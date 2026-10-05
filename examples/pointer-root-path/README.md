# Root hover path for empty surface points

This validation makes an empty point inside a Godot surface resolve to the root
view, as RN does, so the root stays in the hover path while the pointer moves
between views and the empty area. The root is never an event target: RN's root
family has no event dispatcher, and dispatching to it used to crash the preceding
host. It uses two actual roots in one Hermes application. Its fixture and
commands are outside the interactive launcher catalog; public imperative and
native-dispatch flags remain disabled.

The [evidence](../../docs/evidence/pointer-root-path/README.md) records **82/82
headless checks**. The preceding host, with the same SDK bundle, fails exactly
**9 normative checks in 45** of its View case and crashes in the first step of its
Document case.

## Run

```sh
npm run test:pointers:root-path
```

With the preceding native host installed, the runner checks both parts of the
control:

```sh
node tests/pointer-root-path-native.test.mjs --allow-original-negative
```

## Original Document syntax within this opt-in

```jsx
import {useEffect, useRef} from 'react';
import {View} from 'react-native';

function TrackedSurface({onEnter, onLeave}) {
  const ref = useRef(null);
  useEffect(() => {
    const document = ref.current.ownerDocument;
    const enter = event => onEnter(event.target);
    const leave = event => onLeave(event.target);
    document.addEventListener('pointerenter', enter, true);
    document.addEventListener('pointerleave', leave, true);
    return () => {
      document.removeEventListener('pointerenter', enter, true);
      document.removeEventListener('pointerleave', leave, true);
    };
  }, [onEnter, onLeave]);
  return <View ref={ref} style={{width: 130, height: 80, backgroundColor: '#2563eb'}} />;
}
```

`pointerenter` and `pointerleave` do not bubble, but a Document capture listener
sees them at phase 1. It receives one per node that enters or leaves together
with the root: when the pointer comes from outside the surface and when it leaves
the surface. Moving between a view and the surface's empty area keeps the root in
the path, so it receives nothing there, as in RN.

## Limits

Document hover across the flag matrix and documentElement listeners, surface
selection for empty-area input (a first empty-area sample still reaches the
game, not the surface), pen hover, pointer capture while hovering, responders,
hardware, Godot mobile exports and performance require separate acceptance. See
the [research](../../docs/research/pointer-root-path.md).
