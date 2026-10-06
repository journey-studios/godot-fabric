import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeNativePng } from "../tests/native-png.mjs";
import { ensureGodotBinary } from "./godot-binary.mjs";
import { COLORS, MODES as SCALE_MODES, oracleRejection, verifyUniformScaleReport } from "./transform-scale-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const directory = path.join(root, "build");
const output = path.join(directory, "transforms-guards.json");
const modes = ["singular", "rank-one", "3d", "rotate-x", "w-not-one", "range-large", "range-small", "range-pivot"];
const codes = ["E_TRANSFORM_SINGULAR", "E_TRANSFORM_SINGULAR", "E_TRANSFORM_3D", "E_TRANSFORM_3D", "E_TRANSFORM_3D",
  "E_TRANSFORM_RANGE", "E_TRANSFORM_RANGE", "E_TRANSFORM_RANGE"];
// affine_factors rejects non-planar matrices in two places: any z-coupling entry
// (perspective at m[11], rotateX at m[6] and m[9]) and a weight m[15] other than 1.
// A uniform scale writes only m[10], which neither branch reads. Pinned here,
// apart from the probe's own table.
const planarMessages = {
  "3d": "E_TRANSFORM_3D: perspective and 3D transforms are not implemented",
  "rotate-x": "E_TRANSFORM_3D: perspective and 3D transforms are not implemented",
  "w-not-one": "E_TRANSFORM_3D: expected a planar affine transform",
};
// --allow-original-negative runs the uniform-scale lane on the preceding host,
// which must fail exactly the checks that need the uniform scale (the rejected
// guard cases and the input guards hold on both hosts). --capture runs only that
// lane, in the native renderer, and verifies the saved frame as well.
const flags = process.argv.slice(2);
const allowOriginalNegative = flags.includes("--allow-original-negative");
const capture = flags.includes("--capture");
if (flags.some(flag => !["--allow-original-negative", "--capture"].includes(flag)) || (allowOriginalNegative && capture)) {
  throw new Error("Run transform-guards-check.mjs without arguments, or with one of --allow-original-negative and --capture");
}
if (!existsSync(path.join(directory, "app.js"))) throw new Error("Build the real RN examples bundle before running transform guards");
mkdirSync(directory, { recursive: true });
if (capture) {
  await verifyUniformScale();
  process.exit(0);
}
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
  if (planarMessages[entry.mode] !== undefined) {
    assert.equal(entry.expectedError, planarMessages[entry.mode], entry.mode);
  }
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
await verifyUniformScale();

// The uniform-scale lane (examples/transforms/uniform-scale.gd): five fresh
// applications whose Controls are compared with analytical planar matrices by the
// probe and again, from the recorded Controls, by scripts/transform-scale-oracle.mjs.
async function verifyUniformScale() {
  const lane = allowOriginalNegative ? "original" : capture ? "capture" : "current";
  const sha = file => createHash("sha256").update(readFileSync(file)).digest("hex");
  const raw = path.join(directory, "transforms-uniform-scale.json");
  const frame = path.join(directory, "transform-uniform-scale.png");
  rmSync(raw, { force: true });
  if (capture) {
    rmSync(frame, { force: true });
  }
  const run = spawnSync(await ensureGodotBinary(), [
    "--path", root, ...(capture ? [] : ["--headless"]), "res://examples/transforms/uniform-scale.tscn", "--", "--validate",
    ...(capture ? ["--capture"] : []), ...(allowOriginalNegative ? ["--allow-original-negative"] : []),
  ], { encoding: "utf8", timeout: 90000, maxBuffer: 64 * 1024 * 1024 });
  const log = (run.stdout ?? "") + (run.stderr ?? "");
  writeFileSync(path.join(directory, `transforms-uniform-scale-${lane}.log`), log);
  assert.equal(run.error, undefined, log);
  assert.equal(run.signal, null, log);
  assert.equal(run.status, 0, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  const report = JSON.parse(readFileSync(raw, "utf8"));
  report.provenance = { node: process.version, nativeHostSha256: sha(path.join(root, "addons/fabric_godot.dylib")),
    bundleSha256: sha(path.join(directory, "app.js")), sourceReceiptDoesNotCertifyNativeBuild: true };
  assert.equal(report.scenario, "transforms-uniform-scale");
  assert.equal(report.engine, "hermes");
  assert.equal(report.renderer, "fabric");
  assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  assert.equal(report.capturing, capture);
  assert.equal(report.displayServer === "headless", !capture);
  const failures = report.checks.filter(check => !check.passed).map(check => check.name);
  // Every visible Godot error is a failed check or a host error the report keeps.
  const hostErrors = SCALE_MODES.flatMap(mode => report.cases[mode].afterStop.errors.map(error => `FABRIC_ERROR: ${error.split("\n")[0]}`));
  const visible = [...log.matchAll(/^ERROR: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(visible.sort(), [...failures.map(name => `FABRIC_CHECK_FAILED: ${name}`), ...hostErrors].sort(), log);
  if (allowOriginalNegative) {
    // The preceding host has no uniform scale. By position: the independence of the
    // runtimes holds; the three static cases fail mount, matrix, factors and
    // stability; the Pressable fails those four and both presses; the animated case
    // mounts at rest but fails its run, its frames, its end and the press back; every
    // release holds. 22 of 29 checks, the normative set.
    assert.deepEqual(report.checks.map(check => check.passed),
      [true, ...Array(12).fill(false), ...Array(6).fill(false), true, ...Array(4).fill(false), ...Array(5).fill(true)]);
    assert.equal(report.originalNegativeObserved, true);
    assert.deepEqual([...failures].sort(), [...report.expectedOriginalFailures].sort());
    assert.match(log, new RegExp(`TRANSFORM_UNIFORM_SCALE_ORIGINAL_NEGATIVE: ${failures.length}`));
    // What fails is the planar guard and nothing else the slice touches: the first
    // error of each case that mounts a scaled style (the three static ones and the
    // Pressable) is its E_TRANSFORM_3D exception (a rejected mount can raise a
    // follow-up lookup error after it), and the animated case fails once per frame,
    // directly from the backend.
    for (const mode of SCALE_MODES.filter(name => name !== "uniform-animated")) {
      const [first, ...rest] = report.cases[mode].afterStop.errors;
      assert.equal(first.split("\n")[0], "Exception in HostFunction: E_TRANSFORM_3D: expected a planar affine transform", mode);
      for (const error of rest) {
        assert.match(error.split("\n")[0], /^Exception in HostFunction: map::at:\s+key not found$/, mode);
      }
    }
    const animated = report.cases["uniform-animated"].afterStop.errors.map(error => error.split("\n")[0]);
    assert.ok(animated.filter(error => error === "E_TRANSFORM_3D: expected a planar affine transform").length > 10);
    for (const error of animated) {
      assert.match(error, /^(Exception in HostFunction: |Non-js exception: )?E_TRANSFORM_3D: expected a planar affine transform$/);
    }
    assert.ok(oracleRejection(report) !== null, "The oracle rejects the preceding host's report");
    writeFileSync(path.join(directory, "transforms-uniform-scale-original-report.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(`TRANSFORM_UNIFORM_SCALE_ORIGINAL_NEGATIVE_VERIFIED: ${failures.length} of ${report.checks.length} checks fail on the preceding host`);
    return;
  }
  assert.deepEqual(failures, []);
  assert.equal(report.status, "passed");
  assert.equal(report.failed, false);
  assert.equal(report.originalNegativeObserved, false);
  assert.match(log, /TRANSFORM_UNIFORM_SCALE_PASSED: \d+/);
  const oracle = verifyUniformScaleReport(report, { capture });
  if (capture) {
    // The saved frame, decoded apart from Godot's own readback, at the oracle's points.
    const bytes = readFileSync(frame);
    const image = decodeNativePng(bytes, 900, 680);
    const near = (actual, expected) => [0, 2, 4].every(offset =>
      Math.abs(parseInt(actual.slice(offset, offset + 2), 16) - parseInt(expected.slice(offset, offset + 2), 16)) <= 6);
    for (const sample of report.images[0].samples) {
      const actual = image.color(...sample.point);
      assert.ok(near(actual, sample.expected) && actual.endsWith("ff"), `${sample.case} ${sample.kind} at ${sample.point}: ${actual} against ${sample.expected}`);
    }
    assert.ok(Object.values(COLORS).every(color => /^[0-9a-f]{6}$/.test(color)));
    report.provenance.captureSha256 = sha(frame);
  }
  writeFileSync(path.join(directory, `transforms-uniform-scale-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  const originalFile = path.join(directory, "transforms-uniform-scale-original-report.json");
  if (!capture && existsSync(originalFile)) {
    // A local control from the preceding host: the same reproducer, another native host.
    const original = JSON.parse(readFileSync(originalFile, "utf8"));
    assert.deepEqual(original.checks.map(check => check.name), report.checks.map(check => check.name));
    assert.deepEqual(original.expectedOriginalFailures, report.expectedOriginalFailures);
    assert.equal(original.provenance.bundleSha256, report.provenance.bundleSha256, "The same bundle runs on both hosts");
    assert.notEqual(original.provenance.nativeHostSha256, report.provenance.nativeHostSha256);
    writeFileSync(path.join(directory, "transforms-uniform-scale-comparison.json"), JSON.stringify({ scenario: report.scenario,
      originalFailures: original.checks.filter(check => !check.passed).map(check => check.name),
      original: { nativeHostSha256: original.provenance.nativeHostSha256 },
      current: { checks: report.checks.length, nativeHostSha256: report.provenance.nativeHostSha256, bundleSha256: report.provenance.bundleSha256 },
      maximumErrorsAgainstTheOracle: oracle }, null, 2) + "\n");
  }
  console.log(`TRANSFORM_UNIFORM_SCALE_${capture ? "CAPTURE_" : ""}VERIFIED: ${report.checks.length} executed checks; ` +
    `${oracle.animatedSamples} animated frames, ${oracle.animatedIntermediateFrames} between the ends`);
}
