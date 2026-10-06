# Pointer capture notifications

This validation captures actual Godot mouse and touch contacts over two roots
of one Hermes application and observes `gotpointercapture` and
`lostpointercapture` on JSX props and on original listeners added to a View,
the documentElement and the Document, together with hover and click while the
pointer is captured. It runs eight isolated lanes (original/current interest ×
disabled, imperative-only, internal-only and enabled flags). Its fixture and
commands are outside the interactive launcher catalog; public imperative and
native-dispatch flags remain disabled, while the JSX props work with the
default flags.

The [evidence](../../docs/evidence/pointer-capture-notifications/README.md)
records **672 headless checks** and two retained negative controls rejected by
the independent oracle.

## Run

```sh
npm run test:pointers:capture
```

## Capture syntax

```jsx
import {useEffect, useRef, useState} from 'react';
import {View} from 'react-native';

function Handle({onDrag}) {
  const ref = useRef(null);
  const [dragging, setDragging] = useState(false);
  return (
    <View ref={ref}
      onPointerDown={event => ref.current.setPointerCapture(event.nativeEvent.pointerId)}
      onGotPointerCapture={() => setDragging(true)}
      onPointerMove={event => dragging && onDrag(event.nativeEvent.offsetX, event.nativeEvent.offsetY)}
      onLostPointerCapture={() => setDragging(false)}
      style={{width: 48, height: 48, backgroundColor: dragging ? '#1d4ed8' : '#2563eb'}} />
  );
}

// With native EventTarget dispatch enabled, the same notifications also reach
// listeners added to the Document (and, with imperative events, to Views).
function useLostCaptureLog(ref) {
  useEffect(() => {
    const document = ref.current.ownerDocument;
    const log = event => console.log('lost', event.nativeEvent.pointerId);
    document.addEventListener('lostpointercapture', log, true);
    return () => document.removeEventListener('lostpointercapture', log, true);
  }, [ref]);
}
```

`hasPointerCapture` answers at once, but `gotpointercapture` arrives with the
pointer's next event, before that event's hover changes and the event itself.
While captured, moves anywhere — over another view, outside the surface or over
another root — go to the capturing view with offsets local to it, and hover
stays on it. Up and Cancel release the capture after their own dispatch:
`lostpointercapture` follows `pointerup` (and a touch's `pointerout` and
`pointerleave`). The click still comes from the pressed and released views, not
from the capturing one. Capturing another view moves the notifications and the
hover to it at the next event; `releasePointerCapture` sends `lostpointercapture`
at the next event.

With native dispatch, got/lost bubble from the capturing view: Document and
documentElement capture listeners first, the view's own props before its added
listeners, then the ancestors, the documentElement and the Document. RN emits
them without checking listeners, so Document listeners receive them even when
no View in the path listens. Removing the capturing view clears the capture
without `lostpointercapture`.

## Limits

Capture under transforms, pen input, imperative hover listeners while captured,
capture across roots, multiple windows, hardware, Godot mobile exports and
performance require separate acceptance. W3C's implicit touch capture, its
click at the capture target and its `lostpointercapture` at the document after
a removal are not RN behavior and are not adopted. See the
[research](../../docs/research/pointer-capture-notifications.md).
