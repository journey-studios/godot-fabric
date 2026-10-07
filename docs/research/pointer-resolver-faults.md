# Containing a ref-resolution getter fault before the SDK query

Status: executed isolated validation on official Godot 4.7.2, macOS arm64 and
pinned RN 0.87.1. The [receipt](../evidence/pointer-resolver-faults/README.md)
records 62/65 checks on the preceding native host, with three reproduced
failures, and 65/65 headless / 85/85 graphical checks on the corrected host.
Public imperative/native EventTarget flags remain disabled.

## The query catch began too late

The earlier [query-fault validation](pointer-query-faults.md) covered a thrown
SDK query and nonboolean return. Before entering that catch, the native callback
read the component's `stateNode`, then `canonical`, then `publicInstance`.
These JSI property reads can invoke JavaScript getters. A getter exception could
therefore escape before the real SDK callback was entered.

The new native control reproduces that boundary on one actual View canonical
object. The original queue has already registered the physical Down when the
`publicInstance` getter throws. The preceding host retains the contact but loses
the same batch's following TouchStart callback, typed/star Raw delivery and
React state commit. Those are exactly the three failed normative checks in its
65-check report. Healthy controls, descriptor restoration and terminal cleanup
still pass on that host.

## Protecting the existing reads

The [native callback](../../native/application_runtime.cpp) now performs all
three component slot reads inside the existing query-call/boolean-validation
`try`. Its `std::exception` catch records `E_POINTER_LISTENER_QUERY` with the
cause and returns false for that individual interest lookup. It adds no new
listener registry, dispatcher, contact cancellation or category mapping.
The live-family, instance-handle and current-root checks preceding this boundary
retain their existing placement and are not fault-certified by this test.

The correction keeps the original processor and queue in control. A rejected
interest lookup emits no pointerdown. Later healthy queries are allowed to
continue; the following TouchStart retains the original trusted event, both Raw
channels, payload/timestamp identity and its functional React update. The
faulted sample increments TouchStart state once in exactly one native commit.
The recorded event fields and priority context restore after dispatch.

## A discriminating real-ref fixture

The [bootstrap](../../tests/pointer-resolver-fault-bootstrap.js) retrieves the
actual opaque Fiber from `godotInstanceHandle(tag)` and checks its connected
original RN public ref. It requires an own configurable data descriptor on
the actual canonical object, then replaces only `publicInstance` with a
one-shot getter. Before throwing, the getter restores the exact data descriptor
and records the owner and SDK entry count. It invokes neither native APIs nor
listeners. Restoration is proved for the value and all three descriptor flags.

The [JSX fixture](../../tests/pointer-resolver-fault-fixture.jsx) reuses the
existing two-surface query-fault scene and its one real SDK observer. Manual
untrusted dispatch and healthy native gestures establish real original listener
behavior before the fault. The faulting bubble read at offset `34` records zero
SDK entries. On the corrected host, seven subsequent capture/ancestor/root
queries reach the original-Map query and return false. Zero entries at the
actual failure is not a claim that the whole sample never enters the SDK.

Godot ScreenTouch Down/Up/Cancel runs through `Input.parse_input_event` and the
actual native queue. The [probe](../../tests/pointer-resolver-fault-probe.gd)
and [runner](../../tests/pointer-resolver-fault-native.test.mjs) retain the one
expected diagnostic, check B's healthy gesture while A remains held, cancel A,
exercise the next A gesture and verify balanced stop. B is released before A's
Cancel; this is not held-sibling retirement acceptance.

The paired runs preserve identical bundle bytes and 65 check IDs, 18 original
RN input pins and 17 producer pins. Only the native host source differs among
those producers. The original diagnostic is classified as `Non-js exception`;
the corrected one is `E_POINTER_LISTENER_QUERY` with the same cause. The test
retains the expected errors instead of clearing output or treating the old
three failures as passing checks.

The [example](../../examples/pointer-resolver-fault/README.md) has reproduction
commands and actual 680×160 native frames. Its updated A=2/B=0 image follows
one healthy A gesture and the recovered fault batch, before any B input or
Cancel. Graphical acceptance adds 16 pixel assertions, two counter assertions
and two saves to the same 65 checks. The receipt owns hashes and execution
identity; hosted run 37236875765 repeated the 65 getter checks with identical IDs
and bundle ([receipt](../evidence/pointer-resolver-faults/hosted-ci.json)), and the
viewport checks and captures stay local.

## What this does not certify

- The source encloses three slot reads, but executed fault acceptance covers
  only one self-restoring `publicInstance` getter with both original flags
  enabled. Individual stateNode/canonical faults, permanent/proxy/nested getters
  and the broader root-resolution or fault/flag matrix need separate controls.
- Reentrant stop, retirement or arbitrary callback behavior during resolution
  is unverified. This catch is not a complete JSI or queue-error policy.
- Native interest remains limited to `pointerdown`; up, move, hover and the
  remaining pointer/capture categories are not extended by this correction.
  Complete responder, coalescing and null-target acceptance also remain open.
- Local injected input and macOS readbacks do not establish physical hardware,
  Godot Android/iOS exports, development-renderer behavior, full event-priority
  mapping, performance or ABI certification.

The earlier [Document/root receipt](../evidence/pointer-documents/README.md)
and its five-job hosted run establish their own flag/root-interest acceptance.
They do not certify this later getter fixture. Public default flags stay off;
this isolated test adds no public API.
