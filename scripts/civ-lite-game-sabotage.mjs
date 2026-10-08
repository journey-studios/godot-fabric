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
