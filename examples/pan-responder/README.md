# Original PanResponder gestures

This validation drives RN's original `PanResponder` with actual Godot touches
and mouse buttons over two roots of one Hermes application: a free pan view, a
parent that claims vertical moves from a `Pressable` and from a pan view that
refuses to yield, a parent that captures every start, and a view removed
mid-gesture. It runs in four flag lanes (disabled, imperative-only,
internal-only and enabled), covering both of RN's responder implementations. Its
fixture and command are outside the interactive launcher catalog;
`PanResponder` itself works with the default flags.

The [evidence](../../docs/evidence/pan-responder/README.md) records **128
headless checks**, the preceding-SDK control and a retained sabotage rejected by
the independent oracle.

## Run

```sh
npm run test:responders:pan
```

## Syntax

```jsx
import {useRef} from 'react';
import {PanResponder, View} from 'react-native';

function Draggable({onMove, onDrop}) {
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderMove: (_event, {dx, dy}) => onMove(dx, dy),
    onPanResponderRelease: (_event, {dx, dy, vx, vy}) => onDrop(dx, dy, vx, vy),
  })).current;
  return <View {...responder.panHandlers} style={{width: 80, height: 80, backgroundColor: '#2563eb'}} />;
}
```

`dx/dy` accumulate the centroid movement of the touches that moved since the
last event, `x0/y0` is the centroid at grant, and `numberActiveTouches` counts the
fingers on the surface. A parent claims a gesture with
`onMoveShouldSetPanResponderCapture`, and a child keeps it by returning `false`
from `onPanResponderTerminationRequest`.

## Limits

Pinch zoom through chart libraries, `InteractionManager` handles, velocity on
real hardware, nested scroll views and negotiation with native Godot controls
require separate acceptance. See the [research](../../docs/research/pan-responder.md).
