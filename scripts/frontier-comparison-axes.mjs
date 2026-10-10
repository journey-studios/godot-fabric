import { CHANGE_MEASURES } from "./frontier-comparison-format.mjs";
import { READINGS, UNLIMITED } from "./frontier-comparison-protocol.mjs";
import { acrossRuns, contrastOf, median } from "./frontier-comparison-statistics.mjs";

// The secondary outcomes of the final comparison (docs/research/frontier-comparison-protocol.json: `secondaryOutcomes`, `decisionRule`): the verdict of C against B on each axis with
// `verdict: true`, and the descriptive outcomes with their medians and intervals. The context `ctx` is {protocol, roles, decision, arms, campaign, validity, measures, windowSeries}, `decision` being decisionRuleOf(protocol): `measures[arm]`
// holds, for each accepted execution of the presented lane in the order of the slots, the values of windowMeasures and readingValues.

const notApplicable = (outcome, reason, extra = {}) => ({ id: outcome.id, label: outcome.label, applicable: false, reason, ...extra });

// Both arms of the verdict (the subject against the reference) are in the outcome's arms and planned; otherwise the arm that is not ready is the reason.
const comparable = (ctx, outcome) => [ctx.roles.subject, ctx.roles.reference].every((arm) => outcome.arms.includes(arm) && ctx.arms.includes(arm));

const summaries = (valuesByArm) => Object.fromEntries(Object.entries(valuesByArm).map(([arm, values]) => [arm, { ...acrossRuns(values), perRun: values }]));

const headOf = (outcome, kind) => ({ id: outcome.id, label: outcome.label, unit: outcome.unit, kind });

// The body of an axis with an interval: the per-run values of the subject and the reference, the difference of their medians with its 95% bootstrap interval, and the verdict by the
// decision rule with the outcome's own margin and orientation (statistics: the secondary axes are read with their unadjusted intervals).
function intervalBody(ctx, outcome, valuesByArm) {
  const { subject, reference } = ctx.roles;
  const contrast = contrastOf(valuesByArm[subject], valuesByArm[reference], ctx.protocol.statistics.interval);
  const axis = { margin: outcome.margin, orientation: outcome.orientation, requiresIntervalExcludingZero: outcome.requiresIntervalExcludingZero };
  return { arms: summaries(valuesByArm), difference: contrast.difference, ...ctx.decision.verdictOf(contrast.interval, median(valuesByArm[reference]), axis) };
}

// An outcome read once per execution (click-to-panel, rss, time-to-interactive-hud): the series is the outcome's id.
function readingAxis(ctx, outcome) {
  const valuesByArm = Object.fromEntries(outcome.arms.filter((arm) => ctx.arms.includes(arm)).map((arm) => [arm, ctx.measures[arm].map((measure) => measure.readings[outcome.id])]));
  return { ...headOf(outcome, "interval"), ...intervalBody(ctx, outcome, valuesByArm) };
}

// `fps-unlimited`: read in the unlimited lane only, per window, and only when the vsync mode reads back DISABLED (vsync.unlimitedFpsRequires). An execution whose reading is another mode has
// no FPS (invalidation vsync-reading: not invalid, the band is N/A for that execution), and the axis needs `minimumPerArm` executions with a reading in the subject and the reference to
// say anything; otherwise it is N/A, with the readings recorded.
function fpsAxis(ctx, outcome) {
  const unlimited = ctx.validity.accepted[UNLIMITED];
  const [first] = ctx.protocol.windows;
  const withFps = Object.fromEntries(ctx.arms.map((arm) => [arm, unlimited[arm].filter((execution) => Object.hasOwn(execution.windows[first.id], "fps"))]));
  const readings = Object.fromEntries(
    ctx.arms.map((arm) => {
      const modes = {};
      for (const execution of unlimited[arm]) {
        modes[execution.vsync.mode] = (modes[execution.vsync.mode] ?? 0) + 1;
      }
      return [arm, { accepted: unlimited[arm].length, withFps: withFps[arm].length, modes }];
    }),
  );
  const { subject, reference } = ctx.roles;
  const enough = [subject, reference].every((arm) => withFps[arm].length >= ctx.protocol.runs.minimumPerArm);
  if (!enough) {
    const none = [subject, reference].every((arm) => unlimited[arm].length === 0);
    return notApplicable(outcome, none ? "unlimited-lane-not-run" : "vsync-not-disabled", { readings });
  }
  return {
    ...headOf(outcome, "interval-per-window"),
    readings,
    windows: ctx.protocol.windows.map((window) => {
      const valuesByArm = Object.fromEntries(ctx.arms.filter((arm) => outcome.arms.includes(arm)).map((arm) => [arm, withFps[arm].map((execution) => execution.windows[window.id].fps)]));
      return { window: window.id, ...intervalBody(ctx, outcome, valuesByArm) };
    }),
  };
}

// `package-size`, deterministic (decisionRule.deterministic): one export of each arm, repeated once. The two sizes of an arm are equal, so the interval is the point: the category is taken
// on the difference of the two sizes against the margin; if the two exports of an arm differ, the axis is inconclusive.
function packageAxis(ctx, outcome) {
  const { subject, reference } = ctx.roles;
  const arms = Object.fromEntries(ctx.arms.map((arm) => [arm, { exportBytes: ctx.campaign.packages[arm].exportBytes, equal: new Set(ctx.campaign.packages[arm].exportBytes).size === 1 }]));
  const base = { ...headOf(outcome, "deterministic"), arms };
  if (!arms[subject].equal || !arms[reference].equal) {
    return { ...base, category: "inconclusive", reason: "the two exports of an arm differ" };
  }
  const difference = arms[subject].exportBytes[0] - arms[reference].exportBytes[0];
  const axis = { margin: outcome.margin, orientation: outcome.orientation };
  return { ...base, difference, ...ctx.decision.verdictOf([difference, difference], arms[reference].exportBytes[0], axis) };
}

// `change-cost`, a single observation (decisionRule.singleObservation): one implementation per arm, so no interval. The category is taken on the difference of each of files, lines, time
// and tests against the margin (a point interval: gain below -margin, cost above +margin, neutral within), and the axis takes it only when the four agree and is inconclusive otherwise.
function changeCostAxis(ctx, outcome) {
  const { subject, reference } = ctx.roles;
  const observed = ctx.campaign.changeCost;
  const measures = Object.keys(CHANGE_MEASURES).map((name) => {
    const difference = observed[subject][name] - observed[reference][name];
    const axis = { margin: outcome.margin, orientation: outcome.orientation };
    const { margin, category, nonInferior } = ctx.decision.verdictOf([difference, difference], observed[reference][name], axis);
    return { measure: name, [reference]: observed[reference][name], [subject]: observed[subject][name], difference, margin, category, nonInferior };
  });
  const agree = new Set(measures.map((measure) => measure.category)).size === 1;
  return { ...headOf(outcome, "single-observation"), observationsPerArm: 1, measures, agree, category: agree ? measures[0].category : "inconclusive" };
}

function axisOf(ctx, outcome) {
  if (!comparable(ctx, outcome)) {
    return notApplicable(outcome, "reference-arm-not-ready");
  }
  if (Object.hasOwn(READINGS, outcome.id)) {
    return readingAxis(ctx, outcome);
  }
  if (outcome.id === "fps-unlimited") {
    return fpsAxis(ctx, outcome);
  }
  if (outcome.id === "package-size") {
    return packageAxis(ctx, outcome);
  }
  if (outcome.id === "change-cost") {
    return ctx.campaign.changeCost === undefined ? notApplicable(outcome, "not-observed") : changeCostAxis(ctx, outcome);
  }
  throw new Error(`the analysis has no axis for the outcome ${outcome.id}`);
}

// ---- the descriptive outcomes: medians, interquartile ranges and the intervals of the differences, with no category ----

// The series of the descriptive outcomes that are read once per execution, by outcome id: the id of the series in readingValues and its unit. The resident memory's maximum is a series of the
// outcome `rss` (observation: the reading at the end of the run, and the maximum of the readings kept): the end of the run is its verdict, the maximum is described here.
const READING_SERIES = {
  "hermes-heap": [
    { id: "hermes-heap.bytes", unit: "bytes" },
    { id: "hermes-heap.nativeViews", unit: "nodes" },
  ],
  "scene-nodes": [{ id: "scene-nodes", unit: "nodes" }],
  rss: [{ id: "rss.max", unit: "MB" }],
};

// One series of one outcome, in a window or (window null) in the execution: the median and the interquartile range of each arm that the outcome has, and the difference and the 95%
// bootstrap interval of every pair of the protocol whose two arms have it.
function seriesEntry(ctx, outcome, series, window) {
  const valuesByArm = Object.fromEntries(
    outcome.arms.filter((arm) => ctx.arms.includes(arm)).map((arm) => [arm, ctx.measures[arm].map((measure) => (window === null ? measure.readings : measure.windows[window.id])[series.id])]),
  );
  const pairs = ctx.protocol.statistics.pairs
    .filter((pair) => Object.hasOwn(valuesByArm, pair.minuend) && Object.hasOwn(valuesByArm, pair.subtrahend))
    .map((pair) => {
      const { difference, interval } = contrastOf(valuesByArm[pair.minuend], valuesByArm[pair.subtrahend], ctx.protocol.statistics.interval);
      return { id: pair.id, difference, interval };
    });
  return { id: series.id, window: window === null ? null : window.id, unit: series.unit, arms: Object.fromEntries(Object.entries(valuesByArm).map(([arm, values]) => [arm, acrossRuns(values)])), pairs };
}

function descriptiveOf(ctx) {
  const windowSeries = ctx.windowSeries.series;
  return ctx.protocol.secondaryOutcomes
    .filter((outcome) => !outcome.verdict || Object.hasOwn(READING_SERIES, outcome.id))
    .map((outcome) => {
      const series = [];
      for (const own of windowSeries.filter((candidate) => candidate.outcome === outcome.id)) {
        series.push(...ctx.protocol.windows.map((window) => seriesEntry(ctx, outcome, own, window)));
      }
      for (const own of READING_SERIES[outcome.id] ?? []) {
        series.push(seriesEntry(ctx, outcome, own, null));
      }
      return { id: outcome.id, label: outcome.label, series };
    });
}

export function axesSection(ctx) {
  return {
    available: true,
    verdicts: ctx.protocol.secondaryOutcomes.filter((outcome) => outcome.verdict).map((outcome) => axisOf(ctx, outcome)),
    descriptive: descriptiveOf(ctx),
  };
}

// The section `cost-of-change`: the single observation of each arm, as it came, and that it is one observation per arm that supports a description and not a statistical claim.
export function costOfChangeSection(ctx) {
  const { subject, reference } = ctx.roles;
  if (!ctx.arms.includes(reference)) {
    return { available: false, reason: "reference-arm-not-ready" };
  }
  if (ctx.campaign.changeCost === undefined) {
    return { available: false, reason: "not-observed" };
  }
  return {
    available: true,
    observationsPerArm: 1,
    statisticalClaim: false,
    observation: { [reference]: ctx.campaign.changeCost[reference], [subject]: ctx.campaign.changeCost[subject] },
    text: ctx.campaign.text?.costOfChange ?? null,
  };
}
