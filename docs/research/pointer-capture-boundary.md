# Pointer transport and capture: source boundary and adapter hardening

Status: pinned RN 0.87.1 source investigation followed by native adapter
implementation. Native processor tests have passed **144 positive C++
assertions**. Public JSX/Godot validation passes **132/146 checks**; captures,
exception fixtures and provenance are in [pointer evidence](../evidence/pointers/README.md).
Complete GF-08/GF-13 acceptance remains open. The [focus evidence](../evidence/focus/README.md)
remains a separate contract.

## Preserve the actual upstream baseline

The original ReadOnlyElement already exposes `hasPointerCapture`,
`setPointerCapture` and `releasePointerCapture` through NativeDOM. Before this
slice, Godot's adapter sent TouchEvent payloads only. UIManagerBinding registers
active pointers in its original PointerEventsProcessor when the payload is a
PointerEvent; inherited public capture methods could not acquire a live pointer
from that previous transport. The new adapter supplies PointerEvent payloads
while retaining the separate TouchEvent/Pressability path. Godot's View
configuration supplies upstream JSX event names to the original renderer;
handlers use original refs and the pinned legacy event plugin path.

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

The original, unmodified processor has a deletion boundary:

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

The selected selective-lifetime design must also pass the isolated public
fixture before capture support is published. A mounted-only experiment cannot
establish removal safety. Source investigation and processor unit assertions
alone do not close a GF checkpoint or certify the complete public platform
contract.

## Implemented native lifetime overlay

The [overlay generator](../../scripts/rn-pointer-overlay.mjs) verifies the
SHA-256 hashes of the pinned `PointerEventsProcessor.h/.cpp` and
`UIManagerBinding.h/.cpp` inputs before generating the adapter sources.
Unknown input hashes or replacement spans fail the generation. CMake compiles
the generated files from `build/<native-build>/rn-pointer-overlay`; downloaded
RN sources under `.deps` remain immutable. The generated manifest and native
SDK source records identify the original inputs, generated sources and overlay
manifest hash. This is a versioned modification of the native RN adapter
compiled into the addon, not a replacement React reconciler or a recompiled
Godot engine.

The adaptation keeps the original pending/active capture registries and their
normal event order. `hasPointerCapture` sees pending assignments immediately;
got/lost processing waits for the next pointer sample. Native up/cancel uses
the original implicit release. Inactive IDs, buttons-free pointer state and
wrong-owner release retain the pinned no-op behavior rather than acquiring
browser-only exception semantics.

Cleanup distinguishes capture ownership from physical contact ownership:

- A disconnected capture target is removed from pending/active capture maps;
  handlers on that disconnected target are suppressed. A surviving physical
  origin remains active and can receive later input.
- Removal of the physical origin retires its contact and corresponding pointer
  continuation. Selective ID cleanup leaves unrelated contacts and roots intact.
- Root retirement removes that surface's capture targets. A contact originating
  in another surface can survive the loss of its capture owner.
- Newest-clone retargeting is guarded against null. Dispatch rechecks connected
  clones and an ID-specific lifetime guard prevents callbacks from resuming a
  pointer continuation that native retirement has invalidated.
- Native move/up/cancel can reach the original processor even outside native
  hit targets; connected capture can still retarget those samples.

This avoids depending on weak-reference expiry and does not dispatch JS from a
retryable before-commit hook. The original null-clone gap described above is
preserved as the reason for the overlay; generated-source tests and public
fixture results must be attributed separately from the unmodified RN baseline.

## Public fixture and remaining certification

The [pointer example](../../examples/pointers/README.md) uses public JSX/View
refs with real `Input.parse_input_event` input, declared untransformed geometry
oracles, two shared roots and an independent application. It exercises capture
ordering, contact identity/cancellation, outside-root movement, retained refs,
React callback deletion and typed queued Godot lifecycle requests. Those queued
requests are not proof of synchronous JS callback retirement. Results and
captures require their own executed evidence before acceptance is claimed.

Imperative EventTarget remains disabled by the original pinned defaults.
Captured offsets under transforms are not certified; original RN's incomplete
origin-subtraction retargeter requires a separate coordinate/reference oracle.
Injected untransformed input does not certify physical pointer hardware,
mobile input or overlapping roots and z-order across independent applications.
Full HostInstance and GF-08/GF-13 parity remain open.

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

## Executed exception and stop boundaries

The native/JSX fixtures now also exercise listener exceptions. Original RN can
leave a moved hover-tracker entry null after a listener throws; its next native
sample dereferences it. The generated overlay retires only the offending
pointer's authority and relays the original error. Scoped binding cleanup
releases temporary EventTarget retention and restores the previous priority.
The actual JSX fixture observes default-priority recovery, six deliberate
errors and continued input in an independent captured application.

A stop requested by a real LineEdit focus signal inside a got-capture callback
invalidates pointer continuations immediately. React/native destruction remains
deferred until the outer execution scope returns. The accepted queued service
retirement example and this synchronous signal test are distinct proofs.
See [executed evidence](../evidence/pointers/README.md): 132/146 public checks,
144 native assertions, two original-source crash controls and 43 fault checks.
