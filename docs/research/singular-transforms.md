# Singular transforms on a planar Godot Control

Status: executed isolated macOS validation against pinned RN 0.87.1 and official
Godot 4.7.2. The [evidence](../evidence/singular-transforms/README.md) owns the eight
fresh applications (49 headless checks, 58 with the renderer capture), the
preceding-host control (the same bundle fails exactly its 37 normative checks), the
retained sabotage of the pointer projection (it fails exactly two) and the independent
oracle. Perspective, 3D, a weight other than 1, non-finite matrices and results outside
native coordinate precision still fail with their own errors.
Hosted run 37499277022 repeated the 49 checks and the independent oracles accept
the reports ([receipt](../evidence/singular-transforms/hosted-ci.json)).

## What RN does

A view whose planar transform is singular (no inverse) is not drawn and is not hit on
either platform, and RN raises no error; what happens to its descendants differs
between the platforms (below). The next update with an invertible transform draws and
hits the view again, because nothing is kept.

- **Where the zero comes from.** `Transform::Scale` flattens a factor whose magnitude
  is below 1e-5 to exactly 0 (`ReactCommon/react/renderer/graphics/Transform.cpp`,
  lines 43-60, with `isZero` in `Transform.h`, lines 26-31), so `scale: 0`,
  `scaleX: 0` and every animated value under 1e-5, an entrance that starts at 0 or an
  exit that ends there, produce an exactly singular matrix. A `matrix` entry is not
  flattened, so a rank-one matrix such as `[1 5; 5 25]` is singular too.
  `BaseViewProps::resolveTransform` only multiplies the operations and wraps them in
  the `transformOrigin` translations (`BaseViewProps.cpp`, lines 526-561).
- **iOS.** The matrix goes to the layer's `CATransform3D`, and a layer whose 2D part
  collapses draws nothing. `RCTViewComponentView` refuses the hit on the view itself when
  the determinant of that 2×2 part is below 1e-6 (`RCTLayerTransformCollapsesAxis`, which
  makes `pointInside:` return NO,
  `React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm`, lines 100-118). The
  descendants are another case: `betterHitTest` (lines 738-785) abandons the subtree only
  when the container clips or has no `overflowInset` and the point is outside (lines
  754-760); with a container that does not clip and has a nonzero `overflowInset` it walks
  the subviews (lines 762-767), so `hitTest:` can still reach descendants of the collapsed
  view. RN's own test covers `scaleX: 0`, `scaleY: 0` and a view scaled to 0.9 and then to
  0 (`React/Tests/Mounting/RCTViewComponentViewTests.mm`, lines 145-184), always the hit
  on the view itself.
- **Android.** `BaseViewManager` resets the decomposition context, which zeroes its
  scale (`MatrixMathHelper.kt`, lines 487-509), and `MatrixMathHelper.decomposeMatrix`
  returns early for a singular matrix, one whose 3×3 determinant is below 1e-5
  (`MatrixMathHelper.kt`, lines 22-29 and 97-114), so the view is set to scale 0
  (`BaseViewManager.java`, lines 611-632).
  `TouchTargetHelper.getChildPoint` returns `false` for a child whose matrix does not
  invert and the child is skipped with its subtree (`TouchTargetHelper.kt`, lines 216-220
  and 282-321).
- **Fabric's C++ never inverts a transform.** `LayoutableShadowNode::
  computeRelativeLayoutMetrics` applies each node's transform to its frame with
  `Transform::applyWithCenter`, the bounding box of the four mapped corners
  (`core/LayoutableShadowNode.cpp`, lines 82-198, the call at line 172;
  `graphics/Transform.cpp`, lines 460-478), so a singular matrix gives a degenerate
  frame: a point for `scale: 0`, a vertical segment for `scaleX: 0`, the bounding box of
  a diagonal segment for a rank-one matrix. `onLayout` is Yoga's frame and does not
  change;
  `getBoundingClientRect`, `measure` and `measureInWindow` come from `dom/DOM.cpp`
  (lines 273-298, 492-525 and 527-552) and report that degenerate box.

## What this host did

`affine_factors` threw `E_TRANSFORM_SINGULAR: singular transforms are not
implemented` for an exactly singular matrix, and `apply_transform` threw
`E_TRANSFORM_RANGE: transform loses rank at native coordinate precision` when a scale
factor rounded to zero in `real_t`. A static style aborted the commit that mounted it
(with a recovery error, `map::at: key not found`); an animated one failed on every
native-driver frame that reached 0. A press-in or entrance animation that starts at
scale 0, a collapsing menu or a toggled badge broke the application, where RN shows
nothing.

Godot cannot draw a singular Control. `Control.set_scale` replaces a zero component by
1e-5 (`Control.scale = (0, 0)` reads back as `(1e-05, 1e-05)`, in a scratch script), so a
Control has no singular scale of its own, and inverting a singular transform is an engine
error: `Transform2D.affine_inverse()` of one prints `Condition "det == 0" is true` in the
editor binary the lanes run (also a scratch script, not retained). The input guards of
the [transforms record](../evidence/transforms/README.md) consume the event after
cancelling the contact precisely so that Godot's GUI does not attempt another inverse of
a singular Surface. Hiding the Control is the representation that never reaches such an
inversion: nothing of it is drawn and Godot's own picking skips a hidden Control.

## The rule

The transform step now returns a result instead of throwing for rank loss. In
`native/affine_transform.h`:

- `affine_factors` returns `std::optional<AffineFactors>`: `nullopt` for a singular
  matrix, by the same exact detection as before (a zero magnitude, or proportional
  columns by the product test that avoids a false nonzero determinant after
  normalization). Non-finite and non-planar matrices still throw `E_TRANSFORM_NONFINITE`
  and `E_TRANSFORM_3D` first.
- `planar_transform<Native>` is the one definition of a collapsed View, the factors
  or `collapsed`: a singular matrix, or one whose scale factor rounds to zero in the
  Control's own precision (`Native` is `godot::real_t`; `rounds_to_zero` compares with
  half the smallest subnormal, so no conversion can overflow). Such a matrix cannot be
  inverted at that precision either, and the host used to report it as
  `E_TRANSFORM_RANGE`. `[2u u; u u]` for the smallest float subnormal `u` is the
  example: not singular, since its determinant is `u²`, but its smaller singular value,
  `0.38 u`, rounds to zero in a float.

`resolve_transform` (`transform_adapter.cpp`) returns that result and keeps the errors
for what a Control cannot carry: `E_TRANSFORM_3D`, `E_TRANSFORM_NONFINITE` and
`E_TRANSFORM_RANGE` for factors or translations out of the native range; the range of
the forward and inverse transform stays in `apply_transform`, which needs the Control's
size. `apply_transform` returns early for a collapsed result, so the Control keeps the
last invertible transform it carried and its geometry stays finite until a later update
brings an invertible one.

`ApplicationRuntime::apply` resolves once per View, stores the result with the View's
committed shadow, and decides visibility in one place:
`visible = displayType != None && !collapsed`. The existing rule for hidden Controls
then cancels the contacts of the subtree. The native driver's synchronous updates go
through the same `apply`, so an animation through 0 collapses and restores the Control
frame by frame.

Pointer projection uses the same definition. `pointer_local_point` marks a target or a
capture owner inside a collapsed subtree as hidden, as it already does for
`display: none`, instead of projecting through the Control's last invertible transform,
which no longer describes what RN draws. The delivered event keeps the offsets RN's own
retargeter computed: it subtracts the origin of the capture owner's transformed box from
the client point (`ReactCommon/react/renderer/uimanager/PointerEventsProcessor.cpp`,
lines 92-119, a "basic/incomplete implementation" by its own comment), and for
`scale: 0` that box is the point at the owner's center. The external-embedding checks
(`E_POINTER_GEOMETRY_SINGULAR` for a singular root or mounted transform) are unchanged.

## What the scene shows

Eight fresh Hermes applications, each in a Godot Surface of its own, mount the
public styles. The View under test is a `Pressable` above a `Pressable` plate with a
marker child, so a real mouse press where the box is reaches the plate while the box is
collapsed and the box once it is shown:

- `scale: 0`, `scaleX: 0`, the rank-one matrix `[1 5; 5 25]` and the float rank-loss
  matrix `[2u u; u u]`: the Control and its child are hidden and keep a finite
  invertible transform; `onLayout` reports the layout box once; `getBoundingClientRect`,
  `measure` and `measureInWindow` report the boxes RN computes (a point, a segment, a
  660 × 3300 box, a point); a real press reaches the plate.
- An `Animated.View` scaled 0 to 1 and another 1 to 0 with `useNativeDriver`: collapsed
  at rest and shown at the end, and shown at rest and collapsed at the end, with a
  real press reaching the plate or the box accordingly. Every shown frame is the planar
  matrix of its own scale. The ease leaves zero from below: in the executed run the
  first four frames are hidden and the first shown one has a factor of −1.8e-4, a mirrored
  sliver, before the scale passes 5.1e-5 and rises. The oracle also allows the first
  frames to fall back through RN's zero, which an earlier run showed (the Control
  collapses and returns), and requires that no frame is shown below 1e-5 and that none is
  hidden once the scale is clearly away from zero.
- A scale driven by React state through 0, 1.25, 0 and 1: collapse, recovery to a
  non-identity matrix, collapse, and recovery to the identity from the kept transform.
  A contact held on the shown box when the state collapses it is canceled: `pressOut`
  fires, `press` never does, and the contact and the responder are released.
- A pointer pressed on a strip and captured by the box, which then collapses while the
  pointer is down: its events keep reaching the owner with its own coordinates before
  the collapse and with RN's offsets (the client point minus the center) after it.

An independent Node oracle derives the planar matrices, the boxes RN computes and the
press and capture coordinates from the declarations and accepts the report only if every
recorded Control, frame, press and event agrees with them. The same bundle on the
preceding host fails exactly the 37 checks that need the collapse. A retained sabotage
(`scripts/transform-singular-sabotage.mjs`) removes the pointer projection's collapsed
branch and rebuilds: exactly the two capture checks fail, because the events then report
the owner's layout coordinates, and the oracle rejects the report.

## Departures from RN

- **Touches.** RN keeps a touch that is in progress inside a collapsed view; this host
  cancels it, because a Control that is not visible takes no input, as for every hidden
  subtree. Keeping the contact would need a guarded projection through a singular
  transform, which Godot does not represent (`Control.scale` is never zero).
- **Keyboard focus.** A collapse through the native driver releases the keyboard focus
  of a field inside the View (Godot's own hide; `exit/FOCUS_RELEASED` asserts that
  Godot has no focus owner and that JS saw `focus` then `blur`). A collapse through a React
  commit keeps it, because the host's transaction restores the focus owner at its
  end, as it already does for `display: none`; that is an exploratory observation, not
  asserted by the suite. RN keeps the focus in both. A guard on `is_visible_in_tree()` in
  that restoration would make the two paths agree and is an open item.
- **Descendant hits on iOS.** iOS refuses the hit on the singular view itself, but
  `hitTest:` still reaches its descendants when the container does not clip and has a
  nonzero `overflowInset` (`RCTViewComponentView.mm`, lines 754-767); Android's
  `TouchTargetHelper` skips the child and its subtree, and iOS does the same when the
  container clips. The host hides and skips the whole subtree, so neither the View nor
  its descendants are hit: a deliberate choice that matches Android and iOS's clipped
  case. The descendant hits of an unclipped, overflowing container on iOS are not
  reproduced and are an open item: they would need the descendants to stay visible and
  hittable under a singular transform, which Godot does not represent (`Control.scale`
  is never zero) without a projection per descendant.
- **Thresholds.** iOS refuses hits below a determinant of 1e-6 (a scale of about 1e-3)
  and Android treats a 3×3 determinant below 1e-5 as singular, while the host collapses
  only where RN's own flattening makes the matrix exactly singular or the scale
  rounds to zero in a float. Between 1e-5 and 1e-3 the host shows a Control whose area is
  under a pixel and which no pointer practically reaches; iOS's 1e-6 hit threshold on the
  determinant stays outside the host's exact collapse.

## Remaining scope

A real zero scale with a guarded projection, which would keep touches and focus through
a collapse, is an open alternative; 3D, `perspective`, `rotateX` and `rotateY`, a weight
other than 1 and `transformOrigin` z remain rejected; touch input on a collapsed or
restored `Pressable` (the scene presses with the mouse), transformed clipping, a
collapse under a `ScrollView`, Godot mobile exports and the contract, parity and targets
of GF-10 are not certified.
