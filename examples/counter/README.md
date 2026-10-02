# Minimal public React Native counter

[Application](App.jsx) · [Godot scene](scene.tscn) · [Examples index](../README.md)

This is the starting example for application authors. `App.jsx` only imports
React and public `View`, `Text`, `Pressable` and `StyleSheet` from `react-native`.
Press +/− or Reset; decrement is disabled at zero. Pressed styles are functions,
updates use React state and Fabric keeps the existing native Controls.

```sh
npm run setup
npm run example                          # counter is the launcher's default
npm run example -- counter --headless
npm run example -- counter --capture
```

Edit `App.jsx`, close the Godot window and rerun the example to rebuild it.
Open `scene.tscn` in the root Godot editor after setup to inspect its native host.
The scene creates a `FabricSurface` and selects `counter`; the shared
[entry](../entry.jsx) renders `<CounterApp />` into it. Fabric commits create
Godot Controls through the GDExtension. No engine fork is needed.

## Reuse

Copy `CounterApp`, its helper and styles as a component. The diagnostic
`counterStats` export and its observation effects are optional and can be
removed outside this repository's harness. NativeWind is not required for this
component. Bundled `NotoSans` is registered in Godot; on another RN platform,
register that font or replace/remove `fontFamily`.

This repository's runner supplies platform aliases and the native runtime.
It is still a prototype, not a standalone npm package or prebuilt SDK.
Accessibility/keyboard activation, public TextInput, OS services and mobile
Godot builds remain [roadmap gaps](../../ROADMAP.md).

## Proof

[validation.gd](validation.gd) injects logical Viewport pointer events on device
1001, including in headless mode. It verifies initial/native geometry, disabled
input, pressed style, two increments, decrement/reset, preserved native identity
and React mount, then complete unmount, tag/timer/pointer cleanup and errors.
It does not call the React state setter through the diagnostic bridge.

`build/report.json` contains the assertions. Capture adds
`build/counter-initial.png` and `build/counter-updated.png` via the Godot renderer.
Capture also checks real glyph pixels and that the two value readbacks differ.
See [retained example evidence](../../docs/evidence/examples/README.md). These
logical-event checks do not certify physical OS input or complete RN parity.
