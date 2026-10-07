#pragma once

#include "http_transport.h"
#include "websocket_transport.h"
#include <folly/dynamic.h>
#include <cstddef>
#include <memory>

namespace fabric_godot {
class TurboModuleRegistry;
struct NetworkingState;

// One application's side of RN's networking stack: the Networking module with
// Android's contract, which is what RN's own RCTNetworking.android.js drives,
// the BlobModule and FileReaderModule that XMLHttpRequest, fetch's Response
// and FileReader need, over one shared store of blob bytes, and the
// WebSocketModule that RN's own WebSocket drives, with the BlobModule's hooks
// for binary messages as blobs. Requests run on the HttpTransport and sockets on
// the WebSocketTransport the application hands over. The modules, the JSI
// binding, the promises and the device events are RN's; this owns the
// transports and the blobs and ends all of them with the application. The
// WebSocketModule has its own translation unit (websocket_module.cpp), and the
// four modules share one NetworkingState (networking_state.h).
class Networking {
 public:
  Networking(std::unique_ptr<HttpTransport> http, std::unique_ptr<WebSocketTransport> sockets);
  ~Networking();
  // Registers Networking, BlobModule, FileReaderModule and WebSocketModule; each
  // is created when JS first asks for it.
  void install(TurboModuleRegistry &registry);
  // Advances both transports from the application's pump, before JS work drains,
  // so the events they produce are delivered in the same pump.
  void poll(std::size_t byte_budget);
  // Cancels every request, closes every socket with 1001 and releases every blob;
  // no event reaches JS afterwards.
  void stop();
  folly::dynamic snapshot() const;

 private:
  std::shared_ptr<NetworkingState> state_;
};
}
