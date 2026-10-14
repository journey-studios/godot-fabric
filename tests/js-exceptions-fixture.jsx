import React from "react";
import {AppRegistry, Pressable} from "react-native";
import {callbackOf, cases, laneOf, messageOf, stopTurn} from "./js-exceptions-cases.mjs";

// Records what JS observes of callback exceptions and of the microtask queue in one root (GF-05 slice F): which callbacks ran, in which order, and what each
// counter saw. It holds no expectation: the Godot probe judges what it reports, and tests/js-exceptions-oracle.mjs derives every verdict again from RN's sources
// and from a model of RN's event loop. The press handler runs the case the probe armed, in the host's real event path (a Godot mouse event, the input adapter,
// Fabric's event beat, a task of the RuntimeScheduler).
// js-exceptions-host.js runs first (the build injects it) and leaves what it recorded here.
const {logged} = globalThis.JsExceptionsHost;
const records = {};
const armed = {current: null};
const state = {presses: 0};

function JsExceptionsApp() {
  return <Pressable testID="pressable" style={{flex: 1}} onPress={onPress} />;
}
AppRegistry.registerComponent("JsExceptionsApp", () => JsExceptionsApp);

function onPress() {
  state.presses += 1;
  const run = armed.current;
  if (run === null) {
    return;
  }
  armed.current = null;
  run();
}

// The environment a case runs against: the globals at the time of each call, the journal and the counters of the case.
function environmentOf(record) {
  return {
    mark: label => record.journal.push({label, chains: {...record.chains}, logged: logged.length}),
    makeError: label => new Error(messageOf(record.name, label)),
    reportError: error => globalThis.ErrorUtils.reportError(error),
    chains: record.chains,
    finish: () => {
      record.done = true;
    },
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    setInterval: (callback, delay) => globalThis.setInterval(callback, delay),
    clearInterval: id => globalThis.clearInterval(id),
    requestAnimationFrame: callback => globalThis.requestAnimationFrame(callback),
    requestIdleCallback: callback => globalThis.requestIdleCallback(callback),
    setImmediate: callback => globalThis.setImmediate(callback),
    queueMicrotask: callback => globalThis.queueMicrotask(callback),
    Promise,
  };
}

function recordOf(name) {
  const record = {name, journal: [], chains: {}, done: false, entered: false, loggedBefore: logged.length};
  records[name] = record;
  return record;
}

// Enters a case the way its source says. An `evaluate` case runs now, inside the call that evaluates this expression; the others run when the host runs the
// callback that the source stands for.
function start(name) {
  const testCase = cases.find(entry => entry.name === name);
  if (testCase === undefined) {
    return null;
  }
  const record = recordOf(name);
  const run = callbackOf(testCase.body, environmentOf(record));
  const enter = () => {
    record.entered = true;
    run();
  };
  switch (testCase.source) {
    case "evaluate":
      enter();
      break;
    case "timer":
      globalThis.setTimeout(enter, 0);
      break;
    case "raf":
      globalThis.requestAnimationFrame(enter);
      break;
    case "press":
      armed.current = enter;
      break;
    default:
      throw new Error(`Unknown source ${testCase.source}`);
  }
  return {name, source: testCase.source};
}

// The microtasks pending when the application stops (the stop path drains them in one checkpoint). The probe calls this and then stops the application; the
// record is read afterwards.
function queueForStop() {
  const record = recordOf("stop");
  const environment = environmentOf(record);
  const run = callbackOf({label: "queued", throws: false, then: stopTurn}, environment);
  record.entered = true;
  run();
  return true;
}

// The positive control of the rejection tracker: Hermes can track an unhandled rejection, and tells whoever enables it. RN's bundle enables nothing, so the
// `promise` case, which ran before this, tracked nothing. Hermes' tracker is the one of the `promise` package: an unhandled rejection is reported after a timer
// (two seconds for an Error), a rejection that gets its handler before that is never reported, and one that gets it afterwards is reported as handled.
const tracked = {enabled: null, unhandled: [], handled: []};
const rejections = {};
function trackRejections() {
  try {
    HermesInternal.enablePromiseRejectionTracker({
      allRejections: true,
      onUnhandled: (id, rejection) => tracked.unhandled.push({id, message: String(rejection?.message ?? rejection)}),
      onHandled: id => tracked.handled.push({id}),
    });
    tracked.enabled = true;
  } catch (error) {
    tracked.enabled = false;
    tracked.error = String(error?.message ?? error);
    return tracked;
  }
  rejections.unhandled = Promise.reject(new Error("js-exceptions tracked/unhandled"));
  Promise.reject(new Error("js-exceptions tracked/handled")).catch(() => {});
  return tracked;
}
// The late handler of the first rejection, once it has been reported: the tracker says it was handled after all.
function handleTracked() {
  rejections.unhandled?.catch(() => {});
  return tracked;
}

function descriptorOf(object, name) {
  const descriptor = Object.getOwnPropertyDescriptor(object, name);
  return descriptor === undefined ? null : {writable: descriptor.writable ?? null, enumerable: descriptor.enumerable, configurable: descriptor.configurable};
}

globalThis.JsExceptionsProbe = {
  caseNames: cases.map(entry => entry.name),
  mainCaseNames: cases.filter(entry => laneOf(entry) === "main").map(entry => entry.name),
  start,
  queueForStop,
  trackRejections,
  handleTracked,
  tracked: () => tracked,
  record: name => records[name] ?? null,
  state: () => ({presses: state.presses, armed: armed.current !== null}),
  environment() {
    return {
      host: globalThis.JsExceptionsHost,
      hermes: typeof HermesInternal,
      trackerNow: {type: typeof HermesInternal?.enablePromiseRejectionTracker, hasPromise: typeof HermesInternal?.hasPromise === "function" ? HermesInternal.hasPromise() : null},
      // Hermes' Promise is a function of its internal bytecode; RN's polyfill (Libraries/Promise.js) would be JavaScript source.
      promiseIsHermes: typeof Promise === "function" && /\{ \[bytecode\] \}$/.test(Function.prototype.toString.call(Promise)),
      globals: Object.fromEntries(["queueMicrotask", "setImmediate", "setTimeout", "setInterval", "requestAnimationFrame", "requestIdleCallback", "reportError"].map(name => [name,
        {type: typeof globalThis[name], descriptor: descriptorOf(globalThis, name)}])),
      logged: logged.length,
    };
  },
  loggedSince: count => logged.slice(count),
};
