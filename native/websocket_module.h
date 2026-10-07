#pragma once

// The WebSocketModule of this host and the part of BlobModule that belongs to sockets, over the WebSocketTransport the
// application hands to Networking. RN's Android contract is what they implement (WebSocketModule.kt, and BlobModule.kt for
// the content handler and sendOverSocket). The module shares one application's NetworkingState (networking_state.h) with
// the other three, and keeps what it knows of its sockets in the WebSocketState that state holds.

#include "websocket_transport.h"
#include <ReactCommon/TurboModule.h>
#include <folly/dynamic.h>
#include <cstdint>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <string>

namespace fabric_godot {
struct NetworkingState;

// The sockets of one application: the transport that carries them, the phase each is in, the ones whose binary messages
// BlobModule's content handler turns into blobs, and the counters the snapshot reports. Everything runs on the main thread.
struct WebSocketState {
  // What WebSocketModule knows of a socket: RN's Android keeps an OkHttp socket per id from its onOpen until JS closes it,
  // and a socket in any other phase is, to its send, ping and close, one that does not exist.
  enum class Phase { Connecting, Open, Closing };
  std::unique_ptr<WebSocketTransport> transport;
  // Every socket that has not ended, and the ones whose binary messages arrive as blobs instead of base64.
  std::map<uint64_t, Phase> phases;
  std::set<uint64_t> blob_ids;
  uint64_t connects{}, refused{}, opened{}, closed{}, failed{}, sent{}, sent_bytes{}, dropped_sends{}, overflows{}, received{},
      blob_received{}, programmer_errors{}, close_rejections{}, connecting_closes{}, ignored_headers{}, dropped_headers{},
      blob_sent{}, blob_missing{}, blob_handler_changes{};

  // BlobModule.addWebSocketHandler and removeWebSocketHandler: whether a socket's binary messages are blobs.
  void set_blob_handler(double socket, bool enabled);
  // Closes every socket with 1001 and forgets it; nothing is reported afterwards.
  void stop();
  folly::dynamic snapshot() const;
};

// The name the module is registered under, and the module itself, created when JS first asks for it.
std::string websocket_module_name();
std::shared_ptr<facebook::react::TurboModule> make_websocket_module(std::shared_ptr<NetworkingState> state);

// BlobModule.sendOverSocket: the bytes of a blob as one binary message. A blob the store does not hold is `nullopt`, and
// Android sends nothing for it either.
void send_blob_over_socket(const std::shared_ptr<NetworkingState> &state, double socket, std::optional<std::string> bytes);
}
