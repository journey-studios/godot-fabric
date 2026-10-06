# Touches shared by every root

This validation presses the original `Pressable` of two roots of one Hermes
application with actual Godot touches and the mouse at the same time. RN keeps
one JS responder per runtime, so each TouchEvent lists the active touches of the
whole application: a touch in one root can neither take the gesture another
root holds nor end it while that root's own touch is down, though canceling it
terminates the one responder, as on one RN surface. It runs in four flag lanes
(disabled, imperative-only, internal-only and enabled), covering both of RN's
responder implementations. Its
fixture and command are outside the interactive launcher catalog; the behavior
needs no flag.

The [evidence](../../docs/evidence/shared-touches/README.md) records **92
headless checks** and the preceding host, which fails exactly the 9 normative
checks.

## Run

```sh
npm run test:responders:shared-touches
```

## What an application sees

```jsx
import {AppRegistry, Pressable} from 'react-native';

// Two roots of the same application, each with its own button.
function Panel({name, onPress}) {
  return <Pressable onPress={() => onPress(name)} style={{width: 120, height: 80, backgroundColor: '#f97316'}} />;
}
AppRegistry.registerComponent('Panel', () => Panel);
```

Holding the button of root A while tapping the one of root B behaves like two
buttons on one RN surface: the one responder stays with A, B does not press,
and A presses once when its own finger lifts. `nativeEvent.touches` in either
root lists both fingers, while `changedTouches` and `targetTouches` keep the
root's own touch. If A's finger lifts first, the default flags press A right
away; with the experimental native-dispatch flags RN's `ReactNativeResponder`
waits for the last finger, as on one RN surface.

## Limits

RN's iOS and Android surfaces each keep their own touch list, so this is a
deliberate departure from their multi-surface behavior; see the
[research](../../docs/research/shared-touches.md). Pointer capture across roots,
several touch devices and real hardware require separate acceptance.
