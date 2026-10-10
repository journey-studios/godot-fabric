# The Frontier HUD's performance baseline: what a panel swap costs on macOS

Status: executed isolated macOS validation (arm64) against pinned RN 0.87.1, Hermes 250829098.0.17 and official Godot 4.7.2,
headless for the exact counts and in a real window (local, not in CI) for the frame time; **the display presented the window on 2026-10-09** (commit `1bc3a3c`: five runs, each accepted at its first attempt),
and the presented frame time is pinned (see [The windowed baseline](#the-windowed-baseline-presented-2026-10-09-1bc3a3c)); the attempts that preceded it were not presented and are kept as history. This is the `baseline` criterion of the
0.5 Frontier milestone's V05-06: a baseline on the pointer spike's scene, with 50 to 100 native nodes per panel swap, extending the
GF-30 harness, with a budget **proposed** here and frozen later, once, on 2026-10-10 ([the freeze](frontier-freeze.md)). The `turno` and `soak` criteria of V05-06 have their own notes
and `congelado` is the freeze ([The budget, frozen](#the-budget-frozen-on-2026-10-10); [What is left](#what-is-left)). The slice changes no C++, so there is no preceding host to run it on; the control is the
four retained sabotages. The [evidence record](../evidence/frontier-baseline/README.md) pins the execution, the numbers and the captures; the hosted CI run and the Pages publication of the push of #77 to main
are in its `hosted-ci.json` and `publication.json`, and the windowed lane never runs in hosted CI.

## The question

The Frontier game's HUD is React Native over a Godot map. A player clicks a button of the bar and the panel under it is replaced by
another: the units, the city or the research list. That swap is the work the HUD does most often in the middle of a turn, and the 0.5
milestone has to say what it costs before any threshold is chosen ("performance thresholds are proposals: they are recorded, then
frozen once after the macOS baseline of V05-06 and before the first device session", ROADMAP.md). This slice measures it with the
harness GF-30 built for the soak ([performance.md](performance.md)), on the scene the pointer spike built ([world-input.md](world-input.md)),
and writes the proposal down.

## The scene and the HUD

[`examples/frontier-baseline/scene.tscn`](../../examples/frontier-baseline/scene.tscn) instances the pointer spike's world unchanged
(`res://examples/world-input/world.tscn`: the 24x16 map of 32-pixel tiles, a `Camera2D` at zoom 2, `_unhandled_input`), a
`CanvasLayer` with one `FabricSurface` over the whole viewport (topology (a) of the spike; the Surface takes `MOUSE_FILTER_IGNORE`
by default) and a `FabricApplication` that runs the bundle of [`tests/frontier-baseline-fixture.jsx`](../../tests/frontier-baseline-fixture.jsx).
The fixture registers `BaselineHud`, which uses only `View`, `Text` and `Pressable` with `style`, `testID`, `pointerEvents` and
`onPress`, props the 0.5 scope policy ([scope-0.5.json](../compatibility/scope-0.5.json), `src/prop-scope.mjs`) supports; none was refused.

- The root is `pointerEvents="box-none"`: the empty area is the map's.
- A bar has one `Pressable` for each panel (`Units`, `City`, `Research`, `Close`), each with a `Text` label. The bar is `box-none` too, so
  that a click that misses a button is the map's, and the sabotage that gives a button `pointerEvents="none"` lets the click through to the world.
- A region shows **one panel at a time**, chosen by React state that the `onPress` of a button sets. A panel is mounted with a `key`, so that a swap
  unmounts the old tree and mounts a new one.
- The panels are HUD-shaped trees, rows of nested `View` + `Text` in a wrapping grid, and their sizes are counted in **native nodes**, not in
  components: a root, a header `Text`, and for every chip a `View` and its `Text`, plus the production bar in the city.

| Panel | Shape | Native nodes |
| --- | --- | ---: |
| `units` | root, header, 24 chips | 50 |
| `city` | root, header, 36 chips, production bar | 75 |
| `research` | root, header, 49 chips | 100 |
| `empty` | nothing: the base | 0 |

The base, with no panel, is 12 native nodes in the Surface (its root, the HUD's root, the bar, four buttons and four labels, and the region), and the
SceneTree holds 19 nodes then. The sizes are pinned in [`tests/frontier-baseline-cases.mjs`](../../tests/frontier-baseline-cases.mjs) from the Surface's
snapshot (`nativeTags` with each panel shown, less the base; the SceneTree's node count moves by the same numbers), and the oracle derives them again from
the shapes with its own formula. A `Text` is one native node, not two.

The swap is made by a **real click**: the probe delivers the pointer spike's own injection ([`tests/world-input-driver.gd`](../../tests/world-input-driver.gd),
preloaded and not copied), a motion, a press and a release at the center of the button through `Input.parse_input_event`, delivered at once by
`Input.flush_buffered_events()`. The `onPress` changes the React state. Nothing is faked on the JS side.

## What a swap does, measured

The measure is **a swap from panel A to panel B**. A **tour** of 12 swaps makes every ordered pair of the four panels once and ends at the base
(`empty`, `units`, `empty`, `city`, `empty`, `research`, `units`, `city`, `research`, `city`, `units`, `research`, `empty`), so the swaps span 0 to 175
nodes touched. The probe makes 2 warm-up rounds and 30 steady ones (**384 swaps, 30 steady swaps for every ordered pair**) in each of two Godot processes.
After every swap it takes a reading with the **shared sampler** ([`tests/performance-sampler.gd`](../../tests/performance-sampler.gd), the reading GF-30's
soak takes, extracted without changing a check or a field of its report): the engine's counts (the SceneTree's nodes, Godot's node, orphan and object
monitors, static memory and the resident memory) next to the host's `performance` section after a **forced collection** of Hermes' heap. At the end of every
round, after 30 idle frames, one more at rest.

### What is judged, exactly

None of it depends on the pace of the machine, and it holds in both processes, swap by swap:

- the SceneTree, Godot's node monitor and the host's native views after a swap are the base's plus the size of B, and Godot counts no orphan beyond the base's;
- a swap **creates** the nodes of B and **deletes** those of A (the host's counters, the Surface's counters, and the application's snapshot read around the click);
- when the tree holds B's nodes the Surface's snapshot holds B's last node and the root of no other panel;
- a click **swaps exactly once** (one press on the button of B, one change of the React state) and **never reaches the world**: `world.received` is empty after every swap;
- a round ends back at the base (nodes, orphans, native views, the one root), and the click shows its panel within a bound of frames after the flush;
- every reading of Hermes' heap follows a forced collection, so that two are comparable;
- the live heap at rest does not grow past the GF-30 limit, `HEAP_STEADY_GROWTH_LIMIT_BYTES` = 2,048 bytes (imported), from the first half of the steady rounds to the last, each judged
  on its median ([The heap at rest](#the-heap-at-rest)).

The probe has 18 checks (and one that the report is saved). An [independent oracle](../../tests/frontier-baseline-oracle.mjs) derives the same from the raw report
(the sizes from the shapes, the swaps from the tour, the counts from the readings), recomputes the percentiles that are recorded from the raw samples with the GF-30
oracle's nearest rank, and checks the host's own series through that oracle's `verifyReading` (the 128-sample windows, the ordering of the percentiles, the
forced-collection mark). `--replay=<report>` judges a recorded report in Godot without the application, as GF-30's does. The suite changes a recorded report in ten ways
that the probe's replay and the oracle must both reject (a leaked node, a wrong count of deletions, a double press, a click the world heard, a panel without its last node, a heap
read without a collection, a heap that grew 3,000 bytes, a leak of 200 bytes a round on either of the two hosted series of the heap at rest, a run cut short), in five that both must accept (a transient
allocation of 2,056 bytes in the last round, a rise of exactly the limit, those two hosted series themselves, and a first half that alone dips to the low level), and damages it in eleven ways that the replay must refuse with status 2 and no script error.
The oracle's judgement of the heap at rest also has its own unit test on numbers alone (`tests/frontier-baseline-heap.test.mjs`, part of `test:contracts`).

### What is recorded and never judged

Everything that depends on the pace of the machine, with its provenance: the frames a click takes to show its panel (0, see below), the time of the injection and
flush, the time of the swap's frame, the pump and its JS, mount and layout phases from the host's section, the heap of a swap over the base and the resident
memory, Godot's static memory per round. The headless loop runs a frame about every 6.9 ms with nothing pacing it and draws nothing
([frame-clock.md](frame-clock.md)), so what it records of time is **the cost of the CPU work on an unpaced loop and is not a frame time**. The frame time
is measured only in the windowed lane.

## The headless baseline

One run of the suite (2026-10-08), pinned by the [evidence record](../evidence/frontier-baseline/README.md), on an Apple M3 Pro (11 logical cores, 18 GB) with macOS 26.6.2, arm64,
Godot 4.7.2, Hermes 250829098.0.17, the headless display server and the `opengl3` driver named. The Mac was not idle: other agents' work ran on it, and the system load average
(1 minute) was 4 to 8 around the headless commands (the evidence record has it before and after every command), so the durations are a baseline of this machine as it was and not a best
case. Per ordered pair of panels, the median (p50) and the 95th percentile (p95) of the 30 steady swaps in each of the two processes ("1 / 2", milliseconds), and the host's accounting
of process 1's median. "Click to nodes" is the time from the start of the click's injection to the moment the SceneTree holds the new panel; the pump and its phases are the host's own
accounting of the pumps between the read before the click and the read two frames after the nodes exist.

| Swap | Created | Deleted | Click to nodes p50 (1 / 2) | p95 (1 / 2) | Pump p50 | JS p50 | Mount p50 | Layout p50 | Heap over base p50 (KB) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| empty to units | 50 | 0 | 5.1 / 5.3 | 8.6 / 9.1 | 5.1 | 3.3 | 1.4 | 0.3 | 245 |
| units to empty | 0 | 50 | 1.8 / 1.8 | 2.7 / 2.5 | 1.7 | 1.2 | 0.4 | 0.0 | 78 |
| empty to city | 75 | 0 | 7.1 / 7.0 | 11.6 / 10.4 | 7.0 | 4.4 | 2.1 | 0.5 | 318 |
| city to empty | 0 | 75 | 2.1 / 2.1 | 3.1 / 3.4 | 1.9 | 1.3 | 0.5 | 0.0 | 80 |
| empty to research | 100 | 0 | 8.7 / 8.7 | 12.4 / 12.3 | 8.6 | 5.4 | 2.6 | 0.6 | 395 |
| research to empty | 0 | 100 | 2.4 / 2.4 | 3.6 / 3.4 | 2.1 | 1.4 | 0.6 | 0.0 | 81 |
| units to city | 75 | 50 | 7.5 / 7.4 | 13.2 / 10.6 | 7.3 | 4.5 | 2.3 | 0.5 | 320 |
| city to units | 50 | 75 | 5.8 / 5.9 | 11.5 / 7.3 | 5.5 | 3.4 | 1.7 | 0.3 | 243 |
| units to research | 100 | 50 | 9.1 / 9.3 | 12.3 / 12.1 | 8.9 | 5.4 | 2.9 | 0.6 | 397 |
| research to units | 50 | 100 | 6.2 / 6.2 | 15.4 / 9.3 | 5.9 | 3.6 | 1.9 | 0.3 | 242 |
| city to research | 100 | 75 | 9.7 / 9.4 | 13.9 / 14.7 | 9.4 | 5.6 | 3.1 | 0.6 | 397 |
| research to city | 75 | 100 | 8.0 / 7.9 | 9.8 / 10.0 | 7.7 | 4.7 | 2.5 | 0.5 | 320 |

The p95 of 30 samples is the 29th, so it moves with one slow swap. The two processes differ at the median by up to 0.3 ms between pairs. The
exact counts below are identical in both processes; the durations are close and not identical. What the table says:

- **The panel is there when the click returns.** The host mounts the new panel inside the flush that delivers the click (the pointer event, React's update, the commit
  and the mount all run in it), so the SceneTree holds the new nodes the moment `Input.flush_buffered_events()` returns: **0 frames** after the flush, in every one of
  the 720 steady swaps of the two headless processes. "Click to panel in process frames" is 0 here, and its time is the time of that call.
- **The cost follows the nodes the swap creates**, and deleting is cheap: a swap that only deletes 50 to 100 nodes takes 1.8 to 2.4 ms at the median, and one that creates 50, 75 or 100
  takes 5.1 to 6.2, 7.0 to 8.0 and 8.7 to 9.7 ms, by pair (over all the swaps that create that many: 5.8 and 6.0, 7.8 and 7.6, 9.1 and 9.3 ms in process 1 and 2; roughly
  0.07 ms for each node created over a floor of about 3 ms). Of the 5.1 ms of process 1's 50-node create, 3.3 are JavaScript (React's render and
  commit), 1.4 are the host's mounting of the nodes and 0.35 are Yoga's layout.
- **A swap that creates 100 nodes costs 9.2 ms of CPU at the median and 12.4 at p95, more than one 120 Hz period** (8.33 ms), and fits in one 60 Hz period (16.7 ms) in both; one that creates 50 is under the
  120 Hz period at the median (5.1 to 6.2 ms by pair) and over it at p95 (8.6 ms). Development runs of the same code on a more loaded machine gave 11 to 12 ms at the median for the 100-node swap (not pinned): the cost moves with the state of the machine by tens of percent, and the position against 8.33 ms holds.
- **A mounted panel holds heap and gives it back.** While it is shown, Hermes' live heap is 245, 318 and 395 KB over the base (identical in both processes). Once the panel is gone it is
  78 to 81 KB over the base right after the swap and about 70 KB at rest (2,032,000 bytes against the base's 1,960,448, which the first mounts raised), a floor that does not grow with the
  rounds ([The heap at rest](#the-heap-at-rest)).
- **The host's own window** of the last 128 pumps of process 1 (percentiles recomputed from the samples by the GF-30 oracle): pump p50 0.012 ms, p95 0.77, p99 10.3, maximum 28.8;
  mount p50 2.1 ms; layout p50 0.46 ms. Most pumps are idle ones; the swaps are in the tail.
- The resident memory of the process moved between 131 and 192 MB in the run and Godot's static memory grew 369 KB a round, which is the probe keeping its own
  13 readings a round. Both are recorded and not judged.

Process 2 had the same exact counts swap by swap and all its checks; the suite compares the two.

## The windowed lane

`node scripts/frontier-baseline-graphics.mjs` is local (a real window, the native renderer and a display; CI has none) and writes a receipt and a capture of each
panel. It runs [`tests/frontier-baseline-graphics-probe.gd`](../../tests/frontier-baseline-graphics-probe.gd) with `--windowed` on the `gl_compatibility` renderer, in
the same scene and with the same tour and swap code as the headless probe ([`tests/frontier-baseline-swap.gd`](../../tests/frontier-baseline-swap.gd), shared), and
measures what only a window has: the interval between consecutive process frames, from `Time.get_ticks_usec`.

**Protocol** (one fixed rule per line; nothing is left out except what is written here):

1. **5 runs, in separate processes**, one after the other. Each is a fresh Godot process that mounts the scene and runs the tour.
2. **Warm-up: 2 rounds** of the tour (24 swaps) are thrown away. They are in the raw data, flagged by their round.
3. **Idle window**: after the warm-up and with the map and the HUD still, 600 consecutive frames, nothing read, nothing injected.
4. **N = 30 steady rounds**, which is **30 swaps for every ordered pair of the four panels (360 swaps)** per run. For each swap the intervals of the frames from the one
   that took the click up to the first at which the nodes exist (at least that one) are recorded, with the time of the injection, the time from the start of the
   injection to the moment the nodes exist, and the time to the first frame drawn after it (`RenderingServer.frame_post_draw`, connected for the run). The probe reads nothing
   heavy between the click and two frames after the nodes exist (a count of the SceneTree's nodes is all it reads), so the intervals hold the swap's work and not the probe's;
   the Surface's snapshot, which weighs about a hundred nodes, is read after.
5. **p50, p95 and p99 of each run** are computed from that run's raw intervals with the nearest rank (the rank `ceil(p * n / 100)` of the sorted samples). The **median and
   the interquartile range across the runs** (nearest-rank quartiles: with 5 runs the median is the third value and the IQR the fourth minus the second) are the statistic
   of the execution.
6. **Provenance**: the machine (chip, model, cores, memory), the system, the display, the renderer and the adapter, the **vsync mode and the refresh rate read back from the
   window** (`DisplayServer.window_get_vsync_mode()`, `screen_get_refresh_rate()`; the project's default is not changed) and the system load (`sysctl vm.loadavg`)
   **before and after each run**.
7. **No outlier is discarded.** The warm-up is the only rule that leaves swaps out, and one rule leaves whole runs out: **a run counts only if a display presented the window**. It is two checks
   on the raw data (`graphicsRunValidity` in the oracle):
   - the window **drew throughout**: a frame was drawn after every steady click and in at least nine of ten frames of the idle window (a window the system does not draw, covered by other
     windows or the display asleep, still runs process frames, but they are not those of a displayed application);
   - the loop was **paced**: the **idle reference** of the window, the median of the half-sums of its consecutive pairs of idle intervals (`median((x[i] + x[i+1]) / 2)`; see
     [the idle reference](#the-idle-reference-three-statistics-over-the-raw-intervals-of-2026-10-09)), is **at least half of the refresh period that the window read back** (4.17 ms at 120 Hz).
     With the display off or showing the lock screen the window still draws, `frame_post_draw` still fires and the vsync mode still reads `enabled`, but nothing paces the loop and an idle frame
     takes about 0.5 to 0.7 ms; a presented window at 120 Hz has a reference of about 8.3 ms. (Until 2026-10-09 the check was on the median of the idle intervals, which with the vsync on falls in
     one of two groups of intervals by a few samples; the receipts recorded under it are not judged again.)

   A run that fails either check is **rejected with its reason** ("undrawn: the window did not draw throughout" or "unpaced: the display is not presenting"), kept in the receipt
   (`rejectedAttempts`, with its raw intervals) and repeated, at most three times for each of the five. If a slot uses up its attempts the lane stops: the receipt is written with
   `presented: false`, a status "not presented: <reason>" and **no frame-time statistic** (`summary` is null, and the script prints only why each attempt was rejected), and the script
   exits with code 3, which is neither success (0) nor a crash, so that nothing downstream takes it for a baseline. The oracle refuses a receipt with an accepted unpaced run
   (`verifyGraphicsReceipt`) and the statistics across runs (`summarizeGraphicsRuns`) refuse an unpaced run; both are tested on synthetic runs in
   `tests/frontier-baseline-graphics.test.mjs`, which is part of `npm run test:contracts`. Every interval of every accepted run is in the receipt (`raw`), so anyone can apply another
   rule to the same data. An outlier run stays in and shows in the range. (An earlier execution of this code had a run in which the window drew after 16 of 360 steady clicks, and a
   later one drew throughout with no display pacing it: the pacing check was added after it.) Since V05-06 (GF-30) the probe puts its window in front of the others and above them and records, for every process frame, whether
   the engine could draw it, so that an `undrawn` reason says what the engine said of the window; the rule above is unchanged ([the windowed presence](windowed-presence.md)).
8. **The map's own pointer events**: a window on a display also gets the motion of the real pointer, which is the map's whenever it is over the map, so the windowed
   probe judges the presses, releases and touches that reach the world (none may) and records the other events. (An earlier execution had two swaps
   with two motion events each.)

An interval is of **process frames**, which is what the game's `_process` sees. With the vsync on, the engine runs ahead of the display and blocks on it, and the frames come
in clusters (the frame-clock note measured about 3 ms and 13 ms apart at 120 Hz on this display), so an interval longer than the refresh period is **not** an image the display
showed twice: no "missed frame" is read from these intervals, and the ROADMAP's missed frames with the vsync on stay open, since they need presentation timestamps that Godot does not
give. The receipt counts, as the final comparison V05-10 asks, the frames above twice the idle reference (and, as it always did, above twice the idle median) and above 100 ms.

### The windowed baseline: presented (2026-10-09, `1bc3a3c`)

**The presented frame time is pinned.** The windowed lane ran once on commit [`1bc3a3c`](https://github.com/journey-studios/godot-fabric/commit/1bc3a3cc7d5d1a160f2158a87a5f8c623b504130)
(`caffeinate -d node scripts/frontier-baseline-graphics.mjs`, the working tree clean) and the display presented the window: **`presented: true`, exit code 0, 5 of 5 slots accepted at the first attempt of each and no attempt rejected**,
the vsync read back `enabled` at 120 Hz. The commit is that of [the windowed presence](windowed-presence.md), which puts the lane's window in front of the others and above them and records, for every process frame, whether
the engine could draw it; the rule of validity of protocol item 7 is the one written above and did not change. [The evidence of that slice](../evidence/windowed-presence/README.md) describes the execution (the user's absence, the load, the sources
pinned), and [this baseline's evidence record](../evidence/frontier-baseline/README.md#faixa-janelada-apresentada-2026-10-09) pins the numbers below, and the raw receipt itself is committed byte for byte as [`windowed-presented-raw.json`](../evidence/frontier-baseline/windowed-presented-raw.json) (437,679 bytes, SHA-256
`36b32e0d6d1418af122260aa453bdd77bd9619811181731a88855a1e526e13b7`), so that every statistic can be recomputed from its intervals: [how, in the evidence record](../evidence/frontier-baseline/README.md#recalcular).

**What was checked.** `verifyGraphicsReceipt` accepts the receipt, with the oracle of `1bc3a3c` and with the one of this tree, and each of the five runs passes `graphicsRunValidity` (it drew, it was paced). `summarizeGraphicsRuns`, run over the raw intervals
of the five runs, gives the receipt's `summary` exactly (but for the count of the real pointer's motion events over the map, which `raw` does not keep), and every figure below was computed again from the raw intervals by a separate script outside the repository
(nearest rank; quartiles of five) and is equal to the microsecond.

**Where.** An Apple M3 Pro (11 logical cores, 18 GB), macOS 26.6.2 (25G83), arm64, the built-in "Color LCD" (1512 x 982 points, 3024 x 1964 pixels, 120 Hz, scale 2); an 800 x 600 window on `gl_compatibility` over `opengl3` (adapter "Apple M3 Pro"), Godot 4.7.2,
Hermes 250829098.0.17; the frame cap off (`max_fps` 0) and the vsync mode `enabled`, read back from the window. Five runs, each in a process of its own, about 46 s each; the same scene, tour and swap code as the headless lane.

| Run | Process frames | Frames drawn | Frames the engine could not draw | Idle reference (ms) | Idle median (ms, recorded) |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 5,133 | 5,117 | 0 of 5,120 | 8.339 | 6.022 |
| 2 | 5,125 | 5,109 | 0 of 5,112 | 8.336 | 7.928 |
| 3 | 5,095 | 5,079 | 0 of 5,082 | 8.334 | 4.580 |
| 4 | 5,098 | 5,082 | 0 of 5,085 | 8.338 | 4.367 |
| 5 | 5,083 | 5,067 | 0 of 5,070 | 8.339 | 8.368 |

In every run a frame was drawn after each of the 360 steady clicks and the idle window drew 601 times for its 600 intervals; the engine could draw the window in all of the 25,469 frames it sampled. The loop was paced: the idle reference is 8.334 to 8.339 ms, the period of 120 Hz
(8.333 ms), where a loop that nothing paces idles at about 0.7 ms. The median of the idle intervals, which no longer judges, moves from 4.4 to 8.4 ms between runs for the reason given in [the idle reference](#the-idle-reference-three-statistics-over-the-raw-intervals-of-2026-10-09).

**The idle window** (600 consecutive intervals between process frames, the map and the HUD still; ms). The p95 and p99 are the long group of the two that alternate with the vsync on, and the p50 falls in one group or the other, hence its range:

| Run | p50 | p95 | p99 | max | Intervals above twice the idle reference |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 6.022 | 14.854 | 15.604 | 52.315 | 4 of 600 |
| 2 | 7.928 | 14.583 | 15.169 | 15.888 | 0 of 600 |
| 3 | 4.580 | 14.504 | 14.854 | 19.290 | 1 of 600 |
| 4 | 4.367 | 14.554 | 15.213 | 25.699 | 3 of 600 |
| 5 | 8.368 | 15.167 | 15.509 | 44.654 | 3 of 600 |
| **Median [IQR]** | 6.022 [3.348] | 14.583 [0.300] | 15.213 [0.340] | 25.699 [25.364] | 3 [2] |

**The swap frame** is the interval of the process frame that took the click, from the start of the frame in which the injection is flushed to the start of the next one (protocol item 4). The nodes exist when the flush returns (0 frames of latency in all of the 1,800 steady
swaps of the five runs) and a drawn frame followed every click. The table groups the 360 steady swaps of a run by the nodes the swap creates, that is the size of the panel it shows (0, 50, 75 or 100: 90 swaps of each); each cell is the median across the five runs of the statistic of one run,
with the interquartile range of the five in brackets (ms):

| Nodes created | p50 | p95 | p99 |
| ---: | ---: | ---: | ---: |
| 0 | 3.662 [0.014] | 13.714 [0.031] | 14.284 [0.732] |
| 50 | 8.448 [0.058] | 11.052 [0.403] | 15.565 [3.959] |
| 75 | 11.171 [0.144] | 14.080 [1.876] | 19.278 [3.406] |
| 100 | 13.144 [0.111] | 16.577 [0.131] | 24.607 [5.514] |
| all swaps (360 a run) | 10.596 [0.123] | 14.835 [0.378] | 18.175 [1.639] |

By run, for all the swaps (ms):

| Run | p50 | p95 | p99 | max | Above twice the idle reference |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 10.410 | 14.835 | 18.175 | 22.366 | 6 of 360 |
| 2 | 10.502 | 14.497 | 18.978 | 25.918 | 5 of 360 |
| 3 | 10.625 | 15.928 | 19.836 | 60.024 | 11 of 360 |
| 4 | 10.596 | 14.217 | 15.447 | 19.278 | 2 of 360 |
| 5 | 10.673 | 14.875 | 17.339 | 24.621 | 6 of 360 |

**The click to the first drawn frame** (from the start of the injection to the first frame drawn after the nodes exist; ms):

| Run | p50 | p95 | p99 | max |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 10.366 | 14.636 | 17.343 | 20.313 |
| 2 | 10.455 | 14.418 | 18.926 | 25.796 |
| 3 | 10.580 | 15.878 | 19.735 | 59.945 |
| 4 | 10.552 | 14.157 | 15.373 | 19.225 |
| 5 | 10.630 | 14.835 | 17.278 | 24.572 |
| **Median [IQR]** | 10.552 [0.125] | 14.636 [0.417] | 17.343 [1.648] | |

What the tables say, and no more:

- **The swap frame follows the nodes the swap creates.** At the median it is 3.7, 8.4, 11.2 and 13.1 ms for 0, 50, 75 and 100 nodes: a 50-node swap takes about one period of 120 Hz (8.33 ms) and a 100-node swap 1.6 periods. The 100-node swap's p95 (16.6 ms at the median) is at the 60 Hz period (16.67 ms): under it in three of the five runs (14.73, 16.57 and 16.58 ms) and over it in two (16.70 and 19.44); its p99 (24.6 ms) is over it.
- **The CPU time inside the frame is the headless lane's.** The injection and flush, by nodes created, is 2.6, 6.3, 7.9 and 9.4 ms at the median (p95 3.7, 8.3, 10.2 and 11.5) in the window, against 2.2, 5.9, 7.7 and 9.2 ms (p95 3.2, 8.6, 10.6 and 12.4) headless. What the window adds is the loop's
  pace: the frame of a 0-node swap, which costs 2.6 ms of CPU, is 3.7 ms at the median and 13.7 ms at p95, the two groups of the idle window.
- **The p99 of 90 swaps is the largest of them** (nearest rank 90), so the p99 of a size is the statistic of one swap a run and has the widest range (0.7 to 5.5 ms). The largest swap frame, 60.0 ms (a 100-node swap of run 3), is not the swap's alone: the idle windows of runs 1 and 5 hold intervals of 52.3 and 44.7 ms with
  nothing happening. The cause of those stalls was not isolated.
- **No frame of 100 ms or more**: 0 of the 1,800 steady swap frames and 0 of the 3,000 idle intervals. The frames above twice the idle reference (16.7 ms), the count the final comparison V05-10 uses ([the amendment of its protocol](frontier-comparison-protocol.md#amendments)), are 6 [1] of 360 swap frames a run (2 to 11)
  and 3 [2] of 600 idle intervals (0 to 4); by size the swap frames above it are 0 (0 nodes), 0 to 1 (50), 1 to 2 (75) and 0 to 9 (100) of 90.
- No missed frame is read from these intervals (see the protocol), and the vsync was on in every run: FPS without a limit is not claimed.

**The load, and who was there.** The Mac was not quiet: other agents' work ran on it. The one-minute load average (`vm.loadavg`, 11 logical cores) was 5.41 before the lane and 6.79 after it, and 5.26 to 6.16 around the five runs (five-minute 5.60 to 5.92, fifteen-minute 6.82 to 7.08);
it is in the evidence record for every run. **The numbers are therefore pessimistic**: a quieter machine may show smaller ones. The `congelado` criterion did not wait for one: the freeze of 2026-10-10 took this execution by the user's decision, with the corroboration of the night of 2026-10-09 beside it ([the freeze](frontier-freeze.md#the-inputs)). Nobody was at the Mac: the time since the last keyboard or pointer event (`HIDIdleTime`) grew by 234.5 s over the 235 s
of the lane, so there was no event. That says nothing of whether anyone looked at the screen, and it means that **a user working on the Mac is not in these numbers**: the presented baseline is that of a machine nobody was using, and loaded by other agents.

### The first windowed attempts, 2026-10-08: pending (history)

*This is the record as it stood before the lane was presented; it is superseded by the execution above and kept as it was written.*

**No frame time is pinned.** The windowed lane ran on the pinned commit with `caffeinate -d` while the Mac had been idle for about 96 minutes (`HIDIdleTime`) and the display was off or
showing the lock screen. Every attempt drew (`frame_post_draw` fired after 99.9% of the process frames) and the vsync mode read back `enabled` at 120 Hz on the built-in display
("Color LCD", 1512 x 982 points, 3024 x 1964 pixels, 120 Hz, scale 2; an 800 x 600 window, `gl_compatibility`, adapter "Apple M3 Pro"), but **no display paced the loop**: an idle frame took
about 0.7 ms against the 4.167 ms (half of the 120 Hz period) that the validity rule of protocol item 7 requires. The three attempts of slot 1 were **rejected as unpaced**, the lane stopped,
and the receipt says `presented: false`, carries no frame-time statistic and exits with code 3:

| Slot | Attempt | Idle median (ms) | Required (ms) | Frames drawn | Reason |
| ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 1 | 0.704 | 4.167 | 5,067 of 5,071 | unpaced: the display is not presenting |
| 1 | 2 | 0.708 | 4.167 | 5,047 of 5,051 | unpaced: the display is not presenting |
| 1 | 3 | 0.704 | 4.167 | 5,057 of 5,061 | unpaced: the display is not presenting |

The raw intervals of the three attempts are kept in the evidence record (`windowed-raw.json`, `rejectedAttempts`) and are **not frame times**: they are the CPU cost of a process frame in a loop no
display brakes. Nothing of them is a result here. The capture run, which measures nothing, passed.

**Unpinned reference, not a result.** An earlier execution of the same code while the display presented the window had an idle p50 of 7.8 ms (the clusters of about 3 and 13 ms at 120 Hz)
and a swap frame p50 of 12.2, p95 of 18.6 and p99 of 25.5 ms (medians of five runs). Its raw receipt was overwritten before it was kept, so the record does not pin it and no budget row starts from it.
The presented frame time needs an awake, unlocked display: run the lane again and it will check that the loop was paced.

The captures of each panel (`frontier-baseline-panel-empty.png`, `-units.png`, `-city.png` and `-research.png`, 800 x 600 PNGs in [the evidence record](../evidence/frontier-baseline/README.md), hashed in its receipt) are
of the frame as drawn, from a separate run that measures nothing, with pixel checks that the bar is over the map, each panel is where the HUD puts it, and the base comes back after them.

### The windowed attempts of 2026-10-09: not presented

*History: these two executions, earlier on the same day, were superseded by the one on `1bc3a3c` ([presented](#the-windowed-baseline-presented-2026-10-09-1bc3a3c)). The text is as it was written.*

After the record above, the baseline's windowed lane (`node scripts/frontier-baseline-graphics.mjs`, the main's scripts, unchanged) ran **twice** on commit `e6a271d364a27f73acf995ed846c78eed055dde0`, whose tree (`669f2d8f9739a1fc4189092828fad2bc1d24a386`) is identical to the main commit `1adcdb3`, with the user present and the display on, on the same machine
(Apple M3 Pro, "Color LCD" at 120 Hz, an 800 x 600 window, `gl_compatibility`, the vsync read back `enabled`). **Both ended as not presented** (`presented: false`, exit code 3, `summary: null`, no frame-time statistic): slot 3 used up its three attempts both times. **The windowed baseline stays pending** and so does the `baseline` criterion; the budget rows that depend on it are as they were.
The raw receipts are not committed; the [evidence record](../evidence/frontier-baseline/README.md#tentativas-janeladas-de-2026-10-09-não-apresentadas) has every attempt, and their hashes are:

| Attempt | Receipt | SHA-256 | Status | Slots accepted | Attempts |
| --- | --- | --- | --- | --- | ---: |
| A | 735,913 bytes | `bada551e3014ae950cb5c2ef80e8997752fdd730184099424ed2545d587b49e1` | `not presented: unpaced: the display is not presenting (slot 3, 3 attempts)` | 1 and 2 | 8 (2 accepted, 5 `undrawn`, 1 `unpaced`) |
| B | 453,863 bytes | `c03a9f46cf35379eb6eabc3e86e8a0960f7d52d40745db23ae4b4fcdeb2f02c4` | `not presented: undrawn: the window did not draw throughout (slot 3, 3 attempts)` | 1 and 2 | 5 (2 accepted, 3 `undrawn`) |

The three attempts of slot 3 (verdict, idle median in ms, frames drawn of process frames):

| Receipt | First | Second | Third |
| --- | --- | --- | --- |
| A | `undrawn`, 6.700, 4,245 of 5,241 | `undrawn`, 6.893, 182 of 5,774 | `unpaced`, 4.136, 5,106 of 5,110 |
| B | `undrawn`, 6.516, 3,845 of 5,282 | `undrawn`, 5.211, 2,970 of 5,396 | `undrawn`, 6.882, 90 of 5,771 |

What the numbers show, and no more:

- In the eight `undrawn` rejections the window stopped drawing for part of the run (90 to 4,245 frames drawn of 5,241 to 5,778 process frames of an attempt), and in four of them (A1, A4, A7, B5) the idle window drew no frame at all (601 draws in the other nine attempts of A and B), with a mean idle interval of 6.900 ms against
  8.324 to 8.459 ms, about one refresh period (8.333 ms), in the rest. The cause was not isolated and is not proven.
- The one-minute load average stood between 6.2 and 8.0 around A's attempts and between 5.6 and 10.9 around B's: the Mac was loaded.
- Attempt A8 was rejected as `unpaced` for an idle median of 4.136 ms, **0.031 ms under** the 4.167 ms required, with a mean of 8.333 ms and 5,106 of 5,110 frames drawn: its 600 idle intervals split into 300 under 4.167 ms and 300 of 12 ms or more, none between, and the median is the last of the short ones. The idle intervals of the nine attempts that drew
  fall mostly in the same two groups (243 to 300 under 4.167 ms and 290 to 300 of 12 ms or more) and two neighbours add up to 16.65 to 16.68 ms at the median, which is also what the turn's windowed lane saw ([the windowed result of the turn](frontier-turn.md#the-windowed-result-presented-2026-10-09)). The rule is the baseline's own (`graphicsRunValidity`) and it was not touched.
- The four captures of attempt A were written and measure nothing; no frame-time statistic of A or of B is a result.

### The idle reference: three statistics over the raw intervals of 2026-10-09

The pacing check of protocol item 7 used to judge a run by the **median** of its 600 idle intervals. With the vsync on at 120 Hz those intervals come in two groups that alternate (the clusters of
[the frame-clock note](frame-clock.md)): about half of them are under 4.17 ms and about half are 12 ms or more, so two neighbours add up to about one period (16.67 ms) and the mean is about 8.33 ms.
The median falls in one group or the other by a few samples. One windowed attempt of the baseline was refused as `unpaced` with a median of 4.136 ms (4.167 ms required) while the display
presented the window (a mean of 8.333 ms, 5,106 of 5,110 frames drawn), and the accepted runs of the turn had medians from 4.42 to 13.18 ms.

Three candidates for the reference, over the same 600 intervals `x[0..n-1]` of every attempt the three receipts of 2026-10-09 hold (accepted and rejected) and of the three unpaced attempts of 2026-10-08
that [the baseline's record](../evidence/frontier-baseline/windowed-raw.json) keeps raw: the **median** (nearest rank, the rule until this change), the **mean**, and the **median of the pair half-sums** (the rule from this change on),
`median((x[i] + x[i+1]) / 2)` for `i` from 0 to n - 2. The threshold is the same for all three: half of the refresh period that the window read back, 4.167 ms at 120 Hz.

| Receipt | Run, attempt | Judged as | Median (ms) | Mean (ms) | Pair half-sum median (ms) | Below / at or above half a period | Largest (ms) |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| Turn, presented | 1, 1 | undrawn | 4.475 | 8.329 | 8.331 | 298 / 302 | 15.4 |
| Turn, presented | 1, 2 | undrawn | 6.874 | 6.900 | 6.902 | 0 / 600 | 7.8 |
| Turn, presented | 1, 3 | accepted | 13.177 | 8.356 | 8.331 | 299 / 301 | 18.4 |
| Turn, presented | 2, 4 | accepted | 8.495 | 8.601 | 8.331 | 285 / 315 | 52.9 |
| Turn, presented | 3, 5 | accepted | 4.421 | 8.341 | 8.338 | 298 / 302 | 16.7 |
| Turn, presented | 4, 6 | accepted | 8.130 | 8.339 | 8.335 | 292 / 308 | 17.6 |
| Turn, presented | 5, 7 | undrawn | 4.777 | 8.338 | 8.332 | 297 / 303 | 21.3 |
| Turn, presented | 5, 8 | accepted | 12.678 | 8.631 | 8.342 | 289 / 311 | 17.0 |
| Baseline A | 1, 1 | undrawn | 6.888 | 6.900 | 6.901 | 0 / 600 | 7.8 |
| Baseline A | 1, 2 | accepted | 4.665 | 8.334 | 8.335 | 292 / 308 | 15.9 |
| Baseline A | 2, 3 | undrawn | 4.643 | 8.336 | 8.332 | 294 / 306 | 15.4 |
| Baseline A | 2, 4 | undrawn | 6.894 | 6.900 | 6.900 | 0 / 600 | 7.7 |
| Baseline A | 2, 5 | accepted | 11.772 | 8.386 | 8.327 | 286 / 314 | 16.6 |
| Baseline A | 3, 6 | undrawn | 6.700 | 8.334 | 8.334 | 298 / 302 | 17.0 |
| Baseline A | 3, 7 | undrawn | 6.893 | 6.900 | 6.900 | 0 / 600 | 7.8 |
| Baseline A | 3, 8 | unpaced | **4.136 (under 4.167)** | 8.333 | 8.333 | 300 / 300 | 16.3 |
| Baseline B | 1, 1 | accepted | 11.548 | 8.459 | 8.338 | 243 / 357 | 16.8 |
| Baseline B | 2, 2 | accepted | 5.177 | 8.333 | 8.332 | 290 / 310 | 15.4 |
| Baseline B | 3, 3 | undrawn | 6.516 | 8.352 | 8.332 | 259 / 341 | 20.4 |
| Baseline B | 3, 4 | undrawn | 5.211 | 8.324 | 8.331 | 274 / 326 | 18.3 |
| Baseline B | 3, 5 | undrawn | 6.882 | 6.901 | 6.897 | 0 / 600 | 8.1 |
| Baseline, 2026-10-08 | 1, 1 | unpaced | 0.704 (under 4.167) | 0.725 | 0.706 | 598 / 2 | 4.7 |
| Baseline, 2026-10-08 | 1, 2 | unpaced | 0.708 (under 4.167) | 0.705 | 0.710 | 599 / 1 | 4.5 |
| Baseline, 2026-10-08 | 1, 3 | unpaced | 0.704 (under 4.167) | 0.719 | 0.704 | 598 / 2 | 4.4 |

The receipts of 2026-10-09 are kept outside the repository; these are the SHA-256 of the files the table was computed from: the turn's
`db86eb0816f036add015022ffab74187c8debab0dc218e2bc81e4dad723cdbb5`, the baseline's attempt A `bada551e3014ae950cb5c2ef80e8997752fdd730184099424ed2545d587b49e1` and its attempt B
`c03a9f46cf35379eb6eabc3e86e8a0960f7d52d40745db23ae4b4fcdeb2f02c4`. The 2026-10-08 rows are `windowed-raw.json` of the baseline's record
(`2673a645ba67d291f1f254860fcc6422cf1723c116f4bb166be6a1e4df4c99b0`). The intervals are the idle window's, in the order they were taken.

What the table says (observation only: **it changes no verdict and no receipt** of the ones in it):

- **The median is the unstable statistic.** Among the 16 attempts of 2026-10-09 whose idle intervals came in the two groups (the other five, at about 6.9 ms, are a uniform loop at a different pace, and all three
  statistics accept them), the median runs from 4.136 to 13.177 ms and one of them is under the threshold, while the mean runs from 8.324 to 8.631 ms and the pair half-sum median from 8.327 to 8.342 ms.
  The attempt that was refused (baseline A, run 3, attempt 8) is exactly the one with the clusters split 300 / 300: its pairs all mix a short and a long interval (599 of 599).
- **The pair half-sum median would have accepted that attempt** (8.333 ms against 4.167), and the drawn-frames check, which that attempt passed (5,106 of 5,110 drawn), would have been the only one left to decide. It leaves every other
  attempt of 2026-10-09 as it was judged for pacing, and refuses the three unpaced attempts of 2026-10-08 (0.704 to 0.710 ms).
- **The mean and the pair half-sum median give the same verdict on all 24 attempts.** They differ in robustness and not in these data: one hitch moves the mean (the turn's run 2 has a 52.9 ms interval and a mean of
  8.601 ms against 8.331 for the half-sum median), and it moves only two pair half-sums. A loop that nothing paces (about 0.6 ms a frame) with a single stall of 2.1 s or more would have a mean over 4.167 ms and a
  half-sum median of about 0.6 ms: no receipt has that case, so `tests/frontier-baseline-graphics.test.mjs` covers it with a synthetic run.
- **No attempt shows the half-sum failing where the mean does not.** Only one of the 16 attempts with two groups alternates strictly (baseline A, run 3, attempt 8: 599 of 599 pairs mix a short and a long interval); in the other 15,
  between 485 and 596 of the 599 pairs do, and the half-sum median stayed within 8.327 and 8.342 ms regardless.

**The rule from the next execution on.** The pacing check is on the third column, the median of the pair half-sums, with the same threshold (half of the refresh period read back). In `tests/frontier-baseline-oracle.mjs`:

- `idleReference` is the statistic and `graphicsRunValidity` judges `paced` by it. It returns `idleReferenceMs` and `minimumIdleReferenceMs`, and keeps `idleMedianMs` (a record, no longer the judge) and `minimumIdleMedianMs` (the same value as the new minimum, kept for the receipts and tests that already read it).
  The rejection still reads "unpaced: the display is not presenting", and the refusals (`summarizeGraphicsRuns`, `verifyGraphicsReceipt`, the lane's printout) say which value failed: the reference, with the median next to it.
- The summary of a run counts the frames above twice the idle median (`aboveTwiceIdleMedian`, with the meaning it always had) **and** above twice the idle reference (`aboveTwiceIdleReference`), in the run and in the aggregate across runs. The comparison V05-10 uses the count by the reference
  ([the amendment of its protocol](frontier-comparison-protocol.md#amendments)). The turn's lane keeps printing the count by the median until a later change to its script.
- **Nothing recorded is judged again.** A receipt whose attempts carry no `idleReferenceMs` was written under the median and `verifyGraphicsReceipt` judges it by the median, as it did. The three receipts of 2026-10-09 (and the pinned ones: `116a72f`, `cb50b97` and the baseline's) are as they were:
  the table is an observation. The attempt A8, refused by the median, stays refused in its receipt; a run like it would be accepted from the next execution on.

## The heap at rest

The live heap of Hermes at rest (the base shown, after a forced collection and 30 idle frames) was **2,032,000 bytes in the steady state in both processes**, which is 71,552 bytes over
the base's 1,960,448 that the first mounts raised and then never gave up. Two things were learned on the way, and the check has the shape they imply:

- **React lets go of a closed panel a few frames after the commit.** A reading taken right after a swap to the base, six quiet frames later, holds about 11 KB that the same reading
  30 idle frames later does not (the fibers of the unmounted panel, which React detaches in work it schedules after the commit). So "at rest" is read after `REST_FRAMES` = 30 idle frames,
  and the readings after a swap, which are recorded, are not at rest.
- **A reading can carry a transient allocation of 2,056 bytes**, in one to three consecutive rounds, always returning to the same floor (a series like `0 0 0 2056 2056 0 0` over
  the floor). It was seen in about two processes in five while the slice was built, and in both processes of one suite run (one round above the floor in one, two in the other, `highestAboveFloor` 2,056), and in neither process of the run recorded here.
  It is 8 bytes more than the GF-30 limit of 2,048 and was not seen in GF-30's workloads (their one-off steps were 312 bytes). It adds and goes; a leak raises the floor. The strict form (the highest of the
  series over the first steady round, GF-30's) failed in 3 of the 8 processes run before the check was changed; the form "last minus first" would fail whenever the last round is a transient.
- **The noise is wider than that, and a floor does not reach the bottom of it.** The hosted run of PR #77 (job `native-cold-start`, run 37868943054) recorded, in the 32 rests of its second
  process, a heap that moves among four levels, 2,031,680, 2,032,000, 2,033,736 and 2,034,056 bytes, with no trend: a **band of 2,376 bytes**, wider than the limit. The floor of the first five steady rounds
  was 2,031,680 and that of the last five 2,033,736, 2,056 bytes apart, and the check of windows of five rounds failed on a run that leaked nothing. (The two hosted series are embedded in
  `tests/frontier-baseline-heap-series.mjs`.) A floor over a few rounds reads the rare low levels, so what it says depends on whether the run happened to visit one. The floors of the two halves (15 rounds
  against 15) are no better: they differ by -320 and +320 bytes on the hosted series, but a first half that alone reaches 2,031,680 or 2,032,000 against a last half that never does is 2,056 bytes apart with no leak.
- **The check therefore compares the median of the last half of the steady rounds with the median of the first** (`floor(n/2)` rounds each: the first 15 against the last 15 of the 30 measured; the median by nearest
  rank, like the percentiles of the GF-30 oracle) against the GF-30 limit, which is inclusive. A few off-level readings do not move a median, and a leak raises it as it raises the rest. On the two hosted
  series the medians of the halves are the same (2,034,056 and 2,033,736 bytes): growth 0.
- **How noisy each statistic is.** Drawing 30 steady values at random, 200,000 times, from the 60 steady values of the two hosted series, a check with no leak to find fails in about **12.7%** of the draws on the floors of
  windows of five rounds, **4.2%** on the floors of the halves and **0.05%** on the medians of the halves. This is a rough bound and not a model of the heap: the real transients come in runs of one to three rounds
  and not independently, and the 60 values are from one runner.
- **What the medians catch.** They lie 15 rounds apart, so on a heap with no noise a leak of `L` bytes a round adds `15 L` between them and the check fails from `L` = 137 bytes a round (GF-30's fails at 129; the check of
  windows of five rounds claimed 82, which the noise did not allow it to keep). On the hosted series the smallest leak that fails is 158 bytes a round on process 1's and 113 on process 2's (the floors of the halves: 140 and
  158), because the medians can sit a few hundred bytes apart with no leak. The leak the suite uses is 200 bytes a round, which fails on both (growths of 2,800 and 3,720).
- **The suite shows it** with the two hosted series, which pass with a growth of 0 (in the probe's replay in Godot, in the oracle, and in the oracle's unit test on numbers alone); with a leak of 200 bytes a round on top
  of either, which both reject; with the smallest failing leaks pinned (137 on a heap with no noise, 158 and 113); with a first half that alone dips to the low level, which passes (a check on the floors of the halves called it
  a leak); with a recorded report whose last half is 3,000 bytes up, which fails; with exactly the limit, which passes, and one byte more, which fails; and with a single transient of 2,056 bytes in the last round, which
  passes. The oracle records the floors of the halves, `lastMinusFirst`, `highestAboveFloor` and `largestStep` as observations. This reads the criterion ("grows at most the GF-30 limit between the first steady cycle and the
  last") as a statement about the level of the heap at rest and not about two single readings; it is the one place where the slice's method is more than the plain reading of the spec, and it is reported as a deviation.

## The budget, frozen on 2026-10-10

**Frozen once, on 2026-10-10.** The table is the proposal that this section made when the windowed baseline was presented, now frozen by [the freeze](frontier-freeze.md): the single act of the criterion `congelado` of V05-06, which also freezes the five thresholds of
[the final comparison's protocol](frontier-comparison-protocol.md#the-freeze). It is recorded in [`freeze.json`](../evidence/frontier-freeze/freeze.json), which `node scripts/frontier-freeze.mjs --check` recomputes, row by row, from the committed [`inputs.json`](../evidence/frontier-freeze/inputs.json)
(the intervals of the five runs of the baseline and of the five of the turn, both on `1bc3a3c`). What the freeze did to each row:

- **Kept**: the rows marked **exact**, the headless CPU and heap bounds and the memory row come from the headless lane pinned in #77, which does not change.
- **Recomputed**: the windowed rows, from the intervals of `1bc3a3c`, the execution the proposal was derived from. They give the same bounds as the proposal: nothing moved between the proposal and the freeze.
- **Removed**: the rows of the p99 by size (below).
- **Added**: two rows of the turn, the p95 of the AI phase and the p95 of the end of the turn, which are two of the five thresholds of the protocol.

Changing a frozen bound from now on is a decision of its own, with its record, and not an edit of this table. No suite asserts a time or a heap bound (a hosted runner's pace is not this machine's): the suites judge the **exact** rows, and the windowed frame-time bounds are what the final comparison reads as its absolute budget, reported beside the category for B and for C and never changing it.
The rules: the CPU time of a swap is the p95 pooled over the two headless processes, times 1.25, rounded up to 0.5 ms; the heap a panel holds is the p50 times 1.25, rounded up to 10,000 bytes; a frame time of a presented window is the **median across the five
presented runs of the statistic plus three times its interquartile range** (the interquartile range of five by nearest rank is the fourth value minus the second), rounded up to 0.5 ms, applied below to the execution of 2026-10-09 on `1bc3a3c`.

| Metric (lane) | Baseline | Frozen bound | Rule |
| --- | --- | --- | --- |
| Native nodes after a swap (headless, **exact**) | the base's 12 plus 0, 50, 75 or 100 | exact | judged now: SceneTree, host and Surface |
| Nodes a swap creates and deletes (headless, **exact**) | the new panel's and the old one's | exact | judged now |
| A click swaps once, never reaches the map, a round ends at the base (headless, **exact**) | held in 720 steady swaps | exact | judged now |
| Live heap at rest, first to last half of the steady rounds, each by its median (headless, **exact**) | 0 bytes (2,032,000 in both processes) | at most 2,048 bytes | the GF-30 limit, imported and judged now |
| Frames from the click to the panel (headless) | 0 in 720 of 720 steady swaps | at most 1 | the maximum measured plus one frame for a commit that lands in the next pump |
| CPU time of the swap (injection and flush), p95, by nodes created 0 / 50 / 75 / 100 (headless, 180 swaps each) | 3.2 / 8.6 / 10.6 / 12.4 ms (p50 2.2 / 5.9 / 7.7 / 9.2) | 4.5 / 11.0 / 13.5 / 16.0 ms | pooled p95 x 1.25, up to 0.5 ms; the 100-node bound is near the 60 Hz period (16.7 ms) |
| Heap a mounted panel holds over the base (headless, forced collection) | 249,024 / 327,808 / 406,072 bytes for 50 / 75 / 100 nodes (the same in both processes) | 320,000 / 410,000 / 510,000 bytes | p50 x 1.25, up to 10,000 bytes |
| Swap frame p50, by nodes created 0 / 50 / 75 / 100 (windowed, the display presents the window, vsync on, 120 Hz; 90 swaps of each size in each of 5 runs) | median of the 5 runs: 3.662 / 8.448 / 11.171 / 13.144 ms | 4.0 / 9.0 / 12.0 / 13.5 ms | median across the 5 runs + 3 IQR, up to 0.5 ms; of a loaded machine nobody was using |
| Swap frame p95, by nodes created 0 / 50 / 75 / 100 (windowed, same) | 13.714 / 11.052 / 14.080 / 16.577 ms | 14.0 / 12.5 / 20.0 / 17.0 ms | same rule; the 75-node bound is wide because the five runs' p95 are two of about 15.4 ms, one of 14.1 and two of about 13.5 |
| Swap frame p95, all swaps (windowed, same; the protocol's `budget-p95-context-switches`) | 14.835 ms (360 swaps a run, through the four panels) | 16.0 ms | same rule; the 50 swaps of the window go through the seven contexts as the runs of the baseline go through 0, 50, 75 and 100 nodes |
| Idle frame p99 (windowed, 600 idle intervals in each run) | 15.213 ms | 16.5 ms | same rule; the long group of the vsync's clusters is 13 to 15 ms, so no bound under it is meaningful |
| Swap frames and idle frames of 100 ms or more (windowed) | 0 of 1,800 swap frames and 0 of 3,000 idle intervals | 0 | median 0 + 3 x IQR 0 (a count, not rounded) |
| AI phase frame p95 (windowed turn, vsync on, 120 Hz; the first six busy frames of each of the 120 steady turns, 720 a run, in each of 5 runs; the protocol's `budget-p95-ai-phase`) | 14.642 ms (median of the 5 runs) | 15.5 ms | median across the 5 runs + 3 IQR, up to 0.5 ms; of the HUD of `1bc3a3c`, on a loaded machine nobody was using |
| End-of-turn frame p95 (windowed turn, same; the seventh busy frame, which delivers `turn_ended`, and the frame after it, 240 a run; the protocol's `budget-p95-event-burst`) | 14.847 ms (median of the 5 runs) | 15.5 ms | median across the 5 runs + 3 IQR, up to 0.5 ms; the lane records two frames of the end of a turn, the window of the protocol has at least five, and the others were not measured |
| Resident memory and Godot's static memory per round | RSS 131 to 192 MB headless; static 369 KB a round (the probe's own readings) | none | recorded: they move by tens of MB and by the probe's bookkeeping, and cannot be a limit |

The rule of the ROADMAP's final comparison (V05-10) holds for the frame time: **FPS without a limit counts only if the vsync mode read back is disabled**. With the vsync on, as in every attempt here, the outcome is
the **CPU time per frame** (the injection and flush, the pump and its phases, which the headless lane records exactly), and the frame times are read against the refresh period the display reports: 8.33 ms at the
120 Hz of this display. A 100-node swap's own work (9.2 ms at the median, 12.4 at p95) is more than one such period, so today it cannot fit in a single 120 Hz frame on this machine, and a budget in frames at that
rate would fail it by construction. The freeze keeps the per-swap CPU bound and the frame-time bounds of the table, and chooses neither a bound in frames at a lower rate nor a change in what a swap creates (fewer or flatter nodes, a list that mounts
what is visible): that stays a question about the HUD and not about the budget. The presented window says the same in frames: the frame that takes a 100-node swap is 13.1 ms at the median (1.6 periods of 120 Hz) and 16.6 ms at p95, and the injection and flush inside it cost 9.4 ms of CPU at the median.

**The rows that left.** The p99 of the swap frame by size (proposed as 16.5 / 27.5 / 29.5 / 41.5 ms for 0 / 50 / 75 / 100 nodes) is not frozen, for this reason: the p99 of 90 swaps is the largest of them (nearest rank 90), so the bound by size is fixed by one swap a run and is the noisiest (IQR 0.7 to 5.5 ms); the tail is covered by the count of frames of 100 ms or more, which stays. The p95 of the same swaps has an IQR of 0.03 to 1.9 ms across the runs. The count of frames of 100 ms or more is 0 in the five runs. The derivation of the removed rows is kept below, marked as not frozen.

**How the frame-time bounds are derived.** Per statistic, the five runs' values sorted, the nearest-rank quartiles of five (the second, third and fourth values), and the rule. Everything is in milliseconds and was computed on integer microseconds from the raw intervals
by `budgetOf` in `scripts/frontier-freeze.mjs` (the swap and idle figures are the receipt's own `summary`, which `summarizeGraphicsRuns` reproduces; the by-size ones are the same statistic over the swaps of one size; the two rows of the turn are the p95 of the frames of each window over the 120 steady turns of a run, from the raw intervals of the turn's receipt). The bounds in bold are frozen; the others are
derived to be read. Every row of this table is checked against the freeze by `tests/frontier-freeze.test.mjs`.

| Statistic (ms) | The five runs, sorted | Q1 | Median | Q3 | IQR | Median + 3 IQR | Up to 0.5 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Swap frame p50, 0 nodes created | 3.565 / 3.653 / 3.662 / 3.667 / 3.731 | 3.653 | 3.662 | 3.667 | 0.014 | 3.704 | **4.0** |
| Swap frame p95, 0 nodes created | 13.632 / 13.690 / 13.714 / 13.721 / 13.794 | 13.690 | 13.714 | 13.721 | 0.031 | 13.807 | **14.0** |
| Swap frame p99, 0 nodes created | 13.897 / 14.251 / 14.284 / 14.983 / 15.141 | 14.251 | 14.284 | 14.983 | 0.732 | 16.480 | 16.5 |
| Swap frame p50, 50 nodes created | 8.414 / 8.436 / 8.448 / 8.494 / 8.588 | 8.436 | 8.448 | 8.494 | 0.058 | 8.622 | **9.0** |
| Swap frame p95, 50 nodes created | 10.688 / 10.713 / 11.052 / 11.116 / 11.843 | 10.713 | 11.052 | 11.116 | 0.403 | 12.261 | **12.5** |
| Swap frame p99, 50 nodes created | 12.201 / 13.282 / 15.565 / 17.241 / 20.135 | 13.282 | 15.565 | 17.241 | 3.959 | 27.442 | 27.5 |
| Swap frame p50, 75 nodes created | 10.926 / 11.053 / 11.171 / 11.197 / 11.534 | 11.053 | 11.171 | 11.197 | 0.144 | 11.603 | **12.0** |
| Swap frame p95, 75 nodes created | 13.426 / 13.533 / 14.080 / 15.409 / 15.420 | 13.533 | 14.080 | 15.409 | 1.876 | 19.708 | **20.0** |
| Swap frame p99, 75 nodes created | 18.780 / 18.960 / 19.278 / 22.366 / 24.621 | 18.960 | 19.278 | 22.366 | 3.406 | 29.496 | 29.5 |
| Swap frame p50, 100 nodes created | 13.130 / 13.144 / 13.144 / 13.255 / 13.541 | 13.144 | 13.144 | 13.255 | 0.111 | 13.477 | **13.5** |
| Swap frame p95, 100 nodes created | 14.730 / 16.568 / 16.577 / 16.699 / 19.442 | 16.568 | 16.577 | 16.699 | 0.131 | 16.970 | **17.0** |
| Swap frame p99, 100 nodes created | 16.615 / 20.404 / 24.607 / 25.918 / 60.024 | 20.404 | 24.607 | 25.918 | 5.514 | 41.149 | 41.5 |
| Idle frame p99 | 14.854 / 15.169 / 15.213 / 15.509 / 15.604 | 15.169 | 15.213 | 15.509 | 0.340 | 16.233 | **16.5** |
| Swap frames of 100 ms or more, per run | 0 / 0 / 0 / 0 / 0 | 0 | 0 | 0 | 0 | 0 | **0** |
| Idle intervals of 100 ms or more, per run | 0 / 0 / 0 / 0 / 0 | 0 | 0 | 0 | 0 | 0 | **0** |
| Swap frame p50, all swaps (reference) | 10.410 / 10.502 / 10.596 / 10.625 / 10.673 | 10.502 | 10.596 | 10.625 | 0.123 | 10.965 | 11.0 |
| Swap frame p95, all swaps (the protocol's `budget-p95-context-switches`) | 14.217 / 14.497 / 14.835 / 14.875 / 15.928 | 14.497 | 14.835 | 14.875 | 0.378 | 15.969 | **16.0** |
| Swap frame p99, all swaps (reference) | 15.447 / 17.339 / 18.175 / 18.978 / 19.836 | 17.339 | 18.175 | 18.978 | 1.639 | 23.092 | 23.5 |
| AI phase p95 (the protocol's `budget-p95-ai-phase`) | 13.784 / 14.539 / 14.642 / 14.799 / 14.928 | 14.539 | 14.642 | 14.799 | 0.260 | 15.422 | **15.5** |
| End-of-turn p95 (the protocol's `budget-p95-event-burst`) | 14.677 / 14.715 / 14.847 / 14.868 / 14.952 | 14.715 | 14.847 | 14.868 | 0.153 | 15.306 | **15.5** |

**The load makes these numbers pessimistic.** The windowed lane ran with the Mac's one-minute load average at 5.4 to 6.8 on 11 logical cores (other agents' work), so a quiet machine may show smaller frame times and smaller IQRs, and the bounds above may be looser than they need to be. A user working on the machine is not in them either.
The freeze did not wait for a quiet machine: it took this execution by decision, and the corroboration of the night of 2026-10-09 (the same bundle on a machine at a load of 8.3 to 13.6, which was about 25% slower: the p95 of the swap frame over all swaps 18.8 to 20.4 ms against 14.2 to 15.9) shows that the baseline is sensitive to load, which is why the executions of the lowest load are the ones that count
([the freeze](frontier-freeze.md#four-observations-that-change-no-rule)).

## The retained sabotages

`node scripts/frontier-baseline-sabotage.mjs` breaks a source on purpose, runs the headless suite on it (`--sabotage=<name>`, which bundles the broken source) and requires both the probe's checks and the
oracle to reject the report. The sources are guarded (`scripts/sabotage-sources.mjs`): they come back byte for byte, proven by hash, whatever ends the run. The file of each variant's verdict is deleted before it
runs and a missing file counts as not rejected. A run that is cut short because a click did not show its panel fails every check that needs the whole tour, so the interesting column is the oracle's reason.

| Variant | What it breaks | Probe | Oracle |
| --- | --- | --- | --- |
| `leaky-panel` | keeps each panel it has shown mounted and makes the replaced ones invisible (`opacity` 0) | 9 checks (the run stops at the second swap: the old panel's nodes are still there) | "A click showed its panel: the run was not cut short" |
| `no-gc` | the sampler never asks for the forced collection of Hermes' heap | 1 check: the readings of the heap follow a forced collection | "base: Hermes' heap is read after a collection" |
| `world-leak` | the bar's buttons get `pointerEvents="none"`: the click goes to the map and no panel changes | 9 checks (the run stops at the first click, the map heard it) | "A click showed its panel: the run was not cut short" |
| `no-key` | the panel is rendered without its `key`, so React updates the old panel's nodes instead of mounting a new one | 1 check: creations and deletions | "swap 5 (research to units): the host created the 50 nodes of the new panel" |

`leaky-panel` first hid the old panel with `display: "none"` (each panel in a wrapper `View`) and was **not** rejected: all 18 checks passed. A panel hidden that way adds no node to the SceneTree, to the
host's counts or to the Surface (the wrapper itself adds no node, and the hidden subtree is not mounted), so the exact counts were right; it stayed in the JS tree and in Hermes' heap (3.4 MB at rest instead of
2.0), which was constant after the first round, so the growth check is rightly silent. The retained variant makes the replaced panel invisible with `opacity`, which keeps its nodes. (That `display: none` costs
the host no node is itself worth knowing for HUD panels that are hidden and not unmounted.) The slice has no previous-host control, because it changes no C++.

## What is left

- **`turno`** (V05-06): the lifecycle, the pause and the frame budget of a whole turn, on the Frontier game, are not measured here. This slice measures one swap.
- **`soak`** (V05-06): the 100-turn soak on the game and its lifecycle are not run. The 30 steady rounds here (360 swaps) are a soak of the swap, not of the game.
- **`congelado`** (V05-06): done on 2026-10-10. [The freeze](frontier-freeze.md) took the proposal above as its input and froze it, once, together with the five thresholds of the final comparison's protocol; what stays open is in [its note](frontier-freeze.md#what-is-still-open).

## Limitations and open

- One machine (an Apple M3 Pro), one display and one vsync mode (the default, enabled, read back); a frame time with the vsync disabled was not measured, so no FPS without a limit is claimed. The Mac was
  loaded (load average 4 to 8 on 11 logical cores) during every run, so the numbers are not a best case and a quieter machine may show smaller ones.
- **The frame time of a presented window (vsync on, 120 Hz) is pinned from one execution** (2026-10-09, `1bc3a3c`): five runs of one sitting of the lane (about four minutes) with nobody at the Mac and the machine loaded by other agents (load average 5.4 to 6.8 on 11 logical cores), so a user at work and a quiet machine are both missing; the budget rows derived from it
  were frozen from this execution on 2026-10-10, by the user's decision, with a corroboration of the night of 2026-10-09 beside them ([the freeze](frontier-freeze.md)), and a quiet machine may show smaller numbers. The attempts before it, which no display presented, and the earlier unpinned reference are history.
- Synthetic events through `Input.parse_input_event`; no hardware pointer or touch screen, no iPhone, no mobile export. The numbers are macOS, arm64, Compatibility renderer.
- The HUD is a fixture of the same shape as the Frontier panels, not the Frontier HUD (V05-05 is open). The panels are 50 to 100 native nodes of `View` and `Text`; panels with images, text inputs, scroll views,
  long text shaping or animations are not measured.
- Headless time is the CPU cost of an unpaced loop, and the harness's own readings (the forced collection, the process listing for the resident memory) are outside the windows it reports but inside the process;
  Godot's static memory per round (the probe keeps 13 readings a round) is the probe's.
- Missed frames with the vsync on are not read (see the protocol). The frame times are of process frames, which at 120 Hz with the vsync on come in clusters.
- Hosted CI: the headless suite is in the native job of `contracts.yml`, and the push of #77 to main passed it and published Pages (the receipts [`hosted-ci.json`](../evidence/frontier-baseline/hosted-ci.json) and [`publication.json`](../evidence/frontier-baseline/publication.json) of the evidence record); the windowed lane is local and never runs there. A hosted runner will show other times; only the exact checks are asked of it.
- The previous-host control does not apply: nothing in C++ changed, so there is no host to compare it with. The four retained sabotages are the control.
- The docs of compatibility (`docs/compatibility/react-native-0.87.1.json`, `BASELINE.md`), `docs/API.md` and `docs/NATIVE_MODULES.md` do not apply: the slice adds no RN name, public API or native module.

## Reproducing

```sh
npm run test:frontier-baseline                       # the probe in two processes, the exact counts, the oracle and the report-level negatives
node scripts/frontier-baseline-sabotage.mjs          # the four retained sabotages, source restored byte for byte; run nothing else meanwhile
node tests/frontier-baseline-native.test.mjs --replay=build/frontier-baseline-current-report.json   # judge a recorded report
caffeinate -d node scripts/frontier-baseline-graphics.mjs   # local only, needs an awake and unlocked display: five windowed runs, the receipt and a capture per panel; exit 3 if not presented
node scripts/frontier-freeze.mjs --check                   # the frozen budget and thresholds, recomputed from the committed inputs (node --test tests/frontier-freeze.test.mjs)
```
