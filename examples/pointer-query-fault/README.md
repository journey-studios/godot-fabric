# Isolated pointer-interest query fault recovery

This example reproduces a native batch lost after one pointer-interest query
throws or returns a nonboolean value, then verifies the corrected boundary.
The [JSX fixture](../../tests/pointer-query-fault-fixture.jsx) mounts two real
Godot surfaces sharing Hermes and one real SDK query installation. Original
refs register imperative `pointerdown` listeners; JSX touch callbacks update
React state. Public imperative/native EventTarget flags remain off.

The [execution receipt](../../docs/evidence/pointer-query-faults/README.md)
records **186 checks with exactly 12 failures on the preceding host**, **186/186
on the corrected host headless**, and **204/204 with the macOS renderer**.
The graphical lane adds 16 pixel assertions and two 680×160 image saves.
This is a standalone validation fixture outside the interactive example catalog;
its commands are a development harness, not a required addon front door.

## Run the validation

From the repository root, after the existing native setup:

```sh
npm run test:pointers:query-faults
node tests/pointer-query-fault-native.test.mjs --capture
```

The isolated bundle enables original flags before ref imports and selects the
experimental original dispatcher with current pointerdown interest. Input is
Godot ScreenTouch Down/Up/Cancel through `Input.parse_input_event` and the actual
native queue. The public bundle is preserved. No physical hardware or mobile
input is certified by this driver.

For a deliberately installed preceding native host, the optional control is:

```sh
node tests/pointer-query-fault-native.test.mjs --allow-original-negative
```

That option does not select or restore an old binary. It requires exactly the
12 declared failed checks, preserves their red diagnostics, and rejects any
additional or missing failure. It cannot be combined with graphical capture.
It does not report the old host's 186 checks as all passing.

## Read the native frames

![Two native surfaces before query-fault acceptance](../../docs/evidence/pointer-query-faults/initial.png)

Blue is the real input target on each surface; the yellow bar reflects that
surface's React TouchStart counter. The initial counters are **A: 0 / B: 0**.
Healthy native and untrusted manual controls establish that original listener
registration works before any injected fault.

![Same-batch touch update and unaffected second surface](../../docs/evidence/pointer-query-faults/updated.png)

The updated frame records **A: 3 / B: 1** after two healthy A gestures, the first
faulted A Down and B's healthy gesture while A remains held. A's third update
comes from the same-batch TouchStart that the old host dropped. This frame is
captured before the remaining fault/cleanup matrix, not after final stop.
Both images are native Viewport readbacks with asserted pixels.

## What the matrix proves

| Fault | Original-map phase | Contact completion |
| --- | --- | --- |
| Thrown error | Bubble, offset `34` | Up, then a healthy next gesture. |
| Numeric return | Bubble, offset `34` | Cancel, then a healthy next gesture. |
| Thrown error | Capture, offset `35` | Root retirement, healthy B, remount and healthy A. |
| Numeric return | Capture, offset `35` | Application stop while the final contact is held. |

Test-only bootstrap wraps the one real SDK installation and restores its
installer. It consumes a fault only for the selected real ref and offset;
healthy calls delegate to the actual query over RN's original Maps. No listener
registry or JSX pointerdown helper masks native interest.

The corrected C++ boundary reports `E_POINTER_LISTENER_QUERY` and rejects only
the failed interest lookup. Pointerdown callback and Raw pointerdown remain
absent for that failed lookup. The following same-batch TouchStart retains its
two Raw channels, original trusted callback, payload identity and React commit.
B's independent gesture continues while A's contact is held. Event context and
priority restore, and the appropriate terminal boundary clears the contact.
All four deliberate diagnostics survive retirement, recovery and stop.

Ref-resolution property getters occur outside this new catch and are not
covered by these faults. Document interest, other pointer categories, the full
flag matrix, broader error/reentrancy behavior, mobile, hardware and performance
still need their own acceptance. [This correction's CI](https://github.com/journey-studios/godot-fabric/actions/runs/37229423491)
passed 186 headless checks at `b88708c`; the old control and captures remain local.
The later Document/root extension is not covered by that head. See the
[failure analysis and scope](../../docs/research/pointer-query-faults.md).
