// The window rule of the comparative execution (V05-10, criterion `execucao`), and the only one: from the trace that the scenario recorded and the instrument's samples that it dumped, which frames
// belong to which occurrence of which window of docs/research/frontier-comparison-protocol.json (`windows`), and what the CPU time of each of them is, in integer microseconds. The scenario
// (tests/frontier-comparison-scenario.gd) derives nothing of this: it waits for the counters of the event burst, which is waiting logic, and writes the trace and the samples; this module
// derives the windows from the trace, joins them to the samples by frame number and converts, whatever the arm. It is a pure function of the report and the protocol.
//
// A trace is an array of {frame, kind} in the order the events happened, `frame` being the process frame number (Engine.get_process_frames()) in which the event was recorded:
//   end-turn-accepted  the frame whose script called End Turn and was answered with a job id
//   turn-ended         the frame in which GameServices emitted `turn_ended` (the signal handler records it, so it is the frame of the delivery and not the one that notices it)
//   events-settled     the first frame at whose START every notification of the turn had been consumed (the HUD's counter equals the emitter's); the last frame of the burst is the one before
//   context-switch     the frame that received an intent that changes the game's context
//   stress-begin       the frame that received stress_begin()
//   stress-step        a frame that received stress_step()

export const TRACE_KINDS = ["end-turn-accepted", "turn-ended", "events-settled", "context-switch", "stress-begin", "stress-step"];

function sentence(text, pattern, what) {
  const found = pattern.exec(text);
  if (found === null) {
    throw new Error(`the protocol no longer says ${what}: ${pattern}`);
  }
  return found;
}

// The numbers of the windows that the protocol states in words, with the sentences checked so that an amendment that rewrites one fails loudly:
//  - `event-burst` ends "at least 5 frames from the start";
//  - `context-switches` ends "the second frame after the starting frame, so each occurrence has 3 frames";
//  - `stress` ends "the second frame after the last of 20 consecutive per-frame updates".
export function windowRulesOf(protocol) {
  const window = (id) => protocol.windows.find((candidate) => candidate.id === id);
  const burst = sentence(window("event-burst").ends, /at least (\d+) frames from the start/, "the minimum length of the event burst");
  const switches = sentence(window("context-switches").ends, /the second frame after the starting frame, so each occurrence has (\d+) frames/, "the length of a context switch");
  const stress = sentence(window("stress").ends, /the second frame after the last of (\d+) consecutive per-frame updates/, "the tail and the updates of the stress window");
  return {
    burstMinimumFrames: parseInt(burst[1], 10),
    switchFrames: parseInt(switches[1], 10),
    stressSteps: parseInt(stress[1], 10),
    stressTail: 2,
  };
}

const framesOf = (trace, kind) => trace.filter((entry) => entry.kind === kind).map((entry) => entry.frame);

// `ai-phase`: from the frame that accepts End Turn to the last frame before the frame that delivers `turn_ended`.
function aiPhase(trace) {
  const ended = framesOf(trace, "turn-ended");
  return framesOf(trace, "end-turn-accepted").map((first) => {
    const delivered = ended.find((frame) => frame > first);
    return { first, last: delivered === undefined ? null : delivered - 1 };
  });
}

// `event-burst`: from the frame that delivers `turn_ended` to the first frame after which every event of the turn has been consumed, and at least `burstMinimumFrames` frames from the start.
// A frame at whose start the events are settled ends the burst in the frame before it. A turn whose events never settle before the next `turn_ended` has no end (`last: null`).
function eventBurst(trace, rules) {
  const ended = framesOf(trace, "turn-ended");
  const settled = framesOf(trace, "events-settled");
  return ended.map((first, index) => {
    const next = index + 1 < ended.length ? ended[index + 1] : Infinity;
    const at = settled.find((frame) => frame > first && frame <= next);
    return { first, last: at === undefined ? null : Math.max(first + rules.burstMinimumFrames - 1, at - 1) };
  });
}

// `context-switches`: the frame that receives the intent and the `switchFrames - 1` frames after it.
const contextSwitches = (trace, rules) => framesOf(trace, "context-switch").map((first) => ({ first, last: first + rules.switchFrames - 1 }));

// `stress`: from the frame of stress_begin() to the `stressTail`-th frame after the last of the stress_step() frames that follow it and precede the next stress_begin().
function stress(trace, rules) {
  const begins = framesOf(trace, "stress-begin");
  const steps = framesOf(trace, "stress-step");
  return begins.map((first, index) => {
    const next = index + 1 < begins.length ? begins[index + 1] : Infinity;
    const own = steps.filter((frame) => frame > first && frame < next);
    return { first, last: own.length === 0 ? null : own[own.length - 1] + rules.stressTail };
  });
}

// The frames of every occurrence of every window, keyed by the protocol's window ids: [{first, last}] in the order of the trace, `last` null when the occurrence did not end.
export function windowFramesOf(trace, rules) {
  return {
    "ai-phase": aiPhase(trace),
    "event-burst": eventBurst(trace, rules),
    "context-switches": contextSwitches(trace, rules),
    stress: stress(trace, rules),
  };
}

// The conversion of a CPU time to the integer microseconds of the campaign format: Math.round(totalMs * 1000).
export const usecOf = (milliseconds) => Math.round(milliseconds * 1000);

// ---- the join with the instrument's samples ----

// The samples of the run by process frame number, from the raw columns the scenario dumped. A frame is a sample (`has`) when the run has it and the render reading of its draw arrived; the last
// draws of a run do not have it, and no window ends there (the 12 drain frames of the instrument are for that).
function frameTable(columns) {
  const position = new Map(columns.frame.map((frame, index) => [frame, index]));
  return {
    known: (frame) => position.has(frame),
    has: (frame) => position.has(frame) && columns.renderKnown[position.get(frame)] === 1,
    totalUsec: (frame) => usecOf(columns.totalMs[position.get(frame)]),
    intervalUsec: (frame) => usecOf(columns.intervalMs[position.get(frame)]),
    startUsec: (frame) => columns.startUsec[position.get(frame)],
    drawn: (frame) => columns.drawn[position.get(frame)] === 1,
  };
}

// The occurrences of a window: the first `warmup` flagged and the rest measured (runs.warmup), each the CPU time of its frames. An occurrence that did not end, or whose frames the run lacks, is
// left out and said in `problems`, so that the window has fewer occurrences than the protocol asks for and the analysis rejects the execution as incomplete.
function occurrencesOf(table, ranges, warmup, where, problems) {
  const out = [];
  ranges.forEach((range, index) => {
    if (range.last === null) {
      problems.push(`${where}[${index}]: the occurrence that began at frame ${range.first} did not end`);
      return;
    }
    const frameUsec = [];
    for (let frame = range.first; frame <= range.last; frame += 1) {
      if (!table.has(frame)) {
        problems.push(`${where}[${index}]: frame ${frame} has no complete sample`);
        return;
      }
      frameUsec.push(table.totalUsec(frame));
    }
    out.push({ warmup: index < warmup, frameUsec });
  });
  return out;
}

// The idle window: the CPU time and the elapsed interval of each of its frames, and how many of them the display drew (`idleReference`).
function idleOf(table, idle, protocol, problems) {
  const frames = idle.last - idle.first + 1;
  if (frames !== protocol.idleReference.frames) {
    problems.push(`idle: ${frames} frames, the protocol says ${protocol.idleReference.frames}`);
  }
  const cpuUsec = [];
  const intervalsUsec = [];
  let drawnFrames = 0;
  for (let frame = idle.first; frame <= idle.last; frame += 1) {
    if (!table.has(frame)) {
      problems.push(`idle: frame ${frame} has no complete sample`);
      return { cpuUsec: [], intervalsUsec: [], drawnFrames: 0 };
    }
    cpuUsec.push(table.totalUsec(frame));
    intervalsUsec.push(table.intervalUsec(frame));
    drawnFrames += table.drawn(frame) ? 1 : 0;
  }
  return { cpuUsec, intervalsUsec, drawnFrames };
}

// Whether the display drew a frame in every measured occurrence of every window that was measured (the `not-presented` rule asks that a frame is drawn after every measured intent).
function drewAfterEveryIntent(table, windows, ranges, protocol) {
  let measured = 0;
  for (const window of protocol.windows.filter((candidate) => windows[candidate.id].available)) {
    for (const [index, range] of ranges[window.id].entries()) {
      if (index < window.warmupOccurrences || range.last === null) {
        continue;
      }
      measured += 1;
      let drawn = false;
      for (let frame = range.first; frame <= range.last && !drawn; frame += 1) {
        drawn = table.known(frame) && table.drawn(frame);
      }
      if (!drawn) {
        return false;
      }
    }
  }
  return measured > 0;
}

// Everything the orchestrator derives from a scenario's report: the frames of each occurrence (`ranges`), the windows with their occurrences in microseconds, the idle window, whether every
// measured intent was drawn, the table of the samples, and the `problems` that make the report not one to analyse: numbers the scenario waited with that are not the protocol's, an idle
// window of another length, an occurrence that did not end or lacks a frame. A window the scenario recorded as unavailable has no occurrence and says why.
export function derivedOf(report, protocol) {
  const rules = windowRulesOf(protocol);
  const problems = [];
  const waited = report.config.waits;
  if (waited.burstMinimumFrames !== rules.burstMinimumFrames || waited.switchFrames !== rules.switchFrames || waited.stressSteps !== rules.stressSteps || waited.stressTail !== rules.stressTail) {
    problems.push(`waits: the scenario waited with ${JSON.stringify(waited)}, the protocol says ${JSON.stringify(rules)}`);
  }
  if (report.config.idleFrames !== protocol.idleReference.frames) {
    problems.push(`idleFrames: ${report.config.idleFrames}, the protocol says ${protocol.idleReference.frames}`);
  }
  const table = frameTable(report.frames);
  const ranges = windowFramesOf(report.trace, rules);
  const windows = {};
  for (const window of protocol.windows) {
    const reason = report.unavailable[window.id] ?? "";
    windows[window.id] = { available: reason === "", reason, occurrences: reason === "" ? occurrencesOf(table, ranges[window.id], window.warmupOccurrences, window.id, problems) : [] };
  }
  const idle = idleOf(table, report.idle, protocol, problems);
  return { table, ranges, windows, idle, drew: { afterEveryMeasuredIntent: drewAfterEveryIntent(table, windows, ranges, protocol), idleDrawnFrames: idle.drawnFrames }, problems };
}
