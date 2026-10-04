# Isolating pointer-interest query faults from the native batch

Status: executed isolated validation on official Godot 4.7.2, macOS arm64 and
pinned RN 0.87.1. The [execution receipt](../evidence/pointer-query-faults/README.md)
records the preceding native host's 12 reproduced failures and the corrected
host's 186 headless / 204 graphical checks. Public imperative/native EventTarget
flags remain off; this acceptance uses the experimental dispatcher and current
View-path `pointerdown` interest query.

## The failure was larger than the lookup

The [original-map interest query](native-pointer-interest.md) normally returns a
boolean without invoking listeners. Its native boundary nevertheless needs to
contain a thrown callback or an invalid return value. In the preceding host,
either fault escaped pointer processing and discarded the remaining native
EventQueue batch. The same input's following `topTouchStart` therefore lost both
Raw channels, its original touch callback and the callback's React state update.
The physical Down had already registered a held contact.

The unchanged causal fixture reproduced this for a thrown error and a numeric
return, each at pinned bubble offset `34` and capture offset `35`. Its original
host report retains **12 failed normative checks**: TouchStart callback, Raw
delivery and React commit for each of those four cases. The other 174 checks
passed. Recognizing this negative control does not turn that report into
186 passing checks.

## A narrow native boundary

The [host callback](../../native/application_runtime.cpp) now catches
`std::exception` around the installed query call and boolean validation. It
records `E_POINTER_LISTENER_QUERY` with the actual cause and returns false for
that interest lookup. It does not fabricate `topPointerDown`, dispatch a user
listener, clear the diagnostic or terminate a still-held physical contact.
The original queue continues with the same batch's TouchStart; the existing
Raw topics, original trusted touch dispatch and React commit remain intact.

Up, Cancel, root retirement and application stop retain responsibility for
contact cleanup. The fixture verifies those distinct boundaries, another root's
healthy gesture while the faulted contact is held, subsequent gestures and a
retirement/remount with a new root generation. Stop leaves recorded roots,
queued work, timers, frames and pointer routes empty while retaining all four
deliberate error diagnostics.

## Fault injection without a second listener system

The [test bootstrap](../../tests/pointer-query-fault-bootstrap.js) intercepts
the **one real SDK query installation**, passes a wrapper to the original
native installer, then restores that installer. A fault matches one actual
public ref and exact offset `34` or `35`, is consumed once, and either throws
the named error or returns numeric `1`. Every healthy call delegates to the
real SDK query over RN's original listener Maps. The test adds no listener
registry and does not replace listener methods, the dispatcher or the processor.

Real original refs have separate untrusted manual-dispatch positives. Healthy
native bubble and capture controls run before the fault matrix. A capture fault
also proves that the original bubble query first returned false. No JSX
pointerdown helper qualifies the fault target; its JSX touch callbacks are the
independent same-batch behavior being protected.

Godot ScreenTouch Down/Up/Cancel enters through `Input.parse_input_event` and
the actual native queue. The [probe](../../tests/pointer-query-fault-probe.gd)
and [runner](../../tests/pointer-query-fault-native.test.mjs) check actual query
attempts, one diagnostic per fault, callback order, Raw payload/timestamp
identity, trust, transient-field/global-event cleanup, event priority and
functional React updates. Four deliberate errors remain visible in logs and
status; allowances require exactly those errors, rather than hiding arbitrary
failures. The paired headless runs preserve the same authored inputs and
15 original RN source pins; their 14 producer pins differ only at the changed
native host source.

| Executed lane | Checks | Result |
| --- | ---: | --- |
| Preceding native host, headless | 186 | Exactly 12 failed batch-preservation contracts; retained as the negative control. |
| Corrected native host, headless | 186 | All passed, with four explicit retained query diagnostics. |
| Corrected native host, macOS viewport | 204 | All passed; includes 16 pixel assertions and two saved 680×160 frames. |

The [isolated example](../../examples/pointer-query-fault/README.md) explains
the commands and images. The receipt owns source/native digests and captures.
[Hosted CI](https://github.com/journey-studios/godot-fabric/actions/runs/37229423491)
passed five jobs at `b88708c`; its audited artifact confirms 186 fault checks,
22 committed pins and 15 RN inputs. The old-host control remains local, and
the later Document/root extension is outside that head. The preceding query-only
artifact verified 193 original / 230 current checks at `ab0dc44`; its full
workflow encountered an iOS `simctl` discovery timeout on attempt 1 and passed
all five jobs after a same-head rerun (attempt 2). That artifact does not
cover this correction or certify mobile execution.

## Remaining boundaries

- Resolving the ref through `stateNode`, `canonical` and `publicInstance` occurs
  before the new catch. Exceptions from those property getters are outside this
  executed callback/return-value acceptance. Broader resolver errors and
  reentrant stop/removal inside a query need separate cases.
- Document-only/documentElement-only interest, the full flag matrix and other
  pointer categories remain open. Normal listener or responder callback faults
  are separate contracts; this result does not close them.
- Physical hardware, Android/iOS runtime parity, performance, development
  renderer behavior and public capability enablement remain unverified here.
  This is a Godot host correction, not evidence that every RN platform shares
  the reproduced batch behavior.

The later [Document/root evidence](../evidence/pointer-documents/README.md)
extends native root interest and all four original flag configurations. Its
current View-interest regression command produces 193/233 checks, including
the new Document positive. The preceding 193/230 receipt and its source/CI
hashes remain historical evidence for their original executed snapshot.
