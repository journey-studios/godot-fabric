# Isolated original View hover listeners

This validation lets original RN View refs' `pointerover`, `pointerout`,
`pointerenter` and `pointerleave` listeners qualify real Godot mouse and touch
hover without JSX pointer helpers. It uses two actual roots in one Hermes application.
Its fixture and commands are outside the interactive launcher catalog; public
imperative and native-dispatch flags remain disabled.

The [evidence](../../docs/evidence/pointer-hover/README.md) records **158/158
headless checks** (including a hover-fault application) and the preceding host's
**32 visible failures in 137 checks** with the same SDK bundle.

## Run

```sh
npm run test:pointers:hover
```

With the preceding native host installed:

```sh
node tests/pointer-hover-native.test.mjs --allow-original-negative
```

## Original ref syntax within this opt-in

```jsx
import {useEffect, useRef} from 'react';
import {View} from 'react-native';

function HoverTarget({onHover}) {
  const ref = useRef(null);
  useEffect(() => {
    const view = ref.current;
    const enter = () => onHover(true), leave = () => onHover(false);
    view.addEventListener('pointerenter', enter);
    view.addEventListener('pointerleave', leave);
    return () => {
      view.removeEventListener('pointerenter', enter);
      view.removeEventListener('pointerleave', leave);
    };
  }, [onHover]);
  return <View ref={ref} style={{width: 130, height: 80, backgroundColor: '#2563eb'}} />;
}
```

RN's order holds: `pointerout` then `pointerleave` (target towards root) when the
pointer leaves, `pointerover` then `pointerenter` (root towards target) when it
arrives, all at Discrete priority. `pointerover`/`pointerout` bubble;
`pointerenter`/`pointerleave` do not, so a parent sees them only as their own
target or through a capture listener, which RN also uses to emit them to the
descendants. A touch enters its path in its Down, before TouchStart, and leaves it
right after its Up, before TouchEnd.

## Limits

Document/documentElement hover listeners, the empty surface area (no hit target
here, the root on RN Android), pen hover, pointer capture while hovering,
responders, hardware, Godot mobile exports and performance require separate
acceptance. See the [research](../../docs/research/pointer-hover.md).
