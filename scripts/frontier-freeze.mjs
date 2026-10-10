import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { nearestRank, quartiles } from "../tests/performance-oracle.mjs";
import { AI_PHASE_FRAMES, CORROBORATION_ROLES, INPUTS_FORMAT, RECEIPTS, RUNS, SIZES, inputsFromReceipts, turnBusySums, turnPhaseValues } from "./frontier-freeze-receipts.mjs";

// The single freeze of the 0.5 Frontier's performance budget (V05-06, criterion `congelado`) and of the five thresholds of the final comparison's protocol
// (V05-10, criterion `protocolo`).
//
//   node scripts/frontier-freeze.mjs --check [--dir <dir>] [--protocol <file>]
//   node scripts/frontier-freeze.mjs --from-receipts <baseline.json> <turn.json> --corroborate <role>=<receipt.json> ... [--date YYYY-MM-DD] [--out-dir <dir>]
//
// --check reads only the committed inputs.json, freeze.json and the protocol's JSON: it rebuilds the freeze from the inputs, requires it to be the committed one, and requires the
// protocol's thresholds to carry the frozen values, all on one date. It needs no receipt, no network and no oracle. --from-receipts is the act itself: it extracts the inputs
// from the raw receipts (inputsFromReceipts, in frontier-freeze-receipts.mjs, which also holds the registry of the executions and the shape of the extract), builds the freeze from
// them, checks it and writes inputs.json and freeze.json. The raw receipts of the turn and of the corroboration stay outside the repository.
//
// The rule (docs/research/frontier-baseline.md, the budget derivation; docs/research/frontier-comparison-protocol.json, thresholds): for a statistic, its value in each of the
// five runs, in integer microseconds from the raw intervals, sorted; the median is the third, Q1 the second and Q3 the fourth (the quartiles of five by nearest rank, the
// ones of tests/performance-oracle.mjs); the bound is the median plus three times the IQR, rounded up to 0.5 ms. A count follows the same rule without rounding.
// The freeze carries data, not prose: the words are in docs/research/frontier-freeze.md and in the budget table of docs/research/frontier-baseline.md.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DIRECTORY = path.join(REPO_ROOT, "docs", "evidence", "frontier-freeze");
const DEFAULT_PROTOCOL = path.join(REPO_ROOT, "docs", "research", "frontier-comparison-protocol.json");

const FREEZE_FORMAT = "godot-fabric.frontier-freeze/v1";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOAD_LIMIT_1_MINUTE = 2.0;
const ROUNDING_USEC = 500;
const BASELINE_STEADY_SWAPS = 360;
const BASELINE_SWAPS_PER_SIZE = 90;
const IDLE_FRAMES = 600;
const TURNS_PER_RUN = 120;

// ---------------------------------------------------------------------------------------------
// The rule.

// One statistic over the five runs: the values sorted, the quartiles of five by nearest rank, the median plus three IQR and the bound, in the unit of the values (integer
// microseconds for a time). The bound is rounded up to `roundTo` (0.5 ms by default); a count passes `roundTo: null` and is not rounded.
export function budgetOf(perRunValues, { roundTo = ROUNDING_USEC } = {}) {
  const sorted = [...perRunValues].sort((a, b) => a - b);
  const { q1, median, q3, iqr } = quartiles(sorted);
  const medianPlus3Iqr = median + 3 * iqr;
  const limit = roundTo === null ? medianPlus3Iqr : Math.ceil(medianPlus3Iqr / roundTo) * roundTo;
  return { sorted, q1, median, q3, iqr, medianPlus3Iqr, limit };
}

const unique = (values) => [...new Set(values)].sort((a, b) => a - b);
const median = (values) => nearestRank(values, 50);

// Every statistic that is derived, in the order of the derivation table of docs/research/frontier-baseline.md, with the budget it gives. `frozen` says whether a bound is
// frozen (and so shown in bold in the note) or only derived to be read (a reference, or the p99 of a size).
function derivationsOf(inputs) {
  const baseline = inputs.baseline.runs;
  const turn = inputs.turn.runs;
  const out = [];
  const add = (id, label, perRun, { frozen, unit = "usec", source }) => {
    out.push({ id, label, unit, source, frozen, perRun, ...budgetOf(perRun, { roundTo: unit === "count" ? null : ROUNDING_USEC }) });
  };
  for (const size of SIZES) {
    for (const statistic of ["p50", "p95", "p99"]) {
      add(`swap-frame-${statistic}-${size}`, `Swap frame ${statistic}, ${size} nodes created`, baseline.map((run) => run.swapFrame.bySize[size][statistic]), {
        frozen: statistic !== "p99",
        source: "baseline",
      });
    }
  }
  add("idle-frame-p99", "Idle frame p99", baseline.map((run) => run.idle.p99), { frozen: true, source: "baseline" });
  add("swap-frames-100ms", "Swap frames of 100 ms or more, per run", baseline.map((run) => run.slow.swapFramesAtLeast100ms), { frozen: true, unit: "count", source: "baseline" });
  add("idle-intervals-100ms", "Idle intervals of 100 ms or more, per run", baseline.map((run) => run.slow.idleIntervalsAtLeast100ms), { frozen: true, unit: "count", source: "baseline" });
  for (const statistic of ["p50", "p95", "p99"]) {
    const frozen = statistic === "p95";
    const label = frozen ? "Swap frame p95, all swaps (the protocol's `budget-p95-context-switches`)" : `Swap frame ${statistic}, all swaps (reference)`;
    add(`swap-frame-${statistic}-all`, label, baseline.map((run) => run.swapFrame.all[statistic]), { frozen, source: "baseline" });
  }
  add("ai-phase-p95", "AI phase p95 (the protocol's `budget-p95-ai-phase`)", turn.map((run) => nearestRank(run.aiPhaseUsec.flat(), 95)), { frozen: true, source: "turn" });
  add("event-burst-p95", "End-of-turn p95 (the protocol's `budget-p95-event-burst`)", turn.map((run) => nearestRank(run.eventBurstUsec.flat(), 95)), { frozen: true, source: "turn" });
  return out;
}

const afterFrames = (runs) => unique(runs.flatMap((run) => run.eventBurstUsec.map((frames) => frames.length - 1)));
const phaseP50 = (runs) => Array.from({ length: AI_PHASE_FRAMES + 1 }, (_, position) => median(runs.map((run) => nearestRank(turnPhaseValues(run, position), 50))));
const busySumP50 = (runs) => runs.map((run) => nearestRank(turnBusySums(run), 50));

// What each corroborating receipt would give by the same rule and what it shows beside the frozen runs. None of it becomes a threshold.
function corroborationOf(inputs, byId) {
  const frozenLimits = { aiPhase: byId["ai-phase-p95"].limit, eventBurst: byId["event-burst-p95"].limit };
  const roles = {};
  for (const [role, { runs }] of Object.entries(inputs.corroboration)) {
    if (RECEIPTS[role].kind === "baseline") {
      const swapAll = (statistic) => runs.map((run) => run.swapFrame.all[statistic]);
      const bySize = (statistic) => Object.fromEntries(SIZES.map((size) => [size, median(runs.map((run) => run.swapFrame.bySize[size][statistic]))]));
      roles[role] = {
        kind: "baseline",
        swapFrameAllP95: { perRun: swapAll("p95"), ...budgetOf(swapAll("p95")) },
        swapFrameP50BySize: bySize("p50"),
        swapFrameP95BySize: bySize("p95"),
        idleFrameP99: { perRun: runs.map((run) => run.idle.p99), ...budgetOf(runs.map((run) => run.idle.p99)) },
        injectionP50: runs.map((run) => run.injection.p50),
        framesAtLeast100ms: runs.map((run) => run.slow.swapFramesAtLeast100ms + run.slow.idleIntervalsAtLeast100ms),
        frozenRuns: { swapFrameAllP95: byId["swap-frame-p95-all"].perRun, injectionP50: inputs.baseline.runs.map((run) => run.injection.p50) },
      };
    } else {
      const aiPhase = runs.map((run) => nearestRank(run.aiPhaseUsec.flat(), 95));
      const eventBurst = runs.map((run) => nearestRank(run.eventBurstUsec.flat(), 95));
      // The absolute budget of the protocol: the median over the runs of the per-run p95 against the frozen bound, met when at most it.
      const against = (perRun, bound) => ({ medianOfPerRunP95: median(perRun), bound, met: median(perRun) <= bound });
      roles[role] = {
        kind: "turn",
        aiPhaseP95: { perRun: aiPhase, ...budgetOf(aiPhase) },
        eventBurstP95: { perRun: eventBurst, ...budgetOf(eventBurst) },
        busySumP50: busySumP50(runs),
        phaseP50: phaseP50(runs),
        framesAfterTheEndOfTheTurn: afterFrames(runs),
        againstTheFrozenBounds: { aiPhase: against(aiPhase, frozenLimits.aiPhase), eventBurst: against(eventBurst, frozenLimits.eventBurst) },
      };
    }
  }
  const frozenTurn = inputs.turn.runs;
  return { frozenTurn: { busySumP50: busySumP50(frozenTurn), phaseP50: phaseP50(frozenTurn), framesAfterTheEndOfTheTurn: afterFrames(frozenTurn) }, roles };
}

// ---------------------------------------------------------------------------------------------
// What is frozen: the values of the protocol's thresholds and the rows of the budget.

const STRESS_FROZEN_VALUE =
  "N/A: V05-06 measured no log of 200 lines and no production list of 100 items (the turn's tour and the soak's 100 turns keep the game's state small), so the stress window is judged by the relative rule alone";

const CPU_TIME_INSTRUMENT_FROZEN_VALUE = {
  quantity:
    "total_ms = physics_ms + process_ms + setup_ms + render_ms for each process frame, in milliseconds: the monotonic elapsed time between the engine's hooks on the main thread (not the thread's CPU clock of the operating system), every term ending before the frame is presented; the percentile and the windows are the protocol's",
  reading:
    "Time.get_ticks_usec stamped at SceneTree.process_frame, RenderingServer.frame_pre_draw (the last _process when the frame does not draw), SceneTree.physics_frame and the last _physics_process; RenderingServer.get_frame_setup_time_cpu() and viewport_get_measured_render_time_cpu() read at frame_post_draw, with the render measure on for the main window's viewport; never Performance.TIME_PROCESS or TIME_PHYSICS_PROCESS, which are a once-a-second maximum and, for TIME_PROCESS with the vsync on, hold the wait for the display (TIME_PROCESS stays in the samples as a cross-check)",
  alignment:
    "the render reading of a draw is the one taken 6 draws later (Compatibility renderer, Godot 4.7.2, macOS), joined by draw index when the run is over; the harness keeps 6 draws after the last window it needs, and the lag is checked by the render pulse every time the lab probe runs",
  observedError:
    "against a load of known duration, at most 0.16% at 2, 5, 10 and 20 ms headless and at most 1.5% in a presented window (the 2 ms load; 0.22% or less in the others), under the 10% rule; the instrument's floor, the idle total, is about 0.014 ms headless and 0.082 ms in a window, the same in every arm",
  gate: "the protocol's `instrument` rule is operational as: tests/cpu-time-instrument.gd is byte-identical to the one the probe and the oracle passed (its hash goes in the provenance), and the probe and the oracle are rerun on the machine, the engine and the renderer of the campaign before it starts",
  evidence: {
    research: "docs/research/cpu-time-instrument.md",
    record: "docs/evidence/cpu-time-instrument/README.md",
    pinnedCommit: "e38615da6ad7f9ca774e2ef8c46de33707c1b427",
  },
};

const RULE = {
  statement:
    "For a statistic, its value in each of the five runs, in integer microseconds from the raw intervals, sorted; the median is the third, Q1 the second and Q3 the fourth (quartiles of five by nearest rank); the bound is the median plus three times the IQR (Q3 minus Q1), rounded up to 0.5 ms. A count of frames of 100 ms or more follows the same rule without rounding.",
  function: "budgetOf, scripts/frontier-freeze.mjs",
  roundingUsec: ROUNDING_USEC,
};

// Where each row of the budget comes from.
const SOURCES = {
  "headless-77": "the headless lane pinned in #77: docs/evidence/frontier-baseline/README.md",
  "baseline-1bc3a3c": "the windowed baseline on 1bc3a3c: receipt `baseline`, committed as docs/evidence/frontier-baseline/windowed-presented-raw.json",
  "turn-1bc3a3c": "the windowed turn on 1bc3a3c: receipt `turn`, outside the repository, its SHA-256 in inputs.json",
};

// The rows of the budget table of docs/research/frontier-baseline.md, by id. The rows kept are those of the headless lane pinned in #77, which does not change: the freeze
// holds their id and the decision, and the note holds their cells. The recomputed and the added rows read derivations and carry the bounds they give, in ms or as counts.
const KEPT_IDS = ["native-nodes-after-swap", "nodes-created-and-deleted", "one-click-one-swap", "heap-at-rest", "frames-click-to-panel", "cpu-time-of-the-swap", "heap-of-a-mounted-panel"];
const sizeIds = (statistic) => SIZES.map((size) => `swap-frame-${statistic}-${size}`);
const RECOMPUTED = [
  ["swap-frame-p50-by-nodes", sizeIds("p50")],
  ["swap-frame-p95-by-nodes", sizeIds("p95")],
  ["swap-frame-p95-all", ["swap-frame-p95-all"]],
  ["idle-frame-p99", ["idle-frame-p99"]],
  ["frames-of-100-ms-or-more", ["swap-frames-100ms", "idle-intervals-100ms"]],
];
const ADDED = [
  ["ai-phase-p95", ["ai-phase-p95"]],
  ["event-burst-p95", ["event-burst-p95"]],
];

function budgetRows(byId) {
  const row = (id, decision, reason, source, derivations) => ({ id, decision, reason, source, derivations });
  const bounds = (ids) => ids.map((id) => (byId[id].unit === "count" ? byId[id].limit : byId[id].limit / 1000));
  const frozenRow = (decision, reason, source) => ([id, ids]) => ({ ...row(id, decision, reason, source, ids), unit: byId[ids[0]].unit === "count" ? "count" : "ms", bounds: bounds(ids) });
  const kept = (id, reason) => row(id, "kept", reason, "headless-77", []);
  return [
    ...KEPT_IDS.map((id) => kept(id, "the headless lane pinned in #77 does not change")),
    ...RECOMPUTED.map(frozenRow("recomputed", "from the intervals of the windowed baseline on 1bc3a3c, the execution the proposal came from, by the same rule", "baseline-1bc3a3c")),
    ...ADDED.map(frozenRow("added", "a row of the turn that a threshold of the protocol freezes", "turn-1bc3a3c")),
    kept("resident-and-static-memory", "recorded and never a limit: it moves by tens of MB and by the probe's bookkeeping"),
    {
      ...row("swap-frame-p99-by-nodes", "removed", "the p99 of 90 swaps is the largest of them (nearest rank 90), so one swap a run fixes the bound and it is the noisiest; the tail is covered by the count of frames of 100 ms or more", "baseline-1bc3a3c", sizeIds("p99")),
      unit: "ms",
      bounds: null,
      proposedBounds: bounds(sizeIds("p99")),
    },
  ];
}

// The five thresholds of the protocol, with the value each is frozen to.
function protocolThresholds(byId, frozenAt) {
  const numeric = (id) => byId[id].limit / 1000;
  const threshold = (id, receipt, frozenValue, derivation, window) => ({ id, receipt, frozenValue, frozenAt, derivation, window });
  return [
    threshold("cpu-time-instrument", null, CPU_TIME_INSTRUMENT_FROZEN_VALUE, null, null),
    threshold("budget-p95-ai-phase", "turn", numeric("ai-phase-p95"), "ai-phase-p95", "the first six busy frames of each steady turn: 720 a run, 6 a turn"),
    threshold("budget-p95-event-burst", "turn", numeric("event-burst-p95"), "event-burst-p95", "the seventh busy frame, which delivers turn_ended, and the frame after it: 240 a run, 2 a turn; the window of the protocol has at least five and the lane records no more"),
    threshold("budget-p95-context-switches", "baseline", numeric("swap-frame-p95-all"), "swap-frame-p95-all", "all the 360 steady swaps of a run"),
    threshold("budget-p95-stress", null, STRESS_FROZEN_VALUE, null, null),
  ];
}

// The loads of the executions the freeze reads against the limit of the comparative executions.
function loadsOf(inputs, limit) {
  const of = (role) => inputs.receipts[role].load.oneMinute;
  return {
    limit1MinuteAverage: limit,
    frozen: {
      baseline: { ...of("baseline"), lane: inputs.receipts.baseline.laneLoad },
      turn: { ...of("turn"), lane: inputs.receipts.turn.laneLoad },
    },
    everyFrozenReadingAboveTheLimit: ["baseline", "turn"].every((role) => of(role).min > limit),
  };
}

// The freeze, from the inputs and its date.
export function buildFreeze(inputs, { frozenAt }) {
  const derivations = derivationsOf(inputs);
  const byId = Object.fromEntries(derivations.map((derivation) => [derivation.id, derivation]));
  return {
    format: FREEZE_FORMAT,
    frozenAt,
    act: "the single freeze of the V05-06 budget (criterion `congelado`) and of the five thresholds of the V05-10 protocol (criterion `protocolo`), before any comparative execution",
    rule: RULE,
    sources: SOURCES,
    inputs: inputs.receipts,
    derivations,
    protocolThresholds: protocolThresholds(byId, frozenAt),
    budget: budgetRows(byId),
    loads: loadsOf(inputs, LOAD_LIMIT_1_MINUTE),
    corroboration: corroborationOf(inputs, byId),
  };
}

// ---------------------------------------------------------------------------------------------
// The files.

// The files are written 2 spaces deep, with an array of numbers always on one line and an object of scalars on one line when it fits in 120 columns, which keeps the raw
// intervals readable and the diffs small. The writer is part of the format: the test requires the committed files to be what it writes.
const isScalar = (value) => value === null || typeof value !== "object";
export function serialize(value, depth = 0) {
  const pad = "  ".repeat(depth);
  const inner = "  ".repeat(depth + 1);
  if (isScalar(value)) {
    return JSON.stringify(value);
  }
  const entries = Array.isArray(value) ? value : Object.entries(value).filter(([, item]) => item !== undefined);
  if (entries.length === 0) {
    return Array.isArray(value) ? "[]" : "{}";
  }
  const flat = Array.isArray(value) ? value.every(isScalar) : entries.every(([, item]) => isScalar(item));
  if (flat) {
    const line = Array.isArray(value) ? `[${value.map((item) => JSON.stringify(item)).join(", ")}]` : `{${entries.map(([key, item]) => `${JSON.stringify(key)}: ${JSON.stringify(item)}`).join(", ")}}`;
    if (depth + line.length <= 120 || (Array.isArray(value) && value.every((item) => typeof item === "number"))) {
      return line;
    }
  }
  const lines = Array.isArray(value) ? value.map((item) => `${inner}${serialize(item, depth + 1)}`) : entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${serialize(item, depth + 1)}`);
  const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  return `${open}\n${lines.join(",\n")}\n${pad}${close}`;
}

// The rows of the derivation table of the note, as markdown: a bound in bold when it is frozen.
const ms1 = (usec) => (usec / 1000).toFixed(1);
const ms3 = (usec) => (usec / 1000).toFixed(3);
export function derivationRow(derivation) {
  const count = derivation.unit === "count";
  const format = count ? String : ms3;
  const limit = count ? String(derivation.limit) : ms1(derivation.limit);
  const cells = [derivation.q1, derivation.median, derivation.q3, derivation.iqr, derivation.medianPlus3Iqr].map(format);
  return `| ${derivation.label} | ${derivation.sorted.map(format).join(" / ")} | ${cells.join(" | ")} | ${derivation.frozen ? `**${limit}**` : limit} |`;
}

// ---------------------------------------------------------------------------------------------
// The check.

// What is wrong with the shape of the inputs. The rule reads these fields and no others.
export function inputsProblems(inputs) {
  const problems = [];
  const fail = (message) => problems.push(`inputs.json: ${message}`);
  if (inputs.format !== INPUTS_FORMAT) {
    fail(`the format is not ${INPUTS_FORMAT}`);
  }
  if (!isDeepStrictEqual(Object.keys(inputs.receipts ?? {}), Object.keys(RECEIPTS))) {
    fail(`the receipts are not ${Object.keys(RECEIPTS).join(", ")}`);
    return problems;
  }
  for (const [role, receipt] of Object.entries(inputs.receipts)) {
    const known = RECEIPTS[role];
    if (receipt.sha256 !== known.sha256 || receipt.commit !== known.commit || receipt.kind !== known.kind) {
      fail(`${role}: the receipt is not the one registered (SHA-256, commit and kind)`);
    }
    if (!receipt.bundleSha256.startsWith(known.bundlePrefix) || !receipt.hostSha256.startsWith(known.hostPrefix)) {
      fail(`${role}: the bundle or the host is not the one registered`);
    }
  }
  const runsOk = (where, runs) => {
    const ok = Array.isArray(runs) && runs.length === RUNS && runs.every((run, index) => run.run === index + 1);
    if (!ok) {
      fail(`${where}: not the five runs, in order`);
    }
    return ok;
  };
  const baselineOk = (where, runs) => {
    for (const run of runsOk(where, runs) ? runs : []) {
      const shapeOk = run.swapFrame.all.samples === BASELINE_STEADY_SWAPS && SIZES.every((size) => run.swapFrame.bySize[size]?.samples === BASELINE_SWAPS_PER_SIZE) && run.idle.samples === IDLE_FRAMES;
      if (!shapeOk) {
        fail(`${where}, run ${run.run}: not 360 steady swaps (90 of each size) and 600 idle intervals`);
      }
    }
  };
  const turnOk = (where, runs) => {
    for (const run of runsOk(where, runs) ? runs : []) {
      const shapeOk =
        run.turns === TURNS_PER_RUN &&
        run.aiPhaseUsec.length === TURNS_PER_RUN &&
        run.eventBurstUsec.length === TURNS_PER_RUN &&
        run.aiPhaseUsec.every((frames) => frames.length === AI_PHASE_FRAMES && frames.every(Number.isInteger)) &&
        run.eventBurstUsec.every((frames) => frames.length >= 2 && frames.every(Number.isInteger));
      if (!shapeOk) {
        fail(`${where}, run ${run.run}: not 120 steady turns of ${AI_PHASE_FRAMES} frames of the AI phase and at least two of the end of the turn`);
      }
    }
  };
  baselineOk("baseline", inputs.baseline?.runs);
  turnOk("turn", inputs.turn?.runs);
  const roles = Object.keys(inputs.corroboration ?? {});
  if (!isDeepStrictEqual(roles, CORROBORATION_ROLES)) {
    fail(`the corroboration is not ${CORROBORATION_ROLES.join(", ")}`);
    return problems;
  }
  for (const role of roles) {
    (RECEIPTS[role].kind === "baseline" ? baselineOk : turnOk)(`corroboration ${role}`, inputs.corroboration[role].runs);
  }
  return problems;
}

// The paths at which two values differ, for the message of a freeze that is not the one its inputs give.
function differences(expected, actual, where = "$", out = []) {
  if (out.length >= 12 || isDeepStrictEqual(expected, actual)) {
    return out;
  }
  const bothObjects = expected !== null && actual !== null && typeof expected === "object" && typeof actual === "object" && Array.isArray(expected) === Array.isArray(actual);
  if (!bothObjects) {
    out.push(`${where}: expected ${JSON.stringify(expected)?.slice(0, 80)}, found ${JSON.stringify(actual)?.slice(0, 80)}`);
    return out;
  }
  for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    differences(expected[key], actual[key], `${where}.${key}`, out);
  }
  return out;
}

// What is wrong with a freeze, given its inputs and the protocol: the freeze is the one the inputs give by the rule, and the protocol's thresholds carry its values, all on one date.
export function checkFreeze({ inputs, freeze, protocol }) {
  const problems = inputsProblems(inputs);
  if (problems.length > 0) {
    return problems;
  }
  if (typeof freeze.frozenAt !== "string" || !ISO_DATE.test(freeze.frozenAt)) {
    return ["freeze.json: frozenAt is not YYYY-MM-DD"];
  }
  const rebuilt = buildFreeze(inputs, { frozenAt: freeze.frozenAt });
  for (const difference of differences(rebuilt, freeze)) {
    problems.push(`freeze.json is not what inputs.json gives by the rule, at ${difference}`);
  }
  if (protocol.runs.load.limit1MinuteAverage !== LOAD_LIMIT_1_MINUTE) {
    problems.push(`the protocol's load limit is ${protocol.runs.load.limit1MinuteAverage}, not the ${LOAD_LIMIT_1_MINUTE} the freeze compares the loads with`);
  }
  const expected = rebuilt.protocolThresholds;
  if (!isDeepStrictEqual(protocol.thresholds.map((threshold) => threshold.id), expected.map((threshold) => threshold.id))) {
    problems.push("the protocol's thresholds are not the five that the freeze fills, in order");
    return problems;
  }
  protocol.thresholds.forEach((threshold, index) => {
    if (!isDeepStrictEqual(threshold.frozenValue, expected[index].frozenValue)) {
      problems.push(`protocol threshold ${threshold.id}: frozenValue is ${JSON.stringify(threshold.frozenValue)?.slice(0, 80)}, the freeze gives ${JSON.stringify(expected[index].frozenValue).slice(0, 80)}`);
    }
    if (threshold.frozenAt !== freeze.frozenAt) {
      problems.push(`protocol threshold ${threshold.id}: frozenAt is ${threshold.frozenAt}, not ${freeze.frozenAt}`);
    }
  });
  return problems;
}

// ---------------------------------------------------------------------------------------------
// The act.

const localDate = () => {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

// Extracts the inputs from the raw receipts, builds the freeze, checks it against its own thresholds and writes inputs.json and freeze.json into `directory`.
export async function fromReceipts({ baseline, turn, corroborate, directory, frozenAt = localDate() }) {
  if (!ISO_DATE.test(frozenAt)) {
    throw new Error("--date is not YYYY-MM-DD");
  }
  const inputs = await inputsFromReceipts({ baseline, turn, corroborate });
  const freeze = buildFreeze(inputs, { frozenAt });
  const problems = checkFreeze({ inputs, freeze, protocol: { runs: { load: { limit1MinuteAverage: LOAD_LIMIT_1_MINUTE } }, thresholds: freeze.protocolThresholds } });
  if (problems.length > 0) {
    throw new Error(problems.join("\n"));
  }
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "inputs.json"), `${serialize(inputs)}\n`);
  writeFileSync(path.join(directory, "freeze.json"), `${serialize(freeze)}\n`);
  return { inputs, freeze };
}

// ---------------------------------------------------------------------------------------------
// Command line.

function parseArguments(argv) {
  const options = { mode: null, receipts: [], corroborate: {}, directory: DEFAULT_DIRECTORY, protocolFile: DEFAULT_PROTOCOL, date: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") {
      options.mode = "check";
    } else if (argument === "--from-receipts") {
      options.mode = "from-receipts";
      options.receipts = [argv[++index], argv[++index]].map((file) => path.resolve(file ?? ""));
    } else if (argument === "--corroborate") {
      const [role, file] = (argv[++index] ?? "").split("=");
      options.corroborate[role] = path.resolve(file ?? "");
    } else if (argument === "--date") {
      options.date = argv[++index] ?? "";
    } else if (argument === "--out-dir" || argument === "--dir") {
      options.directory = path.resolve(argv[++index] ?? "");
    } else if (argument === "--protocol") {
      options.protocolFile = path.resolve(argv[++index] ?? "");
    } else {
      throw new Error(`unknown argument ${argument}`);
    }
  }
  if (options.mode === null) {
    throw new Error("use --check, or --from-receipts <baseline.json> <turn.json> --corroborate <role>=<receipt.json> ... [--date YYYY-MM-DD] [--out-dir <dir>]");
  }
  return options;
}

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

async function main(argv) {
  const options = parseArguments(argv);
  if (options.mode === "check") {
    const freeze = readJson(path.join(options.directory, "freeze.json"));
    const problems = checkFreeze({ inputs: readJson(path.join(options.directory, "inputs.json")), freeze, protocol: readJson(options.protocolFile) });
    for (const problem of problems) {
      console.error(`FAIL ${problem}`);
    }
    if (problems.length > 0) {
      throw new Error(`${problems.length} problem(s) in the freeze`);
    }
    console.log(`FRONTIER_FREEZE_CHECK_PASSED: ${freeze.protocolThresholds.length} thresholds, ${freeze.budget.length} budget rows, ${freeze.derivations.length} derivations, frozen on ${freeze.frozenAt}`);
    return;
  }
  const [baseline, turn] = options.receipts;
  const { freeze } = await fromReceipts({ baseline, turn, corroborate: options.corroborate, directory: options.directory, frozenAt: options.date });
  for (const threshold of freeze.protocolThresholds) {
    console.log(`${threshold.id}: ${typeof threshold.frozenValue === "object" ? "(the instrument)" : String(threshold.frozenValue).slice(0, 60)}`);
  }
  console.log(`FRONTIER_FREEZE_WRITTEN: ${path.relative(REPO_ROOT, options.directory)}/inputs.json and freeze.json, frozen on ${freeze.frozenAt}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
