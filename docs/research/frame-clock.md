# Display-paced frame callbacks and native animation

Status: executed isolated macOS validation against pinned RN 0.87.1 and official
Godot 4.7.2. The [evidence](../evidence/frame-clock/README.md) owns the 37 headless
checks (29 cadence checks that need the clock and 8 that hold on every host) over eight
loop paces, none of which assumes what timing the machine delivers, the preceding-host
control (the same bundle fails exactly the 29 cadence checks), three retained sabotages (a
clock that always ticks, one that ticks for frames nothing consumes, one that times a
V-Synced window: each fails at least one check and the oracle rejects each), the independent
oracle that recomputes every decision of the clock from the Godot frame times the host
reports, and the C++ unit test over synthetic pacings. Timers are not quantized to ticks, a
presented frame carries the CPU time of its frame and not the display's regular timestamp,
and `ADAPTIVE` and `MAILBOX` V-Sync are covered only by the unit test. Hosted CI is pending.

## What RN does

RN never runs animation frames from a plain loop: each platform asks the display.

- **`requestAnimationFrame` is a platform timer.** The pinned C++ `TimerManager` creates
  it as a one-shot timer of 0 ms whose callback receives `performance.now()`
  (`ReactCommon/react/runtime/TimerManager.cpp`, lines 319-367; the comment at lines
  360-362 says it is the same as `setTimeout(0)`) and hands the timer to the platform. On
  iOS the bridgeless registry calls `createTimerForNextFrame:`
  (`ObjCTimerRegistry.mm`, lines 48-61): the timer is not invoked until the next frame,
  however expired it is, and a duration under 18 ms runs on every frame
  (`React/CoreModules/RCTTiming.mm`, lines 375-389). `RCTTiming` fires the due timers in
  `didUpdateFrame:` (lines 242-317), which `RCTDisplayLink` calls from a `CADisplayLink`
  (`React/Base/RCTDisplayLink.m`, lines 32 and 118-147) that stays paused while no
  observer has a timer pending (lines 149-163). On Android `JavaTimerManager` posts a
  `Choreographer.FrameCallback` and fires every due timer in `doFrame(frameTimeNanos)`;
  its `createTimer` documents the same contract (`JavaTimerManager.kt`, lines 33-35,
  173-189 and 285-315).
- **Native Animated has a choreographer.** The shared `AnimationBackend` asks its
  choreographer to `resume()` when its first callback starts and to `pause()` when the
  last one stops (`ReactCommon/react/renderer/animationbackend/AnimationBackend.cpp`,
  lines 136-165), and `onAnimationFrame(timestamp)` runs every callback once (lines
  119-134). The iOS choreographer is a `CADisplayLink` created on the first `resume()`
  and paused by `pause()`, and it passes the link's `targetTimestamp`, the time the frame
  is due on screen (`React/Fabric/RCTScheduler.mm`, lines 141-189). Android forwards the
  `Choreographer` frame time of its own callback (`FabricUIManagerBinding.cpp`, lines
  64-73).
- **What a display link guarantees.** Neither RN's sources nor this repo implement it; it
  is the contract of `CADisplayLink` and `Choreographer`: at most one callback per refresh
  period, and after a stall one callback, late, because the refreshes missed in between
  are dropped, never replayed. RN's drivers are written for that cadence. The decay driver
  (`ReactCommon/react/renderer/animated/drivers/DecayAnimationDriver.cpp`, lines 34-79)
  evaluates `from + v / (1 - d) * (1 - e^(-(1 - d) t))` at the time since its first frame
  and completes at the first frame whose step from the previous value is under 0.1,
  without writing that frame's value, so the node keeps the previous one. Where it lands
  therefore depends on how far apart its frames are. With a velocity of 0.5 and a
  deceleration of 0.99 the asymptote is 50, and frames 1 ms apart end at 40.006, 6.9 ms
  apart at 48.519, half a 60 Hz period (8.33 ms) apart at 48.824 and a whole period apart
  at 49.445. The JS driver (`Libraries/Animated/animations/DecayAnimation.js`, lines
  94-113) reads `Date.now()` and applies the value before it ends, which the clock does
  not change.

## What this host did

`ApplicationRuntime::pump` snapshotted the pending frame callbacks and called
`NativeAnimated::frame` once per Godot frame, whatever the pace of the loop. Godot's loop
has no display-link guarantee. Headless it runs a frame about every 6.9 ms; uncapped, with
nothing pacing it, it runs hundreds of frames a second (the receipt's `fast` lane sees
thousands in the time a decay runs); and after a long frame it delivers the next one right
behind it. That is what a hosted runner with a busy neighbour does: a stall of tens of
milliseconds, then frames 0.4 ms apart. The decay then ended at its first
near-duplicate step: on the preceding host (this Mac, headless) the same decay lands at
13.5 of 50 in the `fast` lane, 45.6 in the `bursts` lane and 48.5 headless, where a 60 Hz
pace lands at 49.4. Hosted CI showed the other side of it: near-duplicate frames stepping
an animation against a ramp (the note on commit
[`4d8312d`](https://github.com/journey-studios/godot-fabric/commit/4d8312d98766d8ca44b0020b24e6483e4f572f04)
in the singular transforms record), which that commit worked around in the oracle of two
lanes and this slice removes at the source.

## What Godot reports

Godot calls the application's `_process` once per rendered frame on the main thread,
which is also this host's JS thread, and what reaches the screen depends on the window.

- **Headless** has no display and no screens: `DisplayServer.screen_get_refresh_rate`
  returns -1 (a validation seam supplies one) and nothing presents or paces the frames.
- **A window with V-Sync** (the project default) blocks on the display when it presents,
  and the CPU runs ahead of it: the engine pipelines its frames. On this Mac (M3 Pro,
  120 Hz, Compatibility renderer, a headed scratch run of 720 frames, twice) the frames
  averaged 120 per second, in two clusters about 3 ms and 13 ms apart (minimum 1.1 and 1.2
  ms, median 8.3 ms, 90th percentile 13.0 and 13.3 ms, maximum 16.2 and 18.3 ms). A
  rule on the time between frames would drop images the display shows.
- **V-Sync off** runs as fast as the engine's sleep allows: 2,400 frames in 1.45 s, about
  1,657 per second, a gap of 0.53 ms at the median.
- `Engine.max_fps = 60` caps either of them: 60.0 frames per second with V-Sync on and with
  it off.
- `DisplayServer.screen_get_refresh_rate(screen)` reports 120.0 here and costs 0.35 µs a
  call, so the host reads it on every frame and follows the window between screens.
- `window_set_vsync_mode` with `ADAPTIVE` or `MAILBOX` reads back `ENABLED` on this
  renderer, so no window here runs in those modes: the unit test is the only place their
  mapping runs.

## The rule

The host has one display link, `FrameClock` in [`native/frame_clock.h`](../../native/frame_clock.h),
and it is the only place where cadence is decided. The runtime asks it once per Godot
frame, with the time of the frame, the refresh rate of the window's screen, the window's
pacing and whether anything consumes frames (pending frame callbacks, or a Native Animated
backend with an animation to run). Only a tick runs the frame callbacks and the animation
frame, both with the tick's timestamp. Timers, input, the host phase and the work queue
keep running on every Godot frame.

A frame is a tick only if a consumer exists, and then the way the window's frames reach
the screen (`Pacing`) decides:

- **Presentation** (a window on a real display that can draw, V-Sync enabled or adaptive):
  every frame with a consumer is a tick, however close it is to the one before. The engine
  blocks on the display and presents every process frame as one image, so the time between
  Godot frames says nothing here.
- **Time** (headless, V-Sync off or mailbox, a window that cannot draw, or unknown): with
  `T = 1000 / R` ms, where `R` is the refresh rate the display reports for the window's
  screen when it is positive and finite and 60 otherwise (Godot's own fallback, and the
  single-frame interval RN assumes), the frame at time `t` is a tick iff any of these holds:
  no tick has served a consumer yet; `t - (the previous Godot frame) >= T / 2`;
  `t - (the previous tick) >= T`. Every Godot frame is the previous frame of the next one,
  and only a tick is the previous tick.

`T / 2` is rounding to the nearest refresh period: the widest tolerance that never thins a
loop already paced at the refresh with jitter under `T / 2`. Under Time pacing, and only
there:

- two ticks are never closer than `T / 2`: a tick is itself a Godot frame, so the previous
  tick is at or before the previous frame;
- a loop capped at the refresh (`Engine.max_fps`) or slower ticks on every frame while its
  jitter stays under `T / 2`;
- a loop faster than `T / 2` ticks about once per `T`;
- a stall gives one late tick: the catch-up frames behind it are closer than `T / 2` to
  each other and to the tick;
- after idling, the first frame with a consumer ticks at once when it is due: when no tick
  has served a consumer yet, when it starts `T / 2` after the previous Godot frame, or when
  a period has passed since the last tick. On a loop faster than `T / 2`, a request within
  a period of the last tick waits out the period, as a display link would.

Time is for loops nothing paces. Given a presented loop it would thin the frames that reach
the screen: the same pipelined frames (alternating 13 and 3 ms) tick on every frame under
Presentation and on about half of them under Time, as the unit test proves deterministically
on that exact pattern and the receipt's two lanes show on a machine that delivers it, and
the retained `presentation` sabotage, a clock that times a presented window, fails the check
that says every presented frame ticks. Presentation has none of the guarantees above: its
ticks can be as close as the frames of the engine's pipeline.

A window that cannot draw (a minimized one, say) is not presented. Godot's main loop adds
`OS.low_processor_usage_mode_sleep_usec` to every frame while no window can draw, with V-Sync
or without it, so that sleep paces the frames and presentation paces nothing: the clock
treats such a window as Time (source `undrawable`, commit
[`e6d42a4`](https://github.com/journey-studios/godot-fabric/commit/e6d42a4efa8cb224c7db82a24625341eeb21f9e8)).
Godot 4.7.2 exposes `DisplayServer.window_can_draw(window_id)`, which the host asks for the
application's window, and does not expose `can_any_window_draw`, which the main loop itself
asks. On this Mac
(headed scratch runs, V-Sync on, the sleep set to 30 ms so that it can be told from V-Sync's
8 ms): while the window was minimized `window_can_draw` was false and the frames came 30.0 ms
apart at the median (33.3 a second); visible or restored it was true and they came 116 to 119
times a second whatever the sleep; and with the default sleep of 6.9 ms a minimized window ran
145 frames a second. With the host in that window, the application's snapshot read
`time` from `undrawable` for every frame while it was minimized (33.3 ticks a second, one per
frame) and `presentation` from `vsync` after the restore (119.1 ticks a second). In some
other headed runs the window also reported `window_can_draw` false without being
minimized, for the first seconds or in the middle of the run (the frames were then paced by
the sleep as well), and true from the first frame in others: what the OS reports decides, and
the host follows it frame by frame.

The pacing comes from `FrameClock::detect_pacing(headless, vsync_mode, can_draw)`, read per
frame from the application's window, with its source in the snapshot: `headless` for the
headless DisplayServer (its windows cannot draw either, and it comes first), `undrawable`
for a window that cannot draw, `vsync` for `ENABLED` or `ADAPTIVE`, `unpaced` for `DISABLED`
or `MAILBOX`. A validation run states it through two meta values of the `FabricApplication`,
`validation_refresh_rate` (Hz) and `validation_frame_pacing` (`presentation` or `time`,
source `validation`), because the headless DisplayServer presents nothing. The application's
snapshot reports `frameClock` with `periodMs`, `refreshRate`, `rateSource` (`display` or
`fallback`), `pacing`, `pacingSource`, `frames`, `ticks`, `skippedFrames` (frames a consumer
waited through), `lastFrameMs` and `lastTickMs`.

The host binds its own `requestAnimationFrame` and `cancelAnimationFrame`
(`native/application_runtime.cpp`) right after RN's `TimerManager` installs its globals, so a
callback is not a 0 ms timer: a tick runs the callbacks pending when it starts, in order, and
passes every one of them, and the Native Animated frame, the tick's one timestamp. A callback
requested during a tick waits for the next one.

## Why the probe is discriminating

The [fixture](../../tests/frame-clock-fixture.jsx) runs RN's native decay (velocity 0.5,
deceleration 0.99, over the public import) in one box per run and logs what JS observes
in order. The [probe](../../tests/frame-clock-probe.gd) drives the application through
eight paces and reads, once per Godot frame, the clock's snapshot, the backend's counters
and the box's real Control. The paces are Godot's own (a loop capped at 60 fps, the
headless loop, a loop uncapped, a loop with a stall of 57 ms every fifth frame whose catch-up
frame follows it, the hosted runner's pattern), the same 144 Hz loop on a screen that
reports 144 Hz and on one that reports nothing, and the pipelined 13/3 ms frames of a V-Sync
window, once presented and once timed. A cadence check needs the clock's counters, or the
decisions the rule gives the frames that were delivered, or a landing that ticks half a
period apart give; the baseline checks hold on any host.

**No check relies on what the machine delivers** (commit
[`8fc4627`](https://github.com/journey-studios/godot-fabric/commit/8fc46279d6126b87e4fc6cc1d982f75620dfc3b5)).
The first hosted run (a macOS runner) failed two checks that assumed the loop would deliver
3 ms frames: its bimodal lanes had a median gap of 28 ms and one frame (the presented lane)
or none (the timed lane) closer than half a period, 8.3 ms, to the one before, and its
other lanes were stalled for tens of
milliseconds up to 200 ms again and again (14 stalls of 50 ms or more in the 60 fps lane
alone), with catch-up frames behind them. A machine that stalls the process or is too slow
cannot be asked for a pattern, so the probe and the oracle assume none: a frame closer than
half a period to the one before, and within a period of the last tick, must wait wherever
one came, and the condition holds vacuously where none did; what each lane really delivered
(its Godot frames, the median gap, the frames closer than half a period to the one before,
the stalls and the catch-up frames behind them) is an observation, in the report and in the
log of every run, not a check. What a check counts
exists by construction: a lane runs until it has followed 40 frames and 8 ticks, the
stalls of the bursts lane are delays the Pacer inserts, and each request of the callbacks case
follows 40 idle frames, which the headless loop's 6.9 ms sleep spreads over some 0.28 s, far
over one period. The exact patterns are proved by the unit test (the 13 and 3 ms pipelined
frames, a catch-up frame 0.4 ms behind a stall, a loop of 1000 frames a second, random mixes),
and a recorded report from any machine, a hosted run's artifact say, is judged by the same
checks and the oracle with `node tests/frame-clock-native.test.mjs --replay=<report.json>`,
which the current lane also does to its own report. The artifact of that first hosted run
passes the 36 checks and the oracle that way, and the oracle as it was before, which
assumed the pattern, rejected it.

The [oracle](../../tests/frame-clock-oracle.mjs) is written from the contract above and from
RN's decay driver, not from the probe or the C++. It takes the frame times the host
reports, recomputes for every frame whether it had to be a tick, what JS and the backend
received in it, and where the decay driver lands from the frames it was given, in `float`
as the driver does. For any frames no closer than `T / 2` the decay lands in a
window whose bottom the oracle derives from the driver's own rule, `asymptote - 0.1 / (1 -
e^(-(1 - d) step))` with `step = T / 2`, which is 48.749 at 60 Hz, and whose top is the
asymptote, 50.

On the preceding host the same bundle runs and fails exactly the 29 cadence checks (the
clock's counters do not exist, ticks 0.4 ms apart, the decay ends at 13.5 in the `fast`
lane), on a machine that delivers short frames. The three retained sabotages
([`scripts/frame-clock-sabotage.mjs`](../../scripts/frame-clock-sabotage.mjs)) each break
one decision of `FrameClock::frame`, rebuild the host, run the probe and the oracle, restore
the source byte for byte (hashes in the receipt) and rebuild the genuine host: `always`
ticks every frame with a consumer whatever the pacing (the cadence the host had, now
reported by a clock), `idle` decides without asking whether a consumer exists, so a tick
counted for an idle frame refuses the frame a request after idling waits for, and
`presentation` times a presented window. Each fails at least one check and the oracle rejects
each, with every probe check forced to passed; how many checks they fail depends on which
short frames the machine delivered (18 to 21, 3 to 5 and 1 over the runs recorded here), which
is why a sabotage is asked for a failure and for the oracle's rejection, not for a count.

## Departures from RN

- **Timers.** On iOS and Android every timer shorter than a frame fires at the next display
  frame, one callback per frame (`RCTTiming.mm` line 387, `JavaTimerManager.kt` line 285
  onward). This host's timers still run on every Godot frame: `setTimeout(fn, 0)` and
  short intervals are not quantized to ticks, and the baseline check `A zero-delay interval
  fires once on every Godot frame, tick or not` records it. A chain of zero-delay timeouts
  iterates at the Godot loop's rate, hundreds of times a second headless, where RN iterates
  at the refresh rate. Open.
- **Presentation timestamps.** A Presentation tick carries the CPU time of its Godot frame,
  so its steps are as uneven as those frames (3 and 13 ms in the pipelined lane), and a
  decay, which ends at its first step under 0.1, lands lower than at a regular cadence: 48.4
  in that lane against 49.4 to 49.7 in the Time lanes. iOS gives RN the
  `targetTimestamp` of the display link, which is regular; Android's `frameTimeNanos` is the
  vsync time. A regular presentation timestamp is not implemented. Open.
- **One timestamp per tick.** The host binds its own `requestAnimationFrame`
  (`native/application_runtime.cpp`, right after `TimerManager::attachGlobals` installed RN's),
  and a tick passes its one timestamp to every callback of the tick and to the Native
  Animated frame. RN 0.87.1's `TimerManager` rAF is a 0 ms timer whose wrapper reads
  `performance.now()` when each callback runs (`TimerManager.cpp`, lines 343-357), so two
  callbacks of one frame see different times there; browsers pass the frame's shared
  timestamp, as a display link hands out one frame time. The host follows the browsers and
  the display link on purpose: it gives the callbacks and the backend the same instant.
- **`ADAPTIVE` and `MAILBOX`.** Mapped by `detect_pacing` (`ADAPTIVE` presents on the
  display's schedule like `ENABLED`; `MAILBOX` does not wait) and covered by the unit
  test only: this renderer reads both back as `ENABLED`.
- **Variable refresh.** A screen whose rate varies reports one rate; the clock uses what the
  display reports at the time of the frame. Presentation pacing does not use it.

## Exploratory observations outside the receipt

These were run on a headed window on this Mac with a scratch script, once each, and are not
asserted by the suite (the receipt covers headless lanes only). With V-Sync on, 720 of 720
frames were ticks in each of two runs (120.0 and 119.9 per second, none skipped) and
`pacing` was `presentation` from source `vsync` with a 120 Hz `display` rate. With V-Sync
off, 166 of 2,400 frames ticked (114.6 per second, 2,234 skipped), `pacing` `time` from
source `unpaced` at the same rate. With `Engine.max_fps = 60`, V-Sync on or off, 360 of 360
frames ticked at 60.0 per second. Minimized, the window reported it could not draw and the clock
read `time` from `undrawable` (see The rule). A second scratch harness froze and thawed (`SIGSTOP`,
`SIGCONT`) the Godot process that ran the probe, so that its frames came as on a hosted
runner, a stall and then frames close behind it: the frame clock and Animated suites ran on
`e67f82c` 6 times each with stops of 20 to 70 ms every 3 to 40 ms of running, and 10 times
each with stops of 40 to 150 ms every 2 to 15 ms, and every run passed. After the review,
with the probe no longer assuming a pattern of frames, the frame clock suite ran again
under the same two freezings (6 and 10 times) and 4 times with eleven busy loops, one per
core, and every run passed.

## Remaining scope

Regular presentation timestamps (the iOS `targetTimestamp`); quantizing `setTimeout` and
`setInterval` to ticks; `ADAPTIVE` and `MAILBOX` on a renderer that honors them; displays
other than the one measured, variable refresh rates and external screens; behavior under
OS suspend and resume; Godot mobile exports; and the contract, parity and targets of GF-05
and GF-19.
