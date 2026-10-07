#pragma once

#include "godot_http_transport.h"
#include "websocket_transport.h"
#include <memory>

namespace fabric_godot {
// HTTPClient owns async DNS/TCP/TLS setup; wslay owns WebSocket framing on its exposed stream. The connection stays on the
// application's pump and keeps the HTTPClient owner alive until terminal state. `trusted_authorities` and `now` are the
// same seams as the HTTP transport: the PEM of the authorities a TLS connection trusts and the monotonic clock.
std::unique_ptr<WebSocketTransport> make_godot_websocket_transport(
    TrustedAuthorities trusted_authorities = {}, MonotonicClock now = {});
}
