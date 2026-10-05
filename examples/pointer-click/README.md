# Click on release and scroll takeover

This validation presses and releases actual Godot mouse buttons and touches
over two roots of one Hermes application: a group with two leaves, a sibling, a
top-level view, an SDK `Pressable` and an SDK `ScrollView`. It runs eight
isolated lanes (original/current interest × disabled, imperative-only,
internal-only and enabled flags). Its fixture and commands are outside the
interactive launcher catalog; public imperative and native-dispatch flags remain
disabled, while JSX `onClick` works with the default flags.

The [evidence](../../docs/evidence/pointer-click/README.md) records **728
headless checks**, the preceding-host control and two retained negative
controls rejected by the independent oracle.

## Run

```sh
npm run test:pointers:click
```

## Click syntax

```jsx
import {View} from 'react-native';

function Card({onOpen, children}) {
  // A primary press and release on the card or anything inside it.
  return (
    <View onClick={event => onOpen(event.nativeEvent.pointerType)}
      style={{padding: 12, backgroundColor: '#1e293b'}}>
      {children}
    </View>
  );
}
```

The click goes to the deepest view that both the press and the release hit,
and bubbles from there; `onClickCapture` runs on the way down. Only the primary
pointer's main button clicks: right and middle buttons, a second finger and a
chord released on another button never do. A contact that is canceled, whose
view is removed, or that a `ScrollView` drag takes over never clicks: the scroll
view's contact receives one `pointercancel` and then only touches.

`Pressable` keeps pressing through its responder. Its own `onClick` comes from
Pressability, which ignores pointer clicks, so a tap presses once and a
`Pressable` ignores a caller's `onClick`, as in RN.

## Limits

Clicks while a pointer is captured, `auxclick`, `contextmenu`, `dblclick`,
keyboard and accessibility activation, pen input, nested and horizontal scroll
takeover, surface selection for empty-area input, hardware, Godot mobile exports
and performance require separate acceptance. See the
[research](../../docs/research/pointer-click.md).
