import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundlePerformanceProbe, performanceNativeProducers} from "../scripts/performance-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {verifyPerformanceReport} from "./performance-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// The preceding host has no performance section: --allow-original-negative runs the same bundle on it.
// --sabotage=<leak|heap|phase> runs it on a host that was broken on purpose (scripts/performance-sabotage.mjs
// builds those hosts and restores the source): one that never frees the Controls of a retired root, one whose
// Hermes heap reading is taken once and then repeated, and one that counts each phase of a pump twice.
// --replay=<report.json> judges a report that was recorded before, a hosted run's artifact say: the probe's own
// checks run over the recorded readings in Godot, without the application, and the oracle recomputes the rest,
// so a machine that failed can be replayed on any other.
const replayArgument = process.argv.find(argument => argument.startsWith("--replay="));
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const sabotageArgument = process.argv.find(argument => argument === "--sabotage" || argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : sabotageArgument.split("=")[1];
assert.ok([null, "leak", "heap", "phase"].includes(sabotage), "Unknown sabotage: " + sabotage);
const lane = allowOriginalNegative ? "original" : sabotage === null ? "current" : `sabotage-${sabotage}`;
const digest = value => createHash("sha256").update(value).digest("hex");
const sorted = values => [...values].sort();
const probeSources = ["tests/performance-fixture.jsx", "tests/performance-cases.mjs", "tests/performance-probe.gd",
  "tests/performance-native.test.mjs", "tests/performance-oracle.mjs", "scripts/performance-bundle.mjs",
  "scripts/native-probe-bundle.mjs", "src/react-native-platform.jsx", "src/svg.jsx", "sdk/toolchain/platform-plugin.mjs",
  ".deps/hermes/destroot/include/jsi/instrumentation.h", ...performanceNativeProducers];

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
  await rm(path.join(root, "build/performance-report.json"), {force: true});
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/performance-probe.gd", "--",
    ...(allowOriginalNegative ? ["--allow-original-negative"] : []), ...(sabotage === null ? [] : ["--sabotage"])],
  {encoding: "utf8", timeout: 480000, maxBuffer: 64 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/performance-${lane}.log`), log);
  const report = await optionalJson("build/performance-report.json");
  if (report != null) {
    const pinned = JSON.parse(await readFile(path.join(root, "dependencies.json"), "utf8"));
    report.provenance = {node: process.version, bundle, pinned: {godot: pinned.godot.version, hermes: pinned.hermes.version,
      reactNative: pinned["react-native"].version},
    nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, `build/performance-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  return {result, log, report};
}

// The oracle must reject a report on its own derivations, even with every probe check marked as passed.
function oracleRejection(report) {
  try {
    verifyPerformanceReport({...report, checks: report.checks.map(row => ({...row, passed: true}))});
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
    if (!performanceNativeProducers.includes(file)) {
      assert.equal(control.provenance.bundle.sources[file], sha, `${name} shares the reproducer and SDK producer: ${file}`);
    }
  }
  assert.notEqual(control.provenance.nativeHostSha256, report.provenance.nativeHostSha256, name);
}

// The probe's own checks over a recorded report, in Godot and without the application.
function replayChecks(binary, file) {
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/performance-probe.gd", "--",
    `--replay=${path.resolve(file)}`], {encoding: "utf8", timeout: 120000, maxBuffer: 64 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  assert.equal(result.error, undefined, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  const verdicts = log.match(/^PERFORMANCE_REPLAY_CHECKS: (.*)$/m);
  assert.ok(verdicts, log);
  return {status: result.status, log, checks: JSON.parse(verdicts[1])};
}

async function replay(file) {
  const report = JSON.parse(await readFile(file, "utf8"));
  const replayed = replayChecks(await ensureGodotBinary(), file);
  assert.equal(replayed.status, 0, replayed.log);
  assert.match(replayed.log, /PERFORMANCE_REPLAY: \d+ checks, 0 failed/, replayed.log);
  console.log(`${path.basename(file)}: ${replayed.log.match(/PERFORMANCE_REPLAY: .*/)[0]}; the oracle accepts it`);
  console.log(JSON.stringify(verifyPerformanceReport(report).workloads, null, 2));
}

// The report with one reading altered, to show that the probe's checks and the oracle each reject the change.
async function mutated(report, name, change) {
  const copy = structuredClone(report);
  change(copy.stages);
  const file = path.join(root, `build/performance-${lane}-${name}-report.json`);
  await writeFile(file, JSON.stringify(copy));
  return {copy, file};
}

test("The host counts its views, phases and Hermes heap exactly, and a soak of mounts and unmounts returns to the baseline", async () => {
  if (replayArgument !== undefined) {
    await replay(replayArgument.slice("--replay=".length));
    return;
  }
  const bundle = await bundlePerformanceProbe();
  const binary = await ensureGodotBinary();
  const {result, log, report} = await runProbe(binary, bundle);
  // Artifacts are saved before assertions. A control flag never accepts unrelated failures or removes the declared
  // failures from the report.
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.equal(result.status, 0, log);
  assert.ok(report != null, log);
  // A host that frees nothing leaves Godot to report its leak at exit; the other lanes leak nothing.
  assert.doesNotMatch(log, sabotage === "leak" ? /SCRIPT ERROR|Program crashed/ : /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.equal(report.scenario, "performance");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.equal(new Set(report.expectedOriginalFailures).size, report.expectedOriginalFailures.length);
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  if (sabotage !== "leak") {
    // Every ERROR line is a failed check: no native, script or engine error hides.
    assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length, "No native diagnostic, script or engine error is hidden");
  }
  for (const file of probeSources) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  for (const file of ["ReactCommon/react/nativemodule/webperformance/NativePerformance.cpp", "ReactCommon/react/renderer/mounting/ShadowTree.cpp",
    "ReactCommon/react/renderer/mounting/MountingCoordinator.cpp", "ReactCommon/react/renderer/telemetry/TransactionTelemetry.cpp",
    "Libraries/Lists/FlatList.js"]) {
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  }
  // The checks that need the section are normative; the rest holds on both hosts.
  assert.ok(report.expectedOriginalFailures.length > 0 && report.expectedOriginalFailures.length < report.checks.length);
  if (allowOriginalNegative) {
    // Without the section the host cannot say what it counts, how long its phases took or what Hermes holds:
    // exactly the checks that read it fail, and the nodes and views Godot and the surface report still hold.
    assert.ok(report.originalNegativeObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedOriginalFailures), "Only the section checks qualify as the old-host control");
    assert.match(log, new RegExp(`PERFORMANCE_ORIGINAL_NEGATIVE: ${failures.length}`));
    assert.ok(oracleRejection(report) != null, "The oracle rejects the preceding host");
    return;
  }
  assert.equal(report.originalNegativeObserved, false);
  if (sabotage !== null) {
    assert.ok(failures.length > 0);
    assert.match(log, new RegExp(`PERFORMANCE_SABOTAGE_REJECTED: ${failures.length}`));
    assert.ok(oracleRejection(report) != null, "The oracle rejects the sabotaged report");
    return;
  }
  assert.deepEqual(failures, []);
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.match(log, /PERFORMANCE_PASSED: \d+/);
  // The provenance a baseline needs, from the host and from the pins it was built against.
  const {pinned} = report.provenance;
  assert.ok(report.stages.provenance.godot.startsWith(pinned.godot), "The engine is the pinned Godot");
  assert.equal(report.stages.provenance.hermes, pinned.hermes, "and the runtime is the pinned Hermes");
  const stats = verifyPerformanceReport(report);
  console.log(`Baselines by workload:\n${JSON.stringify(stats.workloads, null, 2)}`);
  // Judging the recorded report again, as --replay judges one from anywhere else, gives the verdicts of the run.
  const replayed = replayChecks(binary, path.join(root, `build/performance-${lane}-report.json`));
  assert.equal(replayed.status, 0, replayed.log);
  assert.deepEqual(replayed.checks, report.checks.filter(row => !row.name.startsWith("report/")),
    "Replaying the recorded report gives the verdicts of the run");
  // The same breakages that the retained sabotages make in the host, made in the recorded readings: the probe's checks
  // and the oracle each reject them, with no host to rebuild.
  const negatives = {};
  const frozen = await mutated(report, "frozen-heap", stages => {
    stages.heapSource.retained.performance.hermes.heap = structuredClone(stages.heapSource.rest.performance.hermes.heap);
  });
  const twice = await mutated(report, "phase-twice", stages => {
    stages.workloads.list.final.performance.phases.js.count *= 2;
  });
  const leaked = await mutated(report, "leaked-node", stages => {
    stages.workloads.chart.cycles[7].after.godot.nodes += 1;
    stages.workloads.chart.cycles[7].after.godot.nodeMonitor += 1;
  });
  // The live heap at rest rising past the limit in one steady cycle, and exactly the limit, which is allowed. The probe's
  // own account of the largest step follows the change, as it would in a run.
  const heapAt = (stages, rise) => {
    const cycle = stages.workloads.chart.cycles[10];
    cycle.after.performance.hermes.heap.hermes_allocatedBytes += rise;
    stages.observedHeap.chart.largestStep = rise;
  };
  const grew = await mutated(report, "heap-grew", stages => heapAt(stages, 3000));
  const atLimit = await mutated(report, "heap-at-limit", stages => heapAt(stages, 2048));
  // A notification of an unmount that still counts the root as alive, as the snapshot read before the retirement does.
  const stale = await mutated(report, "stale-notification", stages => {
    stages.workloads.idle.cycles[4].retiredSurface.liveRoots = 1;
  });
  // A stopped application whose second reading differs from the first, as one that read Hermes' heap afresh would give.
  const drifting = await mutated(report, "stopped-drift", stages => {
    stages.stopped.plain[1] = "0".repeat(64);
  });
  for (const [name, change] of Object.entries({frozen, twice, leaked, grew, stale, drifting})) {
    const judged = replayChecks(binary, change.file);
    assert.equal(judged.status, 1, judged.log);
    assert.equal(judged.checks.length, replayed.checks.length, `${name}: the replay loses no check`);
    negatives[name] = {failedChecks: judged.checks.filter(row => !row.passed).map(row => row.name), oracle: oracleRejection(change.copy)};
    assert.ok(negatives[name].oracle != null, `${name}: the oracle rejects it`);
  }
  assert.deepEqual(negatives.frozen.failedChecks.sort(), [
    "heap/Releasing them lowers it again by at least that much",
    "heap/Retaining JS objects raises the collected heap by at least what they hold",
    "heap/Every reading ran a collection: Hermes' collection count rises from one reading to the next"].sort(),
  "A frozen heap reading fails the heap checks, and only those");
  assert.deepEqual(negatives.twice.failedChecks, [
    "invariants/At every reading the phases add up to no more than the pump, and none has more samples than the pump"],
  "A phase counted twice fails the invariant that bounds it");
  assert.deepEqual(negatives.leaked.failedChecks, [
    "chart/Every cycle ends with the SceneTree's nodes back to the baseline of this run"], "A node left in the SceneTree fails its cycle");
  assert.deepEqual(negatives.grew.failedChecks, [
    "chart/The live heap after each steady cycle stays within 2048 bytes of the first steady cycle's"],
  "A live heap that rose 3000 bytes in a steady cycle fails the limit");
  assert.deepEqual(negatives.stale.failedChecks, [
    "unmount/The notification of a root's unmount agrees with the application on its live and retired roots"],
  "A notification that still counts the retired root as alive fails the unmount check");
  assert.deepEqual(negatives.drifting.failedChecks, [
    "stop/Two readings of the stopped application's snapshot are identical, with and without the validation metas"],
  "A stopped application whose snapshot changes between two readings fails the stop check");
  // The limit is inclusive: 2048 bytes above the first steady cycle passes the probe's check and the oracle's.
  const allowed = replayChecks(binary, atLimit.file);
  assert.equal(allowed.status, 0, allowed.log);
  assert.equal(oracleRejection(atLimit.copy), null, "The oracle accepts a rise of exactly the limit");
  // A recorded report with a section emptied or malformed is incomplete: the replay says so with status 2 and does not abort on what it
  // lacks. The sections the later versions of the probe added are the ones that older or damaged reports lack.
  const damaged = {
    "stopped-empty": stages => { stages.stopped = {}; },
    "stopped-short": stages => { stages.stopped.plain = [stages.stopped.plain[0]]; },
    "windows-hollow": stages => { stages.windows.withMeta = {}; },
    "surface-row-old": stages => { delete stages.workloads.forms.cycles[2].retiredSurface.liveRoots; },
    "workloads-null": stages => { stages.workloads = null; },
  };
  for (const [name, change] of Object.entries(damaged)) {
    const broken = await mutated(report, `incomplete-${name}`, change);
    const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/performance-probe.gd", "--",
      `--replay=${path.resolve(broken.file)}`], {encoding: "utf8", timeout: 120000, maxBuffer: 64 * 1024 * 1024});
    const output = (result.stdout ?? "") + (result.stderr ?? "");
    assert.equal(result.status, 2, `${name}: ${output}`);
    assert.match(output, /PERFORMANCE_REPLAY_INCOMPLETE/, name);
    assert.doesNotMatch(output, /SCRIPT ERROR|Invalid access|Program crashed/, name);
  }
  const original = await optionalJson("build/performance-original-report.json");
  if (original != null) {
    assert.ok(original.originalNegativeObserved);
    assertSameReproducer(original, report, bundle, "preceding host");
  }
  const sabotages = {};
  for (const kind of ["leak", "heap", "phase"]) {
    const recorded = await optionalJson(`build/performance-sabotage-${kind}-report.json`);
    sabotages[kind] = recorded;
    if (recorded != null) {
      assert.ok(recorded.checks.some(row => !row.passed) && oracleRejection(recorded) != null, `The ${kind} sabotage is rejected`);
      assertSameReproducer(recorded, report, bundle, `host with the ${kind} sabotage`);
    }
  }
  await writeFile(path.join(root, "build/performance-comparison.json"), JSON.stringify({scenario: report.scenario,
    originalControlPresent: original != null, sabotageLeakPresent: sabotages.leak != null, sabotageHeapPresent: sabotages.heap != null,
    sabotagePhasePresent: sabotages.phase != null, intentionalNativeProducerDifferences: performanceNativeProducers,
    originalFailures: original?.checks.filter(row => !row.passed).map(row => row.name) ?? null,
    sabotageFailures: Object.fromEntries(Object.entries(sabotages).map(([kind, recorded]) =>
      [kind, recorded?.checks.filter(row => !row.passed).map(row => row.name) ?? null])),
    sabotageRejections: Object.fromEntries(Object.entries(sabotages).map(([kind, recorded]) =>
      [kind, recorded == null ? null : oracleRejection(recorded)])),
    reportLevelNegatives: negatives, oracle: stats,
    current: {checks: report.checks.length, nativeHostSha256: report.provenance.nativeHostSha256, bundleSha256: bundle.bundle.sha256}},
  null, 2) + "\n");
});
