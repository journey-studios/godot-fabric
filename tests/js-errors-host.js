// Injected ahead of everything else in the bundle, RN's Metro polyfills included: what the host itself defines before any JavaScript of
// the bundle runs. typeof, because most of these names are not declared. For the globals of ReactInstance's error family, the
// property's attributes too (ReactInstance defines them with defineReadOnlyGlobal: not writable, not enumerable, not configurable).
// It imports nothing, so that nothing of the bundle runs before it; the oracle compares this list with ReactInstance.cpp's.
const errorGlobals = ["RN$useAlwaysAvailableJSErrorHandling", "RN$isRuntimeReady", "RN$hasHandledFatalException", "RN$notifyOfFatalException",
  "RN$inExceptionHandler", "RN$handleException", "RN$registerExceptionListener"];
function describe(name) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  return {
    type: typeof globalThis[name],
    value: typeof globalThis[name] === "boolean" ? globalThis[name] : null,
    length: typeof globalThis[name] === "function" ? globalThis[name].length : null,
    descriptor: descriptor === undefined ? null : {writable: descriptor.writable ?? null, enumerable: descriptor.enumerable, configurable: descriptor.configurable},
  };
}
globalThis.JsErrorsHost = {
  errorUtils: typeof ErrorUtils,
  console: typeof console,
  globals: Object.fromEntries(errorGlobals.map(name => [name, describe(name)])),
  scenario: globalThis.godotScenario,
};
