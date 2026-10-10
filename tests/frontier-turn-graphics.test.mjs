import assert from "node:assert/strict";
import test from "node:test";
import {UNPACED, graphicsRunValidity, summarizeGraphicsRuns, verifyGraphicsReceipt} from "./frontier-baseline-oracle.mjs";
import {CLICK_FRAME_LIMIT, EVENT_QUEUE, GRAPHICS_RUNS, IDLE_FRAMES, PHASES, STEADY_ROUNDS, STEPS, CONTEXT_PANELS, TURN_FRAME_LIMIT, WARMUP_ROUNDS} from "./frontier-turn-cases.mjs";
import {graphicsReceiptSource, graphicsRunOf, summarizeTurnFrames, verifyTourOfTheQueue, verifyTurnGraphicsRun, verifyTurnRecord} from "./frontier-turn-oracle.mjs";

// The windowed lane of the turn on synthetic runs (no Godot, no display): the validity rule is the baseline's, imported, and what this file shows is that the
// turn's runs fit it. A frame time exists only if a display presents the window: a run whose window did not draw, or whose idle frame median is under half of
// the refresh period that the window read back (the display off or locked: it draws, the vsync mode still reads enabled, and nothing paces the loop), is not a
// measurement, and no receipt may report it as one. The turn's own frames (one phase each) are judged for structure and summarized per phase.
const PRESENTED_IDLE_USEC = 7800;
const UNPACED_IDLE_USEC = 530;
const NATIVE = {none: 14, tile: 18, settler: 27, warrior: 24, stack: 26, city: 42, dialog: 24};
// The dialog as the HUD shows it when a step arrives: the event at the head of the queue the step leads to, with its position, or nothing.
const dialogOf = step => {
  const head = EVENT_QUEUE.findIndex(event => event.choices[0] === step.head);
  return step.to === "dialog" ? {choices: EVENT_QUEUE[head].choices.map(choice => `hud-dialog-choice-${choice}`).sort(), position: `${head + 1} of ${EVENT_QUEUE.length}`} : {choices: [], position: ""};
};

// The end of a turn as the probe records it: seven frames that advance a phase each and publish a snapshot each, and one more in which the HUD catches up.
const turnOf = (job, frameUsec) => ({job, snapshots: PHASES.length, turnEnded: 1, finishedJob: 1,
  ended: {job, phases: PHASES.slice(0, 6).map(name => ({name, tasks: 1, events: 1}))},
  frames: [...PHASES.map((phase, index) => ({phase, job: index < 6 ? job : 0, usec: frameUsec + index * 100, nodes: 56, snapshots: 1, turnEnded: index === 6 ? 1 : 0, spinner: index > 0, surfaceReads: 0, stamp: 1})),
    {phase: "idle", job: 0, usec: frameUsec, nodes: 24, snapshots: 0, turnEnded: 0, spinner: false, surfaceReads: 0, stamp: 2}],
  host: {commits: 8, creates: 4, deletes: 32, updates: 20, pumpMs: 24, jsMs: 21, mountMs: 2, layoutMs: 1, pumpCount: 10, jsCount: 8, mountCount: 3, layoutCount: 3},
  pumpWindowMs: Array(10).fill(2)});

// A run of the windowed probe, as tests/frontier-turn-probe.gd --lane=windowed writes it.
// The record of the window's presence as tests/window-presence.gd writes it: `undrawable` frames of 5000 in which the engine could not draw, in one span.
const presenceOf = undrawable => ({windowed: true, opened: {windowed: true, alwaysOnTop: true, focused: true, mode: 0, canDraw: true, waitedFrames: 12, waitedUsec: 101_000,
  stableFrames: 12, waitLimitUsec: 3_000_000}, sampledFrames: 5000, undrawableFrames: undrawable, spanCount: undrawable > 0 ? 1 : 0,
spans: undrawable > 0 ? [[300, undrawable, 2_400_000, 2_400_000 + undrawable * 7000]] : [], canDrawAtEnd: undrawable === 0});

function syntheticReport({run = 1, idleUsec = PRESENTED_IDLE_USEC, drawn = true, refreshRate = 120, frameUsec = 7000, presence} = {}) {
  let job = 0;
  const rounds = Array.from({length: WARMUP_ROUNDS + STEADY_ROUNDS}, (_, round) => ({round, steps: STEPS.map((step, index) => ({
    round, step: index, id: step.id, kind: step.kind, from: step.from, to: step.to, intent: step.intent, frames: step.kind === "turn" ? 8 : 2, flushUsec: 800,
    latencyUsec: step.kind === "turn" ? 52000 : 9000, drawUsec: drawn ? 11000 : null, frameUsec: [8000, 8000], frameReads: [0, 0], fullAgrees: true, callbacks: {[step.intent]: 1},
    worldEvents: step.kind === "map" ? 2 : 0, worldClicks: step.kind === "map" ? 2 : 0, shown: CONTEXT_PANELS[step.to], dialog: dialogOf(step), contextAtArrival: step.to,
    rest: {context: step.to, panels: CONTEXT_PANELS[step.to], surface: {nativeTags: NATIVE[step.to]}}, turn: step.kind === "turn" ? turnOf(++job, frameUsec) : null}))}));
  return {scenario: "frontier-turn-graphics", lane: "windowed", run, godot: "4.7.2-stable (official)", checks: [{name: "click/Every click showed", passed: true}],
    stages: {config: {steps: STEPS, warmupRounds: WARMUP_ROUNDS, rounds: STEADY_ROUNDS, idleFrames: IDLE_FRAMES, clickFrameLimit: CLICK_FRAME_LIMIT, turnFrameLimit: TURN_FRAME_LIMIT},
      provenance: {godot: "4.7.2-stable (official)", hermes: "250829098.0.17", architecture: "arm64", os: "macOS", displayServer: "macOS", renderingDriver: "metal",
        renderingMethod: "gl_compatibility", processor: "Apple M3 Pro", vsyncMode: 1, vsyncModeName: "enabled", refreshRate},
      scene: {mounted: true}, aborted: null, rounds, idle: {frames: IDLE_FRAMES, intervalsUsec: Array(IDLE_FRAMES).fill(idleUsec), draws: drawn ? IDLE_FRAMES + 1 : 0},
      frames: {processed: 5000, drawn: drawn ? 4996 : 0}, ...(presence === undefined ? {} : {presence})}};
}

const rawOf = report => ({run: report.run, attempt: report.run, presence: report.stages.presence ?? null, idleIntervalsUsec: report.stages.idle.intervalsUsec});

// A receipt as scripts/frontier-turn-graphics.mjs writes it, from the runs it accepted and the attempts it rejected.
function receiptOf({accepted, rejected = [], presented}) {
  const attempts = [...accepted.map(report => ({slot: report.run, attempt: report.run, valid: true, reason: null})),
    ...rejected.map((_, index) => ({slot: 1, attempt: 100 + index, valid: false, reason: UNPACED}))];
  return {presented, status: presented ? "presented" : `not presented: ${UNPACED} (slot 1, 3 attempts)`, provenance: {refreshRate: 120}, attempts, raw: accepted.map(rawOf),
    summary: presented ? summarizeGraphicsRuns(accepted.map(report => graphicsRunOf(report, {withTurns: false}))) : null,
    rejectedAttempts: rejected.map((report, index) => ({slot: 1, attempt: 100 + index, valid: false, reason: UNPACED, raw: rawOf(report)}))};
}

const presentedReports = () => Array.from({length: GRAPHICS_RUNS}, (_, index) => syntheticReport({run: index + 1}));
const validity = report => graphicsRunValidity(graphicsRunOf(report));

test("a synthetic run of the windowed probe is accepted, and the run in the baseline's shape has the clicks of the tour", () => {
  const report = syntheticReport();
  verifyTurnGraphicsRun(report);
  const run = graphicsRunOf(report);
  assert.equal(run.swaps.length, (WARMUP_ROUNDS + STEADY_ROUNDS) * STEPS.length);
  assert.equal(graphicsRunOf(report, {withTurns: false}).swaps.length, (WARMUP_ROUNDS + STEADY_ROUNDS) * STEPS.filter(step => step.kind !== "turn").length,
    "the End turn clicks stay out of the statistics of a click to its panels");
  assert.deepEqual(run.config.nativeNodes, NATIVE, "the native views of each context stand where the baseline has the nodes a swap creates");
});

test("a run that is not a run of the tour in a window is refused", () => {
  const headless = syntheticReport();
  headless.stages.provenance.displayServer = "headless";
  assert.throws(() => verifyTurnGraphicsRun(headless), /drew in a window/);
  const aborted = syntheticReport();
  aborted.stages.aborted = {round: 3, step: 1, id: STEPS[1].id};
  assert.throws(() => verifyTurnGraphicsRun(aborted), /No click was cut short/);
  const slow = syntheticReport();
  slow.stages.rounds[4].steps[2].frames = CLICK_FRAME_LIMIT + 1;
  assert.throws(() => verifyTurnGraphicsRun(slow), /showed within the ceiling/);
  const wrongContext = syntheticReport();
  wrongContext.stages.rounds[4].steps[2].rest.panels = CONTEXT_PANELS.stack;
  assert.throws(() => verifyTurnGraphicsRun(wrongContext), /with the panels of the context/);
  const skipped = syntheticReport();
  skipped.stages.rounds[4].steps[12].turn.frames.splice(3, 1);
  assert.throws(() => verifyTurnGraphicsRun(skipped), /one phase in each frame/);
  const wrongEvent = syntheticReport();
  wrongEvent.stages.rounds[4].steps[STEPS.findIndex(step => step.id === "answer-event-2")].dialog.position = "1 of 3";
  assert.throws(() => verifyTurnGraphicsRun(wrongEvent), /the dialog showed the event 3 of the queue/);
  const failedCheck = syntheticReport();
  failedCheck.checks[0].passed = false;
  assert.throws(() => verifyTurnGraphicsRun(failedCheck), /Every check of the run passed/);
});

// What a timed frame measures is the game's and the HUD's, and nothing that the probe adds by looking: a read of the Surface's snapshot (the whole application's status, among it the
// loader's log of every image) inside an interval between two timed frames, or a count that is missing, is not a run of this lane.
test("a run in which the probe read the Surface's snapshot inside a timed frame is refused", () => {
  const inAClick = syntheticReport();
  inAClick.stages.rounds[4].steps[2].frameReads = [0, 1];
  assert.throws(() => verifyTurnGraphicsRun(inAClick), /no timed frame contains one/);
  const inATurn = syntheticReport();
  inATurn.stages.rounds[4].steps[12].turn.frames[2].surfaceReads = 1;
  assert.throws(() => verifyTurnGraphicsRun(inATurn), /nor does any frame of the turn/);
  const uncounted = syntheticReport();
  delete uncounted.stages.rounds[4].steps[2].frameReads;
  assert.throws(() => verifyTurnGraphicsRun(uncounted), /counted in every timed frame/);
  const shortCount = syntheticReport();
  shortCount.stages.rounds[4].steps[2].frameReads = [0];
  assert.throws(() => verifyTurnGraphicsRun(shortCount), /counted in every timed frame/);
  const another = syntheticReport();
  another.stages.rounds[4].steps[8].fullAgrees = false;
  assert.throws(() => verifyTurnGraphicsRun(another), /say the same when the click arrives/);
});

test("the turn's frames: a phase in each frame, a snapshot in each, the end once, and the HUD catching up after", () => {
  const record = syntheticReport().stages.rounds[3].steps[STEPS.findIndex(step => step.id === "end-turn-1")];
  assert.equal(verifyTurnRecord(record, "synthetic").busy.length, PHASES.length);
  const twice = structuredClone(record);
  twice.turn.frames[6].turnEnded = 2;
  assert.throws(() => verifyTurnRecord(twice, "synthetic"), /the end of the turn once/);
  const merged = structuredClone(record);
  merged.turn.frames[1].phase = "production";
  assert.throws(() => verifyTurnRecord(merged, "synthetic"), /one phase in each frame/);
  const restless = structuredClone(record);
  restless.turn.frames[7].snapshots = 1;
  assert.throws(() => verifyTurnRecord(restless, "synthetic"), /nothing moved while the HUD caught up/);
});

test("a window that draws and idles at the refresh period is a measurement", () => {
  const verdict = validity(syntheticReport());
  assert.equal(verdict.valid, true);
  assert.equal(verdict.reason, null);
  assert.ok(verdict.paced && verdict.drew);
  assert.equal(verdict.minimumIdleMedianMs, 4.167, "the threshold is half of the 120 Hz period");
});

test("a window that draws but that no display paces is rejected as unpaced", () => {
  const verdict = validity(syntheticReport({idleUsec: UNPACED_IDLE_USEC}));
  assert.equal(verdict.drew, true, "it drew: a rule on the drawing alone accepted it");
  assert.equal(verdict.paced, false);
  assert.equal(verdict.valid, false);
  assert.equal(verdict.reason, UNPACED);
  assert.equal(verdict.idleMedianMs, 0.53);
});

test("the threshold is half of the refresh period that the window read back", () => {
  assert.equal(validity(syntheticReport({idleUsec: 4200})).valid, true, "4.2 ms at 120 Hz");
  assert.equal(validity(syntheticReport({idleUsec: 4100})).reason, UNPACED, "4.1 ms at 120 Hz");
  assert.equal(validity(syntheticReport({idleUsec: 9000, refreshRate: 60})).valid, true, "9 ms at 60 Hz");
  assert.equal(validity(syntheticReport({idleUsec: 8000, refreshRate: 60})).reason, UNPACED, "8 ms at 60 Hz");
  assert.equal(validity(syntheticReport({refreshRate: -1})).valid, false, "a refresh rate that was not read back judges nothing");
});

test("a window that does not draw is rejected as undrawn, whatever its pace", () => {
  const verdict = validity(syntheticReport({drawn: false}));
  assert.equal(verdict.valid, false);
  assert.match(verdict.reason, /^undrawn: /);
});

test("the statistics across runs refuse an unpaced run, and a presented one is summarized", () => {
  const reports = presentedReports();
  const summary = summarizeGraphicsRuns(reports.map(report => graphicsRunOf(report, {withTurns: false})));
  assert.equal(summary.runs.length, GRAPHICS_RUNS);
  assert.equal(summary.across.swapFrameMs.p50.median, 8, "the first frame of a click, in milliseconds");
  reports[2] = syntheticReport({run: 3, idleUsec: UNPACED_IDLE_USEC});
  assert.throws(() => summarizeGraphicsRuns(reports.map(report => graphicsRunOf(report, {withTurns: false}))), /run 3 is unpaced: the display is not presenting/);
});

test("the frames of the turn are summarized per phase, across runs by their median and range", () => {
  const reports = presentedReports().map((report, index) => syntheticReport({run: index + 1, frameUsec: 7000 + 1000 * index}));
  const {runs, across} = summarizeTurnFrames(reports);
  assert.equal(runs.length, GRAPHICS_RUNS);
  assert.equal(runs[0].turns, STEADY_ROUNDS * 4, "the steady turns of a run");
  assert.deepEqual(across.byPhase.map(row => row.phase), PHASES);
  assert.equal(across.byPhase[0].p50.median, 9, "the first phase's frame, 7 ms in the first run to 11 ms in the fifth: the third run's value is the median");
  assert.equal(across.byPhase[0].p50.iqr, 2, "and the range between the second and the fourth run");
  assert.equal(across.byPhase[6].p50.median, 9.6, "the phase that finishes the turn");
});

test("a receipt with an unpaced accepted run is refused", () => {
  const accepted = presentedReports();
  verifyGraphicsReceipt(receiptOf({accepted, presented: true}));
  const receipt = receiptOf({accepted, presented: true});
  receipt.raw[3] = rawOf(syntheticReport({run: 4, idleUsec: UNPACED_IDLE_USEC}));
  assert.throws(() => verifyGraphicsReceipt(receipt), /Run 4 is accepted but unpaced/);
});

test("a lane that was not presented reports no frame-time statistic, and keeps what it rejected", () => {
  const rejected = [1, 2, 3].map(attempt => syntheticReport({run: attempt, idleUsec: UNPACED_IDLE_USEC}));
  const receipt = receiptOf({accepted: [], rejected, presented: false});
  verifyGraphicsReceipt(receipt);
  assert.equal(receipt.summary, null);
  assert.equal(receipt.rejectedAttempts.length, 3);
  assert.throws(() => verifyGraphicsReceipt({...receipt, summary: {runs: []}}), /reports no frame-time statistic/);
  const unexplained = structuredClone(receipt);
  unexplained.rejectedAttempts[0].reason = "";
  assert.throws(() => verifyGraphicsReceipt(unexplained), /says why/);
  const dropped = structuredClone(receipt);
  dropped.rejectedAttempts.pop();
  assert.throws(() => verifyGraphicsReceipt(dropped), /accepted or rejected/);
});

test("the receipt takes its build, window and viewport from an accepted run, else from the last rejected attempt, else from the captures", () => {
  const captures = syntheticReport({run: 0, refreshRate: 30});
  captures.scenario = "frontier-turn-captures";
  const rejected = [60, 90, 144].map((refreshRate, index) => syntheticReport({run: index + 1, idleUsec: UNPACED_IDLE_USEC, refreshRate}));
  const attemptOf = (report, valid) => ({slot: report.run, attempt: report.run, valid, reason: valid ? null : UNPACED, ...(valid ? {} : {raw: report})});
  const refused = rejected.map(report => attemptOf(report, false));
  const accepted = presentedReports();

  assert.equal(graphicsReceiptSource({accepted, attempts: [...refused, ...accepted.map(report => attemptOf(report, true))], captures}), accepted[0],
    "a run that was accepted speaks for the lane, whatever was rejected before it");
  assert.equal(graphicsReceiptSource({accepted: [], attempts: refused, captures}), rejected[2], "with none accepted, the last attempt that was rejected speaks for it");
  assert.equal(graphicsReceiptSource({accepted: [], attempts: refused, captures}).stages.provenance.refreshRate, 144, "and so does its window, read back");
  assert.equal(graphicsReceiptSource({accepted: [], attempts: [], captures}), captures, "the captures speak only when no windowed run was made");
  assert.notEqual(graphicsReceiptSource({accepted: [], attempts: refused, captures}).scenario, captures.scenario, "never the captures when a windowed run exists");

  const source = graphicsReceiptSource({accepted: [], attempts: refused, captures});
  const receipt = {...receiptOf({accepted: [], rejected, presented: false}), provenance: source.stages.provenance};
  verifyGraphicsReceipt(receipt);
  assert.equal(receipt.provenance.refreshRate, 144, "a receipt that was not presented carries the display that rejected the attempts, and verifies");
});

test("a lane that claims to be presented has all its runs and their statistics", () => {
  const receipt = receiptOf({accepted: presentedReports().slice(0, 4), presented: false});
  receipt.presented = true;
  receipt.status = "presented";
  receipt.summary = null;
  assert.throws(() => verifyGraphicsReceipt(receipt), /all its runs/);
});

// The rules of the tour itself, on mutated copies of the cases' steps and not through a report (a report whose steps differ from the cases fails the oracle's config rule before these
// rules run on it): the tour the oracle accepts is the cases', and each copy breaks one rule and is refused with the message of that rule.
const tourWith = change => {
  const steps = structuredClone(STEPS);
  change(steps, id => steps.find(step => step.id === id));
  return steps;
};

test("the tour of the queue and the Modals: the cases' steps are accepted, and each rule has a mutation that only it refuses", () => {
  verifyTourOfTheQueue(STEPS);
  // Nothing is clicked on the map or on the bar while a Modal is open.
  assert.throws(() => verifyTourOfTheQueue(tourWith((_, step) => { step("map-city").from = "city"; })), /no click of the map or of the bar while a Modal is open \(city\)/);
  assert.throws(() => verifyTourOfTheQueue(tourWith((_, step) => { step("end-turn-1").from = "dialog"; })), /no click of the map or of the bar while a Modal is open \(dialog\)/);
  // Each time the city screen opens the next click is its Close.
  assert.throws(() => verifyTourOfTheQueue(tourWith((_, step) => { step("close-city").target = "hud-bar-end-turn"; })), /the city screen opens and the next click is its Close/);
  assert.throws(() => verifyTourOfTheQueue(tourWith(steps => steps.splice(steps.findIndex(step => step.id === "close-city-again"), 1))), /the city screen opens and the next click is its Close/);
  // The answers are the three events in the order of the queue, each with its first choice, and each leads to the head that follows.
  assert.throws(() => verifyTourOfTheQueue(tourWith((_, step) => {
    [step("answer-event-1").target, step("answer-event-2").target] = [step("answer-event-2").target, step("answer-event-1").target];
  })), /answers the three events in the order of the queue/);
  assert.throws(() => verifyTourOfTheQueue(tourWith((_, step) => { step("answer-event-1").head = "host"; })), /names the first choice of the head it leads to/);
  assert.throws(() => verifyTourOfTheQueue(tourWith((_, step) => { step("answer-event-3").to = "dialog"; })), /the last answer closes the dialog/);
});

// ----------------------------------------------------------------------------------------------------- the window's presence (tests/window-presence.gd)
test("a run of the turn's probe carries the window's presence, and a refusal for not drawing says what the engine said", () => {
  const withPresence = syntheticReport({presence: presenceOf(112)});
  verifyTurnGraphicsRun(withPresence);
  assert.equal(graphicsRunOf(withPresence).presence.undrawableFrames, 112, "the run in the baseline's shape carries it");
  assert.equal(graphicsRunOf(syntheticReport()).presence, undefined, "a run recorded before it has none");
  verifyTurnGraphicsRun(syntheticReport());
  const covered = validity(syntheticReport({drawn: false, presence: presenceOf(2400)}));
  assert.equal(covered.valid, false);
  assert.match(covered.reason, /^undrawn: .*\(window_can_draw\(\) was false in 2400 of 5000 sampled frames, in 1 span: .*read from the spans\)$/);
  assert.equal(covered.undrawableFrames, 2400);
  assert.equal(covered.sampledFrames, 5000);
  const capable = validity(syntheticReport({drawn: false, presence: presenceOf(0)}));
  assert.equal(capable.valid, false, "a window the engine could draw that was not drawn is refused all the same");
  assert.match(capable.reason, /^undrawn: .*\(window_can_draw\(\) was never false in the 5000 sampled frames: the engine believed it could draw, and the cause is open\)$/);
  assert.equal(validity(syntheticReport({drawn: false})).reason, "undrawn: the window did not draw throughout", "and a run without the presence has the plain reason");
  assert.equal(validity(syntheticReport({presence: presenceOf(30)})).valid, true, "the rule does not read the presence: a run that drew is valid");
  const malformed = syntheticReport({presence: presenceOf(112)});
  malformed.stages.presence.undrawableFrames = 6000;
  assert.throws(() => verifyTurnGraphicsRun(malformed), /a count of the sampled ones/);
});

test("a receipt of the turn keeps the count of each attempt and the presence of the runs", () => {
  const rejected = [1, 2, 3].map(attempt => syntheticReport({run: attempt, drawn: false, presence: presenceOf(2400)}));
  const attempts = rejected.map((report, index) => ({slot: 1, attempt: 100 + index, ...validity(report)}));
  const receipt = {presented: false, status: `not presented: ${attempts.at(-1).reason} (slot 1, 3 attempts)`, provenance: {refreshRate: 120}, attempts, raw: [], summary: null,
    rejectedAttempts: attempts.map((attempt, index) => ({...attempt, raw: rawOf(rejected[index])}))};
  verifyGraphicsReceipt(receipt);
  assert.deepEqual(receipt.attempts.map(attempt => attempt.undrawableFrames), [2400, 2400, 2400]);
  assert.equal(receipt.rejectedAttempts[0].raw.presence.spans[0][1], 2400);
  const unsaid = structuredClone(receipt);
  unsaid.attempts[0].reason = "undrawn: the window did not draw throughout";
  assert.throws(() => verifyGraphicsReceipt(unsaid), /was refused for not drawing and its reason says what the engine said/);
  const before = structuredClone(receipt);
  for (const attempt of before.attempts) {
    delete attempt.undrawableFrames;
    delete attempt.sampledFrames;
    attempt.reason = "undrawn: the window did not draw throughout";
  }
  verifyGraphicsReceipt(before);
});

test("a receipt of the turn binds the count of each attempt to the presence of its raw run", () => {
  const rejected = [1, 2, 3].map(attempt => syntheticReport({run: attempt, drawn: false, presence: presenceOf(2400)}));
  const attempts = rejected.map((report, index) => ({slot: 1, attempt: 100 + index, ...validity(report)}));
  const receipt = {presented: false, status: `not presented: ${attempts.at(-1).reason} (slot 1, 3 attempts)`, provenance: {refreshRate: 120}, attempts, raw: [], summary: null,
    rejectedAttempts: attempts.map((attempt, index) => ({...attempt, raw: rawOf(rejected[index])}))};
  verifyGraphicsReceipt(receipt);
  const zero = structuredClone(receipt);
  zero.attempts[0].undrawableFrames = 0;
  assert.equal(zero.rejectedAttempts[0].raw.presence.undrawableFrames, 2400);
  assert.throws(() => verifyGraphicsReceipt(zero), /Attempt 100 says 0 frames the engine could not draw and its raw run says 2400/);
  const sampled = structuredClone(receipt);
  sampled.attempts[2].sampledFrames = 4000;
  assert.throws(() => verifyGraphicsReceipt(sampled), /Attempt 102 says 4000 sampled frames and its raw run says 5000/);
  // A receipt whose attempts carry no count (the turn's earlier one) is not asked for one.
  const before = structuredClone(receipt);
  for (const attempt of before.attempts) {
    delete attempt.undrawableFrames;
    delete attempt.sampledFrames;
    attempt.reason = "undrawn: the window did not draw throughout";
  }
  verifyGraphicsReceipt(before);
});
