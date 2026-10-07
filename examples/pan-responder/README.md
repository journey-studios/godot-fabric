# Original PanResponder gestures

```sh
npm run example -- pan-responder
npm run example -- pan-responder --headless
npm run example -- pan-responder --capture
npm run test:responders:pan
```

RN's original `PanResponder` comes from the public `react-native` import and
runs on actual Godot touches and mouse buttons. The launcher entry is the
interactive demo: a box that follows a mouse drag inside a track, turns amber
while it is held and stays where it is dropped, with a readout of the gesture
state React observed. `npm run test:responders:pan` is the
[evidence](../../docs/evidence/pan-responder/README.md) matrix, outside the
catalog: it drives `PanResponder` over two roots of one Hermes application, with
a free pan view, a parent that claims vertical moves from a `Pressable` and from
a pan view that refuses to yield, a parent that captures every start, and a view
removed mid-gesture. It runs in four flag lanes (disabled, imperative-only,
internal-only and enabled), covering both of RN's responder implementations, and
records **128 headless checks**, the preceding-SDK control and a retained
sabotage rejected by the independent oracle. `PanResponder` itself works with the
default flags.

## Use the example

![The box at its first position, the readout saying idle with no gesture yet](../../docs/evidence/pan-responder/pan-responder-before.png)

**Before** is the screen as mounted. The box rests at its first position (x 24,
y 24) in teal, React holds no gesture and the readout says `idle` and
`no gesture yet`.

![The box amber part way through a drag, the readout showing dx 80 and dy 30](../../docs/evidence/pan-responder/pan-responder-dragging.png)

**Dragging** is the frame after the second of four drag steps, with the left
button held down. The box is amber and follows the pointer by the gesture's `dx`
and `dy` (80 and 30, one active touch): it is at x 104, y 54.

![The box teal again where it was dropped, the readout saying released with dx 160 and dy 60](../../docs/evidence/pan-responder/pan-responder-after.png)

**After** is the frame after the release. The box stays where it was dropped (x
184, y 84) and is teal again, and the readout says `released` with the final
`dx 160 · dy 60 · touches 0`. A second drag from there counts from its own grant.

## What the validation establishes

[validation.gd](validation.gd) sends actual Godot mouse input: it presses the box,
drags it in four steps and releases it, and reads the box's Control from the native
tree and the gesture state from what React observed. Before any touch the box
rests at its first position, React holds no gesture and the readout says idle.
Pressing the box grants the PanResponder (`grant`, then `start`) and the box has
not moved. After each of the four drag steps the box Control sits at its start
plus the gesture's `dx` and `dy`, with one active touch, and the gesture state is
RN's: `dx` and `dy` are `moveX` and `moveY` minus the grant point, and the
velocity follows the drag. Release reports `end` and then `release` after four
moves, the box stays where it was dropped and the native contact and the
responder are cleared. A second drag starts from the dropped box: its gesture
counts from its own grant, in the root's coordinates, and brings the box home;
the second release is reported, no contact is left and the run raised no host
error. With `--capture` the pixels of the two places the box visits are hashed:
both differ between before and after, so the renderer drew the box where it was
dropped and no longer where it started. The headless run passes 11 checks and the
capture run 18.

## Evidence suite

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
from `onPanResponderTerminationRequest`. RN reuses one gesture state object and
resets it when the gesture ends, so a handler that stores it must copy the fields
it needs first, as the example does.

## Limits

Pinch zoom through chart libraries, `InteractionManager` handles, velocity on
real hardware, nested scroll views and negotiation with native Godot controls
require separate acceptance. See the [research](../../docs/research/pan-responder.md).
