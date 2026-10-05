# Isolated original View pointerup

This validation lets the original RN View ref's `pointerup` listener qualify
real Godot input without a JSX pointer helper. It uses two actual roots in one
Hermes application and the original EventTarget listener Maps. Its own fixture
and commands are outside the interactive launcher catalog; public imperative
and native-dispatch flags remain disabled.

The [evidence](../../docs/evidence/pointer-up/README.md) records **62/62 headless**,
**90/90 actual Viewport checks** and the preceding host's **eight visible failures
in 62 checks**. The graphical lane adds 24 actual pixels, two React-counter
checks and two saves/dimension checks. All 16 proportional regression commands
and fresh SDK pack/verify passed. [Hosted CI](../../docs/evidence/pointer-up/hosted-ci.json)
passed five jobs at `041688c`; artifacts reproduce 62 Up and 3,400 preceding
native checks. Old-host controls and captures remain separate local proof.

## Run

After existing native setup, from the repository root:

```sh
npm run test:pointers:up
node tests/pointer-up-native.test.mjs --capture
```

The bundle enables both original EventTarget flags before importing refs and
selects the experimental dispatcher/current interest configuration. The driver
uses Godot ScreenTouch Down/Up/Cancel through the real native queue. The public
application bundle is preserved; capture runs only against the corrected host.

With the preceding native host already installed:

```sh
node tests/pointer-up-native.test.mjs --allow-original-negative
```

The option installs or selects no binary. It accepts only the eight exact
normative failures, keeps those checks failed in the report and rejects extra
or missing failures. It cannot be combined with capture. The initial negative
history and final same-current-SDK native comparison are distinct receipts.

## Original ref syntax within this opt-in

The listener uses ordinary RN ref methods. This code requires the isolated
bootstrap's enabled flags; it does not enable the public default configuration:

```jsx
import {useEffect, useRef, useState} from 'react';
import {View} from 'react-native';

function UpCounter() {
  const ref = useRef(null);
  const [ups, setUps] = useState(0);
  useEffect(() => {
    const view = ref.current;
    const onUp = () => setUps(value => value + 1);
    view.addEventListener('pointerup', onUp);
    return () => view.removeEventListener('pointerup', onUp);
  }, []);
  return <View ref={ref} testID="up-target"
    style={{width: 130 + ups * 4, height: 80, backgroundColor: '#2563eb'}} />;
}
```

The [executed wrapper](../../tests/pointer-up-fixture.jsx) reuses the
[two-root scene](../../tests/pointer-query-fault-fixture.jsx) and gives the Up
counter its own green bar. Passing `true` to `addEventListener` and its matching
removal selects the capture-phase listener. It does not request pointer-capture
ownership. At this listener's own target the event phase is still 2.

Manual `dispatchEvent` proves installation with one untrusted callback and no
native Raw or state increment. Real input separately proves one trusted Up,
typed/star Raw with the same payload/timestamp/pointer ID, one functional React
increment and one native commit. Bubble qualifies with offset `36=true`;
capture-only observes `36=false` then `37=true`.

## Read the native frames

![Actual native roots before pointerup input](../../docs/evidence/pointer-up/initial.png)

Blue is each native target. Yellow width follows TouchStart state; green follows
the trusted Up state. Initially **A and B both have starts=0, ups=0**.

![Actual native counters after A's Up and B's independent touch gesture](../../docs/evidence/pointer-up/updated.png)

After the first bubble case, **both TouchStart counters are 1** and **Up is
A=1/B=0**. B completed its own touch gesture while A stayed held. B's actual
Up query returned false through its path, so it received original TouchEnd/Raw
without an Up callback or update. A then completed its qualified Up.

These are intermediate 680×160 Viewport readbacks before the capture-only,
Cancel and stop cases. Twelve fixed pixels per image, exact React counters and
independently decoded PNG pixels verify the frames.

## Limits

The probe checks the exact original callback context, Discrete priority under
the enabled flags, restored Default/global event, zero release buttons/pressure,
native TouchEnd/Raw, B surviving while A is held, actual Cancel and balanced
stop. Down has no pointer listener and remains filtered: no public Down/Up
pointer-ID identity is claimed.

Faults in the native query for this View, at the Up offsets, are covered by a
[separate record](../../docs/evidence/pointer-up-faults/README.md): only the failed
lookup is rejected, with one diagnostic, and TouchEnd and contact cleanup survive.
A failure resolving the View's public ref follows the same contract
([resolver record](../../docs/evidence/pointer-up-resolver-faults/README.md)).

Document Up, other flag configurations, full membership/ref lifecycle,
captured/no-hit Up, got/lost capture, coalescing, complete responders and priority
mapping require separate acceptance. Development renderer, hardware, Godot
mobile exports and performance are not certified. See the
[research and next boundaries](../../docs/research/pointer-up.md).
