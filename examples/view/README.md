# Layers, edges and visible space

```sh
npm run example -- view
npm run example -- view --headless
npm run example -- view --capture
```

[App.jsx](App.jsx) uses public React Native `AppRegistry`, `View`, `Pressable`,
`Text`, `Button` and public element refs. [scene.tscn](scene.tscn) mounts its
`ViewGeometry` component through one explicit FabricSurface and FabricApplication.
Use the buttons to change the sibling order, remove a tile or compare high z
values. Tap the second card's heading to change its parent layer, or change the
visible region with the overflow button. Each colored tile reports its selection.

[validation.gd](validation.gd) checks the selected element through injected
Viewport mouse and touch events. It does not activate a tag or emit a native
button signal for the stacking oracle. Sibling cases cover positive and negative
z values, equal values, keyed reorder/removal and 5001 versus 4097. The nested
case compares a parent at 1 with a child at 100 against its parent's sibling at
2, then removes and restores the parent's z context. The same child must retain
its native identity and full public geometry throughout that transition. A
static-positioned tile at 99 must leave its later overlapping sibling at 0 in
front.

The overflow cases test `hidden`, `visible`, `scroll` and removal of the prop.
An outside point must select the child only when visible; an inside point must
still select it in every mode. Public `measure`, `measureInWindow`,
`measureLayout` and `getBoundingClientRect` must retain the child's whole 60 by
40 rectangle even while drawing/input is clipped. These checks also compare
public measurements with the real Godot Control geometry. Reorders and style
updates preserve native instances; deleting a tile disconnects its retained ref.

The border control also switches from four opaque colors to four half-opacity
colors over white, one uniform half-opacity red border and finally no borders.
The graphical samples require source-over color composition on each edge; the
native diagnostics require the same View to survive painter changes and every
border width to become zero when removed.
A small rounded self-border has asymmetric widths (left/right 2, top/bottom 10).
Its top-left sample requires the correct left-side color at the corner join.
This checks painting the View's own border, rather than a rounded descendant mask.

![Initial sibling order, nested layer and clipped child](../../docs/evidence/view/view-initial.png)

![High z values preserve the sibling order](../../docs/evidence/view/view-updated.png)

![Visible overflow exposes the outside child](../../docs/evidence/view/view-visible.png)

The graphical lane independently samples the actual Viewport image at each
overlap, inside and outside the clip, and on all four border edges. A public
Button is also clicked through Godot's GUI input path. Every pixel check uses an
interior point away from text and records its expected and actual RGBA values.
The capture mode saves `build/view-initial.png`, `build/view-updated.png` and
`build/view-visible.png`. Headless runs exercise hit-testing, public geometry,
React lifecycle and cleanup; they do not claim drawing proof.

Every bounded run writes `build/report.json`, including all assertions,
per-stage input targets, public/native geometry, instance identities, renderer
samples and shutdown resources. `GodotView` is example validation instrumentation;
the application uses ordinary public React Native props and event handlers.
The [executed checkpoint](../../docs/evidence/view/README.md) records 67 headless
and 107 native assertions, including 36 actual RGBA samples. The final oracle
also runs against the previous native host with a compatible prior JS baseline;
its expected failures have a separate source/binary receipt.

This fixture covers rectangular View clipping and stacking. Rounded descendant
masks, transformed clip regions, platform accessibility, native iOS/Android
comparison and the complete View prop surface remain separate acceptance work.
ScrollView's viewport/content behavior, rich Text paragraph clipping and external
adapter internals need their own regressions; this example does not substitute
for those cases.

Public View uses the original RCTView host and Fabric View descriptor. Original
mount order supplies stacking while Godot z indices remain zero. Uniform borders
retain StyleBoxFlat; four colors draw through a StyleBox Resource on the same
CanvasItem. The internal View wrapper, Pressable and ScrollView content retain
GodotControl. No border overlay nodes participate in hit-testing or layout.

This checkpoint found an offset-surface disagreement between input page points
and NativeDOM `measure`. The later [coordinate example](../coordinates/README.md)
addresses it with genuine move-out/return, moved/scaled Godot surfaces and raw
window input at content density two; its
[evidence](../../docs/evidence/coordinates/README.md) is separate from these
historical View reports. RTL, RN style transforms, fractional geometry and full
StyleSheet utilities still need further acceptance.
