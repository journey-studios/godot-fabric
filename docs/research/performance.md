# Performance baselines: native views, Hermes heap, phase timings and a soak

Status: executed isolated macOS validation (arm64, headless) against pinned RN 0.87.1, Hermes
250829098.0.17 and official Godot 4.7.2. This is the first slice of GF-30. It measures and does
not budget: it adds a `performance` section to the application snapshot, a harness that mounts and
unmounts four workloads in a soak, and 43 headless checks (15 that hold on every host and 28 that
need the new section; the [evidence record](../evidence/performance/README.md) pins the run of the
implementation commit, which had 41, before the review added the unmount notification's check and the stopped
application's check). Nothing in it judges a duration, the resident memory or Godot's static
memory, and nothing in it decides what a device may spend (see [Open](#open)). **The growth of the
live Hermes heap in the steady state is bounded by a normative check of 2,048 bytes**
([below](#the-live-heap-in-the-steady-state-and-the-limit)).

The [evidence record](../evidence/performance/README.md) pins the run, the hosts and the receipt of this
slice; its hosted CI run is pending. The suite is `npm run test:performance`. It runs the probe in Godot, replays the recorded report
through the probe's own checks, and passes the report through an independent oracle
(`tests/performance-oracle.mjs`) that recomputes the invariants and the percentiles from the raw
samples. The preceding host fails exactly the 28 checks that read the section, three retained
sabotages each fail at least one check and are rejected by the oracle, and the accounting has a C++
unit test (`.deps/build/performance_metrics_test`) over synthetic times.

## What RN measures, and where this host reads the same thing

RN has no frame, heap or node budget. It measures, and leaves the budget to the application and
the device.

- **Hermes' heap.** `NativePerformance::getSimpleMemoryInfo` hands JS every entry of
  `rt.instrumentation().getHeapInfo(false)` as a double
  (`ReactCommon/react/nativemodule/webperformance/NativePerformance.cpp`, lines 266-274). The
  instrumentation says the reading is "correct at the instant it is called" and offers a full
  `collectGarbage(cause)` (`jsi/instrumentation.h` of the pinned Hermes, lines 51-58 and 60-63). The
  host reads the same map, sorted, in `performance.hermes.heap`. The pinned Hermes is a Hades
  (concurrent) collector (`HermesInternal.getRuntimeProperties()["GC"]` is `hades (concurrent)`),
  so a reading taken without a collection depends on when the background collector last ran.
  Two readings are comparable only after a forced collection, which the host does when the
  application carries the `validation_collect_garbage_on_status` meta (a seam in the pattern of
  `validation_*` in `native/fabric_application.cpp`: a product never sets it, and a reading without
  it reports `collectedBeforeReading: false`).
- **Layout and diff times.** Every revision of a shadow tree carries a `TransactionTelemetry`:
  `ShadowTree::tryCommit` brackets `layoutIfNeeded` with `willLayout()` and `didLayout()`
  (`ReactCommon/react/renderer/mounting/ShadowTree.cpp`, lines 408-419), `mount()` pushes the revision
  to the mounting coordinator and calls the delegate (lines 486-491), and
  `MountingCoordinator::pullTransaction` times the differencing and keeps the revision's telemetry
  (`MountingCoordinator.cpp`, lines 71-93). The getters are in `TransactionTelemetry.h` (lines
  55-62). The host's mounting callback reads the layout start and end of the transaction it pulls,
  so the layout time it reports is RN's own timing and not a bracket the host drew around code it
  does not own.

## What Godot reports (4.7.2, headless)

The probe reads, from GDScript and without touching the extension profile: `SceneTree.get_node_count()`
and `Performance.get_monitor` for `OBJECT_NODE_COUNT`, `OBJECT_ORPHAN_NODE_COUNT`, `OBJECT_COUNT`;
`OS.get_static_memory_usage()` and `get_static_memory_peak_usage()`; and the resident set size of the
process through `ps -o rss= -p <pid>`. Two things are measured here and not assumed:

- **A Control that is not freed is an orphan, not an extra node.** `SceneTree.get_node_count()` and the
  node monitor count the nodes of the tree; a Control removed from its parent and never freed is
  counted by `OBJECT_ORPHAN_NODE_COUNT` only. The leak sabotage below is rejected by the orphan check
  and passes the node check, and that is why both are checked.
- **Headless is not a display.** Render monitors stay at zero, the loop runs a frame about every
  6.9 ms ([frame clock](frame-clock.md)), `DisplayServer.get_name()` is `headless` and
  `RenderingServer.get_current_rendering_driver_name()` still names `opengl3`. Any duration measured
  this way is the cost of the CPU work on a loop nothing paces, and says nothing about a frame on a
  display.

## The `performance` section

`FabricApplication.snapshot()` carries a `performance` object after `frameClock`. Its logic is in
`native/performance_metrics.h` (pure, no Godot or RN) and is fed from the pump, the mounting callback
and the surface start and retirement in `native/application_runtime.cpp`.

| Field | Meaning |
| --- | --- |
| `counters.commits`, `creates`, `deletes`, `updates` | Exact totals for the application: the live roots' counters plus those of every root that ended (a root adds its counters when it is retired, so the totals survive unmounting). |
| `counters.nativeViews`, `liveRoots`, `retiredRoots` | The native views alive, the roots alive and the roots that ended. `creates - deletes` is always `nativeViews`. |
| `hermes.source`, `hermes.collectedBeforeReading` | `jsi::Instrumentation::getHeapInfo`, and whether a full collection ran before this reading. |
| `hermes.heap` | Every key of `getHeapInfo(false)`: `hermes_allocatedBytes` (live bytes), `hermes_heapSize`, `hermes_va`, `hermes_externalBytes`, `hermes_numCollections` and the peak and timing keys Hermes adds. |
| `pump` | One sample per outermost pump (the turn of the runtime that Godot's `_process` runs once per frame; the 32 idle pumps of a root's retirement belong to the retirement, not to an outer pump). |
| `phases.js`, `phases.mount`, `phases.layout` | The time of a pump attributed to JS turns (microtasks, frame callbacks, timers, the queued work), to Fabric's mounting callback (the diff of the committed tree and the native mutations) and to layout (Yoga and text measurement, as RN's telemetry timed them). One sample per pump in which the phase ran. |
| `surfaces.start`, `surfaces.retire` | The call that starts a surface (React's first render is scheduled and runs in later pumps, so this is the cost of the call itself) and the whole retirement of a root. |
| every series | `count`, `rejected`, `totalMs`, `maxMs`, `p50Ms`, `p95Ms` and `p99Ms`: count, total and maximum are exact over the life of the series; the percentiles are the nearest rank over the last `windowSize` (128) samples. A duration that is negative or not finite is counted in `rejected` and enters nothing else. |
| `windowMs` of a series | The samples the percentiles come from, oldest first. **Only when the application carries the `validation_performance_samples` meta**, in the pattern of `validation_*`: they are most of the section's weight, and every `status()` of every reader pays for it. Whoever recomputes a percentile asks for them. |

The phases are exclusive: a mount inside a JS turn is the mount's time, and RN's layout of the commit is
taken out of the JS turn the commit ran in. So the phases of a pump never add up to more than the
pump, and a phase has at most one sample per pump. Work that is in none of the phases (input
sampling, the networking poll, native animation, viewport updates) is in the pump and in no phase.
React's first render of a root and its unmount run outside a pump; their commits count in the
counters, and the pump phases see only what ran inside a pump.

The weight of the section is measured by the probe after the soaks, when every window is full. The
application snapshot (without any surface's nodes) weighs 5,997 bytes without the `validation_performance_samples`
meta, of which the `performance` section is about 1,944, and 18,398 bytes with it, the section being about
13,433: the samples are about 12 KB that the default snapshot does not carry (they were always on in the
first version of this slice).

## A stopped application

A runtime that has stopped has one state, and a game may read its snapshot as often as it likes: `examples/services`
stops the application twice and requires the second snapshot to equal the first. The counters and series of the section
already hold still then (no pump runs and nothing is created or deleted), but the Hermes reading does not:
**each `getHeapInfo` call adds 40 bytes to `hermes_allocatedBytes` and `hermes_totalAllocatedBytes`**, measured by
reading a stopped application's snapshot twice. A host that read the heap afresh after the stop reported a different
snapshot every time, and the hosted `native-cold-start` job failed on it (`Repeated application stop preserves
finalized service lifetime`). So the runtime reads the heap one last time as it stops, in the same step that
marks it stopped, and a stopped runtime reports that reading in `performance.hermes` (with its `collectedBeforeReading`
as it was then) and reads nothing afresh. The probe stops its application twice and compares the text of four
snapshots, two without the validation metas and two with them: the check fails on the version that read the heap
afresh and passes on the preceding host, which has no section. While the application runs, the heap is not held
still: a reading without the collection meta is of a heap that the previous reading changed, and a reading with the
collection meta is of the live bytes.

## Method

Four workloads, each a root of its own mounted through `FabricSurface` and unmounted by removing it
from the tree:

- **idle**: a `View` that fills the surface (2 native views);
- **forms**: `Button`, `TextInput` and `Switch` through the public facade (5);
- **chart**: `react-native-chart-kit` `LineChart` through the SVG seam, as the chart example (71);
- **list**: a `FlatList` of 120 rows, rendered whole (`initialNumToRender` 120) so that the views a
  mount creates do not depend on batching timers (124).

Per workload, a soak of `CYCLES = 20` mounts and unmounts, the first `WARMUP_CYCLES = 3` left out of
the steady-state judgement. The cost of N is a few seconds in headless (the whole suite takes about
twenty seconds); a longer soak (100 cycles, run by hand, see below) found nothing a shorter one did not.
Each cycle takes three readings (before the mount, when the surface has settled, after the root was
retired and the surface freed). A reading is taken between two Godot frames, never inside a pump, and
holds what the engine counts and what the host reports after a full collection of Hermes' heap; the
probe sets the collection meta and the samples meta only around a reading, so that its own waits read
the light snapshot.

A surface counts as mounted when its state says so and its counters and the host's queues have not moved
for six frames; no check depends on how many frames that took. Further stages: the **heap source**
(a reading, 100,000 retained JS objects, a reading, their release, a reading), three **busy JS turns**
of 30 ms in a timer (the reading before and after shows the JS phase accounted for them), and a
**control** that takes the same readings as a cycle with nothing mounted.

## What is normative and what is recorded

Normative, exact, and independent of how fast the machine is:

- after every cycle the SceneTree holds the nodes the baseline of the run held, Godot counts no orphan
  beyond the baseline's, the surface's own report holds no native view (`creates - deletes ==
  nativeTags` while mounted, `nativeTags == 0` after) and the host holds no view or root;
- `creates - deletes == nativeViews` at every reading; every counter, sample count and total only grows
  from one reading to the next; every cycle of a workload creates and then deletes the same number of
  views;
- every phase's total is at most the pump's, and no phase has more samples than the pump has;
- every number is finite and not negative;
- the heap source follows JS: retaining the objects raises the collected heap by at least 32 bytes per
  object (the reading measured 138), releasing them lowers it by as much, and Hermes' collection count
  rises with every reading;
- the live heap at rest, after a full collection and with nothing mounted, never rises more than 2,048
  bytes above its value after the first steady cycle of a workload (the first three cycles are warm-up);
- without the `validation_performance_samples` meta the section reports aggregates and no samples, and
  with it the samples too;
- the notification of a root's unmount, which the surface keeps as its last report, is the snapshot read as the
  root ended with the performance section's `liveRoots` and `retiredRoots` brought up to the retirement: it agrees
  with its own `rootCount` and with the application's reading taken afterwards (the first version read the section
  with the root still alive and updated only `rootCount`);
- a stopped application has one snapshot: read again and again after `stop()`, with or without the validation metas,
  it is the same text (see [A stopped application](#a-stopped-application));
- a busy JS turn is accounted to the JS phase (at least as long as the turn was busy by the host's own
  clock, at most the pumps that ran it);
- the report names the Godot and Hermes versions, the architecture, the operating system and the driver;
- the oracle recomputes the nearest-rank percentiles from the samples the host reports, and where a
  series has at most 128 samples, their sum and maximum as well.

Recorded with provenance, never judged: every duration, the resident memory of the process and Godot's
static memory. A hosted runner is slower and noisier than a laptop, and the headless loop paces its own
frames, so a check on any of them would be a check on the machine. The probe waits on state, not on
time, and judges the frames it was delivered, never their pace.

## Measured on this machine

One run, the one the [evidence record](../evidence/performance/README.md) pins, on an Apple M3 Pro (11 cores), macOS, arm64, headless, Godot 4.7.2, Hermes 250829098.0.17,
`opengl3` named as the driver. Durations are milliseconds and vary from run to run by tens of percent;
the table is a baseline of what the harness records, not a promise. The mount columns are the sum of the
pumps from the cycle's start to the settled surface, the unmount columns from the settled surface to the
freed one; "p50 / p95" are the nearest ranks over the 20 cycles of the soak.

| Workload | Native views | Commits per cycle | Live heap at rest (bytes) | Heap held while mounted, over rest (bytes) |
| --- | ---: | ---: | ---: | ---: |
| idle | 2 | 1 | 1,790,616 | +21,840 |
| forms | 5 | 1 | 1,803,896 | +63,832 |
| chart | 71 | 1 | 1,820,872 | +263,520 |
| list | 124 | 1 | 1,933,112 | +1,448,784 |

With nothing mounted and the bundle loaded, the live heap was 1,790,472 bytes, the SceneTree held 2 nodes with
no orphan, and Hermes' external bytes were 0 (1,100 once a workload had run). Retaining 100,000 two-property
JS objects raised the collected heap by 13,840,984 bytes (138 per object) and releasing them took it back to
within 40 bytes of where it was; three JS turns busy for 30 ms were accounted 30.02 to 30.06 ms of JS phase
inside 30.07 to 30.13 ms of pumps.

| Workload | Mount: pump p50 / p95 | JS p50 | Mount p50 | Layout p50 | Unmount: pump p50 / p95 | `surfaces.retire` p50 / p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| idle | 0.52 / 1.08 | 0.35 | 0.09 | 0.01 | 0.20 / 0.27 | 0.59 / 0.80 |
| forms | 1.44 / 24.01 | 0.83 | 0.33 | 0.09 | 0.23 / 0.59 | 0.67 / 1.28 |
| chart | 6.65 / 31.79 | 3.18 | 3.23 | 0.06 | 0.40 / 0.52 | 0.91 / 1.23 |
| list | 18.12 / 49.94 | 12.01 | 4.05 | 1.43 | 1.69 / 2.19 | 2.57 / 4.03 |

The phase columns are the median of each phase over the cycles, so they do not add up to the pump's median.
Between a root's removal and its retirement the host runs idle pumps of its own, so the unmount pump holds
them too. Wall time per mount is left out: it is the number of frames the probe waited (six stable ones at
about 6.9 ms each), which is the loop and not the mount. The resident set size stayed within 90 to 188 MB
across the soaks (it moves by tens of megabytes in either direction within a run), and Godot's static memory
grew 62.9, 63.0, 65.7 and 66.6 KB per cycle against 60.5 KB for the control that mounts nothing.

## The live heap in the steady state, and the limit

The live Hermes heap at rest (after a full collection, nothing mounted) was read after every cycle.

Eight soaks whose reports were kept (seven of 20 cycles and one of 100, so 216 steady cycles per workload) gave,
after the first three cycles of each workload:

| Workload | Warm-up | Growth over the steady cycles | Largest step between cycles |
| --- | --- | ---: | ---: |
| idle | none: 1,790,616 from the first cycle | 0 | 0 |
| forms | none: 1,803,896 from the first cycle | 0 | 0 |
| chart | 1,819,368 to 1,820,872 in the first four cycles (+1,504 bytes) | 0 | 0 |
| list | 1,933,112 or 1,933,424 from the first cycle | 0 in seven soaks, +312 in one (the 100-cycle one) | 312 |

Two other soaks of 20 cycles whose reports were not kept (one showed the same 312-byte step in the list
workload) and an exploratory one, which showed it at its thirteenth cycle, are not in the counts above. The live heap at rest is the same to the byte from one cycle
to the next once a workload is warm, because a full collection runs before every reading and the same code
allocates the same objects. The single exception is a one-off 312-byte step in the list workload, at a point
of the run that varies: before the first list cycle in four soaks, inside the steady cycles of one, and in
none of the other three. Read in the middle of a cycle, with the root mounted, the heap moves around its fixed
point by 128 bytes (idle, forms, chart) to 4,528 bytes (list) over a soak.

**The limit is a normative check.** For each workload, after the first three cycles, the live heap at rest
after every cycle stays at most **2,048 bytes** above its value after the first steady cycle
(`HEAP_STEADY_GROWTH_LIMIT_BYTES` in `tests/performance-cases.mjs`; the probe judges it over its readings and
the oracle again over the same ones, and it is inclusive). The measured worst case is 312 bytes, so 2,048 is
6.6 times that and 0.1% of the live heap, which leaves room for a hosted runner's own one-off steps while still
failing any leak of 129 bytes or more per cycle within the 17 steady cycles (16 steps): a single retained
two-property JS object per cycle (138 bytes) fails it after fifteen steady cycles, and a root that is not
released (21,840 bytes for the idle one) fails it at once. The mounted readings are not bounded, as they spread
more than that around their fixed point. The suite checks the boundary on a recorded report: a rise of 3,000
bytes in one steady cycle fails the probe's check and the oracle, and a rise of exactly 2,048 passes both. The
number is a measurement of this host on this machine; a different Hermes, workload or runner needs it measured
again.

## What the soak did not find

No native leak: in every cycle of every run the SceneTree, the orphan count and the host's views returned to
the baseline. No JS leak in the steady state: the live heap after the warm-up is the same to the byte for
17 cycles in the idle, forms and chart workloads of every run, and moves by one 312-byte step in the list
workload in some runs.

Two observations the harness records and does not judge, because they are not the host's:

- **Godot's static memory grows in steps, and so does a plain Godot tree.** `OS.get_static_memory_usage()`
  grew about 63 to 67 KB per cycle in the soaks. The control, which takes the same readings with
  nothing mounted, grew 60 KB per cycle: that is the probe keeping its own readings. Measured once by hand,
  with a throwaway script that is not part of the harness, a Fabric list with no reading kept and a tree of 124
  plain `Panel` and `Label` children added and freed 120 times showed the same staircase (steps of about
  30 KB, 61 KB, 123 KB and 246 KB at the same cycles): a container of the engine growing with the number of
  cycles, not a per-view allocation of the host.
- **Resident memory** moves by tens of megabytes in either direction within a run (the allocator and
  the compressor of the operating system), so it is recorded and cannot be a limit.

## Limitations

- Headless only, on macOS arm64. No display, no frame time of a presented frame, no GPU work, no
  Linux, Windows, iOS or Android run. The leak of a Control that Godot itself holds is visible only to
  the orphan monitor.
- The `mount` and `layout` phases see the commits that run inside a pump. React's first render and a
  root's unmount commit run outside one; their cost is in `surfaces.start`/`retire` (the retirement) and
  in the counters, and the first render lands in the pumps that follow the start. The wall time of a mount in
  the report is the frames the probe waited, so it is quantized by the 6.9 ms loop and six stable frames.
- Percentiles are over the last 128 samples of a series, not over its life; the maximum and the total are
  over the whole life.
- A hosted runner can show a different warm-up, a different 312-byte step or noisier durations.
  Only the exact checks are asked of it.

## Open

- **Budgets by target device (D28).** Frame, JS, mount and heap budgets per target are decided after
  measuring on the target ([V2-D28](../ARCHITECTURE_V2_DECISIONS.md#v2-d28)); this slice measures
  on a laptop in headless and sets none. No optimization (caching, a JS worker, Rust) is accepted
  or rejected by these numbers.
- **Text shaping** (after GF-11, which adds the measure), **10,000 rows** (GF-15) and **graphic frame time**.
- **iOS and Android** runs, and a hosted CI baseline.
- A public JS surface (`performance.mark`, `measure`, `memory`) is not part of this slice: the section
  is a diagnostic of the application snapshot, like `frameClock`.

## Reproducing

```sh
npm run test:performance                 # the probe, the replay, the oracle and the report-level negatives
.deps/build/performance_metrics_test     # the accounting over synthetic times
node tests/performance-native.test.mjs --allow-original-negative   # with the preceding host in addons/
node scripts/performance-sabotage.mjs    # the three retained sabotages, source restored byte for byte
node tests/performance-native.test.mjs --replay=build/performance-current-report.json
```

A replay judges the readings a report recorded, and a report that lacks a section, or has it with another shape, is incomplete: the
probe's replay says `PERFORMANCE_REPLAY_INCOMPLETE` and exits with status 2, where it would otherwise abort on the index it does not
have (and, before this was checked, exit 0). What counts as complete is `REPORT_SHAPE` in `tests/performance-probe.gd`, a declarative
description (type names, nested keys, `["each", shape]` and `["pair", shape]`) of every field that `evaluate()` and `readings()` read
by name, checked by one recursive `matches`. The host's performance section inside a reading is only a Dictionary there, because the
checks read it through `dig()` and `get()`, which tolerate its absence. The suite replays twenty damaged copies of its own report, at
least one for each section (the provenance, the baseline, the heap source, the busy turns, the windows, the stopped application, each
workload, its cycles and readings, the surface rows and the final reading), and requires status 2 and no script error from each. A
throwaway sweep (not kept) damaged each field of the report in turn, in 3,742 copies, 1,432 of which the shape refused; `evaluate()`
ran on the other 2,310 without a script error.
