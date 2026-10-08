#include "image_loader.h"
#include "image_core.h"
#include "image_sources.h"
#include <godot_cpp/classes/file_access.hpp>
#include <godot_cpp/classes/image.hpp>
#include <godot_cpp/classes/worker_thread_pool.hpp>
#include <godot_cpp/variant/packed_byte_array.hpp>
#include <godot_cpp/variant/string.hpp>
#include <atomic>
#include <condition_variable>
#include <cstring>
#include <deque>
#include <map>
#include <mutex>
#include <stdexcept>
#include <utility>
#include <vector>

namespace rn = facebook::react;
using namespace godot;

namespace fabric_godot {
namespace {
// RCTImageLoader keeps at most maxConcurrentDecodingTasks (2) decodes and 30 MB of them going; the pool is shared with
// the engine, so a page full of images must not fill it either.
constexpr std::size_t default_in_flight = 4;
constexpr std::size_t max_records = 256;

std::string hex64(uint64_t value) {
  static constexpr char digits[] = "0123456789abcdef";
  std::string out(16, '0');
  for (int i = 15; i >= 0; --i, value >>= 4) out[static_cast<std::size_t>(i)] = digits[value & 15];
  return out;
}
// Recorded as text: a hash of a thread's identity does not survive a JSON number.
std::string thread_name(std::thread::id id) { return hex64(std::hash<std::thread::id>{}(id)); }
std::string display_uri(const image::Source &source, const std::string &uri) {
  if (source.kind != image::SourceKind::Data) return uri;
  return "data:" + source.media_type + (source.base64 ? ";base64" : "") + ",<" + std::to_string(source.payload.size()) + " characters>";
}
const char *kind_name(image::SourceKind kind) {
  switch (kind) {
    case image::SourceKind::Bundle: return "bundle";
    case image::SourceKind::File: return "file";
    case image::SourceKind::Data: return "data";
    case image::SourceKind::Network: return "network";
    case image::SourceKind::Unsupported: break;
  }
  return "unsupported";
}
bool ends_with_ci(const std::string &text, std::string_view suffix) {
  return text.size() >= suffix.size() && http::iequals(std::string_view(text).substr(text.size() - suffix.size()), suffix);
}
std::string file_error(Error error) {
  switch (error) {
    case ERR_FILE_NOT_FOUND: return "no such file";
    case ERR_FILE_NO_PERMISSION: return "permission denied";
    case ERR_FILE_CANT_OPEN: return "it cannot be opened";
    default: return "Godot error " + std::to_string(static_cast<int>(error));
  }
}
}  // namespace

struct ImageLoader::Job {
  enum class Outcome { Pending, Loaded, Failed, Cancelled };
  uint64_t id{};
  bool measure_only{};
  // Image.prefetch: a picture read and decoded only to see that it is one.
  bool prefetch{};
  rn::ImageSource source;
  image::Source parsed;
  std::string uri;
  std::weak_ptr<const ImageLoader::Coordinator> coordinator;
  std::function<void(MeasuredImage)> measured;
  std::atomic<bool> cancelled{};
  std::atomic<int64_t> task{-1};
  // 0 queued in the pool, 1 running, 2 finished and waiting at the gate.
  std::atomic<int> phase{};
  // Written by the worker, read by the main thread once the job is in the mailbox.
  Outcome outcome{Outcome::Pending};
  bool worker_thread{};
  std::string thread_id;
  std::string error, format, fingerprint;
  uint64_t source_width{}, source_height{}, width{}, height{};
  double scale{1};
  // ImageRequestParams.blurRadius, and what the worker made of it.
  double blur_radius{};
  image::BlurPlan blur;
  bool blurs() const { return blur_radius > image::flt_epsilon; }
  Ref<Image> pixels;
  bool progress{};
  double progress_fraction{};
  int64_t progress_loaded{}, progress_total{};
  // ---- an http(s) source ----
  struct Network {
    // The picture or the bytes the sources found, or why they found none, and what came with them.
    Resolution found;
    uint64_t progress_events{};
  };
  bool network{};
  Network net;
  bool creates_texture() const { return outcome == Outcome::Loaded && !measure_only && !prefetch && !net.found.picture; }
  // The request's cancel closure keeps the job alive as long as the request lives, which is far longer than the job needs its bytes
  // and its picture: they are let go as soon as the job is over (delivered, cancelled or stopped).
  void release() {
    net.found.bytes.reset();
    net.found.picture.reset();
    pixels.unref();
  }
};

struct ImageLoader::State : std::enable_shared_from_this<ImageLoader::State> {
  const std::thread::id host;
  explicit State(std::thread::id host) : host(host) {}

  std::mutex mutex;
  // Everything below is guarded by the mutex, except `ready`, which only the host thread touches.
  std::deque<std::shared_ptr<Job>> pending;
  // Dispatched jobs whose task has not been awaited yet, finished or not.
  std::map<uint64_t, std::shared_ptr<Job>> in_flight;
  std::vector<std::shared_ptr<Job>> finished;
  std::deque<folly::dynamic> records;
  uint64_t next_id{1};
  uint64_t requested{}, measures{}, loaded{}, blurred{}, failed{}, cancelled{}, dropped{}, measured{}, uploads{}, upload_bytes{},
      tasks_started{}, tasks_awaited{}, peak_in_flight{}, deferred_uploads{}, peak_uploads_per_poll{};
  std::atomic<bool> stopped{};
  std::atomic<std::size_t> max_in_flight{default_in_flight};
  std::atomic<std::size_t> budget_override{};
  std::atomic<bool> fingerprints{};
  std::mutex gate_mutex;
  std::condition_variable gate;
  bool held{};
  // Workers that finished their job and wait at the gate.
  std::atomic<int> waiting{};
  std::shared_ptr<std::atomic<int>> live_textures = std::make_shared<std::atomic<int>>(0);
  std::deque<std::shared_ptr<Job>> ready;

  // The sources of http(s) pictures (host thread only): the downloads and the two caches. A network job waits in `fresh` (guarded by
  // the mutex) until the host thread asks the sources for its picture.
  ImageSources sources;
  std::deque<std::shared_ptr<Job>> fresh;
  uint64_t prefetches{}, prefetched{}, cache_clears{};

  bool on_host() const { return std::this_thread::get_id() == host; }

  struct TaskArguments {
    std::shared_ptr<State> state;
    std::shared_ptr<Job> job;
  };
  static void run_task(void *userdata) {
    std::unique_ptr<TaskArguments> arguments(static_cast<TaskArguments *>(userdata));
    arguments->state->work(*arguments->job);
    arguments->job->phase = 2;
    arguments->state->wait_for_release();
    arguments->state->post(arguments->job);
  }

  // ---- worker side ----

  // A worker waits here while the certification seam holds the pool; stopping releases it. The host thread never
  // waits, so a test cannot hold its own main loop.
  void wait_for_release() {
    if (on_host()) return;
    std::unique_lock<std::mutex> lock(gate_mutex);
    ++waiting;
    gate.wait(lock, [this] { return !held || stopped.load(); });
    --waiting;
  }
  void set_hold(bool value) {
    {
      const std::lock_guard<std::mutex> lock(gate_mutex);
      held = value;
    }
    gate.notify_all();
  }

  void post(const std::shared_ptr<Job> &job) {
    const std::lock_guard<std::mutex> lock(mutex);
    finished.push_back(job);
  }
  static bool gone(const Job &job) { return job.cancelled.load() || (!job.measure_only && !job.prefetch && job.coordinator.expired()); }
  // True, with the job cancelled, once nothing wants its picture any more.
  static bool abandon(Job &job) {
    if (!gone(job)) return false;
    job.outcome = Job::Outcome::Cancelled;
    return true;
  }
  static void fail(Job &job, std::string message) {
    job.outcome = Job::Outcome::Failed;
    job.error = std::move(message);
  }
  static std::string decode_error(std::size_t bytes, const std::string &reason) {
    return "Error decoding image data <" + std::to_string(bytes) + " bytes>: " + reason;
  }

  void work(Job &job) noexcept {
    job.phase = 1;
    job.worker_thread = std::this_thread::get_id() != host;
    job.thread_id = thread_name(std::this_thread::get_id());
    try {
      run(job);
    } catch (const std::exception &error) {
      fail(job, std::string("Error loading image: ") + error.what());
    } catch (...) {
      fail(job, "Error loading image");
    }
    if (job.outcome == Job::Outcome::Pending) fail(job, "Error loading image");
  }

  bool read(Job &job, PackedByteArray &bytes) {
    const auto &source = job.parsed;
    if (source.kind == image::SourceKind::Data) {
      const auto decoded = image::data_uri_bytes(source);
      if (!decoded) {
        fail(job, "The data: image URI does not hold valid " + std::string(source.base64 ? "base64" : "percent-encoded") + " data");
        return false;
      }
      if (decoded->size() > image::max_source_bytes) {
        fail(job, "The image data is over the host limit of " + std::to_string(image::max_source_bytes) + " bytes");
        return false;
      }
      bytes.resize(static_cast<int64_t>(decoded->size()));
      if (!decoded->empty()) std::memcpy(bytes.ptrw(), decoded->data(), decoded->size());
      return true;
    }
    if (source.kind == image::SourceKind::Network) {
      // Downloaded (or kept) whole before the job got here.
      const auto &body = job.net.found.bytes;
      if (!body) {
        fail(job, "No image data");
        return false;
      }
      if (body->size() > image::max_source_bytes) {
        fail(job, "The image is " + std::to_string(body->size()) + " bytes, over the host limit of " + std::to_string(image::max_source_bytes));
        return false;
      }
      bytes.resize(static_cast<int64_t>(body->size()));
      if (!body->empty()) std::memcpy(bytes.ptrw(), body->data(), body->size());
      return true;
    }
    const String path = String::utf8(source.path.c_str());
    Ref<FileAccess> file = FileAccess::open(path, FileAccess::READ);
    if (file.is_null()) {
      const auto reason = file_error(FileAccess::get_open_error());
      fail(job, source.kind == image::SourceKind::Bundle ? "Could not find image " + job.uri + " (" + reason + ")"
                                                         : "The file " + source.path + " could not be opened: " + reason);
      return false;
    }
    const uint64_t length = file->get_length();
    if (length > image::max_source_bytes) {
      fail(job, "The image file is " + std::to_string(length) + " bytes, over the host limit of " + std::to_string(image::max_source_bytes));
      return false;
    }
    bytes = file->get_buffer(static_cast<int64_t>(length));
    if (static_cast<uint64_t>(bytes.size()) != length) {
      fail(job, "The image file " + source.path + " could not be read to its end");
      return false;
    }
    return true;
  }

  void run(Job &job) {
    const auto &source = job.parsed;
    if (abandon(job)) return;
    if (source.kind == image::SourceKind::Unsupported) {
      fail(job, source.reason);
      return;
    }
    PackedByteArray bytes;
    if (!read(job, bytes)) return;
    const std::size_t size = static_cast<std::size_t>(bytes.size());
    if (size == 0) {
      fail(job, "No image data");
      return;
    }
    // What the iOS request handlers report once the bytes are in: the file handler's size over the file's size, the data
    // handler's over an unknown length (-1), which is what its progress block divides by. A bundled asset reports (1, 1)
    // when it decodes (RCTBundleAssetImageLoader.mm), below.
    if (source.kind == image::SourceKind::File) {
      job.progress = true;
      job.progress_fraction = 1;
      job.progress_loaded = job.progress_total = static_cast<int64_t>(size);
    } else if (source.kind == image::SourceKind::Data) {
      job.progress = true;
      job.progress_loaded = static_cast<int64_t>(size);
      job.progress_total = -1;
      job.progress_fraction = -static_cast<double>(static_cast<float>(size));
    }
    if (abandon(job)) return;
    const std::string_view view(reinterpret_cast<const char *>(bytes.ptr()), size);
    const bool tga_declared = ends_with_ci(source.path, ".tga") || source.media_type == "image/x-tga" || source.media_type == "image/tga" ||
        source.media_type == "image/x-targa";
    const auto format = image::sniff(view, tga_declared);
    if (format == image::Format::Unknown || format == image::Format::Gif) {
      fail(job, decode_error(size, format == image::Format::Gif ? "GIF images are not supported by this host yet" : "the bytes are not an image format this host decodes (PNG, JPEG, WebP, BMP, TGA or SVG)"));
      return;
    }
    job.format = image::format_name(format);
    const double request_scale = job.source.scale > 0 ? job.source.scale : 1;
    const auto header = image::read_dimensions(format, view, request_scale);
    if (!header) {
      fail(job, decode_error(size, std::string("the ") + job.format + " header is damaged or truncated"));
      return;
    }
    job.source_width = header->width;
    job.source_height = header->height;
    // Reading a size allocates nothing, so a header is believed whatever it says; a decode is what its limits protect.
    if (job.measure_only) {
      if (header->width == 0 || header->height == 0) fail(job, "The image has no pixels");
      else job.outcome = Job::Outcome::Loaded;
      return;
    }
    if (const auto problem = image::dimension_problem(*header); !problem.empty()) {
      fail(job, decode_error(size, problem));
      return;
    }
    Ref<Image> pixels;
    pixels.instantiate();
    Error result = ERR_UNAVAILABLE;
    switch (format) {
      case image::Format::Png: result = pixels->load_png_from_buffer(bytes); break;
      case image::Format::Jpeg: result = pixels->load_jpg_from_buffer(bytes); break;
      case image::Format::WebP: result = pixels->load_webp_from_buffer(bytes); break;
      case image::Format::Bmp: result = pixels->load_bmp_from_buffer(bytes); break;
      case image::Format::Tga: result = pixels->load_tga_from_buffer(bytes); break;
      case image::Format::Svg: result = pixels->load_svg_from_buffer(bytes, static_cast<float>(request_scale)); break;
      default: break;
    }
    if (result != OK || pixels->is_empty()) {
      fail(job, decode_error(size, std::string("the ") + job.format + " decoder rejected the data"));
      return;
    }
    // The header said what the decoder was allowed to allocate; the decoded picture is what it did.
    if (!image::dimension_problem({static_cast<uint64_t>(pixels->get_width()), static_cast<uint64_t>(pixels->get_height())}).empty()) {
      fail(job, decode_error(size, "the decoded picture is larger than its header said"));
      return;
    }
    if (abandon(job)) return;
    // A prefetch only needed to see that the bytes are a picture.
    if (job.prefetch) {
      job.outcome = Job::Outcome::Loaded;
      return;
    }
    // A bundled asset is decoded whole (UIImage imageNamed), at the scale its file name states. The loader shrinks the others
    // to the request, and vectors are rasterized at the request's scale to start with.
    if (source.kind != image::SourceKind::Bundle && format != image::Format::Svg) {
      const auto target = image::decode_target(static_cast<uint64_t>(pixels->get_width()), static_cast<uint64_t>(pixels->get_height()),
          job.source.size.width, job.source.size.height, request_scale);
      if (target.width != static_cast<uint64_t>(pixels->get_width()) || target.height != static_cast<uint64_t>(pixels->get_height()))
        pixels->resize(static_cast<int32_t>(target.width), static_cast<int32_t>(target.height), Image::INTERPOLATE_LANCZOS);
    }
    if (pixels->get_format() != Image::FORMAT_RGBA8) pixels->convert(Image::FORMAT_RGBA8);
    job.width = static_cast<uint64_t>(pixels->get_width());
    job.height = static_cast<uint64_t>(pixels->get_height());
    job.scale = source.kind == image::SourceKind::Bundle && format != image::Format::Svg ? image::bundle_scale(source.path) : request_scale;
    if (job.blurs()) {
      // RCTImageComponentView blurs on a background queue after the image arrives; here it is part of the job, before the pixels become a
      // texture, so that a blurred picture is never one that a cache or another view holds.
      if (abandon(job)) return;
      job.blur = image::blur_plan(job.blur_radius, job.scale);
      if (job.blur.applies) {
        PackedByteArray data = pixels->get_data();
        image::box_blur_rgba8(data.ptrw(), job.width, job.height, job.blur.kernel);
        pixels->set_data(static_cast<int32_t>(job.width), static_cast<int32_t>(job.height), false, Image::FORMAT_RGBA8, data);
      }
    }
    if (fingerprints.load()) {
      const PackedByteArray data = pixels->get_data();
      uint64_t hash = 0xcbf29ce484222325ull;
      for (int64_t i = 0, count = data.size(); i < count; ++i) hash = (hash ^ data[i]) * 0x100000001b3ull;
      job.fingerprint = hex64(hash);
    }
    if (source.kind == image::SourceKind::Bundle) {
      job.progress = true;
      job.progress_fraction = 1;
      job.progress_loaded = job.progress_total = 1;
    }
    if (abandon(job)) return;
    job.pixels = pixels;
    job.outcome = Job::Outcome::Loaded;
  }

  // ---- host side ----

  void record(const Job &job, const char *outcome, bool uploaded = false) {
    folly::dynamic progress = nullptr;
    if (job.progress) progress = folly::dynamic::object("progress", job.progress_fraction)("loaded", job.progress_loaded)("total", job.progress_total);
    folly::dynamic entry = folly::dynamic::object("id", job.id)("kind", job.measure_only ? "measure" : job.prefetch ? "prefetch" : kind_name(job.parsed.kind))
        ("source", kind_name(job.parsed.kind))("uri", display_uri(job.parsed, job.uri))("outcome", outcome)
        ("thread", folly::dynamic::object("worker", job.worker_thread)("id", job.thread_id))
        ("format", job.format)("sourceWidth", job.source_width)("sourceHeight", job.source_height)
        ("width", job.width)("height", job.height)("scale", job.scale)("fingerprint", job.fingerprint)("uploaded", uploaded)
        ("error", job.error)("request", folly::dynamic::object("width", job.source.size.width)("height", job.source.size.height)("scale", job.source.scale))
        ("blur", folly::dynamic::object("radius", job.blur_radius)("kernel", job.blur.kernel)("passes", job.blur.passes)("applies", job.blur.applies))
        ("progress", std::move(progress));
    if (job.network) {
      const auto &found = job.net.found;
      entry["served"] = found.served;
      entry["policy"] = image::policy_name(cache_policy(job.source.cache));
      entry["prefetch"] = job.prefetch;
      entry["response"] = folly::dynamic::object("has", found.has_response)("status", found.status)("url", found.final_url)("bytes", found.downloaded)
          ("code", found.failure_code)("progressEvents", job.net.progress_events);
    }
    const std::lock_guard<std::mutex> lock(mutex);
    records.push_back(std::move(entry));
    if (records.size() > max_records) records.pop_front();
  }
  void count(uint64_t &counter) {
    const std::lock_guard<std::mutex> lock(mutex);
    ++counter;
  }

  std::shared_ptr<Job> enqueue(std::shared_ptr<Job> job) {
    {
      const std::lock_guard<std::mutex> lock(mutex);
      job->id = next_id++;
      ++(job->measure_only ? measures : job->prefetch ? prefetches : requested);
      // A network job downloads before it can be decoded: the host thread begins it.
      (job->network ? fresh : pending).push_back(job);
    }
    // Only the host thread starts tasks; any other thread's work is picked up by the next poll.
    if (on_host()) dispatch();
    return job;
  }

  // Starts the network jobs that have not begun, then the pending jobs the pool may hold, in order.
  void dispatch() {
    begin_network_jobs();
    while (!stopped.load()) {
      std::shared_ptr<Job> job;
      bool skip;
      {
        const std::lock_guard<std::mutex> lock(mutex);
        if (pending.empty() || in_flight.size() >= max_in_flight.load()) return;
        job = pending.front();
        pending.pop_front();
        skip = gone(*job);
        if (!skip) {
          in_flight.emplace(job->id, job);
          ++tasks_started;
          peak_in_flight = std::max<uint64_t>(peak_in_flight, in_flight.size());
        }
      }
      if (skip) {
        // Cancelled before it started: it never reaches the pool.
        job->release();
        job->outcome = Job::Outcome::Cancelled;
        record(*job, "cancelled");
        count(cancelled);
        continue;
      }
      auto *arguments = new TaskArguments{shared_from_this(), job};
      job->task = WorkerThreadPool::get_singleton()->add_native_task(&State::run_task, arguments, false, "Godot Fabric image load");
    }
  }

  // Moves the jobs the workers have finished into `ready`, and awaits their tasks.
  void reap() {
    std::vector<std::shared_ptr<Job>> taken;
    {
      const std::lock_guard<std::mutex> lock(mutex);
      taken.swap(finished);
      for (const auto &job : taken) in_flight.erase(job->id);
    }
    for (const auto &job : taken) {
      if (job->task.load() >= 0) {
        WorkerThreadPool::get_singleton()->wait_for_task_completion(job->task.load());
        count(tasks_awaited);
      }
      ready.push_back(job);
    }
  }

  // ---- network jobs ----

  // What the sources are asked for a job's picture.
  // A blurred picture is made for its request alone, so it is not a picture the decoded cache may hold or answer with.
  static SourceRequest request_of(const Job &job) { return SourceRequest::from(job.source, !job.measure_only && !job.prefetch && !job.blurs()); }

  void begin_network_jobs() {
    while (!stopped.load()) {
      std::shared_ptr<Job> job;
      {
        const std::lock_guard<std::mutex> lock(mutex);
        if (fresh.empty()) return;
        job = fresh.front();
        fresh.pop_front();
      }
      begin_network_job(job);
    }
  }

  // Asks the sources where the job's picture comes from. A picture in the decoded cache, a response in the byte cache and a refusal
  // come back at once, and a download from a later poll.
  void begin_network_job(const std::shared_ptr<Job> &job) {
    if (gone(*job)) {
      job->outcome = Job::Outcome::Cancelled;
      record(*job, "cancelled");
      count(cancelled);
      return;
    }
    SourceHooks hooks;
    hooks.abandoned = [job] { return gone(*job); };
    hooks.progress = [this, job](int64_t loaded, int64_t total) { on_progress(*job, loaded, total); };
    hooks.done = [this, job](Resolution found) { on_resolved(job, std::move(found)); };
    sources.resolve(request_of(*job), std::move(hooks));
  }

  // RCTImageManager's progress block: (float)progress / (float)total, which is negative while the length is unknown.
  void on_progress(Job &job, int64_t loaded, int64_t total) {
    if (job.measure_only || job.prefetch || gone(job)) return;
    const auto coordinator = job.coordinator.lock();
    if (!coordinator) return;
    ++job.net.progress_events;
    job.progress_loaded = loaded;
    job.progress_total = total;
    coordinator->nativeImageResponseProgress(total != 0 ? static_cast<float>(loaded) / static_cast<float>(total) : 0.0f, loaded, total);
  }

  // What the sources found: a picture that needs no decode goes to be delivered, bytes go to the pool to be decoded.
  void on_resolved(const std::shared_ptr<Job> &job, Resolution found) {
    job->net.found = std::move(found);
    const auto &net = job->net.found;
    switch (net.kind) {
      case Resolution::Kind::Picture: {
        const auto &picture = *net.picture;
        job->width = picture.width;
        job->height = picture.height;
        job->source_width = picture.source_width;
        job->source_height = picture.source_height;
        job->scale = picture.scale;
        job->format = picture.format;
        job->fingerprint = picture.fingerprint;
        job->outcome = Job::Outcome::Loaded;
        ready.push_back(job);
        return;
      }
      case Resolution::Kind::Bytes: {
        job->parsed.path = net.path;
        job->parsed.media_type = net.media_type;
        const std::lock_guard<std::mutex> lock(mutex);
        pending.push_back(job);
        return;
      }
      case Resolution::Kind::Failed:
        job->error = net.error;
        job->outcome = Job::Outcome::Failed;
        break;
      case Resolution::Kind::Cancelled:
        job->outcome = Job::Outcome::Cancelled;
        break;
    }
    ready.push_back(job);
  }

  void clear_caches() {
    sources.clear_caches();
    ++cache_clears;
  }

  void deliver(const std::shared_ptr<Job> &job, uint64_t &uploaded) {
    // The bytes were for the decode, which is over. A picture from the decoded cache is handed over below, and then let go.
    job->net.found.bytes.reset();
    if (job->outcome == Job::Outcome::Cancelled) {
      record(*job, "cancelled");
      count(cancelled);
      return;
    }
    if (gone(*job)) {
      // A decode that finished after its request was cancelled, or after nothing was left to ask for it.
      job->pixels.unref();
      record(*job, "dropped");
      count(dropped);
      return;
    }
    if (job->measure_only || job->prefetch) {
      // A size and a prefetch tell their caller, not a view: the size the header gives, or whether the bytes are a picture.
      MeasuredImage result{job->outcome == Job::Outcome::Loaded, job->source_width, job->source_height, job->error};
      job->pixels.unref();
      record(*job, !result.ok ? "failed" : job->measure_only ? "measured" : "prefetched");
      count(job->measure_only ? measured : prefetched);
      if (job->measured) job->measured(std::move(result));
      return;
    }
    const auto coordinator = job->coordinator.lock();
    if (!coordinator) {
      job->pixels.unref();
      record(*job, "dropped");
      count(dropped);
      return;
    }
    if (job->progress) coordinator->nativeImageResponseProgress(static_cast<float>(job->progress_fraction), job->progress_loaded, job->progress_total);
    if (job->outcome == Job::Outcome::Failed) {
      record(*job, "failed");
      count(failed);
      coordinator->nativeImageResponseFailed(
          rn::ImageLoadError(std::make_shared<LoadFailure>(LoadFailure{job->error, job->net.found.failure_code, job->net.found.failure_headers})));
      return;
    }
    if (job->net.found.picture) {
      // The decoded cache already holds this picture: no download, no decode and no texture. Views share it.
      record(*job, "loaded");
      count(loaded);
      const auto picture = std::move(job->net.found.picture);
      coordinator->nativeImageResponseComplete(rn::ImageResponse(picture, nullptr));
      return;
    }
    auto texture = ImageTexture::create_from_image(job->pixels);
    job->pixels.unref();
    if (texture.is_null()) {
      job->error = "Could not create a texture for the image";
      record(*job, "failed");
      count(failed);
      coordinator->nativeImageResponseFailed(rn::ImageLoadError(std::make_shared<LoadFailure>(LoadFailure{job->error, 0, {}})));
      return;
    }
    uploaded += job->width * job->height * 4;
    {
      const std::lock_guard<std::mutex> lock(mutex);
      ++uploads;
      upload_bytes += job->width * job->height * 4;
      ++loaded;
      if (job->blur.applies) ++blurred;
    }
    record(*job, "loaded", true);
    auto live = live_textures;
    ++*live;
    auto *picture = new LoadedImage{std::move(texture), job->width, job->height, job->source_width, job->source_height, job->scale, job->format, job->fingerprint, job->blur};
    const std::shared_ptr<LoadedImage> shared(picture, [live](LoadedImage *value) {
      delete value;
      --*live;
    });
    if (job->network) sources.keep_picture(request_of(*job), job->net.found.freshness, shared, static_cast<std::size_t>(job->width * job->height * 4));
    coordinator->nativeImageResponseComplete(rn::ImageResponse(shared, nullptr));
  }

  void poll(std::size_t budget) {
    if (stopped.load()) return;
    // The network first: what it finishes is decoded by the tasks that dispatch() starts below.
    begin_network_jobs();
    sources.poll(ImageLoader::default_download_budget);
    if (stopped.load()) return;
    reap();
    dispatch();
    if (const auto replaced = budget_override.load()) budget = replaced;
    uint64_t uploaded = 0, uploads_before;
    {
      const std::lock_guard<std::mutex> lock(mutex);
      uploads_before = uploads;
    }
    while (!ready.empty() && !stopped.load()) {
      const auto job = ready.front();
      const bool uploads_now = job->creates_texture() && !gone(*job);
      const uint64_t bytes = job->width * job->height * 4;
      if (uploads_now && uploaded > 0 && uploaded + bytes > budget) {
        count(deferred_uploads);
        break;
      }
      ready.pop_front();
      deliver(job, uploaded);
    }
    {
      const std::lock_guard<std::mutex> lock(mutex);
      peak_uploads_per_poll = std::max<uint64_t>(peak_uploads_per_poll, uploads - uploads_before);
    }
    dispatch();
  }

  void stop() {
    if (stopped.exchange(true)) return;
    // The network first, so that no transport listener runs from here on. The downloads it held are cancelled, and so are the
    // jobs that had not begun.
    sources.stop();
    {
      const std::lock_guard<std::mutex> lock(gate_mutex);
      held = false;
    }
    gate.notify_all();
    std::vector<std::shared_ptr<Job>> waiting;
    {
      const std::lock_guard<std::mutex> lock(mutex);
      for (const auto &job : pending) {
        job->cancelled = true;
        job->release();
      }
      pending.clear();
      for (const auto &job : fresh) job->cancelled = true;
      fresh.clear();
      for (const auto &entry : in_flight) {
        entry.second->cancelled = true;
        waiting.push_back(entry.second);
      }
      in_flight.clear();
      finished.clear();
    }
    // A decode in flight finishes, but nothing it made is used. The pool requires every task it hands out to be awaited.
    for (const auto &job : waiting) {
      if (job->task.load() < 0) continue;
      WorkerThreadPool::get_singleton()->wait_for_task_completion(job->task.load());
      count(tasks_awaited);
      job->release();
    }
    for (const auto &job : ready) {
      job->cancelled = true;
      job->release();
    }
    ready.clear();
    // The pictures the decoded cache holds are textures: none outlives the loader.
    sources.clear_caches();
    // A task that posted after the first clear.
    const std::lock_guard<std::mutex> lock(mutex);
    finished.clear();
  }

  folly::dynamic snapshot() {
    const std::lock_guard<std::mutex> lock(mutex);
    auto jobs = folly::dynamic::array();
    for (const auto &entry : records) jobs.push_back(entry);
    auto flight = folly::dynamic::array();
    for (const auto &entry : in_flight) flight.push_back(folly::dynamic::object("id", entry.first)("uri", display_uri(entry.second->parsed, entry.second->uri))("phase", entry.second->phase.load()));
    bool is_held;
    {
      const std::lock_guard<std::mutex> gate_lock(gate_mutex);
      is_held = held;
    }
    folly::dynamic counters = folly::dynamic::object("requested", requested)("measures", measures)("prefetches", prefetches)("prefetched", prefetched)
        ("cacheClears", cache_clears)("loaded", loaded)("blurred", blurred)("failed", failed)("cancelled", cancelled)("dropped", dropped)("measured", measured)
        ("uploads", uploads)("uploadBytes", upload_bytes)("deferredUploads", deferred_uploads)("peakUploadsPerPoll", peak_uploads_per_poll)
        ("tasksStarted", tasks_started)("tasksAwaited", tasks_awaited)("peakInFlight", peak_in_flight);
    counters.update(sources.counters());
    return folly::dynamic::object("stopped", stopped.load())("held", is_held)("atGate", waiting.load())("hostThread", thread_name(host))
        ("limits", folly::dynamic::object("maxInFlight", max_in_flight.load())("maxDimension", image::max_dimension)("maxPixels", image::max_pixels)
            ("maxSourceBytes", image::max_source_bytes))
        ("counters", std::move(counters))
        ("pending", pending.size())("inFlight", in_flight.size())("finished", finished.size())("ready", ready.size())
        ("fresh", fresh.size())("downloading", sources.downloading())
        ("network", sources.network_snapshot())("caches", sources.caches_snapshot())
        ("liveTextures", live_textures->load())("flight", std::move(flight))("jobs", std::move(jobs));
  }
};

ImageLoader::ImageLoader(std::thread::id host_thread) : state_(std::make_shared<State>(host_thread)) {}
ImageLoader::~ImageLoader() { state_->stop(); }

std::function<void()> ImageLoader::load(const rn::ImageSource &source, std::weak_ptr<const Coordinator> coordinator, double blur_radius) {
  if (state_->stopped.load()) return [] {};
  auto job = std::make_shared<Job>();
  job->source = source;
  job->blur_radius = blur_radius;
  job->uri = source.uri;
  job->parsed = image::classify(source.uri);
  job->network = job->parsed.kind == image::SourceKind::Network;
  job->coordinator = std::move(coordinator);
  state_->enqueue(job);
  return [job] { job->cancelled = true; };
}

void ImageLoader::measure(const std::string &uri, std::vector<std::pair<std::string, std::string>> headers, std::function<void(MeasuredImage)> done) {
  if (state_->stopped.load()) return;
  auto job = std::make_shared<Job>();
  job->measure_only = true;
  job->uri = job->source.uri = uri;
  // A vector is measured at its own size.
  job->source.scale = 1;
  job->source.headers = std::move(headers);
  job->parsed = image::classify(uri);
  job->network = job->parsed.kind == image::SourceKind::Network;
  job->measured = std::move(done);
  state_->enqueue(job);
}

void ImageLoader::prefetch(const std::string &uri, std::function<void(MeasuredImage)> done) {
  if (state_->stopped.load()) return;
  auto job = std::make_shared<Job>();
  job->prefetch = true;
  job->uri = job->source.uri = uri;
  job->source.scale = 1;
  job->parsed = image::classify(uri);
  job->network = job->parsed.kind == image::SourceKind::Network;
  job->measured = std::move(done);
  state_->enqueue(job);
}

void ImageLoader::enable_network(std::unique_ptr<HttpTransport> transport, std::function<double()> monotonic_ms, std::function<double()> wall_ms) {
  if (state_->stopped.load()) return;
  state_->sources.enable_network(std::move(transport), std::move(monotonic_ms), std::move(wall_ms));
}
std::string ImageLoader::cache_status(const std::string &uri) const { return state_->sources.cache_status(uri); }
void ImageLoader::clear_caches() { state_->clear_caches(); }
void ImageLoader::response_limit(uint64_t bytes) { state_->sources.response_limit(bytes); }

void ImageLoader::poll(std::size_t upload_budget) { state_->poll(upload_budget); }
void ImageLoader::stop() { state_->stop(); }
void ImageLoader::hold(bool held) { state_->set_hold(held); }
void ImageLoader::budget(std::size_t bytes) {
  state_->budget_override = bytes;
  // The bound it makes is measured from here.
  const std::lock_guard<std::mutex> lock(state_->mutex);
  state_->peak_uploads_per_poll = 0;
}
void ImageLoader::fingerprints(bool enabled) { state_->fingerprints = enabled; }
void ImageLoader::limit(std::size_t in_flight) {
  state_->max_in_flight = std::max<std::size_t>(1, in_flight);
  if (state_->on_host()) state_->dispatch();
}
folly::dynamic ImageLoader::snapshot() const { return state_->snapshot(); }

}  // namespace fabric_godot
