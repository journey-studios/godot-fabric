#include "image_sources.h"
#include <utility>

namespace fabric_godot {
namespace {
template <typename Value>
folly::dynamic cache_json(const image::ExpiringLru<Value> &cache) {
  auto keys = folly::dynamic::array();
  for (const auto &key : cache.keys()) {
    keys.push_back(key);
  }
  const auto &stats = cache.stats();
  return folly::dynamic::object("entries", cache.size())("bytes", cache.bytes())("totalLimit", cache.total_limit())("entryLimit", cache.entry_limit())
      ("stores", stats.stores)("rejected", stats.rejected)("evictions", stats.evictions)("expired", stats.expired)("replaced", stats.replaced)
      ("keys", std::move(keys));
}
}  // namespace

image::CachePolicy cache_policy(facebook::react::ImageSource::CacheStategy cache) {
  using Cache = facebook::react::ImageSource::CacheStategy;
  switch (cache) {
    case Cache::Reload: return image::CachePolicy::Reload;
    case Cache::ForceCache: return image::CachePolicy::ForceCache;
    case Cache::OnlyIfCached: return image::CachePolicy::OnlyIfCached;
    case Cache::Default: break;
  }
  return image::CachePolicy::Default;
}

SourceRequest SourceRequest::from(const facebook::react::ImageSource &source, bool view) {
  SourceRequest request;
  request.uri = source.uri;
  request.method = source.method;
  request.headers = source.headers;
  request.body = source.body;
  request.policy = cache_policy(source.cache);
  request.view = view;
  request.width = source.size.width;
  request.height = source.size.height;
  request.scale = source.scale;
  return request;
}

void ImageSources::enable_network(std::unique_ptr<HttpTransport> transport, Clock monotonic_ms, Clock wall_ms) {
  if (network_) {
    return;
  }
  wall_ms_ = std::move(wall_ms);
  network_ = std::make_unique<ImageNetwork>(std::move(transport), std::move(monotonic_ms));
  apply_limits();
}

void ImageSources::apply_limits() {
  if (!network_) {
    return;
  }
  auto limits = network_->limits();
  limits.max_response_bytes = response_limit_ > 0 ? response_limit_ : ImageNetwork::Limits{}.max_response_bytes;
  network_->set_limits(limits);
}

void ImageSources::response_limit(uint64_t bytes) {
  response_limit_ = bytes;
  apply_limits();
}

Resolution ImageSources::failure(std::string message) const {
  Resolution found;
  found.kind = Resolution::Kind::Failed;
  found.error = std::move(message);
  return found;
}

void ImageSources::resolve(const SourceRequest &request, SourceHooks hooks) {
  if (!network_) {
    hooks.done(failure("This application has no HTTP transport for network images"));
    return;
  }
  HttpRequest wire;
  if (const auto error = build_download_request({request.method, request.uri, request.headers, request.body}, wire)) {
    hooks.done(failure(*error));
    return;
  }
  const auto url = http::parse_url(request.uri);
  if (!url) {
    hooks.done(failure("The image URL cannot be read"));
    return;
  }
  const std::string cache_url = url->to_string();
  // The path decides whether a .tga file is the TGA it must be declared to be.
  const std::string path = url->target.substr(0, url->target.find('?'));
  // A request that carries a credential neither reads nor writes either cache.
  const bool credentialed = image::carries_credentials(request.headers);
  const bool cacheable = wire.method == "GET" && wire.body.empty() && !credentialed;
  const std::string key = image::decoded_key(request.uri, request.width, request.height, request.scale);
  const double now = wall_ms_ ? wall_ms_() : 0;
  // A stale picture is dropped, as RCTImageCache drops it, whatever the policy then does.
  const auto route = image::route(request.policy, request.view, cacheable, credentialed,
      [&] {
        auto *entry = decoded_.get(key);
        if (!entry) {
          return image::Lookup{};
        }
        const bool stale = decoded_.stale(*entry, now);
        if (stale) {
          decoded_.expire(key);
        }
        return image::Lookup{true, stale};
      },
      [&] {
        const auto *entry = responses_.get(cache_url);
        return entry ? image::Lookup{true, responses_.stale(*entry, now)} : image::Lookup{};
      });
  Resolution found;
  switch (route) {
    case image::Route::DecodedPicture:
      ++decoded_hits_;
      found.kind = Resolution::Kind::Picture;
      found.served = "decoded";
      found.picture = decoded_.peek(key)->value;
      hooks.done(std::move(found));
      return;
    case image::Route::CachedBytes: {
      const auto &entry = responses_.peek(cache_url)->value;
      ++byte_hits_;
      found.kind = Resolution::Kind::Bytes;
      found.served = "bytes";
      found.bytes = entry.body;
      found.path = path;
      if (const auto *type = http::find_header(entry.headers, "content-type")) {
        found.media_type = http::media_type_essence(*type);
      }
      found.freshness = image::response_freshness(entry.headers);
      found.has_response = true;
      found.status = 200;
      found.final_url = entry.final_url;
      found.downloaded = entry.body->size();
      hooks.done(std::move(found));
      return;
    }
    case image::Route::RefuseOnlyIfCached:
      hooks.done(failure(credentialed ? "The image is not in the cache, and its source asks for the cache alone (cache: \"only-if-cached\"); a request that carries credentials never reads the caches"
                                      : "The image is not in the cache, and its source asks for the cache alone (cache: \"only-if-cached\")"));
      return;
    case image::Route::Download:
      break;
  }
  ++downloads_;
  ++downloading_;
  ImageNetwork::Hooks download;
  download.abandoned = std::move(hooks.abandoned);
  download.progress = std::move(hooks.progress);
  download.done = [this, done = std::move(hooks.done), cache_url, cacheable, path](Download finished) {
    --downloading_;
    done(from_download(std::move(finished), cache_url, cacheable, path));
  };
  network_->enqueue(next_download_++, std::move(wire), std::move(download));
}

// What a download that ended is worth to the loader, and what the byte cache keeps of it (NSURLSession puts a 200 in NSURLCache on
// its way to the loader, whoever asked: a view, getSize or prefetch).
Resolution ImageSources::from_download(Download download, const std::string &cache_url, bool cacheable, const std::string &path) {
  Resolution found;
  found.served = "network";
  found.path = path;
  found.has_response = download.has_response;
  found.status = download.status;
  found.final_url = download.final_url;
  found.downloaded = download.received;
  if (download.outcome == Download::Outcome::Abandoned) {
    found.kind = Resolution::Kind::Cancelled;
    return found;
  }
  if (const auto failed = judge_download(download)) {
    found.kind = Resolution::Kind::Failed;
    found.error = failed->message;
    if (failed->has_response) {
      found.failure_code = failed->code;
      found.failure_headers = failed->headers;
    }
    return found;
  }
  // RCTImageCache's rule, for the decoded picture. The byte cache's is the same, except that a response with no readable Date is
  // dated by the time it arrived.
  found.freshness = image::response_freshness(download.headers);
  auto body = std::make_shared<const std::string>(std::move(download.body));
  if (cacheable) {
    const auto kept = found.freshness.dated ? found.freshness : image::response_freshness(download.headers, wall_ms_ ? wall_ms_() : 0);
    if (kept.storable) {
      responses_.put(cache_url, CachedResponse{body, download.headers, download.final_url}, body->size(), kept.stale_at);
    }
  }
  if (const auto *type = http::find_header(download.headers, "content-type")) {
    found.media_type = http::media_type_essence(*type);
  }
  found.kind = Resolution::Kind::Bytes;
  found.bytes = std::move(body);
  return found;
}

void ImageSources::poll(std::size_t byte_budget) {
  if (network_) {
    network_->poll(byte_budget);
  }
}

void ImageSources::stop() {
  if (network_) {
    network_->stop();
  }
  downloading_ = 0;
}

// RCTImageCache keeps what a network response decoded to, unless the request reloaded or the response forbids it.
void ImageSources::keep_picture(const SourceRequest &request, const image::Freshness &freshness, std::shared_ptr<LoadedImage> picture, std::size_t cost) {
  if (!request.view || request.policy == image::CachePolicy::Reload || !freshness.storable || image::carries_credentials(request.headers)) {
    return;
  }
  decoded_.put(image::decoded_key(request.uri, request.width, request.height, request.scale), std::move(picture), cost, freshness.stale_at);
}

std::string ImageSources::cache_status(const std::string &uri) const {
  const auto url = http::parse_url(uri);
  return url && responses_.peek(url->to_string()) ? "memory" : std::string();
}

void ImageSources::clear_caches() {
  decoded_.clear();
  responses_.clear();
}

folly::dynamic ImageSources::counters() const {
  return folly::dynamic::object("decodedHits", decoded_hits_)("byteHits", byte_hits_)("downloads", downloads_);
}
folly::dynamic ImageSources::network_snapshot() const { return network_ ? network_->snapshot() : folly::dynamic(nullptr); }
folly::dynamic ImageSources::caches_snapshot() const {
  return folly::dynamic::object("decoded", cache_json(decoded_))("bytes", cache_json(responses_));
}

}  // namespace fabric_godot
