# Initial public release validation

This record describes the initial public-source snapshot before the examples
reorganization. Its provenance hashes remain historical; they are not hashes
of today's moved source files. Subsequent [cold-start/oracle work](cold-start.md)
has separate evidence.

The [runnable examples record](examples/README.md) has fresh source hashes,
reports for the nine interactive cases and the new public counter captures.

The [public controls record](public-controls/README.md) adds the typed form,
fresh ten-example reports and README gallery captures. Earlier records retain
their historical provenance.

The [independent consumer record](consumer/README.md) adds the 2B
Resource/addon/editor prototype, fresh external TSX project, private/offline
build and dependency checks, native roots/lifecycle and two actual captures.

The later [project-resolution record](project-resolution/README.md) exercises
inherited local aliases and non-hoisted dependencies through that normal addon.
Its actual Godot captures and positive/negative cases retain SDK React identity,
type/runtime source agreement, lockfile ownership and exact-byte recovery.

The later [game-services record](game-services/README.md) extends that consumer
with typed Godot operations, state revisions and signals. It also retains the
services laboratory's pause/job-lifetime captures, dedicated native DTO and
application-destruction fixtures, and the 15-example regression matrix.

The separate [iOS export/runtime record](../IOS_BUILD.md) has current-source
native build/package hashes, an unsigned arm64 device export/link and an
x86_64/Rosetta simulator consumer. Its narrow runtime proof and disclosed
official-template limitations do not certify the complete iOS port.

The [original Codegen record](codegen/README.md) adds upstream TS/Flow generation,
20 contract tests and six compiled C++ translation units. That first record did
not load/render the external adapter; later native-adapter records below add
that bounded execution. Complete ABI certification remains open.

The [independent-root retirement record](root-retirement/README.md) extends
GF-07/GF-26/GF-28 with 17 real Godot runs / 318 checks, including callback-driven
unmount/remount, freed hosts, application replacement and stale core signals
across reused tags. External font ownership has an executed failing binary
control. Three graphical root cases retain readbacks and pixel assertions.
Its source, native/SDK fingerprints and preceding hosted CI are kept separate
from full lifecycle, RN differential and all-target acceptance.

The [public View record](view/README.md) adds original RCTView descriptors,
Fabric stacking/hit order, rectangular overflow clipping and solid physical-edge
borders. It retains 67 headless / 107 native assertions, 36 RGBA samples, three
actual captures and the expected-failing previous-host control. The rebuilt host
also passed 16 headless scenes / 672 checks, NativeWind 58 native checks and
17 adapter runs / 318 checks. At that checkpoint, RTL, transforms, rounded
descendant masks, fractional geometry and mobile View differential work remained
open. Subsequent transform execution is recorded separately below; GF-10 remains
in progress.

The later [coordinate record](coordinates/README.md) addresses the offset-root
input/measurement gap found by the View checkpoint. It retains 238 headless /
247 native assertions, six RGBA samples and three captures. Genuine move-out,
return and release exercise original Pressability through translated/scaled
Godot surfaces and raw window input at content density two. The previous host
fails 121 assertions in each lane; an intermediate cached-density host fails
the first contact before a metrics refresh. GF-08/GF-13 remain in progress
with their wider ref/input acceptance still open. Historical View hashes and
reports remain separate.

The later [transform record](transforms/README.md) adds original RN 2D affine
styles and origins on the same Godot Control, with 309 headless / 345 native
assertions, 33 RGBA samples and three captures. Independent matrices/corners,
public measures, stable refs/state, flattening and genuine transformed-parent
input are checked together. The same final fixture fails 65 headless / 68
native assertions against the preceding coordinate host. Six isolated public
rejection cases pass 61 checks; the affine factor test passes 40,932 checks.
The separate input guard passes 25 checks for invalid composed embeddings,
ignored START, restoration and cancellation preserving the last valid sample.
This does not establish singular JSX rendering.
GF-08/GF-10/GF-13 remain in progress; broader ref/View/input acceptance,
transformed clipping, singular/3D support and mobile differential work remain.

The later [read-only tree record](tree/README.md) adds original RN View IDs,
root-scoped lookup, logical node traversal, snapshot collections, RawText updates
and retained refs during keyed changes and retirement. It passes **89 headless /
99 native checks**, eight RGBA samples and two captures on the unchanged host.
The same fixture fails **25/89 checks** with the preceding JS configuration.
Original source links explain RawText replacement/null ownerDocument and
imperative native IDs reverting on a children-only commit. GF-08 remains open
for complete refs/commands and original mobile differentials.

The [original TextInputState/focus record](focus/README.md) adds 175 headless /
189 native checks, 12 pixels and two captures. Previous-host and eligibility
controls fail 23/160 and 11/175. Its [native command complement](focus/commands.json)
passes 112 checks / 40 owner observations with eight exact argument rejections,
recovery and nine input registrations cleared across two applications. GF-08/
GF-12 remain open; physical keyboard/IME, multiline and mobile focus acceptance
are separate. The subsequent [pointer lifetime record](pointers/README.md)
adds 132/146 public checks,12 pixels,144 native assertions, two original-source
crash controls and 43 original JSX listener/real-focus stop checks. The
[capture analysis](../research/pointer-capture-boundary.md) retains source
boundaries and incomplete transformed/hardware/mobile acceptance.

The subsequent [captured geometry record](pointer-geometry/README.md) adds
631/648 public checks, 14 pixels/three captures, 55 expected previous-host
failures and separate original/binding witnesses. It documents the pinned RN
numerical limitation and native local-inverse behavior; coalescing, hardware,
scroll/windows, EventTarget and mobile acceptance remain open.

The later [ref-getter fault record](pointer-resolver-faults/README.md) isolates a
throwing `canonical.publicInstance` read before the real SDK query. The identical
65-check fixture retains three same-batch TouchStart/Raw/React failures on the
previous host and passes all 65 on the corrected host. Two actual 680×160 frames
add 16 pixel assertions, two React-counter assertions and two saves for 85/85
viewport checks. The descriptor is restored before throwing; broader getter,
root/reentrant, hardware/mobile and priority acceptance remain open. Public
flags stay off and this correction's hosted CI remains pending.

The source was compiled and executed independently on **macOS arm64** using
official Godot **4.7.2**, React **19.2.3**, React Native **0.87.1**, Hermes
**250829098.0.17**, NativeWind **4.2.7** and css-interop **0.2.7**.

The GDExtension and JSX bundle were built in this standalone project. Setup
verified the native archives by SHA-256. Godot itself was not rebuilt. The
[provenance](provenance.json) records public source and evidence hashes.

## Acceptance matrix

| Scene | Headless | Native |
| --- | ---: | ---: |
| React | 36 | 36 |
| Layout | 47 | 47 |
| Input | 45 | 45 |
| Pressability | 43 | 47 |
| Chart Kit | 34 | 34 |
| ScrollView | 62 | 68 |
| NativeWind | 49 | 58 |
| Typography | 50 | 63 |
| **Total** | **366** | **398** |

**764 passing assertions in 16 runs.** [matrix.json](matrix.json) contains
commands and report filenames. The complete per-run reports are not versioned:
`npm run check` regenerates each one as `build/report.json`. Every report was
checked for scene, display mode, expected assertion count and passing results. Native runs are sequential because they share a
generated report path.

Additional release checks: 9 Node contract tests and 6 Python archive-recovery
fixtures; 4 typography Node tests (including the native line-height and rejected
attachment cases); 4 chart tests; 2 native recovery tests. Fallow reported no
unused code. The publication scan and manual source/capture review check scope
and avoid carrying environment-specific logs into the public tree.

The first hosted run exposed static analysis treating a generated test log as
an imported dependency. The test now constructs that filesystem path from the
project directory. Its native line-height check passed again, and static analysis
passed with the log absent. Runtime source and the matrix evidence are unchanged.

## Native captures

The [original EventTarget baseline](event-target/README.md) separately executes
119 headless checks in four runtimes/five surfaces, including 33 manual checks
per enabled root and three reproduced gaps. It preserves production defaults
and does not certify native EventTarget delivery or fix retained ancestry.

The [current-ancestry correction](event-target-ancestry/README.md) then executes
102 checks in each original/corrected variant against the same native host.
Real NativeDOM removals, root retirement/remount and preserved listeners are
separate from a synchronous mutable-parent graph. Shared bundling fixes the
cache. At that checkpoint native delivery was still pending; public EventTarget
flags remain off. Later native integration has its own receipt below.

The [native touch-tag correction](event-dispatch/README.md) executes 647 identical
checks per renderer variant. The original lookup fails two inside-contact
retention assertions; the corrected lookup passes all. Actual Godot input in
the legacy renderer is separate from explicit calls to the original experimental
dispatcher, whose four responder differences remain open. Public flags stay off.

The later [GF-05 runtime example](runtime/README.md) adds three real Viewport
captures with explanations of starting, pausing and completing a React clock.
Its local validation and remaining gaps are recorded separately from this
initial release snapshot.

The [shared-root record](shared-roots/README.md) adds the bounded GF-07
application owner, original AppRegistry, independent lifetimes and three actual
captures. Its matrix retains the 12-example regression results; this earlier
release snapshot and its hashes remain historical.

These images are Godot renderer readbacks of generic fixtures, not desktop
screenshots. They contain no other applications or game content.

![Initial typography](typography-initial.png)

![Clip without ellipsis](typography-clip.png)

![Font change with child state retained](typography-changed.png)

![Narrow viewport and retained child state](typography-narrow.png)

![Original Chart Kit with synthetic data](chart-initial.png)

![Chart selection and tooltip](chart-selected.png)

The typography child retains count 1 and one mount while fonts and width change.
Glyph pixels verify distinct span colors and real variable-font bold. Logical
Viewport events use validation device 1001. This does not certify physical OS
input, DPI/Retina, IME or mobile gestures.

## Line-height regression

[line-height-negative.json](line-height-negative.json) records the inclusive
run-overlap implementation failing before the fix. A 42-height first run leaked
into the next 21-height line: the measured height was 84 instead of 63. The
corrected implementation uses strict half-open overlap plus a final-run sentinel
exception. The line-height run report, regenerated as
`build/line-height-report.json`, proves both span orders, empty/trailing lines and balanced native cleanup.

The chart test also moves the native GUI pointer to the target button before
press/release after resize. Its original missing motion caused the empty-data
assertion to fail in the graphical lane. The same assertions passed with the
complete pointer sequence; they were not removed or weakened.

## Initial import limitation

The first standalone editor import with an empty `.godot` cache logged a
**signal 11** crash after resource import. The next cached import passed, as did
the editor imports preceding the retained matrix runs. The runner still rejects
crashes; no automatic retry or suppressed native error was added.

A separate font-only control without Fabric, a GDExtension or application code
passed its cold import: [editor-import-control.json](editor-import-control.json).
That control does not attribute the crash to Godot alone. The underlying engine root cause remains unresolved. The current runner
contains the late-extension-discovery failure by preparing the startup list
before import; [cold-start evidence](cold-start.md) records fresh native CI
checks without retries.

## Scope and remaining proof

Only the renderer's reviewed source, generic fixtures, font assets/licenses and
fresh public evidence are committed. This is a new repository history. Runtime
dependencies, build caches, native framework binaries, raw logs and unrelated
project documentation are excluded. The publication scanner has negative
fixtures for local paths, internal references and credential-shaped strings.

These initial results are local runtime evidence. The current workflow also
runs cold native Godot checks, original RN iOS/Android reference apps and
differential comparison. Mobile reference jobs do not certify Godot mobile
builds. [API limits](../API.md)
describe capabilities that still need dedicated validation.

The [native EventTarget integration record](event-dispatch-integrated/README.md)
adds 181/206 original/integrated headless checks, 236 viewport checks,
28 pixels/two captures, exclusive batched native delivery and two native lifetime
fixes. Its preceding-host registry failure and reentrant crash controls are
separate. Public flags remain off; this starts
GF-06 alongside continuing GF-05/GF-07/GF-08/GF-13 work.

The subsequent [native pointer-interest record](pointer-interest/README.md)
adds 193 original / 230 current headless checks and 260 current macOS viewport
checks, with 28 pixel assertions and two 820×280 captures. A query reads the
original EventTarget phase/type maps to qualify View-path `pointerdown` in an
internal opt-in; listener methods, once/abort/removal and ViewProps are preserved.
Manual document-only dispatch is positive while native callbacks/Raw down remain
zero. ScreenTouch down/up/cancel, current flattened View ancestry, removal,
rerender, separate roots and query removal at stop have executed controls.
The default installs no query. DocumentElement/other pointer categories,
arbitrary query-fault cleanup, the full flag matrix, performance, public enablement and hardware/mobile
remain open. The [audited query CI](pointer-interest/hosted-ci.json) confirms
193/230 headless checks at ab0dc44 and five successful jobs after an iOS
discovery timeout on attempt 1. Core references match 13 subset cases; no hosted
captures or Godot mobile pointer certification are implied. The initial
snapshot's hashes remain unchanged.

The [query-fault containment record](pointer-query-faults/README.md) retains
12 normative failures in the identical previous-host fixture and 186 corrected
headless / 204 macOS viewport checks. A thrown or non-boolean interest lookup
records its cause and rejects that lookup while preserving same-batch
TouchStart, both Raw channels and functional React state. Up/Cancel, retirement,
remount and stop clean up separately; four diagnostics remain visible. Two
680×160 frames and 16 exact pixels show A=0/B=0 becoming A=3/B=1. This bounds
query-call/result recovery; getter resolution, reentrancy, documents, complete
flags/events and hardware/mobile certification remain open. No new GF/checkpoint
is closed. Its [audited CI](pointer-query-faults/hosted-ci.json) confirms
186 headless checks/22 pins at b88708c with five successful jobs. The old-host
negative and graphical captures stay local; later Document/root work is outside
that committed head.

The later [Document/root interest record](pointer-documents/README.md) adds
2,723 checks across eight original/current flag configurations and 385 actual
viewport checks with 20 pixels/two 760×220 captures. Current root-family handles
resolve original Document/documentElement Maps without lazy ref creation.
Capture-only offset35 and A-none/B-doc isolation have independent controls;
the previous host retains142 normative failures with identical JS bundles.
Original gates, Raw/state/batching, membership, retirement/remount, stop and
one root throw34 are observed separately. All public flags remain off;
broader faults/events/responders/mobile and full GF acceptances stay open.
Hosted CI and this slice's Pages publication remain distinct from local proof.
