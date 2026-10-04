# Public View: stacking, clipping and solid borders

This checkpoint runs the [View example](../../../examples/view/README.md) on
macOS arm64 with the official Godot 4.7.2 Compatibility renderer. The application
imports public React Native components and refs. Public `View` uses original
`ViewNativeComponent` (`RCTView`) and `ViewComponentDescriptor`; the internal
View wrapper, Pressable and ScrollView content still use GodotControl.

## Executed checks

| Lane | Result | What it establishes |
| --- | --- | --- |
| Headless View | 67 assertions passed | Viewport-injected target selection, public/native geometry, keyed identity, style updates, ref cleanup and shutdown |
| Native View | 107 assertions passed, including all 36 RGBA samples | Actual stacking/clipping/border pixels, the same functional contracts, GUI Button activation and capture output |
| Previous-host control | 9 of 67 headless and 24 of 107 native assertions failed | The final oracle detects prior stacking, clipping and border behavior; this control is expected to fail |
| Native adapters | 17 runs, 318 assertions passed | External generated Props, modules, event/command authority and root retirement regressions |
| Example regression matrix | 16 scenes, 672 headless assertions passed | Public components, NativeWind logical measurements, layout, services and lifecycle on the rebuilt host |
| NativeWind native | 58 assertions passed | Original interop, responsive logical-parent geometry and actual Control/pixel agreement |
| JS / Python / native contracts | 202 JS, 13 Python and 10 native tests passed | The completed contract suites recorded in the regression receipt |

The previous-host control uses a compatible prior JS baseline rather than
asking the old binary to register the new RCTView provider. Its binary, source
identities and assertion failures are in [negative-control.json](negative-control.json).
The new host's source/toolchain and binary identities are in
[provenance.json](provenance.json); [checks.json](checks.json) preserves the View
assertions and pixel values. Other completed suites are recorded in
[regressions.json](regressions.json). These are local runtime proofs, not a
claim of hosted CI, exported targets or a complete mobile comparison.

The [preceding CI record](preceding-ci.json) confirms all five jobs at `b5dafc8`
passed. That run predates this View implementation; its success does not certify
the new slice. The [new hosted CI](ci.json) at `b5df4d6` subsequently passed all
five jobs. Its bounded reference comparison does not certify complete View
rendering parity or Godot mobile ports.

## Observed behavior

Original Fabric mount order controls both paint and target selection; mounted
Godot Controls use `z_index = 0`. The fixture covers positive/negative and equal
z values, keyed reorder/removal, values above Godot's former clamp, nested parent
contexts and `position: 'static'`. State/style changes preserve the selected
child's native identity. Rectangular `overflow: 'hidden'` and `'scroll'` clip
drawing and targeting; `'visible'` and prop removal restore outside selection.
Public measurements retain the child's full rectangle while it is clipped.

RN's original `resolveBorderMetrics` supplies the four physical colors and
widths. Uniform color uses native StyleBoxFlat. Distinct colors use one
StyleBox Resource drawing into the existing Control's CanvasItem; no overlay
Controls enter the layout or hit tree. The executed samples cover four opaque
colors, four half-opacity colors over white, a uniform translucent border,
removal to zero widths, and the asymmetric rounded corner join. Alpha composes
over the outer background; each curved join intersects the same corner-to-inset
ray independently on the outer and inner contours. Snapshots retain the resolved
colors and painter selection.

![Initial sibling order, nested context, clipped child and four border colors](view-initial.png)

![High z values retain the correct order and nested context](view-updated.png)

![Visible overflow exposes the child's drawing and target region](view-visible.png)

## Remaining boundaries

GF-10 remains open for RTL, transforms, rounded descendant masks, fractional
geometry, the complete StyleSheet utility surface and original iOS/Android
differential rendering. The rounded sample tests the View's own border, not a
descendant clip mask. Its interior pixels do not certify every antialiased seam
or fractional/DPI configuration. ScrollView, rich Text and adapter child
containers retain their separate acceptance requirements.

A concrete GF-08/GF-13 coordinate gap remains: input page points use Viewport
coordinates while NativeDOM `measure` reports root coordinates for this
Surface's offset. The executed interior taps do not establish genuine movement
gesture or scaled-root correctness. Physical mouse/touch hardware and system
IME are also outside these injected-input/readback checks.
