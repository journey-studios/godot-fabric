import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";

// The pre-registered protocol of the final comparison of the 0.5 (V05-10, criterion `protocolo`): the game without a HUD (A), with a native Godot HUD (B) and
// with the React Native HUD (C). The protocol is docs/research/frontier-comparison-protocol.json, read by machines, and
// docs/research/frontier-comparison-protocol.md, read by people. This test runs no game and measures nothing. It holds the protocol to its own text:
// the schema, the decision rule (evaluated from the JSON, not recoded here), the balance of the order of the executions, the bootstrap that the
// intervals will use, and a pin of the whole file, so that changing the protocol after the pre-registration takes changing this file on purpose,
// together with a new entry in the protocol's own list of `amendments`.
const root = fileURLToPath(new URL("../", import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const protocol = JSON.parse(read("docs/research/frontier-comparison-protocol.json"));
const doc = read("docs/research/frontier-comparison-protocol.md");
const migration = JSON.parse(read("dashboard/migration.json"));

// The SHA-256 of the protocol in canonical form (keys sorted at every depth) without the `frozenValue` and `frozenAt` fields, which are the only ones
// the later freeze may fill. Changing anything else in the JSON is an amendment: it is listed in the research note and as an entry of the `amendments`
// of the JSON, and a pin is added here in the same commit. PINS[n] is the hash of the protocol that carries n amendments:
//  - PINS[0]: the pre-registration (commit 82f5f43, #84), made before any comparative measurement. That file had no `amendments` list.
//  - PINS[1]: the amendment of 2026-10-09, `amendments[0]`: the idle reference is the median of the half-sums of consecutive pairs of the per-frame values of the
//    600 idle frames, in the same quantity as the frames it is compared with: the CPU time per frame for the secondary outcome, the elapsed intervals between
//    process frames for the pacing clause of `not-presented` (docs/research/frontier-comparison-protocol.md, "Amendments"). No comparative measurement had run
//    (`measurementsBefore: 0`). The entry was reworded twice on review before it reached main, so it is one amendment with one pin: its first wording (commit 237b171,
//    pin 6e58144ece9d1c291c818d8079f883c14bd232b7154b0274c93fa683548cb2b0) called the values "CPU times" for both uses, and the second (pin
//    b43c5e9a0e560879c5c67a40c92a755175a74d9bc54f96938222d986e1b3319f) called them the intervals for both.
//  - PINS[2]: the amendment of 2026-10-09, `amendments[1]`: arm B's time-box gets its length (arm C's 12.8 h of subagent active time plus an optimization pass of at
//    most 3.2 h, 16.0 h in all), and the open item of the iPhone records the NO-GO of V05-09. No comparative measurement had run (`measurementsBefore: 0`).
const PINS = [
  "8dd7779dd9f21386cf2e272845339c9031ceebd16cf01aa7dbec3a9d6f00353c",
  "8833e54e54718694486f626644faa4eef4adef1915f80f973d9827aa44098efb",
  "0b0644716fb5e4bf85ef7556347e56fa5ea12d3be3f19a0576498370ddc618b6"
];
const PINNED_SHA256 = PINS[protocol.amendments.length];
const FREEZE_KEYS = ["frozenValue", "frozenAt"];

const withoutFreeze = value => {
  if (Array.isArray(value)) {
    return value.map(withoutFreeze);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !FREEZE_KEYS.includes(key)).map(([key, inner]) => [key, withoutFreeze(inner)]));
  }
  return value;
};
const canonical = value => {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
const sha256 = text => createHash("sha256").update(text).digest("hex");
const pinOf = value => sha256(canonical(withoutFreeze(value)));

// ---- the schema: required fields and their types ----
const typeOf = value => {
  if (value === null) {
    return "null";
  }
  return Array.isArray(value) ? "array" : typeof value;
};
const conforms = (value, shape, where, errors) => {
  if (typeof shape === "string") {
    if (!shape.split("|").includes(typeOf(value))) {
      errors.push(`${where}: expected ${shape}, got ${typeOf(value)}`);
    }
    return;
  }
  if (Array.isArray(shape)) {
    if (!Array.isArray(value) || value.length === 0) {
      errors.push(`${where}: expected a non-empty array`);
      return;
    }
    value.forEach((item, index) => conforms(item, shape[0], `${where}[${index}]`, errors));
    return;
  }
  if (typeOf(value) !== "object") {
    errors.push(`${where}: expected an object, got ${typeOf(value)}`);
    return;
  }
  for (const [key, inner] of Object.entries(shape)) {
    if (!Object.hasOwn(value, key)) {
      errors.push(`${where}.${key}: missing`);
    } else {
      conforms(value[key], inner, `${where}.${key}`, errors);
    }
  }
};
const errorsOf = value => {
  const errors = [];
  conforms(value, schema, "$", errors);
  return errors;
};
const schema = {
  schemaVersion: "number",
  id: "string",
  milestone: "string",
  item: "string",
  criterion: "string",
  reactNative: "string",
  status: "string",
  results: "string",
  baseline: {item: "string", research: "string", evidence: "string", pinnedCommit: "string", headless: "string", windowed: "string", freezeCriterion: "string"},
  preRegistration: {measurementsBeforeThisFile: "string", pin: "string", freeze: "string", amendments: "string"},
  amendments: [{date: "string", what: "string", why: "string", before: "string", measurementsBefore: "number"}],
  arms: [{id: "string", label: "string", role: "string", hud: "string"}],
  hypotheses: [{id: "string", label: "string", contrast: {minuend: "string", subtrahend: "string"}, outcome: "string", nature: "string", expectation: "string"}],
  windows: [{id: "string", label: "string", scenario: "string", starts: "string", ends: "string", occurrences: "string", warmupOccurrences: "number", measuredOccurrences: "number",
    arms: ["string"]}],
  idleReference: {frames: "number", rule: "string"},
  primaryOutcome: {id: "string", label: "string", quantity: "string", unit: "string", orientation: "string", perRun: "string", armValue: "string", analysedApart: "string",
    vsync: "string", instrument: "string"},
  vsync: {readBack: "string", unlimitedFpsRequires: "string", otherwise: "string", refreshRate: "string", missedFramesWithVsyncOn: "string"},
  secondaryOutcomes: [{id: "string", label: "string", unit: "string", arms: ["string"], observation: "string", verdict: "boolean"}],
  runs: {
    minimumPerArm: "number", perArm: "number", why12: "string", blocks: ["string"], repetitions: "number", sequence: ["string"], balance: "string",
    lanes: [{id: "string", vsync: "string", reads: "string"}],
    fixed: {machine: "string", build: "string", gameSeed: "string", replay: "string", soak: "string", input: "string"},
    process: "string", script: [{step: "string", does: "string"}], warmup: "string",
    load: {command: "string", read: "string", limit1MinuteAverage: "number", overLimit: "string", redo: "string"},
    provenance: "string", rawData: "string"
  },
  statistics: {
    perRun: "string", acrossRuns: {center: "string", spread: "string"}, contrast: "string",
    pairs: [{id: "string", minuend: "string", subtrahend: "string", hypothesis: "string"}],
    intervals: "string",
    interval: {level: "number", method: "string", resamples: "number", seed: "number",
      prng: {algorithm: "string", step: "string", knownAnswer: {seed: "number", first: ["number"]}}, unitOfResampling: "string", stream: "string", bounds: "string"},
    multiplicity: {family: "string", method: "string", alphaTwoSided: "number", alphaOneSided: "number", pValues: "string", procedure: "string", effect: "string",
      outsideTheFamily: "string"},
    outliers: "string", analysis: "string"
  },
  decisionRule: {
    scope: "string",
    margin: {formula: "string", relative: "number", relativeTo: "string", floor: {value: "number", unit: "string"}, source: "string"},
    orientation: "string",
    categories: [{id: "string", means: "string", when: "object"}],
    nonInferior: {when: "object", reportedAs: "string"},
    fpsGain: "string", perAxis: "string",
    singleObservation: {applies: ["string"], rule: "string"},
    deterministic: {applies: ["string"], rule: "string"},
    absoluteBudget: "string",
    partialReport: {when: "string", report: "string", timeBox: "string"}
  },
  thresholds: [{id: "string", rule: "string", source: "string", frozenValue: "null|number|string|boolean|object|array", frozenAt: "null|string"}],
  invalidation: [{id: "string", rule: "string", action: "string"}],
  iphone: {when: "string", rule: "string", noGo: "string"},
  open: [{id: "string", text: "string"}],
  report: {sections: [{id: "string", holds: "string"}]}
};

// ---- the decision rule, evaluated from the JSON ----
const compare = {"<": (a, b) => a < b, "<=": (a, b) => a <= b, ">": (a, b) => a > b, ">=": (a, b) => a >= b};
const holds = (condition, interval, margin) => {
  if (Object.hasOwn(condition, "all")) {
    return condition.all.every(inner => holds(inner, interval, margin));
  }
  if (Object.hasOwn(condition, "any")) {
    return condition.any.some(inner => holds(inner, interval, margin));
  }
  const endpoint = {lower: interval[0], upper: interval[1]}[condition.endpoint];
  const bound = {margin, "-margin": -margin}[condition.bound];
  assert.ok(endpoint !== undefined && bound !== undefined && Object.hasOwn(compare, condition.op), `a well-formed leaf: ${JSON.stringify(condition)}`);
  return compare[condition.op](endpoint, bound);
};
const orient = (interval, orientation) => (orientation === "higherIsBetter" ? [-interval[1], -interval[0]] : interval);
const categoriesOf = (interval, margin, orientation = "lowerIsBetter", categories = protocol.decisionRule.categories) => {
  const oriented = orient(interval, orientation);
  return categories.filter(category => holds(category.when, oriented, margin)).map(category => category.id);
};
const classify = (interval, margin, orientation) => {
  const held = categoriesOf(interval, margin, orientation);
  assert.equal(held.length, 1, `exactly one category for [${interval}] with margin ${margin}: ${held}`);
  return held[0];
};
const nonInferior = (interval, margin, orientation = "lowerIsBetter") => holds(protocol.decisionRule.nonInferior.when, orient(interval, orientation), margin);
// The same four categories coded by hand, to be compared with the JSON's.
const reference = (lower, upper, margin) => {
  if (upper < -margin) {
    return "gain";
  }
  if (lower > margin) {
    return "cost";
  }
  if (lower >= -margin && upper <= margin) {
    return "neutral";
  }
  return "inconclusive";
};
const marginOf = (medianOfB, rule = protocol.decisionRule.margin) => Math.max(rule.relative * medianOfB, rule.floor.value);
const close = (actual, expected) => Math.abs(actual - expected) < 1e-12;
const signed = value => (value > 0 ? `+${value}` : String(value));
const shown = interval => `[${signed(interval[0])}, ${signed(interval[1])}]`;

// The examples of the research note: B's median, the interval of C minus B, and what the rule says.
const EXAMPLES = [
  {medianOfB: 8, margin: 0.8, interval: [-3.1, -1.2], category: "gain", nonInferior: true},
  {medianOfB: 8, margin: 0.8, interval: [-0.6, 0.7], category: "neutral", nonInferior: true},
  {medianOfB: 8, margin: 0.8, interval: [0.9, 2.4], category: "cost", nonInferior: false},
  {medianOfB: 8, margin: 0.8, interval: [-2, 0.3], category: "inconclusive", nonInferior: true},
  {medianOfB: 8, margin: 0.8, interval: [-0.5, 1.5], category: "inconclusive", nonInferior: false},
  {medianOfB: 8, margin: 0.8, interval: [-1, -0.8], category: "inconclusive", nonInferior: true},
  {medianOfB: 3, margin: 0.5, interval: [-0.4, 0.4], category: "neutral", nonInferior: true},
  {medianOfB: 3, margin: 0.5, interval: [0.6, 1.1], category: "cost", nonInferior: false}
];

// ---- the Holm guard ----
const holmStands = (pValues, alpha) => {
  const order = pValues.map((p, index) => [p, index]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const stands = pValues.map(() => false);
  for (let rank = 0; rank < order.length; ++rank) {
    if (order[rank][0] > alpha / (order.length - rank)) {
      break;
    }
    stands[order[rank][1]] = true;
  }
  return stands;
};
const guarded = (categories, stands) => categories.map((category, index) => (stands[index] ? category : "inconclusive"));
const claimPValue = (differences, margin) => {
  const count = predicate => differences.filter(predicate).length;
  const total = differences.length + 1;
  const gain = (1 + count(d => d >= -margin)) / total;
  const cost = (1 + count(d => d <= margin)) / total;
  const neutral = Math.max((1 + count(d => d <= -margin)) / total, (1 + count(d => d >= margin)) / total);
  return Math.min(gain, cost, neutral);
};

// ---- the statistics ----
const mulberry32 = seed => {
  let a = seed | 0;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
};
const ascending = values => [...values].sort((a, b) => a - b);
const nearestRank = (values, percent) => ascending(values)[Math.ceil(percent * values.length / 100) - 1];
const median = values => {
  const sorted = ascending(values);
  const middle = sorted.length / 2;
  return sorted.length % 2 === 1 ? sorted[Math.floor(middle)] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const iqr = values => {
  const sorted = ascending(values);
  return sorted[Math.ceil(3 * sorted.length / 4) - 1] - sorted[Math.ceil(sorted.length / 4) - 1];
};
const bootstrapDifferences = (minuend, subtrahend, {seed, resamples}) => {
  const next = mulberry32(seed);
  const resample = values => values.map(() => values[Math.floor(next() * values.length)]);
  const differences = [];
  for (let index = 0; index < resamples; ++index) {
    const drawnMinuend = resample(minuend);
    const drawnSubtrahend = resample(subtrahend);
    differences.push(median(drawnMinuend) - median(drawnSubtrahend));
  }
  return differences;
};
const intervalOf = (differences, level) => {
  const sorted = ascending(differences);
  const lowerRank = Math.round(sorted.length * (1 - level) / 2);
  return [sorted[lowerRank - 1], sorted[sorted.length - lowerRank - 1]];
};

const positionsOf = sequence => {
  const positions = [{A: 0, B: 0, C: 0}, {A: 0, B: 0, C: 0}, {A: 0, B: 0, C: 0}];
  for (const block of sequence) {
    [...block].forEach((arm, position) => {
      ++positions[position][arm];
    });
  }
  return positions;
};

// ---- tests ----
test("the protocol has every required field with its type, and the validator is not vacuous", () => {
  assert.deepEqual(errorsOf(protocol), []);
  assert.deepEqual([protocol.schemaVersion, protocol.milestone, protocol.item, protocol.criterion, protocol.reactNative], [1, "0.5", "V05-10", "protocolo", "0.87.1"]);
  assert.match(protocol.status, /^pre-registered/);
  const missing = structuredClone(protocol);
  delete missing.statistics.interval.seed;
  assert.deepEqual(errorsOf(missing), ["$.statistics.interval.seed: missing"]);
  const wrong = structuredClone(protocol);
  wrong.runs.load.limit1MinuteAverage = "2.0";
  wrong.windows = [];
  assert.deepEqual(errorsOf(wrong), ["$.windows: expected a non-empty array", "$.runs.load.limit1MinuteAverage: expected number, got string"]);
});

test("the three arms, the three hypotheses and the four windows are the ones decided", () => {
  assert.deepEqual(protocol.arms.map(arm => arm.id), ["A", "B", "C"]);
  assert.match(protocol.arms[0].role, /cost control/);
  assert.deepEqual(protocol.hypotheses.map(h => [h.id, h.contrast.minuend, h.contrast.subtrahend]), [["H1", "C", "A"], ["H2", "B", "A"], ["H3", "C", "B"]]);
  const h3 = protocol.hypotheses[2];
  assert.equal(h3.nullHypothesis, "C is not better than B");
  assert.match(h3.validResult, /no gain is a valid result/);
  assert.deepEqual(protocol.statistics.pairs.map(pair => [pair.id, pair.hypothesis]), [["C-A", "H1"], ["B-A", "H2"], ["C-B", "H3"]]);
  assert.deepEqual(protocol.windows.map(window => window.id), ["ai-phase", "event-burst", "context-switches", "stress"]);
  const steps = protocol.runs.script.map(step => step.step);
  for (const window of protocol.windows) {
    assert.ok(steps.includes(window.scenario), `${window.id}: its scenario is a step of the script`);
    assert.deepEqual(window.arms, ["A", "B", "C"], window.id);
  }
  // The soak has 100 turns, so a turn-based window has 100 occurrences; the switches and the rounds follow the V05-06 baseline's warm-up rule.
  assert.deepEqual(protocol.windows.map(window => [window.warmupOccurrences, window.measuredOccurrences]), [[2, 98], [2, 98], [24, 50], [2, 30]]);
  assert.match(protocol.runs.fixed.soak, /^100 turns/);
  assert.equal(protocol.windows[0].warmupOccurrences + protocol.windows[0].measuredOccurrences, 100);
  assert.equal(protocol.idleReference.frames, 600);
  // The primary outcome: the p95 of the CPU time per frame, in ms, lower is better, analysed in each window apart.
  assert.deepEqual([protocol.primaryOutcome.id, protocol.primaryOutcome.unit, protocol.primaryOutcome.orientation], ["cpu-time-p95", "ms", "lowerIsBetter"]);
  assert.match(protocol.primaryOutcome.quantity, /never the interval between frames/);
  assert.equal(protocol.vsync.unlimitedFpsRequires, "DISABLED");
  assert.match(protocol.vsync.readBack, /window_get_vsync_mode/);
});

test("the secondary outcomes are the ones decided, and each axis with a verdict carries its margin", () => {
  const ids = protocol.secondaryOutcomes.map(outcome => outcome.id);
  assert.deepEqual(ids, ["cpu-time-p50", "cpu-time-p99", "frames-above-twice-idle-reference", "frames-above-100-ms", "click-to-panel", "rss", "hermes-heap", "scene-nodes",
    "time-to-interactive-hud", "fps-unlimited", "package-size", "change-cost"]);
  assert.equal(new Set(ids).size, ids.length);
  for (const outcome of protocol.secondaryOutcomes) {
    if (outcome.verdict) {
      assert.ok(["lowerIsBetter", "higherIsBetter"].includes(outcome.orientation), `${outcome.id}: its orientation`);
      assert.equal(outcome.margin.relative, 0.1, outcome.id);
      assert.ok(outcome.margin.floor === null || (outcome.margin.floor.value > 0 && typeof outcome.margin.floor.unit === "string"), outcome.id);
    } else {
      assert.equal(outcome.margin, undefined, `${outcome.id} is descriptive: no margin`);
    }
  }
  const fps = protocol.secondaryOutcomes.find(outcome => outcome.id === "fps-unlimited");
  assert.deepEqual([fps.orientation, fps.requiresIntervalExcludingZero], ["higherIsBetter", true]);
  assert.deepEqual(protocol.secondaryOutcomes.filter(outcome => outcome.arms.join("") === "C").map(outcome => outcome.id), ["hermes-heap"]);
  // Every axis the decision rule handles apart is an axis of the outcomes.
  for (const id of [...protocol.decisionRule.singleObservation.applies, ...protocol.decisionRule.deterministic.applies]) {
    assert.ok(ids.includes(id), id);
  }
});

test("only the thresholds can be frozen, each with a rule and a source, and both fields move together", () => {
  const holders = [];
  const walk = (value, where) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${where}[${index}]`));
    } else if (value !== null && typeof value === "object") {
      if (FREEZE_KEYS.some(key => Object.hasOwn(value, key))) {
        holders.push(where);
      }
      Object.entries(value).forEach(([key, inner]) => walk(inner, `${where}.${key}`));
    }
  };
  walk(protocol, "$");
  assert.deepEqual(holders, protocol.thresholds.map((_, index) => `$.thresholds[${index}]`), "no field outside `thresholds` carries a freeze field (it would escape the pin)");
  const ids = protocol.thresholds.map(threshold => threshold.id);
  assert.deepEqual(ids, ["cpu-time-instrument", "budget-p95-ai-phase", "budget-p95-event-burst", "budget-p95-context-switches", "budget-p95-stress"]);
  for (const threshold of protocol.thresholds) {
    assert.ok(threshold.rule.length > 0 && threshold.source.length > 0, threshold.id);
    assert.equal(threshold.frozenValue === null, threshold.frozenAt === null, `${threshold.id}: the value and the date are filled together`);
  }
  // The freeze is one act: either no threshold is frozen yet (each is a formula and a null) or all are, on the same date.
  assert.equal(new Set(protocol.thresholds.map(threshold => threshold.frozenValue === null)).size, 1, "frozen all together or not at all");
  assert.equal(new Set(protocol.thresholds.map(threshold => threshold.frozenAt)).size, 1, "frozen on one date");
  assert.equal(protocol.primaryOutcome.instrument, "thresholds.cpu-time-instrument");
});

test("the pin: the protocol without its freeze fields has the SHA-256 recorded here", () => {
  assert.equal(PINS.length, protocol.amendments.length + 1, "every amendment has its pin, and every pin after the pre-registration has its amendment");
  assert.equal(pinOf(protocol), PINNED_SHA256,
    "the protocol changed after its pre-registration: this is an amendment, so add an entry to `amendments`, list it in the research note and add its pin on purpose");
  // The freeze moves nothing of the pin.
  const frozen = structuredClone(protocol);
  frozen.thresholds.forEach(threshold => {
    threshold.frozenValue = 4.5;
    threshold.frozenAt = "2026-10-20";
  });
  assert.equal(pinOf(frozen), PINNED_SHA256);
  // Any other change moves it, in the text, in a number, in the order of a list and in a key.
  const edits = [
    clone => {
      clone.statistics.interval.resamples = 9999;
    },
    clone => {
      clone.decisionRule.margin.floor.value = 0.4;
    },
    clone => {
      clone.runs.sequence.reverse();
    },
    clone => {
      clone.hypotheses[2].nullHypothesis = "C is better than B";
    },
    clone => {
      clone.thresholds[0].rule = "another rule";
    },
    clone => {
      clone.extra = true;
    }
  ];
  for (const edit of edits) {
    const edited = structuredClone(protocol);
    edit(edited);
    assert.notEqual(pinOf(edited), PINNED_SHA256, edit.toString());
  }
  // The canonical form does not depend on the order of the keys or the formatting of the file.
  assert.equal(canonical({b: 1, a: [2, {d: 4, c: 3}]}), canonical(JSON.parse('{ "a": [2, {"c": 3, "d": 4}], "b": 1 }')));
});

// ---- the amendments: what a change after the pre-registration has to carry ----
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const executionCriterion = migration.milestones.find(milestone => milestone.id === "0.5").items.find(item => item.id === "V05-10").criteria.find(criterion => criterion.id === "execucao");
// What is wrong with the amendments of a protocol, given whether the criterion `execucao` (the comparative measurements) has run: each entry has a date, what changed,
// why, the text it replaces and the number of comparative measurements made before it, which is 0 while nothing has run; the dates do not go back; and the state of the
// protocol is the pinned one for the number of entries it carries.
const amendmentErrors = (candidate, executionDone) => {
  const errors = [];
  candidate.amendments.forEach((amendment, index) => {
    const where = `amendments[${index}]`;
    if (!ISO_DATE.test(amendment.date)) {
      errors.push(`${where}: its date is not YYYY-MM-DD`);
    }
    for (const key of ["what", "why", "before"]) {
      if (amendment[key].trim().length === 0) {
        errors.push(`${where}: ${key} is empty`);
      }
    }
    if (!Number.isInteger(amendment.measurementsBefore) || amendment.measurementsBefore < 0) {
      errors.push(`${where}: measurementsBefore is not a count`);
    } else if (!executionDone && amendment.measurementsBefore !== 0) {
      errors.push(`${where}: measurementsBefore is ${amendment.measurementsBefore} but no comparative execution has run`);
    }
    if (index > 0 && amendment.date < candidate.amendments[index - 1].date) {
      errors.push(`${where}: its date goes back`);
    }
  });
  if (PINS.length !== candidate.amendments.length + 1 || pinOf(candidate) !== PINS[candidate.amendments.length]) {
    errors.push("the protocol is not the one pinned for its number of amendments");
  }
  return errors;
};

test("an amendment says what changed, why, the text it replaces and that no comparative measurement came before it", () => {
  assert.equal(protocol.amendments.length, 2);
  assert.equal(executionCriterion.done, false, "the comparative executions have not run: when they do, the amendments after them count measurements");
  assert.deepEqual(amendmentErrors(protocol, executionCriterion.done), []);
  assert.deepEqual(protocol.amendments.map(amendment => amendment.date), ["2026-10-09", "2026-10-09"]);
  assert.deepEqual(protocol.amendments.map(amendment => amendment.measurementsBefore), [0, 0]);
  assert.match(protocol.amendments[0].before, /the median CPU time of those frames is the run's idle median/, "it keeps the text it replaced");
  assert.doesNotMatch(JSON.stringify(protocol.idleReference), /idle median/, "and the protocol no longer says it");
  assert.match(protocol.idleReference.rule, /half-sums of the consecutive pairs of the per-frame values/);
  // The reference is of the same quantity as what it is compared with, each in its use: the CPU time per frame for the secondary outcome (the instrument of the
  // primary outcome) and the elapsed intervals between process frames for the pacing clause of `not-presented`.
  assert.match(protocol.idleReference.rule, /secondary outcome 'frames above twice the idle reference' the values are the CPU time per frame, read by the instrument of the primary outcome \(thresholds\.cpu-time-instrument\)/);
  assert.match(protocol.idleReference.rule, /pacing clause of the not-presented rule the values are the elapsed intervals between process frames/);
  const secondary = protocol.secondaryOutcomes.find(outcome => outcome.id === "frames-above-twice-idle-reference");
  assert.match(secondary.label, /^Frames of a window whose CPU time is above twice the run's idle reference \(the median of the half-sums of consecutive pairs of the CPU time per frame of the idle window\)$/);
  assert.match(protocol.invalidation.find(rule => rule.id === "not-presented").rule, /half-sums of consecutive pairs of the elapsed intervals between process frames of the idle window/);
  assert.match(protocol.primaryOutcome.quantity, /CPU time of the main thread/, "and the primary outcome does not change");
  for (const [index, amendment] of protocol.amendments.entries()) {
    const section = doc.slice(doc.indexOf("\n## Amendments\n"), doc.indexOf("\n## Reproducing\n"));
    assert.ok(section.includes(amendment.date) && section.includes(PINS[index + 1]), `the research note lists the amendment of ${amendment.date} with its pin`);
  }
});

test("arm B's time-box has its length, recorded before arm B starts, and the iPhone's open item follows the NO-GO", () => {
  const [, timeBox] = protocol.amendments;
  assert.match(timeBox.before, /its length is set and recorded before arm B starts/, "it keeps the text it replaced");
  assert.match(timeBox.before, /its time-box has no length yet/);
  assert.match(timeBox.before, /the iPhone depends on the GO or NO-GO of V05-09/);
  const box = protocol.decisionRule.partialReport.timeBox;
  assert.match(box, /^the same as arm C's plus one optimization pass, counted as the active time of the subagents/, "the rule of the pre-registration stays its first words");
  assert.match(box, /gaps shorter than 30 minutes between consecutive timestamped events/);
  // The three numbers agree with one another: the pass is a quarter of C's time and the box is their sum.
  const hours = pattern => Number.parseFloat(box.match(pattern)[1]);
  const armC = hours(/took (\d+\.\d) h by that count/);
  const pass = hours(/one optimization pass of at most (\d+\.\d) h \(a quarter of C's\)/);
  const total = hours(/In all (\d+\.\d) h/);
  assert.deepEqual([armC, pass, total], [12.8, 3.2, 16]);
  assert.equal(pass.toFixed(1), (armC / 4).toFixed(1));
  assert.equal(total.toFixed(1), (armC + pass).toFixed(1));
  assert.match(box, /`parity`/, "arm B is ready when the parity rule passes");
  const open = Object.fromEntries(protocol.open.map(item => [item.id, item.text]));
  assert.doesNotMatch(open["arm-b"], /no length yet/);
  assert.match(open["arm-b"], /decisionRule\.partialReport\.timeBox/);
  assert.match(open.iphone, /NO-GO/);
  assert.equal(protocol.iphone.noGo, "the comparison covers macOS only", "the NO-GO branch of the iPhone block is the one that applies, and it does not change");
});

test("a change of the protocol after the pre-registration fails unless it comes with an amendment and a pin", () => {
  // Changing the idle reference back, or any other text, without an entry in `amendments`.
  const silent = structuredClone(protocol);
  silent.idleReference.rule = "after the boot, 600 consecutive frames; the median CPU time of those frames is the run's idle median";
  assert.deepEqual(amendmentErrors(silent, false), ["the protocol is not the one pinned for its number of amendments"]);
  const silentOutcome = structuredClone(protocol);
  silentOutcome.secondaryOutcomes[2].label = "Frames of a window above twice the idle median";
  assert.deepEqual(amendmentErrors(silentOutcome, false), ["the protocol is not the one pinned for its number of amendments"]);
  // Removing the list of amendments, or an entry, leaves the changes without their record.
  const erased = structuredClone(protocol);
  erased.amendments = [];
  assert.deepEqual(amendmentErrors(erased, false), ["the protocol is not the one pinned for its number of amendments"]);
  // An entry without a pin: the number of pins and the number of amendments move together.
  const unpinned = structuredClone(protocol);
  unpinned.amendments.push({...protocol.amendments[0], date: "2026-10-10"});
  assert.deepEqual(amendmentErrors(unpinned, false), ["the protocol is not the one pinned for its number of amendments"]);
  // The record is part of the pin: rewriting what it says is also a change.
  const rewritten = structuredClone(protocol);
  rewritten.amendments[0].why = "another reason";
  assert.deepEqual(amendmentErrors(rewritten, false), ["the protocol is not the one pinned for its number of amendments"]);
});

test("while the comparative executions have not run, an amendment cannot count measurements before it", () => {
  const counted = structuredClone(protocol);
  counted.amendments[0].measurementsBefore = 2;
  assert.ok(amendmentErrors(counted, false).includes("amendments[0]: measurementsBefore is 2 but no comparative execution has run"));
  assert.ok(!amendmentErrors(counted, true).some(error => /measurementsBefore/.test(error)), "once the criterion has run, the count is a count");
  const incomplete = structuredClone(protocol);
  incomplete.amendments[0].why = " ";
  incomplete.amendments[0].date = "yesterday";
  assert.ok(amendmentErrors(incomplete, false).includes("amendments[0]: why is empty"));
  assert.ok(amendmentErrors(incomplete, false).includes("amendments[0]: its date is not YYYY-MM-DD"));
  assert.deepEqual(errorsOf(Object.fromEntries(Object.entries(protocol).filter(([key]) => key !== "amendments"))), ["$.amendments: missing"]);
});

test("the categories are exactly gain, neutral, cost and inconclusive, and exclusive and exhaustive for any interval", () => {
  assert.deepEqual(protocol.decisionRule.categories.map(category => category.id), ["gain", "neutral", "cost", "inconclusive"]);
  const seen = new Set();
  let intervals = 0;
  const values = [];
  for (let value = -4; value <= 4; value += 0.25) {
    values.push(value);
  }
  for (const margin of [0.25, 0.5, 0.75, 1, 2]) {
    for (const lower of values) {
      for (const upper of values.filter(value => value >= lower)) {
        const held = categoriesOf([lower, upper], margin);
        assert.equal(held.length, 1, `[${lower}, ${upper}] with margin ${margin} holds ${held}`);
        assert.equal(held[0], reference(lower, upper, margin), `[${lower}, ${upper}] with margin ${margin}`);
        seen.add(held[0]);
        ++intervals;
      }
    }
  }
  assert.ok(intervals > 2000, `${intervals} intervals checked`);
  assert.deepEqual([...seen].sort(), ["cost", "gain", "inconclusive", "neutral"], "the grid reaches every category");
  // A degenerate interval (a point) is still in exactly one category, including on the margin itself.
  assert.deepEqual([-1, -0.5, 0, 0.5, 1].map(point => classify([point, point], 0.5)), ["gain", "neutral", "neutral", "neutral", "cost"]);
  // The check is not vacuous: a gain that includes -margin overlaps the neutral rule on the point -margin.
  const loose = structuredClone(protocol.decisionRule.categories);
  loose[0].when.all[0].op = "<=";
  assert.equal(categoriesOf([-0.5, -0.5], 0.5, "lowerIsBetter", loose).length, 2);
  assert.equal(categoriesOf([-0.5, -0.5], 0.5).length, 1);
});

test("the margin is the larger of 10% of B's median and 0.5 ms, and the examples land where the research note says", () => {
  const rule = protocol.decisionRule.margin;
  assert.deepEqual([rule.relative, rule.floor.value, rule.floor.unit], [0.1, 0.5, "ms"]);
  for (const [medianOfB, expected] of [[8, 0.8], [3, 0.5], [5, 0.5], [6, 0.6], [20, 2], [0, 0.5]]) {
    assert.ok(close(marginOf(medianOfB), expected), `B median ${medianOfB} gives margin ${expected}`);
  }
  for (const example of EXAMPLES) {
    assert.ok(close(marginOf(example.medianOfB), example.margin), `${shown(example.interval)}: the margin of B's median ${example.medianOfB}`);
    assert.equal(classify(example.interval, example.margin), example.category, shown(example.interval));
    assert.equal(nonInferior(example.interval, example.margin), example.nonInferior, `${shown(example.interval)}: non-inferior`);
    assert.ok(doc.includes(shown(example.interval)), `the research note shows ${shown(example.interval)}`);
  }
  // Non-inferior is a flag beside the category: an interval that crosses only -margin is inconclusive and still non-inferior.
  assert.deepEqual([classify([-2, 0.3], 0.8), nonInferior([-2, 0.3], 0.8)], ["inconclusive", true]);
  // "inconclusive" is never rounded to "neutral": an interval that is almost inside the margin is not neutral.
  assert.equal(classify([-0.8000001, 0.8], 0.8), "inconclusive");
  assert.equal(classify([-0.8, 0.8], 0.8), "neutral");
});

test("a gain is always better: the interval of an outcome where higher is better is negated, and a gain in FPS excludes zero", () => {
  assert.equal(protocol.decisionRule.orientation.includes("negated"), true);
  // FPS: B's median 1000 gives a margin of 100.
  const margin = marginOf(1000, {relative: 0.1, floor: {value: 0}});
  assert.ok(close(margin, 100));
  assert.equal(classify([120, 300], margin, "higherIsBetter"), "gain");
  assert.equal(classify([-300, -120], margin, "higherIsBetter"), "cost");
  assert.equal(classify([-50, 60], margin, "higherIsBetter"), "neutral");
  assert.equal(classify([20, 300], margin, "higherIsBetter"), "inconclusive");
  for (let lower = -400; lower <= 400; lower += 20) {
    for (let upper = lower; upper <= 400; upper += 20) {
      if (classify([lower, upper], margin, "higherIsBetter") === "gain") {
        assert.ok(lower > 0, `a gain in FPS has an interval above zero: [${lower}, ${upper}]`);
      }
    }
  }
});

test("Holm over the four windows of H3 stands for the smallest p-values in order and only ever downgrades", () => {
  const multiplicity = protocol.statistics.multiplicity;
  assert.deepEqual([multiplicity.method, multiplicity.alphaTwoSided, multiplicity.alphaOneSided], ["Holm", 0.05, 0.025]);
  assert.equal(multiplicity.alphaOneSided, multiplicity.alphaTwoSided / 2);
  assert.match(multiplicity.family, /four primary windows of H3/);
  const alpha = multiplicity.alphaOneSided;
  assert.deepEqual(holmStands([0.001, 0.02, 0.2, 0.004], alpha), [true, false, false, true]);
  assert.deepEqual(holmStands([0.001, 0.002, 0.003, 0.004], alpha), [true, true, true, true]);
  // Each of these is under 0.025, and none stands: the smallest is over 0.025 / 4.
  assert.deepEqual(holmStands([0.01, 0.02, 0.03, 0.04], alpha), [false, false, false, false]);
  // The step-down stops at the first p-value that fails.
  assert.deepEqual(holmStands([0.001, 0.02, 0.0001, 0.3], alpha), [true, false, true, false]);
  assert.deepEqual(holmStands([0.025, 0.5, 0.5, 0.5], 0.025), [false, false, false, false]);
  assert.deepEqual(guarded(["gain", "neutral", "cost", "inconclusive"], [true, false, true, true]), ["gain", "inconclusive", "cost", "inconclusive"]);
  assert.deepEqual(guarded(["gain", "neutral", "cost", "inconclusive"], [false, false, false, false]), ["inconclusive", "inconclusive", "inconclusive", "inconclusive"]);

  // The one-sided bootstrap p-value of the claim a window makes.
  const resamples = protocol.statistics.interval.resamples;
  const spread = Array.from({length: resamples}, (_, index) => -3 + 6 * index / (resamples - 1));
  assert.ok(claimPValue(spread, 1) > 0.3, "a wide spread supports no claim");
  assert.equal(claimPValue(Array(resamples).fill(-5), 1), 1 / (resamples + 1), "every resample far below -margin supports a gain");
  assert.equal(claimPValue(Array(resamples).fill(5), 1), 1 / (resamples + 1), "every resample far above +margin supports a cost");
  assert.equal(claimPValue(Array(resamples).fill(0), 1), 1 / (resamples + 1), "every resample inside the margin supports neutral");
  assert.ok(claimPValue(Array(resamples).fill(1), 1) > 0.9, "resamples on the margin support no claim");
});

test("the order of the executions is a Latin square repeated, balanced in count and position", () => {
  const {blocks, repetitions, sequence, perArm, minimumPerArm} = protocol.runs;
  assert.deepEqual(blocks, ["ABC", "CAB", "BCA"]);
  assert.equal(sequence.length, blocks.length * repetitions);
  assert.deepEqual(sequence, Array.from({length: repetitions}, () => blocks).flat());
  assert.ok(sequence.every(block => block.length === 3 && [...block].sort().join("") === "ABC"), "every block holds each arm once");
  const positions = positionsOf(sequence);
  const counts = {A: 0, B: 0, C: 0};
  for (const position of positions) {
    for (const arm of Object.keys(counts)) {
      counts[arm] += position[arm];
    }
  }
  assert.deepEqual(counts, {A: perArm, B: perArm, C: perArm}, "each arm the same number of times");
  for (const position of positions) {
    assert.deepEqual(position, {A: perArm / 3, B: perArm / 3, C: perArm / 3}, "each arm the same number of times in each position");
  }
  // Across the three blocks of a square, each arm takes each position once.
  for (let position = 0; position < 3; ++position) {
    assert.deepEqual(blocks.map(block => block[position]).sort(), ["A", "B", "C"]);
  }
  assert.ok(perArm >= minimumPerArm && minimumPerArm === 10, "at least 10 per arm");
  assert.equal(perArm % blocks.length, 0, "a multiple of the number of blocks, or the positions cannot balance");
  assert.equal(perArm, repetitions * blocks.length);
  assert.equal(perArm, sequence.length, "an execution of an arm for each block");
  assert.deepEqual(protocol.runs.lanes.map(lane => lane.id), ["presented", "unlimited"]);
  // The check is not vacuous: swapping one block for another permutation keeps the counts and breaks the positions.
  const skewed = [...sequence];
  skewed[1] = "ABC";
  assert.notDeepEqual(positionsOf(skewed), positionsOf(sequence));
  assert.ok(positionsOf(skewed).some(position => position.A !== perArm / 3));
});

test("the load limit is written and the redo of an execution is bounded", () => {
  const {load} = protocol.runs;
  assert.equal(load.command, "sysctl vm.loadavg");
  assert.equal(load.limit1MinuteAverage, 2);
  assert.match(load.read, /before .* after/);
  assert.match(load.redo, /at most 3 attempts per slot/);
  assert.deepEqual(protocol.invalidation.map(rule => rule.id), ["load", "not-presented", "not-the-registered-build", "other-game", "errors", "parity", "vsync-reading",
    "incomplete", "instrument"]);
  assert.match(protocol.runs.warmup, /first 2 occurrences/);
});

test("the percentiles, the median, the interquartile range and the bootstrap are defined and reproducible", () => {
  const stats = protocol.statistics;
  assert.deepEqual([stats.interval.level, stats.interval.method.startsWith("percentile bootstrap"), stats.interval.resamples, stats.interval.seed], [0.95, true, 10000, 20261009]);
  // Nearest rank, as the V05-06 baseline and the GF-30 oracle compute it.
  const hundred = Array.from({length: 100}, (_, index) => index + 1);
  assert.deepEqual([50, 95, 99].map(percent => nearestRank(hundred, percent)), [50, 95, 99]);
  assert.equal(nearestRank(Array.from({length: 98}, (_, index) => index + 1), 95), 94);
  assert.equal(nearestRank([3, 1, 2], 95), 3);
  // With 5 runs the median is the third value and the IQR the fourth minus the second, as the baseline does; with 12 the ranks are 3 and 9.
  assert.deepEqual([median([5, 1, 3, 2, 4]), iqr([5, 1, 3, 2, 4])], [3, 2]);
  assert.deepEqual([median([4, 1, 3, 2]), iqr(Array.from({length: 12}, (_, index) => index + 1))], [2.5, 6]);

  // The generator and its known answer, so that another implementation can check itself against the protocol.
  const next = mulberry32(stats.interval.prng.knownAnswer.seed);
  assert.equal(stats.interval.prng.knownAnswer.seed, stats.interval.seed);
  assert.deepEqual(stats.interval.prng.knownAnswer.first.map(() => next()), stats.interval.prng.knownAnswer.first);

  const minuend = [5.2, 5.0, 5.4, 5.1, 5.3, 5.6, 5.2, 5.5, 5.1, 5.4, 5.3, 5.2];
  const subtrahend = [4.1, 4.3, 4.0, 4.2, 4.4, 4.1, 4.5, 4.2, 4.0, 4.3, 4.2, 4.1];
  const differences = bootstrapDifferences(minuend, subtrahend, stats.interval);
  assert.equal(differences.length, 10000);
  assert.deepEqual(differences, bootstrapDifferences(minuend, subtrahend, stats.interval), "the same seed gives the same resamples");
  assert.notDeepEqual(differences, bootstrapDifferences(minuend, subtrahend, {...stats.interval, seed: stats.interval.seed + 1}));
  const [lower, upper] = intervalOf(differences, stats.interval.level);
  assert.ok(lower <= median(minuend) - median(subtrahend) && median(minuend) - median(subtrahend) <= upper, "the interval holds the observed difference");
  // The ranks the protocol names: 250 and 9750 of 10,000.
  const sorted = ascending(differences);
  assert.deepEqual([lower, upper], [sorted[249], sorted[9749]]);
  assert.match(stats.interval.bounds, /rank 250 and 9750/);
  // A pinned example, so that a change of the algorithm shows.
  assert.deepEqual([lower, upper].map(value => value.toFixed(6)), ["0.900000", "1.250000"]);
  // A degenerate sample has a point interval, and an arm identical to the other has an interval around zero.
  assert.deepEqual(intervalOf(bootstrapDifferences([2, 2, 2], [1, 1, 1], {seed: 1, resamples: 1000}), 0.95), [1, 1]);
  const same = intervalOf(bootstrapDifferences(minuend, minuend, stats.interval), 0.95);
  assert.ok(same[0] < 0 && same[1] > 0, `identical arms: an interval around zero, got [${same}]`);
});

test("the research note covers the protocol it reads and quotes its pin and its examples", () => {
  for (const heading of ["Hypotheses", "Outcomes", "The active windows", "Executions", "Statistics", "The decision rule", "What is open", "What invalidates an execution",
    "The final report", "The pin", "Amendments"]) {
    assert.match(doc, new RegExp(`^## ${heading}$`, "m"), heading);
  }
  for (const id of [...protocol.hypotheses.map(h => h.id), ...protocol.windows.map(window => window.id), ...protocol.thresholds.map(threshold => threshold.id),
    ...protocol.invalidation.map(rule => rule.id), ...protocol.report.sections.map(section => section.id), ...protocol.runs.lanes.map(lane => lane.id)]) {
    assert.ok(doc.includes(`\`${id}\``), `the research note names \`${id}\``);
  }
  for (const text of [String(protocol.statistics.interval.seed), String(protocol.statistics.interval.resamples).replace(/(\d)(?=(\d{3})$)/, "$1,"), ...protocol.runs.blocks,
    "frozenValue", "frozenAt", "mulberry32", ...PINS, protocol.baseline.evidence.replace(/^docs\//, "")]) {
    assert.ok(doc.includes(text), `the research note has ${text}`);
  }
  assert.match(doc, /claims no result|states no result/);
});

test("this test is part of the contracts", () => {
  const scripts = JSON.parse(read("package.json")).scripts;
  assert.ok(scripts["test:contracts"].split("&&").some(command => command.includes("tests/frontier-comparison-protocol.test.mjs")), "test:contracts runs this test");
});
