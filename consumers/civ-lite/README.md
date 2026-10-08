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
  publishes a snapshot. It decides no rule.
- `HUDLayer/HUD`: a full-screen `FabricSurface` rendering `ui/index.tsx`.
- `Validation`: the project's own validation, inert unless the game runs with `-- --validate`.

The application, the registry, the bindings and the epoch belong to the root, so going to the menu, starting a game or
reloading the scenery never recreates them: the epoch only rises.

`GameServices` names no path to the SDK. The scene injects the facade, `fabric_api = res://addons/godot_fabric/godot_fabric.gd`,
and, optionally, the scene of the map as `world_scene`. Without a facade it fails loud (`FABRIC_ERROR`) and registers nothing.

## The HUD

`ui/index.tsx` is public TSX: it imports `react`, `react-native`, `@godot-fabric/runtime` and `./frontier-types`, and nothing
else. It connects to `frontier.snapshot` in an effect that removes the connection when its screen goes away, shows the turn, the
context and the actions with their `reason_text`, and sends an action back as `frontier.<id>(args)`. Its two screens are `game`
and `menu`: the menu calls `frontier.open_menu`, which drops the World, and New game calls `frontier.new_game`, which brings it
back. `ui/frontier-types.ts` is the hand-written TypeScript mirror of the registered schemas, which
`tests/frontier-services-parity.test.mjs` compares with them in both directions.

## Layout

- `game/`: the rules and the scenario in plain GDScript, with no extension, no node and no React. `game/game.gd` is the entry
  point; `game/replay.gd` is the 12-turn roteiro whose final state has the golden hash. The state, the snapshot fields, the seven
  contexts, the refusal codes and the determinism rules are in
  [docs/research/frontier-game.md](../../docs/research/frontier-game.md).
- `services/`: `game_services.gd` owns a session and its `epoch` and publishes the snapshot and the intents as typed services;
  `schema.gd` is the one GDScript source of every schema it registers. See
  [docs/research/frontier-services.md](../../docs/research/frontier-services.md).
- `world/`, `ui/`, `main.tscn`, `validation.gd`: the scene, the HUD and the validation described above.

## Validation

`validation.gd` runs ten cycles (new game, three intents through the HUD, reload the scenery, the menu, new game from the menu)
and, after each, once the state it waited for has arrived, compares the nodes, the orphan nodes, the registry's bindings and
subscriptions, its pending work, the connections of `snapshot_changed`, the connections the HUD holds and the epoch with the
first cycle's. In a provisioned project:

```sh
godot --path . --headless --editor -- --godot-fabric-build-check     # builds ui/index.tsx with the addon's private toolchain
godot --path . --headless -- --validate                               # the ten cycles; writes civ-lite-report.json
```

In the repository, `npm run test:consumer:civ-lite` provisions this template into a fresh directory and runs both, with no global
Node and no network, and `node scripts/consumer-civ-lite-sabotage.mjs` runs the retained sabotages. The runs, the receipt and two
captures are in [docs/evidence/frontier-consumer/](../../docs/evidence/frontier-consumer/README.md); hosted CI is pending. The game and the services
also run in the laboratory's root project:

```sh
npm run test:civ-lite-game          # three processes, one golden hash, an independent oracle
node scripts/civ-lite-game-sabotage.mjs   # the retained sabotages
npm run test:frontier-services      # the roteiro played through the typed services, and the TS/Godot parity
node scripts/frontier-services-sabotage.mjs   # the services' retained sabotages
```
