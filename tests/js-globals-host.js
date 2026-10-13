// Injected ahead of everything else in the bundle, RN's console polyfill included: what the host itself defines before any JavaScript
// of the bundle runs. typeof, because most of these names are not declared.
globalThis.JsGlobalsHost = {
  console: typeof console,
  performance: typeof performance,
  window: typeof window,
  process: typeof process,
  navigator: typeof navigator,
  globalIsGlobalThis: globalThis.global === globalThis,
  dev: globalThis.__DEV__,
  nativeLoggingHook: typeof nativeLoggingHook,
  nativePerformanceNow: typeof nativePerformanceNow,
};
