# WebSocket transport over Godot streams

Status: the HTTPClient/wslay adapter passed the 95-check product probe and independent wire
oracle on macOS arm64 with pinned RN 0.87.1 and Godot 4.7.2. The server recorded 60 connections;
the oracle requires all messages sent before a close frame and verifies the peer's actual close
code and reason. Separate TLS cases cover immediate close 1000, peer-selected close 4002 with
its exact reason, and a drop after the client's close as a failure. The bounded load probe
reached the 1 MiB read budget across WebSocket sockets and the 256-event admission limit using
capacity after the separate HTTP poll. The lifetime probe covered reentrant cancel/stop from
open and message handlers. Hosted CI passed all five jobs for pinned head `422c2ee`
([receipt](../evidence/websocket/hosted-ci.json)); later PR-head changes need separate green
checks. The parity job's 13 `core-ui-v2` Android/iOS cases do not prove WebSocket differential or
Godot mobile runtime behavior. The prior WebSocketPeer path's data loss is the behavior in
[godotengine/godot#115384](https://github.com/godotengine/godot/issues/115384); it is not an
observed limitation of this transport. A separate TLS read behavior was traced in pinned engine
source: the public binding discards bytes on a non-OK status while its TLS peer can collect
plaintext and return EOF in one call. The adapter limits reads to queued plaintext or one byte
to expose a close frame before EOF, and reports a drop without inferring success.
`permessage-deflate`, cookies, proxy configuration, HTTP/2 and targets other than macOS remain
outside this proof.

## What RN does

**JavaScript** (`Libraries/WebSocket/WebSocket.js`). `setUpXHR` installs `WebSocket` as a
lazy global (`Libraries/Core/setUpXHR.js`, line 31). The constructor (lines 98-149) takes a
URL, a list of subprotocols and `options.headers` (the deprecated `origin` option warns
and moves under `headers`, lines 111-125), creates a `NativeEventEmitter` that is bound to
the native module only on iOS (lines 141-145), so on this platform the four events arrive
through RN's device event emitter, takes the next id from a module-level counter (line 146)
and calls `NativeWebSocketModule.connect(url, protocols, {headers}, id)` (line 148).
`binaryType` accepts `'blob'` and `'arraybuffer'` and hooks the socket into BlobModule's
content handler (lines 155-171). `send` (lines 182-207) throws `INVALID_STATE_ERR` while
the socket is CONNECTING, sends a `Blob` through `BlobManager.sendOverSocket`, a string
through `send` and an ArrayBuffer or view as base64 through `sendBinary`; `ping()` (lines
209-215) has the same state check. `close(code, reason)` (lines 173-180) sets CLOSING and
calls `_close` (lines 217-226), which defaults the code to 1000 and the reason to `''`.
The four events (lines 233-290) each carry one object with the socket's `id`:
`websocketMessage` (`type` is `text`, `binary` as base64 or `blob` as BlobData),
`websocketOpen` (`protocol`), `websocketClosed` (`code` and `reason`: readyState CLOSED and a
`close` event) and `websocketFailed` (`message`: readyState CLOSED, an `error` event and a
`close` event with code 1006 and the message as its reason, lines 273-288). After either
terminal event the socket unsubscribes from the emitter (lines 270 and 286), so JS ignores
whatever the native side sends later: the contract a native module has to keep is that every
`connect` ends in one `websocketClosed` or one `websocketFailed`, and that a failure is the
last event.

**The native contract is chosen by platform.** The two modules differ in what they do around
that shape:

| | Android `WebSocketModule.kt` (OkHttp 4.9.2) | iOS `RCTWebSocketModule.mm` (SocketRocket) |
| --- | --- | --- |
| Origin | an Origin header made of the URL's scheme, host and written port, unless the caller gave one (lines 104-128, 387-410) | none added |
| Subprotocols | trimmed; empty entries and entries with a comma dropped; joined with `,` into one header (lines 130-143) | the array goes to SocketRocket |
| Headers | a string value is added as is and OkHttp validates names and values; a value that is no string is ignored with a warning (lines 106-123) | each is added; an invalid one is logged |
| Cookies | `CookieJar.NO_COOKIES` on the client, and the Cookie header of the app's cookie handler for the URL added by hand (lines 88, 99-102, 347-361) | the cookies of the shared storage (lines 85-99) |
| Time-outs | connect and write 10 s, read none (lines 89-91) | SocketRocket's own |
| A URL that cannot be read | `Request.Builder.url` throws on the native modules thread | `websocketFailed` "Invalid WebSocket URL" (lines 77-81) |
| `send`, `sendBinary` and `ping` for a socket that is not there | `websocketFailed` and `websocketClosed` with code 0, both saying "client is null" (lines 225-243, 252-271, 306-325) | nothing: a message to a missing socket is a no-op (lines 141-159) |
| `ping` | `send(ByteString.EMPTY)`: an empty binary message (line 327) | a ping frame (lines 156-159) |
| `close` | a no-op for a socket that has not opened yet (lines 208-215); OkHttp's refusals are caught and logged (lines 216-222) | closes and forgets it (lines 161-165) |
| `websocketClosed` | `{id, code, reason}` (lines 161-168) | also `clean` (lines 223-241) |
| Application stop | `invalidate` closes every socket with 1001 (lines 54-60) | detaches the delegate and closes: no event (lines 62-71) |

BlobModule keeps the socket's blob state: its content handler leaves text as text and turns a
binary message into `{blobId, offset: 0, size}` with `type: 'blob'` (`BlobModule.kt`, lines
49-67; `addWebSocketHandler` and `removeWebSocketHandler`, lines 281-289), and
`sendOverSocket` sends the bytes of a blob as one binary message, nothing for a blob it does
not hold (lines 291-297). The iOS version is `RCTBlobManager.mm`, lines 167-190. The C++
spec of the module (`NativeWebSocketModuleCxxSpec`) is already generated in
`React/FBReactNativeSpec`.

## What this host did

The networking slice made `src/initialize.js` import `setUpXHR`, so RN's own `WebSocket`
global existed, but the host registered no `WebSocketModule`: the first `new WebSocket` threw
where RN looks the module up (`TurboModuleRegistry.getEnforcing(...): 'WebSocketModule'
could not be found`), and `BlobModule`'s `addWebSocketHandler`, `removeWebSocketHandler` and
`sendOverSocket` threw `E_UNSUPPORTED`. On the preceding host the same bundle runs the
checks that need no native module and every other check fails at that lookup.

## Historical Godot WebSocketPeer constraints

`WebSocketPeer` is the engine's WebSocket endpoint (`modules/websocket`, built on the wslay
library). The client side is `connect_to_url(url, TLSOptions)`, then `poll()`, regularly: it is
non-blocking, and the ready state names the stage (`STATE_CONNECTING`, `OPEN`, `CLOSING`,
`CLOSED`). `send(bytes, mode)` writes a text or a binary message, `get_packet()` reads one and
`was_string_packet()` says which it was, `get_selected_protocol()` is the subprotocol the
server chose, `get_close_code()` and `get_close_reason()` describe the close once the peer is
CLOSED (the code is -1 when the connection was not cleanly closed), `close(code, reason)`
starts a closing handshake (a negative code drops the connection at once), and
`supported_protocols`, `handshake_headers`, the two buffer sizes (65,535 bytes each by
default) and `max_queued_packets` (4,096) are properties set before connecting. `connect_to_url`
verifies the certificate of a `wss://` URL against the host name, with the engine's roots or
the `TLSOptions` given
([class reference](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/modules/websocket/doc_classes/WebSocketPeer.xml);
the sources cited below are the commit of the official 4.7.2-stable build).

The prior adapter used Godot's `WebSocketPeer`; the current adapter no longer does. These
engine observations explain the switch and remain relevant to the pinned 4.7.2 runtime.

| Finding | Source | Result for this adapter | Evidence |
| --- | --- | --- | --- |
| The former `WebSocketPeer` adapter could lose frames read in the same poll that processes a close frame. This is the behavior described by [godot#115384](https://github.com/godotengine/godot/issues/115384). | [`get_packet`](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/modules/websocket/wsl_peer.cpp#L814-L831), [`poll`](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/modules/websocket/wsl_peer.cpp#L703-L785) | Historical behavior of the superseded adapter. The current StreamPeer/wslay product probe verifies data before a coalesced close and interleaved-control cases; the old limitation is not an observed limitation of this adapter. | Upstream issue and pinned engine source |
| The pinned `StreamPeerMbedTLS::get_partial_data` can collect plaintext before returning EOF; the public `StreamPeer::_get_partial_data` binding clears its returned byte array on any non-OK status. The WebSocketPeer wslay callback treats the failed read as no data. | [`StreamPeerMbedTLS::get_partial_data`](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/modules/mbedtls/stream_peer_mbed_tls.cpp#L210-L253), [`StreamPeer::_get_partial_data`](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/core/io/stream_peer.cpp#L86-L105), [`_wsl_recv_callback`](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/modules/websocket/wsl_peer.cpp#L572-L598) | This source-backed TLS explanation is separate from #115384. The adapter reads at most Godot's queued plaintext, or one byte to load a TLS record when none is queued, so a close frame is parsed before a later EOF. The product smoke confirmed exact 1000 and 4002/reason delivery and rejected a post-close drop. | Pinned engine source; `tests/websocket-transport-smoke.test.mjs` |
| Wslay disables reads after it queues a protocol close for invalid frames, invalid UTF-8 or a message over its configured maximum. | Pinned upstream [wslay event parser](https://github.com/tatsuhiro-t/wslay/blob/0e7d106ff89ad6638090fd811a9b2e4c5dda8d40/lib/wslay_event.c) | The adapter reports a terminal failure after flushing wslay's protocol close, without waiting for a peer close it can no longer read. Invalid-text and oversize product cases complete and release their sockets. | Source inspection; current product probe |

Godot Android WebSocket runtime is not exercised. Web exports require a browser-specific
WebSocket transport and are outside this proof.

## The implementation

`native/websocket_module.{h,cpp}` is the module: the C++ TurboModule `WebSocketModule` (RN's
generated `NativeWebSocketModuleCxxSpec`) and BlobModule's WebSocket hooks, over the
`WebSocketState` it keeps in the application's `NetworkingState`
(`native/networking_state.h`, shared with `Networking`, `BlobModule` and
`FileReaderModule` in `native/networking_modules.cpp`). The state holds the phase of every
socket that has not ended (connecting, open or closing, which is what Android's map of
open OkHttp sockets and RN's JS-side state amount to), the ids whose binary messages are
blobs, and the counters the snapshot reports under `networking.webSocket`. The module
registers through `TurboModuleRegistry::add` like the others, binds the same stoppable call
invoker, and queues its events through the same `queue_event` as the HTTP side, so every
device event leaves through RN's scheduler in the order it was queued and is dropped once the
application stops.

The transport sits behind `native/websocket_transport.h`: `start`, `send`, `close`, `cancel`,
`poll(byte_budget, event_budget)`, `stop` and a listener with `on_open`, `on_message`, `on_closed` and
`on_failure`, called only from `poll()` on Godot's main thread, which is the JS thread.
`native/godot_websocket_transport.cpp` advances one `GodotWebSocketConnection` per socket from
`ApplicationRuntime::pump`. Godot's HTTPClient owns async DNS/TCP/TLS connection setup; the
adapter stops polling it at `STATUS_CONNECTED`, retains it as stream owner, and uses public
StreamPeer reads and writes after that. Pinned wslay commit
`0e7d106ff89ad6638090fd811a9b2e4c5dda8d40` owns the RFC 6455 framing. Its MIT source and
generated headers are private build inputs and are not exported by the native adapter SDK.
`native/websocket_handshake.h` validates the bounded HTTP upgrade response before framing starts.

Each WebSocket poll shares a 1 MiB inbound wire-byte allowance across WebSocket connections,
including upgrade and frame reads. It admits at most 256 pending networking events; capacity
comes from canonical event counters (`queued - delivered - dropped`) after the separate HTTP poll,
less slots reserved by incomplete WebSocket messages. A data message reserves one event slot at
its first frame and releases it only when
complete; fragments and control frames can continue under that reservation. Frame headers,
control traffic and upgrade bytes debit the same wire budget. Connections rotate their first poll
position, and another round runs only when bytes or event capacity made progress. Two eight-socket
RN load phases reached the 1 MiB byte cap and 256-event cap respectively; both delivered all
1,024 messages, kept canonical pending events at or below 256, and ended at zero pending events.
Every socket made progress; the first-progress spread was one frame for 8 KiB messages and zero
for 512-byte messages. The TLS options shared with HTTP live in `native/godot_tls.h`. The pure
parts live in
`native/websocket_core.h` and have their own C++
test (47 assertions in 6 groups, `native/websocket_core_test.cpp`): URLs read the way OkHttp's
`HttpUrl` reads them (through `native/http_core.h`, so `ws:` and `wss:` are `http:` and `https:`
underneath, and an `http:` or `https:` URL connects too, as it does on Android), the default
Origin, the subprotocol list, header validation with OkHttp's messages
([`Headers.kt`](https://github.com/square/okhttp/blob/3edf17ca8a5048912d19e84d0fc2a7941a97c07d/okhttp/src/main/kotlin/okhttp3/Headers.kt#L437-L455),
with the value left out for the credential headers) and the close parameters.

- **Connect.** `connect` validates what OkHttp's `Request.Builder` and `Headers` would: the URL,
  each string header (a value that is no string is ignored and counted), and the subprotocol
  header. A request that cannot be made is not thrown, which Android does on a thread JS never
  sees and iOS does as an event: it becomes a `websocketFailed` with OkHttp's message, so that
  every `connect` ends in a close or a failure; only an id that is not a non-negative integer,
  or one already in use, throws. The default Origin is added when the caller gave none. The
  adapter constructs the handshake headers (`Host`, `Upgrade`, `Connection`,
  `Sec-WebSocket-Key`, `Sec-WebSocket-Version`, and any offered protocol); caller values for
  handshake-owned headers are dropped and counted. The adapter does not offer extensions.
- **Messages.** Text goes out as a text message, base64 as a binary one, a blob's bytes as a
  binary one and `ping` as an empty binary one. Incoming text is a `text` event, binary is
  base64 or, for a socket in blob mode, a blob in the shared store that JS wraps and
  releases. `send`, `sendBinary` and `ping` for a socket that is not open (unknown, still
  connecting, or already closed by JS) raise Android's programmer error: a
  `websocketFailed` and a `websocketClosed` with code 0, both "client is null"; base64 that
  decodes to nothing is Android's "bytes == null" failure and ends the socket.
- **Close.** `close` does nothing for an unknown socket or one that is already closing; on a
  socket that is still connecting it fails the attempt (the deliberate departure below). A
  code or reason OkHttp refuses is a warning in JS and leaves the socket alone. A close frame
  without a status is reported as 1005. A socket the server closes arrives as `open`, any
  messages and `close` with the server's code and reason.
- **Stop.** The application's stop ends the transport first: each open connection queues and
  nonblockingly flushes a 1001 close before its stream is discarded, the module forgets every
  socket and no event reaches JS afterwards; retained methods
  that start something are refused with `E_MODULE_DISPOSED`, and late cleanup is harmless.
- **Seams.** `validation_tls_trusted_authorities` and `validation_clock_offset_ms` are the two
  validation seams the HTTP transport already has; sockets use the same trust roots and injected
  clock for their 30-second connection-plus-upgrade and 60-second closing deadlines. A product
  never sets either.

## Why the probe is discriminating

The [server](../../tests/websocket-server.mjs) is a Node child process on `node:http`,
`node:https` and `node:net` that implements RFC 6455 by hand on the `upgrade` event
(handshake, masked client frames, unmasked server frames, fragmentation, ping, pong and
close). It reports its ports on stdout and records every connection exactly as it happened on
the wire: the handshake's raw header names, order and duplicates, the response it sent, and
every frame in both directions with opcode, flags, length and payload hash. It never waits for
a clock: a held handshake stays held until a control request releases it or the client leaves.
It serves an echo, a subprotocol choice, a handshake report, closes with and without status,
refused and wrongly answered handshakes, dropped and reset connections, a megabyte in either
direction, invalid text, fragmentation with and without a ping inside, a server that never
answers a close, and wss with a CA and a leaf signed at runtime
([certificates](../../tests/networking-certificates.mjs), shared with the HTTP suite), plus a
second authority for the negative cases and a port that accepts and never answers.

The [fixture](../../tests/websocket-fixture.jsx) runs RN's public `WebSocket` in two roots of
one application and records every event of every socket in order with the state it saw; the
[probe](../../tests/websocket-probe.gd) waits on conditions, never on time, and also reads the
application's networking snapshot. The [oracle](../../tests/websocket-oracle.mjs) trusts none of
the probe's verdicts: it compares the server's independent handshake/frame log with the probe's
JS observations, including every required message, close code/reason and terminal outcome. The
current product receipt records 60 server connections and 53 required wire/JS comparisons,
including all expected data before close. It ties transport counters to server-observed traffic;
the exact checks and case accounting are in the [execution receipt](../evidence/websocket/execution.json).

On the preceding host the same bundle runs: 12 of 95 checks pass and 83 fail, with no connection
reaching the server, and the oracle rejects the report.
Two retained sabotages break one line each, rebuild, run the probe and the oracle and restore
the source byte for byte: a module that never adds the default Origin (the server then sees a
handshake without one, and 4 checks fail) and a stop that closes with 1000 instead of 1001
(the server sees the wrong close code on the sockets the stop ended, and 2 checks fail). The
runner also fails on any engine, script or native error line it did not expect, and the suite
passes with the control receipts absent, as in CI.

## Departures from RN

- **Android's contract, not iOS's.** The programmer-error events for a missing socket, the
  empty binary `ping`, the default Origin, the subprotocol rules and the 1001 at stop are
  Android's. iOS would need a second module over the same spec: a no-op for a missing socket, a
  real ping frame and a `clean` flag on `websocketClosed`.
- **`close()` while CONNECTING fails the socket (deliberate).** On Android the module has not
  registered the socket until `onOpen` (`WebSocketModule.kt`, line 149), so its `close` returns
  without doing anything (lines 208-215): the connection opens anyway, JS has already set
  CLOSING (`WebSocket.js`, line 178) and the `open` event sets OPEN again (line 254). Browsers
  do the opposite: the [WHATWG WebSockets Standard's `close()`](https://websockets.spec.whatwg.org/#dom-websocket-close)
  fails the connection when it is not yet established, so the page sees an `error` and a `close`. This host does the same
  (a `websocketFailed` with "WebSocket is closed before the connection is established.", the
  text Chrome prints), because a socket that opens after JS closed it, and every connect that
  ends in nothing, are worse than the departure. The attempt's connection is closed and the
  server sees the held handshake abandoned.
- **No extensions.** OkHttp offers `permessage-deflate` on every connection
  ([`RealWebSocket.connect`](https://github.com/square/okhttp/blob/3edf17ca8a5048912d19e84d0fc2a7941a97c07d/okhttp/src/main/kotlin/okhttp3/internal/ws/RealWebSocket.kt#L157-L163))
  and fails a socket whose caller supplied `Sec-WebSocket-Extensions`
  ([lines 147-150](https://github.com/square/okhttp/blob/3edf17ca8a5048912d19e84d0fc2a7941a97c07d/okhttp/src/main/kotlin/okhttp3/internal/ws/RealWebSocket.kt#L147-L150));
  this adapter does not offer or negotiate extensions and drops a caller's
  `Sec-WebSocket-Extensions` with other handshake-owned headers.
- **The adapter owns handshake headers.** OkHttp replaces `Upgrade`, `Connection`, the key
  and the version, and keeps a caller's `Host`
  ([`BridgeInterceptor`](https://github.com/square/okhttp/blob/3edf17ca8a5048912d19e84d0fc2a7941a97c07d/okhttp/src/main/kotlin/okhttp3/internal/http/BridgeInterceptor.kt#L58-L60));
  this host drops all of them, and the suite asserts that a `Host`, an `Upgrade` and a
  subprotocol header the caller gave are dropped (the others have no check of their own). No
  `User-Agent` or `Accept-Encoding` is sent, which OkHttp adds.
- **No cookies.** Nothing is stored or sent; Android adds the Cookie header of the app's
  cookie handler for the URL (`WebSocketModule.kt`, lines 99-102 and 347-361) and iOS the
  shared storage's. The suite asserts that no cookie is sent.
- **Connection timeout differs from Android.** Android gives OkHttp 10 seconds to connect
  (line 89); this host applies a 30-second policy to connection plus upgrade and 60 seconds to
  the close response. The 30-second deadline is an explicit host policy verified with the
  injected clock, not a claim of inherited OkHttp behavior.
- **Subprotocol selection:** a server that selects no protocol is accepted and reports `''`;
  an unoffered protocol is rejected. OkHttp accepts both cases.
- **Failure text is host-specific.** Upgrade rejection errors retain the response status line;
  other connection failures use adapter diagnostics. Exact OkHttp and SocketRocket failure-text
  parity is not claimed.
- **Invalid UTF-8 text fails the socket.** Wslay sends its protocol close (1007); the module
  reports a terminal failure to RN, which exposes error followed by close 1006.
- **Cancellation close delivery is best effort with unread input.** Drained `/echo` scenarios
  receive the exact 1001 close on the wire. Reentrant cancellation while `/greeting` has sent
  unread data can terminate TCP before the close frame reaches the peer; that is recorded as a
  drop, not a completed close handshake. No delayed teardown is claimed.
- **`websocketClosed` carries no `clean` flag**, as on Android; RN's JS does not read it.

## Exploratory observations outside the receipt

Historical scratch measurement (not a current backend measurement): the former WebSocketPeer
transport used two 16 MiB rings per connection. The current wslay adapter has no such rings; its
16 MiB message limit is a protocol admission limit, not a measured heap reservation. The executed
load probe covers wire-byte and pending-event caps, fairness and real RN handlers; it is bounded
evidence for these fixtures rather than a general heap or long-duration soak certification.

## Remaining scope

`permessage-deflate` and the other extensions, cookies, HTTP/2 and WebSocket over HTTP/2, proxy
and system trust configuration, the exact failure texts of OkHttp and SocketRocket, iOS's module
contract, broader sustained-duration and hardware load, reconnect and offline behavior, hardware
and Godot Android, iOS and Web exports, and the contract, parity and targets of GF-22. No checkpoint of
GF-22 changes with this record: its first slice closed with the
[networking record](../evidence/networking/README.md).
