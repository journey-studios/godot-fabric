import React, { useRef, useState } from "react";
import { AppRegistry, Pressable, StyleSheet, Text, View } from "react-native";

// RN's own fetch, FormData, AbortController and WebSocket through the public
// react-native import and the host's native networking modules. The scene starts
// HTTP and WebSocket echo servers on loopback, passing their addresses as baseUrl
// and socketUrl; nothing else reaches the network.
const observations = { renders: 0, operations: [], view: null, pending: false };
const socketObservations = { renders: 0, events: [], view: null, readyState: null };
globalThis.NetworkingExample = {
  state: () => ({
    renders: observations.renders, operations: observations.operations.map((row) => ({ ...row })), view: observations.view, pending: observations.pending,
    socket: { renders: socketObservations.renders, events: [...socketObservations.events], view: socketObservations.view, readyState: socketObservations.readyState },
  }),
};

const idle = { badge: "idle", status: "No request yet", url: "—", type: "—", body: "Press a button to ask the local server." };
const colors = { idle: "#475569", pending: "#d97706", ok: "#16a34a", failed: "#dc2626" };

const socketIdle = { badge: "idle", status: "No socket yet", protocol: "—", last: "Press Connect to open the echo socket." };

function Action({ id, label, onPress, prefix = "net" }) {
  return (
    <Pressable testID={`${prefix}-${id}`} onPress={onPress} style={styles.button}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

// RN's own WebSocket against the scene's echo server: a socket per Connect, text and binary messages echoed back, and the two ways
// the server ends it, a close with a code and reason and a cut connection.
function SocketCard({ socketUrl }) {
  const [view, setView] = useState(socketIdle);
  const [log, setLog] = useState([]);
  const socket = useRef(null);
  socketObservations.renders += 1;
  socketObservations.view = view;

  const record = (text) => {
    socketObservations.events.push(text);
    // The line is numbered now: two events in one batch must not both read the later count.
    const line = `${socketObservations.events.length}. ${text}`;
    setLog((rows) => [line, ...rows].slice(0, 5));
  };
  const show = (badge, status, protocol, last) => setView((current) => ({ badge, status, protocol: protocol ?? current.protocol, last: last ?? current.last }));
  const open = () => socket.current?.readyState === WebSocket.OPEN;
  const connect = () => {
    if (socket.current) {
      return;
    }
    // Two subprotocols are offered; the server chooses the one it speaks.
    const ws = new WebSocket(socketUrl, ["echo.v2", "echo.v1"]);
    ws.binaryType = "arraybuffer";
    socket.current = ws;
    socketObservations.readyState = ws.readyState;
    show("pending", "WebSocket: connecting …", "—", "Waiting for the server");
    ws.onopen = () => {
      socketObservations.readyState = ws.readyState;
      record(`open (${ws.protocol})`);
      show("ok", "WebSocket: open", ws.protocol, "Connected: send something");
    };
    ws.onmessage = (event) => {
      const echoed = typeof event.data === "string" ? event.data : `${event.data.byteLength} bytes: ${Array.from(new Uint8Array(event.data)).join(" ")}`;
      record(`echo ← ${echoed}`);
      show("ok", "WebSocket: open", undefined, echoed);
    };
    ws.onerror = () => record("error");
    ws.onclose = (event) => {
      socketObservations.readyState = ws.readyState;
      if (socket.current === ws) {
        socket.current = null;
      }
      const failed = event.code === 1006;
      record(`close ${event.code}${!failed && event.reason ? ` ${event.reason}` : ""}`);
      show(failed ? "failed" : "idle", failed ? "WebSocket: failed" : `WebSocket: closed ${event.code}`, undefined, event.reason || "No reason given");
    };
  };
  const send = (payload, label) => {
    if (open()) {
      socket.current.send(payload);
      record(`send → ${label}`);
    }
  };
  const actions = {
    connect,
    send: () => send("olá, servidor", "olá, servidor"),
    binary: () => send(Uint8Array.from([1, 2, 3, 250]), "4 bytes"),
    serverClose: () => send("!close", "!close"),
    drop: () => send("!drop", "!drop"),
    close: () => {
      if (open()) {
        socket.current.close(1000, "done");
      }
    },
  };

  return (
    <View testID="ws-card" style={styles.card}>
      <Text style={styles.eyebrow}>GODOT FABRIC / WEBSOCKET</Text>
      <Text style={styles.title}>WebSocket, straight from React Native.</Text>
      <Text style={styles.description}>RN's own WebSocket, echoed by a server on this machine.</Text>
      <View style={styles.buttons}>
        <Action prefix="ws" id="connect" label="Connect" onPress={actions.connect} />
        <Action prefix="ws" id="send" label="Send" onPress={actions.send} />
        <Action prefix="ws" id="binary" label="Binary" onPress={actions.binary} />
      </View>
      <View style={styles.buttons}>
        <Action prefix="ws" id="close" label="Close" onPress={actions.close} />
        <Action prefix="ws" id="server-close" label="Server close" onPress={actions.serverClose} />
        <Action prefix="ws" id="drop" label="Drop" onPress={actions.drop} />
      </View>
      <View style={styles.response}>
        <View testID="ws-badge" style={[styles.badge, { backgroundColor: colors[view.badge] }]}>
          <Text testID="ws-status" style={styles.badgeText}>{view.status}</Text>
        </View>
        <Line id="ws-url" label="URL" value={socketUrl} />
        <Line id="ws-protocol" label="Protocol" value={view.protocol} />
        <Line id="ws-last" label="Last" value={view.last} />
      </View>
      <Text testID="ws-log" style={styles.log}>{log.length ? log.join("\n") : "No messages yet"}</Text>
    </View>
  );
}

function Line({ id, label, value }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text testID={id} style={styles.lineValue}>{value}</Text>
    </View>
  );
}

function NetworkingExample({ baseUrl, socketUrl }) {
  const [view, setView] = useState(idle);
  const [log, setLog] = useState([]);
  const controller = useRef(null);
  // The newest request owns the screen: an answer or an error that comes back after a newer request started is
  // logged but not shown, so a late response can never replace the view of the request the user is waiting for.
  const newest = useRef(0);
  observations.renders += 1;
  observations.view = view;
  observations.pending = view.badge === "pending";

  const record = (label, outcome) => {
    observations.operations.push({ label, outcome });
    setLog((rows) => [`${observations.operations.length}. ${label} → ${outcome}`, ...rows].slice(0, 5));
  };
  const show = (badge, status, url, type, body) => setView({ badge, status, url, type, body });
  const start = (label, url) => {
    show("pending", `${label} …`, url, "—", "Waiting for the answer");
  };
  const failure = (label, error, current) => {
    record(label, error.name === "AbortError" ? "aborted" : "failed");
    if (current) {
      show("failed", `${label}: ${error.name}`, "—", "—", String(error.message));
    }
  };
  const perform = async (label, path, init, summarize) => {
    const token = ++newest.current;
    start(label, baseUrl + path);
    try {
      const response = await fetch(baseUrl + path, init);
      const body = await summarize(response);
      record(label, String(response.status));
      if (token === newest.current) {
        show(response.ok ? "ok" : "failed", `${label}: ${response.status}`, response.url, response.headers.get("content-type") ?? "—", body);
      }
    } catch (error) {
      failure(label, error, token === newest.current);
    }
  };

  const actions = {
    json: () => perform("GET JSON", "/api/profile", undefined, async (response) => {
      const data = await response.json();
      return `${data.message} · ${data.items.length} items`;
    }),
    text: () => perform("GET text", "/api/text", undefined, (response) => response.text()),
    form: () => {
      const form = new FormData();
      form.append("name", "Ana");
      form.append("note", "olá, servidor");
      return perform("POST form", "/api/echo", { method: "POST", body: form }, async (response) => {
        const data = await response.json();
        return `${data.method} · ${data.fields.join(" · ")}`;
      });
    },
    redirect: () => perform("GET redirect", "/api/redirect", undefined, async (response) => {
      const data = await response.json();
      return `${data.message} · followed one redirect`;
    }),
    slow: () => {
      // One slow request at a time: the previous one ends before the next starts, so Abort always targets the latest.
      controller.current?.abort();
      controller.current = new AbortController();
      return perform("GET slow", "/api/slow", { signal: controller.current.signal }, (response) => response.text());
    },
    abort: () => controller.current?.abort(),
  };

  const badge = colors[view.badge];
  return (
    <View testID="net-root" style={styles.screen}>
      <View style={styles.row}>
      <View testID="net-card" style={styles.card}>
        <Text style={styles.eyebrow}>GODOT FABRIC / NETWORKING</Text>
        <Text style={styles.title}>fetch, straight from React Native.</Text>
        <Text style={styles.description}>RN's own fetch and AbortController over Godot's HTTP client, against a server on this machine.</Text>
        <View style={styles.buttons}>
          <Action id="json" label="GET JSON" onPress={actions.json} />
          <Action id="text" label="GET text" onPress={actions.text} />
          <Action id="form" label="POST form" onPress={actions.form} />
        </View>
        <View style={styles.buttons}>
          <Action id="redirect" label="Redirect" onPress={actions.redirect} />
          <Action id="slow" label="Slow" onPress={actions.slow} />
          <Action id="abort" label="Abort" onPress={actions.abort} />
        </View>
        <View style={styles.response}>
          <View testID="net-badge" style={[styles.badge, { backgroundColor: badge }]}>
            <Text testID="net-status" style={styles.badgeText}>{view.status}</Text>
          </View>
          <Line id="net-url" label="URL" value={view.url} />
          <Line id="net-type" label="Content-Type" value={view.type} />
          <Line id="net-body" label="Body" value={view.body} />
        </View>
        <Text testID="net-log" style={styles.log}>{log.length ? log.join("\n") : "No requests yet"}</Text>
      </View>
      <SocketCard socketUrl={socketUrl} />
      </View>
    </View>
  );
}
AppRegistry.registerComponent("NetworkingExample", () => NetworkingExample);

const styles = StyleSheet.create({
  screen: { width: "100%", height: "100%", padding: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#0b1120" },
  row: { width: "100%", flexDirection: "row", gap: 16, alignItems: "stretch" },
  card: { flexGrow: 1, flexBasis: 0, padding: 22, gap: 12, backgroundColor: "#172033", borderWidth: 1, borderColor: "#334155", borderRadius: 20 },
  eyebrow: { color: "#5eead4", fontFamily: "NotoSans", fontSize: 12, fontWeight: "700" },
  title: { color: "#f8fafc", fontFamily: "NotoSans", fontSize: 24, fontWeight: "700", lineHeight: 32 },
  description: { color: "#cbd5e1", fontFamily: "NotoSans", fontSize: 14, lineHeight: 21 },
  buttons: { flexDirection: "row", gap: 10 },
  button: { flexGrow: 1, flexBasis: 0, paddingVertical: 11, alignItems: "center", backgroundColor: "#2563eb", borderRadius: 10 },
  buttonText: { color: "#ffffff", fontFamily: "NotoSans", fontSize: 15, fontWeight: "700", lineHeight: 22 },
  response: { gap: 8, padding: 14, backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#334155", borderRadius: 14 },
  badge: { alignSelf: "flex-start", paddingVertical: 4, paddingHorizontal: 12, borderRadius: 999 },
  badgeText: { color: "#ffffff", fontFamily: "NotoSans", fontSize: 14, fontWeight: "700", lineHeight: 20 },
  line: { flexDirection: "row", gap: 10 },
  lineLabel: { width: 84, color: "#94a3b8", fontFamily: "NotoSans", fontSize: 13, lineHeight: 20 },
  lineValue: { flexShrink: 1, flexGrow: 1, flexBasis: 0, color: "#e2e8f0", fontFamily: "NotoSans", fontSize: 13, lineHeight: 20 },
  log: { color: "#94a3b8", fontFamily: "JetBrainsMono", fontSize: 12, lineHeight: 18 },
});
