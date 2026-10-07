import React, { useRef, useState } from "react";
import { AppRegistry, Pressable, StyleSheet, Text, View } from "react-native";

// RN's own fetch, FormData and AbortController through the public react-native
// import, over native modules backed by Godot's HTTP client. The scene starts a
// small server on loopback and passes its address in as baseUrl; nothing else
// reaches the network.
const observations = { renders: 0, operations: [], view: null, pending: false };
globalThis.NetworkingExample = {
  state: () => ({ renders: observations.renders, operations: observations.operations.map((row) => ({ ...row })), view: observations.view, pending: observations.pending }),
};

const idle = { badge: "idle", status: "No request yet", url: "—", type: "—", body: "Press a button to ask the local server." };
const colors = { idle: "#475569", pending: "#d97706", ok: "#16a34a", failed: "#dc2626" };

function Action({ id, label, onPress }) {
  return (
    <Pressable testID={`net-${id}`} onPress={onPress} style={styles.button}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
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

function NetworkingExample({ baseUrl }) {
  const [view, setView] = useState(idle);
  const [log, setLog] = useState([]);
  const controller = useRef(null);
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
  const failure = (label, error) => {
    record(label, error.name === "AbortError" ? "aborted" : "failed");
    show("failed", `${label}: ${error.name}`, "—", "—", String(error.message));
  };
  const perform = async (label, path, init, summarize) => {
    start(label, baseUrl + path);
    try {
      const response = await fetch(baseUrl + path, init);
      const body = await summarize(response);
      record(label, String(response.status));
      show(response.ok ? "ok" : "failed", `${label}: ${response.status}`, response.url, response.headers.get("content-type") ?? "—", body);
    } catch (error) {
      failure(label, error);
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
      controller.current = new AbortController();
      return perform("GET slow", "/api/slow", { signal: controller.current.signal }, (response) => response.text());
    },
    abort: () => controller.current?.abort(),
  };

  const badge = colors[view.badge];
  return (
    <View testID="net-root" style={styles.screen}>
      <View style={styles.card}>
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
    </View>
  );
}
AppRegistry.registerComponent("NetworkingExample", () => NetworkingExample);

const styles = StyleSheet.create({
  screen: { width: "100%", height: "100%", padding: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#0b1120" },
  card: { width: "100%", padding: 22, gap: 12, backgroundColor: "#172033", borderWidth: 1, borderColor: "#334155", borderRadius: 20 },
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
  lineLabel: { width: 96, color: "#94a3b8", fontFamily: "NotoSans", fontSize: 13, lineHeight: 20 },
  lineValue: { flexShrink: 1, flexGrow: 1, flexBasis: 0, color: "#e2e8f0", fontFamily: "NotoSans", fontSize: 13, lineHeight: 20 },
  log: { color: "#94a3b8", fontFamily: "JetBrainsMono", fontSize: 12, lineHeight: 18 },
});
