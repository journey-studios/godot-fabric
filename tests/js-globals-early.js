import {firstCall} from "./js-globals-cases.mjs";

// The first module the fixture imports, so the first of the application's own modules to run (the polyfills are injected ahead of it):
// what the environment holds then, and the first line it logs. The hook is wrapped here, before anything else can log, so that the
// probe sees every message and level that console sends to the host; the host still prints each one.
export const logged = [];
const hook = globalThis.nativeLoggingHook;
if (typeof hook === "function") {
  globalThis.nativeLoggingHook = (message, level) => {
    logged.push({message, level});
    return hook(message, level);
  };
}
const consoleDefined = typeof console === "object" && console !== null;
globalThis.JsGlobalsEarly = {
  atFirstModule: {
    console: typeof console,
    polyfilled: consoleDefined && console._isPolyfilled === true,
    performance: typeof performance,
    window: typeof window,
    process: typeof process,
    navigator: typeof navigator,
  },
  logged,
};
if (consoleDefined && typeof console[firstCall.method] === "function") {
  console[firstCall.method](...firstCall.args);
}
