import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {createTurnLane, loadAverage, machine, treeDigest} from "../scripts/frontier-turn-lane.mjs";
import {HEAP_STEADY_GROWTH_LIMIT_BYTES} from "./performance-cases.mjs";
import {FIRST_HALF_DIPS, HOSTED_HEAP_AT_REST, LEAK_BYTES_PER_ROUND, flatSeries, withLeak} from "./frontier-baseline-heap-series.mjs";
import {RSS_GROWTH_LIMIT_KB} from "./frontier-soak-cases.mjs";
import {CLICK_FRAME_LIMIT, STEADY_ROUNDS, STEPS, WARMUP_ROUNDS} from "./frontier-turn-cases.mjs";
import {judgeFrontierTurnReport, verifyFrontierTurnReport} from "./frontier-turn-oracle.mjs";
import {SABOTAGES} from "./frontier-turn-sabotages.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// The turn measured on the Frontier game as a consumer has it (V05-06, criterion `turno`), headless: the template is provisioned into a project of its own,
// its HUD built by the editor plugin, and the probe runs in it as the SceneTree script with the template's own main scene. The probe holds the exact
// invariants and writes the raw report; the independent oracle (tests/frontier-turn-oracle.mjs) judges it rule by rule. The slice changes no C++, so there
// is no preceding host to run it on.
// --sabotage=<skipped-phase|leaky-transition|click-misses-panel|heap-leak> runs the lane on a project or a probe that scripts/frontier-turn-sabotage.mjs broke
// on purpose: the probe's checks and the oracle must each reject it, the oracle for the rule the variant was written for.
// --replay=<report.json> judges a report that was recorded before, in the oracle alone and without a process of Godot.
const replayArgument = process.argv.find(argument => argument.startsWith("--replay="));
const sabotageArgument = process.argv.find(argument => argument === "--sabotage" || argument.startsWith("--sabotage="));
// What each variant breaks, where (the provisioned copy, the template staying as it is, or the probe) and the oracle rules that must reject it: the table of
// tests/frontier-turn-sabotages.mjs, which the lane and the script read too.
const sabotage = sabotageArgument === undefined ? null : (sabotageArgument.split("=")[1] ?? SABOTAGES[0].name);
const variant = sabotage === null ? null : SABOTAGES.find(entry => entry.name === sabotage);
assert.ok(sabotage === null || variant !== undefined, "Unknown sabotage: " + sabotage);
const lane = sabotage === null ? "current" : `sabotage-${sabotage}`;
const digest = value => createHash("sha256").update(value).digest("hex");
const sorted = values => [...values].sort();
// The provisioned addon's manifest without the hash of each source file it was packed from (the revision and the hashes of the native host and the lock stay).
const withoutFiles = ({sourceFiles: _sourceFiles, ...manifest}) => manifest;
const reportFile = `build/frontier-turn-${lane}-report.json`;

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

// The rules a report fails, with the oracle given every probe check as passed: it rejects a report on its own derivations.
const failedRules = report => judgeFrontierTurnReport({...report, checks: report.checks.map(row => ({...row, passed: true}))}).failures.map(failure => failure.rule);

// ----------------------------------------------------------------------------------------- changes to a recorded report
const restsOf = (stages, round) => [stages.rounds[round].start, ...stages.rounds[round].steps.map(record => record.rest)];
// The heap at rest of every series, round by round, replaced by a series of numbers (tests/frontier-baseline-heap-series.mjs): what the check judges is the
// series and not the noise of this machine's own.
const withHeap = (stages, series) => series.forEach((heap, round) => restsOf(stages, round).forEach(rest => {
  rest.reading.performance.hermes.heap.hermes_allocatedBytes = heap;
}));
// The resident memory of every series, round by round: a level and a rise every round from the first steady one.
const withRss = (stages, level, perRound) => stages.rounds.forEach((row, round) => restsOf(stages, round).forEach(rest => {
  rest.reading.godot.rssKb = level + perRound * Math.max(0, round - WARMUP_ROUNDS);
}));
const turnOf = (stages, round = 5, step = 12) => stages.rounds[round].steps[step];
const lastHalf = Math.floor(STEADY_ROUNDS / 2);
// A rise in the last half of the steady rounds, to show where the resident-memory limit is.
const withRssRise = (stages, rise) => stages.rounds.forEach((row, round) => restsOf(stages, round).forEach(rest => {
  rest.reading.godot.rssKb = 200000 + (round >= WARMUP_ROUNDS + STEADY_ROUNDS - lastHalf ? rise : 0);
}));

// What the oracle must reject, with the rules that must be the ones that fail (and only those), and what it must accept.
const REJECTED = {
  "leaked-node": [stages => {
    const {godot} = stages.rounds[6].steps[3].rest.reading;
    godot.nodes += 1;
    godot.nodeMonitor += 1;
  }, ["rests"]],
  "orphan": [stages => {
    stages.rounds[6].steps[3].rest.reading.godot.orphans = 1;
  }, ["rests"]],
  "native-drift": [stages => {
    stages.rounds[9].steps[8].rest.surface.nativeTags += 1;
  }, ["rests"]],
  "wrong-panels": [stages => {
    stages.rounds[9].steps[8].rest.panels = ["hud-bar"];
  }, ["rests"]],
  "slow-panel": [stages => {
    stages.rounds[9].steps[2].frames = CLICK_FRAME_LIMIT + 1;
  }, ["clicks"]],
  "double-call": [stages => {
    stages.rounds[9].steps[2].callbacks = {clear_selection: 2};
  }, ["clicks"]],
  "map-lost": [stages => {
    stages.rounds[9].steps[0].worldClicks = 0;
  }, ["clicks"]],
  "aborted": [stages => {
    stages.aborted = {round: 3, step: 4, id: STEPS[4].id};
  }, ["shape"]],
  "skipped-phase": [stages => {
    turnOf(stages).turn.frames.splice(3, 1);
  }, ["turns"]],
  "two-phases-in-a-frame": [stages => {
    const {frames} = turnOf(stages).turn;
    frames[2].phase = "growth";
  }, ["turns"]],
  "turn-ended-twice": [stages => {
    turnOf(stages).turn.frames[2].turnEnded = 1;
  }, ["turns"]],
  "silent-frame": [stages => {
    turnOf(stages).turn.frames[4].snapshots = 0;
  }, ["turns"]],
  "no-collection": [stages => {
    stages.rounds[5].steps[4].rest.reading.performance.hermes.collectedBeforeReading = false;
  }, ["readings"]],
  "host-error": [stages => {
    stages.rounds[5].steps[4].rest.reading.host.errors = 1;
  }, ["readings"]],
  "heap-grew": [stages => withHeap(stages, flatSeries(3000, lastHalf)), ["heap"]],
  "heap-leak-hosted-1": [stages => withHeap(stages, withLeak(HOSTED_HEAP_AT_REST["process 1"], LEAK_BYTES_PER_ROUND)), ["heap"]],
  "heap-leak-hosted-2": [stages => withHeap(stages, withLeak(HOSTED_HEAP_AT_REST["process 2"], LEAK_BYTES_PER_ROUND)), ["heap"]],
  "heap-over-the-limit-by-one": [stages => withHeap(stages, flatSeries(HEAP_STEADY_GROWTH_LIMIT_BYTES + 1, lastHalf)), ["heap"]],
  "rss-over-the-limit-by-one": [stages => withRssRise(stages, RSS_GROWTH_LIMIT_KB + 1), ["rss"]],
  // The medians lie 15 rounds apart, so a ramp of 4 MiB a round adds 60 MiB between them; a finer one (3 MiB, below) belongs to the heap rule.
  "rss-ramp": [stages => withRss(stages, 200000, 4 * 1024), ["rss"]],
  "unhandled-rejection": [stages => {
    stages.faults.rejections = 1;
  }, ["errors"]],
  "blind-tracker": [stages => {
    stages.control.rejections = 0;
  }, ["errors"]],
};
const ACCEPTED = {
  "heap-blip": stages => withHeap(stages, flatSeries(2056, 1)),
  "heap-at-limit": stages => withHeap(stages, flatSeries(HEAP_STEADY_GROWTH_LIMIT_BYTES, lastHalf)),
  "heap-hosted-1": stages => withHeap(stages, HOSTED_HEAP_AT_REST["process 1"]),
  "heap-hosted-2": stages => withHeap(stages, HOSTED_HEAP_AT_REST["process 2"]),
  "heap-first-half-dips": stages => withHeap(stages, FIRST_HALF_DIPS),
  "rss-at-limit": stages => withRssRise(stages, RSS_GROWTH_LIMIT_KB),
  "rss-falls-30-mib": stages => withRssRise(stages, -30 * 1024),
  "rss-rises-30-mib": stages => withRssRise(stages, 30 * 1024),
  "rss-ramp-3-mib": stages => withRss(stages, 200000, 3 * 1024),
};

// The changes made to a recorded report: each one the oracle must reject for its rule alone, and the ones it must accept.
function reportLevelNegatives(report) {
  const negatives = {};
  for (const [name, [change, rules]] of Object.entries(REJECTED)) {
    const broken = structuredClone(report);
    change(broken.stages);
    negatives[name] = failedRules(broken);
    assert.deepEqual(negatives[name], rules, `${name}: fails the rule that bounds it, and only that one`);
  }
  for (const [name, change] of Object.entries(ACCEPTED)) {
    const accepted = structuredClone(report);
    change(accepted.stages);
    assert.deepEqual(failedRules(accepted), [], `${name}: the oracle accepts it`);
  }
  return {rejected: negatives, accepted: Object.keys(ACCEPTED)};
}

function printTables(summary) {
  const lines = (entries, columns) => entries.map(([key, value]) => `  ${key.padEnd(22)}${columns(value).join(" / ")}`).join("\n");
  console.log(`Click to panels by step (${summary.rounds.warmup} warm-up rounds left out, ${summary.rounds.steady} steady; frames p50 / p95 / max, then milliseconds p50 / p95 / max):\n${lines(
    Object.entries(summary.clickToPanel.byStep), row => [row.frames.p50, row.frames.p95, row.frames.max, row.latencyMs.p50, row.latencyMs.p95, row.latencyMs.max])}`);
  console.log(`The frames of a turn, by the phase the game was at (interval between frames in milliseconds p50 / p95 / max):\n${lines(
    summary.turn.byPhase.map(row => [row.phase, row]), row => [row.intervalMs.p50, row.intervalMs.p95, row.intervalMs.max])}`);
  console.log(`Native views and SceneTree nodes by context:\n${lines(Object.entries(summary.nativeNodes.native), row => [row.nativeViews, row.sceneTreeNodes])}`);
}

test("the Frontier game's clicks show their panels, the turn runs one phase a frame, and nodes, heap and memory hold, on the provisioned consumer", async () => {
  if (replayArgument !== undefined) {
    const file = replayArgument.slice("--replay=".length);
    const report = JSON.parse(await readFile(file, "utf8"));
    const summary = verifyFrontierTurnReport(report);
    const negatives = reportLevelNegatives(report);
    printTables(summary);
    console.log(`${path.basename(file)}: the oracle accepts it, rejects ${Object.keys(negatives.rejected).length} changes for their rules and accepts ${negatives.accepted.length} others`);
    return;
  }
  const provision = await createTurnLane({name: sabotage === null ? "frontier-turn" : `frontier-turn-sabotage-${sabotage}`,
    sabotage: variant?.target === "copy" ? sabotage : null});
  let prepared;
  let run;
  const templateBefore = await treeDigest(path.join(root, "consumers", "civ-lite"));
  try {
    prepared = await provision.prepare();
    run = await provision.launch({label: "headless", lane: "headless", extra: sabotage === null ? [] : ["--sabotage"]});
  } finally {
    await provision.cleanup();
  }
  const {result, log, report, load} = run;
  const templateAfter = await treeDigest(path.join(root, "consumers", "civ-lite"));
  // Artifacts are saved before assertions.
  if (report != null) {
    const pinned = JSON.parse(await readFile(path.join(root, "dependencies.json"), "utf8"));
    report.provenance = {node: process.version, machine: machine(), load, loadAverageNow: loadAverage(), pinned: {godot: pinned.godot.version, hermes: pinned.hermes.version,
      reactNative: pinned["react-native"].version}, template: {name: "civ-lite", sha256: templateAfter}, project: withoutFiles(prepared.manifest), bundleSha256: prepared.bundleSha256,
    probeSha256: prepared.probeSha256, nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), sabotage,
    sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, reportFile), JSON.stringify(report) + "\n");
  }
  await writeFile(path.join(root, `build/frontier-turn-${lane}.log`), log);
  assert.equal(templateAfter, templateBefore, "The template is the same tree before and after: only the provisioned copy is ever changed");
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.equal(result.status, 0, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.equal(report.scenario, "frontier-turn");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.sabotage, sabotage !== null);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  // Every ERROR line is a failed check: no native, script or engine error hides. A sabotage may fail the checks, but never the engine.
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length, "No native diagnostic, script or engine error is hidden");
  if (sabotage !== null) {
    assert.ok(failures.length > 0, "The probe's checks reject the broken lane");
    assert.match(log, new RegExp(`FRONTIER_TURN_SABOTAGE_REJECTED: ${failures.length}`));
    // The oracle rejects the report on its own derivations. The verdict is written for the script that ran the variant, which counts a missing verdict
    // as a variant that was not rejected.
    const oracle = failedRules(report);
    await writeFile(path.join(root, `build/frontier-turn-sabotage-${sabotage}-verdict.json`), JSON.stringify({sabotage, probeFailures: failures, oracleRules: oracle,
      expectedRules: variant.rules, templateUnchanged: templateAfter === templateBefore}, null, 2) + "\n");
    for (const rule of variant.rules) {
      assert.ok(oracle.includes(rule), `The oracle rejects the broken lane for the rule ${rule} (it failed ${oracle.join(", ") || "none"})`);
    }
    return;
  }
  assert.deepEqual(failures, []);
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.match(log, /FRONTIER_TURN_PASSED: \d+/);
  assert.doesNotMatch(log, /FABRIC_ERROR/);
  const {pinned} = report.provenance;
  assert.ok(report.stages.provenance.godot.startsWith(pinned.godot), "The engine is the pinned Godot");
  assert.equal(report.stages.provenance.hermes, pinned.hermes, "and the runtime is the pinned Hermes");
  const summary = verifyFrontierTurnReport(report);
  const negatives = reportLevelNegatives(report);
  printTables(summary);
  const sabotages = {};
  for (const {name} of SABOTAGES) {
    sabotages[name] = await optionalJson(`build/frontier-turn-sabotage-${name}-verdict.json`);
  }
  await writeFile(path.join(root, "build/frontier-turn-comparison.json"), JSON.stringify({scenario: report.scenario, previousHostControl: "not applicable: the slice changes no C++",
    sabotages, reportLevelNegatives: negatives, oracle: summary, current: {checks: report.checks.length, bundleSha256: prepared.bundleSha256, templateSha256: templateAfter,
      nativeHostSha256: report.provenance.nativeHostSha256, load}}, null, 2) + "\n");
});
