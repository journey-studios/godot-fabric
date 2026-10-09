# The CPU-time instrument of the final comparison: the choice and its self-check

Status: executed isolated macOS validation (arm64) against official Godot 4.7.2, headless for the exact checks and in a real window (local, not in CI) for the render term.
This is the `execucao` criterion's preparation in the 0.5 Frontier milestone's V05-10: the one instrument that reads the CPU time of the main thread for each process frame in the three arms
of [the comparison](frontier-comparison-protocol.md), chosen and checked against a synthetic load of known duration **before** any comparative measurement. It changes no C++ and runs no game.
"CPU time" is the protocol's name for the quantity; what the instrument measures is the **monotonic elapsed time between the engine's hooks on the main thread**, not the thread's CPU clock from the
operating system, so a scheduling pause inside the hooks raises the total without raising the thread's CPU use (see [the instrument](#the-instrument)).
**The threshold `cpu-time-instrument` stays unfrozen** (`frozenValue: null`; the freeze is a later, single act together with the other numbers): this note delivers the instrument, its
verification and a written recommendation of what to freeze. The comparison's `execucao` criterion stays open, and so do `protocolo`, `braco-b` and the others. The [evidence record](../evidence/cpu-time-instrument/README.md)
pins the executions to the commit `e38615d`.

## The question

The comparison's primary outcome is the **CPU time per frame, 95th percentile, within each active window**, "read by one instrument that is the same in the three arms, and never the interval between
frames" (the protocol). Arms A (no HUD) and B (a Godot HUD) have no Fabric host, so the host's own `pump` accounting is out. The threshold `cpu-time-instrument` asks for one engine-side reading of the
main thread's CPU time for the frame, from the same code in the three arms, that excludes the wait for the display, checked within 10% against a synthetic load of known duration. Godot offers four
candidate readings, and none of them is what its name suggests, so this note starts by reading what each one measures, at the source and in the binary.

## What the engine offers

Read from the tag `4.7.2-stable` (the commit `ed1daf0bf` of the official binary) and observed in the binary. Lines are of that tag.

| Reading | What it measures | Which frame it describes | Wait for the display |
| --- | --- | --- | --- |
| `Performance.get_monitor(TIME_PROCESS)` | the **largest** over the frames of the last second of the time from before `MainLoop::process` to after `RenderingServer::draw` (`main/main.cpp` 5059-5100; `main/performance.cpp` 245-246) | **one value a second**: it is assigned when the accumulated frame time passes one second, then the maximum is cleared (`main/main.cpp` 4951, 5121, 5136); it describes the second before | **in it**, with the vsync on: the draw ends at the swap |
| `Performance.get_monitor(TIME_PHYSICS_PROCESS)` | the largest of the time of a physics iteration (`main/main.cpp` 5049-5050) | the same one-a-second assignment (5137) | not a draw, so none |
| `RenderingServer.viewport_get_measured_render_time_cpu(vp)`, after `viewport_set_measure_render_time(vp, true)` | the difference of two `Time.get_ticks_usec` stamps the renderer takes when the viewport's render starts and ends (`servers/rendering/renderer_viewport.cpp` 339-343, 760-764, 1578-1583), in ms | **a draw several frames earlier**: the Compatibility renderer keeps its timestamps in a ring of three frames (`drivers/gles3/storage/utilities.h` 184; `utilities.cpp` 343-363) and the draw hands them to the viewport at its tail (`servers/rendering/rendering_server_default.cpp` 136-153, `renderer_viewport.cpp` 1697-1717). **Measured: 6 draws** | **out of it**: the end stamp is before the blit and the swap (`renderer_viewport.cpp` 980-984; `drivers/gles3/rasterizer_gles3.cpp` 124-126) |
| `RenderingServer.get_frame_setup_time_cpu()` | the scene and canvas updates before the viewports render (`rendering_server_default.cpp` 96-100, 232-234), in ms | the last completed draw: read when `frame_post_draw` fires (229) it is the frame's own | out of it |
| `Time.get_ticks_usec()` | the monotonic clock in microseconds (`core/os/time.cpp` 388-390; `mach_absolute_time` on macOS, `drivers/unix/os_unix.cpp` 391-404): elapsed time, **not the thread's CPU time** | the instant it is called | depends on where it is called |

Three things follow, and the instrument is built on them.

- **`TIME_PROCESS` cannot be the per-frame reading.** It changes once a second and holds a maximum, so as a sample of a frame it is a staircase (the headless report of the suite has 20 changes in
  2,422 frames, and the engine cross-check below keeps that honest). And it counts the draw, whose last act on macOS is `[context flushBuffer]` (`platform/macos/gl_manager_macos_legacy.mm` 140-143;
  the swap interval is set at 165-171): with the vsync on, the call blocks until the display takes the image. In the windowed run of this slice an idle window had **a median `TIME_PROCESS` of 15 ms
  while the CPU time of its frames, read by the instrument, was 0.08 ms**. The spec expected a per-frame `TIME_PROCESS`; the source and the binary say otherwise (see
  [Departures from the spec](#departures-from-the-spec)).
- **The pieces that are per frame are the ones the engine's hooks delimit.** `SceneTree.process_frame` is emitted at the start of the process step (`scene/main/scene_tree.cpp` 713), after
  `MainLoop::process` (700) and before the deferred calls are flushed (715) and the nodes' `_process` run (719). `RenderingServer.frame_pre_draw` is emitted when the draw starts
  (`rendering_server_default.cpp` 443-446), after the nodes' `_process`, the timers, and `message_queue->flush()` (`main/main.cpp` 5065) have run: layout and redraw requests, which a node queues
  with `call_deferred`, are inside the interval. (Measured in the window run: showing a canvas item of 30,000 rectangles costs a median 3.11 ms between the two signals, of which 0.0095 ms
  is up to the last node's `_process`: the rest is the redraw the item queued.) `frame_post_draw`
  is emitted at the end of the draw (229). `SceneTree.physics_frame` opens a physics step (`scene_tree.cpp` 649).
- **A headless run does not draw.** `wants_present` is false without a window that can draw (`main/main.cpp` 5080-5094), so `frame_pre_draw` never fires (the oracle requires that a headless report has no draw in its 2,422 frames) and the
  render terms do not exist. The loop is paced by a sleep, not by a display: `OS::add_frame_delay` waits until the next 6.9 ms mark when the window cannot draw (`core/os/os.cpp` 708-741), so
  a headless interval is `max(6.9 ms, the frame's work)` and a 2 ms or a 5 ms load **does not show in it at all** (the interval reads 6.87 ms in the first idle block and 6.89 and 6.90 in the 2 and 5 ms blocks).

## The instrument

[`tests/cpu-time-instrument.gd`](../../tests/cpu-time-instrument.gd) is a `Node` that depends on neither React Native nor the Fabric host, so the same file serves the three arms. `begin(tree)` connects
four signals and adds the node as the last processor of the tree (`process_priority` and `process_physics_priority` at their maximum); `samples()` returns the columns at the end. It takes a
`Time.get_ticks_usec` stamp at each hook and adds up the terms that **end before the frame is presented**. For one process frame, in milliseconds:

```
physics_ms = the scripted physics steps of the iteration: physics_frame to the last _physics_process (0 when it has no step)
process_ms = process_frame to frame_pre_draw          (a frame that does not draw: process_frame to the last _process)
setup_ms   = RenderingServer.get_frame_setup_time_cpu() of the frame's draw, read at frame_post_draw   (0 when it does not draw)
render_ms  = viewport_get_measured_render_time_cpu() of the measured viewports for the frame's draw     (0 when it does not draw)
total_ms   = physics_ms + process_ms + setup_ms + render_ms
```

**Headless.** Nothing draws, so `setup_ms` and `render_ms` are 0 and the total is `physics_ms + process_ms`: the process step as the engine runs it without a window, ending at the last node's `_process`
(the deferred calls that the engine flushes after it are outside, since no `frame_pre_draw` marks their end). The headless lane checks the instrument's process step and the physics span only; the render term has
its own check in a window.

**Which terms exclude the wait for the display, and how:** all four, by construction. `process_ms` stops at `frame_pre_draw`, before `RenderingServer.draw` begins; `setup_ms` is the time of two updates
before the viewports render; `render_ms` ends with the viewport's last stamp, before the blit and the swap. No term spans `end_frame` and the swap, which is where the display blocks. The
interval between frames, `interval_ms`, and the engine's monitor, `monitor_ms`, are recorded in every sample to show that they are other quantities and enter no total.

**Alignment.** `setup_ms` and the process terms are the frame's own. The render reading is not: the value read at the `frame_post_draw` of draw `d` is the render time of draw `d - 6`. The instrument
records every reading with the index of the draw it was taken at (`Engine.get_frames_drawn()`, which is the draw's index at both signals, since it is incremented after the draw) and, when it builds the
samples at the end of the run, gives the frame whose draw was `d` the reading taken at draw `d + RENDER_READING_LAG_DRAWS`. The last six drawn frames of a run have no reading yet (`renderKnown` 0) and
are not samples; a run keeps going for a few frames after the window it wants (the probe's drain), and windows are cut from the columns by process frame number once the run is over. The constant is
not taken on trust: every windowed run of the probe lands a render pulse at known draws and the oracle refuses a run in which the strongest lag is not 6.

**What is not in the total**, and why that is acceptable: the work of `MainLoop::process` before the signal and the stamps' own cost (about ten microseconds; the floor shows in the idle total), the
physics server's own step (outside the scripted physics span), `begin_frame`, the blits, `end_frame` apart from the swap, the post-draw callbacks, the script and extension `frame()` hooks, the audio
update and the frame delay. The comparison reads the same estimator in the three arms, which are biased by the same amount, and the protocol compares them with each other.

**It reads elapsed time, not on-CPU time.** The clock is monotonic and not the thread's CPU clock, which Godot does not expose to scripts: a thread that the system descheduled between two stamps counts
that time. The protocol's load rule (a 1-minute load average above 2.0 redoes the execution) is what keeps that out of the comparison, and the self-check below was run on a loaded Mac.

## The self-check

[`tests/cpu-time-instrument-probe.gd`](../../tests/cpu-time-instrument-probe.gd) runs the instrument in a lab scene of its own, an empty tree with one node that burns a time in each frame and, in a
window, one canvas item that costs the renderer something. The schedule is a list of blocks of process frames; the first 10 of a block are settle frames, recorded and not judged:

| Block | Frames | What happens |
| --- | ---: | --- |
| `warmup` | 120 | nothing |
| `idle-0` | 600 | nothing: the idle window the pacing is judged on |
| `load-T`, T = 2, 5, 10, 20 ms | 200 each | a busy loop of T ms, timed with `Time.get_ticks_usec`, in every frame; an `idle` block of 200 follows each |
| `render-pulse` (a window only) | 264 | 30,000 rectangles shown for one frame in 11, at known draws |
| `drain` | 12 | nothing, so that the last readings arrive |

**The rules**, each judged by the probe from the instrument's samples and again, from the raw stamps and readings, by the independent oracle
([`tests/cpu-time-instrument-oracle.mjs`](../../tests/cpu-time-instrument-oracle.mjs)):

- **Accuracy (the 10% rule).** `base` is the median of `total_ms` over the measured frames of every idle block (the median of an even count is the mean of the two middle values). For each target T:
  `| median(total_ms over the measured frames of load-T) - base - T | <= 0.1 T`. The field truth is the length of the loop as `Time.get_ticks_usec` measured it in every frame, whose median must be T to
  within 1%.
- **CPU time and not the interval.** The idle total is a small part of the idle interval: its median is at most 25% and its 95th percentile at most 50% of the idle interval reference, the median of the
  half-sums of consecutive pairs of the first 600 idle intervals (the baseline's `idleReference`, imported from `tests/frontier-baseline-oracle.mjs`). With the vsync on at 120 Hz that reference is
  near 8.3 ms and the idle CPU time is a hundredth of it. And in each load block the process term takes at least 8 values and repeats at most 10 frames in a row, which a clock does and a monitor
  refreshed once a second does not.
- **The arithmetic.** The terms of every frame are recomputed from the raw stamps and readings, and the oracle refuses a term that is not what the stamps give (the instrument reads its clock at the
  hooks and adds as above); a scheduled frame without a sample is refused.
- **The engine's own number (headless).** `TIME_PROCESS` counts from before the process step to after the draw, so between two of its changes it is never under the instrument's largest process term of
  the frames that the window holds (from the first change to the frame before the second), and it is a little over it. The oracle checks both: never under, and 0.5 ms over at most at the median.
  A busy loop that ran outside the instrument's frame is seen by the engine and not by the instrument, and this check names it too.
- **The render term (a window).** A render pulse lands at known draws; the strongest gain of the reading over the others has to be at lag 6, at least 0.3 ms, and no other lag may reach a quarter of it.
  This shows that the term answers a render load and that the alignment above is right. The draw has to run on the main thread (the project's thread model is not the separate render thread, default
  `RENDER_THREAD_SAFE`, `main/main.cpp` 2776).
- **A window that no display presented is not a measurement.** The run is judged only if the window drew nine in ten of its idle frames and the baseline's idle reference of its intervals is at least
  half of the refresh period read back (4.17 ms at 120 Hz); otherwise it is "not presented", with the reason, nothing but the structure and the arithmetic is judged, and the lane exits with 3
  (`scripts/cpu-time-instrument-graphics.mjs`), as the other windowed lanes do.

[`tests/cpu-time-instrument.test.mjs`](../../tests/cpu-time-instrument.test.mjs) (in `test:contracts`, Node only) runs the oracle over reports made from the contract, accepts the headless and the presented
windowed ones and refuses the mutations (a load 15% off in each of the four targets, the interval or the monitor for the CPU time, a load outside the frame, a missing sample, a duplicated frame, a
changed experiment, an unpaced or undrawn window, a wrong render lag, a render thread), and it keeps the oracle's constants equal to the probe's and the instrument's. The headless suite,
`npm run test:cpu-time-instrument` (the `native-suites-frontier` job of the manual dispatch), runs the probe once in Godot and the oracle over its report, and applies four
mutations to the recorded stamps. The windowed lane is local: `caffeinate -d node scripts/cpu-time-instrument-graphics.mjs` (`npm run bench:cpu-time-instrument-graphics`).

## What the runs showed

The executions of 2026-10-09 on the commit `e38615d`, which [the evidence record](../evidence/cpu-time-instrument/README.md) pins, on an Apple M3 Pro (macOS 26.6.2, arm64) with the Compatibility renderer, a `Color LCD` display at 120 Hz and the vsync read back
as enabled, while other agents' work loaded the machine (the 1-minute load average stood between 5.5 and 9.9 around the runs). The numbers move with the state of the machine by a few microseconds in the idle floor and not in the ratios.

The reading against the busy loop, `total_ms` minus the idle median, in milliseconds (the idle median is the base: 0.014 ms headless and 0.082 ms in the window):

| Target | Headless: read | error | Window: read | error |
| ---: | ---: | ---: | ---: | ---: |
| 2 ms | 2.000 | 0.00% | 2.030 | +1.50% |
| 5 ms | 4.992 | -0.16% | 5.004 | +0.08% |
| 10 ms | 9.993 | -0.07% | 10.015 | +0.15% |
| 20 ms | 19.995 | -0.02% | 20.044 | +0.22% |

The same blocks through the other quantities (medians of the measured frames, ms; the window is the lane's single run):

| Block | Headless interval | Headless `TIME_PROCESS` | Headless total | Window interval | Window `TIME_PROCESS` | Window total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| idle-0 | 6.872 | 0.288 | 0.018 | 9.378 | 15.325 | 0.083 |
| load-2 | 6.892 | 0.221 | 2.014 | 11.040 | 16.802 | 2.112 |
| load-5 | 6.899 | 0.570 | 5.006 | 5.896 | 14.647 | 5.086 |
| load-10 | 10.019 | 10.041 | 10.007 | 10.785 | 15.425 | 10.097 |
| load-20 | 20.026 | 20.075 | 20.009 | 20.864 | 21.018 | 20.126 |

What it shows, and no more: the interval does not see a 2 or 5 ms load headless (the loop's sleep hides it) and in a window it is the clusters of the display (the idle blocks, with the same idle work, have medians from 5.0 to 9.4 ms);
`TIME_PROCESS` is a second behind (a load block starts with the previous block's maximum: 0.22 ms in the 2 ms block, 10.04 ms in the idle block after the 10 ms one) and in a window is 14 to 16 ms for an idle frame because it holds the swap;
the instrument reads the load. The idle reference of the window's idle intervals was 8.34 ms against a refresh period of 8.33 ms, 600 of 600 idle frames drew, and the render pulse landed at lag 6 with a gain of 1.07 ms and at most 0.012 ms
at every other lag. The headless engine cross-check had 20 changes of `TIME_PROCESS` (19 windows between them), none under the instrument's largest process term, and the engine's number was 0.015 ms over it at the median. The
window's 1.5% on the 2 ms load is mostly the floor: the window's idle total is 0.082 ms, 4% of 2 ms.

## The retained sabotages

`node scripts/cpu-time-instrument-sabotage.mjs` breaks a source on purpose, runs the headless suite on it (`--sabotage=<name>`) and requires both the probe's checks and the oracle to reject the report. The
sources are guarded (`scripts/sabotage-sources.mjs`): they come back byte for byte, proven by hash, whatever ends the run. The file of each variant's verdict is deleted before it runs and a missing
file counts as not rejected. Do not run another suite in the worktree meanwhile.

| Variant | What it breaks | Probe | Oracle's first reason |
| --- | --- | --- | --- |
| `reads-interval` | the process term is the interval between frames | the four accuracy rules and the CPU rule | the idle total is a small part of the idle interval: the instrument reads CPU time and not the interval |
| `load-outside-frame` | the busy loop runs from a `process_frame` handler connected before the instrument's, so it ends before the clock starts | the four accuracy rules and the rule that the term changes from frame to frame | the median total minus the idle median is within 10% of the 2 ms load: it read about zero |
| `reads-monitor` | the process term is `Performance.TIME_PROCESS` | the four accuracy rules, the CPU rule and the rule that the term changes from frame to frame | the idle total is a small part of the idle interval (a second's largest idle frame) |

The oracle also names, for each variant, every rule that it breaks (the load outside the frame is also the engine's, and not the instrument's: the cross-check puts the engine's number about 10 ms over it). The slice has no previous-host control because it changes no C++ and its subject, the instrument, runs without the host.

## What `cpu-time-instrument` should freeze

For the single act that freezes the thresholds; the protocol's JSON is not changed here.

1. **The quantity:** `total_ms = physics_ms + process_ms + setup_ms + render_ms` of the formula above, per process frame, in milliseconds; the percentile and the windows are the protocol's.
2. **The reading:** `Time.get_ticks_usec` at `SceneTree.process_frame`, `RenderingServer.frame_pre_draw` (the last `_process` when the frame does not draw), `SceneTree.physics_frame` and the last
   `_physics_process`; `RenderingServer.get_frame_setup_time_cpu()` and `viewport_get_measured_render_time_cpu()` read at `frame_post_draw`, with the render measure on for the main window's viewport. **Not**
   `Performance.TIME_PROCESS` or `TIME_PHYSICS_PROCESS`, which are a once-a-second maximum and, for `TIME_PROCESS`, with the vsync on, hold the wait for the display; `TIME_PROCESS` stays in the samples as a cross-check.
3. **The alignment:** the render reading of a draw is the one taken 6 draws later (Compatibility renderer, 4.7.2, macOS), joined by draw index when the run is over; the harness keeps 6 draws after the
   last window it needs, and the lag is checked by the render pulse every time the lab probe runs.
4. **The error observed against a load of known duration:** at most 0.16% at 2, 5, 10 and 20 ms headless and at most 1.5% in a presented window (the 2 ms load; 0.22% or less in the others), against the 10% rule; the
   instrument's floor (the idle total) is about 0.014 ms headless and 0.082 ms in the window, which is the same in every arm.
5. **The self-check as a gate:** the protocol's `instrument` rule ("the self-check was not passed, or the reading changed after it") is operational as: `tests/cpu-time-instrument.gd` is byte-identical to the
   one the probe and the oracle passed (its hash goes in the provenance), and the probe and the oracle are rerun on the machine, the engine and the renderer of the campaign before it starts.

**What stays open:**

- **The render term on the arms' own scenes.** The window run proves it on a canvas item, six draws late, on this renderer and display; it has not read the Frontier game or either HUD, whose arms do not
  exist yet (`braco-b`, the instrument's wiring in A, B and C).
- **The lag is a property of the renderer, the platform and the engine version.** Another renderer (Forward+, Mobile), a Release export, or Godot mobile may take another number of draws or report none.
  The probe finds out on the machine of the campaign; nothing here says it holds elsewhere.
- **The iPhone,** which depends on the GO or NO-GO of V05-09: `Time.get_ticks_usec` is `mach_absolute_time` there too, but no render reading, thread model or display pacing of a device was read.
- **The vsync disabled lane** (`unlimited`): the swap does not block then, so the exclusion is trivial, but it was not run.
- **A render thread.** With `rendering/driver/threads/thread_model` set to the separate render thread the draw is not the main thread's, and the oracle refuses the run; what the main thread's
  frame is then was not studied.
- **Elapsed time, not on-CPU time,** and the parts of the iteration outside the four terms, as written above. A literal thread CPU-time counter would need the host's C++, which two arms do not have.
- **Missed frames with the vsync on** stay open, as in the protocol.

## Departures from the spec

- **The per-frame sample of the process step is not `TIME_PROCESS`.** The spec assumed a per-frame monitor; at the source and in the binary it is a one-a-second maximum that includes the wait for the display,
  so the instrument stamps the clock at the engine's hooks instead and records `TIME_PROCESS` only as a cross-check (`TIME_PHYSICS_PROCESS` follows the same one-a-second rule and is not recorded). The
  structure the spec fixed (a sample per frame with the frame number, the process term, the physics term, the render term, the setup term, a defined total and the interval as a record) is kept.
- The windowed lane's runner is a script of its own, `scripts/cpu-time-instrument-graphics.mjs`, outside the spec's list of areas, as the other windowed lanes have theirs, so that `node --test` never
  opens a window.

## Reproducing

```sh
npm run test:cpu-time-instrument                        # the probe headless, the oracle, the report-level mutations; node --test tests/cpu-time-instrument.test.mjs is the Node-only part
node scripts/cpu-time-instrument-sabotage.mjs           # the three retained sabotages, sources restored byte for byte; run nothing else meanwhile
node tests/cpu-time-instrument-native.test.mjs --replay=build/cpu-time-instrument-current-report.json   # judge a recorded headless report with the oracle
node scripts/cpu-time-instrument-graphics.mjs --replay=<windowed report>   # judge a recorded windowed report without a window; exit 3 if it was not presented
caffeinate -d node scripts/cpu-time-instrument-graphics.mjs   # local only, needs an awake display: one windowed run, the receipt in build/; exit 3 if not presented
```
