# One touch stream for every root of an application

Status: executed isolated macOS validation against pinned RN 0.87.1 and official
Godot 4.7.2. The [evidence](../evidence/shared-touches/README.md) owns the 92
headless checks in four flag lanes and the preceding-host control. Public
EventTarget flags remain disabled. Hosted CI for this slice is pending.

## What RN's responder assumes

React Native keeps one JS responder per runtime. `ResponderEventPlugin` (legacy)
and `ReactNativeResponder` (native dispatch) both store a single responder
instance and one `ResponderTouchHistoryStore`, and they read every touch event's
`touches` list to decide whether the gesture is over:

- A start or move in another view can claim the responder only through the
  nearest common ancestor of the responder and the new target; views of two
  roots have none, so a touch in another root never claims.
- An end releases the responder when no listed touch still targets a view inside
  it (the legacy plugin's `noResponderTouches`) or when no touch remains listed
  at all (`ReactNativeResponder`); a cancel always terminates it.
- The touch history is keyed by `identifier`, so every active touch of the
  runtime needs its own identifier.

On a single surface both platforms satisfy this: the event lists every active
touch of that surface.

## What RN's platforms do with several surfaces

Each surface keeps its own touch stream. On iOS every `RCTSurfaceView` has its
own `RCTSurfaceTouchHandler`, whose `_activeTouches` and `_identifierPool` are
per handler; `_dispatchActiveTouches` lists only that surface's touches. On
Android every root view owns a `JSTouchDispatcher`, and `TouchesHelper` builds
`touches` from the pointers of the one `MotionEvent` that root received. Two
surfaces touched at the same time therefore release each other's responder in
RN too, and iOS can also give both surfaces' touches the same identifier, which
the single touch history cannot tell apart. RN's own multi-surface apps rarely
touch two surfaces at once; a Godot application with several roots can.

## What this host did

The host already numbered contacts application-wide (Godot touch index `i` is
identifier `i + 1`, the mouse is 0), but each root's `PointerAdapter` listed only
its own contacts. With root A pressed and a touch in root B, B's end listed no
touch inside A's responder, so RN released A's `Pressable` and pressed it with
B's touch. Every public consumer of the responder had the defect: `Pressable`,
`PanResponder` and the touchables.

## The change

Each root's adapter now adds the active touches of the application's other roots
to the `touches` of every TouchEvent it dispatches, as one surface would list
them. `changedTouches` and `targetTouches` stay those of the touch's own target,
and each touch is still dispatched to its own root. Nothing else changes: a
touch in another root still cannot claim (no common ancestor), cannot release a
responder while the holder's touch is listed, and a cancel still terminates the
one responder, exactly as on a single RN surface.

This deliberately departs from the per-surface streams of RN's platforms, in
favor of the semantics RN's single responder and touch history are written
for. Pointer events are untouched: they are per pointer, not per surface.

One consequence comes from RN itself. When the responder's own touch ends while
another root's touch is still down, the legacy plugin releases at once (the
remaining touch is outside the responder), but `ReactNativeResponder`, which
the native-dispatch flags select, releases only when no touch remains, so the
press completes at the other touch's end and with its payload. A single RN
surface with two fingers behaves the same way; the public default flags use the
legacy plugin.

Two existing contracts pinned the per-root lists and now state the application
list: the integrated dispatch probe expects the TouchEnd of A's touch to still
list B's contact and the responder to follow each implementation's rule (its
explicit global oracle already showed `ReactNativeResponder` holding until the
last contact), and the pointer-geometry example expects a TouchCancel in A to
still list B's surviving contact.

## Why the probe is discriminating

The [driver](../../tests/shared-touches-probe.gd) mounts two roots of one
application, each with an original `Pressable`, and presses them with actual
Godot touches and the mouse. The [runner](../../tests/shared-touches-native.test.mjs)
states RN's rules independently and checks, in every lane, the Pressable
callbacks with the touch that caused each one and every raw TouchStart, TouchEnd
and TouchCancel with its `changedTouches`, `touches` and `targetTouches`:

- **Overlaps.** A pressed and B touched and released, the reverse order, and the
  mouse in A with a touch in B: the root pressed first presses once with its
  own touch, the other root's touch neither claims nor releases it and presses
  nothing, and each event lists both touches until one ends.
- **Own touch first.** A pressed, B touched, A's touch lifts, then B's: the
  legacy lanes press A at its own end; the native-dispatch lanes press A at B's
  end, as `ReactNativeResponder` does on one surface.
- **Sequence.** Separate presses in A and then B each press once.
- **Cancel.** A cancel of B's touch terminates A's responder (`pressOut`, no
  press), as any cancel does on one surface.

The preceding host runs the same bundle in the enabled lane and fails exactly
the 9 normative checks: A presses with B's touch, A presses at its own end where
`ReactNativeResponder` would hold, and each root's events list only its own
touches.
