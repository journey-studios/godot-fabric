// Injected ahead of everything else in the bundle, RN's polyfills included: what the host and the engine define before any JavaScript of the bundle runs.
// typeof, because most of these names are not declared. The functions themselves are kept (out of the report) so that the fixture can tell that what an
// application finds later is still the engine's own function and not something the bundle put in its place.
globalThis.WebGlobalsHost = {
  URL: typeof URL,
  URLSearchParams: typeof URLSearchParams,
  AbortController: typeof AbortController,
  AbortSignal: typeof AbortSignal,
  TextEncoder: typeof TextEncoder,
  TextDecoder: typeof TextDecoder,
  atob: typeof atob,
  btoa: typeof btoa,
  DOMException: typeof DOMException,
  fetch: typeof fetch,
  XMLHttpRequest: typeof XMLHttpRequest,
  descriptors: Object.fromEntries(["TextEncoder", "atob", "btoa"].map(name => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    return [name, descriptor === undefined ? null : {writable: descriptor.writable, enumerable: descriptor.enumerable, configurable: descriptor.configurable,
      accessor: typeof descriptor.get === "function"}];
  })),
};
globalThis.WebGlobalsHostFunctions = {
  TextEncoder: typeof TextEncoder === "function" ? TextEncoder : null,
  atob: typeof atob === "function" ? atob : null,
  btoa: typeof btoa === "function" ? btoa : null,
};
