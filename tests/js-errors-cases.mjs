// What the fixture (in Hermes) and the oracle (in Node) both do, written once: the stimulus, never an expectation. The oracle derives what
// must come out from RN's own sources and from running RN's own JavaScript in V8, so nothing here says what an error report contains.

// A value in a step is JSON, except: {"$error": text, "props": {...}} for new Error(text) with those properties assigned,
// {"$thrower": text} for a function that throws new Error(text), and {"$guarded": text} for a function that records
// ErrorUtils.inGuard() and then throws new Error(text).
function materialize(value, env) {
  if (Array.isArray(value)) {
    return value.map(item => materialize(item, env));
  }
  if (value !== null && typeof value === "object") {
    if (typeof value.$error === "string") {
      return Object.assign(env.makeError(value.$error), value.props ?? {});
    }
    if (typeof value.$thrower === "string") {
      return () => {
        throw env.makeError(value.$thrower);
      };
    }
    if (typeof value.$guarded === "string") {
      return () => {
        env.observed.inGuard = env.ErrorUtils.inGuard();
        throw env.makeError(value.$guarded);
      };
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, materialize(item, env)]));
  }
  return value;
}

// The fatal exceptions the ready lane makes, in order. The host records exactly these as failures, with the message RN composed
// (the name, then the message) followed by the parsed stack.
export const messages = {
  consoleString: "js-errors console string",
  consoleError: "js-errors console error object",
  consoleMulti: "js-errors",
  warning: "Warning: js-errors react warning",
  reportError: "js-errors ErrorUtils.reportError",
  reportErrorString: "js-errors ErrorUtils.reportError string",
  guarded: "js-errors applyWithGuard",
  fatalError: "js-errors reportFatalError",
  fatalString: "js-errors thrown string",
  task: "js-errors scheduler task",
  readyDirect: "js-errors ready direct",
  deprecatedSoft: "js-errors deprecated reportSoftException",
  direct: "js-errors direct reportException",
  earlySoft: "js-errors early soft",
  earlyPrevented: "js-errors early prevented",
  earlyWarn: "js-errors early warn",
  earlyFatal: "js-errors early fatal",
  earlyFatalAgain: "js-errors early fatal again",
  earlyDirect: "js-errors early direct",
  escaped: "js-errors escaped the bundle",
};

const frame = {methodName: "caseFrame", file: "js-errors-case.js", lineNumber: 3, column: 4};

// Each case is a list of steps: {call: "object.method", args, record}. object is console, ErrorUtils or native (the JS wrapper of the
// ExceptionsManager module), or absent for a global function (RN$handleException); record keeps the return value. A step that throws
// is recorded as having thrown. A case with `host: true` calls what the C++ host installs, which RN's JS alone cannot run.
export const readyCases = [
  {name: "console-string", steps: [{call: "console.error", args: [messages.consoleString]}]},
  {name: "console-error", steps: [{call: "console.error", args: [{$error: messages.consoleError}]}]},
  {name: "console-multi", steps: [{call: "console.error", args: [messages.consoleMulti, 7, {a: 1}]}]},
  {name: "console-warning", steps: [{call: "console.error", args: [messages.warning]}]},
  {name: "report-error", steps: [{call: "ErrorUtils.reportError", args: [{$error: messages.reportError}]}]},
  {name: "report-error-string", steps: [{call: "ErrorUtils.reportError", args: [messages.reportErrorString]}]},
  {name: "guard", steps: [
    {call: "ErrorUtils.inGuard", args: [], record: true},
    {call: "ErrorUtils.applyWithGuard", args: [{$guarded: messages.guarded}], record: true},
    {call: "ErrorUtils.inGuard", args: [], record: true},
  ]},
  {name: "fatal-error", steps: [{call: "ErrorUtils.reportFatalError", args: [{$error: messages.fatalError}]}]},
  {name: "fatal-string", steps: [{call: "ErrorUtils.reportFatalError", args: [messages.fatalString]}]},
  {name: "deprecated-soft", steps: [{call: "native.reportSoftException", args: [messages.deprecatedSoft, [frame], 42]}]},
  {name: "direct", steps: [
    {call: "native.reportException", args: [{message: messages.direct, originalMessage: null, name: null, componentStack: null, stack: [frame], id: 43,
      isFatal: false}]},
    {call: "native.dismissRedbox", args: [], record: true},
  ]},
  // The runtime is ready after the bundle: with the flag at its default RN$handleException hands the error back to JS (false), nothing
  // is in the middle of reporting, and RN$isRuntimeReady says the runtime is ready.
  {name: "handle-ready", host: true, steps: [
    {call: "RN$handleException", args: [{$error: messages.readyDirect}, false, false], record: true},
    {call: "RN$inExceptionHandler", args: [], record: true},
    {call: "RN$isRuntimeReady", args: [], record: true},
  ]},
  // The calls ReactInstance rejects before it looks at the error.
  {name: "arguments", host: true, steps: [
    {call: "RN$handleException", args: [{$error: messages.readyDirect}]},
    {call: "RN$registerExceptionListener", args: []},
    {call: "RN$registerExceptionListener", args: [1]},
  ]},
];

// The calls the early lane makes while the bundle is still evaluating, before the runtime is ready. A listener registered first
// sees each of them; the one whose message contains "prevented" calls preventDefault.
export const earlyCases = [
  {name: "soft", steps: [{call: "ErrorUtils.reportError", args: [{$error: messages.earlySoft}]}]},
  {name: "prevented", steps: [{call: "ErrorUtils.reportError", args: [{$error: messages.earlyPrevented}]}]},
  {name: "warn", steps: [{call: "ErrorUtils.reportError", args: [{$error: messages.earlyWarn, props: {type: "warn"}}]}]},
  {name: "direct", steps: [{call: "RN$handleException", args: [{$error: messages.earlyDirect}, false, false], record: true}]},
  {name: "fatal", steps: [{call: "ErrorUtils.reportFatalError", args: [{$error: messages.earlyFatal}]}]},
  {name: "fatal-again", steps: [{call: "ErrorUtils.reportFatalError", args: [{$error: messages.earlyFatalAgain}]}]},
];

// Run the steps of a case against env = {console, ErrorUtils, native, RN$handleException, makeError, observed}.
export function runSteps(testCase, env) {
  return testCase.steps.map(step => {
    const [owner, method] = step.call.includes(".") ? step.call.split(".") : [null, step.call];
    const target = owner === null ? env[method] : env[owner][method];
    const receiver = owner === null ? undefined : env[owner];
    try {
      const value = target.apply(receiver, step.args.map(arg => materialize(arg, env)));
      return step.record ? {call: step.call, threw: false, value: value === undefined ? null : value} : {call: step.call, threw: false};
    } catch (error) {
      return {call: step.call, threw: true, error: String(error?.message ?? error)};
    }
  });
}

// The globals of ReactInstance's error family, in the order ReactInstance.cpp defines them. The host installs five, as ReactInstance
// defines them, and leaves RN$hasHandledFatalException and RN$notifyOfFatalException out: with them ExceptionsManager.js reports only the
// first fatal exception, which suits RN's crash on a fatal error and not a runtime that keeps running after an uncaught error (V2-D26;
// GF-07's error-cleanup slice owns any change). The oracle compares the three lists with ReactInstance.cpp.
export const errorGlobals = ["RN$useAlwaysAvailableJSErrorHandling", "RN$isRuntimeReady", "RN$hasHandledFatalException", "RN$notifyOfFatalException",
  "RN$inExceptionHandler", "RN$handleException", "RN$registerExceptionListener"];
export const installedGlobals = ["RN$useAlwaysAvailableJSErrorHandling", "RN$isRuntimeReady", "RN$inExceptionHandler", "RN$handleException",
  "RN$registerExceptionListener"];
export const omittedGlobals = ["RN$hasHandledFatalException", "RN$notifyOfFatalException"];

// The scenarios an application runs this bundle in. The ready lane is the default one.
export const scenarios = {ready: "react", early: "js-errors-early", escape: "js-errors-escape"};

// The priority of RN's NormalPriority task in the RuntimeScheduler (SchedulerPriority.h).
export const normalPriority = 3;
