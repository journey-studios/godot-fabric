# Original React Native transforms

```sh
npm run example -- transforms
npm run example -- transforms --headless
npm run example -- transforms --capture
npm run test:transforms:guards
npm run test:transforms:guards -- --capture   # the uniform scale and singular transform captures, in native windows
```

This public RN gallery mounts through AppRegistry and renders real Godot
Controls. Nine cards compare percentage translation, absolute/percentage
origins, scale/rotation order, a reflected affine matrix, skew, flattening and
a Pressable under a transformed parent. A nested child distinguishes original
RN measurement bounds from the exact painted corners.

## Use the gallery

![Initial ordered transforms and origins](../../docs/evidence/transforms/transform-initial.png)

**Initial transforms** uses the styles in [App.jsx](App.jsx). The red and orange
cards apply the same scale and rotation in different orders. The teal card is
mirrored and sheared; the cyan card combines two skews. The purple card contains
a separately rotated white child. Drag and release the green Pressable to
exercise genuine target-local coordinates and React pressed state.

![Size updates and wrapper materialization](../../docs/evidence/transforms/transform-updated.png)

**Resize and unflatten** changes two card sizes from 80×50 to 100×60 without
replacing their transform props. Percentage translation and origins resolve
against the new size. The blue card's anonymous wrapper gains a transform and
becomes a concrete native node. Its child keeps the same ref, native Control
and React counter state.

![Removed transforms restore logical placement](../../docs/evidence/transforms/transform-reset.png)

**Remove transforms** clears the styles and restores Yoga placement. The
anonymous wrapper flattens again; its child remains mounted. `onLayout` changes
only when Yoga geometry changes, while original `measure`/`measureInWindow`
include the transformed bounds and `measureLayout` retains logical geometry.

## Uniform scale

```sh
npm run test:transforms:guards              # headless: rejections, input guards, the uniform scale and singular lanes
npm run test:transforms:guards -- --capture # the renderer captures, in native windows
```

![Uniform scale: static, animated and pressed](../../docs/evidence/uniform-scale/transform-uniform-scale.png)

RN writes `transform: [{ scale: n }]` as `scale3d(n, n, n)`. The host used to reject
that matrix for its z entry, so no `scale` mounted; it now draws it as a planar
uniform scale on the same Control. [uniform-scale.gd](uniform-scale.gd) mounts five
cases from [App.jsx](App.jsx), each in a fresh Hermes application and a Surface of its
own, and compares every Control with a matrix derived from the JSX: `scale: 1.5`
(blue); `scale: 0.5` then `rotate: "30deg"` (orange, shrunk and turned); `scale: 1.5`
about `transformOrigin: ["25%", "75%"]` (purple, the white dot marks the origin); an
`Animated.View` (green) scaled 1 to 1.5 with `useNativeDriver`, every frame a uniform
scale, and back by a real press on Pop; and a `Pressable` (pink) with `scale: 1.2`
that takes two real mouse presses. One outside its scaled bounds reaches nothing; one
outside its layout box but inside the scaled one fires `pressIn`, `pressOut` and `press`
once and reports the target-local point the inverse of the scaled matrix gives, which
the card's caption shows. The pale outline in each card is the layout box, where the
scale starts.

`rotateX` and a weight other than 1 join perspective as public rejection cases, so the
guard still proves it rejects real 3D. `scale: 0` and every other singular transform
failed with `E_TRANSFORM_SINGULAR` until the
[singular transforms record](../../docs/evidence/singular-transforms/README.md). The
[evidence](../../docs/evidence/uniform-scale/README.md) records the 29 headless and 35
native checks, the preceding host failing exactly 22 and the independent oracle.

## Singular transforms

```sh
npm run test:transforms:guards              # headless: rejections, input guards, the uniform scale and singular lanes
npm run test:transforms:guards -- --capture # both renderer captures, in native windows
node scripts/transform-singular-sabotage.mjs # rebuilds without the pointer projection's collapsed branch
```

![Singular transforms: collapsed and shown Views](../../docs/evidence/singular-transforms/transform-singular.png)

RN draws and hits no view whose planar transform has no inverse, and raises no error:
`scale: 0`, `scaleX: 0`, a rank-one matrix and every animation that starts or ends at 0
are such views, and the next invertible transform shows the view again. The host used to
throw `E_TRANSFORM_SINGULAR` for them. It now hides the Control and its subtree, keeps
the last invertible transform the Control carried and raises nothing. Hiding the subtree
is deliberate: Android skips the child and its subtree and so does iOS when the
container clips, while iOS's `hitTest:` can still reach descendants of an unclipped
container with a nonzero `overflowInset`, which the host does not reproduce.
[singular.gd](singular.gd) mounts eight cases from [App.jsx](App.jsx), each in a fresh
Hermes application and a Surface of its own. In every card the blue-grey plate is a
`Pressable` behind the box, the box is a `Pressable` (a `View` in the capture card) with
a white marker child, and the pale outline is the layout box. The caption counts the
real mouse presses each one received: a press where the collapsed box would be reaches
the plate.

The top row is collapsed: `scale: 0`; `scaleX: 0`; the rank-one matrix `[1 5; 5 25]`;
and `[2u u; u u]` for the smallest float subnormal `u`, which is not singular but loses
its rank in a float, where the Control stores its scale. `getBoundingClientRect`,
`measure` and `measureInWindow` report the boxes RN computes for them (a point, a
segment, a 660 × 3300 box, a point) and `onLayout` the unchanged layout box. The
bottom row: an `Animated.View` scaled 0 to 1 with `useNativeDriver` (green, shown at
the end, so a press reaches the box); an `Animated.View` scaled 1 to 0 (pink, collapsed
at the end, so a press reaches the plate); a scale that React state moves through 0,
1.25, 0 and 1 (teal, shown at 1.25 in the capture; a contact held on the box when the
state collapses it is canceled); and a pointer pressed on the grey strip and captured by
the box (rose, collapsed in the capture), which collapses while the pointer is down: its
events keep reaching the box with RN's own offsets. The
[evidence](../../docs/evidence/singular-transforms/README.md) records the 49 headless
and 58 native checks, the preceding host failing exactly 37, a retained sabotage of the
pointer projection failing exactly 2 and the independent oracle.

## What the validation establishes

[validation.gd](validation.gd) compares six independently calculated affine
coefficients and four corners with each native Control. It checks original RN
public refs, ancestor-by-ancestor measurement bounds, size updates, style
removal and native identity across flattening. Mouse and touch START/MOVE/END
events verify root/local/screen points, contact arrays and original Pressability
callbacks. A point inside the rotated parent's AABB but outside its actual quad
must not activate the expanded hitSlop. Removing a held target retires its
responder; a later physical release cannot resurrect it.

The executed [checkpoint](../../docs/evidence/transforms/README.md) retains 309 headless
and 345 native assertions, 33 RGBA samples, three actual captures, the expected failures
against the preceding host and six isolated public rejection cases with 61 checks: zero
scale, a rank-one matrix, perspective, a large determinant, a small determinant and a
large pivot translation. The current guard ([guards.gd](guards.gd)) also has six
isolated public cases and 61 checks, but not the same six: perspective, `rotateX`, a
weight other than 1 and the checkpoint's three out-of-range cases. Zero scale and the
rank-one matrix became positive cases in the
[singular transforms record](../../docs/evidence/singular-transforms/README.md), and
`rotateX` and the weight came with the
[uniform scale record](../../docs/evidence/uniform-scale/README.md). The current cases
include precise errors, partial-mount cleanup, timers and animation frames. The separate
[input guard](input-guards.gd) passes 25 checks: finite local embeddings whose
composition overflows, an ignored START, restoration followed by a genuine press, and
held-contact cancellation after overflow or a singular external Surface transform.
Cancellation preserves the last valid coordinates, emits no NaN or completed press and
cannot be revived by the later physical release. These results are from macOS arm64 with
official Godot 4.7.2 and RN 0.87.1.

## Supported boundary

Original RN processors and `ViewProps.resolveTransform` determine order,
percentages and origins. The adapter uses the same Control's public base/offset
transforms for painting and GUI coordinates; it adds no wrapper nodes and does
not rebuild Godot. Invertible 2D affine styles are supported in this fixture, and
so is a uniform `scale` (RN's `scale3d(n, n, n)`), static or animated, whose z entry
cannot move a point of a planar Control. A singular transform (`scale: 0` included), or
one that loses rank at native precision, collapses its View as RN does: hidden, not hit,
no error, restored by the next invertible transform. Nonfinite, 3D/perspective (any
entry that couples z, or a weight other than 1) and transforms outside native
coordinate precision fail explicitly.

Input cancellation under an invalid external Godot embedding is a separate
boundary from rendering singular JSX styles, which collapse their View (see
[Singular transforms](#singular-transforms)); an external singular embedding still
cancels the held contact. Changing valid rotation/style transforms during a held
gesture still requires dedicated acceptance.

Use array syntax for percentage translation, such as
`transform: [{ translateX: "25%" }]`. The pinned RN JS processor discards
percentage units in CSS `translateX/translateY` strings; CSS pixel strings have
processor-contract proof only. Transformed clipping, animation, complete
input/ref contracts and mobile reference parity remain open in the
[roadmap](../../ROADMAP.md).
