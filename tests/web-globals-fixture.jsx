import "./web-globals-early";
import React from "react";
import {AppRegistry, View} from "react-native";
import {URL as ModuleURL, URLSearchParams as ModuleSearchParams} from "react-native/Libraries/Blob/URL";
import {URLSearchParams as SearchParamsOwnModule} from "react-native/Libraries/Blob/URLSearchParams";
import NativeBlobModule from "react-native/Libraries/Blob/NativeBlobModule";
// RN's package exports do not reach src/private, so these two are imported by path. They are the files RN's setUpXHR requires for the globals.
import {AbortController as ModuleAbortController} from "../node_modules/react-native/src/private/webapis/dom/abort-api/AbortController";
import {AbortSignal as ModuleAbortSignal, AbortSignal_public as ModuleAbortSignalPublic} from "../node_modules/react-native/src/private/webapis/dom/abort-api/AbortSignal";
import {abortCases, abortTimerCases, decoderCases, encodingCases, runCases, runTimerCases, searchParamsCases, urlCases} from "./web-globals-cases.mjs";

// Records what JS observes of the web globals the application finds: RN's URL, URLSearchParams, AbortController and AbortSignal, which setUpXHR installs from
// its own modules, and the engine's TextEncoder, atob and btoa, with TextDecoder absent. It holds no expectation: the Godot probe judges what it reports
// against literals, and tests/web-globals-oracle.mjs re-derives every verdict from RN's own files run in V8, from Node's own encoders and from the pinned
// Hermes. tests/web-globals-early.js is imported first, so it is the first of this bundle's modules to run.
function WebGlobalsApp() {
  return <View style={{flex: 1}} />;
}
AppRegistry.registerComponent("WebGlobalsApp", () => WebGlobalsApp);

const describeError = error => ({name: String(error?.name ?? "Error"), message: String(error?.message ?? error), isError: error instanceof Error});

function descriptorKind(name) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  if (descriptor === undefined) {
    return null;
  }
  return {kind: typeof descriptor.get === "function" ? "accessor" : "data", writable: descriptor.writable ?? null, enumerable: descriptor.enumerable,
    configurable: descriptor.configurable, setter: typeof descriptor.set};
}

// The globals as the cases receive them: read from the global object, as an application does. The first read resolves the lazy accessor RN installs.
function globalsUnderTest() {
  return {URL: globalThis.URL, URLSearchParams: globalThis.URLSearchParams, AbortController: globalThis.AbortController, AbortSignal: globalThis.AbortSignal,
    TextEncoder: globalThis.TextEncoder, atob: globalThis.atob, btoa: globalThis.btoa, setTimeout: globalThis.setTimeout};
}

// Must run before anything reads URL, URLSearchParams, AbortController or AbortSignal: it looks at RN's lazy accessors before the first read resolves them.
function environment() {
  const lazyBefore = Object.fromEntries(["URL", "URLSearchParams", "AbortController", "AbortSignal"].map(name => [name, descriptorKind(name)]));
  const encodingBefore = Object.fromEntries(["TextEncoder", "atob", "btoa", "TextDecoder"].map(name => [name, descriptorKind(name)]));
  const env = globalsUnderTest();
  const functions = globalThis.WebGlobalsHostFunctions;
  const controller = new env.AbortController();
  let blob = null;
  let objectUrl = null;
  try {
    blob = new Blob(["abc"]);
    objectUrl = {url: env.URL.createObjectURL(blob), blobId: blob.data.blobId, offset: blob.data.offset, size: blob.size};
  } catch (error) {
    objectUrl = {error: describeError(error)};
  }
  const constants = NativeBlobModule?.getConstants() ?? null;
  return {
    lazyBefore,
    lazyAfter: Object.fromEntries(["URL", "URLSearchParams", "AbortController", "AbortSignal"].map(name => [name, descriptorKind(name)])),
    encodingBefore,
    encodingAfter: Object.fromEntries(["TextEncoder", "atob", "btoa", "TextDecoder"].map(name => [name, descriptorKind(name)])),
    types: Object.fromEntries(Object.entries(env).map(([name, value]) => [name, typeof value])),
    identity: {
      urlIsModuleUrl: env.URL === ModuleURL,
      searchParamsIsModuleSearchParams: env.URLSearchParams === ModuleSearchParams,
      searchParamsModulesAgree: ModuleSearchParams === SearchParamsOwnModule,
      abortControllerIsModuleController: env.AbortController === ModuleAbortController,
      abortSignalIsModulePublicSignal: env.AbortSignal === ModuleAbortSignalPublic,
      publicSignalDiffersFromClass: ModuleAbortSignalPublic !== ModuleAbortSignal,
      publicPrototypeIsClassPrototype: env.AbortSignal.prototype === ModuleAbortSignal.prototype,
      controllerSignalIsClassInstance: Object.getPrototypeOf(controller.signal) === ModuleAbortSignal.prototype,
      controllerSignalIsPublicInstance: controller.signal instanceof env.AbortSignal,
      urlSearchParamsIsUrlsOwn: new env.URL("https://a.test/?a=1").searchParams instanceof env.URLSearchParams,
      engineEncoder: env.TextEncoder === functions.TextEncoder,
      engineAtob: env.atob === functions.atob,
      engineBtoa: env.btoa === functions.btoa,
    },
    blobConstants: constants,
    objectUrl,
  };
}

const state = {timers: null, servers: null, fetches: {}, xhrs: {}, controllers: {}, log: []};

function run(kind) {
  const env = globalsUnderTest();
  const tables = {url: urlCases, searchParams: searchParamsCases, abort: abortCases, encoding: encodingCases, decoder: decoderCases};
  return runCases(tables[kind], env);
}

// The cases that end on a timer run one after the other; the probe waits for `done`.
function startTimers() {
  state.timers = {done: false, results: null};
  runTimerCases(abortTimerCases, globalsUnderTest()).then(results => {
    state.timers = {done: true, results};
  }, error => {
    state.timers = {done: true, results: null, error: describeError(error)};
  });
}

// The integration with the networking the host provides. RN's fetch is whatwg-fetch over RN's XMLHttpRequest: it listens to the signal and aborts its request.
function urlOf(path) {
  return "http://127.0.0.1:" + state.servers.http + path;
}
const settled = promise => promise.then(value => ({resolved: true, status: value.status}), error => ({resolved: false, error: describeError(error)}));

function track(name, controller) {
  const entry = {signalEvents: 0, abortedAtEvent: null, reasonAtEvent: null};
  controller.signal.addEventListener("abort", () => {
    entry.signalEvents += 1;
    entry.abortedAtEvent = controller.signal.aborted;
    entry.reasonAtEvent = controller.signal.reason === undefined ? null : String(controller.signal.reason?.name ?? controller.signal.reason);
  });
  state.controllers[name] = {controller, entry};
}

function startFetch(name, path, options = {}) {
  const {AbortController} = globalsUnderTest();
  const controller = new AbortController();
  track(name, controller);
  if (options.abortFirst === true) {
    controller.abort(options.reason);
  }
  state.fetches[name] = {status: "running", outcome: null};
  settled(fetch(urlOf(path), {signal: controller.signal})).then(outcome => {
    state.fetches[name] = {status: "done", outcome};
    state.log.push({event: "fetch", name});
  });
}

function startXhr(name, path) {
  const {AbortController} = globalsUnderTest();
  const controller = new AbortController();
  track(name, controller);
  const request = new XMLHttpRequest();
  const events = [];
  for (const type of ["readystatechange", "load", "error", "abort", "timeout", "loadend"]) {
    request.addEventListener(type, () => events.push({type, readyState: request.readyState, status: request.status}));
  }
  request.onabort = () => state.log.push({event: "xhr-abort", name});
  controller.signal.addEventListener("abort", () => request.abort());
  request.open("GET", urlOf(path));
  request.send();
  state.xhrs[name] = {request, events};
}

function abort(name, reason) {
  const entry = state.controllers[name];
  if (reason === "error") {
    const error = new Error("a reason of the caller");
    entry.reason = error;
    entry.controller.abort(error);
    entry.entry.reasonIsTheCallers = entry.controller.signal.reason === error;
  } else {
    entry.controller.abort();
  }
}

function networkState() {
  const controllers = Object.fromEntries(Object.entries(state.controllers).map(([name, {controller, entry}]) =>
    [name, {...entry, aborted: controller.signal.aborted}]));
  return {fetches: state.fetches, controllers, log: state.log,
    // RN's XMLHttpRequest resets itself at the end of abort(), so its readyState reads UNSENT afterwards: the end of a request is its loadend event.
    xhrs: Object.fromEntries(Object.entries(state.xhrs).map(([name, {request, events}]) =>
      [name, {events, ended: events.some(event => event.type === "loadend"), readyState: request.readyState, status: request.status}]))};
}

globalThis.WebGlobalsProbe = {
  environment,
  run,
  startTimers,
  timers: () => state.timers,
  configure(servers) {
    state.servers = servers;
  },
  startFetch,
  startXhr,
  abort,
  network: networkState,
};
