import assert from "node:assert/strict";
import {isDeepStrictEqual} from "node:util";
import {nearestRank, round} from "./performance-oracle.mjs";
import {idleReference} from "./frontier-baseline-oracle.mjs";

// Independent oracle for the CPU-time instrument (tests/cpu-time-instrument.gd) of the final comparison V05-10, written from the contract of the
// threshold `cpu-time-instrument` in docs/research/frontier-comparison-protocol.md and not from the probe: one engine-side reading of the main
// thread's CPU time for the frame, the same code in the three arms, that excludes the wait for the display, checked within 10% against a synthetic
// load of known duration. It takes the raw report of tests/cpu-time-instrument-probe.gd, the clock stamps the instrument took in every process
// frame and the render readings it received, and recomputes from them what the instrument reports and what the rules say.
//
// The experiment, which the report has to have run: a schedule of blocks of process frames (warm-up, an idle window of 600 measured frames, and for
// each target of 2, 5, 10 and 20 ms a block of 200 measured frames in which every frame burns that long, each followed by an idle block of 200;
// in a window also a render pulse block; and a drain, so that the render readings have arrived). The first frames of a block are settle frames,
// recorded and not judged.
//
// The terms of a process frame, in milliseconds, from the stamps (all of them times of Time.get_ticks_usec):
//   interval = start - the previous frame's start           (recorded, not a CPU time)
//   process  = (pre-draw, or the last _process when the frame did not draw) - start
//   physics  = the scripted physics steps of the iteration
//   setup    = the engine's frame setup time of the frame's draw (0 when it did not draw)
//   render   = the measured render time of the frame's draw, read RENDER_READING_LAG_DRAWS draws after it (0 when it did not draw)
//   total    = physics + process + setup + render
//
// The rules, each recomputed here:
//   cpu        the idle total is a small part of the idle interval: the median at most IDLE_SHARE and the 95th percentile at most IDLE_P95_SHARE of the
//              idle interval reference (the baseline's idleReference over the 600 idle intervals), so what the instrument reads is a CPU time and not the
//              interval between frames (with the vsync on the idle interval is near 8.3 ms at 120 Hz and the CPU time is a small fraction of it)
//   truth      the busy loop of a load block took its target, as the engine's clock measured it (the median to within 1%)
//   accuracy   for each target T: |median(total in the load-T frames) - base - T| <= 10% of T, with base the median of the total over the measured
//              frames of every idle block (the median of an even count is the mean of the two middle values)
//   variation  in each load block the process term takes at least DISTINCT_MINIMUM values and does not repeat more than RUN_MAXIMUM frames in a row,
//              which a clock does and a monitor that the engine refreshes once a second does not
//   render     (a window) the render pulse lands RENDER_READING_LAG_DRAWS draws after the draw that caused it and nowhere else
//   engine     (headless) the engine's own TIME_PROCESS monitor, which is the largest process time of the last second and covers more than the
//              instrument's process step, is never under the largest process term of the second before it was set, and not far over it
// A window that no display presented (it did not draw nine in ten of the idle frames, or the idle reference of its intervals is under half of the
// refresh period read back) is not a measurement: nothing but the structure and the arithmetic is judged, and the answer says why.
export const TARGETS_MS = [2, 5, 10, 20];
export const TOLERANCE = 0.1;
export const RENDER_READING_LAG_DRAWS = 6;
const WARMUP_FRAMES = 120;
const SETTLE_FRAMES = 10;
const FIRST_IDLE_FRAMES = 600;
const BETWEEN_IDLE_FRAMES = 200;
const LOAD_FRAMES = 200;
const PULSE_FRAMES = 264;
const PULSE_PERIOD = 11;
const PULSE_RECTS = 30000;
const PULSE_WARM = 2;
const PULSE_MINIMUM_GAIN_MS = 0.3;
const DRAIN_FRAMES = 12;
const IDLE_SHARE = 0.25;
const IDLE_P95_SHARE = 0.5;
const BURN_TOLERANCE = 0.01;
const DISTINCT_MINIMUM = 8;
const RUN_MAXIMUM = 10;
const ENGINE_MEDIAN_MARGIN_MS = 0.5;
const ENGINE_HIDDEN_UPDATE_USEC = 1500000;
const EPSILON = 1e-9;

const sum = values => values.reduce((total, value) => total + value, 0);
// The middle value, or the mean of the two middle ones when the count is even.
export function median(values) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// The schedule of blocks: the same list the probe builds.
export function expectedBlocks(windowed) {
  const blocks = [];
  const add = (name, kind, targetMs, measured, settle) => {
    const first = blocks.length === 0 ? 0 : blocks.at(-1).end;
    blocks.push({name, kind, targetMs, first, settle, measured, end: first + settle + measured});
  };
  add("warmup", "warmup", 0, 0, WARMUP_FRAMES);
  add("idle-0", "idle", 0, FIRST_IDLE_FRAMES, SETTLE_FRAMES);
  TARGETS_MS.forEach((target, index) => {
    add(`load-${target}`, "load", target, LOAD_FRAMES, SETTLE_FRAMES);
    add(`idle-${index + 1}`, "idle", 0, BETWEEN_IDLE_FRAMES, SETTLE_FRAMES);
  });
  if (windowed) {
    add("render-pulse", "render-pulse", 0, PULSE_FRAMES, SETTLE_FRAMES);
  }
  add("drain", "drain", 0, 0, DRAIN_FRAMES);
  return blocks;
}

// What the experiment fixes, apart from the blocks (which are compared on their own) and from where the probe put the busy loop.
const expectedConfig = () => ({targetsMs: TARGETS_MS, tolerance: TOLERANCE, warmupFrames: WARMUP_FRAMES, settleFrames: SETTLE_FRAMES,
  firstIdleFrames: FIRST_IDLE_FRAMES, betweenIdleFrames: BETWEEN_IDLE_FRAMES, loadFrames: LOAD_FRAMES, drainFrames: DRAIN_FRAMES,
  pulse: {frames: PULSE_FRAMES, period: PULSE_PERIOD, rects: PULSE_RECTS, warm: PULSE_WARM, minimumGainMs: PULSE_MINIMUM_GAIN_MS},
  renderReadingLagDraws: RENDER_READING_LAG_DRAWS, idleShare: IDLE_SHARE, idleP95Share: IDLE_P95_SHARE, burnTolerance: BURN_TOLERANCE});

const RAW = ["frame", "block", "burnUsec", "renderLoad", "startUsec", "lastProcessUsec", "preDrawUsec", "physicsUsec", "drawIndex", "drawn", "setupMs", "monitorMs"];
const DERIVED = ["intervalMs", "processMs", "physicsMs", "renderMs", "renderKnown", "totalMs"];

// The terms of every frame from the raw stamps and readings, with the arithmetic of the contract above.
export function deriveTerms(frames, readings) {
  const byDraw = new Map(readings.draw.map((draw, index) => [draw, readings.ms[index]]));
  const terms = Object.fromEntries(DERIVED.map(name => [name, []]));
  frames.frame.forEach((_frame, index) => {
    const drew = frames.drawIndex[index] >= 0;
    const key = frames.drawIndex[index] + RENDER_READING_LAG_DRAWS;
    const intervalMs = index === 0 ? 0 : (frames.startUsec[index] - frames.startUsec[index - 1]) / 1000;
    const processMs = ((drew ? frames.preDrawUsec[index] : frames.lastProcessUsec[index]) - frames.startUsec[index]) / 1000;
    const physicsMs = frames.physicsUsec[index] / 1000;
    const renderMs = drew && byDraw.has(key) ? byDraw.get(key) : 0;
    terms.intervalMs.push(intervalMs);
    terms.processMs.push(processMs);
    terms.physicsMs.push(physicsMs);
    terms.renderMs.push(renderMs);
    terms.renderKnown.push(!drew || byDraw.has(key) ? 1 : 0);
    terms.totalMs.push(physicsMs + processMs + (drew ? frames.setupMs[index] : 0) + renderMs);
  });
  return terms;
}

// The positions of the measured frames of the blocks of a kind (and of a target, for the load blocks).
const measuredOf = (blocks, kind, targetMs = null) => blocks.filter(block => block.kind === kind && (targetMs === null || block.targetMs === targetMs))
  .flatMap(block => Array.from({length: block.measured}, (_, offset) => block.first + block.settle + offset));
const at = (column, positions) => positions.map(position => column[position]);

// How much more the reading is at the draws of the pulse frames, plus a lag, than at the draws of the others, for each lag in draws.
function pulseGains(frames, readings, blocks) {
  const byDraw = new Map(readings.draw.map((draw, index) => [draw, readings.ms[index]]));
  const pulses = [];
  const others = [];
  let seen = 0;
  for (const position of measuredOf(blocks, "render-pulse")) {
    if (frames.renderLoad[position] === 1) {
      seen += 1;
      if (seen > PULSE_WARM) {
        pulses.push(position);
      }
    } else if (seen > PULSE_WARM) {
      others.push(position);
    }
  }
  const gains = Array.from({length: PULSE_PERIOD}, (_, lag) => {
    const read = positions => positions.map(position => byDraw.get(frames.drawIndex[position] + lag)).filter(value => value !== undefined);
    return median(read(pulses)) - median(read(others));
  });
  return {pulses: pulses.length, gains};
}

function checkStructure(report, violations) {
  const rule = (condition, message) => {
    if (!condition) {
      violations.push(message);
    }
    return condition;
  };
  rule(report.scenario === "cpu-time-instrument", "The report is of the cpu-time-instrument probe");
  const windowed = report.lane === "windowed";
  if (!rule(windowed || report.lane === "headless", "The report names its lane, headless or windowed")) {
    return null;
  }
  rule((report.provenance?.displayServer === "headless") === !windowed, "The lane agrees with the display server that ran it");
  // The draw is part of the main thread's frame only when it runs on the main thread (the project's default thread model, 1; the separate render thread is 2).
  rule(!windowed || (Number.isInteger(report.provenance?.threadModel) && report.provenance.threadModel !== 2), "The draw runs on the main thread: the project's rendering thread model is not the separate render thread");
  const config = {...report.config};
  const blocks = config.blocks;
  delete config.blocks;
  delete config.loadPlacement;
  rule(isDeepStrictEqual(config, expectedConfig()), "The probe ran the experiment this oracle recomputes (targets, frames, tolerance and the lag)");
  const expected = expectedBlocks(windowed);
  if (!rule(isDeepStrictEqual(blocks, expected), "The schedule of blocks is the experiment's: warm-up, idle, four loads each followed by idle, (a render pulse in a window), drain")) {
    return null;
  }
  const total = expected.at(-1).end;
  const frames = report.frames ?? {};
  const complete = RAW.every(name => Array.isArray(frames[name]) && frames[name].length === total)
    && DERIVED.every(name => Array.isArray(frames[name]) && frames[name].length === total);
  if (!rule(complete, `Every column of the report has one entry for each of the ${total} scheduled frames: none is missing a sample`)) {
    return null;
  }
  rule(report.missingSamples === 0, "No scheduled frame lacked a sample of the instrument");
  const readings = report.renderReadings;
  if (!rule(Array.isArray(readings?.draw) && Array.isArray(readings?.ms) && readings.draw.length === readings.ms.length, "The render readings come in pairs of a draw and a time")) {
    return null;
  }
  rule(frames.frame.every((frame, index) => index === 0 || frame === frames.frame[index - 1] + 1), "The samples are of consecutive process frames, in order, none twice");
  rule(frames.block.every((block, index) => block === expected.findIndex(each => index >= each.first && index < each.end)), "Every sample is of the block the schedule puts its frame in");
  rule(frames.startUsec.every((start, index) => index === 0 || start > frames.startUsec[index - 1]), "The clock stamps of the frames start in order");
  rule(frames.frame.every((_frame, index) => frames.lastProcessUsec[index] >= frames.startUsec[index]
    && (frames.drawIndex[index] < 0 || frames.preDrawUsec[index] >= frames.startUsec[index])), "Every frame ends after it starts");
  rule(frames.drawn.every((drawn, index) => drawn === (frames.drawIndex[index] >= 0 ? 1 : 0)), "A frame is marked drawn exactly when it has a draw");
  if (!windowed) {
    rule(frames.drawn.every(drawn => drawn === 0) && frames.setupMs.every(value => value === 0) && report.renderReadings.draw.length === 0,
      "A headless run draws nothing: no draw, no setup time and no render reading");
  }
  return {windowed, blocks: expected, frames, readings};
}

// The instrument's own terms are what its stamps give.
function checkArithmetic(frames, readings, violations) {
  const terms = deriveTerms(frames, readings);
  for (const name of DERIVED) {
    const wrong = terms[name].findIndex((value, index) => !(Math.abs(value - frames[name][index]) <= EPSILON));
    if (wrong >= 0) {
      violations.push(`The ${name} of the frame ${frames.frame[wrong]} is ${frames[name][wrong]} and the instrument's stamps give ${terms[name][wrong]}: the instrument reads its clock at the engine's hooks and adds its terms as the contract says`);
      return;
    }
  }
}

// Whether a display presented the window, from the raw idle window.
function presentation(report, context) {
  const {frames, blocks} = context;
  const idle = measuredOf(blocks, "idle").slice(0, FIRST_IDLE_FRAMES);
  const drawn = sum(at(frames.drawn, idle));
  const refreshRate = report.provenance?.refreshRate;
  const periodMs = refreshRate > 0 ? 1000 / refreshRate : null;
  const reference = idleReference(at(frames.intervalMs, idle));
  const drew = drawn >= 0.9 * FIRST_IDLE_FRAMES;
  const paced = periodMs !== null && reference >= periodMs / 2;
  return {drew, paced, presented: drew && paced, idleDraws: drawn, idleIntervalReferenceMs: round(reference, 3), refreshPeriodMs: periodMs === null ? null : round(periodMs, 3),
    reason: !drew ? "not presented: the window did not draw nine in ten of the idle frames" : !paced ? "not presented: the display did not pace the loop" : null};
}

// The engine's TIME_PROCESS monitor: set once a second, at the end of an iteration, to the largest process time of the iterations since the last time
// it was set, which the engine counts from before the process step to after the draw (so it is at least the instrument's process step, in a run that
// draws nothing too). The frame after the one that set it sees the change. Between two changes the monitor's window is exactly the frames from the
// first change to the frame before the second. Two changes more than ENGINE_HIDDEN_UPDATE_USEC apart may hide a change that left the value the same,
// and their window is not known: they are left out.
function engineMonitor(frames) {
  const changes = [];
  for (let index = 1; index < frames.frame.length; ++index) {
    if (frames.monitorMs[index] !== frames.monitorMs[index - 1]) {
      changes.push(index);
    }
  }
  const margins = [];
  let under = 0;
  changes.slice(1).forEach((index, position) => {
    const first = changes[position];
    if (frames.startUsec[index] - frames.startUsec[first] > ENGINE_HIDDEN_UPDATE_USEC) {
      return;
    }
    const largest = Math.max(...frames.processMs.slice(first, index));
    margins.push(frames.monitorMs[index] - largest);
    under += frames.monitorMs[index] < largest - 1e-6 ? 1 : 0;
  });
  return {updates: margins.length, underTheInstrument: under, medianMarginMs: round(median(margins), 4)};
}

// The verdict on a report: the violations, in the order the rules are listed above, and what was computed. The arithmetic of the instrument comes
// last, so that a reading that is not a CPU time is named by the rule it breaks before it is named by the stamps it does not match.
export function judgeCpuTimeInstrumentReport(report) {
  const violations = [];
  const context = checkStructure(report, violations);
  if (context === null) {
    return {violations, judged: false};
  }
  const {frames, blocks, readings, windowed} = context;
  const stats = {lane: report.lane, loadPlacement: report.config.loadPlacement, judged: false, presented: null, reason: null};
  if (windowed) {
    const shown = presentation(report, context);
    Object.assign(stats, {presented: shown.presented, reason: shown.reason, presentation: shown});
    if (!shown.presented) {
      checkArithmetic(frames, readings, violations);
      return {violations, ...stats};
    }
  }
  stats.judged = true;
  const idle = measuredOf(blocks, "idle");
  const idleTotals = at(frames.totalMs, idle);
  const base = median(idleTotals);
  const reference = idleReference(at(frames.intervalMs, idle.slice(0, FIRST_IDLE_FRAMES)));
  stats.cpu = {idleTotalMedianMs: round(base, 6), idleTotalP95Ms: round(nearestRank(idleTotals, 95), 6), idleIntervalReferenceMs: round(reference, 3),
    idleTotalShare: round(base / reference, 4)};
  const unknown = ["idle", "load", "render-pulse"].filter(kind => measuredOf(blocks, kind).some(position => frames.renderKnown[position] !== 1));
  if (unknown.length > 0) {
    violations.push(`Every measured frame has all its terms: the render reading of each drawn frame had arrived (${unknown.join(", ")} did not)`);
  }
  if (!(base <= IDLE_SHARE * reference && nearestRank(idleTotals, 95) <= IDLE_P95_SHARE * reference)) {
    violations.push(`The idle total is a small part of the idle interval: the instrument reads CPU time and not the interval between frames (median ${round(base, 4)} ms and p95 ${round(nearestRank(idleTotals, 95), 4)} ms against an idle interval reference of ${round(reference, 3)} ms)`);
  }
  stats.accuracy = {};
  stats.variation = {};
  for (const target of TARGETS_MS) {
    const burnedMs = median(at(frames.burnUsec, measuredOf(blocks, "load", target))) / 1000;
    if (!(Math.abs(burnedMs - target) <= BURN_TOLERANCE * target)) {
      violations.push(`The busy loop of the ${target} ms block ran ${round(burnedMs, 4)} ms as the engine's clock measured it (the field truth is the target, to within 1%)`);
    }
  }
  for (const target of TARGETS_MS) {
    const positions = measuredOf(blocks, "load", target);
    const totalMs = median(at(frames.totalMs, positions));
    const readMs = totalMs - base;
    stats.accuracy[target] = {frames: positions.length, burnedMs: round(median(at(frames.burnUsec, positions)) / 1000, 4), totalMedianMs: round(totalMs, 4),
      baseMs: round(base, 4), readMs: round(readMs, 4), error: round((readMs - target) / target, 4)};
    if (!(Math.abs(readMs - target) <= TOLERANCE * target)) {
      violations.push(`The median total minus the idle median is within 10% of the ${target} ms load: it read ${round(readMs, 4)} ms (${round(100 * (readMs - target) / target, 2)}%)`);
    }
  }
  for (const target of TARGETS_MS) {
    const terms = at(frames.processMs, measuredOf(blocks, "load", target));
    let run = 0;
    let longest = 0;
    terms.forEach((term, index) => {
      run = index > 0 && term === terms[index - 1] ? run + 1 : 1;
      longest = Math.max(longest, run);
    });
    const distinct = new Set(terms).size;
    stats.variation[target] = {distinct, longestRun: longest};
    if (!(distinct >= DISTINCT_MINIMUM && longest <= RUN_MAXIMUM)) {
      violations.push(`The process term of the ${target} ms block changes from frame to frame as a clock does (${distinct} values, at most ${longest} frames the same), and not as a monitor refreshed once a second`);
    }
  }
  if (windowed) {
    const {pulses, gains} = pulseGains(frames, readings, blocks);
    const best = gains.reduce((winner, gain, lag) => (gain > gains[winner] ? lag : winner), 0);
    const responds = pulses > 0 && best === RENDER_READING_LAG_DRAWS && gains[RENDER_READING_LAG_DRAWS] >= PULSE_MINIMUM_GAIN_MS
      && gains.every((gain, lag) => lag === RENDER_READING_LAG_DRAWS || gain < 0.25 * gains[RENDER_READING_LAG_DRAWS]);
    stats.render = {pulses, gainsMs: gains.map(gain => round(gain, 4)), bestLag: best, responds};
    if (!responds) {
      violations.push(`The render term answers a synthetic render load and lands ${RENDER_READING_LAG_DRAWS} draws after the draw that caused it (the strongest lag is ${best}, with gains ${gains.map(gain => round(gain, 3)).join(", ")} ms)`);
    }
  } else {
    stats.engine = engineMonitor(frames);
    if (stats.engine.underTheInstrument > 0 || stats.engine.updates === 0 || stats.engine.medianMarginMs > ENGINE_MEDIAN_MARGIN_MS) {
      violations.push(`The engine's own TIME_PROCESS monitor agrees with the instrument's process term: never under it and at most ${ENGINE_MEDIAN_MARGIN_MS} ms over at the median (${JSON.stringify(stats.engine)})`);
    }
  }
  checkArithmetic(frames, readings, violations);
  return {violations, ...stats};
}

// The same, as an assertion: the first violation is the first rule that failed.
export function verifyCpuTimeInstrumentReport(report) {
  const verdict = judgeCpuTimeInstrumentReport(report);
  assert.equal(verdict.violations.length, 0, verdict.violations.join("\n"));
  return verdict;
}
