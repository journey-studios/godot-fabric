import {createHash} from "node:crypto";
import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {brokenFiles, encodePng} from "./images-pattern.mjs";
import {issueTestIdentity} from "./networking-certificates.mjs";

// The deterministic local server of the network images suite. It runs as a child process of the runner, uses only node:http,
// node:https and node:net, and reports its ports as one JSON line on stdout. Every request it receives is recorded as it arrived
// on the wire (raw header names, order and duplicates, body hash), with the status and headers it answered, which is what the
// independent oracle compares the probe's observations to. Nothing here waits for a wall clock: a held request stays held until
// a control request releases it or the client closes the connection, and the probe leaves marks in the log so that the oracle
// can tell which requests belong to which step.
//
// Pictures: /pic/<policy>/<name> answers the picture <name> with the response headers <policy> chooses. Failures, redirects,
// responses that stall, that are chunked or that are too large each have a route of their own (see route()).
//
// Listeners: "http" and "other" (a second origin), "https" with a certificate issued by the trusted test CA, and "refused", a
// port that was open and is now closed.

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/images");
const fixture = relative => readFileSync(path.join(fixtures, relative));

// A smooth picture that deflates well: the decoded size is what the cache limits are about, not the file's.
const gradient = (width, height) => ({width, height, pixel: (x, y) => [Math.floor(x * 255 / width), Math.floor(y * 255 / height), (x + y) & 255, 255]});
// Stored without compression (see buildPictures): a file about as large as its pixels.
const noise = (width, height, seed) => {
  let state = seed;
  return {width, height, pixel: () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return [state & 255, (state >>> 8) & 255, (state >>> 16) & 255, 255];
  }};
};

// name -> {bytes, width, height}. The decoded size of a picture is width * height * 4: the decoded cache keeps one up to 2 MiB.
const pictureSizes = {"quad24.png": [24, 24], "wide.png": [40, 20], "format.jpg": [24, 24], "format.webp": [24, 24], "format.bmp": [24, 24],
  "format.svg": [24, 24], "big-fit.png": [800, 655], "big-over.png": [900, 600], "noise-under.png": [510, 510], "noise-over.png": [512, 512]};
export function buildPictures() {
  const files = {"quad24.png": "formats/format.png", "wide.png": "assets/wide.png", "format.jpg": "formats/format.jpg", "format.webp": "formats/format.webp",
    "format.bmp": "formats/format.bmp", "format.svg": "formats/format.svg"};
  const pictures = Object.fromEntries(Object.entries(files).map(([name, relative]) => [name, fixture(relative)]));
  // The damaged files of the images suite, under flat names: corrupt.png, truncated.png, oversize.png, oversize.jpg, notimage.png, empty.png.
  for (const [relative, bytes] of Object.entries(brokenFiles())) {
    pictures[relative.replace("broken/", "")] = bytes;
  }
  pictures["big-fit.png"] = encodePng(gradient(800, 655));
  pictures["big-over.png"] = encodePng(gradient(900, 600));
  pictures["noise-under.png"] = encodePng(noise(510, 510, 0x2545f491), 0);
  pictures["noise-over.png"] = encodePng(noise(512, 512, 0x9e3779b1), 0);
  return pictures;
}
const contentTypes = {png: "image/png", jpg: "image/jpeg", webp: "image/webp", bmp: "image/bmp", svg: "image/svg+xml"};
const bytePattern = size => Buffer.from(Array.from({length: size}, (_, index) => (index * 31 + 7) & 0xff));

const records = [];
const holds = new Map();
const listeners = {};
let sequence = 0;
let pictures;

function record(request, listener) {
  const entry = {sequence: ++sequence, kind: "request", listener, method: request.method, url: request.url, httpVersion: request.httpVersion,
    rawHeaders: [...request.rawHeaders], bodyBytes: 0, bodySha256: null, bodyBase64: null, state: "open", status: null, responseHeaders: null,
    startedAt: Date.now()};
  records.push(entry);
  return entry;
}

function readBody(request, entry) {
  return new Promise(resolve => {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      entry.bodyBytes = body.length;
      entry.bodySha256 = sha256(body);
      entry.bodyBase64 = body.length <= 64 * 1024 ? body.toString("base64") : null;
      resolve(body);
    });
    request.on("error", () => resolve(Buffer.alloc(0)));
  });
}

// The head of an answer, noted in the log as written: names in lower case, values as sent. (Node does not keep the headers it is
// handed by writeHead, so the log could not ask the response for them afterwards.)
function head(response, status, headers) {
  response.entry.status = status;
  response.entry.responseHeaders = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  response.writeHead(status, headers);
}
// A plain answer carries its Content-Length; the routes that stream or hold set their own framing.
function send(response, status, headers, body) {
  const framing = body === undefined || [204, 304].includes(status) ? {} : {"Content-Length": Buffer.byteLength(body)};
  head(response, status, {...framing, ...headers});
  response.end(body);
}
const json = (response, value, status = 200) => send(response, status, {"Content-Type": "application/json; charset=utf-8"}, JSON.stringify(value));

// How a request ended: answered, cut off by the client closing the connection, or cut off by this server.
function settle(entry, response) {
  response.entry = entry;
  response.on("close", () => {
    entry.state = response.writableFinished ? "responded" : entry.destroyed ? "closed-by-server" : "closed-by-client";
  });
}

const utc = ms => new Date(ms).toUTCString();
// The headers each policy puts on a picture: what RCTImageCache and NSURLCache read to decide whether and how long to keep it.
const policies = {
  plain: () => ({}),
  "max-age": () => ({"Cache-Control": "public, max-age=600"}),
  "no-store": () => ({"Cache-Control": "no-store"}),
  "no-cache": () => ({"Cache-Control": "no-cache"}),
  "max-age-0": () => ({"Cache-Control": "max-age=0"}),
  expires: () => ({Expires: utc(Date.now() + 600000)}),
  heuristic: () => ({"Last-Modified": utc(Date.now() - 10 * 86400000)}),
};

function picture(response, policy, name) {
  const bytes = pictures[name];
  const headers = policies[policy];
  if (!bytes || !headers) {
    return send(response, 404, {"Content-Type": "text/plain"}, "no such picture");
  }
  return send(response, 200, {"Content-Type": contentTypes[name.split(".").pop()] ?? "application/octet-stream", Date: utc(Date.now()), ...headers()}, bytes);
}

async function route(request, response, listener) {
  const entry = record(request, listener);
  settle(entry, response);
  const url = new URL(request.url, "http://placeholder");
  const parts = url.pathname.split("/").filter(Boolean);
  await readBody(request, entry);
  const name = parts[0] ?? "";

  if (name === "__control") {
    entry.kind = "control";
    if (parts[1] === "log") {
      return json(response, {records: records.filter(row => row.kind !== "control"), holds: Object.fromEntries([...holds].map(([key, hold]) => [key, hold.state]))});
    }
    if (parts[1] === "mark") {
      entry.kind = "mark";
      entry.label = parts[2];
      return json(response, {mark: parts[2], sequence: entry.sequence});
    }
    if (parts[1] === "release") {
      const hold = holds.get(parts[2]);
      if (hold && hold.state === "waiting") {
        hold.state = "released";
        hold.release();
      }
      return json(response, {name: parts[2], state: hold?.state ?? "unknown"});
    }
    return json(response, {error: "unknown control"}, 404);
  }
  if (name === "pic") {
    return picture(response, parts[1], parts[2]);
  }
  if (name === "status" || name === "status-empty") {
    // A failure with a body to read (and headers worth reporting), or with none.
    const status = Number(parts[1]);
    const headers = {"Content-Type": "text/plain", "X-Reason": "no luck", "Set-Cookie": ["a=1", "b=2"]};
    return name === "status" ? send(response, status, headers, `status ${status}`) : send(response, status, {...headers, "Content-Length": "0"});
  }
  if (name === "empty200") {
    return send(response, 200, {"Content-Type": "image/png", "X-Reason": "empty"}, "");
  }
  if (name === "html") {
    return send(response, 200, {"Content-Type": "text/html"}, "<!doctype html><title>not a picture</title>\n");
  }
  if (name === "reset") {
    entry.destroyed = true;
    return request.socket.destroy();
  }
  if (name === "truncated") {
    // Promises a long body and sends the start of a picture, then drops the connection.
    entry.destroyed = true;
    const bytes = pictures["quad24.png"];
    head(response, 200, {"Content-Type": "image/png", "Content-Length": String(bytes.length + 100), "X-Reason": "cut"});
    response.write(bytes.subarray(0, 60));
    return setImmediate(() => request.socket.destroy());
  }
  if (name === "redirect") {
    // /redirect/<status>?to=<location>
    return send(response, Number(parts[1]), {Location: url.searchParams.get("to"), "Content-Type": "text/plain"}, "moved");
  }
  if (name === "chunked") {
    // The picture in three chunks and no length: the total is unknown.
    const bytes = pictures[parts[1] ?? "quad24.png"];
    head(response, 200, {"Content-Type": "image/png", Date: utc(Date.now())});
    const third = Math.ceil(bytes.length / 3);
    for (let offset = 0; offset < bytes.length; offset += third) {
      response.write(bytes.subarray(offset, offset + third));
    }
    return response.end();
  }
  if (name === "hang-head" || name === "hang-body") {
    // Held until released. "hang-body" has sent its head, with the picture's whole length, and the first half of the picture.
    const picture = pictures[url.searchParams.get("picture") ?? "quad24.png"];
    const hold = {state: "waiting", release: () => {}};
    holds.set(parts[1], hold);
    entry.hold = parts[1];
    if (name === "hang-body") {
      const half = Math.floor(picture.length / 2);
      head(response, 200, {"Content-Type": "image/png", "Content-Length": String(picture.length), Date: utc(Date.now())});
      response.write(picture.subarray(0, half));
      hold.release = () => response.end(picture.subarray(half));
    } else {
      hold.release = () => send(response, 200, {"Content-Type": "image/png", Date: utc(Date.now())}, picture);
    }
    response.on("close", () => {
      if (!response.writableFinished && hold.state === "waiting") {
        hold.state = "closed-by-client";
      }
    });
    return undefined;
  }
  if (name === "big" || name === "big-chunked") {
    // A response of N bytes: with its length in the head, or without one, to be refused either way by a low limit.
    const size = Number(parts[1]);
    const bytes = bytePattern(size);
    if (name === "big") {
      return send(response, 200, {"Content-Type": "application/octet-stream"}, bytes);
    }
    head(response, 200, {"Content-Type": "application/octet-stream"});
    for (let offset = 0; offset < size; offset += 1024) {
      response.write(bytes.subarray(offset, offset + 1024));
    }
    return response.end();
  }
  return send(response, 404, {"Content-Type": "text/plain"}, "not found");
}

function listen(server, label, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, host, () => {
      listeners[label] = {server, port: server.address().port};
      resolve(listeners[label].port);
    });
  });
}

// A port nothing listens on: bound, read and released, so a connection to it is refused.
function closedPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const {port} = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function startImagesNetworkServer(outDirectory) {
  pictures = buildPictures();
  const identity = issueTestIdentity("Godot Fabric images test CA");
  const handler = label => (request, response) => {
    route(request, response, label).catch(error => {
      if (!response.headersSent) {
        send(response, 500, {"Content-Type": "text/plain"}, String(error?.stack ?? error));
      } else {
        response.destroy();
      }
    });
  };
  const ports = {
    http: await listen(http.createServer(handler("http")), "http"),
    other: await listen(http.createServer(handler("other")), "other"),
    https: await listen(https.createServer({key: identity.privateKey, cert: identity.certificate}, handler("https")), "https"),
    refused: await closedPort(),
  };
  mkdirSync(outDirectory, {recursive: true});
  const files = {ca: path.join(outDirectory, "images-network-ca.pem")};
  // Public certificate only; the leaf key never leaves this process.
  writeFileSync(files.ca, identity.authorityCertificate);
  return {ports, files, pictureSizes, close: () => Promise.all(Object.values(listeners).map(({server}) => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections?.();
  })))};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outIndex = process.argv.indexOf("--out");
  const server = await startImagesNetworkServer(outIndex >= 0 ? process.argv[outIndex + 1] : "build");
  process.stdout.write(JSON.stringify({format: "godot-fabric.images-network-server/v1", ports: server.ports, files: server.files}) + "\n");
  // The runner closes stdin (or kills this process) when it is done.
  process.stdin.on("end", async () => {
    await server.close();
    process.exit(0);
  });
  process.stdin.resume();
}
