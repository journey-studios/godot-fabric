# The execution of the final comparison, part 1: the scenario, the player and the rehearsal in the three arms

Status: documentation, a scenario in GDScript, a scripted player, a runner in Node and their tests. It is the first part of the criterion `execucao` of V05-10 and **closes nothing**: no comparative execution has
happened, and **this note states no result**. The rehearsal it describes ran the scenario once in each arm, in a Debug build, on a provisioned copy of the consumer, three times (headless, and windowed in the
presented and in the unlimited lane); the object it produces is marked as a rehearsal, lives apart from any campaign, and every execution in it is rejected by the analysis as a Debug build, which is what a rehearsal
must show. No number in this note is a measurement of an arm for the comparison. The three rehearsals, with their summaries, the machine's load and the user's absence, are recorded in
[`docs/evidence/frontier-comparison-execution/`](../evidence/frontier-comparison-execution/README.md), pinned at `7e2e5b1`. The campaign needs the Release export of the game in the three arms (V05-07) and a quiet window that the user reserves ([What is missing](#what-is-missing-for-the-campaign)).
Part 2, the orchestrator of the whole campaign (the sequence in both lanes, the attempts and the redo, the wait for the load, the instrument's self-check as the gate, the state that makes it resumable and a launcher that can be swapped), is [below](#the-campaign), with its rehearsal recorded in [`docs/evidence/frontier-comparison-campaign/`](../evidence/frontier-comparison-campaign/README.md), pinned at `f9aabb3`; it too closes nothing and states no result.
This slice moves no checkpoint, grade, weight or denominator of the 1.0.

## The question

The [protocol](frontier-comparison-protocol.md) says what one execution is: "each execution is a fresh process that runs the script below once" (`runs.process`), in eight steps (`runs.script`), with four active windows, a
seed, a replay, a 100-turn soak and a set of readings, the same in the three arms. The [analysis](frontier-comparison-analysis.md) says what the raw data of a campaign look like (`godot-fabric.frontier-comparison-campaign/v1`).
This is the piece between them: the script that plays one execution in one Godot process and writes what the analysis reads, and the player that plays the soak without React Native, so that arm A (no HUD) can play it.

## What is delivered

| File | What it holds |
| --- | --- |
| `tests/frontier-comparison-scenario.gd` | The scenario: a `SceneTree` script, `--arm=A\|B\|C --lane=presented\|unlimited --out=<file>`. The eight steps of the script; it writes the trace, the instrument's samples and the rest of the report. It derives no window. |
| `tests/frontier-comparison-player.gd` | The scripted player of the soak: the port of `decide` of `tests/frontier-soak-fixture.jsx`. |
| `tests/frontier-comparison-hud.gd` | What the scenario knows of an arm: its scene, the live Controls, the context matrix, the real click, the hooks and whether they exist. |
| `tests/frontier-comparison-cycle.gd` | The cycle of the `context-switches` window. |
| `tests/frontier-comparison-readings.gd` | The readings at rest: resident memory, nodes, Hermes' heap and native views, the provenance of the engine. |
| `scripts/frontier-comparison-run-windows.mjs` | **The window rule, the only one**: from the trace to the frames of every occurrence of every window, joined to the instrument's samples and converted to microseconds. |
| `scripts/frontier-comparison-run-campaign.mjs` | From the scenario's report to the execution object of the campaign; the campaign around the executions. |
| `scripts/frontier-comparison-run.mjs` | The runner: provisions the consumer, copies the scenario in, runs one process per arm, hashes the files, builds the rehearsal. `--rehearsal` only. |
| `tests/frontier-comparison-run.test.mjs` | Node only (part of `npm run test:contracts`): the window rule on synthetic traces, the numbers the scenario waits with, the microseconds, the campaign assembled from synthetic executions. |
| `tests/frontier-comparison-run-synthetic.mjs` | The synthetic traces and reports of those tests. |
| `tests/frontier-comparison-player.test.mjs` | Native: the player against the soak of JavaScript, and a control that decides otherwise. |
| `tests/frontier-comparison-run-native.test.mjs` | Native: the rehearsal in the three arms, with the occurrences of each window counted on the windows derived from the real trace. |

`npm run test:frontier-comparison-run` runs the two native files, one at a time. Nothing of `consumers/civ-lite`, of the protocol's JSON or of the analysis' scripts is edited: the scenario and its helpers are copied into the
provisioned copy under `res://comparison/`, and the analysis' modules are only imported.

## The script, step by step

The scenario instantiates the arm's scene (A is `main_bare.tscn`, the game with no HUD; B is `main_native.tscn`, the native Godot HUD; C is `main.tscn`, the React Native HUD), turns the CPU-time instrument on
(`tests/cpu-time-instrument.gd`, with the main window's viewport) and plays the script. A frame is a process frame; the instrument reads all of them, and a frame belongs to a window only through the frame numbers the
[trace](#the-windows) records.

| Step | What the scenario does | The rule of the protocol |
| --- | --- | --- |
| `boot` | Instantiates the scene. In the `unlimited` lane it asks for `VSYNC_DISABLED` and reads the mode back. In B and C it measures the time to the interactive HUD: from the start of the engine's clock to the first frame in which the `none` context's testIDs are present (the panels of the matrix's row, plus the End turn and New game controls) and a script's click on a control is accepted. The control is New game, the click is injected the way the latency pass injects its clicks, and "accepted" is that the game's epoch rose. Then, in a windowed run, it puts the window in front (`tests/window-presence.gd`) and waits for the HUD to rest. | `runs.script` `boot`; `secondaryOutcomes` `time-to-interactive-hud`: "from the start of the process to the first frame at which the initial context's testIDs are present and a scripted click on a control is accepted"; `vsync`: the FPS counts only if `window_get_vsync_mode()` reads back `DISABLED`, and the refresh rate is read back, never assumed |
| `idle` | 600 frames with nothing injected, right after the boot has rested. | `idleReference`: "600 consecutive frames with the map and the HUD still and nothing injected". The scenario records the CPU time and the elapsed interval of each (the two quantities of the idle reference, `idle.cpuUsec` and `idle.intervalsUsec`) and how many the display drew (`drew.idleDrawnFrames`). |
| `replay` | After a new game, the 77 steps of `consumers/civ-lite/game/replay.gd` through `GameServices.callv`, waiting for the job of each End Turn as `hud_validation.gd` does, and the hash of the state at the end. | `runs.script` `replay`: "its golden hash must match; its frames are kept in the raw data and belong to no window". The protocol's "73 intents" became 77 with the amendment 3; the scenario plays whatever `Replay.STEPS` holds (77: the native test asserts it). The golden hash is the one fixed in `tests/civ-lite-game-native.test.mjs`, which the runner reads from there. |
| `soak` | After a new game, 100 turns of the scripted player (below), each turn a sequence of intents that ends with End Turn. The windows `ai-phase` and `event-burst`. | `runs.script` `soak`; `windows` `ai-phase` and `event-burst`, 2 turns of warm-up and 98 measured |
| `context-switches` | 24 + 50 intents that change the game's context, through the seven contexts, in a fixed cycle ([below](#the-cycle-of-the-contexts)). | `windows` `context-switches` |
| `latency` | (B and C) 2 + 30 real clicks on HUD controls found by testID in the live tree, injected as in the V05-06 baseline: `Driver.inject` of `tests/world-input-driver.gd` (a motion, a press and a release through `Input.parse_input_event`) and `Input.flush_buffered_events()`, at the centre of the Control's rectangle. | `runs.script` `latency`; `secondaryOutcomes` `click-to-panel`, in frames |
| `stress` | 2 + 30 rounds: `stress_begin()`, 20 `stress_step()` in consecutive frames, `stress_end()`. | `windows` `stress`. The hooks of the stress and events slice (#119) are there; without them the window is recorded as unavailable, with the reason. |
| `end` | The 12 drain frames of the instrument after the last window, then the resident memory, the nodes of the SceneTree and, in C, Hermes' heap after a forced collection and the native views; the process exits with its code. | `runs.script` `end`; the instrument's lag of 6 draws (`cpu-time-instrument` `alignment`) |

Between any two intents that are not a window's own the scenario waits `SETTLE_FRAMES` (6) frames of rest, so that the HUD has caught up before the next one; and after a new game or a setup it waits for the set of live
Controls to stay unchanged for as long. Those frames, the readings and the setup of a round belong to no window.

### The latency pass

A stack of two units (the Settler and the Warrior on the start tile) is selected by an intent, outside the pass, and the pass clicks a control of the actions panel that the HUD built for it: `hud-actions-select_unit-2` (stack
to Warrior) or `hud-actions-select_unit-1` (stack to Settler), alternating, and then `hud-actions-clear_selection` (to none). The click is over when the HUD shows the panels of the context it leads to and only that
context's marker (`shows_light` of `tests/frontier-turn-probe.gd`, read from the Controls and never from the Surface's snapshot): `clickToPanelFrames` is the frames from the one in which the click was injected to that
moment, 0 when the HUD answers inside the call of the click (the native HUD does), and the first 2 clicks are the warm-up.

### The time to the interactive HUD

The engine's clock (`Time.get_ticks_usec()`) starts with the engine, so the time does not include what the operating system does before the engine runs, which is the same in the three arms. The click is New
game, which the game takes (the epoch rises, nothing else of the state moves and both the replay and the soak begin with a new game of their own). The control may take a few frames to answer, so the scenario
clicks again in each frame in which the testIDs are present until it is accepted, and the time is the one of the frame in which the epoch is seen to have risen. In a windowed run the window is put in front
*after* this, so that the wait for it is not in the time (it would put a floor under the native HUD's).

## The windows

While it plays, the scenario records a trace: an array of `{frame, kind}`, the frame being `Engine.get_process_frames()` at the moment, in six kinds, and at the end it dumps the instrument's samples (`frame`,
`startUsec`, `totalMs`, `intervalMs`, `drawn`, `renderKnown` for every process frame). It derives no window: what it does in a burst is wait for the counters, which is waiting logic. The orchestrator
derives the windows from the trace, joins them to the samples by frame number and converts the CPU time of each frame to integer microseconds, with `Math.round(totalMs * 1000)`
(`scripts/frontier-comparison-run-windows.mjs`, `derivedOf`). **The window rule is one, and it is in JavaScript.**

| Kind | Recorded by | Opens or closes |
| --- | --- | --- |
| `end-turn-accepted` | the frame whose script called End Turn and was answered with a job id | opens `ai-phase` |
| `turn-ended` | the handler of `GameServices.turn_ended`, in the frame that delivers it (a coroutine resumed at the start of a frame cannot see a signal emitted later in it) | closes `ai-phase` (the frame before it) and opens `event-burst` |
| `events-settled` | the first frame at whose start the turn's notifications have been consumed | closes `event-burst` (the frame before it, and never before the fifth) |
| `context-switch` | the frame that received an intent that changes the game's context | opens `context-switches`, which has 3 frames |
| `stress-begin` | the frame that received `stress_begin()` | opens `stress` |
| `stress-step` | each frame that received `stress_step()` | the last of them closes `stress`, two frames later |

What stays in both languages are numbers the scenario waits with (the burst's 5 frames, a switch's 3, the stress window's 20 steps and its 2 frames of tail), and they cannot drift: the protocol states them in words
(`windows[].ends`: "at least 5 frames from the start", "the second frame after the starting frame, so each occurrence has 3 frames", "the second frame after the last of 20 consecutive per-frame updates"); the rule reads
them from the protocol when it runs and refuses a protocol that no longer says them; the scenario writes the ones it waited with (`config.waits`) and the orchestrator refuses a report whose numbers are not the
protocol's; and `tests/frontier-comparison-run.test.mjs` requires the constants of the scenario to be the protocol's, together with the cycle's 24 + 50, the soak's 100 turns, the idle 600 frames and the 2 + 30
of the latency and of the stress (read from `runs.script`), and the kinds the scenario traces to be the kinds the rule reads. A report in which an occurrence did not end, or lacks a frame, is refused with the
occurrence named.

**What is read at the start of a frame.** `events-settled` is the frame at whose *start* the counters are equal, because the scenario's coroutine runs before the nodes' `_process`; the last frame of the burst is the one
before it. The scenario reads the counters from the fifth frame of the burst on (`BURST_MINIMUM_FRAMES`), so that in the frames that are certainly part of the window it does nothing but wait for the next frame; the rule gives
the same answer, because a window never ends before its fifth frame.

### Why the AI phase has five frames here and six in the turn lane

The protocol defines `ai-phase` as "the frame in which the End Turn intent is accepted ... to the last frame before the frame that delivers `frontier.turn_ended`". Both counts below follow it. The turn lane
(`tests/frontier-turn-probe.gd`, read by `extractTurnRun` of `scripts/frontier-freeze-receipts.mjs`, where the frozen budgets come from) has six frames of the window per turn (seven records labelled `ai_plan` to `idle`, the
first six are the window), and this scenario has five. The difference is where, in a frame, the intent is accepted, and it was measured (arm B and C, headless, the frame numbers are `Engine.get_process_frames()`):

| | Accepted in frame | Phase 1 runs in | Phase 6 runs and `turn_ended` is delivered in | Frames of the window |
| --- | ---: | ---: | ---: | ---: |
| The scenario's direct call, arms A, B, C | N (42) | N | N+5 (47) | N to N+4: **5** |
| A real click on the bar, arm B | F (93) | F | F+5 (98) | F to F+4: 5 |
| A real click on the bar, arm C (the turn lane's) | F (93) | F+1 (94) | F+6 (99) | F to F+5: **6** |

The order of a frame, from the source: `SceneTree` emits `process_frame` first (the instrument's handler, then the scenario's coroutine, which resumes in that emission), then the nodes' `_process` in tree order;
`GameServices` is the root of the scene, so its `_process` (`advance_job`, one phase per call, `turn_ended` emitted by `_finish_job` after the sixth) runs before its children's. The scenario calls `end_turn()` from the
coroutine, at the start of the frame, so the first phase runs in that same frame. A click on the React Native HUD is a JavaScript event handled in the host's pump, which `FabricApplication::_process` runs
(`native/fabric_application.cpp`, `runtime->pump(true)`); the service call it makes is run, as the game's own callable, by `GameServiceRegistry::pump_host` in a host phase that the pump schedules with `call_deferred`
(`native/application_runtime.cpp`, `host_phase`), at the end of the frame's process step. `Application` is a child of `GameServices`, so all of that comes after that frame's `GameServices._process`: the intent is accepted
there, the first phase runs in the next frame, and the accepting frame (the click's dispatch and the pump) is a window frame of its own with no phase in it. The turn lane's six
frames are that frame and the frames of phases 1 to 5; this scenario's five are the frames of phases 1 to 5, the first of which also accepts. A click on the native HUD handles the press inside the flush of the click,
at the start of the frame, and gives five, as the direct call does. No frame that belongs to the window is left out here: the window runs from the accepting frame to the last before the delivering one, in both.

The scripted intents are delivered "at the game's intent boundary" in the three arms (`runs.fixed.input`), which is the direct call, so the three arms count alike; what differs is the lane that froze the budget. The absolute
budget of `ai-phase` (15.5 ms) is reported beside the category and never changes it (`decisionRule.absoluteBudget`), and it was derived from a p95 over frames of which one in six is the click's.

## The cycle of the contexts

The seven contexts (none, tile, Settler, Warrior, stack of two units, city, dialog) do not fit in the state of one game: the Settler exists only until `found_city`, the city only after it, and the dialog only after the end
of turn 4. So the cycle is made of rounds, a round being one game, and it takes its intents from the `cover-*` steps of `replay.gd` and from the tour of `tests/frontier-turn-probe.gd`.

**What the protocol says an occurrence is** (the amendment 4, [#117](frontier-comparison-protocol.md#amendments); `windows[context-switches].starts` and the step `context-switches` of `runs.script`): the frame that receives the
intent that changes the game's context, which is **a selection intent for the six first contexts** and, for the dialog, **the last `resolve_event`**, which closes it (dialog to none). The End Turns that open the
dialog, the earlier `resolve_event` calls that set it up and any new game the cycle needs belong to no window. The cycle follows that text: what is not a selection and not the closing of the dialog is a *setup* that comes before a
switch, and the scenario plays it at rest: `found_city` is not a selection intent, so it is a setup.

**A round**: a new game, then 12 switches, two of them preceded by a setup.

| # | Intent | From | To | Setup before it, outside every window |
| ---: | --- | --- | --- | --- |
| 1 | `select_tile(6, 8)` | none | stack | |
| 2 | `select_unit(2)` | stack | warrior | |
| 3 | `clear_selection()` | warrior | none | |
| 4 | `select_tile(6, 8)` | none | stack | |
| 5 | `select_unit(1)` | stack | settler | |
| 6 | `select_tile(9, 8)` | settler | tile | |
| 7 | `select_tile(6, 8)` | tile | stack | |
| 8 | `select_unit(1)` | stack | settler | |
| 9 | `clear_selection()` | city | none | `found_city(1)`: the Settler founds the city on the start tile |
| 10 | `select_tile(6, 8)` | none | city | |
| 11 | `clear_selection()` | city | none | |
| 12 | `resolve_event("host")` | dialog | none | 4 End Turns (the game is at turn 5 and the three events are queued), `resolve_event("welcome")`, `resolve_event("buy_grain")` |

**74 occurrences** (24 of warm-up and 50 measured) are **6 whole rounds of 12 and the first 2 switches of a seventh**, which is cut where the count is reached: 7 new games. The 24 of warm-up are two whole rounds (the
baseline's 12-swap tour twice) and the measured 50 are the occurrences 25 to 74, among them 4 closings of the dialog (the occurrences 36, 48, 60 and 72). Between two occurrences the scenario rests for 6 frames and checks at rest that the game
is in the context the cycle plans and that the HUD (in B and C) shows exactly the panels of the matrix's row for it, and it checks the same after each setup (the city after the founding, the dialog before its closing).

**The dialog.** The context `dialog` cannot be reached by a selection inside the three frames of a window; it was measured on arm A, from the replay's step 43 on, with End Turn (step 44) accepted in frame N:

| Frame | Phase | Context | `dialog.open` |
| --- | --- | --- | ---: |
| N (after the call) | `ai_plan` | stack | 0 |
| N+1 to N+4 | `ai_move`, `production`, `growth`, `research` | stack | 0 |
| N+5 | `refresh` | stack | 0 |
| N+6 | idle, turn 5 | dialog | 1 |

The events are raised by the `refresh` phase (the sixth) of the End Turn of turn 4 (`turn.gd`, `_refresh`: the turn becomes `Rules.EVENT_TURN`, once per game), so the dialog is published in frame N+5 and a
coroutine sees it at the start of N+6; the window of a switch is N to N+2. And inside a dialog every selection is refused and changes nothing: `select_tile`, `clear_selection` and `select_unit` answer
`event_pending` (the replay's steps 45 to 47 say the same). The dialog is entered by End Turn and by nothing else, which is why the amendment 4 takes the occurrence of the dialog to be the intent that **leaves** it.
The amendment 3 ([#116](frontier-comparison-protocol.md#amendments)) corrects the replay to 77 intents, which is what `Replay.STEPS` holds and what this scenario plays; the Node test requires the protocol's count to be
the number of steps of `replay.gd`, and the protocol's two sentences about the context switches to say the last `resolve_event`.

Over the 74 occurrences the contexts reached are: stack 19, warrior 7, none 24 (6 of them the closing of the dialog), settler 12, tile 6, city 6.

## The player and its equivalence with the soak of JavaScript

`tests/frontier-comparison-player.gd` is the port of `decide` of `tests/frontier-soak-fixture.jsx`: the same rule over the same snapshot. It founds the city on the start tile (6, 8); then, every turn and once each, it sets the
research and the production if they are empty, selects the city, selects and fortifies the first unfortified unit on its tile, selects an empty tile and clears the selection, and ends the turn; an event that blocks the game
is answered with its first choice. It reads `GameServices.get_snapshot()` and answers the intent by the name and the arguments the snapshot's actions carry; the scenario sends it through `GameServices.callv`, which is the
game's own boundary, so the intents are the ones the React Native HUD's player sends through the typed services. It keeps no clock and draws no number. Its constants (`START_TILE`, `GARRISON_CAP`) are checked against
`tests/frontier-soak-cases.mjs` by the Node test.

**The equivalence**, in `tests/frontier-comparison-player.test.mjs`: the scenario's soak on arm A, 100 turns after a new game with the protocol's seed (4242), reaches

| | Value |
| --- | --- |
| Final hash (`game.state_hash()` after turn 100) | `0b21c332c1f86fb41522cdbed0144f168831f6ab51bc427769a68a146aa6afd0` |
| Trail hash (the SHA-256 of the hundred turn hashes, one per line) | `4d6d3c4c1078518f8971b76caef08a9b3ba6434c01fdc3658ce7787013d6371b` |
| Decisions | 429, none of them refused |
| Game after the soak | turn 101, the hundred turn hashes all different |

which are the numbers of the soak of JavaScript **today**: `npm run test:frontier-soak` at this commit (4c3abb7) passed in three executions with the same final hash and trail, and the record of the change that moved them,
[`docs/evidence/civ-lite-ui/README.md`](../evidence/civ-lite-ui/README.md) (the section of the three events of turn 5: "hashes final `0b21c332…` e de trilha `4d6d3c4c…` onde eram `a35c55f2…` e `fe9d4f36…`, porque o
estado do jogo mudou", 429 decisions) and its [`report.json`](../evidence/civ-lite-ui/report.json) (`afterTheChange`: `finalHash`, `trailHash`, `previousFinalHash`, `previousTrailHash`). **[`frontier-soak.md`](frontier-soak.md)** printed `a35c55f2…` and `fe9d4f36…` (lines 96 to 100) as if they were the soak's, which they were before #93, the change that added the three events of turn 5 and moved
the state of the game; since #118 it says so and points to the section of the run after it.

A control in the same test plays the game with a garrison of two units instead of six (one constant changed in the copy): the final and the trail hashes move, and the hashes of the turns part from the genuine player's at
turn 3. So the equivalence is a check that can fail, and it says where.

## Times

**Microseconds.** The format of the campaign holds integer microseconds. The conversion is `Math.round(totalMs * 1000)` of the instrument's `totalMs` of the frame (`usecOf` in
`scripts/frontier-comparison-run-windows.mjs`). The scenario writes the same integer as `floor(totalMs * 1000 + 0.5)`, which is `Math.round` for the non-negative values a CPU time takes (the Node test runs the
two over 200,000 values on a fine grid and at the halves), and the runner recomputes every frame of every occurrence from the raw milliseconds the scenario also writes and refuses the execution if one integer differs.
Nothing is discarded or smoothed: every frame of an occurrence is kept, and the warm-up occurrences are flagged and kept.

**FPS without a limit.** The protocol asks for "FPS without a limit, per window" and defines nothing more. The reading chosen: for a window, the frames of its measured occurrences over the time they took, where an
occurrence took the time from the start of its first frame to the start of the frame after its last (`startUsec` of the instrument), summed over the occurrences. It exists only in the `unlimited` lane and only when
the vsync mode reads back `DISABLED` (`vsync.unlimitedFpsRequires`); the other executions have no `fps`, as the format asks. A window with no occurrence (unavailable) is given 0, because the format requires a number
when the lane reads one: it means no frames in no time.

## What the scenario does inside a measured frame

The instrument connects first to `process_frame`, so any work of the harness that resumes from an `await process_frame` falls inside that frame's `processMs`. The scenario therefore keeps its work in the frames of a
window to what a consumer of the game does in any case, and does the rest in frames of rest:

| Window | What happens in its frames | Cost, measured |
| --- | --- | --- |
| `ai-phase` | In the first frame: `Engine.get_process_frames()`, the call of `GameServices.end_turn()` (the intent itself, which the game and the HUDs pay for) and one trace entry. In the others: waiting for the next frame and comparing two integers. The player's decision, with the snapshot it reads, is taken in a frame of rest before. | a trace entry is 0.28 to 0.63 µs |
| `event-burst` | The handler of `turn_ended` (a counter, the frame number, one trace entry). From the fifth frame of the burst on, one read of each counter per frame: `stats()` of the HUD and `notifications_emitted()` of the game; arm A, which has no HUD, reads only the second, from the fourth frame, to have two readings to compare. | `stats()` is **0.86 µs in B and 4.5 µs in C** per read (the record of the slice that delivered it: [provenance of the reads](#provenance-of-the-reads)); `notifications_emitted()` 0.11 to 0.19 µs |
| `context-switches` | In the first frame: one trace entry and the call of the intent. In the other two: waiting. The context reached is read after the window, at rest. | the same trace entry |
| `stress` | In every frame: one trace entry and the call of the hook (the answers are kept and read after the window). | the same trace entry; the hook itself is the game's own work and is what the window measures |
| idle | Waiting for the next frame, as everywhere. | none |

The wait for the next frame is the same in every frame of the run, idle included, so it is in the instrument's floor and not in a difference. Nothing evaluates JavaScript, nothing reads the Surface's snapshot and nothing spawns
a process in a window. In C the only call into the host's JavaScript side is the forced collection of Hermes' heap, once, after the drain, which is the reading at rest of the turn lane (`tests/performance-sampler.gd`).
**The `stats()` of the HUD of C is not read by evaluating JavaScript** (that would charge arm C alone, the trap of #108): it is read from `HudStats`, a node of `main.tscn` that reads the registry's native counters
(`FabricApplication.service_delivery`), with no JavaScript and no Surface snapshot. A path that evaluated JavaScript would cost about 100 µs a read and a read of the Surface's snapshot about 570 µs (the same record).

## What each reading costs, and where it falls

Measured by the scenario in the three rehearsals (nine executions: headless, and windowed in the two lanes), on a machine that was not quiet; the ranges are over those nine executions, and they are the costs of the readings and not of any arm.
Only the last row can fall inside a measured frame. The two cost figures of `stats()` are those of the record of the slice that delivered it; what the scenario measured of the same reads in its own runs is beside them.

| Reading | When it is taken | Cost | In a measured frame? |
| --- | --- | --- | --- |
| Resident memory (`ps -o rss=`) | At rest, after the boot, the idle, the replay, the soak, the switches, the latency, the stress and the end; the report keeps the last (`end`) and the maximum (`max`) | 4.9 to 45.2 ms (a process is spawned) | No. Taken in a frame that belongs to no window; the idle window begins six frames after the one that spawned the process |
| Nodes of the SceneTree | At the end | 2 to 73 µs | No |
| Hermes' live heap after a forced collection, and the Fabric native views (arm C) | At the end, after the drain, by the turn lane's reading at rest (`Sampler.sample()`) | 15.7 to 22.1 ms | No |
| Parity (the visible panels against the context matrix) | At rest, after each switch of the cycle, after each setup and at the boot: 93 checks in a run, in the seven contexts | one walk of the SceneTree for the Controls named `hud-*`, 9.0 to 13.5 µs (B and C) | No |
| Time to the interactive HUD | At the boot | the frame's own clock reading | No: the boot belongs to no window |
| The player's snapshot (`get_snapshot()`) | At rest, before each decision, and after each switch | 48.8 to 85.5 µs | No |
| The flags of validity (drew after every measured intent, the idle frames drawn) | After the run, from the instrument's columns | none during the run | No |
| `stats()` of the HUD and `notifications_emitted()` of the game | Each frame of the event burst from its fifth on | `stats()`: 0.86 µs in B and 4.5 µs in C (the record); 0.65 to 1.0 µs in B and 4.3 to 4.8 µs in C in the scenario's runs. `notifications_emitted()`: 0.11 to 0.19 µs | Yes, by design: the window ends when they agree |

## The validation nodes of `main.tscn`

`main.tscn` has four validation nodes under the game (`Validation`, `HudValidation`, `OverlayValidation`, `StabilityValidation`) and `main_native.tscn` has two (`HudValidation`, `OverlayValidation`); `main_bare.tscn`
has none. Two scripts define `_process`: `hud_validation.gd` (`if recording:`) and `overlay_validation.gd` (the same). Their `_ready` returns at once without their flag (`hud_probe.gd`), but a node whose script
defines `_process` is called in every process frame, so **in B and C, in every measured frame, two empty `_process` calls run** (`validation.gd` and `stability_validation.gd` define none).

What they cost, measured with the instrument on arm A's scene with 0 and with 64 nodes of each script alternately (three of each, 4,000 frames after 300 of warm-up, headless): the mean total of a frame went from 0.0292
to 0.0488 ms with 64 `hud_validation.gd` nodes (**0.31 µs a node and frame**) and from 0.0285 to 0.0545 ms with 64 `overlay_validation.gd` nodes (**0.41 µs**), so the two that B and C carry cost about **0.7 µs a
frame**, with an uncertainty of the order of 0.3 µs a node (the means of the six runs of one script spread between 0.019 and 0.062 ms). That is under 1% of the instrument's floor in a presented window (0.082 ms)
and 0.14% of the 0.5 ms floor of the margin. They are in B and in C alike, so they cancel in C minus B (`H3`); they add the same 0.7 µs to B minus A and C minus A (`H1` and `H2`), because A has none. **They do not weigh
on the measured frames**, and nothing was done about them; if the cost should be zero in the estimates against A, the owner of the consumer can give them `set_process(false)` when their flag is absent.

## The hooks of the stress and events slice

The hooks were delivered by #119 ([`frontier-stress.md`](frontier-stress.md)) and the scenario uses them; it detects each by name, so a game or a HUD without one makes the window that needs it unavailable, with the
reason, and never invented.

| Hook | Where | What the scenario does with it |
| --- | --- | --- |
| `stats() -> {snapshots, context, events}` | B: the native HUD, `HUDLayer/HUD`. C: the node `HudStats` of `main.tscn`, which reads the registry's counters natively (`service_delivery`) and evaluates no JavaScript | reads it from the fifth frame of the burst on, in B and C (`Hud.stats_source`) |
| `notifications_emitted() -> int` | `GameServices` | reads it in the same frames, in the three arms; the set it counts (snapshots, hover cards and ends of turn) is the set `events` counts |
| `stress_begin()`, `stress_step()`, `stress_end()` | `GameServices` | a round is `stress_begin()`, 20 `stress_step()` in consecutive frames and `stress_end()`; the window runs from the first to the second frame after the last step. A refusal (`turn_in_progress`, `stress_on`, `stress_off`) is read after the window and reported |

`events-settled` is read from the fifth frame of the burst on: in B and C the HUD's `events` against the game's `notifications_emitted()`; in A, which has no HUD, the emitter's counter against its own value one frame
earlier, read from the fourth frame on (only the game's side, as the specification of the window says, and independent of whether the game counts a notification before or after it emits it). In the rehearsal the
counters agree at the first read after the minimum in every turn of the three arms: all 100 bursts are the minimum of five frames, and at rest at the end of the run the HUD has consumed everything the game emitted
(`events` equals `notifications_emitted()` in B and in C). **`service_delivery` counts each revision once, however many subscriptions receive it** (the correction that entered with #119), which is why `events` of C
stays equal to the emitter's.

The stress overlay is not the game's state, and a snapshot carries `stress` only while the mode is on; the scenario checks the context matrix's parity outside the stress rounds only (the panel `hud-stress` is in no row of
the matrix) and leaves the mode with `stress_end()` at the end of every round, then waits for the HUD to rest before the next one.

The native test also runs the scenario against a copy of the game that lacks `stress_step()` and a copy of the native HUD that lacks `stats()`: the stress window is unavailable in A and B and says that the hook is missing,
the event burst is unavailable in B and says which HUD lacks which counter, A's event burst is measured, and the analysis rejects the executions as incomplete for exactly those windows.

### Provenance of the reads

What reading `stats()` costs is part of the provenance of the rehearsal (`rehearsal.json`, `provenance.readCosts`, and `summary.json`), taken from the record of the slice that delivered the hooks,
[`docs/evidence/frontier-stress/costs.json`](../evidence/frontier-stress/costs.json): the median per read over 20,000 reads, headless, on a machine under load, **B 0.86 µs and C 4.5 µs**
(`arms["b-new"].statsUs.median` and `arms["c-new"].statsUs.median`, to two digits; the figures after the review fix), and for the record the two paths that a measured frame must not take: evaluating JavaScript, about 100 µs, and
reading the Surface's snapshot, about 570 µs. The campaign's own `provenance` is closed by its format and holds none of this; the scenario also times the reads in each run (`costsUsec`).

## The rehearsal

`node scripts/frontier-comparison-run.mjs --rehearsal --arms A,B,C --lane presented|unlimited [--windowed] [--assume-refresh-hz <n>] [--out <directory>]` provisions the consumer with the harness
(`scripts/consumer-harness.mjs`, then the editor builds the HUD), copies the scenario into the copy, runs one Godot process for each arm and builds:

- `campaign.json`: the campaign object, strictly in the format `godot-fabric.frontier-comparison-campaign/v1`, with `build: "debug"`, one execution per arm in the first slot of the arm (A is slot 1, B slot 2, C slot 3),
  and the hashes of the binary (the engine's executable), the package (the provisioned copy as built, without the import cache and the scenario), the script (the scenario's files and the support files, by path and
  hash) and the protocol. **`campaignErrors` must pass, and the runner refuses to go on if it does not.**
- `rehearsal.json`: the mark. The format refuses a key it does not list, so the field `rehearsal: true` cannot go inside the campaign, and it is beside it: it says that the campaign is a rehearsal, holds its hash, the
  windows that were unavailable and why, the refresh rate assumed (if any) and what the sizes are.
- `report.json`: the analysis's report of the campaign (`buildReport`). The rehearsal registers what it measured, in the process that measured it, so that the rules that compare with the registered values judge the
  other things; the instrument's self-check was not run for it (`instrument.selfCheckPassed` is false), so the report's status is `stopped` and it produces no statistic.
- `summary.json`: counts, times and reasons of each execution.

Every execution comes out rejected with `not-the-registered-build` (clause `build`: Debug). In the headless rehearsal the analysis adds `not-presented` (a headless display draws nothing and does not pace the loop),
`load` when the machine is not quiet (the repository's other lanes run on it: the 1-minute load was above 5 while it ran, against the limit of 2.0).

**The refresh rate.** A headless display reads `-1` and the format requires a positive one (and the analysis refuses `refreshHz <= 0`), so the headless rehearsal is given `--assume-refresh-hz 60`; the value is
written in the campaign's deviations and in `rehearsal.json`. Without it the runner stops with the format's own error. The windowed rehearsal reads the real one.

**What it ran** (headless, Debug, one execution per arm, on a machine with a load above 5; the seconds include the 600 idle frames, the replay, the soak, the switches, the latency and the readings; this is the
headless rehearsal of the [evidence record](../evidence/frontier-comparison-execution/README.md), run at `7e2e5b1`):

| | A | B | C |
| --- | ---: | ---: | ---: |
| Seconds | 51.8 | 56.7 | 75.4 |
| Process frames | 7,449 | 8,042 | 8,168 |
| Replay: steps and golden hash | 77, `cb7ab974…` | 77, `cb7ab974…` | 77, `cb7ab974…` |
| Soak: turns, decisions, final hash | 100, 429, `0b21c332…` | 100, 429, `0b21c332…` | 100, 429, `0b21c332…` |
| Idle window | 600 frames | 600 | 600 |
| `ai-phase` | 100 occurrences (2 + 98), 500 frames | the same | the same |
| `event-burst` | 100 occurrences (2 + 98), 500 frames: every burst is the minimum of 5 | the same | the same |
| `context-switches` | 74 (24 + 50), 222 frames | the same | the same |
| `stress` | 32 rounds (2 + 30), 736 frames: 23 each | the same | the same |
| Latency clicks | not measured in A | 2 + 30 | 2 + 30 |
| Parity | not measured in A | 93 checks, 7 contexts, all match | 93 checks, 7 contexts, all match |
| Time to the interactive HUD (ms, headless, not a result) | not measured in A | 295 | 404 |
| Notifications the game emitted, and the HUD consumed, at rest at the end | 2,256, no consumer | 2,306 and 2,306 | 2,307 and 2,307 |
| Scene nodes at the end | 4 | 31 | 30 |
| Hermes heap, native views | | | 2,332,440 bytes, 17 |
| Errors (script, Godot log, JavaScript), exit code | 0, 0, 0, exit 0 | 0, 0, 0, exit 0 | 0, 0, 0, exit 0 |

The unlimited lane was run on arm A: the vsync was requested `DISABLED` and read back, and the headless display server keeps `ENABLED`, which the scenario records (`vsync-reading`: the FPS band is N/A for that execution).
**Nothing above says how an arm performs.**

**The windowed rehearsal** ran afterwards, at the same commit, in both lanes (`--windowed`, `presented` and `unlimited`), on a 3024 × 1964 display at scale 2 with a 1080 × 600 window at 120 Hz, with the user away. The
three arms were presented in both lanes (the display drew after every measured intent and the 600 idle frames), the unlimited lane's vsync read back `DISABLED` and its FPS band is filled, and every counted window is
what the headless one counted (500, 500, 222 and 736 frames; no burst longer than its minimum of five, C included), the parity matched in its 93 checks, and the replay and the soak reached the same hashes. The only
rejections are `load` (the 1-minute average was 4.9 to 6.0 around the executions, and 4.87 to 6.83 in the sampler) and the Debug build. The loads, the sampler and the user's absence are in the evidence record.

## Readings of the protocol that were chosen

Where the protocol is a sentence, or says nothing, and the scenario had to decide. None of them changes a number of the protocol; each decides how a sentence meets the game.

1. **The replay has 77 steps**, as the amendment 3 of the protocol says; the scenario plays `Replay.STEPS`, whose length the native test asserts.
2. **The soak's hashes** are the soak of JavaScript's today (above), not the ones of the run before #93 that `frontier-soak.md` marks as such.
3. **The occurrence of the dialog is the intent that leaves it**, as the amendment 4 of the protocol writes it, and `found_city` is a setup and not an occurrence, because it is not a selection intent.
4. **12 switches a round and 7 rounds** (6 whole and 2 switches of the seventh), because the contexts do not fit in a game and the dialog needs 4 End Turns outside every window.
5. **The window of the AI phase is five frames**, because the first phase of the job runs in the frame that accepts End Turn, and `turn_ended` is delivered by the frame of the sixth.
6. **The burst of a turn ends with the frame before the first at whose start the counters agree**, and never before its fifth frame; in A, which has no HUD, the agreement is the emitter's counter not having moved since the previous frame's reading.
7. **The time to the interactive HUD** is on the engine's clock, with New game as the control that is clicked, and in a windowed run the window is put in front after it.
8. **The latency pass** clicks the Warrior and the Settler of a stack alternately and then Clear selection; the first two clicks are the warm-up; it is over when the HUD shows the target context's panels and marker.
9. **Parity** is the visible panels (live, visible Controls named `hud-*` that the matrix lists) against the matrix's row for the context the game is in, checked at rest after every switch and every setup; a run passes if all of its checks (93 in the rehearsal) match and all seven contexts were seen.
10. **The unhandled JavaScript errors** of the `errors` rule are the errors the application reports at the end (the host's `errors`); the scenario installs no tracker of rejections, because that would put a handler in arm C alone.
11. **The FPS without a limit** is the frames of the measured occurrences over the time they took (above).
12. **A rest** is six frames (`SETTLE_FRAMES`) between intents, the same number as the turn lane's rule for a quiet application (`STABLE_FRAMES` of `tests/frontier-turn-probe.gd`), and the same in the three arms. It is a rule and not a check that the React Native pump is idle.
13. **The package** is the provisioned copy as built (without the engine's import cache and without the scenario), the **script** is the hash of the scenario's files and its support files, and the binary is the engine's executable: a rehearsal's stand-ins for the Release export's.

## The campaign

Part 2 of the criterion `execucao`: the orchestrator of the whole comparative campaign, which plays the protocol's sequence in the two lanes (`runs.sequence`, `runs.lanes`), judges every attempt, redoes
the rejected ones in their slots, waits for a quiet machine, keeps its state after every attempt so that an interrupted campaign continues, gates everything on the instrument's self-check, and runs through
a launcher that can be swapped. **No campaign was run**: it needs the Release launcher (V05-07) and a quiet window that the user reserves ([What is missing](#what-is-missing-for-the-campaign)). What was
run is the campaign against a fake launcher (Node), and a short headless rehearsal in Debug (below). Nothing in this section states a result.

| File | What it holds |
| --- | --- |
| `scripts/frontier-comparison-campaign.mjs` | The command line and the orchestrator (`runCampaign`): the loop, the files it writes, the resume. |
| `scripts/frontier-comparison-campaign-state.mjs` | The state machine, pure: the plan, the verdict of an attempt, the stops, the next step, the checks of a resume, the summary. |
| `scripts/frontier-comparison-campaign-load.mjs` | The wait for the load, with the clock and the reading injectable. |
| `scripts/frontier-comparison-campaign-instrument.mjs` | The self-check as the gate: the probe in the campaign's engine, headless or in a window, then the oracle. |
| `scripts/frontier-comparison-campaign-lock.mjs` | The lock against two campaigns on one machine. |
| `scripts/frontier-comparison-campaign-launchers.mjs` | The launcher interface; the Debug launcher (over part 1's runner) and the Release launcher (an extension point that refuses). |
| `tests/frontier-comparison-campaign.test.mjs` | Node only: the whole campaign against a fake launcher (part of `npm run test:contracts`). |
| `tests/frontier-comparison-campaign-state.test.mjs` | Node only: the plan, the next step on states written by hand, the stops, the resume's checks, the wait for the load. |
| `tests/frontier-comparison-campaign-guards.test.mjs` | Node only: the lock, and the self-check in a headless or a windowed lane against a probe and an oracle the test supplies. |
| `tests/frontier-comparison-campaign-fake.mjs` | The fake launcher, a self-check that passes or fails, a clock and a load average the tests control. |
| `tests/frontier-comparison-campaign-native.test.mjs` | Native: the short rehearsal (`npm run test:frontier-comparison-run`). |

`scripts/frontier-comparison-run.mjs` now exports three things that were its own (`PROTOCOL_FILE`, `registeredOf`, `git`) and one it factored out of `rehearse` (`environmentOf`, the display, renderer and adapter
that its provenance words); `rehearse` behaves as before. Part 1's window rule (`scripts/frontier-comparison-run-windows.mjs`, `derivedOf`) now returns its `problems` as `{code, message}`
(`config-waits`, `config-idle-frames`, `occurrence-unended`, `sample-missing`, `idle-frames`; `analyse` adds `report-format`), so that the campaign chooses by the code and not by the words of a message; the
messages are the same and the rehearsal's behaviour is unchanged. **Nothing was exported from the analysis' modules**: `assessValidity`, `campaignErrors`, `proseRulesOf` and `slotsOf` were already exported,
and no rule of validity is written here.

```sh
node scripts/frontier-comparison-campaign.mjs --campaign --lanes presented,unlimited --build release --out <dir> [--resume] [--max-wait <s>]
node scripts/frontier-comparison-campaign.mjs --campaign --lanes presented --build debug --rehearsal --slots 1-3 --assume-refresh-hz 60 --max-wait 0 --out <dir>
```

`--build debug` needs `--rehearsal`, which marks the campaign as one; `--slots` and `--assume-refresh-hz` are rehearsal-only (a campaign runs every slot and reads the refresh rate back, never assumes it);
`--build release` uses the Release launcher. `--max-wait` is the seconds to wait for a quiet machine before each execution (default 1800).

### The state machine

```text
prepare launcher ─▶ self-check ─▶ [failed: nothing runs; stopped by `instrument`]
        └▶ next slot of the plan ─▶ wait for load ─▶ launch (a fresh process) ─▶ record ─▶ judge ─▶ write the state ─┐
                 ▲                                                                                                    │
                 └───── accepted: the next slot │ rejected: the same slot, attempt + 1 (at most 3) │ stopped │ done ◀──┘
```

- **The plan** is the sequence of the protocol (`ABC CAB BCA` four times, 36 slots) in the first lane, then in the next; `--slots a-b` limits the slots of each lane (a rehearsal's short run).
- **The verdict** of an attempt is the analysis': the campaign that the state makes (its executions, numbered 1, 2, ... in each slot) goes through `assessValidity`, and the attempt is accepted if no rule
  rejects it. `load`, `not-presented`, `not-the-registered-build`, `other-game`, `errors`, `parity` and `incomplete` are the analysis' (`scripts/frontier-comparison-validity.mjs`); the reasons are its
  `{rule, clause, ...values}`. A rejected attempt stays in the state and in `raw/` with its load readings and its reasons.
- **The redo** takes the place of the rejected attempt: the next launch is the same slot with the next attempt number, before the slot after it.
- **The stops** are the ones the analysis reports (`validity.stopped`: a slot whose attempts are used up, a second `other-game` in one arm, an instrument that did not pass), plus three that it cannot see: a slot
  used up counting an attempt that wrote no report, a scenario that waited with numbers other than the protocol's (the problems coded `config-waits` and `config-idle-frames`), and an engine or a display that is not
  the one the self-check ran on. A stopped
  campaign still writes its campaign and its report (status `stopped`, no statistic).
- **The unlimited lane** is N/A from the first attempt whose vsync did not read back `DISABLED`, and its remaining slots do not run (`runs.lanes`).
- **A rehearsal redoes nothing**: each slot runs once, whatever the rules said, so that the rejections it exists to show (the Debug build, the headless display, the load of a busy machine) can be seen.

### The self-check gate

At the start of a campaign (not of a resume, unless the check had not passed) the probe `tests/cpu-time-instrument-probe.gd` runs in the engine of the launcher, and the oracle
`tests/cpu-time-instrument-oracle.mjs` judges its raw report: the probe's process, its own checks, a log with no hidden error and the oracle's verdict must all pass. The campaign records
`instrument.selfCheckPassed` and `instrument.sha256`, the SHA-256 of `tests/cpu-time-instrument.gd` (beside `registered.instrumentSha256`, which the analysis compares: a file that changed after the check
makes the instrument not pass). If the check fails, **no execution runs**, the stop `instrument` is recorded, and the campaign and its report say so.

**The lane of the check is the launcher's.** The gate asks for the engine and the renderer of the campaign, and the campaign proper runs in a window (the presented lane needs a display, and the unlimited lane needs
a window to read the vsync back as `DISABLED`). A launcher that runs in a window (`launcher.windowed`, which the Release launcher will be) gets the windowed check: the same probe with `--windowed`, the same oracle,
and, as in `scripts/cpu-time-instrument-graphics.mjs` (a command line that cannot be imported, so the campaign's `runSelfCheck` runs the same two programs), a window that no display presented is not a measurement and
does not pass (that script exits with 3 for it; the campaign treats it as a failure and stops). A launcher that runs headless, as the Debug one does, gets the headless check (`npm run test:cpu-time-instrument`'s),
and the campaign's deviations say so. The state keeps the probe's provenance, and the campaign **stops if a scenario reports another engine build, display server, rendering driver or method, or adapter than the probe
did**, so a headless check cannot vouch for a window. The windowed check has been tested with the probe and the oracle replaced (`tests/frontier-comparison-campaign-guards.test.mjs`); it has not been run for real.

### The load

Before each execution the campaign reads `sysctl -n vm.loadavg` (the 1-minute average) every 5 seconds until it is **not above** `runs.load.limit1MinuteAverage` (2.0, read from the protocol; the rule rejects what is
above the limit) or `--max-wait` seconds have passed. The wait goes into the state (`waited`: the first and last reading, the number of readings, the seconds, whether it timed out). If it runs out the attempt runs anyway:
the readings that the rule judges are the launcher's, taken right before the process starts and right after it ends, and they are recorded exactly as read (`load.before`, `load.after`). The wait is a courtesy to
the attempts of a slot, not a guarantee. The clock and the reading are injectable, which is how the tests drive it.

### The lock

A lock file in the system's temporary directory (`godot-fabric-frontier-comparison-campaign.lock`) holds the pid and the `--out` of the campaign that is running. A campaign, or a resume, that finds the lock held by
a live pid refuses to begin and names the holder; a lock whose pid is dead belongs to a campaign that was killed and is taken over; the lock is released when the campaign ends, however it ends, and only by the campaign
that holds it. A lock that cannot be read is refused rather than guessed at. It is taken before the launcher is prepared, because provisioning a copy of the consumer is a Godot process too. It guards one machine
against two campaigns; the protocol's load rule is what catches the other lanes of the repository.

### The state and the resume

`<out>/campaign-state.json` is written after every attempt, atomically (a temporary file, renamed over it), and holds: the options, the protocol's hash, the launcher's registration (the seed, the game's
hashes, the instrument's file and, for each arm, the binary, package and script), the self-check, the engine, and every attempt (its slot, arm and number, the wait, the load before and after, the hashes of the files
it ran, the exit code, the execution object the analysis reads, the verdict, the anomalies and the paths of `raw/<lane>-<slot>-<attempt>.json` and `.log`), and `unreported`, the list of the attempts that wrote no report
(below). The raw files are written before the state, so the state never names a file that is not there. `--resume` reads it, runs the launcher's `prepare()` again and **refuses** unless the protocol, the script, the binary and the package have the same hashes (and the rest
of what was registered, and the options that decide which executions exist), then continues from the first slot without an accepted attempt; the self-check is not repeated unless it had not passed. A campaign
resumed after an interruption ends with the same `campaign.json` and `report.json`, byte for byte, as one that was never interrupted (`tests/frontier-comparison-campaign.test.mjs`, which kills the fake
launcher after 1, 2, 38 and 74 attempts and twice in one campaign). The record of a resume is in the state (`resumes`), never in the campaign.

At the end: `campaign.json` (strictly the analysis' format), `report.json` (the analysis' report), `summary.json` (which also carries `unreported`) and, in a rehearsal, `rehearsal.json` (the mark, beside the campaign, as in part 1).

### The launcher

```text
launcher.build                    "debug" | "release", the build recorded in each execution
launcher.windowed                 whether its processes run in a window; the self-check runs in the same mode
await launcher.prepare()          {engine, registered, packages, deviations}: ready, and what is registered before the first execution; may refuse
await launcher.launch({arm, lane, slot, attempt})
                                  {report, exitCode, signal, log, load: {before, after}, hashes: {binary, package, script}, seconds}: ONE fresh process
await launcher.cleanup()
```

- **Debug** reuses part 1: the provisioned copy of civ-lite with the HUD built and the scenario copied in (`prepareProject`), and `launchScenario` (`--path`, headless). It registers what it measured, as the rehearsal
  does, and its deviations say so.
- **Release** is an extension point and **refuses**: "The Release launcher is not defined yet: the campaign needs the Release export of the civ-lite game in the three arms (V05-07 ...)". It refuses in
  `prepare()`, before the self-check, before any directory is made and before any process starts. When V05-07 says how the scenario runs inside an exported `.app`, it is this launcher that gets the path; the campaign does not change.
- **The fake**, in the tests, plays programmable synthetic executions: a load above the limit, an undrawn presented window, an error, another game, an incomplete window, a process that wrote no report, a vsync
  that reads back `ENABLED`, and an interruption.

### Readings of the protocol that part 2 chose

None changes a number of the protocol; each decides how a sentence meets the orchestrator.

1. **The lanes run one after the other**, the presented lane's 36 slots and then the unlimited lane's (the protocol says only that the unlimited lane "keeps the same sequence"). The presented lane carries the decision, so
   it comes first and a stop there spares the second lane.
2. **"Above the limit" is the limit of 2.0 itself being quiet**, in the wait as in the rule (`tests/frontier-comparison-validity.test.mjs` pins the rule).
3. **The unlimited lane is N/A for the lane, not only for the execution**, when the vsync does not read back `DISABLED` ("the lane is N/A and is not run further"); `vsync-reading` still does not reject the attempt.
4. **An attempt whose process wrote no report** (a crash, a timeout) is a rejection by `errors` that the campaign counts against the 3 attempts and redoes, but the format has no execution object for a run with no
   report and the campaign does not invent one (a refresh rate cannot be made up). It stays in the state and in `raw/<...>.log`, is left out of `executions`, which are renumbered 1, 2, ... among the ones that
   exist, and the campaign's deviations name it. The analysis then sees fewer attempts than were made; the stop on three used-up attempts is the orchestrator's. **The state and `summary.json` list these
   attempts one by one** (`unreported`: the slot, the arm, the attempt, the `errors` reason with its clause, the exit code, the signal and the path of the log), so that whoever reads the summary sees every
   attempt that was made.
5. **`aborted` and `anomalies` of the scenario's report are recorded and reject nothing**: the list of invalidation rules is closed, and an aborted scenario already ends with exit code 1 (`errors`).
6. **A rehearsal redoes nothing** (above), so its three slots are three attempts.
7. **A resume with another instrument file is refused**: the file is part of the script's hash, so the executions after it would not be the same experiment, and the registration cannot be redone in the middle of a campaign.
8. **`--windowed` is not offered by the campaign's command line**: a window needs the user away, and part 1's runner already does the windowed rehearsals. The Debug launcher is headless; a launcher that is
   windowed (the Release one) gets the windowed self-check, and the engine comparison covers the display.

### The short rehearsal

`npm run test:frontier-comparison-run` runs it (`tests/frontier-comparison-campaign-native.test.mjs`): `--slots 1-3` of the presented lane, headless, in Debug, with the real self-check, the real load and the real
clock, on the machine of the other lanes (the 1-minute load was 4.3 to 6.8). It is a rehearsal and **no number of it is a measurement of an arm**. On the run kept in the
[evidence record](../evidence/frontier-comparison-campaign/README.md) (the pinned `f9aabb3` merged with `origin/main`, working tree clean): the self-check (probe and oracle) passed in about 20 s (20.4 to 20.7 over the runs) and recorded the instrument's SHA-256 `4bdcda83…`, and the engine, display server, driver, method and adapter that the probe
recorded were the scenario's, so the campaign did not stop on them; the three attempts (A, B, C, one slot each; about 52, 57 and 75 to 82 s over the runs) exited 0 with no anomaly and no problem; the campaign passed `campaignErrors` and the analysis read it (status `incomplete`: no attempt was accepted, so no arm has the 10 accepted executions the presented lane asks for). Each attempt was rejected for
the reasons a rehearsal must show: `not-the-registered-build:build` (Debug), `not-presented` (a headless display draws nothing and paces nothing: `intent-not-drawn`, `idle-not-drawn`, `not-paced`) and `load` (before and
after). Nothing else fired, and the waits (`--max-wait 0`) timed out on the busy machine, which is what they were given zero seconds to avoid.

The same rehearsal through the command line gave the same three rejections, and the analysis' own command line (`scripts/frontier-comparison-analysis.mjs`) read the written `campaign.json` and produced a
`report.json` of the same bytes. **A real interruption** was tried twice, by hand: the command line was killed with `SIGKILL` while the second attempt was running (the state on disk held the first), and
`--resume` provisioned the consumer again, found the protocol, script, binary and package with the registered hashes, did not repeat the self-check, started at slot 2 and ended with the three attempts, in the
format. **And the refusal was seen for real, twice.** The Debug launcher's package is the provisioned copy, and `scripts/pack-addon.mjs` writes into it a `manifest.json` that holds the repository's `HEAD` and whether
its working tree is dirty (`sourceCommit`, `sourceDirty`), and a copy of the repository's `node_modules`. So the package hash changes with a commit, with any change in the working tree (a new untracked folder is
enough: the resume of the evidence record's interrupted rehearsal, with its folder in `docs/evidence/` untracked, was refused with "arm A package: the state registered 9a12994c…, now ea5dbecf…", and accepted once
the tree was clean again) and with a write into `node_modules` (a finished rehearsal resumed after `npm run check:static` was refused with "e658b3bb…, now b837c07d…"; the one file of the copied inputs that was newer
than the rehearsal was `node_modules/@fallow-cli/darwin-arm64/.fallow-verified`, which `fallow` writes the first time it runs). Two copies provisioned back to back, with nothing between them, hash the same. **A
Debug rehearsal can therefore be resumed only if the commit, the working tree and `node_modules` are as they were when it began;** a Release export is one file and has no such dependence. The second interruption and the second
refusal (the ones on the merged tree) are recorded in the [evidence record](../evidence/frontier-comparison-campaign/README.md).

## What is missing for the campaign

- **V05-07, the Release export of the civ-lite game** in the three arms (A and B too): the hashes of the binary and the package, the size of the export twice, **and the Release launcher** (above). The scenario is a
  `SceneTree` script that is run with `-s` from a project; how it starts inside an exported package (an export template may not run `-s`, and the scenario may have to be the exported project's main scene or an
  autoload) is **open** and belongs to that slice. The question was put to the owner of that slice and has no answer yet. Until it does, `--build release` refuses.
- **A quiet machine and the user away**: a 1-minute load average of 2.0 or less before and after every execution, and a presented window for the 36 executions of the presented lane; the repository's other lanes
  run on this one (4.3 to 6.8 in the short rehearsal, 4.87 to 6.83 in the windowed one). The campaign waits for the load but cannot make the machine quiet.
- **The instrument's windowed self-check, run for real**, on the campaign's machine: a campaign through a windowed launcher runs it first (the probe with `--windowed`, a window in front, the user away) and stops if
  it does not pass or no display presented the window; the code is there and tested with the probe replaced, and was never run. The Debug rehearsal runs the headless check and says so in its deviations.
- **A representation, in the analysis' format, of an attempt that wrote no report.** The format holds an execution object, whose refresh rate must be positive and whose windows and readings must exist; a process that
  crashed or hit its timeout has none of that, and the campaign does not make it up. Such an attempt counts against the 3 attempts of its slot, is redone, and is left out of `executions`; **if it happens in the real
  campaign, `summary.json` and `campaign-state.json` carry it** (`unreported`, with the log kept under `raw/`), and the report's counts of attempts are lower by those. An amendment of the format would put it in the data.
- **The registration before the first execution** for the Release: a rehearsal registers what it measured; a campaign needs the Release launcher to register the hashes of the three exports in `prepare()`.
- **The raw data under `docs/evidence/`**: a campaign's `raw/` holds about 0.3 MB per attempt (about 22 MB for 75 attempts); where it is kept and how it is published is for the slice that runs it.

## Limits

- Every number of the rehearsals is a Debug number on a busy machine, one execution per arm. They show that the script runs and what it counts, nothing of how an arm performs, and no analysis has run on the data of a campaign.
- The six frames of rest are a rule, not a check that the React Native HUD has finished: the windowed rehearsal was the first run in which a pump that is still busy would show in the frames after a window; it
  recorded no anomaly and every parity check matched, which does not prove that the pump was idle.
- Arms A and B have no host, so the scenario's readings of C that need it (the heap, the views, the errors) exist only there, as the protocol says.
- The campaign has run against a fake launcher (72 to 75 synthetic attempts, in Node) and a Debug rehearsal of three attempts. The Release launcher, the 72 attempts of a real campaign and a wait that ends because
  the machine became quiet have not been seen, and a resume after a real interruption was seen once, in the Debug rehearsal ([above](#the-short-rehearsal)). The fake proves the orchestrator's logic, not the machine's behaviour.
- The lock keeps a second campaign from starting on the machine; it cannot keep another lane of the repository (a suite, an export) from running, and the load rule is what catches that.
- The event burst and the stress window are measured in the three arms: in the burst the counters agree at the first read in every turn, so every burst is the minimum of five frames, headless and windowed alike
  (C included, in both lanes). A windowed loop, with the host's pump and the JavaScript runtime draining at the pace of a display, may show a burst longer than five frames in C; that is what the rule is for, and
  it has not been seen yet.

## Reproducing

```sh
node --test tests/frontier-comparison-run.test.mjs                   # Node only; part of npm run test:contracts
npm run test:frontier-comparison-run                                   # native, headless: the player, the rehearsal in the three arms
node scripts/frontier-comparison-run.mjs --rehearsal --arms A,B,C --lane presented --assume-refresh-hz 60 --out build/frontier-comparison-rehearsal
node scripts/frontier-comparison-analysis.mjs --check-format build/frontier-comparison-rehearsal/campaign.json
node scripts/frontier-comparison-run.mjs --rehearsal --arms A,B,C --lane presented --windowed --out <directory>   # windowed: opens a window in front, the user must be away
node scripts/frontier-comparison-run.mjs --rehearsal --arms A,B,C --lane unlimited --windowed --out <directory>
node --test tests/frontier-comparison-campaign.test.mjs tests/frontier-comparison-campaign-state.test.mjs   # Node only, fake launcher; part of npm run test:contracts
npm run test:frontier-comparison-run                                   # also the campaign's short rehearsal: headless, Debug, --slots 1-3 of the presented lane, the real self-check
node scripts/frontier-comparison-campaign.mjs --campaign --lanes presented --build debug --rehearsal --slots 1-3 --assume-refresh-hz 60 --max-wait 0 --out build/frontier-comparison-campaign-rehearsal
node scripts/frontier-comparison-campaign.mjs --campaign --lanes presented --build debug --rehearsal --slots 1-3 --assume-refresh-hz 60 --max-wait 0 --out build/frontier-comparison-campaign-rehearsal --resume
node scripts/frontier-comparison-campaign.mjs --campaign --lanes presented,unlimited --build release --out <directory>   # refuses until V05-07 defines the Release launcher
```
