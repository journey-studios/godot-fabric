import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {isDeepStrictEqual} from "node:util";
import vm from "node:vm";
import {bulk, cases, priorities, runCase, spins} from "./idle-callbacks-cases.mjs";
import {cppFunction, found, hostFacts, immediateShimBundle, schedulerFacts} from "./react-microtasks-oracle.mjs";

// The independent oracle of the idle callbacks slice (GF-05 slice D2). It is written from RN, not from the probe, in three ways:
//   - the facts RN's sources state are read out of the pinned files: what setUpTimers' bridgeless branch installs and from where, the spec of the
//     NativeIdleCallbacks module, its C++ (the 50 ms deadline, the timeout option that only drives didTimeout, the timeRemaining rules, the handle and the
//     cancel), and what the RuntimeScheduler does with an idle task: the priority timeouts, the default timeout of an idle task, the smallest expiration
//     first, the yield, the cancel and the checkpoint after each task;
//   - the order each case of tests/idle-callbacks-cases.mjs comes out in, and what each idle callback is told, is derived by running it through a model of
//     the host's event loop in which the scheduler is the C++ one (a queue ordered by expiration, with the rules read from the files) over a virtual clock
//     that only a spin advances, and the microtask queue is V8's own (Promise reactions, queueMicrotask and RN's immediateShim run in a vm context);
//   - the readings of timeRemaining are judged against the real clock: the callback is told the time it started, so a reading lies between what the
//     request and the reading allow, which the oracle derives from the timestamps the report carries and the 50 ms of the source, and not from a count.
// The report's raw observations are judged against that, and every verdict the probe gave is derived again here and must agree.

const same = isDeepStrictEqual;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const squash = text => text.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").replace(/ \./g, ".").trim();
const epsilon = 1e-6;
const sorted = values => [...values].sort();

const unitMilliseconds = {milliseconds: 1, seconds: 1000, minutes: 60000};

// What setUpTimers.js, its RN$Bridgeless branch, installs: each polyfillGlobal with the module it requires and the member it takes.
function installsOf(bridgeless) {
  const installs = {};
  for (const match of bridgeless.matchAll(/polyfillGlobal\(\s*'(\w+)',\s*\(\) =>\s*require\('([^']+)'\)\s*(?:\.default)?\.(\w+),?\s*\);/g)) {
    installs[match[1]] = {module: match[2], member: match[3]};
  }
  return installs;
}

// NativeIdleCallbacks.cpp, by the structure of its text.
function idleFacts(cpp, header) {
  const request = squash(cppFunction(cpp, "CallbackHandle NativeIdleCallbacks::requestIdleCallback("));
  const cancel = squash(cppFunction(cpp, "void NativeIdleCallbacks::cancelIdleCallback("));
  const remaining = squash(cppFunction(cpp, "jsi::Function makeTimeRemainingFunction("));
  return {
    deadlineMs: Number(found(request, /executionStartTime \+ HighResDuration::fromMilliseconds\((\d+)\)/, "the length of the deadline")),
    deadlineKeys: [...request.matchAll(/idleDeadline\.setProperty\(runtime, "(\w+)"/g)].map(match => match[1]).sort(),
    didTimeoutRule: request.includes("auto didTimeout = expirationTime.has_value() ? executionStartTime > expirationTime : false;"),
    // The timeout option sets an expiration time only when it is positive, and it is the only thing it does: the local `timeout` that would reach the
    // scheduler is declared and never assigned, so the task takes the scheduler's default timeout.
    timeoutOption: request.includes("if (userTimeout > HighResDuration::zero()) { expirationTime = runtimeScheduler->now() + userTimeout; }"),
    timeoutNeverScheduled: request.includes("std::optional<HighResDuration> timeout;") && !/(?<![A-Za-z.])timeout\s*=(?!=)/.test(request)
      && request.includes("task = runtimeScheduler->scheduleIdleTask(std::move(wrappedCallback), timeout.value());")
      && request.includes("task = runtimeScheduler->scheduleIdleTask(std::move(wrappedCallback));"),
    handleHoldsTheTask: request.includes("taskHandle.setNativeState(runtime, std::move(taskNativeState));") && request.includes("std::make_shared<IdleTaskRef>(task)"),
    legacyThrows: request.includes("requestIdleCallback is not supported in legacy runtime scheduler"),
    // timeRemaining: zero once expired; not expired, it yields to the scheduler or measures the deadline against now, and zero ends it for good.
    remainingRules: remaining.includes("double remainingTime = 0;") && remaining.includes("if (!expired) {")
      && remaining.includes("if (runtimeScheduler->getShouldYield()) { expired = true; }")
      && remaining.includes("remainingTime = std::max(diff.toDOMHighResTimeStamp(), 0.0);")
      && remaining.includes("if (remainingTime == 0) { expired = true; }") && remaining.includes("auto diff = deadline - now;"),
    cancelRules: cancel.includes("if (!handle.hasNativeState(runtime)) { return; }") && cancel.includes("std::dynamic_pointer_cast<IdleTaskRef>(handle.getNativeState(runtime))")
      && cancel.includes("runtimeScheduler->cancelTask(*taskHandle->task);"),
    cancelTakesAnObject: header.includes("void cancelIdleCallback(jsi::Runtime &runtime, jsi::Object handle);"),
  };
}

// getResolvedTimeoutForIdleTask: a custom timeout shorter than the idle priority's is added to the Low priority's; any other is kept.
const resolveIdleTimeout = (custom, timeouts) => custom < timeouts.Idle ? timeouts.Low + custom : custom;

// What the RuntimeScheduler does with an idle task, beyond what the microtasks slice reads: the timeout of an idle task, the yield, the cancel.
function idleSchedulerFacts(rn, timeouts) {
  const modern = rn("ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler_Modern.cpp");
  const header = squash(rn("ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler.h"));
  const task = rn("ReactCommon/react/renderer/runtimescheduler/Task.cpp");
  const resolved = squash(cppFunction(modern, "HighResDuration getResolvedTimeoutForIdleTask("));
  const idle = squash(cppFunction(modern, "std::shared_ptr<Task> RuntimeScheduler_Modern::scheduleIdleTask(\n    RawCallback&& callback,"));
  const yields = squash(cppFunction(modern, "bool RuntimeScheduler_Modern::getShouldYield()"));
  const select = squash(cppFunction(modern, "std::shared_ptr<Task> RuntimeScheduler_Modern::selectTask()"));
  const cancel = squash(cppFunction(modern, "void RuntimeScheduler_Modern::cancelTask("));
  const execute = squash(cppFunction(task, "jsi::Value Task::execute("));
  return {
    // The raw-callback overload that NativeIdleCallbacks reaches takes the idle priority's timeout by default, and resolves a custom one.
    defaultIsIdleTimeout: header.includes("std::shared_ptr<Task> scheduleIdleTask(RawCallback &&callback, HighResDuration timeout = timeoutForSchedulerPriority(SchedulerPriority::IdlePriority)) noexcept override;"),
    resolvesCustomTimeouts: resolved.includes("return customTimeout < timeoutForSchedulerPriority(SchedulerPriority::IdlePriority) ? timeoutForSchedulerPriority(SchedulerPriority::LowPriority) + customTimeout : customTimeout;"),
    idleTaskPriority: idle.includes("auto expirationTime = now_() + getResolvedTimeoutForIdleTask(customTimeout);") && idle.includes("SchedulerPriority::IdlePriority, std::move(callback), expirationTime"),
    yieldRule: yields.includes("return syncTaskRequests_ > 0 || (!taskQueue_.empty() && taskQueue_.top().get() != currentTask_);"),
    selectSkipsCanceled: select.includes("while (!taskQueue_.empty() && !taskQueue_.top()->callback) { taskQueue_.pop(); }"),
    cancelDropsTheCallback: cancel.includes("task.callback.reset();"),
    executeClearsTheCallback: execute.includes("callback.reset();") && execute.indexOf("callback.reset();") < execute.indexOf("std::get<RawCallback>(originalCallback)(runtime);"),
    // The timeout the task is scheduled with: the default, the idle priority's, resolved as the scheduler resolves a custom one.
    idleTimeoutMs: resolveIdleTimeout(timeouts.Idle, timeouts),
    modernOnly: rn("ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler.cpp").includes("#ifndef RCT_REMOVE_LEGACY_ARCH\n  if (ReactNativeFeatureFlags::enableBridgelessArchitecture()) {\n#endif\n    return std::make_unique<RuntimeScheduler_Modern>("),
  };
}

// The model of one handler, run by the host's event loop as RN's RuntimeScheduler runs it. The scheduler is the C++ one: a queue of tasks with an expiration, the
// smallest first, which keeps a task that has run or was canceled until selectTask pops it, and whose yield is that the top of the queue is not the task that is
// running. The clock is virtual: it moves by the milliseconds a spin asks for and by nothing else, and an idle callback is told what the C++ tells it from that clock.
// The handler is the body of an Immediate task (the event beat), a microtask checkpoint follows every task, and a timer registered in the handler runs after the
// scheduler has nothing left (the host takes it in the next pump).
async function simulate(testCase, facts, shim) {
  const marks = [];
  const idle = {};
  const context = vm.createContext({});
  vm.runInContext("globalThis.global = globalThis;", context);
  context.queueMicrotask = queueMicrotask;
  vm.runInContext(shim, context);
  const timers = [];
  const queue = [];
  let sequence = 0;
  let clock = 0;
  let current = null;
  const order = (a, b) => a.expiration - b.expiration || a.sequence - b.sequence;
  const top = () => queue.reduce((best, task) => best === null || order(task, best) < 0 ? task : best, null);
  const add = (expiration, callback) => {
    const task = {expiration, sequence: sequence++, callback};
    queue.push(task);
    return task;
  };
  const rawPriority = value => {
    assert.ok(facts.scheduler.raw[value], `${value} is no RuntimeScheduler priority`);
    return facts.scheduler.raw[value];
  };
  const selectTask = () => {
    while (queue.length > 0 && top().callback === null) {
      queue.splice(queue.indexOf(top()), 1);
    }
    return queue.length === 0 ? null : top();
  };
  const env = {
    mark: label => marks.push(label),
    spin: ms => {
      clock += ms;
    },
    scheduler: {unstable_scheduleCallback: (priority, callback) => add(clock + facts.scheduler.timeouts[rawPriority(priority)], callback)},
    queueMicrotask: callback => queueMicrotask(callback),
    Promise: vm.runInContext("Promise", context),
    setImmediate: callback => context.__immediateShim.setImmediate(callback),
    setTimeout: callback => timers.push(callback),
    finish: () => {},
    // NativeIdleCallbacks::requestIdleCallback: the expiration time only for a positive timeout, the task at the idle priority with the default timeout.
    requestIdleCallback: (owner, callback, options) => {
      const timeout = options[0]?.timeout;
      const expiration = timeout !== undefined && timeout > 0 ? clock + timeout : null;
      const task = add(clock + facts.idle.scheduler.idleTimeoutMs, () => {
        const start = clock;
        const deadline = start + facts.idle.deadlineMs;
        const didTimeout = expiration !== null && start > expiration;
        let expired = false;
        idle[owner] = {didTimeout, samples: []};
        callback({didTimeout, timeRemaining() {
          let remaining = 0;
          if (!expired) {
            if (top() !== current) {
              expired = true;
            } else {
              remaining = Math.max(deadline - clock, 0);
              if (remaining === 0) {
                expired = true;
              }
            }
          }
          return remaining;
        }});
      });
      return task;
    },
    idleStart: () => {},
    measure: (owner, label, deadline) => idle[owner].samples.push({label, value: deadline.timeRemaining()}),
    cancelIdleCallback: handle => {
      handle.callback = null;
    },
  };
  runCase(testCase, env);
  await macrotask();
  const runTasks = async () => {
    for (let task = selectTask(); task !== null; task = selectTask()) {
      current = task;
      const callback = task.callback;
      task.callback = null;
      callback();
      await macrotask();
      current = null;
    }
  };
  await runTasks();
  while (timers.length > 0) {
    timers.shift()();
    await macrotask();
    await runTasks();
  }
  return {labels: marks, idle};
}

// One macrotask of Node: every microtask that is pending, and those they queue, runs first, in V8's order.
const macrotask = () => new Promise(resolve => setImmediate(resolve));

// What RN 0.87.1 does, from the pinned sources under `base` and from running its JavaScript in V8.
export async function idleExpectations(base = root) {
  const rn = file => readFileSync(path.join(base, "node_modules/react-native", file), "utf8");

  // setUpTimers.js, its RN$Bridgeless branch: the flag, and where each global comes from.
  const timers = rn("Libraries/Core/setUpTimers.js");
  const bridgeless = timers.slice(timers.indexOf("if (global.RN$Bridgeless === true) {"), timers.indexOf("} else {\n  /**"));
  assert.ok(bridgeless.length > 0 && !bridgeless.includes("JSTimers"), "setUpTimers.js no longer has a bridgeless branch of its own");
  const flagName = found(bridgeless, /global\.(RN\$\w+) = (?:true|false);/, "which flag the bridgeless branch sets");
  const flag = found(bridgeless, /global\.RN\$\w+ = (true|false);/, "the flag's value") === "true";
  const installs = installsOf(bridgeless);

  // The spec module and the C++ it names.
  const specFile = path.posix.normalize(path.posix.join("Libraries/Core", installs.requestIdleCallback.module)) + ".js";
  const spec = rn(specFile);
  const moduleName = found(spec, /getEnforcing<Spec>\(\s*'(\w+)',?\s*\)/, "the module's name");
  const methods = [...spec.matchAll(/readonly (\w+): \(/g)].map(match => match[1]);
  const idle = idleFacts(rn("ReactCommon/react/nativemodule/idlecallbacks/NativeIdleCallbacks.cpp"), rn("ReactCommon/react/nativemodule/idlecallbacks/NativeIdleCallbacks.h"));

  const scheduler = schedulerFacts(rn);
  idle.scheduler = idleSchedulerFacts(rn, scheduler.timeouts);
  const host = hostFacts(base);
  // The host compiles RN with RCT_REMOVE_LEGACY_ARCH, so its RuntimeScheduler is always the modern one that supports idle tasks.
  const cmake = readFileSync(path.join(base, "native/CMakeLists.txt"), "utf8");
  host.compilesWithoutLegacyArch = /RCT_REMOVE_LEGACY_ARCH=1/.test(cmake);
  // The priorities the cases pass are RN's: the raw values the scheduler binding takes.
  assert.deepEqual(Object.entries(priorities).map(([name, value]) => [name, scheduler.raw[value]]),
    [["immediate", "Immediate"], ["userBlocking", "UserBlocking"], ["normal", "Normal"]], "The case priorities are the RuntimeScheduler's raw values");

  const shim = await immediateShimBundle();
  const facts = {scheduler, idle};
  const models = {};
  for (const testCase of cases) {
    models[testCase.name] = await simulate(testCase, facts, shim);
  }
  const orders = Object.fromEntries(cases.map(testCase => [testCase.name, models[testCase.name].labels]));
  // Which readings are zero because the scheduler yields or the deadline is past, and which depend on the clock.
  const samples = Object.fromEntries(cases.filter(testCase => Object.values(models[testCase.name].idle).some(entry => entry.samples.length > 0)).map(testCase => [testCase.name,
    Object.fromEntries(Object.values(models[testCase.name].idle).flatMap(entry => entry.samples).map(sample => [sample.label, sample.value === 0 ? "zero" : "timed"]))]));
  const didTimeout = Object.fromEntries(cases.map(testCase => [testCase.name, Object.fromEntries(Object.entries(models[testCase.name].idle).map(([owner, entry]) => [owner, entry.didTimeout]))]));
  return {flagName, flag, installs, specFile, moduleName, methods, idle, scheduler, host, orders, samples, didTimeout, models, bulk, spins};
}

// What the oracle checks of the facts themselves: the claims the probe's expectations stand on. They are a property of RN's sources, not of a report.
function assertFacts(expected) {
  assert.equal(expected.flag, true, "RN bridgeless sets the flag to true");
  assert.deepEqual(Object.keys(expected.installs).sort(), ["cancelIdleCallback", "clearImmediate", "queueMicrotask", "requestIdleCallback", "setImmediate"]);
  for (const [name, install] of Object.entries(expected.installs)) {
    assert.equal(install.member, name, `${name} is installed from the member of the same name`);
  }
  assert.equal(expected.installs.setImmediate.module, "./Timers/immediateShim");
  assert.equal(expected.installs.clearImmediate.module, "./Timers/immediateShim");
  assert.equal(expected.installs.queueMicrotask.module, "../../src/private/webapis/microtasks/specs/NativeMicrotasks");
  assert.equal(expected.installs.requestIdleCallback.module, expected.installs.cancelIdleCallback.module);
  assert.equal(expected.moduleName, "NativeIdleCallbacksCxx");
  assert.deepEqual(expected.methods, ["requestIdleCallback", "cancelIdleCallback"]);
  const {idle} = expected;
  assert.equal(idle.deadlineMs, 50);
  assert.deepEqual(idle.deadlineKeys, ["didTimeout", "timeRemaining"]);
  for (const key of ["didTimeoutRule", "timeoutOption", "timeoutNeverScheduled", "handleHoldsTheTask", "legacyThrows", "remainingRules", "cancelRules", "cancelTakesAnObject"]) {
    assert.ok(idle[key], `NativeIdleCallbacks no longer has the fact ${key}`);
  }
  for (const [key, value] of Object.entries(idle.scheduler)) {
    if (typeof value === "boolean") {
      assert.ok(value, `The RuntimeScheduler no longer has the fact ${key}`);
    }
  }
  assert.equal(idle.scheduler.idleTimeoutMs, expected.scheduler.timeouts.Idle);
  assert.ok(expected.scheduler.timeouts.Idle > expected.scheduler.timeouts.Low && expected.scheduler.timeouts.Low > expected.scheduler.timeouts.Normal
    && expected.scheduler.timeouts.Normal > expected.scheduler.timeouts.UserBlocking && expected.scheduler.timeouts.UserBlocking > expected.scheduler.timeouts.Immediate,
  "The priorities' timeouts are in order, the idle one the longest");
  assert.ok(expected.scheduler.checkpointAfterEachTask && expected.scheduler.loopChoosesAfterEachTick && expected.scheduler.smallestExpirationFirst
    && expected.scheduler.workIsImmediate && expected.scheduler.beatIsAScheduledTask, "The RuntimeScheduler runs the handler's task, drains the microtasks, then chooses the next task");
  assert.ok(expected.host.timersTakenBeforeTheWorkDrain && expected.host.drainsAfterEachWorkItem && expected.host.compilesWithoutLegacyArch,
    "The host takes due timers before it drains the work queue, drains microtasks after each item, and runs the modern RuntimeScheduler");
  assert.deepEqual(Object.keys(expected.orders).sort(), cases.map(testCase => testCase.name).sort());
  // The model must say the cases are worth running: an idle callback comes after everything queued with it, and the queue yields to what is queued inside.
  const order = expected.orders.order;
  assert.ok(order.indexOf("idle-a") > order.indexOf("task-normal") && order.indexOf("idle-b") > order.indexOf("idle-a") && order.indexOf("timeout") > order.indexOf("idle-b"),
    "In the model idle callbacks run behind the work queued with them, in request order, and ahead of the timer: " + order);
  assert.deepEqual(expected.samples.deadline, {entry: "timed", again: "timed", "after-quick": "timed", "after-deadline": "zero"});
  assert.deepEqual(expected.samples.yield, {entry: "timed", "after-idle": "timed", "after-task": "zero", again: "zero"});
  assert.deepEqual(expected.samples["yield-immediate"], {entry: "timed", "after-task": "zero"});
  assert.deepEqual(expected.didTimeout.timeout, {"idle-timeout-1": true, "idle-timeout-60000": false, "idle-timeout-0": false, "idle-timeout-negative": false, "idle-no-timeout": false});
  assert.ok(spins.quick > 0 && spins.past >= expected.idle.deadlineMs, "A spin past the deadline outlasts it");
}

const labelsOf = record => (record?.marks ?? []).map(entry => entry.label);
const errorsOf = snapshot => snapshot?.errors ?? [];
const idleOf = snapshot => snapshot?.nativeModules?.idleCallbacks ?? null;

// The first write of the flag and the first read of it, and of the function the renderer captures, from the log of the host-state module.
function renderer(events) {
  const index = predicate => events.findIndex(predicate);
  const flagWrite = index(event => event.name === "RN$enableMicrotasksInReact" && event.op === "write" && event.value === true);
  const flagRead = index(event => event.name === "RN$enableMicrotasksInReact" && event.op === "read");
  return {flagWrite, flagRead, flagValue: events[flagRead]?.value};
}

// What the clock allows a reading to be. The callback is told the time its task started, which lies between the request and the callback's entry; the 50 ms
// deadline is measured from it, and a reading is the deadline minus the time of the reading, which lies between the two timestamps around the call. So a reading
// is at most what is left of 50 ms from the entry to the call, and at least what is left from the request to the end of the call, and never negative.
function readingBounds(idle, sample, deadlineMs) {
  return {
    low: Math.max(0, idle.requested.before + deadlineMs - sample.after),
    high: Math.min(deadlineMs, Math.max(0, idle.entry + deadlineMs - sample.at)),
  };
}

// Whether the readings of an idle callback that the classes name are what the model says: the ones it says are zero are exactly zero, the others lie within
// the bounds of the clock, the timestamps are in order, and a later reading is never larger than an earlier one.
function readingsHold(idle, classes, expected) {
  if (!idle || !Array.isArray(idle.samples)) {
    return false;
  }
  const samples = idle.samples.filter(sample => Object.hasOwn(classes, sample.label));
  if (samples.length !== Object.keys(classes).length) {
    return false;
  }
  const stamps = [idle.requested.before, idle.requested.after, idle.entry, ...samples.flatMap(sample => [sample.at, sample.after])];
  if (!stamps.every(Number.isFinite) || stamps.some((stamp, index) => index > 0 && stamp < stamps[index - 1])) {
    return false;
  }
  let previous = Infinity;
  for (const sample of samples) {
    const kind = classes[sample.label];
    if (typeof sample.value !== "number" || sample.value > previous + epsilon) {
      return false;
    }
    previous = sample.value;
    const bounds = readingBounds(idle, sample, expected.idle.deadlineMs);
    if (kind === "zero" ? sample.value !== 0 : !(kind === "timed" && sample.value >= bounds.low - epsilon && sample.value <= bounds.high + epsilon)) {
      return false;
    }
  }
  return true;
}

// Every verdict the probe gives, derived again from the raw observations of a report and from RN, in the probe's order and with its names.
export function idleDerivedChecks(report, expected) {
  const stages = report.stages;
  const row = (name, passed) => ({name, passed});
  const environment = stages.environment ?? {};
  const mounted = stages.mount?.application;
  const native = environment.native ?? {};
  const seen = renderer(environment.events ?? []);
  const before = stages.host?.before ?? {};
  const requestMany = stages.request_many ?? {};
  const many = stages.many_done?.many ?? {};
  const cancelMany = stages.cancel_many ?? {};
  const cancelState = cancelMany.state ?? {};
  const edges = stages.edges?.cancels ?? {};
  const drained = stages.drained ?? {};
  const gate = stages.gate?.state ?? {};
  const afterStop = stages.after_stop ?? {};
  const stop = stages.stop?.application;
  const rootState = stages.stop?.root;
  const record = key => stages[`case_${key}`]?.record;
  const idleIn = (key, owner) => record(key)?.idle?.[owner];
  const labelsRow = (key, name, sentence) => row(`${name}/${sentence}`, same(labelsOf(record(key)), expected.orders[name]));
  const installed = ["RN$enableMicrotasksInReact", "setImmediate", "clearImmediate", "requestIdleCallback", "cancelIdleCallback"];
  const deadline = idleIn("deadline", "idle");
  const yielding = idleIn("yield", "idle-a");
  const immediate = idleIn("yield_immediate", "idle");
  const timeout = record("timeout")?.idle ?? {};
  const requests = (snapshot) => idleOf(snapshot)?.requests;
  const cancels = (snapshot) => idleOf(snapshot)?.cancels;

  return [
    row("mount/The root mounts through the original AppRegistry without a diagnostic",
      mounted?.rootCount === 1 && stages.mount.surfaceId > 0 && errorsOf(mounted).length === 0),
    row("setUpTimers/RN$enableMicrotasksInReact is written true by RN's setUpTimers before the renderer reads it, and the renderer reads true",
      expected.flag === true && seen.flagWrite >= 0 && seen.flagRead > seen.flagWrite && seen.flagValue === expected.flag),
    row("setUpTimers/The host defines none of the globals setUpTimers installs, and the idle callbacks are lazy getters that nothing has read when the bundle has evaluated",
      installed.every(name => before[name] === "undefined") && environment.kindsAtStart?.requestIdleCallback === "getter" && environment.kindsAtStart?.cancelIdleCallback === "getter"
        && same(Object.keys(expected.installs).filter(name => name !== "queueMicrotask").sort(), installed.filter(name => name !== "RN$enableMicrotasksInReact").sort())),
    row("setUpTimers/setImmediate and clearImmediate are RN's immediateShim",
      environment.setImmediate?.isShim === true && environment.clearImmediate?.isShim === true && expected.installs.setImmediate.module === "./Timers/immediateShim"
        && expected.installs.clearImmediate.module === "./Timers/immediateShim"),
    row("setUpTimers/setImmediate reaches RN's NativeMicrotasks through queueMicrotask and runs",
      drained.callsAfter - drained.callsBefore === 1 && drained.callsBefore >= 0 && drained.immediate?.ran === true),
    row("module/RN's NativeIdleCallbacks spec module loads over the host's NativeIdleCallbacksCxx and exposes requestIdleCallback and cancelIdleCallback",
      native.loaded === true && expected.moduleName === "NativeIdleCallbacksCxx" && same(expected.methods, ["requestIdleCallback", "cancelIdleCallback"])
        && native.hasRequestIdleCallback === true && native.hasCancelIdleCallback === true && native.requestType === "function" && native.cancelType === "function"
        && native.stableFunctions === true),
    row("module/The registry serves RN's NativeIdleCallbacks module and counts the calls that reach it",
      Number.isInteger(requests(stages.registry)) && requests(stages.registry) >= 0 && Number.isInteger(cancels(stages.registry)) && cancels(stages.registry) >= 0),
    row("module/Each requestIdleCallback call through the global reaches the C++ module once and returns a task handle",
      requestMany.count === expected.bulk && requestMany.count > 1 && requestMany.after.requests - requestMany.before.requests === requestMany.count
        && requestMany.after.cancels === requestMany.before.cancels && requestMany.before.requests >= 0
        && requestMany.result?.handleTypes?.length === requestMany.count && requestMany.result.handleTypes.every(type => type === "object")
        && requestMany.result.distinct === requestMany.count && requestMany.result.errors?.length === 0),
    row("module/Idle callbacks requested outside any task run, each told a deadline with didTimeout false and a timeRemaining function",
      many.requested === expected.bulk && many.ran === many.requested && many.deadlines?.length === many.requested
        && many.deadlines.every(entry => entry.didTimeout === false && entry.timeRemainingType === "function" && same(entry.keys, expected.idle.deadlineKeys))),
    row("module/Each cancelIdleCallback call through the global reaches the C++ module once, and a canceled callback never runs",
      cancelMany.count === expected.bulk && cancelMany.after.cancels - cancelMany.before.cancels === cancelMany.count
        && cancelMany.after.requests - cancelMany.before.requests === cancelMany.count + 1 && cancelMany.before.cancels >= 0
        && cancelState.requested === cancelMany.count && cancelState.canceled === cancelMany.count && cancelState.ran === 0 && cancelState.controlRan === true
        && cancelState.errors?.length === 0),
    row("module/Cancelling a handle that has already run, one already canceled or an object that is no handle does nothing; a value that is no object throws",
      expected.idle.cancelRules && expected.idle.cancelTakesAnObject && edges.afterRun?.threw === false && edges.again?.threw === false && edges.plainObject?.threw === false
        && edges.number?.threw === true && stages.edges?.state?.ran === true),
    labelsRow("order", "order", "Idle callbacks run behind the work queued with them whatever its priority, in the order they were requested, with their own microtasks between, and ahead of the timer"),
    row("deadline/An idle callback with no timeout is told didTimeout false and a timeRemaining function",
      deadline?.ran === true && deadline.didTimeout === expected.didTimeout.deadline.idle && expected.didTimeout.deadline.idle === false
        && deadline.timeRemainingType === "function" && same(deadline.deadlineKeys, expected.idle.deadlineKeys)),
    row("deadline/timeRemaining reads no more than 50 ms and no less than the clock leaves of it, and a later reading is never larger",
      readingsHold(deadline, {entry: "timed", again: "timed", "after-quick": "timed"}, expected) && same(Object.keys(expected.samples.deadline), ["entry", "again", "after-quick", "after-deadline"])
        && ["entry", "again", "after-quick"].every(label => expected.samples.deadline[label] === "timed")),
    row("deadline/timeRemaining is exactly zero once the 50 ms are past",
      deadline?.samples?.find(sample => sample.label === "after-deadline")?.value === 0 && expected.samples.deadline["after-deadline"] === "zero"
        && deadline.samples.at(-1).at - deadline.entry >= expected.idle.deadlineMs),
    row("yield/A task queued inside an idle callback takes the scheduler's yield, so timeRemaining reads zero from then on; an idle callback queued inside does not",
      readingsHold(yielding, expected.samples.yield, expected) && same(expected.samples.yield, {entry: "timed", "after-idle": "timed", "after-task": "zero", again: "zero"})),
    labelsRow("yield", "yield", "The task runs before the idle callback requested earlier, and that one before the callback requested inside"),
    row("yield-immediate/An Immediate task queued inside an idle callback takes the yield too",
      readingsHold(immediate, expected.samples["yield-immediate"], expected) && same(labelsOf(record("yield_immediate")), expected.orders["yield-immediate"])),
    labelsRow("timeout", "timeout", "The timeout option does not run a callback early: the idle callbacks wait behind a scheduler that stays busy"),
    row("timeout/didTimeout is true for a callback that runs after its timeout, false for a longer one, and false for a timeout of zero or less or none",
      same(sorted(Object.keys(expected.didTimeout.timeout)), sorted(Object.keys(timeout))) && Object.entries(expected.didTimeout.timeout).every(([owner, value]) => timeout[owner]?.ran === true
        && timeout[owner].didTimeout === value)),
    labelsRow("cancel", "cancel", "A canceled callback does not run, and the ones around it do, including one canceled from inside an idle callback"),
    row("gate/An idle callback queued before the application stops does not run once it is inactive, although the scheduler ran the task queued with it",
      gate.queued?.threw === false && gate.controlRan === true && gate.idleRan === false),
    row("gate/Once the application is inactive, requestIdleCallback schedules nothing, returns zero and does not reach the module, and cancelIdleCallback does nothing",
      afterStop.result?.request?.threw === false && afterStop.result.request.value === 0 && afterStop.result.cancel?.threw === false && afterStop.result.cancelNumber?.threw === false
        && afterStop.requests === requests(stop) && afterStop.cancels === cancels(stop) && afterStop.requests >= 0 && afterStop.state?.afterStopRan === false),
    row("lifecycle/Stop releases the root, and all native Controls of the root are balanced",
      stop?.stopped === true && stop.rootCount === 0 && (rootState?.nativeTags ?? -1) === 0 && (rootState?.creates ?? 0) === (rootState?.deletes ?? -1)),
    row("report/The idle callbacks report is saved with any normative failure visible", true),
  ];
}

// The report judged against RN. It holds only for a report of the current host and SDK: every derived verdict must be true and be the verdict the report gave,
// and the orders and readings the host produced must be the model's.
export function verifyIdleCallbacksReport(report, expected) {
  assertFacts(expected);
  const derived = idleDerivedChecks(report, expected);
  assert.deepEqual(derived.map(row => row.name), report.checks.map(row => row.name), "The oracle checks what the probe checks");
  const failing = derived.filter(row => !row.passed).map(row => row.name);
  assert.deepEqual(failing, [], `The oracle fails ${failing.length} check(s), the first of them ${failing[0]}`);
  assert.deepEqual(derived, report.checks, "The oracle derives the verdicts the probe gave");
  // The probe's own written-out expectations are the model's.
  assert.deepEqual(report.orders, expected.orders, "The probe judges by the order the oracle derives");
  assert.deepEqual(report.samples, expected.samples, "The probe judges the readings by the classes the oracle derives");
  assert.equal(report.deadlineMs, expected.idle.deadlineMs, "The probe judges by the deadline the C++ gives");
  // Every case ran once, from one press each, and finished by its own last timer, and none of its calls threw.
  for (const testCase of cases) {
    const outcome = report.stages[`case_${testCase.name.replace("-", "_")}`];
    assert.equal(outcome.armed, true, `${testCase.name} was armed`);
    assert.equal(outcome.record.done, true, `${testCase.name} finished`);
    assert.deepEqual(outcome.record.errors, [], `${testCase.name} made no call that threw`);
  }
  return derived;
}

// The oracle's first complaint about a report whose checks all claim to pass, or null when it accepts it.
export function idleOracleRejection(report, expected) {
  try {
    verifyIdleCallbacksReport({...report, checks: report.checks.map(row => ({...row, passed: true}))}, expected);
  } catch (error) {
    return String(error.message).split("\n")[0];
  }
  return null;
}
