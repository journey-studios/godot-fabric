# Captured pointer geometry in Godot

Original RN View refs and pointer capture now resolve the actual dispatched
visible target's local coordinates through its full Godot/logical affine.
Client/page remain in the physical origin root; screen fields remain native
window samples. ReactFabric, Hermes, capture negotiation and ordering stay
upstream. A generated native overlay retains immutable native samples and
projects only offsets immediately before JS delivery. The official Godot
engine is unchanged. Downloaded RN sources are unchanged.

## Executed macOS arm64 proof

Godot 4.7.2 official, RN 0.87.1, React 19.2.3, Hermes 250829098.0.17,
Node 22.23.3. [The receipt](report.json) binds fixture/production sources,
original/generated RN headers, binaries, bundles, captures and SDK identity.
The [hosted receipt](ci.json) separates CI from local renderer proof. CI
`37202859447` at `f90206f` passed all five jobs. Audited artifacts confirm both
108-check processor witnesses, 378 binding checks and the headless631 fixture;
hosted Node is 22.23.2. The Pages main workflow `37202857849` passed build/deploy,
and the full served JSON matched branch f90206f outside main.

| Witness | Executed result | Scope |
| --- | --- | --- |
| Public example, headless | 631 passing checks | Two real shared roots, original View refs/handlers and injected native input |
| Public example, native window | 648 passing checks; 14 pixels; three captures | Same contracts plus independently selected renderer pixels |
| Identical fixture on preceding host | 55 expected failures/631 | 54 offsets plus singular-source exact terminal coordinates; all other checks pass |
| Original RN processor, compiled with matching original binding | 108 passing checks | Original capture order and four declared numerical cases, no native projection |
| Lifetime overlay without projection | Same 108 checks and numerical results | Lifetime fixes do not masquerade as a geometry fix |
| Real Hermes/binding | 378 passing checks | Immutable retained RawEvent sources, public fields, priorities, native/JS fault isolation, temporary retention and 13 history contracts |
| Prior terminal-history helper | Expected exit 1 at the new terminal serial check | Reproduces old terminal ordering before the monotonic correction |

The public fixture has 34 injections and 99 recorded pointer observations in
each mode. Declared independent matrices/corners drive expectations. It covers
ordered rotation/nonuniform scale, skew, percentage origins, reflection,
cross-root transfer, no-hit drag and a captured logical View without a native
wrapper. A genuine Move callback commits a React transform update. Godot moves
and scales both root embeddings, and the first density-two raw-window sample
is checked before another frame or cached JS metrics update. Original public
AABB measures are checked separately from affine points and painted corners.
Legacy TouchEvent keeps its physical origin during capture.

Singular source embedding cancels only its contact. Cancel/Lost reuse the same
family's offset at the exact last valid native point; absent valid history,
terminal delivery is omitted while original contact cleanup proceeds. A
concurrent contact survives, and restoring the embedding plus late Up cannot
revive the canceled one. Connected `display:none` capture retains the original
empty-layout numerical contract: its executed offsets equal owner-root client
coordinates. Showing it cannot restore an ended pointer.

Contact history is fresh on a new mouse Down and stores weak families. Serials
advance for both normal and terminal envelopes, preserving prior valid geometry
only for terminal delivery. Older callbacks cannot clear/overwrite the latest
sample. Direct history checks exercise `3 → 2`, `terminal 4 → normal 3` and
`normal 5 → terminal 4`; they are not a queue-coalescing certificate.

## The original numerical boundary

The pinned RN retargeter explicitly calls its AABB-origin subtraction
incomplete. The original and overlaid portable witnesses agree exactly:

| Declared case | True local point | Original captured offset |
| --- | --- | --- |
| Translation | (15, 10) | (15, 10) |
| Rotation 90° | (15, 10) | (30, 15) |
| Skew X 45° | (15, 10) | (25, 10) |
| Another embedded root | (15, 15) | (415, 115) |

The portable embedding is hypothetical; it does not execute Godot hit-testing
or instantiate Hermes/UIManagerBinding.
The separate public fixture proves the Godot correction. Correct local offsets
intentionally differ from the incomplete pinned numerical algorithm, without
replacing original IDs, capture negotiation or ordering.
[Source analysis](../../research/pointer-geometry.md).

## Binding and regression boundaries

The binding witness runs actual Hermes and original EventQueueProcessor over
retained RawEvent batches. Projection sees each original immutable source while
the processor modifies a separate dispatched copy. Interleaved roots keep
source metadata and all serialized fields except the projected offset. Native
projection failure and an actual JS `Error` remain visible; only the offending
capture retires, the surviving contact continues, temporary EventTarget
retention balances and priority returns to Default. Default is also verified
before the first event. The executed priority-mapping feature flag is false.
The tested `std::exception` host boundary does not certify typed JSI exception
RTTI across the framework or absolute absence of leaks.

Local regressions pass 199 Node/13 Python contract tests and 22 example
scenarios/2,246 headless checks; pointer lifetime/fault, transform/input guards, runtime,
shared applications, native modules, focus commands and services pass. A fresh
SDK is packaged and verified with matching overlaid headers/binary. Separate
registry tests pass 207 checks/11 cases; loader tests pass 89/21. The external
consumer passes 13 headless Godot runs/213 checks, including native Codegen
mounting, reentrant stop/timer/frame, selective root retirement and appearance.
This slice has no fresh graphical SDK or mobile build proof; ABI certification
remains false. Earlier graphical/export evidence has its own dated receipt.

## Captures

![Initial transformed targets in two embedded roots](pointer-geometry-initial.png)

The blue origin transfers capture to the rotated green target, then to the
skewed purple target in the other root. The yellow child paints under the
flattened logical capture View; its wrapper has no native Control.

![React update and reflection preserve refs/capture](pointer-geometry-updated.png)

The green transform commits from a real pointer callback. The purple affine
is reflected; refs and contact identity remain stable. Pixels separately verify
the old green location was repainted.

![Godot root embeddings at content density two](pointer-geometry-density.png)

These are actual native Viewport readbacks, not generated illustrations.
Screenshots cannot establish event ordering; the executed assertions do.

## Reproduce and remaining work

```sh
npm run setup
npm run test:pointers:geometry
npm run example -- pointer-geometry --headless
npm run example -- pointer-geometry --capture
npm run test:examples
```

Run native commands sequentially. Reports/logs stay in ignored `build/`; the
curated receipt preserves check IDs, numerical observations and provenance.
The previous-host negative uses the same final fixture and a saved binary;
its expected failure is not a green parity result.

GF-08/GF-09/GF-13 remain **In progress**. Ordinary Godot input flushes work per
accepted sample, so no-frame input alone does not exercise EventQueue unique
coalescing. Actual queued coalescing, complete EventTarget/responder/PanResponder,
scroll/multi-window/cross-application stacking, hardware keyboard/pointers and
mobile capture remain open. The existing original RN mobile core fixture has
no captured-pointer oracle. No full GF, release acceptance, architecture
approval or percentage change is justified by this bounded delivery.
