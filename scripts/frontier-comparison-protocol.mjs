// What the analysis of the final comparison of the 0.5 Frontier (V05-10) reads from docs/research/frontier-comparison-protocol.json besides plain numbers: who is the subject, the reference and
// the control of the comparison, the slots of the order of the executions, how each outcome is observed, and the few rules that the protocol states in words and not in data. The protocol is
// the source of truth; the code implements its rules and reads its numbers. Where a rule is a sentence, the sentence is checked here, so that an amendment that rewrites it fails loudly (the
// analysis would otherwise go on implementing the old sentence).

export const PRESENTED = "presented";
export const UNLIMITED = "unlimited";

// The roles of the arms, from the hypotheses and the pairs of statistics.pairs: the confirmatory hypothesis (H3) contrasts the subject (C) against the reference (B), and the other pair
// of the subject (C minus A, H1) is against the control (A). The estimate pairs are those that are not confirmatory (H1 and H2): their difference and interval are reported with no category.
export function rolesOf(protocol) {
  const confirmatory = protocol.hypotheses.filter((hypothesis) => hypothesis.nature.startsWith("confirmatory"));
  if (confirmatory.length !== 1) {
    throw new Error(`the protocol has ${confirmatory.length} confirmatory hypotheses, the analysis reads exactly one`);
  }
  const pairs = protocol.statistics.pairs;
  const decisionPair = pairs.find((pair) => pair.hypothesis === confirmatory[0].id);
  const controlPair = pairs.find((pair) => pair !== decisionPair && pair.minuend === decisionPair.minuend);
  return {
    subject: decisionPair.minuend,
    reference: decisionPair.subtrahend,
    control: controlPair.subtrahend,
    decisionPair,
    estimatePairs: pairs.filter((pair) => pair !== decisionPair),
  };
}

// runs.sequence, one slot for each arm of each block: the slot number (from 1, the position in the order of the executions), the block (from 0), the position in the block (from 0) and the arm.
export function slotsOf(protocol) {
  const slots = [];
  protocol.runs.sequence.forEach((block, blockIndex) => {
    [...block].forEach((arm, position) => {
      slots.push({ slot: slots.length + 1, block: blockIndex, position, arm });
    });
  });
  return slots;
}

// The id of the threshold that holds the absolute budget of a window (thresholds[].id): budget-p95-<window>.
export const budgetIdOf = (window) => `budget-p95-${window.id}`;

// How each secondary outcome is observed, by outcome id. The ones read once per execution have a key in the execution's `readings` and the shape of the value (kinds of
// frontier-comparison-format.mjs); the others are derived from fields the analysis already has, or come from the campaign's arm records.
export const READINGS = {
  "click-to-panel": { key: "clickToPanelFrames", shape: ["count"] },
  rss: { key: "rssMb", shape: { end: "measure", max: "measure" } },
  "hermes-heap": { key: "hermes", shape: { heapBytes: "count", nativeViews: "count" } },
  "scene-nodes": { key: "sceneNodes", shape: "count" },
  "time-to-interactive-hud": { key: "timeToInteractiveHudMs", shape: "measure" },
};
export const DERIVED_OUTCOMES = {
  "cpu-time-p50": "from the frames of each window",
  "cpu-time-p99": "from the frames of each window",
  "frames-above-twice-idle-reference": "from the frames of each window and the idle window",
  "frames-above-100-ms": "from the frames of each window",
  "fps-unlimited": "the `fps` of each window, in the unlimited lane",
  "package-size": "the two exports of each arm, in the campaign's `packages`",
  "change-cost": "the campaign's `changeCost`",
};

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function sentence(text, pattern, what) {
  const found = pattern.exec(text);
  if (found === null) {
    throw new Error(`the protocol no longer says ${what}: ${pattern}`);
  }
  return found;
}

// The rules that are words in the protocol:
//  - runs.load.redo: "at most 3 attempts per slot";
//  - invalidation `not-presented`: "a frame drawn after every measured intent and in at least nine of ten frames of the idle window" and "is under half of the refresh period read back";
//  - invalidation `other-game`: "a repeat of it in one arm stops the campaign".
export function proseRulesOf(protocol) {
  const rule = (id) => protocol.invalidation.find((candidate) => candidate.id === id);
  const attempts = sentence(protocol.runs.load.redo, /at most (\d+) attempts per slot/, "the attempts per slot");
  const drawn = sentence(rule("not-presented").rule, /in at least (\w+) of (\w+) frames of the idle window/, "the share of idle frames that must draw");
  sentence(rule("not-presented").rule, /is under half of the refresh period read back/, "the pacing clause");
  sentence(rule("other-game").action, /a repeat of it in one arm stops the campaign/, "that a repeat of the other game stops the campaign");
  return {
    maxAttempts: parseInt(attempts[1], 10),
    drawn: { atLeast: NUMBER_WORDS[drawn[1]], of: NUMBER_WORDS[drawn[2]] },
    pacedFraction: 0.5,
  };
}

// What stops the analysis from reading a protocol: the problems of the protocol as this analysis understands it, none for the protocol of the pre-registration and its amendments.
export function protocolErrors(protocol) {
  const errors = [];
  if (protocol.runs.lanes.map((lane) => lane.id).join() !== [PRESENTED, UNLIMITED].join()) {
    errors.push(`runs.lanes are not [${PRESENTED}, ${UNLIMITED}]`);
  }
  if (protocol.primaryOutcome.orientation !== "lowerIsBetter") {
    errors.push("the primary outcome is not lowerIsBetter, and the p-values of the Holm guard are oriented for that");
  }
  for (const outcome of protocol.secondaryOutcomes) {
    if (!Object.hasOwn(READINGS, outcome.id) && !Object.hasOwn(DERIVED_OUTCOMES, outcome.id)) {
      errors.push(`secondary outcome ${outcome.id}: the analysis does not know how it is observed`);
    }
  }
  const thresholds = new Set(protocol.thresholds.map((threshold) => threshold.id));
  for (const window of protocol.windows) {
    if (!thresholds.has(budgetIdOf(window))) {
      errors.push(`window ${window.id}: no threshold ${budgetIdOf(window)}`);
    }
  }
  if (protocol.runs.sequence.some((block) => block.length !== protocol.arms.length)) {
    errors.push("a block of runs.sequence does not hold each arm once");
  }
  try {
    rolesOf(protocol);
    proseRulesOf(protocol);
  } catch (error) {
    errors.push(error.message);
  }
  return errors;
}
