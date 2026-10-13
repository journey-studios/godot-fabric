import {handlerCalls, logged, polyfillHandler} from "./js-errors-early";
import React from "react";
import {AppRegistry, View} from "react-native";
import VendorErrorUtils from "react-native/Libraries/vendor/core/ErrorUtils";
import {earlyCases, errorGlobals, messages, normalPriority, readyCases, runSteps, scenarios} from "./js-errors-cases.mjs";

// Records what JS observes of RN's error path in three scenarios (godotScenario, set by the application's meta): the ready lane (the
// default) mounts a root and lets the probe run each case of the list, the early lane reports errors while the bundle is still being
// evaluated, and the escape lane lets an error escape the evaluation. It holds no expectation: the Godot probe judges what it reports and
// tests/js-errors-oracle.mjs re-derives each verdict from RN's sources and from RN's own JavaScript run in V8.
// js-errors-early.js is imported first, so it is the first of this bundle's modules to run.
function JsErrorsApp() {
  return <View style={{flex: 1}} />;
}
AppRegistry.registerComponent("JsErrorsApp", () => JsErrorsApp);

// What a call did: it returned (with the value) or threw (with the message).
function attempt(callback) {
  try {
    return {threw: false, value: callback() ?? null};
  } catch (error) {
    return {threw: true, error: String(error?.message ?? error)};
  }
}

function descriptorOf(object, name) {
  const descriptor = Object.getOwnPropertyDescriptor(object, name);
  return descriptor === undefined ? null : {writable: descriptor.writable ?? null, enumerable: descriptor.enumerable, configurable: descriptor.configurable};
}

// The ExceptionsManager module's JS wrapper (Libraries/Core/NativeExceptionsManager.js) is what RN's ExceptionsManager.js reports to.
// Its reportException is wrapped to record each report, then delegates to the original (which asks the native module). The module is
// loaded here with a guarded require: on a host without the ExceptionsManager module it throws, and the probe wants to see that and not
// lose the whole bundle.
const reports = [];
let native = null;
let nativeError = null;
try {
  native = require("react-native/Libraries/Core/NativeExceptionsManager").default;
} catch (error) {
  nativeError = String(error?.message ?? error);
}
if (native !== null && typeof native.reportException === "function") {
  const original = native.reportException;
  native.reportException = function reportException(data) {
    reports.push({
      message: data.message, originalMessage: data.originalMessage ?? null, name: data.name ?? null, componentStack: data.componentStack ?? null,
      isFatal: data.isFatal, id: data.id, stack: (data.stack ?? []).map(frame => ({methodName: frame.methodName, file: frame.file ?? null,
        lineNumber: frame.lineNumber ?? null, column: frame.column ?? null})),
      extraData: Object.keys(data.extraData ?? {}).sort(),
    });
    return original.call(this, data);
  };
}

const makeError = text => new Error(text);
function caseEnvironment() {
  return {console, ErrorUtils: globalThis.ErrorUtils, native, makeError, observed: {},
    RN$handleException: globalThis.RN$handleException, RN$inExceptionHandler: globalThis.RN$inExceptionHandler,
    RN$isRuntimeReady: globalThis.RN$isRuntimeReady, RN$registerExceptionListener: globalThis.RN$registerExceptionListener};
}

// One case: what its steps did, the reports the module's JS wrapper received, the lines the console sent the host's hook.
function runCase(testCase) {
  const reportStart = reports.length;
  const loggedStart = logged.length;
  const env = caseEnvironment();
  const steps = runSteps(testCase, env);
  return {name: testCase.name, steps, observed: env.observed, reports: reports.slice(reportStart), logged: logged.slice(loggedStart)};
}

const scenario = globalThis.godotScenario;
if (scenario === scenarios.early) {
  // The bundle is still being evaluated, so the runtime is not ready: RN$handleException takes the error into C++ (JsErrorHandler's own
  // pipeline). A listener registered first sees every error, and the one whose message says "prevented" stops it.
  const seen = [];
  const registered = attempt(() => globalThis.RN$registerExceptionListener(data => {
    seen.push({message: data.message, originalMessage: data.originalMessage ?? null, name: data.name ?? null, isFatal: data.isFatal, id: data.id,
      stack: data.stack.length, preventDefault: typeof data.preventDefault, inHandler: globalThis.RN$inExceptionHandler(),
      extraData: Object.keys(data.extraData ?? {}).sort(), isComponentError: data.isComponentError});
    if (data.message.includes("prevented")) {
      data.preventDefault();
    }
  }));
  const cases = earlyCases.map(testCase => {
    const seenStart = seen.length;
    return {...runCase(testCase), seen: seen.slice(seenStart)};
  });
  globalThis.JsErrorsEarlyLane = {registered, cases, inHandlerAfter: attempt(() => globalThis.RN$inExceptionHandler())};
}
if (scenario === scenarios.escape) {
  // Outside every guard: the evaluation of the bundle throws. JsErrorHandler reports it while the runtime is not ready.
  throw new Error(messages.escaped);
}

const task = {scheduled: false, done: false, reportsWhenDone: null};

// The ExceptionsManager module and ErrorUtils as the bundle has them once it has been evaluated.
function environment() {
  const errorUtils = globalThis.ErrorUtils;
  const names = typeof errorUtils === "object" && errorUtils !== null ? Object.getOwnPropertyNames(errorUtils).sort() : [];
  const handler = typeof errorUtils === "object" && errorUtils !== null ? errorUtils.getGlobalHandler() : null;
  const consoleObject = typeof console === "object" && console !== null ? console : {};
  return {
    scenario,
    errorUtils: {type: typeof errorUtils, names, kinds: Object.fromEntries(names.map(name => [name, typeof errorUtils[name]])),
      sameAsVendor: errorUtils === VendorErrorUtils, descriptor: descriptorOf(globalThis, "ErrorUtils")},
    handler: {type: typeof handler, name: handler?.name ?? null, length: handler?.length ?? null, setCalls: handlerCalls.length,
      isTheOneSet: handler !== null && handlerCalls.length === 1 && handler === handlerCalls[0],
      isThePolyfillDefault: handler === polyfillHandler},
    console: {errorOriginal: typeof consoleObject._errorOriginal, errorIsOriginal: consoleObject.error === consoleObject._errorOriginal,
      errorName: consoleObject.error?.name ?? null, errorOriginalDescriptor: descriptorOf(consoleObject, "_errorOriginal")},
    globals: Object.fromEntries(errorGlobals.map(name => [name, {type: typeof globalThis[name], descriptor: descriptorOf(globalThis, name)}])),
    native: {loaded: native !== null, error: nativeError, members: native === null ? [] : Object.keys(native).sort(),
      kinds: native === null ? {} : Object.fromEntries(Object.keys(native).map(name => [name, typeof native[name]]))},
    hermes: typeof HermesInternal,
  };
}

globalThis.JsErrorsProbe = {
  caseNames: readyCases.map(testCase => testCase.name),
  environment,
  runCase(name) {
    const testCase = readyCases.find(entry => entry.name === name);
    return testCase === undefined ? null : runCase(testCase);
  },
  // An exception that escapes a task of RN's RuntimeScheduler. The second task follows the first in the queue: that it ran says the
  // first has been handled.
  scheduleTask() {
    const scheduler = globalThis.nativeRuntimeScheduler;
    const start = reports.length;
    const loggedStart = logged.length;
    task.scheduled = true;
    scheduler.unstable_scheduleCallback(normalPriority, () => {
      throw new Error(messages.task);
    });
    scheduler.unstable_scheduleCallback(normalPriority, () => {
      task.done = true;
      task.result = {reports: reports.slice(start), logged: logged.slice(loggedStart)};
    });
    return true;
  },
  taskState() {
    return {scheduled: task.scheduled, done: task.done, result: task.result ?? null};
  },
};
