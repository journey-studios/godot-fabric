# AppState from the Godot application lifecycle

This validation runs React Native's original `AppState` through the public
`react-native` import, fed by the lifecycle notifications Godot delivers to the
`FabricApplication`. Two roots of one Hermes application share one state. Its
fixture and commands are outside the interactive launcher catalog.

The [evidence](../../docs/evidence/app-state/README.md) records **75/75 headless
checks**. The preceding host, with the same SDK bundle, fails exactly **62
normative checks**, and a host whose focus outranks the pause fails 5.

## Run

```sh
npm run test:app-state
```

With the preceding native host installed, the runner checks the control:

```sh
node tests/app-state-native.test.mjs --allow-original-negative
```

## Original syntax

```jsx
import {useEffect, useState} from 'react';
import {AppState, Text} from 'react-native';

function Lifecycle({onMemoryWarning}) {
  const [state, setState] = useState(AppState.currentState);
  useEffect(() => {
    const change = AppState.addEventListener('change', setState);
    const memory = AppState.addEventListener('memoryWarning', onMemoryWarning);
    const blur = AppState.addEventListener('blur', () => console.log('blur'));
    return () => {
      change.remove();
      memory.remove();
      blur.remove();
    };
  }, [onMemoryWarning]);
  return <Text>{state}</Text>;
}
```

| Godot notification | AppState |
| --- | --- |
| `NOTIFICATION_APPLICATION_FOCUS_OUT` | `change` to `inactive` (unless paused), then `blur` |
| `NOTIFICATION_APPLICATION_FOCUS_IN` | `change` to `active` (unless paused), then `focus` |
| `NOTIFICATION_APPLICATION_PAUSED` | `change` to `background` |
| `NOTIFICATION_APPLICATION_RESUMED` | `change` to `active`, or `inactive` while unfocused |
| `NOTIFICATION_OS_MEMORY_WARNING` | `memoryWarning` |

On desktop Godot reports only application focus, so another application's
focus makes the state `inactive`, iOS's state for a foreground application that
receives no events; there is no `background`. A repeated notification sends
nothing. A paused game tree (`SceneTree.paused`) is not the application
lifecycle and keeps delivering events. Stopping the application sends no event,
and `currentState` keeps its last value.

## Limits

Window minimization and occlusion, real OS focus on hardware, Godot Android and
iOS exports, Appearance and `useColorScheme`, and resume with pending timers,
network or animations require separate acceptance. A Godot Android export
reports a transitional `inactive` before `background`, and iOS exports also send
`focus`/`blur`. See the [research](../../docs/research/app-state.md).
