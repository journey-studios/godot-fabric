# ActivityIndicator

The public `ActivityIndicator` renders React Native's original
`ActivityIndicator.js` over a native Godot spinner. Because Godot is not
Android, the module takes its iOS-family path: a sized View around the
codegen-generated `RCTActivityIndicatorView` component, whose generated
descriptor the host registers as iOS does. The spinner is drawn in a Godot
Control and advances with real frame time while `animating`.

The [evidence](../../docs/evidence/activity-indicator/README.md) records
**33/33 headless checks** across actual SceneTree frames in two roots of one
Hermes application. On the preceding host, the same bundle fails exactly the
**2 normative mount checks**; a retained sabotage that stops the spinner's
per-frame work fails 9 checks and the independent oracle rejects it. The fixture
and commands are outside the interactive launcher catalog.

## Run

```sh
npm run test:activity-indicator
```

With the preceding native host installed, the runner checks the control:

```sh
node tests/activity-indicator-native.test.mjs --allow-original-negative
```

## Original syntax

```jsx
import {ActivityIndicator, View} from 'react-native';

export function Loading({busy}) {
  return (
    <View style={{flexDirection: 'row', gap: 12, padding: 16}}>
      <ActivityIndicator />
      <ActivityIndicator size="large" color="#0a84ff" />
      <ActivityIndicator size={48} color="#ffcc00" animating={busy} hidesWhenStopped={false} />
    </View>
  );
}
```

`size` sets the frame: small is 20×20, large is 36×36 and a number is a square
of that side; the spinner fills it. `animating={false}` stops the spinner, and
`hidesWhenStopped` (true by default) decides whether a stopped spinner is still
drawn. Without `color` the spinner is RN's iOS gray (`#999999`).

## Limits

Accessibility, reduced motion, UIKit's exact timing and spoke geometry, pixel
captures, hardware and Godot mobile exports require separate acceptance. See the
[research](../../docs/research/activity-indicator.md).
