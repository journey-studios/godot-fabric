import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {guardSources} from "./sabotage-sources.mjs";

// The retained sabotages of the Frontier consumer: each breaks one source of the template on purpose, runs
// scripts/consumer-civ-lite-check.mjs against it with --sabotage=<name> (which provisions the broken template, builds it and
// runs its validation), and the validation must reject it, for the reason it was broken. The source is restored byte for byte
// whatever ends the run, a signal included (scripts/sabotage-sources.mjs); the receipt proves it by hash, and the restored
// template must then pass the plain check. There is no sabotage for a World that forgets to disconnect `snapshot_changed`: the
// engine drops the connection of a freed Node by itself, so that leak cannot happen (docs/research/frontier-consumer.md).
//
//  hud-leak    the HUD's effect no longer removes its connection to the snapshot when its screen goes away: the registry's
//               subscriptions and the HUD's grow with every visit to the menu.
//  orphan       dropping the World takes it out of the tree and does not free it: the orphan nodes grow, and the Worlds the cycle
//               dropped are still alive.
//  epoch-reset  reloading the scenery zeroes the epoch before the new game: the epoch is no longer monotonic.
//  no-facade    the scene no longer injects the facade: the node registers nothing and says so (FABRIC_ERROR), and the HUD has
//               nothing to connect to.
//
// A variant whose run leaves no observed.json (a crash, a failed assertion that came first) is recorded as nothing observed and is
// not rejected. Run with:
//   node scripts/consumer-civ-lite-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const template = "consumers/civ-lite";
const variants = [
  {name: "hud-leak", file: `${template}/ui/index.tsx`,
    find: "    return () => release(connection);\n",
    replace: "    return () => {};\n"},
  {name: "orphan", file: `${template}/services/game_services.gd`,
    find: "  remove_child(world)\n  world.queue_free()\n",
    replace: "  remove_child(world)\n"},
  {name: "epoch-reset", file: `${template}/services/game_services.gd`,
    find: "func reload_world() -> Dictionary:\n  _drop_world()\n  return new_game()\n",
    replace: "func reload_world() -> Dictionary:\n  _drop_world()\n  epoch = 0\n  return new_game()\n"},
  {name: "no-facade", file: `${template}/main.tscn`,
    find: "fabric_api=ExtResource(\"2\")\n",
    replace: ""},
];
const digest = content => createHash("sha256").update(content).digest("hex");
const files = [...new Set(variants.map(variant => variant.file))];
const sources = guardSources(root, files);

await mkdir(path.join(root, "build"), {recursive: true});
// Every replacement must find exactly one place before anything is edited.
for (const variant of variants) {
  sources.sabotaged(variant);
}

const receipt = {format: "godot-fabric.consumer-civ-lite-sabotage/v1", sourceSha256: {genuine: sources.genuine}, variants: []};
try {
  for (const variant of variants) {
    try {
      const broken = sources.sabotaged(variant);
      const entry = {name: variant.name, file: variant.file, find: variant.find, replace: variant.replace, sourceSha256: digest(broken)};
      // What the run observed is written by the run itself. A file left by an earlier run must never stand for this one.
      const observedFile = path.join(root, `build/consumer-civ-lite-sabotage-${variant.name}/observed.json`);
      await rm(observedFile, {force: true});
      sources.swap(variant.file, broken);
      const run = await sources.run(process.execPath, ["scripts/consumer-civ-lite-check.mjs", `--sabotage=${variant.name}`]);
      await writeFile(path.join(root, `build/consumer-civ-lite-sabotage-${variant.name}.log`), run.stdout + run.stderr);
      entry.runStatus = run.status;
      let observed = null;
      try {
        observed = JSON.parse(await readFile(observedFile, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
      entry.observed = observed !== null;
      entry.failedChecks = observed === null ? null : observed.failedChecks.length;
      entry.firstFailedCheck = observed === null ? null : (observed.failedChecks[0] ?? null);
      entry.finalSeries = observed === null ? null : (observed.series.at(-1) ?? null);
      entry.logLines = observed === null ? null : observed.logLines;
      entry.rejected = entry.runStatus === 0 && entry.observed;
      receipt.variants.push(entry);
    } finally {
      sources.restore();
    }
  }
} finally {
  receipt.sourceSha256.restored = sources.restore();
}
assert.deepEqual(receipt.sourceSha256.restored, receipt.sourceSha256.genuine, "Every source is restored byte for byte");
// The restored template passes the plain check: the sabotages are the only difference.
const control = await sources.run(process.execPath, ["scripts/consumer-civ-lite-check.mjs"]);
await writeFile(path.join(root, "build/consumer-civ-lite-sabotage-control.log"), control.stdout + control.stderr);
receipt.controlStatus = control.status;
await writeFile(path.join(root, "build/consumer-civ-lite-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
for (const entry of receipt.variants) {
  assert.ok(entry.rejected, `The validation must reject the ${entry.name} project, and its run must leave what it observed `
    + `(status ${entry.runStatus}, observed ${entry.observed}): build/consumer-civ-lite-sabotage-${entry.name}.log`);
}
assert.equal(receipt.controlStatus, 0, "The restored template must pass the plain check: build/consumer-civ-lite-sabotage-control.log");
console.log(JSON.stringify(receipt, null, 2));
