# Original Document hover listeners across flag lanes

This validation registers original `pointerover`, `pointerout`, `pointerenter`
and `pointerleave` listeners on a root's Document and documentElement and drives
a button-less mouse and a touch over a leaf with no listener of its own. It runs
eight isolated lanes (original/current interest × disabled, imperative-only,
internal-only and enabled flags) in two actual roots of one Hermes application.
Its fixture and commands are outside the interactive launcher catalog; public
imperative and native-dispatch flags remain disabled.

The [evidence](../../docs/evidence/pointer-document-hover/README.md) records
**1,530 headless checks** and a retained negative control rejected by the
independent oracle.

## Run

```sh
npm run test:pointers:documents:hover
```

## Original Document syntax within this opt-in

```jsx
import {useEffect, useRef} from 'react';
import {View} from 'react-native';

function DocumentHover({onOver, onEnter}) {
  const ref = useRef(null);
  useEffect(() => {
    const document = ref.current.ownerDocument;
    const over = event => onOver(event.target);
    const enter = event => onEnter(event.target);
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerenter', enter, true);
    return () => {
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerenter', enter, true);
    };
  }, [onOver, onEnter]);
  return <View ref={ref} style={{width: 110, height: 70, backgroundColor: '#2563eb'}} />;
}
```

`pointerover` and `pointerout` bubble to the Document at phase 3 (capture
listeners see them at phase 1). `pointerenter` and `pointerleave` never bubble:
only capture listeners see them, once per node that enters or leaves together
with the root, so when the pointer arrives from or returns to outside the
surface. A bubble enter/leave listener on the Document never runs, as in RN.

## Limits

Viewport capture, root query faults at hover offsets, once/AbortSignal, refs,
mutation and reentry during Document hover, pen hover, pointer capture while
hovering, surface selection for empty-area input, responders, hardware, Godot
mobile exports and performance require separate acceptance. See the
[research](../../docs/research/pointer-hover.md#document-listeners).
