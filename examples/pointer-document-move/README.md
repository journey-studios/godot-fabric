# Isolated Document and documentElement pointermove

This native validation registers ordinary original RN `pointermove` listeners on
Document and documentElement while the blue target has no pointer listener. Two
roots share one Hermes application; each owns a distinct original Document. The
fixture is outside the interactive launcher catalog and public EventTarget flags
remain disabled.

The [evidence](../../docs/evidence/pointer-document-move/README.md) records eight
headless lanes, four original flag configurations for each of
`interestMode=original` and `current`, totaling **1,932 checks**. The
current/enabled macOS viewport passes **330 checks**, including 24 actual pixels.

## Run

```sh
npm run test:pointers:documents:move
node tests/pointer-document-move-native.test.mjs --interest=current --flag=enabled --capture
```

## Original syntax within this opt-in

```jsx
import {useEffect} from 'react';

function useDocumentMove(ref, onMove) {
  useEffect(() => {
    const document = ref.current?.ownerDocument;
    if (document == null) return undefined;
    document.addEventListener('pointermove', onMove);
    return () => document.removeEventListener('pointermove', onMove);
  }, [ref, onMove]);
}
```

Document listeners need `enableNativeEventTargetEventDispatching`;
documentElement listeners also need `enableImperativeEvents`. With the current
SDK interest query installed, a real drag over the blue target reaches capture
listeners at phase 1 and bubble listeners at phase 3, each sample once, at the
Default priority of RN's unique Continuous moves; the original TouchMove follows.
Button-less mouse motion reaches the same listeners.

## Read the native frames

![Native roots before Document Move](../../docs/evidence/pointer-document-move/initial.png)

![Two samples reach DocC and DocB on A only](../../docs/evidence/pointer-document-move/updated.png)

The yellow bar counts React callbacks: A goes from 0 to 4 (two samples, DocC and
DocB each), B stays at 0. The last yellow and first background pixel of each bar
pin the exact count.

## Limits

Root query faults, once/AbortSignal, refs and retirement, mutation and reentry
for Document Move, hover events, pointer capture, responders, multi-touch,
hardware, Godot mobile exports and performance require separate acceptance. See
the [research](../../docs/research/pointer-move.md).
