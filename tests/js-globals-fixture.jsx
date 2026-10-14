import {logged} from "./js-globals-early";
import React from "react";
import {AppRegistry, View} from "react-native";
import {clockFrames, consoleCalls, domGlobals, materialize} from "./js-globals-cases.mjs";

// Records what JS observes of the environment RN's own setup modules build, and of the console RN's polyfill installs. It holds no
// expectation: the Godot probe judges what it reports and tests/js-globals-oracle.mjs re-derives each verdict from RN's sources.
// js-globals-early.js is imported first, so it is the first of this bundle's modules to run.
function JsGlobalsApp() {
  return <View style={{flex: 1}} />;
}
AppRegistry.registerComponent("JsGlobalsApp", () => JsGlobalsApp);

// What a call did: it returned (with the value and its type) or threw (with the message).
function attempt(callback) {
  try {
    const value = callback();
    return {threw: false, type: typeof value, value};
  } catch (error) {
    return {threw: true, error: String(error?.message ?? error)};
  }
}

function descriptorOf(object, name) {
  const descriptor = Object.getOwnPropertyDescriptor(object, name);
  return descriptor === undefined ? null : {
    writable: descriptor.writable ?? null,
    enumerable: descriptor.enumerable,
    configurable: descriptor.configurable,
    accessor: typeof descriptor.get === "function",
  };
}

// performance.now() between two reads of the host clock it is meant to read; null when there is no performance.now.
function sample() {
  const before = nativePerformanceNow();
  const now = typeof performance === "object" && performance !== null && typeof performance.now === "function" ? performance.now() : null;
  const after = nativePerformanceNow();
  return {before, now, after};
}

function environment() {
  const env = typeof process === "object" && process !== null ? process.env : undefined;
  // A variable, not process.env.NODE_ENV: the bundler substitutes that literal, and this reads what the run time holds.
  const key = "NODE_ENV";
  const lazy = {};
  for (const name of domGlobals) {
    lazy[name] = descriptorOf(globalThis, name)?.accessor === true;
  }
  const resolved = {};
  for (const name of domGlobals) {
    try {
      resolved[name] = typeof globalThis[name];
    } catch (error) {
      resolved[name] = "threw: " + String(error?.message ?? error);
    }
  }
  const dispatch = globalThis.RN$isNativeEventTargetEventDispatchingEnabled;
  const perf = typeof performance === "object" && performance !== null ? performance : null;
  const names = typeof console === "object" && console !== null ? Object.getOwnPropertyNames(console).sort() : [];
  return {
    global: globalThis.global === globalThis,
    dev: globalThis.__DEV__,
    window: {sameAsGlobal: globalThis.window === globalThis, descriptor: descriptorOf(globalThis, "window")},
    self: {sameAsGlobal: globalThis.self === globalThis},
    process: {type: typeof process, envType: typeof env, nodeEnv: env === undefined ? null : (env[key] ?? null)},
    navigator: {type: typeof navigator, product: globalThis.navigator?.product ?? null, descriptor: descriptorOf(globalThis, "navigator")},
    performance: perf === null ? {type: typeof performance, ownKeys: [], members: {}, calls: {}} : {
      type: "object",
      ownKeys: Object.keys(perf).sort(),
      members: Object.fromEntries(["now", "mark", "measure", "clearMarks", "clearMeasures"].map(name => [name, typeof perf[name]])),
      calls: {
        mark: attempt(() => perf.mark("js-globals-a")),
        measure: attempt(() => perf.measure("js-globals-m", "js-globals-a")),
        clearMarks: attempt(() => perf.clearMarks("js-globals-a")),
        clearMeasures: attempt(() => perf.clearMeasures("js-globals-m")),
      },
    },
    dom: {names: [...domGlobals], lazyBeforeUse: lazy, resolved},
    domDispatch: {type: typeof dispatch, result: typeof dispatch === "function" ? attempt(() => dispatch()) : null},
    console: {
      type: typeof console,
      names,
      kinds: Object.fromEntries(names.map(name => [name, typeof console[name]])),
      polyfilled: typeof console === "object" && console !== null && console._isPolyfilled === true,
      polyfilledDescriptor: typeof console === "object" && console !== null ? descriptorOf(console, "_isPolyfilled") : null,
      task: typeof console === "object" && console !== null && typeof console.createTask === "function"
        ? attempt(() => console.createTask("js-globals").run(() => 7)) : null,
    },
  };
}

// Every call of the shared scenario, in order: what console sent the host hook for it, and whether it threw.
function consoleScenario() {
  const perCall = [];
  for (const {method, args} of consoleCalls) {
    const start = logged.length;
    let threw = null;
    try {
      console[method](...args.map(arg => materialize(arg, text => new Error(text))));
    } catch (error) {
      threw = String(error?.message ?? error);
    }
    perCall.push({method, args, logged: logged.slice(start), threw});
  }
  return {perCall};
}

const frames = [];
let remaining = 0;
function onFrame() {
  frames.push(sample());
  remaining -= 1;
  if (remaining > 0) {
    requestAnimationFrame(onFrame);
  }
}

globalThis.JsGlobalsProbe = {
  clockFrames,
  environment,
  consoleScenario,
  sample,
  // One sample per frame, on the animation frames the host's frame clock delivers.
  startClock(count) {
    frames.length = 0;
    remaining = count;
    requestAnimationFrame(onFrame);
  },
  clock() {
    return frames.slice();
  },
};
