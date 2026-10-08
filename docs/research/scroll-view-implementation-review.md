# ScrollView implementation review

Status: PR #58 merged at `66c948b`; hosted producer `a3fe519` passed its frozen 17/17 artifact audit. The principal accepted the first desktop ScrollView slice only: GF-14 `slice` is accepted in the receipt, while `contract`, `parity` and `targets` remain false. A separate dashboard checkpoint commit is pending; the historical a3 publication snapshot shows 31/156 and is not a live count for that future publication. The evidence does not certify uploaded dylib bytes, ABI, physical mobile behavior, refresh-rate coverage, or full RN parity. See the [curated hosted receipt](../evidence/scroll-view/hosted-ci.json) and [source index](../evidence/scroll-view/source-pins-a3fe519.json). The 13-case parity subset covers core UI on simulators/emulators, not ScrollView parity or physical hardware.

This is the root's implementation-quality review, separate from the research plan and implementer's test report. It applies the thermo-nuclear criteria: simpler ownership, original RN behavior, explicit boundaries and independent executed evidence.

## Historical local review before Text #67: source `3bf129c`

The implementation passes the local structural review at
`3bf129cc8d3720d527f6ca98ea6ce2481acaf2ba`. The public wrapper replaces 259
lines of custom responder, ref and command handling with 16 lines that retain
the original RN component. ScrollMotion owns movement; the existing physical
route owns contacts, capture, surface identity and retirement. Modal wheel
handling now uses that same route and hit path, removing the separate Control
parent walk. The new motion model and runtime probes stay below 1,000 lines.
ApplicationRuntime was already above that threshold on main; this change
extends its existing route rather than introducing another input owner.

Root independently checked the combined Images #66 host `fa9bcca6…`, all 140
native input pins against Git and working bytes, and the 2,713-file SDK package.
The [historical receipt](../evidence/scroll-view/integration-3bf129c.json) records
ScrollView 33, Modal wheel 13, pointer click 8 × 91, lists 44, OS 37,
Performance 43, and Images 72/74/53 checks, plus the headed Images example's
39 checks and eight inspected captures. Canonical measured-state oracles were
replayed independently; altered reports and same-bundle preceding hosts were
rejected. The complete contracts run passes 353 Node and 13 Python checks.
The earlier three native Performance sabotage builds remain historical;
they were not rerun against this Images-integrated host.

The deduplicated inventory contains 889 path hashes: 360 producer-recorded
and 529 calculated after execution. Root recomputed membership and verified
all bytes, including every producer's complete input list. One supplemental
input, `build/nativewind-compiled.js`, is generated and has no Git source pin.
A graphical wrapper receipt had named the invoked copy but hashed its
canonical source; the actual executed copy was preserved and the correction
is explicitly recorded after execution, without recapturing images. The
earlier `18d3478` wrapper-label discrepancy remains documented rather than
rewriting its receipt.

At that historical point, no Contracts run had started for published `d35808a`, because Text #67 had made the PR conflicting. CI and review were pending then. That local review did not establish GF-14's full contract, physical mobile or refresh-rate parity; the dashboard snapshot stood at 30/156 with all four checkpoints open.

## Historical Performance integration: source `18d3478`

This pre-Images local integration is source commit
`18d3478ea9a69fc117fe51b97ea45f4c7b8cde2c`, with host SHA-256
`fa4605bb65a310e177cbf702dddac7a219ddfe46889880edcedbb7ad5f980ba9` and build
receipt SHA-256
`d9e833f98f5ffa26b28a1d8c0d539bdb8d73515d03ec00c188559bce258a6b4c`. The
[integrated evidence receipt](../evidence/scroll-view/integration-18d3478.json)
and [source-pin inventory](../evidence/scroll-view/source-pins-18d3478.json)
record 136 native input pins matching Git and working bytes, plus each local
probe and bundle identity. The inventory references canonical repository,
React Native, VirtualizedList and third-party maps with 738 path entries across
those source roots. The six group files list declared producers and supplemental
metafile imports separately, then reference hash-pinned bundle receipts for the
exact input memberships. Each path hash is stored once in its origin map. The
inventory separates 283 producer-recorded hashes from 455 computed after
execution; supplemental metafile paths do not imply esbuild recorded hashes.
The 2,713-file SDK package was locally verified;
adapter linking/loading, runtime identity and ABI certification are not
claimed.

The integrated local results are ScrollView 33/33, Modal wheel 13/13, pointer
click 8 × 91, VirtualizedList 44/44, OS contracts 37/37, and Performance
43/43. The Performance oracle independently derives the report, rejects its
three sabotage controls (4, 3 and 2 failed checks), and confirms 28 expected
failures on the retained preceding host with the same bundle. ScrollMotion's
44 core assertions and PerformanceMetrics also pass. The complete local
contract run passes 352 Node and 13 Python checks; static and publication
checks pass. Root inspected the four ScrollView and two Modal captures.
Their host and bundle links were checked, but a later audit found that the
graphics receipt stored the canonical runner hash beside the copied runner
path; that historical runner identity is not verified.

These were local macOS results. CI and CodeRabbit for integrated source `18d3478` were pending at that time; success and approval from published `4aba7f5` applied only to that earlier head. The dashboard snapshot then stood at 30/156 with all four GF-14 checkpoints open. No mobile hardware, refresh-rate matrix, complete RN parity
or full GF-14 acceptance is established. Earlier host-specific reviews below
are retained as historical diagnoses, not as evidence against or in place of
this integrated run.

## Ownership and structural changes

The direction under review removes the custom JS scroll/responder implementation
and its private `scrollDragStart/To/End` protocol. RN 0.87.1's original ScrollView
owns its public component, refs, child structure and responder behavior. A small
public contract seam rejects native features that the Godot host cannot honor.
It does not change `Platform.OS` or inject a second pointer stream.

The native content is a clipped Control. ScrollMotion is the single authority
for the fractional logical offset; paint uses the committed Yoga content origin
minus that offset. Fabric state, events, DOM geometry and input must agree with
it. Retaining ScrollContainer's integer getter, independently patching its paint
position after sorting, or writing the offset in a JS responder would preserve
multiple competing authorities and is rejected.

ApplicationRuntime retains physical contact and surface identity. Its existing
pointer arbitration supplies the native scroll candidate; PointerAdapter cancels
the child stream when that candidate wins. Motion uses the existing frame clock.
Final review still requires that retirement, capture and responder blocking use
these canonical owners without a second lifecycle or leftover compatibility mode.

The duplicate `pan_claimed` state in the application route has been removed:
the route locates the ScrollAdapter, which alone knows whether that pointer owns
the drag. The public wrappers retain the original ScrollView.Context explicitly.
The root repeated the contract, platform seam and relocated typed-consumer suites:
26 tests passed. This verifies those boundaries, not the rebuilt native host.

## Independently reproduced movement defects

The root froze the inputs and headers before each correction, then repeated the
same inputs against the corrected headers. These local C++ witnesses do not
certify a mounted host or a published PR tree.

| Finding | Before | Corrected repetition |
| --- | --- | --- |
| Release discarded the Up coordinate when no final Move arrived | Offset 90 instead of 120 | Offset 120 |
| Momentum discarded elapsed time and depended on frame partition | Ten 20 ms ticks: 211.418; one 200 ms tick: 133.989 | Both: 241.296 |
| Velocity retained movement from before a one-second stationary hold | Release velocity 52.2565 and Momentum | Velocity 0, Idle, offset 300 |

The retained witnesses are under the ignored `build/scroll-motion-root/` tree:
`negative-receipt.json`, `current/positive-receipt.json`, and the paired
`held-after-move/` receipts. They record input/header hashes and exit status.
The correction integrates exponential decay over the whole elapsed interval,
commits the final release coordinate, and uses a bounded recent sample window.
The 250 ms velocity window is a Godot desktop implementation policy; no claim
is made that it reproduces Android or iOS's velocity tracker.

## Other required corrections

- End momentum exactly once on accepted Down, command replacement, wheel,
  disable, resize and retirement. A stationary Down must stop in-flight motion
  before reaching the pan threshold.
- Resolve content by ObjectID rather than testing a potentially freed raw
  pointer with a cast. Test real content deletion/replacement while its parent
  remains mounted.
- Constrain indicator geometry for viewports below the minimum thumb size;
  `std::clamp(value, 18, viewport)` is invalid when the viewport is smaller.
- Calculate event throttling from the double precision clock rather than from
  the float RN event timestamp. Validate non-finite public/native inputs.
- Preserve the existing list windows and exact offsets with deliberate
  stationary releases. Test flings in the dedicated GF-14 fixture, rather than
  rewriting those consumer assertions around an unmeasured terminal offset.
- Reject native options still outside the supported slice instead of allowing
  the original JS component to forward them to a host that ignores them.

## Mounted command repetition and identity boundary

The root independently repeated the original/public command probe on host
`3d943025afdf0ea37eea04c0f0668cb8e82f24c885afe60945b777f7ab72e18c`.
Explicit immediate scrollTo reaches 40, omitted animation accepts a y-only
command and advances, and animated scrollToEnd advances toward the content end.
Paint follows the logical fractional offset in all thirteen captured phases.
Both mounts stop with zero roots, native tags, memberships and pending retirements,
and the log contains no unexpected error. The ignored
`build/scroll-fix-root/root-review.json` records host, build-receipt, bundle,
report and log hashes.

The first root attempt required the previously announced host identity but the
implementer had already rebuilt it. That identity mismatch was rejected and
retained separately; it is not a behavioral failure. Later source changes require
another build and final producer-pin verification. These bounded observations
do not establish terminal animation, pan/momentum, DOM/input, lifetime, graphics,
mobile parity or acceptance of the final implementation.

## Final acceptance gates still open

The preceding desktop host has been recovered from the retained Modal build:
`0dd35f6cbf45878ff66bf4c93db0a1c2c12ac1b2bb91e56566072cacef7d86b8`.
The root compared all 95 source pins in its frozen SDK receipt with merged
`main` (`7e2df46`): all match. This permits an isolated preceding-host control
without replacing the working addon or interfering with the implementer.

The list regression is still a release blocker. Its original fixed offsets and
window assertions are retained. Two confirmed fixture differences are the
original RN ref ownership and the absence of the custom content testID: the old
geometry helper subtracted a missing-node sentinel, producing a false span of
1000 for feed index 60 instead of its unchanged expected 2440. Measuring actual
mounted transforms corrects the reproducer without changing that expectation.

Two product defects were exposed by those consumer checks. A growing measured
content extent canceled the active drag at agenda offset 100 instead of 150.
Event sampling compared against the last *emitted* offset, so the same throttled
offset was counted on subsequent layout calls and later emitted without another
input. Both require corrections in the native owner, followed by a rebuild and
the same consumer assertions; changing the expected offsets or accepting those
extra events would mask the regressions.

The final fixture must derive pointer locations from mounted geometry. Resizing
the Surface alone does not prove a smaller fixed-size ScrollView viewport. An
animation already clamped to zero cannot prove removal during positive motion.
Removing rows alone does not prove retirement of the content Control itself.

Approval requires positive and preceding-host negative evidence with identical
inputs, independent report derivation, strict unexpected-error rejection,
compiled source/host identity, clean terminal ownership, existing consumer gates,
graphical captures and final hosted CI/CodeRabbit review. No check count, local
compilation or passing command probe substitutes for those gates.

The first 17-check mounted report did not establish completed momentum: its
native-pan phase still had motion=Momentum, one MomentumBegin and zero
MomentumEnd. The root retained that report separately and required a bounded
wait for Idle, exactly one completed event sequence and a final offset matching
the measured EndDrag target. The tap-threshold control must also use a child
that does not capture its pointer, so capture cannot conceal a broken threshold.

## Horizontal native prop boundary

The unchanged 44-check list fixture now passes 42 checks. The two remaining
shelf checks exposed a real host-boundary failure: RN's original
`ScrollViewNativeComponent.js` selects the iOS static config when
`Platform.OS` is `godot`, and that config omits `horizontal` from its valid
attributes. The public component forwards the prop, but the attribute payload
filters it before `BaseScrollViewProps` sees it. The adapter therefore remains
vertical and rejects the horizontal gesture as cross-axis movement.

The diagnostic report distinguishes this from hit testing, capture and responder
blocking: the mounted row receives Down, Move and Up; active and pending capture
remain zero; the native candidate exists with `horizontal=false`, while no drag
begins. Replacing the second-root pan assertion with a command assertion would
hide this defect and is not acceptable proof.

The correction must add the missing attribute only to the final registered
`RCTScrollView` config, preserve the original RN component and `Platform.OS`, and
leave ordinary View attributes unchanged. Approval still requires the unchanged
180 px shelf oracle and a real horizontal pan in the second Fabric root.

The first run with the component-specific config passes all 44 original list
oracles. The root independently reran the report's derived oracle and verified
the loaded host (`94841a64`), bundle (`ddc4a032`) and eight compiled native
producer pins. Shelf's logical/Fabric x=180 agrees with painted content x=-180;
the stationary release emits exactly one BeginDrag and EndDrag, with zero
momentum events and no remaining candidate. This report is frozen in ignored
`build/scroll-view-list-root/first-horizontal-positive/`. It closes the diagnosed
horizontal regression, but does not replace the final isolated runtime repeat,
second-root pan, graphical evidence or hosted acceptance.

## Axis policy and final independent repeat

The final review found that `scrollToEnd` moved both coordinates to their maxima
when content overflowed both axes. Align the Godot desktop command with pinned
Android's primary-axis policy: horizontal mode reaches the right edge while
retaining the vertical offset, and vertical mode reaches the bottom while
retaining the horizontal offset. This is a declared desktop policy, without an
iOS parity claim.

The root independently executes the final bundle `89998144` and probe `07c8fc29`
in two isolated projects using current host `60fa18ed` and preceding host `0dd35f6c`.
All eight compiled current source pins match, and the preceding host's 95 source
pins identify merged commit `7e2df46`. The current host passes 22/22: fractional
13.25 logical/Fabric/paint offsets agree; momentum completes once with its
settled offset matching the measured end target; horizontal native pan leaves
the vertical root unchanged. With both axes overflowing, horizontal end reaches
x=540 and retains y=35; vertical end reaches y=590 and retains x=55.

The preceding host executes the same 22 checks, fails 18, and reports exactly 11
expected old command-protocol errors. Its end command and rejected resets leave
the second root at the right edge before the pan; that final negative phase is
a command cascade, not a fresh-root pan control. The earlier isolated comparison
retained that fresh-root control. Neither negative count represents independent
bug counts. Both runs stop without a crash, pending work, roots, tags, pointer
routes, contacts or captures. The durable independent receipt pins original
report bytes separately from the normalized root copy. Hosted acceptance stays
open until CI and CodeRabbit approve the integrated PR.

## Diagonal pan boundary found during integration

The integrated source review found another native-owner defect: candidate
selection checks the configured axis, but drag and release pass the full pointer
vector to the motion model. With both axes overflowing, a vertical-dominant
delta (-30,-50) from offset (100,100) yields (130,150) and velocity (600,1000);
horizontal-dominant (-50,-30) yields (150,130) and (1000,600). A straight gesture
cannot expose this cross-axis movement and momentum. Normalize motion input to
the selected axis while retaining the initial transverse coordinate, including
the release coordinate. An orientation change during a held gesture must retire
the current drag through the existing cancellation owner before accepting the
new orientation. The preceding 22-check evidence remains valid for its stated
cases, but cannot approve this boundary or the integrated host. Mounted diagonal,
release, momentum and orientation controls are required before PR publication.

## Integrated local review completed

The final source projects movement and release into the configured axis in the
existing native offset helper. It adds no second gesture flag or compatibility
mode. An orientation change cancels through the existing owner before the new
props are installed. The identity projection at gesture start and a nullable
release fallback were removed: both obscured invariants without adding behavior.

The root independently runs bundle `c879de5c` and probe `c1e7b821` against current
host `4f28ed0f` and retained preceding host `60fa18ed`, in isolated projects with
the same 16 framework binaries. Current execution passes all 25 checks; preceding
execution fails exactly vertical diagonal, horizontal diagonal and orientation
replacement. Both terminate with zero roots, tags, contacts, captures, routes,
timers and pending work. The logs reject unrelated engine, script and Fabric
errors. All eight current compiled native source pins match the tested sources.

Independent report derivation verifies vertical release `(80,150)` with x
velocity zero and settled x=80; horizontal release `(150,70)` with y velocity
zero and settled y=70. Active-axis settled offsets agree with the reported
momentum targets, Fabric and painted translation. Each sequence completes one
BeginDrag, EndDrag, MomentumBegin and MomentumEnd. Orientation replacement ends
the claimed drag at the change, and later Up does not emit another EndDrag.
The preceding host instead changes transverse release coordinates to 110 and
100, emits transverse velocity and retains the claimed drag at orientation
replacement. These controls expose the diagnosed defects without accepting
unrelated failures.

The public boundary now rejects valid scrollPerfTag, scrollsChildToFocus,
keyboard callbacks and removeClippedSubviews=true rather than silently ignoring
them. The false clipping opt-out remains accepted. The root also independently
derives the final 44-check list oracle, shelf offsets `(180,180,-180)`, and the
three exact sabotage failures; forcing their check flags green still fails the
independent feed-window oracle. All four graphical receipt artifacts match their
recorded bytes and final host/bundle, and the root inspected the rendered clipping
and empty cleanup frame.

See [the integrated independent receipt](../evidence/scroll-view/root-integrated.json).
The thermo-nuclear local structural and behavioral review was satisfied for this
desktop slice. At that historical point final publication, CI and CodeRabbit review were still required; that local evidence alone did not accept a GF-14 checkpoint or the full contract.

## Interrupted drag and neutral option review

A later root review reproduced two further defects on retained host `4f28ed0f`.
Wheel replacement moved y=130 to 178 and changed `contentOffset` moved it to 260,
but both left the pan candidate claimed while motion was Idle. Subsequent Move
was swallowed and EndDrag arrived only on Up at the replacement offset. The
earlier 25-check review did not cover these interruptions.

The canonical native interruption owner now retires a claimed pan before
canceling motion or applying the external offset. Duplicate command retirement
branches disappear; canceled finish uses the existing motion cancellation
directly. It adds no candidate flag, gesture mode or fallback owner.

The CodeRabbit boundary finding also exposed an overly broad unsupported-option
set. One explicit option policy now distinguishes host-equivalent values from
active unsupported requests. Neutral false flags, keyboard dismissal `none`,
touch cancellation enabled and persistent indicators enabled pass through.
`canCancelContentTouches=false` and `persistentScrollbar=false` request behavior
the host does not provide and remain rejected. Valid active options and callback
types have positive and negative boundary coverage. A mounted original RN
component using neutral values scrolls to `(12,24)` without errors.

After integrating Accessibility from main #57, the root independently executes
the final 28-check bundle `29f2c928` and probe `3c42b5ef` on host `bbb683e2` and
retained host `4f28ed0f`, with identical framework bytes. Current passes 28/28;
preceding executes all 28 and fails exactly the two interruption controls with
two expected check errors. Both fully retire runtime and pointer ownership.
Independent report derivation confirms EndDrag at y=130 before scroll to 178
or 260, retired candidates before later Move and Up, one EndDrag and no new
momentum. Logical offset, Fabric state and painted translation agree.

The root verifies the 44-check list oracle and exact three-failure sabotage;
forced-green flags still fail that oracle. All four current graphical artifacts
match their receipts. Independently read PNG pixels inside `(554,109)` are
`(29,78,216)` and outside `(680,109)` are `(245,248,250)`, confirming clipping.
The integrated Accessibility oracle independently passes 80 metadata checks.
Other affected regressions pass 594 Accessibility core assertions in 11 groups,
76 Text layout checks, 76 native module checks and 65 Device Services checks.
No OS accessibility tree or hardware certification follows from these lanes.

All 112 native producers and 18 bundle producers match committed Git blobs at
`0273dc38`; six installed RN inputs match the pinned sources. The complete
contract gate passes 331 Node and 13 Python tests, with static, type, publication
and dashboard gates passing. The implementation retains canonical ownership
and the structural simplifications from this review. At that stage hosted acceptance was pending, and that local review had not accepted a GF-14 checkpoint.

See [the independent interruption proof](../evidence/scroll-view/root-interruption.json)
and [committed producers](../evidence/scroll-view/committed-source.json).

## Final Images integration repeat

Main #56 introduces Image providers, worker decoding and lifecycle in the shared
host, while #60 adds the Frontier milestone to the dashboard. Integration at
`6b2833e` preserves both the Image branch and the plain Control scroll owner,
both native core test targets, every other agent's task and the entire additive
milestone. Board-reported Image paths during the merge were verified byte for
byte as inherited main inputs; after the merge our slot has no conflict.

The root repeats the final frozen bundle `7944e7ca` independently on rebuilt
host `840d7f3e`: all 28 controls pass with full runtime and pointer cleanup.
Report derivation reconfirms the interruption ordering, diagonal active-axis
momentum, orientation retirement and mounted neutral options. The 44-check list
oracle and three-failure sabotage remain effective. The root independently
verifies the 80-check Accessibility and 74-check Image oracles, every final
capture hash and the clipping pixels from the new horizontal frame. Other
affected regressions and the four graphical checks pass on the same frozen host.

All 123 native producers, 18 bundle producers and six installed RN inputs match
the committed sources. Updated contracts pass 351 Node and 13 Python tests;
static, type, publication and dashboard gates pass. No new source file crosses
the thousand-line boundary. No additional scroll flag, owner or compatibility
protocol was introduced by integration. The prior 28-check negative pair is
preserved with its own bundle and identity, without mixing it into this run.

See [the final independent integration receipt](../evidence/scroll-view/root-images-integration.json).
Local thermo-nuclear review was satisfied for this first desktop slice. At that historical point, CI, CodeRabbit and acceptance were pending; the full GF-14 contract remained open.


## OS-specific integration review

Main #61 adds original RN OS-specific APIs to the shared facade and optional
platform-root/plugin inputs to the common probe bundler. Merge `43d0375`
preserves both facade export sets and both typed consumer imports. The bundler
keeps the existing default path, with the new inputs used by the OS negative
controls. It does not duplicate the bundle pipeline. Native sources and all 123
recorded native producer hashes remain unchanged, so the same verified host
`840d7f3e` is reused without a rebuild.

The GF-14 bundle changes to `f2af26ef`; evidence for `7944e7ca` remains
historical. The root executes the new bundle in a fresh isolated project and
independently derives all 28 controls, with full runtime and pointer cleanup.
The 44-check list oracle, exact three-failure sabotage and forced-green oracle
rejection pass. OS contracts pass 37 checks; the previous SDK and three sabotage
variants are rejected. Accessibility, Images, Text and Device/launch oracles are independently
rechecked on the frozen host. NativeModules and Metrics/Errors also pass their
native assertions. Four new graphical executions pass; the captured PNG bytes
are identical to the earlier Images-integrated images.

The producer proof now binds 123 native inputs, 18 recorded GF-14 bundle inputs,
six installed RN inputs and 40 supplemental repository bundle inputs to
`43d0375`. The supplemental map includes the new OS facade and common bundler.
The groups overlap and do not certify the external SDK adapter ABI. Contracts
pass 351 Node and 13 Python tests; static, type, publication and dashboard gates
pass after integration.

This merge introduces no additional ScrollView state, offset authority, private
command protocol, compatibility mode or cast. The separate wrappers preserve
the original RN component contract and the facade's inline-Text boundary. No
source file crosses the thousand-line threshold. The earlier structural
simplifications remain intact, satisfying local thermo-nuclear review for this
desktop slice. CodeRabbit's approval of `3fe88da` applied only to that earlier head. At that stage hosted CI and review for the new head were required, and the full GF-14 contract and all four checkpoints were still open.

See [the current independent receipt](../evidence/scroll-view/root-os-integration.json)
and [the facade regression receipt](../evidence/scroll-view/facade-regressions-43d0375.json).


## Legacy example migration review

CI on `4a6dd92` exposed the unconverted ScrollView example. Local reproduction
identified the failing ScrollContainer assertion and missing `inventory-content`
lookup. Hosted checkout `2236b0d` passed 62 legacy checks and has exactly the
same Git tree as main `dd05760`; this failure is introduced by the migration,
not inherited from main. No failure report was generated before the early quit.

Correction `a0f1fc77` changes only the example and its validator.
Geometry uses the committed rows and scroll metrics instead of a wrapper's
private content testID. Instant commands explicitly request `animated:false`;
default animation must make progress and finish idle with Fabric and painted
content aligned. Wheel interruption is followed by a held Move and Up, with
no resumed drag, extra terminal event or momentum. The fixed-height category
strip disables RN's default flex growth in the consuming example.

The old JS wrapper conflated Pressability's `cancelable` transfer policy with
native pan blocking. Pinned RN 0.87.1 sources distinguish these paths:
Pressability Grant returns `blockNativeResponder`, ScrollView's responder
reject handler is a no-op, and native Android/iOS interception does not query
a child's `cancelable` option. The fixture now verifies native cancellation
of that child and separately verifies explicit native blocking and release.
This is source-based analysis, not mobile parity certification. No private
termination-request protocol, runtime flag or second offset owner was added.

Final runs pass 73 headless and 79 headed checks. The principal repeats all
73 checks in a fresh project with the copied host and dependency frameworks,
checks complete shutdown, and views the final captures. The full 34-scenario
example suite passes 2,457 checks before the final category presentation
adjustment; final focused runs cover that adjustment. Four dedicated
ScrollView tests, type checking and static checks pass. All 213 overlapping
producer comparisons for the dedicated native, ScrollView, list, OS and
supplemental groups still match committed sources.

The patch removes stale assumptions without adding a compatibility layer or
changing native/shared sources. Both modified files remain below 1,000 lines.
Local thermo-nuclear review is satisfied for this correction. The prior CI
failure, new hosted validation and acceptance remain separate evidence.
See [the reproduction and independent correction receipt](../evidence/scroll-view/legacy-example-regression.json).


## Pointer regression review and AccessibilityInfo integration

The pointer suite was byte-identical to main's successful baseline. CI on
`d785d1c` exposed stale assumptions at the ScrollView migration boundary: an
anonymous host-row sentinel selected the content View instead of the shared
AppRegistry parent; native ownership now cancels both child streams; measured
momentum advances the offset after release. RN Android's native ScrollView source
cancels the JS gesture before its BeginDrag event as well. This is source
analysis, not mobile differential parity.

The first proposed identity fix incorrectly used the surface documentElement.
The principal rejected it before acceptance. Correction `b097fb3` uses the
original RN sibling-parent relationship and requires a distinct mounted parent.
It deletes anonymous-row lookup helpers and silent null-to-zero tag coercion.
GDScript normalizes numeric tags only at the event-row comparison boundary.
A stationary hold separates exact drag displacement from fling behavior; the
probe retains the exact 55-to-0 offsets rather than accepting a broad range.
The oracle requires the same pointer, both typed/star pointer and touch cancel
pairs before BeginDrag, no later child move/end/click, no momentum and clean
routes. The principal replays all 26 cases and rejects 16 damaged reports.

Only three test files change for this correction; no native implementation or
shared bundler branch is added. All stay below 1,000 lines. No compatibility
mode, wrapper identity magic or second offset authority is introduced. The
final correction satisfies local thermo-nuclear review.

Integration `cae0d2e` preserves main's AccessibilityInfo feature, ScrollView
contracts, both type imports and dashboard history/milestones. New host
`b4dfdbda` passes all eight pointer lanes, ScrollView 28, lists 44, OS 37,
AccessibilityInfo 54 and legacy example 73; the independent measured scroll and
cleanup verifier passes. Old host-bound controls are archived and current list
and OS SDK controls are rerun. Four graphical checks pass with unchanged PNG
bytes, all visually checked. Contract checks pass 352 Node and 13 Python tests.
127 build inputs and 181 distinct repository producers match the committed
tree; group counts overlap. SDK packing/verification is experimental and does
not certify an adapter ABI. The failed hosted run and historical successes
remain separate from these local results. At that historical stage, hosted CI, new-head CodeRabbit review and GF-14 acceptance were pending.

See [the historical integration receipt](../evidence/scroll-view/click-regression-and-accessibility-integration.json)
and [producer map](../evidence/scroll-view/committed-source-cae0d2e.json).

## Capture authority and hidden-contact retirement

CodeRabbit's two findings at `3e29553` are real. A sibling outside the Down
path can receive capture from RN's original processor; limiting the query to
that path lets native pan steal it. Separately, hiding a still-mounted child
removes its PointerAdapter contact but previously left its runtime scroll
candidate active. The principal confirmed capture loss and a 36 px offset on
the old host, and a hidden row with the same tag, no adapter contact, an active
route and a surviving scroll candidate. `display:none` unmounts this fixture;
the regression uses a singular scale that actually enters subtree hiding.

The structural correction in `465ae76` removes `RoutedPointer.down_path` and
the associated out-parameter/clears. Capture is queried on the current surface
revision through RN's existing `hasPointerCapture`, with one tree traversal
instead of a separate owner cache or a second capture API. Physical-contact
removal calls the existing route synchronizer immediately. Cancellation clears
the route's scroll authority before callbacks. The extra duplicate cancellation
on release is deleted. This removes state and redundant work rather than
introducing feature flags into unrelated flows.

EventDispatcher runs native listeners inline. Any use after dispatch or
takeover re-resolves the route by key and identity; starting a pan also
re-resolves its mounted adapter. Terminal cleanup cannot erase a replacement
contact. The principal rejected an unnecessary removal boolean and an
inconsistent terminal guard before accepting this version. No permanent change
to the RN capture overlay or private interface is needed.

The permanent probe has 33 unique checks. On `b4dfdbda`, exactly four fail:
sibling capture retention/release, hidden touch retirement and hidden mouse
suppression. Cleanup still succeeds. On the rebuilt `b2a8` host all 33 pass.
An independent verifier derives the five new cases from measured booleans,
offsets, identities, cancellations and route counts, and rejects the old report
and nine damaged copies. Failed parser/instrumentation attempts remain distinct
from the accepted red evidence; string capture queries in the isolated
reproducer are not claimed as typed booleans in the permanent report.

Main's Images #64 arrived before publication. Integration `2a01ec6` preserves
the incoming Images sources, both CMake test target sets, GF-16 history, GF-18
acceptance and unknown dashboard/milestone keys. Its new host `78707871` passes
ScrollView 33, lists 44, OS 37, click eight lanes of 91, Images base 73 and
network 74. Canonical SDK/sabotage controls are regenerated for the current
host. The base Images contract expects 73; the network contract expects 74.
Temporary native sabotage changes restore both sources and host byte for byte;
the Images agent is informed through the board.

The principal replays the measured scroll/list/OS/Images oracles, all 26 click
cases in every lane, and all 134 native Git/source pins. A root audit that could
skip a missing click case is corrected to iterate the required inventory and
reject a missing-case control; 17 damaged click reports are rejected. Four
graphical captures are viewed. The executed graphical probe copy differs only
in `CAPTURE_DIR`; both actual and original hashes are recorded. Local gates
pass 352 Node and 13 Python tests, static analysis and publication scanning.
Supplemental `b2a8` runs are preserved as historical rather than silently
relabeled with the new host.

The principal also rejects a stale SDK verification-log reference in the
Luna draft: it targeted the previous AccessibilityInfo package. The exact
`native-sdk-scrollview-fb50` package is verified directly, and only that new
log binds this integration. Its five external-adapter/ABI claims remain false.
The source inventory separates producer metadata from its canonical pin map:
218 distinct repository paths, 106 RN paths and 13 virtualized-list paths,
without repeating source hashes per group. Both evidence files stay below
1,000 lines; bundle metafiles record paths, not per-input byte hashes.

This correction satisfies local thermo-nuclear review: cached state and
duplicate cancellation are removed, canonical RN/route owners remain in place,
and the new probe remains below 1,000 lines. At that historical stage, final-head hosted CI, CodeRabbit review and checkpoint acceptance still required their own evidence. The
cancelled `3e29553` run is not accepted. See the
[current receipt](../evidence/scroll-view/pointer-route-capture-retirement.json)
and [committed producer inventory](../evidence/scroll-view/committed-source-2a01ec6.json).


## Modal wheel dispatch and original Text integration

CodeRabbit's Window wheel finding on `8dd6129` is real. The existing Modal callback
enters routed_input, whose pointer-key classifier cannot represent wheel
buttons. The separate wheel call at the Surface root never executes there.
The principal required an actual current Window.window_input witness with
independent root, click/pan/reset and teardown controls before accepting RED.
The final historical v6 report passes 9 of 13 and fails exactly four Modal wheel
checks: each real signal arrives, but logical/Fabric/paint offsets remain zero.
Instrumentation attempts with a wrong/retired Window or failing owner setup
remain rejected. The RED header's after-teardown ID zero is explicitly bounded
by verified live snapshots; the permanent regression saves IDs before teardown.

The final correction `412eba2` deletes the duplicate physical Control-parent walk
and root-only dispatch. Wheel handling becomes one branch of the existing
routed input entry point, after its input-device filter and before its pointer
classifier. It reuses physical_hit_test, scroll_ancestor and the live mounted
ScrollAdapter, including source-surface identity. No second wheel state,
Modal-specific callback branch, wrapper or public API is needed. The principal
removed a redundant physical-input-host lookup. ApplicationRuntime was already
above 1,000 lines; this correction adds only one net line. Its 321-line permanent
probe, 170-line measured oracle and 92-line runner each remain bounded. The
principal rejected a giant cleanup condition chain and a one-use fixture wrapper;
small canonical counters and one direct component replace them.

Main's original Text #62 is integrated in `0203145`. Incoming exclusive Text files
match main; the dashboard preserves the GF-11 record, all other agents' tasks,
GF-18 acceptance and milestone objects. The rebuilt `7fc` host passes ScrollView 33,
Modal wheel 13, full Modal 7 tests / 193 mounted checks, click eight 91-check lanes,
list 44 and OS 37. Fresh same-host previous-SDK and sabotage controls are rejected.
The principal independently replays the measured scroll/route/Modal/list/OS
oracles and all 26 click cases in every lane, checks stopped-root cleanup and
rejects 14 damaged Modal reports plus missing-click and root-B-leak copies.
All 134 native inputs match the SDK receipt, working files and committed Git `020`;
all 2,713 SDK file bytes / symlinks match its unique manifest and loaded-host link.

Root's contracts invocation initially overlapped the click suite and changed
app.js; the integrity guard aborted correctly. The full suite was rerun serially,
with no accepted result from the stopped attempt. A list run similarly rejected
`787`-host sidecars; preserved historical controls were replaced by fresh `7fc`
executions before the current list / OS runs. Evidence curation distinguishes
these rejected orchestration attempts from product failures. Raw build/pack/
verify terminal logs were not retained; receipts and the root's independent
package-byte verification are the preserved SDK evidence.

Two headed Modal viewport captures were viewed by root. The actual instrumented
copy, its diff and unchanged host/receipt/bundle identities are recorded; the
canonical probe/report were preserved. Local gates pass 352 Node and 13 Python,
static and publication checks. Historical Images/Animated/examples/four earlier
ScrollView captures are retained as historical. This correction satisfies local
thermo-nuclear quality review; final published-head CI, CodeRabbit and GF-14
checkpoint acceptance remain separate pending gates.

See [the measured correction receipt](../evidence/scroll-view/modal-wheel-and-text-integration.json)
and [committed producer inventory](../evidence/scroll-view/committed-source-0203145.json).
