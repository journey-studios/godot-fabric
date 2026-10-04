# Isolated pointer-interest ref getter recovery

This example reproduces a lost native event batch when resolving a real View's
`canonical.publicInstance` executes a throwing getter before the SDK query.
The corrected boundary preserves the following TouchStart, Raw delivery and
React update. The [JSX fixture](../../tests/pointer-resolver-fault-fixture.jsx)
reuses the two-surface query-fault scene, original refs and one real SDK query
observer. Public imperative/native EventTarget flags remain off.

The [execution receipt](../../docs/evidence/pointer-resolver-faults/README.md)
records **62/65 on the preceding native host, with three normative failures**,
**65/65 corrected headless**, and **85/85 corrected macOS viewport**. The
graphical lane adds 16 pixel assertions, two React-counter assertions and two
680×160 image saves. This standalone development validation is outside the
interactive launcher catalog; npm is not a required addon front door.

## Run the validation

From the repository root after existing native setup:

```sh
npm run test:pointers:resolver-faults
node tests/pointer-resolver-fault-native.test.mjs --capture
```

The isolated bundle enables both original flags before importing refs and uses
the experimental original dispatcher with current `pointerdown` interest.
Godot ScreenTouch Down/Up/Cancel enters through `Input.parse_input_event` and
the actual native queue. It preserves the public bundle and does not certify
physical hardware or exported mobile input.

For an already installed preceding native host:

```sh
node tests/pointer-resolver-fault-native.test.mjs --allow-original-negative
```

This option selects or replaces no binary. It requires exactly the three
declared TouchStart/Raw/React failures, retains their failed checks and rejects
additional or missing failures. It cannot be combined with capture.

## Read the actual native frames

![Two native surfaces before the ref-getter case](../../docs/evidence/pointer-resolver-faults/initial.png)

Blue is each surface's real input target. Yellow width follows its functional
React TouchStart counter. The initial counters are **A: 0 / B: 0**.

![A's React TouchStart state survives the throwing ref getter](../../docs/evidence/pointer-resolver-faults/updated.png)

The updated frame is **A: 2 / B: 0**: one healthy A gesture, then the faulted
Down's preserved TouchStart. That second update commits once in the same batch.
The frame precedes B's later healthy gesture and A's Cancel; it is not a final
cleanup screenshot. Both frames are Godot Viewport readbacks with asserted
pixels and matching React counters.

## What is isolated

The [test bootstrap](../../tests/pointer-resolver-fault-bootstrap.js) obtains
the actual connected opaque Fiber and its canonical object. It replaces only
the own configurable `publicInstance` data property with a one-shot getter.
The getter restores the exact original descriptor **before throwing**. This
lets the next queue event, React work and terminal input read the original ref.
Value, writability, enumerability and configurability are checked afterward.

The failed offset-34 read never calls the SDK query: its entry count at the
throw is zero. On the corrected host, seven later healthy capture/ancestor/root
queries reach the original listener Maps and return false. Pointerdown callback
and Raw pointerdown stay absent for this faulted sample. The original trusted
TouchStart and typed/star Raw payload identity survive, with one React commit.
No JSX pointerdown helper, mirrored registry or second query installation masks
the failed lookup.

Exactly one diagnostic remains visible. The previous host reports
`Non-js exception`; the corrected host reports `E_POINTER_LISTENER_QUERY` with
the same cause. The contact stays legitimately held until Cancel. B completes
a healthy gesture while A is held, then A is cancelled and its next gesture
works. Stop removes the query, empties recorded contact/queue state and balances
native nodes for both roots while retaining the diagnostic.

The code catches all three `stateNode`, `canonical` and `publicInstance` slot
reads, but only this one-shot `publicInstance` fault was executed. Separate
stateNode/canonical faults, permanent or proxy accessors, broader root lookup
and flag combinations, reentrant stop/retirement and other pointer categories
remain open. Hardware, Godot mobile exports, full priority mapping, performance
and ABI certification need independent acceptance. CI for this fixture is
pending; the preceding Document/root CI does not cover it. See the
[analysis and remaining boundaries](../../docs/research/pointer-resolver-faults.md).
