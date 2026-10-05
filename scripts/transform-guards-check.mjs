import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureGodotBinary } from "./godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const directory = path.join(root, "build");
const output = path.join(directory, "transforms-guards.json");
const modes = ["singular", "rank-one", "3d", "range-large", "range-small", "range-pivot"];
const codes = ["E_TRANSFORM_SINGULAR", "E_TRANSFORM_SINGULAR", "E_TRANSFORM_3D", "E_TRANSFORM_RANGE", "E_TRANSFORM_RANGE", "E_TRANSFORM_RANGE"];
if (process.argv.slice(2).length) throw new Error("Run transform-guards-check.mjs without arguments");
if (!existsSync(path.join(directory, "app.js"))) throw new Error("Build the real RN examples bundle before running transform guards");
mkdirSync(directory, { recursive: true });
rmSync(output, { force: true });
const result = spawnSync(await ensureGodotBinary(), [
  "--path", root, "--headless", "--script", "res://examples/transforms/guards.gd",
], { encoding: "utf8", timeout: 45000, maxBuffer: 8 * 1024 * 1024 });
const log = (result.stdout ?? "") + (result.stderr ?? "");
writeFileSync(path.join(directory, "transforms-guards.log"), log);
assert.equal(result.error, undefined, log);
assert.equal(result.signal, null, log);
assert.equal(result.status, 0, log);
assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|FABRIC_CHECK_FAILED|ObjectDB instances leaked|Resources still in use/);
assert.match(log, /TRANSFORM_GUARDS_PASSED: /);
const report = JSON.parse(readFileSync(output, "utf8"));
assert.equal(report.scenario, "transforms-guards");
assert.equal(report.status, "passed");
assert.equal(report.failed, false);
assert.equal(report.displayServer, "headless");
assert.equal(report.engine, "hermes");
assert.equal(report.renderer, "fabric");
assert.deepEqual(report.modes, modes);
assert.deepEqual(report.cases.map(entry => entry.mode), modes);
assert.deepEqual(report.cases.map(entry => entry.expectedCode), codes);
assert.ok(report.checks.length > 0 && report.checks.every(check => check.passed), JSON.stringify(report.checks));
assert.equal(new Set(report.cases.map(entry => entry.afterRejection.runtimeId)).size, modes.length);
assert.equal(new Set(report.cases.map(entry => entry.applicationInstanceId)).size, modes.length);
assert.equal(new Set(report.cases.map(entry => entry.surfaceInstanceId)).size, modes.length);
for (const [index, entry] of report.cases.entries()) {
  assert.ok(entry.expectedError.startsWith(codes[index] + ": "), JSON.stringify(entry));
  assert.equal(entry.expectedHostErrorLine, `Exception in HostFunction: ${entry.expectedError}`);
  assert.equal(entry.afterRejection.errors.length, 1);
  assert.equal(entry.afterRejection.errors[0].split("\n")[0], entry.expectedHostErrorLine);
  assert.match(entry.afterRejection.errors[0], /\n\nError: Exception in HostFunction: /);
  assert.match(entry.afterRejection.errors[0], /\n\s+at completeRoot \(native\)/);
  assert.deepEqual(entry.afterStop.errors, entry.afterRejection.errors);
  assert.equal(entry.afterRejection.bundleEvaluations, 1);
  assert.ok(entry.beforeStop.pendingTimers > 0 && entry.beforeStop.pendingAnimationFrames > 0);
  assert.equal(entry.afterStop.stopped, true);
  for (const name of ["rootCount", "pendingRootRetirements", "pendingTimers", "pendingAnimationFrames", "pendingWork"])
    assert.equal(entry.afterStop[name], 0, `${entry.mode}: ${name}`);
  assert.equal(entry.afterStop.hostPhasePending, false);
  assert.equal(entry.nativeAfterStop.nativeTags, 0);
  assert.deepEqual(entry.nativeAfterStop.nodes, []);
  assert.equal(entry.nativeAfterStop.creates, entry.nativeAfterStop.deletes);
}
// Every visible Godot error must correspond exactly to the structured native
// diagnostic of one mode. Missing, repeated or unrelated errors fail the run.
const visibleErrors = [...log.matchAll(/^ERROR: (.+)$/gm)].map(match => match[1]);
assert.deepEqual(visibleErrors.sort(), report.cases.map(entry => `FABRIC_ERROR: ${entry.expectedHostErrorLine}`).sort(), log);
console.log(`TRANSFORM_GUARDS_VERIFIED: ${report.cases.length} fresh applications; ${report.checks.length} executed checks`);

const inputOutput = path.join(directory, "transforms-input-guards.json");
rmSync(inputOutput, {force: true});
const inputRun = spawnSync(await ensureGodotBinary(), [
  "--path", root, "--headless", "res://examples/transforms/input-guards.tscn",
], {encoding: "utf8", timeout: 45000, maxBuffer: 8 * 1024 * 1024});
const inputLog = (inputRun.stdout ?? "") + (inputRun.stderr ?? "");
writeFileSync(path.join(directory, "transforms-input-guards.log"), inputLog);
assert.equal(inputRun.error, undefined, inputLog);
assert.equal(inputRun.signal, null, inputLog);
assert.equal(inputRun.status, 0, inputLog);
assert.doesNotMatch(inputLog, /SCRIPT ERROR|(?:^|\n)ERROR:|Program crashed|FABRIC_ERROR|ObjectDB instances leaked|Resources still in use/);
assert.match(inputLog, /TRANSFORM_INPUT_GUARDS_PASSED: /);
const inputReport = JSON.parse(readFileSync(inputOutput, "utf8"));
assert.equal(inputReport.scenario, "transforms-input-guards");
assert.equal(inputReport.status, "passed");
assert.equal(inputReport.failed, false);
assert.equal(inputReport.displayServer, "headless");
assert.equal(inputReport.validationInputDevice, 1001);
assert.equal(inputReport.inputTransport, "Input.parse_input_event");
assert.ok(inputReport.checks.length > 0 && inputReport.checks.every(check => check.passed));
assert.deepEqual(Object.keys(inputReport.stages).sort(), [
  "ignored-start", "initial", "overflow-active-contact", "restored-control", "singular-surface-active-contact",
]);
assert.deepEqual(inputReport.applicationStopped.errors, []);
assert.equal(inputReport.applicationStopped.stopped, true);
for (const name of ["rootCount", "pendingRootRetirements", "pendingTimers", "pendingAnimationFrames", "pendingWork"])
  assert.equal(inputReport.applicationStopped[name], 0, name);
assert.equal(inputReport.surfaceStopped.nativeTags, 0);
assert.equal(inputReport.surfaceStopped.creates, inputReport.surfaceStopped.deletes);
assert.equal(inputReport.surfaceStopped.pointer.activeTouches, 0);
assert.equal(inputReport.surfaceStopped.pointer.responder, 0);
console.log(`TRANSFORM_INPUT_GUARDS_VERIFIED: ${inputReport.checks.length} executed checks`);
