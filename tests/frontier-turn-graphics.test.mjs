import assert from "node:assert/strict";
import test from "node:test";
import {UNPACED, graphicsRunValidity, summarizeGraphicsRuns, verifyGraphicsReceipt} from "./frontier-baseline-oracle.mjs";
import {CLICK_FRAME_LIMIT, GRAPHICS_RUNS, IDLE_FRAMES, PHASES, STEADY_ROUNDS, STEPS, CONTEXT_PANELS, TURN_FRAME_LIMIT, WARMUP_ROUNDS} from "./frontier-turn-cases.mjs";
import {graphicsRunOf, summarizeTurnFrames, verifyTurnGraphicsRun, verifyTurnRecord} from "./frontier-turn-oracle.mjs";

// The windowed lane of the turn on synthetic runs (no Godot, no display): the validity rule is the baseline's, imported, and what this file shows is that the
// turn's runs fit it. A frame time exists only if a display presents the window: a run whose window did not draw, or whose idle frame median is under half of
// the refresh period that the window read back (the display off or locked: it draws, the vsync mode still reads enabled, and nothing paces the loop), is not a
// measurement, and no receipt may report it as one. The turn's own frames (one phase each) are judged for structure and summarized per phase.
const PRESENTED_IDLE_USEC = 7800;
const UNPACED_IDLE_USEC = 530;
const NATIVE = {none: 14, tile: 18, settler: 27, warrior: 24, stack: 26, city: 42, dialog: 24};

// The end of a turn as the probe records it: seven frames that advance a phase each and publish a snapshot each, and one more in which the HUD catches up.
const turnOf = (job, frameUsec) => ({job, snapshots: PHASES.length, turnEnded: 1, finishedJob: 1,
  ended: {job, phases: PHASES.slice(0, 6).map(name => ({name, tasks: 1, events: 1}))},
  frames: [...PHASES.map((phase, index) => ({phase, job: index < 6 ? job : 0, usec: frameUsec + index * 100, nodes: 56, snapshots: 1, turnEnded: index === 6 ? 1 : 0, spinner: index > 0, stamp: 1})),
    {phase: "idle", job: 0, usec: frameUsec, nodes: 24, snapshots: 0, turnEnded: 0, spinner: false, stamp: 2}],
  host: {commits: 8, creates: 4, deletes: 32, updates: 20, pumpMs: 24, jsMs: 21, mountMs: 2, layoutMs: 1, pumpCount: 10, jsCount: 8, mountCount: 3, layoutCount: 3},
  pumpWindowMs: Array(10).fill(2)});

// A run of the windowed probe, as tests/frontier-turn-probe.gd --lane=windowed writes it.
function syntheticReport({run = 1, idleUsec = PRESENTED_IDLE_USEC, drawn = true, refreshRate = 120, frameUsec = 7000} = {}) {
  let job = 0;
  const rounds = Array.from({length: WARMUP_ROUNDS + STEADY_ROUNDS}, (_, round) => ({round, steps: STEPS.map((step, index) => ({
    round, step: index, id: step.id, kind: step.kind, from: step.from, to: step.to, intent: step.intent, frames: step.kind === "turn" ? 8 : 2, flushUsec: 800,
    latencyUsec: step.kind === "turn" ? 52000 : 9000, drawUsec: drawn ? 11000 : null, frameUsec: [8000, 8000], callbacks: {[step.intent]: 1},
    worldEvents: step.kind === "map" ? 2 : 0, worldClicks: step.kind === "map" ? 2 : 0, shown: CONTEXT_PANELS[step.to], contextAtArrival: step.to,
    rest: {context: step.to, panels: CONTEXT_PANELS[step.to], surface: {nativeTags: NATIVE[step.to]}}, turn: step.kind === "turn" ? turnOf(++job, frameUsec) : null}))}));
  return {scenario: "frontier-turn-graphics", lane: "windowed", run, godot: "4.7.2-stable (official)", checks: [{name: "click/Every click showed", passed: true}],
    stages: {config: {steps: STEPS, warmupRounds: WARMUP_ROUNDS, rounds: STEADY_ROUNDS, idleFrames: IDLE_FRAMES, clickFrameLimit: CLICK_FRAME_LIMIT, turnFrameLimit: TURN_FRAME_LIMIT},
      provenance: {godot: "4.7.2-stable (official)", hermes: "250829098.0.17", architecture: "arm64", os: "macOS", displayServer: "macOS", renderingDriver: "metal",
        renderingMethod: "gl_compatibility", processor: "Apple M3 Pro", vsyncMode: 1, vsyncModeName: "enabled", refreshRate},
      scene: {mounted: true}, aborted: null, rounds, idle: {frames: IDLE_FRAMES, intervalsUsec: Array(IDLE_FRAMES).fill(idleUsec), draws: drawn ? IDLE_FRAMES + 1 : 0},
      frames: {processed: 5000, drawn: drawn ? 4996 : 0}}};
}

const rawOf = report => ({run: report.run, attempt: report.run, idleIntervalsUsec: report.stages.idle.intervalsUsec});

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
  const failedCheck = syntheticReport();
  failedCheck.checks[0].passed = false;
  assert.throws(() => verifyTurnGraphicsRun(failedCheck), /Every check of the run passed/);
});

test("the turn's frames: a phase in each frame, a snapshot in each, the end once, and the HUD catching up after", () => {
  const record = syntheticReport().stages.rounds[3].steps[11];
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

test("a lane that claims to be presented has all its runs and their statistics", () => {
  const receipt = receiptOf({accepted: presentedReports().slice(0, 4), presented: false});
  receipt.presented = true;
  receipt.status = "presented";
  receipt.summary = null;
  assert.throws(() => verifyGraphicsReceipt(receipt), /all its runs/);
});
