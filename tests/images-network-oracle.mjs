import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {contentModeDraw, decodedPixels, decodes, headerSize, pixelLimit, sizeLimit, sniff} from "./images-oracle.mjs";
import {buildPictures} from "./images-network-server.mjs";
import {fingerprint, pictures as patterns, rgba} from "./images-pattern.mjs";

// Independent oracle for build/images-network-report.json, written apart from tests/images-network-probe.gd and from the C++ it
// probes. It reads the server's own log (every request as it arrived on the wire, every answer as it was sent) and the files the
// server serves, recomputes what RN iOS's RCTImageLoader, RCTImageCache and NSURLCache do with them, and only then compares. Its
// model of the two caches is replayed over the operations the probe did, in order, with the clock each one ran at: where a
// picture came from (the decoded cache, the byte cache or the network), every request the server saw, and the keys both caches
// hold at the checkpoints must all agree with it.
const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(root, "tests/fixtures/images/manifest.json"), "utf8"));
const bodies = buildPictures();
const same = (actual, expected, label) => assert.deepEqual(actual, expected, label);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fround = Math.fround;

// The checks that hold on a host without network images: they say nothing the network contributes. Every other check needs it.
export const networkJsOnlyChecks = [
  "mount/Every declared Image mounts one native GodotImage",
  "mount/The application reports no host or runtime error",
  "mount/Every Image asked the loader for exactly one request",
  "mount/No Image fails to render: the wrapper takes the request keys of a source, and crossOrigin and referrerPolicy",
  "threads/Every task the pool handed out was awaited",
  "failures/A failed Image ends with error and loadEnd, leaves no texture and draws nothing",
  "cleanup/No host or runtime diagnostic was reported",
  "report/The network images report is saved",
];
export const networkCheckCount = 72;

// ---- what the server answers, from its routes ----

const redirects = [301, 302, 303, 307, 308];
function answerFor(target) {
  const url = new URL(target, "http://placeholder");
  const parts = url.pathname.split("/").filter(Boolean);
  switch (parts[0]) {
    case "pic": return {status: 200, body: bodies[parts[2]], name: parts[2], policy: parts[1]};
    case "chunked": return {status: 200, body: bodies[parts[1]], name: parts[1], chunked: true};
    case "redirect": return {status: Number(parts[1]), location: url.searchParams.get("to"), body: Buffer.from("moved")};
    case "status": return {status: Number(parts[1]), body: Buffer.from(`status ${parts[1]}`), reason: "no luck"};
    case "status-empty": return {status: Number(parts[1]), body: Buffer.alloc(0), reason: "no luck"};
    case "empty200": return {status: 200, body: Buffer.alloc(0), reason: "empty"};
    case "html": return {status: 200, body: Buffer.from("<!doctype html><title>not a picture</title>\n")};
    case "reset": return {failure: "head"};
    case "truncated": return {failure: "body", status: 200, reason: "cut", announced: bodies["quad24.png"].length + 100};
    default: throw new Error("The oracle does not know the route " + target);
  }
}
const fill = (text, inputs) => text.replace(/\$(https|http|other|refused)\b/g, (_, name) => inputs[name]);
const targetOf = uri => {
  const url = new URL(uri);
  return url.pathname + url.search;
};
const listenerOf = (uri, ports) => {
  const port = Number(new URL(uri).port);
  return Object.entries(ports).find(([, value]) => value === port)?.[0];
};

// The requests the server recorded for a URL (path and query) on a listener, in order.
function recordsFor(report, uri) {
  const listener = listenerOf(uri, report.ports);
  return report.server.records.filter(row => row.kind === "request" && row.url === targetOf(uri) && row.listener === listener);
}
function rawHeaders(record) {
  const out = [];
  for (let index = 0; index < record.rawHeaders.length; index += 2) {
    out.push([record.rawHeaders[index].toLowerCase(), record.rawHeaders[index + 1]]);
  }
  return out;
}
const valuesOf = (record, name) => rawHeaders(record).filter(([key]) => key === name).map(([, value]) => value);

// Where a URL leads, hop by hop, and what the last hop is.
function follow(uri, report) {
  const hops = [];
  let current = uri;
  for (let count = 0; count <= 20; count++) {
    if (listenerOf(current, report.ports) === "refused") {
      return {hops, refused: new URL(current).host};
    }
    const answer = answerFor(targetOf(current));
    hops.push({url: new URL(current).href, answer});
    if (redirects.includes(answer.status) && answer.location) {
      current = new URL(answer.location, current).href;
      continue;
    }
    return {hops, last: hops[hops.length - 1]};
  }
  throw new Error("The oracle follows no more than 20 redirects");
}

// What RCTImageLoader does with the bytes of a 200 response: the decode error, or the picture.
function decodeOutcome(bytes, request) {
  const size = bytes.length;
  const format = sniff(bytes, "");
  const failure = reason => ({error: new RegExp(`^Error decoding image data <${size} bytes>: ${reason}`)});
  if (format === "gif") {
    return failure("GIF images are not supported");
  }
  if (format === "unknown") {
    return failure("the bytes are not an image format this host decodes");
  }
  const header = headerSize(format, bytes, "");
  if (header.width > sizeLimit || header.height > sizeLimit || header.width * header.height > pixelLimit) {
    return failure("The image is \\d+x\\d+ pixels, over the host limit");
  }
  if (!decodes(format, bytes)) {
    return failure(`the ${format} decoder rejected the data`);
  }
  const vector = format === "svg";
  const [width, height] = vector ? [Math.ceil(header.width * request.scale), Math.ceil(header.height * request.scale)]
    : decodedPixels([header.width, header.height], request.size, request.scale);
  return {format, width, height, sourceWidth: vector ? width : header.width, sourceHeight: vector ? height : header.height, scale: request.scale};
}

// What stops a request before it reaches the wire: a header the wire cannot carry, a method the transport cannot send, and a cache
// policy that wants the cache alone when nothing is cached.
const methods = new Set(["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS", "TRACE", "PATCH"]);
function refusedBeforeTheWire(source) {
  for (const [name, value] of Object.entries(source.headers ?? {})) {
    if (!/^[0-9A-Za-z!#$%&'*+\-.^_`|~]+$/.test(name)) return `The image source has an invalid header name: "${name}"`;
    if (/[\r\n\0]/.test(value)) {
      return `The image source has an invalid value for the header "${name}"`;
    }
  }
  const method = (source.method ?? "GET").toUpperCase();
  if (source.cache === "only-if-cached") {
    return /only-if-cached/;
  }
  return methods.has(method) ? null : `Unsupported HTTP method: ${method}`;
}

// The result of a view's request, from the answers: its events, and a picture or the payload of its error.
function expectLoad(source, uri, request, report) {
  const flow = follow(uri, report);
  const out = {events: ["loadStart"]};
  const fail = (message, extra = {}) => {
    out.events.push("error", "loadEnd");
    return Object.assign(out, {error: message, code: null, headers: null}, extra);
  };
  const refusal = refusedBeforeTheWire(source);
  if (refusal) {
    return fail(refusal);
  }
  if (flow.refused) {
    return fail(`Failed to connect to ${flow.refused}`);
  }
  const {answer, url} = flow.last;
  const host = new URL(url).host;
  if (answer.failure === "head") {
    return fail(new RegExp(`^Connection (to ${escape(host)} was lost|closed by ${escape(host)}) before a response arrived$`));
  }
  const record = recordsFor(report, url).at(-1);
  const sent = {code: answer.status, headers: record?.responseHeaders ?? {}, url};
  if (answer.failure === "body") {
    out.progressTotal = answer.announced;
    return fail(new RegExp(`^(unexpected end of stream from ${escape(host)}|Connection to ${escape(host)} was lost while receiving the response)$`), {...sent, bytesBeforeFailure: true});
  }
  out.progressTotal = answer.chunked ? -1 : answer.body.length;
  out.progressBytes = answer.body.length;
  if (answer.body.length === 0) {
    return fail("Unknown image download error", sent);
  }
  out.events.push("progress");
  if (answer.status !== 200) {
    return fail(`Failed to load ${new URL(url).href}`, sent);
  }
  const decoded = decodeOutcome(answer.body, request);
  if (decoded.error) {
    return fail(decoded.error);
  }
  out.picture = decoded;
  out.fixture = Object.entries(manifest.files).find(([, entry]) => entry.sha256 === sha(answer.body))?.[0] ?? null;
  out.events.push("load", "loadEnd");
  out.reported = [fround(fround(decoded.width / decoded.scale) * fround(request.scale)), fround(fround(decoded.height / decoded.scale) * fround(request.scale))];
  return out;
}

// ---- events ----

const eventTypes = new Set(["loadStart", "progress", "partialLoad", "load", "error", "loadEnd"]);
function eventOrderProblem(events) {
  let state = "idle";
  for (const [index, {type}] of events.entries()) {
    if (type === "loadStart" && state !== "result") {
      state = "started";
    } else if (state === "idle") {
      return index === 0 ? `event 0 (${type}) precedes the loadStart of its request` : `event ${index} (${type}) follows the loadEnd of its request`;
    } else if (type === "progress" || type === "partialLoad") {
      if (state === "result") {
        return `event ${index} (${type}) follows the result of its request`;
      }
    } else if (type === "load" || type === "error") {
      if (state === "result") {
        return `event ${index} (${type}) is a second result of its request`;
      }
      state = "result";
    } else if (type === "loadEnd") {
      if (state !== "result") {
        return `event ${index} (loadEnd) has no result of its request before it`;
      }
      state = "idle";
    } else {
      return `event ${index} (${type}) is out of order`;
    }
  }
  return null;
}
// A list may end in the middle of a request: an Image that is unmounted mid-download hears nothing after it.
function verifyEventOrder(value, where = "report", seen = {lists: 0}) {
  if (Array.isArray(value) && value.length > 0 && value.every(item => item !== null && typeof item === "object" && eventTypes.has(item.type))) {
    const problem = eventOrderProblem(value);
    assert.equal(problem, null, `${where}: ${problem}`);
    seen.lists += 1;
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      verifyEventOrder(item, `${where}.${key}`, seen);
    }
  }
  return seen.lists;
}
// The Images whose request the probe cancels, or stops: every other Image ends its last request with a loadEnd.
const unfinished = new Set(["cancel-body", "cancel-head", "h7", "stop-decode", "stop-body-1", "stop-body-2", "stop-head-1", "stop-head-2", "stop-head-3"]);

function verifyProgress(events, total, whole, label) {
  let previous = 0;
  assert.ok(events.length >= 1, label + ": a progress event");
  for (const event of events) {
    assert.ok(event.loaded > previous, `${label}: cumulative bytes only grow (${event.loaded} after ${previous})`);
    assert.equal(event.total, total, label + ": total");
    // A float32 that Godot's JSON writer rounded to fifteen digits.
    const wanted = fround(fround(event.loaded) / fround(total));
    assert.ok(Math.abs(event.progress - wanted) <= 1e-12 * Math.max(1, Math.abs(wanted)), `${label}: progress is loaded over total (${event.progress} against ${wanted})`);
    previous = event.loaded;
  }
  if (whole != null) {
    assert.equal(previous, whole, label + ": the last progress event is the whole body");
  }
}

// ---- the declared cases ----

function verifyCase(spec, report) {
  const {logs} = report.stages.mount.react;
  const node = report.stages.mount.surface.nodes.find(entry => entry.testID === spec.id);
  assert.ok(node && node.kind === "image", spec.id);
  const view = node.image, label = spec.id;
  const size = spec.style?.width ?? 24;
  const uri = fill(spec.source.uri, report.inputs);
  const expected = expectLoad(spec.source, uri, {size: [size, size], scale: report.scale}, report);
  const log = logs[spec.id];
  const types = log.map(event => event.type);
  // The number of progress events depends on how the bytes arrived; their order and their payloads do not.
  assert.equal(types.filter(type => type !== "progress").join(), expected.events.filter(type => type !== "progress").join(), label + ": events in order");
  same(view.events.map(event => event.type), types, label + ": native emission");
  const progress = log.filter(event => event.type === "progress");
  if (expected.picture) {
    assert.ok(progress.length >= 1, label + ": progress");
    verifyProgress(progress, expected.progressTotal, expected.progressBytes, label);
  } else if (expected.progressBytes > 0 && !expected.bytesBeforeFailure) {
    verifyProgress(progress, expected.progressTotal, expected.progressBytes, label);
  } else if (expected.bytesBeforeFailure) {
    verifyProgress(progress, expected.progressTotal, null, label);
    assert.ok(progress.every(event => event.loaded < event.total), label + ": the bytes that came fall short of the total");
  } else {
    assert.equal(progress.length, 0, label + ": nothing downloaded, nothing to report");
  }
  if (expected.error !== undefined) {
    const event = log.find(entry => entry.type === "error");
    if (expected.error instanceof RegExp) {
      assert.match(event.error, expected.error, label);
    } else {
      assert.equal(event.error, expected.error, label);
    }
    assert.equal(view.error, event.error, label);
    assert.equal(view.status, "failed", label);
    assert.equal(view.image, null, label + ": no texture");
    assert.equal(view.drawn, null, label + ": nothing drawn");
    if (expected.code == null) {
      same(event.keys, ["error", "target", "timeStamp"], label + ": an error with no response has the message alone");
    } else {
      same(event.keys, ["error", "httpResponseHeaders", "responseCode", "target", "timeStamp"], label + ": error payload");
      assert.equal(event.responseCode, expected.code, label + ": responseCode");
      // Every header the server wrote is in the payload; repeats of one name are joined, as NSHTTPURLResponse joins them.
      const received = Object.fromEntries(Object.entries(event.httpResponseHeaders).map(([name, value]) => [name.toLowerCase(), value]));
      for (const [name, value] of Object.entries(expected.headers)) {
        assert.equal(received[name], Array.isArray(value) ? value.join(", ") : String(value), `${label}: header ${name}`);
      }
      assert.equal(view.counters.errors, 1, label);
    }
  } else {
    assert.equal(view.status, "loaded", label);
    const picture = view.image, wanted = expected.picture;
    same([picture.format, picture.width, picture.height, picture.sourceWidth, picture.sourceHeight, picture.scale],
      [wanted.format, wanted.width, wanted.height, wanted.sourceWidth, wanted.sourceHeight, wanted.scale], label + ": picture");
    // Never resized: the texture has the pixels of the picture, whatever the mode that draws it.
    same([picture.textureWidth, picture.textureHeight], [wanted.width, wanted.height], label + ": texture");
    const load = log.find(entry => entry.type === "load");
    same(load.keys, ["source", "target", "timeStamp"], label + ": load payload");
    same([load.uri, load.width, load.height], [uri, ...expected.reported], label + ": onLoad");
    const known = patterns[expected.fixture];
    if (known?.exact && wanted.width === known.width) {
      assert.equal(picture.fingerprint, fingerprint(rgba(known)), label + ": pixels");
    } else {
      assert.match(picture.fingerprint, /^[0-9a-f]{16}$/, label);
    }
    const natural = [wanted.width / wanted.scale, wanted.height / wanted.scale];
    same([picture.naturalWidth, picture.naturalHeight], natural, label + ": natural size");
    const draw = contentModeDraw(spec.resizeMode ?? "cover", [size, size], natural);
    same([view.drawn.dst.x, view.drawn.dst.y, view.drawn.dst.width, view.drawn.dst.height], [draw.dst.x, draw.dst.y, draw.dst.width, draw.dst.height], label + ": dst");
    same([view.drawn.src.x, view.drawn.src.y, view.drawn.src.width, view.drawn.src.height], [draw.src.x, draw.src.y, draw.src.width, draw.src.height], label + ": src");
  }
  return expected;
}

// What reached the server for the declared requests: the method, the headers and the body, as declared.
function verifyRequests(report) {
  const {declared} = report.stages.mount;
  const wire = (spec, record) => {
    const source = spec.source;
    assert.equal(record.method, (source.method ?? "GET").toUpperCase(), spec.id + ": method");
    const names = rawHeaders(record).map(([name]) => name);
    assert.ok(!names.includes("cookie") && !names.includes("accept-encoding"), spec.id + ": no cookies and no compression offered");
    same(valuesOf(record, "host"), [new URL(fill(source.uri, report.inputs)).host], spec.id + ": Host");
    const declaredHeaders = {...source.headers};
    if (spec.crossOrigin === "use-credentials") {
      declaredHeaders["Access-Control-Allow-Credentials"] = "true";
    }
    if (spec.referrerPolicy != null) {
      declaredHeaders["Referrer-Policy"] = spec.referrerPolicy;
    }
    for (const [name, value] of Object.entries(declaredHeaders)) {
      same(valuesOf(record, name.toLowerCase()), [value], `${spec.id}: header ${name}`);
    }
    assert.equal(Buffer.from(record.bodyBase64, "base64").toString("utf8"), source.body ?? "", spec.id + ": body");
  };
  // Every request the declared Images make, hop by hop: the server saw each URL exactly as many times as the Images lead to it.
  const expectedHits = new Map();
  for (const spec of declared) {
    const uri = fill(spec.source.uri, report.inputs);
    const flow = follow(uri, report);
    if (flow.refused) {
      continue;
    }
    if (["err-header-name", "err-method", "err-only-if-cached"].includes(spec.id)) {
      assert.equal(recordsFor(report, uri).length, 0, `${spec.id}: the request never leaves the host`);
      continue;
    }
    for (const hop of flow.hops) {
      expectedHits.set(hop.url, (expectedHits.get(hop.url) ?? 0) + 1);
    }
    wire(spec, recordsFor(report, uri)[0]);
  }
  for (const [url, count] of expectedHits) {
    assert.equal(recordsFor(report, url).length, count, `the server saw ${url} ${count} times`);
  }
  // Redirects keep the source's headers, except that Authorization does not cross to another origin.
  const cross = declared.find(spec => spec.id === "ok-redirect-cross");
  const hop = recordsFor(report, fill(cross.source.uri, report.inputs))[0];
  const landed = recordsFor(report, fill("$other/pic/plain/quad24.png", report.inputs));
  assert.equal(landed.length, 1);
  same([valuesOf(hop, "authorization"), valuesOf(hop, "x-keep")], [["secret"], ["kept"]], "the first hop carries both headers");
  same([valuesOf(landed[0], "authorization"), valuesOf(landed[0], "x-keep")], [[], ["kept"]], "the other origin gets X-Keep and not Authorization");
}

// ---- the caches: a model of the two, replayed over the probe's operations ----

const MiB = 1024 * 1024;
class Lru {
  constructor(total, entry) {
    Object.assign(this, {total, entry, map: new Map(), bytes: 0});
  }
  get(key) {
    if (!this.map.has(key)) {
      return undefined;
    }
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }
  peek(key) {
    return this.map.get(key);
  }
  delete(key) {
    if (this.map.has(key)) {
      this.bytes -= this.map.get(key).cost;
    }
    this.map.delete(key);
  }
  put(key, cost, stale) {
    if (cost > this.entry || cost > this.total) {
      return false;
    }
    this.delete(key);
    this.map.set(key, {cost, stale});
    this.bytes += cost;
    while (this.bytes > this.total && this.map.size > 1) {
      const oldest = this.map.keys().next().value;
      this.delete(oldest);
    }
    return true;
  }
  clear() {
    this.map.clear();
    this.bytes = 0;
  }
  keys() {
    return [...this.map.keys()].reverse();
  }
}

// RCTImageCache.mm addImageToCache:response: and the date format its formatter reads.
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function httpDate(text) {
  const match = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d\d) (\w{3}) (\d{4}) (\d\d):(\d\d):(\d\d) GMT$/.exec(text ?? "");
  if (!match || !months.includes(match[2])) {
    return null;
  }
  return Date.UTC(Number(match[3]), months.indexOf(match[2]), Number(match[1]), Number(match[4]), Number(match[5]), Number(match[6]));
}
function freshness(headers, missingDate = null) {
  const date = httpDate(headers.date) ?? missingDate;
  let stale = null;
  for (const component of (headers["cache-control"] ?? "").split(",")) {
    if (component.includes("no-cache") || component.includes("no-store") || component.endsWith("max-age=0")) {
      return {storable: false, stale: null};
    }
    const at = component.indexOf("max-age=");
    if (at >= 0) {
      stale = date == null ? null : date + (Number.parseInt(component.slice(at + 8), 10) || 0) * 1000;
    }
  }
  if (stale == null && date != null) {
    if (headers.expires != null) {
      stale = httpDate(headers.expires);
    } else if (headers["last-modified"] != null) {
      const modified = httpDate(headers["last-modified"]);
      if (modified != null) {
        stale = date + (date - modified) / 10;
      }
    }
  }
  return {storable: true, stale};
}

// Every decision about staleness is made a long way from the stale time, so that how long the probe took between two steps cannot
// change one.
const MARGIN = 20000;
function staleAt(entry, now, label) {
  if (entry.stale == null) {
    return false;
  }
  assert.ok(Math.abs(now - entry.stale) > MARGIN, `${label}: the clock (${now}) is within ${MARGIN} ms of the stale time (${entry.stale})`);
  return now > entry.stale;
}

function simulate(report) {
  // RCTImageCache: 20 MiB, 2 MiB an entry. The byte cache is the host's own: 20 MiB, and no entry over a twentieth of it.
  const decoded = new Lru(20 * MiB, 2 * MiB), bytes = new Lru(20 * MiB, 20 * MiB / 20);
  const cursors = new Map();
  const answers = url => {
    const target = targetOf(url);
    return report.server.records.filter(row => row.kind === "request" && row.url === target && row.listener === "http");
  };
  const take = url => {
    const list = answers(url), at = cursors.get(url) ?? 0;
    assert.ok(at < list.length, `the model fetches ${url} ${at + 1} times, the server saw it ${list.length}`);
    cursors.set(url, at + 1);
    return list[at];
  };
  const decodeOf = (url, op) => {
    const name = answerFor(targetOf(url)).name;
    const outcome = decodeOutcome(bodies[name], {size: [op.width, op.height], scale: op.scale});
    return outcome;
  };
  // Fetches a response the model does not hold and keeps it where RN iOS keeps it.
  const fetch = (op, now) => {
    const record = take(op.uri);
    const headers = record.responseHeaders;
    const length = Number(headers["content-length"] ?? 0);
    if (record.status !== 200 || length === 0) {
      return {record, ok: false};
    }
    const kept = freshness(headers, now);
    if (kept.storable) {
      bytes.put(op.uri, length, kept.stale);
    }
    return {record, ok: true, headers, length};
  };
  // The byte cache answers the default policy while the response is fresh, and force-cache and only-if-cached whatever its age.
  const hit = (op, now) => {
    const found = bytes.get(op.uri);
    if (!found) {
      return null;
    }
    return op.policy === "force-cache" || op.policy === "only-if-cached" || !staleAt(found, now, op.label) ? found : null;
  };
  for (const op of report.stages.ops) {
    const now = op.unix + op.offset;
    const expected = {label: op.label};
    if (op.kind === "memory") {
      // The first warning is the model's start: it knows nothing of what the stages before left in the caches, except that it was something.
      if (op === report.stages.ops[0]) {
        assert.ok(op.before.decoded > 0 && op.before.bytes > 0, `${op.label}: the caches held what the stages before left in them`);
      } else {
        assert.ok(op.before.decoded === decoded.map.size && op.before.bytes === bytes.map.size, `${op.label}: the caches held what the model holds (${decoded.map.size} pictures, ${bytes.map.size} responses)`);
      }
      decoded.clear();
      bytes.clear();
      assert.deepEqual(op.after, {decoded: 0, bytes: 0}, op.label);
      continue;
    }
    if (op.kind === "checkpoint") {
      same(op.decoded, decoded.keys(), `${op.label}: the decoded cache holds these pictures, most recently used first`);
      same(op.bytes, bytes.keys(), `${op.label}: the byte cache holds these responses, most recently used first`);
      continue;
    }
    if (op.kind === "queryCache") {
      same(op.result.value, Object.fromEntries(op.uris.filter(uri => bytes.peek(uri) != null).map(uri => [uri, "memory"])), `${op.label}: queryCache`);
      continue;
    }
    if (op.kind === "view") {
      const policy = op.policy;
      const key = `${op.uri}|${op.width}|${op.height}|${op.scale}|0`;
      let served = null, fresh = null, ok = true, text = null;
      if (policy !== "reload") {
        const entry = decoded.get(key);
        if (entry) {
          if (staleAt(entry, now, op.label)) {
            decoded.delete(key);
          } else {
            served = "decoded";
          }
        }
      }
      if (served == null && policy !== "reload") {
        const found = hit(op, now);
        if (found) {
          served = "bytes";
          fresh = {storable: true, stale: found.stale};
        } else if (policy === "only-if-cached") {
          served = "";
          ok = false;
          text = /only-if-cached/;
        }
      }
      if (served == null) {
        served = "network";
        const got = fetch(op, now);
        if (!got.ok) {
          ok = false;
          const answer = answerFor(targetOf(op.uri));
          text = answer.body.length === 0 ? "Unknown image download error" : `Failed to load ${op.uri}`;
        } else fresh = freshness(got.headers);
      }
      if (ok && served !== "decoded") {
        const outcome = decodeOf(op.uri, op);
        if (outcome.error) {
          ok = false;
          text = outcome.error;
        } else if (policy !== "reload" && fresh.storable) {
          decoded.put(key, outcome.width * outcome.height * 4, fresh.stale);
        }
      }
      same([op.served, op.outcome], [served, ok ? "loaded" : "failed"], `${op.label}: where the picture came from, and whether it loaded`);
      if (text instanceof RegExp) {
        assert.match(op.error, text, op.label);
      } else if (text != null) {
        assert.equal(op.error, text, op.label);
      }
      continue;
    }
    // A source that is not on the network touches neither cache; the loader reads it from the file system and the prefetch resolves.
    if (!/^https?:/.test(op.uri)) {
      same([op.served, op.result.ok, op.result.value], ["", true, true], `${op.label}: a local source is prefetched without the caches`);
      continue;
    }
    // prefetch, getSize and getSizeWithHeaders: the byte cache, and the picture only checked or measured.
    const found = hit({...op, policy: "default"}, now);
    let served = "bytes", ok = true, text = null, length;
    if (!found) {
      served = "network";
      const got = fetch(op, now);
      if (!got.ok) {
        ok = false;
        const answer = answerFor(targetOf(op.uri));
        text = answer.body.length === 0 ? "Unknown image download error" : `Failed to load ${op.uri}`;
      }
    }
    if (ok && op.kind.startsWith("prefetch")) {
      const outcome = decodeOf(op.uri, {...op, width: 0, height: 0, scale: 1});
      if (outcome.error) {
        ok = false;
        text = outcome.error;
      }
    }
    if (ok && op.kind.startsWith("getSize")) {
      const name = answerFor(targetOf(op.uri)).name;
      const format = sniff(bodies[name], "");
      const header = headerSize(format, bodies[name], "");
      length = {width: header.width, height: header.height};
      same(op.result.value, length, `${op.label}: the size is read from the header`);
    }
    same([op.served, op.result.ok], [served, ok], `${op.label}: where the response came from, and whether it succeeded`);
    if (!ok) {
      const prefix = op.kind.startsWith("prefetch") ? "E_PREFETCH_FAILURE: " : op.kind === "getSize" ? `E_GET_SIZE_FAILURE: Failed to getSize of ${op.uri}: ` : "E_GET_SIZE_FAILURE: ";
      if (text instanceof RegExp) {
        assert.match(op.result.message, new RegExp(`^${escape(prefix)}`));
      } else {
        assert.equal(op.result.message, prefix + text, op.label);
      }
    }
  }
  // Every request the server saw for a URL the probe asked about was one the model made.
  for (const [url, count] of cursors) {
    assert.equal(answers(url).length, count, `${url}: the server saw as many requests as the model made`);
  }
  const urls = new Set(report.stages.ops.filter(op => op.uri).map(op => op.uri));
  for (const url of urls) {
    assert.equal(answers(url).length, cursors.get(url) ?? 0, `${url}: no request the model did not make`);
  }
  return {decoded: decoded.keys().length, bytes: bytes.keys().length, urls: urls.size, operations: report.stages.ops.length};
}

// Two Images of one cached picture share a texture, and each draws its own size without resizing it.
function verifyShared(report) {
  const {a, b, live} = report.stages.shared;
  assert.equal(live, 1, "the pair is one picture");
  const pixels = [40, 20];
  for (const [name, view] of [["a", a], ["b", b]]) {
    same([view.image.width, view.image.height, view.image.textureWidth, view.image.textureHeight], [...pixels, ...pixels], `shared ${name}: the texture has the pixels of the picture`);
    same([view.image.naturalWidth, view.image.naturalHeight], [20, 10], `shared ${name}: 40x20 pixels at scale 2 are 20x10 points`);
  }
  assert.equal(a.image.fingerprint, b.image.fingerprint);
  const expect = (view, mode) => {
    const draw = contentModeDraw(mode, [60, 60], [20, 10]);
    same(view.mode, mode);
    same([view.drawn.dst.x, view.drawn.dst.y, view.drawn.dst.width, view.drawn.dst.height], [draw.dst.x, draw.dst.y, draw.dst.width, draw.dst.height], `shared ${mode}: dst`);
    assert.equal(view.drawn.tiled, draw.tiled, `shared ${mode}: tiled`);
    if (draw.tiled) {
      same([view.drawn.tileWidth, view.drawn.tileHeight], draw.tile, `shared ${mode}: the tile is the picture's size in points`);
    }
  };
  // The probe ended with the first Image repeating and the second contained.
  expect(a, "repeat");
  expect(b, "contain");
}

// ---- the loader ----

const accounted = counters => counters.loaded + counters.failed + counters.cancelled + counters.dropped;

// The read, the sniffing, the header and the decode of every body that was downloaded or kept ran on a worker; a picture the
// decoded cache held needed none.
function verifyJobs(report) {
  const host = report.stages.afterStop.loader.hostThread;
  let decodedOnWorkers = 0;
  for (const job of report.stages.jobs) {
    if (job.source !== "network") {
      continue;
    }
    if (job.served === "decoded") {
      assert.equal(job.thread.worker, false, `job ${job.id}: a picture the decoded cache holds needs no worker`);
    } else if (job.format !== "") {
      assert.equal(job.thread.worker, true, `job ${job.id} (${job.uri}) was read and decoded on a worker thread`);
      assert.notEqual(job.thread.id, host, `job ${job.id} ran off the main thread`);
      assert.match(job.thread.id, /^[0-9a-f]{16}$/);
      decodedOnWorkers += 1;
    }
  }
  assert.ok(decodedOnWorkers > 60, "The report holds the jobs of every picture that was decoded");
}

// ---- the whole report ----

function verifyOriginal(report) {
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  same([...failures].sort(), [...report.expectedOriginalFailures].sort(), "Only the checks that need network images fail on a host that has none");
  assert.ok(failures.length > 0 && failures.length < report.checks.length);
  for (const name of networkJsOnlyChecks.filter(name => report.checks.some(row => row.name === name))) {
    assert.ok(report.checks.find(row => row.name === name).passed, `${name} holds on a host without network images`);
    assert.ok(!report.expectedOriginalFailures.includes(name), name);
  }
  const {logs} = report.stages.mount.react;
  for (const spec of report.stages.mount.declared) {
    const error = logs[spec.id].find(event => event.type === "error");
    assert.ok(error && /^Network images are not supported by this host yet/.test(error.error), `${spec.id}: the preceding host fails an http(s) source naming the later slice`);
    same(logs[spec.id].map(event => event.type).filter(type => type !== "progress"), ["loadStart", "error", "loadEnd"], spec.id);
  }
  assert.equal(report.server.records.filter(row => row.kind === "request").length, 0, "The preceding host sends no request at all");
}

export function verifyImagesNetworkReport(report, {original = false} = {}) {
  assert.equal(report.scenario, "images-network");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.allowOriginalNegative, original);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.equal(report.scale, 2);
  if (original) {
    verifyOriginal(report);
    return;
  }
  const {stages} = report;
  assert.ok(verifyEventOrder({mount: stages.mount.react.logs, final: stages.afterStop.logsBefore}, "stages") > 100, "The report holds the event lists of every Image the probe mounted");
  // Every declared case, from its declared inputs and the server's answers.
  const cases = {};
  assert.equal(stages.mount.declared.length, stages.mount.nodes);
  assert.equal(stages.mount.react.pixelRatio, 2);
  for (const spec of stages.mount.declared) {
    cases[spec.id] = verifyCase(spec, report);
  }
  verifyRequests(report);
  const mount = stages.mount.loader;
  assert.equal(mount.counters.requested, stages.mount.declared.length, "One request per Image");
  assert.equal(accounted(mount.counters), mount.counters.requested);
  same(Object.keys(stages.mount.react.boundaries), [], "No Image failed to render");
  // The Images that were not left to finish end where the probe cut them, and every other one ended: the latest list of each.
  const final = stages.afterStop.logsBefore;
  for (const [id, log] of Object.entries(final)) {
    if (!id.startsWith("stop-") && !unfinished.has(id)) {
      assert.equal(log[log.length - 1].type, "loadEnd", `${id}: ended`);
    }
  }
  // Concurrency: no more than four at once, in order.
  const concurrency = stages.concurrency;
  same(Object.keys(concurrency.holds).sort(), ["h1", "h2", "h3", "h4"], "the server held the first four downloads asked for");
  assert.equal(concurrency.atPeak.peakActive, 4, "four were active at the peak");
  assert.equal(concurrency.atPeak.active, 4);
  assert.equal(concurrency.atPeak.queued, 2);
  assert.equal(concurrency.after.peakActive, 4, "never more than four");
  assert.equal(concurrency.sixthEarly, "none", "h6 waited while h5 ran");
  // The log of the server: h1-h6 once each, in a start order that respects the order asked, and h7 never.
  const heldRecords = name => report.server.records.filter(row => row.url === `/hang-body/${name}`);
  for (const name of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
    assert.equal(heldRecords(name).length, 1, name);
  }
  assert.equal(heldRecords("h7").length, 0, "h7 never reached the server");
  const order = ["h1", "h2", "h3", "h4", "h5", "h6"].map(name => heldRecords(name)[0].sequence);
  assert.ok(Math.max(...order.slice(0, 4)) < order[4] && order[4] < order[5], "the downloads reached the server in the order they were asked for: the first four, then h5, then h6");
  // Cancelled downloads: the server saw the client leave.
  for (const name of ["cancel-body", "cancel-head", "idle-body", "idle-head", "swap-a", "stop-body-1", "stop-body-2", "stop-head-1", "stop-head-2"]) {
    const url = name === "swap-a" ? "/hang-body/swap-a" : `/hang-${name.includes("body") ? "body" : "head"}/${name}`;
    const rows = report.server.records.filter(row => row.url === url);
    assert.equal(rows.length, 1, name);
    assert.equal(rows[0].state, "closed-by-client", `${name}: the client left`);
  }
  assert.equal(report.server.records.filter(row => row.url === "/hang-head/stop-head-3").length, 0, "the download that waited was never started");
  // The partial download, the limits and the timeouts.
  const partial = stages.partial;
  assert.ok(partial.midway.length >= 1 && partial.midway.every(event => event.loaded < event.total), "progress was reported while only part had arrived");
  const limits = stages.limits;
  same([limits.announced.error, limits.chunked.error], ["The image is 8000 bytes, over the host limit of 4096", "The image download passed the host limit of 4096 bytes"]);
  same([limits.announced.responseCode, limits.chunked.responseCode], [200, 200]);
  assert.match(limits.exact.error, /^Error decoding image data <4096 bytes>/);
  assert.match(limits.restored.error, /^Error decoding image data <8000 bytes>/);
  assert.equal(stages.idle.body.error, "The request timed out.");
  assert.equal(stages.idle.body.responseCode, 200);
  assert.equal(stages.idle.head.error, "The request timed out.");
  assert.equal(stages.idle.head.responseCode, undefined);
  assert.equal(stages.idle.offsetMs, 90000, "the idle timeout ran out on the clock the validation moved");
  verifyShared(report);
  // The caches.
  const model = simulate(report);
  assert.ok(model.operations >= 90 && model.urls >= 50, "The caches are certified over every operation of the probe");
  // The loader: every job on a worker, every counter accounted for, nothing left after the stop.
  verifyJobs(report);
  const before = stages.beforeStop.loader, stopped = stages.afterStop.loader;
  const unresolved = ["pending", "inFlight", "fresh", "downloading", "ready", "finished"].reduce((total, key) => total + before[key], 0);
  assert.equal(before.counters.requested - accounted(before.counters), unresolved, "every request is resolved or still in one place of the loader");
  assert.equal(before.inFlight, 1, "stop: a decode is in flight");
  assert.equal(before.atGate, 1, "stop: and done");
  assert.equal(before.network.active, 4);
  assert.equal(before.network.queued, 1);
  assert.equal(stopped.stopped, true);
  for (const key of ["pending", "inFlight", "finished", "ready", "fresh", "downloading", "liveTextures"]) {
    assert.equal(stopped[key], 0, `stop: ${key}`);
  }
  assert.equal(stopped.counters.tasksStarted, stopped.counters.tasksAwaited, "stop: every task was awaited");
  assert.equal(stopped.network.active + stopped.network.queued + stopped.network.transport.active, 0, "stop: nothing downloads");
  assert.ok(stopped.network.transport.cancelled >= before.network.transport.cancelled + 4, "stop: the transport cancelled what was in flight");
  same([stopped.caches.decoded.entries, stopped.caches.bytes.entries], [0, 0], "stop: both caches are empty");
  same(stages.afterStop.logsBefore, stages.afterStop.logsAfter, "stop: nothing reached JS after it");
  assert.equal(stages.afterStop.application.stopped, true);
  assert.equal(report.checks.length, networkCheckCount);
  assert.ok(report.allCurrentAssertionsPassed && report.checks.every(row => row.passed));
  return {cases: Object.keys(cases).length, model, jobs: stages.jobs.length};
}
