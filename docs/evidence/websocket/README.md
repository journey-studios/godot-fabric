# RN WebSocket over Godot streams and wslay

## Evidence status

The current backend passed its local macOS arm64/headless native suite on Godot
4.7.2-stable and React Native 0.87.1. The product probe passed 95 checks against
an independent server-wire oracle: 60 server connections and 53 required JS/wire
comparisons. The same run proves messages sent before a coalesced close, including
an interleaved ping, and preserves TLS close 1000 plus peer-selected close 4002
and its exact reason. A TLS drop after the client's close remains an abnormal
failure. See the curated [execution receipt](execution.json). Raw per-run reports remain
local and ignored.

Negative controls are also retained in the execution receipt: the preceding main host
(`afa5d875`) passed only 12 of 95 checks and made zero server connections; the Origin
sabotage failed exactly four checks, and the stop-close-code sabotage failed exactly two.
Both mutation runs were rejected by the independent oracle, and the source files and genuine
host hashes were restored after the runs.

The adapter uses Godot `HTTPClient` for asynchronous DNS/TCP/TLS connection setup,
then retains its public `StreamPeer` connection and uses pinned upstream wslay for
RFC 6455 framing. It does not use `WebSocketPeer`. Historical WebSocketPeer findings
remain in the [research record](../../research/websocket.md); their permitted data-loss
observations do not describe this adapter. The old engine
behavior in [godot#115384](https://github.com/godotengine/godot/issues/115384)
concerns `WebSocketPeer` packet queues and is not evidence of a current adapter
limitation.

The two RN load phases exercised independent shared limits over eight sockets,
with real message handlers, state updates and timers. The 8 KiB phase reached the
1 MiB inbound wire-byte allowance in one poll; the 512-byte phase reached the
256-event admission limit and canonical pending-event peak. Both delivered all
1,024 messages, gave every socket progress, and ended with zero pending events.
The 8 KiB phase's first-progress spread was one frame; the 512-byte phase's was
zero. The curated per-phase measurements are in the execution receipt.

The separate lifetime fixture called cancel and stop reentrantly from both
`on_open` and `on_message`, with `/echo` and `/greeting` data, for eight cases.
All cases ended with zero active connections and no terminal callbacks after the
operation. The four drained `/echo` cases recorded an exact wire close 1001. The
four `/greeting` cases had unread input and ended in a TCP drop before a close frame
was recorded. Cancellation sends 1001 best-effort; those drops are not described
as completed closing handshakes. The curated lifetime measurements are in the execution
receipt.

## Reproduction

Run `npm run test:websocket`. It serializes the product probe, exact TLS contract
smoke, reentrant lifetime fixture and the two load phases. The product oracle
checks the server's handshake and frame log independently of the probe's own
assertions. The runner fails on script/native error output and preserves raw
reports before assertions.

The transport applies a 30-second host deadline to connection plus HTTP upgrade,
verified through the injected clock. This is an explicit host policy; it is not
inherited from Android's 10-second OkHttp connect timeout. A closing handshake has
a separate 60-second deadline.

## Example validation and captures

The example passed 29/29 headless checks and 51/51 graphical checks on macOS with Godot
4.7.2-stable and RN 0.87.1. The graphical run sampled all 11 badge colors and saved 900×680
frames. The per-image SHA-256 and sampled color are in the [execution receipt](execution.json).

- Networking: [idle](networking-idle.png), [JSON](networking-json.png), [form](networking-form.png), [redirect](networking-redirect.png), [pending](networking-pending.png), [aborted](networking-aborted.png).
- WebSocket: [open](websocket-open.png), [echo](websocket-echo.png), [server close 4001](websocket-server-close.png), [drop](websocket-dropped.png), [client close 1000](websocket-closed.png).

## Packaging and target limits

The verified macOS native SDK pack and provisioned addon include the pinned wslay library and
license. The iOS simulator arm64 build passed and its combined archive link retains both Fabric
and wslay symbols. That link proof did not execute on an iOS runtime or export a consumer app;
ABI certification and hosted CI remain separate.

## Boundaries

This is local headless evidence on macOS arm64. Android, iOS-device and Web runtime behavior
remain separate. The fixtures do not certify `permessage-deflate`, other
extensions, cookies, proxies, system trust integration, HTTP/2, long-duration or
hardware load, offline reconnection, or the complete GF-22 acceptance. This PR
adds evidence for one GF-22 slice; no roadmap checkpoint, weight, denominator or
GF completion is claimed.
