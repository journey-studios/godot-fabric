# Modal: native host decision and verification boundaries

Investigation on 2026-10-07 for RN 0.87.1 and Godot 4.7.2-stable, at the start of product
integration. GF-18 is now being implemented; no checkpoint is completed by
this study or the initial local mounting evidence below.

## Physical ownership

Use sibling embedded Godot Windows owned by their common host Window, with only
the top presented Modal exclusive. Logical RN nesting remains in the ShadowTree.
The physical Window tree need not mirror it. A Window-owned presentation stack
can arbitrate multiple applications without reparenting a foreign top Modal when
a lower application's owner stops.

The parent-wide input helper was rejected. In Godot's original
[Viewport input dispatch](https://github.com/godotengine/godot/blob/4.7.2-stable/scene/main/viewport.cpp),
marking input handled before GUI dispatch also suppresses Button and LineEdit
GUI in that Window. Embedded subwindows receive forwarding before the parent's
input/GUI path, allowing stock exclusive routing to do the work.

An independent desktop reexecution of the isolated GUI fixture passed 56
observations. It exercised actual Button and LineEdit controls with injected
mouse/key events, two background application Controls, bounds outside small
roots, top-only input and a full-window Modal. Freeing the lower sibling kept
the top Window, Button and LineEdit identities, focus, text and visibility
transition count. The top continued accepting clicks and text. A separate
embedded Window remained interactive while a Modal was presented.

Physical nesting followed by reparenting was also tested: identities and text
survived but LineEdit focus was lost. Keeping sibling Windows avoids that
operation in the tested case. A background grab_focus probe made both embedded
Viewports report focused LineEdits, while injected keys still reached only the
exclusive top. Control focus flags alone therefore cannot identify keyboard
authority; RN background focus commands and events need product proof.

The final investigation source SHA-256 was
`0923fa4c1f0cf1f5a091c483164a761c8c7dc52f53b0a42e928dc728a66bd4d7`;
the independently rerun log SHA-256 was
`debc1f53b96db3b4e262d42aede852ecd7cc603e49a8520d16f495ea1a72bdd7`.
These identify local ignored investigation inputs, not a committed production
Modal fixture. No OS hardware input, separate OS top-level, mobile, export or
React Native integration is certified by these observations.

## Original descriptor and metrics

The pinned [Modal renderer sources](https://github.com/facebook/react-native/tree/v0.87.1/packages/react-native/ReactCommon/react/renderer/components/modal)
provide ShadowNode, State, event emitter and descriptor behavior. Compose with
the final upstream descriptor, overriding initial State from the host Window
metrics and delegating upstream adoption. Do not copy RN cloning or layout.
Portable compilation needs only ModalHostViewShadowNode.cpp and the cxx
ModalHostViewUtils.cpp in addition to the existing core archive. The five extra
core/debug objects used in an initial spike were removed after symbol inspection
and an independent release-mode link/run.

Root independently tested an actual 320x240 RN Root containing an 800x600 Modal.
Canonical State/child/Root clones changed the Modal to 1024x768 while the Root
stayed 320x240. The original family and RootNodeKind traits survived. This proves
the isolated C++ layout behavior. The integrated local fixture below now also
executes initial JS onLayout, asynchronous UIManager resize, native mounting
and presentation; this does not establish the remaining acceptance.
Each runtime already owns one host Window. A surface-to-Window metrics map would
duplicate that invariant. Window resize must update Modal State even when the
FabricSurface's own dimensions remain unchanged.

## Integration obligations

Resolve physical embedding by target family against a retained current RN tree
revision, including its actual physical Viewport. SurfaceId alone cannot select
a nested Modal Window. Use the canonical resolver for DOM projection, pointer
geometry and physical input authority. RootNodeKind limits geometry ancestry;
it does not authorize truncating RN bubbling, responder, Fiber or ref paths.

measureInWindow, page, screen and target offset use different origins/transforms.
Validate them with nonzero host origins, density/scaling and transforms inside
versus outside the geometry boundary. Preserve source Window/Viewport guards,
capture cancellation, callback lifetime and stale-reference rejection.

Use original Modal and SafeAreaView JS exports without changing Platform.OS.
The pinned non-iOS SafeAreaView default is View; that is not mobile inset proof.
The first product slice should cover none animation, full-screen/transparent
presentation, onShow, top-only onRequestClose without automatic dismissal,
keyboard controls, nested dialogs and abrupt owner teardown. Reject unsupported
props or nonembedded host modes explicitly before presentation. GF-18's full
orientation/insets, reference parity and exported mobile requirements remain
separate acceptance work.

## Preparation publication

The [dashboard capture](../evidence/modal/dashboard-preparation.jpg) and
[publication receipt](../evidence/modal/preparation-publication.json) record the
preparatory data commit `74fdb6d` published from the draft branch using the main
renderer. The complete public JSON matched the committed data, with the generated
branch marker checked separately. Release tracking remains 23/156 checkpoints and
0/39 completed items; no product Modal acceptance is inferred.

## First product mounting in the local draft

An independent execution of the initial native integration passed 10 headless
checks and 12 graphical checks on macOS. The original RN ModalHostView presented
a 420x320 embedded exclusive Window over a 90x70 FabricSurface. Original
SafeAreaView followed the pinned non-iOS View path, the editable native TextInput
mounted, onShow fired once and application stop cleared the root/native tags
without SCRIPT ERROR or leak diagnostics.

The [first rendered capture](../evidence/modal/first-mount.png) and
[source/execution receipt](../evidence/modal/first-mount.json) preserve this
initial, unpublished implementation milestone. The recorded source hashes are
from that execution, not a claim that later changes have been verified. Source
pins do not certify the native build. Input dispatch, first onLayout, resize,
stack reentrancy, geometry and full GF-18 acceptance remain open.

The initial producer called TextInput original in its scope and check labels.
That attribution was corrected during review: the public import uses the
existing Godot PublicInput/NativeInput adapter. Button likewise uses the public
Godot adapter. Original JS-module claims here apply to Modal and SafeAreaView;
mounted LineEdit/Button behavior is not stock TextInput/Button JS parity.

## Local interaction, resize and callback lifetime

An independent rerun of the expanded product fixture passed 30 headless checks
and 34 graphical checks. Root recomputed 44 observations from the raw stage
snapshots and inspected both saved viewport images. The initial original RN
onLayout reported 420x320; resize kept the same native Window, updated original
Modal State/Yoga to 500x350 and produced the corresponding RN layout event. The
ordinary Root stayed 90x70 throughout.

Injected native input edited the controlled public TextInput adapter to firstx
and activated the public Button adapter once. Escape called original
onRequestClose while JS visible remained true. A visible toggle retired the
old Window and created a new host-sized presentation with a second onShow.
The fixture witnessed native Window input, then stopped its Fabric owner from
visibility_changed while Godot was dispatching the visibility callback; the
Window was freed after that callback unwound and roots/native tags reached zero.
Both executions recorded empty runtime errors and no SCRIPT ERROR, engine ERROR
or ObjectDB leak diagnostics.

The [initial image](../evidence/modal/interaction-initial.png),
[resized image](../evidence/modal/interaction-resized.png) and
[independent receipt](../evidence/modal/interaction-local.json) identify this
unpublished milestone using host SHA-256
`ce3079a1d68f62095c8327ac4517b5f1248e3bde1b0b37671491ae8f8b72e07c`.
They precede the ongoing presentation-policy extraction and do not certify
subsequent source changes or a frozen SDK build. Nested original RN Modals,
physical DOM/pointer geometry, RN responder/Pressable input, background focus
authority, cross-runtime owner teardown and capture cancellation remain open.
Mobile/export parity remains open. All four GF-18 checkpoints remain false.

## Reproduced DOM and pointer regressions in the earlier host

Root used an isolated Godot project and copied the same ce3079a1 host to measure
the original RN SafeAreaView/View ref through measureInWindow. With the small
Surface positioned at32,48, the Modal content's physical transform began at0,0,
but measureInWindow returned32,48 with the correct420x320 size. Runtime errors
were empty. This is a failed feature assertion, not acceptance evidence; the
[independent negative receipt](../evidence/modal/dom-projection-negative.json)
preserves expected/observed values and execution hashes.

That host chose the Surface from SurfaceId alone. Review required physical
embedding for the target family in one retained revision, shared with pointer
projection and input/focus authority. A separate Modal offset branch in
NativeDOM would preserve the architectural problem.

Root also ran a separate Pressability discriminator with the same copied host.
Before presenting a Modal, a native click changed the background public
Pressable count from0 to1. After original Modal presentation, clicking its
visible180x44 public Pressable left the Modal count at0, with no runtime errors.
The Control belonged to the Modal's different physical Window/Viewport.
The [pointer negative receipt](../evidence/modal/pointer-routing-negative.json)
records this baseline-positive, Modal-negative result. The public Godot wrapper
uses original RN Pressability; this is not a stock RN Pressable JS attribution.
Stock native Button success in the earlier fixture did not certify RN pointer
transport. Both failures exposed the missing physical embedding/authority
boundary. They remain historical regression evidence; the independent rerun
below establishes the corrected baseline, with broader cases still under review.

## Independently verified physical embedding baseline

Root froze and reexecuted the revised host in an isolated Godot project: 37
headless checks and 41 graphical checks passed. An independent oracle recomputed
22 observations from the raw stages. measureInWindow now starts at the Modal's
physical origin before and after resize, and its original RN pointer handler
receives Down. The ordinary Root remains 90x70. Both captured viewports were
inspected, and runtime/engine/leak diagnostics were empty.

The separate public Pressable discriminator was rerun without changing its
fixture, probe or bundle. Only the native host changed: the earlier host leaves
the Modal onPress count at zero; the revised host changes it to one while the
background count stays one. This verifies the original Pressability path used
by the public Godot wrapper in that case.

The [execution receipt](../evidence/modal/embedding-local.json),
[initial image](../evidence/modal/embedding-initial.png) and
[resized image](../evidence/modal/embedding-resized.png) identify host SHA-256
`730fcbe9226057d9a70eda329a0e596a33c4af36d83f7a6aa8bd07b90c2e03df`.
The producer manifest from that execution omitted nine changed native inputs;
the receipt states that limitation rather than reconstructing old source pins
from subsequent edits. It does not certify a frozen SDK build or later changes.

Nested geometry boundaries, nonzero screen origin and scaling, cross-runtime
focus/owner lifetime, capture cancellation and stale refs remain under review.
The implementation is local and unpublished in draft PR #51. Hosted CI of the
preparatory head does not test this native code. All four GF-18 checkpoints,
full orientation/insets and mobile/export acceptance remain open.

## Nested Windows and active-contact cancellation

Root froze the next producer inputs and independently passed 46 headless checks
and 51 graphical checks, recomputing 31 stage observations. A logically nested
Modal uses a sibling physical Window under the same owner, measures against
its own origin and receives Pressability onPress. Presenting a new top while a
lower contact is active delivers exactly one PointerCancel, TouchCancel and
PressOut; a subsequent Up in the old Window does not produce onPress. Hiding
the top restores the lower presentation. This fixture does not request explicit
pointer capture and must not be cited as proof of setPointerCapture behavior.

The graphical oracle independently compares the event against Godot's Viewport
screen transform plus the actual native owner origin, converted to RN points.
The owner uses content scale 1.5. macOS moved the requested Window position,
so the oracle checks its actual nonzero origin. The pinned
[Window implementation](https://github.com/godotengine/godot/blob/4.7.2-stable/scene/main/window.cpp#L3008)
composes the embedded chain; the public screen-transform API excludes absolute
OS position by default, as specified in the
[Viewport declaration](https://github.com/godotengine/godot/blob/4.7.2-stable/scene/main/viewport.h#L705).
Two earlier root oracle attempts used incorrect assumptions and are recorded in
the receipt; the final executed comparison agrees with the event.

The [nested execution receipt](../evidence/modal/nested-local.json),
[initial capture](../evidence/modal/nested-initial.png) and
[resized capture](../evidence/modal/nested-resized.png) identify the frozen host
`9c2e43ef5b4386a66bae6e844915e1bfca911042b1582ed6282317560f1d45a5`.
The complete changed-native producer manifest is preserved, while build/SDK
certification and later source changes remain separate.

Review also independently reproduced a new regression in that host: a connected
zero-sized View physically at 37,55 reports 5,7 through measureInWindow. The
hidden View still reports zero and the Modal zero-sized View retains its own
origin. The [zero-size negative receipt](../evidence/modal/zero-size-negative.json)
records the failed feature assertion and empty runtime errors. Using width or
height as validity erased RN's distinction between valid 0x0 layout and
EmptyLayoutMetrics. The correction and cross-owner authority changes are in
progress; they are not certified by the positive nested milestone.

## Cross-owner and existing capture contract regressions

Root reproduced two further failures on the frozen9c host. With two applications
under one native Window, stopping the lower owner cancels the upper application's
active contact. Upper Window/Viewport/Control/Input identities, visibility,
exclusivity, focus and text survive; keyboard input still works. PointerCancel
and TouchCancel change0→1 and the subsequent Up produces no onPress. The
[foreign-owner negative](../evidence/modal/foreign-owner-negative.json) isolates
this contact-authority failure; it is not a general focus/lifetime failure.
Cancellation must follow actual authority revocation, and non-top removal must
not interrupt the foreign top.

A separate byte-identical fixture, probe and bundle compares two Surfaces of
one application in the same physical Window. Down on A calls B.setPointerCapture,
and both hosts report hasPointerCapture=true. The earlier ce3079a1 host delivers
B's got, move with offset(-135,15), up and lost callbacks. The9c host delivers
only A's down; capture state changes but B's callbacks disappear, with empty
runtime errors. The [cross-root capture negative](../evidence/modal/cross-root-capture-negative.json)
records this regression in the existing contract. A source-boundary family
check must not be used as a target-family restriction. Preserve source identity
separately and resolve the captured target's physical embedding. Logical RN
ancestry outside a Modal must also be covered before accepting this change.

## Independent rerun of the three review regressions

Root reexecuted each negative discriminator with its byte-identical probe and
bundle, replacing only the native host with SHA-256
`c9fd78ded179c016ffea7d6c4f2998975ad95dbe913908c007b71aee8657ead1`.
All three pass, with empty runtime and engine diagnostics:

- The connected 0x0 View measures 37,55, matching its physical Surface origin;
  display:none still measures zero and the Modal's own origin remains 11,13.
- Stopping the lower application preserves the foreign top contact: zero
  PointerCancel/TouchCancel, then one onPress. Window/Viewport/Control/Input
  identities, focus and text survive; the subsequent key edits firstx to firstxy.
- Capture requested on B by Down on A delivers the original sequence again:
  A/down, B/got, B/move at offset(-135,15), B/up, B/lost. Capture is released.

The [same-input correction receipt](../evidence/modal/review-regressions-local.json)
retains execution hashes and links to the historical negatives. The fixes use
RN's EmptyLayoutMetrics, actual stack top transitions and distinct source/target
physical embeddings. This receipt does not certify a native SDK build, later
source changes, mobile/export or the complete GF-18 acceptance. The expanded
capture/ancestry fixture and remaining lifecycle/reorder cases are reviewed
separately.

## Explicit capture, logical ancestry and foreign runtime proof

Root froze the expanded producer and reexecuted 68 headless checks and 73
graphical checks in an isolated project. A separate oracle recomputed 41 stage
observations. The public Pressable explicitly requests capture, observes got,
receives an outside Move, returns and receives Up/lost with one onPress.
Move/Up and capture notifications still bubble to logical RN ancestors outside
the Modal's physical Window.

Two roots of one application produce B's exact capture/ancestor trace after
Down on A: got, ancestor-got, ancestor-enter, enter, move, ancestor-move, up,
ancestor-up, leave, ancestor-leave, lost, ancestor-lost. Move's offset is 45,35;
A receives no Up. Stopping the lower application preserves the foreign top's
Window identity, focus, text and active capture; its subsequent Up, onPress and
lost each occur once. Cleanup reaches zero roots and native Controls.

The graphical oracle agrees with actual owner origin 72,130 and content scale
1.5: RN screen point 150,190.6667. Both 420x320 and 500x350 captures were inspected.
The [capture execution receipt](../evidence/modal/capture-local.json),
[initial image](../evidence/modal/capture-final-initial.png) and
[resized image](../evidence/modal/capture-final-resized.png) retain binary,
bundle, execution hashes and 27 producer pins, including 20 changed native files.
Two earlier project-setup failures omitted the extension registration; their
logs are retained separately and are not feature assertions.

At this checkpoint the implementation remained local on draft PR #51; its published preparatory
head does not contain this native code. Sibling reorders around the portal,
active capture-owner removal and isolation between two native owner Windows
remain under review. Removing an RN capture target legitimately omits lost
callbacks on that disconnected target; validation must preserve that existing
contract rather than add callbacks to satisfy an incorrect oracle. SDK/gates,
final hosted CI/CodeRabbit, full orientation/insets and mobile/export remain
separate acceptance requirements. All four GF-18 checkpoints remain false.

## Retired physical endpoints retain unreachable routes

Root independently reproduced a P2 on the same c9 host: ten Down/capture/complete
Modal removal/remount cycles destroy ten distinct embedded Windows, but retain
ten suppressed routes. Stored/suppressed grows exactly 1..10 while all pointer
processor capture/active counts return to zero. The runtime has no errors.
Forty-three checks pass; the final route-lifetime assertion fails. The
[negative receipt](../evidence/modal/retired-window-routes-negative.json) pins
the exact host, bundle, fixture, probe and output.

Surface lifetime and physical input endpoint lifetime are distinct. Suppression
must remain for an old held contact whose origin was removed inside the same
live Window; a destroyed Modal Window can never receive its matching Up. Review
requires canonical route retirement in the same operation that destroys that
presentation, without feature checks scattered through dispatch or fabricated
lost callbacks on disconnected targets. The correction and same-Window control
were still in progress at this checkpoint. The positive capture receipt above
does not certify this fix; the final retirement proof below does.

## Keyed sibling order around the portal

Root independently passed a ten-check discriminator on the frozen c9 host.
Logical orders A/Modal/B/C, C/Modal/A/B and A/B/Modal/C produce physical ordinary
sibling orders A/B/C, C/A/B and A/B/C. The portal is excluded from that physical
parent. Ordinary Control IDs, Modal content and LineEdit IDs remain unchanged;
native focus and controlled text seedz survive, onShow remains one, and cleanup
leaves zero native tags. Runtime and engine diagnostics are empty.

The [reorder execution receipt](../evidence/modal/sibling-order-local.json)
pins the same producer host, fixture, probe and bundle. This proof validates
logical mount-index translation; it does not certify the later route retirement
fix, two native owner Windows, mobile/export or complete GF-18 acceptance.

## Final endpoint retirement and consumer verification

The corrected host SHA-256 is
`c2293d7f775c942efeb05c49e5a12cb4a4ad563e99eac6405d5f6ef6e52a074a`.
Root reran the original negative with byte-identical fixture, probe and bundle:
44/44 checks pass, all ten destroyed Windows leave zero stored/suppressed routes
and zero processor state. The [same-input correction](../evidence/modal/retired-window-routes-local.json)
retains the historical failure. Endpoint retirement belongs to the runtime's
canonical presentation destruction operation, not scattered Modal guards in
event dispatch. Both mutation deletion and final unmount use that operation.

The existing independent capture oracle was then repeated serially on c229:
84/84 checks in each of eight interest/feature lanes pass. Removed targets in a
still-live Window preserve suppression of the held contact; disconnected RN
listeners receive no invented terminal callbacks. The
[live-Window control receipt](../evidence/modal/endpoint-retirement-control-local.json)
distinguishes that behavior from unreachable routes belonging to destroyed Windows.

Root verified 29 frozen producer pins and separately reexecuted the final
discriminators: 65/65 lifecycle checks, 9/9 sibling-order checks and 9/9 checks
across two actual native owner Windows on macOS. Forty-four observations were
recomputed from the outputs. Ten capture/removal cycles remain bounded; a
visibility callback can stop its owner reentrantly; reorder retains Controls,
focus, seedz text and one onShow; owner B stays interactive after A is removed.
See the [discriminator receipt](../evidence/modal/discriminators-local.json).

The original expanded scenario was also reexecuted on c229 with the previously
audited byte-identical inputs: 68/68 headless and 73/73 graphical checks, plus
37 independently recomputed observations. Both captures were inspected again:
[initial](../evidence/modal/capture-review-final-initial.png) and
[resized](../evidence/modal/capture-review-final-resized.png). The
[final execution receipt](../evidence/modal/review-final-local.json) pins the new
host and distinguishes it from the historical c9 results.

A fresh native SDK verifies all 95 source pins and the same actual c229 host.
Its linked registry client passes 213 checks in 11 cases, including reservation
of the built-in Modal component. The canonical addon package was loaded by a
new consumer outside the repository: the packaged compiler accepts the supported
Modal/SafeAreaView types and rejects animationType slide; the frozen lifecycle
scenario passes 65/65 headless checks. The
[SDK and consumer receipt](../evidence/modal/sdk-consumer-local.json) preserves
hashes and limitations. The registry does not mount a component, the SDK receipt
does not certify ABI, and the consumer execution does not prove mobile/export.

## Remaining runtime membership review

The final structural audit found another P2 in `ModalWindowStack::runtimes_`:
mounting a Surface registers its runtime, but stopping its last Surface does not
remove that membership. Entries are pruned only when a future top transition
calls cancel_runtimes and its callback returns false. A persistent Window can
therefore retain callbacks and weak-control blocks for stopped applications that
never presented a Modal. This is established by the registration/removal paths;
a counted churn execution on that historical host was not certified.

Review required membership to follow the runtime's live Surfaces. Removing one of two Surfaces
must preserve the other; removing the last must unregister, and remount must
register again. The correction is delegated to the same Luna with a bounded
churn/remount control. c229 proof does not certify that subsequent correction.

## Membership correction and bounded graphical input investigation

Root verified 33 frozen producer pins on host
`37053a3992cfd8cdb512933c26b80ef6efb7711487b149c4b840b31c42386eae`.
The [independent membership receipt](../evidence/modal/membership-local.json)
records 31/31 checks. A persistent observer sees ten app churn cycles return
2→1 members; two Surfaces produce 2→2→1; remount returns to 2, foreign takeover
to 3 with exactly one cancel/lost, and foreign stop back to 2. A typed stack Ref
exists while the runtime owns roots. Last unmount unregisters; remount registers
again. RuntimeMember's separate revision wrapper is deleted: membership does
not advance the revision that arbitrates physical Window presentations.

The final source also passes 65/65 lifecycle, 9/9 reorder, 68/68 headless Modal
checks, and complete contracts (283 Node plus 13 Python). A fresh matching SDK
and registry build passed. These results do not replace graphical proof.

The original graphical two-owner probe passed 9/9 on c229 with the same bundle
and probe, but failed 8/9 and 7/9 on the new host: B receives its second Down,
Got, Up and Lost, but also two moves and no second onPress. An isolated diagnostic
then observes native MouseMotion between injected Down/Up on c229 as well; that
diagnostic c229 loses the Press while its paired new-host execution succeeds.
The trace confirms motion contamination in those runs, but a dedicated-device
diagnostic still loses a Press without RN moves. OS motion alone is not a proven
complete cause. Do not declare either a product regression or a harmless flake.

The [same-input comparison](../evidence/modal/owner-input-review-inconclusive.json)
preserves the original failed outputs. The last investigation is bounded to a
control without the extra logger. This was the intermediate review state; the
final control and its limited conclusion are recorded below.


## Final independent implementation review

All five high-confidence findings are corrected locally: zero-sized connected
layout projection, foreign-top cancellation, cross-root capture delivery,
destroyed-Window route retirement and runtime stack membership. The
[implementation review](modal-implementation-review.md) records the structural
changes, negative controls and approval boundary.

The final no-logger two-owner control changes only the injected mouse device to
4242; the duplicated Up inherits it. All frame waits and all nine assertions
remain unchanged. The original JS bundle is byte-identical in the old c229 and
new 37053a39 host controls. Both pass 9/9, and root independently repeats the
new host: B receives two Downs, Gots, Ups, Losts and Presses, with zero Moves or
Cancels. The [device-isolation receipt](../evidence/modal/owner-input-device-control-local.json)
preserves this comparison. It establishes an engine-injected graphical witness;
it does not identify the full cause of the earlier default-device failures or
certify physical-device input. The earlier failures and diagnostic limitations
remain in the historical receipt.

On the final host, root verifies 33 producer pins and independently executes
68/68 headless and 73/73 graphical Modal checks, 65/65 lifecycle, 31/31 membership,
9/9 reorder and 9/9 native owner checks. A focused existing capture control passes
84/84 in the current-interest, enabled-feature lane; the earlier eight-lane c229
control is retained separately. Root recomputes 22 output observations and
inspects both final captures: [initial](../evidence/modal/review-membership-initial.png)
and [resized](../evidence/modal/review-membership-resized.png). See the
[final local receipt](../evidence/modal/thermonuclear-final-local.json).

A canonical addon installed outside the repository uses the final host and the
SDK's own provisioned CLI to bundle the byte-identical fixture. The packaged
compiler accepts Modal/SafeAreaView and rejects animationType slide. Native
headless execution passes 68/68; root repeats it independently. The installed
manifest's 153 producers and the native SDK's 95 producers match the checkout;
the linked registry passes 213 checks in 11 cases. The
[final consumer receipt](../evidence/modal/thermonuclear-consumer-local.json)
distinguishes bundle production, type rejection, actual execution and ABI limits.

Local implementation review approves this desktop first slice for hosted review.
The published preparatory CI does not certify the new implementation: merge
requires CI and CodeRabbit on the implementation commit. GF-18 stays in progress
with all four checkpoints false. Orientation/insets, mobile/export and complete
pinned RN parity remain outside this first-slice proof.


The reviewed implementation is published as `dd66069` in PR #51. Root verifies
all 33 executed producer pins against its Git blobs. The
[source publication receipt](../evidence/modal/reviewed-source-publication.json)
records local approval separately from pending implementation CI/CodeRabbit.
