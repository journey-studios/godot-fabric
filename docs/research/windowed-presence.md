# The windowed lanes and the window the system does not show: why a run is not drawn, and what the lane does about it

Status: the mechanism is read at the source of official Godot 4.7.2 and the helper is exercised in the baseline's windowed lane (local, not in CI); the lane's code, receipts and tests carry the change.
This is the finding of the 0.5 Frontier milestone's V05-06 (GF-30): on 2026-10-09 the windowed lanes of the [baseline](frontier-baseline.md) and of the [turn](frontier-turn.md) refused run after run as `undrawn`
while the user was working on the Mac, and nothing in the receipts said why. This note reads why at the engine's source, makes the lane's window one the system has no reason to stop drawing, and records for
every process frame whether the engine could draw it, so that a refusal says what the engine knew. **It changes no validity rule, no budget and no criterion**: a run that did not draw is refused whatever
the window was doing, and the lane that was never presented still reports no frame time.

## The question

[`graphicsRunValidity`](../../tests/frontier-baseline-oracle.mjs) refuses a windowed run as `undrawn` if a click that settled has no drawn frame after it, or if fewer than nine in ten of the idle window's frames were drawn.
On 2026-10-09, with the user on the Mac (the power log showed UniversalControl), the baseline accepted slots 1 and 2 and refused slot 3 as `undrawn` in five of six attempts, with the drawn frames of a run falling to 3,845,
then 2,970, then 90 of about 5,000 ([the attempts](../evidence/frontier-baseline/README.md)); the turn had three `undrawn` of eight attempts ([the turn's note](frontier-turn.md)). The hypothesis was that on macOS the engine does
not draw a window that the system says is occluded (covered by other windows, minimized, on another Space), so that `RenderingServer.frame_post_draw`, the hook the probes use to see a drawn frame, does not fire although
the process frames go on.

## The mechanism, at the source

Read from the tag `4.7.2-stable` (the commit `ed1daf0bf` of the official binary). Lines are of that tag. The hypothesis holds.

| Step | Where | What it does |
| --- | --- | --- |
| The flag | `platform/macos/display_server_macos.h` 138 | `WindowData::is_visible` starts as `true`. |
| It is cleared by the system's word | `platform/macos/godot_window_delegate.mm` 387-393 (`windowDidChangeOcclusionState`), 371-378 (`windowDidDeminiaturize`) | `wd.is_visible = ([window occlusionState] & NSWindowOcclusionStateVisible) && [window isVisible]`. These are the only two places that write it on macOS. |
| `window_can_draw` reads it | `display_server_macos.mm` 2709-2711; `can_any_window_draw` 2713-2722 | `window_can_draw(id)` is `windows[id].is_visible`; `can_any_window_draw()` is true if any window has it. Documented as "returns `true` if anything can be drawn in the window" (`doc/classes/DisplayServer.xml` 2148-2154). |
| The draw is skipped | `main/main.cpp` 5080-5097 | `wants_present = (can_any_window_draw() \|\| has_additional_outputs()) && render_loop_enabled`; `RenderingServer::draw` and `increment_frames_drawn` run only `if (wants_present \|\| has_pending_resources_for_processing)`. The second term is `RD::get_singleton() && ...` (5080), false on the Compatibility renderer the project uses (`gl_compatibility`). |
| No hook fires | `servers/rendering/rendering_server_default.cpp` 443-453, 229 | `draw()` emits `frame_pre_draw` (446) and runs `_draw`, which ends with `frame_post_draw` (229). If `draw` is not called, neither fires. |
| The process frames go on | `scene/main/scene_tree.cpp` 713; `main/main.cpp` 5177-5178 | `process_frame` is emitted by `SceneTree::process`, before and without the draw, and the iteration ends with `add_frame_delay(window_can_draw(), ...)`. |
| The loop sleeps instead | `core/os/os.cpp` 690-706, 708-731; `main/main.cpp` 2265 | With `!p_can_draw` the delay is `low_processor_mode_sleep_usec`, whose default is 6,900 us ("roughly 144 FPS"): a loop whose window cannot draw ticks every 6.9 ms. |
| Who calls the iteration | `platform/macos/os_macos.mm` 1132-1150 | `Main::iteration()` runs in a `kCFRunLoopBeforeWaiting` observer of the main run loop. |

Three things follow, and the data of the 2026-10-09 attempts agree with them.
- **A run that is not drawn is a run the engine did not try to draw**, not a run it drew badly: no `frame_post_draw`, no frame counted, and the process frames kept ticking, which is why a run could finish and be refused afterwards.
- **A loop that cannot draw has a signature**: an interval of 6.9 ms. In the attempts of 2026-10-09 the idle window of four of the baseline's (A1, A4, A7, B5) and of one of the turn's (run 1, attempt 2) drew no frame at all, and
  their mean idle interval is 6.900 to 6.901 ms and their pair half-sum median 6.897 to 6.902 ms (the table of ["The idle reference"](frontier-baseline.md#the-idle-reference-three-statistics-over-the-raw-intervals-of-2026-10-09)),
  which is the 6,900 us of `low_processor_mode_sleep_usec` and not a display's period (8.333 ms at 120 Hz, the mean of the attempts that drew). The attempts that drew part of their frames lie in between. This is consistent
  with the mechanism and was read from numbers already recorded; it is not a measurement of the occlusion itself, which the receipts could not see and the helper now records.
- **The engine offers no signal or state of the occlusion other than `window_can_draw`.** There is none in `DisplayServer` (`servers/display/display_server.h`, `doc/classes/DisplayServer.xml`) or `Window` (`scene/main/window.h`, `window.cpp`).
  The helper reads it, once a frame.

What is not read from Godot's source and is taken from how AppKit reports occlusion: that `NSWindowOcclusionStateVisible` means some part of the window can be seen on the screen, so that a window is occluded when other windows
cover it entirely, when it is minimized or hidden, or when it sits on a Space that is not showing. An application that is only in the background is not occluded by that alone; its window is, if something else covers it all.
Whether a display that is asleep or locked clears the flag is not settled here: the oracle's `unpaced` rule was written from runs that did draw (the flag true, `frame_post_draw` firing) with the display off or showing the lock
screen. The exact list of causes is the system's; the engine's whole knowledge is the flag.

## The helper

[`tests/window-presence.gd`](../../tests/window-presence.gd), preloaded by the windowed probes of the baseline (`tests/frontier-baseline-graphics-probe.gd`) and of the turn (`tests/frontier-turn-probe.gd`; the lane copies it with
the probe, `scripts/frontier-turn-lane.mjs`). `open()` runs once, before the first measurement:

1. **`Window.always_on_top = true`** on the root window. `Window::set_flag` (`scene/main/window.cpp` 555-568; the property at 3575) forwards to `DisplayServer.window_set_flag(WINDOW_FLAG_ALWAYS_ON_TOP)`, which on macOS sets
   `wd.on_top` and the window's level to `NSFloatingWindowLevel` (`display_server_macos.mm` 2547-2556; `_update_window_style` keeps it, 297-306; documented at `DisplayServer.xml` 3312-3315). A floating window is above the normal
   windows of every application, active or not (AppKit's window levels, not something Godot's source says), so the window cannot be covered by the windows of the applications the user is using. This is the part that does not
   depend on the application being activated.
2. **`DisplayServer.window_move_to_foreground()`** (`display_server_macos.mm` 2675-2694; `DisplayServer.xml` 2358-2363): `activateIgnoringOtherApps:YES`, then `makeKeyAndOrderFront:`. It puts the window in front of the windows of
   its own application and asks for the application to be active. Whether the system honors the activation of a process that a script started in the background is the system's decision (the call is the engine's and AppKit
   has been narrowing what such activation does), which is why the floating level is the first step and not an extra.
3. **It changes nothing else.** The window keeps its title bar and is not made borderless (setting the flag orders the window out, restyles it and orders it in again, `display_server_macos.mm` 2492-2546), no flag that refuses the focus is set
   (`WINDOW_FLAG_NO_FOCUS`), and the focus is asked for once, here. The user can still move, minimize or close the window.
4. **It waits for the engine to say it can draw**: up to 3 s, for 12 process frames in a row in which `window_can_draw()` is true. The flag starts as `true` (`display_server_macos.h` 138) and a window ordered in behind others
   is cleared by a notification that arrives some frames later, so one `true` read right after the call proves nothing. The wait and its result (`canDraw`, `waitedFrames`, `waitedUsec`) are recorded under `opened`; it is not a
   precondition, and a window that never becomes drawable does not stop the run.
5. **It samples**: at the start of every process frame (`process_frame`) it reads `DisplayServer.window_can_draw()`. A frame in which it is false is counted (`undrawableFrames`, of `sampledFrames`), and consecutive such frames are
   a span, `[first process frame, frames, microseconds from the start of the sampling to the first and to the last]`, of which the first 64 are kept (`spanCount` is the total). `close()` returns the record with `canDrawAtEnd`.
   The flag is the one `Main::iteration` reads at the end of the same frame (5081) and the notification that changes it comes from the run loop that also calls the iteration, so a sample and the decision of its frame
   differ only if a notification lands between them, which this note takes as not happening; that is an inference from the source, and the record is of the engine's flag and not of what the display showed.

Headless there is no window to present: `open()` returns `{"windowed": false}` and nothing is sampled, so the headless lanes and their tests are unchanged.

## What changes in the receipts

- **Each windowed run carries `presence`** (the baseline's `report.presence`, the turn's `stages.presence`): `windowed`, `opened` (`alwaysOnTop` read back, `focused`, `mode`, `canDraw`, `waitedFrames`, `waitedUsec`), `sampledFrames`,
  `undrawableFrames`, `spanCount`, `spans`, `canDrawAtEnd`. The oracle checks its structure and that it adds up (`verifyPresence` in `tests/frontier-baseline-oracle.mjs`): a count of the sampled frames, spans that add up to it.
- **Each attempt of the receipt carries `undrawableFrames` and `sampledFrames`** (from `graphicsRunValidity`), the raw runs and rejected attempts carry the `presence` with the spans, and the receipt carries the captures run's
  as `capturesPresence`. The console prints the count of each attempt.
- **A refusal for not drawing says why** (`undrawnReason`): `undrawn: the window did not draw throughout (the window could not draw: window_can_draw() was false in 2400 of 5000 sampled frames, in 3 spans)`, or, when the engine
  could draw in every sampled frame, `(the engine could draw: window_can_draw() was never false in the 5000 sampled frames)`, which says that the window was not the cause as the engine sees it and the display is the suspect.
  A run recorded without the presence keeps the plain reason. `verifyGraphicsReceipt` requires a receipt that refuses an attempt as `undrawn` and carries its count to say it.
- **The rule of validity is the same.** `valid` is still `drew && paced`; the presence never decides it. A run in which 30 frames could not be drawn and every click and nine in ten of the idle frames were is valid, and a run
  that did not draw is refused whatever the engine said.
- **The receipts already recorded** have none of this and verify as they always did: the checks of the count are made only when an attempt carries it.

## The validation run (2026-10-09, one execution)

The baseline's windowed lane ran **once**, as `caffeinate -d node scripts/frontier-baseline-graphics.mjs`, on the Apple M3 Pro with the built-in "Color LCD" (120 Hz), macOS 26.6.2, official Godot 4.7.2 over `gl_compatibility`, a 800 x 600
window, in about four minutes. The receipt (`build/frontier-baseline-graphics.json`, 438,023 bytes, SHA-256 `6cf08c41ba6b9e5a5774b0ffd1318ab2bf6eff3518696dfe2f41c70f1066874a`, not committed) says `presented`: **five of five slots
accepted at their first attempt, none rejected**, with `undrawableFrames` of **0 in each** (0 of 25,337 sampled frames: 4,990, 5,030, 5,121, 5,117 and 5,079; the captures run, 0 of 60). Each run's `opened` read the window back with
`alwaysOnTop` true and `canDraw` true after the minimum 12 frames (86 to 94 ms), and `canDrawAtEnd` was true in all of them. Drawn frames were 4,987, 5,027, 5,118, 5,114 and 5,076 of 5,003 to 5,134 process frames, idle references
8.332 to 8.340 ms, and the one-minute load average stood between 5.6 and 9.8 around the runs.

What this shows, and what it does not. It shows the helper opens a window the engine can draw in a real run, that the record is written and verified (`verifyGraphicsReceipt` ran on the receipt before it was written), and that the lane,
which earlier the same day never closed its slot 3 (six attempts: five refused as `undrawn`, one as `unpaced`), closed all five slots. It does **not** show that the helper overcomes interference: the system's idle time for keyboard and pointer was 5,470 s before the run and 5,743 s after
it, so nobody touched the Mac during it, and there was no moment at which the window could have been covered. Whether a window in front and above keeps drawing while the user works, switches Space or covers it with a floating
window is not answered by this run; the next windowed run with the user present will, in `undrawableFrames` and in the reason of a refusal. The [evidence record](../evidence/windowed-presence/README.md) pins this execution to its commit.

## What can still keep the lane from being presented

The helper makes the window one the system has no reason to hide. It does not make a display show it.
- **The display asleep or locked**, or a screen the system has switched off: in the runs the `unpaced` rule was written from, the window drew (the flag was true and `frame_post_draw` fired) and nothing paced the loop (an idle
  reference of about 0.6 ms). That is the `unpaced` rule's case and not this one: `undrawableFrames` would be 0, and that is itself the finding. Whether a locked display ever clears the flag instead is not known.
- **Another Space.** A window the system keeps on a Space that is not showing is occluded and floating does not change that: `undrawableFrames` is high and the reason says so. `window_move_to_foreground` asks the application
  to be active, which can bring its window along, but this is not something the note verified.
- **Something above the floating level**: the screen saver, the lock screen, a full-screen application on its own Space, another floating window that covers the lane's whole window.
- **The user's hands.** A floating window of 800 x 600 sits in front of what the user is doing for the minutes the lane takes, and clicking on it, dragging it or giving the focus to another application does not stop it drawing,
  but the process frames of the lane share the machine with whatever the user is doing (the load average is recorded before and after every run).
- **The captures run** waits for `frame_post_draw` (`look()` in the probe) with no bound of its own, so a window that cannot draw would hold it until the process timeout of the script (10 minutes). The helper makes that
  unlikely and does not remove it.
- **Renderers other than Compatibility.** With a renderer on the `RenderingDevice` (`has_pending_resources_for_processing`) `draw` can run with `p_present` false, and `frame_post_draw` can fire for a frame no display shows
  (`main/main.cpp` 5085, `RenderingServerDefault::_draw` 76-229). The project's renderer is `gl_compatibility`; a lane on another one would need this rule read again.

## Recommendation for whoever runs a windowed lane

- `caffeinate -d node scripts/frontier-baseline-graphics.mjs` (and `scripts/frontier-turn-graphics.mjs`): `caffeinate -d` keeps the display from going to sleep while the lane runs. It does not wake a display that is already
  asleep; wake it and unlock the Mac first.
- Expect a window of 800 x 600 floating over the other windows for the minutes the lane takes (the baseline's five slots and its captures). It is meant to be seen; it does not need to be used, and the user does not have to stay
  away from the Mac now, but a Space switch or a full-screen application that covers the lane's Space will still make runs `undrawn`.
- Read a refusal by its reason: **`the window could not draw`** is the screen or the Space, look at what the system was showing; **`the engine could draw`** with an `undrawn` verdict means the engine believed it drew and
  `frame_post_draw` did not tell, look at the display; **`unpaced`** is a display that does not pace the loop (off, locked). The lane still repeats a slot up to three times and then ends as not presented, as before.
- A receipt with `undrawableFrames` greater than 0 in an *accepted* run is not wrong: the run drew where it counted, but some frames of it did not. Those frames are in `spans`, and a reader who wants the strictest run can look
  for runs with 0.
