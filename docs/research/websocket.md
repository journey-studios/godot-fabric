# WebSocket over Godot's WebSocketPeer

Status: executed isolated macOS validation against pinned RN 0.87.1 and official
Godot 4.7.2. The [evidence](../evidence/websocket/README.md) owns the 93 headless
checks against a deterministic local RFC 6455 server over ws and wss, the independent
oracle that checks the 59 connections the server recorded against what each case must have
caused, compares what JS observed on 52 of them and ties the native counters to the server's
frame log, the preceding-host control (the same bundle fails exactly its 81 normative checks)
and two retained sabotages (a module that never sends the default Origin fails 4 checks, a
stop that closes with 1000 instead of 1001 fails 2). The engine loses the messages that
arrive in the same poll as a close frame (godotengine/godot#115384): the host cannot
recover them, and the suite reproduces the loss without requiring it. `permessage-deflate`
and every other extension, cookies, a connect time-out, HTTP/2, proxies and every target
but macOS are not certified. Hosted CI is pending.

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

## What Godot reports

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

What the host depends on, works around or chose, with where it comes from. "Suite" is the
check of the websocket suite that asserts it; "scratch" is an observation from throw-away
scripts on the development machine, which are not in the repository.

| Behavior | Source | What the host does | Asserted |
| --- | --- | --- | --- |
| A message is readable only while the peer is OPEN: `get_packet` and `get_available_packet_count` give nothing otherwise. A close frame flips OPEN to CLOSING inside `poll()`, and a clean close reaches CLOSED and clears the input buffer in the same call, so what arrived in the poll of the close frame is gone when `poll()` returns. This is [godot#115384](https://github.com/godotengine/godot/issues/115384) (open on 2026-10-07). | [`get_packet`](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/modules/websocket/wsl_peer.cpp#L814-L831), [`get_available_packet_count`](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/modules/websocket/wsl_peer.cpp#L833-L839), [the close frame](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/modules/websocket/wsl_peer.cpp#L647-L663), [`poll`](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/modules/websocket/wsl_peer.cpp#L703-L785) and [`close`](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/modules/websocket/wsl_peer.cpp#L849-L885) | Nothing can be done: reading after `poll()` cannot help, because the buffer is cleared inside it, and reading before it cannot see what has not arrived. The loss is documented, and the suite reproduces it with one route that writes three messages and the close frame in one write; the check asks only that the close arrives with the server's code and reason and that JS got at most three messages. Reproduced in 3 of 3 scratch runs; the suite's run delivered 0 of 3. Every other case keeps the data and the close frame apart by protocol order, never by a timer. | Reproduction only (`limits/`) |
| Messages sent by the server after the client's own close frame cannot be read either (the peer is CLOSING). | `get_packet`, `close` (as above) | Nothing; the same limit. | Scratch |
| `connect_to_url` accepts a handshake only if the status is 101, `Connection` and `Upgrade` match and the accept key is right; it checks the selected subprotocol both ways: one the client never offered fails, and so does none when some were offered. OkHttp 4.9.2 checks status, `Connection`, `Upgrade` and the accept key and never looks at `Sec-WebSocket-Protocol`; RFC 6455 section 4.1 makes the unrequested subprotocol a failure, and the [WHATWG WebSockets Standard](https://websockets.spec.whatwg.org/#concept-websocket-establish) also fails a connection that offered subprotocols and got none. | [`_verify_server_response`](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/modules/websocket/wsl_peer.cpp#L424-L481); OkHttp [`checkUpgradeSuccess`](https://github.com/square/okhttp/blob/3edf17ca8a5048912d19e84d0fc2a7941a97c07d/okhttp/src/main/kotlin/okhttp3/internal/ws/RealWebSocket.kt#L222-L250) | The host offers the list RN's module builds. A server that selects nothing, or something else, fails the socket where Android would open it: an `error` and a `close` with code 1006. | Suite (`limits/`, `failure/`, and `protocol/` for the working paths) |
| A failed handshake leaves the peer CLOSED with close code -1 and prints the cause as engine errors; there is no HTTP status to read, so a 403, a wrong accept key and a refused port look alike to the host. | `_verify_server_response` (lines 424-481) | The failure message says the connection failed before it opened and that the engine reports no status. The runner allows exactly the engine lines the probe provokes (5 causes, each followed by the engine's own "Invalid response headers.", and 3 certificates), and fails on any other. | Suite (`failure/`, the runner's allow-list) |
| A close frame the engine receives in the same `poll()` that completes the handshake takes the peer from CONNECTING to CLOSED without the host ever seeing OPEN. | [`poll`](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/modules/websocket/wsl_peer.cpp#L703-L785) (the handshake and the frame loop run in one call) | The host reports `websocketOpen` and then `websocketClosed`, as RN's JS expects of a socket that opened. | Suite (`close/`) |
| The engine never gives up on a closing handshake the server does not answer: nothing in `poll()` times it out. OkHttp cancels the call 60 seconds after it writes the close frame, and the socket fails. | `poll` (lines 703-785); OkHttp [`CANCEL_AFTER_CLOSE_MILLIS`](https://github.com/square/okhttp/blob/3edf17ca8a5048912d19e84d0fc2a7941a97c07d/okhttp/src/main/kotlin/okhttp3/internal/ws/RealWebSocket.kt#L641) and [the cancel it schedules](https://github.com/square/okhttp/blob/3edf17ca8a5048912d19e84d0fc2a7941a97c07d/okhttp/src/main/kotlin/okhttp3/internal/ws/RealWebSocket.kt#L511-L513) | The host starts a 60-second deadline when it asks the engine to close, on the same clock as the HTTP transport's deadlines (so the suite moves it with `validation_clock_offset_ms` and waits for nothing), then drops the connection and fails the socket: an `error` and a `close` with code 1006 and a message that names the timeout. | Suite (`timeout/`) |
| A close reason the wslay library refuses (over 123 bytes) is not an error to the engine: `close()` ignores the result of queueing the frame, the peer goes to CLOSING and nothing is sent. The class reference says a reason must be smaller than 123 bytes; RFC 6455 section 5.5 caps a control frame's payload at 125 bytes, two of them the code. OkHttp refuses it with `reason.size() > 123`. | [`close`](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/modules/websocket/wsl_peer.cpp#L849-L885); OkHttp [`close`](https://github.com/square/okhttp/blob/3edf17ca8a5048912d19e84d0fc2a7941a97c07d/okhttp/src/main/kotlin/okhttp3/internal/ws/RealWebSocket.kt#L430-L445) and [`validateCloseCode`](https://github.com/square/okhttp/blob/3edf17ca8a5048912d19e84d0fc2a7941a97c07d/okhttp/src/main/kotlin/okhttp3/internal/ws/WebSocketProtocol.kt#L122-L135) | The module refuses a code outside 1000-4999, a reserved code (1004-1006, 1015-2999) and a reason over 123 UTF-8 bytes with OkHttp's own messages, as a warning in JS, and leaves the socket as it was, as Android does when OkHttp throws. The engine is never asked. The hang itself was seen in scratch runs. | Suite (`close/`), the hang in scratch |
| Over TLS, a closing handshake the client began ends with the peer CLOSED and close code -1: the server's close frame and its `close_notify` arrive together and the engine's read fails, so the code and reason the server echoed are not reported. Over plain TCP the same end is a connection that was cut. | `poll` and [`_wsl_recv_callback`](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/modules/websocket/wsl_peer.cpp#L572-L598) (a failed read makes `poll` close the peer, [lines 744-751](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/modules/websocket/wsl_peer.cpp#L744-L751)); the cause was not traced further | The host takes a closing it started over TLS as complete and reports the code and reason it asked for, which a server echoes; the same end over TCP, or one the application did not start, is a failure. | Suite (the oracle counts 4 implied closes) |
| A text frame that is not UTF-8 fails the peer with 1007 and the reason "Invalid frame payload data" (RFC 6455 section 8.1 requires failing the connection); no message reaches JS. OkHttp reads the same bytes with replacement characters. | `poll` ([lines 759-781](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/modules/websocket/wsl_peer.cpp#L759-L781)) | Nothing: the socket ends with `close` 1007 and the engine's reason. | Suite (`limits/`) |
| A ping that sits between the fragments of a message (RFC 6455 section 5.4 allows it) has its payload written into the message being assembled: the frame callback appends the chunk of every frame while a data message is pending. The engine answers pings itself (RFC 6455 section 5.5.2). | [`_wsl_frame_recv_chunk_callback`](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/modules/websocket/wsl_peer.cpp#L610-L618) | Nothing: the message arrives with the ping's bytes inside. The suite records what JS got, checks that a pong with the payload went back and that the socket still closes, and the oracle accounts for the merged bytes. | Suite (`limits/`, `frames/`) |
| The rings default to 65,535 bytes, and a message larger than the inbound size fails the peer with 1009: a 1 MiB message never fits. A message the outbound side cannot hold, or more than `max_queued_packets`, is refused with an engine error. The documented size is "roughly the maximum amount of memory that will be allocated". | [`websocket_peer.h`](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/modules/websocket/websocket_peer.h#L53) (the defaults), [`_do_client_handshake`](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/modules/websocket/wsl_peer.cpp#L414-L416) (the limit) and [`_send`](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/modules/websocket/wsl_peer.cpp#L787-L803) | The host sets both rings to 16 MiB, OkHttp's own queue limit (`MAX_QUEUE_SIZE`, [line 635](https://github.com/square/okhttp/blob/3edf17ca8a5048912d19e84d0fc2a7941a97c07d/okhttp/src/main/kotlin/okhttp3/internal/ws/RealWebSocket.kt#L635)), and `max_queued_packets` to 16,384. It checks the outbound size before it sends, so the engine never refuses (and prints about) a message: one that does not fit makes the module close the socket with 1001 and send nothing, as OkHttp's `send` does ([lines 405-408](https://github.com/square/okhttp/blob/3edf17ca8a5048912d19e84d0fc2a7941a97c07d/okhttp/src/main/kotlin/okhttp3/internal/ws/RealWebSocket.kt#L405-L408)). The rings cost address space, not resident memory: 40 sockets with 16 MiB rings opened at once raised the engine's static allocation counter by about 1,925 MB (some 48 MiB per socket) and the process's resident set by 6 MB (scratch, 3 of 3 runs). | Suite (`large/`) |
| `PacketPeer.put_packet` with an empty array sends nothing, while `WebSocketPeer.send` with an empty array sends an empty frame. | the class reference; scratch | `ping()` is an empty binary message through `send`, as Android's is; iOS sends a ping frame, which Godot's peer cannot be asked to send. | Suite (`frames/`) |
| `heartbeat_interval` is 0 by default: the peer sends no pings of its own. | [`websocket_peer.h`](https://github.com/godotengine/godot/blob/ed1daf0bf001b61586d9930840f2f1394092c079/modules/websocket/websocket_peer.h#L73) | Nothing is set: RN's OkHttp client builder (`OkHttpClientProvider.kt`, lines 52-54) sets no ping interval either. | n/a |

Godot Android exports need the `INTERNET` permission and a Web export would use the browser's
`WebSocket`, which cannot add headers or choose its handshake; neither is exercised here.

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
`poll(byte_budget)`, `stop` and a listener with `on_open`, `on_message`, `on_closed` and
`on_failure`, called only from `poll()` on Godot's main thread, which is the JS thread.
`native/godot_websocket_transport.cpp` is the first implementation: one `WebSocketPeer` per
socket, advanced from `ApplicationRuntime::pump` in the same networking poll as the HTTP
transport, with the same byte budget (a connection hands JS at most 256 messages per pump, and
the first message of a pump is read whatever is left of the budget, so no socket waits behind
another). Rings, queue and deadline are the host choices of the table above. The TLS options
both transports build (the engine's roots, or the PEM the validation seam trusts) live in
`native/godot_tls.h`. The pure parts live in `native/websocket_core.h` and have their own C++
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
  handshake's own headers (`Host`, `Upgrade`, `Connection`, `Sec-WebSocket-Key`,
  `-Version`, `-Extensions` and `-Protocol`) are the engine's: a caller's value for one of them
  is dropped and counted.
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
- **Stop.** The application's stop ends the transport first: every open socket gets a close
  frame with 1001, the engine is polled once so that the frame leaves before the connection
  does, the module forgets every socket and no event reaches JS afterwards; retained methods
  that start something are refused with `E_MODULE_DISPOSED`, and late cleanup is harmless.
- **Seams.** `validation_tls_trusted_authorities` and `validation_clock_offset_ms` are the two
  validation seams the HTTP transport already has; the sockets use the same ones, the second
  for the closing deadline. A product never sets either.

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
application's networking snapshot. The [oracle](../../tests/websocket-oracle.mjs) trusts
none of the probe's verdicts. It states, for each of the 59 connections the cases open, what the
server must have received and sent (from the server's own constants and byte pattern), reads
what the server recorded, and compares both with what JS observed: the handshake (one
`Host`, `Upgrade`, `Connection`, version and Origin; a 16-byte key no other connection
reused; no cookie), every frame a client sent masked, the data messages in each direction byte
for byte, the close frames and codes, how each connection ended at the server, and, on 52
sockets, that JS saw the same messages and ended the way the case documents. It ties the native
counters to the server's record by arithmetic: the transport sent as many messages and bytes
as the server received, read what the server sent but for the messages the engine dropped or
refused, started every connection the server saw plus the six it could not (two refused ports,
one that never answers and three untrusted certificates), and every connect ended as a
refusal, a close, a failure or the stop that ended four.

On the preceding host the same bundle runs: the 12 checks that need no native module pass and
the other 81 fail, with no connection reaching the server, and the oracle rejects the report.
Two retained sabotages break one line each, rebuild, run the probe and the oracle and restore
the source byte for byte: a module that never adds the default Origin (the server then sees a
handshake without one, and 4 checks fail) and a stop that closes with 1000 instead of 1001
(the server sees the wrong close code on the sockets the stop ended, and 2 checks fail). The
runner also fails on any engine, script or native error line it did not expect, and the suite
passes with the control receipts absent, as in CI, and under heavy CPU load.

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
  the engine negotiates none, and this host drops a caller's `Sec-WebSocket-Extensions` like
  the other handshake headers, with no check of its own.
- **Handshake-owned headers are the engine's.** OkHttp replaces `Upgrade`, `Connection`, the key
  and the version, and keeps a caller's `Host`
  ([`BridgeInterceptor`](https://github.com/square/okhttp/blob/3edf17ca8a5048912d19e84d0fc2a7941a97c07d/okhttp/src/main/kotlin/okhttp3/internal/http/BridgeInterceptor.kt#L58-L60));
  this host drops all of them, and the suite asserts that a `Host`, an `Upgrade` and a
  subprotocol header the caller gave are dropped (the others have no check of their own). No
  `User-Agent` or `Accept-Encoding` is sent, which OkHttp adds.
- **No cookies.** Nothing is stored or sent; Android adds the Cookie header of the app's
  cookie handler for the URL (`WebSocketModule.kt`, lines 99-102 and 347-361) and iOS the
  shared storage's. The suite asserts that no cookie is sent.
- **No connect time-out.** Android gives OkHttp 10 seconds to connect (line 89); the engine has
  none and the host adds none, so a server that accepts and never answers leaves the socket
  CONNECTING until JS closes it (which fails it, as above).
- **Subprotocols are checked the engine's way:** a server that selects none, or one that was
  not offered, fails the socket; OkHttp accepts both and reports `''` or the unoffered name.
- **Failure messages are this host's and the engine's.** A failed handshake carries no HTTP
  status, so "Expected HTTP 101 response but was '403 Forbidden'" cannot be produced; a lost
  connection says that the connection to host:port was lost without a close frame.
- **Invalid UTF-8 text fails the socket with 1007** where OkHttp delivers it with replacement
  characters.
- **Data written with a close frame can be lost, and a ping between fragments is merged into
  the message:** two engine limits, documented and not required (see above).
- **`websocketClosed` carries no `clean` flag**, as on Android; RN's JS does not read it.

## Exploratory observations outside the receipt

Run on the committed tree with scratch scripts and not asserted by the suite. Forty
`WebSocketPeer`s opened at once against the local server, with the host's 16 MiB inbound and
outbound rings and 16,384 queued packets, were all OPEN: the engine's static allocation counter
went from 23.2 MB to 1,948.4 MB (about 48 MiB of address space per socket) and the process's
resident set from 114.4, 114.6 and 114.7 MB to 120.2, 120.4 and 120.4 MB in three runs, so the
pages are committed only as messages use them. An environment that limits address space or
refuses to overcommit would feel the 48 MiB per socket, and a product that opens many sockets
may want a smaller ring than the host's default. The reproduction of godot#115384 delivered none
of the three messages written with the close frame in the suite's run and in 3 of 3 scratch runs,
and no variation of polling around the close frame recovered them. A handshake the server
answers with 403 or with a wrong accept key is indistinguishable from a refused port in the
engine's own state.

## Remaining scope

`permessage-deflate` and the other extensions, cookies, a connect time-out, a ring size the
application can choose (the host's 16 MiB reserves about 48 MiB of address space per open
socket), HTTP/2 and WebSocket over HTTP/2, proxy and system trust configuration, the exact
failure texts of OkHttp and SocketRocket, iOS's module contract, recovery of the messages the engine drops with a close
frame (it needs the engine fixed), reconnect and offline behavior, hardware and Godot
Android, iOS and Web exports, and the contract, parity and targets of GF-22. No checkpoint of
GF-22 changes with this record: its first slice closed with the
[networking record](../evidence/networking/README.md).
