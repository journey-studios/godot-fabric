# Imperative EventTarget at the RN 0.87.1 boundary

Status: executed historical controls and an isolated native renderer integration
experiment. Public capability remains off; this does not certify complete
experimental RN APIs. The earlier macOS arm64/headless original-ref fixture
passes 119 checks and reproduces three independent gaps.
[Original-ref receipt](../evidence/event-target/README.md).

The [current-ancestry correction](../evidence/event-target-ancestry/README.md)
now passes 102 checks in each original/corrected variant. It fixes the third
gap in shared bundling while preserving current-dispatch snapshots; production
flags remain off. A subsequent
[executed dispatcher comparison](../evidence/event-dispatch/README.md)
runs 647 identical checks per renderer variant and corrects a separate numeric
touch-tag lookup bug in the production legacy path.

Those controls precede the new
[isolated native example](../../examples/event-target/README.md). Its basic and
adversarial runs exercise injected Godot input through the real event queue and
the original batched renderer callback. Final counts, digests, captures and
terminal-registry retirement acceptance require the separate integration
receipt; the historical receipts do not certify this newer path.

## Three separately validated boundaries

1. `enableImperativeEvents` and `enableNativeEventTargetEventDispatching` both
   default false. ReadOnlyNode chooses its EventTarget base while the module is
   evaluated; overrides must precede ref imports. The pinned ReactFabric-prod
   `dispatchEvent` still emits RawEventEmitter and uses the legacy plugin
   extraction path, with no call to the shipped `dispatchNativeEvent` function.
   The Godot private interface now exposes the original dispatcher, and the
   shared platform toolchain has a hash-guarded experimental selection inside
   that batch. The probe opts in; the default selection remains legacy.
   Exposing ref methods alone still cannot establish native listener delivery.
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

Native dispatch and listener interest remain separate steps. The isolated
integration now uses a hash-guarded generated insertion in the shipped renderer's
existing batched callback. It captures the original flag during renderer
initialization, calls original `dispatchNativeEvent` after both RawEventEmitter
channels, and returns before legacy plugins. Selection is exclusive for the
runtime: there is no legacy fallback on null target or listener error and no
pipeline toggle during a gesture. The public default does not emit this selection.
The original dispatcher also performs responder negotiation; a lateral subscriber
would duplicate callbacks or bypass the original batch. Broad responder/focus
regressions and public enablement still require their own acceptance.

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

## Historical explicit-dispatch controls

The dispatcher comparison now executes these boundaries separately from the
ancestry fixture. The enabled runtime calls the original dispatcher explicitly;
actual Godot touch input in the disabled runtime uses the compiled legacy path.
This 647-check comparison does not exercise native EventTarget queue selection
or its React batch:

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
select this dispatcher or resolve these responder differences. Explicit original
dispatcher calls with a null target reproduce a TypeError for a registered event,
while an unregistered event is inert; recovery succeeds afterward. These are JS
controls, not actual null-target native transport. The isolated native selection
does not certify that boundary or introduce a fallback to a second responder.

## Isolated native renderer selection

The new fixture compares two separately bundled selections with the same original
flags enabled before ref imports. Its `original` selection retains the compiled
legacy plugin path; `integrated` opts into the shared toolchain's experimental
branch. Both receive injected ScreenTouch/ScreenDrag through native Fabric event
emission and the renderer callback. They do not call the dispatcher manually to
simulate that integrated delivery. Explicit manual positives remain separate
controls proving that the installed listeners are valid.

The blue target has no JSX touch listener on its path. Its native imperative
delivery distinguishes renderer selection without a helper masking the result.
The orange imperative-only pointer target remains a native negative in both
selections: the unchanged pointer filter still reads declarative ViewProps.
Native touches are emitted without that pointer-interest filter, so a touch
positive cannot be generalized to pointers or arbitrary native event types.

The purple target combines real JSX handlers with imperative listeners on current
logical ancestry, including a genuinely flattened ancestor. The probe compares
the exact capture/bubble sequence, shared payload identity, one typed and one
star Raw emission, original timestamps, trusted event fields and restored global
event state. Two functional updates from one native touch-start commit after
the callbacks, and the white counter's native width follows the React state.
The observed native priority in this fixture is the original default priority;
these controls do not certify all event categories or scheduling mappings.

Adversarial native-path runs exercise cancellation and two contacts inside one
responder, normal listener faults, combined responder/normal faults with exact
host error delivery, and a recovery gesture. A real React commit removes the pink
touched target, checks cancellation and retained-ref ancestry, then rejects a
late physical up. Held-root teardown checks native responder release and React
cleanup while a second root survives. Queued terminal delivery during reentrant
leaf/root retirement has a separate previous-host/corrected-host acceptance
control; writing that control or seeing clean JS callbacks does not establish
that a native crash or registry-order bug is fixed.

Native touch arrays are root-local in this host. The cross-root sequence keeps
that transport separate from explicit original dispatcher oracles constructed
with root-local or global contact arrays. The global oracle's retained responder
is not proof that native Godot input aggregates contacts globally or matches
mobile behavior. Registered null-target delivery is also not executed through
this native integration fixture.

These are isolated validation runs with injected input, not physical touchscreen
or mobile certification. The four original responder differences remain open,
and complete TextInput/focus/Pressability, dev renderer, reentrant lifetime,
performance and public capability acceptance remain separate gates. The
[example](../../examples/event-target/README.md) maps the visual cases; its final
integration receipt must supply the execution counts, source/native digests and
verified capture evidence before those results are promoted to roadmap status.

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
and the isolated native EventTarget integration experiment.
