import React, { useEffect, useState } from "react";
import { AppRegistry, Clipboard, Linking, Pressable, StyleSheet, Text, Vibration, View } from "react-native";

// RN's original Clipboard, Linking and Vibration through the public react-native
// import, over the host's device services. The scene replaces every platform
// backend with a recording stand-in, so Copy never touches the real pasteboard,
// Open URL never opens a browser and Vibrate never shakes anything. The native
// "Deep link" button beside this screen is how a platform delivers a link to the
// running application (FabricApplication.deliver_url); this screen only listens.
const SAMPLE = "Godot Fabric · clipboard sample 🚀";
const LINK = "https://example.com/godot-fabric?from=open-url";
const observations = { renders: 0, operations: [], links: [], initial: "pending", view: null };
globalThis.DeviceServicesExample = {
  state: () => ({
    renders: observations.renders, operations: observations.operations.map((row) => ({ ...row })), links: [...observations.links],
    initial: observations.initial, view: observations.view,
  }),
};

// The first line of an error's message: a host function's exception carries its stack below it.
const reason = (error) => String(error.message).split("\n")[0];

function Action({ id, label, onPress }) {
  return (
    <Pressable testID={`ds-${id}`} onPress={onPress} style={styles.button}>
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

function DeviceServicesExample() {
  const [view, setView] = useState({
    clipboard: "Nothing copied yet", pasted: "—", link: "Nothing opened yet", initial: "Reading the launch URL …",
    deepLink: "No link received yet", vibration: "Not vibrated yet",
  });
  const [log, setLog] = useState([]);
  observations.renders += 1;
  observations.view = view;

  const show = (patch) => setView((current) => ({ ...current, ...patch }));
  const record = (label, outcome) => {
    observations.operations.push({ label, outcome });
    setLog((rows) => [`${observations.operations.length}. ${label} → ${outcome}`, ...rows].slice(0, 5));
  };

  useEffect(() => {
    // The link that launched the application, once, and then every link the platform delivers while it runs.
    Linking.getInitialURL().then((url) => {
      observations.initial = url;
      show({ initial: url ?? "No launch URL" });
    }, (error) => {
      observations.initial = reason(error);
      show({ initial: `Failed: ${reason(error)}` });
    });
    const subscription = Linking.addEventListener("url", ({ url }) => {
      observations.links.push(url);
      record("Deep link", url);
      show({ deepLink: `${observations.links.length}. ${url}` });
    });
    return () => subscription.remove();
  }, []);

  const copy = () => {
    try {
      Clipboard.setString(SAMPLE);
      record("Copy", "ok");
      show({ clipboard: `Copied: ${SAMPLE}` });
    } catch (error) {
      record("Copy", "failed");
      show({ clipboard: `Copy failed: ${reason(error)}` });
    }
  };
  const paste = () => {
    Clipboard.getString().then((text) => {
      record("Paste", JSON.stringify(text));
      show({ pasted: text === "" ? "(empty)" : text });
    }, (error) => {
      record("Paste", "failed");
      show({ pasted: `Paste failed: ${reason(error)}` });
    });
  };
  const open = () => {
    Linking.openURL(LINK).then(() => {
      record("Open URL", "opened");
      show({ link: `Opened ${LINK}` });
    }, (error) => {
      record("Open URL", "failed");
      show({ link: `Failed: ${reason(error)}` });
    });
  };
  const vibrate = () => {
    Vibration.vibrate(150);
    record("Vibrate", "150 ms");
    show({ vibration: "Vibrated for 150 ms" });
  };

  return (
    <View testID="ds-root" style={styles.screen}>
      <View testID="ds-card" style={styles.card}>
        <Text style={styles.eyebrow}>GODOT FABRIC / DEVICE SERVICES</Text>
        <Text style={styles.title}>Clipboard, links and vibration.</Text>
        <Text style={styles.description}>
          RN's own Clipboard, Linking and Vibration over native device services. Here every backend is a stand-in that records what it was asked.
        </Text>
        <View style={styles.buttons}>
          <Action id="copy" label="Copy" onPress={copy} />
          <Action id="paste" label="Paste" onPress={paste} />
          <Action id="open" label="Open URL" onPress={open} />
          <Action id="vibrate" label="Vibrate" onPress={vibrate} />
        </View>
        <View style={styles.response}>
          <Line id="ds-clipboard" label="Clipboard" value={view.clipboard} />
          <Line id="ds-pasted" label="Pasted" value={view.pasted} />
          <Line id="ds-link" label="Link" value={view.link} />
          <Line id="ds-initial" label="Launch URL" value={view.initial} />
          <Line id="ds-deep-link" label="Deep link" value={view.deepLink} />
          <Line id="ds-vibration" label="Vibration" value={view.vibration} />
        </View>
        <Text testID="ds-log" style={styles.log}>{log.length ? log.join("\n") : "No operations yet"}</Text>
      </View>
    </View>
  );
}
AppRegistry.registerComponent("DeviceServicesExample", () => DeviceServicesExample);

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
  line: { flexDirection: "row", gap: 10 },
  lineLabel: { width: 92, color: "#94a3b8", fontFamily: "NotoSans", fontSize: 13, lineHeight: 20 },
  lineValue: { flexShrink: 1, flexGrow: 1, flexBasis: 0, color: "#e2e8f0", fontFamily: "NotoSans", fontSize: 13, lineHeight: 20 },
  log: { color: "#94a3b8", fontFamily: "JetBrainsMono", fontSize: 12, lineHeight: 18 },
});
