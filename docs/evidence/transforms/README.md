# Original RN affine transforms

This checkpoint runs the [public transform gallery](../../../examples/transforms/README.md)
on macOS arm64 with official Godot 4.7.2, React 19.2.3, React Native 0.87.1,
Hermes and the Compatibility renderer. JSX styles reach original Fabric props,
then affect the same Godot Control's painting and GUI transform. Only the
project's GDExtension is compiled; the Godot engine is not rebuilt.

## Executed checks

| Lane | Result | What it establishes |
| --- | --- | --- |
| Headless gallery | 309 assertions passed | Independent affine coefficients/corners, public refs/measures, Yoga events, flattening identity, genuine mouse/touch events and cleanup |
| Native gallery | 345 assertions passed, including 33 RGBA samples | The same contracts plus actual transformed pixels and three saved captures |
| Preceding coordinate host | 65 of 309 headless and 68 of 345 native assertions failed | The same final fixture detects missing native transforms, target-local projection and parent-quad hitSlop behavior |
| Affine factor test | 40,932 checks passed | Reconstruction, reflections, independently sampled matrices, proportional rank-one rejection, nonfinite and nonplanar rejection |
| Rejected public transforms | Six fresh applications, 61 checks passed | Exact singular/3D/range errors, diagnostic stability and partial-mount/timer/frame/native teardown |
| Invalid embedding input | 25 checks passed | Composed determinant overflow, ignored START, restored positive press and held-contact cancellation with the last valid sample |
| Invalid external input geometry | 25 checks passed; intermediate host fails 9 of 25 | Ignored invalid START, restored genuine press and last-valid cancellation under global overflow or singular Surface |
| Example regression matrix | 18 scenes, 1,219 checks passed | Rebuilt final host preserves preceding runnable examples |
| Independent adapter regression | 17 runs, 318 checks passed | External Codegen adapter, retirement/reentrancy and graphical cases use the same final SDK host |
| JS / Python / native contracts | 205 JS, 13 Python and 10 native tests passed | Original processors, typed consumers and completed native contract regressions |

[checks.json](checks.json) retains executed assertions, analytical/native
geometry, public measurements, event coordinates and pixel samples.
[negative-control.json](negative-control.json) retains the expected failures
against the preceding coordinate implementation (`48e4253`), using the same
final fixture and JS bundle. The old host's public RN measurements already
included transforms; the fixture independently exposes its unchanged native
painting/input geometry. [guards.json](guards.json) records six isolated public
rejections. [input-guards.json](input-guards.json) records genuine input under
external Godot embedding changes. [provenance.json](provenance.json) identifies the source, native SDK,
binary, toolchain and captures; [regressions.json](regressions.json) separates
other executed suites. Local results do not certify hosted CI, exported targets
or complete RN parity.

## Original semantics on the actual Control

The platform ViewConfig uses original RN
[processTransform](https://github.com/react/react-native/blob/v0.87.1/packages/react-native/Libraries/StyleSheet/processTransform.js)
and [processTransformOrigin](https://github.com/react/react-native/blob/v0.87.1/packages/react-native/Libraries/StyleSheet/processTransformOrigin.js).
Original [ViewProps resolution](https://github.com/react/react-native/blob/v0.87.1/packages/react-native/ReactCommon/react/renderer/components/view/BaseViewProps.cpp#L532-L560)
owns operation order, percentage translation and origin offsets from the
current layout size. The adapter consumes that matrix rather than parsing a
second transform language.

A rotation/scale/rotation factorization maps the invertible 2D matrix to
Godot's public base and offset transforms. Godot
[composes both on the same Control](https://github.com/godotengine/godot/blob/4.7.2-stable/scene/gui/control.cpp#L688-L718)
when `offset_transform_visual_only=false`; its
[offset implementation](https://github.com/godotengine/godot/blob/4.7.2-stable/scene/gui/control.cpp#L2340-L2349)
supplies the second rotation. This represents reflection and shear without
extra CanvasItems, duplicated layout or a custom engine build. Size-only
updates re-resolve percentage styles and origins; style removal resets the
native Control.

The oracle calculates six affine coefficients and four exact corners directly
from the JSX cases. It checks native Controls independently of original public
measurements. For nested transforms, RN accumulates an axis-aligned bounding
box at each ancestor; that public box can exceed Godot's exact painted quad.
`measure`/`measureInWindow` include those transformed bounds. `measureLayout`
excludes visual transforms and `onLayout` remains Yoga geometry. The fixture
checks all of these contracts instead of treating the two kinds of bounds as
interchangeable.

The anonymous wrapper has no testID/background/collapsable override. Adding its
transform makes it concrete through original RN traits; removing the style
flattens it again. Its child keeps its Control, Fabric tag, ref and React state.
An explicit stacking context on the surrounding frame makes that physical
parent assertion stable while leaving the anonymous wrapper eligible to flatten.

## Observed UI and input

![Initial ordered transforms, origins and mirrored/sheared Views](transform-initial.png)

The initial capture contrasts scale-then-rotate with rotate-then-scale, a
mirrored/sheared matrix, two skews and absolute/percentage origins. Pixel checks
cover transformed interiors, a separately rotated nested child and empty areas
inside a rotated parent's AABB.

![Size-only percentage changes and transformed wrapper materialization](transform-updated.png)

Two Views resize with unchanged percentage style props. The anonymous blue
wrapper gains a transform while its child remains mounted. Original mouse and
touch START/MOVE/END events compare page, target-local and screen points,
contact arrays, responder lifetime and exactly one Pressability activation.
A hitSlop point within the parent AABB but outside its local rectangle is
rejected before it can acquire a responder.

![Removed styles restore placement and flatten the wrapper](transform-reset.png)

Removing styles restores the logical Yoga positions and flattens the wrapper.
The fixture then removes a transformed target during an active contact, checks
the later physical release and verifies final React cleanup, disconnected refs,
balanced Control creates/deletes, empty tags and no pending scheduling resources.
Move-out/return retention under translated/scaled surfaces remains the separate
[coordinate checkpoint](../coordinates/README.md); this gallery's transformed
gestures exercise movement within the retention region.

## Invalid external embeddings during input

The separate [input fixture](../../../examples/transforms/input-guards.gd)
mounts the real gallery and changes the external Godot embedding. Two local
transforms have finite nonzero determinants, but their composition has finite
coefficients and an overflowing determinant. An injected START outside the
analytical target must remain ignored, with no touch, event or responder.
Restoring the embedding then completes a genuine positive Pressability check.

For held contacts, genuine START/MOVE establishes an independently calculated
point and last valid sample. Making the embedding overflow or setting a
singular public Surface offset transform then cancels the next MOVE exactly
once. Original Pressability emits one `PressOut` with every coordinate copied
from the last valid sample; no invalid MOVE/END sample, NaN, completed press or
stale authority is published. Restoration and physical release cannot revive
the canceled contact. Shutdown balances native Controls and scheduling work.

The invalid event is consumed after cancellation so Godot's GUI does not
attempt another inverse of the singular Surface. The 25-check runner also
rejects Godot/script errors. This input safety boundary concerns external
embedding changes; it does not implement singular transforms in JSX or certify
all valid style changes during a held gesture.

## Explicit rejection and remaining boundaries

Six independent Hermes applications mount actual public styles: zero scale,
rank-one matrix, perspective, a large determinant, a small determinant and a
large pivot translation. The exact `E_TRANSFORM_SINGULAR`, `E_TRANSFORM_3D` or
`E_TRANSFORM_RANGE` must appear once. Repeated pumps cannot flood diagnostics;
stopping each application releases its partially mounted tree, native modules,
game-service work, timers and registered animation frames. Nonfinite matrices
are covered by the affine factor test (`E_TRANSFORM_NONFINITE`).

Native float factors alone are insufficient: the complete composed matrix and
its inverse must remain finite and invertible at Godot's coordinate precision.
The factor test also rejects proportional rank-one matrices whose normalized
cross-products could otherwise acquire a false nonzero determinant through
rounding.

Array percentage translation has native execution proof. The pinned upstream
JS `translateX/translateY` CSS string branch discards percentage units; use
`[{ translateX: "25%" }]` rather than `"translateX(25%)"`. CSS pixel strings
have processor-contract proof only. The adapter retains the original processor
instead of inventing a replacement parser.

GF-08/GF-10/GF-13 remain in progress. This is a bounded View/ref/input slice,
with transformed clipping, every host component, valid rotation/style changes
during an active gesture, animation, singular/3D rendering, full multitouch and mobile
reference differentials still open. The preceding
[View](../view/README.md) and [coordinate](../coordinates/README.md) records keep
their historical source and binary identities.
