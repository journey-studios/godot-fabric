import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {guardSources} from "./sabotage-sources.mjs";

// The retained sabotages of Frontier's services: each breaks one GDScript source of the services on purpose, runs
// tests/frontier-services-native.test.mjs against it with --sabotage=<name>, and the probe's checks, the independent
// oracle and the parity must reject it, for the reason it was broken. The source is restored byte for byte, whatever ends
// the run, a signal included (scripts/sabotage-sources.mjs); the receipt proves it by hash, and the restored node must pass
// the plain test.
//
//  schema-drift     schema.gd loses a field of the DTO (an action's reason_text). The snapshot the getter returns no longer
//                   matches its schema, so the registry refuses the bundle's first connection, and the schema Godot
//                   registered is one field short of the TypeScript types: the parity names the field.
//  late-register    the services are registered in _ready, after the surface's _ready ran and the bundle evaluated, instead
//                   of from runtime_available in _enter_tree. The bundle's first connection is told E_SERVICE_MISSING.
//  silent-intent    found_city is accepted and publishes no snapshot. JavaScript keeps the snapshot from before the city,
//                   which is no longer the node's.
//  frozen-epoch     new_game starts a new session without raising the epoch: a HUD could not tell the games apart.
//  emit-on-refusal  a refused intent publishes a snapshot, as if the state had changed.
//  action-args-drift the snapshot's found_city action carries no argument, though the method takes the unit: the action is
//                   no longer a call. The probe's send-back of every action and the oracle's check of its args against the
//                   method's schema reject it (the sabotaged source is the game's snapshot, shared with the P3 game).
//  turn-ended-order turn_ended is emitted after the snapshot of the turn that begins instead of before it.
//
// There is no host here and nothing to rebuild: the services are plain GDScript. Run with:
//   node scripts/frontier-services-sabotage.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const services = "consumers/civ-lite/services";
const variants = [
  {name: "schema-drift", file: `${services}/schema.gd`,
    find: "\"args\": ACTION_ARGS, \"enabled\": INT, \"reason\": STR, \"reason_text\": STR}}\n",
    replace: "\"args\": ACTION_ARGS, \"enabled\": INT, \"reason\": STR}}\n"},
  {name: "late-register", file: `${services}/game_services.gd`,
    find: "func _enter_tree() -> void:\n  $Application.runtime_available.connect(_bind_services)\n",
    replace: "var _late_runtime: Node\n\n\nfunc _enter_tree() -> void:\n  $Application.runtime_available.connect(func(runtime: Node) -> void: _late_runtime = runtime)\n\n\nfunc _ready() -> void:\n  _bind_services(_late_runtime)\n"},
  {name: "silent-intent", file: `${services}/game_services.gd`,
    find: "  return _intent(\"found_city\", game.found_city(unit_id))\n",
    replace: "  _count(\"found_city\")\n  return _plain(game.found_city(unit_id))\n"},
  {name: "frozen-epoch", file: `${services}/game_services.gd`,
    find: "  epoch += 1\n  game = Game.new(Rules.SEED, epoch)\n",
    replace: "  game = Game.new(Rules.SEED, epoch)\n"},
  {name: "emit-on-refusal", file: `${services}/game_services.gd`,
    find: "  if result.ok == 1:\n    snapshot_changed.emit(game.snapshot())\n  return _plain(result)\n",
    replace: "  snapshot_changed.emit(game.snapshot())\n  return _plain(result)\n"},
  {name: "action-args-drift", file: "consumers/civ-lite/game/snapshot.gd",
    find: "    actions.append(action(\"found_city\", \"Found city\", [unit_id], Intents.check_found_city(state, unit_id)))\n",
    replace: "    actions.append(action(\"found_city\", \"Found city\", [], Intents.check_found_city(state, unit_id)))\n"},
  {name: "turn-ended-order", file: `${services}/game_services.gd`,
    find: "    turn_ended.emit({\"turn\": result.turn, \"phases\": result.phases})\n    snapshot_changed.emit(game.snapshot())\n",
    replace: "    snapshot_changed.emit(game.snapshot())\n    turn_ended.emit({\"turn\": result.turn, \"phases\": result.phases})\n"},
];
const digest = content => createHash("sha256").update(content).digest("hex");
const files = [...new Set(variants.map(variant => variant.file))];
const sources = guardSources(root, files);

await mkdir(path.join(root, "build"), {recursive: true});
// Every replacement must find exactly one place before anything is edited.
for (const variant of variants) {
  sources.sabotaged(variant);
}

const receipt = {format: "godot-fabric.frontier-services-sabotage/v1", sourceSha256: {genuine: sources.genuine}, variants: []};
try {
  for (const variant of variants) {
    try {
      const broken = sources.sabotaged(variant);
      const entry = {name: variant.name, file: variant.file, find: variant.find, replace: variant.replace, sourceSha256: digest(broken)};
      // What the run observed is written by the run itself. A file left by an earlier run must never stand for this one.
      const observedFile = path.join(root, `build/frontier-services-sabotage-${variant.name}.json`);
      await rm(observedFile, {force: true});
      sources.swap(variant.file, broken);
      const run = await sources.run(process.execPath, ["tests/frontier-services-native.test.mjs", `--sabotage=${variant.name}`]);
      await writeFile(path.join(root, `build/frontier-services-sabotage-${variant.name}.log`), run.stdout + run.stderr);
      entry.runStatus = run.status;
      // A run that ended before it wrote what it observed (a crash, a failed assertion that came first) leaves no file:
      // that is recorded as nothing observed, and the variant is not rejected.
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
      entry.oracle = observed === null ? null : observed.oracle;
      entry.parity = observed === null ? null : observed.parity;
      entry.registrationErrors = observed === null ? null : observed.registrationErrors;
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
// The restored node passes the plain test: the sabotages are the only difference.
const control = await sources.run(process.execPath, ["tests/frontier-services-native.test.mjs"]);
await writeFile(path.join(root, "build/frontier-services-sabotage-control.log"), control.stdout + control.stderr);
receipt.controlStatus = control.status;
await writeFile(path.join(root, "build/frontier-services-sabotage.json"), JSON.stringify(receipt, null, 2) + "\n");
for (const entry of receipt.variants) {
  assert.ok(entry.rejected, `The probe, the oracle and the parity must reject the ${entry.name} node, and its run must leave what it observed `
    + `(status ${entry.runStatus}, observed ${entry.observed}): build/frontier-services-sabotage-${entry.name}.log`);
}
assert.equal(receipt.controlStatus, 0, "The restored node must pass the plain test: build/frontier-services-sabotage-control.log");
console.log(JSON.stringify(receipt, null, 2));
