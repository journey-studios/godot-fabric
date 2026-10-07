import {createHash} from "node:crypto";
import {mkdirSync, writeFileSync} from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {issueTestIdentity} from "./networking-certificates.mjs";

// The deterministic local WebSocket server of the websocket suite. It runs as a child process of the runner, uses only
// node:http, https and net, and implements RFC 6455 by hand on the `upgrade` event: the handshake with its accept key,
// masked client frames, unmasked server frames, fragmentation, ping, pong and close. It reports its ports as one JSON
// line on stdout. Every connection it accepts or refuses is recorded as it happened on the wire: the handshake request
// with its raw header names, order and duplicates, the response it sent, and every frame in both directions with its
// opcode, flags, length and payload hash. That log is what the independent oracle compares the probe's observations to.
// Nothing here waits for a wall clock: a held handshake stays held until a control request releases it or the client
// closes the connection, and no behavior depends on a timer.
//
// Listeners: "ws" (also answers the control requests over plain HTTP), "wss" with a certificate issued by the trusted
// test CA, "wssUntrusted" with one issued by another CA, "refused", a port that was open and is now closed, and
// "blackhole", which accepts connections and never answers.

export const utf8Text = "Olá, mundo — ação 日本語 😀 Zażółć gęślą jaźń";
export const bytePattern = size => Buffer.from(Array.from({length: size}, (_, index) => (index * 31 + 7) & 0xff));
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const handshakeGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const acceptKey = key => createHash("sha1").update(key + handshakeGuid).digest("base64");
// The subprotocols /subprotocol supports, in the server's order of preference.
const supportedProtocols = ["chat.v2", "chat.v1"];

const OPCODES = {continuation: 0x0, text: 0x1, binary: 0x2, close: 0x8, ping: 0x9, pong: 0xa};
const opcodeName = opcode => Object.entries(OPCODES).find(([, value]) => value === opcode)?.[0] ?? `reserved-${opcode}`;
const MAX_FRAME = 64 * 1024 * 1024;

const connections = [];
const holds = new Map();
const listeners = {};
let sequence = 0;
let frameSequence = 0;

// One server frame: FIN, the opcode and a payload no longer than 2^32, never masked.
function encodeFrame(opcode, payload = Buffer.alloc(0), {fin = true} = {}) {
  const length = payload.length;
  const head = length < 126 ? Buffer.from([(fin ? 0x80 : 0) | opcode, length])
    : length < 65536 ? Buffer.from([(fin ? 0x80 : 0) | opcode, 126, length >> 8, length & 0xff])
      : Buffer.from([(fin ? 0x80 : 0) | opcode, 127, 0, 0, 0, 0, (length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff]);
  return Buffer.concat([head, payload]);
}
const closePayload = (code, reason = "") => (code === undefined ? Buffer.alloc(0)
  : Buffer.concat([Buffer.from([code >> 8, code & 0xff]), Buffer.from(reason, "utf8")]));

// Incremental frame parser. Calls `onFrame({fin, opcode, masked, payload})` for each complete frame.
function frameParser(onFrame, onError) {
  let buffer = Buffer.alloc(0);
  return chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      if (buffer.length < 2) {
        return;
      }
      const fin = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) {
          return;
        }
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) {
          return;
        }
        length = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      if (length > MAX_FRAME) {
        onError(new Error(`frame of ${length} bytes is over the limit`));
        return;
      }
      const maskLength = masked ? 4 : 0;
      if (buffer.length < offset + maskLength + length) {
        return;
      }
      const mask = masked ? buffer.subarray(offset, offset + 4) : null;
      const payload = Buffer.from(buffer.subarray(offset + maskLength, offset + maskLength + length));
      if (mask) {
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] ^= mask[index & 3];
        }
      }
      buffer = buffer.subarray(offset + maskLength + length);
      onFrame({fin, opcode, masked, payload});
    }
  };
}

// A client that closes its end of the TCP connection is noticed at once: Node's http server keeps the socket half open
// otherwise, and `close` would never fire for a connection nobody answers.
function watchEnd(entry, socket) {
  socket.on("end", () => {
    if (entry.tcp === "open") {
      entry.tcp = "closed-by-client";
    }
    socket.end();
  });
}

function newConnection(request, listener) {
  const entry = {sequence: ++sequence, listener, url: request.url, httpVersion: request.httpVersion, rawHeaders: [...request.rawHeaders],
    handshake: {status: null, statusText: null, responseHeaders: []}, frames: [], state: "connecting", clientClose: null, serverClose: null,
    tcp: "open", control: false};
  connections.push(entry);
  return entry;
}

function logFrame(entry, direction, opcode, fin, masked, payload) {
  const frame = {at: ++frameSequence, direction, opcode: opcodeName(opcode), fin, masked, length: payload.length, sha256: sha256(payload),
    // Small payloads are kept whole so the oracle can compare bytes; the rest are known by their hash.
    base64: payload.length <= 256 * 1024 ? payload.toString("base64") : null};
  if (opcode === OPCODES.close) {
    const code = payload.length >= 2 ? payload.readUInt16BE(0) : null;
    const reason = payload.length > 2 ? payload.subarray(2).toString("utf8") : "";
    frame.closeCode = code;
    frame.closeReason = reason;
    if (direction === "in") {
      entry.clientClose = {code, reason, bytes: payload.length};
    } else {
      entry.serverClose = {code, reason, bytes: payload.length};
    }
  }
  entry.frames.push(frame);
  return frame;
}

// A server-side peer over the upgraded socket: sends frames, logs them, and hands data frames to `handlers.message`.
function peerOf(entry, socket, handlers = {}) {
  const sendRaw = (buffer, parts) => {
    for (const part of parts) {
      logFrame(entry, "out", part.opcode, part.fin, false, part.payload);
    }
    if (!socket.destroyed) {
      socket.write(buffer);
    }
  };
  const peer = {
    entry, socket,
    send(opcode, payload = Buffer.alloc(0), {fin = true} = {}) {
      sendRaw(encodeFrame(opcode, payload, {fin}), [{opcode, fin, payload}]);
    },
    text: message => peer.send(OPCODES.text, Buffer.from(message, "utf8")),
    binary: bytes => peer.send(OPCODES.binary, Buffer.from(bytes)),
    close(code, reason = "") {
      peer.send(OPCODES.close, closePayload(code, reason));
    },
    // Several frames in one write: how a real server's data and close frame reach the client in one segment.
    burst(frames) {
      sendRaw(Buffer.concat(frames.map(frame => encodeFrame(frame.opcode, frame.payload, {fin: frame.fin ?? true}))),
        frames.map(frame => ({opcode: frame.opcode, fin: frame.fin ?? true, payload: frame.payload})));
    },
    // The client's end of the connection, with no close frame: what a crash or a network cut looks like.
    drop(reset = false) {
      entry.state = "dropped-by-server";
      entry.tcp = reset ? "reset-by-server" : "closed-by-server";
      entry.serverDropped = true;
      if (reset && socket.resetAndDestroy) {
        socket.resetAndDestroy();
      } else {
        socket.destroy();
      }
    },
  };
  const fragments = [];
  const parse = frameParser(frame => {
    logFrame(entry, "in", frame.opcode, frame.fin, frame.masked, frame.payload);
    if (frame.opcode === OPCODES.close) {
      entry.closeFrameSeen = true;
      handlers.close?.(peer, frame.payload);
      return;
    }
    if (frame.opcode === OPCODES.ping) {
      // A ping is answered with a pong that carries the same payload, as the RFC says.
      peer.send(OPCODES.pong, frame.payload);
      return;
    }
    if (frame.opcode === OPCODES.pong) {
      handlers.pong?.(peer, frame.payload);
      return;
    }
    // A data message, reassembled from its fragments.
    if (frame.opcode !== OPCODES.continuation) {
      fragments.length = 0;
      fragments.push({opcode: frame.opcode, payload: frame.payload});
    } else {
      fragments.push({opcode: fragments[0]?.opcode ?? OPCODES.binary, payload: frame.payload});
    }
    if (frame.fin) {
      const message = {opcode: fragments[0].opcode, payload: Buffer.concat(fragments.map(part => part.payload))};
      fragments.length = 0;
      handlers.message?.(peer, message);
    }
  }, error => {
    entry.protocolError = String(error.message);
    socket.destroy();
  });
  socket.on("data", parse);
  socket.on("error", () => {});
  socket.on("close", () => {
    if (entry.state === "open" || entry.state === "closing") {
      entry.state = entry.closeFrameSeen ? "closed" : "dropped-by-client";
    }
    if (entry.tcp === "open") {
      entry.tcp = "closed-by-client";
    }
    handlers.end?.(peer);
  });
  peer.feed = parse;
  peer.handlers = handlers;
  return peer;
}

// The 101 answer, logged. `protocol` is the subprotocol the server selected, if any.
function accept(entry, request, socket, protocol, extraHeaders = []) {
  const headers = [["Upgrade", "websocket"], ["Connection", "Upgrade"], ["Sec-WebSocket-Accept", acceptKey(request.headers["sec-websocket-key"])]];
  if (protocol) {
    headers.push(["Sec-WebSocket-Protocol", protocol]);
  }
  headers.push(...extraHeaders);
  entry.handshake = {status: 101, statusText: "Switching Protocols", responseHeaders: headers};
  socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headers.map(([name, value]) => `${name}: ${value}`).join("\r\n")}\r\n\r\n`);
  entry.state = "open";
}

// A plain HTTP answer in place of the upgrade, written to the raw socket.
function refuse(entry, socket, status, statusText, body = "") {
  const bytes = Buffer.from(body, "utf8");
  entry.handshake = {status, statusText, responseHeaders: [["Content-Length", String(bytes.length)], ["Connection", "close"]]};
  entry.state = "refused";
  entry.tcp = "closed-by-server";
  socket.write(`HTTP/1.1 ${status} ${statusText}\r\nContent-Type: text/plain\r\nContent-Length: ${bytes.length}\r\nConnection: close\r\n\r\n`);
  socket.end(bytes);
}

const echoHandlers = {
  message: (peer, message) => peer.send(message.opcode, message.payload),
  // The close handshake: answer with the same code (an empty close frame is answered with an empty one) and end the connection.
  close: (peer, payload) => {
    peer.entry.state = "closing";
    peer.close(payload.length >= 2 ? payload.readUInt16BE(0) : undefined, payload.length > 2 ? payload.subarray(2).toString("utf8") : "");
    peer.socket.end();
  },
};

// What each path does once the handshake is accepted. A route may also decide the handshake (hold, reject, wrong answers).
const routes = {
  echo: {handlers: () => echoHandlers},
  // Greets with a text and a binary message, then echoes.
  greeting: {
    handlers: () => echoHandlers,
    onOpen: peer => {
      peer.text("hello from server");
      peer.binary(bytePattern(256));
    },
  },
  // Selects the first protocol of its own preference that the client offered, tells the client which, and echoes.
  subprotocol: {
    select: offered => supportedProtocols.find(candidate => offered.includes(candidate)) ?? null,
    handlers: () => echoHandlers,
    onOpen: (peer, context) => peer.text(`protocol:${context.selected ?? "none"}`),
  },
  // Selects a subprotocol the client never offered, which the client must refuse.
  "wrong-protocol": {
    select: () => "never-offered",
    handlers: () => echoHandlers,
  },
  // Sends the handshake request it received, as a text message.
  headers: {
    handlers: () => echoHandlers,
    onOpen: (peer, context) => peer.text(JSON.stringify({rawHeaders: context.request.rawHeaders, url: context.request.url})),
  },
  // Closes by itself, with the code and reason of the query: at once, or on the first message the client sends.
  "server-close": {
    handlers: (_url, query) => ({
      ...echoHandlers,
      message: query.get("when") === "message" ? peer => peer.close(Number(query.get("code") ?? 1000), query.get("reason") ?? "") : echoHandlers.message,
      close: (peer, payload) => {
        peer.entry.state = "closing";
        // The client's answer to a close the server started ends the exchange.
        if (peer.entry.serverClose === null) {
          echoHandlers.close(peer, payload);
        } else {
          peer.socket.end();
        }
      },
    }),
    onOpen: (peer, _context, query) => {
      if ((query.get("when") ?? "open") === "open") {
        peer.close(Number(query.get("code") ?? 1000), query.get("reason") ?? "");
      }
    },
  },
  // A close frame with no status code at all, which clients report as 1005.
  "close-empty": {
    handlers: () => ({...echoHandlers, close: (peer, _payload) => peer.socket.end()}),
    onOpen: peer => peer.close(undefined),
  },
  // `count` text messages and then a close frame, at once or on the first message the client sends; with coalesce=1 all of
  // it leaves in one write, as a real server's often does. No timer separates the data from the close frame: the suite
  // never depends on how fast anything runs.
  "data-then-close": {
    handlers: (_url, query) => {
      const closing = peer => {
        const count = Number(query.get("count") ?? 3);
        const frames = Array.from({length: count}, (_, index) => ({opcode: OPCODES.text, payload: Buffer.from(`m${index}`)}));
        const close = {opcode: OPCODES.close, payload: closePayload(Number(query.get("code") ?? 1000), query.get("reason") ?? "")};
        if (query.get("coalesce") === "1") {
          peer.burst([...frames, close]);
        } else {
          frames.forEach(frame => peer.send(frame.opcode, frame.payload));
          peer.send(close.opcode, close.payload);
        }
      };
      return {...echoHandlers, message: query.get("when") === "message" ? (peer, _message) => closing(peer) : echoHandlers.message,
        close: (peer, _payload) => {
          peer.entry.state = "closing";
          peer.socket.end();
        }, closing};
    },
    onOpen: (peer, _context, query) => {
      if ((query.get("when") ?? "open") === "open") {
        peer.handlers.closing(peer);
      }
    },
  },
  // Ends the TCP connection with no close frame, at once or on the first message; reset=1 sends a reset instead of a FIN.
  drop: {
    handlers: (_url, query) => ({...echoHandlers, message: query.get("when") === "message" ? peer => peer.drop(query.get("reset") === "1") : echoHandlers.message}),
    onOpen: (peer, _context, query) => {
      if ((query.get("when") ?? "open") === "open") {
        peer.drop(query.get("reset") === "1");
      }
    },
  },
  // Accepts the handshake and then ignores everything, a close frame included: only the client's own end can finish it.
  silent: {handlers: () => ({})},
  // Answers the client's close frame with two more messages first, and then with its own close frame.
  "data-on-close": {
    handlers: () => ({...echoHandlers, close: (peer, payload) => {
      peer.entry.state = "closing";
      peer.text("late-1");
      peer.text("late-2");
      peer.close(payload.length >= 2 ? payload.readUInt16BE(0) : undefined, "");
      peer.socket.end();
    }}),
  },
  // Transport spike routes: echo a TLS close, return a different peer code, or drop after the client's close frame.
  "different-close": {
    handlers: () => ({...echoHandlers, close: peer => {
      peer.entry.state = "closing";
      peer.close(4002, "peer selected");
      peer.socket.end();
    }}),
  },
  "drop-after-close": {
    handlers: () => ({...echoHandlers, close: peer => peer.drop()}),
  },
  // Sends a ping and records the pong, then echoes.
  ping: {
    handlers: () => echoHandlers,
    onOpen: peer => peer.send(OPCODES.ping, Buffer.from("ping-payload")),
  },
  // A text frame whose payload is not UTF-8: RFC 6455 says to fail the connection with 1007, OkHttp reads it with replacement characters.
  "invalid-text": {
    handlers: () => echoHandlers,
    onOpen: peer => peer.send(OPCODES.text, Buffer.from([0x61, 0xff, 0x62, 0xc3])),
  },
  // A megabyte of binary pattern, sent at once, and then an echo.
  large: {
    handlers: () => echoHandlers,
    onOpen: peer => peer.binary(bytePattern(1048576)),
  },
  // An aggregate load with several independent messages per socket. One poll's shared byte budget must rotate through
  // these peers; the messages stay separate so the runtime's callback admission is exercised as well as byte reads.
  flood: {
    handlers: () => echoHandlers,
    onOpen: (peer, _context, query) => {
      const count = Number(query.get("count") ?? 128);
      const bytes = Number(query.get("bytes") ?? 8192);
      const stream = Number(query.get("stream") ?? 0);
      const frames = Array.from({length: count}, (_, index) => {
        const payload = Buffer.alloc(bytes, 0x78);
        payload.write(`${stream}:${index}:`, 0, "utf8");
        return {opcode: OPCODES.text, payload};
      });
      peer.burst(frames);
    },
  },
  // Messages split into fragments: the client must reassemble them.
  fragmented: {
    handlers: () => echoHandlers,
    onOpen: peer => {
      peer.send(OPCODES.text, Buffer.from("frag"), {fin: false});
      peer.send(OPCODES.continuation, Buffer.from("ment"), {fin: false});
      peer.send(OPCODES.continuation, Buffer.from("ed"), {fin: true});
      peer.send(OPCODES.binary, Buffer.from([1, 2, 3]), {fin: false});
      peer.send(OPCODES.continuation, Buffer.from([4, 5, 6]), {fin: true});
    },
  },
  // The same text message with a ping between its fragments, which RFC 6455 allows and the engine mishandles: the ping's
  // payload ends up inside the message.
  "fragmented-ping": {
    handlers: () => echoHandlers,
    onOpen: peer => {
      peer.send(OPCODES.text, Buffer.from("frag"), {fin: false});
      peer.send(OPCODES.ping, Buffer.from("between"));
      peer.send(OPCODES.continuation, Buffer.from("ment"), {fin: false});
      peer.send(OPCODES.continuation, Buffer.from("ed"), {fin: true});
    },
  },
};

function handleUpgrade(request, socket, head, listener) {
  const entry = newConnection(request, listener);
  socket.on("error", () => {});
  watchEnd(entry, socket);
  const url = new URL(request.url, "http://placeholder");
  const name = url.pathname.split("/").filter(Boolean)[0] ?? "";
  const query = url.searchParams;
  const key = request.headers["sec-websocket-key"];
  const wellFormed = String(request.headers.upgrade ?? "").toLowerCase() === "websocket" && key && request.headers["sec-websocket-version"] === "13";

  if (!wellFormed) {
    return refuse(entry, socket, 400, "Bad Request", "not a WebSocket handshake");
  }
  if (name === "reject") {
    return refuse(entry, socket, Number(query.get("status") ?? 403), "Forbidden", "refused");
  }
  if (name === "bad-accept") {
    entry.handshake = {status: 101, statusText: "Switching Protocols", responseHeaders: [["Sec-WebSocket-Accept", "AAAAAAAAAAAAAAAAAAAAAAAAAAA="]]};
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: AAAAAAAAAAAAAAAAAAAAAAAAAAA=\r\n\r\n");
    entry.state = "bad-accept";
    socket.on("close", () => {
      entry.tcp = "closed-by-client";
    });
    return undefined;
  }
  const route = routes[name] ?? routes.echo;
  const offered = String(request.headers["sec-websocket-protocol"] ?? "").split(",").map(value => value.trim()).filter(Boolean);
  const selected = route.select ? route.select(offered) : null;

  function finish(protocol) {
    const peer = peerOf(entry, socket, route.handlers(url, query));
    accept(entry, request, socket, protocol);
    // Bytes the client sent behind its request belong to the first frames.
    if (head?.length) {
      peer.feed(head);
    }
    route.onOpen?.(peer, {request, selected: protocol}, query);
    return undefined;
  }

  if (name === "hold") {
    // The handshake waits for the control request that releases it, or for the client to give up.
    const label = query.get("name");
    const hold = {state: "waiting", release: () => {}};
    holds.set(label, hold);
    entry.hold = label;
    hold.release = () => finish(null);
    socket.on("close", () => {
      if (hold.state === "waiting") {
        hold.state = "closed-by-client";
        entry.state = "dropped-by-client-before-open";
        entry.tcp = "closed-by-client";
      }
    });
    return undefined;
  }
  return finish(selected);
}

function control(request, response) {
  const url = new URL(request.url, "http://placeholder");
  const parts = url.pathname.split("/").filter(Boolean);
  const json = (value, status = 200) => {
    const body = JSON.stringify(value);
    response.writeHead(status, {"Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body)});
    response.end(body);
  };
  if (parts[0] === "__control" && parts[1] === "log") {
    return json({connections, holds: Object.fromEntries([...holds].map(([key, hold]) => [key, hold.state]))});
  }
  if (parts[0] === "__control" && parts[1] === "release") {
    const hold = holds.get(parts[2]);
    if (hold && hold.state === "waiting") {
      hold.state = "released";
      hold.release();
    }
    return json({name: parts[2], state: hold?.state ?? "unknown"});
  }
  // A plain request to a WebSocket path is not an upgrade: the server says so with an ordinary answer.
  response.writeHead(426, {"Content-Type": "text/plain", Upgrade: "websocket"});
  return response.end("upgrade required");
}

function listen(server, label, host = "127.0.0.1") {
  server.on("upgrade", (request, socket, head) => handleUpgrade(request, socket, head, label));
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, host, () => {
      listeners[label] = {server, port: server.address().port};
      resolve(listeners[label].port);
    });
  });
}

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

export async function startWebSocketServer(outDirectory) {
  const identity = issueTestIdentity("Godot Fabric websocket test CA");
  const untrusted = issueTestIdentity("Godot Fabric untrusted websocket test CA");
  const ports = {
    ws: await listen(http.createServer(control), "ws"),
    wss: await listen(https.createServer({key: identity.privateKey, cert: identity.certificate}, control), "wss"),
    wssUntrusted: await listen(https.createServer({key: untrusted.privateKey, cert: untrusted.certificate}, control), "wss-untrusted"),
    refused: await closedPort(),
    blackhole: await listen(blackhole(), "blackhole"),
  };
  mkdirSync(outDirectory, {recursive: true});
  const files = {ca: path.join(outDirectory, "websocket-ca.pem"), untrustedCa: path.join(outDirectory, "websocket-untrusted-ca.pem")};
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
  const server = await startWebSocketServer(outIndex >= 0 ? process.argv[outIndex + 1] : "build");
  process.stdout.write(JSON.stringify({format: "godot-fabric.websocket-server/v1", ports: server.ports, files: server.files}) + "\n");
  // The runner closes stdin (or kills this process) when it is done.
  process.stdin.on("end", async () => {
    await server.close();
    process.exit(0);
  });
  process.stdin.resume();
}
