import assert from "node:assert/strict";
import {bytePattern, sha256, utf8Text} from "./websocket-server.mjs";

// An independent check of a websocket report. It trusts nothing the probe concluded: it states, for each socket the
// cases open, what the server must have received and sent (from the server's own definitions: the constants and byte
// pattern of websocket-server.mjs), reads what the server recorded as it happened on the wire (the handshake's raw
// header names and order, every frame in both directions with its opcode, length and hash, and how each connection
// ended), and compares both with what JS observed through React Native's WebSocket. It ties what JS received to what
// the server sent, and the native counters to the server's record by arithmetic.
//
// A report is judged without its `checks`: the runner also feeds it a copy in which every check is marked passed,
// which a wrong host must still fail.

const equal = (actual, expected, message) => assert.equal(actual, expected, "websocket oracle: " + message);
const same = (actual, expected, message) => assert.deepEqual(actual, expected, "websocket oracle: " + message);
const check = (condition, message) => assert.ok(condition, "websocket oracle: " + message);

const text = value => Buffer.from(value, "utf8");
const MEGABYTE = 1048576;
const allBytes = Buffer.from(Array.from({length: 256}, (_, index) => index));
const describe = (opcode, payload) => ({opcode, length: payload.length, sha256: sha256(payload)});
const textMessage = value => describe("text", text(value));
const binaryMessage = bytes => describe("binary", Buffer.from(bytes));
const fnv1a = bytes => {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return hash;
};

// The case label of a URL: its `case` query parameter.
const labelOf = url => new URL(url, "ws://placeholder").searchParams.get("case");

// What the cases are documented to do, one entry for each connection that reaches the server. `in` and `out` are the data
// messages the server must have received and sent, in order; `clientClose` and `serverClose` the close frames it saw and
// sent ({code, reason}; code null for a frame without a status), or null for none; `end` how the connection ended at the
// server. `js` is how the socket must end for JS when it is not the plain open, messages and close of a clean socket.
const echoed = messages => ({in: messages, out: messages});
const ends = (code, reason = "") => ({clientClose: {code, reason}, serverClose: {code, reason}, end: "closed"});
const refusedHandshake = (status, route, jsFailure) => ({route, in: [], out: [], clientClose: null, serverClose: null, end: "refused", handshake: status,
  js: ["error", "close"], jsFailure});
const held = {listener: "ws", route: "hold", in: [], out: [], clientClose: null, serverClose: null, end: "dropped-by-client-before-open", handshake: null};
const rejectedClose = {route: "server-close", in: [textMessage("now")], out: [], clientClose: {code: 1000, reason: "bye"}, serverClose: {code: 1000, reason: "bye"}, end: "closed"};

function expectedConnections(ports) {
  const origin = `http://127.0.0.1:${ports.ws}`;
  const pattern = binaryMessage(bytePattern(MEGABYTE));
  const entries = {
    "states": {route: "echo", ...echoed([]), ...ends(1000), wireOnly: "The state-property probe uses the native module directly and creates no JS socket session."},
    "echo-text": {route: "echo", ...echoed([textMessage(utf8Text)]), ...ends(4000, "bye"), origin},
    "echo-binary": {route: "echo", ...echoed([binaryMessage(allBytes), binaryMessage(allBytes), binaryMessage(allBytes.subarray(10, 20)),
      binaryMessage(Buffer.from([1, 0, 254, 255, 44, 1])), binaryMessage(allBytes.subarray(4, 12))]), ...ends(1000)},
    "echo-default": {route: "echo", ...echoed([binaryMessage([7, 8, 9])]), ...ends(1000)},
    "echo-blob": {route: "echo", ...echoed([binaryMessage([1, 2, 3, 250]), textMessage("texto"), binaryMessage(text("blob ação")), binaryMessage([9, 8, 7])]), ...ends(1000)},
    "sub-list": {route: "subprotocol", in: [], out: [textMessage("protocol:chat.v2")], ...ends(1000), protocols: "chat.v3,chat.v2,chat.v1"},
    "sub-single": {route: "subprotocol", in: [], out: [textMessage("protocol:chat.v1")], ...ends(1000), protocols: "chat.v1"},
    "sub-none": {route: "subprotocol", in: [], out: [textMessage("protocol:none")], ...ends(1000), protocols: null},
    "sub-filtered": {route: "subprotocol", in: [], out: [textMessage("protocol:chat.v1")], ...ends(1000), protocols: "chat.v1"},
    "headers-plain": {route: "headers", in: [], out: "headers", ...ends(1000), origin},
    "headers-custom": {route: "headers", in: [], out: "headers", ...ends(1000), origin, custom: true},
    "headers-origin": {route: "headers", in: [], out: "headers", ...ends(1000), origin: "https://app.example"},
    "headers-origin-lower": {route: "headers", in: [], out: "headers", ...ends(1000), origin: "https://lower.example"},
    "headers-wss": {listener: "wss", route: "headers", in: [], out: "headers", ...ends(1000), origin: `https://127.0.0.1:${ports.wss}`},
    "headers-http": {route: "headers", in: [], out: "headers", ...ends(1000), origin},
    "headers-https": {listener: "wss", route: "headers", in: [], out: "headers", ...ends(1000), origin: `https://127.0.0.1:${ports.wss}`},
    "server-close": {route: "server-close", in: [], out: [], ...ends(4001, "going away")},
    "server-close-message": {route: "server-close", in: [textMessage("go")], out: [], ...ends(4002, "after a message")},
    "close-empty": {route: "close-empty", in: [], out: [], clientClose: {code: null, reason: ""}, serverClose: {code: null, reason: ""}, end: "closed", jsCode: 1005},
    "close-default": {route: "echo", ...echoed([]), ...ends(1000)},
    "close-custom": {route: "echo", ...echoed([]), ...ends(3000, "ação")},
    "close-rejected-reason": rejectedClose,
    "close-rejected-reserved": rejectedClose,
    "close-rejected-range": rejectedClose,
    "send-after-close": {route: "echo", ...echoed([]), ...ends(1000), js: ["open", "error", "close"], jsFailure: "client is null"},
    "close-connecting": {...held, js: ["error", "close"], jsFailure: "WebSocket is closed before the connection is established."},
    "reject": refusedHandshake(403, "reject", "HTTP/1.1 403 Forbidden"),
    "reject-401": refusedHandshake(401, "reject", "HTTP/1.1 401 Forbidden"),
    "bad-accept": {...refusedHandshake(101, "bad-accept", "invalid Sec-WebSocket-Accept"), end: "bad-accept"},
    "wrong-protocol": {...refusedHandshake(101, "wrong-protocol", "unoffered subprotocol"), end: "dropped-by-client", protocols: "chat.v1"},
    "unmatched-protocol": {route: "echo", ...echoed([]), ...ends(1000), protocols: "other"},
    "drop": {route: "drop", in: [textMessage("boom")], out: [], clientClose: null, serverClose: null, end: "dropped-by-server", js: ["open", "error", "close"], jsFailure: "ended without exposing a close frame"},
    "reset": {route: "drop", in: [textMessage("boom")], out: [], clientClose: null, serverClose: null, end: "dropped-by-server", js: ["open", "error", "close"], jsFailure: "ended without exposing a close frame"},
    "large-binary": {route: "echo", ...echoed([pattern]), ...ends(1000)},
    "large-text": {route: "echo", ...echoed([describe("text", Buffer.alloc(MEGABYTE, "x"))]), ...ends(1000)},
    "large-server": {route: "large", in: [], out: [pattern], ...ends(1000)},
    "large-blob": {route: "large", in: [], out: [pattern], ...ends(1000)},
    "overflow": {route: "echo", ...echoed([]), ...ends(1001)},
    // The transport sends the protocol's 1007 close, then reports that terminal failure to JS as code 1006.
    "invalid-text": {route: "invalid-text", in: [], out: [describe("text", Buffer.from([0x61, 0xff, 0x62, 0xc3]))], jsOut: [],
      ...ends(1007), js: ["open", "error", "close"], jsFailure: "close code 1007"},
    "fragmented": {route: "fragmented", in: [], out: [textMessage("fragmented"), binaryMessage([1, 2, 3, 4, 5, 6])], ...ends(1000),
      fragments: ["text:4:nf", "continuation:4:nf", "continuation:2", "binary:3:nf", "continuation:3"]},
    // A ping between fragments does not enter the reassembled application message.
    "fragmented-ping": {route: "fragmented-ping", in: [], out: [textMessage("fragmented")], ...ends(1000), pong: "between"},
    "server-ping": {route: "ping", in: [textMessage("after the ping")], out: [textMessage("after the ping")], ...ends(1000), pong: "ping-payload"},
    "client-ping": {route: "echo", ...echoed([binaryMessage([])]), ...ends(1000)},
    // All three messages are delivered before the server's close, even when written together.
    "data-then-close": {route: "data-then-close", in: [], out: [textMessage("m0"), textMessage("m1"), textMessage("m2")], clientClose: {code: 4003, reason: "done"},
      serverClose: {code: 4003, reason: "done"}, end: "closed"},
    "wss-trusted": {listener: "wss", route: "echo", ...echoed([textMessage("secure")]), ...ends(1000)},
    "wss-right": {listener: "wss-untrusted", route: "echo", ...echoed([textMessage("secure")]), ...ends(1000)},
    "contract": {route: "echo", ...echoed([textMessage("hello"), binaryMessage([1, 2, 3]), binaryMessage([])]), ...ends(1000, "done"),
      wireOnly: "The module contract probe invokes the native module directly; its device events are asserted in the probe."},
    "contract-bad-base64": {route: "echo", in: [], out: [], ...ends(1001),
      wireOnly: "The malformed base64 contract probe invokes the native module directly; no JS WebSocket object owns this request."},
    "close-timeout": {route: "silent", in: [], out: [], clientClose: {code: 1000, reason: "slow"}, serverClose: null, end: "closed", js: ["open", "error", "close"], jsFailure: "close timed out"},
    "handshake-timeout": {...held, js: ["error", "close"], jsFailure: "connection and upgrade timed out"},
    "stop-open": {route: "echo", ...echoed([textMessage("stop-open")]), ...ends(1001),
      wireOnly: "The application stop discards queued JS events before a terminal session can be recorded."},
    "stop-blob": {route: "echo", ...echoed([binaryMessage([1, 2, 3])]), ...ends(1001),
      wireOnly: "The application stop discards queued JS events before a terminal session can be recorded."},
    "stop-closing": {route: "silent", in: [], out: [], clientClose: {code: 1000, reason: "never answered"}, serverClose: null, end: "closed",
      wireOnly: "The application stop silently drops a close already waiting for the server."},
    "stop-connecting": {...held, wireOnly: "The application stop silently drops the socket before its held upgrade completes."},
  };
  for (const root of ["A", "B"]) {
    for (let index = 0; index < 3; index += 1) {
      entries[`concurrent-${root}-${index}`] = {route: "echo", ...echoed([textMessage(`from ${root} ${index}`)]), ...ends(1000, `${root}${index}`)};
    }
  }
  return entries;
}

const headerPairs = connection => {
  const pairs = [];
  for (let index = 0; index < connection.rawHeaders.length; index += 2) {
    pairs.push([connection.rawHeaders[index].toLowerCase(), connection.rawHeaders[index + 1]]);
  }
  return pairs;
};
const headerValues = (connection, name) => headerPairs(connection).filter(([key]) => key === name).map(([, value]) => value);

// The data messages of one direction, put back together from their frames.
function dataMessages(connection, direction) {
  const messages = [];
  let current = null;
  const finish = parts => {
    const bytes = parts.every(part => part.base64 !== null) ? Buffer.concat(parts.map(part => Buffer.from(part.base64, "base64"))) : null;
    return {opcode: parts[0].opcode, length: parts.reduce((total, part) => total + part.length, 0), bytes,
      sha256: bytes ? sha256(bytes) : parts.length === 1 ? parts[0].sha256 : null};
  };
  for (const frame of connection.frames.filter(row => row.direction === direction)) {
    if (frame.opcode === "text" || frame.opcode === "binary") {
      current = [frame];
    } else if (frame.opcode === "continuation" && current) {
      current.push(frame);
    } else {
      continue;
    }
    if (frame.fin) {
      messages.push(finish(current));
      current = null;
    }
  }
  return messages;
}
const summarize = messages => messages.map(message => ({opcode: message.opcode, length: message.length, sha256: message.sha256}));
const closeFrame = (connection, direction) => connection.frames.find(frame => frame.direction === direction && frame.opcode === "close") ?? null;
const closeOf = frame => (frame === null ? null : {code: frame.closeCode, reason: frame.closeReason});

// Every connection: what a client's handshake and frames must look like whatever the case.
function verifyHandshakes(connections, ports) {
  const keys = new Set();
  const listenerPort = {ws: ports.ws, wss: ports.wss, "wss-untrusted": ports.wssUntrusted};
  connections.forEach((connection, index) => {
    const label = `connection ${connection.sequence} ${connection.url}`;
    if (index > 0) {
      check(connection.sequence > connections[index - 1].sequence, "sequences increase");
    }
    equal(connection.httpVersion, "1.1", `${label} is HTTP/1.1`);
    same(headerValues(connection, "host"), [`127.0.0.1:${listenerPort[connection.listener]}`], `${label} names the host it was sent to, once`);
    same(headerValues(connection, "upgrade"), ["websocket"], `${label} asks for an upgrade to websocket, once`);
    same(headerValues(connection, "connection").map(value => value.toLowerCase()), ["upgrade"], `${label} asks for the connection to be upgraded, once`);
    same(headerValues(connection, "sec-websocket-version"), ["13"], `${label} speaks version 13`);
    const [key, ...rest] = headerValues(connection, "sec-websocket-key");
    check(key !== undefined && rest.length === 0 && Buffer.from(key, "base64").length === 16 && Buffer.from(key, "base64").toString("base64") === key,
      `${label} has one key of 16 bytes`);
    check(!keys.has(key), `${label} has a key no other connection has: a nonce is never reused`);
    keys.add(key);
    equal(headerValues(connection, "origin").length, 1, `${label} carries exactly one Origin`);
    equal(headerValues(connection, "cookie").length, 0, `${label} sends no cookie`);
    check(!["open", "connecting", "closing"].includes(connection.state), `${label} ended: ${connection.state}`);
    equal(connection.protocolError, undefined, `${label} broke no protocol rule the server enforces`);
    for (const frame of connection.frames.filter(row => row.direction === "in")) {
      equal(frame.masked, true, `${label}: every frame a client sends is masked`);
    }
    for (const frame of connection.frames.filter(row => row.direction === "out")) {
      equal(frame.masked, false, `${label}: the server never masks`);
    }
  });
}

// The JS side of a socket against the server's record of it.
function verifySession(label, session, connection, entry) {
  const types = session.events.map(event => event.type);
  const messages = session.events.filter(event => event.type === "message");
  const closes = session.events.filter(event => event.type === "close");
  const sent = Array.isArray(entry.jsOut) ? entry.jsOut : Array.isArray(entry.out) || entry.out === undefined ? dataMessages(connection, "out") : null;
  if (entry.js) {
    same(types, entry.js, `${label}: how the socket ended for JS`);
  } else {
    equal(types[0], "open", `${label} opens first`);
    equal(types.at(-1), "close", `${label} closes last`);
    check(!types.includes("error") && !types.includes("handler-error"), `${label} has no error`);
  }
  equal(closes.length, 1, `${label} closes exactly once`);
  const [close] = closes;
  equal(close.readyState, 3, `${label}: the state at close is CLOSED`);
  const answer = closeFrame(connection, "out");
  if (entry.jsFailure) {
    equal(close.code, 1006, `${label}: a failed socket closes with 1006`);
    check(close.reason.includes(entry.jsFailure), `${label}: the failure says ${entry.jsFailure}: ${close.reason}`);
  } else {
    check(answer !== null, `${label}: the server's close frame is what JS's close reports`);
    equal(close.code, entry.jsCode ?? answer.closeCode, `${label}: JS closes with the code the server's close frame carried`);
    // The engine's own words for a close it makes itself, the server's for any other.
    equal(close.reason, entry.jsReason ?? answer.closeReason, `${label}: and its reason`);
  }
  // What JS received is what the server sent: the same messages in the same order, byte for byte.
  if (sent !== null) {
    equal(messages.length, sent.length, `${label}: JS received every message the server sent`);
    messages.forEach((message, index) => {
      const wanted = sent[index];
      if (message.kind === "text") {
        equal(wanted.opcode, "text", `${label} message ${index} is text`);
        // A JS string counts UTF-16 units: the bytes of a short text are counted from the text itself, and the one long text is ASCII.
        equal(message.text === null ? message.length : Buffer.byteLength(message.text, "utf8"), wanted.length, `${label} message ${index}: its length in bytes`);
        if (wanted.bytes !== null && message.text !== null) {
          equal(message.text, wanted.bytes.toString("utf8"), `${label} message ${index}: its text`);
        }
        return;
      }
      equal(message.kind === "blob" ? message.size : message.length, wanted.length, `${label} message ${index}: its length`);
      equal(wanted.opcode, "binary", `${label} message ${index} is binary`);
      const bytes = wanted.bytes ?? (wanted.sha256 === sha256(bytePattern(MEGABYTE)) ? bytePattern(MEGABYTE) : null);
      check(bytes !== null, `${label} message ${index}: the server's bytes are known`);
      equal(message.fnv, fnv1a(bytes), `${label} message ${index}: its bytes, by hash`);
      if (message.bytes) {
        same(Buffer.from(message.bytes), bytes, `${label} message ${index}: its bytes`);
      }
    });
  }
}

// Every JS session in the report, found by walking the stages: an object with events and the URL of its socket.
function sessionsOf(stages) {
  const found = new Map();
  const walk = value => {
    if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value !== null && typeof value === "object") {
      if (Array.isArray(value.events) && typeof value.url === "string" && value.created !== undefined) {
        const label = labelOf(value.url);
        if (label !== null) {
          found.set(label, value);
        }
      } else {
        Object.values(value).forEach(walk);
      }
    }
  };
  walk(stages);
  return found;
}

export function verifyWebSocketReport(report, serverLog) {
  const {stages} = report;
  const connections = serverLog.connections;
  const ports = report.ports;
  const entries = expectedConnections(ports);
  const byLabel = new Map();
  for (const connection of connections) {
    const label = labelOf(connection.url);
    check(label !== null && !byLabel.has(label), `every connection carries its own case label: ${connection.url}`);
    byLabel.set(label, connection);
  }
  equal(stages.modules.WebSocketModule, true, "RN's WebSocketModule was found");
  equal(stages.constructs.created, true, "and RN's WebSocket constructs over it");

  // 1. The connections the cases must have caused, and nothing else.
  same([...byLabel.keys()].sort(), Object.keys(entries).sort(), "the server saw exactly the connections the cases open");
  verifyHandshakes(connections, ports);

  // 2. Each of them against the case that opened it.
  const sessions = sessionsOf(stages);
  let compared = 0;
  for (const [label, entry] of Object.entries(entries)) {
    const connection = byLabel.get(label);
    equal(connection.listener, entry.listener ?? "ws", `${label} reached the listener it was sent to`);
    equal(new URL(connection.url, "ws://placeholder").pathname, "/" + entry.route, `${label} asked for its route`);
    equal(connection.state, entry.end, `${label} ended as ${entry.end}`);
    if (entry.handshake === null) {
      equal(connection.handshake.status, null, `${label} never got its handshake answered`);
    } else if (entry.handshake !== undefined) {
      equal(connection.handshake.status, entry.handshake, `${label} was answered with ${entry.handshake}`);
    }
    same(summarize(dataMessages(connection, "in")), entry.in, `${label}: the messages the server received`);
    if (Array.isArray(entry.out)) {
      same(summarize(dataMessages(connection, "out")), entry.out, `${label}: the messages the server sent`);
    }
    same(closeOf(closeFrame(connection, "in")), entry.clientClose, `${label}: the close frame the server received`);
    same(closeOf(closeFrame(connection, "out")), entry.serverClose, `${label}: the close frame the server sent`);
    if (entry.origin !== undefined) {
      same(headerValues(connection, "origin"), [entry.origin], `${label}: its Origin`);
    }
    same(headerValues(connection, "sec-websocket-protocol"), entry.protocols === undefined || entry.protocols === null ? [] : [entry.protocols],
      `${label}: the subprotocols it offered`);
    if (entry.pong !== undefined) {
      const pongs = connection.frames.filter(frame => frame.direction === "in" && frame.opcode === "pong");
      same(pongs.map(frame => Buffer.from(frame.base64, "base64").toString("utf8")), [entry.pong], `${label}: the pong the engine sent`);
    }
    if (entry.fragments !== undefined) {
      same(connection.frames.filter(frame => frame.direction === "out").slice(0, entry.fragments.length)
        .map(frame => `${frame.opcode}:${frame.length}${frame.fin ? "" : ":nf"}`), entry.fragments, `${label}: the fragments the server wrote`);
    }
    if (entry.out === "headers") {
      // The server reports the handshake it received: it must be the one it recorded.
      const reported = JSON.parse(Buffer.from(connection.frames.find(frame => frame.direction === "out").base64, "base64").toString("utf8"));
      same(reported.rawHeaders, connection.rawHeaders, `${label}: the server's own report of the handshake is the handshake it recorded`);
    }
    if (entry.custom) {
      same(headerValues(connection, "x-custom"), ["one"], `${label}: a header from the options`);
      same(headerValues(connection, "authorization"), ["Bearer t"], `${label}: another`);
      equal(headerValues(connection, "x-number").length, 0, `${label}: a header that is no string is not sent`);
      same(headerValues(connection, "host"), [`127.0.0.1:${ports.ws}`], `${label}: Host is the engine's`);
      same(headerValues(connection, "upgrade"), ["websocket"], `${label}: Upgrade is the engine's`);
    }
    const session = sessions.get(label);
    if (entry.wireOnly !== undefined) {
      check(session === undefined, `${label}: wire-only evidence is explicitly scoped: ${entry.wireOnly}`);
    } else {
      check(session !== undefined, `${label}: a JS session is required`);
      verifySession(label, session, connection, entry);
      compared += 1;
    }
  }
  equal(compared, Object.values(entries).filter(entry => entry.wireOnly === undefined).length,
    "every ordinary connection has a JS session compared with the server");

  // 3. The native counters, by arithmetic against the server's wire record.
  const final = stages.stopped.networking.webSocket;
  const transport = final.transport;
  const clientMessages = connections.flatMap(connection => dataMessages(connection, "in"));
  const serverMessages = connections.flatMap(connection => dataMessages(connection, "out"));
  equal(stages.dataThenCloseObserved.sent, 3, "the probe observed the three messages the server wrote with the close frame");
  equal(stages.dataThenCloseObserved.delivered, 3, "all messages written with the close frame reached JavaScript");
  equal(transport.messagesOut.text, clientMessages.filter(message => message.opcode === "text").length, "the transport sent as many text messages as the server received");
  equal(transport.messagesOut.binary, clientMessages.filter(message => message.opcode === "binary").length, "and as many binary ones");
  equal(transport.messagesOut.bytes, clientMessages.reduce((total, message) => total + message.length, 0), "and as many bytes");
  // The one message that is not UTF-8 is refused by the transport after it sends close 1007.
  equal(transport.messagesIn.text + transport.messagesIn.binary, serverMessages.length - 1, "the transport delivered every valid message and refused only the invalid text frame");
  // A ping between fragments remains a control frame and is not part of the reassembled message.
  const observed = stages.interleavedPingObserved;
  equal(observed.messages, 1, "the message with a ping between its fragments arrived as one message");
  equal(observed.text, "fragmented", "the ping payload did not enter the reassembled data message");
  equal(transport.messagesIn.bytes, serverMessages.reduce((total, message) => total + message.length, 0) - 4,
    "the transport counted every delivered payload except the four invalid UTF-8 bytes");
  equal(final.sent, clientMessages.length, "the module counts the messages the server received");
  equal(final.sentBytes, transport.messagesOut.bytes, "and their bytes");
  equal(final.received, transport.messagesIn.text + transport.messagesIn.binary, "and the messages the transport read");
  // Attempts the server never saw: two connections to a port that refuses (the constructor probe and the failure case), one to a
  // port that accepts and never answers (the duplicate id), and three certificates the engine refuses. The module refuses before
  // any transport: a URL without a scheme, a scheme OkHttp cannot read, a header, a non-ASCII header and a subprotocol OkHttp
  // cannot take, and a trust that is no PEM.
  const unseen = 2 + 1 + 3;
  const refusedByModule = 6;
  equal(transport.started, connections.length + unseen, "the transport started every connection the server saw, and the ones it could not see");
  equal(final.refused, refusedByModule, "the module refused the six it must refuse");
  equal(final.connects, transport.started + refusedByModule, "and every connect is one or the other");
  // The four sockets the stop stage leaves in flight are ended by the application's stop, which is silent: neither a close nor a failure.
  equal(final.connects, final.refused + final.closed + final.failed + 4, "every connect ended as a refusal, a close, a failure, or the stop that ended four");
  equal(transport.started, transport.closedByPeer + transport.failed + transport.cancelled, "every started connection ended as a close, a failure or a cancel");
  equal(final.programmerErrors, 6, "six sends went to a socket that was gone: after a close, after a failure, to ids that never existed");
  equal(final.closeRejections, 3, "three closes were refused: a long reason, a reserved code, a code out of range");
  equal(final.connectingCloses, 2, "two sockets were closed while connecting");
  equal(transport.closeTimeouts, 1, "one close was never answered");
  equal(transport.impliedCloses, undefined, "the transport exposes no inferred-close success counter");
  equal(final.ignoredHeaders, 1, "one header that is no string was ignored");
  equal(final.droppedHeaders, 3, "three of the handshake's own headers were dropped");
  equal(final.blobMessages, 4, "four binary messages became blobs");
  equal(final.blobSends, 1, "one blob was sent");
  equal(final.overflows, 1, "one message did not fit in the queue and closed its socket with 1001");
  equal(transport.overflows, 1, "as the transport saw it");
  equal(final.droppedSends + transport.sendErrors, 0, "and no other send was lost");

  // 4. The transport validates HTTP upgrades itself; only two TLS handshake failures reach the engine's TLS peer.
  equal(stages.deliberateTlsFailures, 3, "all three untrusted TLS handshakes that reach the engine are refused");

  // 5. Nothing is left, here or there.
  equal(stages.stopped.networking.stopped, true, "the application stopped");
  same(final.sockets, {connecting: 0, open: 0, closing: 0, blobHandlers: 0}, "no socket is left after stop");
  equal(transport.active, 0, "and the transport holds none");
  equal(stages.stopped.networking.blobs.count, 0, "and no blob");
  for (const name of ["close-connecting", "stop-connecting"]) {
    equal(serverLog.holds[name], "closed-by-client", `${name}: the held handshake saw the client leave`);
  }
  return {connections: connections.length, compared, serverMessages: serverMessages.length, clientMessages: clientMessages.length,
    started: transport.started, connects: final.connects};
}
