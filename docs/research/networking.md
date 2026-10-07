# fetch and XMLHttpRequest over Godot's HTTP client

Status: executed isolated macOS validation against pinned RN 0.87.1 and official
Godot 4.7.2. The [evidence](../evidence/networking/README.md) owns the 100 headless
checks against a deterministic local server over HTTP and HTTPS, the independent
oracle that compares the 137 requests the server recorded with what JS observed, the
preceding-host control (the same bundle fails exactly its 84 normative checks) and two
retained sabotages (a transport that never follows a redirect fails 8 checks, one that
does not join repeated response headers fails 2). WebSocket (certified afterwards, see the
[WebSocket record](../evidence/websocket/README.md) and its [research note](websocket.md)),
cookies, compressed responses, HTTP/2, upload and download progress, incremental
streaming, `uri` and file bodies, connection pooling and every target but macOS are not
certified. Hosted CI is pending.

## What RN does

**JavaScript** (`Libraries/Core/setUpXHR.js`, `Libraries/Network`, `Libraries/Blob`).
`InitializeCore` requires `setUpXHR`, which installs `XMLHttpRequest`, `FormData`,
`fetch`, `Headers`, `Request`, `Response`, `WebSocket`, `Blob`, `File`, `FileReader`,
`URL`, `URLSearchParams`, `AbortController` and `AbortSignal` as lazy globals
(`polyfillGlobal`, lines 21-48): each module loads on first read. `fetch` is the
whatwg-fetch 3.6.20 polyfill (`Libraries/Network/fetch.js`) written over
`XMLHttpRequest`. It asks for `responseType = 'blob'` whenever `new Blob()` works
(`fetch.js` of the package, lines 12 and 593-599) and then reads a body through
`FileReader`; without a `BlobModule` it falls back to `arraybuffer` and decodes the
bytes as Latin-1, which breaks UTF-8. A request's `signal` aborts its XHR
(lines 531-626), so the abort is purely JS.

`XMLHttpRequest.js` is the only caller of `RCTNetworking`. `send()` (line 564)
subscribes to six device events (lines 576-601: `didSendNetworkData`,
`didReceiveNetworkResponse`, `didReceiveNetworkData`, `didReceiveNetworkIncrementalData`,
`didReceiveNetworkDataProgress`, `didCompleteNetworkResponse`), maps `responseType`
to the native `text`, `base64` (for `arraybuffer`) or `blob`, and calls
`RCTNetworking.sendRequest`. The events carry `[requestId, ...]` arrays:
`__didReceiveResponse(id, status, headers, url)` (line 337) moves to HEADERS_RECEIVED,
`__didReceiveData(id, response)` (line 367) stores the body and
`__didCompleteResponse(id, error, timedOut)` (line 421) finishes. A non-empty `error`
becomes `error`, or `timeout` when the third element is true; 4xx and 5xx are `load`.
`abort()` (line 654) calls `abortRequest`, which emits nothing, and dispatches its own
`readystatechange`, `abort` and `loadend`. `readystatechange` and `progress` listeners
only ask for incremental updates: a request without them, or one whose native side never
sends the incremental or progress events, still loads from the one final data event.

The blob stack needs `BlobModule` (`getConstants` is read when `URL.js` loads, lines
17-27; `addNetworkingHandler` when XHR loads, line 69; `createFromParts` and `release`
from `BlobManager.js`, lines 62-99 and 135-142) and `FileReaderModule`
(`readAsText(blob, encoding)` and `readAsDataURL(blob)`, both promises). JS creates the
UUID of every blob it builds; a native response blob is `{blobId, offset: 0, size,
type?}`. `Blob.close()` releases the bytes, and `BlobManager.js` (lines 37-46) asks the
host for a `__blobCollectorProvider` whose host object lets the native side release a
blob JS dropped without closing it.

**The native contract is chosen by platform.** The two JS wrappers differ:

| | `RCTNetworking.android.js` | `RCTNetworking.ios.js` |
| --- | --- | --- |
| Request id | JS assigns it from 1 (line 35) and calls the callback synchronously after `sendRequest` | native assigns it and passes it to the callback (`RCTNetworking.mm`, lines 720-725) |
| `sendRequest` | positional: method, url, id, headers as `[name, value]` pairs, body, responseType, incrementalUpdates, timeout, withCredentials | one query object |
| Failure event | `[id, message]`, with a third element `true` only for a time-out | `[id, message, timedOut]` always (line 701) |
| Redirects, time-out | OkHttp: up to 20 follow-ups; `callTimeout` covers the whole call (`NetworkingModule.kt`, lines 416-418) | NSURLSession; `timeoutInterval` (line 335) |
| Cookies | an OkHttp cookie jar, off unless `withCredentials` (lines 371-373) | `HTTPShouldHandleCookies = withCredentials` (line 319) |
| Compression | OkHttp's transparent gzip, and an explicit gunzip when the app set `Accept-Encoding` (lines 665-690) | NSURLSession decodes |

The Android C++ spec (`NativeNetworkingAndroidCxxSpec`) is already generated in
`React/FBReactNativeSpec`. The Android module also requires a content type for string,
base64 and uri bodies (`NetworkingModule.kt`, lines 458, 510 and 549: "Payload is set but
no content-type header specified"), strips header names to printable ASCII
(`HeaderUtil.stripHeaderName`) and adds values as UTF-8 (`addUnsafeNonAscii`, lines
1029 and 1035), turns a string body into bytes itself so that OkHttp does not append a
charset to the caller's Content-Type (lines 481-501, react-native#8237), joins repeated
response headers with `", "` keyed by the name as received
(`NetworkEventUtil.okHttpHeadersToMap`, lines 239-250), reports the response's final URL
and answers the `text` response type with OkHttp's `string()` (a byte order mark first,
then the Content-Type charset, UTF-8 by default; `NetworkingModule.kt`, line 734).
Redirects, cookies and decompression are left to OkHttp on Android and to Foundation on
iOS.

## What this host did

`src/initialize.js` replaces `InitializeCore`, so `setUpXHR` never ran: `fetch`,
`XMLHttpRequest`, `FormData`, `Blob`, `FileReader`, `URL` and `AbortController` did not
exist, and no native module of the three was registered. Importing `setUpXHR` alone
would install globals that throw where they first look up a module: on the preceding
host the same bundle runs the JavaScript checks and every network check fails at the
lookup (`TurboModuleRegistry.getEnforcing(...): 'Networking' could not be found`,
`'FileReaderModule'`). RN also ships `RCTNetworking.js` only as a file that imports
itself, relying on the `.ios` and `.android` variants that this host's resolver never
picks.

## What Godot reports

`HTTPClient` is the engine's low-level client. It is non-blocking when polled: one
`poll()` advances resolution, connection, the TLS handshake, the request and the
response, and the status names the stage (`STATUS_RESOLVING`, `CONNECTING`, `CONNECTED`,
`REQUESTING`, `BODY`, `DISCONNECTED`, `CONNECTION_ERROR`, `TLS_HANDSHAKE_ERROR`,
`CANT_RESOLVE`, `CANT_CONNECT`). `read_response_body_chunk()` returns at most
`read_chunk_size` bytes, 65,536 by default; `get_response_headers()` is the raw list of
`Name: value` lines in wire order with duplicates and the case the server used;
`get_response_body_length()` is -1 for chunked or unsized bodies; `connect_to_host`
takes `TLSOptions` (`TLSOptions.client()` trusts the engine's roots,
`TLSOptions.client(chain)` only the given `X509Certificate`). TLS is mbedTLS with TLS 1.2
and 1.3, no revocation and no pinning. The client performs no redirects, no total
timeout (the `HTTPRequest` node has one, `HTTPClient` has none), no decompression, no
cookies, no pooling and no HTTP/2; `Host` is added unless the request names one.

Behaviors the transport depends on; the first three are asserted by the suite:

- A server that answers and closes the connection at once leaves the client in
  `STATUS_CONNECTION_ERROR` if it is polled again after the response completed, so
  the transport polls once per pump and takes a finished response before the next poll.
- A body that ends before its declared length leaves `STATUS_DISCONNECTED` with fewer
  bytes than `get_response_body_length()`.
- A certificate the engine refuses prints `ERROR: TLS handshake error: -9984` to the
  engine log and ends in `STATUS_TLS_HANDSHAKE_ERROR`; the runner allows exactly the
  three the probe provokes.
- Godot Android exports need the `INTERNET` permission and a Web export is bound by CORS;
  neither is exercised here.

## The implementation

`native/networking_modules.{h,cpp}` is one application's side of RN's stack: the C++
TurboModules `Networking` (RN's generated `NativeNetworkingAndroidCxxSpec`),
`BlobModule` and `FileReaderModule`, over one `BlobStore` (`native/blob_store.h`: UUID v4
ids, slices by offset and size, counters). They register through
`TurboModuleRegistry::add` like the other native modules and bind one stoppable call
invoker, so every device event and every promise settlement leaves through RN's runtime
scheduler in the order it was queued and is dropped once the application stops.

The transport sits behind `native/http_transport.h`: `start`, `cancel`, `poll`, `stop`
and a listener with `on_head`, `on_body`, `on_failure` and `on_complete`. Every call
runs on Godot's main thread, which is also the JS thread. `native/godot_http_transport.cpp`
is the first implementation: one `HTTPClient` and one connection per request, advanced
from `ApplicationRuntime::pump` before the work queue drains, with 1 MiB of body bytes
per pump shared by every request. The pure parts live in `native/http_core.h` and have
their own C++ test (81 assertions in 10 groups, `native/http_core_test.cpp`): URL
parsing and canonicalization, reference resolution, OkHttp's redirect rules, header
validation, media types, BOM-aware charset decoding, base64 and multipart.

- **Requests.** `sendRequest` validates the arguments and headers and builds the body
  (`string` and `base64` as bytes with the caller's Content-Type, unchanged and required as
  on Android; `formData` with string parts as multipart with a random boundary; `blob`
  with the blob's own type unless the caller set one), then starts the transport. Problems
  with the request itself (an invalid response type, timeout or header, a body that cannot
  be read) become a `didCompleteNetworkResponse` event, because on Android the JS wrapper
  has not yet told the caller the id when `sendRequest` returns; only a request id that is
  not a non-negative integer, or that is already in flight, throws. `uri` bodies and file
  parts fail with an explicit message.
- **Redirects.** The transport follows them itself: 301, 302 and 303 turn a non-GET,
  non-HEAD request into a GET without a body, 307 and 308 keep the method and the body,
  at most 20 follow-ups (the 21st fails with "Too many follow-up requests: 21"),
  across origins, `Authorization` dropped when the origin changes, a scheme the host
  cannot follow (anything but http and https) delivered as the response. The final URL
  is the response URL.
- **Time-out.** The deadline is `now + timeout` on the monotonic clock, checked on every
  poll, and covers the whole exchange including redirects and the body, as OkHttp's
  `callTimeout` does; 0 means none. The failure is `[id, "The request timed out.",
  true]`.
- **Responses.** Events are `didReceiveNetworkResponse` (headers joined with `", "`),
  then `didReceiveNetworkData` and `didCompleteNetworkResponse`. The body is buffered
  until it completes: `text` decodes by the Content-Type charset (UTF-8, ISO-8859-1,
  US-ASCII or UTF-16, a BOM wins, invalid UTF-8 becomes U+FFFD), `base64` encodes it, and
  `blob` stores it and sends `{blobId, offset: 0, size, type}`. A response whose
  `Content-Encoding` is not `identity` fails explicitly.
- **Abort and stop.** `abortRequest` marks a shared token so the events already queued for
  the request are dropped, cancels the transport silently and counts it. `stop` ends the
  transport first, releases every blob and refuses retained module methods with
  `E_MODULE_DISPOSED`; no listener runs afterwards and `disposeEnvironment` releases the
  device subscriptions of requests still in flight.
- **Blobs.** `BlobModule.createFromParts` copies string parts and blob slices into the
  store; `release` frees by id; the collector provider returns a host object whose
  finalizer (Hermes may run it on another thread) only queues the id behind a mutex, and
  the main thread releases it on the next poll. The object also tells the collector how
  many native bytes it holds.
- **Facade and seams.** `src/initialize.js` imports `setUpXHR`; the SDK's esbuild plugin
  aliases `RCTNetworking` to `RCTNetworking.android.js` (a project module of that name is
  untouched); `src/platform-environment.js` counts and disposes the six device
  subscriptions. The `react-native` facade gains no export: the `Networking` export stays
  missing, the globals are RN's own. Two validation seams on the `FabricApplication` node
  keep the suite deterministic: `validation_tls_trusted_authorities` (the PEM of the
  authorities an HTTPS request trusts instead of Godot's roots) and
  `validation_clock_offset_ms` (moves the clock the deadlines run on, so a time-out needs
  no wait). A product never sets either, and the defaults are Godot's roots and no offset.

## Why the probe is discriminating

The [server](../../tests/networking-server.mjs) is a Node child process that reports its
ports on stdout, records each request exactly as it arrived (raw header names, order and
duplicates, body bytes and hash, and how the connection ended) and never sleeps: a held
request stays held until a control request releases it or the client closes the
connection. It serves status codes, a raw header echo, repeated headers, JSON, UTF-8,
ISO-8859-1, BOM and invalid UTF-8 bodies, byte patterns of any size, a megabyte in
chunks, answers followed by a close, a compressed answer, redirect chains and loops, a
cross-origin and a cross-scheme redirect, resets and truncations, a port that accepts and
never answers, and HTTPS with a CA and a leaf signed at runtime
([certificates](../../tests/networking-certificates.mjs): only the public CA certificate
is written to `build/`), plus a second authority for the negative cases.

The [fixture](../../tests/networking-fixture.jsx) runs RN's public APIs in two roots of
one application and records what JS observes; the [probe](../../tests/networking-probe.gd)
waits on conditions, never on time, and also reads the application's networking snapshot.
The [oracle](../../tests/networking-oracle.mjs) trusts none of the probe's verdicts: it
derives the multiset of requests the cases must have caused (137, by listener, method and
URL), reads bodies, headers, redirects and connection ends from the server's record, and
ties the native counters to that record by arithmetic: every request the transport
started ended exactly one way (completed, failed or cancelled), 64 redirects were followed
(1 + 1 + 20 + 20 + 20 + 1 + 1), no event was delivered after the stop and none dropped, and
the blob store's books balance (stored = held + closed + collected).

On the preceding host the same bundle runs: the 16 checks that need no native module pass
and the other 84 fail, with no request reaching the server, and the oracle rejects the
report. A transport that never follows a redirect fails 8 checks, and the server then
records no follow-up; a transport that keeps repeated response headers apart fails the
join check and the cookie check, and the oracle rejects both reports. The runner also
fails on any engine, script or native error line it did not expect, and the same suite
passes with the control receipts absent, as in CI, and under heavy CPU load.

## Departures from RN

- **Android's contract, not iOS's.** The JS wrapper that lets JS assign request ids and
  deliver them synchronously, positional arguments and a header array are Android's; the
  failure event has two elements, three for a time-out. The iOS wrapper would need a second
  native module over a different spec.
- **No cookies.** Nothing is stored or sent, `withCredentials` has no effect and
  `clearCookies` calls back `false`.
- **No decompression.** OkHttp and NSURLSession decode gzip; this host fails the request
  with `Unsupported Content-Encoding` rather than deliver raw bytes. A string request body
  with `Content-Encoding: gzip` also fails explicitly (that path has no check of its own;
  other bodies drop the header, as on Android).
- **The body arrives whole.** Incremental updates and download or upload progress events
  are never sent, which XMLHttpRequest tolerates; a megabyte arrives over several
  budgeted polls but is delivered once.
- **No files.** `uri` bodies and `FormData` file parts fail explicitly.
- **HTTP/1.1, one connection per request.** No pooling, no HTTP/2, no proxy configuration.
- **Messages.** Failure messages are this host's (for example "Unable to resolve host",
  "unexpected end of stream from host:port"), not OkHttp's exceptions' text.
- **`BlobModule`'s constants** are iOS's (`blob`, no host), because Android's depend on a
  content provider this host has none of; `URL.createObjectURL` therefore reads
  `blob:<id>?offset=..&size=..`. Its WebSocket methods threw `E_UNSUPPORTED` until the
  [WebSocket record](../evidence/websocket/README.md) implemented them.

## Exploratory observations outside the receipt

Run once on the committed tree with scratch scripts and not asserted by the suite. Fetches
from the development machine on 2026-10-07 to public servers, over Godot's default roots
and with no validation seam: `https://example.com/` and `http://example.com/` answered 200
with `text/html` and 577 characters each, `http://www.wikipedia.org/` was followed through
one redirect to `https://www.wikipedia.org/` (200, `text/html`, 91,853 characters) and
`https://api.github.com/zen` answered 200 with 36 characters of `text/plain`; the transport
counted 4 started, 4 completed, 0 failed and 1 redirect followed. Real TLS verification and
a real redirect chain therefore work, but those servers' answers can change, so nothing
here is asserted. Three renderer capture runs of the example produced the same bytes for
the idle and aborted frames and different bytes for the other four, whose URL line shows
the ephemeral port of the loopback server. The suite passed 9 of 9 runs under 14 busy loops
on the 11-core machine (6 before the commit and 3 from the committed tree), and passes
with the control receipts absent, as in CI.

## Remaining scope

`WebSocket` (its first use failed with RN's own "'WebSocketModule' could not be found", and
`BlobModule`'s socket methods threw, until the [WebSocket record](../evidence/websocket/README.md)),
cookies and `withCredentials`, compression of
either direction, HTTP/2, upload and download progress, incremental streaming of text,
`uri` and file bodies, connection pooling and keep-alive, proxy and system trust
configuration, the `Networking` export of `react-native`, offline and reconnect
behavior, hardware and Godot Android, iOS and Web exports, and the contract, parity and
targets of GF-22. Only the first-slice checkpoint of GF-22 closes with this record.
