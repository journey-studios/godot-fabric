# Modal implementation quality review

The local implementation is approved for hosted review of the desktop first
slice in PR #51. Five high-confidence defects were found and corrected before
this verdict. Merge still requires CI and CodeRabbit on the implementation head.
This is not full GF-18 acceptance.

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
it is now 2,521 lines. Its size remains an architectural concern, but the new
Window arbitration and tree geometry are extracted, while registry/mount and
endpoint retirement stay with their existing runtime authority. No additional
pass-through layer is required for this slice.

## Final independent evidence

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

## Acceptance boundary

No unresolved high-confidence implementation defect remains from this review.
The published preparation's green CI cannot certify the new native implementation.
Review and merge require the implementation commit's hosted results and resolved
CodeRabbit comments. GF-18 remains in progress with all four checkpoints false.
Orientation/insets, mobile/export, complete pinned RN parity and hardware input
remain explicit acceptance work. The dashboard does not increase completeness
based on this local first-slice verdict.
