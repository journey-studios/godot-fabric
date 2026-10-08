import assert from "node:assert/strict";
import {BASE, CASES, CHILD, DOOMED, POSES, RACE_MS} from "./layout-animation-cases.mjs";

// The independent oracle of the LayoutAnimation report. It never reads a verdict of the Godot probe: from the raw
// report (the samples of the Controls, the counters of the driver and the transactions it served, with the clock RN
// read for each) and the plain data of tests/layout-animation-cases.mjs it recomputes every frame of every animation
// with RN's own formulas and compares. The formulas are RN 0.87.1's, from the files the bundle pins:
//   ReactCommon/react/renderer/animations/conversions.h:68-203   the config RN's driver accepts (parseLayoutAnimationConfig)
//   ReactCommon/react/renderer/animations/utils.cpp:13-67        the progress and the interpolation factor of a curve
//   ReactCommon/react/renderer/animations/LayoutAnimationKeyFrameManager.cpp
//     :82-95     the clock RN reads (now_), here the host's frame time in whole milliseconds
//     :101-141   configureNext: the config is parsed, the failure callback called when RN cannot parse it
//     :164-1045  pullTransaction: :170 reads the clock, :243-252 consumes the armed animation and starts it at that time,
//                :356-433 creates and inserts run at once, :434-646 updates and deletes are animated (and an insert faded or
//                scaled in from opacity 0 or scale 0, a delete faded or scaled out to it), :647-672 a conflicting key frame
//                is replaced by one that starts from the view the old one last put on screen (viewPrev), :1031-1043 the
//                status delegate (started on 0 to N animations in flight, completed on N to 0)
//     :1080-1152 the interpolated view (interpolateFloats: x, y, width, height) and :1160-1250 the final mutations of a key frame
//   ReactCommon/react/renderer/animations/LayoutAnimationDriver.cpp:17-115   one update per key frame per transaction, the
//                  callback and the final mutations of a completed animation
//   ReactCommon/react/renderer/components/view/ViewPropsInterpolation.h:24-48   opacity and transform interpolation
//   Libraries/LayoutAnimation/LayoutAnimation.js:60-118   RN's JS timer, armed at duration + 17 ms and cleared by the end
const TYPES = ["spring", "linear", "easeInEaseOut", "easeIn", "easeOut", "keyboard"];
const PROPERTIES = ["opacity", "scaleX", "scaleY", "scaleXY"];
const KIND = {box: "update", child: "create", doomed: "delete"};
const IDS = ["box", "child", "doomed"];
// The Controls hold single-precision floats, as RN's own interpolation does: the observed distance to these formulas is below 1e-4.
const POSITION_TOLERANCE = 5e-4;
const UNIT_TOLERANCE = 1e-5;

// conversions.h:68-150 parseAnimationConfig. A sub-config RN accepts, or null when RN rejects it.
function parseSub(config, defaultDuration, withProperty) {
  if (config === null || typeof config !== "object" || Object.keys(config).length === 0) {
    return {type: "linear", property: null, duration: defaultDuration, delay: 0, springDamping: 0};
  }
  if (typeof config.type !== "string" || !TYPES.includes(config.type)) {
    return null;
  }
  let property = null;
  if (withProperty) {
    if (typeof config.property !== "string" || !PROPERTIES.includes(config.property)) {
      return null;
    }
    property = config.property;
  }
  if ("duration" in config && typeof config.duration !== "number") {
    return null;
  }
  if ("delay" in config && typeof config.delay !== "number") {
    return null;
  }
  return {type: config.type, property, duration: config.duration ?? defaultDuration, delay: config.delay ?? 0,
    springDamping: typeof config.springDamping === "number" ? config.springDamping : 0.5};
}

// conversions.h:177-203 parseLayoutAnimationConfig: the effective config of a configureNext, or null when the driver rejects it.
function parseLayoutAnimationConfig(config) {
  if (config === null || typeof config !== "object" || Object.keys(config).length === 0 || typeof config.duration !== "number") {
    return null;
  }
  const none = {type: "none", property: null, duration: 0, delay: 0, springDamping: 0};
  const sub = (key, withProperty) => (key in config ? parseSub(config[key], config.duration, withProperty) : none);
  const parsed = {duration: config.duration, create: sub("create", true), update: sub("update", false), delete: sub("delete", true)};
  return parsed.create && parsed.update && parsed.delete ? parsed : null;
}

// utils.cpp:13-67 calculateAnimationProgress: [the linear progress of time, the interpolation factor], from the time RN reads
// (whole milliseconds) and the start time of the animation.
function animationProgress(now, startTime, config) {
  if (config.type === "none") {
    return [1, 1];
  }
  const delay = Math.trunc(config.delay);
  const endTime = startTime + delay + Math.trunc(config.duration);
  if (now >= endTime) {
    return [1, 1];
  }
  if (now < startTime + delay) {
    return [0, 0];
  }
  const linear = 1 - (endTime - delay - now) / (endTime - startTime);
  if (config.type === "easeIn") {
    return [linear, linear ** 2];
  }
  if (config.type === "easeOut") {
    return [linear, 1 - (1 - linear) ** 2];
  }
  if (config.type === "easeInEaseOut") {
    return [linear, Math.cos((linear + 1) * Math.PI) / 2 + 0.5];
  }
  if (config.type === "spring") {
    const damping = config.springDamping;
    return [linear, 1 + 2 ** (-10 * linear) * Math.sin((linear - damping / 4) * Math.PI * 2 / damping)];
  }
  return [linear, linear];
}

const lerp = (from, to, factor) => from + (to - from) * factor;
const rested = rect => ({present: true, x: rect.x, y: rect.y, width: rect.width, height: rect.height, opacity: 1, scale_x: 1, scale_y: 1, visible: true});
const absent = {present: false};
const scalesX = property => property === "scaleX" || property === "scaleXY";
const scalesY = property => property === "scaleY" || property === "scaleXY";
const box = (begin, end, factor) => ({present: true, x: lerp(begin.x, end.x, factor), y: lerp(begin.y, end.y, factor),
  width: lerp(begin.width, end.width, factor), height: lerp(begin.height, end.height, factor), opacity: 1, scale_x: 1, scale_y: 1, visible: true});

// The scene a case starts from and the one it commits, and what each of the three nodes does between them.
function transition(spec) {
  const to = {...BASE, ...spec.to};
  const entities = [];
  if (to.box !== BASE.box) {
    entities.push("box");
  }
  if (to.child && !BASE.child) {
    entities.push("child");
  }
  if (!to.doomed && BASE.doomed) {
    entities.push("doomed");
  }
  return {from: BASE, to, entities};
}

function finalStates(to) {
  return {box: rested(POSES[to.box]), child: to.child ? rested(CHILD) : absent, doomed: to.doomed ? rested(DOOMED) : absent};
}

// LayoutAnimationKeyFrameManager.cpp:455-495, 575-620 and 1080-1152: a key frame interpolates its node from the start view to the final
// one by the factor of its curve. An update moves the layout; a create starts at opacity 0 or scale 0; a delete ends at opacity 0
// or scale 0 (and is removed with the animation).
function entityState(entity, factor, config, from, to) {
  if (entity === "box") {
    return box(POSES[from.box], POSES[to.box], factor);
  }
  const state = rested(entity === "child" ? CHILD : DOOMED);
  const [begin, end] = entity === "child" ? [0, 1] : [1, 0];
  if (config.property === "opacity") {
    state.opacity = lerp(begin, end, factor);
  }
  if (scalesX(config.property)) {
    state.scale_x = lerp(begin, end, factor);
  }
  if (scalesY(config.property)) {
    state.scale_y = lerp(begin, end, factor);
  }
  // A scale of 0 collapses the View, which RN draws and hits nowhere: the host hides it.
  state.visible = state.scale_x !== 0 && state.scale_y !== 0;
  return state;
}

// An animation in flight: when it started, what it animates and between which scenes. Its states at a clock RN read, and whether
// that clock is past the end of every key frame (LayoutAnimationDriver.cpp:56-80 counts the ones whose progress is below 1).
function animationAt(animation, clock) {
  const states = {...animation.base};
  let finished = true;
  for (const entity of animation.entities) {
    const config = animation.config[KIND[entity]];
    const [linear, factor] = animationProgress(clock, animation.start, config);
    finished = finished && linear >= 1;
    states[entity] = entityState(entity, factor, config, animation.from, animation.to);
  }
  return finished ? {states: {...states, ...finalStates(animation.to)}, finished} : {states, finished};
}

function compare(actual, expected, label, errors) {
  assert.equal(actual.present, expected.present, `${label}: present`);
  if (!expected.present) {
    return;
  }
  for (const key of ["x", "y", "width", "height"]) {
    const error = Math.abs(actual[key] - expected[key]);
    errors.position = Math.max(errors.position, error);
    assert.ok(error <= POSITION_TOLERANCE, `${label}: ${key} ${actual[key]}, RN's curve gives ${expected[key]}`);
  }
  assert.equal(actual.visible, expected.visible, `${label}: visible`);
  for (const [key, group] of [["opacity", "opacity"], ["scale_x", "scale"], ["scale_y", "scale"]]) {
    // A collapsed View is hidden, whatever scale the Control keeps.
    if (!expected.visible && group === "scale") {
      continue;
    }
    const error = Math.abs(actual[key] - expected[key]);
    errors[group] = Math.max(errors[group], error);
    assert.ok(error <= UNIT_TOLERANCE, `${label}: ${key} ${actual[key]}, RN's curve gives ${expected[key]}`);
  }
}

function pullsOf(report, request, final) {
  const found = [];
  for (let sequence = request.pullsTotal + 1; sequence <= final.pullsTotal; sequence += 1) {
    const pull = report.pullBySequence.get(sequence);
    assert.ok(pull, `The transaction ${sequence} the driver served is in the report`);
    found.push(pull);
  }
  return found;
}

// Every transaction the driver served: numbered without a gap, the clock RN read is the frame time in whole milliseconds, and it
// never goes back.
function verifyPulls(report) {
  const ordered = [...report.pulls].sort((a, b) => a.sequence - b.sequence);
  ordered.forEach((pull, index) => assert.equal(pull.sequence, index + 1, "The driver's transactions are numbered without a gap"));
  let clock = 0;
  let frame = 0;
  for (const pull of ordered) {
    assert.equal(pull.clockMs, Math.floor(pull.frameMs), `Transaction ${pull.sequence}: RN reads the frame time in whole milliseconds`);
    assert.ok(pull.clockMs >= clock && pull.frameMs >= frame, `Transaction ${pull.sequence}: the clock never goes back`);
    clock = pull.clockMs;
    frame = pull.frameMs;
  }
}

// The rows of a run, frame by frame: a tick needs an animation in flight when the frame began, is a tick of the frame clock and carries
// its timestamp; the Controls change only in a frame that applied a transaction, and the transactions belong to the Godot frames
// between the two samples. simulate(pull, row) is called for every transaction in order, with the row that shows it (the one in
// which it is the last) or null when a later transaction of the same frame replaced it.
function verifyRows(report, stage, label, simulate) {
  let previous = stage.request;
  for (const row of stage.rows) {
    const ticked = row.ticks - previous.ticks;
    assert.ok(ticked === 0 || ticked === 1, `${label}: the driver ticks at most once per frame`);
    if (ticked === 1) {
      assert.ok(previous.active, `${label}: a tick needs an animation in flight when the frame began`);
      assert.ok(row.frameTicks - previous.frameTicks >= 1, `${label}: each tick of the driver is a tick of the frame clock`);
      assert.equal(row.lastClockMs, row.frameLastTickMs, `${label}: the driver's clock is the frame clock's tick timestamp`);
    }
    assert.ok(row.lastClockMs >= previous.lastClockMs, `${label}: the driver's clock never goes back`);
    if (row.pullsTotal === previous.pullsTotal) {
      assert.deepEqual(row.controls, previous.controls, `${label}: the Controls change only in a frame that applied a transaction`);
    }
    for (let sequence = previous.pullsTotal + 1; sequence <= row.pullsTotal; sequence += 1) {
      const pull = report.pullBySequence.get(sequence);
      assert.ok(pull.godotFrame >= previous.n - 1 && pull.godotFrame <= row.n - 1, `${label}: the transaction belongs to the Godot frames between the samples`);
      simulate(pull, sequence === row.pullsTotal ? row : null);
    }
    previous = row;
  }
}

function verifyFinalLayout(stage, pose, label, layoutChanged) {
  const node = stage.nodes["la-box"];
  for (const [key, fabric] of [["x", "fabricX"], ["y", "fabricY"], ["width", "fabricWidth"], ["height", "fabricHeight"]]) {
    assert.ok(Math.abs(node[fabric] - pose[key]) <= POSITION_TOLERANCE, `${label}: fabric ${key} is the committed layout`);
    assert.ok(Math.abs(stage.final.controls.box[key] - pose[key]) <= 1e-4, `${label}: the Control ends exactly at the committed layout`);
  }
  // onLayout fires with the commit, for the layout the commit changed, and never with a frame of the animation.
  const layouts = stage.events.filter(event => event.kind === "layout" && event.id === "box");
  assert.equal(layouts.length > 0, layoutChanged, `${label}: onLayout reports the commit's layout change`);
  if (layoutChanged) {
    assert.deepEqual(layouts.at(-1).layout, pose, `${label}: onLayout is the committed layout, not a frame of the animation`);
  }
  assert.ok(Math.abs(stage.measure.rect.x - pose.x) <= POSITION_TOLERANCE && Math.abs(stage.measure.rect.width - pose.width) <= POSITION_TOLERANCE,
    `${label}: getBoundingClientRect is the committed layout`);
  assert.ok(Math.abs(stage.measure.measure.width - pose.width) <= POSITION_TOLERANCE && Math.abs(stage.measure.measure.height - pose.height) <= POSITION_TOLERANCE,
    `${label}: measure is the committed layout`);
}

// How RN's JS timer ended: the timer RN armed for this configureNext, with the delay RN gives it.
function verifyRace(stage, name, spec, eff, ends, entities) {
  const races = stage.races.filter(race => race.label === name);
  if (spec.via === "legacy") {
    assert.equal(races.length, 0, `${name}: the legacy call has no JS timer`);
    return;
  }
  assert.equal(races.length, 1, `${name}: configureNext arms one JS timer`);
  assert.equal(races[0].delay, spec.config.duration + RACE_MS, `${name}: the timer is armed at duration + 17 ms`);
  assert.ok(["cleared", "fired"].includes(races[0].state), `${name}: the timer ended`);
  assert.equal(ends[0].race, races[0].state, `${name}: the callback saw the timer as the end of the call left it`);
  if (spec.separated) {
    const longest = Math.max(...entities.map(entity => eff[KIND[entity]].delay + eff[KIND[entity]].duration));
    assert.ok(eff.duration >= longest + 1000, `${name}: the timer is far behind the longest animation`);
    assert.equal(races[0].state, "cleared", `${name}: only the driver can have ended the call, and it cleared RN's timer`);
  }
}

function verifyAnimated(report, name, errors) {
  const spec = CASES[name];
  const stage = report.stages[name];
  const eff = parseLayoutAnimationConfig(spec.config);
  assert.ok(eff, `${name}: RN's driver accepts the config`);
  const {from, to, entities} = transition(spec);
  assert.deepEqual(entities, spec.entities, `${name}: the nodes the scene change animates`);
  const configures = stage.events.filter(event => event.kind === "configure");
  assert.equal(configures.length, 1, `${name}: one configureNext`);
  assert.equal(configures[0].via, spec.via);
  assert.deepEqual(configures[0].config, spec.config, `${name}: the config RN's helpers built`);
  assert.ok(stage.request.enabled && !stage.request.active, `${name}: the driver is installed and idle before the commit`);
  const pulls = pullsOf(report, stage.request, stage.final);
  assert.ok(pulls.length >= 3, `${name}: the driver served the start, at least one frame between, and the end`);
  // The first transaction is the commit's: it starts the animation, so the time it reads is the one the animation counts from.
  const animation = {start: pulls[0].clockMs, entities, config: eff, from, to, base: {box: rested(POSES[from.box]), child: absent, doomed: rested(DOOMED)}};
  const created = entities.includes("child") ? 1 : 0;
  const deleted = entities.includes("doomed") ? 1 : 0;
  const finalUpdates = (entities.includes("box") ? 1 : 0) + created;
  let last = null;
  verifyRows(report, stage, name, (pull, row) => {
    assert.equal(last, null, `${name}: no transaction after the animation's last`);
    const expected = animationAt(animation, pull.clockMs);
    // LayoutAnimationDriver.cpp:17-115: one update per key frame in every transaction; the commit's creates and inserts at once; with
    // the last, the removes and deletes of the delete key frames and a final update for the update key frames (their final mutation)
    // and the create ones (the synthetic one for a key frame that has none: LayoutAnimationKeyFrameManager.cpp:1207-1250).
    const first = pull.sequence === pulls[0].sequence;
    assert.equal(pull.creates, first ? created : 0, `${name}: creates of transaction ${pull.sequence}`);
    assert.equal(pull.inserts, first ? created : 0, `${name}: inserts of transaction ${pull.sequence}`);
    assert.equal(pull.updates, entities.length + (expected.finished ? finalUpdates : 0), `${name}: updates of transaction ${pull.sequence}`);
    assert.equal(pull.removes, expected.finished ? deleted : 0, `${name}: removes of transaction ${pull.sequence}`);
    assert.equal(pull.deletes, expected.finished ? deleted : 0, `${name}: deletes of transaction ${pull.sequence}`);
    assert.equal(pull.active, !expected.finished, `${name}: the driver is in flight until the last transaction`);
    if (row !== null) {
      for (const id of IDS) {
        compare(row.controls[id], expected.states[id], `${name}: transaction ${pull.sequence} ${id}`, errors);
      }
    }
    if (expected.finished) {
      assert.equal(pull.sequence, pulls.at(-1).sequence, `${name}: the animation's last transaction is the last the driver served`);
      last = pull;
    }
  });
  assert.equal(last?.sequence, pulls.at(-1).sequence, `${name}: the animation reached its end`);
  for (const id of IDS) {
    compare(stage.final.controls[id], finalStates(to)[id], `${name}: at rest ${id}`, errors);
  }
  verifyFinalLayout(stage, POSES[to.box], name, entities.includes("box"));
  // The driver's counters: one animation, one success callback, queued by the last transaction, and nothing in flight after.
  const delta = key => stage.final[key] - stage.request[key];
  assert.equal(delta("started"), 1, `${name}: one animation started`);
  assert.equal(delta("completed"), 1, `${name}: one animation completed`);
  assert.equal(delta("callbacks"), 1, `${name}: one success callback queued`);
  assert.equal(last.callbacks - stage.request.callbacks, 1, `${name}: the last transaction queued it`);
  assert.equal(pulls.slice(0, -1).filter(pull => pull.callbacks !== stage.request.callbacks).length, 0, `${name}: no earlier transaction queued a callback`);
  assert.equal(stage.final.active, false);
  // The first transaction was pulled by the commit, every other by a tick of the frame clock, and only by it.
  assert.equal(delta("ticks"), pulls.length - 1, `${name}: every transaction after the first is one tick`);
  assert.equal(delta("frameTicks"), delta("ticks"), `${name}: the frame clock ticks for the driver alone`);
  // RN's callbacks: onAnimationDidEnd once, after the animation's last transaction when the driver ended the call.
  const ends = stage.events.filter(event => event.kind === "end" && event.label === name);
  assert.equal(ends.length, 1, `${name}: onAnimationDidEnd exactly once`);
  assert.equal(stage.events.filter(event => event.kind === "fail").length, 0, `${name}: no failure callback`);
  assert.deepEqual(ends[0].scene, to, `${name}: the callback saw the final scene mounted`);
  verifyRace(stage, name, spec, eff, ends, entities);
  if (spec.separated || spec.via === "legacy") {
    const lastRow = stage.rows.find(row => row.pullsTotal >= last.sequence);
    assert.ok(ends[0].n >= lastRow.n, `${name}: the callback follows the animation's last transaction`);
  }
}

function verifyFail(report) {
  const stage = report.stages.fail;
  const spec = CASES.fail;
  assert.equal(parseLayoutAnimationConfig(spec.config), null, "RN's driver rejects the config");
  const delta = key => stage.final[key] - stage.request[key];
  assert.ok(stage.request.enabled, "fail: the driver is installed");
  assert.equal(stage.events.filter(event => event.kind === "fail").length, 1, "fail: onAnimationDidFail exactly once");
  assert.equal(delta("callbacks"), 1, "fail: the failure callback went through the driver's executor");
  assert.equal(delta("started"), 0, "fail: no animation started");
  assert.equal(delta("completed"), 0);
  assert.equal(delta("pullsTotal"), 0, "fail: the driver served no transaction");
  assert.equal(delta("ticks"), 0);
  const xs = stage.rows.map(row => row.controls.box.x);
  assert.ok(xs.filter((x, index) => index > 0 && x !== xs[index - 1]).length <= 1, "fail: the box takes the committed layout in one step");
  assert.equal(stage.final.controls.box.x, POSES.b.x, "fail: the committed layout is on the Control");
  const ends = stage.events.filter(event => event.kind === "end");
  assert.equal(ends.length, 1, "fail: RN's timer ends the call once");
  assert.equal(ends[0].race, "fired", "fail: the timer is what ended it");
}

function verifyFlag(report) {
  const stage = report.stages.flag;
  const delta = key => stage.final[key] - stage.request[key];
  assert.ok(stage.request.enabled, "flag: the driver is installed");
  const flags = stage.events.filter(event => event.kind === "flag");
  assert.equal(flags.length, 1);
  assert.equal(flags[0].threw, false, "flag: the legacy flag does not throw");
  for (const key of ["started", "completed", "callbacks", "pullsTotal", "ticks", "clockReads"]) {
    assert.equal(delta(key), 0, `flag: ${key} did not move`);
  }
  const xs = stage.rows.map(row => row.controls.box.x);
  assert.ok(xs.filter((x, index) => index > 0 && x !== xs[index - 1]).length <= 1, "flag: the commit is not animated");
  assert.equal(stage.final.controls.box.x, POSES.b.x);
}

// A second configureNext and its commit while the first animation runs. LayoutAnimationKeyFrameManager.cpp:236 and :1483-1578 erase the key
// frame of the node the new commit touches, so the first animation completes at that transaction (its callback is queued) and the
// new key frame starts from the view the first one last put on screen (viewPrev), counting from the clock of that transaction.
function verifyInterrupt(report, errors) {
  const stage = report.stages.interrupt;
  const first = CASES["interrupt-first"];
  const second = CASES["interrupt-second"];
  const firstConfig = parseLayoutAnimationConfig(first.config).update;
  const secondConfig = parseLayoutAnimationConfig(second.config).update;
  assert.ok(firstConfig && secondConfig);
  const configures = stage.events.filter(event => event.kind === "configure");
  assert.deepEqual(configures.map(event => event.label), ["interrupt-first", "interrupt-second"]);
  assert.deepEqual(configures.map(event => event.config), [first.config, second.config]);
  assert.ok(stage.midway && stage.request.enabled && !stage.request.active, "interrupt: the second commit came while the first animation was in flight");
  const pulls = pullsOf(report, stage.request, stage.final);
  const secondStart = pulls.find(pull => pull.sequence > stage.second.pullsTotal && pull.callbacks > stage.second.callbacks);
  assert.ok(secondStart, "interrupt: the driver served the second commit and queued the first animation's callback");
  const firstStart = pulls[0].clockMs;
  const others = {child: absent, doomed: rested(DOOMED)};
  let shown = null;
  let begin = null;
  let secondClock = null;
  let ended = false;
  verifyRows(report, stage, "interrupt", (pull, row) => {
    assert.ok(!ended, "interrupt: no transaction after the end");
    if (pull.sequence === secondStart.sequence) {
      secondClock = pull.clockMs;
      begin = shown;
    }
    let expected;
    if (secondClock === null) {
      const [linear, factor] = animationProgress(pull.clockMs, firstStart, firstConfig);
      assert.ok(linear < 1, "interrupt: the second commit came before the first animation ended");
      expected = box(POSES.a, POSES.b, factor);
    } else {
      const [linear, factor] = animationProgress(pull.clockMs, secondClock, secondConfig);
      expected = linear >= 1 ? rested(POSES.c) : box(begin, POSES.c, factor);
      ended = linear >= 1;
    }
    shown = expected;
    if (row !== null) {
      for (const id of IDS) {
        compare(row.controls[id], id === "box" ? expected : others[id], `interrupt: transaction ${pull.sequence} ${id}`, errors);
      }
    }
  });
  assert.ok(ended, "interrupt: the second animation reached its end");
  assert.equal(pulls.at(-1).active, false);
  compare(stage.final.controls.box, rested(POSES.c), "interrupt: at rest", errors);
  verifyFinalLayout(stage, POSES.c, "interrupt", true);
  const delta = key => stage.final[key] - stage.request[key];
  assert.equal(delta("started"), 1, "interrupt: the second animation joins the one in flight, which started once");
  assert.equal(delta("completed"), 1);
  assert.equal(delta("callbacks"), 2, "interrupt: both success callbacks went through the driver's executor");
  assert.equal(secondStart.callbacks - stage.second.callbacks, 1, "interrupt: the first animation's callback was queued by the second commit's transaction");
  assert.equal(delta("ticks"), pulls.length - 2, "interrupt: every transaction but the two commits' is one tick");
  assert.equal(delta("frameTicks"), delta("ticks"));
  const ends = stage.events.filter(event => event.kind === "end");
  assert.deepEqual(ends.map(event => event.label), ["interrupt-first", "interrupt-second"], "interrupt: both callbacks, in order, once");
  assert.ok(ends.every(event => event.race === "cleared"), "interrupt: the driver ended both calls before RN's timers");
}

// Idle, nothing consumes frames: the frame clock and the driver do not tick, the driver pulls nothing, and its clock moves forward.
function verifyIdle(stage, label) {
  let previous = stage.request;
  for (const row of stage.rows) {
    assert.equal(row.ticks, stage.request.ticks, `${label}: the driver never ticks idle`);
    assert.equal(row.frameTicks, stage.request.frameTicks, `${label}: the frame clock never ticks idle`);
    assert.equal(row.pullsTotal, stage.request.pullsTotal, `${label}: the driver pulls nothing idle`);
    assert.equal(row.active, false);
    assert.ok(row.lastClockMs >= previous.lastClockMs, `${label}: the driver's clock never goes back`);
    previous = row;
  }
  assert.ok(stage.rows.at(-1).lastClockMs > stage.request.lastClockMs, `${label}: the driver's clock moves with the host's frames`);
}

function verifyStop(report) {
  const stage = report.stages.stop;
  assert.equal(stage.stopped, true, "stop: the application stopped");
  assert.equal(stage.after.stopped, true, "stop: the driver stopped with it");
  assert.equal(stage.after.active, false);
  assert.ok(stage.before.ticks >= 1 && stage.before.pullsTotal >= 3, "stop: an animation was in flight");
  for (const key of ["ticks", "pullsTotal", "started", "completed", "callbacksQueued"]) {
    assert.equal(stage.after[key], stage.before[key], `stop: ${key} did not move after the stop`);
  }
  assert.deepEqual(stage.errors, [], "stop: no error");
}

// The independent verdict on a report of the current host. Throws on the first number RN's formulas do not give. Returns the largest
// distances to the oracle's expectations.
export function verifyLayoutAnimationReport(report) {
  assert.equal(report.scenario, "layout-animation");
  const indexed = {...report, pullBySequence: new Map(report.pulls.map(pull => [pull.sequence, pull]))};
  const errors = {position: 0, opacity: 0, scale: 0};
  const mount = report.stages.mount;
  assert.equal(mount.state.enabled, true, "The driver is installed");
  assert.deepEqual([mount.state.started, mount.state.completed, mount.state.callbacksQueued, mount.state.ticks, mount.state.pullsTotal, mount.state.clockReads],
    [0, 0, 0, 0, 0, 0], "The driver idles before any animation");
  verifyPulls(indexed);
  verifyIdle(report.stages["idle-start"], "idle-start");
  for (const name of ["native-end", "update-linear", "update-ease", "update-spring", "create-opacity", "create-scale", "delete-opacity",
    "delete-scale", "mixed", "legacy"]) {
    verifyAnimated(indexed, name, errors);
  }
  verifyFail(indexed);
  verifyFlag(indexed);
  verifyInterrupt(indexed, errors);
  verifyIdle(report.stages["idle-end"], "idle-end");
  verifyStop(indexed);
  // The spring overshoots: some frame is beyond the final layout, which only the oracle's curve (and not the probe) says should be.
  const spring = report.stages["update-spring"].rows.map(row => row.controls.box.x);
  assert.ok(spring.some(x => x > POSES.b.x + 0.5), "The spring's curve takes the box beyond its final layout");
  return {maximumErrorsAgainstTheOracle: errors, transactions: report.pulls.length};
}
