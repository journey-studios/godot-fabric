import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";

// The comparison's stress mode through the node and the registry (docs/research/frontier-stress.md), run for real by tests/frontier-stress-probe.gd: the
// three intents and their codes, what the snapshot carries and when, the registry accepting the snapshot's one optional field and refusing what the
// declaration does not allow, and the counters. This test reads the probe's raw report again, from the rules of the mode and not from its verdicts.
// --sabotage runs the probe where a failed check is the rejection (the preceding host, which has no optional field, is run so by hand: see the evidence).
const root = fileURLToPath(new URL("..", import.meta.url));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const sabotage = process.argv.includes("--sabotage");
const REFUSAL = /^ERROR: FABRIC_ERROR: E_SERVICE_SCHEMA: Schema must be a JSON scalar type, \{array:schema\}, or \{object:\{field:schema\}\}$/;

test("the stress mode: three intents outside the game's state, a snapshot that carries it only while it is on, and a registry that allows its one optional field", async () => {
  const binary = await ensureGodotBinary();
  await rm(path.join(root, "build/frontier-stress-report.json"), {force: true});
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/frontier-stress-probe.gd", "--", ...(sabotage ? ["--sabotage"] : [])],
    {encoding: "utf8", timeout: 180000, maxBuffer: 16 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/frontier-stress${sabotage ? "-sabotage" : ""}.log`), log);
  assert.equal(result.error, undefined, log);
  const report = JSON.parse(await readFile(path.join(root, "build/frontier-stress-report.json"), "utf8"));
  const failed = report.checks.filter(check => !check.passed).map(check => check.name);
  if (sabotage) {
    assert.ok(failed.length > 0, "the probe rejects what was broken");
    return;
  }
  assert.equal(result.status, 0, log);
  assert.match(log, /FRONTIER_STRESS_PASSED/);
  assert.deepEqual(failed, [], "every check of the probe passed");
  // The only errors in the log are the three the probe provokes on purpose: a schema whose optional is not an object's field.
  const errors = log.split("\n").filter(line => line.startsWith("ERROR:"));
  assert.equal(errors.length, 3, `the probe provokes three refusals of a schema and nothing else logs an error: ${errors.join(" | ")}`);
  assert.ok(errors.every(line => REFUSAL.test(line)));
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed/);

  // The raw observations, judged again from the rules of the mode.
  assert.equal(report.bindings, 19);
  assert.deepEqual([report.off.step.code, report.off.end.code, report.off.published], ["stress_off", "stress_off", 0]);
  assert.deepEqual([report.during.refused.ok, report.during.refused.code, report.during.carried], [0, "turn_in_progress", false]);
  assert.deepEqual([report.begun.result.code, report.begun.log, report.begun.production, report.begun.published, report.begun.frozen], ["ok", 200, 100, 1, true]);
  assert.ok(report.begun.first.startsWith("00001 "));
  assert.deepEqual([report.again.ok, report.again.code], [0, "stress_on"]);
  assert.equal(report.steps.results.length, 20);
  assert.ok(report.steps.results.every(row => row.ok === 1 && row.code === "ok"));
  assert.deepEqual([report.steps.published, report.steps.lines], [21, 200]);
  assert.ok(report.steps.first.startsWith("00021 ") && report.steps.last.startsWith("00220 "));
  assert.deepEqual(report.steps.progress, [...Array(20).fill(1), ...Array(80).fill(0)]);
  assert.equal(report.state.during, report.state.before, "the game's state hash did not move while the mode was on");
  assert.ok(report.state.log[1] <= 32, "the game's log stayed within its 32 lines");
  assert.deepEqual([report.ended.result.code, report.ended.identical, report.ended.carries, report.ended.published], ["ok", true, false, 22]);
  assert.equal(report.ended.length[0], report.ended.length[1]);
  assert.equal(report.counters.emitted, 22);
  assert.equal(report.counters.revisionsAfter.emitted - report.counters.revisionsBefore.emitted, 22, "the registry numbered as many revisions as the node published");
  assert.equal(report.counters.revisionsAfter.sent, 0, "nothing is handed to JavaScript with no subscriber");
  assert.deepEqual(report.counters.errors, []);
  assert.deepEqual(report.newGame, {carries: false, step: report.newGame.step});
  assert.equal(report.newGame.step.code, "stress_off");
  assert.deepEqual(report.validator.rejected, {wrongType: true, unknownField: true, missingRequired: true});
  assert.deepEqual(report.validator.refusals, {root: true, element: true, argument: true});
  assert.equal(report.validator.errorsAfterValid, 0);
  assert.deepEqual(report.validator.origins, {bothBound: true, afterOther: 0, afterMine: 1, bound: true}, "the counters of a name are the default origin's, whatever other origin has the name");
  const sources = Object.fromEntries(await Promise.all(["tests/frontier-stress-probe.gd", "consumers/civ-lite/services/game_services.gd", "consumers/civ-lite/services/stress.gd",
    "consumers/civ-lite/services/schema.gd", "native/game_service_registry.cpp", "native/fabric_application.cpp"].map(async file => [file, digest(await readFile(path.join(root, file)))])));
  await writeFile(path.join(root, "build/frontier-stress-summary.json"), JSON.stringify({checks: report.checks.length, nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), sources}, null, 2) + "\n");
  console.log(`FRONTIER_STRESS_LANE_PASSED: ${report.checks.length} checks`);
});
