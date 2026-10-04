# Native pointerdown interest on original document roots

Status: isolated local headless validation executed with pinned RN 0.87.1 and
Godot 4.7.2. Eight original/current flag lanes passed 2,723 checks. A preceding
native-host control reproduced 142 failed assertions with the same JS bundles;
the corrected host passed their complete acceptance. The macOS graphical
current/enabled lane passed 385/385 with two actual captures. Hosted proof for
this slice is pending. The
[execution receipt](../evidence/pointer-documents/README.md) records the source,
binary and image provenance. Public imperative/native EventTarget flags remain off.

The preceding [View-path query](native-pointer-interest.md) reads RN's original
listener Maps, but its component-ref resolver cannot resolve the surface root's
specialized handle. Consequently, a Document-only listener can be a real manual
dispatch positive while native pointerdown is filtered. This extension adds the
original Document and documentElement to interest qualification; it does not
replace event construction, capture negotiation, the dispatcher or React batching.

## Resolve the actual root, without creating a ref

In the pinned original RN sources, `ReactFabric-prod` creates a Document when it
creates a root. `ReactNativeDocument` immediately creates its documentElement
and links that element's specialized instance handle to the native root through
`NativeDOM.linkRootNode`. Those are original RN ownership rules; the Godot
adaptation supplies the native qualification path that can use these existing
objects.

The [native callback](../../native/application_runtime.cpp) checks the active
application and live owning surface, obtains the newest clone, and compares its
family with the actual root in the current ShadowTree revision. `RootNodeKind`
is only a preliminary filter: nested nodes can carry that trait. Only the real
root family receives the specialized-handle branch. The registry visit ends
before the callback enters JS; a root tag or an old retained object alone does
not grant native authority.

The internal callback becomes `query(candidate, offset, isRootHandle)`. Components
continue to pass their existing public ref. The real root passes its original
opaque handle. In the [shared SDK helper](../../sdk/toolchain/platform-plugin.mjs),
original `getPublicInstanceFromReactNativeDocumentElementInstanceHandle` reads
the existing documentElement; original `getOwnerDocument` reads its owner slot.
The query then inspects those two original EventTarget Maps for `pointerdown`
at bubble offset `34` or capture offset `35`.

The query does not call generic renderer public-instance lookup, construct a
Document or ref, allocate listener storage, dispatch listeners, mutate ViewProps
or maintain another registry. Original once, abort, deduplication and removal
continue to govern the same registrations. Missing objects/listeners return false.

The local no-ref control observes a real unreferenced component's existing
`canonical.publicInstance === null` before and after the actual installed query.
It checks both false qualification and a positive Document query on a freshly
remounted cold root. The observer reads the existing Fiber/canonical fields;
the root candidate must be the exact original bound handle. Normal dispatcher
delivery may then legitimately materialize the target's public ref. A snapshot
only after delivery would not distinguish these stages.

This proves preservation of the observed leaf's null field during those queries.
The fixture's `lazyHelperCalled: false` is a declared observer property, not an
independent runtime invocation counter. It does not separately certify every
public-instance field, `publicRootInstance` preservation, or all possible lookup
paths. Source inspection supplies the narrower structural fact that the SDK
root query uses specialized existing-object helpers rather than generic lazy
renderer lookup.

## Preserve the original flag matrix

`ReadOnlyNode` chooses its base class when its module evaluates. With native
dispatch off it inherits Object; enabling imperative events alone cannot add the
API. With native dispatch on it inherits EventTarget. RN then hides the public
methods on final View/documentElement/Text classes when imperative events are
off. Document has no corresponding final-class gate.

| Imperative events | Native dispatch | Document methods | View/documentElement methods | Experimental current query |
| --- | --- | --- | --- | --- |
| Off | Off | Absent | Absent | Not installed. |
| On | Off | Absent | Absent | Not installed. |
| Off | On | Present | Hidden | Installed; Document can provide original-map interest. |
| On | On | Present | Present | Installed; Document and documentElement can provide interest. |

The opt-in installer now follows the native-dispatch flag alone. This preserves
the original Document API in the Off/On combination instead of requiring an
imperative flag that Document does not use. It does not expose hidden methods
on other classes. `pointerInterestMode: "current"` still requires the experimental
original dispatcher in the shared toolchain; public defaults retain the empty
helper, original interest selection and disabled flags. Flags and dispatcher
selection are fixed before imports/input, with separate runtimes for the four
configurations. Toggling during a gesture is outside the contract.

## Executed original/current acceptance

Each lane starts its own runtime with immutable flags before importing the
original ref classes. Two actual Godot surfaces then share one Hermes application.
The injected `InputEventScreenTouch` Down/Up/Cancel samples traverse the real
native queue. This is native execution, without a physical input-device claim.

| Flags: imperative / native dispatch | Mode name | Original interest | Current interest |
| --- | --- | --- | --- |
| Off / Off | `disabled` | 336/336 | 336/336 |
| On / Off | `imperative-only` | 336/336 | 336/336 |
| Off / On | `internal-only` | 338/338 | 340/340 |
| On / On | `enabled` | 338/338 | 363/363 |

The original-interest control preserves the expected lack of native
Document/documentElement qualification even when manual dispatch works. Current
interest delivers native Document-only capture/bubble callbacks when native
dispatch is on, and isolated documentElement-only callbacks when both flags are
on. These target paths have no JSX pointerdown helper or component imperative
listener. Manual originals remain untrusted at-target positives; native delivery
uses original trusted events, original root/target identities and the expected
capture/bubble path.

Independent capture-only cases prevent a bubble listener from masking the
capture-interest path. The same original listener first succeeds in untrusted
manual dispatch at phase `2`; descendant native input then delivers a trusted
phase `1` event. Actual root-query observations require offset `34` to return
false before offset `35` qualifies the event. Document capture works with native
dispatch alone and with both flags; element capture requires both. With the
imperative flag off, the element case remains hidden and both offsets return
false. Original interest preserves native absence.

Another control registers only B's Document listeners. An A sample produces
neither Raw pointerdown nor callbacks and leaves B's state and native contact
metrics unchanged. The following B sample is a real positive with current
interest/native dispatch, while original interest remains negative. This proves
qualification is scoped to the owning root rather than the existence of a
listener elsewhere in the application.

The fixture checks exact callback order and phases, `target`, `currentTarget`,
listener `this`, owner Document, Raw typed/star membership and payload identity,
timestamps, priority/global-event restoration, functional state updates, and one
renderer commit for a gesture with delivered callbacks. Empty callback cases
must produce no additional commit. The GDScript comparison converts expected
integer phases to JSON's float representation; it does not round observed
values. The Node receipt also compares the exact phase values.

Executed membership cases cover `once` consumption, final removal, already-aborted
and later-aborted signals, plus absent interest. Rerender preserves root/ref
identity and listeners. Retirement cancels a held contact, disconnects retained
Document/element objects, clears the renderer root lookup, and balances native
Controls. The sibling root accepts a subsequent healthy gesture. Remount creates
new original identities; retained old listeners remain a manual positive while
providing no native interest to the replacement root. This is not proof of a
second simultaneously held contact surviving retirement.

A real declarative JSX sentinel works in all eight lanes. With native dispatch
off its events retain the compiled legacy representation; the test does not
mislabel them as original trusted EventTarget events or invent DOM phases.
Late flag override is rejected after the original classes have initialized.
Terminal/stop checks cover pointer/touch/route ownership, root removal, query
uninstallation and pending timers/frames/work.

## Actual graphical result

The focused command avoids running every flag lane graphically:

```sh
node tests/pointer-document-native.test.mjs --interest=current --flag=enabled --capture
```

It passed the 363 current/enabled assertions plus 20 asserted pixels and two
successful saves, totaling 385/385. The real 760×220 Viewport captures show
`A: 0 / B: 0` before input and `A: 2 / B: 0` after the first Document-only A
gesture. Capture and bubble callbacks contribute two functional updates in one
renderer commit; only A's yellow counter widens. Both images were visually
inspected, and their tested pixels agree with the receipt. The
[example](../../examples/pointer-document/README.md#scene) embeds the actual
[initial](../evidence/pointer-documents/initial.png) and
[updated](../evidence/pointer-documents/updated.png) images. They illustrate this
first gesture, not every later lifecycle or fault case.

## Native-host causal control

The new current-interest bundles also ran against the preceding `5f424c7…`
native addon and the corrected `df06c37…` addon:

| Mode | Preceding host | Corrected host |
| --- | --- | --- |
| `disabled` | 336/336 | 336/336 |
| `imperative-only` | 336/336 | 336/336 |
| `internal-only` | 279/340; 61 failed | 340/340 |
| `enabled` | 282/363; 81 failed | 363/363 |

The 142 failed normative assertions remain failures, not an additional green
suite. Both hosts used identical JS bundles and all 18 pinned RN inputs; of 14
producer source pins only `native/application_runtime.cpp` differed. The
preceding host lacked the actual-root candidate/discriminator path. Its missing
callbacks, Raw delivery, commits, lazy-root observations and root-fault execution
were reported without script errors or a crash. This comparison establishes
the missing native adaptation for this fixture; it does not establish a universal
React Native platform defect or mobile behavior.

## Error and capability boundaries

The current/enabled lane injects one deliberate throw at bubble offset `34`
for the actual A root handle through the one real SDK installation. It confirms
exact matching and consumption, one retained `E_POINTER_LISTENER_QUERY`
diagnostic, suppression of only pointerdown, and continued original trusted
same-batch TouchStart/Raw delivery with its React update. The legitimate pressed
contact remains active until Cancel; the next healthy gesture works and the
diagnostic remains visible through stop.

Specialized root resolution runs inside the installed JS query call and thus
inside that native catch. The executed throw is a root-query fault, not a throw
from a specialized resolver getter. Root nonboolean returns, capture-offset
faults, resolver-getter faults, reentrant stop/removal, and a simultaneous sibling
contact during a root fault remain uncertified by this matrix. Test wrappers
must forward `isRootHandle`; dropping it loses the root branch. Existing C++
component-path reads of `stateNode`, `canonical` and `publicInstance` remain
outside the catch. The preceding
[query-fault proof](pointer-query-faults.md) is separate evidence with its own scope.

This scope is pointerdown interest. Peer-removal/wrong-type cases specific to
root Maps, broader lazy-field instrumentation, other pointer categories, the
full event surface, physical hardware, Android/iOS runtime equivalence,
performance, development renderer behavior and public capability enablement
remain separate acceptance. The actual-root family guard is source-reviewed;
an adversarial nested `RootNodeKind` fixture is still absent. Restored priority
context does not certify the complete priority mapping. Earlier query-only or
query-fault CI receipts and dashboard publication do not certify this new local
root/flag extension; its hosted CI remains pending. The
[isolated example](../../examples/pointer-document/README.md) describes the scene
and reproduction commands.
