# Imperative EventTarget at the RN 0.87.1 boundary

Status: source investigation and **executed original-ref probe**. The isolated
macOS arm64/headless fixture passes 119 checks and reproduces all three gaps.
[Receipt](../evidence/event-target/README.md). Native integration remains
pending; this does not enable a public capability, approve a renderer change
or certify complete experimental RN APIs.

The [current-ancestry correction](../evidence/event-target-ancestry/README.md)
now passes 102 checks in each original/corrected variant. It fixes the third
gap in shared bundling while preserving current-dispatch snapshots; production
flags remain off. Native EventTarget delivery and the dispatcher proposal remain
pending. A subsequent [executed dispatcher comparison](../evidence/event-dispatch/README.md)
runs 647 identical checks per renderer variant and corrects a separate numeric
touch-tag lookup bug in the production legacy path.

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
   chain. The unchanged-source probe now reproduces this: the warmed detached
   ref bubbles to the still-mounted former parent, while its never-dispatched
   detached sibling performs only self-dispatch. NativeDOM returns null parent
   and disconnected for both refs.
   The generated correction removes that permanent cache and resolves the
   original current-parent getter for each new path. Retired item/ancestor/root
   controls and remount confirm the fix; the original variant retains the gap.

## Proposed sequence and acceptance

The first step is executed in an isolated opt-in fixture; default flags stay
off elsewhere. It compares listener identity by
(type, callback, capture), deduplication, removal, object handleEvent, once
before nested dispatch, mutation during dispatch, abort/re-add, passive and
cancelable behavior. Check target/currentTarget, capture/bubble order,
stopPropagation/stopImmediatePropagation, dispatch return values, same-event
reentrancy and error cleanup. Retained refs may dispatch locally after unmount,
but must not propagate through retired native ancestry. Preserve the original
parent-cache behavior as a separate control before choosing a correction.
Four separate runtimes exercise the complete two-flag matrix, including
original defaults, rejected late/repeated overrides and five mounted surfaces.
The enabled runtime executes 33 manual checks in each of two roots. Public
listener failure reports once through TimerManager after dispatch returns;
peer delivery and original transient-field cleanup still complete.

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

## Dispatcher integration boundaries still requiring runtime controls

The dispatcher comparison now executes these boundaries separately from the
ancestry fixture. The enabled runtime calls the original dispatcher explicitly;
actual Godot touch input in the disabled runtime uses the compiled legacy path.
The native EventTarget queue and batching contract is still pending:

- The should-set handler calls have no protected currentTarget cleanup when a
  handler throws. `processResponderEvent` is called before `dispatchNativeEvent`'s
  normal-event try/finally. A retained original should-set error event confirms
  currentTarget is not cleared; normal touch-start delivery is aborted. Balancing
  the contact and starting a new gesture recovers. The cleanup gap remains open.
- Responder events are invoked directly; the normal native event is separately
  dispatched through `dispatchTrustedEvent`. Do not transfer the latter's
  isTrusted/phase assertions to responder events. The fixture positively checks
  original responder events as untrusted, NONE-phase and empty-path, separately
  from trusted normal capture/bubble. Nested dispatch and eight deliberate JS
  faults exercise original cleanup/recovery boundaries without native errors.
- The new `noResponderTouches` tests whether the touches array is empty. The
  compiled legacy responder tests whether remaining touches descend from the
  current responder. The executed two-branch case confirms that the experimental
  responder retains its owner after the last descendant ends while an unrelated
  contact remains. The legacy path releases the owner at that boundary.

Two further comparisons remain open: installed should-set callbacks use strict
true in the experimental responder versus truthy values in the compiled legacy
path; an installed termination callback returning undefined permits transfer in
the former and rejects it in the latter. These observations do not authorize
silently changing the pinned experimental contract.

The inside-two-contact control exposed a separate Godot integration bug: numeric
touch targets passed through the compiled renderer's instance lookup unchanged,
so its descendant walk released even an owner with a surviving inside contact.
The generated numeric-only lookup now asks the current runtime UIManager for
the original weak instance handle. Invalid, retired and removed tags return
null. The original lookup fails exactly two normative assertions; the corrected
lookup passes all 647 with identical fixtures/RN inputs/native host. Canonical
and Fiber inputs remain intact. This fix applies to the existing production
legacy path and does not enable experimental EventTarget dispatch.

The current-ancestry correction changes only parent resolution; it does not
select this dispatcher or resolve these responder differences. A target-null
native case now reproduces a TypeError for a registered event, while an
unregistered event is inert; recovery succeeds afterward. The native transport
must define how retired/null targets are rejected before selecting a runtime-wide
branch. Mixing two responder implementations within one runtime is not an
accepted fallback.

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
remains separate from this original-ref baseline, current-ancestry correction
and the still-unimplemented native EventTarget proposal.
