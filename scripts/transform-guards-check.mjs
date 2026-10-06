import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeNativePng } from "../tests/native-png.mjs";
import { ensureGodotBinary } from "./godot-binary.mjs";
import { COLORS, MODES as SCALE_MODES, oracleRejection, verifyUniformScaleReport } from "./transform-scale-oracle.mjs";
import {
  COLORS as SINGULAR_COLORS, MODES as SINGULAR_MODES, oracleRejection as singularRejection, verifySingularReport,
} from "./transform-singular-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const directory = path.join(root, "build");
const output = path.join(directory, "transforms-guards.json");
const modes = ["3d", "rotate-x", "w-not-one", "range-large", "range-small", "range-pivot"];
const codes = ["E_TRANSFORM_3D", "E_TRANSFORM_3D", "E_TRANSFORM_3D", "E_TRANSFORM_RANGE", "E_TRANSFORM_RANGE", "E_TRANSFORM_RANGE"];
// affine_factors rejects non-planar matrices in two places: any z-coupling entry
// (perspective at m[11], rotateX at m[6] and m[9]) and a weight m[15] other than 1.
// A uniform scale writes only m[10], which neither branch reads. Pinned here,
// apart from the probe's own table.
const planarMessages = {
  "3d": "E_TRANSFORM_3D: perspective and 3D transforms are not implemented",
  "rotate-x": "E_TRANSFORM_3D: perspective and 3D transforms are not implemented",
  "w-not-one": "E_TRANSFORM_3D: expected a planar affine transform",
};
// Without arguments: the guard cases, the input guards and both probe lanes
// (examples/transforms/uniform-scale.gd and singular.gd) on the installed host. Each
// lane has its own preceding host, so the flags that need one take the lane they run
// with. --allow-original-negative runs that lane on its preceding host, which must
// fail exactly the checks that need the change under test; --capture runs the lane in
// the native renderer and verifies the saved frame as well, and runs both lanes
// without --lane. --lane alone runs one lane on the installed host. --lane=singular
// --sabotage runs that lane on the host scripts/transform-singular-sabotage.mjs builds
// without the pointer projection's collapsed branch, which only that lane can isolate:
// it must fail exactly the two capture checks and the oracle must reject its report.
const LANES = ["uniform-scale", "singular"];
const flags = process.argv.slice(2);
const allowOriginalNegative = flags.includes("--allow-original-negative");
const capture = flags.includes("--capture");
const sabotage = flags.includes("--sabotage");
const selectedLane = flags.find(flag => flag.startsWith("--lane="))?.slice("--lane=".length);
if (flags.some(flag => !["--allow-original-negative", "--capture", "--sabotage"].includes(flag) && !flag.startsWith("--lane=")) ||
    [allowOriginalNegative, capture, sabotage].filter(Boolean).length > 1 ||
    (selectedLane !== undefined && !LANES.includes(selectedLane)) || ((allowOriginalNegative || sabotage) && selectedLane === undefined) ||
    (sabotage && selectedLane !== "singular")) {
  throw new Error("Run transform-guards-check.mjs without arguments, with --capture, or with --lane=uniform-scale|singular " +
    "alone or with one of --allow-original-negative and --capture (the former needs its lane), or with --lane=singular --sabotage");
}
if (!existsSync(path.join(directory, "app.js"))) throw new Error("Build the real RN examples bundle before running transform guards");
mkdirSync(directory, { recursive: true });
if (capture || selectedLane !== undefined) {
  if (selectedLane !== "singular") {
    await verifyUniformScale();
  }
  if (selectedLane !== "uniform-scale") {
    await verifySingular();
  }
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
await verifySingular();

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
    `${oracle.animatedFrames} frames delivered to the animations, ${oracle.animatedIntermediateFrames} between the ends`);
}

// The singular-transform lane (examples/transforms/singular.gd): eight fresh
// applications whose Controls, RN's measurements, real presses and captured pointer
// are compared with what the declarations mean by the probe and again, from the
// recorded values, by scripts/transform-singular-oracle.mjs.
async function verifySingular() {
  const lane = allowOriginalNegative ? "original" : sabotage ? "sabotage" : capture ? "capture" : "current";
  const sha = file => createHash("sha256").update(readFileSync(file)).digest("hex");
  const raw = path.join(directory, "transforms-singular.json");
  const frame = path.join(directory, "transform-singular.png");
  rmSync(raw, { force: true });
  if (capture) {
    rmSync(frame, { force: true });
  }
  const run = spawnSync(await ensureGodotBinary(), [
    "--path", root, ...(capture ? [] : ["--headless"]), "res://examples/transforms/singular.tscn", "--", "--validate",
    ...(capture ? ["--capture"] : []), ...(allowOriginalNegative ? ["--allow-original-negative"] : []), ...(sabotage ? ["--sabotage"] : []),
  ], { encoding: "utf8", timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
  const log = (run.stdout ?? "") + (run.stderr ?? "");
  writeFileSync(path.join(directory, `transforms-singular-${lane}.log`), log);
  assert.equal(run.error, undefined, log);
  assert.equal(run.signal, null, log);
  assert.equal(run.status, 0, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  const report = JSON.parse(readFileSync(raw, "utf8"));
  report.provenance = { node: process.version, nativeHostSha256: sha(path.join(root, "addons/fabric_godot.dylib")),
    bundleSha256: sha(path.join(directory, "app.js")), sourceReceiptDoesNotCertifyNativeBuild: true };
  assert.equal(report.scenario, "transforms-singular");
  assert.equal(report.engine, "hermes");
  assert.equal(report.renderer, "fabric");
  assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  assert.equal(report.sabotage, sabotage);
  assert.equal(report.capturing, capture);
  assert.equal(report.displayServer === "headless", !capture);
  const failures = report.checks.filter(check => !check.passed).map(check => check.name);
  // Every visible Godot error is a failed check or a host error the report keeps.
  const hostErrors = SINGULAR_MODES.flatMap(mode => report.cases[mode].afterStop.errors.map(error => `FABRIC_ERROR: ${error.split("\n")[0]}`));
  const visible = [...log.matchAll(/^ERROR: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(visible.sort(), [...failures.map(name => `FABRIC_CHECK_FAILED: ${name}`), ...hostErrors].sort(), log);
  if (sabotage) {
    // A host that has lost only the pointer projection's collapsed branch is right about
    // everything the transform step does and raises no error. What it gets wrong is the
    // captured pointer of a collapsed owner: projected through the owner's last
    // invertible transform, its events report the owner's layout coordinates where RN's
    // own payload is expected. Exactly those two checks fail, named here apart from the
    // probe's own table, and the oracle rejects the report from its own derivations.
    const named = [/^capture\/After the owner collapses, the same captured pointer keeps reaching it/,
      /^capture\/The release reaches the collapsed owner, which then loses the capture/];
    assert.equal(report.sabotageObserved, true);
    assert.deepEqual([...failures].sort(), [...report.expectedSabotageFailures].sort());
    assert.equal(failures.length, named.length);
    for (const pattern of named) {
      assert.equal(failures.filter(name => pattern.test(name)).length, 1, `${pattern} fails on the sabotaged host`);
    }
    assert.deepEqual(hostErrors, [], "The sabotaged host raises no error");
    assert.match(log, new RegExp(`TRANSFORM_SINGULAR_SABOTAGE_REJECTED: ${failures.length}`));
    const { gesture } = report.cases.capture;
    const owner = [gesture.second[0] - report.layout.boxLeft, gesture.second[1] - report.layout.boxTop];
    assert.deepEqual([gesture.afterMove[3].offsetX, gesture.afterMove[3].offsetY], owner,
      "The move after the collapse reports the owner's layout coordinates");
    const rejection = singularRejection(report, {});
    assert.ok(rejection !== null, "The oracle rejects the sabotaged host's report");
    writeFileSync(path.join(directory, "transforms-singular-sabotage-report.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(`TRANSFORM_SINGULAR_SABOTAGE_VERIFIED: ${failures.length} of ${report.checks.length} checks fail on the host without the collapsed branch ` +
      `(${rejection})`);
    return;
  }
  if (allowOriginalNegative) {
    // The preceding host throws E_TRANSFORM_SINGULAR for every singular transform. By
    // position: the independence of the runtimes holds; the four static cases, the
    // entrance and the toggle fail every check but their release, because their
    // mount is rejected; the exit mounts shown and takes its press, then fails its
    // run, its frames, its end and the release of its field's focus; the capture holds
    // until the owner collapses and fails from there; every release holds. 37 of 49
    // checks, the normative set.
    const held = count => Array(count).fill(true), failed = count => Array(count).fill(false);
    assert.deepEqual(report.checks.map(check => check.passed), [
      ...held(1), ...failed(20), ...failed(5), ...held(2), ...failed(4), ...held(1), ...failed(2), ...failed(6), ...held(8)]);
    assert.equal(report.originalNegativeObserved, true);
    assert.deepEqual([...failures].sort(), [...report.expectedOriginalFailures].sort());
    assert.match(log, new RegExp(`TRANSFORM_SINGULAR_ORIGINAL_NEGATIVE: ${failures.length}`));
    // What fails is the old rejection and nothing else the slice touches: a mounted
    // singular style raises E_TRANSFORM_SINGULAR (a matrix that only loses rank in
    // float, E_TRANSFORM_RANGE), from the commit of a mount, of a React update or of a
    // native-driver frame.
    for (const mode of SINGULAR_MODES) {
      const errors = report.cases[mode].afterStop.errors.map(error => error.split("\n")[0]);
      if (mode === "exit" || mode === "capture") {
        assert.ok(errors.length > 0, mode);
      }
      const message = mode === "rank-lost" ? "E_TRANSFORM_RANGE: transform loses rank at native coordinate precision"
        : "E_TRANSFORM_SINGULAR: singular transforms are not implemented";
      for (const [index, error] of errors.entries()) {
        // A rejected mount can raise a follow-up lookup error after the first.
        assert.ok(error === message || error === `Exception in HostFunction: ${message}` || error === `Non-js exception: ${message}` ||
          (index > 0 && /^Exception in HostFunction: map::at:\s+key not found$/.test(error)), `${mode}: ${error}`);
      }
    }
    assert.ok(singularRejection(report, {}) !== null, "The oracle rejects the preceding host's report");
    writeFileSync(path.join(directory, "transforms-singular-original-report.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(`TRANSFORM_SINGULAR_ORIGINAL_NEGATIVE_VERIFIED: ${failures.length} of ${report.checks.length} checks fail on the preceding host`);
    return;
  }
  assert.deepEqual(failures, []);
  assert.equal(report.status, "passed");
  assert.equal(report.failed, false);
  assert.equal(report.originalNegativeObserved, false);
  assert.equal(report.sabotageObserved, false);
  assert.match(log, /TRANSFORM_SINGULAR_PASSED: \d+/);
  const oracle = verifySingularReport(report, { capture });
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
    assert.ok(Object.values(SINGULAR_COLORS).every(color => /^[0-9a-f]{6}$/.test(color)));
    report.provenance.captureSha256 = sha(frame);
  }
  writeFileSync(path.join(directory, `transforms-singular-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  const originalFile = path.join(directory, "transforms-singular-original-report.json");
  const sabotageFile = path.join(directory, "transforms-singular-sabotage-report.json");
  const receiptFile = path.join(directory, "transforms-singular-sabotage.json");
  // The local controls, present once their hosts have been run: the same reproducer on
  // another native host, either the preceding one or the one without the collapsed branch.
  const original = !capture && existsSync(originalFile) ? JSON.parse(readFileSync(originalFile, "utf8")) : null;
  const broken = !capture && existsSync(sabotageFile) ? JSON.parse(readFileSync(sabotageFile, "utf8")) : null;
  if (original !== null) {
    assert.deepEqual(original.checks.map(check => check.name), report.checks.map(check => check.name));
    assert.deepEqual(original.expectedOriginalFailures, report.expectedOriginalFailures);
    assert.equal(original.provenance.bundleSha256, report.provenance.bundleSha256, "The same bundle runs on both hosts");
    assert.notEqual(original.provenance.nativeHostSha256, report.provenance.nativeHostSha256);
  }
  let sabotageRejection = null;
  if (broken !== null) {
    assert.equal(broken.sabotageObserved, true);
    assert.deepEqual(broken.checks.filter(check => !check.passed).map(check => check.name).sort(), [...broken.expectedSabotageFailures].sort());
    assert.deepEqual(broken.expectedSabotageFailures, report.expectedSabotageFailures);
    assert.deepEqual(broken.checks.map(check => check.name), report.checks.map(check => check.name));
    assert.equal(broken.provenance.bundleSha256, report.provenance.bundleSha256, "The same bundle runs on the sabotaged host");
    assert.notEqual(broken.provenance.nativeHostSha256, report.provenance.nativeHostSha256);
    sabotageRejection = singularRejection(broken, {});
    assert.ok(sabotageRejection !== null, "The oracle rejects the sabotaged host's report");
  }
  if (!capture && existsSync(receiptFile)) {
    // The receipt of scripts/transform-singular-sabotage.mjs: it must describe this very
    // source and host, so a stale one fails here until the sabotage runs again.
    const receipt = JSON.parse(readFileSync(receiptFile, "utf8"));
    assert.equal(receipt.format, "godot-fabric.transform-singular-sabotage/v1");
    assert.deepEqual(receipt.sourceSha256.restored, receipt.sourceSha256.genuine, "The sabotage restored every source byte for byte");
    for (const [file, digest] of Object.entries(receipt.sourceSha256.genuine)) {
      assert.equal(sha(path.join(root, file)), digest, `${file} is not the source the sabotage ran against: run scripts/transform-singular-sabotage.mjs again`);
    }
    assert.equal(receipt.hostSha256.restored, receipt.hostSha256.genuine, "The rebuilt host is the genuine one");
    assert.equal(receipt.hostSha256.genuine, report.provenance.nativeHostSha256,
      "The receipt is not about the host under test: run scripts/transform-singular-sabotage.mjs again");
    assert.equal(receipt.variants.length, 1);
    const [entry] = receipt.variants;
    assert.equal(entry.runStatus, 0, "The sabotage run rejected the sabotaged host");
    assert.notEqual(entry.hostSha256, receipt.hostSha256.genuine);
    assert.ok(broken !== null, "The sabotaged host's report is kept beside its receipt");
    assert.equal(broken.provenance.nativeHostSha256, entry.hostSha256, "The sabotaged report comes from the receipt's sabotaged host");
  }
  if (original !== null || broken !== null) {
    writeFileSync(path.join(directory, "transforms-singular-comparison.json"), JSON.stringify({ scenario: report.scenario,
      originalControlPresent: original !== null, sabotagePresent: broken !== null,
      originalFailures: original?.checks.filter(check => !check.passed).map(check => check.name) ?? null,
      original: original === null ? null : { nativeHostSha256: original.provenance.nativeHostSha256 },
      sabotageFailures: broken?.checks.filter(check => !check.passed).map(check => check.name) ?? null, sabotageRejection,
      sabotage: broken === null ? null : { nativeHostSha256: broken.provenance.nativeHostSha256 },
      current: { checks: report.checks.length, nativeHostSha256: report.provenance.nativeHostSha256, bundleSha256: report.provenance.bundleSha256 },
      maximumErrorsAgainstTheOracle: oracle }, null, 2) + "\n");
  }
  console.log(`TRANSFORM_SINGULAR_${capture ? "CAPTURE_" : ""}VERIFIED: ${report.checks.length} executed checks; ` +
    `${oracle.animatedFrames} frames delivered to the animations, ${oracle.animatedIntermediateFrames} between the ends`);
}
