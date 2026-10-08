#pragma once

#include "http_core.h"
#include <folly/dynamic.h>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>

namespace fabric_godot {
// One HTTP request as the Networking module hands it to a transport. The
// module has already validated and sanitized the headers and built the body;
// the transport adds only what the wire needs (Host, Content-Length).
struct HttpRequest {
  std::string method;  // upper case
  std::string url;     // as JS gave it; the transport parses it
  http::Headers headers;
  std::string body;
  // The whole exchange, redirects included, must end within this many
  // milliseconds; 0 means no deadline (the call timeout of RN's Android client).
  double timeout_ms{};
  // RCTHTTPRequestHandler's redirect delegate replaces the next request's headers with the cookies' (the host keeps none), so a redirected
  // request carries none of the headers the caller set. Off by default: a request keeps OkHttp's rules, which keep them and drop only an
  // Authorization that crosses to another origin (Networking). Image downloads turn it on.
  bool drop_headers_on_redirect{};
};

struct HttpResponseHead {
  int status{};
  http::Headers headers;  // as received: wire order, duplicates kept
  std::string url;        // where the response came from, after redirects
};

struct HttpFailure {
  std::string message;
  bool timed_out{};
};

// What a transport reports about one request, always from poll() on the main
// thread and never from start(). Exactly one of on_failure and on_complete ends
// the exchange. Nothing is reported after cancel() or stop().
struct HttpListener {
  std::function<void(HttpResponseHead)> on_head;
  std::function<void(std::string)> on_body;  // repeats while the body arrives
  std::function<void(HttpFailure)> on_failure;
  std::function<void()> on_complete;
};

// The platform seam under RN's Networking module. Godot's HTTPClient is the
// first transport; a platform one (NSURLSession, WinHTTP) can replace it
// without the module noticing. Every method runs on the application's main
// thread, which is also the JS thread.
class HttpTransport {
 public:
  virtual ~HttpTransport() = default;
  // A request that cannot start at all (an unsupported method, a URL that does
  // not parse) returns its explanation and reports nothing else.
  virtual std::optional<std::string> start(uint64_t id, HttpRequest request, HttpListener listener) = 0;
  // Silent: RN's abortRequest emits nothing, and neither does a cancelled request.
  virtual void cancel(uint64_t id) = 0;
  // Advances every request, reading at most `byte_budget` body bytes in all so
  // that one large response cannot hold a frame hostage.
  virtual void poll(std::size_t byte_budget) = 0;
  // Cancels everything. No listener runs after it returns.
  virtual void stop() = 0;
  virtual folly::dynamic snapshot() const = 0;
};
}
