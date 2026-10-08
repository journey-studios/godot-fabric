# Modal implementation quality review

The desktop slice is locally approved on code commit `3b8ddbcc251a2a136c0708b484d68dad2a0ce60c`
after the thermo-nuclear review and corrections. CodeRabbit approved `bee7b40`
and all six review threads are resolved. Its hosted Modal, transform and capture
stages passed, but the native job exhausted its global 45-minute budget before
parity. A fresh complete CI run with a 60-minute global budget remains required
before merge; this is not full GF-18 acceptance.

The previous a97876b integration failed hosted `test:transforms:guards` with
`det == 0`; its Modal step was skipped. Root reproduced the failure and confirmed
that the private validation-device filter ran after pointer-key rejection.
Moving the existing filter before classification preserves the original mouse
and touch families and consumes emulated events before singular GUI hit-testing.
The same frozen 25-check inputs and an explicit device -1 witness fail the strict
error oracle on the regression host and pass on the corrected host. No skip,
retry, new API or diagnostic relaxation was added.
[Failed-head receipt](../evidence/modal/ci-transform-inverse-a978.json),
[corrected local proof](../evidence/modal/ci-input-filter-final-local.json) and
[dashboard capture](../evidence/modal/dashboard-input-filter-final.jpg).

The review applies the user's thermo-nuclear criteria to the Modal change and
the shared DOM, pointer, runtime and addon boundaries it affects. It combines
source audit, frozen before/after controls, independent execution and graphical
inspection. It does not certify every prior Luna change or every roadmap item.

## Findings and correction evidence

| Priority | Finding | Required correction | Evidence |
| --- | --- | --- | --- |
| P1 | Connected 0×0 layouts were treated as invalid, dropping physical offsets | Use RN's original EmptyLayoutMetrics distinction | [Three same-input regressions](../evidence/modal/review-regressions-local.json) |
| P1 | Stopping a lower runtime cancelled the foreign top's active contact | Cancel only when the actual visible top changes | [Before/after](../evidence/modal/review-regressions-local.json), [final execution](../evidence/modal/thermonuclear-final-local.json) |
| P1 | Cross-root capture changed capture state but dropped Got/Move/Up/Lost delivery | Keep immutable input origin distinct from the target embedding; retain RN ancestry | [Before/after](../evidence/modal/review-regressions-local.json), [final trace](../evidence/modal/thermonuclear-final-local.json) |
| P2 | Complete Modal removal left unreachable suppressed routes for destroyed Windows | Retire the endpoint in the canonical presentation destruction operation | [Ten-cycle negative](../evidence/modal/retired-window-routes-negative.json), [same-input correction](../evidence/modal/retired-window-routes-local.json) |
| P2 | Persistent owner Windows retained callbacks for runtimes after their last Surface stopped | Register while roots exist, unregister on last unmount/stop, register on remount | [Source audit and 31-check churn/remount control](../evidence/modal/membership-local.json) |

The first three defects were independently reproduced on the same frozen inputs
and passed after correction. Endpoint retirement failed exactly its final
lifetime assertion before correction: stored/suppressed routes grew 1..10, even
though processor state reached zero. The same 44-input scenario then passed
44/44 with every destroyed Window leaving zero routes. The membership defect
was established by the source registration/removal paths; no counted negative
churn execution on that historical host is claimed.

## Structural changes required for approval

The Window owns one typed ModalWindowStack and its runtime memberships.
ModalPresentation retains a stack Ref and one ownership identity. Duplicate
Window IDs, retired flags and the separate runtime-membership revision wrapper
were removed. Membership changes do not invalidate the revision used to arbitrate
physical presentation changes. Last-root cleanup explicitly ends membership.

WindowMetricsSnapshot is the shared authority used by the original RN component
descriptor and native layout updates. It eliminates parallel metrics by Surface
and supplies correct host dimensions before initial Yoga layout. Modal content
mounts through the ordinary Panel child path, eliminating nullable physical
parent modes and special Window child scans.

PhysicalEmbedding retains one immutable Fabric revision and its logical path.
DOM measurement and pointer geometry reuse it. RootNodeKind selects the physical
geometry boundary; RN retains event ancestry, including ancestors outside a
Modal Window. PointerInputSource retains the origin's family, mount, Window and
Viewport identities. A capture target can therefore live in another root under
the same native owner without losing the source's validity or projecting through
the wrong viewport. TouchContact updates the event and source together.

Endpoint retirement belongs to one destroy_modal operation used by mutation
removal and final unmount. It does not add Modal checks across general dispatch
or fabricate terminal callbacks for disconnected listeners. The existing
same-live-Window held-contact suppression contract remains intact.

These changes delete duplicated state and special modes. Stack arbitration,
presentation policy and immutable-tree geometry live in focused modules rather
than accumulating feature branches throughout shared dispatch. The stack has
249 lines, presentation 69 and embedding 50. No changed file crosses from below
1,000 to above 1,000 lines. application_runtime.cpp already exceeded that limit;
it is now 2,566 lines (main already has 2,141). Its size remains an architectural concern, but the new
Window arbitration and tree geometry are extracted, while registry/mount and
endpoint retirement stay with their existing runtime authority. No additional
pass-through layer is required for this slice.

## Initial desktop evidence

Root verifies 33 producer pins against the checkout on host SHA-256
`37053a3992cfd8cdb512933c26b80ef6efb7711487b149c4b840b31c42386eae`.
The [final receipt](../evidence/modal/thermonuclear-final-local.json) records:

- 68/68 headless and 73/73 graphical Modal checks, with 22 separately recomputed
  observations and inspected [initial](../evidence/modal/review-membership-initial.png)
  and [resized](../evidence/modal/review-membership-resized.png) images.
- 65/65 lifecycle, 31/31 membership and 9/9 sibling-order checks. Ten destroyed
  Windows leave zero routes; persistent observer membership returns to baseline.
- 84/84 checks in the existing current-interest, enabled-feature capture lane.
  The [earlier eight-lane control](../evidence/modal/endpoint-retirement-control-local.json)
  remains separately attributed to its c229 host.

The [two-native-owner control](../evidence/modal/owner-input-device-control-local.json)
passes 9/9 on both old and new hosts and in root's independent new-host run. It
uses the unchanged no-logger JS bundle and changes only the injected mouse device
to 4242; Up inherits it. Frame waits and all nine assertions remain unchanged.
This separates fixture input from the desktop stream without altering production
logic or weakening the oracle.

The [earlier default-device failures](../evidence/modal/owner-input-review-inconclusive.json)
remain documented. A diagnostic traced real native MouseMotion between injected
Down/Up, including a failure on the older host. Other diagnostic outcomes remain
unexplained. The final dedicated-device witness proves engine-injected isolation;
it does not prove the complete historical cause or physical-device behavior.

A [canonical external consumer](../evidence/modal/thermonuclear-consumer-local.json)
installs the actual final host and bundles the byte-identical fixture through the
provisioned SDK CLI. Packaged types accept none/fullScreen/overFullScreen and
SafeAreaView, and reject animationType slide. Root repeats the headless 68/68
scenario independently. The addon manifest's 153 and native SDK's 95 producer
hashes match the checkout; the linked registry passes 213 checks in 11 cases.
Registry execution does not mount a component and SDK verification does not
certify ABI. The consumer proof is headless.

The final required contracts pass 283 Node tests plus 13 Python tests. Static,
publication and diff validation are recorded in the
[local gate receipt](../evidence/modal/thermonuclear-gates-local.json).

## Additional review corrections and final evidence

The [final correction receipt](../evidence/modal/coderabbit-final-local.json)
pins 35 producers and matches all 21 changed/related native producers to the
compiled build receipt. Root repeated 68/68 headless and 73/73 graphical checks,
65/65 lifecycle, 31/31 membership, 9/9 reorder and 84/84 current/enabled capture
checks on host SHA-256
`45ba095b7584224c550f4f453b7ee12e092606212fe6d57e41abbd2e78c6163d`.
The [initial](../evidence/modal/review-coderabbit-initial.png) and
[resized](../evidence/modal/review-coderabbit-resized.png) captures were inspected.

| Priority | Additional finding | Correction and evidence |
| --- | --- | --- |
| P1 | Hidden connected Surfaces lost DOM coordinates because geometry required native visibility | Keep connected geometry independent of visibility; use the typed physical_input_host boundary for input. Identical old/new 9-check probes show 34.5,55.5→0,0 before correction and stable 34.5,55.5 afterward. |
| P2 | Teardown retained a Surface pointer and attached ordinary content across Modal callbacks | Detach ordinary roots before hide, retain presentation ownership and re-resolve Object IDs after mutations. The callback sees a live detached RN root in the final probe. |
| P2 | Logical mount/removal scanned all parents and empty Surface entries survived retirement | Maintain child→parent ownership, touch the known parent and forget the root in canonical finalization. Reorder and lifecycle pass; no asymptotic benchmark or linear teardown claim is made. |
| P2 | Missing targets caused a null dereference; early failure then exposed unsafe quit cleanup | Guard before native access, cache IDs before retirement, stop both runtimes and await cleanup. The negative exits 1 with a durable failed report, zero roots and only its expected failed-assertion diagnostic. |
| P2 | The existing validation device filter was bypassed by Modal Window input | Move it once to routed_input and reuse its Root. The later transform guard exposed classification ordering; the filter now retains its original event families before key selection. The same explicit foreign-device inputs fail four checks on the old host and pass 11/11 on the final host. |

The teardown proof distinguishes two engine-supported paths. During a bound
Surface.unmount call, Godot rejects synchronous Object.free because that Object
is locked; the historical diagnostic is retained and is not a reproduced crash
or use-after-free. The final callback confirms ordinary content is alive and
already detached, then queue_free completes after return. A separate JS-hide
callback performs immediate Surface.free with ordinary content alive. Both
retire to zero roots with no runtime errors; the final probe passes 9/9.

The final two-owner probe retains all nine original assertions and their frame
waits, adds the target guard and a controlled interloper assertion. Both Surfaces
select device 4242 through the preexisting private validation metadata; three
explicit device 4243 moves are inside their owners and outside their targets.
The old host admits one/two native and responder moves and loses Pressability
presses. The corrected host delivers all original Press/Up/capture assertions
with zero foreign native/responder moves. No skip, retry or weakened assertion
was introduced. The [earlier observation](../evidence/modal/coderabbit-input-observation.json)
remains inconclusive about the complete cause of ambient desktop interference.
This certifies an isolated engine-injected witness, not hardware input.

A fresh [canonical consumer](../evidence/modal/coderabbit-consumer-local.json)
uses the final host, the byte-identical fixture and provisioned SDK CLI; root
passes 68/68 headless checks. All 153 addon and 95 native SDK hashes match the
checkout. The linked registry passes 213 checks in 11 cases without mounting a
component or certifying ABI. The existing type positive/negative proof remains
attributed to its original host; this change does not modify public types.
Final required local gates again pass 283 Node and 13 Python tests; see the
[gate receipt](../evidence/modal/coderabbit-gates-local.json). The
[source publication pin](../evidence/modal/coderabbit-reviewed-source-publication.json)
verifies 35 Modal, 95 SDK and 153 addon producer hashes against f95a3e2.

## Final integration correction

| Priority | Finding | Correction |
| --- | --- | --- |
| P1 | Pointer classification bypassed the validation-device filter for emulated mouse and wheel events, admitting singular GUI hit-testing | Keep the null guard and original mouse/touch filter in canonical routed_input, before key selection; preserve normal RN key rejection. |

Root independently passes 164 transform checks, all seven Modal Node tests
(including the headed 11-check two-owner witness), eight 84-check capture lanes,
283 Node contract tests and 13 Python tests on host `0dd35f6cbf45878ff66bf4c93db0a1c2c12ac1b2bb91e56566072cacef7d86b8`.
A fresh canonical SDK consumer passes 68/68 headless checks after real resource
import. All 35 Modal, 95 SDK and 153 addon producer pins match the reviewed code
commit, including the 21 compiled native producers. The
[final local receipt](../evidence/modal/ci-input-filter-final-local.json) retains
the paired controls, report/log hashes, packaging base/dirty provenance and
preparation corrections. Earlier 45ba095b and 37053a39 proofs remain historical.

## Acceptance boundary

Local structural and behavioral review of this desktop slice is approved.
CodeRabbit approved `bee7b40`, including the independently inspected hosted
headed witness. The final implementation head still needs complete hosted CI
before merge. GF-18 remains in progress with all four checkpoints false here.
Orientation/insets, mobile/export, complete pinned RN parity and hardware input
remain explicit acceptance work. Local approval does not increase the dashboard
completeness or certify all previous Luna implementations.

## Hosted runner control

The [a32235d hosted artifact](../evidence/modal/hosted-runner-control-a32235d.json)
confirms the required macos-15 owner-window probe passes 9/9 with display server
macOS. Core Modal passes 68/68, lifecycle 65/65, reorder 9/9 and membership 31/31.
No display skip was introduced. This establishes runner support; it does not
certify the later CodeRabbit corrections. A subsequent live check confirms all five required workflow jobs passed on a32235d.

## Corrected hosted head and global CI budget

Root independently inspected the downloaded artifacts of [run 37701896839](https://github.com/journey-studios/godot-fabric/actions/runs/37701896839)
at `bee7b40061319e25d002fc86808dc9c1140c5424`. The
[curated receipt](../evidence/modal/hosted-bee7b40-timeout.json) records:

- 193 positive Modal assertions, including the required 11-check macOS display
  witness. Its missing-target negative fails exactly the intended assertion and
  cleans both applications to zero roots, memberships and listeners.
- 164 transform and 672 capture assertions, with no unexpected engine errors.
  The 35 Modal producer pins, 95 compiled SDK pins and 10 original RN source pins
  match the reviewed inputs. SDK manifest binding is verified; its payload files
  are absent from this hosted artifact and are not independently rehashed here.
- CodeRabbit's [independent artifact verification and approval](https://github.com/journey-studios/godot-fabric/pull/51#discussion_r4213152528).

The workflow is **cancelled**, not green. GitHub's native check annotation says
`The job has exceeded the maximum execution time of 45m0s`. Cold-start prints
`COLD_START_PASSED` at cancellation, but its step is cancelled and parity is
skipped. Passing earlier artifacts does not override that incomplete pipeline.
The sole workflow correction raises the total native job budget to 60 minutes;
individual probe deadlines, assertions, strict error checks and required headed
execution remain unchanged. The new head must pass all five jobs before merge.
The [dashboard capture](../evidence/modal/dashboard-hosted-timeout.jpg) preserves
the partial hosted result and unchanged 23/156 checkpoints.
