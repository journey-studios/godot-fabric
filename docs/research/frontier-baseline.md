# The Frontier HUD's performance baseline: what a panel swap costs on macOS

Status: executed isolated macOS validation (arm64) against pinned RN 0.87.1, Hermes 250829098.0.17 and official Godot 4.7.2,
headless for the exact counts and in a real window (local, not in CI) for the frame time. This is the `baseline` criterion of the
0.5 Frontier milestone's V05-06: a baseline on the pointer spike's scene, with 50 to 100 native nodes per panel swap, extending the
GF-30 harness, with a **proposed** budget recorded and not frozen. The `turno`, `soak` and `congelado` criteria of V05-06 are open
(see [What is left](#what-is-left)). The slice changes no C++, so there is no preceding host to run it on; the control is the
four retained sabotages. Hosted CI and the Pages publication are pending.

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
- the live heap at rest does not grow past the GF-30 limit, `HEAP_STEADY_GROWTH_LIMIT_BYTES` = 2,048 bytes (imported), from the first five steady rounds to the last
  five ([The heap at rest](#the-heap-at-rest)).

The probe has 18 checks (and one that the report is saved). An [independent oracle](../../tests/frontier-baseline-oracle.mjs) derives the same from the raw report
(the sizes from the shapes, the swaps from the tour, the counts from the readings), recomputes the percentiles that are recorded from the raw samples with the GF-30
oracle's nearest rank, and checks the host's own series through that oracle's `verifyReading` (the 128-sample windows, the ordering of the percentiles, the
forced-collection mark). `--replay=<report>` judges a recorded report in Godot without the application, as GF-30's does. The suite changes a recorded report in eight ways
that the probe's replay and the oracle must both reject (a leaked node, a wrong count of deletions, a double press, a click the world heard, a panel without its last node, a heap
read without a collection, a heap that grew 3,000 bytes, a run cut short), in two that both must accept (a transient allocation of 2,056 bytes in the last round, and a rise of exactly
the limit), and damages it in eleven ways that the replay must refuse with status 2 and no script error.

### What is recorded and never judged

Everything that depends on the pace of the machine, with its provenance: the frames a click takes to show its panel (0, see below), the time of the injection and
flush, the time of the swap's frame, the pump and its JS, mount and layout phases from the host's section, the heap of a swap over the base and the resident
memory, Godot's static memory per round. The headless loop runs a frame about every 6.9 ms with nothing pacing it and draws nothing
([frame-clock.md](frame-clock.md)), so what it records of time is **the cost of the CPU work on an unpaced loop and is not a frame time**. The frame time
is measured only in the windowed lane.

## The headless baseline

One run of the suite (2026-10-08), on an Apple M3 Pro (11 logical cores, 18 GB) with macOS 26.6.2, arm64, Godot 4.7.2, Hermes 250829098.0.17, the headless display
server and the `opengl3` driver named. The Mac was not idle: the system load average was 6 to 8 on its 11 logical cores around the windowed runs, and other work
ran during the headless ones too, so the durations are a baseline of this machine as it was and not a best case. Per ordered pair of panels, the median (p50) and
the 95th percentile (p95) of the 30 steady swaps, for each of the two processes ("1 / 2"), and the host's accounting of process 1's median (milliseconds). "Click to
nodes" is the time from the start of the click's injection to the moment the SceneTree holds the new panel; the pump and its phases are the host's own accounting of
the pumps between the read before the click and the read two frames after the nodes exist.

| Swap | Created | Deleted | Click to nodes p50 (1 / 2) | p95 (1 / 2) | Pump p50 | JS p50 | Mount p50 | Layout p50 | Heap over base p50 (KB) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| empty to units | 50 | 0 | 9.0 / 6.6 | 12.5 / 10.3 | 8.8 | 5.9 | 2.3 | 0.59 | 245 |
| units to empty | 0 | 50 | 2.6 / 2.4 | 2.9 / 3.5 | 2.3 | 1.7 | 0.5 | 0.03 | 78 |
| empty to city | 75 | 0 | 9.7 / 9.4 | 11.9 / 17.6 | 9.6 | 5.8 | 2.7 | 0.68 | 318 |
| city to empty | 0 | 75 | 2.8 / 2.6 | 6.9 / 3.1 | 2.5 | 1.7 | 0.6 | 0.02 | 80 |
| empty to research | 100 | 0 | 11.2 / 9.8 | 13.5 / 16.6 | 11.1 | 6.7 | 3.3 | 0.78 | 395 |
| research to empty | 0 | 100 | 3.1 / 2.9 | 4.8 / 4.4 | 2.7 | 1.9 | 0.7 | 0.02 | 81 |
| units to city | 75 | 50 | 9.9 / 9.0 | 15.3 / 11.4 | 9.5 | 6.0 | 2.9 | 0.63 | 320 |
| city to units | 50 | 75 | 7.4 / 6.8 | 20.0 / 9.0 | 7.1 | 4.4 | 2.1 | 0.42 | 243 |
| units to research | 100 | 50 | 12.2 / 11.2 | 17.7 / 18.3 | 12.0 | 7.4 | 3.7 | 0.73 | 397 |
| research to units | 50 | 100 | 7.7 / 6.8 | 8.8 / 9.9 | 7.3 | 4.4 | 2.2 | 0.44 | 242 |
| city to research | 100 | 75 | 11.3 / 11.2 | 12.9 / 15.4 | 11.0 | 6.8 | 3.5 | 0.69 | 397 |
| research to city | 75 | 100 | 10.0 / 9.0 | 16.4 / 11.6 | 9.6 | 5.8 | 3.1 | 0.59 | 320 |

The p95 of 30 samples is the 29th, so it moves with one slow swap (city to units was 20.0 in process 1 and 9.0 in process 2). The two processes also differ at the median by up
to 2.4 ms (empty to units, 9.0 and 6.6), which is the machine's load and not the code: the exact counts below are the same in both, the durations are not. What the table says:

- **The panel is there when the click returns.** The host mounts the new panel inside the flush that delivers the click (the pointer event, React's update, the commit
  and the mount all run in it), so the SceneTree holds the new nodes the moment `Input.flush_buffered_events()` returns: **0 frames** after the flush, in every one of
  the 2,520 steady swaps of the two headless processes and the five windowed runs. "Click to panel in process frames" is 0 here, and its time is the time of that call.
- **The cost follows the nodes the swap creates**, and deleting is cheap: a swap that only deletes 50 to 100 nodes takes 2.4 to 3.1 ms at the median, and one that creates 50, 75 or 100
  takes 6.6 to 9.0, 9.0 to 10.0 and 9.8 to 12.2 ms at the median, by pair (over all the swaps that create that many: 7.8 and 6.8, 10.0 and 9.1, 11.7 and 11.0 ms in process 1 and 2; roughly
  0.08 ms for each node created over a floor of about 3 ms). Of the 8.8 ms of process 1's 50-node create, 5.9 are JavaScript (React's render and commit), 2.3 are the host's
  mounting of the nodes and 0.59 are Yoga's layout.
- **A swap that creates 100 nodes costs more than one 120 Hz period** (8.33 ms) and fits in one 60 Hz period (16.7 ms) at the median; one that creates 50 is around the 120 Hz
  period at the median (6.8 to 9.0 ms) and over it at the 95th percentile.
- **A mounted panel holds heap and gives it back.** While it is shown, Hermes' live heap is 245, 318 and 395 KB over the base (identical in both processes). Once the panel is
  gone it is 78 to 81 KB over the base right after the swap and about 70 KB at rest (2,032,000 bytes against the base's 1,960,448, which the first mounts raised), a floor that
  does not grow with the rounds ([The heap at rest](#the-heap-at-rest)).
- **The host's own window** of the last 128 pumps of process 1 (percentiles recomputed from the samples by the GF-30 oracle): pump p50 0.02 ms, p95 0.47, p99 11.0, maximum 34.7;
  mount p50 2.7 ms; layout p50 0.59 ms. Most pumps are idle ones; the swaps are in the tail.
- The resident memory of the process moved between 127 and 191 MB in the run and Godot's static memory grew 369 KB a round, which is the probe keeping its own 13 readings a round.
  Both are recorded and not judged.

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
7. **No outlier is discarded.** The warm-up is the only rule that leaves swaps out, and one rule leaves a whole run out: **a window the system does not draw** (covered by
   other windows, the display asleep) still runs process frames, but they are not the frames of a displayed application. A run counts only if a frame was drawn after every
   steady click and in at least nine of ten frames of the idle window; otherwise it is kept in the receipt (`rejectedAttempts`, with its raw intervals), flagged, and repeated, at most
   three times for each of the five. Every interval of every accepted run is in the receipt (`raw`), so anyone can apply another rule to the same data. An outlier run
   stays in and shows in the range. (An earlier execution of this code had a run in which the window drew after 16 of 360 steady clicks, which is why the rule is written;
   all five runs of the execution below drew throughout, and none was repeated.)
8. **The map's own pointer events**: a window on a display also gets the motion of the real pointer, which is the map's whenever it is over the map, so the windowed
   probe judges the presses, releases and touches that reach the world (none may) and records the other events. The five runs below had none. (An earlier execution had two swaps
   with two motion events each.)

An interval is of **process frames**, which is what the game's `_process` sees. With the vsync on, the engine runs ahead of the display and blocks on it, and the frames come
in clusters (the frame-clock note measured about 3 ms and 13 ms apart at 120 Hz on this display), so an interval longer than the refresh period is **not** an image the display
showed twice: no "missed frame" is read from these intervals, and the ROADMAP's missed frames with the vsync on stay open, since they need presentation timestamps that Godot does not
give. The receipt counts, as the final comparison V05-10 asks, the frames above twice the idle median and above 100 ms.

### The windowed baseline

One execution (2026-10-08): an Apple M3 Pro (Mac15,6, 11 logical cores, 18 GB), macOS 26.6.2 (25G83), the built-in display ("Color LCD", 1512 x 982 points, 3024 x 1964 pixels,
120 Hz, scale 2), an 800 x 600 window, Godot 4.7.2 on `gl_compatibility` (adapter "Apple M3 Pro"), **vsync `enabled` and refresh rate 120.0 read back from the window**,
`Engine.max_fps` 0. The load average (1 minute) was 6.60, 6.09, 5.73, 6.04 and 6.02 before the five runs and 7.71 after the last: the Mac was running other work, on 11 logical cores.
Milliseconds, per run, from the raw intervals:

| Run | Idle p50 | Idle p95 | Idle p99 | Idle max | Swap frame p50 | p95 | p99 | max | Swap frames above 2x the idle median | Injection p50 / p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 7.8 | 13.7 | 13.9 | 15.9 | 12.2 | 17.6 | 23.6 | 36.0 | 44 / 360 | 7.6 / 11.6 |
| 2 | 7.8 | 13.7 | 14.0 | 14.4 | 12.2 | 17.9 | 22.7 | 47.9 | 41 / 360 | 7.6 / 11.4 |
| 3 | 7.8 | 12.1 | 13.1 | 18.0 | 12.2 | 19.0 | 28.3 | 46.1 | 70 / 360 | 7.5 / 12.6 |
| 4 | 7.9 | 12.2 | 13.4 | 25.0 | 12.1 | 18.6 | 25.5 | 38.6 | 63 / 360 | 7.5 / 11.8 |
| 5 | 8.4 | 12.4 | 12.7 | 15.7 | 11.7 | 19.0 | 30.9 | 48.9 | 42 / 360 | 7.5 / 12.5 |

Across the five runs (the median, the first to the third quartile, the IQR, and the range):

| Statistic (ms) | Median | Q1 to Q3 | IQR | Range |
| --- | ---: | ---: | ---: | ---: |
| Idle frame p50 | 7.8 | 7.8 to 7.9 | 0.1 | 7.8 to 8.4 |
| Idle frame p95 | 12.4 | 12.2 to 13.7 | 1.5 | 12.1 to 13.7 |
| Idle frame p99 | 13.4 | 13.1 to 13.9 | 0.8 | 12.7 to 14.0 |
| Idle frame max | 15.9 | 15.7 to 18.0 | 2.3 | 14.4 to 25.0 |
| Swap frame p50 | 12.2 | 12.1 to 12.2 | 0.0 | 11.7 to 12.2 |
| Swap frame p95 | 18.6 | 17.9 to 19.0 | 1.1 | 17.6 to 19.0 |
| Swap frame p99 | 25.5 | 23.6 to 28.3 | 4.7 | 22.7 to 30.9 |
| Swap frame max | 46.1 | 38.6 to 47.9 | 9.4 | 36.0 to 48.9 |
| Injection (the click's own work) p50 | 7.5 | 7.5 to 7.6 | 0.1 | 7.5 to 7.6 |
| Click to the first drawn frame p50 / p95 | 12.1 / 18.5 | 12.1 to 12.1 / 17.8 to 18.9 | 0.0 / 1.1 | 11.6 to 12.2 / 17.5 to 18.9 |

By the nodes the swap creates, the swap frame (the median across the runs of each run's p50 / p95, in milliseconds): 0 nodes (a swap to the base) 6.9 / 12.4, 50 nodes 9.6 / 15.6,
75 nodes 13.3 / 18.4, 100 nodes 15.3 / 20.4.

- **The swap is the frame that took the click.** Its p50 (12.2 ms, IQR 0.0) is the injection's own 7.5 ms plus the rest of the frame (the draw of the new nodes and the wait
  on the display); the first frame drawn after the nodes exist is that same frame (p50 12.1 ms). The idle frame is 7.8 ms at the median.
- **It costs frames at the tail.** 44 of 360 swap frames (runs 41 to 70) last more than twice the idle median (15.7 ms), against 1 of 600 idle frames (0 to 3 over the runs);
  none lasts 100 ms or more, in any run. The swap frame's p99 is 25.5 ms with an IQR of 4.7 ms (the worst four swaps of 360 move from run to run), and its maximum 36 to 49 ms.
- **The idle frame p95 of 12.4 ms is not a slow frame**: it is the 13 ms cluster of this display's frames at 120 Hz with the vsync on (the idle frame p99 is 13.4 ms, IQR 0.8).
- **A 100-node swap takes about two 120 Hz periods**: its frame p50 is 15.3 ms and p95 20.4 ms; a 50-node swap's is 9.6 and 15.6.
- At the start and the end of a run the live heap of Hermes was 1,960,448 and 2,043,480 bytes (read right after the last swap, not at rest) in all five runs, and the resident
  memory 248 to 264 MB at the start and 160 to 210 MB at the end: recorded, not judged.

The captures of each panel (`panel-empty`, `panel-units`, `panel-city` and `panel-research`, 800 x 600 PNGs written to `build/frontier-baseline-graphics/`, hashed in the receipt) are of the
frame as drawn, from a separate run that measures nothing, with pixel checks that the bar is over the map, each panel is where the HUD puts it, and the base comes back after them.

## The heap at rest

The live heap of Hermes at rest (the base shown, after a forced collection and 30 idle frames) was **2,032,000 bytes in the steady state in both processes**, which is 71,552 bytes over
the base's 1,960,448 that the first mounts raised and then never gave up. Two things were learned on the way, and the check has the shape they imply:

- **React lets go of a closed panel a few frames after the commit.** A reading taken right after a swap to the base, six quiet frames later, holds about 11 KB that the same reading
  30 idle frames later does not (the fibers of the unmounted panel, which React detaches in work it schedules after the commit). So "at rest" is read after `REST_FRAMES` = 30 idle frames,
  and the readings after a swap, which are recorded, are not at rest.
- **A reading can carry a transient allocation of 2,056 bytes**, in one to three consecutive rounds, always returning to the same floor (a series like `0 0 0 2056 2056 0 0` over
  the floor). It was seen in about two processes in five while the slice was built, and in both processes of the suite run above (one round above the floor in process 1, two in process 2, `highestAboveFloor` 2,056).
  It is 8 bytes more than the GF-30 limit of 2,048 and was not seen in GF-30's workloads (their one-off steps were 312 bytes). It adds and goes; a leak raises the floor. The check therefore compares **the
  lowest reading of the last five steady rounds with the lowest of the first five** (`HEAP_WINDOW_ROUNDS` = 5; a transient of up to three consecutive rounds leaves a window with the floor in it)
  against the GF-30 limit, which is inclusive. The strict form (the highest of the series over the first steady round, GF-30's) failed in 3 of the 8 processes run before the check was changed; the form
  "last minus first" would fail whenever the last round is a transient. A leak of `L` bytes a round raises the floor by `25 L` between the windows, so the check fails at `L` of 82 bytes or more per round
  (GF-30's fails at 129). The suite shows it with a recorded report whose last window is 3,000 bytes up, shows that exactly the limit passes, and shows that a single transient of 2,056 bytes in the last
  round passes. The oracle records `lastMinusFirst`, `highestAboveFloor` and `largestStep` as observations. This reads the criterion ("grows at most the GF-30 limit between the first steady cycle and the last") as
  a statement about the floor and not about two single readings; it is the one place where the slice's method is more than the plain reading of the spec, and it is reported as a deviation.

## The proposed budget

**PROPOSAL, not frozen.** The table has the values the baseline suggests and the rule that derived each, so that the freeze (criterion `congelado`, a separate and single act after this baseline and before
the first device session) can accept, tighten or drop each. None of it is a gate today except the rows marked **exact**, which the suite already judges. One rule for a windowed value: the **median across the
five runs of the statistic plus three times its interquartile range**, rounded up to 0.5 ms, so that a rerun of the same code on the same machine should fall inside it; a value that is
deterministic gets a factor of 1.25 as room for the HUD to grow.

| Metric (lane) | Baseline | Proposed bound | Rule |
| --- | --- | --- | --- |
| Native nodes after a swap (headless, **exact**) | the base's 12 plus 0, 50, 75 or 100 | exact | judged now: SceneTree, host and Surface |
| Nodes a swap creates and deletes (headless, **exact**) | the new panel's and the old one's | exact | judged now |
| A click swaps once, never reaches the map, a round ends at the base (headless, **exact**) | held in 720 headless and 1,800 windowed steady swaps | exact | judged now |
| Live heap at rest, first to last five steady rounds (headless, **exact**) | 0 bytes (2,032,000 in both processes) | at most 2,048 bytes | the GF-30 limit, imported and judged now |
| Frames from the click to the panel (both lanes) | 0 in 2,520 of 2,520 steady swaps | at most 1 | the maximum measured plus one frame for a commit that lands in the next pump |
| CPU time of the swap, the click's own injection and flush, p95, by nodes created (windowed) | 0 nodes 4.3 ms, 50 nodes 9.6, 75 nodes 12.2, 100 nodes 13.1 | 7.0, 12.0, 15.0 and 16.5 ms | median + 3 IQR of the run p95s (IQR 0.8, 0.8, 0.8, 1.1 ms); the 100-node bound is the 60 Hz period |
| Swap frame p95 (windowed, vsync on, 120 Hz) | 18.6 ms (IQR 1.1) | 22.0 ms | median + 3 IQR |
| Swap frame p99 (windowed, vsync on, 120 Hz) | 25.5 ms (IQR 4.7) | 40.0 ms | median + 3 IQR |
| Swap frames of 100 ms or more, per 360 swaps (windowed) | 0 in all five runs | 0 | no tolerance for a visible stall |
| Idle frame p99 (windowed, vsync on, 120 Hz) | 13.4 ms (IQR 0.8) | 16.0 ms | median + 3 IQR: an idle HUD costs no frame time |
| Heap a mounted panel holds over the base (headless, forced collection) | 249,024, 327,808 and 406,072 bytes for 50, 75 and 100 nodes (the same in both processes) | 320,000, 410,000 and 510,000 bytes | p50 x 1.25, up to 10,000 bytes |
| Resident memory and Godot's static memory per round (both) | RSS 127 to 191 MB headless; static 369 KB a round (the probe's own readings) | none | recorded: they move by tens of MB and by the probe's bookkeeping, and cannot be a limit |

The rule of the ROADMAP's final comparison (V05-10) holds for the frame time: **FPS without a limit counts only if the vsync mode read back is disabled**. With the vsync on, as in every run here, the outcome is
the **CPU time per frame** (the injection and flush, the pump and its phases, which the headless lane records exactly), and the frame times are read against the refresh period the display reports: 8.33 ms at the
120 Hz of this display. A 100-node swap's own work (11.0 ms at the median) is more than one such period, so today it cannot fit in a single 120 Hz frame on this machine, and a budget in frames at that rate
would fail it by construction; the freeze has to choose between a per-swap CPU bound (above), a bound in frames at a lower rate, or a change in what a swap creates (fewer or flatter nodes, a list that mounts
what is visible). Nothing here decides it.

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
- **`congelado`** (V05-06): the freeze of the thresholds. The proposal above is the input; the freeze is one act, later, by the principal.

## Limitations and open

- One machine (an Apple M3 Pro), one display and one vsync mode (the default, enabled, read back); a frame time with the vsync disabled was not measured, so no FPS without a limit is claimed. The Mac was
  loaded (load average 6 to 8 on 11 logical cores) during every run, so the numbers are not a best case and a quieter machine may show smaller ones.
- Synthetic events through `Input.parse_input_event`; no hardware pointer or touch screen, no iPhone, no mobile export. The numbers are macOS, arm64, Compatibility renderer.
- The HUD is a fixture of the same shape as the Frontier panels, not the Frontier HUD (V05-05 is open). The panels are 50 to 100 native nodes of `View` and `Text`; panels with images, text inputs, scroll views,
  long text shaping or animations are not measured.
- Headless time is the CPU cost of an unpaced loop, and the harness's own readings (the forced collection, the process listing for the resident memory) are outside the windows it reports but inside the process;
  Godot's static memory per round (the probe keeps 13 readings a round) is the probe's.
- Missed frames with the vsync on are not read (see the protocol). The frame times are of process frames, which at 120 Hz with the vsync on come in clusters.
- Hosted CI is pending: the headless suite is in the native job of `contracts.yml`; the windowed lane is local and never runs there. A hosted runner will show other times; only the exact checks are asked of it.
- The previous-host control does not apply: nothing in C++ changed, so there is no host to compare it with. The four retained sabotages are the control.
- The docs of compatibility (`docs/compatibility/react-native-0.87.1.json`, `BASELINE.md`), `docs/API.md` and `docs/NATIVE_MODULES.md` do not apply: the slice adds no RN name, public API or native module.

## Reproducing

```sh
npm run test:frontier-baseline                       # the probe in two processes, the exact counts, the oracle and the report-level negatives
node scripts/frontier-baseline-sabotage.mjs          # the four retained sabotages, source restored byte for byte; run nothing else meanwhile
node tests/frontier-baseline-native.test.mjs --replay=build/frontier-baseline-current-report.json   # judge a recorded report
node scripts/frontier-baseline-graphics.mjs          # local only: five windowed runs, the receipt and a capture per panel
```
