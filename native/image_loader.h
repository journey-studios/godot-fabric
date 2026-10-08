#pragma once

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

namespace fabric_godot {

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
};

// What a view receives for a picture that did not.
struct LoadFailure {
  std::string message;
};

// The result of Image.getSize for one source: the pixel size its header gives, or why that cannot be read.
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
class ImageLoader final {
 public:
  using Coordinator = facebook::react::ImageResponseObserverCoordinator;

  // How many bytes of textures one poll() creates, past the first: the budget a frame spends on uploads.
  static constexpr std::size_t default_upload_budget = 8 * 1024 * 1024;

  explicit ImageLoader(std::thread::id host_thread = std::this_thread::get_id());
  ~ImageLoader();
  ImageLoader(const ImageLoader &) = delete;
  ImageLoader &operator=(const ImageLoader &) = delete;

  // Starts the load of `source` for the request whose observers `coordinator` serves, and returns what cancels it. The
  // request completes or fails once, from the main thread, in a later poll(); a request that is cancelled or whose
  // coordinator is gone never does.
  std::function<void()> load(const facebook::react::ImageSource &source, std::weak_ptr<const Coordinator> coordinator);
  // Reads the size of the picture at `uri` (no decode) off the main thread and hands it to `done` from a later poll().
  void measure(const std::string &uri, std::function<void(MeasuredImage)> done);
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
  folly::dynamic snapshot() const;

 private:
  struct Job;
  struct State;
  std::shared_ptr<State> state_;
};

}  // namespace fabric_godot
