import React, {useEffect} from "react";
import {AppRegistry, NativeEventEmitter, TurboModuleRegistry, View} from "react-native";
import {disposeEnvironment, environmentStats} from "../src/platform-environment";

// Drives React Native's own WebSocket (and, for binary messages, its Blob and FileReader) through the public
// react-native bundle against the suite's local WebSocket server, and records what JS observes: every event of every
// socket, in order, with the readyState it saw. Every case is one named scenario; the probe starts it, waits for it and
// compares the record with what the server saw. Nothing here knows the native module: on a host without it, the first
// `new WebSocket` throws where RN looks the module up, which fails every case that needs the network, and the cases that
// need none behave the same on both hosts.
const state = {servers: null, cases: {}, sequence: 0, roots: {}, log: [], sockets: {}};
// The modules as the bundle first found them, retained to be called after the application stops.
const retained = {};
for (const name of ["WebSocketModule", "BlobModule"]) {
  try {
    retained[name] = TurboModuleRegistry.get(name);
  } catch (error) {
    retained[name] = null;
  }
}

const utf8Text = "Olá, mundo — ação 日本語 😀 Zażółć gęślą jaźń";
const describeError = error => ({name: String(error?.name ?? "Error"), message: String(error?.message ?? error)});
const bytesOf = buffer => Array.from(new Uint8Array(buffer));
// The bytes the server's pattern is made of: the same value the oracle computes.
const pattern = size => Uint8Array.from({length: size}, (_, index) => (index * 31 + 7) & 0xff);
// FNV-1a over bytes, and over the code units of an ASCII string.
function fnv1a(values) {
  const bytes = typeof values === "string" ? Array.from(values, character => character.charCodeAt(0) & 0xff) : new Uint8Array(values);
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += 1) {
    hash = Math.imul(hash ^ bytes[index], 0x01000193) >>> 0;
  }
  return hash;
}
const settled = promise => promise.then(value => ({value}), error => ({error: describeError(error)}));
const smallBytes = buffer => (buffer.byteLength <= 4096 ? bytesOf(buffer) : null);
// The report is JSON, which a raw control character in a string would break: the reasons that carry one are recorded with it spelled out.
const visible = text => text.replace(/[\u0000-\u001f\u007f]/g, character => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"));

function readBlob(blob, method) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader[method](blob);
  });
}

function context(root, args) {
  const servers = state.servers;
  const base = {ws: "ws://127.0.0.1:" + servers.ws, wss: "wss://127.0.0.1:" + servers.wss, wssUntrusted: "wss://127.0.0.1:" + servers.wssUntrusted,
    refused: "ws://127.0.0.1:" + servers.refused, blackhole: "ws://127.0.0.1:" + servers.blackhole};
  return {root, args: args ?? {}, base, url: (path, origin = "ws") => base[origin] + path};
}

// One WebSocket under observation. Every event it dispatches is recorded in order with the state it saw; the promise ends
// with its close event (and with the reads of the blobs it received, which are the only thing that finishes later).
// `onOpen` and `onMessage` drive the socket.
function drive({url, protocols, options, binaryType, name, onOpen, onMessage}) {
  return new Promise(resolve => {
    const events = [];
    const reads = [];
    const ws = protocols === undefined && options === undefined ? new WebSocket(url) : new WebSocket(url, protocols, options);
    if (name) {
      state.sockets[name] = {ws, events};
    }
    if (binaryType !== undefined) {
      ws.binaryType = binaryType;
    }
    const note = (type, extra = {}) => {
      const event = {type, readyState: ws.readyState, ...extra};
      events.push(event);
      return event;
    };
    const created = {readyState: ws.readyState, binaryType: ws.binaryType ?? null, url: ws.url};
    // A handler that throws would be swallowed by the event dispatch; the record keeps it.
    const guarded = call => {
      try {
        call();
      } catch (error) {
        note("handler-error", {message: String(error?.message ?? error)});
      }
    };
    ws.onopen = () => {
      note("open", {protocol: ws.protocol});
      guarded(() => onOpen?.(ws, events));
    };
    ws.onmessage = message => {
      const data = message.data;
      let event;
      if (typeof data === "string") {
        event = note("message", {kind: "text", length: data.length, text: data.length <= 4096 ? data : null, fnv: fnv1a(data)});
      } else if (data instanceof ArrayBuffer) {
        event = note("message", {kind: "arraybuffer", length: data.byteLength, bytes: smallBytes(data), fnv: fnv1a(data)});
      } else {
        // A blob is native memory behind an id: its bytes are read through FileReader, and the blob is closed after.
        event = note("message", {kind: "blob", size: data.size, mime: data.type});
        reads.push(readBlob(data, "readAsArrayBuffer").then(buffer => {
          event.length = buffer.byteLength;
          event.bytes = smallBytes(buffer);
          event.fnv = fnv1a(buffer);
          data.close();
        }));
      }
      guarded(() => onMessage?.(ws, event, events, data));
    };
    ws.onerror = () => note("error");
    ws.onclose = closeEvent => {
      note("close", {code: closeEvent.code, reason: visible(closeEvent.reason)});
      Promise.all(reads).then(() => resolve({created, events, protocol: ws.protocol ?? null, url: ws.url, binaryType: ws.binaryType ?? null,
        readyState: ws.readyState}));
    };
  });
}
const messagesOf = events => events.filter(event => event.type === "message");

const cases = {
  // JavaScript only, once a socket exists: the checks RN's own class makes before and without any native help.
  states: ({url}) => new Promise(resolve => {
    const ws = new WebSocket(url("/echo?case=states"));
    const results = {constants: [WebSocket.CONNECTING, WebSocket.OPEN, WebSocket.CLOSING, WebSocket.CLOSED], initial: ws.readyState,
      initialBinaryType: ws.binaryType ?? null};
    const attempt = call => {
      try {
        call();
        return "returned";
      } catch (error) {
        return String(error.message);
      }
    };
    results.sendConnecting = attempt(() => ws.send("early"));
    results.pingConnecting = attempt(() => ws.ping());
    results.invalidBinaryType = attempt(() => {
      ws.binaryType = "text";
    });
    ws.binaryType = "blob";
    results.afterBlob = ws.binaryType;
    ws.binaryType = "arraybuffer";
    results.afterArrayBuffer = ws.binaryType;
    ws.onopen = () => {
      results.openState = ws.readyState;
      results.unsupportedData = attempt(() => ws.send({not: "supported"}));
      ws.close();
      results.closingState = ws.readyState;
    };
    ws.onclose = () => {
      results.finalState = ws.readyState;
      results.sendAfterClosed = attempt(() => ws.send("late"));
      resolve(results);
    };
  }),
  echoText: ({url}) => drive({url: url("/echo?case=echo-text"), onOpen: ws => ws.send(utf8Text), onMessage: ws => ws.close(4000, "bye")}),
  // Every kind of binary data RN's send accepts, with its own offsets, echoed back as ArrayBuffers.
  echoBinary: ({url}) => {
    const all = Uint8Array.from({length: 256}, (_, index) => index);
    const sends = [all, all.buffer.slice(0), all.subarray(10, 20), new Int16Array([1, -2, 300]), new DataView(all.buffer, 4, 8)];
    let received = 0;
    return drive({url: url("/echo?case=echo-binary"), binaryType: "arraybuffer", onOpen: ws => sends.forEach(item => ws.send(item)),
      onMessage: ws => {
        received += 1;
        if (received === sends.length) {
          ws.close();
        }
      }});
  },
  // The default binaryType is unset and gives ArrayBuffers too.
  echoDefault: ({url}) => drive({url: url("/echo?case=echo-default"), onOpen: ws => ws.send(Uint8Array.from([7, 8, 9])), onMessage: ws => ws.close()}),
  // BlobModule's WebSocket hooks: binary messages arrive as blobs in native memory, a Blob is sent from its bytes, text is
  // text whatever the binaryType, and switching back to arraybuffer returns binary messages to ArrayBuffers.
  echoBlob: ({url}) => {
    let sent = 0;
    return drive({url: url("/echo?case=echo-blob"), name: "echo-blob", binaryType: "blob", onOpen: ws => ws.send(Uint8Array.from([1, 2, 3, 250]).buffer),
      onMessage: (ws, event, events) => {
        const count = messagesOf(events).length;
        if (count === 1) {
          ws.send("texto");
        } else if (count === 2) {
          const blob = new Blob(["blob ", "ação"]);
          ws.send(blob);
          sent = blob.size;
          blob.close();
        } else if (count === 3) {
          ws.binaryType = "arraybuffer";
          ws.send(Uint8Array.from([9, 8, 7]).buffer);
        } else if (count === 4) {
          ws.close();
        }
      }}).then(result => ({...result, blobSent: sent}));
  },
  subprotocol: async ({url}) => ({
    list: await drive({url: url("/subprotocol?case=sub-list"), protocols: ["chat.v3", "chat.v2", "chat.v1"], onMessage: ws => ws.close()}),
    single: await drive({url: url("/subprotocol?case=sub-single"), protocols: "chat.v1", onMessage: ws => ws.close()}),
    none: await drive({url: url("/subprotocol?case=sub-none"), onMessage: ws => ws.close()}),
    filtered: await drive({url: url("/subprotocol?case=sub-filtered"), protocols: [" chat.v1 ", "", "a,b"], onMessage: ws => ws.close()}),
  }),
  headers: async ({url}) => ({
    plain: await drive({url: url("/headers?case=headers-plain"), onMessage: ws => ws.close()}),
    custom: await drive({url: url("/headers?case=headers-custom"), options: {headers: {"X-Custom": "one", Authorization: "Bearer t", "X-Number": 5,
      Host: "other.test", "Sec-WebSocket-Protocol": "smuggled", Upgrade: "h2c"}}, onMessage: ws => ws.close()}),
    origin: await drive({url: url("/headers?case=headers-origin"), options: {headers: {Origin: "https://app.example"}}, onMessage: ws => ws.close()}),
    lowerOrigin: await drive({url: url("/headers?case=headers-origin-lower"), options: {headers: {origin: "https://lower.example"}}, onMessage: ws => ws.close()}),
    secure: await drive({url: url("/headers?case=headers-wss", "wss"), onMessage: ws => ws.close()}),
    // OkHttp reads http and https URLs as ws and wss, and so does the host.
    httpScheme: await drive({url: url("/headers?case=headers-http").replace("ws:", "http:"), onMessage: ws => ws.close()}),
    httpsScheme: await drive({url: url("/headers?case=headers-https", "wss").replace("wss:", "https:"), onMessage: ws => ws.close()}),
  }),
  // The server closes: with its own code and reason, at once or on a message, and with no code at all.
  serverClose: async ({url}) => ({
    atOnce: await drive({url: url("/server-close?code=4001&reason=going%20away&case=server-close")}),
    onMessage: await drive({url: url("/server-close?when=message&code=4002&reason=after%20a%20message&case=server-close-message"), onOpen: ws => ws.send("go")}),
    empty: await drive({url: url("/close-empty?case=close-empty")}),
  }),
  clientClose: async ({url}) => ({
    defaults: await drive({url: url("/echo?case=close-default"), onOpen: ws => ws.close()}),
    custom: await drive({url: url("/echo?case=close-custom"), onOpen: ws => ws.close(3000, "ação")}),
    // OkHttp refuses a reason over 123 bytes, a reserved code and one out of range; Android logs it and the socket stays open.
    // Each socket then ends the way the server ends it, after a message JS can still send while its state is CLOSING.
    rejected: await Promise.all([["reason", 1000, "x".repeat(124)], ["reserved", 1005, "r"], ["range", 999, "r"]].map(([label, code, reason]) => drive({
      url: url("/server-close?when=message&code=1000&reason=bye&case=close-rejected-" + label),
      onOpen: ws => {
        ws.close(code, reason);
        ws.send("now");
      }}))),
    // send after close(): Android's module no longer has the socket, and says so with a failure that closes it.
    sendAfterClose: await drive({url: url("/echo?case=send-after-close"), onOpen: ws => {
      ws.close();
      ws.send("late");
    }}),
  }),
  // The handshake held at the server: close() while CONNECTING ends the attempt (two-phase: the probe closes it).
  holdConnecting: ({url, args}) => drive({url: url("/hold?name=" + args.name + "&case=" + args.name), name: args.name}),
  // The close frame the server never answers: only the host's own time-out can end it (two-phase: the probe moves the clock).
  silentClose: ({url, args}) => drive({url: url("/silent?case=" + args.name), name: args.name, onOpen: ws => ws.close(1000, "slow")}),
  failures: async ({url, base}) => ({
    rejected: await drive({url: url("/reject?case=reject")}),
    unauthorized: await drive({url: url("/reject?status=401&case=reject-401")}),
    badAccept: await drive({url: url("/bad-accept?case=bad-accept")}),
    wrongProtocol: await drive({url: url("/wrong-protocol?case=wrong-protocol"), protocols: ["chat.v1"]}),
    unmatchedProtocol: await drive({url: url("/echo?case=unmatched-protocol"), protocols: ["other"]}),
    refused: await drive({url: base.refused + "/x?case=refused"}),
    badScheme: await drive({url: "ftp://127.0.0.1:1/x"}),
    noScheme: await drive({url: "not a url"}),
    badHeader: await drive({url: url("/echo?case=bad-header"), options: {headers: {"X-Bad": "a\nb"}}}),
    nonAsciiHeader: await drive({url: url("/echo?case=non-ascii-header"), options: {headers: {"X-Unicode": "ação", Authorization: "Bearer é"}}}),
    badProtocol: await drive({url: url("/echo?case=bad-protocol"), protocols: ["bad\u0001"]}),
    dropped: await drive({url: url("/drop?when=message&case=drop"), onOpen: ws => ws.send("boom")}),
    reset: await drive({url: url("/drop?when=message&reset=1&case=reset"), onOpen: ws => ws.send("boom")}),
  }),
  // Messages of a megabyte, both ways, binary, text and as blobs.
  large: async ({url}) => {
    const size = 1048576;
    return {
      binary: await drive({url: url("/echo?case=large-binary"), binaryType: "arraybuffer", onOpen: ws => ws.send(pattern(size)), onMessage: ws => ws.close()}),
      text: await drive({url: url("/echo?case=large-text"), onOpen: ws => ws.send("x".repeat(size)), onMessage: ws => ws.close()}),
      fromServer: await drive({url: url("/large?case=large-server"), onMessage: ws => ws.close()}),
      blob: await drive({url: url("/large?case=large-blob"), binaryType: "blob", onMessage: ws => ws.close()}),
    };
  },
  // A message that does not fit in what OkHttp queues (16 MiB) closes the socket with 1001 and sends nothing.
  overflow: ({url}) => drive({url: url("/echo?case=overflow"), onOpen: ws => ws.send(new Uint8Array(16 * 1048576 + 1))}),
  // What the engine does with frames that are not plain messages: fragments are one message, pings are answered by the
  // engine, and the server's pong comes back, none of which JS sees.
  frames: async ({url}) => ({
    fragmented: await drive({url: url("/fragmented?case=fragmented"), onMessage: (ws, event, events) => {
      if (messagesOf(events).length === 2) {
        ws.close();
      }
    }}),
    serverPing: await drive({url: url("/ping?case=server-ping"), onOpen: ws => ws.send("after the ping"), onMessage: ws => ws.close()}),
    ping: await drive({url: url("/echo?case=client-ping"), onOpen: ws => ws.ping(), onMessage: ws => ws.close()}),
    // RFC 6455 fails a connection whose text frame is not UTF-8, with 1007; the engine does, OkHttp does not.
    invalidText: await drive({url: url("/invalid-text?case=invalid-text")}),
  }),
  // The engine drops the messages that arrive in the same poll as the peer's close frame (godotengine/godot#115384). A
  // server that writes three messages and a close in one go is the reproduction: the close always arrives, the messages
  // may not. Observed, never required.
  dataThenClose: async ({url}) => ({
    coalesced: await drive({url: url("/data-then-close?count=3&coalesce=1&code=4003&reason=done&case=data-then-close")}),
  }),
  // A ping between the fragments of one message: RFC 6455 allows it, the engine puts the ping's payload into the message.
  // Observed, never required.
  interleavedPing: async ({url}) => ({
    fragmented: await drive({url: url("/fragmented-ping?case=fragmented-ping"), onMessage: ws => ws.close()}),
  }),
  tls: async ({url, args}) => drive({url: url("/echo?case=wss-" + args.label, args.origin), onOpen: ws => ws.send("secure"), onMessage: ws => ws.close()}),
  // The native module's own contract, below WebSocket's tolerance: the four device events and their payloads, called
  // directly, together with the arguments RN's JS never sends.
  contract: async ({url, base}) => {
    const module = TurboModuleRegistry.get("WebSocketModule");
    const emitter = new NativeEventEmitter();
    const events = [];
    const waiting = [];
    const subscriptions = ["websocketOpen", "websocketMessage", "websocketClosed", "websocketFailed"].map(name => emitter.addListener(name, payload => {
      events.push({name, payload: JSON.parse(JSON.stringify(payload)), keys: Object.keys(payload).sort()});
      waiting.splice(0).forEach(resume => resume());
    }));
    const until = async test => {
      while (!test()) {
        await new Promise(resume => waiting.push(resume));
      }
    };
    const count = (name, id) => events.filter(event => event.name === name && event.payload.id === id).length;
    const attempt = call => {
      try {
        call();
        return "returned";
      } catch (error) {
        return String(error.message);
      }
    };
    const results = {};
    module.connect(url("/echo?case=contract"), null, {headers: {}}, 9001);
    await until(() => count("websocketOpen", 9001) === 1);
    module.send("hello", 9001);
    module.sendBinary("AQID", 9001);
    module.ping(9001);
    await until(() => count("websocketMessage", 9001) === 3);
    module.close(1000, "done", 9001);
    await until(() => count("websocketClosed", 9001) === 1);
    results.lifecycle = events.slice();
    events.length = 0;
    // A socket that does not exist: "This is a programmer error" on Android, and the same events here; a close does nothing.
    module.send("unknown", 9100);
    module.sendBinary("AQID", 9100);
    module.ping(9100);
    module.close(1000, "", 9101);
    await until(() => count("websocketClosed", 9100) === 3);
    results.unknown = events.slice();
    events.length = 0;
    // Bytes that are no base64: the failure is the socket's last event, and the socket ends with it.
    module.connect(url("/echo?case=contract-bad-base64"), null, {headers: {}}, 9002);
    await until(() => count("websocketOpen", 9002) === 1);
    module.sendBinary("%%%", 9002);
    await until(() => count("websocketFailed", 9002) === 1);
    module.send("after the failure", 9002);
    await until(() => count("websocketClosed", 9002) === 1);
    results.badBase64 = events.slice();
    events.length = 0;
    // A connection to a port that accepts and never answers stays connecting until the socket is closed.
    results.duplicate = attempt(() => {
      module.connect(base.blackhole + "/x", null, {headers: {}}, 9003);
      module.connect(base.blackhole + "/y", null, {headers: {}}, 9003);
    });
    results.invalidId = attempt(() => module.connect(url("/echo?case=contract-invalid"), null, {headers: {}}, -1));
    module.close(1000, "", 9003);
    await until(() => count("websocketFailed", 9003) === 1);
    results.duplicateEvents = events.slice();
    subscriptions.forEach(subscription => subscription.remove());
    return results;
  },
  // Three roots' worth of sockets at once: each root's sockets receive only their own messages.
  concurrent: async ({url, root}) => {
    const sockets = await Promise.all([0, 1, 2].map(index => drive({url: url(`/echo?case=concurrent-${root}-${index}`),
      onOpen: ws => ws.send(`from ${root} ${index}`), onMessage: ws => ws.close(1000, `${root}${index}`)})));
    return {sockets};
  },
  // Sockets left for the application to stop: open, open as blobs, closing at a silent server, and connecting.
  staysOpen: ({url}) => new Promise(() => {
    // Never settles. Each socket's events are in state.sockets for the probe to read, and a socket that ends is logged.
    const stay = (name, path, extra) => drive({url: url(path), name, ...extra}).then(() => state.log.push({event: "ended", name}));
    stay("stop-open", "/echo?case=stop-open", {onOpen: ws => ws.send("stop-open")});
    stay("stop-blob", "/echo?case=stop-blob", {binaryType: "blob", onOpen: ws => ws.send(Uint8Array.from([1, 2, 3]).buffer)});
    stay("stop-closing", "/silent?case=stop-closing", {onOpen: ws => ws.close(1000, "never answered")});
    stay("stop-connecting", "/hold?name=stop-connecting&case=stop-connecting", {});
  }),
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
  return <View testID={"websocket-" + name} style={{width: 120, height: 40, backgroundColor: "#7c3aed"}} />;
}
AppRegistry.registerComponent("WebSocketProbe", () => Root);

globalThis.WebSocketProbe = {
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
  // The events a started socket has had so far, and its state.
  socket(name) {
    const entry = state.sockets[name];
    return entry == null ? null : {events: entry.events, readyState: entry.ws.readyState};
  },
  closeSocket(name, code, reason) {
    state.sockets[name]?.ws.close(code, reason);
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
    return {WebSocketModule: find("WebSocketModule"), BlobModule: find("BlobModule"), Networking: find("Networking")};
  },
  // The first use of WebSocket, as RN's own lookup meets (or does not meet) the module.
  constructs() {
    try {
      const ws = new WebSocket("ws://127.0.0.1:" + state.servers.refused + "/x?case=constructs");
      ws.onerror = () => {};
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
      connect: attempt(retained.WebSocketModule, module => module.connect("ws://127.0.0.1:1/", null, {headers: {}}, 9501)),
      send: attempt(retained.WebSocketModule, module => module.send("late", 9501)),
      sendBinary: attempt(retained.WebSocketModule, module => module.sendBinary("AQID", 9501)),
      ping: attempt(retained.WebSocketModule, module => module.ping(9501)),
      close: attempt(retained.WebSocketModule, module => module.close(1000, "", 9501)),
      addHandler: attempt(retained.BlobModule, module => module.addWebSocketHandler(9501)),
      removeHandler: attempt(retained.BlobModule, module => module.removeWebSocketHandler(9501)),
      sendOverSocket: attempt(retained.BlobModule, module => module.sendOverSocket({blobId: "x", offset: 0, size: 0}, 9501)),
      lookup: attempt({}, () => TurboModuleRegistry.get("WebSocketModule")),
    };
  },
  dispose() {
    disposeEnvironment();
    return {environment: environmentStats(), log: state.log.length};
  },
};
