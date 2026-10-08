import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleFrontierBaselineProbe, frontierBaselineNativeProducers, frontierBaselineSources} from "../scripts/frontier-baseline-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {HEAP_WINDOW_ROUNDS, ROUNDS, TOUR, WARMUP_ROUNDS} from "./frontier-baseline-cases.mjs";
import {verifyFrontierBaselineReport} from "./frontier-baseline-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// The performance baseline on the Frontier HUD's scene, headless: the probe runs in PROCESSES separate Godot processes and each holds the exact
// invariants, then the oracle judges each raw report. The slice changes no C++, so there is no preceding host to run it on.
// --sabotage=<leaky-panel|no-gc|world-leak|no-key> runs one process on a source that scripts/frontier-baseline-sabotage.mjs broke on
// purpose (it swaps the source and restores it byte for byte): the probe's checks and the oracle must each reject it.
// --replay=<report.json> judges a report that was recorded before, a hosted run's artifact say: the probe's own checks run over
// the recorded readings in Godot, without the application, and the oracle recomputes the rest.
const replayArgument = process.argv.find(argument => argument.startsWith("--replay="));
const sabotageArgument = process.argv.find(argument => argument === "--sabotage" || argument.startsWith("--sabotage="));
const sabotageNames = ["leaky-panel", "no-gc", "world-leak", "no-key"];
const sabotage = sabotageArgument === undefined ? null : (sabotageArgument.split("=")[1] ?? sabotageNames[0]);
assert.ok(sabotage === null || sabotageNames.includes(sabotage), "Unknown sabotage: " + sabotage);
const lane = sabotage === null ? "current" : `sabotage-${sabotage}`;
const PROCESSES = 2;
const digest = value => createHash("sha256").update(value).digest("hex");
const sorted = values => [...values].sort();
const reportFile = process => `build/frontier-baseline-${lane}${process > 1 ? `-${process}` : ""}-report.json`;

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

async function runProbe(binary, bundle, number) {
  await rm(path.join(root, "build/frontier-baseline-report.json"), {force: true});
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/frontier-baseline-probe.gd", "--",
    ...(sabotage === null ? [] : ["--sabotage"])], {encoding: "utf8", timeout: 900000, maxBuffer: 64 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/frontier-baseline-${lane}${number > 1 ? `-${number}` : ""}.log`), log);
  const report = await optionalJson("build/frontier-baseline-report.json");
  if (report != null) {
    const pinned = JSON.parse(await readFile(path.join(root, "dependencies.json"), "utf8"));
    report.provenance = {node: process.version, process: number, bundle, pinned: {godot: pinned.godot.version, hermes: pinned.hermes.version,
      reactNative: pinned["react-native"].version},
    nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, reportFile(number)), JSON.stringify(report, null, 2) + "\n");
  }
  return {result, log, report};
}

// The oracle must reject a report on its own derivations, even with every probe check marked as passed.
function oracleRejection(report) {
  try {
    verifyFrontierBaselineReport({...report, checks: report.checks.map(row => ({...row, passed: true}))});
  } catch (error) {
    return String(error.message).split("\n")[0];
  }
  return null;
}

// The probe's own checks over a recorded report, in Godot and without the application.
function replayChecks(binary, file) {
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/frontier-baseline-probe.gd", "--",
    `--replay=${path.resolve(file)}`], {encoding: "utf8", timeout: 180000, maxBuffer: 64 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  assert.equal(result.error, undefined, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  const verdicts = log.match(/^FRONTIER_BASELINE_REPLAY_CHECKS: (.*)$/m);
  return {status: result.status, log, checks: verdicts === null ? null : JSON.parse(verdicts[1])};
}

async function replay(file) {
  const report = JSON.parse(await readFile(file, "utf8"));
  const replayed = replayChecks(await ensureGodotBinary(), file);
  assert.equal(replayed.status, 0, replayed.log);
  assert.match(replayed.log, /FRONTIER_BASELINE_REPLAY: \d+ checks, 0 failed/, replayed.log);
  console.log(`${path.basename(file)}: ${replayed.log.match(/FRONTIER_BASELINE_REPLAY: .*/)[0]}; the oracle accepts it`);
  console.log(JSON.stringify(verifyFrontierBaselineReport(report).heap, null, 2));
}

// The report with one reading altered, to show that the probe's checks and the oracle each reject the change.
async function mutated(report, name, change) {
  const copy = structuredClone(report);
  change(copy.stages);
  const file = path.join(root, `build/frontier-baseline-${lane}-${name}-report.json`);
  await writeFile(file, JSON.stringify(copy));
  return {copy, file};
}

// What a swap leaves, exactly: the same in every process, whatever the pace of the machine.
const exactRows = report => report.stages.swaps.map(swap => [swap.round, swap.step, swap.from, swap.to, swap.treeNodes, swap.surface.nativeTags,
  swap.surface.creates, swap.surface.deletes, swap.host.creates, swap.host.deletes, swap.after.performance.counters.nativeViews,
  swap.after.performance.counters.creates, swap.after.performance.counters.deletes, swap.after.godot.nodes, swap.after.godot.orphans, swap.rn.changes, swap.worldEvents]);

test("The HUD's panels swap by a real click with exact counts of nodes, creations and deletions, and the host returns to the base", async () => {
  if (replayArgument !== undefined) {
    await replay(replayArgument.slice("--replay=".length));
    return;
  }
  const bundle = await bundleFrontierBaselineProbe();
  const binary = await ensureGodotBinary();
  const runs = [];
  for (let number = 1; number <= (sabotage === null ? PROCESSES : 1); ++number) {
    runs.push(await runProbe(binary, bundle, number));
  }
  for (const {result, log, report} of runs) {
    // Artifacts are saved before assertions.
    assert.equal(result.error, undefined, log);
    assert.equal(result.signal, null, log);
    assert.equal(result.status, 0, log);
    assert.ok(report != null, log);
    assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
    assert.equal(report.scenario, "frontier-baseline");
    assert.equal(report.reactNative, "0.87.1");
    assert.equal(report.displayServer, "headless");
    assert.equal(report.sabotage, sabotage !== null);
    assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
    const failures = report.checks.filter(row => !row.passed).map(row => row.name);
    const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
    assert.deepEqual(sorted(checkErrors), sorted(failures));
    // Every ERROR line is a failed check: no native, script or engine error hides.
    assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length, "No native diagnostic, script or engine error is hidden");
    if (sabotage !== null) {
      assert.ok(failures.length > 0, "The probe's checks reject the sabotaged source");
      assert.match(log, new RegExp(`FRONTIER_BASELINE_SABOTAGE_REJECTED: ${failures.length}`));
    } else {
      assert.deepEqual(failures, []);
      assert.equal(report.allCurrentAssertionsPassed, true);
      assert.match(log, /FRONTIER_BASELINE_PASSED: \d+/);
    }
  }
  const [{report}] = runs;
  for (const file of frontierBaselineSources) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  for (const file of ["Libraries/Components/View/View.js", "React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm",
    "ReactCommon/react/nativemodule/webperformance/NativePerformance.cpp", "ReactCommon/react/renderer/telemetry/TransactionTelemetry.cpp"]) {
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  }
  if (sabotage !== null) {
    // The oracle rejects the sabotaged report on its own derivations. The verdict is written for the script that ran the variant, which
    // counts a missing verdict as a variant that was not rejected.
    const rejection = oracleRejection(report);
    const failures = report.checks.filter(row => !row.passed).map(row => row.name);
    await writeFile(path.join(root, `build/frontier-baseline-sabotage-${sabotage}-verdict.json`),
      JSON.stringify({sabotage, probeFailures: failures, oracleRejection: rejection}, null, 2) + "\n");
    assert.ok(rejection != null, "The oracle rejects the sabotaged report");
    return;
  }
  const {pinned} = report.provenance;
  assert.ok(report.stages.provenance.godot.startsWith(pinned.godot), "The engine is the pinned Godot");
  assert.equal(report.stages.provenance.hermes, pinned.hermes, "and the runtime is the pinned Hermes");
  const stats = runs.map(({report: each}) => verifyFrontierBaselineReport(each));
  // The exact invariants are the same in the two processes, swap by swap, and so are the checks.
  assert.deepEqual(exactRows(runs[1].report), exactRows(report), "The exact counts of every swap are the same in both processes");
  assert.deepEqual(runs[1].report.checks.map(row => row.name), report.checks.map(row => row.name));
  console.log(`Baseline by ordered pair of panels (process 1, ${ROUNDS} steady swaps each, milliseconds):\n${JSON.stringify(
    Object.fromEntries(Object.entries(stats[0].perPair).map(([pair, row]) => [pair, {flushMs: row.flushMs.p50, swapFrameMs: row.swapFrameMs.p50, pumpMs: row.pumpMs.p50,
      mountMs: row.mountMs.p50, jsMs: row.jsMs.p50, heapOverBaseBytes: row.heapOverBaseBytes.p50}])), null, 2)}`);
  // Judging the recorded report again, as --replay judges one from anywhere else, gives the verdicts of the run.
  const replayed = replayChecks(binary, path.join(root, reportFile(1)));
  assert.equal(replayed.status, 0, replayed.log);
  assert.deepEqual(replayed.checks, report.checks.filter(row => !row.name.startsWith("report/")), "Replaying the recorded report gives the verdicts of the run");
  // The same breakages that the retained sabotages make in the source, made in the recorded readings: the probe's checks and the oracle
  // each reject them, with nothing to rebuild.
  const negatives = {};
  const heapAtRest = (stages, round, rise) => {
    stages.rests[round].reading.performance.hermes.heap.hermes_allocatedBytes += rise;
  };
  const lastWindow = Array.from({length: HEAP_WINDOW_ROUNDS}, (_, index) => WARMUP_ROUNDS + ROUNDS - 1 - index);
  const index = TOUR.length * 2;
  const rejected = {
    "leaked-node": stages => {
      stages.swaps[index].after.godot.nodes += 1;
      stages.swaps[index].after.godot.nodeMonitor += 1;
    },
    "wrong-deletes": stages => {
      stages.swaps[index].surface.deletes += 10;
    },
    "double-press": stages => {
      stages.swaps[index].rn.presses[stages.swaps[index].to] = 2;
    },
    "world-heard": stages => {
      stages.swaps[index].worldEvents = 3;
    },
    "late-panel": stages => {
      stages.swaps[index].snapshotComplete = false;
    },
    "no-collection": stages => {
      stages.rests[5].reading.performance.hermes.collectedBeforeReading = false;
    },
    "heap-grew": stages => lastWindow.forEach(round => heapAtRest(stages, round, 3000)),
    aborted: stages => {
      stages.aborted = {round: 3, step: 4, from: "empty", to: "city"};
    },
  };
  const expected = {
    "leaked-node": ["swap/Every swap leaves the SceneTree with the base's nodes plus the new panel's, and Godot counts no orphan beyond the base's"],
    "wrong-deletes": ["swap/Every swap creates the nodes of the new panel and deletes those of the old one, in the host's counters and in the Surface's"],
    "double-press": ["swap/Every click swaps exactly once: one press on the button, one change of state, the new panel shown"],
    "world-heard": ["swap/No click of a swap reaches the Godot world"],
    "late-panel": ["swap/When the tree holds the new panel, the Surface's snapshot holds its last node and the root of no other panel"],
    "no-collection": ["section/Every reading of Hermes' heap follows a forced collection, so that two readings are comparable"],
    "heap-grew": ["heap/The live heap at rest of the last 5 steady rounds is within 2048 bytes of the first 5's"],
    aborted: ["swap/Every click shows its panel: the tree holds the nodes of the new panel within a bound of frames after the flush"],
  };
  for (const [name, change] of Object.entries(rejected)) {
    const broken = await mutated(report, name, change);
    const judged = replayChecks(binary, broken.file);
    assert.equal(judged.status, 1, judged.log);
    assert.equal(judged.checks.length, replayed.checks.length, `${name}: the replay loses no check`);
    negatives[name] = {failedChecks: judged.checks.filter(row => !row.passed).map(row => row.name), oracle: oracleRejection(broken.copy)};
    assert.deepEqual(negatives[name].failedChecks, expected[name], `${name}: fails the check that bounds it, and only that one`);
    assert.ok(negatives[name].oracle != null, `${name}: the oracle rejects it`);
  }
  // A transient allocation in a reading, which only adds and returns, is not growth: one reading 2056 bytes up, even the last one, passes.
  // The limit is inclusive: a whole window 2048 bytes up passes the probe's check and the oracle's.
  const allowed = {
    "heap-blip": stages => heapAtRest(stages, WARMUP_ROUNDS + ROUNDS - 1, 2056),
    "heap-at-limit": stages => lastWindow.forEach(round => heapAtRest(stages, round, 2048)),
  };
  for (const [name, change] of Object.entries(allowed)) {
    const accepted = await mutated(report, name, change);
    const judged = replayChecks(binary, accepted.file);
    assert.equal(judged.status, 0, `${name}: ${judged.log}`);
    assert.equal(oracleRejection(accepted.copy), null, `${name}: the oracle accepts it`);
  }
  // A recorded report with a section emptied or malformed is incomplete: the replay says so with status 2 and does not abort on what it lacks.
  const damaged = {
    "config-null": stages => { stages.config = null; },
    "base-hollow": stages => { stages.base = {}; },
    "base-without-surface": stages => { delete stages.base.surface; },
    "swaps-null": stages => { stages.swaps = null; },
    "swap-without-after": stages => { delete stages.swaps[7].after; },
    "swap-reading-without-godot": stages => { delete stages.swaps[9].after.godot; },
    "swap-without-rn": stages => { delete stages.swaps[3].rn; },
    "rests-not-a-list": stages => { stages.rests = {}; },
    "rest-without-reading": stages => { delete stages.rests[4].reading; },
    "final-missing": stages => { delete stages.final; },
    "aborted-missing": stages => { delete stages.aborted; },
  };
  for (const [name, change] of Object.entries(damaged)) {
    const broken = await mutated(report, `incomplete-${name}`, change);
    const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/frontier-baseline-probe.gd", "--",
      `--replay=${path.resolve(broken.file)}`], {encoding: "utf8", timeout: 180000, maxBuffer: 64 * 1024 * 1024});
    const output = (result.stdout ?? "") + (result.stderr ?? "");
    assert.equal(result.status, 2, `${name}: ${output}`);
    assert.match(output, /FRONTIER_BASELINE_REPLAY_INCOMPLETE/, name);
    assert.doesNotMatch(output, /SCRIPT ERROR|Invalid access|Program crashed/, name);
  }
  const sabotages = {};
  for (const name of sabotageNames) {
    sabotages[name] = await optionalJson(`build/frontier-baseline-sabotage-${name}-verdict.json`);
  }
  await writeFile(path.join(root, "build/frontier-baseline-comparison.json"), JSON.stringify({scenario: report.scenario,
    previousHostControl: "not applicable: the slice changes no C++", processes: runs.length, sameExactRowsInEveryProcess: true,
    sabotages, intentionalNativeProducerDifferences: [], nativeProducersPinned: frontierBaselineNativeProducers, reportLevelNegatives: negatives,
    oracle: stats[0], oracleSecondProcess: {heap: stats[1].heap, hostWindow: stats[1].hostWindow, memory: stats[1].memory},
    current: {checks: report.checks.length, nativeHostSha256: report.provenance.nativeHostSha256, bundleSha256: bundle.bundle.sha256}},
  null, 2) + "\n");
});
