import assert from "node:assert/strict";
import test from "node:test";
import {GRAPHICS_RUNS, IDLE_FRAMES, NATIVE_NODES, TOUR, WARMUP_ROUNDS, ROUNDS} from "./frontier-baseline-cases.mjs";
import {UNPACED, graphicsRunValidity, summarizeGraphicsRuns, verifyGraphicsReceipt} from "./frontier-baseline-oracle.mjs";

// The validity rule of the windowed lane, on synthetic runs (no Godot, no display): a frame time exists only if a display presents the window. A run
// whose window did not draw, or whose idle frame median is under half of the refresh period that the window read back (the display off or locked:
// it draws, the vsync mode still reads enabled, and nothing paces the loop), is not a measurement, and no receipt may report it as one.
const steps = TOUR.length - 1;
const PRESENTED_IDLE_USEC = 7800;
const UNPACED_IDLE_USEC = 530;

function syntheticRun({run = 1, idleUsec = PRESENTED_IDLE_USEC, drawn = true, refreshRate = 120} = {}) {
  const swaps = Array.from({length: (WARMUP_ROUNDS + ROUNDS) * steps}, (_, index) => ({round: Math.floor(index / steps), step: index % steps,
    from: TOUR[index % steps], to: TOUR[index % steps + 1], latencyFrames: 0, flushUsec: 7000, latencyUsec: 7000, drawUsec: drawn ? 9000 : null,
    frameUsec: [9000], worldEvents: 0, worldClicks: 0}));
  return {run, config: {nativeNodes: NATIVE_NODES}, provenance: {refreshRate, vsyncMode: 1, vsyncModeName: "enabled"}, swaps,
    idle: {frames: IDLE_FRAMES, intervalsUsec: Array(IDLE_FRAMES).fill(idleUsec), draws: drawn ? IDLE_FRAMES + 1 : 0},
    frames: {processed: 5000, drawn: drawn ? 4996 : 0}};
}

const rawOf = run => ({run: run.run, attempt: run.run, idleIntervalsUsec: run.idle.intervalsUsec});

// A receipt as scripts/frontier-baseline-graphics.mjs writes it, from the runs it accepted and the attempts it rejected.
function receiptOf({accepted, rejected = [], presented}) {
  const attempts = [...accepted.map(run => ({slot: run.run, attempt: run.run, valid: true, reason: null})),
    ...rejected.map((run, index) => ({slot: 1, attempt: 100 + index, valid: false, reason: UNPACED}))];
  return {presented, status: presented ? "presented" : `not presented: ${UNPACED} (slot 1, 3 attempts)`, provenance: {refreshRate: 120},
    attempts, raw: accepted.map(rawOf), summary: presented ? summarizeGraphicsRuns(accepted) : null,
    rejectedAttempts: rejected.map((run, index) => ({slot: 1, attempt: 100 + index, valid: false, reason: UNPACED, raw: rawOf(run)}))};
}

const presentedRuns = () => Array.from({length: GRAPHICS_RUNS}, (_, index) => syntheticRun({run: index + 1}));

test("a window that draws and idles at the refresh period is a measurement", () => {
  const validity = graphicsRunValidity(syntheticRun());
  assert.equal(validity.valid, true);
  assert.equal(validity.reason, null);
  assert.ok(validity.paced && validity.drew);
  assert.equal(validity.minimumIdleMedianMs, 4.167, "the threshold is half of the 120 Hz period");
});

test("a window that draws but that no display paces is rejected as unpaced", () => {
  const validity = graphicsRunValidity(syntheticRun({idleUsec: UNPACED_IDLE_USEC}));
  assert.equal(validity.drew, true, "it drew: the old rule accepted it");
  assert.equal(validity.paced, false);
  assert.equal(validity.valid, false);
  assert.equal(validity.reason, "unpaced: the display is not presenting");
  assert.equal(validity.idleMedianMs, 0.53);
});

test("the threshold is half of the refresh period that the window read back", () => {
  assert.equal(graphicsRunValidity(syntheticRun({idleUsec: 4200})).valid, true, "4.2 ms at 120 Hz");
  assert.equal(graphicsRunValidity(syntheticRun({idleUsec: 4100})).reason, UNPACED, "4.1 ms at 120 Hz");
  assert.equal(graphicsRunValidity(syntheticRun({idleUsec: 9000, refreshRate: 60})).valid, true, "9 ms at 60 Hz");
  assert.equal(graphicsRunValidity(syntheticRun({idleUsec: 8000, refreshRate: 60})).reason, UNPACED, "8 ms at 60 Hz");
  assert.equal(graphicsRunValidity(syntheticRun({refreshRate: -1})).valid, false, "a refresh rate that was not read back judges nothing");
});

test("a window that does not draw is rejected as undrawn, whatever its pace", () => {
  const validity = graphicsRunValidity(syntheticRun({drawn: false}));
  assert.equal(validity.valid, false);
  assert.match(validity.reason, /^undrawn: /);
});

test("the statistics across runs refuse an unpaced run", () => {
  const runs = presentedRuns();
  assert.equal(summarizeGraphicsRuns(runs).runs.length, GRAPHICS_RUNS);
  runs[2] = syntheticRun({run: 3, idleUsec: UNPACED_IDLE_USEC});
  assert.throws(() => summarizeGraphicsRuns(runs), /run 3 is unpaced: the display is not presenting/);
});

test("a receipt with an unpaced accepted run is refused", () => {
  const accepted = presentedRuns();
  verifyGraphicsReceipt(receiptOf({accepted, presented: true}));
  const unpaced = syntheticRun({run: 4, idleUsec: UNPACED_IDLE_USEC});
  const receipt = receiptOf({accepted, presented: true});
  receipt.raw[3] = rawOf(unpaced);
  assert.throws(() => verifyGraphicsReceipt(receipt), /Run 4 is accepted but unpaced/);
});

test("a lane that was not presented reports no frame-time statistic, and keeps what it rejected", () => {
  const rejected = [1, 2, 3].map(attempt => syntheticRun({run: attempt, idleUsec: UNPACED_IDLE_USEC}));
  const receipt = receiptOf({accepted: [], rejected, presented: false});
  verifyGraphicsReceipt(receipt);
  assert.equal(receipt.summary, null);
  assert.equal(receipt.rejectedAttempts.length, 3);
  const leaking = {...receipt, summary: {runs: []}};
  assert.throws(() => verifyGraphicsReceipt(leaking), /reports no frame-time statistic/);
  const unexplained = structuredClone(receipt);
  unexplained.rejectedAttempts[0].reason = "";
  assert.throws(() => verifyGraphicsReceipt(unexplained), /says why/);
  const dropped = structuredClone(receipt);
  dropped.rejectedAttempts.pop();
  assert.throws(() => verifyGraphicsReceipt(dropped), /accepted or rejected/);
});

test("a lane that claims to be presented has all its runs and their statistics", () => {
  const receipt = receiptOf({accepted: presentedRuns().slice(0, 4), presented: false});
  receipt.presented = true;
  receipt.status = "presented";
  receipt.summary = null;
  assert.throws(() => verifyGraphicsReceipt(receipt), /all its runs/);
});
