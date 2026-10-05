# Isolated original View pointermove

This validation lets the original RN View ref's `pointermove` listener qualify
real Godot drags and mouse motion without a JSX pointer helper. It uses two actual roots in one
Hermes application and the original EventTarget listener Maps. Its own fixture
and commands are outside the interactive launcher catalog; public imperative
and native-dispatch flags remain disabled.

The [evidence](../../docs/evidence/pointer-move/README.md) records **135/135
headless**, **159/159 actual Viewport checks** and the preceding host's **45
visible failures in 135 checks** with the same SDK bundle. The graphical lane
adds 20 actual pixels, two React-counter checks and two saves/dimension checks.
Hosted CI for this slice is pending.

## Run

After existing native setup, from the repository root:

```sh
npm run test:pointers:move
node tests/pointer-move-native.test.mjs --capture
```

The bundle enables both original EventTarget flags before importing refs and
selects the experimental dispatcher/current interest configuration. The driver
injects Godot ScreenTouch, ScreenDrag and button-less MouseMotion events through
the real native queue. Capture runs only against the corrected host.

With the preceding native host already installed:

```sh
node tests/pointer-move-native.test.mjs --allow-original-negative
```

The option installs or selects no binary. It accepts only the 45 exact
normative failures, keeps those checks failed in the report and rejects extra
or missing failures. It cannot be combined with capture.

## Original ref syntax within this opt-in

The listener uses ordinary RN ref methods. This code requires the isolated
bootstrap's enabled flags; it does not enable the public default configuration:

```jsx
import {useEffect, useRef, useState} from 'react';
import {View} from 'react-native';

function MoveCounter() {
  const ref = useRef(null);
  const [moves, setMoves] = useState(0);
  useEffect(() => {
    const view = ref.current;
    const onMove = () => setMoves(value => value + 1);
    view.addEventListener('pointermove', onMove);
    return () => view.removeEventListener('pointermove', onMove);
  }, []);
  return <View ref={ref} testID="move-target"
    style={{width: 130 + moves * 4, height: 80, backgroundColor: '#2563eb'}} />;
}
```

The [executed wrapper](../../tests/pointer-move-fixture.jsx) reuses the
[two-root scene](../../tests/pointer-query-fault-fixture.jsx) and gives the Move
counter its own orange bar. Passing `true` to `addEventListener` and its matching
removal selects the capture-phase listener. On the target itself the event phase
is 2; the same listeners on its parent View run at phase 1 (capture) or 3
(bubble).

Each delivered move is trusted, with one typed and one star Raw carrying the
callback's payload/timestamp/pointer ID, and commits one functional increment.
Touch drags arrive as `touch` with `buttons=1`; button-less mouse motion arrives
as `mouse` with `buttons=0`. Moves run at Default priority: the host enqueues them
as unique Continuous events, as RN does, and the pinned priority mapping turns
Continuous into Default. The host flushes RN's queue after every input event, so
samples are merged per frame by Godot's input accumulation, not by RN's queue.

## Read the native frames

![Actual native roots before any move](../../docs/evidence/pointer-move/initial.png)

Blue is each native target. The orange width follows the React Move counter;
yellow follows TouchStart. Initially **A and B both have moves=0**.

![A's orange Move bar grows after two drag samples](../../docs/evidence/pointer-move/updated.png)

After the bubble case, **A has moves=2 and B moves=0**. These are 680×160
Viewport readbacks with ten fixed pixels each, exact React counters and
independently decoded PNG pixels.

## Limits

Document/documentElement `pointermove` (which the shared root path now admits
without certification), other flag configurations, hover events
(over/out/enter/leave), Move lookup faults, pointer capture, captured/no-hit
moves, responders, multi-touch, hardware, Godot mobile exports and performance
require separate acceptance. See the
[research and next boundaries](../../docs/research/pointer-move.md).
