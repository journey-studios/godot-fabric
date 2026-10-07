import React, {useEffect} from "react";
import {AppRegistry, TurboModuleRegistry, View} from "react-native";
import {disposeEnvironment, environmentStats} from "../src/platform-environment";

// Drives React Native's own networking globals (fetch with Headers, Request and
// Response, XMLHttpRequest, FormData, Blob, FileReader, AbortController) through
// the public react-native bundle against the suite's local server, and records
// what JS observes. Every case is one named scenario; the probe starts it, waits
// for it and compares the record with what the server saw. Nothing here knows
// the native module: on a host without it every network case records the error
// RN throws where it first looks the module up, and the cases that need no
// network (the JavaScript ones) behave the same on both hosts.
const state = {servers: null, cases: {}, sequence: 0, roots: {}, log: [], controllers: {}, requests: {}};
// The modules as the bundle first found them, retained to be called after the application stops.
const retained = {};
for (const name of ["Networking", "BlobModule", "FileReaderModule"]) {
  try {
    retained[name] = TurboModuleRegistry.get(name);
  } catch (error) {
    retained[name] = null;
  }
}

const describeError = error => ({name: String(error?.name ?? "Error"), message: String(error?.message ?? error)});
const bytesOf = buffer => Array.from(new Uint8Array(buffer));
// FNV-1a over the bytes: the same value the oracle computes from the server's pattern.
function fnv1a(buffer) {
  const bytes = new Uint8Array(buffer);
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += 1) {
    hash = Math.imul(hash ^ bytes[index], 0x01000193) >>> 0;
  }
  return hash;
}
const pairsOf = headers => {
  const pairs = [];
  headers.forEach((value, name) => pairs.push([name, value]));
  return pairs;
};
const settled = promise => promise.then(value => ({value}), error => ({error: describeError(error)}));

function context(root, args) {
  const servers = state.servers;
  const origin = args?.origin ?? "http";
  const base = {http: "http://127.0.0.1:" + servers.http, other: "http://127.0.0.1:" + servers.other,
    https: "https://127.0.0.1:" + servers.https, httpsUntrusted: "https://127.0.0.1:" + servers.httpsUntrusted,
    refused: "http://127.0.0.1:" + servers.refused, blackhole: "http://127.0.0.1:" + servers.blackhole};
  return {root, args: args ?? {}, base, url: path => base[origin] + path};
}

// One XMLHttpRequest, with every event it dispatches recorded in order.
function xhr({method = "GET", url, headers = {}, body = null, responseType = "", timeout = 0, listen = true, handle}) {
  return new Promise(resolve => {
    const request = new XMLHttpRequest();
    const events = [];
    const note = type => events.push({type, readyState: request.readyState, status: request.status});
    if (listen) {
      for (const type of ["readystatechange", "load", "error", "abort", "timeout", "loadend", "progress"]) {
        request.addEventListener(type, () => note(type));
      }
    } else {
      request.onload = () => note("load");
      request.onerror = () => note("error");
      request.ontimeout = () => note("timeout");
      request.onabort = () => note("abort");
    }
    request.onloadend = () => resolve(request);
    request.responseType = responseType;
    request.timeout = timeout;
    request.open(method, url);
    for (const [name, value] of Object.entries(headers)) {
      request.setRequestHeader(name, value);
    }
    request.events = events;
    handle?.(request);
    request.send(body);
  });
}
function summarize(request) {
  const typed = request.responseType;
  const summary = {events: request.events, readyState: request.readyState, status: request.status, responseURL: request.responseURL ?? null,
    contentType: request.getResponseHeader("content-type"), missing: request.getResponseHeader("x-missing"),
    allHeaders: request.getAllResponseHeaders(), responseType: typed};
  if (typed === "" || typed === "text") {
    summary.responseText = request.responseText;
  }
  return summary;
}

function readBlob(blob, method, ...rest) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader[method](blob, ...rest);
  });
}

const cases = {
  // JavaScript only: identical on a host without the native modules.
  pure: async () => {
    const headers = new Headers({"X-A": "1"});
    headers.append("x-a", "2");
    const request = new Request("http://example.test/x", {method: "post", body: "ação", headers: {"content-type": "text/plain"}});
    const controller = new AbortController();
    const heard = [];
    controller.signal.addEventListener("abort", () => heard.push(controller.signal.aborted));
    controller.abort();
    const form = new FormData();
    form.append("field", "ação");
    return {
      globals: Object.fromEntries(["fetch", "Headers", "Request", "Response", "FormData", "Blob", "File", "URL",
        "URLSearchParams", "AbortController", "AbortSignal"].map(name => [name, typeof globalThis[name]])),
      header: headers.get("x-a"), method: request.method, requestText: await request.text(), aborted: controller.signal.aborted, heard,
      formParts: form.getParts().map(part => ({string: part.string, headers: part.headers})),
      search: new URLSearchParams("a=1&b=%C3%A7").get("b"),
    };
  },
  // Reading XMLHttpRequest or FileReader loads their modules, which throw where they need a native module.
  globals: async () => Object.fromEntries(["XMLHttpRequest", "FileReader"].map(name => {
    try {
      return [name, typeof globalThis[name]];
    } catch (error) {
      return [name, "throws: " + String(error.message)];
    }
  })),
  json: async ({url}) => {
    const response = await fetch(url("/json"));
    const body = await response.json();
    return {status: response.status, ok: response.ok, url: response.url, contentType: response.headers.get("content-type"),
      missing: response.headers.get("x-missing"), body, bodyUsed: response.bodyUsed};
  },
  // A multi-byte body through fetch's blob path: text, the blob's byte size and its type.
  utf8: async ({url}) => {
    const response = await fetch(url("/utf8"));
    const copy = response.clone();
    const text = await response.text();
    const blob = await copy.blob();
    return {text, blobSize: blob.size, blobType: blob.type, contentType: response.headers.get("content-type")};
  },
  latin1: async ({url}) => {
    const response = await fetch(url("/latin1"));
    const copy = response.clone();
    const blob = await copy.blob();
    return {text: await response.text(), blobSize: blob.size, blobType: blob.type};
  },
  // Android's two paths differ on a BOM: OkHttp's string() drops it, FileReader keeps it.
  bom: async ({url}) => {
    const response = await fetch(url("/bom"));
    const viaFetch = await response.text();
    const viaXhr = (await xhr({url: url("/bom")})).responseText;
    return {viaFetch, viaXhr};
  },
  badUtf8: async ({url}) => {
    const response = await fetch(url("/bad-utf8"));
    const viaFetch = await response.text();
    const viaXhr = (await xhr({url: url("/bad-utf8")})).responseText;
    return {viaFetch, viaXhr};
  },
  bytes: async ({url}) => {
    const response = await fetch(url("/bytes/4096"));
    const buffer = await response.arrayBuffer();
    return {length: buffer.byteLength, bytes: bytesOf(buffer), sha256: response.headers.get("x-body-sha256")};
  },
  large: async ({url}) => {
    const response = await fetch(url("/large/1048576"));
    const buffer = await response.arrayBuffer();
    return {length: buffer.byteLength, fnv: fnv1a(buffer), declared: response.headers.get("x-body-length"), sha256: response.headers.get("x-body-sha256")};
  },
  // The server closes the connection right after its answer, with a length and chunked.
  closing: async ({url}) => {
    const sized = await (await fetch(url("/close/70000"))).arrayBuffer();
    const chunked = await (await fetch(url("/close-chunked/70000"))).arrayBuffer();
    return {sized: {length: sized.byteLength, fnv: fnv1a(sized)}, chunked: {length: chunked.byteLength, fnv: fnv1a(chunked)}};
  },
  status: async ({url}) => {
    const results = {};
    for (const code of [404, 500, 204, 304]) {
      const response = await fetch(url("/status/" + code));
      results[code] = {status: response.status, ok: response.ok, text: await response.text()};
    }
    const head = await fetch(url("/status/200"), {method: "HEAD"});
    results.head = {status: head.status, ok: head.ok, text: await head.text(), contentType: head.headers.get("content-type")};
    return results;
  },
  // Request headers as the server received them, and Headers' own joining of repeats.
  echoHeaders: async ({url}) => {
    const headers = new Headers();
    headers.append("X-Custom", "one");
    headers.append("x-custom", "two");
    headers.set("Accept", "application/json");
    headers.set("X-Unicode", "ação");
    const response = await fetch(url("/echo?case=headers"), {headers});
    const echo = await response.json();
    return {sent: pairsOf(headers), echo: {method: echo.method, url: echo.url, headers: echo.headers, rawHeaders: echo.rawHeaders}};
  },
  // Nothing is stored: /headers sets cookies, and clearCookies, which has nothing to clear, answers false.
  cookies: async ({url}) => {
    const first = await fetch(url("/headers"));
    const second = await fetch(url("/echo?case=cookies"), {credentials: "include"});
    const echo = await second.json();
    const cleared = await new Promise(resolve => retained.Networking.clearCookies(resolve));
    return {setCookie: first.headers.get("set-cookie"), sentCookie: echo.headers.cookie ?? null, cleared};
  },
  responseHeaders: async ({url}) => {
    const response = await fetch(url("/headers"));
    return {pairs: pairsOf(response.headers), setCookie: response.headers.get("set-cookie"), multi: response.headers.get("x-multi"),
      mixed: response.headers.get("X-MIXED-CASE"), empty: response.headers.get("x-empty"), has: response.headers.has("x-multi")};
  },
  postJson: async ({url}) => {
    const body = JSON.stringify({text: "ação", list: [1, 2, 3]});
    const response = await fetch(url("/echo?case=post-json"), {method: "POST", headers: {"content-type": "application/json"}, body});
    const echo = await response.json();
    return {sent: body, echo: {method: echo.method, bodyBytes: echo.bodyBytes, bodySha256: echo.bodySha256, headers: echo.headers}};
  },
  postDefaultType: async ({url}) => {
    // whatwg-fetch gives a string body its own text/plain content type.
    const response = await fetch(url("/echo?case=post-default"), {method: "POST", body: "só texto"});
    const echo = await response.json();
    return {echo: {method: echo.method, bodyBytes: echo.bodyBytes, bodySha256: echo.bodySha256, headers: echo.headers}};
  },
  postBytes: async ({url}) => {
    const body = new Uint8Array(256).map((_, index) => index);
    const response = await fetch(url("/echo?case=post-bytes"), {method: "POST", headers: {"content-type": "application/octet-stream"}, body});
    const echo = await response.json();
    return {echo: {method: echo.method, bodyBytes: echo.bodyBytes, bodySha256: echo.bodySha256, headers: echo.headers}};
  },
  // Android refuses a binary body without a content type, and nothing reaches the server.
  postBytesNoType: async ({url}) => settled(fetch(url("/echo?case=post-bytes-no-type"), {method: "POST", body: new Uint8Array([1, 2, 3])})),
  postFormData: async ({url}) => {
    const form = new FormData();
    form.append("field", "ação 日本語");
    form.append("plain", "abc");
    const response = await fetch(url("/echo?case=form-data"), {method: "POST", body: form});
    const echo = await response.json();
    return {echo: {method: echo.method, bodyBytes: echo.bodyBytes, bodyBase64: echo.bodyBase64, headers: echo.headers}};
  },
  postFormDataFile: async ({url}) => {
    const form = new FormData();
    form.append("file", {uri: "file:///picture.png", type: "image/png", name: "picture.png"});
    return settled(fetch(url("/echo?case=form-data-file"), {method: "POST", body: form}));
  },
  postBlob: async ({url}) => {
    const blob = new Blob(["olá ", "mundo ", new Blob(["😀"])], {type: "text/plain;charset=utf-8"});
    const response = await fetch(url("/echo?case=post-blob"), {method: "POST", body: blob});
    const echo = await response.json();
    return {blobSize: blob.size, echo: {method: echo.method, bodyBytes: echo.bodyBytes, bodySha256: echo.bodySha256, headers: echo.headers}};
  },
  redirect302: async ({url, args}) => {
    const response = await fetch(url("/redirect/302?to=" + encodeURIComponent("/echo?case=redirect-302-" + args.id)),
      {method: "POST", headers: {"content-type": "text/plain", "x-keep": "kept"}, body: "payload-302"});
    const echo = await response.json();
    return {status: response.status, url: response.url, echo: {method: echo.method, url: echo.url, bodyBytes: echo.bodyBytes, headers: echo.headers}};
  },
  redirect307: async ({url}) => {
    const response = await fetch(url("/redirect/307?to=" + encodeURIComponent("/echo?case=redirect-307")),
      {method: "POST", headers: {"content-type": "text/plain"}, body: "payload-307"});
    const echo = await response.json();
    return {status: response.status, url: response.url, echo: {method: echo.method, url: echo.url, bodyBytes: echo.bodyBytes, bodySha256: echo.bodySha256, headers: echo.headers}};
  },
  redirectChain: async ({url, args}) => {
    const outcome = await settled(fetch(url("/redirect-chain/" + args.hops)));
    return outcome.error ? outcome : {status: outcome.value.status, url: outcome.value.url, text: await outcome.value.text()};
  },
  redirectLoop: async ({url}) => settled(fetch(url("/redirect-loop"))),
  // Authorization is sent to the same origin and dropped across origins.
  redirectOrigins: async ({url}) => {
    const headers = {authorization: "Bearer secret", "x-keep": "kept"};
    const same = await (await fetch(url("/redirect/302?to=" + encodeURIComponent("/echo?case=redirect-same")), {headers})).json();
    const cross = await (await fetch(url("/redirect-cross"), {headers})).json();
    return {same: {url: same.url, headers: same.headers}, cross: {url: cross.url, headers: cross.headers}};
  },
  // A redirect to a scheme the host cannot follow is the response itself.
  redirectScheme: async ({url}) => {
    const response = await fetch(url("/redirect-scheme"));
    return {status: response.status, ok: response.ok, location: response.headers.get("location"), text: await response.text()};
  },
  gzip: async ({url}) => {
    const fetched = await settled(fetch(url("/gzip")));
    const request = await xhr({url: url("/gzip")});
    return {fetched, xhr: summarize(request)};
  },
  networkErrors: async ({url, base}) => {
    const refused = await settled(fetch(base.refused + "/"));
    const reset = await settled(fetch(url("/reset")));
    const truncated = await xhr({url: url("/truncated")});
    const unsupported = await settled(fetch("ftp://127.0.0.1/file"));
    const invalid = await settled(fetch("http://"));
    const method = await xhr({method: "CONNECT", url: url("/echo")});
    return {refused, reset, truncated: summarize(truncated), unsupported, invalid, method: summarize(method)};
  },
  https: async ({url, args}) => {
    const response = await settled(fetch(url("/json?case=" + (args.label ?? "https"))));
    return response.error ? response : {status: response.value.status, url: response.value.url, body: await response.value.json()};
  },
  // XMLHttpRequest events, headers and every response type.
  xhrEvents: async ({url}) => {
    const request = await xhr({url: url("/json")});
    return {...summarize(request), json: JSON.parse(request.responseText)};
  },
  xhrMinimal: async ({url}) => summarize(await xhr({url: url("/json"), listen: false})),
  xhrIncremental: async ({url}) => {
    const request = await xhr({url: url("/json"), handle: handler => { handler.onprogress = () => {}; handler.onreadystatechange = () => {}; }});
    return summarize(request);
  },
  xhrTypes: async ({url}) => {
    const buffer = await xhr({url: url("/bytes/512"), responseType: "arraybuffer"});
    const blob = await xhr({url: url("/utf8"), responseType: "blob"});
    const json = await xhr({url: url("/json"), responseType: "json"});
    const text = await xhr({url: url("/utf8"), responseType: "text"});
    const empty = await xhr({url: url("/status/204"), responseType: "blob"});
    const failed = await xhr({url: url("/reset"), responseType: "blob"});
    const results = {
      arraybuffer: {...summarize(buffer), bytes: bytesOf(buffer.response)},
      blob: {...summarize(blob), size: blob.response.size, type: blob.response.type, text: await readBlob(blob.response, "readAsText")},
      json: {...summarize(json), value: json.response},
      text: summarize(text),
      emptyBlob: {...summarize(empty), size: empty.response.size},
      failedBlob: {...summarize(failed), response: failed.response === null ? null : typeof failed.response},
    };
    // Blobs live until JS closes them: release every one this case made.
    for (const request of [blob, empty, failed]) {
      request.response?.close();
    }
    return results;
  },
  xhrHttpErrors: async ({url}) => {
    const notFound = await xhr({url: url("/status/404")});
    const failure = await xhr({url: url("/status/500"), method: "POST", headers: {"content-type": "text/plain"}, body: "x"});
    return {notFound: summarize(notFound), failure: summarize(failure)};
  },
  // Blobs and FileReader over the native store.
  blobs: async () => {
    const text = "ação 日本語 😀";
    const inner = new Blob(["mais"]);
    const blob = new Blob([text, " e ", inner], {type: "text/plain;charset=utf-8"});
    const slice = blob.slice(2, 8, "application/x-slice");
    const latin1 = new Blob(["abc"]);
    const untyped = new Blob(["x"]);
    const file = new File(["conteúdo"], "nota.txt", {type: "text/plain", lastModified: 1234});
    const results = {size: blob.size, type: blob.type, sliceSize: slice.size, sliceType: slice.type};
    results.text = await readBlob(blob, "readAsText");
    results.latin1 = await readBlob(latin1, "readAsText", "iso-8859-1");
    results.dataUrl = await readBlob(blob, "readAsDataURL");
    results.untyped = await readBlob(untyped, "readAsDataURL");
    results.arrayBuffer = bytesOf(await readBlob(slice, "readAsArrayBuffer"));
    results.objectUrl = URL.createObjectURL(blob).replace(/[0-9a-f-]{36}/, "<id>");
    results.file = {name: file.name, size: file.size, type: file.type, lastModified: file.lastModified, text: await readBlob(file, "readAsText")};
    results.badEncoding = (await settled(readBlob(blob, "readAsText", "shift_jis"))).error ?? null;
    results.badRead = await settled(readBlob({data: {blobId: "00000000-0000-4000-8000-000000000000", offset: 0, size: 1}}, "readAsText"));
    results.badSlice = await settled(readBlob({data: {...slice.data, offset: 1000}}, "readAsText"));
    slice.close();
    results.closed = (await settled(readBlob(slice, "readAsText"))).error ?? null;
    // Blobs live until JS closes them; the probe expects the native store back at its baseline.
    for (const each of [blob, inner, latin1, untyped, file]) {
      each.close();
    }
    return results;
  },
  // The native module's own contract, below XMLHttpRequest's tolerance: the events RCTNetworking.android.js listens to,
  // their payloads and their order, for each response type and for a failure and a time-out.
  contract: async ({url, base}) => {
    // Required here and not at the top: on a host without the module RN's own import throws where it looks it up,
    // and that must fail this case, not the bundle.
    const RCTNetworking = require("react-native/Libraries/Network/RCTNetworking").default;
    const send = (target, {responseType = "text", timeout = 0}) => new Promise(resolve => {
      const events = [];
      let requestId = null;
      const subscriptions = ["didReceiveNetworkResponse", "didReceiveNetworkData", "didReceiveNetworkIncrementalData",
        "didReceiveNetworkDataProgress", "didSendNetworkData", "didCompleteNetworkResponse"].map(name => RCTNetworking.addListener(name, payload => {
        events.push({name, payload: Array.from(payload)});
        if (name === "didCompleteNetworkResponse") {
          subscriptions.forEach(subscription => subscription.remove());
          resolve({requestId, events});
        }
      }));
      RCTNetworking.sendRequest("GET", "contract", target, {}, null, responseType, false, timeout, id => { requestId = id; }, true);
    });
    return {
      text: await send(url("/utf8?contract=text"), {}),
      base64: await send(url("/bytes/16"), {responseType: "base64"}),
      reset: await send(url("/reset"), {}),
      timeout: await send(base.blackhole + "/", {timeout: 150}),
    };
  },
  // fetch makes a response blob for every answer, and nothing in whatwg-fetch closes it: only the garbage collector can.
  unclosed: async ({url}) => {
    for (let index = 0; index < 5; index += 1) {
      const response = await fetch(url("/utf8?collect=" + index));
      await response.text();
    }
    return {fetched: 5};
  },
  // Two-phase cases: started here, ended by abort(), release or the server.
  hangFetch: ({url, args}) => {
    const controller = new AbortController();
    state.controllers[args.name] = controller;
    return settled(fetch(url("/hang/" + args.name), {signal: controller.signal}));
  },
  abortedBefore: async ({url}) => {
    const controller = new AbortController();
    controller.abort();
    return settled(fetch(url("/echo?case=aborted-before"), {signal: controller.signal}));
  },
  // A request that is sent to a port that never answers can only end by its own time-out, on the real clock.
  timeoutReal: async ({base}) => summarize(await xhr({url: base.blackhole + "/", timeout: 150})),
  hangXhr: ({url, args}) => xhr({url: url((args.body ? "/hang-body/" : "/hang/") + args.name), responseType: args.responseType ?? "",
    timeout: args.timeout ?? 0, handle: request => { state.requests[args.name] = request; }}).then(summarize),
  hangStays: ({url, args}) => new Promise(() => {
    // Never settles: the request is left in flight for the application to stop.
    if (args.kind === "fetch") {
      fetch(url("/hang/" + args.name)).then(() => state.log.push({event: "settled", name: args.name}), () => state.log.push({event: "failed", name: args.name}));
    } else {
      xhr({url: url((args.body ? "/hang-body/" : "/hang/") + args.name), responseType: args.responseType ?? "",
        handle: request => {
          state.requests[args.name] = request;
          for (const type of ["load", "error", "abort", "timeout", "loadend"]) {
            request.addEventListener(type, () => state.log.push({event: type, name: args.name}));
          }
        }});
    }
  }),
  concurrent: async ({url, root}) => {
    const [json, text, bytes, post] = await Promise.all([
      fetch(url("/json?root=" + root)).then(response => response.json()),
      fetch(url("/utf8?root=" + root)).then(response => response.text()),
      xhr({url: url("/bytes/64"), responseType: "arraybuffer"}).then(request => bytesOf(request.response)),
      fetch(url("/echo?root=" + root), {method: "POST", headers: {"content-type": "text/plain"}, body: "from root " + root}).then(response => response.json()),
    ]);
    return {json, text, bytes, post: {url: post.url, bodyBytes: post.bodyBytes, bodySha256: post.bodySha256}};
  },
};

function start(name, root, args) {
  const key = `${root}:${name}${args?.label ? ":" + args.label : ""}`;
  const entry = {name, root, status: "running", sequence: ++state.sequence, result: null, error: null};
  state.cases[key] = entry;
  Promise.resolve().then(() => cases[name](context(root, args))).then(
    result => { entry.status = "done"; entry.result = result ?? null; state.log.push({event: "done", key}); },
    error => { entry.status = "failed"; entry.error = describeError(error); state.log.push({event: "failed", key}); });
  return key;
}

function Root({name}) {
  useEffect(() => {
    state.roots[name] = {mounted: true, cleanups: 0};
    return () => {
      state.roots[name].mounted = false;
      state.roots[name].cleanups += 1;
      state.log.push({event: "cleanup", name});
    };
  }, [name]);
  return <View testID={"networking-" + name} style={{width: 120, height: 40, backgroundColor: "#0f766e"}} />;
}
AppRegistry.registerComponent("NetworkingProbe", () => Root);

globalThis.NetworkingProbe = {
  configure(servers) {
    state.servers = servers;
  },
  start,
  // Pure JS reads only: valid after the application stops.
  snapshot() {
    return {cases: state.cases, roots: state.roots, log: state.log, environment: environmentStats()};
  },
  // Garbage for the collector: every call allocates a few megabytes and keeps none.
  churn() {
    let garbage = [];
    for (let index = 0; index < 200; index += 1) {
      garbage.push(new Array(5000).fill(index));
    }
    garbage = null;
    return true;
  },
  status(key) {
    return state.cases[key]?.status ?? "missing";
  },
  entry(key) {
    return state.cases[key] ?? null;
  },
  // The events a started request has dispatched so far.
  xhrEvents(name) {
    return state.requests[name]?.events ?? null;
  },
  abort(name) {
    state.controllers[name]?.abort();
  },
  abortXhr(name) {
    state.requests[name]?.abort();
  },
  // The native modules as JS finds them.
  modules() {
    const find = name => {
      try {
        return TurboModuleRegistry.get(name) != null;
      } catch (error) {
        return String(error.message);
      }
    };
    return {Networking: find("Networking"), BlobModule: find("BlobModule"), FileReaderModule: find("FileReaderModule"), WebSocketModule: find("WebSocketModule")};
  },
  // A WebSocket constructs where the host has the module and throws RN's own lookup error where it has not. Nothing listens
  // on the port: the socket fails at once, and closing it is all the cleanup it needs.
  webSocket() {
    try {
      const socket = new WebSocket("ws://127.0.0.1:1/");
      socket.close();
      return {created: true};
    } catch (error) {
      return {created: false, message: String(error.message)};
    }
  },
  // The retained modules, called after the application stopped.
  afterStop() {
    const attempt = (module, call) => {
      if (module == null) {
        return "missing";
      }
      try {
        call(module);
        return "returned";
      } catch (error) {
        return String(error.message);
      }
    };
    return {
      send: attempt(retained.Networking, module => module.sendRequest("GET", "http://127.0.0.1:1/", 9001, [], {}, "text", false, 0, false)),
      abort: attempt(retained.Networking, module => module.abortRequest(9001)),
      clearCookies: attempt(retained.Networking, module => module.clearCookies(() => {})),
      constants: attempt(retained.BlobModule, module => module.getConstants()),
      createFromParts: attempt(retained.BlobModule, module => module.createFromParts([], "stopped")),
      release: attempt(retained.BlobModule, module => module.release("stopped")),
      read: attempt(retained.FileReaderModule, module => module.readAsText({blobId: "x", offset: 0, size: 0}, "utf-8")),
      lookup: attempt({}, () => TurboModuleRegistry.get("Networking")),
    };
  },
  dispose() {
    disposeEnvironment();
    return {environment: environmentStats(), log: state.log.length};
  },
};
