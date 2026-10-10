import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {budgetResult, decisionRuleOf} from "../scripts/frontier-comparison-decision.mjs";
import {DERIVED_OUTCOMES, READINGS, protocolErrors, proseRulesOf, rolesOf, slotsOf} from "../scripts/frontier-comparison-protocol.mjs";
import {REPORT_FORMAT, buildReport, serializeReport} from "../scripts/frontier-comparison-report.mjs";
import {bootstrapDifferences, claimPValue, contrastOf, idleReference, intervalOf, iqr, median, mulberry32} from "../scripts/frontier-comparison-statistics.mjs";
import {quartiles} from "./performance-oracle.mjs";
import {FRAMES, executionsOf, overLoaded, readProtocol, sha256, slotRecord as slotOf, syntheticCampaign} from "./frontier-comparison-synthetic.mjs";

// The analysis of the final comparison of the 0.5 Frontier (V05-10): scripts/frontier-comparison-analysis.mjs and the modules under it, written before the first comparative execution. This test
// runs no game and measures nothing: it analyses SYNTHETIC campaigns (tests/frontier-comparison-synthetic.mjs), whose numbers were made up, to prove that the script computes what
// docs/research/frontier-comparison-protocol.json says it computes: the statistics, the decision rule, the axes, the partial report, the budgets and the byte-for-byte reproducibility. No number
// here is a result of any arm. The statistics and the decision functions themselves are the ones the protocol's own test (tests/frontier-comparison-protocol.test.mjs) imports, with its fixed
// examples and its fixed interval. The validity of the executions is in tests/frontier-comparison-validity.test.mjs.
const root = fileURLToPath(new URL("../", import.meta.url));
const {protocol, protocolSha256} = readProtocol();
const SCRIPT = path.join(root, "scripts/frontier-comparison-analysis.mjs");
const CAMPAIGN_SHA256 = "0".repeat(64);

const analyze = (campaign, under = protocol, underSha256 = protocolSha256) => buildReport({campaign, protocol: under, protocolSha256: underSha256, campaignSha256: CAMPAIGN_SHA256});
const build = options => syntheticCampaign(protocol, protocolSha256, options);
const pairOf = (report, windowId, pairId) => report.sections.primary.windows.find(window => window.id === windowId).pairs.find(pair => pair.id === pairId);
const axisOf = (report, id) => report.sections.axes.verdicts.find(axis => axis.id === id);
const close = (actual, expected) => Math.abs(actual - expected) < 1e-9;
// [median, spread] of the per-run p95 of a window, by arm, in ms (the spread is the half-width of the draws).
const perArm = (a, b, c) => ({A: a, B: b, C: c});
const TIGHT = 0.05;
const {marginOf, verdictOf} = decisionRuleOf(protocol);

// ---- the protocol as the analysis reads it ----
test("the analysis reads the roles, the slots and the sentences of the protocol, and refuses a protocol it does not understand", () => {
  assert.deepEqual(protocolErrors(protocol), []);
  const roles = rolesOf(protocol);
  assert.deepEqual([roles.subject, roles.reference, roles.control, roles.decisionPair.id, roles.estimatePairs.map(pair => pair.id)], ["C", "B", "A", "C-B", ["C-A", "B-A"]]);
  assert.deepEqual(proseRulesOf(protocol), {maxAttempts: 3, drawn: {atLeast: 9, of: 10}, pacedFraction: 0.5});
  const slots = slotsOf(protocol);
  assert.equal(slots.length, protocol.runs.sequence.length * 3);
  assert.deepEqual(slots.slice(0, 6).map(slot => [slot.slot, slot.block, slot.position, slot.arm]), [[1, 0, 0, "A"], [2, 0, 1, "B"], [3, 0, 2, "C"], [4, 1, 0, "C"], [5, 1, 1, "A"], [6, 1, 2, "B"]]);
  // Every secondary outcome of the protocol is one the analysis knows how to observe, and nothing else is.
  assert.deepEqual(protocol.secondaryOutcomes.map(outcome => outcome.id).sort(), [...Object.keys(READINGS), ...Object.keys(DERIVED_OUTCOMES)].sort());

  // A sentence that an amendment rewrites is caught, because the code implements the old one.
  const reworded = structuredClone(protocol);
  reworded.runs.load.redo = reworded.runs.load.redo.replace("at most 3 attempts per slot", "at most three attempts per slot");
  assert.throws(() => proseRulesOf(reworded), /no longer says the attempts per slot/);
  assert.match(protocolErrors(reworded).join("\n"), /no longer says the attempts per slot/);
  const forgotten = structuredClone(protocol);
  forgotten.secondaryOutcomes.push({id: "new-outcome", label: "New", unit: "x", arms: ["A"], observation: "per execution", verdict: false});
  assert.deepEqual(protocolErrors(forgotten), ["secondary outcome new-outcome: the analysis does not know how it is observed"]);
  const upside = structuredClone(protocol);
  upside.primaryOutcome.orientation = "higherIsBetter";
  assert.match(protocolErrors(upside)[0], /not lowerIsBetter/);
});

// ---- the statistics ----
test("the median is the protocol's (the mean of the two middle values), not the nearest rank of the oracle, and the idle reference is the median of the half-sums", () => {
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(quartiles([4, 1, 3, 2]).median, 2, "the oracle's median is the nearest rank: the lower of the two middle values");
  assert.deepEqual([median([5, 1, 3, 2, 4]), iqr([5, 1, 3, 2, 4]), iqr(Array.from({length: 12}, (_, index) => index + 1))], [3, 2, 6]);
  // The idle window comes in two alternating groups, so its median is one group or the other and the median of the half-sums is the sum of the two over two.
  const groups = Array.from({length: 600}, (_, index) => (index % 2 === 0 ? 4000 : 12667));
  assert.equal(idleReference(groups), 8333.5);
  assert.equal(median(groups), 8333.5, "with an even count the protocol's median is the mean of the two middle values, one from each group");
  assert.equal(quartiles(groups).median, 4000);
  // A single stall moves only two of the half-sums.
  const stalled = [...groups];
  stalled[300] = 900000;
  assert.equal(idleReference(stalled), 8333.5);
  // Half-sums of consecutive pairs, i from 0 to n - 2: 599 of them for 600 frames.
  assert.equal(idleReference([10, 20, 30]), 15);
  assert.equal(idleReference([10, 20, 100]), 15, "the nearest rank of two half-sums (15 and 60) at 50% is the first");
});

test("the module reproduces the protocol's fixed interval and its known answer, with the parameters read from the protocol", () => {
  const interval = protocol.statistics.interval;
  const next = mulberry32(interval.prng.knownAnswer.seed);
  assert.deepEqual(interval.prng.knownAnswer.first.map(() => next()), interval.prng.knownAnswer.first);
  const minuend = [5.2, 5.0, 5.4, 5.1, 5.3, 5.6, 5.2, 5.5, 5.1, 5.4, 5.3, 5.2];
  const subtrahend = [4.1, 4.3, 4.0, 4.2, 4.4, 4.1, 4.5, 4.2, 4.0, 4.3, 4.2, 4.1];
  const contrast = contrastOf(minuend, subtrahend, interval);
  assert.deepEqual(contrast.interval.map(value => value.toFixed(6)), ["0.900000", "1.250000"], "the interval that the protocol's test pins");
  assert.ok(close(contrast.difference, median(minuend) - median(subtrahend)));
  assert.equal(contrast.differences.length, interval.resamples);
  assert.deepEqual(contrast.differences, bootstrapDifferences(minuend, subtrahend, interval));
  const sorted = [...contrast.differences].sort((a, b) => a - b);
  assert.deepEqual(contrast.interval, [sorted[249], sorted[9749]], "the ranks 250 and 9750 of the 10,000 sorted differences");
  assert.deepEqual(intervalOf(contrast.differences, interval.level), contrast.interval);
});

// ---- the decision rule on a campaign ----
test("the four categories, the non-inferior flag beside them, and H1 and H2 as estimates with no category", () => {
  const windows = {
    "ai-phase": perArm([5, TIGHT], [8, TIGHT], [6, TIGHT]),
    "event-burst": perArm([5, TIGHT], [8, TIGHT], [8.05, TIGHT]),
    "context-switches": perArm([5, TIGHT], [8, TIGHT], [10, TIGHT]),
    stress: perArm([5, TIGHT], [8, 3], [8, 3])
  };
  const report = analyze(build({windows, lanes: ["presented"]}));
  assert.equal(report.status, "complete");
  const decisions = protocol.windows.map(({id}) => pairOf(report, id, "C-B"));
  assert.deepEqual(decisions.map(pair => pair.category), ["gain", "neutral", "cost", "inconclusive"]);
  assert.deepEqual(decisions.map(pair => pair.nonInferior), [true, true, false, decisions[3].interval[1] <= decisions[3].margin.value]);
  assert.ok((decisions[3].interval[0] < -decisions[3].margin.value && decisions[3].interval[1] >= -decisions[3].margin.value) || (decisions[3].interval[0] <= decisions[3].margin.value && decisions[3].interval[1] > decisions[3].margin.value),
    "the interval of the inconclusive window crosses -margin or +margin");
  // The three that hold a claim stand in the Holm family of four, and nothing is downgraded.
  assert.deepEqual(decisions.map(pair => [pair.unadjustedCategory === pair.category, pair.downgraded, pair.holmStands]), [[true, false, true], [true, false, true], [true, false, true], [true, false, false]]);
  assert.ok(decisions[3].pValue > 0.1 && decisions.slice(0, 3).every(pair => pair.pValue < 0.001));
  // H1 and H2 report the difference and the interval, and take no category, no margin and no flag.
  for (const id of ["C-A", "B-A"]) {
    for (const {id: windowId} of protocol.windows) {
      const pair = pairOf(report, windowId, id);
      assert.deepEqual(Object.keys(pair), ["id", "hypothesis", "minuend", "subtrahend", "difference", "interval"], `${windowId} ${id}`);
    }
  }
  assert.deepEqual(pairOf(report, "ai-phase", "C-A").hypothesis, "H1");
  assert.deepEqual(pairOf(report, "ai-phase", "B-A").hypothesis, "H2");
  // The windows are side by side and never averaged: each has its own arms, interval and category.
  assert.deepEqual(report.sections.primary.windows.map(({id}) => id), protocol.windows.map(({id}) => id));
});

test("the margin is the larger of 10% of B's median and the floor of 0.5 ms: the same difference is a cost under the floor and neutral under 10%", () => {
  const windows = {
    "ai-phase": perArm([2, TIGHT], [3, TIGHT], [3.7, TIGHT]),
    "event-burst": perArm([5, TIGHT], [8, TIGHT], [8.7, TIGHT]),
    "context-switches": perArm([5, TIGHT], [8, TIGHT], [8, TIGHT]),
    stress: perArm([5, TIGHT], [8, TIGHT], [8, TIGHT])
  };
  const report = analyze(build({windows, lanes: ["presented"]}));
  const [low, high] = [pairOf(report, "ai-phase", "C-B"), pairOf(report, "event-burst", "C-B")];
  assert.ok(Math.abs(low.difference - 0.7) < 0.1 && Math.abs(high.difference - 0.7) < 0.1, "the same difference of 0.7 ms in both");
  assert.equal(low.margin.value, 0.5, "B's median is 3 ms: 10% is 0.3 ms and the floor wins");
  assert.ok(close(high.margin.value, 0.1 * high.margin.medianOfReference), "B's median is 8 ms: 10% is 0.8 ms and wins over the floor");
  assert.deepEqual([low.category, high.category], ["cost", "neutral"]);
  assert.deepEqual([low.margin.floor, low.margin.relative, low.margin.formula], [{value: 0.5, unit: "ms"}, 0.1, protocol.decisionRule.margin.formula]);
  // The function on its own, on the cases of the protocol's test and the boundary at 5 ms, where the two are equal.
  for (const [medianOfB, expected] of [[8, 0.8], [3, 0.5], [5, 0.5], [6, 0.6], [0, 0.5]]) {
    assert.ok(close(marginOf(medianOfB), expected), `B median ${medianOfB}`);
  }
});

test("a hand-checkable campaign: arms with no spread give point intervals and the differences of the medians", () => {
  const windows = Object.fromEntries(protocol.windows.map(({id}) => [id, perArm([5, 0], [8, 0], [6, 0])]));
  const report = analyze(build({windows, lanes: ["presented"]}));
  for (const {id} of protocol.windows) {
    const [ca, ba, cb] = ["C-A", "B-A", "C-B"].map(pairId => pairOf(report, id, pairId));
    assert.deepEqual([ca.difference, ca.interval, ba.difference, ba.interval, cb.difference, cb.interval], [1, [1, 1], 3, [3, 3], -2, [-2, -2]], id);
    assert.deepEqual([cb.margin.value, cb.category, cb.nonInferior, cb.pValue], [0.8, "gain", true, 1 / 10001]);
    const arms = report.sections.primary.windows.find(candidate => candidate.id === id).arms;
    assert.deepEqual([arms.A, arms.B, arms.C].map(arm => [arm.executions, arm.median, arm.iqr]), [[12, 5, 0], [12, 8, 0], [12, 6, 0]]);
  }
});

test("the report recomputes from its own per-run values: the intervals and the p-values are the bootstrap of the right arms in the right order", () => {
  const report = analyze(build({lanes: ["presented"]}));
  const interval = protocol.statistics.interval;
  for (const entry of report.sections.primary.windows) {
    for (const pair of protocol.statistics.pairs) {
      const reported = entry.pairs.find(candidate => candidate.id === pair.id);
      const minuend = entry.arms[pair.minuend].perRun;
      const subtrahend = entry.arms[pair.subtrahend].perRun;
      assert.equal(minuend.length, 12);
      const differences = bootstrapDifferences(minuend, subtrahend, interval);
      assert.deepEqual(reported.interval, intervalOf(differences, interval.level), `${entry.id} ${pair.id}`);
      assert.equal(reported.difference, median(minuend) - median(subtrahend));
      if (pair.id === "C-B") {
        assert.equal(reported.pValue, claimPValue(differences, reported.margin.value));
      }
    }
  }
});

test("the Holm guard downgrades a category whose claim does not stand in the family of four windows, and shows the unadjusted one beside it", () => {
  // A gain whose interval clears -margin but whose one-sided p-value (0.0157) is over alpha / 4 (0.00625), in a family of otherwise inconclusive windows.
  const wide = perArm([5, TIGHT], [8, 3], [8, 3]);
  const windows = {"ai-phase": perArm([5, TIGHT], [8, 0.6], [7, 0.6]), "event-burst": wide, "context-switches": wide, stress: wide};
  const report = analyze(build({windows, lanes: ["presented"]}));
  const marginal = pairOf(report, "ai-phase", "C-B");
  assert.deepEqual([marginal.unadjustedCategory, marginal.category, marginal.downgraded, marginal.holmStands], ["gain", "inconclusive", true, false]);
  assert.ok(marginal.pValue > protocol.statistics.multiplicity.alphaOneSided / 4 && marginal.pValue < protocol.statistics.multiplicity.alphaOneSided);
  assert.ok(marginal.interval[1] < -marginal.margin.value, "by its interval alone it is a gain");
  assert.equal(marginal.nonInferior, true, "the flag is the interval's and the guard does not touch it");
  for (const id of ["event-burst", "context-switches", "stress"]) {
    const pair = pairOf(report, id, "C-B");
    assert.deepEqual([pair.unadjustedCategory, pair.category, pair.downgraded], ["inconclusive", "inconclusive", false], "an inconclusive window stays inconclusive and is not downgraded");
  }
  // The same window, alone in a family whose other claims are strong, stands: the guard depends on the family.
  const strong = analyze(build({windows: {...windows, "event-burst": perArm([5, TIGHT], [8, TIGHT], [10, TIGHT]), "context-switches": perArm([5, TIGHT], [8, TIGHT], [10, TIGHT]), stress: perArm([5, TIGHT], [8, TIGHT], [10, TIGHT])}, lanes: ["presented"]}));
  assert.deepEqual([pairOf(strong, "ai-phase", "C-B").category, pairOf(strong, "ai-phase", "C-B").downgraded], ["gain", false]);
});

// ---- the axes ----
test("the axes: the verdict of C against B with the outcome's own margin, the deterministic package size and the single observation of the cost of change", () => {
  const campaign = build();
  for (const execution of executionsOf(campaign, "C")) {
    execution.readings.clickToPanelFrames = execution.readings.clickToPanelFrames.map(() => 5);
    execution.readings.rssMb.end = 450;
    execution.readings.timeToInteractiveHudMs = 300;
  }
  for (const execution of executionsOf(campaign, "C", "unlimited")) {
    for (const entry of protocol.windows) {
      execution.windows[entry.id].fps += 400;
    }
  }
  const report = analyze(campaign);
  assert.deepEqual(report.sections.axes.verdicts.map(axis => axis.id), protocol.secondaryOutcomes.filter(outcome => outcome.verdict).map(outcome => outcome.id));
  const click = axisOf(report, "click-to-panel");
  assert.deepEqual([click.arms.B.median, click.arms.C.median, click.margin.value, click.category, click.nonInferior], [3, 5, 1, "cost", false], "the floor of one frame beats 10% of 3");
  assert.deepEqual(click.margin.floor, {value: 1, unit: "frames"});
  assert.deepEqual([axisOf(report, "rss").category, axisOf(report, "rss").margin.floor], ["cost", null]);
  assert.equal(axisOf(report, "time-to-interactive-hud").category, "gain");
  // Package size: the default sizes (41 and 55 MB) give a cost; the two exports of an arm that differ make the axis inconclusive.
  const size = axisOf(report, "package-size");
  assert.deepEqual([size.kind, size.interval, size.category, size.nonInferior], ["deterministic", [14000000, 14000000], "cost", false]);
  const unequal = build();
  unequal.packages.C.exportBytes = [55000000, 55000001];
  assert.deepEqual([axisOf(analyze(unequal), "package-size").category, axisOf(analyze(unequal), "package-size").reason], ["inconclusive", "the two exports of an arm differ"]);
  // The cost of change: one observation per arm; the axis takes a category only when the four measures agree.
  const change = axisOf(report, "change-cost");
  assert.deepEqual(change.measures.map(measure => [measure.measure, measure.difference, measure.category]), [["files", 0, "neutral"], ["lines", -20, "gain"], ["timeMinutes", -5, "neutral"], ["tests", 0, "neutral"]]);
  assert.deepEqual([change.agree, change.category, change.kind, change.observationsPerArm], [false, "inconclusive", "single-observation", 1]);
  const allBetter = build();
  allBetter.changeCost.C = {files: 2, lines: 100, timeMinutes: 60, tests: 2};
  const agreed = axisOf(analyze(allBetter), "change-cost");
  assert.deepEqual([agreed.agree, agreed.category, agreed.measures.map(measure => measure.category)], [true, "gain", ["gain", "gain", "gain", "gain"]]);
  const withoutObservation = build();
  delete withoutObservation.changeCost;
  assert.deepEqual(axisOf(analyze(withoutObservation), "change-cost"), {id: "change-cost", label: axisOf(report, "change-cost").label, applicable: false, reason: "not-observed"});
  assert.deepEqual(analyze(withoutObservation).sections["cost-of-change"], {available: false, reason: "not-observed"});
  const observed = report.sections["cost-of-change"];
  assert.deepEqual([observed.observationsPerArm, observed.statisticalClaim, observed.observation.B, observed.observation.C], [1, false, campaign.changeCost.B, campaign.changeCost.C]);
});

test("FPS without a limit: higher is better, a gain excludes zero, and the axis is N/A when the vsync does not read DISABLED", () => {
  const campaign = build();
  for (const execution of executionsOf(campaign, "C", "unlimited")) {
    for (const entry of protocol.windows) {
      execution.windows[entry.id].fps += 400;
    }
  }
  const fps = axisOf(analyze(campaign), "fps-unlimited");
  assert.equal(fps.windows.length, 4);
  for (const entry of fps.windows) {
    assert.deepEqual([entry.category, entry.excludesZero, entry.orientation], ["gain", true, "higherIsBetter"], entry.window);
    assert.ok(entry.interval[0] > 0, "C is above B");
    assert.deepEqual(entry.orientedInterval, [-entry.interval[1], -entry.interval[0]]);
  }
  // C below B is a cost, and C within 10% of B is neutral whatever its sign.
  const slower = build();
  for (const execution of executionsOf(slower, "C", "unlimited")) {
    execution.windows["ai-phase"].fps -= 400;
  }
  assert.equal(axisOf(analyze(slower), "fps-unlimited").windows[0].category, "cost");
  assert.equal(axisOf(analyze(campaign), "fps-unlimited").windows[0].margin.floor, null);

  // The vsync mode read back is not DISABLED in the unlimited lane: no FPS for that execution, the execution is not invalid, and the axis is N/A with the readings.
  const enabled = build();
  for (const execution of enabled.executions.filter(candidate => candidate.lane === "unlimited")) {
    execution.vsync.mode = "ENABLED";
    for (const entry of protocol.windows) {
      delete execution.windows[entry.id].fps;
    }
  }
  const na = analyze(enabled);
  assert.equal(na.status, "complete", "an unlimited lane that did not read DISABLED invalidates nothing");
  assert.deepEqual(axisOf(na, "fps-unlimited"), {id: "fps-unlimited", label: axisOf(analyze(campaign), "fps-unlimited").label, applicable: false, reason: "vsync-not-disabled",
    readings: {A: {accepted: 12, withFps: 0, modes: {ENABLED: 12}}, B: {accepted: 12, withFps: 0, modes: {ENABLED: 12}}, C: {accepted: 12, withFps: 0, modes: {ENABLED: 12}}}});
  assert.equal(na.sections.validity.totals.unlimited.C.rejected, 0);
  // A lane that was not run at all is N/A for that reason.
  assert.equal(axisOf(analyze(build({lanes: ["presented"]})), "fps-unlimited").reason, "unlimited-lane-not-run");
  // A single execution that reads another mode leaves 11 of 12 with a reading, which is still at least the 10 the protocol requires.
  const one = build();
  const odd = executionsOf(one, "C", "unlimited")[0];
  odd.vsync.mode = "ADAPTIVE";
  for (const entry of protocol.windows) {
    delete odd.windows[entry.id].fps;
  }
  const kept = axisOf(analyze(one), "fps-unlimited");
  assert.deepEqual([kept.readings.C.accepted, kept.readings.C.withFps, kept.readings.C.modes], [12, 11, {ADAPTIVE: 1, DISABLED: 11}]);
  assert.equal(kept.windows[0].arms.C.executions, 11);
  // The gain by the rule excludes zero for every interval of a grid, so the flag adds nothing the rule did not say.
  for (let lower = -400; lower <= 400; lower += 25) {
    for (let upper = lower; upper <= 400; upper += 25) {
      const verdict = verdictOf([lower, upper], 1000, {margin: protocol.secondaryOutcomes.find(outcome => outcome.id === "fps-unlimited").margin, orientation: "higherIsBetter", requiresIntervalExcludingZero: true});
      if (verdict.category === "gain") {
        assert.equal(verdict.excludesZero, true, `[${lower}, ${upper}]`);
      }
    }
  }
});

test("the descriptive outcomes report medians, interquartile ranges and intervals with no category, and leave the warm-up out", () => {
  const report = analyze(build({lanes: ["presented"]}));
  const {descriptive} = report.sections.axes;
  assert.deepEqual(descriptive.map(outcome => outcome.id), ["cpu-time-p50", "cpu-time-p99", "frames-above-twice-idle-reference", "frames-above-100-ms", "rss", "hermes-heap", "scene-nodes"]);
  assert.doesNotMatch(JSON.stringify(descriptive), /category|nonInferior/);
  const series = (outcomeId, id, windowId) => descriptive.find(outcome => outcome.id === outcomeId).series.find(entry => entry.id === id && entry.window === windowId);
  // The warm-up occurrences are frames of 150 ms: if one leaked into a window, its p99 would be 150 ms and it would count frames of 100 ms or more.
  const p99 = series("cpu-time-p99", "cpu-time-p99", "ai-phase");
  assert.ok(p99.arms.C.median < 10 && p99.arms.C.median > 7, `p99 ${p99.arms.C.median}`);
  assert.deepEqual([series("frames-above-100-ms", "frames-above-100-ms.count", "ai-phase").arms.C.median, series("frames-above-100-ms", "frames-above-100-ms.share", "stress").arms.B.median], [0, 0]);
  // Every frame of the synthetic windows is far above twice the idle reference (about 0.16 ms), over the 98 measured occurrences of 6 frames.
  assert.deepEqual([series("frames-above-twice-idle-reference", "frames-above-twice-idle-reference.count", "ai-phase").arms.C.median, series("frames-above-twice-idle-reference", "frames-above-twice-idle-reference.share", "ai-phase").arms.C.median], [98 * FRAMES["ai-phase"][0], 1]);
  assert.deepEqual(series("hermes-heap", "hermes-heap.bytes", null).pairs, [], "the Hermes heap exists in C only: no pair");
  assert.deepEqual(Object.keys(series("hermes-heap", "hermes-heap.bytes", null).arms), ["C"]);
  assert.deepEqual(series("scene-nodes", "scene-nodes", null).pairs.map(pair => pair.id), ["C-A", "B-A", "C-B"]);
  assert.deepEqual(series("rss", "rss.max", null).unit, "MB");
  // Each pair carries a difference and the interval of the bootstrap.
  const pair = series("cpu-time-p50", "cpu-time-p50", "stress").pairs.find(candidate => candidate.id === "C-B");
  assert.ok(pair.interval.length === 2 && pair.interval[0] <= pair.interval[1] && Number.isFinite(pair.difference));
});

// ---- the budgets ----
test("the absolute budgets: met when at most the frozen value, exceeded otherwise, and N/A for the stress window the freeze left N/A", () => {
  assert.deepEqual([budgetResult(15.5, 15.5), budgetResult(15.5000001, 15.5), budgetResult(0, 15.5), budgetResult(1, null), budgetResult(1, "N/A: no baseline")], ["met", "exceeded", "met", "n/a", "n/a"]);
  const windows = {
    "ai-phase": perArm([5, TIGHT], [8, TIGHT], [20, TIGHT]),
    "event-burst": perArm([5, TIGHT], [8, TIGHT], [8, TIGHT]),
    "context-switches": perArm([5, TIGHT], [17, TIGHT], [8, TIGHT]),
    stress: perArm([5, TIGHT], [8, TIGHT], [30, TIGHT])
  };
  const report = analyze(build({windows, lanes: ["presented"]}));
  const budgets = report.sections.budgets.windows;
  assert.deepEqual(budgets.map(entry => [entry.id, entry.threshold, typeof entry.budget === "number" ? entry.budget : "n/a"]),
    [["ai-phase", "budget-p95-ai-phase", 15.5], ["event-burst", "budget-p95-event-burst", 15.5], ["context-switches", "budget-p95-context-switches", 16], ["stress", "budget-p95-stress", "n/a"]]);
  assert.deepEqual(budgets.map(entry => Object.fromEntries(Object.entries(entry.arms).map(([arm, value]) => [arm, value.result]))), [
    {A: "met", B: "met", C: "exceeded"},
    {A: "met", B: "met", C: "met"},
    {A: "met", B: "exceeded", C: "met"},
    {A: "n/a", B: "n/a", C: "n/a"}
  ]);
  const frozen = protocol.thresholds.find(threshold => threshold.id === "budget-p95-stress");
  assert.deepEqual([budgets[3].budget, budgets[3].frozenAt], [frozen.frozenValue, frozen.frozenAt], "the budget is reported as frozen, with the reason and the date");
  // The result is beside the category of C against B and changes nothing in it.
  const exceeded = pairOf(report, "ai-phase", "C-B");
  assert.deepEqual([exceeded.budget.B.result, exceeded.budget.C.result, exceeded.category], ["met", "exceeded", "cost"]);
});

// ---- the partial report ----
test("when arm B is not ready the report is A against C: H1 only, no category for H3 and no gain claimed", () => {
  const report = analyze(build({armBReady: false, text: {decision: "Synthetic decision text."}}));
  assert.equal(report.status, "partial");
  assert.equal(executionsOf(build({armBReady: false}), "B").length, 0);
  for (const entry of report.sections.primary.windows) {
    assert.deepEqual(Object.keys(entry.arms), ["A", "C"], entry.id);
    assert.deepEqual(entry.pairs.map(pair => [pair.id, pair.skipped ?? "estimated"]), [["C-A", "estimated"], ["B-A", "reference-arm-not-ready"], ["C-B", "reference-arm-not-ready"]]);
    assert.ok(entry.pairs[0].interval[0] < entry.pairs[0].difference && entry.pairs[0].difference < entry.pairs[0].interval[1], "H1 is estimated");
  }
  assert.doesNotMatch(JSON.stringify(report.sections.primary), /"category"|"gain"|"nonInferior"|"downgraded"/, "no category anywhere in the primary section");
  assert.deepEqual(report.sections.axes.verdicts.map(axis => [axis.applicable, axis.reason]), Array(6).fill([false, "reference-arm-not-ready"]));
  assert.deepEqual(report.sections["cost-of-change"], {available: false, reason: "reference-arm-not-ready"});
  assert.deepEqual(Object.keys(report.sections.budgets.windows[0].arms), ["A", "C"]);
  assert.deepEqual(report.sections.decision, {text: "Synthetic decision text.", partialReport: {applies: true, reason: "synthetic: arm B did not pass the context matrix in its time-box"}});
  assert.deepEqual(report.sections.validity.totals.presented.B, {planned: 0, accepted: 0, rejected: 0, open: 0, missing: 0, exhausted: 0});
  assert.equal(slotOf(report, "presented", 2).state, "not-planned");
  assert.equal(report.sections.validity.balance.presented.balanced, true);
  assert.deepEqual(report.sections.validity.balance.presented.planned.map(position => position.B), [0, 0, 0]);
  // The descriptive outcomes keep the pairs that exist.
  const nodes = report.sections.axes.descriptive.find(outcome => outcome.id === "scene-nodes").series[0];
  assert.deepEqual(nodes.pairs.map(pair => pair.id), ["C-A"]);
  assert.deepEqual(analyze(build({armBReady: true})).sections.decision.partialReport, {applies: false, reason: null});
});

// ---- the protocol is the source of the numbers ----
test("the parameters are read from the protocol when the script runs: a changed protocol changes the interval, the margin and the load limit", () => {
  const changed = structuredClone(protocol);
  changed.statistics.interval.seed = 7;
  changed.statistics.interval.resamples = 1000;
  changed.statistics.interval.level = 0.9;
  changed.decisionRule.margin.relative = 0.5;
  changed.runs.load.limit1MinuteAverage = 6;
  const changedSha256 = sha256(JSON.stringify(changed));
  const campaign = syntheticCampaign(changed, changedSha256, {lanes: ["presented"]});
  overLoaded(campaign.executions.find(execution => execution.slot === 4));
  const report = analyze(campaign, changed, changedSha256);
  const original = analyze(build({lanes: ["presented"]}));
  assert.deepEqual([report.sections.primary.interval.seed, report.sections.primary.interval.resamples, report.sections.primary.interval.level, report.sections.reproduction.seed, report.sections.reproduction.resamples], [7, 1000, 0.9, 7, 1000]);
  assert.deepEqual([original.sections.primary.interval.seed, original.sections.primary.interval.resamples, original.sections.primary.interval.level], [20261009, 10000, 0.95], "the seed of the protocol is in the report");
  const entry = report.sections.primary.windows[0];
  const expected = intervalOf(bootstrapDifferences(entry.arms.C.perRun, entry.arms.B.perRun, {seed: 7, resamples: 1000}), 0.9);
  assert.deepEqual(entry.pairs.find(pair => pair.id === "C-B").interval, expected);
  assert.ok(close(entry.pairs.find(pair => pair.id === "C-B").margin.value, 0.5 * entry.arms.B.median), "the relative margin is the protocol's");
  assert.deepEqual([slotOf(report, "presented", 4).state, slotOf(report, "presented", 4).accepted, slotOf(report, "presented", 4).rejected], ["accepted", 1, 0], "a load of 5.3 is within a limit of 6");
  assert.equal(report.sections.provenance.protocol.sha256, changedSha256);
  // The floor and the categories are the protocol's as well: a floor of 0 leaves 10% of B's median as the margin.
  const noFloor = structuredClone(protocol);
  noFloor.decisionRule.margin.floor = {value: 0, unit: "ms"};
  const noFloorSha256 = sha256(JSON.stringify(noFloor));
  const small = analyze(syntheticCampaign(noFloor, noFloorSha256, {windows: Object.fromEntries(protocol.windows.map(({id}) => [id, perArm([2, TIGHT], [3, TIGHT], [3.4, TIGHT])])), lanes: ["presented"]}), noFloor, noFloorSha256);
  assert.deepEqual([pairOf(small, "ai-phase", "C-B").category, Math.abs(pairOf(small, "ai-phase", "C-B").margin.value - 0.3) < 0.01], ["cost", true]);
});

// ---- the report ----
test("the report has the sections of the protocol in order, the frozen values and the hash of the protocol, and takes its words from the campaign", () => {
  const report = analyze(build({text: {decision: "A decision.", limitations: "The limits.", costOfChange: "The change."}}));
  assert.deepEqual([report.format, REPORT_FORMAT], ["godot-fabric.frontier-comparison-report/v1", "godot-fabric.frontier-comparison-report/v1"]);
  assert.deepEqual(Object.keys(report.sections), protocol.report.sections.map(section => section.id));
  const {provenance} = report.sections;
  assert.equal(provenance.protocol.sha256, protocolSha256);
  assert.equal(provenance.protocol.amendments, protocol.amendments.length);
  assert.deepEqual(provenance.protocol.frozen, protocol.thresholds.map(threshold => ({id: threshold.id, frozenValue: threshold.frozenValue, frozenAt: threshold.frozenAt})), "the frozen values with their dates");
  assert.ok(provenance.protocol.frozen.every(threshold => threshold.frozenAt === "2026-10-10"));
  assert.deepEqual([provenance.commit, provenance.deviations], ["synthetic-commit", []]);
  assert.deepEqual(provenance.vsync, [{lane: "presented", mode: "ENABLED", refreshHz: 120, executions: 36}, {lane: "unlimited", mode: "DISABLED", refreshHz: 120, executions: 36}]);
  assert.deepEqual([provenance.load.limit1MinuteAverage, provenance.load.highestBefore < 2, provenance.load.highestAfter < 2], [2, true, true]);
  assert.deepEqual([report.sections.decision.text, report.sections.limitations.text, report.sections["cost-of-change"].text], ["A decision.", "The limits.", "The change."]);
  const bare = analyze(build());
  assert.deepEqual([bare.sections.decision.text, bare.sections.limitations.text, bare.sections["cost-of-change"].text], [null, null, null], "the script writes no text of its own");
  assert.deepEqual(Object.keys(report.sections.reproduction), ["rawData", "campaignSha256", "protocolSha256", "seed", "resamples", "commands"]);
  // Another section list in the protocol is refused: the report is the protocol's.
  const other = structuredClone(protocol);
  other.report.sections.pop();
  assert.throws(() => analyze(build(), other, protocolSha256), /report sections/);
});

test("the same campaign gives the same report byte for byte, and the seed of the protocol is in it", () => {
  const campaign = build();
  const first = serializeReport(analyze(campaign));
  assert.equal(serializeReport(analyze(structuredClone(campaign))), first);
  assert.equal(serializeReport(analyze(JSON.parse(JSON.stringify(campaign)))), first, "a campaign read back from its JSON gives the same bytes");
  assert.match(first, /"seed": 20261009/);
  assert.ok(first.endsWith("}\n"));
  // Another draw of the synthetic data is another report, and the report carries no clock, no path and no random number.
  assert.notEqual(serializeReport(analyze(build({seed: "another"}))), first);
  assert.doesNotMatch(first, /\/Users\/|\/private\/|Date|T\d\d:\d\d/);
});

test("the command line writes the report of a campaign file, checks its format and refuses a bad one", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-comparison-"));
  try {
    const campaignFile = path.join(directory, "campaign.json");
    const reportFile = path.join(directory, "report.json");
    const campaign = build({lanes: ["presented"]});
    const campaignText = `${JSON.stringify(campaign)}\n`;
    fs.writeFileSync(campaignFile, campaignText);
    const run = args => spawnSync(process.execPath, [SCRIPT, ...args], {encoding: "utf8", maxBuffer: 1 << 28});
    const checked = run(["--check-format", campaignFile]);
    assert.deepEqual([checked.status, checked.stdout], [0, "FRONTIER_COMPARISON_FORMAT_PASSED: 36 attempts, arm B ready\n"]);
    const written = run([campaignFile, "--out", reportFile]);
    assert.equal(written.status, 0, written.stderr);
    assert.match(written.stdout, /^FRONTIER_COMPARISON_ANALYSIS_WRITTEN: .*report\.json, status complete\n$/);
    const expected = serializeReport(buildReport({campaign: JSON.parse(campaignText), protocol, protocolSha256, campaignSha256: sha256(campaignText)}));
    assert.equal(fs.readFileSync(reportFile, "utf8"), expected, "the file is the report of the library, with the hash of the campaign file");
    assert.equal(run([campaignFile]).stdout, expected, "without --out the report goes to the standard output");
    const broken = structuredClone(campaign);
    delete broken.provenance.commit;
    broken.executions[0].hashes.binary = "abc";
    fs.writeFileSync(campaignFile, JSON.stringify(broken));
    const refused = run(["--check-format", campaignFile]);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /FAIL \$\.provenance\.commit: missing\nFAIL \$\.executions\[0\]\.hashes\.binary: expected sha256/);
    assert.equal(run([campaignFile, "--out", reportFile]).status, 1);
    assert.equal(run([]).status, 1);
    assert.match(run(["--wat"]).stderr, /unknown argument --wat/);
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

// ---- the evidence record ----
const EVIDENCE = "docs/evidence/frontier-comparison-analysis";
const EXAMPLE_COMMANDS = [
  "node tests/frontier-comparison-synthetic.mjs example-campaign.json",
  `node scripts/frontier-comparison-analysis.mjs example-campaign.json --out ${EVIDENCE}/example-report.json`
];
test("the example report of the evidence record is the exact output of the script for the synthetic campaign regenerated with the same seed, by the commands of its README", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "frontier-comparison-example-"));
  try {
    const campaignFile = path.join(directory, "example-campaign.json");
    const reportFile = path.join(directory, "example-report.json");
    const run = args => spawnSync(process.execPath, args, {encoding: "utf8", maxBuffer: 1 << 28});
    const written = run([path.join(root, "tests/frontier-comparison-synthetic.mjs"), campaignFile]);
    assert.equal(written.status, 0, written.stderr);
    const analysed = run([SCRIPT, campaignFile, "--out", reportFile]);
    assert.equal(analysed.status, 0, analysed.stderr);
    const committed = fs.readFileSync(path.join(root, EVIDENCE, "example-report.json"), "utf8");
    assert.equal(fs.readFileSync(reportFile, "utf8"), committed, "the committed report is the script's output, byte for byte; regenerate it with the commands of the README if the protocol or the script changed");
    const report = JSON.parse(committed);
    assert.deepEqual([report.status, report.why, report.sections.reproduction.campaignSha256], ["complete", [], sha256(fs.readFileSync(campaignFile))], "the report records the hash of the campaign bytes it analysed");
    assert.equal(report.sections.reproduction.protocolSha256, protocolSha256);
    // The example says it is made up, in the words of the campaign and in the data it carries, and it shows the four categories and a redone load.
    assert.match(JSON.stringify([report.sections.decision, report.sections.limitations, report.sections["cost-of-change"].text]), /SYNTHETIC EXAMPLE/);
    assert.deepEqual([report.sections.provenance.commit, report.sections.provenance.machine], ["synthetic-commit", "synthetic machine"]);
    assert.deepEqual(protocol.windows.map(({id}) => pairOf(report, id, "C-B").category), ["gain", "neutral", "cost", "inconclusive"]);
    assert.deepEqual([slotOf(report, "presented", 4).state, slotOf(report, "presented", 4).rejected], ["accepted", 1]);
    assert.equal(axisOf(report, "fps-unlimited").windows[0].category, "gain");
    const readme = fs.readFileSync(path.join(root, EVIDENCE, "README.md"), "utf8");
    for (const command of EXAMPLE_COMMANDS) {
      assert.ok(readme.includes(command), `the README gives the command: ${command}`);
    }
  } finally {
    fs.rmSync(directory, {recursive: true, force: true});
  }
});

// ---- the shape of the delivery ----
test("the protocol's test imports the functions from the modules, and the tests are part of the contracts", () => {
  const protocolTest = fs.readFileSync(path.join(root, "tests/frontier-comparison-protocol.test.mjs"), "utf8");
  assert.match(protocolTest, /from "\.\.\/scripts\/frontier-comparison-statistics\.mjs"/);
  assert.match(protocolTest, /from "\.\.\/scripts\/frontier-comparison-decision\.mjs"/);
  assert.doesNotMatch(protocolTest, /Math\.imul|const mulberry32|const holmStands|const bootstrapDifferences/, "the statistics live in one place");
  const contracts = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts["test:contracts"].split("&&");
  for (const name of ["analysis", "validity"]) {
    assert.ok(contracts.some(command => command.includes(`tests/frontier-comparison-${name}.test.mjs`)), `test:contracts runs the ${name} test`);
  }
});
