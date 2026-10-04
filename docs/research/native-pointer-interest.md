# Native interest from original pointerdown listener storage

Status: executed isolated native validation on official Godot 4.7.2, macOS arm64
and pinned RN 0.87.1. The [pointer-interest receipt](../evidence/pointer-interest/README.md)
records 193 original / 230 current headless checks and 260 current graphical
checks, with 28 pixel assertions and two 820×280 captures. Public imperative/native
EventTarget flags remain off. This slice targets `View`-path `pointerdown` interest.

## Why dispatcher selection is insufficient

The [EventTarget integration](event-target-boundary.md) separates dispatcher
selection from native emission. Calling the original dispatcher in the existing
React batch can deliver imperative listeners only after the native event reaches
that callback. The selected original C++ `PointerEventsProcessor` filters
`topPointerDown` by `ViewProps.events` on the target and its View ancestors.
Original `addEventListener("pointerdown", ...)` updates JS storage without setting
those declarative props. An empty JSX `onPointerDown` helper would make the filter
pass and conceal the imperative-only gap.

This observation applies to this host and pinned source path. Android and iOS
have their own emission, flags and dispatch integration; it is not evidence of a
universal mobile RN bug. Their corresponding behavior still needs reference
execution.

## One source of listener state

The generated [query overlay](../../sdk/toolchain/rn-pointer-interest-overlay.mjs)
appends `hasPointerDownListenerForGodot(target, capture)` to original
`src/private/webapis/dom/events/EventTarget.js`. It requires the complete
RN 0.87.1 source SHA-256
`9ef4ad5d04667a3e786de5008f3a3da76920215b16b6605549db4f3b206b0e53`
and exactly one original `getListenersForPhase` implementation. Original source,
class methods and downloaded inputs remain unchanged.

The query reads the original phase-specific `Map`, then the exact
`"pointerdown"` registration map. Any registration with `removed === false`
provides interest. Capture and bubble storage are queried separately. It does
not inspect or invoke callbacks, object `handleEvent`, options or abort signals;
it does not dispatch, cache interest or mutate storage.

There is no second listener registry and no mutation of `ViewProps.events`.
Original listener identity, deduplication, once removal before invocation,
abort/removal and re-add behavior continue to belong to RN's implementation.
The next interest check sees those changes through the same maps. No wrapper
around `addEventListener`, `removeEventListener` or a user callback implements a
parallel version of those rules. The native fixture now confirms once removal
before the callback, immediate peer/final removal, abort and subsequent-event
membership using the original maps.

The host callback resolves a current ShadowNode family and its original public
ref, checks the live owning surface, and asks the installed query for the pinned
pointerdown capture/bubble offsets. This adds an imperative-interest result to
the original View-path check. The original processor remains responsible for
path traversal, pointer negotiation, capture, event construction and emission.
The query itself never substitutes for the dispatcher.

## Selection and packaging

The [shared platform plugin](../../sdk/toolchain/platform-plugin.mjs) owns both
the original module transform and the exact SDK
[`pointer-listener-query.js`](../../src/pointer-listener-query.js) seam.

| Selection | Listener query | Dispatcher and flags |
| --- | --- | --- |
| Public default | `pointerInterestMode: "original"`; helper is empty and original EventTarget bytes are preserved. | Existing default renderer selection; public flags remain off. |
| Native comparison: `original` | No interest query is installed. | Experimental original dispatcher and original flags enabled before ref imports, matching the `current` comparison. |
| Native comparison: `current` | Append the pinned query and generate the installer for the exact SDK helper. | Requires `nativeDispatchMode: "experimental"`; installation additionally requires both original flags enabled. |

Unknown modes fail before SDK resolution. A current-interest/original-dispatch
combination is rejected, avoiding emission into a dispatcher that does not
deliver imperative listeners. Dispatcher selection is established at runtime
initialization; this experiment does not toggle pipelines during a gesture.

The executed [toolchain guards](../../tests/rn-pointer-interest-overlay.test.mjs)
include real esbuild bundles. Default helper bundling contains neither the RN
query nor the native installer. In a relocated SDK copy, the current helper
directly imports exact SDK EventTarget and feature-flag modules; neighboring fake
RN files cannot steal those imports. Ordinary project dependencies and a project
module with the same helper filename retain project ownership. These guards
prove source adaptation and packaging, not native pointer delivery.

## Executed native acceptance

The [isolated example](../../examples/pointer-interest/README.md) uses original
refs and listener methods with paired `original`/`current` interest selections.
The executed variants share native host, authored JSX, pinned RN inputs,
dispatcher selection and original flags. Godot ScreenTouch down/up/cancel enters
through `Input.parse_input_event` and the real native queue. No ScreenDrag is
injected by this fixture; manual dispatch positives are recorded separately.

| Executed lane | Checks | Result |
| --- | ---: | --- |
| Original interest, headless | 193 | Passed; no imperative-only native pointerdown, with manual listener positives. |
| Current interest, headless | 230 | Passed; View capture/bubble interest reaches the original dispatcher. |
| Current interest, macOS viewport | 260 | Passed; includes 28 pixel assertions and two saved frames. |

The graphical lane adds 28 pixel and two image-save checks to current headless
acceptance. Current mode also executes query-specific membership assertions;
the variants do not have identical complete check-ID lists. The original control
passes its expected absence assertions rather than being a failing binary control.

Executed acceptance includes an imperative-only View path without JSX helpers; capture,
bubble and both phases; wrong event type and absent/removed listeners as native
negatives; once, duplicate registration, pre/post registration abort and removal
during dispatch; current interest after a React rerender; flattened View ancestry;
mixed JSX/imperative delivery without duplicates; replacement and retained-ref
lifetime; and separate surfaces. RawEventEmitter identity/order, original trusted
normal-event fields, transient-field cleanup and functional React updates are
checked together. A document-only listener has a separate untrusted manual
positive and zero native callbacks/Raw pointerdown in both variants, despite real
native input and a live original registration.

App stop removes the installed query and leaves roots, queued work, timers,
animation frames, root retirements and pointer routes empty in the recorded
status. This is not a test that calls the query after stop and obtains false.
The [receipt](../evidence/pointer-interest/README.md) owns source/native digests,
lane reports and the actual captures; those local results do not certify hosted
CI or a public capability release.

## Remaining boundaries

- Document-only and documentElement-only interest are still native gaps. Their
  original JS maps may contain live listeners, but this View-only native query
  does not visit those objects to qualify emission. A View that already qualifies
  can still provide an event for the original JS dispatch path; that does not
  prove document-only interest. The executed document-only manual-positive/native-
  zero case preserves that gap; documentElement-only acceptance is still pending.
- Pointer move/up, enter/leave/over/out, click and the rest of the pointer surface
  retain their preceding filtering behavior. A pointerup registration is a
  negative for pointerdown interest; this slice does not fix pointerup delivery.
- The pinned dispatcher exposes pointer fields through `event.nativeEvent` on
  original `LegacySyntheticEvent`. This is not a complete W3C PointerEvent claim.
- Native cleanup after an arbitrary injected query callback throws or returns an
  invalid value is not certified here. Source guards for the pure query do not
  replace that fault-injection acceptance.
- Physical mouse/touch hardware, Android/iOS runtime equivalence, the full flag
  matrix, public enablement, performance and broad responder/focus/Pressability regression
  acceptance remain separate work. A desktop injected-input proof must not be
  promoted to those claims.
