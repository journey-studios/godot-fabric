// The first module the fixture imports, so the first of the application's own modules to run (the polyfills are injected ahead of it): what
// RN's error-guard polyfill has defined by then and setUpErrorHandling has not, and the two things the probe needs to see afterwards, which only
// a module that runs before setUpErrorHandling can see: the handler that setUpErrorHandling registers, and what the console logs. Both are wrapped
// here and delegate to the original, so nothing changes for the code under test.
export const logged = [];
const hook = globalThis.nativeLoggingHook;
if (typeof hook === "function") {
  globalThis.nativeLoggingHook = (message, level) => {
    logged.push({message, level});
    return hook(message, level);
  };
}

export const handlerCalls = [];
const errorUtils = globalThis.ErrorUtils;
export const polyfillHandler = typeof errorUtils === "object" && errorUtils !== null ? errorUtils.getGlobalHandler() : null;
if (polyfillHandler !== null) {
  const original = errorUtils.setGlobalHandler;
  errorUtils.setGlobalHandler = function setGlobalHandler(handler) {
    handlerCalls.push(handler);
    return original.call(this, handler);
  };
}

function thrownBy(callback) {
  try {
    callback();
    return null;
  } catch (error) {
    return String(error?.message ?? error);
  }
}

globalThis.JsErrorsEarly = {
  atFirstModule: {
    errorUtils: typeof errorUtils,
    // The polyfill's handler until setUpErrorHandling replaces it: it throws what it is handed.
    defaultHandlerType: typeof polyfillHandler,
    defaultHandlerRethrows: polyfillHandler === null ? null : thrownBy(() => polyfillHandler(new Error("js-errors default handler"), false)),
    consoleErrorOriginal: typeof globalThis.console?._errorOriginal,
    window: typeof window,
  },
  logged,
};
