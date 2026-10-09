# The turn on the Frontier game as a consumer has it: clicks to panels, the sliced AI's frames, and the heap, memory and native nodes of each transition

Status: implemented and executed locally on macOS arm64 (Apple M3 Pro) against pinned RN 0.87.1, Hermes 250829098.0.17 and official Godot 4.7.2, headless for the exact counts and the CPU durations with their
provenance and in a real window (local, not in CI) for the presented frame time; **the windowed attempt was not presented by the display**, so that lane ended as not presented with no frame-time statistic, and the presented frame time of the turn
is **pending** (see [The windowed lane](#the-windowed-lane)). This is the `turno` criterion of the 0.5 Frontier milestone's V05-06: the click to the panel, the frames of a turn with the sliced AI, and the Hermes heap, resident memory and native nodes of each
transition, on the game's consumer. The criterion is **not closed** by this slice (the presented frame time is part of it, as it is of `baseline`), and the windowed part of `baseline` and `congelado` stay open (see [What is left](#what-is-left)).
The slice changes no C++ and no file of the template (`consumers/civ-lite`), so there is no preceding host to run it on; the control is the four retained sabotages. The [evidence record](../evidence/frontier-turn/README.md) pins the execution at `116a72f`; hosted CI and the Pages publication are pending.

## The question

The criterion (`dashboard/migration.json`, V05-06, `turno`): "Latência clique até painel, tempo de quadro em turno com IA fatiada, heap Hermes, RSS e nós nativos por transição, no consumidor do jogo".
The baseline ([frontier-baseline.md](frontier-baseline.md)) measured the swap of a fixture's panel and the soak ([frontier-soak.md](frontier-soak.md)) played the game for 100 turns under a
fixture HUD; both said that the same measures **on the game's consumer** were open. This slice takes them there: the game is the template that the addon provisions
(`consumers/civ-lite`, [frontier-consumer.md](frontier-consumer.md)), its HUD is the one V05-05 is building, and what is clicked is what a player clicks.

## Sources

- [frontier-baseline.md](frontier-baseline.md) and [frontier-soak.md](frontier-soak.md): the harness this extends. `tests/performance-sampler.gd` takes the reading (the engine's counts, the host's native views, the resident memory and Hermes' heap after a
  forced collection) and is copied into the provisioned project, not rewritten; the heap at rest is judged by `heapAtRest` of `tests/frontier-baseline-oracle.mjs:67` (the median of the last half of the steady rounds against the first's, over
  `HEAP_STEADY_GROWTH_LIMIT_BYTES` = 2,048 bytes, `tests/performance-cases.mjs:22`), imported; the resident memory by the soak's loose rule over `RSS_GROWTH_LIMIT_KB` = 48 MiB (`tests/frontier-soak-cases.mjs:39`), `rssGrowthAtRest` of `tests/frontier-soak-oracle.mjs`, imported. Both are one rule, `growthOfHalves` of `tests/performance-oracle.mjs`, which the baseline, the soak and this lane share and none repeats; the windowed
  lane's validity and statistics are the baseline's `graphicsRunValidity`, `summarizeGraphicsRuns` and `verifyGraphicsReceipt` (`tests/frontier-baseline-oracle.mjs:285`, `:356`, `:301`), imported and not copied.
- `consumers/civ-lite/hud_validation.gd`: the table of contexts to panels (`:33`), the validation device and the size of the viewport (`:287`, `:289`) and the pointer events through the viewport (`:217`) are the probe's model: it preloads that file in the provisioned copy (`res://hud_validation.gd`) and reads the table, the panels, the device, the size of the viewport and the geometry of the map from its constants, and the runner reads the size from it, so none of them
  is repeated in the probe. The JavaScript side has the table once, in `tests/civ-lite-ui-oracle.mjs`, which `tests/frontier-turn-cases.mjs` imports; the report echoes the table the probe used so that the oracle compares the two sources.
  `native/application_runtime.cpp:2091` and `:2872`: a Surface whose host has `validation_input_device` hears only the events of that device, which is why the probe's clicks are the HUD's and the real pointer's are not.
- `consumers/civ-lite/services/game_services.gd`: `end_turn` (`:210`) accepts the turn as a job; `_process` (`:223`) calls `advance_job` (`:230`), which runs one phase and publishes a snapshot, and `_finish_job` (`:243`) publishes `turn_ended` once, ahead of the
  snapshot of the turn that begins. `consumers/civ-lite/world/world.gd:76`: the map hears a left click in `_unhandled_input` and asks the node for `select_tile`. `consumers/civ-lite/game/turn.gd:13` and `rules.gd:63`: the refresh phase clears the
  selection and raises the event when turn 5 begins. [frontier-services.md](frontier-services.md) and [frontier-game.md](frontier-game.md): the phases, the seven contexts, the intents and their refusals.
- `native/fabric_application.cpp:111` and `:255`: the application always processes and pumps the runtime in its `_process`; `native/fabric_surface.cpp:155` and `:163`: the Surface hears the pointer in `_input` and claims it in `_unhandled_input`.

## The scene, and why it is the provisioned consumer

The measures are taken on **`consumers/civ-lite` as `scripts/consumer-civ-lite-check.mjs` provisions it** and not on a fixture or on the repository's root project: `createHarness({template: "civ-lite", name: "frontier-turn"})` copies the
template into a project of its own, packs the addon into it, and the editor plugin builds `ui/index.tsx` (no Node of its own, no network). Only then does the lane copy three files into the provisioned copy, under
`res://turn_probe/`: the probe (`tests/frontier-turn-probe.gd`), the runner (`tests/frontier-turn-runner.gd`) and the sampler (`tests/performance-sampler.gd`). It runs

```sh
godot --path <provisioned project> --headless -s res://turn_probe/frontier-turn-runner.gd -- --lane=headless
```

The runner is a `SceneTree` script: it puts the template's own `res://main.tscn` in the root (the `GameServices` node with its `Application`, the `World` and the HUD's `FabricSurface`, exactly as `run/main_scene` would), adds the probe beside it and hands the
probe the scene. The addon's application works under that script, so **no autoload was needed** (the fallback of the decision, registering the probe as an autoload of the copy, was not used). The template
and the HUD are untouched: the lane never writes under `consumers/civ-lite/`, the template's own validations stay inert (they run only with `-- --validate` and `-- --validate-hud`), and the test hashes the template's tree before and after every run and
requires it to be the same. What the lane changes it changes in the provisioned copy, which it throws away (the sabotages below).

What this buys over a fixture: the HUD is a function of the game's snapshot, so a transition is a **round trip through the game** (the click reaches Godot, the game changes, publishes a snapshot, React renders it and the host mounts it), not a change of React state.
It also means the numbers move when V05-05 changes the HUD; the exact rules below are written so that they do not (they compare a context with itself and never pin a count).

## The tour

Every click is real: a motion, then a press and a release through `get_viewport().push_input(event, true)` on the validation device 1001 (`hud.set_meta("validation_input_device", 1001)`), the way `hud_validation.gd` drives the HUD. No intent is called on the service to cause the
transition that is measured. A round starts on a **new game, prepared through the services** (the one thing that is not a click, and not measured), rests there, and takes the 16 clicks of the tour, which visit all seven contexts of the game:

| # | Step | The click | Context before to after | Intent it makes |
| ---: | --- | --- | --- | --- |
| 1 | `map-stack` | tile (6, 8) of the map | none to stack | `select_tile` |
| 2 | `select-warrior` | `hud-actions-select_unit-2`, the actions panel | stack to warrior | `select_unit` |
| 3 | `clear-selection` | `hud-actions-clear_selection`, the actions panel | warrior to none | `clear_selection` |
| 4 | `map-stack-again` | tile (6, 8) | none to stack | `select_tile` |
| 5 | `select-settler` | `hud-actions-select_unit-1` | stack to settler | `select_unit` |
| 6 | `map-tile` | tile (9, 8), an empty plain | settler to tile | `select_tile` |
| 7 | `map-stack-third` | tile (6, 8) | tile to stack | `select_tile` |
| 8 | `select-settler-again` | `hud-actions-select_unit-1` | stack to settler | `select_unit` |
| 9 | `found-city` | `hud-actions-found_city-1` | settler to city | `found_city` |
| 10 | `map-tile-again` | tile (9, 8) | city to tile | `select_tile` |
| 11 | `map-city` | tile (6, 8), now the city | tile to city | `select_tile` |
| 12 | `end-turn-1` | `hud-bar-end-turn`, the bar | city to none | `end_turn` |
| 13 | `end-turn-2` | `hud-bar-end-turn` | none to none | `end_turn` |
| 14 | `end-turn-3` | `hud-bar-end-turn` | none to none | `end_turn` |
| 15 | `end-turn-4` | `hud-bar-end-turn` | none to dialog | `end_turn` |
| 16 | `answer-event` | `hud-dialog-choice-welcome`, the dialog | dialog to none | `resolve_event` |

`dialog` **is opened by a click**: the End turn of the fourth turn runs the refresh phase of turn 4, which raises the event when turn 5 begins, and the context becomes `dialog`; `answer-event` is the click on the dialog's only choice. The preparation needed no roteiro (`game/replay.gd`): the tour
starts from the scenario's own start (the Settler and the Warrior stacked on tile (6, 8)), and each click leads to the state of the next. Before each click the pointer moves to its target and the probe waits until the application has done nothing for 6 frames (the hover is published and
rendered *before* the click, not inside it). After the panels show, the probe waits `REST_FRAMES` = 30 idle frames and takes the **reading at rest** with the shared sampler: the engine's counts, the host's native views, the Surface's snapshot (its `nativeTags` and the testIDs it holds), the resident memory and Hermes' heap after a forced
collection, and the HUD's own counters (`FrontierHud.stats()`: the calls it made, the calls the game rejected, its connections).

The tour is repeated `WARMUP_ROUNDS` = 2 times (the baseline's number, in `tests/frontier-turn-cases.mjs`; they are in the raw data, flagged by their round, and left out of the heap and memory rules and of every statistic) and `STEADY_ROUNDS` = 30 more: **480 steady clicks and 120 steady turns** in one process, plus the 32 readings at the start of the rounds.

Arrival is not a frame count: a click has arrived when the Surface's tree holds exactly the panels of the context it leads to (the table of `hud_validation.gd`: `hud-bar`, `hud-actions`, `hud-tile`, `hud-city`, `hud-research`, `hud-dialog`) and, for the three contexts that mount the same panels
(`stack`, `settler`, `warrior`), the button only that context lists. For an End turn it is also that the job has finished, the game is at `idle` and the spinner is gone. The number of frames is **recorded**; the ceiling (10 frames for a click, 40 for a turn) only catches a stall, and a click that does not arrive ends the run.

## What is judged exactly, and what depends on the pace

The headless loop runs a frame every ~7 ms with nothing pacing it and draws nothing ([frame-clock.md](frame-clock.md)), so **what it records of time is the CPU cost of the work on an unpaced loop and is not a frame time**. The probe's checks and the independent
oracle (`tests/frontier-turn-oracle.mjs`, which judges each rule apart, so that a report broken for one reason is shown to fail for that one) judge only what holds at any pace of the machine, and **no limit on a time is set anywhere**:

| Rule | What must hold | Exact? |
| --- | --- | --- |
| `clicks` | the HUD shows the panels of the context the click leads to within the ceiling of frames; the click makes **exactly one call** to the game, the intent of its step; a click on the map reaches the World (its press and release) and one on a panel or button does not; a panel click is one call of the HUD and a map click none | exact |
| `rests` | at rest, in every round, the Surface holds the panels of the context and the marker of no other; the native views are the same **every time a context comes back** (and the Surface's `nativeTags` are the host's `nativeViews`); the SceneTree holds the host's native views plus a constant (10) and Godot's node monitor counts the same nodes; **0 orphans** | exact |
| `turns` | from the acceptance, **each frame advances exactly one phase**, in the order of the service (`ai_plan`, `ai_move`, `production`, `growth`, `research`, `refresh`, `idle`); a snapshot is published in each of those seven frames and none before or after; `turn_ended` is published **once**, in the frame that finishes the last phase; the job finished once and its summary lists the six phases; the ids of the jobs rise by one | exact |
| `heap` | for every series (the start of a round and each of the 16 steps, one reading a round), the live heap at rest after a forced collection: the median of the last 15 steady rounds less the median of the first 15 is at most 2,048 bytes (`heapAtRest`, imported) | the GF-30 limit, exact |
| `rss` | the resident memory at rest, for every series and for the run in the order of the readings: the median of the last half of the steady readings less the first's is at most 48 MiB (the soak's loose rule, `RSS_GROWTH_LIMIT_KB`) | coarse, see below |
| `errors` | the host's `errors` is 0 at every reading, the HUD's rejected calls are 0, no `FABRIC_ERROR` is in the log, no error or promise rejection went unhandled in JavaScript (a global handler and Hermes' tracker, installed by the probe; and a control after the run, one rejection that nobody handles, which the tracker must see) | exact |
| `readings`, `scene`, `shape`, `config` | every reading satisfies the host's invariants (`verifyReading`, `verifyGrowth` of the GF-30 oracle) and was taken after a forced collection; the game mounted its HUD in the 1080 x 600 viewport; every round has its 16 steps; the probe ran the parameters of the cases | exact |

Recorded, never judged: the frames a click takes, every duration (the injection, the click to the panels, each frame of a turn, the host's pump and its JS, mount and layout phases), the resident memory's level and Godot's static memory.

**The frames from the click to the panels are not fixed in the oracle.** They were 2 in every one of the 480 steady clicks of the pinned run, and the explanation fits the structure: the click is a round trip through the game. In the frame of the click the call (or the map's `select_tile`)
reaches the game, which publishes the snapshot in that frame; the application's pump hands it to JavaScript; React renders and the host mounts the panel in the pump of the next frame. The state is Godot's, so unlike the baseline (a React state, panel there when the
flush returns: 0 frames) it cannot show in fewer. That is a reading of the numbers and of the order of the nodes in the tree, not a trace of the pumps, and it is not a promise: a change of the HUD, of the scheduler or of the registry may make it 1 or 3. So the oracle asserts a
ceiling and records the observation (p50, p95 and maximum, by step and by context, below).

## The headless lane

One run of the lane (2026-10-09), pinned by the [evidence record](../evidence/frontier-turn/README.md) at commit `116a72f`, on an Apple M3 Pro (11 logical cores, 18 GB) with macOS 26.6.2, arm64, Godot 4.7.2, Hermes 250829098.0.17, the headless display server and the `opengl3` driver named: 32 rounds, **512 clicks, 128 turns and 546 readings** in one process.
The whole test (provisioning, the editor build, the run, the 4.6 seconds Hermes' tracker needs at the end, the oracle and the negatives) took **192 seconds**, the probe itself 172: well under the 5 minutes the lane was allowed before it had to be reported, and the native job's 90-minute limit (about 60 used) stays clear. The Mac was not idle (other
agents' work ran on it): the system load average (1 minute) was 4.1 before the process and 1.5 after it, so the durations are a baseline of this machine as it was and not a best case. Every number below is of the 30 steady rounds (480 clicks, 120 turns); the 2 warm-up rounds are in the raw data and in no statistic.
The p95 of 30 samples is the 29th, so it moves with one slow click.

### Click to panels, by step

The frames and the milliseconds from the start of the injection (the press and the release, delivered at once) to the moment the HUD shows the panels of the context. "Injection" is the time of the delivery itself: the map's click runs the game's `select_tile` inside it, a button's press runs React's handler.

| Step | Kind | Context before to after | Frames p50 / p95 / max | Click to panels (ms) p50 / p95 / max | Injection p50 (ms) |
| --- | --- | --- | --- | --- | ---: |
| `map-stack` | map | none to stack | 2 / 2 / 2 | 10.2 / 11.9 / 12.7 | 0.60 |
| `select-warrior` | action | stack to warrior | 2 / 2 / 2 | 10.1 / 11.3 / 11.6 | 0.91 |
| `clear-selection` | action | warrior to none | 2 / 2 / 2 | 10.7 / 11.4 / 11.6 | 0.98 |
| `map-stack-again` | map | none to stack | 2 / 2 / 2 | 10.3 / 10.8 / 12.6 | 0.57 |
| `select-settler` | action | stack to settler | 2 / 2 / 2 | 9.8 / 10.6 / 11.0 | 0.94 |
| `map-tile` | map | settler to tile | 2 / 2 / 2 | 10.5 / 12.3 / 13.0 | 0.51 |
| `map-stack-third` | map | tile to stack | 2 / 2 / 2 | 9.4 / 11.0 / 11.0 | 0.58 |
| `select-settler-again` | action | stack to settler | 2 / 2 / 2 | 9.7 / 10.6 / 10.9 | 0.93 |
| `found-city` | action | settler to city | 2 / 2 / 2 | 13.5 / 15.2 / 16.4 | 0.96 |
| `map-tile-again` | map | city to tile | 2 / 2 / 2 | 10.2 / 11.6 / 12.0 | 0.57 |
| `map-city` | map | tile to city | 2 / 2 / 2 | 13.5 / 14.6 / 15.2 | 0.60 |
| `end-turn-1` | turn | city to none | 8 / 8 / 8 | 52.5 / 53.1 / 53.2 | 0.85 |
| `end-turn-2` | turn | none to none | 8 / 8 / 8 | 51.8 / 52.9 / 55.3 | 0.91 |
| `end-turn-3` | turn | none to none | 8 / 8 / 8 | 51.5 / 52.9 / 53.2 | 0.96 |
| `end-turn-4` | turn | none to dialog | 8 / 8 / 8 | 50.8 / 51.6 / 52.7 | 0.97 |
| `answer-event` | dialog | dialog to none | 2 / 2 / 2 | 10.2 / 11.9 / 12.4 | 1.03 |

By the context the click leads to (the clicks that are not an End turn):

| Context the click leads to | Steps | Samples | Frames p50 / p95 / max | Click to panels (ms) p50 / p95 / max |
| --- | --- | ---: | --- | --- |
| `none` | `clear-selection`, `answer-event` | 60 | 2 / 2 / 2 | 10.5 / 11.6 / 12.4 |
| `tile` | `map-tile`, `map-tile-again` | 60 | 2 / 2 / 2 | 10.4 / 11.6 / 13.0 |
| `settler` | `select-settler`, `select-settler-again` | 60 | 2 / 2 / 2 | 9.7 / 10.6 / 11.0 |
| `warrior` | `select-warrior` | 30 | 2 / 2 / 2 | 10.1 / 11.3 / 11.6 |
| `stack` | `map-stack`, `map-stack-again`, `map-stack-third` | 90 | 2 / 2 / 2 | 10.0 / 11.0 / 12.7 |
| `city` | `found-city`, `map-city` | 60 | 2 / 2 / 2 | 13.5 / 14.6 / 16.4 |

`dialog` is reached by `end-turn-4`, whose click to the dialog's panels is 50.8 ms at the median (the turn's seven frames and one more; below). The End turn clicks, to the panels of the context the turn leaves the game in and no spinner, are the last four rows of the first table.

- **2 frames in all 480 steady clicks, whatever the context, the device of the click (the map's or a button's) or the panel**, and **8 for an End turn** (the seven frames of the job and one in which the HUD catches up). That is an observation and the oracle does not fix it (see above).
- **The time follows the nodes the transition mounts.** The contexts of 14 to 27 native views take 9.7 to 10.5 ms at the median and the city ones, which hold 42, 13.5 ms (about 3 ms more for 15 to 28 more native views). Most of the 10 ms is the headless loop's own floor, not work: two frames of a loop that runs a frame every ~6.9 ms
  with nothing pacing it ([frame-clock.md](frame-clock.md)), counted from an injection that happens inside the first. It is **not a presented latency**, and 10 ms is not a "frame time" of anything.
- **The injection is cheap**: 0.5 to 0.6 ms for a map click, which runs `select_tile` in it, and 0.8 to 1.0 ms for a button, which runs React's handler. The rest of the time is in the two frames after it.
- The tail is short: the p95 is at most 15.2 ms (`found-city`) and the maximum 16.4 ms (one `found-city`, 1.2 times its median), in 480 clicks.

### The turn, frame by frame

Every frame of the 120 steady turns, from the frame in which the game accepts the End turn: the phase the game was at when the frame ended, the interval since the previous frame (`Time.get_ticks_usec` at the start of each frame), the SceneTree's nodes and whether the HUD showed the spinner. The first interval is shorter because
it starts at the injection, which comes a few milliseconds after the frame boundary (the probe's reads before the click).

| Frame | Phase the game was at | Interval p50 / p95 / max (ms) | SceneTree nodes (min to max) | Spinner shown |
| ---: | --- | --- | --- | ---: |
| 1 | `ai_plan` | 2.8 / 4.1 / 7.0 | 24 to 52 | 0 of 120 |
| 2 | `ai_move` | 7.4 / 10.3 / 10.7 | 26 to 56 | 120 of 120 |
| 3 | `production` | 7.3 / 7.7 / 8.1 | 26 to 56 | 120 of 120 |
| 4 | `growth` | 6.7 / 7.1 / 8.4 | 26 to 56 | 120 of 120 |
| 5 | `research` | 7.0 / 8.0 / 9.0 | 26 to 56 | 120 of 120 |
| 6 | `refresh` | 6.9 / 7.4 / 8.3 | 26 to 56 | 120 of 120 |
| 7 | `idle` | 6.9 / 7.4 / 7.6 | 26 to 56 | 120 of 120 |
| 8 | `idle`, the HUD catching up | 6.8 / 7.9 / 8.1 | 24 to 26 | 0 of 120 |

The host does not expose its pump and phases per frame, only their running totals and the last 128 samples of each series, so they are given **around the turn**: from the reading before the click to the one at the end of the turn, over the 120 steady turns (milliseconds p50 / p95 / max): the pump 24.2 / 32.9 / 33.7, of which JavaScript 21.7 / 29.6 / 30.4, the host's mount
1.7 / 2.3 / 2.4 and Yoga's layout 0.7 / 0.9 / 1.1, in 10 pumps for the 8 frames (10 in every turn; the two beyond one a frame are not isolated). The 1,200 pump samples of the turns are 2.8 ms at the median, 4.8 at p95 and 8.5 at most. The seven frames of the job take 44.7 ms
(p50; 46.0 at p95, 47.2 at most) from the first to the last.

- **Exact, and what the oracle judges:** one phase in each of the seven frames, in the order of the service; a snapshot published in each (S0 in the frame that accepts the turn, S6 in the one that finishes it, seven in seven consecutive frames) and none before or after; `turn_ended` once, in the frame of the last phase, before its snapshot; the job finished once; the ids of the 128 jobs rise by one; 128 `turn_ended` for
  128 End turn presses.
- **The frame intervals are the loop's floor, not the phases' cost.** Every phase's frame is 6.7 to 7.4 ms at the median, less than a millisecond of difference between them, which is the unpaced headless loop's own ~6.9 ms and not what a presented frame would show; the host's pump over the turn is 24 ms of the 45. What is
  measured here is that **no frame carries two phases and that the turn is eight frames, not how long a frame takes**: that is the windowed lane's.
- **The HUD follows the game by one frame.** The spinner is not shown at the frame that accepts the turn (0 of 120), is shown in the six that follow and is gone in the eighth: the snapshot a frame publishes is rendered by the pump of the next, which is the same pipeline that makes a click take 2 frames.
- While the turn runs the HUD mounts a few nodes, the spinner among them (SceneTree 26 to 56, against 24 to 52 at rest before the turn), and gives them back in the eighth frame (24 to 26).

### Native nodes by context

Exact, and identical in all 546 readings at rest: **in every round and at every step that leads to a context**, the Surface's snapshot and the host's count are the same native views, the SceneTree holds them plus 10 (the nodes of the scene and the probe, which no click changes) and Godot's node monitor counts the same nodes. **There was no orphan node in any reading** (0 in all 546).

| Context | Native views | SceneTree nodes | Steps that lead to it |
| --- | ---: | ---: | --- |
| `none` | 14 | 24 | `clear-selection`, `end-turn-1`, `end-turn-2`, `end-turn-3`, `answer-event`, and the start of every round |
| `tile` | 18 | 28 | `map-tile`, `map-tile-again` |
| `settler` | 27 | 37 | `select-settler`, `select-settler-again` |
| `warrior` | 24 | 34 | `select-warrior` |
| `stack` | 26 | 36 | `map-stack`, `map-stack-again`, `map-stack-third` |
| `city` | 42 | 52 | `found-city`, `map-city` |
| `dialog` | 24 | 34 | `end-turn-4` |

The numbers are not pinned in the oracle (the HUD of V05-05 will change them): the oracle requires each context to hold **one** value in every reading that leads to it, in the Surface, in the host and in the tree, and the cases pin none.

### Heap and resident memory, by transition

Each row is a series of one reading a round (32), taken after the step with its 30 idle frames and a forced collection of Hermes' heap. The heap is the median of the 30 steady rounds; the growth is the baseline's rule, the median of the last 15 rounds less the median of the first 15 (limit 2,048 bytes); the resident memory is the soak's loose rule over the same halves
(limit 48 MiB).

| Series (the reading at rest after the step) | Native views | Heap at rest (bytes, steady median) | Growth between the medians of the halves | Resident memory p50 (MiB) | Resident memory min to max (MiB) | Growth between the medians (MiB) |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| `start` | 14 | 2,175,808 | 128 | 197.0 | 137.8 to 204.8 | -57.6 |
| `map-stack` | 26 | 2,244,944 | 128 | 197.0 | 137.8 to 204.9 | -57.6 |
| `select-warrior` | 24 | 2,270,792 | 128 | 197.0 | 137.8 to 204.9 | -57.6 |
| `clear-selection` | 14 | 2,178,608 | 128 | 197.0 | 137.8 to 204.9 | -57.6 |
| `map-stack-again` | 26 | 2,245,016 | 128 | 197.0 | 137.8 to 204.9 | -57.6 |
| `select-settler` | 27 | 2,289,696 | 128 | 197.0 | 137.9 to 205.0 | -57.6 |
| `map-tile` | 18 | 2,210,856 | 128 | 197.0 | 137.9 to 205.0 | -57.6 |
| `map-stack-third` | 26 | 2,260,888 | 128 | 197.1 | 138.0 to 205.0 | -57.6 |
| `select-settler-again` | 27 | 2,289,696 | 128 | 197.1 | 138.0 to 205.0 | -57.6 |
| `found-city` | 42 | 2,338,336 | 128 | 197.4 | 138.3 to 204.7 | -58.1 |
| `map-tile-again` | 18 | 2,195,376 | 128 | 196.9 | 138.3 to 204.7 | -58.1 |
| `map-city` | 42 | 2,335,280 | 128 | 196.9 | 138.4 to 204.8 | -58.1 |
| `end-turn-1` | 14 | 2,172,184 | 128 | 196.9 | 137.7 to 204.8 | -58.1 |
| `end-turn-2` | 14 | 2,164,936 | 128 | 196.9 | 137.7 to 204.8 | -58.1 |
| `end-turn-3` | 14 | 2,165,120 | 128 | 196.9 | 137.7 to 204.8 | -58.1 |
| `end-turn-4` | 24 | 2,223,928 | 128 | 197.0 | 137.8 to 204.8 | -58.1 |
| `answer-event` | 14 | 2,177,904 | 128 | 197.0 | 137.8 to 204.8 | -58.1 |

- **The heap was flat to the byte once the HUD's bounded lists had filled, and every series grew by 128 bytes between the medians** (the first median 2,175,680 and the last 2,175,808 for the start of a round; the limit is 2,048). The context sets the level: the heap holds the panels' fibers, so it rises with the native views (2.07 MiB with the bar's 14, 2.23 MiB with the city's 42, about 6 KiB a view), and each series returns to its own level every round, which is why the rule is applied to a series for each step and not to one for the run.
- **The ramp, and why the warm-up is not tuned.** The heap of the start of a round was 2,125,960 bytes in round 0, 2,166,752 in round 1 (the first renders of every panel), then rose by 2,760, 1,784, 1,296, 1,040, 1,040 and 992 bytes in the next rounds and was flat at 2,175,680 from round 9 to 14. `consumers/civ-lite/ui/telemetry.ts` keeps the last 64 results, phases and epochs the HUD saw (`KEPT = 64`),
  the HUD makes 10 calls a round (320 in the run, all answered), and 64 results are 6.4 rounds: the ramp ends where those lists fill (a reading of the numbers, not isolated). The rule passes because the median of the first 15 steady rounds sits on the plateau: **a HUD whose bounded lists took more than about a dozen rounds to fill would fail the rule on a run that leaks nothing**,
  and the number of warm-up rounds (2) is the baseline's, not chosen for this HUD. The steps of +128 bytes at the 16th round and of +256 at the 32nd are the size of 16 and 32 entries of 8 bytes, which is what a list that gets one entry a round would add as its storage doubles (the epochs the telemetry keeps: consistent with the numbers, not isolated); they are why the growth between the medians is 128 and not 0, and they
  stop at the cap of 64 entries.
- **Resident memory moved by tens of MiB and went down, as it does in every harness of the repository.** The 17 series span 138 to 205 MiB; the medians are 197 MiB; the growth between the medians of the halves is -57.6 to -58.1 MiB, and **-57.8 MiB for the run read in order** (510 steady readings, halves of 255), against the 48 MiB the rule allows (it bounds a rise, and this one is a fall). The process stood at 193 to 205 MiB for the first 21 rounds, rising 0.5 to 0.6 MiB a round, and fell to 138 MiB at round 22 (the OS compressing it, as the soak saw; not isolated), from where it rose again at the same pace;
  Godot's static memory (the probe's own readings, 546 of them) grew from 27.6 to 46.4 MiB, 0.6 MiB a round, which is the pace of the rise: the resident memory includes the probe's bookkeeping, and the rule is a coarse trend, **blind to a leak under about 3 MiB a round** (45 MiB over the 15 rounds between the medians; the oracle shows that 3 MiB a round passes and 4 MiB fails). The heap rule is the leak detector.

### Errors

The host's `errors` is 0 at all 546 readings; the HUD made 320 calls and the game answered 320, none rejected (`problemCount` 0 at every reading); the HUD kept its 2 connections; the node published 1,312 snapshots and 128 `turn_ended`; **no JavaScript error and no promise rejection went unhandled** (the probe installs a global handler where the runtime has one, which it does not: `ErrorUtils` is absent, and Hermes' tracker, which was watching),
and **the control after the run, one rejection that nobody handles, was seen once** by the tracker; no `FABRIC_ERROR` and no `ERROR:` line is in the log.

## The windowed lane

`caffeinate -d npm run bench:frontier-turn-graphics` (`scripts/frontier-turn-graphics.mjs`) is local (a real window, the native renderer and a display; CI has none). It provisions the same project, copies the same probe and runs it with Godot's `--windowed` on the `gl_compatibility`
renderer, with the same tour and the same clicks (`--lane=windowed`), and measures what only a window has: the interval between consecutive process frames, from `Time.get_ticks_usec`, in three windows: an **idle** one (600 frames after the warm-up, the map and the HUD still, nothing read
or injected), the frames that took a **click**, and **every frame of a turn**, which is what the sliced AI is measured by (the table of the headless lane, now with presented frames). A reading at rest is not taken (no collection in the middle of the frames); the Surface is only counted.

**Protocol.** It is the baseline's, and the validity rule and the statistics are the baseline's own code, **imported and not copied** (`graphicsRunValidity`, `summarizeGraphicsRuns` and `verifyGraphicsReceipt` of `tests/frontier-baseline-oracle.mjs`; the turn's runs are put in the shape they read by `graphicsRunOf`):

1. **5 runs, in separate processes**, one after the other, each a fresh Godot process that mounts the scene and runs the tour.
2. **Warm-up: 2 rounds** are thrown away (in the raw data, flagged by their round). Then the idle window, then **30 steady rounds**: **480 clicks and 120 turns** a run.
3. **p50, p95 and p99 of each run** are computed from that run's raw intervals with the nearest rank; the **median and the interquartile range across the runs** (nearest-rank quartiles) are the statistic of the execution. The turn's frames are summarized per phase the same way.
4. **Provenance**: the machine, the system, the display, the renderer and the adapter, the **vsync mode and the refresh rate read back from the window** and the system load before and after each run.
5. **No outlier is discarded.** The warm-up is the only rule that leaves clicks out, and one rule leaves whole runs out: **a run counts only if a display presented the window**. It is two checks on the raw data: the window **drew throughout** (a frame was drawn after every steady click and in at least nine of ten frames of the idle window), and the
   loop was **paced**: the median interval of the idle window is **at least half of the refresh period that the window read back** (4.17 ms at 120 Hz). With the display off or showing the lock screen the window still draws, `frame_post_draw` still fires and the vsync mode still reads `enabled`, but nothing paces the loop and an idle frame takes about 0.6 ms.
6. A run that fails either check is **rejected with its reason**, kept in the receipt (`rejectedAttempts`, with its raw intervals) and repeated, at most three times for each of the five. If a slot uses up its attempts the lane stops: the receipt says `presented: false`, a status "not presented: <reason>" and **no frame-time statistic**,
   and the script exits with code 3, which is neither success (0) nor a crash. The unit tests of the validity and of the receipt on synthetic runs of the turn's shape (`tests/frontier-turn-graphics.test.mjs`, part of `npm run test:contracts`) show that a run that no display paced is refused, and so is a receipt that carries one.
7. The windowed probe's clicks are on the validation device, which the HUD's Surface hears and the real pointer is not (`native/application_runtime.cpp:2091`); the World still hears the real pointer's motion over the map, so the windowed lane records what the World heard (`worldEvents`, `worldClicks`) and judges the one call each click made to the game, not the World's counts (the headless lane judges those).

### The windowed result: not presented

**No frame time is pinned.** The lane ran once on the pinned code with `caffeinate -d`, while the Mac had been idle for about 11.6 hours (`HIDIdleTime`) and its display was off or showing the lock screen. Every attempt drew (`frame_post_draw` fired after every one of the 11,473 to 11,488 process frames
of an attempt, and 601 times in the 600 frames of the idle window) and the vsync mode read back `enabled` at 120 Hz on the built-in display ("Color LCD", 1512 x 982 points, 3024 x 1964 pixels, 120 Hz, scale 2; a 1080 x 600 window, `gl_compatibility`, adapter "Apple M3 Pro"), but **no display paced the loop**: an idle
frame took about 0.6 ms against the 4.167 ms that the validity rule requires. The three attempts of slot 1 were **rejected as unpaced**, the lane stopped, and the receipt says `presented: false`, carries no frame-time statistic and exits with code 3. Nothing was forced.

| Slot | Attempt | Idle median (ms) | Required (ms) | Frames drawn | Reason |
| ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 1 | 0.606 | 4.167 | 11,488 of 11,488 | unpaced: the display is not presenting |
| 1 | 2 | 0.587 | 4.167 | 11,474 of 11,474 | unpaced: the display is not presenting |
| 1 | 3 | 0.589 | 4.167 | 11,473 of 11,473 | unpaced: the display is not presenting |

The raw intervals of the three attempts are kept in the receipt (`build/frontier-turn-graphics.json`, `rejectedAttempts`) and are **not frame times**: they are the CPU cost of a process frame in a loop no display brakes. Nothing of them is a result here, and no budget row starts from them.
The presented frame time of the turn needs an awake, unlocked display: run the lane again and it will check that the loop was paced. The captures run, which measures nothing and does not need a display to pace the loop, passed: it saved one image of the frame as drawn for each of the seven contexts
(`context-none.png`, `-tile.png`, `-settler.png`, `-warrior.png`, `-stack.png`, `-city.png` and `-dialog.png`, 1080 x 600 PNGs, hashed in the receipt), taken the first time each context shows, of the real HUD over the real map (in the city one the Aurora city's two panels over the map; in the dialog one turn 5 with the event waiting, End turn disabled with the game's reason).

## The retained sabotages

The four variants are listed once, with what each breaks, where, the text it replaces and the oracle rules that must reject it, in `tests/frontier-turn-sabotages.mjs`; the lane (for the provisioned copy), the script (for the probe) and the test (for the rules) all read that table.
`node scripts/frontier-turn-sabotage.mjs` breaks one thing at a time, runs the headless lane on it (`tests/frontier-turn-native.test.mjs --sabotage=<name>`) and requires **both** the probe's checks and the oracle to reject the report, the oracle for the rule each variant was written for (not merely for any rule). The two
variants that need the game or the HUD to be wrong break **the provisioned copy**, which is thrown away; the other two break the probe, through `scripts/sabotage-sources.mjs` (restored byte for byte, proven by hash, whatever ends the run). **The template is never edited**: the script hashes the tree of
`consumers/civ-lite` before and after and requires it to be the same, and so does the test on every run. The file of each variant's verdict is deleted before it runs and a missing file counts as not rejected. A last run of the genuine source follows.

| Variant | Where it breaks | What it breaks | Probe | Oracle (the rule, and what it said) |
| --- | --- | --- | --- | --- |
| `skipped-phase` | the provisioned copy of `services/game_services.gd` | `_process` calls `advance_job` twice, so a frame runs two phases | 3 checks: one phase a frame in the service's order; a snapshot in each of the seven frames; the end of the turn once, in the frame of the last phase | `turns`: "the game advanced one phase in each frame, in the order of the service, and ended at idle" (the frames show `ai_plan`, `production`, `research` and `idle`, two snapshots in three of them, while the job's own summary still lists the six phases) |
| `leaky-transition` | the probe | every click leaves a Godot node behind that nothing frees (`Node.new()` in the click) | 1 check: Godot counts no orphan node at rest | `rests`: "start, round 1: Godot counts no orphan node" (16 orphans at the start of round 1, one for each click of round 0, then 32, 48) |
| `click-misses-panel` | the probe | the click is delivered 2,000 pixels to the left of the tile or the button | 8 checks: the first click shows nothing within the ceiling, and everything after it is missing | `shape` "No click was cut short" and `clicks` "round 0 map-stack: the HUD showed the panels of stack within 10 frames of the click (-1)"; the rules that need the whole run (`rests`, `heap`, `rss`, `turns`) fail too, because the run ended at its first click |
| `heap-leak` | the provisioned copy of `ui/hud/hud.tsx` | the HUD keeps 64 numbers of every render for ever (a module-level array that `GameScreen` pushes to), a JavaScript leak that grows with every transition | 1 check: the live heap at rest | `heap`: "The live heap at rest rose 477536 bytes from the median of the first half (15 rounds) of the steady rounds to the median of the last, over the limit of 2048" (the start of a round, 2,234,480 bytes at round 2 and 3,155,624 at round 31) |

`heap-leak` first broke the HUD with `(globalThis.turnLeak ??= []).push(...)`, which the editor build refused (TypeScript error TS7017: `globalThis` has no index signature): the variant was **not rejected** (the build never produced a bundle, the run died before judging, and its verdict file did not exist) and
the script said so. It was rewritten as a typed module-level array, which builds, runs and is rejected by the heap rule alone.

The oracle is also tried on the recorded report changed in 22 ways that it must reject, each **for its rule and no other** (a node or an orphan that drifts, a native view the Surface and the host disagree on, a panel missing at rest, a click over the ceiling, a second call, a map that did not hear its click, a run cut short, a phase skipped, two
phases in a frame, a second end of the turn, a frame that publishes no snapshot, a heap read without a collection, a host error, a heap that grows by 3,000 bytes, by exactly 2,049, and by 200 bytes a round on either of the two series of the hosted run of PR #77, a resident memory that grows by the limit plus 1 KB and by 4 MiB a round, an unhandled rejection and a tracker
that is blind), and in nine ways that it must accept (a single transient of 2,056 bytes, a rise of exactly the limit, the two hosted series themselves, a first half that alone dips, a resident memory that falls by 30 MiB, rises by 30 MiB, rises by exactly the limit, and a ramp of 3 MiB a round).

## What is left

- **`baseline`** (V05-06), the windowed part: the frame time of a presented window is still **pending**. No display presented the window in either lane (the baseline's and this one), and the two lanes check the pacing on their own; running
  `node scripts/frontier-baseline-graphics.mjs` and `caffeinate -d npm run bench:frontier-turn-graphics` on an awake, unlocked display is what closes them. This slice does not touch the baseline's files.
- **`congelado`** (V05-06): the freeze of the thresholds, one act, later, by the principal. This note records and proposes no bound. The inputs it adds to the freeze are the click to the panels (2 frames and 10 to 14 ms of CPU, headless), the turn (eight frames, seven of them the job's) and the heap and native views per context.
- The criterion `turno` is **not closed** by this slice: the presented frame time of the turn is part of it, as it is of `baseline`, and the windowed lane ended as not presented. Its record is an `activity` and not `done: true`; it closes when the lane runs presented, with the receipt next to the headless evidence.
- The HUD that is measured is the one on `main` at the pinned commit (V05-05 is still adding overlays and a Modal dialog): the numbers are that HUD's, and the exact rules compare each context with itself, so they keep holding when the HUD changes and only its numbers move.

## Limitations and open

- One machine (an Apple M3 Pro), the headless display server and the `opengl3` driver named; the Mac was loaded by other agents' suites (load average 1.5 to 4.1), so the durations are not a best case. They are the CPU cost of work on a loop that nothing paces and are **not frame times**; the presented frame time is the windowed lane's, still pending. Only the exact
  counts are asked of a hosted runner.
- **The frame time of a presented window (vsync on, 120 Hz) is PENDING**: no windowed attempt was presented by the display (the Mac had been idle for 11.6 hours, the display off or locked), the lane rejected all three attempts as unpaced and ended with `presented: false`, exit code 3 and no frame-time statistic. No frame time of a click, of a phase of the turn or of an idle frame is claimed, and no budget starts from this slice.
  Missed frames with the vsync on are not read either (they need presentation timestamps that Godot does not give).
- Synthetic events through the viewport on the validation device; no hardware pointer or touch screen, no iPhone, no mobile export. The numbers are macOS, arm64, Compatibility renderer.
- **The HUD is V05-05's work in progress** (bar, actions, tile, city, research and dialog as positioned panels): no Modal, no overlay stack, no images, no scroll views, no text input, no animation but the spinner. The numbers are that HUD's and move when it does; every exact rule compares a context with itself.
- **The tour is one fixed path** through turns 1 to 5 of one scenario (a Settler founds a city, a Warrior is selected, four turns end with an empty production queue, one event is answered): the game's state stays small and the army does not grow; it is not an economy that keeps growing, a long session (the soak's 100 turns are) or the services' 64-task and 128-event budgets (the services' stress case).
  The turn's phases are the scripted faction's walk, the city's production, growth and research, and nothing more.
- The two frames from the click to the panels are an observation and an explanation that fits the structure (a round trip through the game); the pumps were not traced inside the frames. The oracle bounds them by a ceiling (10 frames, 40 for a turn) and fixes nothing.
- The host reports its pump and its JS, mount and layout phases as running totals and the last 128 samples of each series, **not per frame**: the turn's host time is given around the turn (10 pump samples in 8 frames), and a phase cannot be attributed to a frame.
- The heap judgement is the baseline's, and it is blind to what the warm-up has not finished: the HUD's bounded lists were still filling for the first six rounds (about 1 KB a round) and the rule passes because the median of the first half is past them. A hosted runner's noise band was 2,376 bytes in the baseline (wider than the limit); there are 17 series here, so the chance that one series
  fails on noise alone is larger than the baseline's (0.05% a series on the baseline's resampling, about 1% for the 17, a rough bound and not a model).
- The resident-memory rule is a coarse trend over 15 rounds: blind to a leak, native included, under about 3 MiB a round. It includes the probe's own bookkeeping (Godot's static memory grew from 27.6 to 46.4 MiB in the run).
- Hermes' tracker of unhandled rejections reports from a timer, so the probe reads the count after waiting 2.3 s and its control is a `TypeError`; the runtime has no `ErrorUtils`. The probe installs its handlers after the bundle has run, so an error thrown while the bundle is evaluated is seen only by the host's `errors`.
- The probe's sampler is **copied** into the provisioned project (the lane copies `tests/performance-sampler.gd`, as decided) and not preloaded from `res://tests/`, which a provisioned project does not have; the file is the same bytes (its hash is in the report).
- The previous-host control does not apply: nothing in C++ changed. The four retained sabotages are the control. The compatibility documents (`docs/compatibility/react-native-0.87.1.json`, `BASELINE.md`), `docs/API.md`, `docs/NATIVE_MODULES.md` and `docs/PARITY.md` do not apply: the slice adds no RN name, public API or native module and moves no count.
- Hosted CI is pending: the lane is a step of the native job of `contracts.yml` and takes about 3 minutes locally. The sabotages and the windowed lane never run there.

## Reproducing

```sh
npm run test:frontier-turn                       # the lane in one Godot process (about 3 minutes), the oracle, the report-level negatives, the tables
node scripts/frontier-turn-sabotage.mjs          # the four retained sabotages and a last genuine run, sources restored byte for byte; run nothing else meanwhile
node tests/frontier-turn-native.test.mjs --replay=build/frontier-turn-current-report.json   # judge a recorded report (the oracle alone, no Godot)
caffeinate -d npm run bench:frontier-turn-graphics   # local only, needs an awake and unlocked display: five windowed runs, the receipt and a capture per context; exit 3 if not presented
```

The first command leaves the raw report in `build/frontier-turn-current-report.json`, the log in `build/frontier-turn-current.log`, the provisioning and editor logs in `build/frontier-turn/` and the oracle's summary, with the negatives and the verdicts of the sabotages, in `build/frontier-turn-comparison.json`.
