import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleFrameClockProbe, frameClockNativeProducers} from "../scripts/frame-clock-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {verifyFrameClockReport} from "./frame-clock-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// The preceding host has no frame clock and ticks on every Godot frame:
// --allow-original-negative runs the same bundle on it. --sabotage runs it on a host
// whose clock always ticks when a frame has a consumer (the preceding cadence, now with
// a clock to report it), --sabotage=idle on one whose clock ticks for frames nothing
// consumes and --sabotage=presentation on one that ignores V-Sync presentation and times
// the frames of a presented window (scripts/frame-clock-sabotage.mjs builds those hosts
// and restores the source).
// --replay=<report.json> judges a report that was recorded before, a hosted run's artifact say:
// the probe's own checks run over the recorded lanes in Godot, without the application, and the
// oracle recomputes every decision, so a machine that failed can be replayed on any other.
const replayArgument = process.argv.find(argument => argument.startsWith("--replay="));
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const sabotageArgument = process.argv.find(argument => argument === "--sabotage" || argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : (sabotageArgument.split("=")[1] ?? "always");
assert.ok([null, "always", "idle", "presentation"].includes(sabotage), "Unknown sabotage: " + sabotage);
const lane = allowOriginalNegative ? "original" : sabotage === null ? "current" : `sabotage-${sabotage}`;
const digest = value => createHash("sha256").update(value).digest("hex");
const sorted = values => [...values].sort();

async function optionalJson(file) {
  try {
    return JSON.parse(await readFile(path.join(root, file), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function runProbe(binary, bundle) {
  await rm(path.join(root, "build/frame-clock-report.json"), {force: true});
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/frame-clock-probe.gd", "--",
    ...(allowOriginalNegative ? ["--allow-original-negative"] : []), ...(sabotage === null ? [] : ["--sabotage"])],
  {encoding: "utf8", timeout: 240000, maxBuffer: 64 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/frame-clock-${lane}.log`), log);
  const report = await optionalJson("build/frame-clock-report.json");
  if (report != null) {
    report.provenance = {node: process.version, bundle,
      nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, `build/frame-clock-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  return {result, log, report};
}

// The oracle must reject a report on its own derivations, even with every
// probe check marked as passed.
function oracleRejection(report) {
  try {
    verifyFrameClockReport({...report, checks: report.checks.map(row => ({...row, passed: true}))});
  } catch (error) {
    return String(error.message).split("\n")[0];
  }
  return null;
}

function assertSameReproducer(control, report, bundle, name) {
  assert.deepEqual(control.checks.map(row => row.name), report.checks.map(row => row.name), name);
  assert.deepEqual(control.expectedOriginalFailures, report.expectedOriginalFailures, name);
  assert.equal(control.provenance.bundle.bundle.sha256, bundle.bundle.sha256, name + ": the same bundle runs on every host");
  // Only the compiled native producers differ between hosts; their bundle-time pins say nothing about them.
  for (const [file, sha] of Object.entries(bundle.sources)) {
    if (!frameClockNativeProducers.includes(file)) {
      assert.equal(control.provenance.bundle.sources[file], sha, `${name} shares the reproducer and SDK producer: ${file}`);
    }
  }
  assert.notEqual(control.provenance.nativeHostSha256, report.provenance.nativeHostSha256, name);
}

// What each lane really delivered, for the log of whoever reads a run: the checks hold of any of it.
function observedPace(stats) {
  return Object.entries(stats).map(([lane, run]) => `${lane}: ${run.pacing.frames} Godot frames, ${run.pacing.gapsUnderHalfPeriod} closer than half a period to the one before, ${
    run.pacing.stalls} stalls with ${run.pacing.catchUps} catch-up frames, ${run.ticks} ticks`).join("\n  ");
}

// The probe's own checks over a recorded report, in Godot and without the application.
function replayChecks(binary, file) {
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/frame-clock-probe.gd", "--",
    `--replay=${path.resolve(file)}`], {encoding: "utf8", timeout: 120000, maxBuffer: 64 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  assert.equal(result.error, undefined, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  const verdicts = log.match(/^FRAME_CLOCK_REPLAY_CHECKS: (.*)$/m);
  assert.ok(verdicts, log);
  return {status: result.status, log, checks: JSON.parse(verdicts[1])};
}

async function replay(file) {
  const report = JSON.parse(await readFile(file, "utf8"));
  const replayed = replayChecks(await ensureGodotBinary(), file);
  assert.equal(replayed.status, 0, replayed.log);
  assert.match(replayed.log, /FRAME_CLOCK_REPLAY: \d+ checks, 0 failed/, replayed.log);
  console.log(`${path.basename(file)}: ${replayed.log.match(/FRAME_CLOCK_REPLAY: .*/)[0]}; the oracle accepts it`);
  console.log(`  ${observedPace(verifyFrameClockReport(report).runs)}`);
}

test("The frame clock gives requestAnimationFrame and RN's Native Animated a display link's cadence on every Godot pacing", async () => {
  if (replayArgument !== undefined) {
    await replay(replayArgument.slice("--replay=".length));
    return;
  }
  const bundle = await bundleFrameClockProbe();
  const binary = await ensureGodotBinary();
  const {result, log, report} = await runProbe(binary, bundle);
  // Artifacts are saved before assertions. A control flag never accepts
  // unrelated failures or removes the declared failures from the report.
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.equal(result.status, 0, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.equal(report.scenario, "frame-clock");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.equal(new Set(report.expectedOriginalFailures).size, report.expectedOriginalFailures.length);
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  // Every ERROR line is a failed check: no native, script or engine error hides.
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length, "No native diagnostic, script or engine error is hidden");
  for (const file of ["tests/frame-clock-fixture.jsx", "tests/frame-clock-cases.mjs", "tests/frame-clock-probe.gd",
    "tests/frame-clock-native.test.mjs", "tests/frame-clock-oracle.mjs", "scripts/frame-clock-bundle.mjs",
    "scripts/native-probe-bundle.mjs", "src/react-native-platform.jsx", "src/animated-exports.js", "src/platform-color-value-types.js",
    "sdk/toolchain/platform-plugin.mjs", ...frameClockNativeProducers]) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  for (const file of ["ReactCommon/react/runtime/TimerManager.cpp", "React/CoreModules/RCTTiming.mm", "React/Base/RCTDisplayLink.m",
    "React/Fabric/RCTScheduler.mm", "ReactAndroid/src/main/jni/react/fabric/FabricUIManagerBinding.cpp",
    "ReactCommon/react/renderer/animated/drivers/DecayAnimationDriver.cpp", "Libraries/Animated/animations/DecayAnimation.js"]) {
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  }
  // The cadence checks are normative; the rest holds on both hosts.
  assert.ok(report.expectedOriginalFailures.length > 0 && report.expectedOriginalFailures.length < report.checks.length);
  if (allowOriginalNegative) {
    // Without a clock every frame with a callback or an animation is a tick: exactly the
    // checks that need the clock's counters, ticks half a period apart or a landing the
    // thinned ticks give fail.
    assert.ok(report.originalNegativeObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedOriginalFailures),
      "Only the cadence checks qualify as the old-host control");
    assert.match(log, new RegExp(`FRAME_CLOCK_ORIGINAL_NEGATIVE: ${failures.length}`));
    assert.ok(oracleRejection(report) != null, "The oracle rejects the preceding host");
    return;
  }
  assert.equal(report.originalNegativeObserved, false);
  if (sabotage !== null) {
    assert.ok(failures.length > 0);
    assert.match(log, new RegExp(`FRAME_CLOCK_SABOTAGE_REJECTED: ${failures.length}`));
    assert.ok(oracleRejection(report) != null, "The oracle rejects the sabotaged report");
    // A clock that decides wrongly can break more than cadence: one that ticks for idle frames
    // may refuse the frame a request after idling is waiting for, which fails a check that
    // holds on every other host. So a sabotage is asked for a failure and the oracle's rejection.
    return;
  }
  assert.deepEqual(failures, []);
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.match(log, /FRAME_CLOCK_PASSED: \d+/);
  const stats = verifyFrameClockReport(report);
  console.log(`The Godot frames each lane delivered:\n  ${observedPace(stats.runs)}`);
  // Judging the recorded report again, as --replay judges one from anywhere else, gives the verdicts of the run.
  const replayed = replayChecks(binary, path.join(root, `build/frame-clock-${lane}-report.json`));
  assert.equal(replayed.status, 0, replayed.log);
  assert.deepEqual(replayed.checks, report.checks.filter(row => !row.name.startsWith("report/")),
    "Replaying the recorded report gives the verdicts of the run");
  // A report where the request got no callback is judged like any other: the two checks that need the callback
  // fail and every check is still recorded, where reading the missing event once aborted the replay partway
  // (replayChecks rejects a script error), dropping the checks after it.
  const withoutCallback = structuredClone(report);
  withoutCallback.stages.callbacks.once.events = [];
  const withoutCallbackFile = path.join(root, `build/frame-clock-${lane}-without-callback-report.json`);
  await writeFile(withoutCallbackFile, JSON.stringify(withoutCallback));
  const judged = replayChecks(binary, withoutCallbackFile);
  assert.equal(judged.status, 1, judged.log);
  assert.equal(judged.checks.length, replayed.checks.length, "A report without the callback loses no check to the replay");
  assert.deepEqual(judged.checks.filter(row => !row.passed).map(row => row.name), [
    "callbacks/A request after idling reaches its callback in the very next Godot frame, with a frame timestamp",
    "callbacks/That frame is a tick the clock counts, and its timestamp is the clock's"]);
  const original = await optionalJson("build/frame-clock-original-report.json");
  if (original != null) {
    assert.ok(original.originalNegativeObserved);
    assertSameReproducer(original, report, bundle, "preceding host");
  }
  const always = await optionalJson("build/frame-clock-sabotage-always-report.json");
  const alwaysRejection = always == null ? null : oracleRejection(always);
  if (always != null) {
    assert.ok(always.checks.some(row => !row.passed) && alwaysRejection != null);
    assertSameReproducer(always, report, bundle, "host whose clock always ticks");
  }
  const idle = await optionalJson("build/frame-clock-sabotage-idle-report.json");
  const idleRejection = idle == null ? null : oracleRejection(idle);
  if (idle != null) {
    assert.ok(idle.checks.some(row => !row.passed) && idleRejection != null);
    assertSameReproducer(idle, report, bundle, "host whose clock ticks for idle frames");
  }
  const presentation = await optionalJson("build/frame-clock-sabotage-presentation-report.json");
  const presentationRejection = presentation == null ? null : oracleRejection(presentation);
  if (presentation != null) {
    assert.ok(presentation.checks.some(row => !row.passed) && presentationRejection != null);
    assertSameReproducer(presentation, report, bundle, "host whose clock times a presented window");
  }
  await writeFile(path.join(root, "build/frame-clock-comparison.json"), JSON.stringify({scenario: report.scenario,
    originalControlPresent: original != null, sabotageAlwaysPresent: always != null, sabotageIdlePresent: idle != null,
    sabotagePresentationPresent: presentation != null,
    intentionalNativeProducerDifferences: frameClockNativeProducers,
    originalFailures: original?.checks.filter(row => !row.passed).map(row => row.name) ?? null,
    sabotageAlwaysFailures: always?.checks.filter(row => !row.passed).map(row => row.name) ?? null, sabotageAlwaysRejection: alwaysRejection,
    sabotageIdleFailures: idle?.checks.filter(row => !row.passed).map(row => row.name) ?? null, sabotageIdleRejection: idleRejection,
    sabotagePresentationFailures: presentation?.checks.filter(row => !row.passed).map(row => row.name) ?? null,
    sabotagePresentationRejection: presentationRejection,
    oracle: stats,
    current: {checks: report.checks.length, nativeHostSha256: report.provenance.nativeHostSha256, bundleSha256: bundle.bundle.sha256}},
  null, 2) + "\n");
});
