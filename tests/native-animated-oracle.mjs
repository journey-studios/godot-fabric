import assert from "node:assert/strict";
import {ANIMATIONS, BOXES, COMPOSITION, INTERRUPT, TOUCHABLE} from "./native-animated-cases.mjs";

// Independent oracle, written from RN's formulas and its C++ drivers, not from
// the probe and without RN's animation code: easings, the JS drivers (Date.now()
// deltas), the C++ frame, spring and decay drivers (the timestamp of each frame
// the host delivered to RN's AnimationBackend, float32 values) and the way an
// interpolation and a transform land on a Godot Control.
const FRAME_MS = 1000 / 60;
const f32 = Math.fround;
const MAX_SPRING_STEP = 4 * FRAME_MS;
// What the Control may differ from the recomputed value by, after both round to
// float32 as the Control does. RN builds the native frame table from its own
// bezier solver and a rotation is split across two transforms; the recomputed
// values observed here agree to rounding (opacity and x within 1e-12, rotation
// within one float32 half-ulp), so these bounds are about 16 ulps.
const TOLERANCE = {opacity: 1e-6, x: 1e-4, y: 1e-4, rotation: 1e-5};

const quad = t => t * t;
const cubic = t => t * t * t;
const out = easing => t => 1 - easing(1 - t);
const inOut = easing => t => (t < 0.5 ? easing(t * 2) / 2 : 1 - easing((1 - t) * 2) / 2);
// CSS cubic-bezier by bisection on x: the easing y at the t where x(s) = t.
function bezier(x1, y1, x2, y2) {
  const at = (s, a, b) => 3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;
  return t => {
    if (t <= 0 || t >= 1) {
      return Math.min(1, Math.max(0, t));
    }
    let low = 0;
    let high = 1;
    for (let step = 0; step < 64; step++) {
      const middle = (low + high) / 2;
      if (at(middle, x1, x2) < t) {
        low = middle;
      } else {
        high = middle;
      }
    }
    return at((low + high) / 2, y1, y2);
  };
}
const EASINGS = {linear: t => t, "inOut(ease)": inOut(bezier(0.42, 0, 1, 1)), "out(cubic)": out(cubic), "inOut(quad)": inOut(quad)};

// RN's interpolation as the JS driver evaluates it (clamp-free, "extend").
const jsMix = (value, range, output) => {
  const t = (value - range[0]) / (range[1] - range[0]);
  return output[0] * (1 - t) + output[1] * t;
};
// The C++ interpolate() the native driver and interpolation nodes use.
const mix = (x, inMin, inMax, outMin, outMax) => outMin + (outMax - outMin) * (x - inMin) / (inMax - inMin);

// ---------------------------------------------------------------- JS drivers
function springAt(config, seconds, from) {
  const c = config.damping;
  const m = config.mass;
  const k = config.stiffness;
  const v0 = 0;
  const zeta = c / (2 * Math.sqrt(k * m));
  const omega0 = Math.sqrt(k / m);
  const omega1 = omega0 * Math.sqrt(1.0 - zeta * zeta);
  const x0 = config.to - from;
  if (zeta < 1) {
    const envelope = Math.exp(-zeta * omega0 * seconds);
    return {
      position: config.to - envelope * (((v0 + zeta * omega0 * x0) / omega1) * Math.sin(omega1 * seconds) + x0 * Math.cos(omega1 * seconds)),
      velocity: zeta * omega0 * envelope * ((Math.sin(omega1 * seconds) * (v0 + zeta * omega0 * x0)) / omega1 + x0 * Math.cos(omega1 * seconds))
        - envelope * (Math.cos(omega1 * seconds) * (v0 + zeta * omega0 * x0) - omega1 * x0 * Math.sin(omega1 * seconds)),
    };
  }
  const envelope = Math.exp(-omega0 * seconds);
  return {position: config.to - envelope * (x0 + (v0 + omega0 * x0) * seconds),
    velocity: envelope * (v0 * (seconds * omega0 - 1) + seconds * x0 * (omega0 * omega0))};
}
const decayAt = (config, milliseconds) => config.from + (config.velocity / (1 - config.deceleration))
  * (1 - Math.exp(-(1 - config.deceleration) * milliseconds));
const timingAt = (config, milliseconds) => config.from + EASINGS[config.easing](Math.min(1, milliseconds / config.duration)) * (config.to - config.from);

// The curve's extremes over a window of elapsed time: a value is accepted when
// some elapsed time in the window produces it.
function inWindow(curve, low, high, observed, tolerance = 1e-9) {
  let min = Infinity;
  let max = -Infinity;
  for (let step = 0; step <= 96; step++) {
    const value = curve(Math.max(0, low + (high - low) * step / 96));
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return observed >= min - tolerance && observed <= max + tolerance;
}

const valuesOf = (events, label) => events.filter(entry => entry.kind === "value" && entry.label === label);
const endsOf = (events, label) => events.filter(entry => entry.kind === "end" && entry.label === label);
const degrees = text => {
  assert.match(text, /^-?[0-9.e+-]+deg$/);
  return Number.parseFloat(text);
};

// What the listener stamps say about the time a JS driver step ran at. RN's
// driver reads Date.now() when its step runs, and the listener stamps its own
// entry right after, on the same thread: so a step ran no later than its stamp,
// and no earlier than the stamp of the step before it. These are facts, not
// tolerances: a pause between two reads (a collection, a descheduled process)
// only widens the window by as much as the pause was. The driver's start lies
// between the stamps taken around the call that started it.
const stepWindow = (previous, stamp, started) => ({low: Math.max(0, previous - started.after), high: stamp - started.before + 1});

// Date.now() reads whole milliseconds, so a lower bound that holds in time (an
// animation lasts its duration, a timer waits its delay) holds between two of its
// stamps to within one millisecond. That is the only slack the duration and delay
// bounds below take. They are measured from the stamp taken before the call that
// started the animation, never from its first frame: a loaded machine may deliver
// the first frame well after the start, which shortens "end minus first frame"
// while the animation itself ran its full duration.
const CLOCK_GRANULARITY = 1;

// How many frames a host delivers to an animation is its frame pacing, so no count of
// values is a property of the driver, except that one which runs for a duration or to
// rest reports a frame inside the animation and the one that ends it. A decay ends at
// its first step under 0.1, which a few frames reach (see verifyJsValue).
const FEWEST_JS_VALUES = 2;

// A JS-driver animation on a bare value: every listener entry is on the curve
// RN's driver computes for the Date.now() it ran at (see stepWindow), its
// interpolated outputs follow from the raw value, and the end is as RN's driver
// ends.
function verifyJsValue(name, stage) {
  const config = ANIMATIONS[name];
  const [start] = stage.events.filter(entry => entry.kind === "start" && entry.label === name);
  const values = valuesOf(stage.events, name);
  const [end, ...extra] = endsOf(stage.events, name);
  // RN's decay may end after a few values: two frames that read the same
  // millisecond make a step of 0, which is below its 0.1 threshold.
  assert.ok(start && end && extra.length === 0 && values.length >= (config.kind === "decay" ? 1 : FEWEST_JS_VALUES), name);
  assert.equal(end.result.finished, true, name);
  // RN's spring runs its first step inside start(), before the caller regains control.
  assert.ok(end.sequence > values.at(-1).sequence && values.every(entry => entry.t >= start.before), name);
  const map = config.map;
  // RN's spring advances its own clock by at most 64 ms of Date.now() per step,
  // from where it was: after a long pause that clock lags Date.now(), so the
  // earliest it can be is bounded step by step.
  let clock = start.before;
  values.forEach((entry, index) => {
    const previous = index === 0 ? start.after : values[index - 1].t;
    let {low, high} = stepWindow(previous, entry.t, start);
    if (config.kind === "spring") {
      clock = index === 0 ? start.before : Math.min(previous, clock + 64);
      low = Math.max(0, clock - start.after);
    }
    const curve = {timing: milliseconds => timingAt(config, milliseconds), decay: milliseconds => decayAt(config, milliseconds),
      spring: milliseconds => springAt(config, milliseconds / 1000, config.from).position}[config.kind];
    const last = index === values.length - 1;
    const exact = last && config.kind !== "decay";
    assert.ok(exact ? entry.value === config.to : inWindow(curve, low, high, entry.value), `${name} value ${index}: ${entry.value}`);
    // The outputs are RN's interpolation of the raw value.
    assert.ok(Math.abs(entry.opacity - jsMix(entry.value, map.input, map.opacity)) < 1e-9, `${name} opacity ${index}`);
    assert.ok(Math.abs(entry.translateX - jsMix(entry.value, map.input, map.translateX)) < 1e-9, `${name} translateX ${index}`);
    assert.ok(Math.abs(degrees(entry.rotate) - jsMix(entry.value, map.input, map.rotate)) < 1e-9, `${name} rotate ${index}`);
  });
  if (config.kind === "decay") {
    // Ends at the first step below 0.1; every earlier step was at least 0.1.
    const steps = values.map((entry, index) => Math.abs(entry.value - (index === 0 ? config.from : values[index - 1].value)));
    assert.ok(steps.at(-1) < 0.1 && steps.slice(0, -1).every(step => step >= 0.1), `${name} ends at the first step below 0.1`);
  } else if (config.kind === "spring") {
    // RN emits the target itself once the spring is at rest.
    const near = values.at(-2);
    assert.ok(Math.abs(near.value - config.to) <= 0.001 && values.at(-1).value === config.to, `${name} ends at rest`);
  } else {
    assert.ok(values.at(-1).t - start.before >= config.duration - CLOCK_GRANULARITY, `${name} lasts its duration`);
  }
}

function verifyComposition(stage) {
  const events = stage.events;
  const order = group => events.filter(entry => entry.kind === "end" && entry.label.startsWith(group))
    .map(entry => `${entry.label}:${entry.result.finished}`);
  assert.deepEqual(order("sequence"), ["sequence-0:true", "sequence-1:true", "sequence:true"]);
  assert.deepEqual(order("parallel"), ["parallel-0:true", "parallel-1:true", "parallel:true"]);
  assert.deepEqual(order("stagger"), ["stagger-0:true", "stagger-1:true", "stagger:true"]);
  assert.deepEqual(order("loop"), ["loop-iteration:true", "loop-iteration:true", "loop:true"]);
  const first = label => valuesOf(events, label)[0];
  const end = label => endsOf(events, label)[0];
  // Every composition started in the one call stamped by stage.started, so none of
  // its animations started before startBefore. RN's JS driver ends a timing
  // animation at the first frame whose Date.now() is its own start plus its
  // duration, and the delay of a stagger is a timer set in that call.
  const {startBefore} = stage.started;
  // sequence runs its second ramp only after the first ended, and the first ramp
  // ran its duration.
  assert.ok(first("sequence-1").sequence > end("sequence-0").sequence);
  const sequenced = end("sequence-0").t - startBefore;
  assert.ok(sequenced >= COMPOSITION.sequence[0] - CLOCK_GRANULARITY,
    `sequence-0 ended ${sequenced} ms after the start, for a ${COMPOSITION.sequence[0]} ms ramp`);
  // parallel starts both ramps together; the shorter one ends first. Together is the
  // same frame: the host runs the frame callbacks registered before a frame in that
  // frame, in order, and defers what they register to the next one, so both ramps
  // report their first value in the frame that follows the call. Every entry carries the
  // timestamp the host gave the frame it was recorded in, which no other frame has: the
  // order of the entries could not say it, since a first value that came late would
  // still precede the other ramp's second.
  const [shorter, longer] = [first("parallel-0"), first("parallel-1")];
  assert.ok(typeof shorter.frame === "number" && shorter.frame === longer.frame, "parallel starts both ramps in the same frame");
  assert.ok(end("parallel-0").sequence < end("parallel-1").sequence);
  // stagger starts the second ramp its delay after the call that started the stagger.
  const staggered = first("stagger-1").t - startBefore;
  assert.ok(staggered >= COMPOSITION.stagger.delay - CLOCK_GRANULARITY,
    `stagger-1 reported its first value ${staggered} ms after the start, for a ${COMPOSITION.stagger.delay} ms delay`);
  // loop runs its ramp twice: the value falls back once, between the two runs.
  const loop = valuesOf(events, "loop-iteration").map(entry => entry.value);
  assert.equal(loop.filter((value, index) => index > 0 && value < loop[index - 1]).length, 1);
  assert.equal(loop.at(-1), 1);
  for (const label of ["sequence", "parallel", "stagger", "loop"]) {
    const group = events.filter(entry => entry.kind === "value" && entry.label.startsWith(label));
    assert.ok(end(label).sequence > group.at(-1).sequence, `${label} reports its end after its last value`);
  }
}

function verifyInterrupt(stage) {
  const events = stage.events;
  const start = stage.started;
  const [stopped] = endsOf(events, "stopped");
  const [reading] = events.filter(entry => entry.kind === "stopAnimation");
  const stoppedValues = valuesOf(events, "stopped");
  assert.equal(endsOf(events, "stopped").length, 1);
  assert.equal(stopped.result.finished, false);
  // stop() ran from a 100 ms timer; nothing moved after it and the value read
  // is the last one reported, on the linear curve.
  assert.ok(stopped.t - start.startBefore >= INTERRUPT.stopAfter - CLOCK_GRANULARITY);
  assert.ok(stoppedValues.every(entry => entry.sequence < stopped.sequence));
  assert.equal(reading.value, stoppedValues.at(-1).value);
  const linear = milliseconds => milliseconds / INTERRUPT.longDuration;
  const ran = stepWindow(stoppedValues.at(-2).t, stoppedValues.at(-1).t, {before: start.startBefore, after: start.startAfter});
  assert.ok(inWindow(linear, ran.low, ran.high, reading.value));
  // A new animation on the same value stops the old one, which ends unfinished,
  // and runs from where the old one was to its own target.
  const [first] = endsOf(events, "first");
  const [second] = endsOf(events, "second");
  const replaced = valuesOf(events, "replaced");
  assert.equal(first.result.finished, false);
  assert.equal(second.result.finished, true);
  assert.ok(first.sequence < second.sequence && Math.abs(replaced.at(-1).value - INTERRUPT.replacement.to) < 1e-12);
  const before = replaced.filter(entry => entry.sequence < first.sequence).at(-1).value;
  const curve = milliseconds => before + (INTERRUPT.replacement.to - before) * Math.min(1, milliseconds / INTERRUPT.replacement.duration);
  // RN stops the old animation (its end callback is the stamp of the first) and
  // then starts the new one, whose start is no later than its first entry.
  const after = replaced.filter(row => row.sequence > first.sequence);
  after.forEach((entry, index) => {
    const ran = stepWindow(index === 0 ? after[0].t : after[index - 1].t, entry.t, {before: first.t, after: after[0].t});
    assert.ok(inWindow(curve, ran.low, ran.high, entry.value, 1e-9), `replaced ${entry.value}`);
  });
}

// ------------------------------------------------------------ native drivers
// The drivers' state machines, one function per animation: each call is one
// delivered frame and returns the node's value and whether the driver completed.
function frameModel(config) {
  const count = Math.round(config.duration / FRAME_MS);
  const table = Array.from({length: count}, (_, index) => EASINGS[config.easing](index / count));
  table.push(EASINGS[config.easing](1));
  let started = null;
  return timestamp => {
    started ??= timestamp;
    const delta = timestamp - started;
    const index = Math.round(delta / FRAME_MS);
    if (index + 1 >= table.length) {
      return {value: config.to, complete: true};
    }
    const frame = mix(delta, index * FRAME_MS, (index + 1) * FRAME_MS, table[index], table[index + 1]);
    return {value: mix(frame, 0, 1, config.from, config.to), complete: false};
  };
}
function springModel(config) {
  let started = null;
  let last = 0;
  let accumulated = 0;
  return timestamp => {
    const first = started === null;
    started ??= timestamp;
    const delta = timestamp - started;
    if (first) {
      last = delta - FRAME_MS;
      accumulated = 0;
    }
    accumulated += Math.min(delta - last, MAX_SPRING_STEP);
    last = delta;
    const {position, velocity} = springAt(config, accumulated / 1000, config.from);
    const value = f32(position);
    if (Math.abs(velocity) <= 0.001 && Math.abs(value - config.to) <= 0.001) {
      return {value: f32(config.to), complete: true};
    }
    return {value, complete: false};
  };
}
function decayModel(config) {
  let started = null;
  let last = config.from;
  let value = config.from;
  return timestamp => {
    const first = started === null;
    started ??= timestamp;
    const delta = timestamp - started;
    const next = f32(decayAt(config, 1000 * (delta / 1000)));
    if (!first && Math.abs(next - last) < 0.1) {
      return {value, complete: true};
    }
    last = next;
    value = next;
    return {value, complete: false};
  };
}
const MODELS = {timing: frameModel, spring: springModel, decay: decayModel};

// How a node value lands on the Control: opacity through the box's interpolation
// (or directly), translateX and rotate through theirs, or an XY value's two nodes.
function controlProps(box, config, values) {
  if (box.view === "xy") {
    return {x: f32(values.x), y: f32(values.y)};
  }
  const value = values.value;
  if (box.map.opacity === "direct") {
    return {opacity: f32(value)};
  }
  const radians = box.map.rotate.map(angle => (angle * Math.PI) / 180);
  return {opacity: f32(mix(value, ...box.map.input, ...box.map.opacity)), x: f32(mix(value, ...box.map.input, ...box.map.translateX)),
    rotation: f32(mix(value, ...box.map.input, ...radians))};
}
const angleDifference = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
// Each Control's layout position at mount, before any animation moved it.
let layouts = {};

// One animation of a run: from its request, every frame the host delivered
// steps the driver with the timestamp it reports, and every sample of the
// target Control must show what that frame applied.
function verifyStart(run, index, stats, options = {}) {
  const start = run.starts[index];
  const config = start.config ?? ANIMATIONS[start.name];
  const box = start.box ?? BOXES[config.box];
  const target = start.target ?? `${start.root}/${config.box}`;
  const first = run.samples.findIndex(row => row.frames > start.request.frames);
  assert.ok(first >= 0, `${start.name}: the backend delivered a frame after the request`);
  // The backend wants frames from the moment the request runs (a call from JS, or the handler of an
  // input), and the frame clock ticks for it at the first frame it can: the first tick after the
  // request delivers the backend's first frame, with no tick between them. Where that tick is
  // among the Godot frames is the host's pacing.
  assert.ok(first >= start.at, `${start.name}: the first frame comes after the request`);
  assert.equal(run.samples[first].ticks - start.request.ticks, 1, `${start.name}: the first frame is the first tick after the request`);
  const xy = box.view === "xy";
  const models = xy ? {x: MODELS.timing({...config, from: config.from.x, to: config.to.x}),
    y: MODELS.timing({...config, from: config.from.y, to: config.to.y})} : {value: MODELS[config.kind](config)};
  const rest = layouts[target];
  let values = xy ? {x: config.from.x, y: config.from.y} : {value: config.from};
  let complete = false;
  let delivered = 0;
  let last = null;
  for (let at = first; at < (options.until ?? run.samples.length); at++) {
    const row = run.samples[at];
    const before = at > 0 ? run.samples[at - 1] : run.rest;
    assert.ok(row.frames - before.frames === 0 || row.frames - before.frames === 1, `${start.name}: at most one frame per Godot frame`);
    // Only a tick of the frame clock runs the backend, and there is at most one per Godot frame.
    assert.ok(row.ticks - before.ticks === 0 || row.ticks - before.ticks === 1, `${start.name} sample ${at}: at most one tick per Godot frame`);
    assert.ok(row.frames - before.frames <= row.ticks - before.ticks, `${start.name} sample ${at}: the backend runs only on a tick`);
    if (row.frames > before.frames) {
      delivered += 1;
      assert.ok(typeof row.ts === "number" && (last === null || row.ts > last), `${start.name}: frame timestamps increase`);
      last = row.ts;
      const running = !complete && !(options.stopAt != null && at >= options.stopAt);
      if (running) {
        const steps = Object.fromEntries(Object.entries(models).map(([key, model]) => [key, model(row.ts)]));
        values = Object.fromEntries(Object.entries(steps).map(([key, step]) => [key, step.value]));
        complete = Object.values(steps).every(step => step.complete);
      }
    }
    const actual = row.controls[target];
    if (!actual.present) {
      assert.ok(options.removedFrom != null && at >= options.removedFrom, `${start.name}: the Control exists until removed`);
      continue;
    }
    const expected = controlProps(box, config, values);
    for (const [key, value] of Object.entries(expected)) {
      const base = key === "x" ? rest.x : key === "y" ? rest.y : 0;
      const wanted = key === "x" || key === "y" ? f32(base + value) : value;
      const error = key === "rotation" ? angleDifference(actual.rotation, wanted) : Math.abs(actual[key] - wanted);
      stats[key] = Math.max(stats[key] ?? 0, error);
      assert.ok(error <= TOLERANCE[key], `${start.name} sample ${at} (${key}): ${actual[key]} against ${wanted}`);
    }
    for (const key of ["scale_x", "scale_y"]) {
      assert.ok(Math.abs(actual[key] - 1) < 1e-6, `${start.name}: ${key} stays 1`);
    }
    if (!("y" in expected)) {
      assert.ok(Math.abs(actual.y - layouts[target].y) < 1e-6, `${start.name}: y stays at the layout position`);
    }
  }
  stats.frames = (stats.frames ?? 0) + delivered;
  if (options.stopAt == null && options.removedFrom == null) {
    assert.ok(complete, `${start.name}: the driver completed`);
  }
  stats[`delivered ${index}`] = delivered;
  return {values, complete};
}

// The end callback's own result: RN reports the node's value and offset.
function verifyEnd(run, label, expected) {
  const [end, ...extra] = run.events.filter(entry => entry.kind === "end" && entry.label === label);
  assert.ok(end && extra.length === 0, `${label}: one end callback`);
  assert.equal(end.result.finished, expected.finished, label);
  if (expected.value !== undefined) {
    assert.ok(Math.abs(end.result.value - expected.value) <= 1e-12, `${label}: end value ${end.result.value} against ${expected.value}`);
    assert.equal(end.result.offset, 0);
  }
}

function verifyBackendCounters(run) {
  // The host reports each delivered frame once, and only while RN's backend
  // wants frames: resumes and pauses alternate and no direct update is stale
  // unless the run expects it.
  let resumed = run.rest.resumes - run.rest.pauses;
  assert.ok(resumed === 0 || resumed === 1);
  for (const row of run.samples) {
    resumed = row.resumes - row.pauses;
    assert.ok(resumed === 0 || resumed === 1, "resumes and pauses alternate");
  }
}

// ---------------------------------------------------------------- the report
// The JS drivers need no native module and no view: they must agree with the
// oracle on every host, including one without RN's native Animated.
export function verifyJsDriverReport(report) {
  const {stages} = report;
  assert.equal(report.scenario, "native-animated");
  assert.deepEqual(stages.mount.cases, JSON.parse(JSON.stringify({animations: ANIMATIONS, boxes: BOXES})),
    "The fixture ran the experiment this oracle recomputes");
  for (const name of ["js-timing", "js-spring", "js-decay"]) {
    verifyJsValue(name, stages[name]);
  }
  verifyComposition(stages["js-composition"]);
  verifyInterrupt(stages["js-interrupt"]);
}

// The boxes that finished or stopped an animation, with the stage whose last
// sample is their final props: after every later React commit of the run, the
// Control must still show them. Derived here from the stages' raw samples.
const PERSISTENT = ["native-spring", "native-decay", "native-created", "native-xy", "native-stop", "native-listener", "native-rerender"];
// Whether the driver's own rule moved the box over the frames the host delivered. Every
// animation that runs for a duration or to rest does; a decay ends at its first step under
// 0.1, which two frames a fraction of a millisecond apart reach before the Control has
// moved, so the delivered timestamps decide whether there is a final prop to persist.
function leavesRest(run, name) {
  const config = ANIMATIONS[name];
  if (config.kind !== "decay") {
    return true;
  }
  const model = MODELS.decay(config);
  let frames = run.rest.frames;
  for (const row of run.samples) {
    if (row.frames > frames) {
      const step = model(row.ts);
      if (step.value !== config.from) {
        return true;
      }
      if (step.complete) {
        return false;
      }
    }
    frames = row.frames;
  }
  return false;
}
export function verifyPersistence(report) {
  const {stages} = report;
  for (const box of PERSISTENT) {
    const final = stages[box].final.controls[`A/${box}`];
    const rest = stages.mount.rest[`A/${box}`];
    assert.ok(final.present && (final.opacity !== rest.opacity || final.x !== rest.x || final.y !== rest.y || !leavesRest(stages[box], box)),
      `${box} left its rest props in its own run`);
    assert.deepEqual(stages.persistence.props[box], final, `${box} keeps its final props through every later React commit`);
  }
  assert.deepEqual(stages.persistence.reverted, []);
}

export function verifyNativeAnimatedReport(report) {
  const {stages} = report;
  layouts = stages.mount.rest;
  assert.ok(Math.abs(report.frameMs - FRAME_MS) < 1e-12);
  verifyJsDriverReport(report);

  const stats = {};
  const track = name => (stats[name] = {});
  // The JS driver on a view: the Control ends at the final outputs, and the
  // native backend never ran.
  const jsView = stages["js-view"];
  const jsBox = BOXES["js-view"];
  const jsFinal = jsView.final.controls["A/js-view"];
  const jsRest = jsView.rest.controls["A/js-view"];
  assert.ok(Math.abs(jsFinal.opacity - f32(jsBox.map.opacity[1])) <= TOLERANCE.opacity);
  assert.ok(Math.abs(jsFinal.x - (jsRest.x + jsBox.map.translateX[1])) <= TOLERANCE.x);
  assert.ok(angleDifference(jsFinal.rotation, (jsBox.map.rotate[1] * Math.PI) / 180) <= TOLERANCE.rotation);
  assert.deepEqual([jsView.final.frames, jsView.final.resumes, jsView.final.direct], [jsView.rest.frames, jsView.rest.resumes, jsView.rest.direct]);
  verifyEnd(jsView, "js-view", {finished: true});

  for (const name of ["native-timing", "native-spring", "native-decay", "native-created", "native-xy", "native-listener", "native-rerender"]) {
    const run = stages[name];
    verifyBackendCounters(run);
    const result = verifyStart(run, 0, track(name));
    const config = ANIMATIONS[name];
    const final = config.kind === "spring" ? f32(config.to) : config.to;
    if (config.kind === "decay") {
      verifyEnd(run, name, {finished: true, value: result.values.value});
    } else if (BOXES[config.box].view !== "xy") {
      verifyEnd(run, name, {finished: true, value: final});
    } else {
      verifyEnd(run, name, {finished: true});
    }
  }

  // stopAnimation: the driver stops at the first frame after the request, the
  // value read is what was applied, and nothing moves afterwards.
  const stop = stages["native-stop"];
  verifyBackendCounters(stop);
  verifyStart(stop, 0, track("native-stop"), {stopAt: stop.marks[0].at});
  const [reading] = stop.events.filter(entry => entry.kind === "stopAnimation");
  assert.ok(Math.abs(reading.value - stop.samples[stop.marks[0].at - 1].controls["A/native-stop"].opacity) <= 1.2e-7);
  verifyEnd(stop, "native-stop", {finished: false});

  // The listener hears RN's own values: the model's node value each frame it
  // changed, then the final value once more from the end callback's sync.
  const listener = stages["native-listener"];
  const heard = listener.events.filter(entry => entry.kind === "listener").map(entry => entry.value);
  const model = frameModel(ANIMATIONS["native-listener"]);
  const expected = [];
  let current = ANIMATIONS["native-listener"].from;
  listener.samples.forEach((row, at) => {
    const before = at > 0 ? listener.samples[at - 1] : listener.rest;
    if (row.frames > before.frames && !(expected.length > 0 && current === ANIMATIONS["native-listener"].to)) {
      const next = model(row.ts).value;
      if (next !== current) {
        expected.push(next);
        current = next;
      }
    }
  });
  assert.equal(heard.length, expected.length + 1);
  expected.forEach((value, index) => assert.ok(Math.abs(heard[index] - value) <= 1e-12, `listener value ${index}`));
  assert.equal(heard.at(-1), heard.at(-2));
  assert.equal(listener.counts.after.valueEvents - listener.counts.before.valueEvents, expected.length);

  // An Animated.View removed mid-animation: the Control goes, the driver stops
  // being applied, and a view already gone only counts stale updates until RN
  // disconnects it.
  for (const name of ["native-unmount", "native-race"]) {
    const run = stages[name];
    const hidden = run.marks[0].at;
    verifyBackendCounters(run);
    verifyStart(run, 0, track(name), {removedFrom: hidden});
    const missing = run.samples.findIndex(row => !row.controls[`A/${ANIMATIONS[name].box}`].present);
    assert.ok(missing >= hidden, `${name}: the Control is removed after the request`);
    // The frame of the tick that removed the view may still have applied one
    // update before the removal, or found the view gone and dropped it.
    let staleBefore = run.samples[missing - 1].stale;
    let stale = 0;
    for (const row of run.samples.slice(missing)) {
      assert.ok(row.stale - staleBefore === 0 || row.stale - staleBefore === 1);
      stale += row.stale - staleBefore;
      staleBefore = row.stale;
      assert.equal(row.direct, run.samples[missing].direct, `${name}: nothing is applied once the Control is gone`);
    }
    if (name === "native-race") {
      assert.ok(stale > 0 && stale <= run.samples.length - missing, `${name}: stale updates are counted`);
    } else {
      assert.equal(stale, 0, `${name}: RN disconnects before the next frame, so no update is stale`);
    }
    verifyEnd(run, name, {finished: false});
  }

  // Two roots of one application: each animation on its own curve from its own
  // request, and the second root going away leaves the first on its curve.
  const roots = stages["native-two-roots"];
  verifyBackendCounters(roots);
  verifyStart(roots, 0, track("native-two-a"));
  verifyStart(roots, 1, track("native-two-b"));
  verifyEnd(roots, "native-two-a", {finished: true, value: 1});
  verifyEnd(roots, "native-two-b", {finished: true, value: 1});
  assert.notEqual(roots.starts[0].request.frames, roots.starts[1].request.frames);
  const again = stages["native-two-roots/unmount"];
  verifyBackendCounters(again);
  verifyStart(again, 0, track("native-return"));
  verifyEnd(again, "native-return", {finished: true, value: 0});

  // TouchableOpacity: RN's own timings (0 ms on the grant, 250 ms on the way
  // back) through the same driver, from each actual input.
  for (const device of ["mouse", "touch"]) {
    const run = stages[`touchable-opacity/${device}`];
    verifyBackendCounters(run);
    const box = {view: "view", map: {opacity: "direct"}};
    const press = {kind: "timing", from: TOUCHABLE.restOpacity, to: TOUCHABLE.activeOpacity, duration: TOUCHABLE.pressIn, easing: TOUCHABLE.easing};
    const release = {kind: "timing", from: TOUCHABLE.activeOpacity, to: TOUCHABLE.restOpacity, duration: TOUCHABLE.pressOut, easing: TOUCHABLE.easing};
    const target = "A/touchable";
    run.starts[0] = {...run.starts[0], config: press, box, target};
    run.starts[1] = {...run.starts[1], config: release, box, target};
    const statistics = track(`touchable-opacity/${device}`);
    // Each transition from its own request: the press up to the release input.
    verifyStart(run, 0, statistics, {until: run.marks[1].at});
    verifyStart(run, 1, statistics);
    const heard = run.events.filter(entry => entry.kind === "touchable").map(entry => entry.type);
    assert.deepEqual(heard, ["in", "out", "press"]);
  }

  verifyPersistence(report);
  const stopped = stages.stop;
  assert.ok(stopped.stopped && stopped.after.frames === stopped.before.frames && stopped.after.directUpdates === stopped.before.directUpdates);
  assert.deepEqual(stopped.errors, []);
  return stats;
}
