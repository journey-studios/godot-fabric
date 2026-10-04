# Imperative EventTarget at the RN 0.87.1 boundary

Status: source investigation, **runtime proof pending**. This note proposes
acceptance for the next GF-08/GF-13 slice. It does not enable a capability,
approve a renderer change or certify experimental RN APIs.

## Three independent gaps

1. `enableImperativeEvents` and `enableNativeEventTargetEventDispatching` both
   default false. ReadOnlyNode chooses its EventTarget base while the module is
   evaluated; overrides must precede ref imports. The pinned ReactFabric-prod
   `dispatchEvent` still emits RawEventEmitter and uses the legacy plugin
   extraction path, with no call to the shipped `dispatchNativeEvent` function.
   The original private interface exports that dispatcher; the Godot private
   interface currently does not. Exposing ref methods alone cannot establish
   native listener delivery.
2. Original `addEventListener` stores JS listener state without declaring native
   ViewProps interest. The pointer processor filters several event kinds by
   declarative pointer props in the ancestry. An acceptance fixture with empty
   JSX handlers would hide the imperative-only emission gap.
3. `getEventTargetParent` caches the first parent, including null, on the target.
   No invalidation was found in this pinned implementation. NativeDOM ancestry
   changes after commit/unmount, but retained refs may continue using the cached
   chain. This is an actionable hypothesis requiring an unchanged-source
   reproducer, not an executed bug claim.

## Proposed sequence and acceptance

First execute original ref/manual-dispatch contracts in an isolated opt-in
fixture and keep default flags off elsewhere. Compare listener identity by
(type, callback, capture), deduplication, removal, object handleEvent, once
before nested dispatch, mutation during dispatch, abort/re-add, passive and
cancelable behavior. Check target/currentTarget, capture/bubble order,
stopPropagation/stopImmediatePropagation, dispatch return values, same-event
reentrancy and error cleanup. Retained refs may dispatch locally after unmount,
but must not propagate through retired native ancestry. Preserve the original
parent-cache behavior as a separate control before choosing a correction.

Then connect original native dispatch and listener interest. One candidate is
a hash-guarded generated insertion in the shipped renderer's existing batched
callback, selecting the original `dispatchNativeEvent` function while keeping
RawEventEmitter delivery once. The original dispatcher also performs responder
negotiation; a lateral subscriber could duplicate callbacks or lose batching.
This candidate still requires executed positive/negative and responder/focus
regressions; it has not been adopted here.

For imperative-only pointer listeners, an initial per-runtime capability could
bypass the declarative-interest optimization while preserving original pointer
negotiation/capture. Its delivery cost must be explicit. A later subscription
bridge may restore efficient native filtering; do not claim that bridge exists.

The native acceptance must use real refs in nested/flattened trees, two roots,
listeners with **no JSX helper**, JSX plus imperative delivery exactly once,
input timestamps/priorities/coordinates, reentrant cancellation and unmount.
Flags off must retain the legacy baseline; delayed/repeated overrides must
retain original rejection. Complete TextInput/focus/Pressability/responder
regressions are required because event selection affects an entire runtime.

The shipped dispatcher constructs `LegacySyntheticEvent`, with pointer values
in `event.nativeEvent`. It is not proof of a complete W3C PointerEvent surface.
Public HostInstance types also need separate inspection before advertising
imperative methods as generally supported.

## Pinned primary sources

- [Feature flags](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/src/private/featureflags/ReactNativeFeatureFlags.js)
- [ReadOnlyNode inheritance/parent](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/src/private/webapis/dom/nodes/ReadOnlyNode.js)
- [Compiled ReactFabric renderer](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/Libraries/Renderer/implementations/ReactFabric-prod.js)
- [Original native dispatcher/responder](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/src/private/renderer/events/dispatchNativeEvent.js)
- [EventTarget listener registration](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/src/private/webapis/dom/events/EventTarget.js)
- [Parent cache and trusted error dispatch](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/src/private/webapis/dom/events/internals/EventTargetInternals.js)
- [Native pointer interest filter](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/ReactCommon/react/renderer/uimanager/PointerEventsProcessor.cpp)
- [Original private interface](https://github.com/facebook/react-native/blob/v0.87.1/packages/react-native/src/react-private-interface.js)

These findings come from the installed pin; future pins must be inspected anew.
The [preceding captured geometry receipt](../evidence/pointer-geometry/README.md)
remains separate from this unexecuted EventTarget proposal.
