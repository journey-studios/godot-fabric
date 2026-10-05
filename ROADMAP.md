# Godot Fabric roadmap to 1.0

**Goal:** a usable Godot platform for the current stable React Native contract,
with original React/Fabric/Hermes/Yoga, a public typed SDK, native extension
support and exported applications on **macOS, Linux, Windows, Android and iOS**.
No Godot fork or rebuilt engine/export templates are part of this plan.

This is the canonical live work-status document. Baseline audit:
**2026-10-01, RN 0.87.1 / React 19.2.3 / Hermes 250829098.0.17 / Godot 4.7.2**.
See [current capabilities and gaps](docs/PARITY.md), the
[97-name API inventory](docs/compatibility/react-native-0.87.1.json) and
[retained runtime evidence](docs/evidence/README.md).

The [migration dashboard](dashboard/README.md) reads
[migration.json](dashboard/migration.json). Update its checkpoints, evidence,
remaining work, focus and history with every verified implementation slice.
The required item acceptance below remains authoritative; the dashboard
calculates checkpoint progress and does not replace full contract certification.
After committing and pushing the JSON, an implementation branch can publish
through `gh workflow run dashboard-pages.yml --ref main -f data_ref="BRANCH"`.
Confirm that exact workflow's successful deployment before reporting a public
update. The renderer comes from `main`; the published data identifies its branch
and resolved commit. Automatic deployment from `main` also remains enabled.

## Current position

The public repository, MIT license, pinned source dependencies, standalone
macOS prototype, generic fixtures, captures and contract CI are delivered.
Original reconciliation, Fabric commits, Yoga layout and several host subsets
already run. This foundation is **experimental 0.1**, not full RN parity.

GF-01 and GF-02 are **In progress**: [PR #4](https://github.com/journey-studios/godot-fabric/pull/4)
delivered the root API inventory, nine shared native reference cases, differential
CI and a cold-start containment. The GF-02 follow-up pins the tested engine,
validates it before native setup and covers failed-start cleanup. The crash was
narrowed to native-class discovery and the editor documentation shutdown path;
the upstream correction and full contract inventory remain open. See the [baseline](docs/compatibility/BASELINE.md)
and [cold-start evidence](docs/evidence/cold-start.md). GF-03/GF-04 and the
bounded public editing/widget slices of GF-12/GF-17 are now In progress.
The [typed public form](examples/form/README.md) delivers a single-line
TextInput/Button slice and explicit prop failures. Types cover bounded
View/Text/control imports and the registration/RootTagContext subset; complete facade types, mobile editing, other widgets
and differential certification remain open.

GF-05 is **In progress**: upstream TimerManager, portable RN microtask/immediate
modules, a public runtime example and four additional shared oracle cases are
implemented. [Runtime evidence](docs/evidence/runtime/README.md) records native
checks/captures and the remaining bootstrap, idle/error/global and starvation
gaps. The later DeviceInfo checkpoint starts GF-09; it does not complete GF-05.

The [runnable examples](examples/README.md) expose existing fixtures in a shared
project; they are a prerequisite for GF-28, not the independent packaged consumer
SDK required by that item. Each table row owns its status. Verification requires
its acceptance result, not an export stub, merged PR or unrelated green CI.

GF-07 is **In progress**: an explicit `FabricApplication` owns one Hermes,
UIManager, scheduler and timer queue. The [shared example](examples/shared/README.md)
registers HUD/Inventory through the original AppRegistry and validates root props,
independent state/input/constraints, module stores, unmount/remount and live
application scheduling with no mounted roots. This is the bounded 2A prototype:
full bootstrap, pause/resume, overlays/portals, reference comparison and the
complete SDK activation are still open. D19–D32 remain pending.
The [shared-root evidence](docs/evidence/shared-roots/README.md) retains local
positive/negative checks, real captures and the 12-example regression matrix.

The bounded [2B consumer/addon prototype](consumers/minimal/README.md) now runs
separate project TSX through resource-based entry configuration, a scene owner,
provisioned private tools and the editor build hook. A fresh external consumer
passes offline/no-global-Node builds, dependency/React-identity checks, visible
build rejection/recovery and two-root native assertions with real captures.
[Evidence](docs/evidence/consumer/README.md) records the exact scope.
GF-28/GF-29 remain In progress; complete installation/update, export,
diagnostics, development and per-target acceptance remain open. D19–D29 are
still pending. The later [game-services checkpoint](docs/evidence/game-services/README.md)
extends this same consumer with typed Godot calls, initial-state revision races,
ordered signals and connection cleanup. Sequence 3 remains In progress for
complete geometry, activation/restart and integrated milestone coverage below.

Priority meanings: **P0** blocks dependable development or the architecture;
**P1** is required to complete the 1.0 contract; **P2** extends the explicit
release scope. P0 describes urgency, not the full release checklist. Module
owners below are implementation boundaries, not assigned people.

The [native foundation checkpoint](docs/evidence/native-foundation/README.md)
starts GF-08/GF-09/GF-25: original RN public refs and NativeDOM use the Fabric
tree; generated DeviceInfo/SourceCode bootstrap and original JSI TurboModules
cover bounded measurements, subscriptions, promises/events and lifetime.
The [metrics example](examples/metrics/README.md) tests real resize, uniform
content density, reads without subscribers and Yoga rounding. These items
remain In progress for their full rows below. The
[services example](examples/services/README.md) now combines typed operations,
signals, consistent snapshots and Zustand across HUD/inventory. Pause,
hide/unmount/remount, accepted jobs, cancellation and terminal stop have bounded
native evidence. Full DTO string-domain parity, codegen, cross-thread execution
and restart/activation contracts remain open; D19–D32 are still pending.

GF-31/GF-35 now include the [iOS export/runtime checkpoint](docs/IOS_BUILD.md):
three native builds, two XCFramework combinations, unsigned arm64 device
export/link and 22 runtime checks in an x86_64/Rosetta iOS 18.4 consumer. Arm64
simulator execution is blocked by missing arm64 code in the official template;
physical-device, Debug, input/IME/AT and system-service certification remain
required. A reproduced engine-only mouse error is explicitly recorded. These
results are independent of the original RN reference-app CI and do not close
the iOS port or the other target foundations.

GF-26 is **In progress**: the standalone [Codegen experiment](docs/CODEGEN.md)
uses the original pinned parser/generators for a TurboModule and Fabric Badge
spec, producing common C++ and ViewConfig artifacts with reproducible checks.
The isolated compilation witness instantiates the generated descriptor and a
typed Promise/event TurboModule against the existing macOS arm64 Release build.
The [executed evidence](docs/evidence/codegen/README.md) retains 20 Node tests,
six compiled translation units and explicit generation/runtime distinctions.
The first hosted Codegen attempt failed on its assumed private Node path before
compilation. Explicit CI Node selection now has three tests and a fresh local
six-unit witness. The corrected [hosted run](https://github.com/journey-studios/godot-fabric/actions/runs/37145700599)
passed all five jobs at `5d46bba`, including the six-unit Codegen compilation.
Its [artifact evidence](docs/evidence/codegen/hosted-ci.json) records the actual
CI Node 22.23.2 separately from declared addon Node 22.23.3.
It rejects unsupported schema, collisions and stale inputs/artifacts. This
first slice does not register a native provider or draw the Badge. The next
slice must expose external factories/adapters safely, remove the fixed native
component assumptions, integrate specs before bundling and prove a consumer's
props/events/commands, defaults, stale refs and cleanup without core edits.

The next verified GF-26 foundation now provides a
[shared native SDK and registration SPI](docs/NATIVE_EXTENSIONS.md): 22 preflight
tests, 14 SDK receipt/packaging tests and an independent relocated C++ client
with 11 cases / 207 registry checks. Original generated descriptors link to the
shared host; rollback/reentrant cleanup, lazy selection/installation and terminal
lookup/disposal are exercised. [Evidence](docs/evidence/native-sdk/README.md)
retains consumed-source/binary hashes and separate package/link/registry claims.
Actual Godot cold start, runtime/roots/modules/services, 15 existing examples
(605 checks) and the independent consumer (18 tooling + 40 native checks) pass
against the rebuilt host. The [hosted SDK run](https://github.com/journey-studios/godot-fabric/actions/runs/37147754831) passed all five jobs
at `7a67f96`, with the original artifact confirming the same 207 registry checks.
Actual CI tooling/native source hashes are [retained separately](docs/evidence/native-sdk/hosted-ci.json).
A further [executed external-adapter slice](docs/evidence/native-adapters/README.md)
now passes 21 loader cases / 89 checks, and an independent original-Codegen
Badge/Probe consumer passes 35 headless / 37 graphical checks. Its JSX uses the
original registry, generated Props/emitter/Commands/CxxSpec and a shared native
host. Two roots exercise reorder, defaults, current/stale callbacks, remount,
Promise/emitter delivery and extracted-method shutdown. Captures document real
Godot rendering. Core regressions and the 207-check registry client pass.
Complete schema/name/reflection coverage, external containers/native state,
long-lived asynchronous work, full RN differential parity and all-target
export/ABI acceptance remain open; GF-26/GF-28/GF-31 stay **In progress**.
A traditional-consumer replay passed 18 tooling / 40 native checks after an
isolated recovery fingerprint mismatch; the unchanged assertion now retains
baseline/recovered bundles for investigation. That failure is historical; the
executed fix is described below.
An additional [native shutdown slice](docs/evidence/adapter-shutdown/README.md)
reproduced Control deletion inside a Godot signal during a Fabric commit. Stop
now retires authority immediately and delays destruction until execution returns;
resize/RAF/timer fixtures passed **8/9/9 checks**, and the external consumer
passed **35 headless/37 graphical** again on the rebuilt host. Native suites
passed **2/4/2/2** serially. Independent root destruction was not covered in
that slice; the executed follow-up below adds that coverage. Long-lived async
work remains open. Hosted run **37151683147** passed loader
**89** and registry **207** but reproduced the consumer recovery fingerprint
failure; its external runtime lane did not run. The subsequent
[shutdown CI](docs/evidence/adapter-shutdown/hosted-ci.json) at
`9317b46` passed all five jobs, with **35 headless** and **8/9/9 shutdown**
checks confirmed in its artifact; it predates the new builder correction. No
GF acceptance, dependency or denominator is closed by this slice.
Hosted evidence remains separate from graphical local execution and complete
RN/all-target acceptance.

An [explicit project-TSConfig slice](docs/evidence/bundle-determinism/README.md)
now fixes a reproduced import/alias ordering race in esbuild. Eighteen diagnostic
processes kept the same 154 physical/transformed inputs: inferred configuration
produced two bundle hashes, explicit configuration one. Five causal Node tests
cover both orders, strict:false, JSX and inherited settings. The actual consumer
passed **18 tooling/40 native** checks with exact recovery hashes preserved;
selected-adapter runtime passed **35/37** and shutdown **8/9/9** again. Six more
builds kept the same bundle/selection bytes and all 154 inputs. Current local
contracts passed **126 Node/13 Python**. Its
[hosted run](https://github.com/journey-studios/godot-fabric/actions/runs/37154927839)
at `9c75031` subsequently passed all five jobs; it predates the resolution
implementation below. The [resolution probes](docs/evidence/bundle-determinism/resolution-gaps.json)
remain discovery evidence for that next slice.

The [GF-03 project-resolution slice](docs/evidence/project-resolution/README.md)
now executes inherited local `paths` aliases and declared dependencies installed
inside their importing libraries through the normal addon/editor. The fresh
consumer passed **27 tooling/40 native/43 graphical** checks; its alias variant
passed **40/43**, and the nested-dependency variant **40**. SDK React identity,
lockfile ownership and exact-byte recovery remain verified. Relative imports
cannot bypass package declarations; ordinary project files with RN-like names
retain their own implementations. Unsupported suffix orders/type spoofing,
escaping aliases fail explicitly. At `dde5485`, app aliases colliding with
package/private SDK imports were also rejected; the follow-up below removes
that bounded restriction. Config/manifest snapshots reject changing or stale declarations
before publication. Original Codegen adapter runtime passed **35/37** and
shutdown **8/9/9** on the same native SDK.
Local gates also passed **172 Node/13 Python**, **10 native tests** and the
**15 headless examples/605 checks**. Complete types, assets, exports/package
conditions, arbitrary resolution/transform settings, all-target SDK/export
acceptance and D20 remain open. No GF or denominator closes with this slice;
its newer hosted acceptance is tracked separately from the preceding green run.

The [scoped-alias follow-up](docs/evidence/alias-scopes/README.md) now preserves
application, nested-library and SDK ownership in both original TypeScript
checking and runtime resolution. The actual addon/editor consumer passed
**30 tooling/40 native/43 graphical** checks; its colliding-name variant proves
distinct literal types and rendered values, unchanged SDK React identity,
lockfile ownership and exact-byte recovery. Wrong cross-scope types fail before
publication. Local gates passed **199 Node/13 Python**, **78 targeted** and
**10 serial native tests**. Codegen adapter runtime passed **35/37** and shutdown **8/9/9**.
Eight determinism/transform controls retain the reproduced race negative,
strict:false, inherited JSX and class-field behavior.
Original Metro 0.87.1 comparisons cover eight conditional-export/import profiles
and author key order/exact targets; missing-target fallback and external
`#imports` remain two explicitly tested differences. ESNext/Preserve + Bundler
is the bounded compiler profile; NodeNext/Node16/CJS emit, runtime `types`
conditions, declaration execution and unimplemented decorator metadata fail
visibly. Full types/assets/profiles/Metro/workspaces/exports and all-target
acceptance remain open; D20 and GF-03/GF-28 remain open. No denominator changes.
[Preceding resolver CI](docs/evidence/alias-scopes/preceding-ci.json) passed all
five jobs at `f2eb57f`. The subsequent scoped-alias CI passed all five jobs at
`80729da`; its [separate record](docs/evidence/root-retirement/preceding-ci.json)
predates the root-retirement implementation below.

The [independent-root retirement slice](docs/evidence/root-retirement/README.md)
now extends 2A with **17 real Godot runs / 318 checks** on macOS arm64 Release.
Resize/pressed/RAF/timer callbacks can retire one root while another keeps its
state, Controls, VM, module cache and scheduling. Immediate remount, synchronous
host free and replacement by another application preserve the current owner
and reject old refs/events. Cleanup uses original React/Fabric work in a deferred
Godot phase, outside the original registry visit. A reproduced old core Button
signal across reused root/tag IDs is now rejected using its originating runtime
and mount identity; a fresh Button still delivers normally. Original external
ViewProps no longer enter a core props cast, and adapter font ownership is
verified against a failing preceding binary. Three graphical root cases also
check rendered pixels and retain captures. Regressions passed **199 Node/13
Python**, **10 native tests** and **15 headless examples/605 checks** on the
rebuilt host. Full GF-07/GF-26/GF-28 acceptance,
original RN differential lifecycle, other targets/exports and ABI remain open.
No item, decision or checkpoint denominator closes with this slice. Its
[preceding hosted CI](docs/evidence/view/preceding-ci.json) subsequently passed
all five jobs at `b5dafc8`; the View implementation below has separate evidence.

The [public View foundation](docs/evidence/view/README.md) starts GF-10 with
original RCTView/ViewComponentDescriptor, authoritative Fabric mount order and
rectangular hidden/scroll clipping in both painting and hit testing. Four
physical border colors, source-over alpha, asymmetric rounded joins and style
removal use resolved upstream ViewProps without adding overlay Controls.
Public clipped-child measurements retain the full logical rectangle; keyed and
flattening updates preserve the selected child identity and stale refs retire.
The final fixture passed **67 headless / 107 native checks**, including **36 RGBA
samples** and three captured stages. The previous host failed **9/67** headless
and **24/107** native checks against the same final oracle, as expected.
Regression gates passed **202 Node/13 Python**, **10 native tests**, **16 headless
examples/672 checks**, **58 NativeWind native checks** and **17 adapter runs/318
checks**. NativeWind now verifies public logical-parent measures independently
against real window-space Controls, preserving padding, gap and responsive
assertions when original Fabric mounting flattens/reparents nodes. Only GF-10
first-slice checkpoint becomes done; the full item and dependencies remain open.
[Hosted CI at `b5df4d6`](docs/evidence/view/ci.json) passed all five jobs; its
reference fixtures do not certify full View rendering or Godot mobile ports.
RTL/logical edges, transforms/origin, rounded descendant masks, fractional/DPI
geometry, full StyleSheet/shadows/filters and original mobile View differential
certification still need execution.

The [coordinate and gesture slice](https://github.com/journey-studios/godot-fabric/blob/48e425345b0ecb7665a7a447c9c14453c8e4ece0/docs/evidence/coordinates/README.md) at verified implementation `48e425345b0ecb7665a7a447c9c14453c8e4ece0` now
addresses that reproduced GF-08/GF-09/GF-13 gap. Public page points and original
measure use root space; location remains relative to the original target, and
screen points include native Window origin and current content density. The
first hit root also samples density immediately after a content-scale change,
without depending on another root or the next frame to refresh a cache.
Two independent roots passed **238 headless / 247 native checks**, **6 RGBA
samples** and three captures. Real MOVE inside/outside/return, release outside,
moving a held surface, nonuniform root scale and raw-window density-two input
preserve original Pressability state, target identity and public geometry.
The preceding host fails **121/238 headless and 121/247 native** checks, while
the intermediate cached-density host fails exactly **1/238**: first screen point
was `(990,568)` instead of `(495,284)`. The final host passes the same oracle.
Regressions passed **202 Node/13 Python**, **10 native tests**, **17 headless
examples/910 checks** and **17 adapter runs/318 checks**. GF-13 becomes In progress
with only its first-slice checkpoint done; full input/HostInstance/metrics/View
and differential/target acceptances remain open. Overlapping/nested roots,
embedded Window/SubViewport, singular/rotated embeddings, RN component
transforms, physical hardware, OS DPI, multitouch and the remaining interaction
contracts still require their own evidence. Next in sequence 3: expand View
transforms and public HostInstance behavior against the original contract.
No new architectural decision, complete GF item or denominator changes here.
The [hosted CI receipt](docs/evidence/coordinates/ci.json) keeps local proof,
current CI, preceding simulator-discovery failure and verified Pages deployment
separate; none supplies the still-open full differential/target acceptance.
Coordinate CI snapshots `f40831e` and `b1732fb` each passed all five jobs,
including cold start and the current limited RN oracle. The later affine
transform slice below keeps its new local proof separate from that hosted CI.

The [affine transform slice](https://github.com/journey-studios/godot-fabric/blob/6e5db7b5cb6a4bce567c7c648240c8637a3b944f/docs/evidence/transforms/README.md) at verified implementation
`6e5db7b5cb6a4bce567c7c648240c8637a3b944f` extends
GF-07/GF-08/GF-10/GF-13 using original RN transform processors and resolved
ViewProps. Ordered transforms, percentage translation/origins, shear and
reflection affect the same Godot Control through public base/offset APIs.
No engine rebuild or extra host node is needed. Independent coefficients,
exact corners and renderer pixels are checked separately from original RN
ancestor-AABB measures and Yoga layout. Resize-only updates, removal and
flatten/materialize/flatten preserve the child Control, tag, ref and React state.
The final gallery passes **309 headless /345 native checks**, **33 RGBA samples**
and three captured phases. The previous coordinate host fails **65/309 and
68/345** against the identical fixture and bundle.

The standalone factor test passes **40,932 checks**, including proportional
rank-one rounding cases. Six fresh Hermes applications pass **61 rejection and
teardown checks** for singular, 3D/perspective and native-precision limits.
Native error recovery no longer detaches a Control rejected before insertion.
Another **25 actual input checks** reject a false START caused by composed
determinant overflow, accept a restored positive press and cancel held contacts
using their last valid coordinates under overflow or a singular external
Surface. The canceled event is consumed before Godot GUI tries another inverse.
The intermediate transform host fails **9/25** on the same input fixture.
These external-embedding safety checks do not implement singular JSX rendering.

The final rebuilt binary passes **205 Node/13 Python**, **10 native tests**,
**18 headless examples/1,219 checks** and **17 adapter runs/318 checks**.
The native SDK source and loaded consumer host hashes match the executed final
implementation. [Pages run37171971971](https://github.com/journey-studios/godot-fabric/actions/runs/37171971971)
succeeded with branch JSON5885331, checked against the served public file.
The [hosted receipt](docs/evidence/transforms/ci.json) preserves the earlier
pending observation and the subsequent successful five-job run separately;
its limited RN reference cases do not certify full transform or target parity. GF items, full contract/differential/target
checkpoints, decisions, weights and the dashboard denominator remain unchanged.
Valid transform animation during contact, transformed masks, complete
HostInstance commands, RTL and mobile differential acceptance remain open.
Next in sequence 3: continue the public HostInstance/native-command branch.

The [completed hosted run](https://github.com/journey-studios/godot-fabric/actions/runs/37171931529) at `5885331` passed contracts, native cold start, original iOS/Android references and parity comparison. The dated earlier pending observation remains in [ci.json](docs/evidence/transforms/ci.json). These limited reference fixtures do not close full transform parity, the Godot mobile ports or GF-08.

The [public tree and ID slice](https://github.com/journey-studios/godot-fabric/blob/31d08ac37d1fb61a80c233aada6a3cfc3549bfcc/docs/evidence/tree/README.md) at verified implementation
`31d08ac37d1fb61a80c233aada6a3cfc3549bfcc` extends GF-08 and
GF-10 through original RN `View.js`, base ViewConfig and narrowed read-only types.
Public View `id` takes precedence over `nativeID`; Text `nativeID` and document
lookup use the committed Fabric tree for each root. Logical parent/sibling
traversal, snapshot collections, duplicate IDs, text replacement, native
materialization and stale refs are tested across two roots and their retirement.
The pinned production RawText replacement/null ownerDocument and children-only
native-ID reversion are documented with original source links rather than
silently replaced with browser semantics.

The unchanged native host passes **89 headless / 99 native assertions**, **8
RGBA samples** at independently declared slots and two actual captures. Four
frame assertions prove the native reorder separately from logical traversal.
The same final fixture fails **25/89** with the preceding JS configuration;
restoring it regenerates exact positive bundle bytes. Regressions pass **206
Node / 13 Python**, **10 native tests**, **19 examples / 1,308 final checks** and
**17 adapter runs / 318 checks**. A first consumer graphical timeout is retained;
explicit test-window focus preparation precedes a fresh successful full run.
[Pages run37175019378](https://github.com/journey-studios/godot-fabric/actions/runs/37175019378) passed build/deploy; served JSON matches `a012f9e`, source `31d08ac`, outside main.
The [hosted receipt](docs/evidence/tree/ci.json) records contracts passed with
other jobs still running in that snapshot. These are separate from local proof.
The later [hosted run37175169255](https://github.com/journey-studios/godot-fabric/actions/runs/37175169255)
at `a608d07` passed all five jobs. It validates the preceding tree snapshot,
including the limited mobile reference suite; it is not a focus differential.
GF-08/GF-10 remain
In progress; checkpoints, dependencies, weights, decisions and denominator do
not change. Next in sequence 3: original TextInputState, public focus and native
commands, followed by remaining HostInstance/EventTarget and pointer capture
acceptance. Full mobile tree differentials and all-target evidence remain open.

### Public input focus checkpoint (2026-10-04)

The [focus slice](docs/evidence/focus/README.md), verified against implementation
`3b09b37acf735664301d3ddaf9ab275519893267`, extends GF-08/GF-12 through
the original TextInputState singleton, original public element prototype and
Fabric/Codegen focus commands. Callback-time focus, autoFocus, native transfers,
readonly updates, callback ref replacement, keyed replacement/removal and stale
commands are tested against the actual Viewport owner and LineEdit focus.
Native eligibility guards cover deleted/stopping inputs and off-tree reparenting.
Canonical props are not used as an authority for committed native editability.

The final fixture passes **175 headless / 189 native checks**, **12 pixels** and
two captures. It executes off-tree, root-retirement and application-stop
callbacks inside native operations. Controls fail **23/160** against the
preceding native host and **11/175** without JS native eligibility. Restoring
the final implementation restores exact bundle/native bytes. Regressions pass
**207 Node / 13 Python**, **10 native tests**, **20 examples / 1,483 checks** and
**17 adapter runs / 318 checks**. Exact identities and the initial fixture
callback-ref correction are retained in the linked receipts.

GF-08/GF-12 remain In progress. Existing slice checkpoints gain evidence;
full contract, reference parity, dependencies and targets remain open. Weights,
decisions and the 156-checkpoint denominator do not change. Next in sequence 3:
remaining HostInstance/EventTarget and pointer-capture acceptance. Hidden trees,
hardware keyboard/IME, multiline and mobile focus differentials retain their
separate acceptance requirements. Publication/hosted results are recorded after
verification; local runtime proof is distinct from both. Manual Pages run
[37177743564](https://github.com/journey-studios/godot-fabric/actions/runs/37177743564)
passed build/deploy and served branch JSON `0d7c731` exactly;
[the hosted snapshot](docs/evidence/focus/ci.json) keeps new focus CI status
separate from the completed preceding tree CI. Later focus snapshot
[CI37177820811](https://github.com/journey-studios/godot-fabric/actions/runs/37177820811)
at `1699e5c` passed all five jobs; limited reference coverage remains distinct
from a full focus/mobile differential.

The isolated native-command complement passes **112 checks / 40 actual focus
owner observations**, eight exact malformed-argument rejections and recovery,
with all nine input registrations released. The downloaded hosted artifact
confirms those results and source identities. The complement CI completed with
contracts/native/Android passing; iOS discovery failed and comparison skipped.
The [dated hosted receipt](docs/evidence/focus/commands-ci.json) retains the
iOS simulator-discovery timeout before app build, followed by a successful
13-check core reference on identical inputs. This does not close GF-08/GF-12 or
certify full focus/mobile parity. The later [pointer lifetime slice](docs/evidence/pointers/README.md)
passes 132/146 public checks,144 native assertions and 43 JSX fault/real-focus
stop checks, with 12 pixels/two captures and two original-source crash controls.
Generated native lifetime guards preserve the upstream capture negotiation;
complete EventTarget, transformed/hardware/mobile acceptance remains open.

## Release contract and scope

1. Ordinary public RN imports and TypeScript/TSX work, including stable
   components, props/styles/events, imperative refs, public utilities and
   required JS globals. The 84 stable/compatibility value exports in the audit
   are the first inventory slice; the complete contract is larger.
2. Applicable behavior matches a pinned original RN reference app on iOS and
   Android. Desktop ports implement the shared API and declare concrete OS
   mappings. Differences require a reviewed rationale and fixture; essential
   shared behavior cannot be waived under a generic “Godot limitation.”
3. App authors can register a typed TurboModule and a Fabric native component
   with events/commands through a documented build/export path. Existing mobile
   native binaries still require host ports; 1.0 does not promise every library.
4. macOS arm64, Linux x86_64, Windows x86_64, Android arm64 and iOS arm64 plus
   simulator are release gates. Each has a clean installation, packaged consumer
   app and physical input/system-service evidence. OS minimums are established
   in GF-31, rather than guessed now.
5. NativeWind and the selected chart/SVG contract have explicit supported
   versions and executable consumer examples. Larger library ports, Web/WASM,
   additional architectures and 13 experimental/unstable RN exports are P2.

“Current RN” is a versioned promise. GF-38 rechecks the latest stable version
before release, tests the corresponding React/Hermes combination and publishes
that support matrix. A release cannot claim “current” while ignoring a newer
stable baseline; an explicitly older baseline must be named and approved as a
scope change. RC/nightly APIs are not automatically added to the 1.0 gate.

## Next implementation order

Follow the [Architecture 2.0 migration order](#architecture-20-migration-order)
below: establish reliable startup and comparison fixtures; advance the shared
application and independent consumer in parallel; connect geometry, refs and
native services; prove external extensions; then expand UI/system behavior,
distribution and certification. Begin portable-build, accessibility and IME
probes immediately. Keep existing examples as regression evidence.

### Architecture 2.0 migration order

**Sequencing recorded: 2026-10-02.** This is the agreed prioritization of work,
not approval of the remaining architecture contracts. At this sequencing
checkpoint, the [decision register](docs/ARCHITECTURE_V2_DECISIONS.md) records
**18 approved directions and 14 pending decisions**. No item changes status because of this
plan; the release scope and acceptance requirements remain in force.

Prioritize foundations with many dependents and early tests that can reveal
design constraints. Decision numbers organize discussion, not implementation.
M0 through M5 group responsibilities; they are not a requirement to finish one
entire group before beginning another.

| Sequence | Delivery slice | Existing work owners | Prerequisite and observable result |
| --- | --- | --- | --- |
| 1 | Reliable startup and comparison fixtures | GF-01, GF-02 | Reproduce and fix cold-start/root-cause and minimum-version gaps; fresh startup, failed-start cleanup and positive/negative comparison cases remain observable |
| 2A | Shared application, bootstrap and roots | GF-05, GF-06, GF-07 | Start from the reliable baseline; register/mount two distinct roots in one runtime, update props and unmount one without restarting the other; extend the semantic suite with each behavior |
| 2B | Minimal independent consumer and authoring flow | GF-03, GF-04; initial slices of GF-28/GF-29 | Advance alongside 2A; a separate TSX project uses public imports/types and project-owned dependencies, with visible build/unsupported-contract errors and no hidden demo aliases |
| 3 | Geometry, refs and Godot-to-React communication | GF-08, GF-09, GF-25; View foundation in GF-10 | Integrate 2A/2B; window/surface metrics, drawing, measures and input agree; typed calls/events respect lifetime, initial-state revisions and stale-reference rejection |
| 4 | External native module and component | GF-26, supported by GF-25/GF-31 | Use the native registry, refs, View foundation and identified binary combination; an independent consumer builds/runs a module and component with specs, events/commands and cleanup without editing the core |
| 5 | Complete UI, interaction and system behavior | GF-10 through GF-24 | Expand the host/service foundations through the dependency branches below; forms, gestures, animations, scroll/lists, images, widgets, accessibility and services pass their applicable fixtures; OS-specific completion also needs the relevant port |
| 6 | Distributable SDK, selected libraries, development tools and complete ports | GF-27, GF-28, GF-29, GF-32 through GF-35 | Combine host contracts, extensions and per-target tooling; clean consumers install, debug and export identified artifacts; selected libraries and real input/system integration have target-specific evidence |
| 7 | Complete certification, performance and release | GF-30, GF-36 through GF-39 | Close coverage for the promised scope, budgets and soak/recovery cases; verify the actual release head, current stable baseline policy and reproducible SDK/consumer artifacts before 1.0 |

These are **implementation slices**, not substitutes for the complete item
acceptance. A minimal consumer does not close GF-28, a working form does not
close GF-12, and an early port spike does not close GF-34/GF-35. Close each item
only when its full result and completion dependencies in the tables pass.
Selected contracts can be implemented and tested before every contract of a
preceding item is complete; record exactly which slice and host were exercised.

```mermaid
flowchart TD
  Baseline[Startup and comparison: GF-01 and GF-02] --> Application[Shared application: GF-05 to GF-07]
  Baseline --> Consumer[Consumer and public facade: GF-03 and GF-04]
  Baseline --> Portable[Early target feasibility: GF-31]
  Application --> Foundation[Refs, metrics and modules: GF-08, GF-09, GF-25 and View foundation]
  Consumer --> Foundation
  Foundation --> UI[Complete UI and system contracts: GF-10 to GF-24]
  Foundation --> Extensions[External extension proof: GF-26]
  Portable --> Extensions
  UI --> SDK[SDK, libraries, tools and ports: GF-27 to GF-29 and GF-32 to GF-35]
  Extensions --> SDK
  Portable --> SDK
  SDK --> Release[Complete certification and release: GF-30 and GF-36 to GF-39]
```

The diagram groups slices; the item tables retain the more precise completion
dependencies. Intermediate alphas/betas can ship narrower declared scopes
without labelling them full 1.0 parity or reducing the agreed release goal.

### Dependencies that determine the schedule

- **Bootstrap and semantics → roots → refs/metrics:** GF-05/GF-06 precede full
  GF-07; GF-08/GF-09 depend on GF-07. Root/application lifecycle is an early
  migration foundation even though GF-07 has P1 release priority.
- **Public facade, bootstrap and roots → native modules:** GF-03/GF-05/GF-07
  feed GF-25. GF-25 is in M3 but is a prerequisite for completing styles,
  editing, animation, accessibility, environment and network contracts.
- **Refs, metrics, View and text → editing:** GF-08/GF-09/GF-10/GF-11, together
  with the public facade/native modules, support complete GF-12. IME, selection
  and focus commands need correct host geometry and native lifetime.
- **Editing, input and animation → scroll → lists:** full GF-14 requires
  GF-12/GF-13/GF-19 as well as refs/metrics; GF-15 requires GF-10/GF-14.
  A partial ScrollView probe is not a completed host for upstream lists.
- **Environment and modules → networking → remote images:** GF-21/GF-25
  support GF-22, which GF-16 needs for network images. This branch can advance
  alongside scrolling after its own prerequisites are available.
- **Extensions and portable builds → complete SDK/ports:** GF-26/GF-31 feed
  GF-28. A consumer/packaging prototype starts early; complete SDK acceptance
  includes extension and per-target export results, with port certification
  continuing in GF-32 through GF-35.

### Architecture decisions before dependent implementation

Use this discussion priority for the **14 pending decisions**. Agree the
contract needed by the next slice before implementing behavior that depends on
it; detailed formats and measured internal choices can be specified with that
slice. This schedule does not turn a recommendation into an approved contract.

| Discussion priority | Pending decisions | Reason and work connection |
| --- | --- | --- |
| 1 · Evidence and migration criteria | [D31](docs/ARCHITECTURE_V2_DECISIONS.md#v2-d31), [D32](docs/ARCHITECTURE_V2_DECISIONS.md#v2-d32) | Define comparison evidence and slice exit criteria before changing the host; connect GF-01/GF-37 and this migration plan without weakening 1.0 scope |
| 2 · Platform and execution safety | [D30](docs/ARCHITECTURE_V2_DECISIONS.md#v2-d30), [D27](docs/ARCHITECTURE_V2_DECISIONS.md#v2-d27), [D28](docs/ARCHITECTURE_V2_DECISIONS.md#v2-d28) | Define service responsibilities, shutdown/ownership and executor boundaries for GF-05/GF-07/GF-25/GF-31; thread migration, caching and Rust still require profiling in GF-30 |
| 3 · Authoring and activation | [D19](docs/ARCHITECTURE_V2_DECISIONS.md#v2-d19), [D20](docs/ARCHITECTURE_V2_DECISIONS.md#v2-d20), [D21](docs/ARCHITECTURE_V2_DECISIONS.md#v2-d21), [D29](docs/ARCHITECTURE_V2_DECISIONS.md#v2-d29), [D22](docs/ARCHITECTURE_V2_DECISIONS.md#v2-d22), [D26](docs/ARCHITECTURE_V2_DECISIONS.md#v2-d26) | Connect builder, resolution, transforms, types, activation and diagnostics across GF-03/GF-04/GF-28/GF-29; a successful build alone is not successful activation |
| 4 · Resources and distribution | [D24](docs/ARCHITECTURE_V2_DECISIONS.md#v2-d24), [D25](docs/ARCHITECTURE_V2_DECISIONS.md#v2-d25) | Keep resource identities, artifact generations and per-target exports coherent for GF-16/GF-28/GF-31 through GF-35 |
| 5 · State preservation while editing | [D23](docs/ARCHITECTURE_V2_DECISIONS.md#v2-d23) | Add Fast Refresh in GF-29 after reload, activation and cleanup are reliable; document eligible edits and fallback/state loss |

The **18 approved directions** map to the existing work as follows. These are
ownership links for the migration, not evidence that the decisions are shipped.

| Approved direction | Implementation connection |
| --- | --- |
| [D01–D02](docs/ARCHITECTURE_V2.md#v2-d01) · application and surface identity | GF-07/GF-28, with GF-05/GF-06 runtime foundations |
| [D03–D08](docs/ARCHITECTURE_V2.md#v2-d03) · calls, data, events and connection lifetime | GF-25 transports/game bindings, coordinated with GF-05/GF-07 and typed consumer work in GF-03/GF-28 |
| [D09–D12](docs/ARCHITECTURE_V2.md#v2-d09) · tree, input, time and hosting contexts | GF-07/GF-08/GF-09/GF-10/GF-13/GF-21, plus module/runtime integration |
| [D13–D16](docs/ARCHITECTURE_V2.md#v2-d13) · native discovery, compatibility, specs and behavior | GF-25/GF-26/GF-28/GF-31; each component also belongs to its functional GF item |
| [D17](docs/ARCHITECTURE_V2.md#v2-d17) · original library identity and demonstrated scope | GF-27/GF-37/GF-38 |
| [D18](docs/ARCHITECTURE_V2.md#v2-d18) · self-contained editor flow and project dependency ownership | GF-28/GF-29/GF-31, with GF-03 resolution/types |

In particular, make the GodotFabric binding/revision/lifetime scenarios explicit
in GF-25/GF-07 acceptance slices. A generic TurboModule example alone does not
prove every game-integration contract in D03–D08. Track those cases within the
existing owners rather than creating a second backlog from the decision IDs.

### Parallel probes and verification throughout migration

- **GF-31 begins immediately:** prove loading, JSI and a minimal Control in
  Android/iOS consumers with official Godot/templates; establish the native
  build/ABI constraints before committing the complete port design.
- **Accessibility and IME paths begin immediately:** investigate a real OS
  semantic/focus/action bridge in GF-20 and native composition/keyboard paths in
  GF-12, coordinated with GF-31. An exported executable or metadata dictionary
  does not prove assistive technology or editing behavior.
- **Comparison and CI grow per slice:** GF-01 fixtures feed GF-37 continuously;
  extend GF-36 native lanes as targets become runnable. Early passing subsets
  are not the complete certification required in sequence 7.
- **Measure before optimizing:** establish GF-30 frame/heap/node baselines and
  budgets on available workloads during migration; add list/target workloads
  as they exist. Separate runtime/mount executor contracts early, then choose
  caching, workers or bounded C++/Rust work from measured bottlenecks.

### First integrated milestone: HUD and inventory consumer

Build a generic independent Godot consumer with **HUD and inventory in one
shared application**. This integrates selected contracts from sequences 1–3;
it is an alpha migration milestone, not complete RN parity or closure of every
participating GF item. Keep the existing form/runtime/chart/style examples as
regressions and identify which host each report exercised.

Acceptance for this milestone:

1. Configure the application/addon and run public TSX imports in the separate
   consumer without editing demo internals. Exercise the provisioned basic
   editor flow from D18 without requiring global Node; additional dependencies
   remain project-owned and explicitly installed.
2. Mount HUD and inventory with separate identities/local state in one Hermes.
   Share data explicitly when needed; no state-management library is required.
3. Update the HUD from Godot data/signals, including an initial revision and
   changes during connection. Invoke a typed game operation from the inventory;
   observe defined results/errors and event ordering.
4. Resize only the inventory: its constraints/layout and input/measure geometry
   update while HUD geometry and window metrics retain their meanings.
5. Pause the simulation while UI input/timers remain available. Hide, unmount
   and remount the inventory according to their distinct lifecycle contracts;
   the HUD and application remain operant.
6. Close the inventory during an accepted operation; its result must not access
   the old mount. Repeated mounts/cleanup do not duplicate listeners or leak
   owned nodes, and runtime restart rejects old refs/callbacks.
7. Once pending activation/diagnostic contracts are agreed, inject build and
   activation failures and verify their distinct recovery policies. Outdated
   build responses cannot become the active generation; source maps identify
   the executed generation. Do not imply rollback of accepted game operations.

Record semantic assertions, root/runtime identities, cleanup observations and
native visual captures. Extend this same consumer with an external module and
Fabric component in sequence 4, then grow selected library cases. Screenshots
explain the scenario; they do not replace lifecycle/event/ref assertions.

**Checkpoint 2026-10-03:** the independent consumer demonstrates points 1–4
through public TSX, one runtime/two roots, typed Godot services and inventory-only
resize with original refs, stable window metrics and native editing. The separate
services laboratory demonstrates pause, hide/unmount/remount and accepted-job
lifetime from points 5–6. This is split evidence, not acceptance of the entire
integrated milestone: runtime restart and stale refs (6), pause/job lifetime in
this same provisioned consumer (5–6), and the pending activation/diagnostic contract (7) still need
the integrated consumer. Boundary/lifetime fixtures additionally prove queued
revocation, source destruction, terminal stop and synchronous application
destruction. The next dependency is the external spec/module/component slice
in sequence 4, coordinated with the View foundation and approved contracts.

## M0 — Establish a reliable, measurable contract

Owners: public facade/bundler, runtime lifecycle and acceptance harness.
Exit: a clean consumer can start, import truthful APIs
and expose a contract failure without hidden no-ops or stale evidence.

| ID / priority / work | Status | Required result and acceptance | Completion dependencies |
| --- | --- | --- | --- |
| GF-01 · P0 · Full contract inventory and oracle | In progress | Expand the versioned root inventory to types, component props/styles, events, ref commands, globals and applicable OS APIs. Every target contract has an owner and positive/negative fixture. Run shared fixtures against an original pinned RN iOS/Android app and Godot; record semantic traces, layout tolerances and platform applicability before implementation | None |
| GF-02 · P0 · Clean startup and engine contract | In progress | Reproduce the signal-11 cold import with fresh dependencies/resource cache; isolate load/import/shutdown and fix the root cause. Align extension metadata with the actual minimum supported Godot API. Repeated first installs and failed-start cleanup pass in native CI without retrying away crashes | GF-01 |
| GF-03 · P0 · Public API and typed platform resolution | In progress | Export actual public TextInput/Button contracts, use the original wrapper where viable, and provide strict RN-compatible public types. Resolve `.godot`, `.native`, JS/JSX/TS/TSX, assets and package conditions through a documented consumer bundler. An independent TSX app imports every in-scope root name; implemented APIs run, unfinished contracts still fail visibly | GF-01 |
| GF-04 · P0 · Eliminate silently accepted behavior | In progress | Audit facade destructuring, validAttributes, values and event registration. Implement or explicitly reject each unsupported prop/value, including accessibility metadata and userSelect/collapsable semantics; verify updates/removal as well as initial mount. Before 1.0 all applicable target contracts must be implemented, not merely guarded | GF-01, GF-03 |
| GF-05 · P0 · RN bootstrap and JS globals | In progress | Integrate upstream core initialization or an audited equivalent. Certify timers/arguments/cancellation, intervals, microtasks, immediate/idle callbacks, monotonic RAF, performance, errors and required URL/encoding/abort globals. Verify task ordering, callback exceptions, starvation and unmount cleanup against RN; network transport is GF-22 | GF-01 |
| GF-06 · P1 · React/Fabric semantic suite | In progress | Exercise every applicable feature in the pinned native React renderer, including dev StrictMode, refs/cleanup, transitions, Suspense, effects/external stores, batching, supported Activity/hidden-tree behavior and errors. Verify abandoned renders produce no native mounts and events/updates preserve upstream priority. Reuse upstream reconciliation rather than implement a second scheduler | GF-01, GF-05 |
| GF-07 · P1 · Root and surface lifecycle | In progress | Deliver AppRegistry/RootTagContext and supported mount/update/unmount APIs, multiple uniquely identified surfaces, root props, scene changes/pause/resume and error cleanup. Design overlays/portal needs against the actual public RN contract. Repeated root replacement and two concurrent surfaces preserve independent state and release tags/timers/subscriptions | GF-05, GF-06 |
| GF-08 · P1 · Public refs and native commands | In progress | Complete applicable HostInstance/React Native node APIs, root/text instances, measure/measureInWindow/measureLayout, setNativeProps and public UIManager/findNodeHandle behavior. Compare transformed/window coordinates and commit timing; deleted refs and stale commands must not access freed nodes | GF-03, GF-07 |
| GF-09 · P0 · Real metrics and platform identity | In progress | Supply window and screen dimensions, density/font scale, resize/orientation/insets and stable subscriptions. Define `Platform.OS = godot`, physical OS metadata and platform selection/resolution without impersonating iOS/Android. Verify high DPI, font scaling, multi-window coordinates and logical/pixel conversions with reference traces and real devices | GF-01, GF-07 |

**GF-02 checkpoint (2026-10-02):** the extension minimum now matches the tested
Godot 4.7.2 runtime. Setup rejects a different engine before downloads/build
outputs; runners discard stale success reports before version validation.
Regressions cover interrupted startup-list publication, disposable-project
cleanup and visible import/runtime failures. Prepared cold imports and runtime
checks pass locally. Direct empty-cache import still reproduces the engine
crash, consistent with [upstream issue #111645](https://github.com/godotengine/godot/issues/111645).
GF-02 remains In progress; the [evidence record](docs/evidence/cold-start.md)
distinguishes containment, local verification and the remaining engine boundary.

### Focus command boundary complement (2026-10-04)

The [original-dispatch guard fixture](docs/evidence/focus/commands.json) passes
**112 checks / 40 native focus-owner observations**. Eight malformed focus/blur
calls reach exact argument diagnostics, preserve focus/State/events and allow
later valid commands and React commits across two roots plus an independent
application. Readonly/removed/stopped targets retain no focus authority; all
nine input registrations and native lifetimes clear at shutdown. This is a
headless native complement on the unchanged focus host; CI now runs it, with
hosted results recorded separately. No new checkpoint or full GF closes.

### Pointer transport, capture and exception lifetime (2026-10-04)

GF-08/GF-13 remain **In progress**. Real Godot input now reaches original pointer
serialization/negotiation and public View capture refs, with app-owned contact
IDs, no-hit drag routing and selective retirement. The [executed receipt](docs/evidence/pointers/README.md)
records 132 headless/146 native checks,12 pixels/two images and 144 native
assertions. Two original processor/binding controls reproduce retained-target
and moved-hover-tracker SIGSEGV; the generated hash-pinned overlay fixes those
boundaries while preserving downloaded sources and original JS negotiation.

An isolated original JSX bundle passes 43 checks with six deliberate listener
errors, priority recovery and synchronous stop from a genuine LineEdit focus
signal inside got capture. Another app's already-captured pointer survives.
Native SDK overlay headers/identity are repackaged and validated separately.
Original Pressability regressions still test fresh Down after focus cancellation.

The [hosted receipt](docs/evidence/pointers/ci.json) independently verifies the
144 processor assertions, 43 JSX checks and both original-source crash controls
from CI artifacts at `a15fde4`. That run completed successfully in all five jobs;
its original RN reference comparison covers the current oracle fixtures.
Pages run `37197499767` passed build/deploy; the served
JSON exactly matched that branch commit outside main. Neither publication nor
the original Android/iOS reference lanes certify Godot mobile ports.

This slice does not enable imperative EventTarget flags or close transformed
capture, nested responder/PanResponder, hardware/keyboard, multi-window/scroll,
cross-app stacking or mobile differentials. No architecture decision or full
checkpoint/GF is newly closed. [Source analysis](docs/research/pointer-capture-boundary.md).

### Captured pointer geometry checkpoint (2026-10-04)

GF-08/GF-09/GF-13 remain **In progress**. The
[public geometry fixture](examples/pointer-geometry/README.md) passes 631
headless / 648 native checks, with 14 pixel checks and three Viewport captures.
The identical final fixture fails 55/631 checks on the previous committed host:
54 offsets and one exact terminal-coordinate check. Native local projection
covers rotation/skew/reflection, shared-root embeddings, flattened refs,
no-hit drag, real React transform commits and immediate raw density-two input.
Physical-origin client/page/screen fields and original capture ordering remain
separate from target-local offset and original public AABB measures.

The unchanged RN processor and lifetime overlay, compiled with their matching
binding sources/headers, each pass 108 portable checks with identical
unprojected numerical results. That fixture does not execute the binding. Three declared
cases expose the pinned incomplete capture algorithm. The Godot correction
intentionally differs from AABB origin subtraction; it is not numerical parity
with that incomplete algorithm. A real Hermes/binding witness passes 378
checks, including immutable retained samples, interleaved roots, native/JS
fault recovery, default priority initialization and monotonic terminal history.

Singular cancel preserves only the same contact/family/exact prior native point;
another captured contact survives. Connected `display:none` capture keeps the
pinned empty-layout coordinates and ordering. Late input cannot restore ended
or retired authority. Native SDK pack/verify, registry 207/11 cases, loader
89/21 cases and 13 headless consumer runs/213 checks pass with the fresh
header/binary combination; ABI certification remains false. Contracts pass
199 Node/13 Python checks and 22 example scenarios/2,246 headless checks pass.
[Executed receipt](docs/evidence/pointer-geometry/README.md).

Original queued coalescing, complete EventTarget/responder/PanResponder,
scroll/multi-window/hardware/keyboard and mobile capture differentials remain
open. Typed JSI exception RTTI across framework boundaries is uncertified.
No architecture approval, weight, denominator, complete checkpoint or GF item
changes. The [hosted receipt](docs/evidence/pointer-geometry/ci.json) confirms all five
jobs passed at f90206f and audits original108/108, binding378 and headless631
artifacts. Pages37202857849 passed build/deploy; served JSON matched f90206f
outside main. Reference mobile jobs contain no captured-pointer oracle.

### Original EventTarget baseline (2026-10-04)

GF-05/GF-08/GF-13 remain **In progress**. The isolated original-ref probe passes
119 headless checks in four Hermes runtimes/five surfaces. Each enabled root
executes 33 manual checks: original listener identity/removal, capture/bubble,
flattened ancestry, once/reentrancy, mutation, AbortSignal, cancellation,
passive and public error cleanup. The two-flag matrix retains original defaults
and rejects late/repeated overrides. One deliberate listener fault arrives once
through TimerManager; all runtime work/timers and native nodes retire.

Three gaps are reproduced separately with positive controls: imperative-only
native pointer interest, the compiled legacy dispatcher omitting imperative
delivery despite working JSX, and permanent parent cache on a warmed detached
ref versus a cold detached sibling. [Executed receipt](docs/evidence/event-target/README.md)
and [source investigation](docs/research/event-target-boundary.md). Production
flags/bundle were unchanged in that baseline; native delivery remains pending.
The subsequent current-ancestry correction is recorded below. This does not close any full checkpoint, GF or architectural
decision. [CI receipt](docs/evidence/event-target/ci.json) audits 119 identical
check IDs and all three gaps at 515d0d7; all five jobs passed. This hosted
manual baseline remains separate from native EventTarget integration.

### EventTarget current-ancestry correction (2026-10-04)

GF-08 remains **In progress**. Shared consumer/laboratory bundling now generates
a hash-guarded correction to the pinned permanent parent cache. The original
parent getter resolves current NativeDOM ancestry for each new event path; the
original dispatcher still snapshots that path before callbacks.
[Evidence](docs/evidence/event-target-ancestry/README.md) records **102 checks
in each original/corrected variant**, using identical fixtures/native host.
Retired warm refs dispatch locally after item/ancestor/root removal and remount.
Another root retains its identities, and listeners installed before a keyed
sibling reorder continue working. A separate original-EventTarget graph proves
synchronous capture-time mutation preserves the current path and changes the
next path; this does not claim native React reparenting with retained identity.

Five overlay guards, contracts204/13Python, consumer30/40, original119 control,
focus/command and pointer processor/error gates pass. All22examples/2246headless
pass with the shared correction; no native rebuild was needed. Default
EventTarget flags remain off, native interest/dispatcher and complete responder
acceptance remain open. [Hosted artifact](docs/evidence/event-target-ancestry/ci.json)
now confirms both102 variants at91e5219 with exact local check IDs and source
pins. All five jobs passed. Performance, hardware/mobile
and the full GF-08 contract are pending. No checkpoint, dependency,
architectural decision, weight or denominator is closed.

### Native touch-tag resolution and dispatcher comparison (2026-10-04)

GF-05/GF-08/GF-13 remain **In progress**. Ending one of two contacts inside a
responder exposed a production integration bug: the pinned compiled renderer
treated Godot's numeric touch target as a Fiber, so its descendant check released
the owner prematurely. Shared bundling now inserts a hash-guarded numeric-only
lookup through the runtime UIManager/current committed tree and original weak
instance handle. Invalid/removed tags return null; canonical/Fiber inputs retain
their original path. The official Godot engine is unchanged; the addon is rebuilt.

The [executed comparison](docs/evidence/event-dispatch/README.md) runs **647
identical checks per variant**. Original lookup fails exactly two normative
inside-contact retention checks; corrected lookup passes all 647 on the same
native host. Explicit calls to the original experimental dispatcher in one
two-root runtime are compared with actual Godot touch input through the compiled
legacy path in a separate two-root runtime. Normal trusted JSX/imperative
capture/bubble, nested globals, deliberate faults and recovery are exercised
separately from original responder-event semantics. Pressability now verifies
retained pressed state, a moving surviving contact and one final activation.

Contracts227/13 Python, 22 examples/2250 headless, Pressability47, independent
consumer30/40 and original EventTarget/ancestry/focus/pointer gates pass. Fresh
native SDK pack/verify and addon provisioning pass; stale native source/binary
combinations are rejected before output creation and after copying. Thirteen
composition guards complement 14 existing SDK tests. Static/publication scans
pass. Hosted run37218513221 at897b127 now passes all five jobs; the artifact reproduces647 IDs, both original negatives and the corrected pass with17 source pins audited.

Four experimental responder differences remain open: unrelated contact retention,
should-set error currentTarget cleanup, truthy should-set acceptance and undefined
termination transfer. Public EventTarget flags remain off. Native imperative
interest, batched dispatcher integration, complete responder/PanResponder,
reentrant teardown, lookup performance, dev renderer and hardware/mobile parity
remain pending. No new complete checkpoint, GF or architectural decision closes;
the dashboard denominator and weights are preserved.

### Native EventTarget batch and terminal lifetime (2026-10-04)

GF-06 starts **In progress** with its first host-validated semantic slice;
GF-05/GF-07/GF-08/GF-13 remain **In progress**. Shared bundling can opt into the
original dispatcher inside the existing renderer batch. Raw typed/star emit once;
legacy extraction is exclusive. Default generated renderer source retains the
preceding tag correction, and public flags stay disabled.

[Evidence and captures](docs/evidence/event-dispatch-integrated/README.md) record
181 original/206 integrated headless checks and236 viewport checks/28 pixels.
One native touch reaches an imperative-only listener; mixed JSX/imperative handlers
commit both functional React updates once after callbacks, changing native geometry.
Fault ordering/recovery, root-local contact scope, removal and surviving roots
have distinct controls. Explicit global manual contacts do not certify mobile scope.

The probe fixes two native defects: terminal pointer retirement preceding queued
Cancel delivery, and reentrant ancestor detachment while Godot removes a child.
A previous-host queue control fails its normative registry assertion in both lanes;
an intermediate original-lane control crashes with signal11. Root-scoped removal
deferral and revoked-origin pointer checks pass the current control in both lanes;
ordinary resize/free remains separately verified through actual adapters.

Contracts235/13 Python,18 overlay guards, fresh SDK, loader89/21 and13 actual
adapter runs/213 checks passed. Current-host consumer30/40,22 examples/2250 and pointer/focus/tag regressions
passed. Source/host pins are recorded in the receipt. [Hosted integration CI](https://github.com/journey-studios/godot-fabric/actions/runs/37223152112) passed all five jobs at0478499; the audited artifact matches 181/206 IDs, 16 committed pins, 13 RN inputs and bundle identities. Hosted lanes are headless; mobile jobs are the existing core references. The subsequent pointer-interest query requires its own proof.

Native imperative pointer interest, full experimental flag matrix, four original
responder differences, complete PanResponder/types, registered-null-target JS,
reentrant full-queue contracts, dev renderer, performance and hardware/mobile
parity remain open. Next: native listener interest with an imperative-only positive
and removal/abort/lifetime controls, then dispatcher flags and responder gaps.
Only GF-06's first semantic slice gains a completed checkpoint; no complete GF,
architectural decision, full parity/dependency acceptance or denominator closes.

### Original listener Maps qualify native pointerdown (2026-10-04)

GF-05/GF-06/GF-07/GF-08/GF-13 remain **In progress**. The shared SDK can
opt into a pure query appended to hash-pinned original RN EventTarget source.
It reads actual capture/bubble listener Maps, including immediate removal,
`once`, abort and duplicate identity, without a second registry, wrapped handlers
or mutated View event props. Only View-path `pointerdown` interest changes;
original dispatch and renderer batching still own callback delivery. Public
imperative/native EventTarget flags remain off.

The [executed receipt and actual captures](docs/evidence/pointer-interest/README.md)
record **193 original / 230 current headless checks** and **260 native macOS
viewport checks**, including 28 asserted pixels and two saved captures. Both
lanes share 13 producer pins, 13 original RN inputs and the same new native host.
An imperative-only View gets no native Raw in the original filter and one
delivery in the query lane; separate manual positives establish listener identity.
Flattened ancestry has a live original ref/Fiber and no native Control. The
14-case matrix covers capture/bubble, listener mutation and mixed JSX delivery.
Document-only listeners still have a manual positive and native zero-Raw negative.

Actual re-render retains the original ref/tag/listener. Replacement and remount
cannot revive old listener authority. B keeps an actual held contact while A
unmounts, releases it and receives another gesture. Stop removes/releases the
query and clears native contacts/roots/pending tasks. This certifies teardown,
not a post-stop query invocation. Injected ScreenTouch input is distinct from
hardware input.

Shared guards15 plus native guards6, contracts250Node/13Python, static scan,
22examples2250, consumer30/40, fresh native SDK pack/verify, loader89/21 and
13actual adapters213 pass. Previous native dispatch181/206 and pointer
processor/geometry regressions pass on the new host. [Hosted query CI](https://github.com/journey-studios/godot-fabric/actions/runs/37226934414) passed all five jobs at ab0dc44 on attempt 2.
Attempt 1 timed out listing iOS simulators before app build; the unchanged head
passed on rerun. The native artifact matches 193/230 IDs, committed sources and
original RN inputs; it is headless and its mobile jobs exercise the core reference
suite, not Godot pointer-query mobile parity. The preceding integration CI
at0478499 is independently audited above.

Next: document/documentElement interest and complete experimental flag combinations,
then other pointer categories and responder gaps. The narrow query-fault fix below
leaves arbitrary resolver/reentrancy faults open.
Performance, dev renderer, full refs/commands, complete PanResponder,
hardware/mobile and full release acceptance stay open. Adapter ABI remains
experimental. No additional checkpoint, complete GF, decision, weight or
denominator changes. [Scope and platform-specific filters](docs/research/native-pointer-interest.md).


### A query fault preserves same-batch TouchStart (2026-10-04)

GF-05/GF-06/GF-07/GF-08/GF-13 stay **In progress**. The native interest
callback now catches query-call exceptions and non-boolean results, records
`E_POINTER_LISTENER_QUERY` with the cause, and returns false for that lookup.
The original queue continues with TouchStart, both Raw channels and its React
update. It does not manufacture pointerdown or end a still-held physical contact.

The [identical-fixture control and captures](docs/evidence/pointer-query-faults/README.md)
retain **174/186 on the previous host, with 12 normative failures**, followed by
**186/186 corrected headless** and **204/204 native viewport** checks. Four
one-shot faults cover throw/non-boolean at bubble/capture offsets 34/35 on real
original refs. Only native C++ differs across 14 producers/15 RN inputs; bundle
bytes and check IDs match. Two 680×160 captures/16 exact pixels show the real
TouchStart counter committing despite the failed lookup. Four diagnostics stay
visible and retained; context returns to Default, without certifying all priorities.

Up/Cancel, retirement/remount and stop clear their recorded resources separately.
B completes a gesture while A is held and works after A retirement; B is already
released before A unmounts in this fault fixture. The earlier held-B retirement
proof is independent. Contracts250/13, static analysis, 22examples2250,
consumer30/40, fresh SDK, loader89/21, 13adapters213 and prior interest193/230,
dispatch181/206 and portable processor/geometry gates pass on the corrected host.
[Hosted correction CI](https://github.com/journey-studios/godot-fabric/actions/runs/37229423491) passed all five jobs at b88708c.
Its audited artifacts confirm 186 fault checks, 22 committed source pins and
15 RN inputs, plus 193/230 prior-interest regressions. The old-host negative and
captures remain local; the run does not cover the subsequent Document extension.

The catch excludes family/handle/public-instance resolution. Getter exceptions,
reentrancy, stop during query and complete queue-fault behavior remain open.
Document/documentElement and the four flag combinations have a later receipt
below; other pointer events/responders remain next. Public flags stay off.
Hardware/mobile/performance,
full contracts/dependencies and ABI certification remain pending. No new complete
checkpoint, GF, decision, weight or denominator changes.

### Document/root native interest and all four flags (2026-10-04)

GF-05/GF-06/GF-07/GF-08/GF-13 remain **In progress**. The
[Document/root receipt](docs/evidence/pointer-documents/README.md) extends the
opt-in query to the actual current root family and its original specialized
handle. Existing RN documentElement/owner Document accessors read original Maps;
no generic lazy ref lookup, mirror, ViewProps mutation or public API is added.
Document methods and the installer follow native dispatch alone; View and
documentElement retain the original both-flags gate. Public flags remain off.

Eight fresh Hermes flag/SDK lanes pass **2,723 checks**: original 336/336/338/338,
current 336/336/340/363. The identical current bundles on the previous native host
retain **142 normative failures** (279/340 and 282/363 in the dispatch-on lanes).
All 18 original RN inputs and bundle bytes match; only C++ differs among 14
producers. The curated receipt verifies 25 source/configuration pins against implementation
`00bd80454384cbfbffc1b703df0864674bf11f99`. Native capture
passes **385/385**, including 20 exact pixels/two 760×220 saves: original Document
capture+bubble commits A=2/B=0 from A=0/B=0 in one renderer batch.

Capture-only registrations independently prove actual root offset34=false
before offset35=true, with original manual positives and gated-method negatives.
A-none/B-doc proves no Raw/callbacks or B state/contact mutation on A input,
followed by a live B positive. Original identities, phases, Raw membership,
functional updates/one commit, once/abort/removal, rerender, held-root retirement,
retained old objects, remount and balanced stop have executed observations.
No-ref purity is the real canonical slot before/after query; lazyHelperCalled
is an annotation, not an independent call counter. A downstream original
dispatcher may create the public ref legitimately.

One root throw34 with both flags preserves same-batch TouchStart/Raw/React and
one retained diagnostic through Cancel/recovery/stop. Root nonboolean/capture
faults, dispatch-only faults, resolver getters and reentrancy remain open;
component getters stay outside the native call catch. A nested-RootNodeKind
adversarial fixture and simultaneously held sibling retirement remain pending.

Host regressions pass 250 Node/13 Python contracts, static analysis,
22 examples/2,250 checks, consumer 30/40, fresh SDK pack/verify, loader 89/21,
13 adapters/213, updated interest 193/233, query faults 186, integration181/206,
and portable processor/geometry gates. [CI e65b7ba](docs/evidence/pointer-documents/hosted-ci.json)
passed all five jobs. Its audited artifacts confirm the same 2,723 Document
checks/IDs/bundles across eight lanes, interest 193/233 and query faults 186.
All 25 curated pins match implementation, head and native checkout a1d8a980.
Capture-only and cross-root traces are checked directly. The declared CI host
is shared by eleven reports; the artifacts contain no binary for independent
hash verification. Images/385 checks and 142 earlier-host negatives remain
local proof. Mobile jobs exercise their core reference subset. Previous b88708c
fault CI also passed five jobs.
[Pages 37233421454](docs/evidence/pointer-documents/publication.json) published
e65b7ba successfully; full public JSON and the local API match that data
commit, removing only generated publication. The subsequent [Pages run37233943579](https://github.com/journey-studios/godot-fabric/actions/runs/37233943579)
also passed and served the full b7b6c29 JSON, independently compared with the
commit and local API. Source remains outside main. The next fault fixture will
exercise a one-shot getter on a real component canonical.publicInstance slot
before broadening interest to pointerup; resolver faults are not yet certified.

No new checkpoint, GF acceptance, dependency, decision, weight or denominator
closes. Other pointer categories and responder/PanResponder contracts are next,
with complete priorities, dev renderer, performance, hardware/mobile/export
acceptance still open. Scope remains a verified root-interest slice.

### Component ref resolver failure preserves the native batch (2026-10-04)

GF-05/GF-06/GF-07/GF-08/GF-13 remain **In progress**. The
[getter fault receipt](docs/evidence/pointer-resolver-faults/README.md) proves a
failure before the SDK query: one getter on the actual current View family's
canonical.publicInstance restores its exact original data descriptor before
throwing. The preceding host loses the same-batch TouchStart callback, Raw
channels and React commit even though that descriptor is already usable.

Identical JS bundle bytes, 65 check IDs and 18 original RN inputs retain
**62/65 with three visible normative failures** on the preserved host. The
corrected host passes **65/65**, with only C++ differing among 17 producers.
All 23 curated code/configuration pins match implementation `b3920e190e8d3e0f3b4f6c0fac39cbd2e753a2d8`.
Component property reads now share the query's exception boundary. A failed
lookup records E_POINTER_LISTENER_QUERY and its cause, rejects that interest
lookup, and preserves the following original TouchStart/Raw/update in one
actual native React commit. No pointerdown is manufactured. The failed getter
enters no SDK callback; seven later healthy false queries are legitimate.

B completes a healthy gesture while A remains physically held. A's actual
Cancel, next healthy Down/Up, context restoration, descriptor reuse and balanced
stop pass independently; one diagnostic remains. The actual macOS viewport
passes **85/85**, including 16 pixel checks, two counter checks and two saves.
Images show A0/B0 to A2/B0: one healthy A baseline then the preserved fault-batch
TouchStart, before B input. The fault itself adds the second unit/one commit.

This executes one restored publicInstance getter with both flags. Individual
stateNode/canonical faults, permanent/proxy/root accessors, reentrant
stop/retirement, other flags/categories, complete priorities, hardware/mobile,
performance and dev renderer remain open. The preceding Document CI passed
five jobs and 2,723 Document checks; this new getter fixture has its own hosted
CI tracked separately. No new GF, checkpoint, dependency, weight or
denominator closes. Regression gates pass 250 Node/13 Python, 2,723 Document,
193/233 interest, 186 query faults, integrated181/206, 22 examples/2,250,
consumer30/40, fresh SDK pack/verify, loader89/21, 13 adapters/213 and two
portable processor/geometry tests each. The refreshed query-fault baseline
retains twelve negatives; no assertion is relaxed. Details are in the receipt.
[Getter CI37236875765](docs/evidence/pointer-resolver-faults/hosted-ci.json)
passed five jobs at head534d455. Its actual native checkout8ce9a862 and23pins
match implementation/head/checkout. Twelve reports in four audited native
artifacts pass3,400checks, including the same65getterIDs/fullbundle provenance,
193/233interest,2,723Document and186queryfaults. The native digest is declared
by the runner; binaries, captures and old-host control are absent from CI.
Mobile core-reference outputs remain a separate, unaudited scope here.
[Pages37237426598](docs/evidence/pointer-resolver-faults/publication.json)
passed build/deploy with data11dfb3c; the full public JSON and local API match
that commit. Source remains outside main. This hosted audit adds evidence to
the existing slice checkpoints; full GF acceptance remains open.

### Original View pointerup gap reproduced (2026-10-04)

GF-13 remains **In progress**. The [Up negative receipt](docs/evidence/pointer-up/README.md)
uses original View refs and Maps with both flags in two live roots. Independent
manual Up dispatch proves registration, while native Up produces no SDK entry.
The preserved Down-only host retains **54/62 with eight normative failures**
(callback, Raw, React/native commit and qualification in bubble/capture-only).
TouchEnd, typed/star Raw touch, held A while B ends, Cancel and balanced stop
pass independently. This is the preserved negative checkpoint; the correction
and its final paired control are recorded below. No complete GF or new
checkpoint is claimed. View/TT proof does not cover Document/other flags,
listener lifecycle, captured-Up, Down/Up ID identity or full priority mappings.

### Original View pointerup delivery and regressions (2026-10-04)

GF-06/GF-07/GF-08/GF-13 remain **In progress**. Exact Up offsets 36/37 now
qualify original imperative View listeners through the same native processor.
The final current SDK bundle on the preserved native host retains **54/62**
and eight normative failures; the corrected host passes **62/62**. Eighteen
original RN inputs and 16 producers are identical except native C++ and the
native overlay. Capture-only lookup observes 36=false before 37=true. B has
eight real false Up queries while A remains held, no Up delivery/commit and a
healthy TouchEnd. A's trusted Up/Raw produces exactly one React/native commit.
Actual macOS capture passes **90/90**, including 24 pixels, two React-counter
assertions and two saves/dimension checks. Green Up becomes A1/B0; yellow
TouchStart becomes A1/B1. [Evidence](docs/evidence/pointer-up/README.md),
[research](docs/research/pointer-up.md) and [example](examples/pointer-up/README.md)
include actual native frames and distinguish initial history from the final
same-current-SDK control.

All 16 proportional regression commands pass: 255 Node/13 Python contracts,
2,723 Document checks, interest 193/233, query faults 186, ref getter 65,
integrated 181/206, 22 examples/2,250 checks, consumer 30/40, fresh SDK
pack/verify, loader 89/21, 13 actual adapter runs/213 checks and two portable
processor/geometry tests each. The earlier query/getter hosts still reproduce
exactly 12/3 normative failures with the same current SDK, preserving historical
raw controls separately. Their current End traces permit only healthy false Up
phase pairs; Cancel remains empty, Down is never retried and the original
callback/Raw/state/cleanup assertions remain enforced. The dedicated Up probe
owns the no-RawUp negative; Document/interest observers track Down topics.

Execution used the working tree after 3ca4174. The receipt pins 81 unique
executed code/configuration inputs against implementation f7c2cf6bbae4d1ef167ceb94050ee3eb5bf4d01b
using git show, retaining that original execution base and dirty state.
[Hosted Up CI](docs/evidence/pointer-up/hosted-ci.json) at041688c passed all five
jobs; five native artifacts reproduce 62 Up checks and 3,400 preceding checks
in 13 reports. Sixteen producer pins match the actual native checkout5250225.
The CI host hash is runner-declared; old-host control and captures are local. [Pages publication](docs/evidence/pointer-up/publication.json)
passed build/deploy in run 37242930291 with main renderer and branch data
0a2f01e; complete public/local JSON was verified. SDK ABI certification and
public flags remain false.
This scope is View with both flags. Document Up/other flags, listener lifecycle,
captured/no-hit Up, public Down/Up ID pairing, both priority flag branches,
hardware/mobile/dev/performance remain open. No GF acceptance, dependency,
checkpoint, weight or denominator closes.

### Original Document/documentElement pointerup and four flags

[Document Up evidence](docs/evidence/pointer-document-up/README.md) extends the
corrected Up host with ordinary original root listeners and actual Godot touch
terminals. Eight SDK/flag lanes pass **1,371 headless checks**; current/enabled
passes **243 native viewport checks**, with 20 actual pixels and two counter/save
assertions. [The example](examples/pointer-document-up/README.md), research and
README include both actual 760×220 frames (A0/B0→A2/B0 in one native commit).

Document methods require D; View/element require I-and-D. Current SDK qualifies
Document Up with D even without I. Original SDK and D-disabled lanes retain
manual controls and native JSX transport but filter leaf imperative Up.
Document/element/capture-only order, phases, same Up Event object, Raw payload/ID/
timestamp, Discrete restoration and exact root36/37 qualification are checked.
All component lookups belong to the native owning root; no-ref first Down
queries preserve null, while positive Up follows downstream materialization.
Unpersisted D-disabled JSX observes upstream legacy pooling between Up/TouchEnd.

A negative Up cannot borrow B's Document interest while B remains held; B then
receives its own Up. Final listener removal, TouchEnd fallback, real Cancel and
balanced stop pass. Final Down regression passes **2,723 checks**, contracts
**255 Node/13 Python** and static analysis passes. View Up again passes62/62
with its same-current-SDK previous host54/62/eight failures. Native/SDK production sources
are unchanged fromf7c2cf6 and retain its separate SDK proof. This slice adds its
own eight-lane CI gate/artifact. [Hosted run37244296477](docs/evidence/pointer-document-up/hosted-ci.json)
passed all five jobs; the eight-lane1371 artifact,22 RN inputs and actual checkout
e9adb77d/71pins match baseline84270fb. Captures/binary/mobile outputs are separate. Its71
unique executed code/configuration inputs match implementation84270fb via
git show/SHA-256; original execution base0a2f01e/dirty state is retained.
[Pages37244579332](docs/evidence/pointer-document-up/publication.json) passed
build/deploy using main renderer/dataf7696b3; full public/local JSON confirmed.
Publication is separate from the later verified baseline84270fb hosted runtime.

Broader listener lifecycle beyond the following Document bubble slice, retained/retired
refs/remount, dispatch mutation, Up-specific faults/
reentrancy, captured/no-hit/null-target Up, Down/Up ID pairing, got/lost capture,
other event categories and hardware/mobile/dev/performance remain open.
No whole GF, dependency, checkpoint, weight or denominator closes.

### Document Up bubble listener lifecycle: once and AbortSignal

[Lifecycle evidence](docs/evidence/pointer-document-up-lifecycle/README.md) extends
Document Up to **2,143 headless checks** across eight original/current flag lanes.
The graphical current/enabled lane passes **414 checks** in five native frames,
with62 pixels independently decoded from PNGs and five counter/save assertions.
The [example](examples/pointer-document-up/README.md) shows the three actual once
frames A12/B2→A13/B2→A13/B2: first Up increments/commits once; second has no Up
callback/Raw/commit and real root36/37false while TouchEnd/cleanup remain healthy.
Original SDK filtered native Ups leave once installed for the first manual
untrusted control; a second manual control observes consumption without state.

Pre-aborted signals remain inert. Abort-after-first observes the original RN
AbortSignal instance and false→true state, positive manual before/negative after,
no React state/commit/native ownership effect during abort and a negative second
native Up. D-disabled fixtures associate no signal; this does not gate the
AbortSignal class. Down regression passes2723, contracts255Node/13Python, static
and publication scan pass. Production native/SDK bytes are unchanged. Execution
base245ccce/dirty is retained; all71 executed code/configuration inputs match
implementationa3e6c6b via git show/SHA-256. Hosted Contracts run 37246479501
passed all five jobs at fc52215 (merge checkout 3eaf9c2); its
[audited artifact](docs/evidence/pointer-document-up-lifecycle/hosted-ci.json)
repeats the 2,143 headless checks with identical IDs, bundles and lifecycle
stages, and all 71 tracked inputs match a3e6c6b in the checkout tree. The
viewport/pixel proof stays local. [Pages 37308701669](docs/evidence/pointer-document-up-lifecycle/publication.json)
published this record (data bd4ccd6, main renderer); full public/local JSON matched. The older
[84270fb hosted audit](docs/evidence/pointer-document-up/hosted-ci.json)
still confirms the 1,371 baseline checks separately.

This slice covers bubble Document listeners. Other phases and View/element
lifecycle, dispatch-time abort/mutation/reentrancy, refs/remount, Up faults,
captured/no-hit routing, Down/Up ID pairing, full responders, hardware/mobile/dev
and performance remain open. No whole GF, checkpoint, weight or denominator closes.

### Document Up across rerender, retirement and remount (2026-10-05)

GF-06/GF-07/GF-08/GF-13 remain **In progress**. The
[refs evidence](docs/evidence/pointer-document-up-refs/README.md) adds three
root-generation controls to all eight lanes: **2,709 headless checks**, with the
previous 2,143 check IDs preserved in order. The graphical current/enabled lane
passes **535 checks**, including 90 pixels in seven native frames.

A real rerender keeps Document, documentElement, the View ref and the root getter;
the next Up delivers the same listeners and phases. Retiring A while A and B hold
contacts cancels A first: one original TouchCancel with its Raw pair, no Up
callback/Raw/query/state for retained OldDoc/OldRoot listeners, balanced native
Controls and one extra pointerCancel. B keeps its contact and metrics, then its Up
qualifies. The replacement root has a new surface and a fresh connected Document;
retained listeners query 36/37 false for its gestures while a manual dispatch still
reaches OldDoc. The release of the index cancelled by retirement is swallowed even
with fresh listeners installed; the next complete gesture qualifies only through
the fresh Document.

Only tests changed: the shared fixture takes the event type for retained roots
(Down stays the default) and the Up probe/oracle gain the stages. Down regression
passes 2,723, contracts 255 Node/13 Python and static analysis. Native/SDK bytes
are unchanged. Capture-phase or View listeners across retirement, application
stop/restart, keyed remount of the whole tree, general Down/Up pointerId pairing,
dispatch-time mutation/reentrancy, Up faults and captured/no-hit routing remain
open. All 71 executed code/configuration inputs match implementation f7c0bab
via git show/SHA-256 (execution base 3b74ae8/dirty retained). Hosted Contracts
run 37310815360 passed all five jobs at 862e39d (merge checkout 3f52374); its
[audited artifact](docs/evidence/pointer-document-up-refs/hosted-ci.json) repeats
the 2,709 headless checks with identical IDs, bundles and refs stages, and all 71
tracked inputs match f7c0bab in the checkout tree. The viewport/pixel proof stays
local. [Pages 37317251249](docs/evidence/pointer-document-up-refs/publication.json)
published this record (data 2c00f1e, main renderer); full public/local JSON matched.
No whole GF, checkpoint, weight or denominator closes.


### Document Up listener mutation during dispatch (2026-10-05)

GF-06/GF-07/GF-08/GF-13 remain **In progress**. The
[mutation evidence](docs/evidence/pointer-document-up-mutation/README.md) adds
dispatch-time mutation stages to all eight lanes: **4,401 headless checks**, with
the previous 2,709 check IDs preserved in order. Mutations run inside native Up
callbacks in the two current lanes with D, only through manual dispatch in the
original lanes with D, and the lanes without D confirm that nothing registers.
The graphical current/enabled lane passes **835 checks**, including 118 pixels in
nine native frames.

The original dispatcher snapshots each target/phase Map when it reaches it, and
native delivery keeps that contract. A capture listener removing the bubble
listener suppresses it in the same Up; the next gesture queries 36=false/37=true.
Removing or aborting (original AbortSignal) a pending sibling in the Map being
iterated skips it through the `removed` mark. An add to that Map waits for the
next gesture, where the duplicate re-add is a no-op. A capture listener adding
documentElement (I) and Document bubble listeners gets both delivered in the same
Up although the pre-dispatch root query saw only capture membership. An add to
B's Document from A's callback leaves B's state, commits and contact unchanged
until B's own gesture qualifies. A deliberate wrong-phase removal fails eight
probe checks, and the independent oracle rejects that retained report on its own.

Only tests changed: the shared fixture gains `mut-*` kinds (Down unchanged, 2,723
checks) and the Up probe/oracle gain the stages. Contracts 255 Node/13 Python,
22 examples and static analysis pass; native/SDK bytes are unchanged. Reentrant
dispatch, View/element listener mutation, stopPropagation with mutation, listener
errors during mutation, Up faults and captured/no-hit routing remain open.
All 71 executed code/configuration inputs match implementation 4342db0 via git
show/SHA-256 (execution base de89fb2/dirty retained). Hosted Contracts run
37319530371 passed all five jobs at c7e5037 (merge checkout 2717fe2); its
[audited artifact](docs/evidence/pointer-document-up-mutation/hosted-ci.json)
repeats the 4,401 headless checks with identical IDs, bundles and mutation
stages, and all 71 tracked inputs match 4342db0 in the checkout tree. The
viewport/pixel proof and negative control stay local. [Pages 37325323565](docs/evidence/pointer-document-up-mutation/publication.json)
published this record (data d67e981, main renderer); full public/local JSON matched.
No whole GF, checkpoint, weight or denominator closes.


### Document Up reentrant dispatch (2026-10-05)

GF-06/GF-07/GF-08/GF-13 remain **In progress**. The
[reentry evidence](docs/evidence/pointer-document-up-reentry/README.md) adds
reentrant-dispatch stages to all eight lanes: **5,097 headless checks**, with the
previous 4,401 check IDs preserved in order. Reentry happens inside native Up
callbacks in the two current lanes with D; the other lanes keep manual/no-method
controls. The graphical current/enabled lane passes **946 checks** with the same
118 pixels; nested events change no React state, so no frame is added.

A capture or bubble Document listener that dispatches a new `pointerup` on its
Document runs the nested dispatch to completion: all three Document listeners at
phase 2, untrusted, on one Event distinct from the Up, at Discrete priority, and
the nested Event is clean on return. The native Up then resumes trusted with its
phase, currentTarget, target, five-target path and `globalThis.event`, and the
remaining outer listeners run trusted in one commit. Re-dispatching the native Up
throws "already being dispatched" before changing it. A nested dispatch on B's
Document reaches B's listeners with no native query, Raw, state, commit or
contact change; B's next gesture qualifies normally. A retained control that
leaks the nested Event into `globalThis.event` fails three probe checks, and the
independent oracle rejects that report on its own.

Only tests changed: the shared fixture gains `re-*` kinds and a separate nested
channel (Down unchanged, 2,723 checks); contracts 255 Node/13 Python, 22 examples
and static analysis pass; native/SDK bytes are unchanged. Nested dispatch on
elements/Views, nested preventDefault/stopPropagation/errors, deeper nesting,
React updates from nested events, Up faults and captured/no-hit routing remain
open. All 71 executed code/configuration inputs match implementation f0c00ce via
git show/SHA-256 (execution base dbd6324/dirty retained). Hosted Contracts run
37321794370 passed all five jobs at 4a907dd (merge checkout d521569); its
[audited artifact](docs/evidence/pointer-document-up-reentry/hosted-ci.json)
repeats the 5,097 headless checks with identical IDs, bundles and reentry
stages, and all 71 tracked inputs match f0c00ce in the checkout tree. The
viewport/pixel proof and negative control stay local. [Pages 37325323565](docs/evidence/pointer-document-up-reentry/publication.json)
published this record (data d67e981, main renderer); full public/local JSON matched.
No whole GF, checkpoint, weight or denominator closes.


### Document Up root query faults (2026-10-05)

GF-05/GF-06/GF-07/GF-08/GF-13 remain **In progress**. The
[fault evidence](docs/evidence/pointer-document-up-fault/README.md) adds one-shot
root query faults at the Up offsets to all eight lanes: **6,451 headless checks**,
with the previous 5,097 check IDs preserved in order. The faults run in a second
application started after the healthy one stops, so the healthy no-diagnostic
checks keep their meaning; only the two current lanes with D install the query
and consume faults. The graphical current/enabled lane passes **1,179 checks**,
including 132 pixels in ten native frames.

The existing native catch rejects only the failed lookup at offsets 36/37 too. A
bubble throw with Document capture and bubble listeners still qualifies through
capture (36=throw, 37=true) and delivers DocC and DocB in one commit. A capture
throw or a non-boolean result at either offset, with no other qualifying lookup,
delivers no Up, while the original TouchEnd, its Raw pair and contact cleanup
survive. Each consumed fault leaves one retained E_POINTER_LISTENER_QUERY
diagnostic; a capture fault stays armed when the bubble lookup qualifies first.
Recovery gestures and a final B gesture are healthy, and the second application
stops with exactly the four consumed diagnostics. A retained control that
returns true for a throw-mode fault fails nine probe checks, and the independent
oracle rejects that report on its own.

Only tests changed: the shared bootstrap accepts Up offsets 36/37 (Down unchanged,
2,723 checks), the Up fixture exposes the fault hooks and the probe/oracle gain
the stages. Contracts 255 Node/13 Python, 22 examples and static analysis pass;
native/SDK bytes are unchanged. Component and resolver faults on Up, repeated
faults or faults during retirement/stop, captured/no-hit routing and Down/Up
pointerId pairing remain open. All 71 executed code/configuration inputs match
implementation eda1bf2 via git show/SHA-256 (execution base f5660c6/dirty
retained). Hosted Contracts run 37328158081 passed all five jobs at 6f9e10c
(merge checkout ba30dee); its [audited artifact](docs/evidence/pointer-document-up-fault/hosted-ci.json)
repeats the 6,451 headless checks with identical IDs, bundles and fault stages,
the second application's Godot allocation ids differing only by a one-to-one
renaming, and all 71 tracked inputs match eda1bf2 in the checkout tree. The
viewport/pixel proof and negative control stay local. [Pages 37329106287](docs/evidence/pointer-document-up-fault/publication.json)
deployed this record from main 988af3c with the committed data. No whole GF,
checkpoint, weight or denominator closes.


### View Up component query faults (2026-10-05)

GF-05/GF-06/GF-07/GF-08/GF-13 remain **In progress**. The
[View Up fault evidence](docs/evidence/pointer-up-faults/README.md) arms one-shot
throw and non-boolean faults on the actual View ref at offsets 36/37, in a second
application started after the healthy View Up probe stops: **240 headless checks**
(the previous 62 IDs preserved in order) and **268 graphical checks** with the
same 24 pixels. The preceding-host control never runs this phase.

The existing native catch rejects only the failed component lookup. A bubble
throw on a View with capture and bubble listeners still qualifies through capture
(36=throw, 37=true) and delivers both listeners at phase 2 in one commit. A
throw or non-boolean result with no other qualifying lookup on the View hands the
query to its owning-surface ancestors and the root, each read 36 then 37 and
false; no Up is delivered, while the original TouchEnd, its Raw pair and contact
cleanup survive. Each consumed fault leaves one retained E_POINTER_LISTENER_QUERY
diagnostic; a capture fault stays armed when the bubble lookup qualifies first.
Recoveries and a final B Up are healthy, and the second application stops with
exactly the five consumed diagnostics. A retained control that returns true for a
throw-mode fault fails fifteen probe checks, and the independent oracle rejects
that report on its own.

Only tests changed: the shared fault bootstrap accepts Up offsets, the shared
fixture can register capture and bubble on one View, and the View Up probe/oracle
gain the stages. The View Up, query-fault and resolver-fault preceding-host
controls were rerun on their preserved hosts with the new bundles and reproduce
their 8, 12 and 3 normative failures. Query faults 186, resolver faults 65,
Document Up 6,451, Down 2,723, contracts 255 Node/13 Python, 22 examples and
static analysis pass; native/SDK bytes are unchanged. Resolver getter faults on
Up, repeated faults or faults during retirement/stop, other flag branches and
mixed Document/View paths remain open. All 81 executed code/configuration inputs
match implementation f9a3b25 via git show/SHA-256 (execution base 988af3c/dirty
retained). Hosted Contracts run 37330669524 passed all five jobs at 01d3add (merge
checkout fa37a92); its [audited artifact](docs/evidence/pointer-up-faults/hosted-ci.json)
repeats the 240 headless checks with identical IDs, bundle and fault stages, the
second application's allocation ids differing only by a one-to-one renaming, and
all 81 tracked inputs match f9a3b25 in the checkout tree. [Pages 37331641273](docs/evidence/pointer-up-faults/publication.json)
deployed this record from main 84a95ab. The viewport, old-host and negative
controls stay local. No whole GF, checkpoint, weight or denominator closes.


### View Up resolver getter faults (2026-10-05)

GF-05/GF-06/GF-07/GF-08/GF-13 remain **In progress**. The
[resolver evidence](docs/evidence/pointer-up-resolver-faults/README.md) arms a
one-shot getter on the actual View's `canonical.publicInstance` after Down, in the
same second application as the component faults: **296 headless checks** (the
previous 240 IDs preserved in order) and **324 graphical checks** with the same 24
pixels.

Component slot reads already share the query's exception boundary. The getter
restores the original data descriptor before throwing, so the View's first native
lookup (36) fails before any SDK entry and only that lookup is rejected with one
retained E_POINTER_LISTENER_QUERY. The next lookup (37) reads the restored
descriptor and enters the SDK: a capture listener on the same View still
qualifies and the Up delivers capture and bubble in one commit; with bubble only,
the query reaches the owning-surface ancestors and root, all false, and no Up is
delivered while TouchEnd and contact cleanup survive. Recoveries are healthy and
the second application stops with exactly its seven diagnostics. A retained
control whose getter silently returns the ref fails nine probe checks, and the
independent oracle rejects that report on its own.

Only tests changed: the resolver bootstrap accepts a new getter once the previous
one is consumed and restored, and the View Up fixture/probe/oracle gain the cases;
the resolver bootstrap is pinned separately because it is outside the bundle
provenance list. The View Up and resolver-fault preceding-host controls reproduce
their 8 and 3 normative failures with the new bundles. Query faults 186, resolver
faults 65, Document Up 6,451, Down 2,723, contracts 255 Node/13 Python, 22 examples
and static analysis pass; native/SDK bytes are unchanged. stateNode/canonical and
root-handle resolver faults, repeated faults and faults during retirement/stop
remain open. All 82 executed code/configuration inputs, including the resolver
bootstrap, match implementation 6b3554c via git show/SHA-256 (execution base
01d3add/dirty retained). Hosted Contracts run 37332057453 passed all five jobs at
b02ab93 (merge checkout 3265374); its [audited artifact](docs/evidence/pointer-up-resolver-faults/hosted-ci.json)
repeats the 296 headless checks with identical IDs, bundle and stages, allocation
ids differing only by a one-to-one renaming, and all 82 tracked inputs match
6b3554c in the checkout tree. [Pages 37333111502](docs/evidence/pointer-up-resolver-faults/publication.json)
deployed this record from main add4486, and the live public JSON and local API
match it. The viewport, old-host and negative controls stay local. No whole GF,
checkpoint, weight or denominator closes.


### View pointermove native interest (2026-10-05)

GF-06/GF-07/GF-08/GF-13 remain **In progress**. The
[Move evidence](docs/evidence/pointer-move/README.md) lets original imperative
View `pointermove` listeners qualify native emission: **219/219 headless**
(135 healthy plus 84 in a Move-fault application) and **243/243 graphical checks**
with 20 actual pixels, while the preceding host replaying the same SDK bundle keeps
exactly **45 normative failures**.

RN's PointerEventsProcessor emits `topPointerMove` only when the target path
declares PointerMove/PointerMoveCapture ViewProps; an imperative listener sets no
bit, so real moves were dropped before the JS dispatcher. The four Down/Up
interest boundaries now admit Move: the EventTarget overlay query, SDK offsets 1
and 25 (not adjacent), the native callback whitelist and the generated overlay
clause, OR'd after the original ViewProps check. Listeners on the hit View
qualify with 1=true (bubble) or 1=false then 25=true (capture-only) and run at
phase 2; on its parent View the target's empty pair is read first and the
callbacks run at phase 3 or 1. Touch drags and button-less mouse motion each
deliver one trusted callback per dispatched sample with its typed/star Raw and one
functional commit, at the Default priority that the pinned, unfixed mapping gives
the host's unique Continuous moves; with no ContinuousStart outstanding, a plain
Unspecified move would run at Discrete. A View without Move listeners reads its
whole path false in order (itself, parent, AppRegistry container, root handle) and
emits no pointer move; stop is balanced. The host flushes RN's event queue after
every input event, so RN's unique-move coalescing never has a pending move; Godot's
input accumulation merges samples per frame. Because Move lookups run on every
sample, hover included, the host retains each distinct Move lookup failure once as
E_POINTER_LISTENER_QUERY, up to 16 causes per application, and only counts repeats
in pointerListenerQuerySuppressed; Down/Up still report every failure. Repeated
throw and non-boolean faults on A's own Move lookups leave one diagnostic each and
count the repeats, recoveries deliver, and fifteen distinct causes fill the bound
and count the last.

The two native build records differ in 5 of 6,708 entries: the host hash,
application_runtime.cpp, rn-pointer-overlay.mjs and the generated
PointerEventsProcessor tree. The View Up, query-fault and resolver-fault
preceding-host controls reproduce 8/12/3 failures with the new bundles.
On the new host, the three contracts-job gates (contracts 257 Node/13 Python,
static and publication), test:recovery (outside CI) and all 21 native-job suites
pass, including Down 2,723, Document Up 6,451, View Up 296, query faults 186,
resolver faults 65, Move 219, 22 examples and parity:godot; so do native codegen,
fresh SDK pack/verify, adapter registry, loader (89 checks/21 cases) and runtime
(13 runs/213 checks), consumer (30 + 40 checks) and cold start. The native PNG decoder shared by the View Up, Document Up and Move
oracles moved to tests/native-png.mjs. This slice also admits behavior it does not
certify: a Document/documentElement `pointermove` listener now qualifies any move
in its surface through the shared root path. Document pointermove and its flag
matrix, resolver faults during Move lookups, hover events, the per-move query
cost, captured/no-hit moves (non-unique Unspecified in the host, unlike RN),
responders and multi-touch remain open. All 77 executed
code/configuration inputs match implementation f9f9817 via git show/SHA-256
(execution base a0ec86b/dirty retained). Hosted Contracts run 37345287351 passed all
five jobs at 4ca3f1f (merge checkout 9cf35fd); its [audited artifact](docs/evidence/pointer-move/hosted-ci.json)
repeats the 219 headless checks with identical IDs, bundle and stages, including
the 51 fault stages, the second application's allocation ids differing only by a
one-to-one renaming, the 16 expected diagnostics, and all 77 tracked inputs match
f9f9817 in the checkout tree. [Pages 37349051758](docs/evidence/pointer-move/publication.json)
deployed this record from main d75ea51, and the live public JSON and local API match
it. The viewport and old-host controls stay local. No whole GF, checkpoint, weight
or denominator closes.

### Document pointermove across four original flags (2026-10-05)

GF-06/GF-07/GF-08/GF-13 remain **In progress**. The
[Document Move evidence](docs/evidence/pointer-document-move/README.md) certifies
original `pointermove` listeners on Document and documentElement over the View
Move native support, in eight lanes (original/current interest × disabled,
imperative-only, internal-only and enabled flags): **1,932 headless checks** and
**330 graphical checks** with 24 pixels in the current/enabled viewport.

Document listeners exist with native dispatch alone and documentElement listeners
also need imperative events; original interest installs no query and delivers
nothing. With the current query, two drag samples per case reach Document and
documentElement capture listeners at phase 1 and bubble listeners at phase 3,
one Event per sample at the Default priority of unique Continuous moves, with
the original TouchMove after them and one commit per sample. The root query reads
1=true, or 1=false then 25=true for capture-only, after the target's and each
ancestor's false pairs. B's Document listeners stay isolated from A's moves,
removing the last listener between two samples of one contact stops delivery at
the next, Cancel reads nothing, a JSX sentinel qualifies by props in every lane
and button-less mouse motion reaches Document listeners. A retained control that
drops the owner Document from the root query fails 52 (internal-only) and 40
(enabled) probe checks, and the independent oracle rejects both reports.

Only tests changed: the Document fixture accepts `pointermove` (TouchMove on the
target, a JSX `onPointerMove` sentinel and Move Raw) and a wrapper, probe, oracle
and CI step run the matrix; Down 2,723, Document Up 6,451, contracts 257 Node/13
Python, static analysis and the publication scan pass, and native/SDK bytes are
those of the View Move slice. Root query faults, once/AbortSignal, refs, mutation
and reentry for Document Move remain open. All 20 executed code/configuration
inputs match implementation c2ad8f5 via git show/SHA-256 (execution base
2d57c9b/dirty retained). Hosted Contracts run 37351245158 passed all five jobs at
46876eb (merge checkout 9515c0d); its [audited artifact](docs/evidence/pointer-document-move/hosted-ci.json)
repeats the 1,932 headless checks of the eight lanes with identical IDs, bundles
and stages, no lane error line, and all 20 tracked inputs match c2ad8f5 in
the checkout tree. [Pages 37352204907](docs/evidence/pointer-document-move/publication.json)
deployed this record from main a6af188, and the live public JSON and local API match
it. The viewport and negative control stay local. No whole GF, checkpoint, weight
or denominator closes.

### View hover native interest (2026-10-05)

GF-06/GF-07/GF-08/GF-13 remain **In progress**. The
[hover evidence](docs/evidence/pointer-hover/README.md) lets original imperative
View `pointerover`, `pointerout`, `pointerenter` and `pointerleave` listeners
qualify native mouse and touch hover: **158/158 headless checks** (137 healthy
plus 21 in a hover-fault application), while the preceding host replaying the
same SDK bundle keeps exactly **32 normative failures** and never consults a hover
Map.

RN's `handleIncomingPointerEventOnNode` filters hover by ViewProps: out/over when
any node of the previous/current path listens, and leave/enter per node when the
node listens or a leaving/entering capture ancestor does. The overlay ORs the
original-Map query after each check: the path query for out/over and one query
per node for the capture and own offsets of leave/enter, so RN's propagation and
short-circuits are unchanged. The SDK maps offsets 0/23, 2/24, 26/28 and 27/29;
at the root, the Document's bubble listener never qualifies the non-bubbling
enter/leave, only its capture listener and the documentElement do. Hover lookups
share Move's bounded diagnostics. A button-less mouse entering and leaving A's
target with listeners on the target or its parent, bubble or capture, receives
exactly RN's callbacks: out then leave from the target, over then enter towards
it, phases 2, 3 or 1, and a parent capture listener running for the parent and
the target, all at Discrete priority with one Raw pair per dispatched event. A
touch enters its path in the Down, before the Down emission and TouchStart
(`buttons` 1), and leaves it right after the Up emission, before TouchEnd
(`buttons` 0). Manual dispatches keep enter/leave non-bubbling, moving inside the
target emits no hover, B without listeners reads false everywhere, and ancestors
without a public instance are skipped without being created. A repeated throwing
Over lookup is retained once and counted afterwards while enter still qualifies.

Because RN's hover tracker runs before every Down and Move and after a touch's Up
or Cancel, every older pointer probe now observes hover lookups. Their snapshots
keep the certified category in `query.rows` and the hover rows in
`query.hoverRows`, and a final check requires those hover lookups to be healthy
false delegates. The Down resolver fault now lets the target's four hover reads
(26, 28, 23, 0) through and still fails the Down lookup's own read. The View Up,
query-fault, resolver-fault and Move preceding-host controls still reproduce
8/12/3/45 failures with the new bundles. On the corrected host the contracts
gates (258 Node/13 Python, static analysis, publication scan), `test:recovery`
and the 23 native suites pass, including Down 2,731, Document Up 6,459, View Up
297, query 187, resolver 66, Move 220, Document Move 1,940 and 22 examples, each
older probe count including its final hover check; codegen, the native SDK
pack/verify, adapters (loader 89 checks/21 cases, runtime 13 runs/213 checks),
consumer (30 + 40) and cold start pass too.

This slice exposes a divergence that predates it: the empty
surface area has no hit target here, while RN resolves it to the root view. RN
0.87.1 drops root-targeted events before JS (the root family has no event
dispatcher), so Document listeners receive nothing there in either; the
difference is that this host drops the root from the hover path on each
transition into an empty area, so a Document capture enter/leave listener sees
enter/leave for every node of the path, unlike RN's C++ processor. It belongs to
the Document hover certification, the next delivery. (An earlier version of this
paragraph claimed that Document listeners miss events RN would deliver there; RN
delivers none.) Pen hover, touch with other listener
placements, capture while hovering, responders and multi-touch remain open. All
76 executed code/configuration inputs match implementation 5560798 via git
show/SHA-256 (execution base f868160/dirty retained; main a6af188 differs only in
docs and the dashboard). Hosted Contracts run 37352693788 passed all five jobs at
fcaae01 (merge checkout 5d216dd); its [audited artifact](docs/evidence/pointer-hover/hosted-ci.json)
repeats the 158 headless checks with identical IDs, bundle and stages, including
the touch case and the fault stages, the second application's allocation ids
differing only by a one-to-one renaming, and all 76 tracked inputs match
5560798 in the checkout tree. [Pages 37354496135](docs/evidence/pointer-hover/publication.json)
deployed this record from main 2643d4c, and the live public JSON and local API match
it. The old-host control stays local. No whole GF, checkpoint, weight or
denominator closes.

### Root hover path for empty surface points (2026-10-05)

GF-06/GF-07/GF-08/GF-13 remain **In progress**. The
[root-path evidence](docs/evidence/pointer-root-path/README.md) resolves an empty
point inside a surface to the root view, as RN's `TouchTargetHelper` (Android)
and root component `hitTest` (iOS) do: **82/82 headless checks** with a mouse
and a touch, View listeners and Document capture listeners. The root stays in
the processor's hover path between a view and the empty area and leaves it only
for a point outside the root.

The root is never an event target. RN 0.87.1 creates the root family without an
event dispatcher and its EventTarget without an instance handle, and `RootProps`
declares no listener. The host leaked through that boundary: the View hover
slice let the root qualify its own enter/leave, and with a Document capture
`pointerenter`/`pointerleave` listener the processor emitted to the root and
`UIManagerBinding::dispatchEventToJS` dereferenced the missing handle, crashing
the process (opt-in flags only). Now the adapter flags an empty point inside the
root, the binding resolves that JS-less sample to the current root node, the
overlay's path query and enter/leave loops never qualify, read or emit to a root,
and the binding drops any dispatch to a root before touching its EventTarget. A
root's capture lookups still propagate enter/leave to the descendants that enter
or leave with it. A Document capture listener therefore sees container, parent
and target enter at phase 1 when the pointer arrives from outside the surface and
leave when it exits, and nothing between a view and the empty area. A touch drag
into the empty area keeps the root, and its release leaves only the root.

On the View hover host the same bundle fails exactly 9 normative checks in its
View case (the root's own Maps read and the root leaving and re-entering on each
transition) and crashes in the first step of its Document case. The hover probe
now enters and leaves through a point outside every surface and no longer
expects the root's own lookups; the View Up, query-fault, resolver-fault, Move
and hover preceding-host controls still reproduce 8/12/3/45/32 failures. Surface
selection is unchanged: a first empty-area sample still reaches the game. The
validation-only `inverse()` calls in pointer geometry now go through
`require_invertible()`, removing the build's `nodiscard` warnings.

On the corrected host the contracts gates (260 Node/13 Python, static analysis,
publication scan), `test:recovery` and the 24 native suites pass, including Down
2,731, Document Up 6,459, View Up 297, query 187, resolver 66, Move 220, Document
Move 1,940, hover 158, root path 82 and 22 examples; codegen, the native SDK
pack/verify, adapters (loader 89 checks/21 cases, runtime 13 runs/213 checks),
consumer (30 + 40) and cold start pass too. All 76 executed code/configuration
inputs match implementation 71a64c2 via git show/SHA-256 (execution base
1302d51/dirty retained; ea091a0 only records hover receipts). Document hover across the flag matrix, documentElement listeners,
surface selection for empty-area input, pen hover, capture while hovering,
responders and multi-touch remain open. Hosted Contracts run 37359026197 passed all
five jobs at a478778 (merge checkout 0523b27); its [audited artifact](docs/evidence/pointer-root-path/hosted-ci.json)
repeats the 82 headless checks with identical IDs, bundle and stages, and all
76 tracked inputs match 71a64c2 in the checkout tree. [Pages 37360227776](docs/evidence/pointer-root-path/publication.json)
deployed this record from main 3264107, and the live public JSON and local API match
it. The two-part preceding-host control stays local. No whole GF, checkpoint,
weight or denominator closes.


### Document hover across four original flags (2026-10-05)

GF-06/GF-07/GF-08/GF-13 remain **In progress**. The
[Document hover evidence](docs/evidence/pointer-document-hover/README.md)
certifies original `pointerover/out/enter/leave` listeners on Document and
documentElement over the View hover and root-path native support, in eight lanes
(original/current interest × disabled, imperative-only, internal-only and enabled
flags): **1,530 headless checks**.

Document listeners exist with native dispatch alone and documentElement listeners
also need imperative events; original interest installs no query and delivers
nothing. With the current query, a mouse arriving from outside the surface gets
over at the leaf (capture at phase 1, bubble at phase 3) and enter for the
container, parent and leaf on every capture listener at phase 1; moving between
the leaf and the empty area delivers only out/over, because the root stays in the
hover path; leaving the surface delivers out and leave for leaf, parent and
container. Bubble enter/leave listeners on the Document or documentElement never
run, since RN never delivers a root-targeted event. The root reads exactly the
over/out path (bubble, then capture only when bubble did not qualify) and the
capture enter/leave Maps; Views read only empty Maps. A touch enters in its Down
and leaves after its Up. Manual dispatches prove installation and the method gate,
a JSX sentinel with `onPointerEnter`/`onPointerLeave` delivers by props in every
lane, B's listeners stay isolated, and removing the listeners during hover stops
delivery at the next change. A retained control whose SDK ignores the owner
Document for hover offsets fails 34 (internal-only) and 22 (enabled) probe checks,
and the independent oracle rejects both reports.

Only tests changed: the Document fixture accepts `pointerhover` (all four hover
types per listener, hover Raw and a JSX enter/leave sentinel), and a wrapper,
probe, oracle and CI step run the matrix. The shared bundler is pinned by every
preceding-host control, so the View Up, query-fault, resolver-fault, Move, hover
and root-path controls were rerun with the new bundles and still reproduce
8/12/3/45/32/9 failures (the root-path Document case still crashes on the hover
host). The contracts gates (260 Node/13 Python, static analysis, publication
scan), `test:recovery` and the 25 native suites pass on the same host, including
Down 2,731, Document Up 6,459, View Up 297, Move 220, Document Move 1,940, hover
158, root path 82 and 22 examples. All 22 executed code/configuration inputs
match implementation b880b9b via git show/SHA-256 (execution base 3264107/dirty
retained). Viewport capture, root query
faults at hover offsets, once/AbortSignal, refs, mutation and reentry during
Document hover, pen hover and capture while hovering remain open. Hosted
Contracts run 37364101069 (the push of main 15e1dda) passed all five jobs, three of
them in attempts 2-4 after the hosted pool did not run them; its
[audited artifact](docs/evidence/pointer-document-hover/hosted-ci.json) repeats
the 1,530 headless checks with identical IDs, bundles and stages, and all
22 tracked inputs match b880b9b. [Pages 37364101010](docs/evidence/pointer-document-hover/publication.json)
deployed this record from main 15e1dda, and the live public JSON and local API
match it. No whole GF, checkpoint, weight or denominator closes.

### Click on release and scroll takeover (2026-10-05)

GF-06/GF-07/GF-08/GF-13 remain **In progress**. The
[click evidence](docs/evidence/pointer-click/README.md) makes the host
synthesize `click` like RN's platforms and lets a scroll drag take its contact
over, in eight lanes (original/current interest × four flag configurations):
**728 headless checks**.

When a primary pointer releases its main button, the adapter clicks the deepest
mounted view on both the Down and the Up hit paths (Android's
`JSPointerDispatcher`, the web's nearest common ancestor), with iOS's
primary/main-button filter; a contact whose paths share only the root does not
click. The click copies the Up's sample with an offset local to its own target,
is Discrete, follows the Up and precedes the contact's TouchEnd, and never reads
a listener Map. Right and middle buttons, a second finger, a chord released on
another button, a canceled contact, a removed target and a release outside the
surface never click. Godot mounts the AppRegistry View, so two top-level
children click it where RN would drop the click at the root. When the SDK
ScrollView starts a drag, the contacts begun inside it receive one
`pointercancel` and then only touches, like RN's native scroll views, so a scroll
never clicks; a tap on a `Pressable` still presses once.

The SDK base view config now declares `topClick` with `onClick`/
`onClickCapture` (without it the legacy plugin throws on every click with the
default flags), and the SDK Pressable keeps Pressability's `onClick`, which
ignores pointer clicks, as RN's does. The native job timeout rises to 45 minutes
(its suites take 21-24) and the Ubuntu jobs are pinned to ubuntu-24.04. The
preceding host runs the same bundle and fails exactly 31 normative checks; a
host that clicks the release target fails 10, and an SDK without `topClick`
throws in the legacy lane; the independent oracle rejects all three. The six
preceding-host controls that pin the SDK bundle were rerun with the new bundles
and still reproduce 8/12/3/45/32/9 failures; the contracts gates, `test:recovery`,
the 26 native suites and the native SDK batch pass on the same host. Captured
clicks, `auxclick`/`contextmenu`, keyboard and accessibility activation, pen,
nested or horizontal scroll takeover and surface selection for empty-area input
remain open. All 28 executed code/configuration inputs match implementation
8948a1c via git show/SHA-256 (execution base 15e1dda/dirty retained). Hosted
Contracts run 37375758262 (the push of main 72155bc) passed all five jobs in the first
attempt; its [audited artifact](docs/evidence/pointer-click/hosted-ci.json)
repeats the 728 headless checks with identical IDs, bundles and stages, and all
28 tracked inputs match 8948a1c. [Pages 37375758284](docs/evidence/pointer-click/publication.json)
deployed this record from main 72155bc, and the live public JSON and local API
match it. No whole GF, checkpoint, weight or denominator closes.

### Original PanResponder (2026-10-05)

GF-13 remains **In progress**. The
[PanResponder evidence](docs/evidence/pan-responder/README.md) replaces the
platform's throwing `PanResponder` stub (a chart-example leftover) with RN's
original module, which is plain JS over the responder events and their touch
history that this host already delivers; no native code changes. Four flag lanes
cover both of RN's responder implementations: **128 headless checks**.

Touch and mouse drags grant at the start centroid, accumulate displacement and
release with the final state; a second finger starts with two active touches
and each move uses the centroid of both, as `TouchHistoryMath` compares
inclusively; a parent claims vertical moves from a `Pressable` (which presses
out without pressing), a pan view that refuses to yield keeps its gesture after
RN's speculative grant and reject of the parent, and a capture parent wins the
start. Removing the responder's View cancels the contact without a callback to
the unmounted responder, and the next gesture is granted normally. The legacy
plugin and native dispatch produce identical callbacks and gesture state. The
preceding SDK fails at mount when its stub throws, and a PanResponder that drops
the capture-phase handlers fails 6 checks rejected by the independent oracle.
The shared bundler now exports its probe helper, so new probes stop editing a
producer every preceding-host control pins. Those seven controls were rerun with
the new SDK bundle and still reproduce 8/12/3/45/32/9/31 failures; the contracts
gates, `test:recovery`, the 27 native suites and the native SDK batch pass on the
same host. Pinch zoom through chart libraries, `InteractionManager` handles,
hardware velocity, nested scroll views and negotiation with native Godot
controls remain open. All 14 executed code/configuration inputs match
implementation b3327e4 via git show/SHA-256 (execution base 72155bc/dirty
retained). Hosted CI for this slice is pending. No whole GF, checkpoint, weight
or denominator closes.

### AppState from the Godot application lifecycle (2026-10-05)

GF-21 moves to **In progress**. The
[AppState evidence](docs/evidence/app-state/README.md) replaces the SDK's fixed
`AppState` with React Native's original module, read through the public
`react-native` import and fed by the lifecycle notifications Godot delivers to
the `FabricApplication`: **75 headless checks**, with two roots of one Hermes
application sharing one state.

The native `AppState` TurboModule implements RN's generated
`NativeAppStateCxxSpec` and emits through the original
`TurboModule::emitDeviceEvent`. One lifecycle per application takes
`NOTIFICATION_APPLICATION_FOCUS_IN/OUT`, `PAUSED/RESUMED` and
`OS_MEMORY_WARNING`, including notifications that arrive before the runtime
exists. The state is `background` while paused, `inactive` while unfocused and
`active` otherwise: on iOS, where Godot sends FOCUS_OUT on `WillResignActive` and
PAUSED on `DidEnterBackground`, this reproduces RCTAppState's sequence, and a
desktop application that loses focus is `inactive`, iOS's state for a foreground
application that receives no events. Only a new state is sent; every actual
focus change also sends Android's `appStateFocusChange` (`focus`/`blur`) after
the state event, and each memory warning sends `memoryWarning`. A paused game
tree is not the lifecycle (V2-D11) and keeps delivering events. Stopping the
application disposes the module without an event, as Android's `onHostDestroy`
does; `disposeEnvironment()` no longer invents `inactive` and only releases the
AppState listeners. A CommonJS getter keeps RN's lazy `AppState` export, so
bundles that never read it still run on hosts without the module.

On the preceding host (main `72155bc`) the same bundle mounts and stops both
roots but fails its first AppState read with `'AppState' could not be found`:
exactly the 62 normative checks fail. A retained host whose focus outranks the
pause fails 5 checks, and the independent oracle rejects its report. The
contracts gates (260 Node/13 Python, static analysis, publication scan),
`test:recovery`, the 27 native suites (22 examples, Down 2,731, Document Up
6,459, View Up 297, Move 220, Document Move 1,940, hover 158, root path 82,
Document hover 1,530, click 728, AppState 75) and the native SDK batch pass on
the same host. Every bundle that imports `react-native` changes, so the
preceding-host controls that pin the SDK bundle need new bundles; the click
suite's new bundles still pass its 728 checks on the preceding host, which has
no AppState module. Window minimization, real OS focus, Godot Android/iOS
exports (Android would report a transitional `inactive`, iOS also
`focus`/`blur`), Appearance/`useColorScheme`, device configuration and resume
with pending work remain open. All 70 executed code/configuration inputs match
implementation 7087679 via git show/SHA-256 (execution base 72155bc; the
executed tree is the implementation's). Hosted CI for this slice is pending. No
whole GF, checkpoint, weight or denominator closes.

### Touches shared by every root (2026-10-05)

GF-13 remains **In progress**. The
[shared touches evidence](docs/evidence/shared-touches/README.md) makes every
TouchEvent list the active touches of all roots of the application, because
they share one Hermes runtime and so RN's one JS responder and touch history:
**92 headless checks** in four flag lanes over two roots' original
`Pressable`s, with actual Godot touches and the mouse.

Before, each root listed only its own touches: with root A pressed, a touch
ending in root B looked like the last touch of A's gesture, RN released A's
responder and A's `Pressable` pressed with B's touch, a defect every public
responder consumer shared (`Pressable`, `PanResponder`, the touchables). Each
root's pointer adapter now adds the other roots' active touches to `touches`;
`changedTouches` and `targetTouches` keep the touch's own target, and a touch in
another root still cannot claim (no common ancestor). RN's iOS and Android
surfaces each keep their own list (`RCTSurfaceTouchHandler`,
`JSTouchDispatcher`), so this is a deliberate departure in favor of the
single-surface semantics RN's responder is written for. When the responder's own
touch ends while another root's touch is down, the legacy plugin releases at
once, while `ReactNativeResponder` (native-dispatch flags) waits until no touch
remains, as on one RN surface; the lanes of each implementation agree and the
two differ only there. The integrated dispatch probe and the pointer-geometry
example pinned per-root lists and now expect the application's list.

The preceding host (main's PanResponder tree) runs the same bundle and fails
exactly the 9 normative checks. The seven preceding-host controls that pin the
SDK bundle were rerun with the merged bundles and still reproduce
8/12/3/45/32/9/31 failures; the contracts gates (260 Node/13 Python, static
analysis, publication scan), `test:recovery`, the native suites (22 examples,
Down 2,731, Document Up 6,459, View Up 297, Move 220, Document Move 1,940, hover
158, root path 82, Document hover 1,530, click 728, PanResponder 128, AppState
75, shared touches 92, `parity:godot`) and the native SDK batch pass on the same
host. Pointer capture across roots, several touch devices, hardware and mobile
exports remain open. All 16 executed code/configuration inputs match
implementation 1b7dac5 via git show/SHA-256 (execution base 283065d/dirty
retained). Hosted CI for this slice is pending. No whole GF, checkpoint, weight
or denominator closes.

## M1 — Complete the native UI tree

Owners: component descriptors/adapters, Yoga/style schema, paragraph/input and
scroll host. Exit: normal forms, dialogs and large lists
work through public RN imports with applicable upstream behavior.

| ID / priority / work | Status | Required result and acceptance | Completion dependencies |
| --- | --- | --- | --- |
| GF-10 · P1 · View, styles and RTL | In progress | Complete shared View props/styles and StyleSheet/color utilities: logical edges, RTL, baseline/layout constraints, transforms/origin, borders, opacity/clipping, z-order, supported shadows/filters and hit geometry. Reproduce asymmetric border colors before fixing. Certify mount/update/removal, fractional layout, custom colors and dynamic RTL against the pinned schema | GF-04, GF-08, GF-09, GF-25 |
| GF-11 · P1 · Text and fonts | Planned | Complete Text props/events/refs, pressable/selectable spans, inline content, truncation/alignment/decoration, baseline/font scaling and font loading/fallback. Validate bidi, emoji, grapheme clusters, mixed fonts, empty/trailing lines, nested updates and measurement/painting agreement. Define tolerances explicitly where font engines differ | GF-08, GF-09, GF-10 |
| GF-12 · P1 · TextInput and keyboard | In progress | Connect the public wrapper to native controlled/uncontrolled editing. Complete multiline, IME composition, selection/graphemes, secure input, keyboard types/actions, autofill where applicable, submit/end-edit sequencing, undo and commands. Deliver Keyboard/KeyboardAvoidingView and prove real desktop IME and mobile keyboard/insets, including JS transformations and delayed acknowledgements | GF-03, GF-08, GF-09, GF-11, GF-25 |
| GF-13 · P1 · Input, Pressability and touchables | In progress | Complete pointer/touch/responder and PanResponder contracts, multi-pointer identity/capture/cancel, hitSlop/retention, hover, keyboard/focus traversal and applicable touchable behaviors. Preserve event coordinates/priorities under transforms/scroll. Hardware and injected fixtures cover nested negotiation, interrupted gestures, disabling/removal mid-press and no duplicate activation | GF-06, GF-08, GF-09, GF-10 |
| GF-14 · P1 · Scroll and refresh | Planned | Complete applicable ScrollView props/events/commands: animated scroll, drag/momentum sequence, clipping, nested scrolling, paging/snap, platform bounce/zoom where applicable, indicators, refresh, keyboard interactions and resizing. Compare offsets/content/insets and event timing; verify ownership during child gestures and interruption | GF-08, GF-09, GF-12, GF-13, GF-19 |
| GF-15 · P1 · Virtualized lists | Planned | Run upstream VirtualizedList/FlatList/SectionList/VirtualizedSectionList over the completed host. Certify windowing, item identity/state, measurement/getItemLayout, viewability, onEndReached, scrollToIndex failure/recovery, separators/sticky sections and dynamic data. A 10,000-row fixture mounts a bounded window and has measured frame/memory results | GF-10, GF-14 |
| GF-16 · P1 · Images and asset pipeline | Planned | Deliver Image/ImageBackground/AssetRegistry with bundled/URI/data assets, density selection, size/resize/tint/animation, loading/error/progress, caching and public image methods. Native async decode must not block frames; cancellation/unmount and missing/corrupt assets pass exported-app tests. Network image behavior uses GF-22 | GF-03, GF-09, GF-10, GF-22, GF-25 |
| GF-17 · P1 · Shared widgets | In progress | Deliver Button with RN title/onPress semantics, Switch and ActivityIndicator plus their stable props/events/accessibility and platform color behavior. Reuse shared upstream JS wrappers where possible. Verify controlled updates, disabled/focus/loading transitions and consumer imports rather than legacy demo aliases | GF-03, GF-10, GF-13, GF-20 |
| GF-18 · P1 · Modals and safe areas | Planned | Deliver Modal presentation/dismiss/requestClose, overlay stacking/focus/back handling and the pinned SafeAreaView behavior. Handle orientation/insets and root ownership across windows/surfaces. Verify nested dialogs, background focus, keyboard, abrupt unmount and exported mobile presentation | GF-07, GF-09, GF-13, GF-20, GF-23 |

## M2 — Supply the platform runtime and OS behavior

Owners: JSI/TurboModules, animation/event loop, platform service bridges and
accessibility host. Exit: components and public services
observe the real system and retain the original event/callback contracts.

| ID / priority / work | Status | Required result and acceptance | Completion dependencies |
| --- | --- | --- | --- |
| GF-19 · P1 · Animated and layout animation | Planned | Deliver upstream Animated/Easing/hooks and LayoutAnimation with an actual native animation backend and driver semantics. Cover timing/spring/decay, composition/interpolation, event binding, cancellation and layout transitions; synchronize native values and JS callbacks. Measure under JS load, background/resume and reduced motion; complete core animation without requiring Reanimated | GF-05, GF-08, GF-09, GF-10, GF-25 |
| GF-20 · P1 · Accessibility | Planned | Map the semantic tree, roles/labels/state/actions, focus, live announcements, hidden/grouped content and AccessibilityInfo settings/events to the OS assistive technology bridge. Prove screen-reader traversal/activation, keyboard navigation, reduced motion and text scaling on each target. A metadata dictionary alone is not a pass; a missing OS bridge is a release blocker to resolve early | GF-04, GF-07, GF-09, GF-13, GF-25 |
| GF-21 · P1 · System environment and app lifecycle | In progress | Deliver real Appearance/useColorScheme, AppState, device configuration and subscription behavior. Cover system theme changes/manual override, foreground/background/focus, memory pressure and event cleanup. Test window minimization, scene pauses and mobile resume with pending timers/network/animations; remove fixed success values | GF-05, GF-07, GF-09, GF-25 |
| GF-22 · P1 · Networking and web-standard runtime APIs | Planned | Deliver the required fetch/XHR/WebSocket, headers/body/form data/blob and abort behavior, backed by real native networking. Certify streaming/progress/cancellation, TLS/redirect/cookie policies, offline/reconnect and errors with a deterministic local test server. Freeze exactly which pinned RN globals/methods are in scope and verify module disposal | GF-05, GF-21, GF-25 |
| GF-23 · P1 · Shared device services | Planned | Implement applicable Alert, BackHandler, Linking, Share, Vibration, Settings and legacy Clipboard behavior through typed OS modules. Include promise/callback/error/event contracts, deep links and interaction with scene/navigation roots. Verify success, denial, unavailable hardware, lifecycle and cancelled operations on exported consumers | GF-07, GF-21, GF-25 |
| GF-24 · P1 · OS-specific public contracts | Planned | Map every pinned iOS/Android-specific component/API/prop, including InputAccessoryView, StatusBar, PermissionsAndroid, ToastAndroid, ActionSheetIOS, DynamicColorIOS and legacy notification/drawer/progress/touchable contracts. Implement on applicable OSs and reproduce upstream unavailability elsewhere. Compare API/OS-version restrictions explicitly; deprecation does not silently remove the pinned contract | GF-09, GF-12, GF-13, GF-17, GF-18, GF-23, GF-25, GF-34, GF-35 |

## M3 — Make the platform extensible and usable outside the demos

Owners: native module/component registry, code generation, package/export
integration and developer tools. Exit: an independent
consumer project can write TSX, add native functionality, debug and export.

| ID / priority / work | Status | Required result and acceptance | Completion dependencies |
| --- | --- | --- | --- |
| GF-25 · P0 · TurboModule and event infrastructure | In progress | Provide typed JSI TurboModule registration/lazy lookup, get/getEnforcing semantics, NativeModules compatibility, callable modules and native event-emitter contracts. Build a custom C++ example with constants, sync calls, async promises/events and disposal. Test missing modules, exceptions, listener lifetime and per-runtime ownership; support platform bridges without pretending mobile binaries are portable | GF-03, GF-05, GF-07 |
| GF-26 · P1 · Codegen and custom Fabric components | In progress | Integrate upstream specs/schema/codegen with public codegenNativeComponent/Commands, registry/requireNativeComponent and versioned generated artifacts. A consumer builds a new descriptor/view with typed props, events and ref commands without editing the renderer core. Verify schema mismatch failures, mount/update/delete and ABI/export packaging | GF-08, GF-10, GF-25, GF-31 |
| GF-27 · P1 · Selected library certification | Planned | Certify original NativeWind/compiler/css-interop and Chart Kit against the public SDK, including TextInput, theme/scaling and retained state. Expand the local SVG adapter to the declared chart contract and document remaining SVG limits. Tests use package imports in an independent app; publish exact versions and supported features. Reanimated/Gesture Handler/safe-area/screens ports remain explicit P2 unless added to release scope | GF-11, GF-12, GF-15, GF-16, GF-19, GF-21, GF-26 |
| GF-28 · P1 · SDK, addon and consumer exports | In progress | Separate platform SDK/native addon from generic examples. Publish typed JS entrypoints, locked build/codegen tools, supported package resolution, prebuilt native artifacts or reproducible builds, licenses and an export plugin/dependency manifest. Support application entry/root props in existing Godot projects without editing demo source. Verify a clean external consumer and exported debug/release app on every target | GF-03, GF-07, GF-25, GF-26, GF-31 |
| GF-29 · P1 · Development experience | In progress | Supply original dev renderer, mapped JS/native errors, source maps, LogBox/dev settings, Hermes inspection and React Native DevTools integration. Add reliable reload/Fast Refresh with documented state rules and no stale native nodes. Verify syntax/runtime/native exceptions, reconnect, profiler visibility and production removal of dev-only paths | GF-05, GF-06, GF-07, GF-28 |
| GF-30 · P1 · Frame, heap and threading budgets | Planned | Profile mount/layout/shaping/JS and retain reproducible frame-time, Hermes heap/RSS and native-node measurements for idle/forms/charts/10,000 rows. Define target-device budgets before accepting optimization. Implement caching or JS/worker/Rust paths only for measured bottlenecks, preserving JSI ownership, Godot main-thread calls and event/commit ordering. Soak and unmount cycles show bounded steady-state memory. The 48/480-row ScrollView benchmark from the pre-publication prototype was not ported; this item starts without a scroll benchmark | GF-11, GF-15, GF-19, GF-28 |

## M4 — Port, export and certify each supported OS

Owners: native dependency toolchain, Godot export integration and device CI.
Exit: each promised architecture has an installable,
exported consumer with native system integration. Platform feasibility starts
in M0; certification completes after the host and service contracts exist.

| ID / priority / work | Status | Required result and acceptance | Completion dependencies |
| --- | --- | --- | --- |
| GF-31 · P0 · Portable dependency/build foundation | In progress | Replace macOS-framework assumptions with per-target Hermes, RN dependencies, Fabric/Yoga and godot-cpp builds. Specify ABI/compiler/OS minimums and debug/release combinations, hashes/licenses and loader/export behavior. Build an early Android/iOS startup/JSI/Control spike with official templates and identify native-view/accessibility bridge constraints before committing the port design | GF-01 |
| GF-32 · P1 · Linux x86_64 | Planned | Build/load/export on a declared distribution baseline, package shared dependencies and verify window/DPI/input/IME/accessibility/system services. Native headless and graphical acceptance run on a fresh consumer, plus exported application evidence | GF-02, GF-09, GF-12, GF-20, GF-21, GF-23, GF-28, GF-31 |
| GF-33 · P1 · Windows x86_64 | Planned | Establish MSVC/CRT/ABI and DLL discovery/export; verify native startup/shutdown, DPI, keyboard/IME, focus, accessibility and services in exported debug/release consumers. Test installation paths with spaces and fresh machines | GF-02, GF-09, GF-12, GF-20, GF-21, GF-23, GF-28, GF-31 |
| GF-34 · P1 · Android arm64 | Planned | Integrate NDK/JNI/shared dependencies and exported Gradle project without modifying Godot. Prove startup, hardware touch, keyboard/IME, safe insets/orientation, lifecycle, accessibility, network and OS services on emulator and a physical device; debug/release packaging includes all dependencies | GF-02, GF-09, GF-12, GF-13, GF-20, GF-21, GF-23, GF-28, GF-31 |
| GF-35 · P1 · iOS arm64 and simulator | In progress | Integrate static/xcframework dependencies with the Godot Xcode export, respecting linkage/signing/store constraints without modifying the engine. Prove simulator and physical-device startup, touch/IME/insets, lifecycle, accessibility/network/services and debug/release packaging; archive/install evidence uses the consumer app | GF-02, GF-09, GF-12, GF-13, GF-20, GF-21, GF-23, GF-28, GF-31 |
| GF-36 · P1 · Native hosted CI and artifacts | Planned | Add actual native compile/import/headless/graphical/export lanes for macOS and each port, plus device/simulator lanes as applicable. Keep contract CI separate; attach version/platform/mode/source hashes and fail on crashes, script errors, missing assertions or stale reports. Some hardware/AT checks may be retained manual release evidence, explicitly named | GF-02, GF-28, GF-32, GF-33, GF-34, GF-35 |
| GF-37 · P1 · Differential parity certification | Planned | Run the complete GF-01 contract suite against the original pinned RN reference apps and all Godot targets. Compare event sequences/values, ref results, React lifecycle, layout and supported screenshots using predetermined tolerances. Cover errors/denial/unmount/background and physical-device input. Every difference is fixed or a concrete reviewed upstream OS boundary; no blanket or skipped-contract parity claim | GF-01, GF-04, GF-06, GF-08, GF-10, GF-11, GF-12, GF-13, GF-14, GF-15, GF-16, GF-17, GF-18, GF-19, GF-20, GF-21, GF-22, GF-23, GF-24, GF-27, GF-29, GF-36 |

## M5 — Freeze and release 1.0

Owners: release/version policy and acceptance evidence.
| ID / priority / work | Status | Required result and acceptance | Completion dependencies |
| --- | --- | --- | --- |
| GF-38 · P1 · Version and upgrade policy | Planned | Publish tested RN/React/Hermes/Godot/toolchain/OS combinations, private-host seam inventory and supported upgrade/backport policy. Recheck latest stable RN, generate/review API diffs and rerun affected codegen/native/differential fixtures. Record additions/removals and migration notes; choose no nightly dependencies by accident | GF-26, GF-28, GF-36, GF-37 |
| GF-39 · P1 · Release candidate and 1.0 | Planned | Freeze the tested baseline and ship reproducible SDK/addon artifacts, reference consumer projects, installation/export docs and compatibility reports. Pass the checklist below with no unresolved required contract or P0/P1 release defect. A narrower desktop-only or component-subset release must use an alpha/beta label or an explicitly renegotiated scope | GF-01 through GF-38 |
| GF-40 · P2 · Explicitly later scope | Planned | Evaluate the 13 unstable/experimental exports, Web/WASM, extra CPU architectures, editor authoring/GDSS extensions and additional native library ports. Create separate specs and versioned support claims; these cannot hide missing stable core behavior in 1.0 | None; not a 1.0 gate |

## 1.0 acceptance checklist

- [ ] Full contract inventory has no unassigned stable API, prop/style/event,
      command, type or global; all required behavior has fresh positive and
      negative parity evidence. The dated 97-name inventory is not sufficient.
- [ ] Required components include View/Text/TextInput, press/touch controls,
      ScrollView/virtualized lists, images, widgets, refresh, modal and safe-area
      behavior; all applicable styles, refs and accessibility contracts pass.
- [ ] Real system metrics/theme/lifecycle/keyboard, animation, networking and
      applicable device/OS APIs work; no success-shaped fixed-value shim or
      silently dropped behavior remains in the supported contract.
- [ ] Multiple roots, scene changes, errors and repeated unmount cycles preserve
      event/commit semantics and release memory/nodes/subscriptions. Dev and
      production behavior are tested separately.
- [ ] A custom TurboModule and custom Fabric component build, run and export in
      an independent TSX consumer; selected NativeWind/chart package versions
      pass without importing demo internals.
- [ ] Official Godot plus the addon exports debug/release consumers for macOS
      arm64, Linux x86_64, Windows x86_64, Android arm64 and iOS device/simulator.
      Cold startup, physical input/IME, OS services and assistive technologies
      have platform-specific evidence; no engine fork is needed.
- [ ] Native CI passes for the actual release head; required manual hardware/AT
      evidence is attached separately. Contract CI alone is not release proof.
- [ ] Declared device/frame/memory budgets and soak/recovery cases pass; errors,
      crashes, timeouts and stale/missing reports still fail the runner.
- [ ] Latest stable RN support is rechecked, pinned and documented, including
      React/Hermes/Godot/OS minimums and any explicitly approved version choice.
      License notices, artifact integrity and installation/upgrade/export docs
      are complete.

Evidence format for closing an item: exact source commit and dependency
versions, target OS/architecture/device, mode (headless/GUI/exported consumer),
command/fixture, assertion result, limitations and durable report/capture links.
Screenshots supplement behavior assertions; they do not replace event,
reconciliation, cleanup or system integration checks.
