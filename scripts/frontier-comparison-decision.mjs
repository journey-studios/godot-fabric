// The decision rule of the final comparison of the 0.5 Frontier (V05-10), as docs/research/frontier-comparison-protocol.json defines it under `decisionRule`. The rule is evaluated from the
// JSON's own conditions (`categories[].when`, `nonInferior.when`), not recoded here. Intervals are [lower, upper] pairs of the difference C minus B, in the unit of the outcome.

const COMPARE = { "<": (a, b) => a < b, "<=": (a, b) => a <= b, ">": (a, b) => a > b, ">=": (a, b) => a >= b };

// One condition of the rule on an interval already oriented so that negative is better: a leaf {endpoint, op, bound} or an {all: [...]} / {any: [...]} of conditions.
function holds(condition, interval, margin) {
  if (Object.hasOwn(condition, "all")) {
    return condition.all.every((inner) => holds(inner, interval, margin));
  }
  if (Object.hasOwn(condition, "any")) {
    return condition.any.some((inner) => holds(inner, interval, margin));
  }
  const endpoint = { lower: interval[0], upper: interval[1] }[condition.endpoint];
  const bound = { margin, "-margin": -margin }[condition.bound];
  if (endpoint === undefined || bound === undefined || !Object.hasOwn(COMPARE, condition.op)) {
    throw new Error(`the decision rule has a leaf that is not well formed: ${JSON.stringify(condition)}`);
  }
  return COMPARE[condition.op](endpoint, bound);
}

// decisionRule.orientation: for an outcome where higher is better the interval [lo, hi] of C minus B is negated to [-hi, -lo] before the categories apply, so that a gain always means better.
const orient = (interval, orientation) => (orientation === "higherIsBetter" ? [-interval[1], -interval[0]] : interval);

// The decision rule of a protocol, bound to its `decisionRule`: the functions below read the categories, the non-inferior condition and the margin from it, so nothing of the protocol is written
// in the code and callers pass no part of it. The optional `categories` and `marginRule` arguments are there for a test to try another rule against the same code.
export function decisionRuleOf(protocol) {
  const rule = protocol.decisionRule;

  // The ids of the categories (decisionRule.categories) whose condition holds for the interval: exactly one, for any interval, by the rule's own design.
  const categoriesOf = (interval, margin, orientation = "lowerIsBetter", categories = rule.categories) => {
    const oriented = orient(interval, orientation);
    return categories.filter((category) => holds(category.when, oriented, margin)).map((category) => category.id);
  };

  const classify = (interval, margin, orientation = "lowerIsBetter") => {
    const held = categoriesOf(interval, margin, orientation);
    if (held.length !== 1) {
      throw new Error(`exactly one category is expected for [${interval}] with margin ${margin}, got ${held.length}: ${held}`);
    }
    return held[0];
  };

  // decisionRule.nonInferior: a flag beside the category, never in its place.
  const nonInferior = (interval, margin, orientation = "lowerIsBetter") => holds(rule.nonInferior.when, orient(interval, orientation), margin);

  // decisionRule.margin.formula, max(relative x the median of B, floor): `marginRule` is {relative, floor: {value, unit} | null}, the shape of decisionRule.margin and of the `margin` of an outcome.
  const marginOf = (medianOfReference, marginRule = rule.margin) => Math.max(marginRule.relative * medianOfReference, marginRule.floor?.value ?? 0);

  // The verdict of C against B (the subject against the reference) on one interval: the margin and where it comes from, the category, the non-inferior flag. `axis` is {margin, orientation}
  // (the decision rule's own for a primary window, the outcome's for an axis). decisionRule.fpsGain: a gain in FPS is stated only when the interval excludes zero, and a gain by the rule
  // already does (the margin is not negative), so for an axis that requires it the flag is reported beside the category.
  const verdictOf = (interval, medianOfReference, axis) => {
    const margin = marginOf(medianOfReference, axis.margin);
    const verdict = {
      interval,
      orientation: axis.orientation,
      orientedInterval: orient(interval, axis.orientation),
      margin: { value: margin, relative: axis.margin.relative, floor: axis.margin.floor, medianOfReference },
      category: classify(interval, margin, axis.orientation),
      nonInferior: nonInferior(interval, margin, axis.orientation),
    };
    if (axis.requiresIntervalExcludingZero) {
      verdict.excludesZero = interval[0] > 0 || interval[1] < 0;
    }
    return verdict;
  };

  return { categoriesOf, classify, nonInferior, marginOf, verdictOf };
}

// decisionRule.absoluteBudget: the median over the executions of an arm of the per-run p95 of a window against the window's frozen budget: met when at most the budget, exceeded
// otherwise, n/a when the budget is not a number (null while unfrozen, or the text of an N/A frozen with its reason).
export function budgetResult(armValue, budget) {
  if (typeof budget !== "number") {
    return "n/a";
  }
  return armValue <= budget ? "met" : "exceeded";
}
