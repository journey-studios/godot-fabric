import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import vm from "node:vm";
import {transformSync} from "@babel/core";
import {ANIMATIONS} from "./native-animated-cases.mjs";
import {verifyJsValue} from "./native-animated-oracle.mjs";

// The oracle of the native Animated slice judges the JS spring against RN's own clock: a value is accepted when some elapsed time
// inside the window the stamps allow produces it. This lane replays RN 0.87.1's SpringAnimation.js (Flow stripped by Babel, nothing
// else changed) under a fake Date.now() and requestAnimationFrame, so that the runner's pace is whatever the case says, and feeds the
// events a fixture would have logged to the oracle. Hosted CI run 37938459369 (attempt 1) failed `js-spring value 7: 1.04321380853327`,
// the spring's value at exactly 314 ms, 0.16 ms before its first peak: the oracle sampled the window, and a window of a slow runner's
// frame (more than about 31 ms) steps over the peak. That never happens at 60 fps, which is why it passed locally.
const animated = fileURLToPath(new URL("../node_modules/react-native/Libraries/Animated/", import.meta.url));
const compile = file => transformSync(readFileSync(path.join(animated, file), "utf8"), {
  filename: path.join(animated, file), configFile: false, babelrc: false, presets: [["@react-native/babel-preset", {enableBabelRuntime: false}]],
}).code;
const sources = {spring: compile("animations/SpringAnimation.js"), config: compile("SpringConfig.js")};

// The members of Animation that the spring calls; its other imports are types.
class Animation {
  start(_from, _onUpdate, onEnd) {
    this._onEnd = onEnd;
    this.__active = true;
  }

  stop() {
    this.__active = false;
  }

  __startAnimationIfNative() {
    return false;
  }

  __notifyAnimationEnd(result) {
    const callback = this._onEnd;
    if (callback != null) {
      this._onEnd = null;
      callback(result);
    }
  }
}
const invariant = (condition, message) => {
  assert.ok(condition, message);
};

function load(code, world, modules) {
  const module = {exports: {}};
  const sandbox = {Date: {now: () => world.now}, requestAnimationFrame: callback => world.frames.push(callback), setTimeout, clearTimeout};
  vm.runInNewContext(`(function (require, module, exports) {${code}\n})`, sandbox)(id => modules[id], module, module.exports);
  return module.exports;
}

const config = ANIMATIONS["js-spring"];
const mix = (value, range, output) => {
  const t = (value - range[0]) / (range[1] - range[0]);
  return output[0] * (1 - t) + output[1] * t;
};
// What the fixture logs for a value of the spring, with the outputs RN's interpolation makes of it.
const outputs = value => ({value, opacity: mix(value, config.map.input, config.map.opacity), translateX: mix(value, config.map.input, config.map.translateX),
  rotate: `${mix(value, config.map.input, config.map.rotate)}deg`});

// The events the fixture logs for a JS spring on a bare value. `pace(step)` is the milliseconds between a step and the one before;
// `pause(step)` those the listener takes before it stamps. The spring may differ from the one the oracle recomputes.
function replay({pace, pause = () => 0, spring = {}}) {
  const world = {now: 1791645517000, frames: []};
  const settings = {stiffness: config.stiffness, damping: config.damping, mass: config.mass, ...spring};
  const springConfig = load(sources.config, world, {});
  const {default: Spring} = load(sources.spring, world, {"../nodes/AnimatedColor": {default: class {}, __esModule: true}, "../SpringConfig": springConfig,
    "./Animation": {default: Animation, __esModule: true}, invariant: {default: invariant, __esModule: true}});
  const events = [];
  let sequence = 0;
  let step = 0;
  let finished = false;
  const record = entry => events.push({sequence: ++sequence, t: world.now, ...entry});
  const onUpdate = value => {
    world.now += pause(step);
    record({kind: "value", label: "js-spring", ...outputs(value)});
  };
  const before = world.now;
  new Spring({toValue: config.to, ...settings, useNativeDriver: false}).start(config.from, onUpdate, result => {
    finished = result.finished;
    record({kind: "end", label: "js-spring", result});
  }, undefined, {});
  // RN's first step runs inside start(), so the value precedes the note of the start.
  events.splice(1, 0, {sequence: ++sequence, t: world.now, kind: "start", label: "js-spring", before, after: world.now});
  while (!finished) {
    step += 1;
    assert.ok(step < 5000 && world.frames.length > 0, "the spring comes to rest");
    world.now += pace(step);
    world.frames.shift()();
  }
  return {events};
}

// The pace of the failed run: seven frames 43 to 56 ms apart, the value of step 7 lands at 314 ms, then 45 ms frames.
const slow = [43, 43, 43, 43, 43, 43, 56];
const slowPace = step => slow[step - 1] ?? 45;
const valuesOf = stage => stage.events.filter(entry => entry.kind === "value");

test("the spring's value at 314 ms, 0.16 ms before its peak, is accepted on a slow runner's window", () => {
  const stage = replay({pace: slowPace});
  const start = stage.events.find(entry => entry.kind === "start");
  const value = valuesOf(stage)[7];
  assert.equal(value.t - start.before, 314);
  assert.equal(value.value, 1.043213808533273, "the value of the hosted failure");
  verifyJsValue("js-spring", stage);
});

test("RN's spring is accepted whatever the pace of the runner: slow, bursty or paused", () => {
  let state = 1;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const profiles = {
    steady: () => 15 + Math.floor(random() * 4),
    slow: () => 30 + Math.floor(random() * 30),
    bursty: () => (random() < 0.3 ? Math.floor(random() * 3) : 20 + Math.floor(random() * 50)),
    paused: () => (random() < 0.08 ? 70 + Math.floor(random() * 200) : 14 + Math.floor(random() * 25)),
  };
  for (const [name, pace] of Object.entries(profiles)) {
    for (let run = 0; run < 150; run++) {
      const stage = replay({pace, pause: () => (random() < 0.9 ? 0 : 1 + Math.floor(random() * 3))});
      assert.doesNotThrow(() => verifyJsValue("js-spring", stage), `${name} run ${run}`);
    }
  }
});

test("the oracle still rejects a spring that is not the one it recomputes, and a value that is off the curve", () => {
  for (const spring of [{stiffness: 220}, {stiffness: 180}, {damping: 18}, {damping: 22}, {mass: 1.1}]) {
    assert.throws(() => verifyJsValue("js-spring", replay({pace: slowPace, spring})), /js-spring value \d+/, JSON.stringify(spring));
  }
  // The window of step 7 holds the values from 1.024 up to the peak: below it, a step off by a fifth and a hair above the peak
  // are refused, so the turning point widens the window to the peak and no further.
  const peak = 1 + Math.exp(-Math.PI);
  for (const [index, wrong] of [[7, 1.01], [7, peak + 1e-6], [3, valuesOf(replay({pace: slowPace}))[3].value + 0.2]]) {
    const stage = replay({pace: slowPace});
    Object.assign(valuesOf(stage)[index], outputs(wrong));
    assert.throws(() => verifyJsValue("js-spring", stage), new RegExp(`js-spring value ${index}:`), `value ${index} = ${wrong}`);
  }
  // The peak itself, the highest value the spring takes, is accepted where a window holds it.
  const stage = replay({pace: slowPace});
  Object.assign(valuesOf(stage)[7], outputs(peak));
  verifyJsValue("js-spring", stage);
});
