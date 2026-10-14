// The host's lifecycle gate (V2-D27) over the timers, the microtasks and the idle callbacks. src/initialize.js imports RN's setUpTimers unchanged
// (Libraries/Core/setUpTimers.js, its RN$Bridgeless branch), which sets RN$enableMicrotasksInReact and installs queueMicrotask, setImmediate,
// clearImmediate, requestIdleCallback and cancelIdleCallback; the TimerManager the host attached before this module is evaluated provides
// setTimeout, setInterval and requestAnimationFrame. What stays here is the host's own, which RN does not have.
//
// Once stop() has begun, no timer, frame, microtask or idle callback is scheduled and none runs. RN destroys its runtime with the callbacks still
// pending; this host stops an application while its Hermes still drains microtasks and its RuntimeScheduler still runs tasks (Impl::stop pumps), so
// the callbacks check. The microtasks queued before the stop complete first, in one checkpoint at the head of stop(), and the host opens the gate
// again while it unmounts the roots, because React's own jobs use queueMicrotask (RN$enableMicrotasksInReact) and a call the gate refuses leaves React
// waiting for the job for good. A stop request alone does not close it: React finishes a commit in flight after the request returns.
import { polyfillGlobal } from "react-native/Libraries/Utilities/PolyfillFunctions";

const active = globalThis.godotRuntimeActive;
for (const name of ["setTimeout", "setInterval", "requestAnimationFrame"]) {
  const native = globalThis[name];
  globalThis[name] = (...args) => active() ? native(...args) : 0;
}

// The gate wraps the function setUpTimers installs and does not replace it. setUpTimers installs these globals as lazy getters (polyfillGlobal),
// whose first read looks the spec module up. The gate puts a lazy getter of its own over RN's, with RN's own polyfillGlobal: the function it
// wraps is whatever RN's getter resolves, looked up when the global is first read, as in RN. A host that lacks a module fails when a global
// that needs it is read, and not when the bundle evaluates. It must run after setUpTimers and before anything reads the globals.
function gate(name, wrap) {
  const resolve = Object.getOwnPropertyDescriptor(globalThis, name)?.get;
  if (typeof resolve !== "function") {
    throw new Error(`The host's gate wraps ${name} as setUpTimers installs it, a lazy getter that nothing has read yet`);
  }
  polyfillGlobal(name, () => wrap(resolve.call(globalThis)));
}

// The callback is checked again when it runs: what is queued and has not run when the application stops does not run. setImmediate is RN's
// immediateShim, which queues through this global, so it is gated too.
gate("queueMicrotask", (queue) => (callback) => {
  if (typeof callback !== "function") {
    throw new TypeError("queueMicrotask requires a function");
  }
  if (active()) {
    queue(() => { if (active()) { callback(); } });
  }
});

// The idle callbacks use the strict gate, which the window in which stop() unmounts the roots does not open: React queues no idle callback, and one
// that user code queued before the stop is still in the RuntimeScheduler's queue when stop() unmounts the roots and pumps.
const live = () => active(true);
gate("requestIdleCallback", (request) => (callback, ...options) => {
  if (typeof callback !== "function") {
    throw new TypeError("requestIdleCallback requires a function");
  }
  if (!live()) {
    return 0;
  }
  return request((deadline) => { if (live()) { callback(deadline); } }, ...options);
});
gate("cancelIdleCallback", (cancel) => (handle) => {
  if (live()) {
    cancel(handle);
  }
});
