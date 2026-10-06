# Uniform scale on a planar Godot Control

Status: executed isolated macOS validation against pinned RN 0.87.1 and official
Godot 4.7.2. The [evidence](../evidence/uniform-scale/README.md) owns the five
fresh applications (29 headless checks, 35 with the renderer capture), the
preceding-host control (the same bundle fails exactly its 22 normative checks)
and the independent oracle. `scale: 0` and every other singular transform failed with
`E_TRANSFORM_SINGULAR` when this slice ran (the
[singular transforms slice](singular-transforms.md) collapses them as RN does);
perspective and any rotation out of the plane still fail with `E_TRANSFORM_3D`.
Hosted run 37455258901 repeated the 29 checks and the independent oracle accepts
its report ([receipt](../evidence/uniform-scale/hosted-ci.json)).

## What RN does

RN converts `{ scale: n }` to one `TransformOperation` of type `Scale` with
`x = y = z = n` (`ReactCommon/react/renderer/components/view/conversions.h`,
lines 811-819), and `Transform::Scale` writes `matrix[0] = x`, `matrix[5] = y` and
`matrix[10] = z` (`graphics/Transform.cpp`, lines 43-60). So a uniform scale always
carries `n` at index 10, while `scaleX` and `scaleY` keep `z = 1` (lines 820-843)
and `scaleZ` writes only `z` (line 844).
`BaseViewProps::resolveTransform` multiplies the operations in order and wraps the
result in the `transformOrigin` translations (`BaseViewProps.cpp`, lines 532-561).
The C++ Native Animated builds the same style: `TransformAnimatedNode` collects
`{ scale: value }` for every frame (`animated/nodes/TransformAnimatedNode.cpp`,
lines 35-56), and the clone of the mounted props goes through the same
conversion. An animated uniform scale is therefore the same matrix, once per
frame.

The platforms render it in the plane. iOS copies all 16 entries to the layer's
`CATransform3D` (`React/Fabric/RCTConversions.h`, lines 147-166, applied in
`RCTViewComponentView.mm`, lines 355, 657 and 694): the third diagonal entry
multiplies z, and the content of a view lies at z = 0. Android decomposes the
matrix and applies `scale[0]` and `scale[1]` as `scaleX` and `scaleY`
(`BaseViewManager.java`, lines 618-632); `scale[2]` is never read.

## What this host did

`native/affine_transform.h` rejected any matrix whose `[10]` was not 1 with
`E_TRANSFORM_3D: expected a planar affine transform`, so every uniform scale
failed: a static one when the tree mounted, an animated one on every frame the
native backend delivered (the exception is caught where the backend's update is
applied, so the Control stayed unscaled and the host recorded one error per
frame). The guard was written for 2D affine styles and treated index 10 like the
entries that really leave the plane.

## The rule

With every z-coupling entry (`[2]`, `[3]`, `[6]`, `[7]`, `[8]`, `[9]`, `[11]`,
`[14]`) zero, `[10]` only multiplies z; a Control's points have z = 0, so it cannot
move any point of the plane, and it is not part of the planar rule. `[15]` is
different: it divides x and y, so it must stay 1. The z-coupling entries stay
rejected; they are what `rotateX`, `rotateY` and `perspective` write (for
`rotateX` and `rotateY` the entry at `[10]` is a cosine, which is why the old
check was not a reason to reject them either). `scaleZ` writes only `[10]`, so it
becomes a no-op in the plane, as on both platforms; the scene does not exercise it,
the unit test covers its matrix. 3D is out of scope: this change makes the planar
rule exact, it does not add a 3D transform.

The rule has one definition now, `planar_violation` in `affine_transform.h`
(`None`, `ZCoupling` or `Weight`). The transform adapter reports it as
`E_TRANSFORM_3D` with its two messages, and the pointer projection
(`pointer_geometry.cpp`, `local_transform`) as `E_POINTER_GEOMETRY_3D`; both used to
carry a copy, and the copies would have disagreed about `[10]`.

The pointer projection's copy cannot be reached from a Godot scenario with a scaled
node. `pointer_local_point` anchors at the deepest mounted node from the target
upward and calls `local_transform` only for the nodes below the anchor. A node with a
transform forms a stacking context (`ViewShadowNode.cpp`, line 48) and is always
mounted, so it is its own anchor. Counting the calls in a scratch build gave 0 in
the five-application scene, with real presses on a scaled `Pressable`, and 7 in the
`pointer-geometry` example, all with the identity matrix (flattened refs). The
branch is covered by the unit test of the shared predicate, which includes RN's
`Float` matrices.

## What the scene shows

Each case runs in a fresh Hermes application and a Godot Surface of its own, and the
Control is compared with a planar matrix derived from the JSX declaration, not from
anything the host reports:

- `scale: 1.5`, `[{ scale: 0.5 }, { rotate: "30deg" }]` and `scale: 1.5` about
  `transformOrigin: ["25%", "75%"]`: six affine coefficients, four corners, the
  Control's scale on both axes, its angle and its position.
- `Animated.View` scaled 1 to 1.5 with `useNativeDriver`, then back by a real
  press on a button: every frame is a uniform scale and the matrix of its own
  factor, and the Control ends on the identity.
- A `Pressable` with `scale: 1.2` takes two real mouse presses. One just outside
  the scaled box reaches nothing; one outside the layout box but inside the scaled
  one fires `pressIn`, `pressOut` and `press` once, and reports the point the
  inverse of the scaled matrix gives (6.67, 95.0), against the (-8, 104) an
  unscaled hit test would have implied. Godot's `hit_test` and the projection use
  the Control's real transform.

An independent Node oracle derives the same matrices from the declarations and
accepts the report only if every recorded Control, frame and press agrees with
them; in a scratch run, not retained, it rejected 33 of 33 hand-edited copies. The
same bundle on the preceding host fails exactly the 22 checks that need the scale,
with `E_TRANSFORM_3D` as the first error of every mount.

## Remaining scope

`scale: 0`, `scaleX: 0` and any singular matrix failed with `E_TRANSFORM_SINGULAR` here
(a press-in animation that starts at zero is common; the
[singular transforms slice](singular-transforms.md) is that requirement); 3D,
perspective, `rotateX`/`rotateY`, a weight other than 1
and `transformOrigin` z remain rejected; transformed clipping, touch input on a
scaled `Pressable` (the scene presses with the mouse), Godot mobile exports and the
contract, parity and targets of GF-10 are not certified.
