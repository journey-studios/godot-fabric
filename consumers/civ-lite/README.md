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
- `Validation` and `HudValidation`: the project's own validations, inert unless the game runs with `-- --validate` or
  `-- --validate-hud`.

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
`hud-research` and `hud-dialog`. They are positioned boxes, so the map around them is the World's. The bar shows the turn, the phase,
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

## Layout

- `game/`: the rules and the scenario in plain GDScript, with no extension, no node and no React. `game/game.gd` is the entry
  point; `game/replay.gd` is the 12-turn roteiro whose final state has the golden hash. The state, the snapshot fields, the seven
  contexts, the refusal codes and the determinism rules are in
  [docs/research/frontier-game.md](../../docs/research/frontier-game.md).
- `services/`: `game_services.gd` owns a session and its `epoch` and publishes the snapshot and the intents as typed services;
  `schema.gd` is the one GDScript source of every schema it registers. See
  [docs/research/frontier-services.md](../../docs/research/frontier-services.md).
- `world/`, `ui/`, `main.tscn`, `validation.gd`, `hud_validation.gd`: the scene, the HUD and the validations described above.

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
```

In the repository, `npm run test:consumer:civ-lite` provisions this template into a fresh directory and runs both, with no global
Node and no network, and `node scripts/consumer-civ-lite-sabotage.mjs` runs the retained sabotages. `npm run test:civ-lite-ui` does the
same for the HUD (`--validate-hud`, judged again by an independent oracle, with a control and
`node scripts/civ-lite-ui-sabotage.mjs` for its sabotages). The runs, the receipt and two
captures are in [docs/evidence/frontier-consumer/](../../docs/evidence/frontier-consumer/README.md); hosted CI is pending. The game and the services
also run in the laboratory's root project:

```sh
npm run test:civ-lite-game          # three processes, one golden hash, an independent oracle
node scripts/civ-lite-game-sabotage.mjs   # the retained sabotages
npm run test:frontier-services      # the roteiro played through the typed services, and the TS/Godot parity
node scripts/frontier-services-sabotage.mjs   # the services' retained sabotages
```
