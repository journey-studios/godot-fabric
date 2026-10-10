import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {guardSources} from "./sabotage-sources.mjs";

// The retained sabotages of the Frontier game: each breaks one GDScript source on purpose, runs
// tests/civ-lite-game-native.test.mjs against it with --sabotage=<name>, and the test and the independent oracle
// must both reject it. The source is restored byte for byte, whatever ends the run, a signal included
// (scripts/sabotage-sources.mjs); the receipt proves it by hash, and the restored game must pass the plain test.
//
//  prng   the PRNG's output comes from the engine's randi(): the map differs in every process, so the three
//         executions disagree, the generator no longer gives PCG32's published outputs, and the golden hash is lost.
//  canon  the serializer stops sorting object keys: the text is no longer canonical, so the hash is not the golden one
//         and the oracle finds the keys out of order.
//  rule   a forest costs one movement point instead of two, an error of one unit in the rule the roteiro leans on:
//         the Settler keeps a point it must not have, so a refusal the roteiro expects does not happen, the golden
//         hash is lost and the oracle finds a move that did not pay the terrain's cost.
//  economy the city centre yields one production too many. The roteiro's first turns still play, but the stock the city
//         adds is wrong from its first turn of production: the golden hash is lost and the oracle, which recomputes the
//         end of every turn from the serialization before it, finds the first one that does not add up.
//  ai-ignores-block  the faction's Warrior no longer waits for a unit of the player or the player's city on its next
//         tile. The roteiro never puts the player on the faction's route, so the roteiro's states and its golden hash
//         are unchanged: the states the probe builds for the wait (a city on the route that finishes a Warrior that
//         turn, and a unit of the player on the route) fail the probe's checks, and the oracle finds the faction on the
//         player's tile.
//  ai-city  the defect the review of PR #70 found: only a unit of the player blocks the faction, not the city. The
//         faction walks into the city and the Warrior the city finishes that turn is born on top of it.
//  ai-wrong-event  the faction waits as it should but says it moved: ai_moved in place of ai_blocked. The wait's game
//         fields other than the log are the genuine ones, and so are the replay's golden and trace hashes, because the
//         roteiro never reaches a wait; but the wait case's log is not, and the log is part of the serialized state. The
//         probe's check of the wait's event fails, and the oracle, which judges the log entries a turn appended against
//         the events the rules give the faction's phases, rejects it.
//
//  irrigation-diagonal  Water on a diagonal counts as Water beside the tile: a Settler with Water only on a corner irrigates. The roteiro
//         never irrigates, so its states and its golden hash are unchanged; the irrigation scenarios built for the four sides fail the probe's
//         checks, and the oracle finds an irrigation its rule refuses.
//  irrigation-keeps-moves  irrigating does not spend the Settler's moves: the Settler that irrigated can still found a city, move or irrigate.
//  irrigation-unsorted  the irrigated tiles stay in the order they were irrigated in, not ascending: the same set has two spellings, and so two hashes.
//  irrigation-no-yield  the tile does not yield the bonus: the card's food and the city's yields are the terrain's. The irrigated tile is
//         recorded in the state, so only the yields tell.
//
//  events-out-of-order  an answered event leaves the queue by its tail and not by its head: the first event is answered and is
//         still the head, so the second never comes up. The replay's refusals and contexts at the queue steps do not happen, the
//         golden hash is lost and the oracle finds the first answer that did not take the head out.
//
// There is no host here and nothing to rebuild: the game is plain GDScript. Run with:
//   node scripts/civ-lite-game-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const game = "consumers/civ-lite/game";
const variants = [
  {name: "prng", file: `${game}/prng.gd`, find: "  return ((shifted >> rotation) | (shifted << ((32 - rotation) & 31))) & MASK32\n",
    replace: "  return randi() & MASK32\n"},
  {name: "canon", file: `${game}/canon.gd`, find: "      keys.sort()\n", replace: ""},
  {name: "rule", file: `${game}/rules.gd`, find: "  {\"name\": \"Forest\", \"food\": 1, \"production\": 2, \"science\": 0, \"move\": 2},\n",
    replace: "  {\"name\": \"Forest\", \"food\": 1, \"production\": 2, \"science\": 0, \"move\": 1},\n"},
  {name: "economy", file: `${game}/rules.gd`, find: "const CENTER_PRODUCTION := 1\n", replace: "const CENTER_PRODUCTION := 2\n"},
  {name: "ai-ignores-block", file: `${game}/turn.gd`,
    find: "  return not World.units_at(state, x, y, Rules.OWNER_PLAYER).is_empty() or not World.city_at(state, x, y).is_empty()\n",
    replace: "  return false\n"},
  {name: "ai-city", file: `${game}/turn.gd`,
    find: "  return not World.units_at(state, x, y, Rules.OWNER_PLAYER).is_empty() or not World.city_at(state, x, y).is_empty()\n",
    replace: "  return not World.units_at(state, x, y, Rules.OWNER_PLAYER).is_empty()\n"},
  {name: "irrigation-diagonal", file: `${game}/world.gd`,
    find: "  for side: Vector2i in [Vector2i(0, -1), Vector2i(1, 0), Vector2i(0, 1), Vector2i(-1, 0)]:\n",
    replace: "  for side: Vector2i in [Vector2i(0, -1), Vector2i(1, 0), Vector2i(0, 1), Vector2i(-1, 0), Vector2i(-1, -1), Vector2i(1, -1), Vector2i(1, 1), Vector2i(-1, 1)]:\n"},
  {name: "irrigation-keeps-moves", file: `${game}/intents.gd`, find: "  state.irrigated.sort()\n  unit.moves = 0\n", replace: "  state.irrigated.sort()\n"},
  {name: "irrigation-unsorted", file: `${game}/intents.gd`, find: "  state.irrigated.sort()\n", replace: ""},
  {name: "irrigation-no-yield", file: `${game}/economy.gd`,
    find: "  var food: int = terrain.food + (Rules.IRRIGATION_FOOD if World.is_irrigated(state, x, y) else 0)\n", replace: "  var food: int = terrain.food\n"},
  {name: "events-out-of-order", file: `${game}/intents.gd`, find: "  state.events.queue.remove_at(0)\n", replace: "  state.events.queue.pop_back()\n"},
  {name: "ai-wrong-event", file: `${game}/turn.gd`, find: "    World.emit(state, \"ai_blocked\", ai.tx, ai.ty)\n",
    replace: "    World.emit(state, \"ai_moved\", ai.tx, ai.ty)\n"},
];
const digest = content => createHash("sha256").update(content).digest("hex");
const files = [...new Set(variants.map(variant => variant.file))];
const sources = guardSources(root, files);

await mkdir(path.join(root, "build"), {recursive: true});
// Every replacement must find exactly one place before anything is edited.
for (const variant of variants) {
  sources.sabotaged(variant);
}

const receipt = {format: "godot-fabric.civ-lite-game-sabotage/v1", sourceSha256: {genuine: sources.genuine}, variants: []};
try {
  for (const variant of variants) {
    try {
      const broken = sources.sabotaged(variant);
      const entry = {name: variant.name, file: variant.file, find: variant.find, replace: variant.replace, sourceSha256: digest(broken)};
      sources.swap(variant.file, broken);
      const run = await sources.run(process.execPath, ["tests/civ-lite-game-native.test.mjs", `--sabotage=${variant.name}`]);
      await writeFile(path.join(root, `build/civ-lite-game-sabotage-${variant.name}.log`), run.stdout + run.stderr);
      entry.runStatus = run.status;
      entry.rejections = JSON.parse(await readFile(path.join(root, `build/civ-lite-game-sabotage-${variant.name}.json`), "utf8")).rejections;
      receipt.variants.push(entry);
    } finally {
      sources.restore();
    }
  }
} finally {
  receipt.sourceSha256.restored = sources.restore();
}
assert.deepEqual(receipt.sourceSha256.restored, receipt.sourceSha256.genuine, "Every source is restored byte for byte");
// The restored game passes the plain test: the sabotages are the only difference.
const control = await sources.run(process.execPath, ["tests/civ-lite-game-native.test.mjs"]);
await writeFile(path.join(root, "build/civ-lite-game-sabotage-control.log"), control.stdout + control.stderr);
receipt.controlStatus = control.status;
await writeFile(path.join(root, "build/civ-lite-game-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
for (const entry of receipt.variants) {
  assert.equal(entry.runStatus, 0, `The test and the oracle must reject the ${entry.name} game: build/civ-lite-game-sabotage-${entry.name}.log`);
}
assert.equal(receipt.controlStatus, 0, "The restored game must pass the plain test: build/civ-lite-game-sabotage-control.log");
console.log(JSON.stringify(receipt, null, 2));
