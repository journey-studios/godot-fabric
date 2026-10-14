import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {isDeepStrictEqual} from "node:util";
import vm from "node:vm";
import ts from "typescript";
import {scanBootstrap} from "../scripts/parity-upstream-scan.mjs";
import {consoleCalls, domGlobals, firstCall, materialize} from "./js-globals-cases.mjs";

// The independent oracle of the JS globals slice. It is written from RN's sources, not from the probe: what RN's setup modules install is
// read out of the pinned files with the TypeScript parser (and, for the DOM globals, out of the scan behind the bootstrap audit), and what RN's
// console polyfill logs for the scenario is what the polyfill itself logs, run in Node (V8) against a hook that records its calls. The report's
// raw observations are judged against those, and every verdict the probe gave is derived again here and must agree.

const sorted = values => [...values].sort();
// Deep equality that ignores the order of keys: Godot writes a report with its keys sorted.
const same = isDeepStrictEqual;

function parse(file, source) {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

function visit(node, callback) {
  callback(node);
  node.forEachChild(child => visit(child, callback));
}

const nameOf = node => (node.name !== undefined && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))) ? node.name.text : undefined;

// The properties of the first object literal assigned to `target` (say `global.performance`) that matches `accept`, with the spread kept apart.
function assignedObject(sf, target, accept = () => true) {
  let found;
  visit(sf, node => {
    if (found === undefined && ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      node.left.getText(sf) === target && ts.isObjectLiteralExpression(node.right) && accept(node.right)) {
      found = node.right;
    }
  });
  assert.ok(found, `${target} is no longer assigned an object literal`);
  return found;
}

// The attributes an Object.defineProperty(owner, name, {…}) call sets true; one it leaves out is false.
function definedProperty(sf, owner, name) {
  let found;
  visit(sf, node => {
    if (found === undefined && ts.isCallExpression(node) && node.expression.getText(sf) === "Object.defineProperty" &&
      node.arguments[0]?.getText(sf) === owner && ts.isStringLiteral(node.arguments[1]) && node.arguments[1].text === name &&
      ts.isObjectLiteralExpression(node.arguments[2])) {
      // The attributes only: a descriptor's value is the object the fixture reads separately.
      found = Object.fromEntries(node.arguments[2].properties.filter(ts.isPropertyAssignment)
        .filter(property => ["writable", "enumerable", "configurable"].includes(nameOf(property)))
        .map(property => [nameOf(property), property.initializer.kind === ts.SyntaxKind.TrueKeyword]));
    }
  });
  assert.ok(found, `Object.defineProperty(${owner}, '${name}', …) is no longer in the source`);
  return found;
}

// Runs RN's console polyfill in a V8 context whose native hook records its calls, and makes the scenario's calls against it.
function runPolyfill(source, calls) {
  const logged = [];
  const context = vm.createContext({});
  context.global = context;
  context.__DEV__ = false;
  context.nativeLoggingHook = (message, level) => logged.push({message, level});
  vm.runInContext(source, context);
  const makeError = vm.runInContext("(text => new Error(text))", context);
  return calls.map(({method, args}) => {
    const start = logged.length;
    let threw = null;
    try {
      context.console[method](...args.map(arg => materialize(arg, makeError)));
    } catch (error) {
      threw = String(error?.message ?? error);
    }
    return {method, args, logged: logged.slice(start), threw};
  });
}

// What RN 0.87.1 installs and logs, from the pinned sources under `root`.
export function rnExpectations(root) {
  const rn = path.join(root, "node_modules/react-native");
  const read = file => readFileSync(path.join(rn, file), "utf8");
  const chain = scanBootstrap({ts, upstream: rn}).steps;
  const installed = file => chain.find(step => step.file === file).globals;
  const globals = parse("setUpGlobals.js", read("Libraries/Core/setUpGlobals.js"));
  const navigator = parse("setUpNavigator.js", read("Libraries/Core/setUpNavigator.js"));
  const performance = parse("setUpPerformance.js", read("Libraries/Core/setUpPerformance.js"));
  const polyfillSource = readFileSync(path.join(root, "node_modules/@react-native/js-polyfills/console.js"), "utf8");
  const polyfill = parse("console.js", polyfillSource);

  let nodeEnv;
  visit(globals, node => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      node.left.getText(globals) === "global.process.env.NODE_ENV" && ts.isConditionalExpression(node.right) &&
      ts.isStringLiteral(node.right.whenFalse)) {
      nodeEnv = node.right.whenFalse.text;
    }
  });
  let product;
  visit(navigator, node => {
    if (ts.isPropertyAssignment(node) && nameOf(node) === "product" && ts.isStringLiteral(node.initializer)) {
      product = node.initializer.text;
    }
  });
  const withSpread = object => object.properties.some(ts.isSpreadAssignment);
  const consoleObject = assignedObject(polyfill, "global.console", withSpread);
  const dom = installed("src/private/setup/setUpDOM.js");
  return {
    // setUpGlobals.js: window is defined on the global object as fixed; process.env.NODE_ENV takes the second branch of __DEV__ ? … : ….
    window: definedProperty(globals, "globalThis", "window"),
    nodeEnv,
    navigator: definedProperty(navigator, "global", "navigator"),
    product,
    // setUpPerformance.js: the fallback object.
    performanceMembers: sorted(assignedObject(performance, "global.performance").properties.map(nameOf)),
    // setUpDOM.js: lazy getters for every name but the dispatch function, which it defines directly.
    domGlobals: sorted(dom.filter(name => !name.startsWith("RN$"))),
    dispatchName: dom.find(name => name.startsWith("RN$")),
    // console.js: the members of global.console that the polyfill defines, and the hidden marker it adds.
    consoleMembers: sorted([...consoleObject.properties.filter(property => !ts.isSpreadAssignment(property)).map(nameOf), "_isPolyfilled"]),
    marker: definedProperty(polyfill, "console", "_isPolyfilled"),
    // What the polyfill logs for the scenario, and for the call the bundle's first module makes.
    scenario: runPolyfill(polyfillSource, consoleCalls),
    first: runPolyfill(polyfillSource, [firstCall])[0].logged,
  };
}

const bracketed = samples => samples.length > 0 &&
  samples.every(sample => sample.now !== null && sample.before <= sample.now && sample.now <= sample.after);
const movesForward = samples => samples.length >= 2 && samples.every(sample => sample.now !== null) &&
  samples.every((sample, index) => index === 0 || sample.now >= samples[index - 1].now) && samples.at(-1).now > samples[0].now;

// The call of the scenario to console.<method> whose first argument is `first`, in a record of the calls.
const callOf = (calls, method, first) => calls.find(call => call.method === method && call.args.length > 0 && same(call.args[0], first));
const sends = (calls, method, first, message, level) => {
  const call = callOf(calls, method, first);
  return call !== undefined && call.threw === null && call.logged.length === 1 && call.logged[0].message === message && call.logged[0].level === level;
};
const sendsNothing = (calls, method, first) => {
  const call = callOf(calls, method, first);
  return call !== undefined && call.threw === null && call.logged.length === 0;
};

// Every verdict the probe gives, derived again from the raw observations of a report and from RN, in the probe's order and with its names.
export function derivedChecks(report, expected) {
  const {mount, host, first, early, environment: env, clock, console: scenario, stop} = report.stages;
  const fixed = descriptor => descriptor !== null && descriptor.writable === false;
  const samples = [clock.a, ...clock.frames, clock.b];
  const godot = clock.godot;
  const advanced = clock.a.now !== null && clock.b.now !== null ? clock.b.now - clock.a.now : null;
  const calls = scenario.perCall;
  const performanceState = env.performance;
  const dom = env.dom;
  const row = (name, passed) => ({name, passed});
  return [
    row("mount/A root mounts through the original AppRegistry in the Hermes application the bundle ran in",
      mount.application.rootCount === 1 && mount.surfaceId > 0 && mount.application.errors.length === 0),
    row("host/The host defines neither performance nor console before the first line of the bundle",
      host.console === "undefined" && host.performance === "undefined"),
    row("host/The host binds nativeLoggingHook and nativePerformanceNow and sets global and __DEV__",
      host.nativeLoggingHook === "function" && host.nativePerformanceNow === "function" && host.globalIsGlobalThis === true && host.dev === false),
    row("first/RN's console polyfill has run when the first module of the bundle starts, and no setup module of RN has",
      first.console === "object" && first.polyfilled === true && first.window === "undefined" && first.process === "undefined" &&
        first.navigator === "undefined"),
    row("first/The first line the bundle logs reaches the host's hook in RN's format at the info level",
      early.length >= 1 && same(early[0], expected.first[0]) && early[0].level === 1),
    row("globals/window and self are the global object, and window is RN's fixed property",
      env.global === true && env.window.sameAsGlobal === true && env.self.sameAsGlobal === true && env.window.descriptor !== null &&
        env.window.descriptor.writable === expected.window.writable && env.window.descriptor.configurable === expected.window.configurable &&
        env.window.descriptor.enumerable === expected.window.enumerable && env.window.descriptor.accessor === false),
    row("globals/process.env.NODE_ENV is production at run time",
      env.process.type === "object" && env.process.envType === "object" && env.process.nodeEnv === expected.nodeEnv),
    row("globals/navigator.product is ReactNative, on the property RN defines",
      env.navigator.product === expected.product && env.navigator.descriptor !== null &&
        env.navigator.descriptor.writable === expected.navigator.writable && env.navigator.descriptor.configurable === expected.navigator.configurable &&
        env.navigator.descriptor.enumerable === expected.navigator.enumerable),
    row("performance/performance has RN's five members and no other",
      performanceState.type === "object" && same(performanceState.ownKeys, expected.performanceMembers) &&
        expected.performanceMembers.every(member => performanceState.members[member] === "function")),
    row("performance/mark, measure, clearMarks and clearMeasures return without throwing",
      Object.keys(performanceState.calls).length === 4 &&
        Object.values(performanceState.calls).every(call => call.threw === false && call.type === "undefined")),
    row("performance/now() reads the host clock: it falls between two nativePerformanceNow() reads in every sample",
      bracketed(samples) && clock.frames.length === clock.framesWanted),
    row("performance/now() never goes backward from one sample to the next, and moves forward", movesForward(samples)),
    row("performance/now() advances as much as Godot's own clock did between two reads",
      advanced !== null && advanced >= 0 && advanced >= (godot.bBefore - godot.aAfter) / 1000 - 1 &&
        advanced <= (godot.bAfter - godot.aBefore) / 1000 + 1),
    row("dom/RN's 14 DOM globals are lazy getters until first used, and classes after",
      same(sorted(dom.names), expected.domGlobals) && dom.names.length === 14 &&
        dom.names.every(name => dom.lazyBeforeUse[name] === true && dom.resolved[name] === "function")),
    row("dom/RN$isNativeEventTargetEventDispatchingEnabled is a function that answers a boolean",
      expected.dispatchName === "RN$isNativeEventTargetEventDispatchingEnabled" && env.domDispatch.type === "function" &&
        env.domDispatch.result !== null && env.domDispatch.result.threw === false && env.domDispatch.result.type === "boolean"),
    row("console/console has the members of RN's polyfill, and createTask runs its callback",
      env.console.type === "object" && same(env.console.names, expected.consoleMembers) && env.console.polyfilled === true &&
        expected.consoleMembers.every(name => env.console.kinds[name] === (name === "_isPolyfilled" ? "boolean" : "function")) &&
        env.console.task !== null && env.console.task.threw === false && env.console.task.value === 7),
    row("console/Every call of the scenario runs without throwing", calls.every(call => call.threw === null)),
    row("console/A lone string is logged as it is, and log(\"A\", \"B\") as 'A', 'B', at the info level",
      sends(calls, "log", "one string", "one string", 1) && sends(calls, "log", "A", "'A', 'B'", 1)),
    row("console/info, debug, trace, warn and error carry RN's levels, and an error that starts with \"Warning: \" is a warning",
      sends(calls, "info", "count", "'count', 3, true, null", 1) && sends(calls, "debug", "debug", "debug", 0) &&
        sends(calls, "trace", "trace", "'trace', 0", 0) && sends(calls, "warn", "warn", "'warn', 2", 2) &&
        sends(calls, "error", "error", "'error', 3", 3) &&
        sends(calls, "error", "Warning: reported as a warning", "'Warning: reported as a warning', 1", 2)),
    row("console/assert(false, \"boom\") logs \"Assertion failed: boom\" at the error level, and assert(true) logs nothing",
      sends(calls, "assert", false, "Assertion failed: boom", 3) && sendsNothing(calls, "assert", true)),
    row("console/time, timeEnd, timeStamp, count and countReset are RN's silent stubs",
      ["time", "timeEnd", "timeStamp"].every(method => sendsNothing(calls, method, "t")) &&
        ["count", "countReset"].every(method => sendsNothing(calls, method, "c"))),
    row("lifecycle/Stop releases the root without a diagnostic",
      stop.application.stopped === true && stop.application.rootCount === 0 && stop.application.errors.length === 0),
    row("lifecycle/All native Controls of the root are balanced", stop.root.nativeTags === 0 && stop.root.creates === stop.root.deletes),
    row("report/The JS globals report is saved with any normative failure visible", true),
  ];
}

// The report judged against RN. It holds only for a report of the current host and SDK: every derived verdict must be true and be the
// verdict the report gave, and what the Hermes console logged for the whole scenario must be what RN's polyfill logs in Node.
export function verifyJsGlobalsReport(report, expected) {
  const derived = derivedChecks(report, expected);
  assert.deepEqual(derived.map(row => row.name), report.checks.map(row => row.name), "The oracle checks what the probe checks");
  const failing = derived.filter(row => !row.passed).map(row => row.name);
  assert.deepEqual(failing, [], `The oracle fails ${failing.length} check(s), the first of them ${failing[0]}`);
  assert.deepEqual(derived, report.checks, "The oracle derives the verdicts the probe gave");
  const stages = report.stages;
  assert.deepEqual(stages.console.perCall, expected.scenario, "The Hermes console logs what RN's polyfill logs in Node, call by call");
  assert.deepEqual(stages.environment.dom.names, domGlobals, "The fixture resolves the DOM globals the cases list");
  assert.deepEqual(stages.environment.console.names, expected.consoleMembers);
  assert.deepEqual(stages.environment.window.descriptor, {...expected.window, accessor: false});
  assert.deepEqual(stages.environment.navigator.descriptor, {...expected.navigator, accessor: false});
  assert.equal(expected.marker.enumerable, false, "RN's marker is not enumerable");
  return derived;
}

// The oracle's first complaint about a report whose checks all claim to pass, or null when it accepts it.
export function oracleRejection(report, expected) {
  try {
    verifyJsGlobalsReport({...report, checks: report.checks.map(row => ({...row, passed: true}))}, expected);
  } catch (error) {
    return String(error.message).split("\n")[0];
  }
  return null;
}
