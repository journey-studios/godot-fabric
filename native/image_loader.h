#pragma once

#include "http_core.h"
#include "image_effects_core.h"
#include <folly/dynamic.h>
#include <godot_cpp/classes/image_texture.hpp>
#include <react/renderer/imagemanager/ImageResponseObserverCoordinator.h>
#include <react/renderer/imagemanager/primitives.h>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <thread>
#include <utility>
#include <vector>

namespace fabric_godot {

class HttpTransport;

// What a view receives for a picture that loaded. The texture exists only on the main thread; the pixels it was made
// from were read and decoded on a worker.
struct LoadedImage {
  godot::Ref<godot::ImageTexture> texture;
  // The texture's pixels, and the file's (they differ when the decode shrank the picture).
  uint64_t width{}, height{};
  uint64_t source_width{}, source_height{};
  // UIImage.scale: pixels per point of this picture. Its size in points is the pixels over this.
  double scale{1};
  std::string format;
  // A 64-bit FNV-1a of the decoded RGBA bytes, which the certification compares with the pixels of the fixture. Empty
  // unless the certification seam asks for it (fingerprints()): a decode does not pass over its pixels for it otherwise.
  std::string fingerprint;
  // The blur that was asked for and what it did. A picture whose blur changed its pixels is derived: it was made for the one request
  // that asked for the blur, and no cache holds it.
  image::BlurPlan blur;
};

// What a view receives for a picture that did not. The code and the headers are those of the HTTP response a failed download came
// with (RCTImageLoader puts them in the NSError's userInfo as httpStatusCode and httpResponseHeaders, which RCTImageComponentView
// hands to onError); a failure that came with no response has neither.
struct LoadFailure {
  std::string message;
  int response_code{};
  std::vector<std::pair<std::string, std::string>> response_headers;
};

// The result of Image.getSize for one source: the pixel size its header gives, or why that cannot be read. Image.prefetch
// takes the same shape and reads only `ok` and `error`.
struct MeasuredImage {
  bool ok{};
  uint64_t width{}, height{};
  std::string error;
};

// RN's ImageManager asks this for every image request. A request is read, decoded and shrunk on Godot's WorkerThreadPool,
// never on the main thread; the main thread only creates the texture, in poll(), and tells the request's observers (RN's
// ImageResponseObserverCoordinator) as RCTImageManager's completion blocks do. Cancelling a request flags its job: a
// decode in flight finishes, and its result is dropped. stop() cancels everything and waits for every task, as the
// pool requires of each task it hands out.
//
// An http(s) source is first downloaded by the loader's own HttpTransport, started and polled from poll() (image_network.h),
// and its bytes go through the same pipeline once they are complete. Two memory caches stand where RN iOS has two: a decoded
// cache (RCTImageCache) that a request of the same URL, size and scale is answered from without a download or a decode, and a
// byte cache (NSURLCache) that the cache policies, Image.prefetch, Image.queryCache and Image.getSize use. Neither is written
// to disk.
class ImageLoader final {
 public:
  using Coordinator = facebook::react::ImageResponseObserverCoordinator;

  // How many bytes of textures one poll() creates, past the first: the budget a frame spends on uploads.
  static constexpr std::size_t default_upload_budget = 8 * 1024 * 1024;
  // How many bytes of response bodies one poll() reads from the network, in all, as Networking's pump reads.
  static constexpr std::size_t default_download_budget = 1024 * 1024;

  explicit ImageLoader(std::thread::id host_thread = std::this_thread::get_id());
  ~ImageLoader();
  ImageLoader(const ImageLoader &) = delete;
  ImageLoader &operator=(const ImageLoader &) = delete;

  // Starts the load of `source` for the request whose observers `coordinator` serves, and returns what cancels it. The
  // request completes or fails once, from the main thread, in a later poll(); a request that is cancelled or whose
  // coordinator is gone never does. A request with a `blur_radius` above epsilon is blurred on the worker after the decode
  // (image_effects_core.h), and neither reads the decoded cache nor writes it.
  std::function<void()> load(const facebook::react::ImageSource &source, std::weak_ptr<const Coordinator> coordinator, double blur_radius = 0);
  // Gives the loader the network: the transport its downloads go through, the clock their idle timeout runs on (monotonic
  // milliseconds) and the wall clock that decides when a cached response is stale (milliseconds since the epoch). Without it
  // an http(s) source fails. Host thread only.
  void enable_network(std::unique_ptr<HttpTransport> transport, std::function<double()> monotonic_ms, std::function<double()> wall_ms);
  // Reads the size of the picture at `uri` (no decode) off the main thread and hands it to `done` from a later poll(). `headers`
  // go with the request of an http(s) source (getSizeWithHeaders).
  void measure(const std::string &uri, std::vector<std::pair<std::string, std::string>> headers, std::function<void(MeasuredImage)> done);
  // Downloads (an http(s) source) or reads the picture at `uri`, decodes it off the main thread to see that it is one, and tells
  // `done`: a network response stays in the byte cache.
  void prefetch(const std::string &uri, std::function<void(MeasuredImage)> done);
  // "memory" when the byte cache holds a response for the URL, as NSURLCache.cachedResponseForRequest finds one; empty otherwise.
  std::string cache_status(const std::string &uri) const;
  // The host's memory warning: both caches give their memory back. Host thread only.
  void clear_caches();
  // Reports finished work to its requesters from the main thread. At most `upload_budget` bytes of textures are created
  // per call (one always is, so that a large picture cannot starve), and the rest waits for the next.
  void poll(std::size_t upload_budget);
  // Cancels every request, waits for every task and refuses new work. No observer is told anything afterwards.
  void stop();
  // The certification seam: while held, a worker that has finished its job waits before handing it over, so that a
  // decode is in flight for as long as a test needs it to be. Only the "images-fixture" scenario exposes it to JS.
  void hold(bool held);
  // The other half of the seam: how many jobs may be in the pool at once (4 by default). The pool decides how many of
  // them run at the same time, which differs from machine to machine; a limit of 1 makes a test independent of that.
  void limit(std::size_t in_flight);
  // And the third: replaces the upload budget of poll() (0 restores it), so that a test can make every poll create one texture (and
  // starts counting the most textures one poll created again).
  void budget(std::size_t bytes);
  // And the fourth: makes each decode fingerprint its pixels (off by default), which only the certification reads.
  void fingerprints(bool enabled);
  // And the fifth: the most bytes of one response the loader accepts (0 restores the default), so that a test need not serve
  // a response of the default size to see one refused.
  void response_limit(uint64_t bytes);
  folly::dynamic snapshot() const;

 private:
  struct Job;
  struct State;
  std::shared_ptr<State> state_;
};

}  // namespace fabric_godot
