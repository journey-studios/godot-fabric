import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";
import {isDeepStrictEqual} from "node:util";
import vm from "node:vm";
import {build} from "esbuild";
import ts from "typescript";
import {platformPlugin} from "../sdk/toolchain/platform-plugin.mjs";
import {godotExtensions} from "../sdk/toolchain/platform-resolution.mjs";
import {bulk, cases, priorities, runCase} from "./react-microtasks-cases.mjs";

// The independent oracle of the React microtasks slice. It is written from RN, not from the probe, in three ways:
//   - the facts RN's sources state are read out of the pinned files: setUpTimers' flag and where it installs queueMicrotask from, the spec and
//     the C++ of the NativeMicrotasks module, the renderer's flag branch (supportsMicrotasks, scheduleMicrotask, scheduleImmediateRootScheduleTask
//     and the job they queue), how an event becomes a discrete update, and what the RuntimeScheduler does: the priority timeouts, the checkpoint
//     after each task, the work a press handler runs in;
//   - the order each case of tests/react-microtasks-cases.mjs comes out in is derived by running it through a model of the host's event loop
//     in which the microtask queue is V8's own (Promise reactions, queueMicrotask and RN's immediateShim run in a vm context) and React's job is
//     queued where the renderer's flag branch queues it: in that queue with the flag on, as an Immediate-priority RuntimeScheduler task with it off;
//   - the model is judged against the host both ways: the probe's lane has the flag on, and the lane that leaves it unset must come out in the
//     order the model gives for the flag off (explainedByModel), so a model that does not describe this host fails.
// The report's raw observations are judged against that, and every verdict the probe gave is derived again here and must agree.

const same = isDeepStrictEqual;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const requireSdk = createRequire(path.join(root, "package.json"));
const sorted = values => [...values].sort();
const squash = text => text.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").replace(/ \./g, ".").trim();

function parse(file, source) {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

function visit(node, callback) {
  callback(node);
  node.forEachChild(child => visit(child, callback));
}

// The first group of the first match of `pattern` in `source`, or a failure that names what was looked for: the oracle reads these words out
// of RN, so a source that no longer says them is a reason to look again, not to guess.
function found(source, pattern, what) {
  const match = source.match(pattern);
  assert.ok(match, `RN's sources no longer say ${what}`);
  return match[1];
}

// The text of a function of a C++ source, from its signature to the closing brace at the start of a line.
function cppFunction(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `RN's sources no longer define ${signature}`);
  const end = source.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `${signature} has no end`);
  return source.slice(start, end + 3);
}

const unitMilliseconds = {milliseconds: 1, seconds: 1000, minutes: 60000};

// The facts of the renderer's flag branch, from ReactFabric-prod.js, by the structure of its code and not by the names the minifier gave it.
function rendererFacts(source) {
  const file = parse("ReactFabric-prod.js", source);
  const functions = new Map();
  const variables = new Map();
  visit(file, node => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      functions.set(node.name.text, node);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      variables.set(node.name.text, node.initializer);
    }
  });
  const text = node => squash(node.getText(file));
  const need = (map, name, what) => {
    assert.ok(map.has(name), `ReactFabric-prod.js no longer defines ${what}`);
    return map.get(name);
  };

  // scheduleImmediateRootScheduleTask: a conditional on one variable, with a call to a scheduleMicrotask function on one side and a RuntimeScheduler
  // task at an Immediate priority on the other.
  const schedule = need(functions, "scheduleImmediateRootScheduleTask", "scheduleImmediateRootScheduleTask");
  const conditional = schedule.body.statements[0]?.expression;
  assert.ok(conditional && ts.isConditionalExpression(conditional) && ts.isIdentifier(conditional.condition),
    "scheduleImmediateRootScheduleTask is no longer a conditional on a variable");
  const microtaskCall = conditional.whenTrue;
  const taskCall = conditional.whenFalse;
  assert.ok(ts.isCallExpression(microtaskCall) && ts.isIdentifier(microtaskCall.expression), "The flag branch no longer calls a scheduleMicrotask function");
  assert.ok(ts.isCallExpression(taskCall) && taskCall.arguments.length === 2, "The other branch no longer schedules a task with a priority and a callback");
  const flagVariable = conditional.condition.text;
  const flagGlobal = found(text(need(variables, flagVariable, flagVariable)), /^"undefined" !== typeof (RN\$\w+) && !!\1$/, "what supportsMicrotasks reads");
  const scheduleMicrotask = text(need(variables, microtaskCall.expression.text, "scheduleMicrotask"));
  const capturedGlobal = found(scheduleMicrotask, /^"function" === typeof (\w+) \? \1 : \w+$/, "which global scheduleMicrotask captures");
  // The job queued in the microtask: a conditional on the execution context, which runs processRootScheduleInMicrotask when React is not rendering or
  // committing, and otherwise queues the same job as an Immediate task.
  const job = microtaskCall.arguments[0];
  assert.ok(job && ts.isFunctionExpression(job), "The flag branch no longer hands scheduleMicrotask a function");
  const jobBody = text(job.body);
  const jobName = found(jobBody, /: (\w+)\(\);? \}$/, "the job the microtask runs");
  const taskFunction = text(taskCall.expression);
  const priority = text(taskCall.arguments[0]);
  const taskName = text(taskCall.arguments[1]);
  const taskText = text(need(functions, taskName, taskName));
  // processRootScheduleInMicrotask: it clears the one-job-per-turn guard first, then flushes the sync work of every root in the same call, so the commit
  // is inside the job; ensureRootIsScheduled queues that job once per turn.
  const process = text(need(functions, jobName, jobName));
  const ensure = text(need(functions, "ensureRootIsScheduled", "ensureRootIsScheduled"));
  const resolve = text(need(functions, "resolveUpdatePriority", "resolveUpdatePriority"));
  return {
    flagGlobal, capturedGlobal,
    flagBranch: {condition: flagVariable, whenTrue: microtaskCall.expression.text, whenFalse: taskFunction, priority, task: taskName},
    jobQueuedOutsideRenderOrCommit: jobBody.includes("0 !== (executionContext & 6) ?") && jobBody.includes(`${taskFunction}(${priority}, ${taskName})`),
    immediateTaskRunsTheJob: taskText.includes(`${jobName}()`),
    jobFlushesSyncWork: process.includes("= didScheduleMicrotask = !1") && process.includes("flushSyncWorkAcrossRoots_impl(0, !1)"),
    oneJobPerTurn: ensure.includes("didScheduleMicrotask || ((didScheduleMicrotask = !0), scheduleImmediateRootScheduleTask())"),
    discreteIsSync: /case FabricDiscretePriority:\s*return 2;/.test(source) && resolve.includes("fabricGetCurrentEventPriority"),
  };
}

// RN's RuntimeScheduler and what feeds it, from the C++: the timeout of each priority, that a task is followed by a microtask checkpoint before the next
// one is chosen, that the smallest expiration runs first, and that the work a press handler runs in is itself an Immediate task.
function schedulerFacts(rn) {
  const utils = rn("ReactCommon/react/renderer/runtimescheduler/SchedulerPriorityUtils.h");
  const modern = rn("ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler_Modern.cpp");
  const task = rn("ReactCommon/react/renderer/runtimescheduler/Task.h");
  const beat = rn("ReactCommon/react/renderer/core/EventBeat.cpp");
  const timeouts = {};
  for (const match of utils.matchAll(/case SchedulerPriority::(\w+)Priority:\s*return HighResDuration::fromChrono\(std::chrono::(milliseconds|seconds|minutes)\((\d+)\)\);/g)) {
    timeouts[match[1]] = Number(match[3]) * unitMilliseconds[match[2]];
  }
  assert.deepEqual(sorted(Object.keys(timeouts)), ["Idle", "Immediate", "Low", "Normal", "UserBlocking"], "SchedulerPriorityUtils.h no longer gives every priority a timeout");
  const raw = {};
  for (const match of utils.matchAll(/case (\d):\s*return SchedulerPriority::(\w+)Priority;/g)) {
    raw[Number(match[1])] = match[2];
  }
  const tick = cppFunction(modern, "void RuntimeScheduler_Modern::runEventLoopTick(");
  const loop = cppFunction(modern, "void RuntimeScheduler_Modern::runEventLoop(");
  const scheduleWork = cppFunction(modern, "void RuntimeScheduler_Modern::scheduleWork(");
  const induce = cppFunction(beat, "void EventBeat::induce() const {");
  return {
    timeouts, raw,
    checkpointAfterEachTask: tick.indexOf("executeTask(runtime, task, didUserCallbackTimeout);") !== -1 &&
      tick.indexOf("executeTask(") < tick.indexOf("performMicrotaskCheckpoint(runtime);") && tick.indexOf("performMicrotaskCheckpoint(runtime);") < tick.indexOf("updateRendering("),
    loopChoosesAfterEachTick: loop.indexOf("runEventLoopTick(runtime, *topPriorityTask);") !== -1 &&
      loop.indexOf("runEventLoopTick(") < loop.lastIndexOf("topPriorityTask = selectTask();"),
    smallestExpirationFirst: task.includes("return lhs->expirationTime > rhs->expirationTime;"),
    workIsImmediate: scheduleWork.includes("scheduleTask(SchedulerPriority::ImmediatePriority, std::move(callback));"),
    beatIsAScheduledTask: induce.includes("runtimeScheduler_.scheduleWork(std::move(beat));"),
  };
}

// How a press becomes a discrete update, from the pinned C++ and the renderer: the touch end is the end of a continuous gesture; with the default of the
// flag that fixes the mapping, the processor resets its state on the end and gives it the Discrete priority, which the renderer maps to the sync lane.
function eventFacts(rn) {
  const emitter = rn("ReactCommon/react/renderer/components/view/TouchEventEmitter.cpp");
  const processor = rn("ReactCommon/react/renderer/core/EventQueueProcessor.cpp");
  const defaults = rn("ReactCommon/react/featureflags/ReactNativeFeatureFlagsDefaults.h");
  const fixedMapping = found(defaults, /bool fixMappingOfEventPrioritiesBetweenFabricAndReact\(\) override \{\s*return (true|false);/, "the default of the event priority mapping") === "true";
  const touchEndIsContinuousEnd = /"touchEnd", std::move\(event\), RawEvent::Category::ContinuousEnd/.test(emitter);
  const legacy = processor.slice(processor.indexOf("} else {\n      if (event.category == RawEvent::Category::ContinuousEnd) {"));
  const endResetsThenDiscrete = legacy.includes("hasContinuousEventStarted_ = false;") &&
    legacy.indexOf("hasContinuousEventStarted_ = false;") < legacy.indexOf("reactPriority = hasContinuousEventStarted_ ? ReactEventPriority::Default") &&
    legacy.includes(": ReactEventPriority::Discrete;");
  return {fixedMapping, touchEndIsContinuousEnd, endResetsThenDiscrete, discretePressIsSync: !fixedMapping && touchEndIsContinuousEnd && endResetsThenDiscrete};
}

// The host's own order, from its source: a timer registered while a pump drains the work queue is taken by the next pump, after the scheduler's loop of this
// one, and the host drains the microtasks after each item of the queue.
function hostFacts(base) {
  const source = readFileSync(path.join(base, "native/application_runtime.cpp"), "utf8");
  const pump = source.slice(source.indexOf("void pump(bool frame_tick = false) {"), source.indexOf("void unmount(int id, bool legacy_hook = false) {"));
  const takeDue = pump.indexOf("timer_registry->take_due(now_ms())");
  const drain = pump.indexOf("for (int limit = 0; !stop_requested && !work.empty() && limit < 256; ++limit) {");
  const checkpoint = pump.indexOf("if (!stop_requested) runtime->drainMicrotasks();", drain);
  return {timersTakenBeforeTheWorkDrain: takeDue !== -1 && drain !== -1 && takeDue < drain, drainsAfterEachWorkItem: drain !== -1 && checkpoint > drain};
}

// RN's immediateShim run in V8, so that setImmediate defers as RN's own JavaScript says: through the global queueMicrotask.
async function immediateShimBundle() {
  const result = await build({absWorkingDir: root, stdin: {contents: `
import {setImmediate, clearImmediate} from "react-native/Libraries/Core/Timers/immediateShim";
globalThis.__immediateShim = {setImmediate, clearImmediate};
`, resolveDir: root, sourcefile: "react-microtasks-immediate-entry.js"}, bundle: true, write: false, platform: "neutral", format: "iife",
  define: {"process.env.NODE_ENV": '"production"', __DEV__: "false"}, mainFields: ["main"], resolveExtensions: godotExtensions,
  plugins: [platformPlugin(path.join(root, "src"), id => requireSdk.resolve(id))]});
  return result.outputFiles[0].text;
}

// One macrotask of Node: every microtask that is pending, and those they queue, runs first, in V8's order.
const macrotask = () => new Promise(resolve => setImmediate(resolve));

// The model of one handler, run by the host's event loop as RN's RuntimeScheduler runs it: the handler is the body of an Immediate task (the event beat),
// a microtask checkpoint follows every task, the scheduler then picks the task with the smallest expiration, and a timer registered in the handler runs
// after the scheduler has nothing left (the host takes it in the next pump). `flag` decides where React's job goes when a sync-lane update asks for it:
// into the microtask queue, or into the scheduler as an Immediate task. Tasks queued within one handler differ in expiration by their priority's timeout
// and by nothing else that matters: the handler queues them in a few microseconds, the smallest difference between two timeouts is 250 ms.
async function simulate(testCase, flag, facts, shim) {
  const marks = [];
  const mark = (label, detail = null) => marks.push(detail === null ? label : `${label}:${detail}`);
  const context = vm.createContext({});
  vm.runInContext("globalThis.global = globalThis;", context);
  context.queueMicrotask = queueMicrotask;
  vm.runInContext(shim, context);
  const tasks = [];
  const timers = [];
  let sequence = 0;
  const schedule = (priorityName, callback) => tasks.push({timeout: facts.scheduler.timeouts[priorityName], sequence: sequence++, callback});
  const rawPriority = value => {
    assert.ok(facts.scheduler.raw[value], `${value} is no RuntimeScheduler priority`);
    return facts.scheduler.raw[value];
  };
  let pending = 0;
  let queued = false;
  const reactJob = () => {
    queued = false;
    mark("commit", pending);
    pending = 0;
  };
  const env = {
    mark,
    // ensureRootIsScheduled queues the job once per turn, where scheduleImmediateRootScheduleTask puts it for this flag.
    setState: () => {
      pending += 1;
      if (!queued) {
        queued = true;
        if (flag) {
          queueMicrotask(reactJob);
        } else {
          schedule("Immediate", reactJob);
        }
      }
    },
    scheduler: {unstable_scheduleCallback: (priority, callback) => schedule(rawPriority(priority), callback)},
    queueMicrotask: callback => queueMicrotask(callback),
    Promise: vm.runInContext("Promise", context),
    setImmediate: callback => context.__immediateShim.setImmediate(callback),
    setTimeout: callback => timers.push(callback),
    finish: () => {},
  };
  // The handler is a task: its body, then the checkpoint.
  runCase(testCase, env);
  await macrotask();
  const runTasks = async () => {
    while (tasks.length > 0) {
      tasks.sort((a, b) => a.timeout - b.timeout || a.sequence - b.sequence);
      tasks.shift().callback();
      await macrotask();
    }
  };
  await runTasks();
  while (timers.length > 0) {
    timers.shift()();
    await macrotask();
    await runTasks();
  }
  return marks;
}

// What RN 0.87.1 does, from the pinned sources under `base` and from running its JavaScript in V8.
export async function rnExpectations(base = root) {
  const rnBase = path.join(base, "node_modules/react-native");
  const rn = file => readFileSync(path.join(rnBase, file), "utf8");

  // setUpTimers.js, its RN$Bridgeless branch: the flag, and where queueMicrotask and setImmediate come from.
  const timers = rn("Libraries/Core/setUpTimers.js");
  const bridgeless = timers.slice(timers.indexOf("if (global.RN$Bridgeless === true) {"), timers.indexOf("} else {\n  /**"));
  assert.ok(bridgeless.length > 0 && !bridgeless.includes("JSTimers"), "setUpTimers.js no longer has a bridgeless branch of its own");
  const flagName = found(bridgeless, /global\.(RN\$\w+) = (?:true|false);/, "which flag the bridgeless branch sets");
  const flag = found(bridgeless, /global\.RN\$\w+ = (true|false);/, "the flag's value") === "true";
  const queueSpec = found(bridgeless, /polyfillGlobal\(\s*'queueMicrotask',\s*\(\) =>\s*require\('([^']+)'\)\s*\.default\.queueMicrotask,?\s*\);/, "where queueMicrotask comes from");
  const immediateSource = found(bridgeless, /polyfillGlobal\(\s*'setImmediate',\s*\(\) => require\('([^']+)'\)\.setImmediate,?\s*\);/, "where setImmediate comes from");

  // The spec module and the C++ it names: the module's name, its one method, and that the method queues on the runtime's microtask queue.
  const specFile = path.posix.normalize(path.posix.join("Libraries/Core", queueSpec)) + ".js";
  const spec = rn(specFile);
  const moduleName = found(spec, /getEnforcing<Spec>\(\s*'(\w+)',?\s*\)/, "the module's name");
  const methods = [...spec.matchAll(/readonly (\w+): \(/g)].map(match => match[1]);
  const cpp = rn("ReactCommon/react/nativemodule/microtasks/NativeMicrotasks.cpp");
  const queuesOnTheRuntime = /void NativeMicrotasks::queueMicrotask\(\s*jsi::Runtime& runtime,\s*jsi::Function callback\) \{\s*runtime\.queueMicrotask\(callback\);\s*\}/.test(cpp);
  assert.ok(queuesOnTheRuntime, "NativeMicrotasks.cpp no longer queues on the runtime's microtask queue");
  // The portable shim this slice replaced is a job on a resolved Promise.
  const shim = rn("Libraries/Core/Timers/queueMicrotask.js");
  assert.match(shim, /\(resolvedPromise \|\| \(resolvedPromise = Promise\.resolve\(\)\)\)\s*\.then\(callback\)/, "The portable queueMicrotask is no longer a Promise job");

  const renderer = rendererFacts(rn("Libraries/Renderer/implementations/ReactFabric-prod.js"));
  const scheduler = schedulerFacts(rn);
  const events = eventFacts(rn);
  const host = hostFacts(base);
  assert.equal(renderer.flagGlobal, flagName, "The renderer reads the flag setUpTimers sets");
  assert.equal(renderer.capturedGlobal, "queueMicrotask", "The renderer captures the queueMicrotask global");
  // The priorities the cases pass are RN's: the raw values the scheduler binding takes.
  assert.deepEqual(Object.entries(priorities).map(([name, value]) => [name, scheduler.raw[value]]),
    [["immediate", "Immediate"], ["userBlocking", "UserBlocking"], ["normal", "Normal"]], "The case priorities are the RuntimeScheduler's raw values");
  assert.equal(renderer.flagBranch.priority, "ImmediatePriority", "The flag-off branch queues an Immediate-priority task");

  const shimText = await immediateShimBundle();
  const facts = {scheduler};
  const orders = {on: {}, off: {}};
  for (const testCase of cases) {
    orders.on[testCase.name] = await simulate(testCase, true, facts, shimText);
    orders.off[testCase.name] = await simulate(testCase, false, facts, shimText);
  }
  const differing = cases.filter(testCase => !same(orders.on[testCase.name], orders.off[testCase.name])).map(testCase => testCase.name);
  return {flagName, flag, queueSpec, specFile, moduleName, methods, immediateSource, queuesOnTheRuntime, renderer, scheduler, events, host, orders, differing, bulk};
}

// What the oracle checks of the facts themselves: the claims the probe's expectations stand on. They are a property of RN's sources, not of a report.
function assertFacts(expected) {
  assert.equal(expected.flag, true, "RN bridgeless sets the flag to true");
  assert.equal(expected.moduleName, "NativeMicrotasksCxx");
  assert.deepEqual(expected.methods, ["queueMicrotask"]);
  assert.equal(expected.immediateSource, "./Timers/immediateShim");
  assert.equal(expected.renderer.flagBranch.whenTrue, "scheduleMicrotask");
  assert.ok(expected.renderer.jobQueuedOutsideRenderOrCommit && expected.renderer.immediateTaskRunsTheJob && expected.renderer.jobFlushesSyncWork &&
    expected.renderer.oneJobPerTurn && expected.renderer.discreteIsSync, "The renderer's job commits sync work in the call, once per turn, for a discrete event");
  assert.ok(expected.scheduler.checkpointAfterEachTask && expected.scheduler.loopChoosesAfterEachTick && expected.scheduler.smallestExpirationFirst &&
    expected.scheduler.workIsImmediate && expected.scheduler.beatIsAScheduledTask, "The RuntimeScheduler runs the handler's task, drains the microtasks, then chooses the next task");
  assert.ok(expected.events.discretePressIsSync, "A press release reaches React as a discrete event");
  assert.ok(expected.host.timersTakenBeforeTheWorkDrain && expected.host.drainsAfterEachWorkItem,
    "The host takes due timers before it drains the work queue, and drains microtasks after each item");
  // The cases are worth running only if the flag changes at least two of them, and the microtask queue alone does not depend on it.
  assert.ok(expected.differing.length >= 2, "At least two cases come out in another order with the flag off: " + expected.differing);
  assert.deepEqual(expected.orders.on.fifo, expected.orders.off.fifo, "The queue alone does not depend on the flag");
  assert.deepEqual(sorted(Object.keys(expected.orders.on)), sorted(cases.map(testCase => testCase.name)));
}

const labels = record => (record?.marks ?? []).map(entry => entry.detail === null ? entry.label : `${entry.label}:${entry.detail}`);
const errorsOf = snapshot => snapshot?.errors ?? [];
const callsOf = snapshot => snapshot?.nativeModules?.microtasks?.calls ?? -1;

// The first read of the flag and of the function the renderer captures, and the writes before them, from the log of the accessors.
function renderer(events) {
  const index = predicate => events.findIndex(predicate);
  const flagWrite = index(event => event.name === "RN$enableMicrotasksInReact" && event.op === "write" && event.value === true);
  const flagRead = index(event => event.name === "RN$enableMicrotasksInReact" && event.op === "read");
  const functionWrite = index(event => event.name === "queueMicrotask" && event.op === "write" && event.type === "function");
  const functionRead = index(event => event.name === "queueMicrotask" && event.op === "read" && event.type === "function");
  return {flagWrite, flagRead, functionWrite, functionRead, flagValue: events[flagRead]?.value, functionIsFinal: events[functionRead]?.final};
}

// Every verdict the probe gives, derived again from the raw observations of a report and from RN, in the probe's order and with its names.
export function derivedChecks(report, expected) {
  const stages = report.stages;
  const row = (name, passed) => ({name, passed});
  const environment = stages.environment ?? {};
  const mounted = stages.mount?.application;
  const native = environment.native ?? {};
  const seen = renderer(environment.events ?? []);
  const before = stages.host?.before ?? {};
  const queueMany = stages.queue_many ?? {};
  const drained = stages.drained ?? {};
  const many = drained.many ?? {};
  const gate = stages.gate?.state ?? {};
  const afterStop = stages.after_stop ?? {};
  const reentrant = stages.reentrant ?? {};
  const stop = stages.stop?.application;
  const rootState = stages.stop?.root;
  const caseRow = (key, name, sentence) => row(`${name}/${sentence}`, same(labels(stages[`case_${key}`]?.record), expected.orders.on[name]));

  return [
    row("mount/The root mounts through the original AppRegistry without a diagnostic",
      mounted?.rootCount === 1 && stages.mount.surfaceId > 0 && errorsOf(mounted).length === 0),
    row("flag/RN$enableMicrotasksInReact is written true by the host runtime before the renderer reads it, and the renderer reads true",
      expected.flag === true && seen.flagWrite >= 0 && seen.flagRead > seen.flagWrite && seen.flagValue === expected.flag),
    row("flag/The host runtime installs queueMicrotask before the renderer evaluates, and the renderer captures that function",
      seen.functionWrite >= 0 && seen.functionRead > seen.functionWrite && seen.functionIsFinal === true && seen.flagWrite < seen.flagRead),
    row("flag/The host defines no RN$enableMicrotasksInReact before the bundle, and queueMicrotask is a one-argument function once it has run",
      before.RN$enableMicrotasksInReact === "undefined" && environment.queueMicrotask?.type === "function" && environment.queueMicrotask.length === 1 &&
        environment.setImmediate?.type === "function"),
    row("module/RN's NativeMicrotasks spec module loads over the host's NativeMicrotasksCxx and exposes queueMicrotask",
      native.loaded === true && expected.moduleName === "NativeMicrotasksCxx" && same(expected.methods, ["queueMicrotask"]) && native.hasQueueMicrotask === true &&
        native.queueMicrotaskType === "function" && native.stableFunction === true),
    row("module/The registry serves RN's NativeMicrotasks module and counts the calls that reach it",
      Number.isInteger(stages.registry?.microtasks?.calls) && stages.registry.microtasks.calls >= 0),
    row("module/Each queueMicrotask call through the global reaches the C++ module once",
      queueMany.count === expected.bulk && queueMany.count > 1 && queueMany.after - queueMany.before === queueMany.count && queueMany.before >= 0),
    row("module/The host drains the callbacks it queued on the module's microtask queue",
      many.queued === expected.bulk && many.ran === many.queued),
    row("module/setImmediate, RN's shim over queueMicrotask, reaches the C++ module through the global and runs",
      drained.callsAfter - drained.callsBefore === 1 && drained.callsBefore >= 0 && drained.immediate?.ran === true),
    caseRow("fifo", "fifo", "Promise reactions, microtasks and an immediate run in the order they were queued, nested ones behind them, before the next RuntimeScheduler task and a timer"),
    caseRow("react_microtask", "react-microtask", "A sync-lane update commits in a microtask: after the microtask queued before it, ahead of the microtask and the Promise reaction queued after it"),
    caseRow("react_tasks", "react-tasks", "The commit comes before every task queued earlier through the RuntimeScheduler, an Immediate one included, and before a timer"),
    caseRow("react_batched", "react-batched", "Two updates in one handler are one commit, ahead of the microtasks queued between and after them"),
    row("gate/A microtask, an immediate and a Promise reaction queued before the application stops complete first, while it is still alive",
      gate.queued === true && gate.microtaskAlive === true && gate.immediateAlive === true && gate.promiseAlive === true),
    row("gate/Stop unmounts the root through React's own microtask: the update pending at the stop is not lost, and the root's effect cleanup runs once",
      gate.cleanups === 1),
    row("gate/Once the application has stopped, queueMicrotask schedules nothing, does not reach the module, and nothing queued then runs",
      afterStop.result?.threw === false && afterStop.calls === callsOf(stop) && afterStop.calls >= 0 && afterStop.ran === false),
    row("lifecycle/Stop releases the root, and all native Controls of the root are balanced",
      stop?.stopped === true && stop.rootCount === 0 && (rootState?.nativeTags ?? -1) === 0 && (rootState?.creates ?? 0) === (rootState?.deletes ?? -1)),
    row("reentrant/A stop requested by a native signal in the middle of a commit still unmounts the root: React queues its next job after the request, and the gate does not refuse it",
      reentrant.controlFound === true && reentrant.requests >= 1 && reentrant.application?.stopped === true && reentrant.application.rootCount === 0 &&
        reentrant.state?.cleanups === 1),
    row("report/The React microtasks report is saved with any normative failure visible", true),
  ];
}

// The report judged against RN. It holds only for a report of the current host and SDK: every derived verdict must be true and be the verdict the
// report gave, and the orders the host produced must be the model's.
export function verifyReactMicrotasksReport(report, expected) {
  assertFacts(expected);
  const derived = derivedChecks(report, expected);
  assert.deepEqual(derived.map(row => row.name), report.checks.map(row => row.name), "The oracle checks what the probe checks");
  const failing = derived.filter(row => !row.passed).map(row => row.name);
  assert.deepEqual(failing, [], `The oracle fails ${failing.length} check(s), the first of them ${failing[0]}`);
  assert.deepEqual(derived, report.checks, "The oracle derives the verdicts the probe gave");
  // The probe's own written-out expectations are the model's orders with the flag on.
  assert.deepEqual(report.orders, expected.orders.on, "The probe judges by the order the oracle derives");
  // Every case ran once, from one press each, and finished by its own last timer.
  for (const testCase of cases) {
    const outcome = report.stages[`case_${testCase.name.replace("-", "_")}`];
    assert.equal(outcome.armed, true, `${testCase.name} was armed`);
    assert.equal(outcome.record.done, true, `${testCase.name} finished`);
  }
  return derived;
}

// Whether the orders a report observed are the model's for the flag the report's renderer read: the flag-unset sabotage must come out in the order the
// model derives for the flag off, which says the model describes this host and not only the lane that passes. Null when they are, else the first difference.
export function explainedByModel(report, expected) {
  const seen = renderer(report.stages?.environment?.events ?? []);
  const flag = seen.flagRead >= 0 && seen.flagValue === true;
  const modelled = flag ? expected.orders.on : expected.orders.off;
  for (const testCase of cases) {
    const observed = labels(report.stages[`case_${testCase.name.replace("-", "_")}`]?.record);
    if (!same(observed, modelled[testCase.name])) {
      return `${testCase.name} came out as ${observed.join(",")} where the model for the flag ${flag ? "on" : "off"} says ${modelled[testCase.name].join(",")}`;
    }
  }
  return null;
}

// The oracle's first complaint about a report whose checks all claim to pass, or null when it accepts it.
export function oracleRejection(report, expected) {
  try {
    verifyReactMicrotasksReport({...report, checks: report.checks.map(row => ({...row, passed: true}))}, expected);
  } catch (error) {
    return String(error.message).split("\n")[0];
  }
  return null;
}
