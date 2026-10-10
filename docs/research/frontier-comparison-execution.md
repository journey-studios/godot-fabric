# The execution of the final comparison, part 1: the scenario, the player and the rehearsal in the three arms

Status: documentation, a scenario in GDScript, a scripted player, a runner in Node and their tests. It is the first part of the criterion `execucao` of V05-10 and **closes nothing**: no comparative execution has
happened, and **this note states no result**. The rehearsal it describes ran the scenario once in each arm, in a Debug build, headless, on a provisioned copy of the consumer; the object it produces is marked as a
rehearsal, lives apart from any campaign, and every execution in it is rejected by the analysis as a Debug build, which is what a rehearsal must show. No number in this note is a measurement of an arm for the
comparison. The campaign needs the Release export of the game in the three arms (V05-07), the second part of this criterion and a quiet window that the user reserves ([What is missing](#what-is-missing-for-the-campaign)).
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
| `stress` | 2 + 30 rounds: `stress_begin()`, 20 `stress_step()` in consecutive frames, `stress_end()`. | `windows` `stress`. The hooks are not delivered yet: the window is recorded as unavailable. |
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
estado do jogo mudou", 429 decisions) and its [`report.json`](../evidence/civ-lite-ui/report.json) (`afterTheChange`: `finalHash`, `trailHash`, `previousFinalHash`, `previousTrailHash`). **[`frontier-soak.md`](frontier-soak.md)
(lines 96 to 100) still describes the run before #93**, which added the three events of turn 5 and moved the state of the game: its `a35c55f2…` and `fe9d4f36…` are the previous run's. This note does not edit it; it is
a correction of its own.

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
| `ai-phase` | In the first frame: `Engine.get_process_frames()`, the call of `GameServices.end_turn()` (the intent itself, which the game and the HUDs pay for) and one trace entry. In the others: waiting for the next frame and comparing two integers. The player's decision, with the snapshot it reads, is taken in a frame of rest before. | a trace entry is 0.3 to 0.8 µs |
| `event-burst` | The handler of `turn_ended` (a counter, the frame number, one trace entry). From the fifth frame of the burst on, one read of each counter per frame: `stats()` of the HUD and `notifications_emitted()` of the game; arm A, which has no HUD, reads only the second, from the fourth frame, to have two readings to compare. | `stats()` of the native HUD is 0.6 to 2.0 µs; the other hook is not delivered |
| `context-switches` | In the first frame: one trace entry and the call of the intent. In the other two: waiting. The context reached is read after the window, at rest. | the same trace entry |
| `stress` | In every frame: one trace entry and the call of the hook. | the same trace entry |
| idle | Waiting for the next frame, as everywhere. | none |

The wait for the next frame is the same in every frame of the run, idle included, so it is in the instrument's floor and not in a difference. Nothing evaluates JavaScript, nothing reads the Surface's snapshot and nothing spawns
a process in a window. In C the only call into the host's JavaScript side is the forced collection of Hermes' heap, once, after the drain, which is the reading at rest of the turn lane (`tests/performance-sampler.gd`).
**The `stats()` of the HUD of C is not to be read by evaluating JavaScript** (that would charge arm C alone, the trap of #108); the scenario reads a counter that the HUD exposes to GDScript, or it records the window as
unavailable.

## What each reading costs, and where it falls

Measured by the scenario in the rehearsal, on a machine that was not quiet, headless; they are the costs of the readings and not of any arm. Only the last row can fall inside a measured frame.

| Reading | When it is taken | Cost | In a measured frame? |
| --- | --- | --- | --- |
| Resident memory (`ps -o rss=`) | At rest, after the boot, the idle, the replay, the soak, the switches, the latency, the stress and the end; the report keeps the last (`end`) and the maximum (`max`) | 4.6 to 16.6 ms (a process is spawned) | No. Taken in a frame that belongs to no window; the idle window begins six frames after the one that spawned the process |
| Nodes of the SceneTree | At the end | 3 to 75 µs | No |
| Hermes' live heap after a forced collection, and the Fabric native views (arm C) | At the end, after the drain, by the turn lane's reading at rest (`Sampler.sample()`) | 15 to 26 ms | No |
| Parity (the visible panels against the context matrix) | At rest, after each switch of the cycle, after each setup and at the boot: 93 checks in a run, in the seven contexts | one walk of the SceneTree for the Controls named `hud-*`, 9 to 22 µs | No |
| Time to the interactive HUD | At the boot | the frame's own clock reading | No: the boot belongs to no window |
| The player's snapshot (`get_snapshot()`) | At rest, before each decision, and after each switch | 50 to 133 µs | No |
| The flags of validity (drew after every measured intent, the idle frames drawn) | After the run, from the instrument's columns | none during the run | No |
| `stats()` of the HUD and `notifications_emitted()` of the game | Each frame of the event burst from its fifth on, when the hooks exist | 0.6 to 2.0 µs for the native HUD's; the rest not delivered | Yes, by design: the window ends when they agree |

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

The scenario is written against the contract and detects each hook by name; a hook that is not there is reported, and the window that needs it is recorded as unavailable with the reason, never invented.

| Hook | Where | State at this commit | What the scenario does |
| --- | --- | --- | --- |
| `stats() -> {snapshots, context, events}` | the HUD of B and C | B has `stats()` with `{calls, screen, context}` (no `snapshots`, no `events`); C's `FabricSurface` has no such method | `event-burst` unavailable in B and C: the HUD has no `events` counter that GDScript can read without evaluating JavaScript in a measured frame |
| `notifications_emitted() -> int` | `GameServices` | absent | `event-burst` unavailable in A, B and C |
| `stress_begin()`, `stress_step()`, `stress_end()` | `GameServices` | absent | `stress` unavailable in A, B and C: no round is played |

When the hooks land the windows come in by themselves: `events-settled` is read from the fifth frame of the burst on, comparing the HUD's `events` with the game's `notifications_emitted()` (in A, which has no HUD, the
emitter's counter against its own value one frame earlier, read from the fourth frame on: only the game's side, as the specification of the window says, and independent of whether the game counts a notification
before or after it emits it), and a stress round is `stress_begin()`, 20 `stress_step()` in consecutive frames and
`stress_end()`, with the window from the first to the second frame after the last step. The native test pins the unavailable state, and then runs those paths once with **stand-ins** that it writes into a copy of the
game and of the native HUD for the length of the test (a counter that `notifications_emitted()` and the HUD's `events` both read, and three hooks that answer `ok` and do nothing): in A and B the event burst is measured
(100 occurrences, 98 of them measured, five frames each, because the stand-ins agree at once) and so is the stress window (32 rounds, 30 measured, 23 frames each: the begin, 20 steps and the 2 frames after the last).
That shows the plumbing of the scenario, the trace and the window rule work with hooks; it says nothing about the real hooks, which do not exist yet, and the first run with them is the first run of the
reads that depend on what they cost.

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
`incomplete` for the windows that wait for a hook, and `load` when the machine is not quiet (the repository's other lanes run on it: the 1-minute load was above 5 while it ran, against the limit of 2.0).

**The refresh rate.** A headless display reads `-1` and the format requires a positive one (and the analysis refuses `refreshHz <= 0`), so the headless rehearsal is given `--assume-refresh-hz 60`; the value is
written in the campaign's deviations and in `rehearsal.json`. Without it the runner stops with the format's own error. The windowed rehearsal reads the real one.

**What it ran** (headless, Debug, one execution per arm, on a machine with a load above 5; the seconds include the 600 idle frames, the replay, the soak, the switches, the latency and the readings):

| | A | B | C |
| --- | ---: | ---: | ---: |
| Seconds | 39.9 | 43.8 | 44.9 |
| Process frames | 5,731 | 6,291 | 6,385 |
| Replay: steps and golden hash | 77, `cb7ab974…` | 77, `cb7ab974…` | 77, `cb7ab974…` |
| Soak: turns, decisions, final hash | 100, 429, `0b21c332…` | 100, 429, `0b21c332…` | 100, 429, `0b21c332…` |
| Idle window | 600 frames | 600 | 600 |
| `ai-phase` | 100 occurrences (2 + 98), 500 frames | the same | the same |
| `event-burst` | unavailable (hook) | unavailable (hook) | unavailable (hook) |
| `context-switches` | 74 (24 + 50), 222 frames | the same | the same |
| `stress` | unavailable (hooks) | unavailable (hooks) | unavailable (hooks) |
| Latency clicks | not measured in A | 2 + 30 | 2 + 30 |
| Parity | not measured in A | 93 checks, 7 contexts, all match | 93 checks, 7 contexts, all match |
| Time to the interactive HUD (ms, headless, not a result) | not measured in A | 303 | 577 |
| Scene nodes at the end | 4 | 31 | 29 |
| Hermes heap, native views | | | 2,286,680 bytes, 17 |
| Errors (script, Godot log, JavaScript), exit code | 0, 0, 0, exit 0 | 0, 0, 0, exit 0 | 0, 0, 0, exit 0 |

The unlimited lane was run on arm A: the vsync was requested `DISABLED` and read back, and the headless display server keeps `ENABLED`, which the scenario records (`vsync-reading`: the FPS band is N/A for that execution).
**Nothing above says how an arm performs.** The windowed rehearsal, which is what shows a presented loop, waits for the user's pause.

## Readings of the protocol that were chosen

Where the protocol is a sentence, or says nothing, and the scenario had to decide. None of them changes a number of the protocol; each decides how a sentence meets the game.

1. **The replay has 77 steps**, as the amendment 3 of the protocol says; the scenario plays `Replay.STEPS`, whose length the native test asserts.
2. **The soak's hashes** are the soak of JavaScript's today (above), not the ones `frontier-soak.md` still prints.
3. **The occurrence of the dialog is the intent that leaves it**, as the amendment 4 of the protocol writes it, and `found_city` is a setup and not an occurrence, because it is not a selection intent.
4. **12 switches a round and 7 rounds** (6 whole and 2 switches of the seventh), because the contexts do not fit in a game and the dialog needs 4 End Turns outside every window.
5. **The window of the AI phase is five frames**, because the first phase of the job runs in the frame that accepts End Turn, and `turn_ended` is delivered by the frame of the sixth.
6. **The burst of a turn ends with the frame before the first at whose start the counters agree**, and never before its fifth frame; in A, which has no HUD, the agreement is the emitter's counter not having moved since the previous frame's reading.7. **The time to the interactive HUD** is on the engine's clock, with New game as the control that is clicked, and in a windowed run the window is put in front after it.
8. **The latency pass** clicks the Warrior and the Settler of a stack alternately and then Clear selection; the first two clicks are the warm-up; it is over when the HUD shows the target context's panels and marker.
9. **Parity** is the visible panels (live, visible Controls named `hud-*` that the matrix lists) against the matrix's row for the context the game is in, checked at rest after every switch and every setup; a run passes if all of its checks (93 in the rehearsal) match and all seven contexts were seen.
10. **The unhandled JavaScript errors** of the `errors` rule are the errors the application reports at the end (the host's `errors`); the scenario installs no tracker of rejections, because that would put a handler in arm C alone.
11. **The FPS without a limit** is the frames of the measured occurrences over the time they took (above).
12. **A rest** is six frames (`SETTLE_FRAMES`) between intents, the same number as the turn lane's rule for a quiet application (`STABLE_FRAMES` of `tests/frontier-turn-probe.gd`), and the same in the three arms. It is a rule and not a check that the React Native pump is idle.
13. **The package** is the provisioned copy as built (without the engine's import cache and without the scenario), the **script** is the hash of the scenario's files and its support files, and the binary is the engine's executable: a rehearsal's stand-ins for the Release export's.

## What is missing for the campaign

- **The second part of the criterion**: the sequence of 36 executions in each lane (the Latin square), the attempts (at most 3 a slot) and the redo by the load, the two lanes, the registration of the hashes before the
  first execution, the raw data under `docs/evidence/`, and the unlimited lane's reading of the vsync.
- **V05-07, the Release export of the civ-lite game** in the three arms (A and B too): the hashes of the binary and the package, the size of the export twice. The scenario is a `SceneTree` script that is run with
  `-s` from a project; how it starts inside an exported package (an export template may not run `-s`, and the scenario may have to be the exported project's main scene or an autoload) is **open** and belongs to that
  slice.
- **The stress and events hooks**, and the HUD counters for B and C, so that `event-burst` and `stress` are measurable; the first run with them is the first run of those lines.
- **The instrument's self-check** on the campaign's machine, and its hash registered (`cpu-time-instrument` `gate`).
- **A quiet machine**: a 1-minute load average of 2.0 or less before and after every execution, and a presented window; the repository's other lanes run on this one.
- **The windowed rehearsal**, once, when the user pauses the board.
- **A correction of `frontier-soak.md`**, which still describes the run before #93.

## Limits

- Every number of the rehearsal is a headless Debug number on a busy machine. They show that the script runs and what it counts, nothing of how an arm performs, and no analysis has run on the data of a campaign.
- The six frames of rest are a rule, not a check that the React Native HUD has finished: the windowed rehearsal is the first run in which a pump that is still busy would show in the frames after a window.
- Arms A and B have no host, so the scenario's readings of C that need it (the heap, the views, the errors) exist only there, as the protocol says.
- The paths of the scenario that wait for the hooks (the burst's reads of the counters, the stress rounds) are written against the contract and were run only with the test's stand-ins, in A and B; arm C has no counter to
  read yet, so they were not run there at all.

## Reproducing

```sh
node --test tests/frontier-comparison-run.test.mjs                   # Node only; part of npm run test:contracts
npm run test:frontier-comparison-run                                   # native, headless: the player, the rehearsal in the three arms
node scripts/frontier-comparison-run.mjs --rehearsal --arms A,B,C --lane presented --assume-refresh-hz 60 --out build/frontier-comparison-rehearsal
node scripts/frontier-comparison-analysis.mjs --check-format build/frontier-comparison-rehearsal/campaign.json
```
