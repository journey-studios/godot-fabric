# Frontier as a provisioned consumer (V05-03, criterion `consumidor`)

Milestone 0.5's third package puts Frontier, the reference game, in a project of its own. The template
`consumers/civ-lite/` is provisioned by the addon like `consumers/minimal`, built by the editor plugin with the addon's
private toolchain (no Node of the project's, no network), opens in the editor, and runs ten cycles of new game, intents through
its HUD, reloading the scenery and the menu, measured for what a leak would grow, with the epoch strictly increasing.

The criterion this closes is V05-03 `consumidor`: "Consumidor civ-lite provisionado pelo addon (TSX público, sem Node global)
abrindo no editor; 10 ciclos novo jogo, recarregar cenário e menu sem vazar listeners ou nós, com epoch monotônico". It does not
close `autoridade`, and it does not depend on D22 or D23 (below).

```sh
npm run test:consumer:civ-lite            # provisions, builds in the editor, runs the ten cycles, builds offline
npm run test:consumer:civ-lite -- --capture   # the same plus a headed run that saves the two screenshots
node scripts/consumer-civ-lite-sabotage.mjs   # the four retained sabotages and the control
```

## Sources

- `sdk/addon/application_node.gd:5` and `:28`: the `runtime_available` signal, emitted right after the `Runtime` child is
  added, so while the application enters the tree: before any surface mounts and before the bundle evaluates.
  `consumers/civ-lite/services/game_services.gd` registers from it, as `consumers/minimal/game.gd` does.
- `sdk/addon/godot_fabric.gd:1` and `:33-37`: `class_name GodotFabric` and `for_application(application)`. A provisioned
  project reaches the facade through the global class or through the script itself; the laboratory's root project keeps the SDK
  sources behind `.gdignore` and reaches the script by path.
- `scripts/create-consumer.mjs:16-18` copies the whole template directory (minus `.uid` and `.import`), `:19` provisions the
  addon with `scripts/pack-addon.mjs`, `:25-30` rewrites the README's `../../` links to the provisioned revision and `:34`
  writes `.godot/extension_list.cfg`. `scripts/consumer-harness.mjs` is the harness every consumer lane shares
  (`createHarness`, `editor()`, `runtime()`): a fresh project outside the checkout, `PATH=/usr/bin:/bin`, the editor build and the
  validation run with their logs and reports.
- `consumers/minimal/validation.gd:167-180`: the way a consumer reads the registry (`snapshot().gameServices` with `bindings`,
  `subscriptions`, `pendingHostTasks`, `pendingEvents`, `stopped`) and the connections of its own signals.
- `tests/performance-probe.gd:160-162` and `:525-548`, `docs/research/performance.md:55-58`: `get_node_count()`,
  `OBJECT_ORPHAN_NODE_COUNT` and `OBJECT_COUNT`, and the two things that note measured: a Control removed and not freed is an
  orphan, not an extra node, which is why both are checked.
- `docs/ARCHITECTURE_V2_DECISIONS.md` D22 and D23 (both pending): when a build may replace the application and what a reload
  loses. This slice does not need either: see "The scene".
- `docs/research/frontier-game.md` and `docs/research/frontier-services.md`: the game and its typed services, which this slice
  consumes and changes in one place (the facade, and the one method below).

## The template and its provisioning

`consumers/civ-lite/` gains what `consumers/minimal/` has and it lacked, and keeps `game/` and `services/` where they were:

| File | What it is |
| --- | --- |
| `project.godot` | enables `res://addons/godot_fabric/plugin.cfg`; `[godot_fabric] application="res://ui/application.tres"`; main scene `res://main.tscn`, 1080x600 |
| `main.tscn` | the scene (below) |
| `ui/application.tres` | `entry_file="res://ui/index.tsx"`, `bundle_file="res://.godot_fabric/app.js"` |
| `ui/index.tsx` | the HUD, public TSX |
| `ui/frontier-types.ts` | the hand-written types of the services, as before |
| `world/world.tscn`, `world/world.gd` | the scenery |
| `validation.gd` | the ten cycles, run with `-- --validate` |
| `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore` | the same pinned peers (`react` 19.2.3, `react-native` 0.87.1) and paths as the minimal template; the project has no dependency of its own |
| `README.md` | the consumer's guide; its `../../` links are the ones `create-consumer` rewrites |

**The root project still loads the game and the services.** With a `project.godot` inside `consumers/civ-lite/`, Godot treats the
folder as a project of its own and the root project's file scan skips it. The scripts do not need the scan: the probes
`preload("res://consumers/civ-lite/game/...")` by path and the relative `preload("../game/rules.gd")` inside the template keep
working. Before anything else was changed, `project.godot` was added and `npm run test:civ-lite-game` (1 test) and
`npm run test:frontier-services` (8 tests) were run, and passed.

`scripts/consumer-civ-lite-check.mjs` provisions the template with `create-consumer.mjs` into a fresh directory, and checks:
no global Node (`spawnSync("node")` gives `ENOENT`); the project is the template plus the addon, with no `sdk`, `tests`,
`build`, `consumers`, `examples`, `src` or `native` directory; the scene injects the addon's facade and no script names the
laboratory's path; the HUD's imports are only `react`, `react-native`, `@godot-fabric/runtime` and `./frontier-types`; the guide's
links point at the provisioned revision; the editor build prints `CONSUMER_EDITOR_BUILD_PASSED` with no `ERROR:` and leaves the
lockfile alone; the validation runs; the bundle's inputs have nothing of the laboratory, of `examples/` or of a project
dependency; and the same bundle comes out of the addon's builder under `sandbox-exec` with the network denied.

## The scene

`main.tscn`'s root is the `GameServices` node (`services/game_services.gd`), and its children are:

```text
GameServices            services/game_services.gd   fabric_api = addons/godot_fabric/godot_fabric.gd, world_scene = world/world.tscn
├── Application         addons/godot_fabric/application_node.gd + ui/application.tres
├── World               world/world.tscn
├── HUDLayer (CanvasLayer)
│   └── HUD             FabricSurface, full screen, application_path = ../../Application/Runtime, component FrontierHUD
└── Validation          validation.gd, inert without --validate
```

**Why the root is the services node.** The application, its registry, the bindings and the epoch are the root's, so they live
for the life of the application. Reloading the scenery, going to the menu and starting a game only drop and bring back
`World`, a leaf. Nothing in a cycle recreates the application, the registry or the `GameServices` node, and the epoch, which is
a field of the node, can only go up: monotonic by construction, and measured to be.

**Why that is the design, and what it leaves out.** Recreating the application restarts the registry and its registration
generation, and what a HUD then sees is a reconnection after a reload: that is D22 (when a build may replace the application and
how it recovers) and D23 (what a reload loses), both pending. The acceptance of V05-03 says "sem depender de reconexão nem de
gerações de ativação (D22 e D23 pendentes)", and this scene is how it does not depend on them: the HUD's connections come and
go with its screens, but the application they connect to is the same one throughout.

**Who drops and brings back the World.** `GameServices` does, when the scene's owner gave it a `world_scene`
(`_ensure_world`, `_drop_world` in `game_services.gd`). Dropping is `remove_child` and then `queue_free`: out of the tree at
once, freed at the end of the frame. `new_game` brings a World back if there is none, before it publishes the snapshot;
`reload_world()` (a method of the scene's owner, not a service) drops the World and starts a new game; `open_menu` (a service)
drops it. A node without `world_scene`, such as the laboratory's probe, has none of this to do.

## The injected facade

`game_services.gd` used to `preload("res://sdk/addon/godot_fabric.gd")`, a path that exists only in the laboratory. It now has
`@export var fabric_api: Script`, and the owner of the scene injects the facade:

- **Provisioned:** `main.tscn` points it at `res://addons/godot_fabric/godot_fabric.gd` as an `ext_resource`. The project's
  scripts name no SDK path and not the global `GodotFabric` class either.
- **Laboratory:** `tests/frontier-services-probe.gd` assigns `preload("res://sdk/addon/godot_fabric.gd")` before the node enters
  the tree.
- **Without it,** `_bind_services` calls `push_error("FABRIC_ERROR: GameServices has no fabric_api; ...")` and registers
  nothing. The sabotage `no-facade` shows the loudness: the log has the `FABRIC_ERROR`, and the validation fails its first
  checks.

`for_application` is a static function, called through the `Script` the node holds; GDScript accepts that and the scene runs
it in both worlds. The `late-register` sabotage of the services and the source hashes of the parity test needed no change: the
sabotage's `find` text (`_enter_tree` connecting `runtime_available`) is unchanged, because the facade check is inside
`_bind_services`, and the node defines no `_ready` for the sabotage to collide with.

## The scenery

`world/world.gd` is a `Node2D` of the scene, a child of `GameServices`. It draws the 24x16 map with one `draw_rect` per tile in
the colour of its terrain, the city and the units as markers and the selected tile outlined; it reads
`services.game.state` (terrain, units, city, selection) and decides no rule; and it calls `queue_redraw` when the node
publishes `snapshot_changed`.

The World connects a plain method (`services.snapshot_changed.connect(_on_snapshot_changed)`, which calls `queue_redraw`) in
`_enter_tree` and disconnects it in `_exit_tree`.

**Why there is no sabotage for a World that forgets to disconnect.** A first design had one ("the World does not disconnect
`snapshot_changed` in `_exit_tree`"), and it was dropped because that leak cannot happen. A throwaway script in Godot 4.7.2 (not
kept in the repository) connected a Node's method, a lambda made inside a Node, a lambda made inside a RefCounted and a
RefCounted's method to one long-lived signal, dropped the last reference to the RefCounted objects and freed the nodes:

```text
connections before free: 3        (the RefCounted method's connection went with its object, when its last reference did)
connections after node frees: 1
  remaining: <anonymous lambda>(self lambda)
orphans: 1.0 nodes: 2             (a removed node that is not freed: an orphan, and not in get_node_count())
```

The engine drops a connection whose target is a freed Node, lambdas included. Only a lambda made by a RefCounted outlives its
object, because the lambda holds the object and the signal holds the lambda, and a World written that way would pay for an
indirection that exists to make the sabotage possible. So the World stays plain. Its explicit disconnect in `_exit_tree` is
symmetry, and it matters in the frame between `remove_child` and the free, when the World is out of the tree and alive; it is not
what prevents a leak. What the check keeps is the guard: the connections of `snapshot_changed` after every cycle are the first
cycle's (the registry's and the World's), so a World that stayed connected through some other path would be seen. A World that is
not freed is another leak, with its own sabotage (`orphan`).

## The menu

The HUD has two screens, `game` and `menu`, React state. Going to the menu has to tell Godot, because the World has to leave the
tree, and the services are the only channel from JavaScript to Godot. The spec preferred not to add a method; the one that is
unavoidable is for this, not for the World's return, which `new_game` does by itself.

- **`frontier.open_menu()`** is the 12th method, answering the uniform `{ok, code, text}`. It is not a rule of the game: it
  drops the World, changes no state, publishes no snapshot and leaves the epoch alone. It is in `schema.gd`
  (`METHOD_ARGS`), in `frontier-types.ts` (`FrontierMethods` and `FRONTIER_OPEN_MENU`) and therefore in the parity test, which
  now counts one state, one signal and 12 methods: **14 bindings**, where the package before had 13. The probe, the oracle and
  the parity test were changed for that count and nothing else.
- **New game in the menu** calls `frontier.new_game` (the epoch rises by 1); with no World, `GameServices` instantiates one from
  `world_scene` before it publishes the snapshot, and the HUD, which called it from the menu, goes back to the `game` screen and
  connects again to receive the new epoch.

## The HUD

`ui/index.tsx` is public TSX. It imports `react`, `react-native` (`View`, `Text`, `Pressable`), `@godot-fabric/runtime` and
`./frontier-types`, and uses only props the 0.5 scope allows (`docs/compatibility/scope-0.5.json`: `testID`, `style`,
`onPress`, `disabled` and children, every one `supported` in the table of `src/prop-scope.mjs`, whose `checkProps` accepts the
props it passes; the style names are the ones the view and text configs already list). The check of the props was run against
that table as it is on the revision that added it, and this slice's own runs are on the tree before it. The game screen connects to `frontier.snapshot` in an effect whose cleanup removes the
connection, shows the turn and the epoch, the context and the phase, the three stocks and every action with its label (inert,
with the game's `reason_text` under it, when `enabled` is 0), and sends an action back as `frontier.<id>(args)` with the
arguments the snapshot's action carries. The screens call `frontier.open_menu` and `frontier.new_game`. There is no rule in it.

`globalThis.FrontierHud` exposes `stats()` (the connections the HUD holds now, the calls it made and answered, the epochs it saw,
the problems it met, the screen) and `send(id, args)` (the function its buttons use) for the validation to read: nothing in the HUD
reads them. They are bounded, because a HUD lives as long as the game and this one is the template to copy: the counters
(`resultCount`, `epochCount`, `problemCount`) count for the life of the HUD, each list keeps only the last 64 entries, and a reader
that wants what is new subtracts the counter it saw from the one it sees and takes that many from the end of the list, which is
what `validation.gd` does for each cycle (six results, three epochs).

## The ten cycles

`validation.gd` is run by `harness.runtime()` with `-- --validate`. Each cycle:

1. **(a)** presses New game on the HUD;
2. **(b)** three intents of the roteiro through the HUD: `select_unit [1]` and `move_unit [1, 7, 8]` sent with the HUD's own
   function, and End turn pressed on the HUD (the button of the action `end_turn` of the snapshot);
3. **(c)** reloads the scenery: `reload_world()`, which drops the World and starts a new game;
4. **(d)** presses Menu: the World leaves the tree and is freed, the HUD shows the menu and lets go of the snapshot;
5. **(e)** presses New game in the menu: a World is back, the HUD is on the game screen again.

A button is pressed as a user would, headless or headed: the mouse goes down and up on the centre of the Pressable's control
through the viewport. Every wait is for state (the epoch the HUD saw is the node's, the HUD shows `Turn 1 · epoch N`, the World
exists or is gone, the HUD's connection count is 0), with a frame count only as its limit; two frames at the end let the
`queue_free` of the dropped Worlds happen. The first cycle is the baseline and the nine others have to come back to it.

Per cycle it measures, and the check script reads the series again from the report and does not take Godot's comparison on
trust:

| Measure | Where it comes from | Expected after every cycle |
| --- | --- | --- |
| nodes of the tree | `get_tree().get_node_count()` | the first cycle's |
| orphan nodes | `Performance.OBJECT_ORPHAN_NODE_COUNT` | the first cycle's |
| bindings | `snapshot().gameServices.bindings` | 14 |
| subscriptions | `snapshot().gameServices.subscriptions` | the first cycle's |
| pending work | `gameServices.pendingHostTasks`, `pendingEvents` | 0 and 0 |
| connections of `snapshot_changed` | `get_connections().size()` | the first cycle's: the registry's and the World's |
| connections the HUD holds | `FrontierHud.stats().subscriptions` | the first cycle's |
| epoch | `GameServices.epoch`, and the HUD's last | the previous one plus exactly 3 (a, c and e), equal in both, and the HUD saw each one in order |
| the dropped Worlds | `instance_from_id` of the two that the cycle dropped | freed |
| errors | `snapshot().errors`, the HUD's problems, and the log | none; no `FABRIC_ERROR`, no `SCRIPT ERROR` |

`OBJECT_COUNT` is recorded in the report and not asserted: it is 1616 in every cycle of the headless run, and 1615, 1618 and
then 1620 from the third cycle on in the headed one (a renderer warming up), so it does not say "back to the first cycle" the
way the asserted measures do. The count of checks is exact and fixed in the script: **145 native checks**, 6 before the cycles,
10 in the first, 14 in each of the other nine, 3 after them; the headed run adds the three of the captures (148).

The run on the machine of this slice (the series is `build/consumer-civ-lite/series.json`; the headed run gave the same values
for every measure in the table):

| Cycle | nodes | orphans | bindings | subscriptions | `snapshot_changed` connections | HUD connections | epoch (Godot, HUD) |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 21 | 0 | 14 | 1 | 2 | 1 | 4, 4 |
| 2 | 21 | 0 | 14 | 1 | 2 | 1 | 7, 7 |
| 3 | 21 | 0 | 14 | 1 | 2 | 1 | 10, 10 |
| 4 | 21 | 0 | 14 | 1 | 2 | 1 | 13, 13 |
| 5 | 21 | 0 | 14 | 1 | 2 | 1 | 16, 16 |
| 6 | 21 | 0 | 14 | 1 | 2 | 1 | 19, 19 |
| 7 | 21 | 0 | 14 | 1 | 2 | 1 | 22, 22 |
| 8 | 21 | 0 | 14 | 1 | 2 | 1 | 25, 25 |
| 9 | 21 | 0 | 14 | 1 | 2 | 1 | 28, 28 |
| 10 | 21 | 0 | 14 | 1 | 2 | 1 | 31, 31 |

After the ten cycles the validation stops the application: the registry reports `stopped`, no binding, no subscription and
nothing pending, and `snapshot_changed` keeps only the World's connection.

## The retained sabotages

`node scripts/consumer-civ-lite-sabotage.mjs` breaks one source of the template at a time (`scripts/sabotage-sources.mjs`
restores it byte for byte whatever ends the run, proven by hash), runs `scripts/consumer-civ-lite-check.mjs --sabotage=<name>`
(which provisions the broken template, builds it in the editor and runs its validation with `--sabotage`), and requires the
validation to reject it for the reason it was broken. The result file of each variant is deleted before it runs, and a variant
that leaves none (a crash, an assertion that came first) is not rejected. The restored template must then pass the plain check.

| Sabotage | Break | What the series and the checks showed |
| --- | --- | --- |
| `hud-leak` | the HUD's effect no longer removes its connection | the registry's subscriptions and the HUD's 2 at cycle 1 and 11 at the tenth; 29 failed checks, the first the menu check of cycle 1 |
| `orphan` | `remove_child` without `queue_free` when the World is dropped | orphans 2 at cycle 1 and 20 at the tenth, the nodes of the tree unchanged (21); 19 failed checks, the first that the dropped Worlds are not freed |
| `epoch-reset` | `reload_world` zeroes the epoch before the new game | the epoch ends the tenth cycle at 2; 21 failed checks, the first that the cycle rose 1 and not 3 |
| `no-facade` | `main.tscn` no longer injects the facade | the log has `FABRIC_ERROR: GameServices has no fabric_api`; the node registered no binding; the 3 preflight checks fail and no cycle is run |

The baseline of a sabotaged run is already contaminated (the first cycle leaks too), so the comparison with the first cycle
catches the growth and the cycle-level checks catch the first leak.

## No previous host

This slice has no C++ and changes nothing in `native/`, `src/` or `sdk/`, so there is no previous host to compare with: the
control with a previous host does not apply. The restored sources are proven by hash and the restored template passes the plain
check.

## What stays open

- **`autoridade`.** A job that survives closing the screen, and bursts against the 64 tasks and 128 events a phase, are not
  measured here. `end_turn` is still one synchronous GDScript call.
- **D22 and D23.** Reconnection after a reload and the activation generations are out; nothing here recreates the application.
  A consumer that does recreate it is not this scene, and what its HUD should then see is those decisions'.
- **The playable HUD** is V05-05: this one is the smallest that serves the services (no map input, no city or research screen,
  no dialog), and the scenery draws no coordinates and takes no input.
- **The headed run** (`--capture`) is local, on one machine; hosted CI runs the headless check, and hosted CI for this lane is
  pending.
- **What the cycles do not measure:** time, frame cost and memory (`OBJECT_COUNT` is recorded, not asserted), and a HUD that
  stays on a screen for a long time.
- **No generator** for the TypeScript types: the parity test is still what keeps them with the schemas.

## Compatibility

No React Native export, TurboModule or prop changed and nothing in `src/`, `sdk/` or `native/` was edited, so `docs/API.md`,
`docs/NATIVE_MODULES.md`, `docs/PARITY.md` and `docs/compatibility/` do not apply. The public services API is unchanged. The
HUD stays inside the 0.5 scope (View, Text, Pressable). `examples/` has no directory for this slice: the template is the
example, and `examples/README.md` lists consumers only through its own text.
