import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { nearestRank } from "../tests/performance-oracle.mjs";

// What describes the inputs of the freeze and how they are extracted: the registry of the executions it reads, the shape of the extract that the rule reads and the way from the raw
// receipts of the windowed lanes to it (inputsFromReceipts, which `node scripts/frontier-freeze.mjs --from-receipts` calls). This module imports nothing of frontier-freeze.mjs,
// which imports the registry and the shape from here; the extraction runs once, when the freeze is made.
//
// Nothing is taken on trust. The SHA-256 of each receipt is the registered one; the oracles accept it (verifyGraphicsReceipt and graphicsRunValidity); the baseline's `summary` is
// proved equal to the oracle's statistics over the raw intervals, and the extract of the baseline is read from it; the turn's statistics are recomputed from its raw intervals. The
// oracles and the cases are imported inside the extraction, after the hash is right, and nowhere else: --check and the test read no receipt and import no oracle.

export const INPUTS_FORMAT = "godot-fabric.frontier-freeze-inputs/v1";
export const SIZES = [0, 50, 75, 100];
export const RUNS = 5;
export const AI_PHASE_FRAMES = 6;
const SLOW_FRAME_USEC = 100_000;
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const atLeast = (values, bound) => values.filter((value) => value >= bound).length;
const times = (count, value) => Array.from({ length: count }, () => value);
const ms = (usec) => Math.round(usec) / 1000;
const usec = (milliseconds) => Math.round(milliseconds * 1000);

// ---------------------------------------------------------------------------------------------
// The registry.

// The executions the freeze reads, by role. The first two freeze; the other three corroborate and become no threshold. The SHA-256 of each raw receipt is the one the principal
// recorded; the bundle and the host are given by their first eight digits and the receipt must carry full values that start with them.
const MEASURED_COMMIT = "1bc3a3cc7d5d1a160f2158a87a5f8c623b504130";
const CORROBORATION_COMMIT = "916387e349d3933e2ecfb417f9be8e332358a803";
export const RECEIPTS = {
  baseline: {
    kind: "baseline",
    freezes: true,
    sha256: "36b32e0d6d1418af122260aa453bdd77bd9619811181731a88855a1e526e13b7",
    commit: MEASURED_COMMIT,
    bundlePrefix: "7895d359",
    hostPrefix: "212d0f6e",
    committedAs: "docs/evidence/frontier-baseline/windowed-presented-raw.json",
    laneLoad: { before: "{ 5.41 5.71 7.07 }", after: "{ 6.79 6.05 6.87 }" },
    what: "the presented windowed baseline of V05-06, on the commit of the proposal",
  },
  turn: {
    kind: "turn",
    freezes: true,
    sha256: "8dd6ec9cf4776a8026c3056c337da9a9bb7c811b6b529f05c1ecee3ca111e90f",
    commit: MEASURED_COMMIT,
    bundlePrefix: "fce50a0a",
    hostPrefix: "212d0f6e",
    committedAs: null,
    laneLoad: { before: "{ 5.70 5.85 6.78 }", after: "{ 5.77 6.18 6.44 }" },
    what: "the presented windowed turn of V05-06, measured on the same commit right after the baseline",
  },
  "baseline-main": {
    kind: "baseline",
    freezes: false,
    sha256: "9959a269a61b615d5ccfff3864f262732f2fd28bcbf240f01987c29e3027e9f4",
    commit: CORROBORATION_COMMIT,
    bundlePrefix: "7895d359",
    hostPrefix: "497e4f95",
    committedAs: null,
    laneLoad: { before: "{ 8.78 9.37 8.62 }", after: "{ 8.29 9.34 8.81 }" },
    what: "corroboration: the baseline again, on main, with no suite, build or export of another agent running and a higher system load (the same bundle as the frozen one)",
  },
  "turn-main": {
    kind: "turn",
    freezes: false,
    sha256: "4708f22b7dc62544a1e22b1c7e1e4f96cc7895216ae7b68c9f4ff62a4da370ca",
    commit: CORROBORATION_COMMIT,
    bundlePrefix: "54b8af7d",
    hostPrefix: "497e4f95",
    committedAs: null,
    laneLoad: { before: "{ 8.29 9.34 8.81 }", after: "{ 7.52 7.45 8.06 }" },
    what: "corroboration: the turn on main with the HUD of #100 (the current one)",
  },
  "turn-main-pre-100-hud": {
    kind: "turn",
    freezes: false,
    sha256: "244f6ffd37eef631df4587abc8eb5542af3d89524a130e7a7771cd7ef0c13545",
    commit: CORROBORATION_COMMIT,
    consumerCommit: "fb51c07162bb52eb418f3a3c5c4a19798b148eab",
    bundlePrefix: "fce50a0a",
    hostPrefix: "497e4f95",
    committedAs: null,
    laneLoad: { before: "{ 8.18 7.72 8.12 }", after: "{ 8.35 7.87 7.89 }" },
    what: "corroboration, the A/B: the turn on main with only consumers/civ-lite restored to the commit before #100",
  },
};
export const CORROBORATION_ROLES = Object.keys(RECEIPTS).filter((role) => !RECEIPTS[role].freezes);

// The 1-minute load average of a `{ 5.70 5.85 6.78 }` reading, as vm.loadavg prints it.
function oneMinute(reading) {
  const match = /^\{\s*(\d+(?:\.\d+)?)\s+\d+(?:\.\d+)?\s+\d+(?:\.\d+)?\s*\}$/.exec(reading);
  if (match === null) {
    throw new Error(`not a vm.loadavg reading: ${reading}`);
  }
  return Number.parseFloat(match[1]);
}

// The readings the lane took around each of its runs, as written, and the least and the greatest 1-minute average among them.
function loadOf(receipt) {
  const attempts = receipt.attempts.map((attempt) => ({
    slot: attempt.slot,
    attempt: attempt.attempt,
    before: attempt.loadAverage.before,
    after: attempt.loadAverage.after,
    seconds: attempt.loadAverage.seconds,
  }));
  const readings = attempts.flatMap((attempt) => [oneMinute(attempt.before), oneMinute(attempt.after)]);
  return { attempts, oneMinute: { min: Math.min(...readings), max: Math.max(...readings) } };
}

const receiptMetadata = (role, bytes, receipt) => ({
  kind: RECEIPTS[role].kind,
  what: RECEIPTS[role].what,
  commit: RECEIPTS[role].commit,
  ...(RECEIPTS[role].consumerCommit === undefined ? {} : { consumerCommit: RECEIPTS[role].consumerCommit }),
  sha256: sha256(bytes),
  bytes: bytes.length,
  committedAs: RECEIPTS[role].committedAs,
  format: receipt.format ?? null,
  bundleSha256: receipt.bundleSha256,
  hostSha256: receipt.nativeHostSha256,
  presented: receipt.presented,
  runsAccepted: receipt.raw.length,
  attempts: receipt.attempts.length,
  rejectedAttempts: receipt.rejectedAttempts.length,
  refreshRate: receipt.provenance.refreshRate,
  vsyncMode: receipt.provenance.vsyncModeName,
  laneLoad: RECEIPTS[role].laneLoad,
  load: loadOf(receipt),
});

// ---------------------------------------------------------------------------------------------
// The baseline: the extract is read from the receipt's `summary` (milliseconds of three decimals, which are whole microseconds, back to integer microseconds). The summary is
// proved equal to the oracle's statistics over the raw intervals before anything is read from it, so the extract is the oracle's. The oracle counts the frames above 100 ms.

const frameStats = (frame) => ({ samples: frame.samples, p50: usec(frame.p50), p95: usec(frame.p95), p99: usec(frame.p99) });

export const baselineRunsOfSummary = (receipt) =>
  receipt.summary.runs.map((run) => ({
    run: run.run,
    swapFrame: { all: frameStats(run.swapFrameMs), bySize: Object.fromEntries(SIZES.map((size) => [size, frameStats(run.swapFrameMsByNodesCreated[size])])) },
    injection: { p50: usec(run.injectionMs.p50), p95: usec(run.injectionMs.p95) },
    idle: { samples: run.idleFrameMs.samples, p99: usec(run.idleFrameMs.p99) },
    slow: { swapFramesAtLeast100ms: run.swapFrameMs.above100ms, idleIntervalsAtLeast100ms: run.idleFrameMs.above100ms },
  }));

const withoutMotion = (summary) => ({ ...summary, runs: summary.runs.map(({ mapMotionEvents: _motion, ...run }) => run) });

// A raw baseline run in the shape the baseline oracle reads (docs/evidence/frontier-baseline/README.md, "Recalcular").
function baselineRunOf(raw, receipt, nativeNodes) {
  const attempt = receipt.attempts.find((each) => each.attempt === raw.attempt);
  return {
    run: raw.run,
    provenance: receipt.provenance,
    config: { nativeNodes },
    swaps: raw.swaps.map(([round, step, from, to, latencyFrames, flushUsec, latencyUsec, drawUsec, frameUsec]) => ({ round, step, from, to, latencyFrames, flushUsec, latencyUsec, drawUsec, frameUsec })),
    idle: { intervalsUsec: raw.idleIntervalsUsec, draws: raw.idleDraws, frames: raw.idleIntervalsUsec.length },
    frames: { processed: attempt.processFrames, drawn: attempt.drawnFrames },
    ...(raw.presence === null || raw.presence === undefined ? {} : { presence: raw.presence }),
  };
}

// ---------------------------------------------------------------------------------------------
// The turn.

// The seven frames of a turn added up (the six of the AI phase and the one that delivers the end of the turn), and the interval of one of the seven.
export const turnBusySums = (run) => run.aiPhaseUsec.map((frames, turn) => frames.reduce((total, value) => total + value, 0) + run.eventBurstUsec[turn][0]);
export const turnPhaseValues = (run, position) => run.aiPhaseUsec.map((frames, turn) => (position < AI_PHASE_FRAMES ? frames[position] : run.eventBurstUsec[turn][0]));

// A turn of a run is [round, id, the frames as [phase, interval us, nodes, snapshots, end of the turn], the host's phases]. From the frame in which the game leaves idle there are
// `phases` busy frames, one phase each, the last of them the one that delivers the end of the turn; the frames after them are the HUD catching up. The ai-phase window is the
// first busy frames but the last; the end of the turn is the last busy frame and the frames after it (what the lane records of it).
export function extractTurnRun(raw, { warmupRounds, phases }) {
  const aiPhaseUsec = [];
  const eventBurstUsec = [];
  for (const [round, id, frames] of raw.turns) {
    if (round < warmupRounds) {
      continue;
    }
    const where = `run ${raw.run} round ${round} ${id}`;
    const first = frames.findIndex((frame) => frame[0] !== "idle");
    if (first < 0) {
      throw new Error(`${where}: the game never left idle`);
    }
    const busy = frames.slice(first, first + phases.length);
    const after = frames.slice(first + phases.length);
    if (!isDeepStrictEqual(busy.map((frame) => frame[0]), phases)) {
      throw new Error(`${where}: the frames do not advance one phase each, in the order of the service`);
    }
    if (!frames.slice(0, first).every((frame) => frame[3] === 0 && frame[4] === 0)) {
      throw new Error(`${where}: something moved before the acceptance`);
    }
    if (!isDeepStrictEqual(busy.map((frame) => frame[3]), times(phases.length, 1)) || !isDeepStrictEqual(busy.map((frame) => frame[4]), [...times(phases.length - 1, 0), 1])) {
      throw new Error(`${where}: not a snapshot in each busy frame and the end of the turn once, in the last`);
    }
    if (after.length === 0 || !after.every((frame) => frame[0] === "idle" && frame[3] === 0 && frame[4] === 0)) {
      throw new Error(`${where}: the frames after the turn are not the HUD catching up`);
    }
    aiPhaseUsec.push(busy.slice(0, phases.length - 1).map((frame) => frame[1]));
    eventBurstUsec.push([busy[phases.length - 1][1], ...after.map((frame) => frame[1])]);
  }
  return { run: raw.run, turns: aiPhaseUsec.length, aiPhaseUsec, eventBurstUsec };
}

// The clicks of a raw turn run as the validity of the baseline reads them (a frame has to be drawn after every click), and the idle window.
const turnRunOf = (raw, receipt) => {
  const attempt = receipt.attempts.find((each) => each.attempt === raw.attempt);
  return {
    run: raw.run,
    provenance: receipt.provenance,
    swaps: raw.clicks.map(([round, , , , , , drawUsec]) => ({ round, drawUsec })),
    idle: { intervalsUsec: raw.idleIntervalsUsec, draws: raw.idleDraws, frames: raw.idleIntervalsUsec.length },
    frames: { processed: attempt.processFrames, drawn: attempt.drawnFrames },
    ...(raw.presence === null || raw.presence === undefined ? {} : { presence: raw.presence }),
  };
};

// The statistics of the receipt's own `turnFrames` (computed by the turn's oracle from the full reports), recomputed from the raw intervals that the extract keeps.
function checkTurnFrames(receipt, runs, label) {
  runs.forEach((run, index) => {
    const reported = receipt.turnFrames.runs[index];
    if (reported.run !== run.run || reported.turns !== run.turns) {
      throw new Error(`${label}: the receipt's turn frames of run ${run.run} are not for ${run.turns} turns`);
    }
    const phases = Array.from({ length: AI_PHASE_FRAMES + 1 }, (_, position) => turnPhaseValues(run, position));
    phases.forEach((values, position) => {
      const each = reported.byPhase[position].intervalMs;
      const mine = { p50: ms(nearestRank(values, 50)), p95: ms(nearestRank(values, 95)), max: ms(Math.max(...values)) };
      if (each.p50 !== mine.p50 || each.p95 !== mine.p95 || each.max !== mine.max) {
        throw new Error(`${label}: run ${run.run}, phase ${reported.byPhase[position].phase}: the receipt says ${JSON.stringify({ p50: each.p50, p95: each.p95, max: each.max })}, the raw intervals give ${JSON.stringify(mine)}`);
      }
    });
    const sums = turnBusySums(run);
    const mine = { p50: ms(nearestRank(sums, 50)), p95: ms(nearestRank(sums, 95)), max: ms(Math.max(...sums)) };
    const each = reported.busyMs;
    if (each.p50 !== mine.p50 || each.p95 !== mine.p95 || each.max !== mine.max) {
      throw new Error(`${label}: run ${run.run}: the seven frames of the job add up to ${JSON.stringify(mine)} in the raw intervals and the receipt says ${JSON.stringify({ p50: each.p50, p95: each.p95, max: each.max })}`);
    }
  });
}

// What the receipt's `summary` says of each run's idle window, recomputed from the raw intervals.
function checkIdleSummary(receipt, label) {
  receipt.raw.forEach((raw, index) => {
    const idle = raw.idleIntervalsUsec;
    const reported = receipt.summary.runs[index].idleFrameMs;
    const mine = { p50: ms(nearestRank(idle, 50)), p95: ms(nearestRank(idle, 95)), p99: ms(nearestRank(idle, 99)), max: ms(Math.max(...idle)), above100ms: atLeast(idle, SLOW_FRAME_USEC) };
    for (const key of Object.keys(mine)) {
      if (reported[key] !== mine[key]) {
        throw new Error(`${label}: run ${raw.run}: the idle ${key} is ${reported[key]} in the receipt and ${mine[key]} in the raw intervals`);
      }
    }
  });
}

// ---------------------------------------------------------------------------------------------
// One receipt, and the whole act.

async function extractReceipt(role, file) {
  const known = RECEIPTS[role];
  const bytes = readFileSync(file);
  if (sha256(bytes) !== known.sha256) {
    throw new Error(`${role}: the SHA-256 of ${path.basename(file)} is ${sha256(bytes)}, not the registered ${known.sha256}`);
  }
  const receipt = JSON.parse(bytes.toString("utf8"));
  const { verifyGraphicsReceipt, graphicsRunValidity, summarizeGraphicsRuns } = await import("../tests/frontier-baseline-oracle.mjs");
  verifyGraphicsReceipt(receipt);
  if (receipt.presented !== true || receipt.raw.length !== RUNS || receipt.rejectedAttempts.length !== 0 || receipt.attempts.length !== RUNS) {
    throw new Error(`${role}: the receipt is not a presented one with its five runs accepted at the first attempt`);
  }
  if (!receipt.bundleSha256.startsWith(known.bundlePrefix) || !receipt.nativeHostSha256.startsWith(known.hostPrefix)) {
    throw new Error(`${role}: the bundle (${receipt.bundleSha256}) or the host (${receipt.nativeHostSha256}) is not the registered one`);
  }
  const metadata = receiptMetadata(role, bytes, receipt);
  if (known.kind === "baseline") {
    const { NATIVE_NODES } = await import("../tests/frontier-baseline-cases.mjs");
    const runs = receipt.raw.map((raw) => baselineRunOf(raw, receipt, NATIVE_NODES));
    for (const run of runs) {
      const validity = graphicsRunValidity(run);
      if (!validity.valid) {
        throw new Error(`${role}: run ${run.run} is not valid for the oracle: ${validity.reason}`);
      }
    }
    if (!isDeepStrictEqual(JSON.parse(JSON.stringify(withoutMotion(summarizeGraphicsRuns(runs)))), withoutMotion(receipt.summary))) {
      throw new Error(`${role}: the oracle's statistics over the raw intervals are not the receipt's summary`);
    }
    return { metadata, runs: baselineRunsOfSummary(receipt) };
  }
  const { PHASES, WARMUP_ROUNDS } = await import("../tests/frontier-turn-cases.mjs");
  for (const raw of receipt.raw) {
    const validity = graphicsRunValidity(turnRunOf(raw, receipt));
    if (!validity.valid) {
      throw new Error(`${role}: run ${raw.run} is not valid for the oracle: ${validity.reason}`);
    }
  }
  const extracted = receipt.raw.map((raw) => extractTurnRun(raw, { warmupRounds: WARMUP_ROUNDS, phases: PHASES }));
  checkIdleSummary(receipt, role);
  checkTurnFrames(receipt, extracted, role);
  return { metadata, runs: extracted };
}

const EXTRACTS =
  "only what the rule reads. Baseline runs: the p50, p95 and p99 of the swap frame (the first interval of the frames of a swap) over all the 360 steady swaps and over the 90 of each size (0, 50, 75 and 100 nodes created), the p50 and p95 of the injection and flush, the idle p99 of the 600 idle intervals and the counts of frames of 100 ms or more. Turn runs: for each of the 120 steady turns, the six intervals of the `ai-phase` window (the busy frames but the last) and the intervals of the end of the turn (the last busy frame, which delivers `turn_ended`, and the frames after it).";

// Judges the receipts and returns the inputs: the registry's metadata of each, and the extract of its runs. The three corroborating receipts are required, by role.
export async function inputsFromReceipts({ baseline, turn, corroborate = {} }) {
  for (const role of Object.keys(corroborate)) {
    if (!CORROBORATION_ROLES.includes(role)) {
      throw new Error(`--corroborate ${role}: the roles are ${CORROBORATION_ROLES.join(", ")}`);
    }
  }
  const extracted = { baseline: await extractReceipt("baseline", baseline), turn: await extractReceipt("turn", turn) };
  for (const role of CORROBORATION_ROLES) {
    if (corroborate[role] === undefined) {
      throw new Error(`the corroborating receipt ${role} is required: --corroborate ${role}=<file>`);
    }
    extracted[role] = await extractReceipt(role, corroborate[role]);
  }
  return {
    format: INPUTS_FORMAT,
    unit: "microseconds, integer, from the raw intervals of the receipts",
    extracts: EXTRACTS,
    receipts: Object.fromEntries(Object.keys(RECEIPTS).map((role) => [role, extracted[role].metadata])),
    baseline: { runs: extracted.baseline.runs },
    turn: { runs: extracted.turn.runs },
    corroboration: Object.fromEntries(CORROBORATION_ROLES.map((role) => [role, { runs: extracted[role].runs }])),
  };
}
