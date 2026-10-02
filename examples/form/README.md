# Public native form in TypeScript

[Application](App.tsx) · [Godot scene](scene.tscn) · [Examples index](../README.md)

This form uses public `Button`, `TextInput`, `View`, `Text` and `StyleSheet`
imports from `react-native`. Edit the controlled name and save it; lock editing,
change styles or clear the value with native buttons. The note field is
uncontrolled and receives initial focus. The same React/Fabric tree commits to
Godot `Button` and single-line `LineEdit` Controls.

```sh
npm run setup
npm run example -- form
npm run type-check
npm run example -- form --headless
npm run example -- form --capture
```

Edit `App.tsx`, close the window and relaunch. The launcher rebuilds TSX; the
strict [consumer configuration](../../tsconfig.godot.json) resolves the bounded
Godot declarations rather than promising the entire mobile RN API.

## Supported contract

Button accepts `title`, optional `onPress`, `disabled`, static string `color`,
`testID` and a native ref. On Godot, `color` sets the background and title casing
is preserved. Native keyboard/pointer activation calls `onPress` without a
mobile gesture payload (the upstream Button event argument is optional).

TextInput supports controlled `value` or initial `defaultValue`, `placeholder`,
`editable`, initial `autoFocus`, UTF-16 `selection`, single-line submission,
editing/focus/key/selection callbacks, native measurement and ref commands
`focus`, `blur`, `isFocused`, `clear`, `setSelection`, `getNativeRef`. The
implemented style subset includes layout, appearance, `fontSize` and static
string `color`. `submitBehavior` is `submit` or `blurAndSubmit`.

Unsupported props, multiline, unsupported input typography and invalid
selection values fail visibly. Accessibility, system IME, virtual keyboards,
password/autofill, undo parity, mobile input policy and complete RN styling
remain open. NativeWind TextInput interop has not been certified by this form.
See [API limits](../../docs/API.md) and the [roadmap](../../ROADMAP.md).

## Validation

[validation.gd](validation.gd) drives real native keyboard editing and button
activation through logical Viewport events. It checks native values, styles and
geometry, automatic focus, asynchronous measurement, event delivery, controlled
rerenders, stable ref/native identity, disabled editing/activation, acknowledged
uncontrolled clear and complete cleanup. Harness-only probes intentionally pass
invalid props through React error boundaries. These probes are not application
API examples to copy.

The capture lane checks actual input glyph pixels and writes
`build/form-initial.png` and `build/form-changed.png`. Reports and screenshots
are retained in the [public controls evidence](../../docs/evidence/public-controls/README.md).
These checks do not certify physical hardware input or original-native mobile
parity for this form; the existing nine-case differential oracle covers other
core UI contracts.
