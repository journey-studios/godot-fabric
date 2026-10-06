import assert from "node:assert/strict";
import {BOXES, DECAY, DISPLAY_RATE, FALLBACK_RATE} from "./frame-clock-cases.mjs";

// Independent oracle, written from the contract the frame clock states and from RN's
// decay driver, not from the probe or the C++: it takes the Godot frame times the host
// reports, once per frame, and recomputes from them whether each frame had to be a
// tick, what JS and RN's Native Animated received in it, and where RN's decay driver
// lands from the frames it was given.
//
// The contract: a frame nothing consumes is neither a tick nor a waited frame. Where the
// window is presented with V-Sync ("presentation" pacing) a frame that has a consumer is a
// tick, whatever the time since the frame before it. Where nothing paces the loop ("time"
// pacing), with T = 1000 / R ms, a frame at time t that has a consumer is a tick iff no
// tick served a consumer before, or t - (the previous Godot frame) >= T / 2, or
// t - (the previous tick) >= T. Frame callbacks and the Native Animated backend run in
// ticks, with the tick's timestamp, and in nothing else; timers run in every frame.

// The report keeps the decimals the probe printed for times relative to its origin, so a
// time read back may differ from the host's by a few units in the last printed digit.
// The comparisons of times that are one value (a tick and the timestamp JS received in
// it) take SAME_TICK; a bound is not asserted either way where a time is within
// EPSILON of it.
const EPSILON = 1e-6;
const SAME_TICK = 1e-4;
const f32 = Math.fround;
const periodOf = rate => 1000 / rate;
const PACINGS = ["paced-60", "headless", "fast", "bursts"];

// ----------------------------------------------------------------------- decay
// RN's DecayAnimationDriver: the first frame anchors the animation, and the driver
// completes at the first later frame whose step from the previous value is under 0.1,
// keeping that previous value. Values are float32.
const SPAN = DECAY.velocity / (1 - DECAY.deceleration);
const ASYMPTOTE = DECAY.from + SPAN;
const decayAt = milliseconds => DECAY.from + SPAN * (1 - Math.exp(-(1 - DECAY.deceleration) * milliseconds));
function decayModel() {
  let started = null;
  let last = DECAY.from;
  let value = DECAY.from;
  let complete = false;
  return timestamp => {
    if (complete) {
      return {value, complete};
    }
    const first = started === null;
    started ??= timestamp;
    const next = f32(decayAt(1000 * ((timestamp - started) / 1000)));
    if (!first && Math.abs(next - last) < 0.1) {
      complete = true;
      return {value, complete};
    }
    last = next;
    value = next;
    return {value, complete};
  };
}
// Where the decay ends for frames the given steps apart.
function landingOfUniformSteps(step) {
  const model = decayModel();
  for (let at = 0; at < 1e6; at += step) {
    const result = model(1e6 + at);
    if (result.complete) {
      return result.value;
    }
  }
  throw new Error("The decay never completed");
}
// The lowest value the driver can end at when no two frames are closer than `step`:
// it completes only where the step from the previous frame is under 0.1, and a step of
// at least `step` is that small only once a step of exactly `step` is, which is where
// the increment A e^(-c t) (1 - e^(-c step)) has fallen to 0.1.
const lowestLanding = step => ASYMPTOTE - 0.1 / (1 - Math.exp(-(1 - DECAY.deceleration) * step));

// -------------------------------------------------------------------- one run
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const shareUnder = (values, limit) => values.filter(value => value < limit).length / Math.max(values.length, 1);

function pumpsOf(run) {
  const all = [run.rest, ...run.samples];
  const byIndex = new Map();
  for (const entry of run.events) {
    byIndex.set(entry.at, [...(byIndex.get(entry.at) ?? []), entry]);
  }
  return run.samples.map((after, index) => ({index, before: all[index], after, events: byIndex.get(index) ?? []}));
}

// The clock's decision for every pump of a run, recomputed from the Godot frame times:
// a consumer's frame ticks exactly when the contract says it must, a frame nothing
// consumes does not, and the counters and timestamps agree with it.
function verifyDecisions(pumps, label, {rate, source, pacing, pacingSource}) {
  const period = periodOf(rate);
  const outcome = {ticks: 0, waited: 0, idle: 0, frames: pumps.length, ticked: []};
  for (const {index, before, after} of pumps) {
    const name = `${label} pump ${index}`;
    assert.ok(typeof before.clock.frames === "number" && typeof after.clock.frames === "number", `${label}: the application reports a frame clock`);
    assert.equal(after.n - before.n, 1, `${name}: the probe saw every Godot frame`);
    assert.equal(after.clock.frames - before.clock.frames, 1, `${name}: the clock saw every Godot frame`);
    assert.ok(Math.abs(after.clock.periodMs - period) < 1e-9 && after.clock.refreshRate === rate && after.clock.source === source,
      `${name}: the clock runs at ${rate} Hz from the ${source}`);
    assert.ok(after.clock.pacing === pacing && after.clock.pacingSource === pacingSource, `${name}: the clock paces by ${pacing}, from ${pacingSource}`);
    const tick = after.clock.ticks - before.clock.ticks;
    const waited = after.clock.skipped - before.clock.skipped;
    assert.ok((tick === 0 || tick === 1) && (waited === 0 || waited === 1) && tick + waited <= 1, `${name}: one decision per frame`);
    const time = after.clock.lastFrameMs;
    assert.ok(time > before.clock.lastFrameMs, `${name}: Godot frame times increase`);
    const consumer = tick + waited === 1;
    if (pacing === "presentation") {
      // Every frame is presented as one image: a consumer is served by the frame, never made to wait.
      assert.equal(waited, 0, `${name}: a presented frame with a consumer is a tick, none waits`);
    } else if (consumer) {
      const served = before.clock.ticks > 0;
      const gap = time - before.clock.lastFrameMs;
      const since = served ? time - before.clock.lastTickMs : Infinity;
      const ambiguous = Math.abs(gap - period / 2) <= EPSILON || (served && Math.abs(since - period) <= EPSILON);
      const must = !served || gap >= period / 2 || since >= period;
      if (!ambiguous) {
        assert.equal(tick === 1, must, `${name}: ${gap.toFixed(3)} ms after the previous frame and ${since.toFixed(3)} ms after the previous tick ${
          must ? "must" : "must not"} tick, the clock ${tick === 1 ? "ticked" : "waited"}`);
      }
    }
    if (tick === 1) {
      assert.ok(Math.abs(after.clock.lastTickMs - time) <= EPSILON, `${name}: a tick is the frame it happened in`);
      outcome.ticked.push(after.clock.lastTickMs);
    } else {
      assert.equal(after.clock.lastTickMs, before.clock.lastTickMs, `${name}: only a tick moves the last tick`);
    }
    outcome.ticks += tick;
    outcome.waited += waited;
    outcome.idle += consumer ? 0 : 1;
  }
  // Where time paces the loop, two ticks are never closer than half a period.
  if (pacing === "time") {
    assertApart(outcome.ticked, period, `${label}: ticks`);
  }
  return outcome;
}

// What JS received: the loop's callbacks ran in the pumps that ticked, one per tick, with
// the tick's timestamp, and the zero-delay interval fired once in every pump, tick or not.
function verifyJs(run, pumps, label, {rate, pacing}) {
  const loopFrom = run.marks.loop;
  const loopTo = run.marks["stop-loop"];
  const intervalTo = run.marks["stop-interval"];
  const received = [];
  for (const {index, before, after, events} of pumps) {
    const name = `${label} pump ${index}`;
    const ticked = after.clock.ticks - before.clock.ticks === 1;
    const calls = events.filter(entry => entry.kind === "frame");
    const inLoop = index >= loopFrom && index < loopTo;
    if (!ticked) {
      assert.equal(calls.length, 0, `${name}: no frame callback runs in a frame that did not tick`);
    }
    if (inLoop) {
      // A consumer is waiting in every frame of the loop window: each pump is a decision.
      assert.equal(after.clock.ticks - before.clock.ticks + after.clock.skipped - before.clock.skipped, 1, `${name}: the loop's callback is a consumer`);
      assert.equal(calls.length, ticked ? 1 : 0, `${name}: the loop's callback runs once per tick`);
      assert.ok(calls.every(entry => entry.label === "raf" && Math.abs(entry.timestamp - after.clock.lastTickMs) <= SAME_TICK),
        `${name}: the callback receives the tick's timestamp`);
      received.push(...calls.map(entry => entry.timestamp));
    } else if (index >= loopTo) {
      // The first pump after the cancel is the first without the loop.
      assert.equal(calls.length, 0, `${name}: a cancelled loop runs no more`);
    }
    if (index >= loopTo && !(after.animated.active || before.animated.active)) {
      assert.equal(after.clock.ticks - before.clock.ticks + after.clock.skipped - before.clock.skipped, 0,
        `${name}: with no loop and no animation nothing consumes frames`);
    }
    const timers = events.filter(entry => entry.kind === "timer");
    if (index >= loopFrom && index < intervalTo) {
      assert.equal(timers.length, 1, `${name}: the zero-delay interval fires once in every Godot frame`);
    } else {
      assert.equal(timers.length, 0, `${name}: the interval runs only while it exists`);
    }
  }
  assert.ok(received.length >= 5, `${label}: the loop's callbacks ran`);
  if (pacing === "time") {
    assertApart(received, periodOf(rate), `${label}: the timestamps JS received`);
  }
}

// A stall gives one late tick: over the loop window, the frame that follows a stall of three
// periods or more ticks, and the catch-up frame right behind it, closer than half a period,
// waits. Counted from the Godot frame times the host reports, not from the probe's clock.
function verifyStalls(window, label, rate) {
  const period = periodOf(rate);
  const found = {stalls: 0, lateTicks: 0, catchUps: 0, catchUpsWaited: 0};
  window.forEach((pump, at) => {
    const gap = pump.after.clock.lastFrameMs - pump.before.clock.lastFrameMs;
    if (at === 0 || gap < 3 * period) {
      return;
    }
    found.stalls += 1;
    found.lateTicks += pump.after.clock.ticks - pump.before.clock.ticks;
    const behind = window[at + 1];
    if (behind !== undefined && behind.after.clock.lastFrameMs - pump.after.clock.lastFrameMs < period / 2) {
      found.catchUps += 1;
      found.catchUpsWaited += behind.after.clock.ticks === pump.after.clock.ticks ? 1 : 0;
    }
  });
  assert.equal(found.lateTicks, found.stalls, `${label}: every stall ticked once, late`);
  assert.equal(found.catchUpsWaited, found.catchUps, `${label}: no catch-up frame behind a stall ticked`);
  return found;
}

// No two timestamps of a series are closer than half a period.
function assertApart(timestamps, period, label) {
  for (let at = 1; at < timestamps.length; at++) {
    assert.ok(timestamps[at] - timestamps[at - 1] >= period / 2 - EPSILON,
      `${label} ${timestamps[at - 1].toFixed(3)} and ${timestamps[at].toFixed(3)} are closer than half of ${period.toFixed(3)} ms`);
  }
}

// RN's Native Animated: the backend delivers a frame in a tick, at most one, with the
// tick's timestamp, and in every tick while it has an animation to run.
function verifyBackend(pumps, label, {rate, pacing}) {
  let delivered = 0;
  const received = [];
  for (const {index, before, after} of pumps) {
    const name = `${label} pump ${index}`;
    const frames = after.animated.frames - before.animated.frames;
    const tick = after.clock.ticks - before.clock.ticks;
    assert.ok(frames === 0 || frames === 1, `${name}: at most one backend frame per Godot frame`);
    assert.ok(frames <= tick, `${name}: the backend runs only in a tick`);
    if (before.animated.active && tick === 1) {
      assert.equal(frames, 1, `${name}: a tick serves a backend that has an animation to run`);
    }
    if (frames === 1) {
      delivered += 1;
      received.push(after.animated.lastFrameMs);
      assert.ok(Math.abs(after.animated.lastFrameMs - after.clock.lastTickMs) <= SAME_TICK, `${name}: the backend's frame has the tick's timestamp`);
    }
  }
  if (pacing === "time") {
    assertApart(received, periodOf(rate), `${label}: the timestamps the backend received`);
  }
  return delivered;
}

// The decay, replayed from the frames the backend was given, against the Control the
// host moved, and where it lands against what the ticks allow.
function verifyDecay(run, pumps, label, {rate, pacing}) {
  const period = periodOf(rate);
  const model = decayModel();
  const rest = run.restX;
  let value = DECAY.from;
  let complete = false;
  for (const {index, before, after} of pumps) {
    if (after.animated.frames > before.animated.frames) {
      const step = model(after.animated.lastFrameMs);
      value = step.value;
      complete = step.complete;
    }
    const wanted = f32(rest + f32(value));
    assert.ok(Math.abs(after.x - wanted) <= 1e-4, `${label} pump ${index}: the Control is at ${after.x}, the driver's frames put it at ${wanted}`);
  }
  assert.ok(complete, `${label}: the decay completed`);
  const [end, ...extra] = run.events.filter(entry => entry.kind === "end" && entry.label === run.box);
  assert.ok(end && extra.length === 0 && end.result.finished === true, `${label}: RN reports one finished end`);
  const landing = run.samples.at(-1).x - rest;
  assert.ok(landing > DECAY.from && landing < ASYMPTOTE, `${label}: lands at ${landing}, short of the ${ASYMPTOTE} the decay approaches`);
  if (pacing === "time") {
    // Ticks half a period apart or more land it inside the window. A presented loop's ticks
    // carry the pipelined CPU times of its frames, as close as those are, and land it anywhere.
    const low = lowestLanding(period / 2);
    assert.ok(landing >= low - 1e-3, `${label}: lands at ${landing}, inside [${low.toFixed(3)}, ${ASYMPTOTE}) for ticks half a period apart or more`);
  }
  return landing;
}

// The lane named the pace it ran at; a machine that did not deliver it would make the
// checks above hold of some other loop.
function verifyPacing(run, label) {
  const times = [run.rest.ms, ...run.samples.map(row => row.ms)];
  const gaps = times.slice(1).map((time, index) => time - times[index]);
  const period = periodOf(FALLBACK_RATE);
  const stalls = gaps.filter(gap => gap >= 3 * period).length;
  const catchUps = gaps.filter((gap, index) => index > 0 && gaps[index - 1] >= 3 * period && gap < period / 2).length;
  const as = {
    "paced-60": () => gaps.length >= 20 && median(gaps) > 8 && median(gaps) < 40,
    headless: () => gaps.length >= 20 && shareUnder(gaps, period / 2) > 0.3,
    fast: () => gaps.length >= 50 && shareUnder(gaps, period / 2) > 0.7,
    bursts: () => gaps.length >= 20 && stalls >= 3 && catchUps >= 3,
    "display-144": () => gaps.length >= 20 && median(gaps) > 3 && median(gaps) < 40,
    "fallback-144": () => gaps.length >= 20 && median(gaps) > 3 && median(gaps) < 40,
    "presentation-bimodal": () => gaps.length >= 20 && shareUnder(gaps, period / 2) > 0.15 && shareUnder(gaps, period / 2) < 0.85,
    "time-bimodal": () => gaps.length >= 20 && shareUnder(gaps, period / 2) > 0.15 && shareUnder(gaps, period / 2) < 0.85,
  }[run.pattern];
  assert.ok(as(), `${label}: the Godot loop ran at the pace the lane names`);
  return {frames: gaps.length, medianGapMs: median(gaps), shareUnderHalfPeriod: shareUnder(gaps, period / 2), stalls, catchUps};
}

function verifyRun(run, label, lane) {
  const pumps = pumpsOf(run);
  assert.ok(pumps.length > 0 && run.marks.loop === 0 && run.marks["stop-loop"] > run.marks.decay, `${label}: the run sampled its loop and its decay`);
  const pace = verifyPacing(run, label);
  const outcome = verifyDecisions(pumps, label, lane);
  verifyJs(run, pumps, label, lane);
  const delivered = verifyBackend(pumps, label, lane);
  assert.ok(delivered >= 2, `${label}: the backend delivered frames`);
  const landing = verifyDecay(run, pumps, label, lane);
  const window = pumps.slice(run.marks.loop, run.marks["stop-loop"]);
  const elapsed = window.at(-1).after.ms - window[0].before.ms;
  const loopTicks = window.filter(pump => pump.after.clock.ticks > pump.before.clock.ticks).length;
  // Stalls and the catch-up frames behind them are judged where time paces the loop.
  const stalls = lane.pacing === "time" ? verifyStalls(window, label, lane.rate) : null;
  if (run.pattern === "bursts") {
    assert.ok(stalls.stalls >= 3 && stalls.catchUps >= 3, `${label}: the bursts lane had stalls and catch-up frames to judge`);
  }
  return {frames: outcome.frames, ticks: outcome.ticks, waited: outcome.waited, idle: outcome.idle, backendFrames: delivered, landing,
    loopFrames: window.length, loopTicks, loopTicksPerSecond: (1000 * loopTicks) / elapsed, stalls, pacing: pace};
}

// ------------------------------------------------------------ the semantic lanes
function verifyCallbacks(stage, rate) {
  const period = periodOf(rate);
  const label = "callbacks";
  const {idle, once, cancelled, ordered, nested} = stage;
  const quiet = run => pumpsOf(run).forEach(({index, before, after}) => {
    assert.equal(after.clock.frames - before.clock.frames, 1, `${label} pump ${index}: the clock saw every Godot frame`);
    assert.equal(after.clock.ticks - before.clock.ticks + after.clock.skipped - before.clock.skipped, 0, `${label} pump ${index}: nothing waits for a frame`);
  });
  assert.equal(idle.samples.length, 40);
  quiet(idle);
  assert.equal(idle.events.length, 0);
  quiet(cancelled);
  assert.equal(cancelled.events.length, 0, `${label}: a cancelled request never runs`);
  // A request after idling is served by the very next Godot frame, as a tick.
  const [hit, ...rest] = once.events;
  assert.ok(hit && rest.length === 0 && hit.at === 0 && hit.label === "once", `${label}: one request, one callback, in the very next frame`);
  const first = pumpsOf(once)[0];
  assert.equal(first.after.clock.ticks - first.before.clock.ticks, 1, `${label}: that frame is a tick`);
  assert.equal(first.after.clock.skipped, first.before.clock.skipped);
  assert.ok(Math.abs(hit.timestamp - first.after.clock.lastTickMs) <= SAME_TICK, `${label}: the callback receives the tick's timestamp`);
  // Callbacks registered before a tick run in that tick, in order, with its timestamp.
  const parts = ordered.events.filter(entry => entry.kind === "frame");
  assert.deepEqual(parts.map(entry => entry.label), ["ordered:a", "ordered:b", "ordered:c"]);
  assert.ok(parts.every(entry => entry.at === parts[0].at && entry.timestamp === parts[0].timestamp), `${label}: one tick, one timestamp`);
  assert.ok(parts[0].sequence < parts[1].sequence && parts[1].sequence < parts[2].sequence);
  const orderedPump = pumpsOf(ordered)[parts[0].at];
  assert.equal(orderedPump.after.clock.ticks - orderedPump.before.clock.ticks, 1);
  assert.ok(Math.abs(parts[0].timestamp - orderedPump.after.clock.lastTickMs) <= SAME_TICK);
  // A request from inside a callback runs on a later tick, never the same one.
  const outer = nested.events.filter(entry => entry.label === "nested:outer");
  const inner = nested.events.filter(entry => entry.label === "nested:inner");
  assert.ok(outer.length === 1 && inner.length === 1 && inner[0].at > outer[0].at, `${label}: the nested callback runs in a later frame`);
  assert.ok(inner[0].timestamp - outer[0].timestamp >= period / 2 - EPSILON, `${label}: the nested callback's tick is at least half a period after the outer's`);
  for (const [entry, at] of [[outer[0], outer[0].at], [inner[0], inner[0].at]]) {
    const pump = pumpsOf(nested)[at];
    assert.equal(pump.after.clock.ticks - pump.before.clock.ticks, 1, `${label}: ${entry.label} ran in a tick`);
    assert.ok(Math.abs(entry.timestamp - pump.after.clock.lastTickMs) <= SAME_TICK);
  }
}

function verifyStop(stage) {
  const {before, after, again} = stage;
  assert.ok(before.ticks > 0 && typeof before.frames === "number", "The clock ticked for the loop before the stop");
  assert.deepEqual(after, before, "Stopping ends the ticks: the clock is as it was");
  assert.deepEqual(again, before, "and reports one state however often it is asked");
}

// ------------------------------------------------------------------- the report
export function verifyFrameClockReport(report) {
  const {stages} = report;
  assert.equal(report.scenario, "frame-clock");
  assert.ok(Math.abs(report.periodMs - periodOf(FALLBACK_RATE)) < 1e-12 && report.displayRate === DISPLAY_RATE);
  assert.deepEqual(stages.boxes, BOXES, "The fixture ran the experiment this oracle recomputes");
  const start = stages.clock.sample.clock;
  assert.ok(start.source === "fallback" && start.refreshRate === FALLBACK_RATE && Math.abs(start.periodMs - periodOf(FALLBACK_RATE)) < 1e-9
    && start.ticks === 0 && start.skipped === 0 && start.frames > 0, "A display with no refresh rate gives the 60 Hz fallback, with no tick yet");
  assert.ok(start.pacing === "time" && start.pacingSource === "headless", "A headless display server paces by time: it presents nothing");
  verifyCallbacks(stages.callbacks, FALLBACK_RATE);
  const stats = {};
  // The headless display server has no screen and presents nothing: Time pacing, at the fallback rate.
  const headless = {rate: FALLBACK_RATE, source: "fallback", pacing: "time", pacingSource: "headless"};
  for (const pacing of PACINGS) {
    stats[pacing] = verifyRun(stages.runs[pacing], pacing, headless);
  }
  stats["display-144"] = verifyRun(stages.runs["display-144"], "display-144", {...headless, rate: DISPLAY_RATE, source: "display"});
  stats["fallback-144"] = verifyRun(stages.runs["fallback-144"], "fallback-144", headless);
  // The same pipelined frames, as the validation seam says a V-Sync window presents them and,
  // for contrast, as a window nothing paces.
  stats["presentation-bimodal"] = verifyRun(stages.runs["presentation-bimodal"], "presentation-bimodal",
    {...headless, pacing: "presentation", pacingSource: "validation"});
  stats["time-bimodal"] = verifyRun(stages.runs["time-bimodal"], "time-bimodal", {...headless, pacingSource: "validation"});
  assert.ok(stats["presentation-bimodal"].waited === 0 && stats["presentation-bimodal"].loopTicks === stats["presentation-bimodal"].loopFrames,
    "Every pipelined frame of a presented window ticks, the 3 ms ones included, and none waits");
  assert.ok(stats["time-bimodal"].waited > 0 && stats["time-bimodal"].loopTicks < stats["time-bimodal"].loopFrames,
    "The same frames under Time pacing are thinned: those closer than half a period wait");
  // One decay, four pacings: the landing may differ only within the window that ticks no
  // closer than half a period allow, the hosted runner's bursts among them.
  const landings = PACINGS.map(pacing => stats[pacing].landing);
  const window = ASYMPTOTE - lowestLanding(periodOf(FALLBACK_RATE) / 2);
  assert.ok(Math.max(...landings) - Math.min(...landings) <= window,
    `The decay lands ${Math.min(...landings)} to ${Math.max(...landings)} across the pacings, more than ${window}`);
  // A loop of hundreds of frames a second is thinned to about the display's rate; a process
  // that a busy neighbour stalls ticks less, never more.
  assert.ok(stats.fast.loopTicksPerSecond < 1.2 * FALLBACK_RATE && stats.fast.ticks < 0.25 * stats.fast.frames,
    `A loop of hundreds of frames a second ticks ${stats.fast.loopTicksPerSecond} times a second, ${stats.fast.ticks} of ${stats.fast.frames} frames`);
  assert.ok(stats["fallback-144"].ticks < 0.7 * stats["fallback-144"].frames && stats["fallback-144"].loopTicksPerSecond < 1.2 * FALLBACK_RATE,
    "A 144 Hz loop on a display that reports nothing is thinned to the fallback rate");
  verifyStop(stages.stop);
  return {window: {lowestLanding: lowestLanding(periodOf(FALLBACK_RATE) / 2), asymptote: ASYMPTOTE, span: window,
    uniformLanding: {halfPeriod: landingOfUniformSteps(periodOf(FALLBACK_RATE) / 2), period: landingOfUniformSteps(periodOf(FALLBACK_RATE)),
      sixPointNineMs: landingOfUniformSteps(6.9), oneMs: landingOfUniformSteps(1)}}, runs: stats};
}
