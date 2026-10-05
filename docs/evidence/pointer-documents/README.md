# Native descendant input reaches the original Document

A Document-only listener previously worked through original manual dispatch but
could not qualify its descendant's native `pointerdown`. The host now verifies
the actual current root family and passes its original specialized handle to the
opt-in SDK query. Original accessors read its existing documentElement and owner
Document; their original EventTarget Maps supply interest. Component queries
continue to use existing refs. No listener mirror, ViewProps mutation, public API
or Godot engine rebuild is introduced.

[Local receipt](report.json), [hosted CI receipt](hosted-ci.json),
[isolated example](../../../examples/pointer-document/README.md)
and [source/contract analysis](../../research/native-document-pointer-interest.md).
The local execution below uses macOS arm64 Release, official Godot 4.7.2,
RN 0.87.1, React 19.2.3 and Node 22.23.3. The receipt pins 25 executed
sources/configuration inputs, 18 original RN inputs, native build identity,
per-lane report/check-ID/bundle hashes and the captures. Execution preceded the
implementation commit. All 25 executed code/configuration pins match
`00bd80454384cbfbffc1b703df0864674bf11f99` via `git show`; the original execution base
73d33da/source-dirty identity remains unchanged.

Each lane starts a fresh Hermes runtime before original ref classes initialize.
All eight SDK controls share the same corrected native host. The previous-host
control instead runs the exact current SDK bundles on the earlier native addon.

| Imperative / native dispatch | Original SDK | Current SDK | Previous host with current SDK |
| --- | --- | --- | --- |
| Off / Off | 336/336 | 336/336 | 336/336 |
| On / Off | 336/336 | 336/336 | 336/336 |
| Off / On | 338/338 | 340/340 | 279/340; 61 normative failures |
| On / On | 338/338 | 363/363 | 282/363; 81 normative failures |

The eight corrected-host lanes pass **2,723 checks**. The previous host retains
**142 failed assertions** with the same current bundle bytes, check IDs and
18 RN inputs. Of 14 producers only `native/application_runtime.cpp` differs;
separate native binary hashes are recorded. Expected negative recognition does
not make those failures green. No script error, crash or pointer-registry
inconsistency occurs in either control.

Document keeps original listener methods with native dispatch alone. View and
documentElement require both flags. The installer therefore follows native
dispatch alone while the original final-class gates remain intact. Original
interest retains native absence even where manual dispatch is positive. The
fixture never borrows a hidden prototype method. Public flags remain disabled.

The executed cases distinguish original manual untrusted at-target dispatch
from native trusted capture/bubble delivery. They check exact phases, order,
original targets/currentTarget/owner Document/listener `this`, Raw typed/star
membership and payload identity, timestamps, dispatch context restoration,
functional React counters and exactly one original renderer commit per gesture
with callbacks. Absent callbacks commit no additional state.

Capture-only Document and documentElement registrations have independent manual
positives. Their native gestures reach the exact original root handle with
`offset34=false` **before** `offset35=true`; no bubble or JSX helper registration
can qualify them. Document passes in Off/On and On/On; documentElement passes
only On/On. Its Off/On methods remain absent and both offsets remain false.
A separate A-without-listeners/B-with-Document-listeners control proves A emits
no Raw/callbacks and leaves B's React state and native counts intact. The next B
gesture provides the corresponding live positive.

Once consumption, final removal, pre/post-registration abort, rerender identity,
held-root retirement, sibling recovery, retained old objects, new remount
identities and balanced stop have executed checks. Retained old Document
listeners remain manual positives but cannot qualify replacement native input.
The sibling gesture follows retirement; this fixture does not certify a second
simultaneously held sibling contact during retirement.

The cold no-ref leaf stays `canonical.publicInstance === null` before and after
the actual installed root query, for false and positive qualification. Original
downstream dispatch may create that public ref afterward. The fixture's
`lazyHelperCalled:false` is an annotation, **not** an instrumented call counter.
Source inspection confirms the specialized accessors avoid generic lazy renderer
lookup; this does not separately prove every public-root field or lookup path.

One current/On/On `throw34` injected at the actual root query remains visible as
`E_POINTER_LISTENER_QUERY`. Only pointerdown interest is rejected; the same
batch's original trusted TouchStart/Raw/React update continues. Cancel, a healthy
next gesture and stop preserve the diagnostic and clean legitimate contact
ownership. Root nonboolean/capture faults, Off/On root faults, resolver getters,
reentrant stop/removal and arbitrary component getters are not certified here.
Component family/handle/stateNode/canonical/publicInstance reads remain outside
the native query-call catch. Complete event priority mapping is also open.

The actual macOS viewport run passes **385/385**, including **20 exact RGBA
assertions and two saves**. These 760×220 images show the first Document-only A
gesture: initial counters A=0/B=0, then capture and bubble commit A=2/B=0 in one
batch. Yellow width reflects React state; blue is the native descendant target,
teal is the independent JSX sentinel, and purple marks later rerender state.
The frames precede capture-only, isolation and fault cases; pixels alone do not
prove those later behaviors.

![Two native roots before Document-only input](initial.png)

![Document capture and bubble commit A=2 while B remains 0](updated.png)

Reproduce on the built corrected host:

```sh
npm run test:pointers:documents
node tests/pointer-document-native.test.mjs --interest=current --flag=enabled --capture
```

The test does not select an old native binary. The previous-host control was
executed with a preserved earlier addon/source/build record, restored afterward.
All injected samples use real `InputEventScreenTouch` through the native queue;
physical hardware and exported mobile input remain independent acceptance.

Regressions pass on this host: 250 Node/13 Python contracts, static analysis,
22 examples/2,250 checks, independent consumer 30 build/ownership and 40 native
checks, fresh SDK pack/verify, loader 89 checks/21 cases and 13 native adapter
runs/213 checks. Updated View interest passes 193/233; query faults pass 186;
integrated dispatch remains 181/206. Portable processor and geometry gates each
pass two tests. ABI certification remains false.

[Hosted CI](https://github.com/journey-studios/godot-fabric/actions/runs/37233393202)
completed successfully in all five jobs at **e65b7ba**. The
[artifact audit](hosted-ci.json) confirms the same eight headless lanes and
**2,723/2,723 checks**, unique IDs/digests and per-flag bundle bytes as the local
final execution. All 14 producer pins and 18 original RN inputs match; all 25
curated code/configuration pins match implementation `00bd804`, head `e65b7ba`
and actual native checkout `a1d8a980`.

Hosted traces independently confirm capture-only `34=false` before `35=true`,
the original flag gates and A-negative/B-positive isolation. Only the
current/enabled Document lane retains its one deliberate root `throw34`
diagnostic. The same CI host also passes View interest **193/233** and query
faults **186/186**, with the latter's four expected diagnostics. Probe logs have
no script error, crash or pointer-registry inconsistency. Three artifact ZIP
hashes and all lane report/check-ID hashes are recorded in the hosted receipt.

These headless artifacts include neither images nor the compiled native binary.
Their shared **declared** host hash `5feb2117…` is consistent across all eleven
reports; it is not required to equal the separately built local `df06c37…` host.
The local **385/385 and 20 pixels** and the older-host **142 normative failures**
remain separate evidence; CI did not rerun that old host control.

[Preceding fault CI](https://github.com/journey-studios/godot-fabric/actions/runs/37229423491)
passed five jobs at b88708c and audited 186 fault checks/22 pins/15 RN inputs plus
193/230 earlier interest checks; it does not certify this Document extension.
[Preceding Pages publication](https://github.com/journey-studios/godot-fabric/actions/runs/37231095632)
passed build/deploy with data 73d33da; its full public JSON and local API matched
that commit after removing only generated `publication`. The [initial publication receipt](publication.json) at
[e65b7ba](https://github.com/journey-studios/godot-fabric/actions/runs/37233421454)
passed build and deploy with the main renderer. Its full public JSON and local
API equal that committed data after removing only generated `publication`.
The later [Pages metadata publication](https://github.com/journey-studios/godot-fabric/actions/runs/37233943579)
also passed build/deploy with its full public JSON verified against the committed
data. Publication is separate from native CI: this CI receipt covers e65b7ba,
not a later documentation or dashboard commit.
The implementation is still outside main. Core iOS/Android reference jobs do not
certify Godot mobile exports or this native Document matrix.

Other pointer categories, complete responder/PanResponder/type contracts,
coalescing, null-target delivery, development renderer, performance, hardware,
mobile and public enablement remain open. The current-family guard is reviewed
but lacks a separate nested-RootNodeKind adversarial fixture. glog lifecycle
warnings may remain. GF-05/06/07/08/13 stay In progress: no new done checkpoint,
whole item, dependency acceptance, decision, weight or denominator is closed.
