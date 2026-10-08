#pragma once

// Where the picture of an http(s) image source comes from. The loader's decode pipeline asks this for each such request, and gets
// back a picture it needs no decode for (the decoded cache holds it), the bytes of a response to decode (the byte cache kept them,
// or the network just delivered them), or the reason there is nothing. It owns what RN iOS's RCTImageLoader keeps for that: the
// downloads (image_network.h), the decoded cache (RCTImageCache) and the byte cache (NSURLCache's role), and applies the order and
// the rules the loader follows (image_cache.h's route(), RCTImageCache's freshness). Host thread only; it knows nothing of jobs,
// threads or textures, except that the decoded cache holds the LoadedImage a view draws.

#include "http_core.h"
#include "image_cache.h"
#include "image_loader.h"
#include "image_network.h"
#include <folly/dynamic.h>
#include <react/renderer/imagemanager/primitives.h>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>

namespace fabric_godot {

// ImageSource.cache as the caches' policy.
image::CachePolicy cache_policy(facebook::react::ImageSource::CacheStategy cache);

// What the loader asks for.
struct SourceRequest {
  // What RN's ImageSource asks for. A size and a prefetch are not views: they never touch the decoded cache.
  static SourceRequest from(const facebook::react::ImageSource &source, bool view);

  std::string uri;
  std::string method;
  http::Headers headers;
  std::string body;
  image::CachePolicy policy{image::CachePolicy::Default};
  // A picture for an Image, which consults the decoded cache and fills it; getSize and prefetch use the byte cache alone.
  bool view{};
  // The request's size in points and its scale, which the decoded cache keys a picture on.
  double width{}, height{}, scale{1};
};

// What it finds, and what came with it.
struct Resolution {
  enum class Kind {
    // The decoded cache held the picture: nothing to decode.
    Picture,
    // The bytes of a response to decode, from the byte cache or the network.
    Bytes,
    // Nothing: `error` says why, with the code and headers of the response that came with it, if one did.
    Failed,
    // The download was abandoned.
    Cancelled,
  };
  Kind kind{Kind::Failed};
  // "decoded", "bytes" or "network".
  std::string served;
  std::shared_ptr<LoadedImage> picture;
  std::shared_ptr<const std::string> bytes;
  // What the decode wants to know of the bytes' origin: the path of the URL (a .tga needs to be declared one) and the media type.
  std::string path, media_type;
  // What the response says about keeping the decoded picture (RCTImageCache's rule).
  image::Freshness freshness;
  // The response, if there was one.
  bool has_response{};
  int status{};
  std::string final_url;
  uint64_t downloaded{};
  // A failure: its text and, from the response that came with it, its status and headers (RCTImageComponentView puts them in onError).
  std::string error;
  int failure_code{};
  http::Headers failure_headers;
};

// What the loader gives to be called back. `done` is called once: at once for an answer the caches give, from a later poll() for a
// download. None runs after stop().
struct SourceHooks {
  // Whether nothing wants the picture any more; asked for every download in every poll.
  std::function<bool()> abandoned;
  // The cumulative bytes received and the total, at most once per download per poll.
  std::function<void(int64_t loaded, int64_t total)> progress;
  std::function<void(Resolution)> done;
};

class ImageSources final {
 public:
  using Clock = ImageNetwork::Clock;

  // Gives the sources the network: the transport, the clock the idle timeout runs on (monotonic milliseconds) and the wall clock
  // that decides when a cached response is stale (milliseconds since the epoch). Without it an http(s) request fails.
  void enable_network(std::unique_ptr<HttpTransport> transport, Clock monotonic_ms, Clock wall_ms);
  // Finds where the request's picture comes from; `done` is called, at once or from a later poll.
  void resolve(const SourceRequest &request, SourceHooks hooks);
  // Advances the downloads by at most `byte_budget` bytes of bodies.
  void poll(std::size_t byte_budget);
  // Stops the downloads, the transport first: nothing is called back from here on.
  void stop();
  // The loader hands back the picture it decoded for a request: the decoded cache keeps it when the request and the response allow.
  void keep_picture(const SourceRequest &request, const image::Freshness &freshness, std::shared_ptr<LoadedImage> picture, std::size_t cost);
  // "memory" for a URL the byte cache holds a response for, as NSURLCache.cachedResponseForRequest finds one; empty otherwise.
  std::string cache_status(const std::string &uri) const;
  // Both caches give their memory back (the OS memory warning, and the end of the application).
  void clear_caches();
  // The most bytes of one response accepted (0 restores the default); the certification's seam.
  void response_limit(uint64_t bytes);
  // The downloads that have been asked for and have not ended: the ones running and the ones that wait for a slot.
  uint64_t downloading() const { return downloading_; }
  folly::dynamic counters() const;
  folly::dynamic network_snapshot() const;
  folly::dynamic caches_snapshot() const;

 private:
  struct CachedResponse {
    std::shared_ptr<const std::string> body;
    http::Headers headers;
    std::string final_url;
  };
  Resolution failure(std::string message) const;
  Resolution from_download(Download download, const std::string &cache_url, bool cacheable, const std::string &path);
  void apply_limits();

  std::unique_ptr<ImageNetwork> network_;
  Clock wall_ms_;
  uint64_t response_limit_{};
  image::ExpiringLru<std::shared_ptr<LoadedImage>> decoded_{image::decoded_total_limit, image::decoded_entry_limit};
  image::ExpiringLru<CachedResponse> responses_{image::byte_total_limit, image::byte_entry_limit};
  // The transport tells downloads apart by an id of its own: one per download, from this sequence.
  uint64_t next_download_{1};
  uint64_t decoded_hits_{}, byte_hits_{}, downloads_{}, downloading_{};
};

}  // namespace fabric_godot
