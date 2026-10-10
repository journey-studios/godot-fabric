import { windowRulesOf } from "../scripts/frontier-comparison-run-windows.mjs";

// Synthetic traces and scenario reports for the tests of the runner of the comparative execution (V05-10, `execucao`): made up to exercise the window rule and the assembly of the campaign. None
// of their numbers says anything about an arm. A trace is what tests/frontier-comparison-scenario.gd records (scripts/frontier-comparison-run-windows.mjs).

const FRAMES_PER_TURN = 40;
// The idle window is the first frames of the run; the trace begins after it.
const TRACE_START = 1000;

// The trace of a soak of `turns` turns, `switches` context switches and `rounds` stress rounds. Each turn is accepted at a frame, delivers `turn_ended` five frames later (the job has
// six phases) and its events settle `settleDelays[turn % length]` frames after the minimum of the burst; a turn in `unsettled` never settles. A stress round has `stressSteps` steps.
export function syntheticTrace({ turns = 100, switches = 74, rounds = 32, settleDelays = [0], unsettled = [], stressSteps = 20, burst = true, stress = true } = {}) {
  const trace = [];
  let frame = TRACE_START;
  for (let turn = 0; turn < turns; turn += 1) {
    trace.push({ frame, kind: "end-turn-accepted" });
    trace.push({ frame: frame + 5, kind: "turn-ended" });
    if (burst && !unsettled.includes(turn)) {
      trace.push({ frame: frame + 10 + settleDelays[turn % settleDelays.length], kind: "events-settled" });
    }
    frame += FRAMES_PER_TURN;
  }
  for (let index = 0; index < switches; index += 1) {
    trace.push({ frame, kind: "context-switch" });
    frame += 12;
  }
  for (let round = 0; stress && round < rounds; round += 1) {
    trace.push({ frame, kind: "stress-begin" });
    for (let step = 1; step <= stressSteps; step += 1) {
      trace.push({ frame: frame + step, kind: "stress-step" });
    }
    frame += stressSteps + 20;
  }
  return { trace, lastFrame: frame + 20 };
}

export const totalMsOf = (frame) => 0.05 + ((frame * 37) % 11) / 100 + 0.0004;

// A scenario report (godot-fabric.frontier-comparison-scenario/v1) of an arm, consistent in itself: the raw columns of every frame, the trace, the idle range and the windows recorded as
// unavailable (`unavailable`: window id to reason). A real report has more fields (provenance, costs, the stages); these are the ones the runner reads.
export function syntheticReport(protocol, { arm = "A", lane = "presented", mode = "ENABLED", refreshHz = 120, unavailable = {}, trace: options = {} } = {}) {
  const rules = windowRulesOf(protocol);
  const { trace, lastFrame } = syntheticTrace({ ...options, burst: unavailable["event-burst"] === undefined, stress: unavailable.stress === undefined });
  const frames = { frame: [], startUsec: [], totalMs: [], intervalMs: [], drawn: [], renderKnown: [] };
  for (let frame = 1; frame <= lastFrame; frame += 1) {
    frames.frame.push(frame);
    frames.startUsec.push(frame * 8333);
    frames.totalMs.push(totalMsOf(frame));
    frames.intervalMs.push(frame === 1 ? 0 : 8.333);
    frames.drawn.push(1);
    frames.renderKnown.push(1);
  }
  const withHud = arm !== "A";
  const readings = { rssMb: { end: 100, max: 120 }, sceneNodes: 30 };
  if (withHud) {
    Object.assign(readings, { clickToPanelFrames: [0, 1, 0], timeToInteractiveHudMs: 300 });
  }
  if (arm === "C") {
    readings.hermes = { heapBytes: 2_000_000, nativeViews: 17 };
  }
  return {
    format: "godot-fabric.frontier-comparison-scenario/v1",
    arm,
    lane,
    seed: 4242,
    vsync: { requested: lane === "unlimited" ? "DISABLED" : "default", mode, refreshHz },
    config: { idleFrames: protocol.idleReference.frames, waits: { ...rules } },
    boot: withHud ? { timeToInteractiveHudMs: 300 } : {},
    game: { replayGoldenHash: "a".repeat(64), soakFinalHash: "b".repeat(64) },
    idle: { first: 1, last: protocol.idleReference.frames },
    unavailable,
    parity: { matches: true },
    applicationErrors: 0,
    anomalies: [],
    latency: { frames: [0, 1, 0] },
    trace,
    readings,
    frames,
  };
}
