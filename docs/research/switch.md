# Switch: RN's original Switch.js over a native Godot switch

Status: executed isolated macOS validation against pinned RN 0.87.1 and official
Godot 4.7.2. The [evidence](../evidence/switch/README.md) owns the 108 headless
checks with actual Godot mouse and touch input, the control on the preceding
host (exactly 2 normative failures) and a retained sabotage of the `setValue`
command that the probe and the independent oracle both reject.
Hosted run 37390584578 repeated the 108 checks and the independent oracle
accepts its report ([receipt](../evidence/switch/hosted-ci.json)).

## What RN does

`Libraries/Components/Switch/Switch.js` chooses its native component by
platform. On Android it renders `AndroidSwitchNativeComponent` (`AndroidSwitch`,
`enabled`/`on`/`trackTintColor`, command `setNativeValue`). Everywhere else it
renders `SwitchNativeComponent` from
`src/private/components/switch/specs/SwitchNativeComponent.js`: the Codegen spec
`Switch` with `paperComponentName: 'RCTSwitch'`, the props `disabled`, `value`,
`tintColor`, `onTintColor`, `thumbTintColor` (plus the deprecated `thumbColor`,
`trackColorForFalse` and `trackColorForTrue`), the bubbling `onChange` event
`{value, target}` and the `setValue(value)` command. With `Platform.OS ===
"godot"` the original module takes this non-Android path. It sends
`trackColor.false/true` as `tintColor`/`onTintColor`, `thumbColor` as
`thumbTintColor`, composes `alignSelf: 'flex-start'` with the style, and maps
`ios_backgroundColor` to `backgroundColor` with `borderRadius: 16`. It also
claims the JS responder on touch start and refuses termination.

Switch.js is controlled. `handleChange` calls `onChange`, then `onValueChange`,
then records the native value; a layout effect compares it with `value === true`
and, when JS kept the old value, restores the native switch with
`SwitchCommands.setValue` (only when the ref has `setNativeProps`, which RN's
`ReactNativeElement` does).

`@react-native/babel-plugin-codegen` (part of `@react-native/babel-preset`)
compiles that spec into a static ViewConfig: `uiViewClassName: "RCTSwitch"`,
the eight props with `processColor` for colors, and `topChange` as a bubbling
event. In bridgeless mode `NativeComponentRegistry.get` merges it with the
platform base ViewConfig. Fabric's `componentNameByReactViewName.cpp` drops the
`RCT` prefix, so C++ creates a `Switch` node.

On iOS and macOS the C++ side is RN's shared
`ReactCommon/react/renderer/components/switch/iosswitch` component:
`AppleSwitchComponentDescriptor.h` and `AppleSwitchShadowNode.h`, a leaf,
measurable node over the generated `SwitchProps` and `SwitchEventEmitter`
(`React/FBReactNativeSpec/.../Props.h`, `EventEmitters.h`). The platform file
supplies the name and the measurement: `IOSSwitchShadowNode.mm` returns
`RCTSwitchSize()` (`[UISwitch new].intrinsicContentSize`, `React/Base/RCTUtils.mm`)
plus two points of width; `MacOSSwitchShadowNode.mm` returns `NSSwitch`'s size.

`React/Fabric/Mounting/ComponentViews/Switch/RCTSwitchComponentView.mm` mounts a
`UISwitch` as the content view of an ordinary view, so the host paints the View
appearance (`ios_backgroundColor`). Its `updateProps` applies `value` only
initially or when the prop changes, `disabled` as `enabled`, and the three tint
colors; the deprecated generated colors are parsed but unused. Its `onChange:`
emits nothing when `props.value == sender.on`, and `setValue:` moves the switch
without an event. The generated `RCTSwitchHandleCommand` accepts exactly one
boolean. `UIManagerBinding::dispatchEventToJS` mixes the target tag and a
`timeStamp` into every payload, so JS sees `{value, target, timeStamp}`.

Android differs in mechanism, not in the JS contract: `ReactSwitch.kt` blocks
further native changes until JS sets a value (`allowChange`), and
`ReactSwitchEvent.kt` sends the view tag as `target`.

## What this host did

`src/react-native-platform.jsx` exported `Switch` as an `unavailable` placeholder
that threw on render. The preceding host had no Switch descriptor: running the
current SDK bundle on it, Fabric's legacy interop resolves `Switch`
(`ComponentDescriptorRegistry::at`), and the host mount rejects the node with
`Unsupported GodotControl kind: Switch`, followed by `map::at` failures for the
missing Controls.

## The implementation

- **Original JS.** The facade renders RN's original Switch.js after the
  platform's usual checks (no inline Controls in Text, supported styles only).
  The SDK's existing RN transform runs the Codegen plugin, so the RCTSwitch
  ViewConfig, its `onChange` event and the `setValue` command are the generated
  ones.
- **Original C++ component.** The host compiles the package's generated
  `FBReactNativeSpec` Props/EventEmitters and registers RN's
  `SwitchComponentDescriptor` from `iosswitch`. `native/switch_view.cpp` is the
  Godot platform file beside `IOSSwitchShadowNode.mm`: it defines the component
  name and the measurement. The native SDK record now lists those generated
  sources.
- **Native control.** `GodotSwitch` is a custom-drawn Godot `Panel`: the Panel
  paints the host appearance, then a pill track and a circular thumb are drawn
  over the whole Yoga frame. A left-button click or a touch tap that starts and
  ends inside it toggles the native value and emits `toggled`; Godot's emulated
  mouse for a touch (and the reverse) is ignored, and Godot's synthetic release
  when it drops mouse focus cancels the press. The runtime turns `toggled` into
  `SwitchEventEmitter::onChange` only when the native value differs from the
  committed `value` prop, as `RCTSwitchComponentView` does. `value` applies only
  initially or when it changes; `setValue` changes the native value without an
  event; malformed `setValue` arguments are rejected with a diagnostic.
- **Colors.** `tintColor`, `onTintColor` and `thumbTintColor` color the off
  track, the on track and the thumb; without them the track is light gray
  (`#E9E9EA`) off and green (`#34C759`) on, with a white thumb. A disabled
  switch is drawn at half opacity.

## Default size

RN's Switch has no fixed size: it is whatever the platform control measures.
Running RN's own call (`[UISwitch new].intrinsicContentSize`, plus RN's two
points) on the local simulators gives **51×31** on iOS 18.4 (UISwitch 49×31) and
**63×28** on iOS 26.3.1 (UISwitch 61×28, Xcode 26.2 SDK). The repo's iOS
reference lane (`scripts/parity-reference.mjs`) uses the newest available iOS
runtime, so Godot reports **63×28** for a Switch without an explicit size; an
explicit style size wins, and the Godot track fills that frame (UIKit keeps
UISwitch at its own size inside a larger host view). Switch.js's `alignSelf:
'flex-start'` keeps the measured width in a stretching column. With the 28-point
height, RN's border resolution clamps `ios_backgroundColor`'s radius 16 to 14.

## Events and the shared registry

RN's ViewConfig registry is global per top-level event. The generated Switch
config registers `topChange` as bubbling (as RN's own iOS and Android TextInput
configs do), while the GodotControl config registers it as direct; the renderer
prefers the bubbling entry once both exist. So after a Switch renders, a Godot
`TextInput` change also bubbles: its own `onChange` still runs exactly once, and
ancestors' `onChangeCapture`/`onChange` observe it, as in RN. The probe records
this with an actual key press.

## Why the probe is discriminating

The [driver](../../tests/switch-probe.gd) mounts two roots of one Hermes
application and drives actual Godot input (`Input.parse_input_event`, without a
validation device filter, so Godot's emulated mouse for a touch reaches the
GUI). The [oracle](../../tests/switch-oracle.mjs) re-derives every stage from the
raw JS log and native snapshots:

- **Controlled.** A mouse click and a touch tap each produce TouchStart,
  TouchEnd and one Change targeting the Switch; capture, `onChange`,
  `onValueChange` and bubble run once in that order; the payload keys are
  `target`, `timeStamp` and `value`. During the press the Switch is RN's JS
  responder and native input is not blocked. No `setValue` is needed.
- **Value prop that does not change.** The native switch toggles from the input,
  then exactly one `setValue` from Switch.js restores it; the same for a Switch
  without `value`.
- **Disabled.** RN still sees the touch, but nothing toggles and no Change or
  handler runs.
- **Colors and size.** The native colors, the drawn track/thumb, the host
  background, color updates and their removal, the 63×28 default frame, the
  explicit 80×40 frame and the measured width in a stretching column.
- **Commands, removal, two roots.** Generated `setValue` both ways and two
  malformed calls; removing a pressed Switch releases the responder, its release
  toggles nothing and a stale ref's `setValue` is ignored; B's Switch keeps its
  own state and tag.

The preceding host fails exactly the two normative mount checks. A retained
sabotage (native `setValue` made a no-op) fails 13 probe checks, and the oracle
rejects its report at the first fixed-value tap.

## Remaining scope

Keyboard activation and focus, accessibility (`accessibilityRole="switch"`),
animation and thumb dragging, platform-matched default colors and sizes per
Godot target, the Android path, hardware and mobile exports remain open.
