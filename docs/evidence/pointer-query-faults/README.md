# A failed interest lookup preserves the native event batch

An exception or non-boolean result from the internal pointer-interest query
previously escaped native processing. It discarded the same batch's following
TouchStart, its Raw delivery and its React update. The native host now records
`E_POINTER_LISTENER_QUERY`, rejects only that interest lookup and continues the
original queue. The physical contact remains held until its actual terminal event.

[Curated receipt](report.json), [isolated example](../../../examples/pointer-query-fault/README.md)
and [implementation boundaries](../../research/pointer-query-faults.md).
Execution used official Godot 4.7.2, RN 0.87.1, React 19.2.3 and Node 22.23.3
on macOS arm64 Release. The receipt pins the exact executed sources, original RN
inputs, two native hosts, bundle, raw reports and captures. Execution preceded
the implementation commit. All 22 executed code/configuration pins match
`1286b1bc1ff8d8f01a8585c4a8662d6f9916ce13`; the original execution identity remains unchanged.

| Executed lane | Result |
| --- | --- |
| Previous native host, identical fixture | 174/186 pass; 12 normative failures remain visible |
| Corrected host, headless | 186/186 pass |
| Corrected host, actual macOS viewport | 204/204 pass, including 16 pixel assertions and two capture saves |

The same fixture/bundle, 14 producer pins and 15 original RN inputs are used in
both causal lanes. Only `native/application_runtime.cpp` differs. Four one-shot
faults exercise thrown errors and numeric returns at the pinned bubble/capture
offsets 34/35 on actual original refs. Each old-host case loses three required
outcomes: TouchStart callback, its typed/star Raw delivery and functional React
commit. Recognizing the expected negative does not turn those 12 failures green.

The corrected lane retains trusted original touch event identity, both Raw
channels and the actual React update. It does not manufacture pointerdown or
invoke its listener when the query fails. Four diagnostics, including each cause,
stay visible in Godot output and the application error history. Transient event
fields and the priority context return to Default after delivery; this does not
certify the complete priority mapping.

Up, Cancel, root retirement/remount and application stop have separate cleanup
checks. B completes healthy gestures while A remains pressed and again after A
retires. B is already released before A's unmount in this fixture; held-B survival
during A retirement belongs to the preceding [interest proof](../pointer-interest/README.md).
Stop removes the query and leaves roots, contacts, routing, work, timers and
frames empty with balanced native nodes while retaining the four diagnostics.

These are actual 680 × 160 Godot viewport readbacks. Blue is the native input
target. Yellow width reflects functional React TouchStart state. The updated
frame is taken after the first thrown bubble lookup and B's healthy gesture,
with counters A=3/B=1; the initial frame has A=0/B=0. Eight exact RGBA assertions
per frame include the counter extensions.

![Two native surfaces before the query-fault cases](initial.png)

![The failed lookup still lets TouchStart update A while B works independently](updated.png)

Reproduce on the built corrected host with the locked tools:

```sh
npm run test:pointers:query-faults
node tests/pointer-query-fault-native.test.mjs --capture
```

The separate `--allow-original-negative` command validates an already installed
previous host. It does not select or replace binaries. The injected input is
`InputEventScreenTouch`; physical hardware and exported mobile input remain
distinct acceptance requirements. The internal test wraps the one real SDK
installation for fault injection, then restores its installer. Healthy calls
delegate to the actual original-Map query; no public listener system is added.

Regressions on the corrected host pass: 250 Node/13 Python contracts, static
analysis, 22 examples/2,250 checks, independent consumer 30 build/ownership and
40 native checks, fresh SDK pack/verify, loader 89 checks/21 cases, and 13 native
adapter runs/213 checks. Previous interest 193/230 and integrated dispatch
181/206 remain green, as do portable processor and geometry gates. Adapter ABI
certification remains false. [Hosted CI](https://github.com/journey-studios/godot-fabric/actions/runs/37229423491)
passed all five jobs at `b88708c`. Its [audited artifacts](hosted-ci.json) confirm
186 headless fault checks, 22 committed pins, 14 producers and 15 original RN
inputs, alongside 193/230 prior-interest regression checks. Four diagnostics are
retained with no unexpected probe errors. The native digest is declared by the
runner; no native binary is included for independent hashing. The 12-failure
old-host control and 204-check captures remain local. Core mobile reference jobs
do not certify Godot query-fault exports. The later Document/root extension is
not included in this head.

The catch covers the query call and boolean validation. Family/handle and
`stateNode.canonical.publicInstance` resolution happen outside it. Getter faults,
reentrancy, stop during the lookup and the full queue-error contract remain open,
alongside document/documentElement interest, the full flag matrix, other pointer
categories, responders, performance and hardware/mobile parity. Public flags stay
off. GF-05/06/07/08/13 remain In progress with no new completed checkpoint or
complete GF. glog initialization/destruction warnings may still appear.

The later [Document/root receipt](../pointer-documents/README.md) extends
root interest and the four original flag combinations. This historical
receipt keeps its own executed source pins, counters and CI scope unchanged.
