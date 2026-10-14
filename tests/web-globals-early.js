// The first module the fixture imports, so the first of the application's own modules to run (the polyfills are injected ahead of it): what the globals
// are then. RN's setUpXHR runs when the renderer first requires src/initialize.js, which is after this module, so none of the four it installs is there yet,
// and none of the polyfills that came first (RN's console and error-guard) has put a TextDecoder or an encoding global of its own.
globalThis.WebGlobalsEarly = {
  atFirstModule: {
    URL: typeof URL,
    URLSearchParams: typeof URLSearchParams,
    AbortController: typeof AbortController,
    AbortSignal: typeof AbortSignal,
    TextEncoder: typeof TextEncoder,
    TextDecoder: typeof TextDecoder,
    atob: typeof atob,
    btoa: typeof btoa,
    sameEncoder: globalThis.TextEncoder === globalThis.WebGlobalsHostFunctions.TextEncoder,
    sameAtob: globalThis.atob === globalThis.WebGlobalsHostFunctions.atob,
    sameBtoa: globalThis.btoa === globalThis.WebGlobalsHostFunctions.btoa,
  },
};
