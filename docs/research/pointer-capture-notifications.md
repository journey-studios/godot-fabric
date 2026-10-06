# Pointer capture notifications for EventTarget listeners

Status: executed isolated macOS validation against pinned RN 0.87.1 and official
Godot 4.7.2. The [evidence](../evidence/pointer-capture-notifications/README.md)
owns the 672 headless checks in eight lanes and two retained negative controls.
No native or SDK code changed: the host already matches RN here. Public
EventTarget flags remain disabled.

## What RN does

The shared C++ `PointerEventsProcessor`
(`ReactCommon/react/renderer/uimanager/PointerEventsProcessor.cpp`) owns
capture on both platforms:

- `setPointerCapture` stores a pending owner only for an active pointer with
  pressed buttons; `releasePointerCapture` clears it only when called on the
  pending owner; `hasPointerCapture` reads the pending map, so it answers at once
  (`ReadOnlyElement.js` reaches these through `NativeDOM.cpp`).
- `interceptPointerEvent` first runs `processPendingPointerCapture` for the
  event's pointer: `topLostPointerCapture` to the previous active owner, then
  `topGotPointerCapture` to the pending one, each retargeted to its owner by
  `retargetPointerEvent` and dispatched at Discrete priority. Both fall through
  `shouldEmitPointerEvent`'s default branch, so they are emitted without any
  listener check. A capture set during a Down's listeners is therefore notified
  at that pointer's next event, not at the Down.
- The event itself is then retargeted to the pending owner. Hover tracking
  (`handleIncomingPointerEventOnNode`, `PointerHoverTracker.cpp`) receives the
  retargeted node, so boundary events follow the owner, and the event is emitted
  only when the owner's path listens, which can drop a retargeted Move or Up
  whose physical target listened.
- After a Cancel, or an Up of a pointer that did not hover before its Down (a
  touch), the processor leaves the hover path (out, then leave from the deepest
  node). Then it releases the capture implicitly and processes it again, which
  emits `lostpointercapture`. A mouse released while captured keeps its hover
  path on the former owner until its next event.
- `topClick` is retargeted only by a pending owner, and the Up has already
  released it. Android's `JSPointerDispatcher` clicks the deepest view of both
  native hit paths after `POINTER_UP`; iOS's `RCTSurfacePointerHandler` emits
  `onClick` on the release view right after `onPointerUp`. Neither knows about
  capture, so a click never goes to the capturing view.
- `BaseViewConfig.android.js` and `BaseViewConfig.ios.js` declare
  `topGotPointerCapture`/`topLostPointerCapture` as bubbling events with
  `onGotPointerCapture(Capture)`/`onLostPointerCapture(Capture)`.
  `dispatchNativeEvent.js` builds every native event cancelable and bubbling
  unless the config sets `skipBubbling`; `EventTarget.js` runs a node's prop
  listener before its added listeners, capture top-down and bubble bottom-up.
- `ReadOnlyNode.js` extends `EventTarget` only with native dispatch, and
  `ReactNativeElement.js` removes the public methods without the imperative
  flag: Document listeners need native dispatch, element listeners both flags.

When an owner is removed, the processor's weak reference expires only if
nothing retains the node; its hover tracker usually does, and `retargetPointerEvent`
then dereferences a missing newest clone. The
[capture boundary note](pointer-capture-boundary.md) records that crash and the
host's lifetime overlay, which clears disconnected owners without an event.

## What this host does

The SDK's base view config declares both notifications as bubbling events, the
generated processor overlay keeps `processPendingPointerCapture`, the
retargeting and the implicit release unchanged, and the native listener query
admits no got/lost offset (RN never asks). Executed against actual input, the
host matches every rule above in all eight lanes, so this slice adds only the
fixture, probe, runner and CI step.

## Choices where RN and W3C differ

The host follows RN. The W3C Pointer Events rules below are known differences.

- **Click under capture.** W3C dispatches `click` at the target of the captured
  `pointerup` (Pointer Events 3, §4.2.12.3). RN keeps its platforms' physical
  hit paths, after the Up has released the capture.
- **Implicit touch capture.** W3C asks direct-manipulation devices to behave as
  if `setPointerCapture` ran before the `pointerdown` listeners ("Implicit
  pointer capture"). RN captures only when JS asks.
- **Removed owner.** W3C sets the capture target to the document so the next
  processing fires `lostpointercapture` there ("Implicit release of pointer
  capture"). RN 0.87.1 has no path that targets the Document (a root-targeted
  event never reaches JS) and crashes when a retained owner is removed; the host
  clears the owner silently, like RN's only branch that does not crash.
- **Touch release order.** W3C releases immediately after `pointerup`, before
  the boundary events of a non-hovering pointer; RN emits up, out, leave, then
  lost.
- **Boundary events after release.** W3C sends them right after an implicit
  release for a hovering pointer; RN waits for the pointer's next event.

When the capturing view is also the contact's hit view or origin, removing it
cancels the contact by the host's earlier lifetime rule: the cancel targets the
removed view and reaches no listener, and a held mouse button stays inert until
released. RN would crash there, so there is no RN behavior to match.

## Why the probe is discriminating

The [driver](../../tests/pointer-capture-notifications-probe.gd) sends actual
Godot mouse and touch events over two roots of one application; the
[fixture](../../tests/pointer-capture-notifications-fixture.jsx) calls the
original ref methods from JSX `onPointerDown`/`onPointerMove` and records every
callback, the raw native stream and `hasPointerCapture` inside each handler and
notification. The [runner](../../tests/pointer-capture-notifications-native.test.mjs)
re-verifies each report with a model of RN's processor (pending/active owners,
hover tracker, implicit release, removal) and Android's click rule, plus a
generic DOM dispatch model, written apart from the probe's hand-derived lists.

- **Cases.** Capture on the pressed view with moves over a sibling, the group,
  an empty root point, outside the surface and over the other root; capture
  released by an immediate Up; transfer to a sibling; explicit release; mouse
  and touch cancel; removal of an owner that is not the hit view and of one that
  is; capture by a third view and by a view with no listener; a buttons-free
  request; a touch without capture; two fingers; the same capture on root B.
- **Controls.** An SDK declaring got/lost with `skipBubbling` fails the delivery
  of 12 or 13 cases per lane; an overlay that tracks hover by the physical
  target fails sequence, payload and delivery in the 11 cases where the pointer
  leaves its owner. The oracle rejects all 16 reports and accepts the final 8.

Offsets of hover events follow the host's per-target projection
([pointer geometry](pointer-geometry.md)) and are not part of this certification.

## Versioned primary sources

- [PointerEventsProcessor](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/ReactCommon/react/renderer/uimanager/PointerEventsProcessor.cpp)
- [PointerHoverTracker](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/ReactCommon/react/renderer/uimanager/PointerHoverTracker.cpp)
- [ReadOnlyElement capture methods](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/src/private/webapis/dom/nodes/ReadOnlyElement.js)
- [dispatchNativeEvent](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/src/private/renderer/events/dispatchNativeEvent.js)
- [EventTarget](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/src/private/webapis/dom/events/EventTarget.js)
- [Android BaseViewConfig](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/Libraries/NativeComponent/BaseViewConfig.android.js)
- [Android JSPointerDispatcher](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/JSPointerDispatcher.kt)
- [iOS RCTSurfacePointerHandler](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/React/Fabric/RCTSurfacePointerHandler.mm)
- [W3C Pointer Events Level 3](https://www.w3.org/TR/pointerevents3/)

These files were read in the installed pinned sources; online documents can
change independently.
