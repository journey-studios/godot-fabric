#pragma once

#include "http_core.h"
#include <folly/dynamic.h>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <vector>

namespace fabric_godot {
// One WebSocket connection as the WebSocketModule hands it to a transport. The module has already parsed and
// canonicalized the URL (ws or wss, the port written out), validated the headers and chosen the subprotocols; the
// transport adds only what the wire needs (Host, Upgrade, Connection, the key and the version).
struct WebSocketRequest {
  std::string url;
  std::vector<std::string> protocols;  // offered, in order; empty when none
  http::Headers headers;               // the Origin among them, never a header the handshake itself is made of
};

struct WebSocketMessage {
  bool text{};
  std::string bytes;  // UTF-8 for a text message
};

// What a transport reports about one connection, always from poll() on the main thread and never from start(), send()
// or close(). In order: on_open once, on_message for each message, and then exactly one of on_closed (the peer's close
// frame arrived: `code` is the one it carried, 1005 when it carried none) and on_failure (a handshake that failed or a
// connection that ended without a close frame). Nothing is reported after stop().
struct WebSocketListener {
  std::function<void(std::string)> on_open;  // the subprotocol the server selected, "" when none
  std::function<void(WebSocketMessage)> on_message;
  std::function<void(int, std::string)> on_closed;
  std::function<void(std::string)> on_failure;
};

enum class WebSocketSend {
  Sent,
  NotOpen,   // the connection is not open (any more): nothing was queued
  Overflow,  // the message does not fit in what is queued: nothing was queued, and the module closes with 1001 as OkHttp does
};

// The platform seam under RN's WebSocketModule. Godot's WebSocketPeer is the first transport; a platform one
// (NSURLSessionWebSocketTask, WinHTTP) can replace it without the module noticing. Every method runs on the
// application's main thread, which is also the JS thread.
class WebSocketTransport {
 public:
  virtual ~WebSocketTransport() = default;
  // A connection that cannot start at all (a duplicate id, a trust configuration that is not PEM) returns its explanation
  // and reports nothing else.
  virtual std::optional<std::string> start(uint64_t id, WebSocketRequest request, WebSocketListener listener) = 0;
  virtual WebSocketSend send(uint64_t id, const WebSocketMessage &message) = 0;
  // Begins the closing handshake with the code and reason, which the module has validated. A connection that is still
  // connecting ends as a failure at the next poll(). A closing handshake the peer never answers ends as a failure too,
  // after RealWebSocket's own 60 seconds on the transport's clock.
  virtual void close(uint64_t id, int code, const std::string &reason) = 0;
  // Ends a connection without a word to its listener: an open one is closed with 1001, and nothing it holds is reported. The
  // module uses it for a connection whose failure it has already reported, because a failure is the last event of a socket.
  virtual void cancel(uint64_t id) = 0;
  // Advances every connection, reading at most `byte_budget` bytes of messages in all (always at least one message from
  // a connection that has one, so that no message waits forever behind a larger one).
  virtual void poll(std::size_t byte_budget) = 0;
  // Closes every connection with 1001 and forgets it. No listener runs after it returns.
  virtual void stop() = 0;
  virtual folly::dynamic snapshot() const = 0;
};
}
