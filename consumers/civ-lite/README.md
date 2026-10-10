# Frontier: a game provisioned as a consumer

Frontier is a small turn-based strategy game in the interaction style of Civilization 2, the reference game of the 0.5
milestone (a real app on this platform), not a product. Godot owns the map, the rules, the scripted faction and the turn; the
HUD is React Native over Godot and only projects a snapshot and sends intents.

This template becomes a separate Godot project after provisioning the addon, like `consumers/minimal`: its own
`project.godot`, scene, application Resource, package manifest and lockfile, and no import of the laboratory. Follow the
[SDK provisioning guide](../../sdk/README.md) first; the unprovisioned source cannot load its native surfaces, and the root
project loads only `game/` and `services/` from it. The research note is
[docs/research/frontier-consumer.md](../../docs/research/frontier-consumer.md).

## The scene

`main.tscn` has the persistent `GameServices` node (`services/game_services.gd`) as its root, and under it:

- `Application`: the addon's `application_node.gd` with `ui/application.tres`. It creates the native `Runtime` and emits
  `runtime_available`, on which `GameServices` registers the services, before the HUD mounts.
- `World`: the map, drawn tile by tile (`world/world.tscn`). It reads the session of its parent and draws it again when the node
  publishes a snapshot or the hovered tile changes. It decides no rule, but it is the map's pointer: a left click on a tile asks the
  node for the game's own `select_tile`, and the mouse over the map tells the node which tile is under it (`frontier.hover`). It listens
  in `_unhandled_input`, so it has to stay ahead of the HUD's layer in the tree (the node keeps it there).
- `HUDLayer/HUD`: a full-screen `FabricSurface` rendering `ui/index.tsx`.
- `Validation`, `HudValidation`, `OverlayValidation` and `StabilityValidation`: the project's own validations, inert unless the game runs
  with `-- --validate`, `-- --validate-hud`, `-- --validate-overlays` or `-- --validate-stability`.

The application, the registry, the bindings and the epoch belong to the root, so going to the menu, starting a game or
reloading the scenery never recreates them: the epoch only rises.

`GameServices` names no path to the SDK. The scene injects the facade, `fabric_api = res://addons/godot_fabric/godot_fabric.gd`,
and, optionally, the scene of the map as `world_scene`. Without a facade it fails loud (`FABRIC_ERROR`) and registers nothing.

## The HUD

The HUD is public TSX: its files import `react`, `react-native`, `@godot-fabric/runtime` and one another, and nothing else.
Godot derives the context of the session (`game/context.gd`) and the HUD mounts the panels that context calls for, which is all it
decides (`ui/hud/hud.tsx`):

| context | panels |
| --- | --- |
| `none` | bar |
| `tile` | bar, tile |
| `settler`, `warrior` | bar, actions, tile |
| `stack` | bar, actions (one `select_unit` per unit), tile |
| `city` | bar, city, research |
| `dialog` | bar, dialog |

The panels are `ui/hud/{bar,actions,tile,city,research,dialog}.tsx`, with the testIDs `hud-bar`, `hud-actions`, `hud-tile`, `hud-city`,
`hud-research` and `hud-dialog`. The bar, the actions and the tile card are positioned boxes in the tree, so the map around them is the
World's. The city screen with the research list, and the event dialog, are blocking Modals (`ui/hud/overlay.tsx`): the host opens a Modal
as a window of its own, exclusive while it is on top, so while one is open nothing under it, the map included, hears the pointer. Escape
closes the city screen (the game's `clear_selection`, as its Close button does) and does nothing on the dialog, because the event has to be
answered. The game holds a queue of three events, raised together on turn 5: the dialog shows the head, "1 of 3", and each answer brings the
next, each in a subtree of its own. The bar shows the turn, the phase,
the three resources, End turn (enabled by the game's `end_turn` action, with a spinner while the phase is not `idle`) and the way to
the menu; the actions panel lists the snapshot's actions but End turn, each with the game's `reason_text` when disabled; the tile card
shows the tile under the pointer while it is over the map and the selected tile otherwise.

`ui/store.ts` is the only module that talks to the game: one store at module scope, read through `useSyncExternalStore`
(`useFrontier()`), that holds the connections to `frontier.snapshot` and `frontier.hover` while a screen reads it and releases them when
the last one stops, and the typed `send` and `sendAction` over `callFrontier`. No panel subscribes, calls a service or holds an effect or
a listener of its own. The two screens are `game` and `menu`: the menu calls `frontier.open_menu`, which drops the World, and New game
calls `frontier.new_game`, which brings it back. End turn is accepted at once and the turn goes on in `GameServices`, which advances one
phase per frame; closing the screen or going to the menu does not stop it. `ui/frontier-types.ts` is the hand-written TypeScript
mirror of the registered schemas, which `tests/frontier-services-parity.test.mjs` compares with them in both directions.

## The second scene: the native HUD

`main_native.tscn` is the same game with a HUD written in GDScript, the second arm of the 0.5 milestone's final comparison
([docs/research/frontier-arm-b.md](../../docs/research/frontier-arm-b.md)). It mirrors `main.tscn` without the `Application` and without the
`FabricSurface`: the `GameServices` root, the `World` ahead of `HUDLayer`, `HUDLayer/HUD` (`native_hud/hud.tscn`) and the validations. With no
`Application` the node registers no service and the HUD plays on the node's signals and methods (`snapshot_changed`, `hover_changed`, `select_unit`,
`end_turn` and the rest), which are the game's, shared by both scenes.

The HUD has the same six panels, seven contexts and testIDs as the React Native one, and the same table:
`native_hud/hud.gd` mounts the panels of the context and unmounts the others, each panel is a scene with a script of its own
(`bar`, `actions`, `tile`, `city`, `research`, `dialog`), and a Control is named by its testID. The city screen with the research list and the
event dialog are overlays (`overlay.gd`): a full-screen Control that stops the pointer, above the map. The icons are the same PNGs, in
`TextureRect`s and `Button.icon`.

```sh
godot --path . --headless res://main_native.tscn -- --validate-hud        # the same matrix, phase and input stages, on the native HUD
godot --path . --headless res://main_native.tscn -- --validate-overlays   # the queue, the blocking overlays, Escape, a new game
```

**The stress mode.** For the comparison's `stress` window the node also owns a stress overlay (`services/stress.gd`) that is not the game's: `stress_begin`, `stress_step` and
`stress_end` enter it, change it and leave it, and while it is on the snapshot carries a log of 200 lines and a production list of 100 items (`stress`, the one optional field of the
schema). Both HUDs show it in `hud-stress` in every context, outside the table of panels, and the execution runner reads `stats()` on either, in the same shape: on the native HUD
node, and on `HudStats` (`hud_stats.gd`) in `main.tscn`, which reads the registry's own counters and no JavaScript
([docs/research/frontier-stress.md](../../docs/research/frontier-stress.md)).

`main_bare.tscn` is the third scene, for the comparison's arm A: `GameServices` and the `World` and nothing else, so no `HUDLayer`, no
`Application` and no `FabricSurface`. The validations are not in it; the game plays on the node's methods and publishes its snapshots as in the other two.

The probes read the HUD through a reader (`hud_reader.gd`): `hud_reader_host.gd` takes the rows from the React Native host's snapshot,
`hud_reader_native.gd` from the Controls, and the scene says which one it is. `npm run test:civ-lite-ui` runs both scenes, and its sabotage script
has three for the native HUD. The stability probe is the React Native host's and does not run on this scene.

## Layout

- `game/`: the rules and the scenario in plain GDScript, with no extension, no node and no React. `game/game.gd` is the entry
  point; `game/replay.gd` is the 12-turn roteiro whose final state has the golden hash. The state, the snapshot fields, the seven
  contexts, the refusal codes and the determinism rules are in
  [docs/research/frontier-game.md](../../docs/research/frontier-game.md).
- `services/`: `game_services.gd` owns a session and its `epoch` and publishes the snapshot and the intents as typed services;
  `schema.gd` is the one GDScript source of every schema it registers. See
  [docs/research/frontier-services.md](../../docs/research/frontier-services.md).
- `world/`, `ui/`, `main.tscn`, `validation.gd`, `hud_probe.gd`, `hud_validation.gd`, `overlay_validation.gd`, `stability_validation.gd`,
  `stability_judge.gd`: the scene, the HUD and the validations described above (`hud_probe.gd` is what the three HUD probes share).
- `native_hud/`, `main_native.tscn`, `main_bare.tscn`, `hud_reader*.gd`: the native HUD, its scene, the scene with no HUD and the readers the probes look at either HUD through.
- `services/stress.gd`, `hud_stats.gd`: the stress mode's overlay and the runner's `stats()` for the React Native HUD.
- `ui/icons/`: the seven icons of the set (settler, warrior, city, food, production, science and irrigation), 32x32 PNGs drawn from shapes by
  `scripts/civ-lite-icons.mjs` (original art, no third-party image); irrigation is the Irrigate action's and the irrigated tile's. `ui/hud/icons.ts` imports each of the first six as an asset (`ui/assets.d.ts` declares
  `*.png`) and `Icon` in `ui/hud/kit.tsx` draws it with an `Image`: the resources of the bar, the unit actions, the units and the city of the
  tile card, and the city screen's title and production items, which are inside the Modal's window.

## Validation

`validation.gd` runs ten cycles (new game, three intents through the HUD, reload the scenery, End turn and the menu in the same
frame, new game from the menu)
and, after each, once the state it waited for has arrived, compares the nodes, the orphan nodes, the registry's bindings and
subscriptions, its pending work, the connections of `snapshot_changed`, the connections the HUD holds and the epoch with the
first cycle's. In a provisioned project:

```sh
godot --path . --headless --editor -- --godot-fabric-build-check     # builds ui/index.tsx with the addon's private toolchain
godot --path . --headless -- --validate                               # the ten cycles; writes civ-lite-report.json
godot --path . --headless -- --validate-hud                           # the panels of the seven contexts, the turn and the pointer; writes civ-lite-ui-report.json
godot --path . --headless -- --validate-overlays                      # the queue of three events, the remount and the blocking Modals; writes civ-lite-overlay-report.json
godot --path . --headless -- --validate-stability                     # twenty cycles of each overlay, what leaks, focus, the icons; writes civ-lite-stability-report.json
```

In the repository, `npm run test:consumer:civ-lite` provisions this template into a fresh directory and runs both, with no global
Node and no network, and `node scripts/consumer-civ-lite-sabotage.mjs` runs the retained sabotages. `npm run test:civ-lite-ui` does the
same for the HUD (`--validate-hud`, `--validate-overlays` and `--validate-stability`, each judged again by an independent oracle, a static scan of the
HUD against the 0.5 manifest, controls, and `node scripts/civ-lite-ui-sabotage.mjs` for its sabotages). The runs, the receipt and two
captures are in [docs/evidence/frontier-consumer/](../../docs/evidence/frontier-consumer/README.md); hosted CI is pending. The game and the services
also run in the laboratory's root project:

```sh
npm run test:civ-lite-game          # three processes, one golden hash, an independent oracle
node scripts/civ-lite-game-sabotage.mjs   # the retained sabotages
npm run test:frontier-services      # the roteiro played through the typed services, and the TS/Godot parity
node scripts/frontier-services-sabotage.mjs   # the services' retained sabotages
```
