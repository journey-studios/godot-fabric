# ScrollView implementation review

Status: GF-14 is in progress. No GF-14 checkpoint has been accepted. This is
the root's ongoing implementation-quality review, separate from the research
plan and from the implementer's test report. It applies the user-supplied
thermo-nuclear review criteria: simpler ownership, original RN behavior,
explicit boundaries and independent executed evidence.

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
