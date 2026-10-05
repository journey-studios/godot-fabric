# Original React Native transforms

```sh
npm run example -- transforms
npm run example -- transforms --headless
npm run example -- transforms --capture
npm run test:transforms:guards
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

## What the validation establishes

[validation.gd](validation.gd) compares six independently calculated affine
coefficients and four corners with each native Control. It checks original RN
public refs, ancestor-by-ancestor measurement bounds, size updates, style
removal and native identity across flattening. Mouse and touch START/MOVE/END
events verify root/local/screen points, contact arrays and original Pressability
callbacks. A point inside the rotated parent's AABB but outside its actual quad
must not activate the expanded hitSlop. Removing a held target retires its
responder; a later physical release cannot resurrect it.

The executed [checkpoint](../../docs/evidence/transforms/README.md) retains
309 headless and 345 native assertions, 33 RGBA samples, three actual captures
and the expected failures against the preceding host. Six isolated public
guard cases pass 61 checks, including precise errors, partial-mount cleanup,
timers and animation frames. The separate [input guard](input-guards.gd) passes
25 checks: finite local embeddings whose composition overflows, an ignored
START, restoration followed by a genuine press, and held-contact cancellation
after overflow or a singular external Surface transform. Cancellation preserves
the last valid coordinates, emits no NaN or completed press and cannot be
revived by the later physical release. These results are from macOS arm64 with
official Godot 4.7.2 and RN 0.87.1.

## Supported boundary

Original RN processors and `ViewProps.resolveTransform` determine order,
percentages and origins. The adapter uses the same Control's public base/offset
transforms for painting and GUI coordinates; it adds no wrapper nodes and does
not rebuild Godot. Invertible 2D affine styles are supported in this fixture.
Singular, nonfinite, 3D/perspective and transforms outside native coordinate
precision fail explicitly.

Input cancellation under an invalid external Godot embedding is a separate
boundary from rendering singular JSX styles; singular rendering remains
unsupported. Changing valid rotation/style transforms during a held gesture
still requires dedicated acceptance.

Use array syntax for percentage translation, such as
`transform: [{ translateX: "25%" }]`. The pinned RN JS processor discards
percentage units in CSS `translateX/translateY` strings; CSS pixel strings have
processor-contract proof only. Transformed clipping, animation, complete
input/ref contracts and mobile reference parity remain open in the
[roadmap](../../ROADMAP.md).
