# Frontier's services: the GameServices node, its epoch and the types in parity

Status: implemented and executed locally on macOS arm64 against pinned RN 0.87.1 and official Godot 4.7.2 (headless), for
the criteria `servicos` and `autoridade` of V05-03. The [evidence record](../evidence/frontier-services/README.md) pins the local
runs of `servicos` at commit `75c4c0f`. `autoridade` (the end of a turn as an accepted job, in "The turn is a job" below) was
added to the same node afterwards, and its [evidence record](../evidence/frontier-authority/README.md) pins the local runs at
commit `d0c7096`; hosted CI for `npm run test:frontier-services` is pending.

The second package of the 0.5 milestone exposes the Frontier game ([research](frontier-game.md), rules in GDScript, already on
`main`) to a React Native HUD through the typed game services the repository already has
([docs/GAME_SERVICES.md](../GAME_SERVICES.md)). The criterion it closes is the one in `dashboard/migration.json`
(`milestones[0]`, item V05-03, `servicos`): a persistent `GameServices` node with an epoch, whose states, signals and methods
are registered before the mount, with schemas and TypeScript types tested for parity between Godot and TypeScript, positive
and negative.

That package closed only that criterion. `consumidor` (provisioning by the addon, the editor, ten cycles) was closed by the next
one ([frontier-consumer.md](frontier-consumer.md)), and `autoridade` (a turn that is a job which survives closing the screen, a
rule mutated in Godot that changes the HUD with no change in JavaScript, bursts measured against the 64/128 budgets) is added
here, in "The turn is a job". There is no HUD here: the playable HUD is V05-05, so there is no example and no screenshot.

## Sources

- [docs/GAME_SERVICES.md](../GAME_SERVICES.md): the API, the schema language (`integer`, `string`, `{array}`, `{object}`,
  exact objects, no optional field or union) and the DTO limits (depth 32, 10,000 value nodes).
- `native/game_service_registry.cpp`: `check_schema` and `validate` (190-223) are the whole schema language;
  `validate_args` (230) rejects a wrong count or type before the method runs, and `call` (641-655) validates the arguments
  before invoking the callback and the result after it; `signal_schema` (272) requires the declared signal arity to match
  the schema; `connect` (583-599) looks the binding up when the request is made and rejects `E_SERVICE_MISSING` if there is
  none; the limits are at line 24.
- `sdk/addon/application_node.gd` (5, 28) and `consumers/minimal/game.gd` (14-15): `runtime_available` is emitted while the
  application enters the tree, and the game node connects to it from its own `_enter_tree`. That is the pre-mount
  registration hook.
- `examples/services/game.gd`: an object schema (`{"object": {...}}`) and the laboratory's way to reach the facade
  (`preload("res://sdk/addon/godot_fabric.gd")`, because the SDK sources sit behind `.gdignore` in the root project).
- `consumers/civ-lite/game/` and [frontier-game.md](frontier-game.md): the intents, the refusal codes, the snapshot DTO and
  the golden and trace hashes the services must reproduce.
- `tests/device-services-*` and `scripts/device-services-{bundle,sabotage}.mjs`: the native probe, oracle, bundle and
  sabotage pattern this slice follows. It has no C++, so it has no host to rebuild.

## The node and its lifecycle

`consumers/civ-lite/services/game_services.gd` (`extends Node`, no `class_name`) owns one `FrontierGame` session and an
integer `epoch`. It registers 14 bindings: one state, one signal, one method per intent and `open_menu`, the one method that is
the scene's and not the game's (added by the `consumidor` slice; the package before it registered 13).

> **Update, 2026-10-09 (P8, V05-05).** The HUD slice added a second state, `frontier.hover`: the card of the tile under the pointer,
> published by the World as a state of its own (the pointer is not part of the game, so the snapshot, its emission and the hashes
> did not change). The node now registers **15 bindings**: two states, one signal and the same 12 methods. The figures of 14
> bindings below are those of the runs this note's package made, and are left as they were; the probe, the oracle and the parity
> test now expect 15. See [Frontier's HUD](frontier-hud.md), "The hover service".

- **Registration is before everything.** The node connects to `$Application.runtime_available` in `_enter_tree`, as
  `consumers/minimal/game.gd` does. The signal is emitted while the application enters the tree, before a surface mounts and
  before the bundle evaluates. `_ready` would be too late: a parent's `_ready` runs after its children's, so the surface has
  mounted and the bundle has already asked for its services (the `late-register` sabotage below registers from `_ready` and
  the bundle's first connections are told `E_SERVICE_MISSING`). The node keeps the binding tokens and removes them in
  `_exit_tree`.
- **The node is persistent.** The bindings belong to the node and the application, not to a surface. Unmounting and
  remounting the `FabricSurface` leaves the bindings, the registration generation, the game and the epoch as they were
  (measured below).
- **The facade is injected.** The node names no path to the SDK: it has `@export var fabric_api: Script`, and the owner of the
  scene hands it the facade's script. The laboratory's probe assigns `preload("res://sdk/addon/godot_fabric.gd")` before the node
  enters the tree, and a provisioned consumer's `main.tscn` points it at `res://addons/godot_fabric/godot_fabric.gd`. Without a
  facade `_bind_services` fails loud (`push_error("FABRIC_ERROR: ...")`) and registers nothing. Closed by the `consumidor` slice
  ([frontier-consumer.md](frontier-consumer.md)).

## The services

All names are under origin `default` and the prefix `frontier.`. Every schema comes from
`consumers/civ-lite/services/schema.gd`; the node registers from there and spells out no schema itself (the native test
scans `game_services.gd` for one).

| Name | Kind | Carries | Emits when |
| --- | --- | --- | --- |
| `frontier.snapshot` | state | the snapshot DTO (`FrontierSnapshot`), exact schema | its signal `snapshot_changed(snapshot)` fires once after every accepted intent and every `new_game`, and, for the turn's job, once when it is accepted and once after each of its six phases; a refused intent fires nothing |
| `frontier.turn_ended` | signal | one argument, `{turn: integer, phases: [{name: string, tasks: integer, events: integer}], job: integer}` | once per job, when it finishes: after the snapshot of the last phase and before the snapshot of the turn that begins |
| `frontier.select_tile` | method | `(x: integer, y: integer)` | |
| `frontier.select_unit` | method | `(unit_id: integer)` | |
| `frontier.clear_selection` | method | `()` | |
| `frontier.move_unit` | method | `(unit_id: integer, x: integer, y: integer)` | |
| `frontier.found_city` | method | `(unit_id: integer)` | |
| `frontier.fortify` | method | `(unit_id: integer)` | |
| `frontier.set_production` | method | `(item_id: string, slot: integer)` | |
| `frontier.set_research` | method | `(tech_id: string)` | |
| `frontier.resolve_event` | method | `(choice_id: string)` | |
| `frontier.end_turn` | method | `()`, registered `{"response": "acceptance"}` | the answer is the acceptance, with the job's id; the turn goes on in the node |
| `frontier.new_game` | method | `()` | |
| `frontier.open_menu` | method | `()` | not a rule of the game: the scene drops its World (`world_scene`, when the owner gave one); no snapshot, the epoch is untouched |

Every method answers the same object, `{ok: integer, code: string, text: string, job: integer}` (response `completion`, the
default, for all of them but `end_turn`, which answers on `acceptance`): `ok` is 0 or 1, `code` is `"ok"` or the game's refusal
code, `text` is what the HUD shows (`""` when accepted) and `job` is the id of the job the call started, 0 for every method that
starts none and for a call that was refused. The schema language has no optional field and no union, so one result cannot be
`{ok, code, text}` for most intents and `{ok, code, text, job}` for `end_turn`: the `job` is in all of them, with no schema per
method. What the game adds to the end of a turn (`turn` and `phases`) goes out on `frontier.turn_ended` instead, and the new turn
is in the snapshot. A refused intent is a normal answer with `ok: 0`, not a rejection: the game decided, and nothing changed.

### Emission

An accepted intent publishes the whole snapshot once (`bind_state` requires the changed signal to carry one complete state
value). The snapshot is read after the intent applied. A refused intent publishes nothing and does not run the game's apply
step. The end of a turn publishes seven snapshots, one for the acceptance and one after each phase, with `turn_ended` between
the sixth and the seventh (see below), so a HUD that reacts to the end of the turn sees it before it sees the turn that begins.

## The epoch

The epoch is an integer held by the node, 1 at the start, raised by 1 on every `new_game`, and passed to the game so it
reaches the snapshot. It lives outside the state and outside the hash: the state has no `epoch` key, and the oracle requires
that.

| Session | Began with | `epoch` in the snapshot | State hash |
| --- | --- | --- | --- |
| 1 | the node entering the tree | 1 | `c36aad5b117e662a962645923734e5a046f5808fff202cbc5a24e2c9ee871c2e` |
| 2 | `new_game` | 2 | the same |
| 3 | `new_game` | 3 | the same |
| 4 | `new_game` | 4 | the same |

Every `new_game` publishes one snapshot, no `turn_ended`, and returns to the scenario's initial state (turn 1, context
`none`, no selection). The initial hash is also the hash the roteiro's opening refusal leaves, which the oracle uses as an
independent witness of it. The epoch tells a HUD that every snapshot it holds is from a finished game.

## The turn is a job (`autoridade`)

The criterion is V05-03 `autoridade`: "turn.end aceito sobrevive ao fechamento da tela e job.finished chega 1x; uma regra mutada no
Godot muda a HUD sem alterar JS; rajadas de fim de turno medidas contra 64 tarefas e 128 eventos por fase". It is written in the
dashboard's words; in the repository `turn.end` is `frontier.end_turn` and `job.finished` is `frontier.turn_ended`.

### Sources

- [docs/GAME_SERVICES.md](../GAME_SERVICES.md) (89-93): a method registered with `{response: "acceptance"}` may return a job
  identifier while game work continues; completion and cancellation are explicit game signals and methods; removing UI does not
  cancel an accepted game job.
- `native/game_service_registry.cpp`: `options` (249-259) accepts `response` as the one option of a method, `completion` or
  `acceptance`; `call` (641-664) validates the arguments, runs the callback, validates the result and resolves with the
  registration's `response`; `pump_host(64, 128)` (665-692) runs at most 64 queued tasks and then sends at most 128 queued events,
  in the order they were queued, and what is left stays queued for the next pump; `snapshot()` (714-722) reports
  `pendingHostTasks`, `pendingEvents`, `hostTasksRun`, `eventsSent` and the two budgets. A signal or a state change queues one
  event for each subscription that is ready (`receive`, 395-415).
- `native/fabric_application.cpp:255` and `native/application_runtime.cpp:681-691`, `1143-1146`: the application's `_process` pumps
  once a frame, and the pump of the host phase is a deferred call that the engine runs after every `_process` of that frame.
- `examples/services/game.gd` (`inventory.equip` with `{"response": "acceptance"}`, the job owned by the persistent node and ended
  by `operation_finished` with a `finished_jobs` record), `examples/services/App.jsx:24-27` (the subscriptions at module scope)
  and `examples/services/validation.gd:142-168` (the surface unmounted, the job finishing afterwards, `finished.length == 1`): the
  pattern this reuses.
- `tests/services_boundaries.gd:259-283` and `tests/services-boundary-fixture.js:165-173`: the burst of 70 tasks and 140 events
  against 64 and 128, which this measures per phase of a turn.

### The contract

- **`frontier.end_turn` is an accepted job.** `Schema.METHOD_OPTIONS` registers it with `{"response": "acceptance"}`. The game
  starts the turn (`begin_end_turn`: its `phase` becomes `ai_plan`, and every intent but the phases is refused until the last has
  run) and answers `{ok: 1, code: "ok", text: "", job: <id>}`. A refused call (`event_pending`, `turn_in_progress`) answers
  `ok: 0` and `job: 0`; the registration, not the outcome, fixes the response, so a refusal also resolves on `acceptance`.
- **The ids** are integers rising by 1 from 1 for the life of the node (`next_job`), the same across new games (`new_game` does
  not reset them), and in neither the state nor its hash.
- **The node drives the job**, never the World and never a surface: `GameServices._process` calls `advance_job()` once a frame,
  which runs `game.advance_phase()` (one phase) and publishes the snapshot. Closing the HUD, going to the menu or dropping the
  World leaves it running (the `job-dies-with-screen` sabotage ties it to the screen and the `job-dies-with-menu` one to the
  World, and both are rejected). The job follows the game's clock: it stops while the tree is paused, like the rest of the game.
- **One job is seven snapshots and one `turn_ended`.** The snapshot is published when the turn is accepted (it shows `phase:
  "ai_plan"` and every action disabled with `turn_in_progress`) and after each of the six phases (it shows the next one; the last
  shows `"idle"`, the turn that begins, and `last_job` = the job). `turn_ended` goes out once, after the sixth and before the
  seventh, with `{turn, phases, job}`. The game's own `end_turn()` stays synchronous and serves the replay of the game, whose
  golden and trace hashes are unchanged (`npm run test:civ-lite-game`).
- **`snapshot.last_job`** (integer, 0 for none) is the id of the last job that finished in the session. A HUD that connects after
  the acceptance learns from it that the job is over without a replay of the signal. It is an input of the snapshot like the
  epoch (`FrontierGame.last_job`, set by the node, never in the state or the hash); a new game starts it at 0.
- **`new_game` abandons a job in progress**: the session it belonged to is gone (the epoch rises) and no `turn_ended` fires for it.
- **The tasks and events of `turn_ended.phases` are the game's counters** (what a phase did to the state: the tiles it worked, the
  entries it logged; at most 64 and 128, `Rules.PHASE_TASK_LIMIT`, `Rules.PHASE_EVENT_LIMIT`). The registry's `hostTasksRun` and
  `eventsSent` count something else, calls it ran and events it sent. The two are recorded apart and not confused.
- **Types.** `schema.gd` has `RESULT.job`, `TURN_ENDED.job` and `SNAPSHOT.last_job`; `frontier-types.ts` has `FrontierResult.job`,
  `FrontierTurnEnded.job` and `FrontierSnapshot.last_job`, all `Int`; and the parity compares them both ways (18 synthetic
  mutations now, five of them about these fields).

### The job, measured

The probe waits for each job to finish before the next step of the roteiro, and reports for each: the snapshots JavaScript
received (phase, turn, `last_job`), the frame each was published in on the Godot side, and what the registry held in the middle of
that frame (after the application's `_process` scheduled the pump, before the deferred pump ran) and at the start of the next one
(after it). The first job of the roteiro, with the surface mounted (two subscribers of the snapshot, the application's and the
panel's, and one of `turn_ended`); `F0` is the frame the call was accepted in:

| Frame | The snapshot published shows | Tasks run | Events sent | Pending after the pump |
| --- | --- | ---: | ---: | --- |
| F0 | `ai_plan` (accepted), turn 1 | 1 (the `end_turn` call) | 2 | 0 tasks, 0 events |
| F1 | `ai_move`, turn 1 | 0 | 2 | 0, 0 |
| F2 | `production`, turn 1 | 0 | 2 | 0, 0 |
| F3 | `growth`, turn 1 | 0 | 2 | 0, 0 |
| F4 | `research`, turn 1 | 0 | 2 | 0, 0 |
| F5 | `refresh`, turn 1 | 0 | 2 | 0, 0 |
| F6 | `idle`, turn 2, `last_job` 1, after `turn_ended` | 0 | 3 (`turn_ended` and two snapshots) | 0, 0 |

| What was measured | Accepted | Phases | `turn_ended` for the job | `last_job` at rest | Recorded in |
| --- | --- | --- | --- | --- | --- |
| Surface mounted (jobs 1, 2 and 4 to 12 of the roteiro) | `{ok: 1, job: N}`, response `acceptance` | 7 snapshots in 7 consecutive frames | once, in the application's own subscription | N | the report's `steps[].job` |
| Surface closed in the frame after the acceptance, before the first phase ran (job 3) | the same | the same: the application held `rootCount` 0 in all 4 samples taken while it ran | once, and still once after the remount | 3; the remounted root's first snapshot is `idle`, turn 4, `last_job` 3 | `persistence.job` |
| Ten calls sent while the job runs (job 13) | the same | the same, and each call refused with `turn_in_progress`, `job: 0`, with no snapshot published and no state changed | once | 13 | `jobLane.burst` |
| End of turn and the menu in the same frame (the consumer, ten cycles, jobs 2, 4, ... 20) | the same | the same, with the World out of the tree and no HUD connection | once | the node's `finished_jobs[N] == 1` | [frontier-consumer.md](frontier-consumer.md) |

All jobs of the probe: 15 accepted (12 in the roteiro, one with calls sent while it ran, two in the stress cases), 15 finished,
the application's own subscription received `turn_ended` for jobs 1 to 15, each once and in order, and the node's
`finished_jobs` holds 1 for each. The third job is the one with the screen closed: the probe closes the surface at the start of
the frame after the node accepted it, which it detects from the node (`job != 0`) and not from JavaScript, so the job has run none
of its phases; the application's `rootCount` is read while it runs; and after it the probe plays one more step with no surface and
mounts again.

### Rules from Godot change the HUD with no change in JavaScript

A lane of the plain test, not a sabotage. The probe has a `--rule-lane` mode that plays the first intents of the game through the
services (`select_tile(6, 8)`, `select_unit(1)`, `move_unit(1, 7, 8)`) and keeps the snapshot JavaScript received after each. The
test runs it twice with the same bundle: once on the genuine `rules.gd`, and once with one constant of it mutated by
`scripts/sabotage-sources.mjs` (the Settler's movement points, `"moves": 2` to `"moves": 0`), restored byte for byte afterwards.

| | Genuine | Mutated |
| --- | --- | --- |
| `rules.gd` SHA-256 | `bd96e80ed0e3ce9b985158fece61fe93b6a32af50ad68f0f94fa07783eb42040` | `5b593b141e0f5ad932578a19400869a97b6c54970b9af404460344640dcbe0fd` |
| bundle SHA-256 | `5df6014653829e791cf348b454128f21fa0b34b501b33d280ba82de14a2be468` | the same: the bundle contains no `.gd` |
| native host SHA-256 | `9b1cc1b73d99649a10624d8eaf9beb407e8b51cdf321cced7fc3a758954f020c` | the same |

The oracle derives what must change from the genuine snapshots and the constant, and requires that it is exactly what changed:

| Observation | What differs in the snapshot JavaScript received |
| --- | --- |
| initial | nothing (the state is not the same, its hash differs, but the snapshot shows no unit yet) |
| after `select_tile(6, 8)` | the Settler's card in `tile.units[0]`: `moves` 2 to 0 and `max_moves` 2 to 0, and nothing else |
| after `select_unit(1)` | the same two fields, and `found_city`: `enabled` 1 to 0, `reason` `""` to `"no_moves_left"`, `reason_text` to the game's text |
| `move_unit(1, 7, 8)` | genuine `{ok: 1}`; mutated `{ok: 0, code: "no_moves_left"}`, and a refused move changes neither the snapshot nor the state |

The state changed because Godot changed: the JavaScript is the same bytes in both runs. The test also rebuilds the bundle from the
restored rules and requires the first run's hash. The oracle refuses a lane where something else differs, where nothing does,
where the move was accepted, where the hash is the same or where the bundle or the rules are not what they should be (six
variants in the parity test).

### Bursts against 64 tasks and 128 events a phase

Every frame of every job fit in one pump: the largest pump of the 12 roteiro jobs ran 1 task and sent 3 events, and left nothing
pending, against the budgets of 64 and 128. With ten calls sent while the job runs (job 13), the frame that carries them ran 10
tasks and sent 2 events (their results are resolved in the tasks, which do not count as events), and left nothing pending. That
is the real subscribers of the probe. The game's own counters in `turn_ended.phases` are at most 5 tasks and 2 events a phase
in the roteiro.

The stress case adds 150 module-scope subscribers of `frontier.snapshot` (so a publication holds 152 events, more than 128; the
publication of the last phase holds 153 with `turn_ended`). The pumps are counted as pumps, not as time:

| Case | Publications | Events each | Pumps each | Sent in each pump | Lost | Order |
| --- | ---: | ---: | ---: | --- | --- | --- |
| one phase at a time (`advance_job` called by the probe with the frame driver off, each publication drained before the next) | 7 | 152 (153 for the last) | 2 | 128 then 24 (128 then 25 for the last) | none: each of the 150 received exactly one snapshot for each publication | FIFO: by publication, and by subscriber within it |
| the node's own driver, one phase per frame (outrunning the pump) | 7 | 152 | the whole job: 9 pumps | 128 eight times, then 41 | none | FIFO |

In the second case the backlog at the start of each frame is 152, 176, 200, 224, 248, 272, 297, 169, 41 and then 0: the job is not
held back by the registry (one phase per frame regardless), the budget bounds each pump, and the queue drains in `ceil(1065 / 128) = 9`
pumps, 1065 being 7 snapshots to 152 subscribers and the one `turn_ended`. The case is a measure, not a recommendation: a HUD that
lived with that many subscribers would want a policy for backlog that the services do not have.

## `Action.args` is the call's positional arguments

The schema language has exact objects only, and the P3 snapshot's `Action.args` was an object whose keys varied by action, so
it had no schema. A fixed `{unit_id}` with `0` for "none" would have given it one, but it leaves every caller to know which
intents take a unit, and the HUD would carry a rule it must not (React decides nothing about the game). `args` is now the
intent's positional arguments as an array of integers, schema `{array: integer}`, TypeScript `readonly Int[]`: `[unit_id]` for
`select_unit`, `found_city` and `fortify`, `[]` for `clear_selection` and `end_turn`. An action becomes a call with no
knowledge of the intents: `GodotFabric.call("frontier." + action.id, action.args)`.

What proves it:

- The P3 probe calls every action of every snapshot with `callv(action.id, action.args)` on a copy of the game, and the P3
  test pins the exact arguments: `[the selected unit's id]` for `found_city` and `fortify`, `[one of the tile's own units]` for
  `select_unit`, `[]` for the others.
- The services probe sends every action of the snapshot JavaScript holds back as `frontier.<id>` with its own `args`, on a copy
  of the reference session (never the live one, so the roteiro's states stay as they are). The call must name a registered
  method that takes that many arguments; it must be accepted exactly when the action is enabled and refused with the action's
  `reason` otherwise. The oracle checks each action's `args` against the method's argument schema derived from the TypeScript
  tuples, and the reported results, at all 73 steps.

The snapshot is not part of the state, so the golden hash and the trace hash did not change; `npm run test:civ-lite-game` shows
the same two hashes.

## One schema source in GDScript, hand-written types in TypeScript

`schema.gd` holds the schemas as `const`: the DTO and its parts, `turn_ended`, the arguments of each method and the result.
`consumers/civ-lite/ui/frontier-types.ts` is the TypeScript mirror, written by hand: the repository has no generator and this
slice does not add one. It declares `FrontierSnapshot` and its parts (`Selection`, `Stock`, `Resources`,
`Action`, `UnitCard`, `TileCard`, `QueueEntry`, `Item`, `GarrisonEntry`, `CityScreen`, `Tech`, `Research`, `Choice`,
`Dialog`), `FrontierTurnEnded` (with `TurnPhase`) and `FrontierResult`, the maps `FrontierStates`, `FrontierSignals` and
`FrontierMethods` (name to what it carries: the value, the argument tuple), and one constant per registered name.

Conventions:

- `type Int = number` is the registry's `integer`. A bare `number` would convert to `number`, which the registry also has and
  the types do not use; the parity then reports the field.
- No optional field, no `any` or `unknown`, no union, no generic, no `extends`: the extractor refuses them by name, because the
  schema language cannot say them.
- A shape a signal carries (`FrontierTurnEnded`, `TurnPhase`) is a type alias of an object literal with mutable arrays: the
  transport's `GodotDTO` constraint on signal argument tuples accepts that and not an interface, which has no index signature.
- `callFrontier(method, args)` is the one function in the file. `GodotFabric.call` takes any `readonly GodotDTO[]`, so a wrong
  type or count would compile and fail only at the boundary; through `callFrontier` it does not compile. Its parameters are one
  `FrontierCall`, a union of `[method, args]` tuples, one per method, so the name and its arguments are a pair: a name that is
  itself a union of two methods does not accept the arguments of only one of them (indexing `FrontierMethods` by a generic name
  would have).

### The parity test

`tests/frontier-services-parity.test.mjs` reads `frontier-types.ts` with the TypeScript compiler API (the extractor lives in
`tests/frontier-services-oracle.mjs` and is the schema source of the oracle too, so the two checks do not share an author with
the GDScript), converts every interface and map to the registry's schema language, and compares it deeply with the schemas the
probe dumped from the node's registrations, in both directions. Differences are reported one per line, naming the field:

```
frontier.snapshot.actions[].reason_text: declared in TypeScript, missing from Godot's schema
frontier.move_unit: TypeScript declares 3 arguments, Godot registers 2
frontier.snapshot.epoch: TypeScript declares "number", Godot registers "integer"
```

The retained negative cases apply 18 synthetic mutations (a field removed, nested or not, one added, `integer` swapped for
`string`, an array turned into its element, an action's `args` element retyped or the array turned into an object, a signal
payload field removed, an argument removed or added or retyped, a result field removed or added, and the `job` of a result, of
`turn_ended` and the `last_job` of the snapshot removed or retyped) to each side in turn and require the comparison to report the
field. It also requires that a name registered on one side only, or of another kind,
fails, that the extractor refuses nine kinds of unsupported TypeScript, that the oracle's validator rejects a snapshot with a
field more or less or of another type, and that the oracle rejects a report in which an action's `args` are not its method's
arguments (wrong count, wrong type) or in which an action was not accepted when enabled. It requires that `end_turn` is the one
method registered to answer on acceptance, and a second test requires the oracle to reject 21 mutants of a report for what the
job guarantees (a phase's snapshot missing, `last_job` set early, the phases in one frame, `turn_ended` twice, a job counted twice,
a wrong id, `end_turn` answering on completion, a refused one starting a job, a pump leaving work pending or over budget, a call
accepted while the job ran, a root held while the screen was closed, the screen closed after the job had run, a job received twice
after the remount, a remounted root at the wrong job, a delivery out of order, a lost snapshot, a drain in too many pumps, a
backlog that never grew, a job lost from the log). The test refuses a stale dump: it checks that the sources pinned in the report
are the ones in the tree.

`tests/types/frontier-services.tsx`, included in `tsconfig.godot.json` and so in `npm run type-check`, holds the type-level
cases in the style of `tests/types/godot-fabric.tsx`: `connect<FrontierSnapshot>`, `subscribe<[FrontierTurnEnded]>` and
`callFrontier` with the right tuples; and, with `@ts-expect-error`, a wrong argument type, a wrong count, an unknown method, a name that is a union of two methods called with the arguments of
only one of them, a `FrontierCall` pairing a name with another method's arguments,
a field the snapshot does not have, an action's `args` read as an object or as strings or pushed to, an `ok` treated as a
boolean, a `turn` read from a result and a `job` read as a string. A positive case sends each action of a snapshot back with
`GodotFabric.call("frontier." + action.id, action.args)`.

## Schema violations

A JavaScript caller that breaks a method's schema is rejected with `E_SERVICE_SCHEMA` before the GDScript callback runs
(`native/game_service_registry.cpp:655`). The probe proves "before" with a counter in the node that counts every callback
that ran: it does not move. Eleven cases, ten rejected by the schema and one control:

| Case | Call | Error |
| --- | --- | --- |
| wrong type | `select_tile("6", 8)` | `E_SERVICE_SCHEMA` |
| wrong type, a fraction | `move_unit(1, 7.5, 8)` | `E_SERVICE_SCHEMA` |
| wrong type, a number for a string | `set_research(7)` | `E_SERVICE_SCHEMA` |
| wrong type, a string for an integer | `set_production("warrior", "0")` | `E_SERVICE_SCHEMA` |
| arity, too few | `select_tile(6)` | `E_SERVICE_SCHEMA` |
| arity, too many | `select_unit(1, 2)` | `E_SERVICE_SCHEMA` |
| arity, an argument for a method with none | `end_turn(1)` | `E_SERVICE_SCHEMA` |
| arity, none for a method with one | `found_city()` | `E_SERVICE_SCHEMA` |
| extra field, an object with an extra field for an integer | `select_unit({unit_id: 1, extra: 2})` | `E_SERVICE_SCHEMA` |
| extra field, an object for a string | `resolve_event({choice_id: "welcome"})` | `E_SERVICE_SCHEMA` |
| a service that was never registered (control) | `frontier.nope()` | `E_SERVICE_MISSING` |

Each rejected case also publishes no snapshot and no `turn_ended`, and leaves the state hash as it was. The control shows that
the check for a missing service can fail.

## What the probe and the oracle measured

`npm run test:frontier-services` runs `tests/frontier-services-native.test.mjs` and then
`tests/frontier-services-parity.test.mjs` in sequence (the second reads the report the first leaves).

`tests/frontier-services-probe.gd` builds the scene of a consumer in the official headless Godot on the root project: the
`GameServices` node, a child `Application` that emits `runtime_available` while it enters the tree, and a `FabricSurface`. The
child is a stand-in for `sdk/addon/application_node.gd`: it builds the `FabricApplication` and emits the signal, without the
Resource that node requires, because the bundle lives in `build/` and not under `res://.godot_fabric/`. The bundle
(`tests/frontier-services-fixture.jsx`) stands in for the HUD: it imports the public `@godot-fabric/runtime` and the types of
the slice, connects when it evaluates and plays the roteiro one call at a time as the probe tells it to. The roteiro
(`consumers/civ-lite/game/replay.gd`) reaches it as a prop from the probe, never typed again. A second `FrontierGame` in the
process, which the services never touch, plays the same steps and is the reference.

- **Registration before the mount.** The bundle's own connections, made as it evaluates, were ready with no error (a late
  registration answers `E_SERVICE_MISSING` there); the first connection received the initial snapshot of epoch 1; the registry
  held the 14 bindings (15 since the hover state of 2026-10-09; see the update in "The node and its lifecycle").
- **Round trip.** At all 73 steps the snapshot JavaScript holds is byte-for-byte the node's canonical snapshot and the
  reference session's.
- **Actions are calls.** At all 73 steps every action of the snapshot JavaScript holds is sent back as `frontier.<id>(args)`,
  with its own `args` and nothing else, on a copy of the reference session (the live one is never touched, so the roteiro's
  hashes are intact). It names a registered method that takes that many arguments, is accepted exactly when it is enabled and is
  refused with its `reason` otherwise.
- **The roteiro through the services.** 73 steps: 43 accepted and 30 refused. Each answer is the uniform
  `{ok, code, text, job}` and has the roteiro's code; `end_turn` answers on acceptance. The 24 refusal codes the roteiro plays
  reach JavaScript with `ok: 0`, the same code and the same text, and publish nothing. Each of the 12 accepted `end_turn` was a job:
  seven snapshots through the six phases, one a frame, and one `turn_ended` with the six phases in order (`ai_plan`, `ai_move`,
  `production`, `growth`, `research`, `refresh`) and the job, before the snapshot of the turn that begins, which carries
  `last_job`. The probe waits for each job before the next step. The state of the node is the reference's at every step, and the
  final hash is the P3 golden hash
  `275b7c6182605a784d8be3565d4df38a5bb130aaa6c0ea7640abe4c521427d29`; the hashes of all 73 steps make the P3 trace hash
  `fba99004fa12e253b9a6fe7f8bbee0cbd6e468a67308d25d0c40236f48c68cb8`.
- **Persistence.** The surface is unmounted in the frame after the node accepted the third `end_turn`, with the job's first phase
  not yet run: the panel's connection is removed, the root is gone, and the registry still holds 14 bindings (15 since 2026-10-09) under the same
  registration generation (`"1"`), the same node and game and the same epoch. The job goes on with no root and finishes once
  (see "The turn is a job"). One more step is played with no surface at all (`select_tile(7, 8)`) and the node answers it. The
  surface is mounted again: the panel reconnects, its first value is the current snapshot (at rest, turn 4, `last_job` 3), and it
  is of the same generation, so nothing was registered a second time.
- **DTO limits.** The largest snapshot of the roteiro has 174 value nodes and depth 4 (the limits are 10,000 and 32). One
  state, one signal and twelve methods are 14 bindings (two states since 2026-10-09: 15).
- **The dump of the registered schemas** goes in the report for the parity test.

`tests/frontier-services-oracle.mjs` judges the raw report without trusting the probe's verdicts. It derives the schema from
the TypeScript types (not from GDScript) and validates every received snapshot against it, exactly; requires canonical text,
agreement with the serialized state (turn, phase, selection, stocks, city), every action's `args` against its method's argument
schema and the result of sending it back, the refusal table's codes and texts, one snapshot per
accepted intent and none per refusal, strictly rising revisions with those only, `turn_ended` once per accepted `end_turn` and
in order, epochs rising by 1 with the initial hash, the SHA-256 of every serialization, the golden and the trace hash, the
violations never reaching GDScript, and the persistence figures above. For each job it requires the id, the seven snapshots with
the turn and `last_job` they must show, the consecutive frames, the pumps of each frame (nothing pending after it, at most 64
tasks and 128 events), the calls refused while it ran, the figures of the job that outlived its screen, the stress case (events
per publication, pumps, no loss, FIFO) and the jobs of the whole probe. `verifyRuleLane` judges the two runs of the rule lane.

### Retained sabotages

`node scripts/frontier-services-sabotage.mjs` breaks one GDScript source at a time through `scripts/sabotage-sources.mjs`
(restored byte for byte whatever ends the run, proven by hash), runs the native test with `--sabotage=<name>`, and the probe's
checks, the oracle or the parity must reject it for the reason it was broken. The restored node must then pass the plain test.

| Sabotage | Break | Rejected by |
| --- | --- | --- |
| `schema-drift` | `schema.gd` loses an action's `reason_text` | the registry refuses the bundle's first connection (`E_SERVICE_SCHEMA`: the snapshot no longer matches its schema); the parity names `frontier.snapshot.actions[].reason_text`; the oracle |
| `late-register` | the services are registered from `_ready` instead of `runtime_available` in `_enter_tree` | both bundle connections get `E_SERVICE_MISSING`; the probe and the oracle (the schemas themselves still agree) |
| `silent-intent` | `found_city` is accepted and publishes no snapshot | the step's snapshot check and its publish check; the oracle at step 18 |
| `frozen-epoch` | `new_game` does not raise the epoch | the probe's epoch checks; the oracle at the first `new_game` |
| `emit-on-refusal` | a refused intent publishes a snapshot | the probe at every refusal; the oracle at step 0 |
| `action-args-drift` | the snapshot's `found_city` action (in the game's `snapshot.gd`) carries `[]` instead of `[unit_id]` | the probe's send-back of every action at step 3; the oracle, which checks each action's `args` against its method's schema |
| `turn-ended-order` | `turn_ended` is emitted after the snapshot of the turn that begins | the probe at every `end_turn`; the oracle at step 16 |
| `double-finish` | `turn_ended` is emitted twice at the end of the job | the probe at every `end_turn` (a turn ends exactly when an `end_turn` is accepted); the oracle at step 16 |
| `job-dies-with-screen` | the driver stops when the application holds no root: the job is abandoned and never finishes | the probe's persistence checks at the third job (it finished once, with no surface); the oracle |
| `sync-end-turn` | `end_turn` runs every phase inside the callback, as it did before the job | the probe at step 16: the node did not advance one phase per frame, and the calls made while the job should run were not refused; the oracle |
| `stale-snapshot` | the snapshot of the `growth` phase is not published | the probe at step 16: the job publishes six snapshots and not seven; the oracle |

### No previous host

This slice has no C++ and changes nothing in `native/`, `src/` or `sdk/`, so there is no previous host to compare with: the
control with a previous host does not apply, and no previous-host report exists. The restored sources are proven by hash and
must pass the plain test.

## What stays open

- **`consumidor`.** Closed by the next package: `consumers/civ-lite/` is a provisioned consumer project, the node's facade is
  injected and the ten cycles run in it ([frontier-consumer.md](frontier-consumer.md)). The probe here still builds its scene in
  code, with a stand-in for the addon's application node, because its bundle lives in `build/`.
- **`autoridade`** is closed by "The turn is a job". What it does not do: cancel a job (there is no cancel method; the
  contract is that a job finishes, and a new game abandons it), keep a job across a new application (D22 and D23 are pending),
  resolve a backlog (the stress case measures that the queue drains in order and without loss, and does not propose a policy), or
  run the headed and the hosted lanes: the figures above are headless, on one machine.
- **The HUD** (V05-05) and the native HUD of arm B (V05-10): nothing here mounts a panel. The bundle is a probe fixture.
- **No generator.** The TypeScript types are written by hand and the parity test is what keeps the two sides together. It
  checks names and shapes; it does not check that a type means what its name says.
- **Typed `subscribe` and `connect` helpers** beyond `callFrontier` are not provided: a HUD calls `GodotFabric.connect` with
  `FrontierSnapshot` and `GodotFabric.subscribe` with `[FrontierTurnEnded]`, which the type test shows.
- **Hosted CI** for `npm run test:frontier-services` is pending; the local record is the [evidence](../evidence/frontier-services/README.md).

## Compatibility

No React Native export, TurboModule or prop changed: nothing in `src/`, `sdk/` or `native/` was edited, so `docs/API.md`,
`docs/NATIVE_MODULES.md`, `docs/PARITY.md` (an audit of React Native's API) and `docs/compatibility/` do not apply. The
public services API is unchanged; [docs/GAME_SERVICES.md](../GAME_SERVICES.md) names Frontier as a reference consumer with a
nested object schema and, for `autoridade`, as the example of an accepted job. There is no example directory for this slice,
because it has no HUD.
