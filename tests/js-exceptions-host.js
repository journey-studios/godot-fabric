// Injected ahead of everything else in the bundle, RN's Metro polyfills included (GF-05 slice F): what the host and the engine do before any JavaScript of the
// bundle runs, and two hooks that only a module running first can put in place. It imports nothing, so that nothing of the bundle runs before it.
//   - the log: every line RN's console sends the host (nativeLoggingHook), so that a case can say that nothing was logged;
//   - Hermes' promise rejection tracker: enablePromiseRejectionTracker is wrapped to count its calls. RN's polyfillPromise enables it only under __DEV__,
//     and setUpErrorHandling does not enable it at all, so a release bundle never calls it and an unhandled rejection is not tracked.
const logged = [];
const hook = globalThis.nativeLoggingHook;
if (typeof hook === "function") {
  globalThis.nativeLoggingHook = (message, level) => {
    logged.push({message, level});
    return hook(message, level);
  };
}

const internal = globalThis.HermesInternal;
const tracker = {type: typeof internal?.enablePromiseRejectionTracker, calls: [], wrapped: false, hasPromise: null};
if (typeof internal?.hasPromise === "function") {
  tracker.hasPromise = internal.hasPromise();
}
if (tracker.type === "function") {
  const original = internal.enablePromiseRejectionTracker;
  try {
    internal.enablePromiseRejectionTracker = function enablePromiseRejectionTracker(options) {
      tracker.calls.push(options === undefined ? null : Object.keys(options).sort());
      return original.apply(this, arguments);
    };
    tracker.wrapped = internal.enablePromiseRejectionTracker !== original;
  } catch (error) {
    tracker.wrapped = false;
  }
}

globalThis.JsExceptionsHost = {
  dev: typeof __DEV__ === "undefined" ? null : __DEV__,
  tracker,
  logged,
  scenario: globalThis.godotScenario ?? null,
  timers: Object.fromEntries(["setTimeout", "setInterval", "requestAnimationFrame", "queueMicrotask", "setImmediate", "requestIdleCallback"].map(name => [name, typeof globalThis[name]])),
};
