#include "image_loader.h"
#include "image_core.h"
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
  Ref<Image> pixels;
  bool progress{};
  double progress_fraction{};
  int64_t progress_loaded{}, progress_total{};
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
  uint64_t requested{}, measures{}, loaded{}, failed{}, cancelled{}, dropped{}, measured{}, uploads{}, upload_bytes{},
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
  static bool gone(const Job &job) { return job.cancelled.load() || (!job.measure_only && job.coordinator.expired()); }
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
    if (source.kind == image::SourceKind::Network || source.kind == image::SourceKind::Unsupported) {
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
    folly::dynamic entry = folly::dynamic::object("id", job.id)("kind", job.measure_only ? "measure" : kind_name(job.parsed.kind))
        ("source", kind_name(job.parsed.kind))("uri", display_uri(job.parsed, job.uri))("outcome", outcome)
        ("thread", folly::dynamic::object("worker", job.worker_thread)("id", job.thread_id))
        ("format", job.format)("sourceWidth", job.source_width)("sourceHeight", job.source_height)
        ("width", job.width)("height", job.height)("scale", job.scale)("fingerprint", job.fingerprint)("uploaded", uploaded)
        ("error", job.error)("request", folly::dynamic::object("width", job.source.size.width)("height", job.source.size.height)("scale", job.source.scale))
        ("progress", std::move(progress));
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
      ++(job->measure_only ? measures : requested);
      pending.push_back(job);
    }
    // Only the host thread starts tasks; any other thread's work is picked up by the next poll.
    if (on_host()) dispatch();
    return job;
  }

  // Starts the pending jobs the pool may hold, in order.
  void dispatch() {
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

  void deliver(const std::shared_ptr<Job> &job, uint64_t &uploaded) {
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
    if (job->measure_only) {
      MeasuredImage result;
      result.ok = job->outcome == Job::Outcome::Loaded;
      result.width = job->source_width;
      result.height = job->source_height;
      result.error = job->error;
      record(*job, result.ok ? "measured" : "failed");
      count(measured);
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
      coordinator->nativeImageResponseFailed(rn::ImageLoadError(std::make_shared<LoadFailure>(LoadFailure{job->error})));
      return;
    }
    auto texture = ImageTexture::create_from_image(job->pixels);
    job->pixels.unref();
    if (texture.is_null()) {
      job->error = "Could not create a texture for the image";
      record(*job, "failed");
      count(failed);
      coordinator->nativeImageResponseFailed(rn::ImageLoadError(std::make_shared<LoadFailure>(LoadFailure{job->error})));
      return;
    }
    uploaded += job->width * job->height * 4;
    {
      const std::lock_guard<std::mutex> lock(mutex);
      ++uploads;
      upload_bytes += job->width * job->height * 4;
      ++loaded;
    }
    record(*job, "loaded", true);
    auto live = live_textures;
    ++*live;
    auto *picture = new LoadedImage{std::move(texture), job->width, job->height, job->source_width, job->source_height, job->scale, job->format, job->fingerprint};
    coordinator->nativeImageResponseComplete(rn::ImageResponse(std::shared_ptr<LoadedImage>(picture, [live](LoadedImage *value) {
      delete value;
      --*live;
    }), nullptr));
  }

  void poll(std::size_t budget) {
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
      const bool uploads_now = job->outcome == Job::Outcome::Loaded && !job->measure_only && !gone(*job);
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
    {
      const std::lock_guard<std::mutex> lock(gate_mutex);
      held = false;
    }
    gate.notify_all();
    std::vector<std::shared_ptr<Job>> waiting;
    {
      const std::lock_guard<std::mutex> lock(mutex);
      for (const auto &job : pending) job->cancelled = true;
      pending.clear();
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
    }
    for (const auto &job : ready) job->cancelled = true;
    ready.clear();
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
    return folly::dynamic::object("stopped", stopped.load())("held", is_held)("atGate", waiting.load())("hostThread", thread_name(host))
        ("limits", folly::dynamic::object("maxInFlight", max_in_flight.load())("maxDimension", image::max_dimension)("maxPixels", image::max_pixels)
            ("maxSourceBytes", image::max_source_bytes))
        ("counters", folly::dynamic::object("requested", requested)("measures", measures)("loaded", loaded)("failed", failed)
            ("cancelled", cancelled)("dropped", dropped)("measured", measured)("uploads", uploads)("uploadBytes", upload_bytes)
            ("deferredUploads", deferred_uploads)("peakUploadsPerPoll", peak_uploads_per_poll)("tasksStarted", tasks_started)("tasksAwaited", tasks_awaited)
            ("peakInFlight", peak_in_flight))
        ("pending", pending.size())("inFlight", in_flight.size())("finished", finished.size())("ready", ready.size())
        ("liveTextures", live_textures->load())("flight", std::move(flight))("jobs", std::move(jobs));
  }
};

ImageLoader::ImageLoader(std::thread::id host_thread) : state_(std::make_shared<State>(host_thread)) {}
ImageLoader::~ImageLoader() { state_->stop(); }

std::function<void()> ImageLoader::load(const rn::ImageSource &source, std::weak_ptr<const Coordinator> coordinator) {
  if (state_->stopped.load()) return [] {};
  auto job = std::make_shared<Job>();
  job->source = source;
  job->uri = source.uri;
  job->parsed = image::classify(source.uri);
  job->coordinator = std::move(coordinator);
  state_->enqueue(job);
  return [job] { job->cancelled = true; };
}

void ImageLoader::measure(const std::string &uri, std::function<void(MeasuredImage)> done) {
  if (state_->stopped.load()) return;
  auto job = std::make_shared<Job>();
  job->measure_only = true;
  job->uri = uri;
  // A vector is measured at its own size.
  job->source.scale = 1;
  job->parsed = image::classify(uri);
  job->measured = std::move(done);
  state_->enqueue(job);
}

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
