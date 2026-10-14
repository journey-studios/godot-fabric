import React from "react";
import {AppRegistry, Pressable} from "react-native";
import {clearImmediate as shimClearImmediate, setImmediate as shimSetImmediate} from "react-native/Libraries/Core/Timers/immediateShim";
import {bulk, cases, runCase} from "./idle-callbacks-cases.mjs";

// Records what JS observes of the idle callbacks in one root: the globals RN's setUpTimers installs, what each idle callback is told and when, the order in
// which the marks of each case come out of one press handler, and the state of the lifecycle gate. It holds no expectation: the Godot probe judges what it
// reports and tests/idle-callbacks-oracle.mjs derives every verdict again, from RN's sources and V8.
// The handler of a case is a Pressable's onPress, run in the host's real event path: the probe presses and releases the root with Godot mouse events, the
// host's input adapter turns the release into a touch end, and Fabric's event beat delivers it to React's event system (EventBeat::induce, a
// RuntimeScheduler task). Everything a case queues is therefore queued from inside a task, as it is in an application.
function IdleCallbacksApp() {
  return <Pressable style={{flex: 1}} onPress={start} />;
}
AppRegistry.registerComponent("IdleCallbacksApp", () => IdleCallbacksApp);

// The globals setUpTimers installs lazily, as the bundle leaves them: a getter that nothing has read, or a value. Nothing of the fixture reads them before this.
function kindOf(name) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  return descriptor === undefined ? "absent" : typeof descriptor.get === "function" ? "getter" : "value";
}
const kindsAtStart = Object.fromEntries(["requestIdleCallback", "cancelIdleCallback"].map(name => [name, kindOf(name)]));

// The steady clock the host's RuntimeScheduler stamps its tasks with (nativePerformanceNow and HighResTimeStamp::now are both std::chrono::steady_clock).
const clock = () => globalThis.nativePerformanceNow();

const results = {};
const state = {armed: null, current: null, presses: 0};

function mark(label) {
  if (state.current !== null) {
    state.current.marks.push({label, detail: null});
  }
}

function describe(error) {
  return String(error?.message ?? error);
}

// The environment of a case: the steps of tests/idle-callbacks-cases.mjs, over the globals of the host. A call that throws is recorded and the case goes on,
// so that a host without the module shows as failed checks and not as a lost bundle.
function environment(record, finish) {
  const note = (what, error) => record.errors.push({what, error: describe(error)});
  return {
    mark,
    spin(ms) {
      const start = clock();
      while (clock() - start < ms) {
        // The scheduler is busy: nothing else runs.
      }
    },
    scheduler: globalThis.nativeRuntimeScheduler,
    queueMicrotask: callback => globalThis.queueMicrotask(callback),
    Promise,
    setImmediate: callback => globalThis.setImmediate(callback),
    setTimeout,
    requestIdleCallback(owner, callback, options) {
      const idle = {requested: {before: clock(), after: null}, timeout: options[0]?.timeout ?? null, handleType: null, ran: false, didTimeout: null,
        timeRemainingType: null, deadlineKeys: null, entry: null, samples: []};
      record.idle[owner] = idle;
      try {
        const handle = globalThis.requestIdleCallback(callback, ...options);
        idle.requested.after = clock();
        idle.handleType = typeof handle;
        return handle;
      } catch (error) {
        idle.requested.after = clock();
        note("requestIdleCallback " + owner, error);
        return null;
      }
    },
    idleStart(owner, deadline) {
      const idle = record.idle[owner];
      idle.entry = clock();
      idle.ran = true;
      idle.didTimeout = deadline.didTimeout;
      idle.timeRemainingType = typeof deadline.timeRemaining;
      idle.deadlineKeys = Object.keys(deadline).sort();
    },
    measure(owner, label, deadline) {
      const at = clock();
      const value = deadline.timeRemaining();
      record.idle[owner].samples.push({label, value, at, after: clock()});
    },
    cancelIdleCallback(handle) {
      try {
        globalThis.cancelIdleCallback(handle);
      } catch (error) {
        note("cancelIdleCallback", error);
      }
    },
    finish,
  };
}

// The press handler: the case the probe armed, then the runner's own marks. A press with nothing armed does nothing.
function start() {
  state.presses += 1;
  const armed = state.armed;
  if (armed === null) {
    return;
  }
  state.armed = null;
  const record = {name: armed.name, marks: [], idle: {}, errors: [], done: false};
  state.current = record;
  results[armed.name] = record;
  runCase(armed, environment(record, () => {
    record.done = true;
  }));
}

// RN's NativeIdleCallbacks spec module, loaded with a guarded require: on a host that does not register the module it throws, and the probe wants to see that
// and not lose the whole bundle.
let nativeModule = null;
let nativeError = null;
try {
  nativeModule = require("../node_modules/react-native/src/private/webapis/idlecallbacks/specs/NativeIdleCallbacks").default;
} catch (error) {
  nativeError = describe(error);
}

function descriptorOf(name) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  return descriptor === undefined ? null : {kind: typeof descriptor.get === "function" ? "getter" : "value", enumerable: descriptor.enumerable,
    configurable: descriptor.configurable, writable: descriptor.writable ?? null};
}

function attempt(callback) {
  try {
    return {threw: false, value: callback() ?? null};
  } catch (error) {
    return {threw: true, error: describe(error)};
  }
}

const batch = {many: null, cancelMany: null, edges: null};
const gate = {queued: false, idleRan: false, controlRan: false};

globalThis.IdleCallbacksProbe = {
  caseNames: cases.map(entry => entry.name),
  bulk,
  // The globals as the bundle has them once it has been evaluated. Reading a global that setUpTimers installed lazily is what resolves it, so the
  // reads that can throw on a host without the module are attempts.
  environment() {
    const events = globalThis.ReactMicrotasksHost.events();
    const read = name => attempt(() => ({type: typeof globalThis[name], length: globalThis[name]?.length ?? null, name: globalThis[name]?.name ?? null}));
    return {
      kindsAtStart,
      flag: {type: typeof globalThis.RN$enableMicrotasksInReact, value: globalThis.RN$enableMicrotasksInReact === true},
      queueMicrotask: read("queueMicrotask"),
      requestIdleCallback: read("requestIdleCallback"),
      cancelIdleCallback: read("cancelIdleCallback"),
      setImmediate: {type: typeof globalThis.setImmediate, isShim: globalThis.setImmediate === shimSetImmediate},
      clearImmediate: {type: typeof globalThis.clearImmediate, isShim: globalThis.clearImmediate === shimClearImmediate},
      descriptors: Object.fromEntries(["queueMicrotask", "setImmediate", "clearImmediate", "requestIdleCallback", "cancelIdleCallback"]
        .map(name => [name, descriptorOf(name)])),
      events,
      native: {loaded: nativeModule !== null, error: nativeError,
        hasRequestIdleCallback: nativeModule !== null && "requestIdleCallback" in nativeModule,
        hasCancelIdleCallback: nativeModule !== null && "cancelIdleCallback" in nativeModule,
        requestType: nativeModule === null ? "undefined" : typeof nativeModule.requestIdleCallback,
        cancelType: nativeModule === null ? "undefined" : typeof nativeModule.cancelIdleCallback,
        stableFunctions: nativeModule === null ? null : nativeModule.requestIdleCallback === nativeModule.requestIdleCallback
          && nativeModule.cancelIdleCallback === nativeModule.cancelIdleCallback},
      hermes: typeof HermesInternal,
    };
  },
  // setImmediate, which RN shims over the global queueMicrotask.
  queueImmediate() {
    state.immediate = {ran: false};
    globalThis.setImmediate(() => {
      state.immediate.ran = true;
    });
    return true;
  },
  immediateState() {
    return state.immediate ?? null;
  },
  // Requests a batch of idle callbacks through the global in one turn, outside any task. manyState says how many ran by the time the caller asks again,
  // and what each was told.
  requestMany(count) {
    const many = {requested: count, ran: 0, deadlines: [], handleTypes: [], distinct: 0, errors: []};
    batch.many = many;
    const handles = new Set();
    for (let index = 0; index < count; index += 1) {
      try {
        const handle = globalThis.requestIdleCallback(deadline => {
          many.ran += 1;
          many.deadlines.push({didTimeout: deadline.didTimeout, timeRemainingType: typeof deadline.timeRemaining, keys: Object.keys(deadline).sort()});
        });
        many.handleTypes.push(typeof handle);
        handles.add(handle);
      } catch (error) {
        many.errors.push(describe(error));
      }
    }
    many.distinct = handles.size;
    return many;
  },
  manyState() {
    return batch.many;
  },
  // Requests `count` callbacks, cancels them all in the same turn and requests one more behind them: when that last one has run, the scheduler has gone
  // past the canceled ones and none of them ran.
  cancelMany(count) {
    const cancel = {requested: count, ran: 0, controlRan: false, canceled: 0, errors: []};
    batch.cancelMany = cancel;
    const handles = [];
    for (let index = 0; index < count; index += 1) {
      try {
        handles.push(globalThis.requestIdleCallback(() => {
          cancel.ran += 1;
        }));
      } catch (error) {
        cancel.errors.push(describe(error));
      }
    }
    for (const handle of handles) {
      try {
        globalThis.cancelIdleCallback(handle);
        cancel.canceled += 1;
      } catch (error) {
        cancel.errors.push(describe(error));
      }
    }
    try {
      globalThis.requestIdleCallback(() => {
        cancel.controlRan = true;
      });
    } catch (error) {
      cancel.errors.push(describe(error));
    }
    return cancel;
  },
  cancelManyState() {
    return batch.cancelMany;
  },
  // The handle of one callback that is left to run; edgeCancels then cancels it after it ran, and cancels what is no handle.
  edgeRequest() {
    const edges = {ran: false, handle: null, request: null, cancels: null};
    batch.edges = edges;
    edges.request = attempt(() => {
      edges.handle = globalThis.requestIdleCallback(() => {
        edges.ran = true;
      });
      return typeof edges.handle;
    });
    return edges.request;
  },
  edgeState() {
    return batch.edges === null ? null : {ran: batch.edges.ran, request: batch.edges.request, cancels: batch.edges.cancels};
  },
  edgeCancels() {
    const edges = batch.edges;
    edges.cancels = {
      afterRun: attempt(() => globalThis.cancelIdleCallback(edges.handle)),
      again: attempt(() => globalThis.cancelIdleCallback(edges.handle)),
      plainObject: attempt(() => globalThis.cancelIdleCallback({})),
      number: attempt(() => globalThis.cancelIdleCallback(0)),
    };
    return edges.cancels;
  },
  // Arms the case the next press runs.
  arm(name) {
    const found = cases.find(entry => entry.name === name);
    if (found === undefined) {
      return false;
    }
    state.armed = found;
    return true;
  },
  state() {
    return {presses: state.presses, armed: state.armed === null ? null : state.armed.name, results};
  },
  // The lifecycle gate: an idle callback is queued in one turn, with a Normal task queued behind it (it runs first: its expiration is five seconds, the
  // idle callback's five minutes), and the probe stops the application before the host pumps. The task is not gated, so that it ran says the scheduler ran
  // during the stop, in the window in which stop() unmounts the roots, and went on to the idle callback behind it; that must not have run.
  queueGated() {
    gate.queued = attempt(() => {
      globalThis.nativeRuntimeScheduler.unstable_scheduleCallback(3, () => {
        gate.controlRan = true;
      });
      globalThis.requestIdleCallback(() => {
        gate.idleRan = true;
      });
      return true;
    });
    return gate.queued;
  },
  // What the gate lets through once the application is inactive: nothing is queued, and a cancel does nothing.
  afterStop() {
    gate.afterStopRan = false;
    return {
      request: attempt(() => globalThis.requestIdleCallback(() => {
        gate.afterStopRan = true;
      })),
      cancel: attempt(() => globalThis.cancelIdleCallback({})),
      cancelNumber: attempt(() => globalThis.cancelIdleCallback(0)),
    };
  },
  gateState() {
    return {...gate};
  },
};
