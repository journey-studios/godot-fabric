# ActivityIndicator: RN's original module over a Godot spinner

Status: executed isolated macOS validation against pinned RN 0.87.1 and official
Godot 4.7.2. The [evidence](../evidence/activity-indicator/README.md) owns the 33
headless checks across actual SceneTree frames, the control on the preceding
host (exactly 2 normative failures) and a retained sabotage that stops the
spinner's per-frame work, which the probe and the independent oracle both reject.
Hosted run 37395264445 repeated the 33 checks and the independent oracle accepts
its report ([receipt](../evidence/activity-indicator/hosted-ci.json)).

## What RN does

`Libraries/Components/ActivityIndicator/ActivityIndicator.js` renders
`ProgressBarAndroid` on Android and, everywhere else, the Codegen component
`ActivityIndicatorView` from
`src/private/components/activityindicator/specs/ActivityIndicatorViewNativeComponent.js`
(`paperComponentName: 'RCTActivityIndicatorView'`): props `hidesWhenStopped` and
`animating` (both default `true`), `color` and `size` (`'small' | 'large'`,
default `'small'`), with no events or commands. With `Platform.OS === "godot"`
the original module takes this non-Android path.

The module wraps the native component in an ordinary `View` (style
`alignItems`/`justifyContent: 'center'` composed with the caller's style, plus
`onLayout`) and passes the remaining props, `ref` and `testID` to the native
component. Its own defaults are `animating = true`, `hidesWhenStopped = true`,
`size = 'small'` and `color = Platform.OS === 'ios' ? '#999999' : null`. `size`
becomes the native frame: `'small'` is 20×20 with `size: 'small'`, `'large'` is
36×36 with `size: 'large'`, and a number is a square of that side with no `size`
prop, so the native default (`small`) applies.

The spec is not `interfaceOnly`, so the package's generated `FBReactNativeSpec`
contains the whole component: `ActivityIndicatorViewProps` (`Props.h`), the
plain `ActivityIndicatorViewShadowNode` (`ShadowNodes.h`, a non-measured view
node whose name `ShadowNodes.cpp` defines) and
`ActivityIndicatorViewComponentDescriptor` (`ComponentDescriptors.h`).
`componentNameByReactViewName.cpp` maps `RCTActivityIndicatorView` to that name.

`React/Fabric/Mounting/ComponentViews/ActivityIndicator/RCTActivityIndicatorViewComponentView.mm`
registers the generated descriptor directly. It creates a `UIActivityIndicatorView`
from the generated default props, so it starts animating with
`hidesWhenStopped`. `updateProps` starts or stops it when `animating` changes and
applies `color`, `hidesWhenStopped` and `size` (UIKit's medium or large style);
UIKit draws the spinner at its style's size inside the frame. Android's
`ProgressBarContainerView.kt` always hides a stopped bar and uses the system
accent color when `color` is null, so iOS is the reference for
`hidesWhenStopped`.

## What this host did

`src/react-native-platform.jsx` exported `ActivityIndicator` as an `unavailable`
placeholder that threw on render. The preceding host had no
`ActivityIndicatorView` descriptor: running the current SDK bundle on it, Fabric's
legacy interop resolves the name and the host mount rejects the node with
`Unsupported GodotControl kind: ActivityIndicatorView`, followed by `map::at`
failures for the missing Controls.

## The implementation

- **Original JS.** The facade renders RN's original ActivityIndicator.js after the
  platform's usual checks (no inline Controls in Text, supported styles only).
  The SDK's existing RN transform runs the Codegen plugin, so the
  `RCTActivityIndicatorView` ViewConfig is the generated one.
- **Original C++ component.** Alongside the generated Props/EventEmitters already
  compiled for the Switch, the host compiles the generated `ShadowNodes.cpp` and
  registers the generated `ActivityIndicatorViewComponentDescriptor`, exactly the
  descriptor iOS registers. ActivityIndicator.js sizes the frame, so nothing is
  measured natively.
- **Native control.** `GodotActivityIndicator` is a custom-drawn Godot `Panel`:
  the Panel paints the host appearance and an eight-spoke spinner is drawn over
  the whole Yoga frame. As in `RCTActivityIndicatorViewComponentView`, `animating`
  starts and stops it. Only an animating spinner takes Godot's internal process
  notification; each frame advances its phase by the frame's real delta at one
  turn per second, and the brightest spoke steps once per eighth of a turn with
  trailing spokes fading, like UIKit's spinner. A stopped spinner keeps its phase:
  with `hidesWhenStopped` it is not drawn, without it it is drawn frozen. `color`
  recolors it; without a color the spinner draws `#999999`, the color RN passes
  on iOS, because ActivityIndicator.js passes `null` outside iOS.

## Defaults and sizes

ActivityIndicator.js decides the defaults; the generated props repeat them
(`animating` and `hidesWhenStopped` true, size small). Only the color differs by
platform in JS: `#999999` on iOS and `null` elsewhere, where Android shows the
system accent. Godot draws RN's iOS gray for `null`. UIKit keeps its medium or
large spinner size inside the frame, so a numeric size on iOS only enlarges the
host; Godot draws to the frame, which matches 20×20 and 36×36 for the named
sizes and scales a numeric size, as Android does.

## Why the probe is discriminating

The [driver](../../tests/activity-indicator-probe.gd) mounts two roots of one
Hermes application and measures every spinner across ten actual SceneTree
frames. The [oracle](../../tests/activity-indicator-oracle.mjs) re-derives each
stage from the raw native snapshots:

- **Defaults and sizes.** Animating, hidesWhenStopped, small style and RN's iOS
  gray without a color; 20×20, 36×36 with the large style and 48×48 with the small
  style for a number; every ref resolves to its native spinner's tag.
- **Phase.** While animating, the phase and the internal-process count advance
  exactly once per frame and the last draw uses the newer phase. Stopped, both
  stay frozen and no per-frame work runs, while other spinners keep animating;
  without hidesWhenStopped the frozen spinner is drawn; restarting resumes from
  the frozen phase.
- **Color, remount, two roots.** A new color and its removal; a remounted spinner
  is a new instance with its own phase; B's spinners keep their own state and
  instances while A changes.

The preceding host fails exactly the two normative mount checks. A retained
sabotage that never gives the spinner per-frame work fails 9 probe checks, and
the oracle rejects its report at the first phase check.

## Remaining scope

Accessibility, reduced motion, UIKit's exact timing and spoke geometry, pixel
captures, hardware and mobile exports remain open.
