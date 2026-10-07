#pragma once

#include "godot_http_transport.h"
#include "websocket_transport.h"
#include <memory>

namespace fabric_godot {
// WebSocket connections over Godot's WebSocketPeer, one peer and one TCP connection each, polled from the application's
// pump. The engine performs the handshake and the framing; this adds what RN's Android client gets from OkHttp and the
// engine does not give: the close handshake's own timeout, OkHttp's limit on what is queued to send, buffers large enough
// for messages of megabytes, and the trust of the application's validation seam for wss URLs. `trusted_authorities` and
// `now` are the seams of the HTTP transport: the PEM of the authorities a TLS connection trusts, and the monotonic clock.
std::unique_ptr<WebSocketTransport> make_godot_websocket_transport(
    TrustedAuthorities trusted_authorities = {}, MonotonicClock now = {});
}
