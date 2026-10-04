# Pointer transport and capture: the next host boundary

Status: source investigation against pinned RN 0.87.1. This document does not
claim an executed pointer/capture implementation, a reproduced crash or an
approved cleanup design. The [focus evidence](../evidence/focus/README.md)
remains a separate executed contract.

## Preserve the actual upstream baseline

The original ReadOnlyElement already exposes `hasPointerCapture`,
`setPointerCapture` and `releasePointerCapture` through NativeDOM. Godot's
current input adapter sends TouchEvent payloads. UIManagerBinding only registers
active pointers in its original PointerEventsProcessor when the payload is a
PointerEvent. Public capture methods therefore cannot acquire a live pointer
from today's transport.

`enableImperativeEvents` and `enableNativeEventTargetEventDispatching` are false
in the pinned JS defaults. The distributed production renderer uses legacy
plugins. Enabling those flags alone would not route native events into the
separate EventTarget dispatcher. Treat imperative EventTarget as a separate
versioned feature investigation; its absence with these flags is the upstream
baseline.

## Capture lifetime must precede exposing transport

The original processor reports pending capture immediately through
`hasPointerCapture`; got/lost events are processed at the next pointer event.
Inactive IDs and release by a different owner currently no-op. These details
are the pinned contract, rather than assumptions from browser DOM behavior.

There is an unresolved deletion boundary in the original source:

1. `releasePointerCapture` removes the pending override, retaining the active
   override until the next event.
2. `processPendingPointerCapture` retargets lost-capture notifications through
   that previous active target.
3. `retargetPointerEvent` dereferences the newest ShadowNode clone without a
   null check. A removed family can have no newest clone while an older node
   remains referenced.
4. Godot's mounting delegate executes after ShadowTree replaces its current
   revision. Clearing capture from the Delete mutation alone is too late for
   the old target's retargeting lookup.

Weak-reference expiry is not a lifetime guarantee. The renderer's later
`detachFiberAfterEffects` clears `stateNode`; retained native/node references
can extend the old node's lifetime. A global processor reset would erase the
other roots' pointer, hover and capture state.

A public before-commit hook exists, but it is not a proven cancellation path.
Commit hooks run under a shared hook lock and may be retried. Calling JS from
there introduces callback, commit and retirement reentrancy inside that
boundary. Similarly, queueing cancellation before `RN$stopSurface` does not
prove it is processed before the root's removal.

## Proposed acceptance order

- Establish application-wide pointer identity and ownership across surfaces and
  windows. Existing per-root touch IDs cannot be copied blindly into a shared
  runtime pointer registry.
- Deliver native PointerEvent fields, native hit targets and supported View
  event configs while preserving TouchEvent/Pressability behavior. Transport
  exposes capture implicitly through the inherited methods, so capture must
  either fail visibly at NativeDOM or have proven cleanup before this becomes
  a public capability.
- Prove pending/active capture and got/lost ordering on untransformed sibling
  targets: immediate queries, release by the wrong owner, inactive IDs,
  transfer, up/cancel, multiple pointers and roots.
- Prove deletion of the capture target, retained refs, root/application
  retirement and reentrant callbacks. Surviving roots retain their state; no
  stale pointer registry or retired node remains usable.
- Certify captured coordinate semantics separately. The pinned upstream
  retargeter explicitly uses an incomplete origin subtraction for nontrivial
  transforms. Native local geometry and that original contract need separate
  oracles before any full transform/capture parity claim.

Choose a selective lifetime design and demonstrate it in an isolated fixture
before publishing capture support. A mounted-only experiment cannot establish
removal safety. No new GF checkpoint or architectural approval follows from
this source investigation.

## Versioned primary source

- [ReadOnlyElement capture methods](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/src/private/webapis/dom/nodes/ReadOnlyElement.js)
- [JS feature defaults](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/src/private/featureflags/ReactNativeFeatureFlags.js)
- [Distributed production renderer](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/Libraries/Renderer/implementations/ReactFabric-prod.js)
- [UIManagerBinding payload dispatch](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/ReactCommon/react/renderer/uimanager/UIManagerBinding.cpp)
- [PointerEventsProcessor public interface](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/ReactCommon/react/renderer/uimanager/PointerEventsProcessor.h)
- [Capture processing and retargeting](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/ReactCommon/react/renderer/uimanager/PointerEventsProcessor.cpp)
- [ShadowTree commit/mount order](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/ReactCommon/react/renderer/mounting/ShadowTree.cpp)
- [UIManager hook dispatch](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/ReactCommon/react/renderer/uimanager/UIManager.cpp)

These files were inspected in the installed pinned sources. Online docs can
change independently; the source/lockfile baseline controls the investigation.
