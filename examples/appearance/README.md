# Appearance and useColorScheme from Godot's system theme

This validation runs React Native's original `Appearance` and `useColorScheme`
through the public `react-native` import, fed by Godot's DisplayServer system
theme and the application's `setColorScheme` override. Two roots of one Hermes
application render the same scheme, and two applications that run at once share
one system theme callback. Its fixture and commands are outside the interactive
launcher catalog.

The [evidence](../../docs/evidence/appearance/README.md) records **79/79 headless
checks**. The preceding host, with the same SDK bundle, fails exactly **56
normative checks**; the host from before the shared callback fails exactly the 9
checks where two applications observe at once, and a host that emitted for every
system callback failed 17 of the first execution's 67.

## Run

```sh
npm run test:appearance
```

With the preceding native host installed, the runner checks the control; with
the host from before the shared callback, the second command:

```sh
node tests/appearance-native.test.mjs --allow-original-negative
node tests/appearance-native.test.mjs --allow-prefix-negative
```

## Original syntax

```jsx
import {useEffect} from 'react';
import {Appearance, Pressable, Text, useColorScheme} from 'react-native';

function ThemeToggle({onSchemeChange}) {
  const scheme = useColorScheme();
  useEffect(() => {
    const subscription = Appearance.addChangeListener(({colorScheme}) => onSchemeChange(colorScheme));
    return () => subscription.remove();
  }, [onSchemeChange]);
  return (
    <Pressable onPress={() => Appearance.setColorScheme(scheme === 'dark' ? 'light' : 'dark')}>
      <Text>{scheme}</Text>
    </Pressable>
  );
}
// Follow the system again:
Appearance.setColorScheme('unspecified');
```

| Source | Effective scheme |
| --- | --- |
| `setColorScheme('light')` or `('dark')` | That scheme, whatever the system reports |
| `setColorScheme('unspecified')` or `('auto')` | The system's again |
| Godot's system theme callback, one for every application | `dark` when `DisplayServer.is_dark_mode()`, otherwise `light` |
| No system dark mode (headless) | `light` |

A change event is sent only when the effective scheme changes, so a repeated or
overridden system change re-renders nothing. Unknown overrides fail with
`E_ARGUMENT`. Stopping the application sends no event, and a stopped or freed
application no longer receives system theme changes while the others still do.

## Limits

The headless DisplayServer has no system theme: the evidence supplies the system
value through a validation meta and calls the one Callable registered with
DisplayServer. Real OS theme changes, a game that sets its own DisplayServer
theme callback (it replaces Fabric's for every application, or is replaced by
it: the last registration wins), accent colors, `PlatformColor`,
per-window themes and Godot mobile exports require separate acceptance. See the
[research](../../docs/research/appearance.md).
