# Isolated Document and documentElement pointerdown interest

Status: executed local headless validation with RN 0.87.1 and Godot 4.7.2.
Eight original/current flag lanes passed 2,723 checks. The preceding native
addon reproduced 142 failed assertions on the identical current JS bundles.
The graphical current/enabled lane passed 385/385 and produced the two images
below. Hosted proof for this slice is pending. See the
[receipt](../../docs/evidence/pointer-documents/README.md) for provenance.
This isolated example keeps public imperative/native EventTarget flags off by default.

The experiment extends native interest from component refs to each surface's
original React Native Document and documentElement. A listener in an original JS
Map should be able to qualify a descendant's native pointerdown without an
empty JSX pointerdown helper. Original manual dispatch, native qualification and
trusted delivery are separate observations.

## Harness commands

From the repository root, after the existing native setup:

```sh
npm run test:pointers:documents
node tests/pointer-document-native.test.mjs --interest=current --flag=enabled --capture
```

The first command exercises the four flags with original/current interest.
The second runs only the current/enabled lane graphically. These are development
validation commands, not a required addon front door. This standalone fixture
sits outside the 22-example catalog. The
[fixture JSX](../../tests/pointer-document-fixture.jsx) uses the shared platform
plugin with experimental original native dispatch and current pointer interest.
Original interest and the preceding native addon are distinct controls.

## Scene

Two 360×220 surfaces share one Hermes application. Their origins are `(0, 0)`
and `(400, 0)` in a 760×220 viewport, with independent root objects and state.

| Color | Purpose |
| --- | --- |
| Blue leaf | Native target for Document-only/documentElement-only cases. Its path has no JSX pointerdown helper or competing component listener. An unreferenced target also exercises lazy ref observations. |
| Yellow counter | React state updated by original trusted callbacks. Headless assertions check the counter and one batched commit per gesture with callbacks; actual pixels verify the first A update. |
| Teal JSX sentinel | Independent declarative behavior, including flag-off configurations, so disabling imperative/native dispatch cannot pass by disabling the whole UI. |
| Purple revision bar | Rerender marker for identity/listener persistence checks. |

Before input, both React counters are zero:

![Actual native viewport before input, with A and B counters at zero](../../docs/evidence/pointer-documents/initial.png)

After the first Document-only gesture on A, its capture and bubble callbacks
produce `A: 2 / B: 0` in one renderer commit. Only A's yellow bar widens:

![Actual native viewport after A's Document gesture, with A at two and B at zero](../../docs/evidence/pointer-documents/updated.png)

The macOS lane passed 385/385: 363 behavioral checks, 20 asserted pixels and two
successful image saves. The real 760×220 Viewport readbacks were visually
inspected. These frames capture the first gesture, before the remaining
membership, lifecycle and fault matrix; they do not depict every tested case.

## Root lookup and flags

RN creates Document and documentElement when it creates the renderer root and
links an original specialized handle to the native root family. The native
callback verifies that **actual current family**, releases the registry lock,
then passes the handle to the SDK query. Original private helpers retrieve the
already-existing documentElement and owner Document. Their original capture and
bubble Maps supply interest; there is no second listener registry or synthetic
ViewProps registration.

| Imperative flag | Native-dispatch flag | Expected original API / opt-in query |
| --- | --- | --- |
| Off | Off | Document and elements have no listener methods; no query. |
| On | Off | Methods still absent because the original base is Object; no query. |
| Off | On | Document methods exist; element methods remain hidden. Current query installs for Document interest. |
| On | On | Document and element methods exist; current query installs for both. |

Each configuration starts in its own runtime before original ref-class imports.
The experiment preserves these original gates; it does not borrow hidden
methods, add methods or toggle flags during a gesture. Public default selection
continues to bundle the empty installer.

## Executed results

| Flag mode | Original interest | Current interest |
| --- | --- | --- |
| `disabled` | 336/336 | 336/336 |
| `imperative-only` | 336/336 | 336/336 |
| `internal-only` | 338/338 | 340/340 |
| `enabled` | 338/338 | 363/363 |

Document-only listeners qualify descendant input in current interest when native
dispatch is on, including the imperative-off configuration. Isolated
documentElement-only listeners require both original flags. Original interest
keeps the expected native absence, while manual original dispatch remains a
separate untrusted positive where the API exists. No hidden method is borrowed.

Capture-only controls contain one original capture listener and no bubble/helper
listener. Manual dispatch proves it at phase `2`, untrusted; descendant native
input delivers phase `1`, trusted. The actual root query must return false at
bubble offset `34` before capture offset `35` returns true. Document works with
native dispatch alone or both flags; element capture requires both and remains
false at both offsets when its public API is hidden.

A separate isolation case registers only B's Document listeners. Input on A
produces no Raw pointerdown or callbacks and leaves B's counter and native
contact metrics unchanged. Input on B then proves the listener is live with
current interest/native dispatch. Original interest retains native absence.

The harness injects native `InputEventScreenTouch` Down/Up/Cancel samples through
the real queue. It checks exact callback order/phases, trusted original identity,
target/currentTarget/this, original owner Document, Raw typed/star payload
identity and timestamps, dispatch cleanup and functional React state. Delivered
callbacks from one gesture produce exactly one renderer commit; absent callbacks
produce none. Expected integer phase values are converted to JSON float
representation in GDScript without rounding observed phases.

Once consumption, final removal, pre/post-registration abort and absent interest
affect the next native event through the original Maps. Rerender preserves
identities/listeners. Retirement cancels a held contact and balances native
Controls; the sibling root accepts a later gesture. Retained old Documents remain
manual positives but cannot qualify input for a remounted root with new identities.
The sentinel remains healthy in every lane, retaining the compiled legacy event
representation when native dispatch is off.

The no-ref leaf remains `canonical.publicInstance === null` **before and after
the actual root query**, including a cold positive query after remount. The
normal dispatcher may materialize it later. This observes that field directly;
the fixture's `lazyHelperCalled: false` is not independent call instrumentation
or proof of every lazy/root field.

The current/enabled lane throws once at actual root bubble offset `34`. One
explicit query diagnostic remains recorded; same-batch trusted TouchStart,
Raw delivery and its React update continue. The pressed contact remains active
until Cancel, and the next healthy gesture works. Resolver-getter throws and
other root fault combinations have not been certified.

## Preceding native-host control

With the same current-interest JS bundles and all 18 RN source pins, the older
`5f424c7…` addon passes `disabled` and `imperative-only` (336 each), but fails
61/340 assertions in `internal-only` and 81/363 in `enabled`. The corrected
`df06c37…` addon passes all four. Of 14 producer pins, only
`native/application_runtime.cpp` changes. The 142 failed assertions are retained
as normative failures; neither host crashed or produced a script error.

This demonstrates the missing Godot native root-routing path for this fixture.
It is not a claim about all React Native platforms. Physical hardware, hosted
and mobile proof for the new slice, other pointer categories, performance,
development renderer behavior and public enablement remain pending. Existing
component-path getters remain outside the query catch. Simultaneously held
sibling-contact retirement/fault cases and broader lazy-field instrumentation
are also outside these observations. See the
[design and acceptance boundaries](../../docs/research/native-document-pointer-interest.md).
