#pragma once

#include "http_transport.h"
#include <folly/dynamic.h>
#include <cstddef>
#include <memory>

namespace fabric_godot {
class TurboModuleRegistry;
struct NetworkingState;

// One application's side of RN's networking stack: the Networking module with
// Android's contract, which is what RN's own RCTNetworking.android.js drives,
// and the BlobModule and FileReaderModule that XMLHttpRequest, fetch's Response
// and FileReader need, over one shared store of blob bytes. Requests run on the
// HttpTransport the application hands over. The modules, the JSI binding, the
// promises and the device events are RN's; this owns the transport and the blobs
// and ends both with the application.
class Networking {
 public:
  explicit Networking(std::unique_ptr<HttpTransport> transport);
  ~Networking();
  // Registers Networking, BlobModule and FileReaderModule; each is created
  // when JS first asks for it.
  void install(TurboModuleRegistry &registry);
  // Advances the transport from the application's pump, before JS work drains,
  // so the events it produces are delivered in the same pump.
  void poll(std::size_t byte_budget);
  // Cancels every request and releases every blob; no event reaches JS afterwards.
  void stop();
  folly::dynamic snapshot() const;

 private:
  std::shared_ptr<NetworkingState> state_;
};
}
