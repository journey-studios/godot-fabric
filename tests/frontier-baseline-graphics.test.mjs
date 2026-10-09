import assert from "node:assert/strict";
import test from "node:test";
import {GRAPHICS_RUNS, IDLE_FRAMES, NATIVE_NODES, TOUR, WARMUP_ROUNDS, ROUNDS} from "./frontier-baseline-cases.mjs";
import {UNPACED, graphicsRunValidity, idleReference, summarizeGraphicsRuns, verifyGraphicsReceipt} from "./frontier-baseline-oracle.mjs";

// The validity rule of the windowed lane, on synthetic runs (no Godot, no display): a frame time exists only if a display presents the window. A run
// whose window did not draw, or whose idle reference (the median of the half-sums of consecutive pairs of the idle intervals) is under half of the
// refresh period that the window read back (the display off or locked: it draws, the vsync mode still reads enabled, and nothing paces the loop), is
// not a measurement, and no receipt may report it as one. The median of the idle intervals used to judge it and fell in one of the two groups of a
// presented window at 120 Hz by a few samples (docs/research/frontier-baseline.md, "The idle reference"); the cases below are that, and what the
// reference must still refuse.
const steps = TOUR.length - 1;
const PRESENTED_IDLE_USEC = 7800;
const UNPACED_IDLE_USEC = 530;
// A presented window at 120 Hz: two groups that alternate and add up to one period (8,333 us), the median in the low group 31 us under half a period
// (the attempt A8 of the baseline: median 4.136 ms, mean 8.333 ms).
const alternating = (low, high) => Array.from({length: IDLE_FRAMES}, (_, index) => index % 2 === 0 ? low : high);
const TWO_GROUPS_USEC = alternating(4136, 12530);

function syntheticRun({run = 1, idleUsec = PRESENTED_IDLE_USEC, idleIntervals = null, drawn = true, refreshRate = 120, swapFrameUsec = 9000} = {}) {
  const swaps = Array.from({length: (WARMUP_ROUNDS + ROUNDS) * steps}, (_, index) => ({round: Math.floor(index / steps), step: index % steps,
    from: TOUR[index % steps], to: TOUR[index % steps + 1], latencyFrames: 0, flushUsec: 7000, latencyUsec: 7000, drawUsec: drawn ? 9000 : null,
    frameUsec: [swapFrameUsec], worldEvents: 0, worldClicks: 0}));
  return {run, config: {nativeNodes: NATIVE_NODES}, provenance: {refreshRate, vsyncMode: 1, vsyncModeName: "enabled"}, swaps,
    idle: {frames: IDLE_FRAMES, intervalsUsec: idleIntervals ?? Array(IDLE_FRAMES).fill(idleUsec), draws: drawn ? IDLE_FRAMES + 1 : 0},
    frames: {processed: 5000, drawn: drawn ? 4996 : 0}};
}

const rawOf = run => ({run: run.run, attempt: run.run, idleIntervalsUsec: run.idle.intervalsUsec});

// A receipt as scripts/frontier-baseline-graphics.mjs writes it, from the runs it accepted and the attempts it rejected: the attempts carry what
// graphicsRunValidity says of each. `legacy` is a receipt recorded before the idle reference: no attempt has idleReferenceMs and no count of the
// summary is "above twice the idle reference".
function receiptOf({accepted, rejected = [], presented, legacy = false}) {
  const noReference = ({idleReferenceMs: _reference, minimumIdleReferenceMs: _minimum, ...rest}) => rest;
  const judged = (run, slot, attempt) => ({slot, attempt, ...(legacy ? noReference(graphicsRunValidity(run)) : graphicsRunValidity(run))});
  const attempts = [...accepted.map(run => judged(run, run.run, run.run)), ...rejected.map((run, index) => judged(run, 1, 100 + index))];
  const summary = presented ? summarizeGraphicsRuns(accepted) : null;
  if (legacy && summary !== null) {
    for (const run of summary.runs) {
      delete run.idleFrameMs.aboveTwiceIdleReference;
      delete run.swapFrameMs.aboveTwiceIdleReference;
    }
    delete summary.across.idleFrameMs.aboveTwiceIdleReference;
    delete summary.across.swapFrameMs.aboveTwiceIdleReference;
  }
  return {presented, status: presented ? "presented" : `not presented: ${UNPACED} (slot 1, 3 attempts)`, provenance: {refreshRate: 120},
    attempts, raw: accepted.map(rawOf), summary,
    rejectedAttempts: rejected.map((run, index) => ({...judged(run, 1, 100 + index), reason: UNPACED, raw: rawOf(run)}))};
}

const presentedRuns = () => Array.from({length: GRAPHICS_RUNS}, (_, index) => syntheticRun({run: index + 1}));

test("a window that draws and idles at the refresh period is a measurement", () => {
  const validity = graphicsRunValidity(syntheticRun());
  assert.equal(validity.valid, true);
  assert.equal(validity.reason, null);
  assert.ok(validity.paced && validity.drew);
  assert.equal(validity.minimumIdleReferenceMs, 4.167, "the threshold is half of the 120 Hz period");
  assert.equal(validity.minimumIdleMedianMs, 4.167, "the field that the receipts and tests already read is kept, with the same value");
  assert.equal(validity.idleReferenceMs, 7.8);
  assert.equal(validity.idleMedianMs, 7.8, "and the median is still recorded");
});

test("the idle reference is the median of the half-sums of consecutive pairs", () => {
  assert.equal(idleReference([1, 3, 1, 3, 1, 3]), 2, "two groups that alternate: every pair is one of each");
  assert.equal(idleReference([5, 5, 5, 5]), 5);
  assert.equal(idleReference([2, 4]), 3, "one pair");
  assert.equal(idleReference([7]), 0, "fewer than two intervals have no reference");
  assert.equal(idleReference([]), 0);
  assert.equal(idleReference([0.5, ...Array(5000).fill(0.5), 5000, ...Array(5000).fill(0.5)]), 0.5, "a single stall moves two of the half-sums and not their median");
});

test("a presented window at 120 Hz whose idle median falls in the low group is a measurement (attempt A8 of the baseline)", () => {
  const validity = graphicsRunValidity(syntheticRun({idleIntervals: TWO_GROUPS_USEC}));
  assert.equal(validity.idleMedianMs, 4.136, "the median is in the low group, 0.031 ms under half of the period");
  assert.ok(validity.idleMedianMs < validity.minimumIdleMedianMs, "and the old rule refused this run");
  assert.equal(validity.idleMeanMs, 8.333);
  assert.equal(validity.idleReferenceMs, 8.333, "while every pair adds up to about one period");
  assert.equal(validity.paced, true);
  assert.equal(validity.valid, true);
  assert.equal(validity.reason, null);
  const highGroup = graphicsRunValidity(syntheticRun({idleIntervals: alternating(12530, 4136)}));
  assert.equal(highGroup.idleReferenceMs, 8.333, "the same wherever the groups start");
  assert.equal(highGroup.valid, true);
  const jittered = Array.from({length: IDLE_FRAMES}, (_, index) => (index % 2 === 0 ? 1200 + 40 * (index % 17) : 14000 - 25 * (index % 13)));
  assert.equal(graphicsRunValidity(syntheticRun({idleIntervals: jittered})).valid, true, "with the groups spread out");
});

test("a window that draws but that no display paces is rejected as unpaced", () => {
  const validity = graphicsRunValidity(syntheticRun({idleUsec: UNPACED_IDLE_USEC}));
  assert.equal(validity.drew, true, "it drew: the old rule accepted it");
  assert.equal(validity.paced, false);
  assert.equal(validity.valid, false);
  assert.equal(validity.reason, "unpaced: the display is not presenting");
  assert.equal(validity.idleMedianMs, 0.53);
  assert.equal(validity.idleReferenceMs, 0.53);
  const rough = graphicsRunValidity(syntheticRun({idleIntervals: alternating(300, 900)}));
  assert.equal(rough.idleReferenceMs, 0.6, "a loop with no rhythm whose intervals differ: about 0.6 ms a half-sum");
  assert.equal(rough.reason, UNPACED);
});

test("a single large stall in a loop that nothing paces does not make it paced", () => {
  const stalled = Array(IDLE_FRAMES).fill(UNPACED_IDLE_USEC);
  stalled[300] = 5_000_000;
  const validity = graphicsRunValidity(syntheticRun({idleIntervals: stalled}));
  assert.ok(validity.idleMeanMs > validity.minimumIdleReferenceMs, "the mean would accept it: one stall of 5 s lifts it to 8.9 ms");
  assert.equal(validity.idleMedianMs, 0.53);
  assert.equal(validity.idleReferenceMs, 0.53, "the half-sums of the other pairs are untouched");
  assert.equal(validity.paced, false);
  assert.equal(validity.reason, UNPACED);
});

test("the threshold is half of the refresh period that the window read back", () => {
  assert.equal(graphicsRunValidity(syntheticRun({idleUsec: 4200})).valid, true, "4.2 ms at 120 Hz");
  assert.equal(graphicsRunValidity(syntheticRun({idleUsec: 4100})).reason, UNPACED, "4.1 ms at 120 Hz");
  assert.equal(graphicsRunValidity(syntheticRun({idleUsec: 9000, refreshRate: 60})).valid, true, "9 ms at 60 Hz");
  assert.equal(graphicsRunValidity(syntheticRun({idleUsec: 8000, refreshRate: 60})).reason, UNPACED, "8 ms at 60 Hz");
  assert.equal(graphicsRunValidity(syntheticRun({refreshRate: -1})).valid, false, "a refresh rate that was not read back judges nothing");
});

test("a presented window at 60 Hz is a measurement, whichever way its intervals fall", () => {
  const steady = graphicsRunValidity(syntheticRun({idleUsec: 16667, refreshRate: 60}));
  assert.equal(steady.minimumIdleReferenceMs, 8.333, "the threshold is half of the 60 Hz period");
  assert.equal(steady.valid, true);
  const clustered = graphicsRunValidity(syntheticRun({idleIntervals: alternating(6000, 27334), refreshRate: 60}));
  assert.equal(clustered.idleMedianMs, 6, "two groups that alternate, with the median in the low group");
  assert.equal(clustered.idleReferenceMs, 16.667);
  assert.equal(clustered.valid, true);
  const unpaced = graphicsRunValidity(syntheticRun({idleIntervals: alternating(300, 900), refreshRate: 60}));
  assert.equal(unpaced.reason, UNPACED, "and an unpaced loop is still refused at 60 Hz");
});

test("a window that does not draw is rejected as undrawn, whatever its pace", () => {
  const validity = graphicsRunValidity(syntheticRun({drawn: false}));
  assert.equal(validity.valid, false);
  assert.match(validity.reason, /^undrawn: /);
  const clusteredAndUndrawn = graphicsRunValidity(syntheticRun({idleIntervals: TWO_GROUPS_USEC, drawn: false}));
  assert.match(clusteredAndUndrawn.reason, /^undrawn: /, "the idle reference does not excuse a window that did not draw");
});

test("the statistics across runs refuse an unpaced run, and say which value failed", () => {
  const runs = presentedRuns();
  assert.equal(summarizeGraphicsRuns(runs).runs.length, GRAPHICS_RUNS);
  runs[2] = syntheticRun({run: 3, idleUsec: UNPACED_IDLE_USEC});
  assert.throws(() => summarizeGraphicsRuns(runs), /run 3 is unpaced: the display is not presenting \(idle reference 0.53 ms, at least 4.167 ms wanted; idle median 0.53 ms, recorded\)/);
  runs[2] = syntheticRun({run: 3, idleIntervals: TWO_GROUPS_USEC});
  assert.equal(summarizeGraphicsRuns(runs).runs.length, GRAPHICS_RUNS, "while a run whose median is in the low group is summarized");
});

test("the frames above twice the idle reference do not depend on the group the median falls in", () => {
  const clicks = ROUNDS * steps;
  const runs = Array.from({length: GRAPHICS_RUNS}, (_, index) => syntheticRun({run: index + 1, idleIntervals: TWO_GROUPS_USEC, swapFrameUsec: 9000}));
  const summary = summarizeGraphicsRuns(runs);
  for (const run of summary.runs) {
    assert.equal(run.swapFrameMs.samples, clicks);
    assert.equal(run.swapFrameMs.aboveTwiceIdleMedian, clicks, "every 9 ms click is above twice the low median (8.27 ms): the count as it has always been taken");
    assert.equal(run.swapFrameMs.aboveTwiceIdleReference, 0, "and none is above twice the reference (16.67 ms)");
    assert.equal(run.idleFrameMs.aboveTwiceIdleMedian, IDLE_FRAMES / 2);
    assert.equal(run.idleFrameMs.aboveTwiceIdleReference, 0);
  }
  assert.equal(summary.across.swapFrameMs.aboveTwiceIdleMedian.median, clicks);
  assert.equal(summary.across.swapFrameMs.aboveTwiceIdleReference.median, 0, "both counts are in the aggregate across the runs");
  assert.equal(summary.across.idleFrameMs.aboveTwiceIdleReference.max, 0);
  const slow = summarizeGraphicsRuns(Array.from({length: GRAPHICS_RUNS}, (_, index) => syntheticRun({run: index + 1, idleIntervals: TWO_GROUPS_USEC, swapFrameUsec: 20000})));
  assert.equal(slow.runs[0].swapFrameMs.aboveTwiceIdleReference, clicks, "a click of 20 ms is above twice the reference of 8.33 ms");
});

test("a receipt with an unpaced accepted run is refused", () => {
  const accepted = presentedRuns();
  verifyGraphicsReceipt(receiptOf({accepted, presented: true}));
  const unpaced = syntheticRun({run: 4, idleUsec: UNPACED_IDLE_USEC});
  const receipt = receiptOf({accepted, presented: true});
  receipt.raw[3] = rawOf(unpaced);
  assert.throws(() => verifyGraphicsReceipt(receipt), /Run 4 is accepted but unpaced: its idle reference .* is 0.53 ms/);
});

test("a receipt written under the idle reference accepts a run whose median is in the low group", () => {
  const accepted = presentedRuns();
  accepted[1] = syntheticRun({run: 2, idleIntervals: TWO_GROUPS_USEC});
  verifyGraphicsReceipt(receiptOf({accepted, presented: true}));
});

test("a receipt recorded before the idle reference is judged by the median it was judged by, and still verifies", () => {
  const accepted = presentedRuns();
  const legacy = receiptOf({accepted, presented: true, legacy: true});
  assert.ok(legacy.attempts.every(attempt => attempt.idleReferenceMs === undefined && attempt.idleMedianMs !== undefined), "it has no idle reference");
  assert.ok(legacy.summary.runs.every(run => run.swapFrameMs.aboveTwiceIdleReference === undefined && run.swapFrameMs.aboveTwiceIdleMedian !== undefined));
  verifyGraphicsReceipt(legacy);
  const unpaced = receiptOf({accepted, presented: true, legacy: true});
  unpaced.raw[3] = rawOf(syntheticRun({run: 4, idleUsec: UNPACED_IDLE_USEC}));
  assert.throws(() => verifyGraphicsReceipt(unpaced), /Run 4 is accepted but unpaced: its idle frame median is 0.53 ms/);
  const lowMedian = receiptOf({accepted, presented: true, legacy: true});
  lowMedian.raw[3] = rawOf(syntheticRun({run: 4, idleIntervals: TWO_GROUPS_USEC}));
  assert.throws(() => verifyGraphicsReceipt(lowMedian), /Run 4 is accepted but unpaced: its idle frame median is 4.136 ms/, "a recorded receipt is not reclassified");
});

test("a count above twice the idle reference that is not a count of the samples is refused", () => {
  const receipt = receiptOf({accepted: presentedRuns(), presented: true});
  receipt.summary.runs[0].swapFrameMs.aboveTwiceIdleReference = receipt.summary.runs[0].swapFrameMs.samples + 1;
  assert.throws(() => verifyGraphicsReceipt(receipt), /the frames above twice the idle reference are a count of its samples/);
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
