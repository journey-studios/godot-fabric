import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleFrontierSoakProbe, frontierSoakNativeProducers, frontierSoakSources} from "../scripts/frontier-soak-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {EXECUTIONS, PAUSE_TURN, RSS_GROWTH_LIMIT_KB, TURNS, WARMUP_TURNS} from "./frontier-soak-cases.mjs";
import {gameOf, verifyFrontierSoakReport, verifyFrontierSoakRuns, verifySameGame} from "./frontier-soak-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// The 100-turn soak of the Frontier game, headless: the probe runs in one Godot process for each execution of the cases (three, with the heavy panel
// closed by unmounting in the first and the third and by hiding in the second), each plays 100 turns and holds the exact invariants, then the oracle
// judges each raw report and the three together (the same game, byte for byte). The slice changes no C++, so there is no preceding host to run it on.
// --sabotage=<listener-leak|nondeterministic-player|pause-kills-ui|leaky-hide> runs the probe on a source that scripts/frontier-soak-sabotage.mjs broke
// on purpose (it swaps the source and restores it byte for byte): the probe's checks and the oracle must reject it, each for the reason it was broken.
const sabotageArgument = process.argv.find(argument => argument === "--sabotage" || argument.startsWith("--sabotage="));
// What each variant needs: the strategy of its processes and how many it takes (a player that decides by the clock is told only by two games).
const variants = {
  "listener-leak": {strategies: ["unmount"]},
  "nondeterministic-player": {strategies: ["unmount", "unmount"]},
  "pause-kills-ui": {strategies: ["unmount"]},
  "leaky-hide": {strategies: ["hide"]},
};
const sabotageNames = Object.keys(variants);
const sabotage = sabotageArgument === undefined ? null : (sabotageArgument.split("=")[1] ?? sabotageNames[0]);
assert.ok(sabotage === null || sabotageNames.includes(sabotage), "Unknown sabotage: " + sabotage);
const lane = sabotage === null ? "current" : `sabotage-${sabotage}`;
const strategies = sabotage === null ? EXECUTIONS : variants[sabotage].strategies;
const digest = value => createHash("sha256").update(value).digest("hex");
const sorted = values => [...values].sort();
const reportFile = number => `build/frontier-soak-${lane}-${number}-report.json`;

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

async function runProbe(binary, bundle, number, strategy) {
  await rm(path.join(root, "build/frontier-soak-report.json"), {force: true});
  const started = Date.now();
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/frontier-soak-probe.gd", "--", `--strategy=${strategy}`,
    ...(sabotage === null ? [] : ["--sabotage"])], {encoding: "utf8", timeout: 1200000, maxBuffer: 64 * 1024 * 1024});
  const seconds = (Date.now() - started) / 1000;
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/frontier-soak-${lane}-${number}.log`), log);
  const report = await optionalJson("build/frontier-soak-report.json");
  if (report != null) {
    const pinned = JSON.parse(await readFile(path.join(root, "dependencies.json"), "utf8"));
    report.provenance = {node: process.version, process: number, strategy, seconds, bundle, pinned: {godot: pinned.godot.version, hermes: pinned.hermes.version,
      reactNative: pinned["react-native"].version},
    nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, reportFile(number)), JSON.stringify(report) + "\n");
  }
  return {result, log, report, seconds};
}

// The oracle must reject a report on its own derivations, even with every probe check marked as passed.
function oracleRejection(report) {
  try {
    verifyFrontierSoakReport({...report, checks: report.checks.map(row => ({...row, passed: true}))});
  } catch (error) {
    return String(error.message).split("\n")[0];
  }
  return null;
}

const failedChecks = report => report.checks.filter(row => !row.passed).map(row => row.name);

test("The soak plays 100 turns three times with the same game, steady nodes, heap and memory, no unhandled error, a pause that keeps the HUD alive, and the numbers of mounting against hiding", async () => {
  const bundle = await bundleFrontierSoakProbe();
  const binary = await ensureGodotBinary();
  const runs = [];
  for (const [index, strategy] of strategies.entries()) {
    runs.push(await runProbe(binary, bundle, index + 1, strategy));
  }
  for (const {result, log, report} of runs) {
    // Artifacts are saved before assertions.
    assert.equal(result.error, undefined, log);
    assert.equal(result.signal, null, log);
    assert.equal(result.status, 0, log);
    assert.ok(report != null, log);
    assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
    assert.equal(report.scenario, "frontier-soak");
    assert.equal(report.reactNative, "0.87.1");
    assert.equal(report.displayServer, "headless");
    assert.equal(report.sabotage, sabotage !== null);
    assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
    const failures = failedChecks(report);
    const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
    assert.deepEqual(sorted(checkErrors), sorted(failures));
    // Every ERROR line is a failed check: no native, script or engine error hides.
    assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length, "No native diagnostic, script or engine error is hidden");
    if (sabotage === null) {
      assert.deepEqual(failures, []);
      assert.equal(report.allCurrentAssertionsPassed, true);
      assert.match(log, /FRONTIER_SOAK_PASSED: \d+/);
    } else if (failures.length > 0) {
      assert.match(log, new RegExp(`FRONTIER_SOAK_SABOTAGE_REJECTED: ${failures.length}`));
    }
  }
  for (const file of frontierSoakSources) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  for (const file of ["Libraries/Components/View/View.js", "Libraries/TurboModule/TurboModuleRegistry.js",
    "React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm"]) {
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  }
  if (sabotage !== null) {
    // The oracle rejects the sabotaged runs on its own derivations: each report on its own and, where a run alone cannot tell, the runs together.
    // The verdict is written for the script that ran the variant, which counts a missing verdict as a variant that was not rejected.
    const rejections = runs.map(({report}) => oracleRejection(report));
    let together = null;
    if (runs.length > 1) {
      try {
        verifySameGame(runs.map(({report}) => gameOf(report)));
      } catch (error) {
        together = String(error.message).split("\n")[0];
      }
    }
    const oracle = together ?? rejections.find(rejection => rejection !== null) ?? null;
    await writeFile(path.join(root, `build/frontier-soak-sabotage-${sabotage}-verdict.json`),
      JSON.stringify({sabotage, probeFailures: runs.flatMap(({report}) => failedChecks(report)), oracleRejection: oracle, runs: runs.length}, null, 2) + "\n");
    assert.ok(oracle != null, "The oracle rejects the sabotaged runs");
    return;
  }
  const [{report}] = runs;
  const {pinned} = report.provenance;
  for (const {report: each} of runs) {
    assert.ok(each.stages.provenance.godot.startsWith(pinned.godot), "The engine is the pinned Godot");
    assert.equal(each.stages.provenance.hermes, pinned.hermes, "and the runtime is the pinned Hermes");
  }
  const summaries = runs.map(({report: each}) => verifyFrontierSoakReport(each));
  const together = verifyFrontierSoakRuns(summaries);
  console.log(`The game after ${TURNS} turns, in ${summaries.length} executions (${summaries.map(summary => summary.strategy).join(", ")}): final hash ${together.finalHash}, trail hash ${together.trailHash}`);
  console.log(`Seconds per execution: ${runs.map(run => round(run.seconds)).join(", ")}`);
  console.log(`Heap at rest, first and last half median (bytes): ${summaries.map(summary => `${summary.memory.heap.firstMedian}/${summary.memory.heap.lastMedian}`).join(", ")}`);
  console.log(`Resident memory, first and last half median (KB): ${summaries.map(summary => `${summary.memory.rss.firstMedianKb}/${summary.memory.rss.lastMedianKb} (band ${summary.memory.rss.bandKb})`).join(", ")}`);
  console.log(JSON.stringify(together.decision, null, 2));
  // The same breakages that the retained sabotages make in the source, and others, made in the recorded readings: the oracle rejects each, for the
  // reason it is written for, with nothing to rebuild. They are made on the first execution (unmounting) unless the change is the hiding strategy's.
  const negatives = {};
  const mutate = (source, change) => {
    const copy = structuredClone(source);
    change(copy.stages);
    return copy;
  };
  const unmounted = runs[0].report;
  const hidden = runs[1].report;
  // The first turn of the last half of the steady turns: the halves are the first floor(98 / 2) turns after the warm-up and the last as many.
  const lastHalfFrom = TURNS - Math.floor((TURNS - WARMUP_TURNS) / 2);
  // The heap and the resident memory at rest of every turn replaced by a series (flat in the first half, `rise` higher in the last), so that what the
  // check judges is the series and not this machine's own noise.
  const heapSeries = (stages, rise) => stages.turns.forEach((row, turn) => {
    row.rest.reading.performance.hermes.heap.hermes_allocatedBytes = 2_000_000 + (turn >= lastHalfFrom ? rise : 0);
  });
  const rssSeries = (stages, rise) => stages.turns.forEach((row, turn) => {
    row.rest.reading.godot.rssKb = 150_000 + (turn >= lastHalfFrom ? rise : 0);
  });
  const rejected = {
    "leaked-node": [unmounted, stages => { stages.turns[40].rest.reading.godot.nodes += 1; }, /SceneTree holds the host's native views plus the constant/],
    "orphan": [unmounted, stages => { stages.turns[40].contexts[0].orphans += 1; }, /no orphan beyond the base's/],
    "native-drift": [unmounted, stages => { stages.turns[40].contexts[1].native += 1; }, /the HUD holds the native views its state gives/],
    "hide-counted-unmounted": [hidden, stages => {
      for (const row of stages.turns) {
        row.panel.closed.reading.native -= 100;
        row.panel.closed.reading.nodes -= 100;
        row.panel.closed.reading.nodeMonitor -= 100;
      }
    }, /the HUD holds the native views its state gives/],
    "heap-grew": [unmounted, stages => heapSeries(stages, 3000), /live heap at rest rose/],
    "heap-one-over": [unmounted, stages => heapSeries(stages, 2049), /live heap at rest rose 2049 bytes/],
    "heap-leak": [unmounted, stages => stages.turns.forEach((row, turn) => { row.rest.reading.performance.hermes.heap.hermes_allocatedBytes += 200 * turn; }), /live heap at rest rose/],
    "rss-grew": [unmounted, stages => rssSeries(stages, RSS_GROWTH_LIMIT_KB + 4096), /resident memory rose/],
    "rss-one-over": [unmounted, stages => rssSeries(stages, RSS_GROWTH_LIMIT_KB + 1), new RegExp(`resident memory rose ${RSS_GROWTH_LIMIT_KB + 1} KB`)],
    // A leak of 1 MiB a turn: the medians of the halves lie 49 turns apart, so the rise is 49 MiB, over the limit of 48.
    "rss-ramp": [unmounted, stages => stages.turns.forEach((row, turn) => { row.rest.reading.godot.rssKb = 150_000 + 1024 * turn; }), /resident memory rose 50176 KB/],
    "refused-intent": [unmounted, stages => { Object.assign(stages.turns[10].decisions[0], {ok: 0, code: "turn_in_progress"}); }, /the game accepted/],
    "unhandled-rejection": [unmounted, stages => { stages.faults.rejections = 1; }, /no promise was rejected with no handler/],
    "blind-handler": [unmounted, stages => { stages.control.rejections = 0; }, /sees an unhandled rejection when there is one/],
    "subscription-leak": [unmounted, stages => stages.turns.slice(60).forEach(row => { row.rest.registry.subscriptions += 1; }), /same subscriptions at every reading/],
    "job-twice": [unmounted, stages => { stages.turns[20].job.rows.splice(7, 0, structuredClone(stages.turns[20].job.rows[6])); }, /seven snapshots and one turn_ended/],
    "phase-advanced-in-pause": [unmounted, stages => { stages.turns[PAUSE_TURN - 1].pause.during.phase = "ai_move"; }, /did not advance a phase/],
    "ui-dead-in-pause": [unmounted, stages => { stages.turns[PAUSE_TURN - 1].pause.ui.clicksAfterFirst = stages.turns[PAUSE_TURN - 1].pause.ui.clicksBefore; },
      /HUD answered while the game was paused/],
    "marker-never-shown": [unmounted, stages => { stages.turns[PAUSE_TURN - 1].pause.ui.markerShown = false; }, /React changed its state and the marker was a native node/],
    "pause-too-short": [unmounted, stages => { stages.turns[PAUSE_TURN - 1].pause.during.frames = 5; }, /for 60 frames/],
    "no-warm-up": [unmounted, stages => { stages.turns[WARMUP_TURNS - 1].warm = {markerShown: false, markerGone: false, clicks: 0}; }, /warmed up in a warm-up turn/],
    "closed-panel-claims": [unmounted, stages => { stages.turns[20].panel.closed.claim.presses = 0; }, /does not claim the map, however it was closed/],
    "open-panel-leaks-click": [hidden, stages => { stages.turns[20].panel.open.claim.presses = 1; }, /open panel claims the map/],
    "hash-forged": [unmounted, stages => { stages.turns[30].hash = "0".repeat(64); }, /SHA-256 of the canonical serialization/],
    "aborted": [unmounted, stages => { stages.aborted = {turn: 70, reason: "x"}; }, /nothing aborted it/],
    "hidden-panel-deletes": [hidden, stages => { stages.turns[5].panel.closed.click.host.deletes = 100; }, /creates and deletes no node/],
  };
  for (const [name, [source, change, expected]] of Object.entries(rejected)) {
    const broken = mutate(source, change);
    negatives[name] = oracleRejection(broken);
    assert.ok(negatives[name] !== null, `${name}: the oracle rejects it`);
    assert.match(negatives[name], expected, `${name}: for the reason it is written for`);
  }
  // Two executions that do not play the same game are told apart whatever else they are: the final hash, the trail, or only one turn's hash.
  const forks = {
    "final-hash-forked": summaries => { summaries[2].finalHash = "0".repeat(64); },
    "trail-forked": summaries => { summaries[1].trailHash = "0".repeat(64); },
    "turn-forked": summaries => { summaries[2].hashes[17] = "0".repeat(64); },
  };
  for (const [name, change] of Object.entries(forks)) {
    const copy = structuredClone(summaries);
    change(copy);
    assert.throws(() => verifySameGame(copy), /Execution \d: /, `${name}: the oracle rejects it`);
    negatives[name] = "rejected";
  }
  // The decision's numbers are checked too: a hidden panel that holds no more nodes than an unmounted one is not what the table says.
  const hollow = structuredClone(summaries);
  hollow[1].panel.nativeClosed -= 100;
  assert.throws(() => verifyFrontierSoakRuns(hollow), /A hidden panel holds 100 native nodes more than an unmounted one/);
  negatives["hidden-holds-no-nodes"] = "rejected";
  // What is not a leak is not rejected: a transient allocation in the last reading, a rise of exactly the limit, a resident memory that falls and one
  // that rises by exactly its limit. The limit is inclusive.
  const allowed = {
    "heap-blip": stages => {
      heapSeries(stages, 0);
      stages.turns.at(-1).rest.reading.performance.hermes.heap.hermes_allocatedBytes += 2056;
    },
    "heap-at-limit": stages => heapSeries(stages, 2048),
    "rss-falls": stages => rssSeries(stages, -30 * 1024),
    "rss-rises-30-mib": stages => rssSeries(stages, 30 * 1024),
    "rss-at-limit": stages => rssSeries(stages, RSS_GROWTH_LIMIT_KB),
  };
  for (const [name, change] of Object.entries(allowed)) {
    assert.equal(oracleRejection(mutate(unmounted, change)), null, `${name}: the oracle accepts it`);
  }
  await writeFile(path.join(root, "build/frontier-soak-comparison.json"), JSON.stringify({scenario: report.scenario,
    previousHostControl: "not applicable: the slice changes no C++", executions: runs.map(run => ({strategy: run.report.provenance.strategy, seconds: round(run.seconds),
      checks: run.report.checks.length})),
    finalHash: together.finalHash, trailHash: together.trailHash, decision: together.decision, summaries: summaries.map(summary => ({...summary, hashes: undefined,
      panel: {...summary.panel, raw: undefined}})),
    sabotages: Object.fromEntries(await Promise.all(sabotageNames.map(async name => [name, await optionalJson(`build/frontier-soak-sabotage-${name}-verdict.json`)]))),
    intentionalNativeProducerDifferences: [], nativeProducersPinned: frontierSoakNativeProducers, reportLevelNegatives: negatives,
    current: {checks: report.checks.length, nativeHostSha256: report.provenance.nativeHostSha256, bundleSha256: bundle.bundle.sha256}},
  null, 2) + "\n");
});

function round(value) {
  return Math.round(value * 10) / 10;
}
