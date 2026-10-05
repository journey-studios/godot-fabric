# Letting original View pointermove listeners qualify native emission

Status: executed isolated macOS validation against pinned RN 0.87.1 and official
Godot 4.7.2. The [evidence](../evidence/pointer-move/README.md) owns the 219
headless checks (135 healthy and 84 in a Move-fault application), 243 graphical
checks and the 45-failure native control. Public EventTarget flags remain
disabled. Hosted CI for this slice is pending.

## The filter is upstream, the gap is imperative registration

RN's `PointerEventsProcessor` emits `topPointerMove` only when a node on the
path from the hit target to the root declares `PointerMove` or
`PointerMoveCapture` in its ViewProps (`shouldEmitPointerEvent`, the same
path walk used for Down and Up). JSX `onPointerMove` props set those bits; an
imperative `addEventListener('pointermove', ...)` on the original View ref does
not. With native EventTarget dispatch enabled, a View whose only Move listener
was imperative never received a real move: the event was dropped before the JS
dispatcher, even though a public `dispatchEvent` proved the listener installed.

The preceding host reproduces exactly that. Replaying the final SDK bundle on it
keeps 45 normative failures visible: delivery, the pointer Raw pair, the
React/native commit and the Move lookups for each of eight touch samples and
three mouse cases, plus B's lookup chain. TouchMove, the native move counters,
Down/Up/Cancel and terminal cleanup still pass, which separates the missing
interest qualifier from a broken input stream.

## Extend the same original-Map query

The four boundaries that already admitted Down and Up now admit Move:

1. The [EventTarget overlay](../../sdk/toolchain/rn-pointer-interest-overlay.mjs)
   reads the original phase/type Maps for `pointermove`, with the shared
   removed-listener check. It invokes no listener and mirrors no registry.
2. The [SDK platform plugin](../../sdk/toolchain/platform-plugin.mjs) maps
   original `ViewEvents::PointerMove=1` and `PointerMoveCapture=25`. They are
   not adjacent, which is why the table is explicit rather than derived.
3. The [native installed query](../../native/application_runtime.cpp) accepts
   those enum values with its existing ref resolution, boolean validation and
   `E_POINTER_LISTENER_QUERY` boundary.
4. The [generated native overlay](../../scripts/rn-pointer-overlay.mjs) asks for
   `{PointerMove, PointerMoveCapture}` interest for `topPointerMove` when the
   ViewProps do not qualify. Hover tracking runs before that decision and stays
   ViewProps-only, as do click and the capture notifications.

The two native build records differ only in the host hash, the two edited
producers and the generated `PointerEventsProcessor` tree; the other 6,703
recorded entries are identical.

## Priority and coalescing follow the host's enqueue

Like RN's `TouchEventEmitter::onPointerMove`, the Godot host enqueues a move
that hits a View with `dispatchUniqueEvent`, whose category is `Continuous`. With
`fixMappingOfEventPrioritiesBetweenFabricAndReact` off, as pinned,
`EventQueueProcessor` maps `Continuous` to React's Default priority. The
processor only re-dispatches with that queue priority. The mouse cases run with no
contact holding a ContinuousStart, where a plain `Unspecified` move would map to
Discrete, so the observed Default identifies the category.

RN's coalescing of unique moves needs a pending move in the queue, and this host
never has one. `ApplicationRuntime::input` pumps the event beat synchronously
after every input event, so each sample is flushed before the next arrives.
Godot's input accumulation, on by default, merges motion samples within a frame
instead: two samples in one frame reach the host as one motion and deliver one
callback at the latest point. With accumulation off, both samples dispatch in
order. Moves that hit no View, captured ones included, take a separate host path
as non-unique `Unspecified` events; that divergence predates this slice and
belongs to the capture work.

## Move lookup failures are reported once per cause

Down and Up lookups run once per gesture, and the fault slices certified that
each failing lookup leaves one retained `E_POINTER_LISTENER_QUERY`. Move lookups
run on every sample, hover included, so the same policy would grow the error list
and the engine log without limit. The host keeps the rejection, a failing lookup
still returns false and the rest of the path decides, but it retains each
distinct Move failure cause once, up to 16 distinct causes per application, and
only counts repeats and causes past that bound in `pointerListenerQuerySuppressed`.
Down and Up reporting is unchanged.

A second application exercises it with faults injected into A's own Move lookups.
A throwing bubble lookup over three samples leaves one diagnostic and counts two;
a non-boolean capture lookup over two samples leaves one and counts one; each
recovery sample delivers once the fault is spent. Fifteen distinct causes in a
row fill the bound with fourteen more diagnostics and count the fifteenth. B's
move stays healthy, and stop retains exactly the 16 diagnostics in order with four
counted failures.

## Why the probe is discriminating

The [wrapper](../../tests/pointer-move-fixture.jsx) reuses the actual two-root
View/ref scene with an optional orange Move counter and a ref on the target's
parent View. Each phase is installed alone and first proven by an untrusted
public dispatch with no native Raw or state change. The
[driver](../../tests/pointer-move-probe.gd) then injects real ScreenTouch,
ScreenDrag and button-less MouseMotion events through the native queue.

- On the target, bubble qualifies each sample with `1=true` and capture-only
  reads `1=false` then `25=true`; both run at phase 2. On the parent, the target's
  empty pair is read first, then the parent's Maps, and the callbacks run at
  phase 3 (bubble) or phase 1 (capture) with the parent as `currentTarget`.
- Each delivered sample has one typed and one star `topPointerMove` Raw with the
  callback's payload, timestamp and pointer ID, and commits one functional
  increment. Touch samples also keep the original TouchMove pair.
- B, with no Move listener, must read exactly its own pair, its parent's, the
  AppRegistry container's and the root handle's, in that order, all false, and
  emits no pointer move.
- Mouse samples carry `pointerType` mouse, `buttons=0` and the exact local point
  of the dispatched sample.
- Captures pin the exact counter width with the last orange and first background
  pixel of each bar. The [runner](../../tests/pointer-move-native.test.mjs) keeps
  exact check IDs, rejects unrelated errors and compares the old-host replay
  against the same bundle, test/SDK producers and RN pins.

## Next bounded acceptance

- Document/documentElement `pointermove` across the four original flag
  configurations. The shared root path already answers offsets 1/25, so a
  Document listener now qualifies any move in its surface without certification.
- Resolver getter faults during Move lookups and Document/documentElement Move
  faults, which share the bounded path but are not exercised here.
- Hover: `pointerover/out` and the enter/leave semantics with the processor's
  hover tracking.
- The per-move cost of the path query when no prop qualifies: two JSI calls per
  node, each resolving the newest clone.
- Pointer capture and captured/no-hit moves, `pointerrawupdate`, responders and
  PanResponder, multi-touch identity, the fixed priority mapping, hardware,
  exported mobile input and performance.

The [example](../../examples/pointer-move/README.md) shows the ordinary ref
syntax within its isolated opt-in configuration and the actual native frames.
