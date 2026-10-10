# Density, safe-area insets and landscape for the Frontier HUD

Status: source investigation against pinned RN 0.87.1 and official Godot 4.7.2 (`4.7.2-stable`), plus two executed lanes on
the desktop: the headless lane (`npm run test:mobile-density`, macOS arm64: 132 checks, an independent oracle, the control on
main before the slice with 74 checks failing, exactly the normative ones, and four retained host sabotages that the probe and
the oracle both reject) and a local windowed run on a Retina display at scale 2 (11 checks with pixels read back from three
captures). **The iOS simulator lane that was planned was not run, and will not be in the 0.5**: the user's decision of
2026-10-09 is a NO-GO for the iPhone gate, the 0.5 closes as a complete macOS milestone, and mobile goes back to GF-35
(the V05-08 preparation was blocked in PR #102; see [the device record](../evidence/frontier-device/README.md)). "The
simulator" below keeps what that lane would have had to show and why only the x86_64 simulator could ever have run it.
Nothing here was run on a simulator, a physical device or Android.

The requirement that opened the slice (milestone 0.5, item V05-08): with `canvas_items` stretch, `Dimensions.scale`
coincides with the screen's scale and a 44-point Pressable measures 44 ± 0.5 through `measureInWindow`; the whole HUD lies
inside the insets; 20 automated touches are 20 `onPress`. The slice covers the density and the insets on the desktop and does
not claim V05-08; the touch and background criteria are other work, and the real iOS reading of the safe area is GF-35's.

References to Godot are files of the `4.7.2-stable` tag; references to RN are files of the pinned package
(`node_modules/react-native`); the others are files of this repository.

## 1. How the density was derived, and what the policy changes

**What the host reports.** A Fabric point is a Godot content coordinate. `native/fabric_application.cpp:229-251` reads the
metrics of the window on every pump: the size is `Window::get_visible_rect().size`, and the scale is the scale of
`get_final_transform() * get_global_canvas_transform().affine_inverse()`, the transform from content to window pixels.
It refuses an embedded window, `CONTENT_SCALE_MODE_VIEWPORT` and a non-uniform scale (`:234-235`, `:244-245`).
`Dimensions.get('screen')` is `screen_get_size` over that scale (`:248-251`). The same scale is `pointScaleFactor`
of every layout (`native/application_runtime.cpp:739`, `:971`), and `update_viewport` (`:920`) emits
`didUpdateDimensions` when the size, the scale or the screen change. The metrics, with the scale, size and screen,
are `native/window_metrics.h`.

**What Godot does with a content scale.** `Window::_update_viewport_size` (`scene/main/window.cpp:1302-1432`):
- With `content_scale_size` zero (or the mode disabled) the window's 2D size override is its pixel size over
  `content_scale_factor` (`:1328-1330`). That override is what `Viewport::_set_size` turns into
  `stretch_transform.scale(size / override)` (`scene/main/viewport.cpp:1133-1138`), and
  `get_final_transform()` is `stretch_transform * global_canvas_transform` (`viewport.cpp:1391-1394`; the Window's
  version also multiplies `window_transform`, `window.cpp:3233-3236`). `get_visible_rect()` answers with the override
  as its size (`viewport.cpp:1238-1250`).
- With a content size set, `CONTENT_SCALE_MODE_CANVAS_ITEMS` derives the override from the aspect and the content
  size (`window.cpp:1407-1413`) and `VIEWPORT` mode is a different path altogether (`:1414-1424`).
- `set_content_scale_factor` calls `_update_viewport_size` at once (`window.cpp:1887-1892`), so a Control anchored to
  the window follows in the same call.
- The project settings `display/window/stretch/mode` and `scale` are applied once, at startup (`main/main.cpp:4627-4631`).
  Every `project.godot` this repository ships leaves stretch disabled, so `Dimensions.scale` was 1.0 on every
  platform, the iPhone included.

**What RN does.** `RCTExportedDimensions` (`React/CoreModules/RCTDeviceInfo.mm:186-208`) gives both `window` and
`screen` the scale `UIScreen.mainScreen.scale` and the sizes in points (`window` from the key window, `screen` from
the screen's bounds). RN's layout, hit testing and `measureInWindow` are in points. The recorded simulator run shows
the gap: iPhone 16e reported 2532x1170 at scale 1.0 (`docs/evidence/ios-consumer/simulator-x86_64-final.json:26-38`)
while `UIScreen.scale` is 3, so a 44-point control was 44 pixels, a third of its size on the glass.

**The policy.** `FabricApplication.density_policy` is `content` (the default: today's behavior, nothing changes for an
existing project) or `screen` (`native/fabric_application.cpp:153-155`, `:172-177`). It can change only before the
application initializes. With `screen`, `apply_density_policy` (`:190-198`) runs inside the per-pump metrics read
(`:233`), before the window is judged:
- the mode is pinned to `CANVAS_ITEMS` (it also guarantees the viewport mode the host refuses never survives),
  `content_scale_size` to `(0, 0)` and `content_scale_factor` to the screen's scale, and each is set only when it
  differs, so nothing is set on a steady pump;
- the screen's scale is `DisplayServer.screen_get_scale(window_get_current_screen(...))` (`:178-184`), or
  `validation_screen_scale` where the display server has one scale (headless: `servers/display/display_server_headless.h:71`).
  On iOS that is `[UIScreen mainScreen].scale` (`platform/ios/display_server_ios.mm:116-122`), on macOS the backing
  scale of the screen when hi-DPI is allowed (`platform/macos/display_server_macos.mm:1490-1506`), and 1.0 by default
  (`servers/display/display_server.cpp:579-581`);
- a change of the screen's scale (a window dragged to another display) is applied on the next pump, with no timer,
  and `Dimensions.scale`, `pointScaleFactor` and `didUpdateDimensions` follow: one event per change of the scale.

Trade-offs: the 2D world under the same window is scaled too, which is what a game on a
phone wants; a project that set its own stretch is overridden for as long as the policy is `screen`; mixed-DPI moves are
re-applied rather than pinned to the first display.

## 2. RN's SafeAreaView on iOS, and what this host replicates

**RN.** `Libraries/Components/SafeAreaView/SafeAreaView.js:30-32` is `Platform.select({ios:
RCTSafeAreaViewNativeComponent, default: View})`. This platform's `Platform.OS` is `"godot"`, so RN's own module is a plain
`View` here, which is what `tests/modal-host-native.test.mjs` used to assert. The native component is the
`SafeAreaView` host component of `src/private/components/safeareaview/specs/RCTSafeAreaViewNativeComponent.js` (no props
of its own: `ViewProps`). On iOS `React/Fabric/Mounting/ComponentViews/SafeAreaView/RCTSafeAreaViewComponentView.mm`:
- keeps the `State` it is handed (`updateState:oldState:`, `:77-81`) and asks to refresh it from `safeAreaInsetsDidChange`
  (`:31-36`) and `finalizeUpdates` (`:83-87`), that is, after every update of the view and whenever UIKit's safe area
  changes;
- reads `self.safeAreaInsets`, which UIKit computes for the view's own frame in its window, rounds each side to a pixel
  with `RCTRoundPixelValue` (`:44-48`; `React/Base/RCTUtils.mm:432-436`, `round(value * scale) / scale`, the scale being
  `RCTScreenScale`, `:342-350`);
- builds the update with `updateState` and a callback: below a threshold of `1 / RCTScreenScale() + 0.01` on every side
  the callback returns `nullptr` and the State keeps its data (`:50-67`). A change of exactly one pixel (`1/scale`) is
  under the threshold; two pixels are over it.

`SafeAreaViewState` is `{EdgeInsets padding}` (`ReactCommon/react/renderer/components/safeareaview/SafeAreaViewState.h:38`),
and `SafeAreaViewComponentDescriptor::adopt` applies it to Yoga as the node's padding
(`SafeAreaViewComponentDescriptor.h:20-27`). The component name is `"SafeAreaView"`
(`SafeAreaViewShadowNode.cpp:13`). The host compiles none of this today; `SafeAreaView` in the Godot facade was RN's `View`.

**This host.**
- `react/renderer/components/safeareaview` is compiled (`native/CMakeLists.txt`, the `MODULES` list), the descriptor is
  registered (`native/application_runtime.cpp:625`) and the component mounts as the host's `View` control
  (`component_kind`, `:102`; the apply path, `:1570`). The facade's `SafeAreaView` is RN's
  `RCTSafeAreaViewNativeComponent` rendered through the same function as the `View`, with `checkProps("View")`
  (`src/react-native-platform.jsx:87-93`, `:188-201`).
- The pure rule is `native/display_insets_core.h`: `unsafe_bands` (the band of each window edge the OS leaves out, from the
  safe-area rectangle in screen pixels, `:37`), `view_insets` (UIKit's rule for a view: the part of each band that the
  view's frame in the window reaches, `:51`), `round_to_pixel` (`:59`), `update_threshold` and `needs_update`
  (`:72-79`), unit-tested in `native/display_insets_core_test.cpp`.
- `native/display_insets.cpp` reads the window's bands (`window_unsafe_edges`, `:21`) and mirrors
  `_updateStateIfNecessary` (`follow_safe_area`, `:47`): it computes the padding and, when a side is the threshold
  away from the State's, asks RN to replace the State with the callback form of `updateState`, which cancels itself
  below the threshold exactly like RN's.
- `native/application_runtime.cpp:899` (`update_safe_area_views`) resolves each SafeAreaView to its State and to its
  frame in the window, the one `measureInWindow` reports (`window_rect`, `:436`, shared with `NativeDOM`), and calls it.

**Where it differs from RN iOS.**
1. *The refresh runs every pump.* RN refreshes on `safeAreaInsetsDidChange` and `finalizeUpdates`. Godot has no
   change signal for the safe area or the frame, so the host recomputes on every pump (`application_runtime.cpp:1203`,
   after the window was read and before the event beat, so the update is delivered in the same pump). The threshold and
   the self-cancelling callback keep a steady pump from asking RN for anything (the lane asserts zero requests across a
   change of scale and a change under the threshold). A view whose padding depends on another's (a SafeAreaView nested in
   the HUD) can be updated twice before it settles; the final state is the same.
2. *Rounding is at the content scale.* RN rounds at the screen's scale; here the pixel is the content scale of the window
   (`WindowMetrics.scale`). Under `density_policy=screen` the two are the same number.
3. *No mapping of `View.js`.* RN's iOS SafeAreaView goes straight to the native component, not through `View.js`, so the
   `aria-*`, `id` and `tabIndex` mappings of that file do not apply and the view config drops those names. The facade
   keeps the View's prop table, `withExplicitRoles` and the style check (`renderHostView`), so a prop the host refuses on a
   View is refused here with the same message. The manifest row says so (`docs/compatibility/scope-0.5.json`).
4. *A view that hangs outside the window.* UIKit's rule gives a view the part of it that lies outside the safe rectangle,
   so a view 20 points past the window edge with no insets keeps a padding of 20. The lane records that case instead of
   asserting that clearing the insets clears everything.

## 3. `get_display_safe_area` by platform

The base `DisplayServer::get_display_safe_area()` is `screen_get_usable_rect()` (`servers/display/display_server.h:310`).
- **iOS.** The override (`drivers/apple_embedded/display_server_apple_embedded.mm:482-491`) takes the godot view's
  `safeAreaInsets` and returns `Rect2i(screen_get_position() + insets_position * scale, screen_get_size() -
  insets_size * scale)`: **physical pixels in screen coordinates**, with the scale `[UIScreen mainScreen].scale`. The host
  converts to points with the window's content scale (`display_insets_core.h:37-46`) and uses the window's position and
  size, so a window that is not the whole screen keeps only the bands it overlaps.
- **Android.** The override asks the Java side (`platform/android/display_server_android.cpp:264-268`). The host reads it
  through the same function; it is not exercised here.
- **macOS.** There is no override, so the answer is `screen_get_usable_rect()` of the screen, its `visibleFrame` (menu
  bar and Dock) times the scale (`platform/macos/display_server_macos.mm:1515-1535`): a non-zero rectangle that is not a
  safe area. **The host never reads it**: `window_unsafe_edges` returns zero unless `OS.has_feature("ios")` or
  `"android"` (`native/display_insets.cpp:21-26`), so a desktop window is never padded by the Dock.
- **Headless.** `screen_get_usable_rect` is `Rect2i()` (`servers/display/display_server_headless.h:69`), so the fallback
  is an empty rectangle, which `unsafe_bands` treats as no information.
- There is no change signal for the safe area; the pump polls, as `update_viewport` does for the rest of the window.

Because the desktop cannot report a safe area, the lane states the bands through `validation_safe_area` (a Dictionary of
`left`, `top`, `right`, `bottom` in points), honored on any OS; removing the meta returns to the platform. The
conversion from pixels, and the iOS reading itself, are the part of the rule only the simulator can exercise.

## 4. Orientation

The landscape lock is the project setting `display/window/handheld/orientation` (default 0, landscape; read at
`main/main.cpp:2836` and applied with `screen_set_orientation` at `:3463`). No project in this repository sets it.
- **Export.** The iOS exporter writes `UISupportedInterfaceOrientations` from it
  (`editor/export/editor_export_platform_apple_embedded.cpp:535-572`): `SCREEN_LANDSCAPE` is `LandscapeLeft` only for the
  iPhone; the iPad list is separate (`:573-610`, `LandscapeRight` for landscape).
- **Runtime.** The view controller's mask follows `screen_get_orientation`
  (`drivers/apple_embedded/godot_view_controller.mm:313-357`; `shouldAutorotate` only for the sensor modes), and the
  display server stores the value `screen_set_orientation` was given (`display_server_apple_embedded.mm:692-698`).
- **Desktop.** The base `screen_get_orientation` returns `SCREEN_LANDSCAPE` whatever the window is
  (`servers/display/display_server.cpp:575-577`), so on a desktop it proves nothing: the check that the app is in
  landscape, and that the exported Info.plist lists landscape only, is the simulator lane's.

A landscape game sets the project setting explicitly rather than rely on the default; `docs/IOS_BUILD.md` and the SDK README
are to say so when the evidence is recorded.

## 5. The simulator (not run)

This lane was never executed: the iPhone gate of the 0.5 is a NO-GO (2026-10-09) and the V05-08 preparation was blocked
(PR #102), so what follows records why it could only have been the x86_64 simulator and what it would have had to show,
for GF-35 to pick up. Only the x86_64/Rosetta simulator runs a Godot Fabric iOS app today. The iOS 18.3 and 18.4 runtimes advertise both
architectures and the existing evidence uses an iPhone 16e (`docs/evidence/ios-consumer/simulator-x86_64-final.json`).
The official 4.7.2 template's simulator `libgodot.a` holds only x86_64 code, so the arm64 simulator cannot link
(`docs/IOS_BUILD.md:211-227`; upstream issue godotengine/godot#122379), and the x86_64 build needs the XCFramework
repackaged (`docs/IOS_BUILD.md:82-90`). The lane records its result locally: the CI does not run Godot on iOS.

What a simulator lane would have to show that the desktop lanes cannot: `screen_get_scale()` is 3 and equals
`Dimensions.scale`; a 44-point Pressable measures 44 ± 0.5; the real `get_display_safe_area()` converted to points puts
the HUD's bars inside the notch and home-indicator bands, with a screenshot; `screen_get_orientation()` is landscape; and
the exported Info.plist lists landscape only.

## 6. The pointer policy of the world spike

A HUD over a Godot world is the game's shape (docs/research/world-input.md). `FabricSurface` takes no pointer from the
GUI (`native/fabric_surface.cpp:16-21`, `MOUSE_FILTER_IGNORE`), and its `_unhandled_input` claims the pointer
that RN's hit test finds (`:163-173`, `ApplicationRuntime::claims`, `application_runtime.cpp:2923`), which walks the
Controls the host mounted (`hit_test`, `:1794`; the filters, `:1771`). A `SafeAreaView` is mounted as the same `view` control as a
`View` (`component_kind`) and the hit test reads `pointerEvents` from `ViewProps`, which `SafeAreaViewProps` extends,
so it follows the same rule and **the HUD's full-screen root has to be `pointerEvents="box-none"`**, as in the pointer
spike: the empty area, and the padding band the insets add, then belong to the world.

The density lane carries that as a permanent group (`world/...`: 48 checks, 8 cases): a full-screen SafeAreaView root and,
as the control, a View root, each `box-none` and `auto`, at scale 1 and at scale 2 under `density_policy=screen`, over a
minimal world that counts the left presses reaching its `_unhandled_input`. 20 clicks on the empty area and 20 in the
padding band reach the world 20 times and the HUD none under `box-none`; 20 clicks on the centre of the Pressable (from
its `measureInWindow` frame) press it 20 times and reach the world never. Under `auto` the root takes every pointer,
the padding band included (the box of a view includes its padding, in UIKit and so in RN), so the world hears none. The
SafeAreaView and the View leave the same counts at every point, and the SafeAreaView root shifts the bar by exactly the
insets while the View root does not. The counts are invariants of the events, not of the pace, and an independent oracle
recomputes the claimed side from the measured frames.

The control on main before the slice (b0e40aa, whose Surface still takes the pointer: it predates the pointer spike) fails
12 of the group's checks: the empty area and the band of a `box-none` root never reach the world (8), and nothing pads the
SafeAreaView root (4). The rest holds on both hosts.

## A windowed run at scale 2

`npm run bench:mobile-density-graphics` (local only: it needs a real window and the native renderer, which CI has not)
mounts the HUD of the density fixture on a macOS window (`gl_compatibility`, Retina display) under `density_policy` `screen`
with no scale seam: `DisplayServer.screen_get_scale()` is 2, so `Dimensions.scale` is 2, the content scale factor is 2 in
`canvas_items` mode and the 1200x720-pixel window is 600x360 points. The unsafe bands of a landscape iPhone (47, 20, 47.5, 21
points) are stated through `validation_safe_area`. The probe captures the frame as drawn and reads pixels back from it
(`tests/mobile-density-graphics-probe.gd`): the four bands show the root's colour and the bars, the 44-point Pressable and
the side panels show theirs at the frames `measureInWindow` gave, inside the safe rectangle; with the seam removed the same
pixel of the left band is the side panel's. A second capture paints the bands the probe states over the frame, in
translucent red, for the reader; no pixel check runs on it. The bands are the seam's numbers, not an iPhone's.

## Not certified

- No simulator run (the lane was not executed: NO-GO of 2026-10-09), no physical device, no Android, no arm64 simulator.
- The `get_display_safe_area` conversion from pixels runs only where the display server reports a safe area.
- The multi-window case (a Modal) shares the unsafe bands of the owner window and the frame `measureInWindow` gives; it
  has no case of its own in the lane.
- The `toque` (20 touches) and `segundo-plano` criteria of V05-08, and the world-input policy beyond `box-none` roots,
  stay open.
