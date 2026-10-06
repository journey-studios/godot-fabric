# Switch

The public `Switch` renders React Native's original `Switch.js` over a native
Godot switch. Because Godot is not Android, Switch.js takes its iOS-family path:
the codegen-generated `RCTSwitch` ViewConfig, the bubbling `onChange` event
`{value, target}` and the `setValue` command. The host registers RN's shared
iOS/macOS Switch descriptor and draws the track and thumb in a Godot Control
that toggles on an actual mouse click or touch tap.

The [evidence](../../docs/evidence/switch/README.md) records **108/108 headless
checks** in two roots of one Hermes application. On the preceding host, the same
bundle fails exactly the **2 normative mount checks**; a retained sabotage of the
native `setValue` command fails 13 checks and the independent oracle rejects it.
The fixture and commands are outside the interactive launcher catalog.

## Run

```sh
npm run test:switch
```

With the preceding native host installed, the runner checks the control:

```sh
node tests/switch-native.test.mjs --allow-original-negative
```

## Original syntax

```jsx
import {useState} from 'react';
import {Switch, View} from 'react-native';

export function SoundSetting() {
  const [enabled, setEnabled] = useState(false);
  return (
    <View style={{padding: 16}}>
      <Switch
        value={enabled}
        onValueChange={setEnabled}
        trackColor={{false: '#767577', true: '#81b0ff'}}
        thumbColor={enabled ? '#f5dd4b' : '#f4f3f4'}
        ios_backgroundColor="#3e3e3e"
      />
    </View>
  );
}
```

`Switch` is controlled, as in RN: a tap toggles the native switch and calls
`onChange` and then `onValueChange`. If `value` does not follow, Switch.js sends
`setValue` and the native switch returns to `value`. `disabled` ignores input.
`trackColor` and `thumbColor` color the track and thumb; `ios_backgroundColor`
paints the view behind them with Switch.js's rounded corners. Without a style
size the switch measures 63×28, RN's frame on iOS 26.

## Limits

Keyboard activation and focus, accessibility, animation and thumb dragging, the
Android-only props and command, hardware and Godot mobile exports require
separate acceptance. After a Switch renders, `topChange` bubbles for every
component, so a `TextInput` change also reaches ancestors' `onChange`, as in RN.
See the [research](../../docs/research/switch.md).
