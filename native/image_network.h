#pragma once

// The network half of the image loader: what RN iOS's RCTImageLoader asks of NSURLSession for an http(s) image source, over the
// host's own HttpTransport. A request is built as NSURLRequestFromImageSource builds it, at most four downloads run at once
// (maxConcurrentLoadingTasks), and every outcome is judged as RCTImageLoader judges it: a status other than 200, an empty body
// and a transport failure each fail with their own message and the response that came with them.
//
// The transport reports to listeners from its poll(), and a listener must not cancel or start anything (cancel inside one is a
// use-after-free in the transport). The listeners here only record into the download. Everything that acts on a recording, the
// cancellations, the size and idle limits, the progress and the outcome, happens in ImageNetwork::poll() after the transport's
// poll() has returned. Host thread only. The header holds no Godot and no React Native, so image_network_test.cpp drives it with
// a transport of its own.

#include "http_core.h"
#include "http_transport.h"
#include <folly/dynamic.h>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <utility>

namespace fabric_godot {

// What the image source asks for (RN's ImageSource: uri, method, headers, body).
struct RequestSpec {
  std::string method;
  std::string uri;
  http::Headers headers;
  std::string body;
};

// RCTImagePrimitivesConversions.h NSURLRequestFromImageSource: the method is GET or the source's, upper-cased; the headers are set
// in the order given, so that a later value of a name (compared without case, as NSMutableURLRequest does) replaces the earlier
// one; any method takes the body. The host validates the names and values the transport would write to the wire as they are.
// Returns the reason the request cannot be made, or nothing with `out` filled.
std::optional<std::string> build_download_request(const RequestSpec &spec, HttpRequest &out);

// What a download came to.
struct Download {
  enum class Outcome { Complete, Failed, Abandoned };
  Outcome outcome{Outcome::Failed};
  // The response head, once one arrived: failures after it keep it, as an NSURLResponse outlives the error that ended its task.
  bool has_response{};
  int status{};
  http::Headers headers;
  std::string final_url;
  std::string body;
  // Content-Length, or -1 when the response has none or is chunked (NSURLResponse expectedContentLength).
  int64_t total{-1};
  uint64_t received{};
  // The transport's, or the host's own, explanation of a failure.
  std::string failure;
  bool timed_out{};
};

// Why RCTImageLoader fails an image whose download ended, with the response it came with.
struct DownloadFailure {
  std::string message;
  bool has_response{};
  int code{};
  http::Headers headers;
};
// A completed download that is not a picture to decode: an empty body ("Unknown image download error", checked before the
// status, as RCTNetworkTask hands the loader no data at all) or a status other than 200 ("Failed to load <URL>"). A failed
// download fails with its own message. Nothing for a 200 with a body.
std::optional<DownloadFailure> judge_download(const Download &download);

class ImageNetwork final {
 public:
  using Clock = std::function<double()>;

  struct Limits {
    // maxConcurrentLoadingTasks.
    std::size_t max_downloads{4};
    // Past this many bytes, announced by Content-Length or received, a download is abandoned and fails.
    uint64_t max_response_bytes{128ull * 1024 * 1024};
    // NSURLSession's default timeoutIntervalForRequest is 60 s between the bytes of a request.
    double idle_timeout_ms{60000};
  };

  // What the loader hands over with a download. All three run on the host thread, from poll(), never from a transport listener,
  // and none runs after stop().
  struct Hooks {
    // Whether nothing wants the response any more; asked for every download in every poll.
    std::function<bool()> abandoned;
    // The cumulative bytes received and the total, at most once per download per poll, after the transport's poll.
    std::function<void(int64_t loaded, int64_t total)> progress;
    // Once, when the download ends however it ends.
    std::function<void(Download)> done;
  };

  ImageNetwork(std::unique_ptr<HttpTransport> transport, Clock now);
  ~ImageNetwork();
  ImageNetwork(const ImageNetwork &) = delete;
  ImageNetwork &operator=(const ImageNetwork &) = delete;

  // Queues a download; it starts, first in first out, as soon as fewer than max_downloads run.
  void enqueue(uint64_t id, HttpRequest request, Hooks hooks);
  // Starts what may start, advances the transport by at most `byte_budget` bytes of bodies, then acts on what it recorded.
  void poll(std::size_t byte_budget);
  // Stops the transport first, so that no listener runs afterwards, and forgets every download without telling anyone.
  void stop();
  void set_limits(const Limits &limits) { limits_ = limits; }
  const Limits &limits() const { return limits_; }
  std::size_t queued() const { return queue_.size(); }
  std::size_t active() const { return active_.size(); }
  folly::dynamic snapshot() const;

 private:
  struct Exchange;
  void start_queued();
  void settle_active();
  void finish(const std::shared_ptr<Exchange> &exchange, Download download);
  void report_progress(Exchange &exchange);
  Download outcome_of(Exchange &exchange, Download::Outcome outcome) const;

  std::unique_ptr<HttpTransport> transport_;
  Clock now_;
  Limits limits_;
  std::deque<std::shared_ptr<Exchange>> queue_;
  std::map<uint64_t, std::shared_ptr<Exchange>> active_;
  bool stopped_{};
  uint64_t started_{}, completed_{}, failed_{}, abandoned_{}, aborted_size_{}, aborted_idle_{}, progress_events_{}, bytes_{}, polls_{}, peak_active_{};
};

}  // namespace fabric_godot
