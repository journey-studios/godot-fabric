# civ-lite: Frontier, the 0.5 reference game

Frontier is a small turn-based strategy game in the interaction style of Civilization 2, used as a fixture for the 0.5
milestone (a real app on this platform), not as a product. Godot owns the map, the rules, the scripted faction and the
turn; the HUD will be React Native over Godot and will only project a snapshot and send intents.

`game/` holds the rules and the scenario in plain GDScript, with no extension, no node and no React. It is not a Godot
project of its own yet: the root project loads it as `res://consumers/civ-lite/game/`, and the scripts use relative
`preload` paths so they keep working when the folder becomes one.

- `game/game.gd` is the entry point: the intents, the turn in slices, the snapshot and the state hash.
- `game/replay.gd` is the 12-turn roteiro whose final state has the golden hash.
- The state, the snapshot fields, the seven contexts, the refusal codes and the determinism rules are in
  [docs/research/frontier-game.md](../../docs/research/frontier-game.md).

`services/` is the persistent `GameServices` node (`game_services.gd`) that owns a session of the game and its `epoch` and
publishes the snapshot and the intents as typed services; `schema.gd` is the one GDScript source of every schema it registers.
`ui/frontier-types.ts` is the hand-written TypeScript mirror, which a parity test compares with the registered schemas in both
directions. See [docs/research/frontier-services.md](../../docs/research/frontier-services.md).

```sh
npm run test:civ-lite-game          # three processes, one golden hash, an independent oracle
node scripts/civ-lite-game-sabotage.mjs   # the retained sabotages
npm run test:frontier-services      # the roteiro played through the typed services, and the TS/Godot parity
node scripts/frontier-services-sabotage.mjs   # the services' retained sabotages
```
