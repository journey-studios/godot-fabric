import {createHash} from "node:crypto";
import {mkdirSync, writeFileSync} from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {gzipSync} from "node:zlib";
import {issueTestIdentity} from "./networking-certificates.mjs";

// The deterministic local server of the networking suite. It runs as a child
// process of the runner, uses only node:http/https/net, and reports its ports
// as one JSON line on stdout. Every request it receives is recorded exactly as
// it arrived on the wire (raw header names, order and duplicates, body hash),
// which is what the independent oracle compares the probe's observations to.
// Nothing here waits for a wall clock: a held request stays held until a
// control request releases it or the client closes the connection.
//
// Listeners: "http" and "other" (a second origin), "https" with a certificate
// issued by the trusted test CA, "https-untrusted" with one issued by another
// CA, "refused", a port that was open and is now closed, and "blackhole", which
// accepts connections and never answers.

export const utf8Text = "Olá, mundo — ação 日本語 😀 Zażółć gęślą jaźń";
export const latin1Bytes = Buffer.from([0x61, 0xe7, 0xe3, 0x6f]); // "ação" in ISO-8859-1
export const bytePattern = size => Buffer.from(Array.from({length: size}, (_, index) => (index * 31 + 7) & 0xff));
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

const records = [];
const holds = new Map();
let sequence = 0;
const listeners = {};

function record(request, listener) {
  const entry = {sequence: ++sequence, listener, method: request.method, url: request.url, httpVersion: request.httpVersion,
    rawHeaders: [...request.rawHeaders], bodyBytes: 0, bodySha256: null, bodyBase64: null, state: "open"};
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
      // Small bodies are kept whole so the oracle can parse multipart parts and compare bytes.
      entry.bodyBase64 = body.length <= 256 * 1024 ? body.toString("base64") : null;
      resolve(body);
    });
    request.on("error", () => resolve(Buffer.alloc(0)));
  });
}

const headerObject = rawHeaders => {
  const joined = {};
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index].toLowerCase();
    joined[name] = name in joined ? `${joined[name]}, ${rawHeaders[index + 1]}` : rawHeaders[index + 1];
  }
  return joined;
};

// A plain answer carries its Content-Length; the routes that stream or hold set their own framing.
function send(response, status, headers, body) {
  const framing = body === undefined || [204, 304].includes(status) ? {} : {"Content-Length": Buffer.byteLength(body)};
  response.writeHead(status, {...framing, ...headers});
  response.end(body);
}
const json = (response, value, status = 200) => send(response, status, {"Content-Type": "application/json; charset=utf-8"}, JSON.stringify(value));

// How a request ended: answered, cut off by the client closing the connection, or cut off by this server.
function settle(entry, response) {
  response.on("close", () => {
    entry.state = response.writableFinished ? "responded" : entry.destroyed ? "closed-by-server" : "closed-by-client";
  });
}

async function route(request, response, listener) {
  const entry = record(request, listener);
  settle(entry, response);
  const url = new URL(request.url, "http://placeholder");
  const parts = url.pathname.split("/").filter(Boolean);
  const body = await readBody(request, entry);
  const name = parts[0] ?? "";

  if (name === "__control") {
    entry.control = true;
    if (parts[1] === "log") {
      return json(response, {records: records.filter(row => !row.control), holds: Object.fromEntries([...holds].map(([key, hold]) => [key, hold.state]))});
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
  if (name === "json") {
    return json(response, {message: "hello", list: [1, 2, 3], unicode: "ação", nested: {ok: true}});
  }
  if (name === "utf8") {
    return send(response, 200, {"Content-Type": "text/plain; charset=utf-8"}, utf8Text);
  }
  if (name === "latin1") {
    return send(response, 200, {"Content-Type": "text/plain; charset=iso-8859-1"}, latin1Bytes);
  }
  if (name === "bom") {
    return send(response, 200, {"Content-Type": "text/plain"}, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("com BOM")]));
  }
  if (name === "bad-utf8") {
    return send(response, 200, {"Content-Type": "text/plain; charset=utf-8"}, Buffer.from([0x61, 0xff, 0x62, 0xc3]));
  }
  if (name === "status") {
    const status = Number(parts[1]);
    return send(response, status, {"Content-Type": "text/plain"}, [204, 304].includes(status) || request.method === "HEAD" ? undefined : `status ${status}`);
  }
  if (name === "echo") {
    return json(response, {method: request.method, url: request.url, httpVersion: request.httpVersion, rawHeaders: request.rawHeaders,
      headers: headerObject(request.rawHeaders), bodyBytes: body.length, bodySha256: sha256(body), bodyBase64: body.toString("base64")});
  }
  if (name === "headers") {
    response.setHeader("Content-Type", "text/plain");
    response.setHeader("Set-Cookie", ["a=1", "b=2"]);
    response.setHeader("X-Multi", ["one", "two", "three"]);
    response.setHeader("X-Mixed-Case", "Value");
    response.setHeader("X-Empty", "");
    return response.end("headers");
  }
  if (name === "bytes") {
    const size = Number(parts[1] ?? 4096);
    const bytes = bytePattern(size);
    return send(response, 200, {"Content-Type": "application/octet-stream", "X-Body-Sha256": sha256(bytes)}, bytes);
  }
  if (name === "large") {
    // Chunked transfer of a body much larger than one read, with the hash known up front.
    const size = Number(parts[1] ?? 1048576);
    const bytes = bytePattern(size);
    response.writeHead(200, {"Content-Type": "application/octet-stream", "X-Body-Sha256": sha256(bytes), "X-Body-Length": String(size)});
    for (let offset = 0; offset < size; offset += 16384) {
      response.write(bytes.subarray(offset, offset + 16384));
    }
    return response.end();
  }
  if (name === "chunked") {
    response.writeHead(200, {"Content-Type": "text/plain"});
    for (const piece of ["one ", "two ", "três"]) {
      response.write(piece);
    }
    return response.end();
  }
  if (name === "close" || name === "close-chunked") {
    // Answers and closes the connection at once, as HTTP/1.0 servers and many proxies do.
    const bytes = bytePattern(Number(parts[1] ?? 70000));
    const headers = {"Content-Type": "application/octet-stream", Connection: "close", "X-Body-Sha256": sha256(bytes)};
    if (name === "close") {
      headers["Content-Length"] = String(bytes.length);
    }
    response.writeHead(200, headers);
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      response.write(bytes.subarray(offset, offset + 8192));
    }
    return response.end();
  }
  if (name === "gzip") {
    return send(response, 200, {"Content-Type": "text/plain", "Content-Encoding": "gzip"}, gzipSync("compressed"));
  }
  if (name === "redirect") {
    // /redirect/<status>?to=<location>
    return send(response, Number(parts[1]), {Location: url.searchParams.get("to"), "Content-Type": "text/plain"}, "moved");
  }
  if (name === "redirect-chain") {
    const remaining = Number(parts[1]);
    return remaining > 0
      ? send(response, 302, {Location: `/redirect-chain/${remaining - 1}`}, "next")
      : send(response, 200, {"Content-Type": "text/plain"}, "chain end");
  }
  if (name === "redirect-loop") {
    return send(response, 302, {Location: "/redirect-loop"}, "again");
  }
  if (name === "redirect-cross") {
    return send(response, 302, {Location: `http://127.0.0.1:${listeners.other.port}/echo`}, "elsewhere");
  }
  if (name === "redirect-scheme") {
    return send(response, 302, {Location: "ftp://127.0.0.1/file"}, "elsewhere");
  }
  if (name === "hang" || name === "hang-body") {
    // Held until released; "hang-body" has already sent its headers and first chunk.
    const hold = {state: "waiting", release: () => {}};
    holds.set(parts[1], hold);
    entry.hold = parts[1];
    if (name === "hang-body") {
      response.writeHead(200, {"Content-Type": "text/plain", "Content-Length": "9"});
      response.write("first-");
    }
    hold.release = () => (name === "hang" ? send(response, 200, {"Content-Type": "text/plain"}, `released ${parts[1]}`) : response.end("end"));
    response.on("close", () => {
      if (!response.writableFinished && hold.state === "waiting") {
        hold.state = "closed-by-client";
      }
    });
    return undefined;
  }
  if (name === "reset") {
    entry.destroyed = true;
    return request.socket.destroy();
  }
  if (name === "truncated") {
    entry.destroyed = true;
    response.writeHead(200, {"Content-Type": "text/plain", "Content-Length": "100"});
    response.write("only ten b");
    return setImmediate(() => request.socket.destroy());
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

// A port that accepts connections and never answers or reads: a request sent to it can only time out.
function blackhole() {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
  });
  server.destroySockets = () => sockets.forEach(socket => socket.destroy());
  return server;
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

async function startNetworkingServer(outDirectory) {
  const identity = issueTestIdentity("Godot Fabric networking test CA");
  const untrusted = issueTestIdentity("Godot Fabric untrusted test CA");
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
    httpsUntrusted: await listen(https.createServer({key: untrusted.privateKey, cert: untrusted.certificate}, handler("https-untrusted")), "https-untrusted"),
    refused: await closedPort(),
    blackhole: await listen(blackhole(), "blackhole"),
  };
  mkdirSync(outDirectory, {recursive: true});
  const files = {ca: path.join(outDirectory, "networking-ca.pem"), untrustedCa: path.join(outDirectory, "networking-untrusted-ca.pem")};
  // Public certificates only; the leaf keys never leave this process.
  writeFileSync(files.ca, identity.authorityCertificate);
  writeFileSync(files.untrustedCa, untrusted.authorityCertificate);
  return {ports, files, close: () => Promise.all(Object.values(listeners).map(({server}) => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections?.();
    server.destroySockets?.();
  })))};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outIndex = process.argv.indexOf("--out");
  const server = await startNetworkingServer(outIndex >= 0 ? process.argv[outIndex + 1] : "build");
  process.stdout.write(JSON.stringify({format: "godot-fabric.networking-server/v1", ports: server.ports, files: server.files}) + "\n");
  // The runner closes stdin (or kills this process) when it is done.
  process.stdin.on("end", async () => {
    await server.close();
    process.exit(0);
  });
  process.stdin.resume();
}
