# Running the original PanResponder

Status: executed isolated macOS validation against pinned RN 0.87.1 and official
Godot 4.7.2. The [evidence](../evidence/pan-responder/README.md) owns the 128
headless checks in four flag lanes, the preceding-SDK control and a retained
sabotage. Public EventTarget flags remain disabled.

## What RN's PanResponder needs

`Libraries/Interaction/PanResponder.js` is plain JS. It turns a config of
`onPanResponder*` callbacks into the eleven responder handlers
(`onStartShouldSetResponder[Capture]`, `onMoveShouldSetResponder[Capture]`,
grant, reject, start, move, end, release, terminate and termination request) and
keeps one gesture state per instance:

- The capture start handler resets the state on the first touch, so every
  PanResponder on the touched path starts clean.
- Grant records `x0/y0` as the centroid of the active touches and resets
  `dx/dy`.
- Moves add the centroid change of the touches that changed since the state's
  last accounted timestamp (`TouchHistoryMath`). With more than one active
  touch that comparison is inclusive, so a two-finger move uses the centroid of
  both touches; velocity is that distance over the elapsed history time.
- Start and end read `numberActiveTouches` from the touch history; release and
  terminate pass the final state and reset it.

Everything comes from the responder events and their `touchHistory`, which the
renderer builds from the touch events' `touches`, `changedTouches` and per-touch
timestamps — in the legacy plugin (`ResponderEventPlugin`) and, with native
dispatch, in `ReactNativeResponder`. Negotiation is the responder system's: a
requester is granted before the current responder is asked to yield, so a
refused claim sees its grant and then its reject.

## What this host did

The platform's `react-native` exported a `PanResponder` whose `create` threw
"Chart platform PanResponder/pinch zoom is not implemented", a leftover from the
chart example. The touch transport and the original responder system were
already certified for Pressability: actual Godot touches and the left mouse
button produce TouchStart/Move/End/Cancel with stable identifiers, every active
touch and per-touch timestamps.

## The change

The platform exports RN's original module. No native code changes. The shared
bundler now exports its probe helper, so later probes call it from their own
runners instead of adding entries to a producer every preceding-host control
pins.

## Why the probe is discriminating

The [driver](../../tests/pan-responder-probe.gd) uses actual Godot touches and
mouse buttons over two roots of one application. The
[runner](../../tests/pan-responder-native.test.mjs) restates RN's gesture rules
and checks every callback and the gesture state it carries:

- **Single drags.** A touch and a mouse drag grant at the start centroid, move
  with the accumulated displacement, end with no active touch and release with
  the final displacement; velocity follows the movement.
- **Two fingers.** The second finger starts with two active touches; each move
  uses the centroid of both, as `TouchHistoryMath` does; the touches end one at
  a time before the release.
- **Negotiation.** A parent that claims vertical moves past ten points takes the
  gesture from a `Pressable` (granted, then the Pressable presses out without
  pressing); a pan view that refuses to yield keeps it (the parent is granted,
  then rejected); a capture parent wins the start over its child.
- **Removal.** Removing the responder's View cancels the contact; the unmounted
  responder receives no further callback, as RN cannot reach an unmounted
  instance either, and the next gesture is granted normally.

Both responder implementations — the legacy plugin and native dispatch —
produce identical callbacks and gesture state in all four lanes. The preceding
SDK fails the run at mount, when its stub throws on the first `create`. A
sabotaged PanResponder that drops the capture-phase handlers fails 6 checks
(its state no longer resets on the first touch and no parent can claim), and
the independent oracle rejects it.

## Open

Pinch zoom through RN chart libraries, `InteractionManager` handles, gesture
velocity on real hardware, nested scroll views and responder negotiation with
native Godot controls remain open.
