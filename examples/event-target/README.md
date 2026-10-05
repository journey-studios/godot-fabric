# Isolated native EventTarget dispatch

This validation example connects the original RN EventTarget dispatcher to
Godot's native event queue through an experimental renderer selection. The JSX
is in [the integrated fixture](../../tests/event-dispatch-integrated-fixture.jsx);
the [Godot driver](../../tests/event-dispatch-integrated-probe.gd) mounts two real
surfaces in one Hermes runtime and injects ScreenTouch/ScreenDrag gestures.
It compares the unchanged legacy renderer selection with the isolated integrated
selection using the same refs, JSX and native host.

Public imperative/native EventTarget flags remain off. Only this probe enables
the original flags before importing refs and opts into
`platformPlugin(..., {nativeDispatchMode: "experimental"})`. The generated branch
calls the original dispatcher inside the renderer's existing React batch, after
one emission on each RawEventEmitter channel, and returns before legacy plugins.
The default toolchain keeps its existing numeric-tag correction and does not
select this dispatcher.

## Run the validation

From the repository root, after the existing native setup:

```sh
npm run test:events:integrated
node tests/event-dispatch-integrated-native.test.mjs --capture
```

The second command opens the integrated variant in Godot and records the two
frames below; its original control remains headless. These are repository
validation commands, not an npm/CLI requirement for using the addon. This folder
documents a test fixture rather than a standalone launcher scene.

## Read the scene

![Initial native EventTarget validation with two roots](../../docs/evidence/event-dispatch-integrated/initial.png)

| Color | Case | What the probe distinguishes |
| --- | --- | --- |
| Blue | Imperative touch listener only | No JSX touch handler on its path. Manual original dispatch is positive; native delivery is absent in the original renderer control and present in the integrated selection. |
| Purple | JSX plus imperative listeners | Real callbacks on target, parent and a flattened logical ancestor. The original batch preserves payload identity, capture/bubble order and JSX-before-imperative delivery without duplicate plugin dispatch. |
| Orange | Imperative pointer listener only | Explicit negative: native pointer delivery remains zero without declarative native interest. A separate manual pointer positive proves the listener exists. No empty JSX helper masks the gap. |
| Green and teal | Two contacts inside one responder | Ending the first contact must retain the actual native owner; the last end releases it. The probe also checks movement and cancellation. |
| Pink | Target removed by React | A real commit removes a touched target. Cancellation, retained-ref disconnection and a late up are checked; the retained ref's later manual event stays self-only. |
| White bar and counter | React state in the native batch | One JSX callback and one imperative callback each schedule a functional update in the same touch-start gesture. The first integrated gesture advances root A from 0 to 2 in one commit after the callbacks, and native geometry follows. |

![Root A after the first mixed gesture commits both React updates](../../docs/evidence/event-dispatch-integrated/updated.png)

The updated capture is taken after the first purple gesture in root A, before
the later removal and teardown cases. Root B is still at its initial counter;
the white bar makes the committed state change visible.

## Scope of the experiment

The driver also exercises preventDefault/stopPropagation, deliberate native
callback faults and recovery, held-responder root teardown, and a surviving
second root. Its reports keep original normal trusted events separate from the
original responder event contract. The native contact payload is root-local;
the manually constructed global-contact oracle is recorded separately.

This uses actual native renderer delivery with injected Godot input, not physical
touchscreen hardware. It does not solve imperative pointer interest, enable the
public capability, resolve the four original experimental responder differences,
or certify the complete RN event surface. Final execution counts, digests,
terminal-registry retirement controls and mobile proof belong to the integration
receipt. See the [research and acceptance boundaries](../../docs/research/event-target-boundary.md).
