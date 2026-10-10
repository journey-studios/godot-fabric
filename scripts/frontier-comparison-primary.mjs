import { budgetResult } from "./frontier-comparison-decision.mjs";
import { budgetIdOf } from "./frontier-comparison-protocol.mjs";
import { acrossRuns, claimPValue, contrastOf, guarded, holmStands } from "./frontier-comparison-statistics.mjs";

// The primary outcome of the final comparison (docs/research/frontier-comparison-protocol.json: `primaryOutcome`, `statistics`, `decisionRule`) and the absolute budgets: for each window
// and each pair of arms, the executions, the median and the interquartile range of each arm, the difference and its 95% interval; for C against B the margin, the category, the
// non-inferior flag and the Holm guard over the four windows. The context `ctx` is {protocol, roles, decision, arms, measures, windowSeries}, `decision` being decisionRuleOf(protocol): `arms` are the arms the campaign plans and `measures[arm]`
// holds, for each accepted execution of the presented lane in the order of the slots, the values of windowMeasures and readingValues.

// primaryOutcome.armValue: for each window and arm, the per-run p95 (in ms), its median across the executions and its interquartile range.
export function primaryValues(ctx) {
  return Object.fromEntries(
    ctx.protocol.windows.map((window) => [
      window.id,
      Object.fromEntries(
        ctx.arms.map((arm) => {
          const perRun = ctx.measures[arm].map((measure) => measure.windows[window.id][ctx.windowSeries.primary]);
          return [arm, { ...acrossRuns(perRun), perRun }];
        }),
      ),
    ]),
  );
}

// decisionRule.absoluteBudget: the window's frozen budget (thresholds[budget-p95-<window>]) and, for each arm, the median of its per-run p95 against it.
function windowBudget(ctx, window, values) {
  const threshold = ctx.protocol.thresholds.find((candidate) => candidate.id === budgetIdOf(window));
  return {
    threshold: threshold.id,
    unit: threshold.unit,
    budget: threshold.frozenValue,
    frozenAt: threshold.frozenAt,
    arms: Object.fromEntries(ctx.arms.map((arm) => [arm, { median: values[window.id][arm].median, result: budgetResult(values[window.id][arm].median, threshold.frozenValue) }])),
  };
}

export function budgetsSection(ctx, values) {
  return { available: true, windows: ctx.protocol.windows.map((window) => ({ id: window.id, ...windowBudget(ctx, window, values) })) };
}

// The pair's entry in a window: its difference and interval, with no category for an estimate (H1, H2). A pair with the reference arm, when it is not ready, is skipped with that reason.
function estimateEntry(pair, contrast) {
  return { id: pair.id, hypothesis: pair.hypothesis, minuend: pair.minuend, subtrahend: pair.subtrahend, difference: contrast.difference, interval: contrast.interval };
}

// statistics.multiplicity: the Holm guard over the family of the four primary windows of H3 (C minus B). For each window the claim's one-sided bootstrap p-value, from the resampled
// differences of the same interval and with the margin of the window; the k-th smallest stands when it is at most alphaOneSided / (m - k + 1) and every smaller one stood; a category whose
// claim does not stand is downgraded to inconclusive, and the unadjusted category and interval stay beside it.
function holmOf(claims, multiplicity) {
  const pValues = claims.map(({ contrast, verdict }) => claimPValue(contrast.differences, verdict.margin.value));
  const stands = holmStands(pValues, multiplicity.alphaOneSided);
  return { pValues, stands, categories: guarded(claims.map(({ verdict }) => verdict.category), stands) };
}

export function primarySection(ctx, values) {
  const { protocol, roles, arms } = ctx;
  const { statistics, decisionRule, primaryOutcome } = protocol;
  const usable = (pair) => arms.includes(pair.minuend) && arms.includes(pair.subtrahend);
  const contrasts = protocol.windows.map((window) =>
    statistics.pairs.map((pair) => (usable(pair) ? contrastOf(values[window.id][pair.minuend].perRun, values[window.id][pair.subtrahend].perRun, statistics.interval) : null)),
  );
  const decisionIndex = statistics.pairs.indexOf(roles.decisionPair);
  const claims = usable(roles.decisionPair)
    ? protocol.windows.map((window, index) => {
        const contrast = contrasts[index][decisionIndex];
        const verdict = ctx.decision.verdictOf(contrast.interval, values[window.id][roles.reference].median, { margin: decisionRule.margin, orientation: primaryOutcome.orientation });
        return { contrast, verdict };
      })
    : null;
  const holm = claims === null ? null : holmOf(claims, statistics.multiplicity);
  return {
    available: true,
    outcome: primaryOutcome.id,
    unit: primaryOutcome.unit,
    orientation: primaryOutcome.orientation,
    interval: { level: statistics.interval.level, method: statistics.interval.method, resamples: statistics.interval.resamples, seed: statistics.interval.seed, prng: statistics.interval.prng.algorithm },
    multiplicity: { family: statistics.multiplicity.family, method: statistics.multiplicity.method, alphaOneSided: statistics.multiplicity.alphaOneSided },
    windows: protocol.windows.map((window, windowIndex) => ({
      id: window.id,
      label: window.label,
      arms: values[window.id],
      pairs: statistics.pairs.map((pair, pairIndex) => {
        if (contrasts[windowIndex][pairIndex] === null) {
          return { id: pair.id, hypothesis: pair.hypothesis, skipped: "reference-arm-not-ready" };
        }
        if (pair !== roles.decisionPair) {
          return estimateEntry(pair, contrasts[windowIndex][pairIndex]);
        }
        const { verdict } = claims[windowIndex];
        const budget = windowBudget(ctx, window, values);
        return {
          ...estimateEntry(pair, contrasts[windowIndex][pairIndex]),
          margin: { ...verdict.margin, formula: decisionRule.margin.formula },
          unadjustedCategory: verdict.category,
          category: holm.categories[windowIndex],
          downgraded: holm.categories[windowIndex] !== verdict.category,
          nonInferior: verdict.nonInferior,
          pValue: holm.pValues[windowIndex],
          holmStands: holm.stands[windowIndex],
          budget: { threshold: budget.threshold, value: budget.budget, [roles.reference]: budget.arms[roles.reference], [roles.subject]: budget.arms[roles.subject] },
        };
      }),
    })),
  };
}
