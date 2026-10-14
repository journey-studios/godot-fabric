import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";
import {isDeepStrictEqual} from "node:util";
import vm from "node:vm";
import {build} from "esbuild";
import ts from "typescript";
import {platformPlugin} from "../sdk/toolchain/platform-plugin.mjs";
import {metroPolyfills} from "../sdk/toolchain/metro-polyfills.mjs";
import {godotExtensions} from "../sdk/toolchain/platform-resolution.mjs";
import {earlyCases, errorGlobals, installedGlobals, messages, omittedGlobals, readyCases, runSteps} from "./js-errors-cases.mjs";

// The independent oracle of the error path slice. It is written from RN, not from the probe, in three ways:
//   - the facts RN's sources state (the members of ErrorUtils, the name of the handler setUpErrorHandling registers, the globals
//     ReactInstance defines and the words it refuses calls with, the flag default, the prefix JsErrorHandler gives an error before the
//     runtime is ready) are read out of the pinned files;
//   - what RN's own JavaScript does with each case (error-guard, setUpErrorHandling, ExceptionsManager, NativeExceptionsManager) is what it
//     does in V8: the same modules are bundled by the same toolchain and run in a vm context whose native module records its calls, so the
//     reports, the console lines and the values of the steps come from RN's code and not from the probe;
//   - what JsErrorHandler's C++ pipeline does before the runtime is ready (the order, preventDefault, the warn, the one fatal error) is
//     a model written from JsErrorHandler.cpp, whose anchors the oracle finds in the source.
// The report's raw observations are judged against those, and every verdict the probe gave is derived again here and must agree.

const same = isDeepStrictEqual;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const requireSdk = createRequire(path.join(root, "package.json"));

function parse(file, source) {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

function visit(node, callback) {
  callback(node);
  node.forEachChild(child => visit(child, callback));
}

const nameOf = node => (node.name !== undefined && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) ? node.name.text : undefined;
const sorted = values => [...values].sort();

// The first group of the first match of `pattern` in `source`, or a failure that names what was looked for: the oracle reads these words
// out of RN, so a source that no longer says them is a reason to look again, not to guess.
function found(source, pattern, what) {
  const match = source.match(pattern);
  assert.ok(match, `RN's sources no longer say ${what}`);
  return match[1];
}

// What a report of an error holds, without what depends on the engine (the frames of the stack, the id).
const summary = data => ({message: data.message, originalMessage: data.originalMessage ?? null, name: data.name ?? null,
  componentStack: data.componentStack ?? null, isFatal: data.isFatal, extra: sorted(Object.keys(data.extraData ?? {}))});
// The same, from what the fixture recorded of the call to NativeExceptionsManager.reportException in Hermes.
const summaryOfReport = report => ({message: report.message, originalMessage: report.originalMessage ?? null, name: report.name ?? null,
  componentStack: report.componentStack ?? null, isFatal: report.isFatal, extra: report.extraData});

// RN's own JavaScript in V8. RN's modules are bundled the way the host's bundles are (the platform plugin, the Metro polyfills ahead of
// everything), and run in a context whose TurboModule proxy answers ExceptionsManager with a module that records its calls.
async function referenceRun() {
  const result = await build({absWorkingDir: root, stdin: {contents: `
import "react-native/Libraries/Core/setUpErrorHandling";
import native from "react-native/Libraries/Core/NativeExceptionsManager";
globalThis.__nativeExceptionsManager = native;
`, resolveDir: root, sourcefile: "js-errors-reference-entry.js"}, bundle: true, write: false, platform: "neutral", format: "iife",
  define: {"process.env.NODE_ENV": '"production"', __DEV__: "false"}, inject: metroPolyfills(id => requireSdk.resolve(id)),
  mainFields: ["main"], resolveExtensions: godotExtensions, plugins: [platformPlugin(path.join(root, "src"), id => requireSdk.resolve(id))]});
  const logged = [];
  const calls = [];
  const exceptionsManager = {
    reportException: data => calls.push({method: "reportException", data: summary(data), stack: data.stack.length}),
    reportSoftException: (message, stack, id) => calls.push({method: "reportSoftException", message, stack: stack.length, id}),
    reportFatalException: (message, stack, id) => calls.push({method: "reportFatalException", message, stack: stack.length, id}),
    dismissRedbox: () => calls.push({method: "dismissRedbox"}),
  };
  const context = vm.createContext({});
  context.global = context;
  context.__DEV__ = false;
  context.nativeLoggingHook = (message, level) => logged.push({message, level});
  // What the host's native module runtime requires of the VM before any module loads.
  context.RN$Bridgeless = true;
  context.nativeModuleProxy = {};
  context.RN$registerCallableModule = () => {};
  context.__turboModuleProxy = name => name === "ExceptionsManager" ? exceptionsManager : null;
  // The runtime is ready after the bundle, and the flag is at its default: RN$handleException hands every error back to JS.
  context.RN$handleException = () => false;
  context.RN$inExceptionHandler = () => false;
  vm.runInContext(result.outputFiles[0].text, context);
  const makeError = vm.runInContext("(text => new Error(text))", context);
  const isFatal = call => call.method === "reportException" ? call.data.isFatal : call.method === "reportFatalException";
  const cases = {};
  for (const testCase of readyCases.filter(entry => entry.host !== true)) {
    const callStart = calls.length;
    const loggedStart = logged.length;
    const env = {console: context.console, ErrorUtils: context.ErrorUtils, native: context.__nativeExceptionsManager, makeError, observed: {}};
    const steps = runSteps(testCase, env);
    const made = calls.slice(callStart);
    const reports = made.filter(call => call.method === "reportException");
    cases[testCase.name] = {steps, observed: env.observed, logged: logged.slice(loggedStart), reports: reports.map(call => call.data),
      reportedStacks: reports.map(call => call.stack), deprecated: made.filter(call => call.method.endsWith("Exception") && call.method !== "reportException"),
      dismissed: made.filter(call => call.method === "dismissRedbox").length,
      softCount: made.filter(call => call.method !== "dismissRedbox" && !isFatal(call)).length,
      fatalCount: made.filter(call => call.method !== "dismissRedbox" && isFatal(call)).length};
  }
  return {cases};
}

// What the JsErrorHandler C++ pipeline does with a sequence of errors while the runtime is not ready, from JsErrorHandler.cpp: every
// listener sees the error before anything is decided; a listener that calls preventDefault stops it; a non-fatal error of type "warn" is
// not forwarded; the first fatal error is forwarded and the later ones are not. The listener of the fixture prevents an error whose
// message says "prevented". The message is composed with the name, as the pipeline does, and prefixed. The pipeline logs the error with
// console.error unless it was handed logToConsole false (the case that calls RN$handleException directly says so).
function modelEarly(prefix) {
  let handledFatal = false;
  return earlyCases.map(testCase => {
    const step = testCase.steps[0];
    const subject = step.args[0];
    const fatal = step.call === "ErrorUtils.reportFatalError";
    const message = `${prefix}Error: ${subject.$error}`;
    let forwarded = !message.includes("prevented") && (fatal || subject.props?.type !== "warn");
    if (fatal && forwarded) {
      forwarded = !handledFatal;
      handledFatal = true;
    }
    return {name: testCase.name, message, fatal, forwarded, loggedToConsole: step.args[2] !== false};
  });
}

// What Android's JSStackTrace.format makes of a message and a stack, with the file of a frame kept (Android keeps only the id of a bundle
// segment; native/js_error_path.cpp keeps the file, because this host's bundle has a name, and a stack that does not say which file it is
// in is of little use). The parts the host keeps of RN's Kotlin are checked against the source in rnExpectations.
function failureText(message, stack) {
  return message + ", stack:\n" + stack.map(frame => `${frame.methodName}@${frame.file ? frame.file + ":" : ""}${
    frame.lineNumber != null ? Math.trunc(frame.lineNumber) : -1}${frame.column != null ? ":" + Math.trunc(frame.column) : ""}\n`).join("");
}

// What RN 0.87.1 does, from the pinned sources under `base` and from running its JavaScript.
export async function rnExpectations(base = root) {
  const rn = path.join(base, "node_modules/react-native");
  const read = file => readFileSync(path.join(rn, file), "utf8");
  const errorGuardSource = readFileSync(path.join(base, "node_modules/@react-native/js-polyfills/error-guard.js"), "utf8");
  const errorGuard = parse("error-guard.js", errorGuardSource);
  const setUpSource = read("Libraries/Core/setUpErrorHandling.js");
  const setUp = parse("setUpErrorHandling.js", setUpSource);
  const exceptionsManager = read("Libraries/Core/ExceptionsManager.js");
  const reactInstance = read("ReactCommon/react/runtime/ReactInstance.cpp");
  const handlerSource = read("ReactCommon/jserrorhandler/JsErrorHandler.cpp");
  const schedulerSource = read("ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler_Modern.cpp");
  const flagDefaults = read("ReactCommon/react/featureflags/ReactNativeFeatureFlagsDefaults.h");
  const kotlin = read("ReactAndroid/src/main/java/com/facebook/react/util/JSStackTrace.kt");

  // error-guard.js: the members of the ErrorUtils object it assigns to global.ErrorUtils.
  let errorUtilsMembers;
  visit(errorGuard, node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "ErrorUtils" && node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)) {
      errorUtilsMembers = sorted(node.initializer.properties.map(nameOf));
    }
  });
  assert.ok(errorUtilsMembers, "error-guard.js no longer defines ErrorUtils as an object literal");
  assert.match(errorGuardSource, /global\.ErrorUtils = ErrorUtils;/);

  // setUpErrorHandling.js: the arrow function it hands to ErrorUtils.setGlobalHandler.
  let handler;
  visit(setUp, node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isArrowFunction(node.initializer)) {
      handler = {name: node.name.text, arity: node.initializer.parameters.length};
    }
  });
  assert.ok(handler, "setUpErrorHandling.js no longer defines its handler as an arrow function");
  assert.match(setUpSource, new RegExp(`ErrorUtils\\.setGlobalHandler\\(${handler.name}\\)`));

  // ExceptionsManager.js: the console.error it installs, and the member it keeps the original under.
  const reporter = found(exceptionsManager, /console\.error = (\w+);/, "which function replaces console.error");
  const original = found(exceptionsManager, /console\.(_\w+) = console\.error\.bind\(console\);/, "where console.error is kept");

  // ReactInstance.cpp: the globals of the error family and their arities, and the words the calls are refused with.
  const defined = [...reactInstance.matchAll(/defineReadOnlyGlobal\(\s*runtime,\s*"(RN\$\w+)"/g)].map(match => match[1]);
  const family = defined.filter(name => /Exception|Handling|isRuntimeReady/.test(name));
  const arity = name => Number(found(reactInstance, new RegExp(`"${name.replace("$", "\\$")}",\\s*jsi::Function::createFromHostFunction\\(\\s*runtime,\\s*` +
    `jsi::PropNameID::forAscii\\(runtime, "\\w+"\\),\\s*(\\d+),`), `the arity of ${name}`));
  // RN$useAlwaysAvailableJSErrorHandling is the flag's value, not a function (ReactInstance.cpp:451-455).
  const FLAG_GLOBAL = "RN$useAlwaysAvailableJSErrorHandling";
  assert.match(reactInstance, /"RN\$useAlwaysAvailableJSErrorHandling",\s*jsi::Value\(\s*ReactNativeFeatureFlags::useAlwaysAvailableJSErrorHandling\(\)\)\);/);
  // The host installs the five that keep a runtime running and leaves out the two that make ExceptionsManager.js report only the first fatal
  // exception (ExceptionsManager.js:127-130); together they are the family, and the two it leaves out are the ones that file reads.
  assert.deepEqual(sorted([...installedGlobals, ...omittedGlobals]), sorted(family), "The host installs or leaves out each global of the family");
  assert.match(exceptionsManager, /if \(global\.RN\$hasHandledFatalException\?\.\(\)\) \{\s*return;\s*\}\s*global\.RN\$notifyOfFatalException\?\.\(\);/);
  const refusals = {
    handleException: found(reactInstance, /"(handleException requires 3 arguments[^"]*)"/, "why handleException refuses a call"),
    listenerMissing: found(reactInstance, /"(registerExceptionListener: requires 1 argument: fn)"/, "why registerExceptionListener refuses no argument"),
    listenerType: found(reactInstance, /"(registerExceptionListener: The first argument must be a function)"/, "why registerExceptionListener refuses a non-function"),
  };
  // With the flag at false and the runtime ready, RN$handleException answers false (ReactInstance.cpp:537-542).
  assert.match(reactInstance, /!ReactNativeFeatureFlags::\s*useAlwaysAvailableJSErrorHandling\(\)\) \{\s*if \(jsErrorHandler->isRuntimeReady\(\)\) \{\s*return jsi::Value\(false\);/);
  const flag = found(flagDefaults, /bool useAlwaysAvailableJSErrorHandling\(\) override \{\s*return (true|false);/, "the flag's default") === "true";
  // The runtime is ready after the bundle, unless a fatal error was handled (ReactInstance.cpp:296).
  assert.match(reactInstance, /if \(!jsErrorHandler->hasHandledFatalError\(\)\) \{\s*jsErrorHandler->setRuntimeReady\(\);/);

  // JsErrorHandler.cpp: the prefix, and the anchors of the model.
  const prefix = found(handlerSource, /"(\[runtime not ready\]: )"/, "the prefix of an error before the runtime is ready");
  for (const anchor of ["isEqualTo(runtime, errorType, \"warn\")", "if (isFatal || !isWarn)", "if (_hasHandledFatalError)", "_hasHandledFatalError = true;",
    "if (*shouldPreventDefault)", "for (auto& errorListener : _errorListeners)"]) {
    assert.ok(handlerSource.includes(anchor), `JsErrorHandler.cpp no longer says ${anchor}`);
  }
  // RN's RuntimeScheduler hands its error handler a wrapper for what it does not recognise as a JS error.
  const schedulerWrap = found(schedulerSource, /jsi::JSError error\(runtime, std::string\("(Non-js exception: )"\) \+ ex\.what\(\)\);/, "how the scheduler wraps a std::exception");
  // RN spells the wrap of what it does not recognise as a JS error twice: ReactInstance's runtime executor (ReactInstance.cpp:104-108) and the
  // RuntimeScheduler (above) differ in case. The host's own catches mirror the runtime executor, and its spelling is read from there.
  const executorWrap = found(reactInstance, /jsi::JSError error\(\s*jsiRuntime, std::string\("(Non-JS exception: )"\) \+ ex\.what\(\)\);/, "how the runtime executor wraps a std::exception");
  const hostSource = readFileSync(path.join(base, "native/js_error_path.cpp"), "utf8");
  assert.equal(found(hostSource, /non_js_exception_prefix = "([^"]*)";/, "the host's prefix for an exception that is not a JS error"), executorWrap,
    "The host spells the runtime executor's wrap as ReactInstance.cpp does");
  const hostCode = hostSource.split("\n").filter(line => !/^\s*\/\//.test(line)).join("\n");
  // Slice F's microtask checkpoint mirrors RuntimeScheduler_Modern::performMicrotaskCheckpoint, whose catch wraps with the scheduler's own spelling
  // (RuntimeScheduler_Modern.cpp:402 and 442): the host spells each of RN's two wraps once, outside its comments.
  assert.equal(found(hostSource, /task_non_js_exception_prefix = "([^"]*)";/, "the host's prefix for the scheduler's tasks and checkpoint"), schedulerWrap,
    "The host spells the scheduler's wrap as RuntimeScheduler_Modern.cpp does");
  assert.equal([...hostCode.matchAll(/"Non-/g)].length, 2, "The host spells each wrap of RN once, outside its comments");
  // The parts of Android's format the host keeps.
  for (const part of ['", stack:\\n"', '"@"', "append(-1)"]) {
    assert.ok(kotlin.includes(part), `JSStackTrace.kt no longer says ${part}`);
  }

  const reference = await referenceRun();
  return {
    errorUtilsMembers, handler, reporter, original, family,
    installed: installedGlobals.map(name => name === FLAG_GLOBAL ? {name, flag: true} : {name, arity: arity(name)}), omitted: omittedGlobals, refusals, flag, prefix,
    schedulerWrap, executorWrap, early: modelEarly(prefix), reference,
  };
}

const errorsOf = snapshot => snapshot?.errors ?? [];
const counted = (record, route, kind) => Number(record?.after?.[route]?.[kind] ?? 0) - Number(record?.before?.[route]?.[kind] ?? 0);

// A case of the ready lane: the steps, the console lines and the reports of the module's JS wrapper are what RN's JavaScript does in V8.
function sameAsReference(record, expected, name) {
  const ref = expected.reference.cases[name];
  const result = record?.result;
  return ref !== undefined && result != null && same(result.steps, ref.steps) && same(result.observed, ref.observed) && same(result.logged, ref.logged) &&
    same(result.reports.map(summaryOfReport), ref.reports) && same(result.reports.map(report => report.stack.length > 0), ref.reportedStacks.map(length => length > 0));
}

// The host counted the reports of the module's JS wrapper: the same kind and message, the frames of the stack and the id RN gave.
function nativeSaw(record) {
  const reports = record?.result?.reports ?? [];
  const seen = record?.after?.reports ?? [];
  const fatal = reports.filter(report => report.isFatal).length;
  if (seen.length < reports.length || counted(record, "module", "fatal") !== fatal || counted(record, "module", "soft") !== reports.length - fatal ||
    counted(record, "handler", "soft") !== 0 || counted(record, "handler", "fatal") !== 0) {
    return false;
  }
  return reports.every((report, index) => {
    const last = seen[seen.length - reports.length + index];
    return last.origin === "module" && last.fatal === report.isFatal && last.message === report.message && last.frames === report.stack.length &&
      last.id === report.id;
  });
}

// One host failure per fatal report, and no other: its text is the message and stack of the report, in Android's format.
function failuresFor(record) {
  const fatal = (record?.result?.reports ?? []).filter(report => report.isFatal);
  const errors = record?.errors ?? [];
  return errors.length === fatal.length && fatal.every((report, index) => errors[index] === failureText(report.message, report.stack));
}

// Every verdict the probe gives, derived again from the raw observations of a report and from RN, in the probe's order and with its names.
export function derivedChecks(report, expected) {
  const stages = report.stages;
  const row = (name, passed) => ({name, passed});
  const cases = stages.cases ?? {};
  const ref = expected.reference.cases;
  const mounted = stages.mount?.application;
  const globals = stages.host?.globals ?? {};
  const installedNames = expected.installed.map(entry => entry.name);
  const omitted = expected.family.filter(name => !installedNames.includes(name));
  const flagEntry = globals["RN$useAlwaysAvailableJSErrorHandling"];
  const readOnly = {writable: false, enumerable: false, configurable: false};
  const environment = stages.environment ?? {};
  const first = stages.first ?? {};
  const quiet = record => (record?.errors ?? [1]).length === 0;
  const noThrow = record => (record?.result?.steps ?? []).length > 0 && record.result.steps.every(step => step.threw === false);
  const logsOnce = (record, text, level) => (record?.result?.logged ?? []).filter(entry => entry.message === text && entry.level === level).length === 1;
  const lastReport = record => (record?.after?.reports ?? []).at(-1);

  const soft = name => sameAsReference(cases[name], expected, name) && ref[name].reports.length === 1 && ref[name].reports[0].isFatal === false &&
    nativeSaw(cases[name]) && quiet(cases[name]) && noThrow(cases[name]);
  const fatal = name => sameAsReference(cases[name], expected, name) && ref[name].reports.length === 1 && ref[name].reports[0].isFatal === true &&
    nativeSaw(cases[name]) && failuresFor(cases[name]) && noThrow(cases[name]);
  const warning = cases["console-warning"];
  const guard = cases.guard;

  // The scheduler's catch site: RN's RuntimeScheduler wraps what Hermes throws (a std::exception to it) and reports the wrapper as fatal.
  const task = cases["scheduler-task"];
  const taskReports = task?.result?.reports ?? [];
  const taskFailed = taskReports.length === 1 && taskReports[0].isFatal === true &&
    taskReports[0].message.startsWith(`Error: ${expected.schedulerWrap}${messages.task}\n\nError: ${messages.task}`) &&
    (task.errors ?? []).length === 1 && task.errors[0] === failureText(taskReports[0].message, taskReports[0].stack) &&
    counted(task, "module", "fatal") === 1 && counted(task, "module", "soft") === 0 && counted(task, "handler", "fatal") === 0 &&
    counted(task, "handler", "soft") === 0;

  const deprecated = cases["deprecated-soft"];
  const direct = cases.direct;
  const refDeprecated = ref["deprecated-soft"];
  const refDirect = ref.direct;
  const deprecatedOk = noThrow(deprecated) && quiet(deprecated) && counted(deprecated, "module", "soft") === 1 && refDeprecated.deprecated.length === 1 &&
    refDeprecated.deprecated[0].method === "reportSoftException" && lastReport(deprecated)?.origin === "module" && lastReport(deprecated)?.fatal === false &&
    lastReport(deprecated)?.message === refDeprecated.deprecated[0].message && lastReport(deprecated)?.frames === refDeprecated.deprecated[0].stack &&
    lastReport(deprecated)?.id === refDeprecated.deprecated[0].id && sameAsReference(deprecated, expected, "deprecated-soft");
  const directOk = noThrow(direct) && quiet(direct) && counted(direct, "module", "soft") === 1 && sameAsReference(direct, expected, "direct") &&
    refDirect.dismissed === 1 && refDirect.reports.length === 1 && lastReport(direct)?.message === refDirect.reports[0].message &&
    lastReport(direct)?.frames === refDirect.reportedStacks[0] && lastReport(direct)?.fatal === refDirect.reports[0].isFatal;

  const ready = cases["handle-ready"];
  const refused = cases.arguments?.result?.steps ?? [];
  const settled = stages.settled ?? {};
  const totals = settled.jsErrors ?? {};
  const softReports = Object.values(ref).reduce((sum, entry) => sum + entry.softCount, 0);
  // The cases RN's JavaScript ran in V8 report the fatal errors of the two ErrorUtils.reportFatalError cases; the task is the third.
  const fatalReports = Object.values(ref).reduce((sum, entry) => sum + entry.fatalCount, 0) + 1;
  const failures = settled.errors ?? [];
  const order = [...["fatal-error", "fatal-string"].map(name => cases[name]?.result?.reports?.[0]), taskReports[0]];
  const nativeOk = totals.runtimeReady === true && totals.handledFatalError === false && totals.inHandler === false && totals.listeners === 0 &&
    totals.handler?.soft === 0 && totals.handler?.fatal === 0 && totals.module?.fatal === fatalReports && totals.module?.soft === softReports &&
    failures.length === fatalReports && order.every((entry, index) => entry !== undefined && failures[index] === failureText(entry.message, entry.stack));

  const early = stages.early_lane ?? {};
  const earlyByName = Object.fromEntries((early.cases ?? []).map(entry => [entry.name, entry]));
  const seenOnce = model => {
    const seen = earlyByName[model.name]?.seen ?? [];
    return seen.length === 1 && seen[0].message === model.message && seen[0].isFatal === model.fatal && seen[0].preventDefault === "function" &&
      seen[0].inHandler === true && seen[0].stack > 0 && seen[0].isComponentError === false;
  };
  const earlyTotals = stages.early_settled?.jsErrors ?? {};
  const forwardedSoft = expected.early.filter(model => model.forwarded && !model.fatal);
  // The call after the bundle is one more soft error the pipeline takes, since the runtime is still not ready.
  const lateMessage = `${expected.prefix}Error: ${messages.readyDirect}`;
  const handled = (earlyTotals.reports ?? []).filter(entry => entry.origin === "handler" && entry.fatal === false).map(entry => entry.message);
  const earlyFailures = stages.early_settled?.errors ?? [];
  const firstFatal = expected.early.find(model => model.fatal && model.forwarded);
  const late = stages.early_late;
  const lateSteps = late?.result?.steps ?? [];

  const escapeSnapshot = stages.escape?.application;
  const escapeFailures = errorsOf(escapeSnapshot);
  const escapeTotals = escapeSnapshot?.jsErrors ?? {};
  const stop = stages.stop?.application;
  const rootState = stages.stop?.root;
  const earlyStop = stages.early_stop;

  return [
    row("mount/The ready lane mounts a root through the original AppRegistry without a diagnostic",
      mounted?.rootCount === 1 && stages.mount.surfaceId > 0 && errorsOf(mounted).length === 0),
    row("host/The host installs the five globals of ReactInstance's error family that keep a runtime running as ReactInstance defines them, and neither RN$hasHandledFatalException nor RN$notifyOfFatalException",
      same(errorGlobals, expected.family) && same(sorted(Object.keys(globals)), sorted(expected.family)) && same(sorted(omitted), sorted(expected.omitted)) &&
        expected.installed.every(entry => entry.flag === true ?
          flagEntry?.type === "boolean" && flagEntry.value === expected.flag && same(flagEntry.descriptor, readOnly) :
          globals[entry.name]?.type === "function" && globals[entry.name].length === entry.arity && same(globals[entry.name].descriptor, readOnly)) &&
        omitted.every(name => globals[name]?.type === "undefined")),
    row("first/RN's error-guard polyfill has run when the first module of the bundle starts, and setUpErrorHandling has not",
      stages.host?.errorUtils === "undefined" && stages.host?.console === "undefined" && first.errorUtils === "object" && first.defaultHandlerType === "function" &&
        first.defaultHandlerRethrows === "js-errors default handler" && first.consoleErrorOriginal === "undefined"),
    row("errorutils/ErrorUtils has the members of RN's error-guard polyfill and is the module RN reads through Libraries/vendor/core/ErrorUtils",
      environment.errorUtils?.type === "object" && same(environment.errorUtils.names, expected.errorUtilsMembers) &&
        expected.errorUtilsMembers.every(name => environment.errorUtils.kinds[name] === "function") && environment.errorUtils.sameAsVendor === true),
    row("handler/ErrorUtils.getGlobalHandler() is the handler setUpErrorHandling registered, once, and console.error is ExceptionsManager's reporter",
      environment.handler?.type === "function" && environment.handler.name === expected.handler.name && environment.handler.length === expected.handler.arity &&
        environment.handler.setCalls === 1 && environment.handler.isTheOneSet === true && environment.handler.isThePolyfillDefault === false &&
        environment.console?.errorOriginal === "function" && expected.original === "_errorOriginal" && environment.console.errorIsOriginal === false &&
        environment.console.errorName === expected.reporter),
    row("soft/console.error goes through ExceptionsManager to NativeExceptionsManager.reportException with isFatal false, is logged, and records no failure",
      ["console-string", "console-error", "console-multi"].every(soft) && logsOnce(cases["console-string"], "js-errors console string", 3)),
    row("soft/A console.error whose message starts with \"Warning: \" is logged at the warning level and reported to nothing",
      noThrow(warning) && sameAsReference(warning, expected, "console-warning") && ref["console-warning"].reports.length === 0 &&
        logsOnce(warning, "Warning: js-errors react warning", 2) && counted(warning, "module", "soft") === 0 && counted(warning, "module", "fatal") === 0 && quiet(warning)),
    row("soft/ErrorUtils.reportError reports a soft exception once, for an Error and for a thrown string, logs the error once and records no failure",
      ["report-error", "report-error-string"].every(soft) && logsOnce(cases["report-error"], "[Error: js-errors ErrorUtils.reportError]", 3)),
    row("soft/ErrorUtils.applyWithGuard reports the error it catches as a soft exception and returns null, and inGuard is true inside the call only",
      soft("guard") && guard.result.steps.length === 3 && guard.result.steps[0].value === false && guard.result.steps[1].value === null &&
        guard.result.steps[2].value === false && guard.result.observed.inGuard === true),
    row("fatal/ErrorUtils.reportFatalError reaches reportException with isFatal true and records exactly one host failure, with the message and the parsed stack",
      ["fatal-error", "fatal-string"].every(fatal)),
    row("fatal/An exception that escapes a task of RN's RuntimeScheduler reaches ErrorUtils as a fatal error and records exactly one host failure", taskFailed),
    row("module/The deprecated reportSoftException, a direct reportException and dismissRedbox answer as RN's iOS and Android modules do: a soft exception is logged and never a failure",
      deprecatedOk && directOk),
    row("ready/Once the bundle has evaluated, RN$isRuntimeReady says so, RN$handleException hands the error back to JS and nothing is in the middle of reporting",
      expected.flag === false && noThrow(ready) && ready.result.steps.length === 3 && ready.result.steps[0].value === false && ready.result.steps[1].value === false &&
        ready.result.steps[2].value === totals.runtimeReady && totals.runtimeReady === true && ready.result.reports.length === 0 && quiet(ready) &&
        counted(ready, "handler", "soft") === 0 && counted(ready, "module", "soft") === 0),
    row("ready/RN$handleException and RN$registerExceptionListener refuse the calls ReactInstance refuses, with its messages",
      refused.length === 3 && refused.every(step => step.threw === true) && refused[0].error.includes(expected.refusals.handleException) &&
        refused[1].error.includes(expected.refusals.listenerMissing) && refused[2].error.includes(expected.refusals.listenerType)),
    row("native/The host counted what reached it by route: eight soft and three fatal reports from ExceptionsManager, none from the C++ pipeline, and a failure for each fatal one only",
      nativeOk),
    row("lifecycle/Stop releases the root without a further diagnostic, and all native Controls of the root are balanced",
      stop?.stopped === true && stop.rootCount === 0 && errorsOf(stop).length === failures.length && (rootState?.nativeTags ?? -1) === 0 && (rootState?.creates ?? 0) === (rootState?.deletes ?? -1)),
    row("early-mount/The early lane mounts a root: an error handled while the bundle evaluates does not stop the application",
      stages.early_mount?.rootCount === 1),
    row("early/A listener registered with RN$registerExceptionListener sees each error RN$handleException takes into C++, with RN's data and RN$inExceptionHandler true, and RN$handleException answers true",
      early.registered?.threw === false && (early.cases ?? []).length === expected.early.length && expected.early.every(seenOnce) &&
        earlyByName.direct?.steps?.[0]?.value === true && (early.cases ?? []).every(entry => entry.reports.length === 0) && early.inHandlerAfter?.value === false),
    row("early/JsErrorHandler's pipeline logs the soft errors no listener prevented, skips the warn, and records the first fatal error as a failure, with the runtime-not-ready prefix, and not the second",
      earlyTotals.handler?.soft === forwardedSoft.length + 1 && earlyTotals.handler?.fatal === 1 && earlyTotals.module?.soft === 0 && earlyTotals.module?.fatal === 0 &&
        same(handled, [...forwardedSoft.map(model => model.message), lateMessage]) && earlyFailures.length === 1 &&
        earlyFailures[0].startsWith(`${firstFatal.message}, stack:\n`)),
    row("early/A fatal error handled while the bundle evaluates leaves the runtime not ready: RN$isRuntimeReady says so, and RN$handleException keeps taking errors into C++",
      earlyTotals.runtimeReady === false && earlyTotals.handledFatalError === true && earlyTotals.inHandler === false && noThrow(late) && lateSteps.length === 3 &&
        lateSteps[0].value === true && lateSteps[1].value === false && lateSteps[2].value === earlyTotals.runtimeReady),
    row("early-lifecycle/Stop releases the early lane's root without a further diagnostic",
      earlyStop?.stopped === true && earlyStop.rootCount === 0 && errorsOf(earlyStop).length === earlyFailures.length),
    row("escape/An error that escapes the evaluation of the bundle is reported by JsErrorHandler while the runtime is not ready, is the application's one failure, and nothing mounts",
      stages.escape?.surfaceId === 0 && escapeSnapshot?.rootCount === 0 && escapeSnapshot.bundleEvaluations === 0 && escapeSnapshot.stopped === true &&
        escapeFailures.length === 1 && escapeFailures[0].startsWith(`${expected.prefix}Error: ${messages.escaped}, stack:\n`) &&
        escapeTotals.handler?.fatal === 1 && escapeTotals.runtimeReady === false && escapeTotals.handledFatalError === true),
    row("report/The JS errors report is saved with any normative failure visible", true),
  ];
}

// The report judged against RN. It holds only for a report of the current host and SDK: every derived verdict must be true and be the
// verdict the report gave, and what Hermes did with RN's JavaScript must be what V8 did.
export function verifyJsErrorsReport(report, expected) {
  const derived = derivedChecks(report, expected);
  assert.deepEqual(derived.map(row => row.name), report.checks.map(row => row.name), "The oracle checks what the probe checks");
  const failing = derived.filter(row => !row.passed).map(row => row.name);
  assert.deepEqual(failing, [], `The oracle fails ${failing.length} check(s), the first of them ${failing[0]}`);
  assert.deepEqual(derived, report.checks, "The oracle derives the verdicts the probe gave");
  const stages = report.stages;
  // Every case of the ready list ran (the report's keys are sorted), and each one is a case RN's JavaScript ran in V8 or one the host answers.
  assert.deepEqual(sorted(Object.keys(stages.cases)), sorted([...readyCases.map(entry => entry.name), "scheduler-task"]));
  assert.deepEqual(sorted(Object.keys(stages.environment.globals)), sorted(expected.family));
  // The early lane's console lines are what the model says: the pipeline logs the error (message prefixed) unless logToConsole is off.
  for (const model of expected.early) {
    const entry = stages.early_lane.cases.find(candidate => candidate.name === model.name);
    const logged = entry.logged.filter(line => line.message === model.message);
    assert.equal(logged.length, model.loggedToConsole ? 1 : 0, `The pipeline's console.error line for ${model.name}`);
    if (model.loggedToConsole) {
      assert.equal(logged[0].level, 3);
    }
  }
  // The host's report of each route is the pipeline's, never the module's, before the runtime is ready.
  assert.ok(stages.early_settled.jsErrors.reports.every(entry => entry.origin === "handler"));
  return derived;
}

// The oracle's first complaint about a report whose checks all claim to pass, or null when it accepts it.
export function oracleRejection(report, expected) {
  try {
    verifyJsErrorsReport({...report, checks: report.checks.map(row => ({...row, passed: true}))}, expected);
  } catch (error) {
    return String(error.message).split("\n")[0];
  }
  return null;
}
