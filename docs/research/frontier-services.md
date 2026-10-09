# Frontier's services: the GameServices node, its epoch and the types in parity

Status: implemented and executed locally on macOS arm64 against pinned RN 0.87.1 and official Godot 4.7.2 (headless), for
the criterion `servicos` of V05-03. The [evidence record](../evidence/frontier-services/README.md) pins the local runs at
commit `75c4c0f`; hosted CI for `npm run test:frontier-services` is pending.

The second package of the 0.5 milestone exposes the Frontier game ([research](frontier-game.md), rules in GDScript, already on
`main`) to a React Native HUD through the typed game services the repository already has
([docs/GAME_SERVICES.md](../GAME_SERVICES.md)). The criterion it closes is the one in `dashboard/migration.json`
(`milestones[0]`, item V05-03, `servicos`): a persistent `GameServices` node with an epoch, whose states, signals and methods
are registered before the mount, with schemas and TypeScript types tested for parity between Godot and TypeScript, positive
and negative.

It closes only that criterion. `consumidor` (provisioning by the addon, the editor, ten cycles) and `autoridade` (a job that
survives closing the screen, bursts against the 64/128 budgets) are not in this slice; see "What stays open". There is no HUD
here: the playable HUD is V05-05, so there is no example and no screenshot.

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
| `frontier.snapshot` | state | the snapshot DTO (`FrontierSnapshot`), exact schema | its signal `snapshot_changed(snapshot)` fires once after every accepted intent and every `new_game`; a refused intent fires nothing |
| `frontier.turn_ended` | signal | one argument, `{turn: integer, phases: [{name: string, tasks: integer, events: integer}]}` | after an accepted `end_turn`, before that turn's `snapshot_changed` |
| `frontier.select_tile` | method | `(x: integer, y: integer)` | |
| `frontier.select_unit` | method | `(unit_id: integer)` | |
| `frontier.clear_selection` | method | `()` | |
| `frontier.move_unit` | method | `(unit_id: integer, x: integer, y: integer)` | |
| `frontier.found_city` | method | `(unit_id: integer)` | |
| `frontier.fortify` | method | `(unit_id: integer)` | |
| `frontier.set_production` | method | `(item_id: string, slot: integer)` | |
| `frontier.set_research` | method | `(tech_id: string)` | |
| `frontier.resolve_event` | method | `(choice_id: string)` | |
| `frontier.end_turn` | method | `()` | |
| `frontier.new_game` | method | `()` | |
| `frontier.open_menu` | method | `()` | not a rule of the game: the scene drops its World (`world_scene`, when the owner gave one); no snapshot, the epoch is untouched |

Every method answers the same object, `{ok: integer, code: string, text: string}` (response `completion`, the default):
`ok` is 0 or 1, `code` is `"ok"` or the game's refusal code, `text` is what the HUD shows (`""` when accepted). The schema
language has no optional field and no union, so one result cannot be `{ok, code, text}` for most intents and
`{ok, code, text, turn, phases}` for `end_turn`. What the game adds to `end_turn`'s answer (`turn` and `phases`) goes out on
`frontier.turn_ended` instead, and the new turn is in the snapshot. A refused intent is a normal answer with `ok: 0`, not a
rejection: the game decided, and nothing changed.

### Emission

An accepted intent publishes the whole snapshot once (`bind_state` requires the changed signal to carry one complete state
value). The snapshot is read after the intent applied. For `end_turn` the order in the queue is `turn_ended`, then
`snapshot_changed`, so a HUD that reacts to the phases sees them before it sees the turn that begins. A refused intent
publishes nothing and does not run the game's apply step.

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

The retained negative cases apply 13 synthetic mutations (a field removed, nested or not, one added, `integer` swapped for
`string`, an array turned into its element, an action's `args` element retyped or the array turned into an object, a signal
payload field removed, an argument removed or added or retyped, a result field removed or added) to each side in turn and
require the comparison to report the field. It also requires that a name registered on one side only, or of another kind,
fails, that the extractor refuses nine kinds of unsupported TypeScript, that the oracle's validator rejects a snapshot with a
field more or less or of another type, and that the oracle rejects a report in which an action's `args` are not its method's
arguments (wrong count, wrong type) or in which an action was not accepted when enabled. The test refuses a stale dump: it
checks that the sources pinned in the report are the ones in the tree.

`tests/types/frontier-services.tsx`, included in `tsconfig.godot.json` and so in `npm run type-check`, holds the type-level
cases in the style of `tests/types/godot-fabric.tsx`: `connect<FrontierSnapshot>`, `subscribe<[FrontierTurnEnded]>` and
`callFrontier` with the right tuples; and, with `@ts-expect-error`, a wrong argument type, a wrong count, an unknown method, a name that is a union of two methods called with the arguments of
only one of them, a `FrontierCall` pairing a name with another method's arguments,
a field the snapshot does not have, an action's `args` read as an object or as strings or pushed to, an `ok` treated as a
boolean, and a `turn` read from a result. A positive case sends each action of a snapshot back with
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
  held the 14 bindings.
- **Round trip.** At all 73 steps the snapshot JavaScript holds is byte-for-byte the node's canonical snapshot and the
  reference session's.
- **Actions are calls.** At all 73 steps every action of the snapshot JavaScript holds is sent back as `frontier.<id>(args)`,
  with its own `args` and nothing else, on a copy of the reference session (the live one is never touched, so the roteiro's
  hashes are intact). It names a registered method that takes that many arguments, is accepted exactly when it is enabled and is
  refused with its `reason` otherwise.
- **The roteiro through the services.** 73 steps: 43 accepted and 30 refused. Each answer is the uniform `{ok, code, text}` and
  has the roteiro's code. The 24 refusal codes the roteiro plays reach JavaScript with `ok: 0`, the same code and the same
  text, and publish nothing. Each of the 12 accepted `end_turn` produced one `turn_ended` with the six phases in order
  (`ai_plan`, `ai_move`, `production`, `growth`, `research`, `refresh`), before the snapshot of the turn that begins. The state
  of the node is the reference's at every step, and the final hash is the P3 golden hash
  `275b7c6182605a784d8be3565d4df38a5bb130aaa6c0ea7640abe4c521427d29`; the hashes of all 73 steps make the P3 trace hash
  `fba99004fa12e253b9a6fe7f8bbee0cbd6e468a67308d25d0c40236f48c68cb8`.
- **Persistence.** After the third accepted `end_turn` the probe unmounts the surface: the panel's connection is removed, the
  root is gone, and the registry still holds 14 bindings under the same registration generation (`"1"`), the same node and
  game, the same epoch and the same state. One more step is played with no surface at all (`select_tile(7, 8)`) and the node
  answers it. The surface is mounted again: the panel reconnects, its first value is the current snapshot, and it is of the
  same generation, so nothing was registered a second time.
- **DTO limits.** The largest snapshot of the roteiro has 173 value nodes and depth 4 (the limits are 10,000 and 32). One
  state, one signal and twelve methods are 14 bindings.
- **The dump of the registered schemas** goes in the report for the parity test.

`tests/frontier-services-oracle.mjs` judges the raw report without trusting the probe's verdicts. It derives the schema from
the TypeScript types (not from GDScript) and validates every received snapshot against it, exactly; requires canonical text,
agreement with the serialized state (turn, phase, selection, stocks, city), every action's `args` against its method's argument
schema and the result of sending it back, the refusal table's codes and texts, one snapshot per
accepted intent and none per refusal, strictly rising revisions with those only, `turn_ended` once per accepted `end_turn` and
in order, epochs rising by 1 with the initial hash, the SHA-256 of every serialization, the golden and the trace hash, the
violations never reaching GDScript, and the persistence figures above.

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
| `turn-ended-order` | `turn_ended` is emitted after the snapshot | the probe at every `end_turn`; the oracle at step 16 |

### No previous host

This slice has no C++ and changes nothing in `native/`, `src/` or `sdk/`, so there is no previous host to compare with: the
control with a previous host does not apply, and no previous-host report exists. The restored sources are proven by hash and
must pass the plain test.

## What stays open

- **`consumidor`.** Closed by the next package: `consumers/civ-lite/` is a provisioned consumer project, the node's facade is
  injected and the ten cycles run in it ([frontier-consumer.md](frontier-consumer.md)). The probe here still builds its scene in
  code, with a stand-in for the addon's application node, because its bundle lives in `build/`.
- **`autoridade`.** A job that survives closing the screen, and bursts against the 64 tasks and 128 events a phase, are not
  measured. `end_turn` here is one synchronous GDScript call; slicing it by phase for a frame budget (`begin_end_turn` and
  `advance_phase` exist in the game) is not wired to a service.
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
nested object schema. There is no example directory for this slice, because it has no HUD.
