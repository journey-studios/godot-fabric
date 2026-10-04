# Letting original View pointerup listeners qualify native emission

Status: executed isolated macOS validation against pinned RN 0.87.1 and official
Godot 4.7.2. The [evidence](../evidence/pointer-up/README.md) owns the 62 headless
checks, 90 graphical checks and eight-failure native control. Public EventTarget
flags remain disabled. All 16 proportional regression commands and fresh SDK
pack/verify passed; hosted CI for this Up slice is pending.

## Registration and native delivery were separate contracts

The original RN View ref already accepted `addEventListener('pointerup', ...)`.
An independent public `dispatchEvent` proved the actual listener was installed:
one untrusted callback, without native Raw or a React counter update. That alone
did not establish native delivery. RN's pointer processor filters emission by
the target's ViewProps/path before the JS dispatcher runs. The preceding Godot
interest extension considered only Down, so it never consulted the installed
Up listener Maps for a real ScreenTouch release.

The initial control kept eight normative failures visible: trusted callback,
typed/star Raw, React/native commit and SDK qualification in each of bubble and
capture-only. Its original TouchEnd, Raw touch and terminal cleanup still passed.
This distinguishes a missing interest qualifier from a broken physical contact
or an uninstalled listener.

The final causal comparison replayed the corrected SDK bundle on the preceding
native host, then the corrected host. Bundle bytes and all 18 original RN input
pins were identical. Only two native producer inputs changed: the host query
boundary and generated PointerEventsProcessor overlay. The old host still failed
the exact eight checks; the corrected host passed all 62. The historical initial
negative receipt retains its earlier SDK hashes separately.

## Extend the existing original-Map query

Four existing boundaries now admit the exact Up offsets:

1. The [pinned EventTarget overlay](../../sdk/toolchain/rn-pointer-interest-overlay.mjs)
   reads the original phase/type listener Maps for `pointerup`, sharing the same
   removed-listener check used for Down. It invokes no listener and mirrors no
   registry.
2. The [SDK platform plugin](../../sdk/toolchain/platform-plugin.mjs) explicitly
   maps original `ViewEvents::PointerUp=36` and `PointerUpCapture=37` to those
   phase queries. Other offsets retain their preceding behavior; adjacency or
   numeric parity does not define their meaning.
3. The [native installed query](../../native/application_runtime.cpp) accepts
   those original enum values while retaining its current-root/ref resolution,
   boolean validation and diagnostic boundary.
4. The [generated native overlay](../../scripts/rn-pointer-overlay.mjs) checks
   original imperative interest for Up as well as Down when normal ViewProps
   do not qualify. Original queue, dispatcher, pointer registry and terminal
   cleanup remain in control.

The defaults install no query. The fixture enables both original flags before
imports and opts into the experimental dispatcher/current interest toolchain.
This is not a new user-facing event API.

## Why the probe is discriminating

The [wrapper](../../tests/pointer-up-fixture.jsx) reuses the actual two-root
View/ref scene and one real SDK observer. No JSX pointerdown/up helper is added.
Down produces only the original TouchStart and its two Raw deliveries, commits
one functional update and leaves a legitimate contact held. Each Up phase has
an independent positive manual registration control before physical input.

On release, bubble-only qualifies with `36=true`. After that listener is removed,
the isolated capture-only case observes `36=false` before `37=true`. Both real
callbacks run at the target's phase 2: a capture listener at its own target is
not an ancestor phase-1 event. Neither case calls `setPointerCapture`; captured
pointer ownership is a separate contract.

Each trusted Up has one typed and one star Raw delivery with the original
callback's payload object, timestamp and pointer ID. Buttons and pressure are
zero. The functional Up update produces one native commit and the expected
actual counter width. The Discrete callback priority and restored Default/global
event/transient fields are checked for the enabled configuration.

B has no Up listener and completes a gesture while A remains held. Its SDK
query really visits eight false Up entries, yet emits no Up callback/Raw or
React update. Original TouchEnd and Raw touch still run; only B's contact ends.
A's Up, the later Cancel and final stop separately verify cleanup. Cancel has
no Up query entry and does not reuse Up's offsets.

The [native driver](../../tests/pointer-up-probe.gd) injects real Godot input into
the native queue. The [runner](../../tests/pointer-up-native.test.mjs) keeps exact
check IDs, rejects unrelated errors and saves failed control reports before
asserting success. Graphical acceptance reads the actual Viewport and independently
decodes the saved PNG, rather than rendering a mock. The captured stage follows
the first bubble case: yellow TouchStart counters are A1/B1 and green Up
counters are A1/B0. Capture-only, Cancel and stop happen later.

## Next bounded acceptance

- Document/documentElement Up and the four original flag configurations need
  their own native qualification controls. This View proof does not certify
  the root resolver merely because shared source can route an Up query there.
- General Up membership (once, abort, removal, rerender), retained/retired refs,
  captured/no-hit Up, got/lost capture, coalescing and responder transitions
  remain separate from the tested registration switch and balanced stop.
- Up-specific query/resolver faults and reentrant lifecycle behavior are not
  covered by earlier Down-only fault controls. Neither the new offset mapping
  nor this successful release establishes their recovery contract.
- Down is filtered here, so only Up callback/Raw pointer identity is proved.
  A real qualified Down control is needed to compare a public Down/Up pair.
- Other priority flag branches, development renderer, hardware, exported Godot
  mobile input, full RN parity and performance are unverified by this probe.

The [example](../../examples/pointer-up/README.md) presents the ordinary ref
syntax within its isolated opt-in configuration and actual native frames.
