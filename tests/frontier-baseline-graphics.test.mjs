import assert from "node:assert/strict";
import test from "node:test";
import {GRAPHICS_RUNS, IDLE_FRAMES, NATIVE_NODES, TOUR, WARMUP_ROUNDS, ROUNDS} from "./frontier-baseline-cases.mjs";
import {UNPACED, graphicsRunValidity, idleReference, summarizeGraphicsRuns, undrawnReason, verifyGraphicsReceipt, verifyPresence} from "./frontier-baseline-oracle.mjs";

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

// The record of the window's presence as tests/window-presence.gd writes it: `undrawable` frames of `sampled` in which the engine could not draw, in the spans
// given (one span of all of them by default).
function presenceOf(undrawable, {sampled = 5000, spans = undrawable > 0 ? [[300, undrawable, 2_400_000, 2_400_000 + undrawable * 7000]] : []} = {}) {
  return {windowed: true, opened: {windowed: true, alwaysOnTop: true, focused: true, mode: 0, canDraw: true, waitedFrames: 12, waitedUsec: 101_000, stableFrames: 12,
    waitLimitUsec: 3_000_000}, sampledFrames: sampled, undrawableFrames: undrawable, spanCount: spans.length, spans, canDrawAtEnd: undrawable === 0};
}

function syntheticRun({run = 1, idleUsec = PRESENTED_IDLE_USEC, idleIntervals = null, drawn = true, refreshRate = 120, swapFrameUsec = 9000, presence} = {}) {
  const swaps = Array.from({length: (WARMUP_ROUNDS + ROUNDS) * steps}, (_, index) => ({round: Math.floor(index / steps), step: index % steps,
    from: TOUR[index % steps], to: TOUR[index % steps + 1], latencyFrames: 0, flushUsec: 7000, latencyUsec: 7000, drawUsec: drawn ? 9000 : null,
    frameUsec: [swapFrameUsec], worldEvents: 0, worldClicks: 0}));
  return {run, config: {nativeNodes: NATIVE_NODES}, provenance: {refreshRate, vsyncMode: 1, vsyncModeName: "enabled"}, swaps,
    idle: {frames: IDLE_FRAMES, intervalsUsec: idleIntervals ?? Array(IDLE_FRAMES).fill(idleUsec), draws: drawn ? IDLE_FRAMES + 1 : 0},
    frames: {processed: 5000, drawn: drawn ? 4996 : 0}, ...(presence === undefined ? {} : {presence})};
}

const rawOf = run => ({run: run.run, attempt: run.run, idleIntervalsUsec: run.idle.intervalsUsec, ...(run.presence === undefined ? {} : {presence: run.presence})});

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
  const lastReason = rejected.length === 0 ? UNPACED : graphicsRunValidity(rejected.at(-1)).reason;
  return {presented, status: presented ? "presented" : `not presented: ${lastReason} (slot 1, 3 attempts)`, provenance: {refreshRate: 120},
    attempts, raw: accepted.map(rawOf), summary,
    rejectedAttempts: rejected.map((run, index) => ({...judged(run, 1, 100 + index), raw: rawOf(run)}))};
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

// ----------------------------------------------------------------------------------------------------- the window's presence (tests/window-presence.gd)
test("a run refused for not drawing says whether the engine could draw the window", () => {
  const covered = graphicsRunValidity(syntheticRun({drawn: false, presence: presenceOf(112)}));
  assert.equal(covered.valid, false);
  assert.equal(covered.drew, false);
  assert.equal(covered.reason, "undrawn: the window did not draw throughout (the window could not draw: window_can_draw() was false in 112 of 5000 sampled frames, in 1 span)");
  assert.equal(covered.undrawableFrames, 112, "the count is in the validity, and so in the attempt of the receipt");
  assert.equal(covered.sampledFrames, 5000);
  const spans = [[300, 40, 2_400_000, 2_700_000], [900, 60, 6_000_000, 6_400_000]];
  assert.match(graphicsRunValidity(syntheticRun({drawn: false, presence: presenceOf(100, {spans})})).reason, /false in 100 of 5000 sampled frames, in 2 spans\)$/);
  const capable = graphicsRunValidity(syntheticRun({drawn: false, presence: presenceOf(0)}));
  assert.equal(capable.valid, false, "a window the engine could draw that was not drawn is refused all the same");
  assert.equal(capable.reason, "undrawn: the window did not draw throughout (the engine could draw: window_can_draw() was never false in the 5000 sampled frames)");
  assert.equal(capable.undrawableFrames, 0);
  assert.equal(undrawnReason(undefined), "undrawn: the window did not draw throughout");
});

test("a run recorded without the presence is refused with the plain reason, and has no count", () => {
  const validity = graphicsRunValidity(syntheticRun({drawn: false}));
  assert.equal(validity.reason, "undrawn: the window did not draw throughout");
  assert.equal(validity.undrawableFrames, null);
  assert.equal(validity.sampledFrames, null);
  assert.equal(graphicsRunValidity(syntheticRun()).undrawableFrames, null);
});

test("the rule of validity does not read the presence: a run that drew is valid whatever the engine said, and one that did not is refused", () => {
  const flickered = graphicsRunValidity(syntheticRun({presence: presenceOf(30)}));
  assert.equal(flickered.valid, true, "30 frames the engine could not draw, and the window drew throughout");
  assert.equal(flickered.reason, null);
  assert.equal(flickered.undrawableFrames, 30, "the count is recorded all the same");
  for (const presence of [undefined, presenceOf(0), presenceOf(112), presenceOf(4900)]) {
    const undrawn = graphicsRunValidity(syntheticRun({drawn: false, presence}));
    assert.equal(undrawn.valid, false);
    assert.match(undrawn.reason, /^undrawn: /);
    const unpaced = graphicsRunValidity(syntheticRun({idleUsec: UNPACED_IDLE_USEC, presence}));
    assert.equal(unpaced.reason, UNPACED, "an unpaced run that drew keeps its reason");
  }
});

test("the presence a run carries adds up", () => {
  const record = presenceOf(112);
  verifyPresence(record, "synthetic");
  verifyPresence(presenceOf(0), "synthetic");
  const clipped = presenceOf(500, {spans: Array.from({length: 64}, (_, index) => [100 + index * 10, 5, index * 1000, index * 1000 + 40])});
  clipped.spanCount = 80;
  verifyPresence(clipped, "synthetic, the first 64 of 80 spans");
  const bad = change => {
    const copy = structuredClone(record);
    change(copy);
    return copy;
  };
  assert.throws(() => verifyPresence(bad(copy => { copy.undrawableFrames = 5001; }), "synthetic"), /a count of the sampled ones/);
  assert.throws(() => verifyPresence(bad(copy => { copy.spans[0][1] = 111; }), "synthetic"), /add up/);
  assert.throws(() => verifyPresence(bad(copy => { copy.spanCount = 0; copy.spans = []; }), "synthetic"), /come in spans/);
  assert.throws(() => verifyPresence(bad(copy => { copy.spans[0][3] = 1; }), "synthetic"), /a span is/);
  assert.throws(() => verifyPresence(bad(copy => { copy.windowed = false; }), "synthetic"), /of a window/);
  assert.throws(() => verifyPresence(bad(copy => { delete copy.canDrawAtEnd; }), "synthetic"), /whether it could when the lane ended/);
  assert.throws(() => verifyPresence(bad(copy => { copy.opened.alwaysOnTop = "yes"; }), "synthetic"), /above the others/);
});

test("a receipt keeps the count of each attempt, and a refusal for not drawing in it says what the engine said", () => {
  const accepted = presentedRuns().map(run => ({...run, presence: presenceOf(4)}));
  const rejected = [1, 2, 3].map(attempt => syntheticRun({run: attempt, drawn: false, presence: presenceOf(attempt === 1 ? 0 : 2400)}));
  const receipt = receiptOf({accepted: [], rejected, presented: false});
  verifyGraphicsReceipt(receipt);
  assert.deepEqual(receipt.attempts.map(attempt => attempt.undrawableFrames), [0, 2400, 2400]);
  assert.match(receipt.status, /^not presented: undrawn: .*window_can_draw\(\) was false in 2400 of 5000 sampled frames/);
  assert.equal(receipt.rejectedAttempts[1].raw.presence.spans[0][1], 2400, "and the spans of the rejected attempt are kept");
  verifyGraphicsReceipt(receiptOf({accepted, presented: true}));
  const unsaid = structuredClone(receipt);
  unsaid.attempts[1].reason = "undrawn: the window did not draw throughout";
  assert.throws(() => verifyGraphicsReceipt(unsaid), /Attempt 101 was refused for not drawing and its reason says what the engine said/);
  const impossible = structuredClone(receipt);
  impossible.attempts[0].undrawableFrames = 5001;
  assert.throws(() => verifyGraphicsReceipt(impossible), /Attempt 100: the frames the engine could not draw are a count of the sampled ones/);
  const malformed = structuredClone(receipt);
  malformed.rejectedAttempts[2].raw.presence.spans[0][1] = 1;
  assert.throws(() => verifyGraphicsReceipt(malformed), /add up to the frames the engine could not draw/);
});

test("a receipt recorded before the presence has no count and verifies as it always did", () => {
  const receipt = receiptOf({accepted: presentedRuns(), presented: true});
  for (const attempt of receipt.attempts) {
    delete attempt.undrawableFrames;
    delete attempt.sampledFrames;
  }
  verifyGraphicsReceipt(receipt);
  const refused = receiptOf({accepted: [], rejected: [1, 2, 3].map(attempt => syntheticRun({run: attempt, drawn: false})), presented: false});
  for (const attempt of refused.attempts) {
    delete attempt.undrawableFrames;
    delete attempt.sampledFrames;
  }
  verifyGraphicsReceipt(refused);
  assert.match(refused.status, /^not presented: undrawn: the window did not draw throughout \(slot 1/, "with the plain reason, which says nothing of the window");
});
