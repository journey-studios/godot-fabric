// What the fixture (in Hermes) and the oracle (in Node) both do, written once: the stimulus, never an expectation. The oracle derives what must come
// out from RN's own sources and from a model of RN's event loop, so nothing here says where an exception is reported or what still runs.
//
// A case is {name, source, body}. `source` is how the body is entered:
//   evaluate  from FabricApplication.evaluate, a JS entry that no task of any scheduler runs (the host drains the microtasks it queued at the head of its next pump);
//   timer     from a setTimeout callback (a task of RN's RuntimeScheduler there, a work item of the host's queue here);
//   raf       from a requestAnimationFrame callback;
//   press     from a Pressable's onPress, driven by a Godot mouse event through the host's real event path (a task of the RuntimeScheduler in both).
// `body` is a callback, {label, throws, then}: it records its label, runs the actions of `then` in order, and throws an Error if `throws` is set (a body that
// throws is not entered from evaluate: the exception would be the validation seam's, not a callback's).
// An action is {do, ...}: mark, reportError, timeout, interval, raf, idle, immediate, microtask, promise, chain, finish. A case in the `wedge` lane runs in an
// application of its own; every other case is in the `main` lane.

// The Error a callback throws: one per callback, named after the case and the label, so that a report says which callback made it.
export const messageOf = (caseName, label) => `js-exceptions ${caseName}/${label}`;

export const total = {retry: 300, storm: 1000000};
// RuntimeScheduler_Modern::performMicrotaskCheckpoint's bound (kRetriesBound) is read from the pinned source by the oracle; the cases are sized by it: a throwing
// chain of 300 microtasks crosses one bound (255 failures in a checkpoint) and leaves 45 for the next.

const callback = (label, props = {}) => ({label, throws: false, then: [], ...props});
const thrower = (label, then = []) => callback(label, {throws: true, then});
const timeout = (cb, delay = 0) => ({do: "timeout", callback: cb, delay});
const finish = {do: "finish"};

// The microtasks of one turn: a queueMicrotask callback that throws, one that does not, a Promise reaction, two immediates (RN's immediateShim defers each one
// through queueMicrotask), and a callback that queues another. The last timer ends the case.
const queueTurn = [
  {do: "microtask", callback: thrower("m1")},
  {do: "microtask", callback: callback("m2")},
  {do: "promise", form: "then", callback: callback("p")},
  {do: "immediate", callback: thrower("i1")},
  {do: "immediate", callback: callback("i2")},
  {do: "microtask", callback: callback("m3", {then: [{do: "microtask", callback: callback("m4")}]})},
  timeout(callback("timer", {then: [finish]}), 20),
];

// A throwing chain and a storm, each with a timer and a frame callback queued beside it, and a last timer that ends the case once both have had their turn.
const alongside = chain => [
  chain,
  timeout(callback("alongside-timer")),
  {do: "raf", callback: callback("alongside-raf")},
  timeout(callback("end", {then: [finish]}), 100),
];
const retry = {do: "chain", label: "retry", total: total.retry, via: "queueMicrotask", throws: true};
const storm = {do: "chain", label: "storm", total: total.storm, via: "mixed", throws: false};

export const cases = [
  // A soft exception is the other channel of RN's error path: reported, logged, never a failure. It is reported from inside a timer here.
  {name: "soft", source: "timer", body: callback("start", {then: [{do: "reportError", label: "soft"}, timeout(callback("timer", {then: [finish]}), 20)]})},
  // Callbacks that RN runs as tasks of its RuntimeScheduler: where the exception is reported, and what still runs.
  {name: "timeout", source: "evaluate", body: callback("start", {then: [
    timeout(thrower("a")), timeout(callback("b")), timeout(callback("c", {then: [finish]}), 20)]})},
  {name: "interval", source: "evaluate", body: callback("start", {then: [
    {do: "interval", label: "tick", delay: 5, throwOn: [1, 2], stopAfter: 3, then: [finish]}]})},
  {name: "raf", source: "evaluate", body: callback("start", {then: [
    {do: "raf", callback: thrower("r1")},
    {do: "raf", callback: callback("r2", {then: [{do: "raf", callback: callback("r3", {then: [finish]})}]})}]})},
  {name: "idle", source: "evaluate", body: callback("start", {then: [
    {do: "idle", callback: thrower("i1")}, {do: "idle", callback: callback("i2")}, timeout(callback("timer", {then: [finish]}), 20)]})},
  // A press whose handler queues a timer and throws, then a press whose handler does not: the runtime keeps running.
  {name: "event", source: "press", body: thrower("onPress", [timeout(callback("timer", {then: [finish]}), 20)])},
  {name: "event-after", source: "press", body: callback("onPress", {then: [timeout(callback("timer", {then: [finish]}), 20)]})},
  // The microtask queue drained at each point where the host drains it, and by RN's own checkpoint after a task of the RuntimeScheduler.
  {name: "microtask-evaluate", source: "evaluate", body: callback("start", {then: queueTurn})},
  {name: "microtask-timer", source: "timer", body: callback("start", {then: queueTurn})},
  {name: "microtask-raf", source: "raf", body: callback("start", {then: queueTurn})},
  {name: "microtask-press", source: "press", body: callback("start", {then: queueTurn})},
  // Promise reactions: an exception in one rejects the promise it returned and reaches no host; a rejection nobody handles is not tracked in a release build.
  {name: "promise", source: "evaluate", body: callback("start", {then: [
    {do: "promise", form: "then", callback: thrower("then-throws")},
    {do: "promise", form: "then-catch", callback: thrower("then-catch-throws"), caught: "then-catch-caught"},
    {do: "promise", form: "reject", label: "reject-unhandled"},
    {do: "promise", form: "async", callback: thrower("async-throws")},
    {do: "microtask", callback: callback("after")},
    timeout(callback("timer", {then: [finish]}), 20)]})},
  // Starvation. A microtask that queues itself and throws each time is bounded by the checkpoint's retry bound; a chain that does not throw is not bounded at all.
  {name: "retry-bound-evaluate", source: "evaluate", body: callback("start", {then: alongside(retry)})},
  {name: "retry-bound-timer", source: "timer", body: callback("start", {then: alongside(retry)})},
  {name: "retry-bound-raf", source: "raf", body: callback("start", {then: alongside(retry)})},
  // The same bound, reached by RN's own checkpoint after the press task; it ends the RuntimeScheduler, so these two run in an application of their own. The second
  // press is the one that never gets its handler run.
  {name: "retry-bound-press", lane: "wedge", source: "press", body: callback("start", {then: alongside(retry)})},
  {name: "press-after", lane: "wedge", source: "press", body: callback("onPress", {then: [timeout(callback("timer", {then: [finish]}), 20)]})},
  {name: "storm-evaluate", source: "evaluate", body: callback("start", {then: alongside(storm)})},
  {name: "storm-timer", source: "timer", body: callback("start", {then: alongside(storm)})},
];

// What the stop path drains: the microtasks pending when the application stops complete first, in one checkpoint, the one that throws included.
export const stopTurn = [
  {do: "microtask", callback: thrower("s1")},
  {do: "microtask", callback: callback("s2")},
  {do: "promise", form: "then", callback: callback("sp")},
  {do: "immediate", callback: callback("si")},
  {do: "microtask", callback: callback("s3")},
];

// Run a callback's actions. env supplies the clock's functions (the globals in Hermes, a model in the oracle), the journal and the chain counters.
export function callbackOf(spec, env) {
  return () => {
    env.mark(spec.label);
    for (const action of spec.then ?? []) {
      perform(action, env);
    }
    if (spec.throws) {
      throw env.makeError(spec.label);
    }
  };
}

function perform(action, env) {
  switch (action.do) {
    case "mark":
      env.mark(action.label);
      break;
    case "finish":
      env.finish();
      break;
    case "reportError":
      env.mark(action.label);
      env.reportError(env.makeError(action.label));
      break;
    case "timeout":
      env.setTimeout(callbackOf(action.callback, env), action.delay ?? 0);
      break;
    case "raf":
      env.requestAnimationFrame(callbackOf(action.callback, env));
      break;
    case "idle": {
      const run = callbackOf(action.callback, env);
      env.requestIdleCallback(() => run());
      break;
    }
    case "immediate":
      env.setImmediate(callbackOf(action.callback, env));
      break;
    case "microtask":
      env.queueMicrotask(callbackOf(action.callback, env));
      break;
    case "interval": {
      let calls = 0;
      const id = env.setInterval(() => {
        calls += 1;
        env.mark(`${action.label}#${calls}`);
        if (calls >= action.stopAfter) {
          env.clearInterval(id);
          for (const next of action.then ?? []) {
            perform(next, env);
          }
        }
        if (action.throwOn.includes(calls)) {
          throw env.makeError(`${action.label}#${calls}`);
        }
      }, action.delay);
      break;
    }
    case "promise":
      promise(action, env);
      break;
    case "chain":
      chain(action, env);
      break;
    default:
      throw new Error(`Unknown action ${action.do}`);
  }
}

// Promise forms. A reaction that throws rejects the promise `then` returned; nothing here catches it but the form that says so.
function promise(action, env) {
  const {Promise} = env;
  switch (action.form) {
    case "then":
      Promise.resolve().then(callbackOf(action.callback, env));
      break;
    case "then-catch":
      Promise.resolve().then(callbackOf(action.callback, env)).catch(() => env.mark(action.caught));
      break;
    case "reject":
      Promise.reject(env.makeError(action.label)).then(() => env.mark(`${action.label}-never`));
      break;
    case "async": {
      const run = callbackOf(action.callback, env);
      (async () => {
        await null;
        run();
      })();
      break;
    }
    default:
      throw new Error(`Unknown promise form ${action.form}`);
  }
}

// A chain: `total` runs, each queues the next one before it throws (when it throws). Only the last run is a journal entry; the others are counted, and a mark
// carries the counters, so the order of a timer against the chain is read from the count it saw.
function chain(action, env) {
  let runs = 0;
  const schedule = index => {
    if (action.via === "promise" || (action.via === "mixed" && index % 2 === 0)) {
      env.Promise.resolve().then(step);
    } else {
      env.queueMicrotask(step);
    }
  };
  function step() {
    runs += 1;
    env.chains[action.label] = runs;
    if (runs < action.total) {
      schedule(runs);
    } else {
      env.mark(`${action.label}-last`);
    }
    if (action.throws) {
      throw env.makeError(action.label);
    }
  }
  schedule(0);
}

export const laneOf = testCase => testCase.lane ?? "main";
