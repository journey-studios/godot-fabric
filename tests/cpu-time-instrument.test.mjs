import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {RENDER_READING_LAG_DRAWS, TARGETS_MS, TOLERANCE, expectedBlocks, judgeCpuTimeInstrumentReport, median, verifyCpuTimeInstrumentReport} from "./cpu-time-instrument-oracle.mjs";

// The CPU-time instrument's oracle (tests/cpu-time-instrument-oracle.mjs) on synthetic reports, in Node and with no engine: it accepts the reports of an
// instrument that reads CPU time (headless, and in a window that a display presented) and refuses each mutation of them. The reports are made here from the
// contract, with the arithmetic written again on purpose (the oracle's own is not used to make them), and the numbers are those of a real run's shape: an
// idle frame a few microseconds of CPU in 6.9 ms (headless) or in alternating 3 and 13 ms (a 120 Hz window), a busy loop of the target in every load frame,
// the engine's monitor refreshed once a second, and a render reading that arrives six draws after its draw.
const root = fileURLToPath(new URL("..", import.meta.url));

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const LAG = 6;
const RENDER_READING_NOISE = 0.04;
const PULSE_COST_MS = 1.2;

// The terms of the contract written again: nothing here comes from the oracle.
function terms(frames, readings) {
  const byDraw = new Map();
  readings.draw.forEach((draw, index) => byDraw.set(draw, readings.ms[index]));
  const out = {intervalMs: [], processMs: [], physicsMs: [], renderMs: [], renderKnown: [], totalMs: []};
  for (let index = 0; index < frames.frame.length; ++index) {
    const drew = frames.drawIndex[index] >= 0;
    const reading = byDraw.get(frames.drawIndex[index] + LAG);
    const interval = index === 0 ? 0 : (frames.startUsec[index] - frames.startUsec[index - 1]) / 1000;
    const process = ((drew ? frames.preDrawUsec[index] : frames.lastProcessUsec[index]) - frames.startUsec[index]) / 1000;
    const physics = frames.physicsUsec[index] / 1000;
    const render = drew && reading !== undefined ? reading : 0;
    const setup = drew ? frames.setupMs[index] : 0;
    out.intervalMs.push(interval);
    out.processMs.push(process);
    out.physicsMs.push(physics);
    out.renderMs.push(render);
    out.renderKnown.push(!drew || reading !== undefined ? 1 : 0);
    out.totalMs.push(physics + process + setup + render);
  }
  return out;
}

// A report. `scale` multiplies the busy loop as the instrument reads it, per target; `reads` is what the instrument takes for the process term
// (the clock, the interval between frames, the engine's monitor, or nothing of the load because it ran outside the measured frame); `pace` is the
// loop's idle gap in microseconds when something other than the defaults paces it; `lag` is the draws the engine really takes to report a render time.
function report({windowed = false, seed = 7, scale = {}, reads = "clock", pace = null, lag = LAG} = {}) {
  const blocks = expectedBlocks(windowed);
  const total = blocks.at(-1).end;
  const random = mulberry32(seed);
  const jitter = (low, high) => low + Math.floor(random() * (high - low + 1));
  const frames = {frame: [], block: [], burnUsec: [], renderLoad: [], startUsec: [], lastProcessUsec: [], preDrawUsec: [], physicsUsec: [], drawIndex: [], drawn: [],
    setupMs: [], monitorMs: []};
  const cost = [];
  let start = 5000000;
  let monitor = 0;
  let largest = 0;
  let accumulated = 0;
  for (let step = 0; step < total; ++step) {
    const block = blocks.findIndex(each => step >= each.first && step < each.end);
    const {kind, targetMs, first, settle} = blocks[block];
    const offset = step - first - settle;
    const pulse = kind === "render-pulse" && offset >= 0 && offset % 11 === 0 ? 1 : 0;
    const burn = kind === "load" ? targetMs * 1000 + jitter(0, 4) : 0;
    const busy = jitter(6, 14) + burn + (pulse === 1 ? 3300 + jitter(0, 200) : 0);
    const paced = windowed ? (step % 2 === 0 ? 3300 : 13367) + jitter(-150, 150) : 6900 + jitter(-40, 40);
    const gap = Math.max(pace === null ? paced : pace + jitter(-20, 20), busy + jitter(100, 600));
    const taken = {clock: jitter(6, 14) + Math.round(burn * (scale[targetMs] ?? 1)) + (pulse === 1 ? 3300 : 0), interval: gap,
      monitor: Math.round(monitor * 1000), outside: jitter(6, 14)}[reads];
    frames.frame.push(1000 + step);
    frames.block.push(block);
    frames.burnUsec.push(burn);
    frames.renderLoad.push(pulse);
    frames.startUsec.push(start);
    frames.lastProcessUsec.push(start + taken - (windowed ? jitter(1, 3) : 0));
    frames.preDrawUsec.push(windowed ? start + taken : 0);
    frames.physicsUsec.push(step % 5 < 2 ? jitter(2, 5) : 0);
    frames.drawIndex.push(windowed ? step : -1);
    frames.drawn.push(windowed ? 1 : 0);
    frames.setupMs.push(windowed ? (3 + jitter(0, 3)) / 1000 : 0);
    frames.monitorMs.push(monitor);
    cost.push((60 + jitter(0, 1000 * RENDER_READING_NOISE)) / 1000 + (pulse === 1 ? PULSE_COST_MS + jitter(0, 500) / 1000 : 0));
    // The engine counts from before the process step, so it never counts less than the instrument's step (the monitor is over it by tens of microseconds).
    largest = Math.max(largest, Math.max(busy, taken) / 1000 + 0.02 + (windowed ? 13 : 0));
    accumulated += gap;
    if (accumulated > 1000000) {
      monitor = largest;
      largest = 0;
      accumulated -= 1000000;
    }
    start += gap;
  }
  const readings = {draw: [], ms: []};
  if (windowed) {
    for (let draw = 0; draw < total; ++draw) {
      readings.draw.push(draw);
      readings.ms.push(draw >= lag ? cost[draw - lag] : 0);
    }
  }
  const derived = terms(frames, readings);
  return {scenario: "cpu-time-instrument", lane: windowed ? "windowed" : "headless",
    provenance: {displayServer: windowed ? "macOS" : "headless", refreshRate: windowed ? 120 : -1, threadModel: 1},
    config: {targetsMs: [2, 5, 10, 20], tolerance: 0.1, warmupFrames: 120, settleFrames: 10, firstIdleFrames: 600, betweenIdleFrames: 200, loadFrames: 200,
      drainFrames: 12, pulse: {frames: 264, period: 11, rects: 30000, warm: 2, minimumGainMs: 0.3}, renderReadingLagDraws: 6, idleShare: 0.25, idleP95Share: 0.5,
      burnTolerance: 0.01, loadPlacement: reads === "outside" ? "before-frame" : "in-frame", blocks},
    frames: {...frames, ...derived}, renderReadings: readings, missingSamples: 0, droppedSamples: 1};
}

// The report with one change made to a copy of it.
const changed = (original, change) => {
  const copy = structuredClone(original);
  change(copy);
  return copy;
};
const firstViolation = original => judgeCpuTimeInstrumentReport(original).violations[0];

test("The oracle's constants are the probe's and the instrument's", () => {
  const probe = readFileSync(`${root}tests/cpu-time-instrument-probe.gd`, "utf8");
  const instrument = readFileSync(`${root}tests/cpu-time-instrument.gd`, "utf8");
  const constant = (source, name) => {
    const match = source.match(new RegExp(`^const ${name}(?::\\s*[^=]+?)?\\s*:?=\\s*(.+)$`, "m"));
    assert.ok(match, `${name} is declared`);
    return JSON.parse(match[1]);
  };
  assert.deepEqual(constant(probe, "TARGETS_MS"), TARGETS_MS);
  assert.equal(constant(probe, "TOLERANCE"), TOLERANCE);
  assert.equal(constant(instrument, "RENDER_READING_LAG_DRAWS"), RENDER_READING_LAG_DRAWS);
  const blocks = expectedBlocks(true);
  assert.equal(constant(probe, "WARMUP_FRAMES"), blocks[0].settle);
  assert.equal(constant(probe, "SETTLE_FRAMES"), blocks[1].settle);
  assert.equal(constant(probe, "FIRST_IDLE_FRAMES"), blocks[1].measured);
  assert.equal(constant(probe, "LOAD_FRAMES"), blocks[2].measured);
  assert.equal(constant(probe, "BETWEEN_IDLE_FRAMES"), blocks[3].measured);
  assert.equal(constant(probe, "PULSE_FRAMES"), blocks.at(-2).measured);
  assert.equal(constant(probe, "DRAIN_FRAMES"), blocks.at(-1).settle);
  assert.equal(constant(probe, "LOAD_PLACEMENT"), "in-frame", "The genuine probe puts the busy loop between the instrument's stamps");
});

test("The median of an even count is the mean of the two middle values", () => {
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([]), 0);
});

test("The oracle accepts the report of an instrument that reads CPU time, headless", () => {
  const verdict = verifyCpuTimeInstrumentReport(report());
  assert.equal(verdict.judged, true);
  for (const target of TARGETS_MS) {
    assert.ok(Math.abs(verdict.accuracy[target].error) < 0.01, `${target} ms read within 1%`);
  }
  assert.ok(verdict.cpu.idleTotalShare < 0.01, "The idle total is a hundredth of the idle interval");
  assert.equal(verdict.engine.underTheInstrument, 0);
  // Other seeds: the verdict does not hang on one draw of the jitter.
  for (const seed of [1, 2, 3, 4, 5]) {
    verifyCpuTimeInstrumentReport(report({seed}));
  }
});

test("The oracle accepts the report of a window that a display presented, and the render term lands six draws after its draw", () => {
  const verdict = verifyCpuTimeInstrumentReport(report({windowed: true}));
  assert.equal(verdict.presented, true);
  assert.equal(verdict.render.bestLag, 6);
  assert.ok(verdict.render.gainsMs[6] > 1);
  assert.ok(verdict.render.gainsMs.filter((_, lag) => lag !== 6).every(gain => Math.abs(gain) < 0.05));
  assert.ok(verdict.presentation.idleIntervalReferenceMs > 8 && verdict.presentation.idleIntervalReferenceMs < 8.7, "A 120 Hz window's idle reference is near 8.3 ms");
  assert.ok(verdict.cpu.idleTotalShare < 0.05);
  for (const seed of [1, 2, 3]) {
    verifyCpuTimeInstrumentReport(report({windowed: true, seed}));
  }
});

test("Each load is judged to within 10% of its target, the boundary belonging to the accepted side", () => {
  // The instrument reads 9% over and 9% under: inside the rule.
  verifyCpuTimeInstrumentReport(report({scale: {10: 1.09}}));
  verifyCpuTimeInstrumentReport(report({scale: {2: 0.91, 20: 0.91}}));
  for (const target of TARGETS_MS) {
    const over = judgeCpuTimeInstrumentReport(report({scale: {[target]: 1.15}}));
    assert.match(over.violations[0], new RegExp(`within 10% of the ${target} ms load`), `${target} ms read 15% over`);
    assert.equal(over.violations.length, 1, "and only that rule accuses");
    const under = judgeCpuTimeInstrumentReport(report({scale: {[target]: 0.85}}));
    assert.match(under.violations[0], new RegExp(`within 10% of the ${target} ms load`), `${target} ms read 15% under`);
  }
});

test("An instrument that reads the interval between frames and not the CPU time is refused by the CPU rule first", () => {
  for (const windowed of [false, true]) {
    const verdict = judgeCpuTimeInstrumentReport(report({reads: "interval", windowed}));
    assert.match(verdict.violations[0], /reads CPU time and not the interval between frames/);
    assert.ok(verdict.violations.length > 1, "and the loads it cannot see are refused after it");
  }
});

test("An instrument that reads the engine's once-a-second monitor as the frame's process time is refused: it repeats and it disagrees with its own stamps", () => {
  const verdict = judgeCpuTimeInstrumentReport(report({reads: "monitor"}));
  assert.ok(verdict.violations.some(violation => /changes from frame to frame as a clock does/.test(violation)), verdict.violations.join("\n"));
});

test("A busy loop that ran outside the measured frame is not seen, and the 10% rule says so", () => {
  const verdict = judgeCpuTimeInstrumentReport(report({reads: "outside"}));
  assert.match(verdict.violations[0], /within 10% of the 2 ms load/);
  assert.equal(verdict.violations.filter(violation => /within 10%/.test(violation)).length, 4, "all four loads are missing");
  assert.equal(verdict.violations.some(violation => /busy loop/.test(violation)), false, "while the field truth, measured by the engine's clock, says the loop ran");
});

test("A load that did not run what was asked is refused by the field truth", () => {
  const verdict = judgeCpuTimeInstrumentReport(changed(report(), original => {
    original.frames.burnUsec = original.frames.burnUsec.map(burn => (burn === 10000 || burn > 10000 && burn < 10005 ? 7000 : burn));
  }));
  assert.match(verdict.violations[0], /busy loop of the 10 ms block ran 7 ms/);
});

test("A frame without a sample is refused, whether the columns are short or the instrument says it missed one", () => {
  assert.match(firstViolation(changed(report(), original => {
    for (const column of Object.values(original.frames)) {
      column.splice(1500, 1);
    }
  })), /one entry for each of the 2422 scheduled frames/);
  assert.match(firstViolation(changed(report(), original => {
    original.missingSamples = 1;
  })), /lacked a sample/);
  assert.match(firstViolation(changed(report(), original => {
    original.frames.frame[900] = original.frames.frame[899];
  })), /consecutive process frames/);
  assert.match(firstViolation(changed(report(), original => {
    delete original.frames.totalMs;
  })), /one entry for each/);
});

test("The experiment is pinned: a different tolerance, schedule or lane is refused", () => {
  assert.match(firstViolation(changed(report(), original => {
    original.config.tolerance = 0.2;
  })), /experiment this oracle recomputes/);
  assert.match(firstViolation(changed(report(), original => {
    original.config.renderReadingLagDraws = 5;
  })), /experiment this oracle recomputes/);
  assert.match(firstViolation(changed(report(), original => {
    original.config.blocks[2].targetMs = 3;
  })), /schedule of blocks/);
  assert.match(firstViolation(changed(report(), original => {
    original.lane = "elsewhere";
  })), /names its lane/);
  assert.match(judgeCpuTimeInstrumentReport(changed(report(), original => {
    original.provenance.displayServer = "macOS";
  })).violations[0], /lane agrees with the display server/);
});

test("The instrument's terms are what its stamps give: a total that is not the sum, or a process term that is not the clock difference, is refused", () => {
  const sum = judgeCpuTimeInstrumentReport(changed(report(), original => {
    original.frames.totalMs[400] += 0.001;
  }));
  assert.match(sum.violations.at(-1), /totalMs of the frame 1400 is/);
  const process = judgeCpuTimeInstrumentReport(changed(report(), original => {
    original.frames.processMs[400] += 0.001;
    original.frames.totalMs[400] += 0.001;
  }));
  assert.match(process.violations.at(-1), /processMs of the frame 1400 is/);
  const reading = judgeCpuTimeInstrumentReport(changed(report({windowed: true}), original => {
    original.frames.renderMs[400] += 0.01;
    original.frames.totalMs[400] += 0.01;
  }));
  assert.match(reading.violations.at(-1), /renderMs of the frame 1400 is/);
});

test("The engine's own monitor is the cross-check: an instrument over what the engine counted for the second is refused", () => {
  const verdict = judgeCpuTimeInstrumentReport(changed(report(), original => {
    original.frames.monitorMs = original.frames.monitorMs.map(value => value / 2);
  }));
  assert.match(verdict.violations[0], /TIME_PROCESS monitor agrees with the instrument's process term/);
  assert.ok(verdict.engine.underTheInstrument > 0);
});

test("A headless run that drew something is refused", () => {
  const verdict = judgeCpuTimeInstrumentReport(changed(report(), original => {
    original.renderReadings.draw = [0];
    original.renderReadings.ms = [0.5];
  }));
  assert.match(verdict.violations[0], /draws nothing/);
});

test("A window that no display paced is not a measurement: nothing is judged but the arithmetic, and the answer says why", () => {
  // The display off or showing the lock screen: the window draws and the vsync reads back enabled, but an idle frame takes 0.7 ms.
  const unpaced = judgeCpuTimeInstrumentReport(report({windowed: true, pace: 700}));
  assert.equal(unpaced.presented, false);
  assert.equal(unpaced.judged, false);
  assert.match(unpaced.reason, /did not pace the loop/);
  assert.deepEqual(unpaced.violations, []);
  assert.ok(unpaced.presentation.idleIntervalReferenceMs < 1, "The idle reference of an unpaced window is under a millisecond");
  assert.equal(unpaced.accuracy, undefined, "and no accuracy is claimed");
  assert.throws(() => verifyCpuTimeInstrumentReport(changed(report({windowed: true, pace: 700}), original => {
    original.frames.totalMs[400] += 0.01;
  })), /totalMs of the frame 1400/, "The arithmetic is judged even then");
  // A window that did not draw (covered by other windows, or the display asleep).
  const undrawn = judgeCpuTimeInstrumentReport(changed(report({windowed: true}), original => {
    original.frames.drawn = original.frames.drawn.map((drawn, index) => (index >= 130 && index < 740 && index % 3 !== 0 ? 0 : drawn));
    original.frames.drawIndex = original.frames.drawIndex.map((draw, index) => (original.frames.drawn[index] === 0 ? -1 : draw));
  }));
  assert.equal(undrawn.presented, false);
  assert.match(undrawn.reason, /did not draw nine in ten/);
  // The refresh rate that the window read back is part of the rule: a window that reads none is not paced.
  assert.equal(judgeCpuTimeInstrumentReport(changed(report({windowed: true}), original => {
    original.provenance.refreshRate = -1;
  })).presented, false);
});

test("A window whose draw runs on a render thread is refused: the render term is not the main thread's", () => {
  assert.match(firstViolation(changed(report({windowed: true}), original => {
    original.provenance.threadModel = 2;
  })), /rendering thread model is not the separate render thread/);
});

test("A render term whose lag is not the instrument's is refused, and so is one that does not answer the render load", () => {
  // The engine takes five draws, not six: the readings land a draw early for the instrument's constant.
  const early = judgeCpuTimeInstrumentReport(report({windowed: true, lag: 5}));
  assert.match(early.violations[0], /lands 6 draws after the draw that caused it \(the strongest lag is 5/);
  const late = judgeCpuTimeInstrumentReport(report({windowed: true, lag: 7}));
  assert.match(late.violations[0], /strongest lag is 7/);
  // No reading ever moves.
  const flat = judgeCpuTimeInstrumentReport(changed(report({windowed: true}), original => {
    original.renderReadings.ms = original.renderReadings.ms.map(() => 0.08);
    original.frames.renderMs = original.frames.renderMs.map((_, index) => (original.frames.drawIndex[index] >= 0 && original.frames.renderKnown[index] === 1 ? 0.08 : 0));
    original.frames.totalMs = original.frames.totalMs.map((_, index) => original.frames.physicsMs[index] + original.frames.processMs[index] + original.frames.setupMs[index]
      + original.frames.renderMs[index]);
  }));
  assert.ok(flat.violations.some(violation => /render term answers a synthetic render load/.test(violation)), flat.violations.join("\n"));
});

test("A drawn frame whose render reading had not arrived is not a sample of the measured blocks", () => {
  const verdict = judgeCpuTimeInstrumentReport(changed(report({windowed: true}), original => {
    original.renderReadings.draw = original.renderReadings.draw.slice(0, 1000);
    original.renderReadings.ms = original.renderReadings.ms.slice(0, 1000);
    const redone = terms(original.frames, original.renderReadings);
    Object.assign(original.frames, redone);
  }));
  assert.ok(verdict.violations.some(violation => /render reading of each drawn frame had arrived/.test(violation)), verdict.violations.join("\n"));
});

// The windowed lane's script judges a recorded report without a window (--replay) and can be pointed at a directory of its own (--root): the replay below
// runs in an empty one, which has no build/.
test("The windowed lane replays a recorded report in a checkout with no build/, and its receipt does not pass the replaying machine off as the measurement's", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "cpu-time-instrument-replay-"));
  try {
    const replay = (name, recorded) => {
      const file = path.join(directory, `${name}.json`);
      writeFileSync(file, JSON.stringify(recorded));
      const result = spawnSync(process.execPath, [`${root}scripts/cpu-time-instrument-graphics.mjs`, `--replay=${file}`, `--root=${directory}`], {encoding: "utf8", timeout: 120000});
      const receiptFile = path.join(directory, "build/cpu-time-instrument-graphics-replay.json");
      return {status: result.status, output: result.stdout + result.stderr, receipt: JSON.parse(readFileSync(receiptFile, "utf8"))};
    };
    assert.equal(existsSync(path.join(directory, "build")), false, "The directory starts with no build/");
    // The raw report of a presented window: judged, exit 0, and nothing in the receipt says the replaying machine measured it.
    const presented = replay("presented", report({windowed: true}));
    assert.equal(presented.status, 0, presented.output);
    assert.equal(existsSync(path.join(directory, "build")), true, "The script makes build/ itself");
    assert.equal(presented.receipt.presented, true);
    assert.equal(presented.receipt.replayed, true);
    assert.equal("machine" in presented.receipt, false, "A replay has no machine of its own making");
    assert.ok("replayHost" in presented.receipt, "It records the machine that replayed it apart");
    assert.match(presented.receipt.measuredOn, /replayed report \(the machine of its measurement is not recorded in it/);
    assert.match(presented.receipt.command, /--replay/);
    // The receipt of a run, which keeps the report under raw and the machine that measured it: that machine is the measurement's.
    const measuring = {chip: "the measuring machine", logicalCores: 11};
    const fromReceipt = replay("receipt", {raw: report({windowed: true}), machine: measuring});
    assert.equal(fromReceipt.status, 0, fromReceipt.output);
    assert.deepEqual(fromReceipt.receipt.machine, measuring);
    assert.match(fromReceipt.receipt.measuredOn, /machine recorded in the receipt it came from/);
    assert.ok("replayHost" in fromReceipt.receipt);
    // A window that no display presented: exit 3, and no accuracy is claimed.
    const unpaced = replay("unpaced", report({windowed: true, pace: 700}));
    assert.equal(unpaced.status, 3, unpaced.output);
    assert.equal(unpaced.receipt.presented, false);
    assert.equal(unpaced.receipt.status, "not presented: the display did not pace the loop");
    assert.equal(unpaced.receipt.verdict.accuracy, undefined);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});
