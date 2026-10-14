import React, {useEffect, useLayoutEffect, useRef, useState} from "react";
import {AppRegistry, Pressable} from "react-native";
import {bulk, cases, runCase} from "./react-microtasks-cases.mjs";

// Records what JS observes of the microtask path in one root: the globals the host installs, the order in which the marks of each case come
// out of one press handler, and the state of the lifecycle gate. It holds no expectation: the Godot probe judges what it reports and
// tests/react-microtasks-oracle.mjs derives every verdict again, from RN's sources, the pinned renderer and V8.
// The handler of a case is a Pressable's onPress, run in the host's real event path: the probe presses and releases the root with Godot mouse
// events, the host's input adapter turns the release into a touch end, and Fabric's event beat delivers it to React's event system
// (EventBeat::induce, a RuntimeScheduler task) as a discrete event.
const update = {current: null};
const gate = {queued: false, microtaskAlive: null, immediateAlive: null, promiseAlive: null, afterStopRan: false, cleanups: 0, nativeTag: null};
const resize = {current: null};

// Whether the application is still alive, as the host says it to JS: godotNode answers null once a stop is requested or under way.
function alive() {
  return gate.nativeTag !== null && typeof globalThis.godotNode === "function" && globalThis.godotNode(gate.nativeTag) !== null;
}
function ReactMicrotasksApp() {
  const [count, setCount] = useState(0);
  const [narrow, setNarrow] = useState(false);
  const committed = useRef(0);
  const target = useRef(null);
  useLayoutEffect(() => {
    update.current = () => setCount(value => value + 1);
    resize.current = () => setNarrow(true);
    gate.nativeTag = target.current?.tag ?? null;
  }, []);
  // The cleanup that unmounting the root at stop() runs: React queues its own microtask for it, through the gate.
  useEffect(() => () => {
    gate.cleanups += 1;
  }, []);
  useLayoutEffect(() => {
    if (count !== committed.current) {
      // The detail is how many updates this commit carries.
      mark("commit", count - committed.current);
      committed.current = count;
    }
  }, [count]);
  return <Pressable ref={target} testID="pressable" style={narrow ? {width: 120, height: 60} : {flex: 1}} onPress={start} />;
}
AppRegistry.registerComponent("ReactMicrotasksApp", () => ReactMicrotasksApp);

const results = {};
const state = {armed: null, current: null, presses: 0};

function mark(label, detail = null) {
  if (state.current !== null) {
    state.current.marks.push({label, detail});
  }
}

// The press handler: the case the probe armed, then the runner's own marks. A press with nothing armed does nothing.
function start() {
  state.presses += 1;
  const armed = state.armed;
  if (armed === null) {
    return;
  }
  state.armed = null;
  const record = {name: armed.name, marks: [], done: false};
  state.current = record;
  results[armed.name] = record;
  runCase(armed, {mark, setState: () => update.current(), scheduler: globalThis.nativeRuntimeScheduler,
    queueMicrotask: callback => globalThis.queueMicrotask(callback), Promise, setImmediate: callback => globalThis.setImmediate(callback),
    setTimeout, finish: () => {
      record.done = true;
    }});
}

// RN's NativeMicrotasks spec module, loaded with a guarded require: on a host that does not register the module it throws, and the probe
// wants to see that and not lose the whole bundle.
let nativeModule = null;
let nativeError = null;
try {
  nativeModule = require("../node_modules/react-native/src/private/webapis/microtasks/specs/NativeMicrotasks").default;
} catch (error) {
  nativeError = String(error?.message ?? error);
}

function descriptorOf(object, name) {
  const descriptor = Object.getOwnPropertyDescriptor(object, name);
  return descriptor === undefined ? null : {writable: descriptor.writable ?? null, enumerable: descriptor.enumerable, configurable: descriptor.configurable};
}

function attempt(callback) {
  try {
    return {threw: false, value: callback() ?? null};
  } catch (error) {
    return {threw: true, error: String(error?.message ?? error)};
  }
}



globalThis.ReactMicrotasksProbe = {
  caseNames: cases.map(entry => entry.name),
  bulk,
  // The globals as the bundle has them once it has been evaluated.
  environment() {
    const events = globalThis.ReactMicrotasksHost.events();
    return {
      flag: {type: typeof globalThis.RN$enableMicrotasksInReact, value: globalThis.RN$enableMicrotasksInReact === true},
      queueMicrotask: {type: typeof globalThis.queueMicrotask, length: globalThis.queueMicrotask?.length ?? null, name: globalThis.queueMicrotask?.name ?? null,
        descriptor: descriptorOf(globalThis, "queueMicrotask")},
      setImmediate: {type: typeof globalThis.setImmediate},
      events,
      native: {loaded: nativeModule !== null, error: nativeError, hasQueueMicrotask: nativeModule !== null && "queueMicrotask" in nativeModule,
        queueMicrotaskType: nativeModule === null ? "undefined" : typeof nativeModule.queueMicrotask,
        stableFunction: nativeModule === null ? null : nativeModule.queueMicrotask === nativeModule.queueMicrotask},
      hermes: typeof HermesInternal,
    };
  },
  // Queues a batch of callbacks through the global in one turn; queueManyState says how many ran by the time the caller asks again.
  queueMany(count) {
    state.queueMany = {queued: count, ran: 0};
    for (let index = 0; index < count; index += 1) {
      globalThis.queueMicrotask(() => {
        state.queueMany.ran += 1;
      });
    }
    return count;
  },
  queueManyState() {
    return state.queueMany ?? null;
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
  // The lifecycle gate: a microtask, an immediate and a Promise reaction are queued in one turn, with an update of the component (so that
  // React's own job is pending too), and the probe stops the application before the host drains them. Each records whether the application was
  // still alive when it ran: they were queued before the stop, so they complete first.
  queueGated() {
    gate.queued = true;
    globalThis.queueMicrotask(() => {
      gate.microtaskAlive = alive();
    });
    globalThis.setImmediate(() => {
      gate.immediateAlive = alive();
    });
    Promise.resolve().then(() => {
      gate.promiseAlive = alive();
    });
    update.current();
    return true;
  },
  // A stop requested by a native signal in the middle of a commit: the probe connects the signal of the root's Control and this changes its size.
  resize() {
    resize.current();
    return true;
  },
  // What the gate lets through once the application is inactive: nothing is queued.
  queueAfterStop() {
    return attempt(() => globalThis.queueMicrotask(() => {
      gate.afterStopRan = true;
    }));
  },
  gateState() {
    return {...gate};
  },
};
