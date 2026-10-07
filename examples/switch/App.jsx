import React, { useState } from "react";
import { AppRegistry, StyleSheet, Switch, Text, View } from "react-native";

// RN's original Switch.js through the public react-native import: a controlled
// value, onValueChange, trackColor/thumbColor/ios_backgroundColor and disabled.
// The track and thumb are drawn by a native Godot control that toggles on a
// real mouse click or touch tap.
const observations = { renders: 0, changes: [], values: {} };
globalThis.SwitchExample = {
  state: () => ({ renders: observations.renders, changes: observations.changes.map((row) => ({ ...row })), ...observations.values }),
};

function Setting({ title, hint, children }) {
  return (
    <View style={styles.setting}>
      <View style={styles.copy}>
        <Text style={styles.settingTitle}>{title}</Text>
        <Text style={styles.settingHint}>{hint}</Text>
      </View>
      {children}
    </View>
  );
}

function SwitchExample() {
  const [sound, setSound] = useState(false);
  const [vibration, setVibration] = useState(true);
  const [status, setStatus] = useState("Nothing switched yet");
  observations.renders += 1;
  observations.values = { sound, vibration, status };

  const change = (id, setter) => (value) => {
    observations.changes.push({ id, value });
    setter(value);
    setStatus(`${id} is ${value ? "on" : "off"}`);
  };

  return (
    <View testID="switch-root" style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>GODOT FABRIC / SWITCH</Text>
        <Text style={styles.title}>Settings that answer to a click.</Text>
        <Text style={styles.description}>
          RN's own Switch.js over a native Godot switch. A click toggles it and calls onValueChange.
        </Text>
        <Setting title="Sound" hint={`Default colors · ${sound ? "on" : "off"}`}>
          <Switch testID="switch-sound" value={sound} onValueChange={change("Sound", setSound)} />
        </Setting>
        <Setting title="Vibration" hint={`Custom trackColor and thumbColor · ${vibration ? "on" : "off"}`}>
          <Switch
            testID="switch-vibration"
            value={vibration}
            onValueChange={change("Vibration", setVibration)}
            trackColor={{ false: "#475569", true: "#16a34a" }}
            thumbColor="#f8fafc"
            ios_backgroundColor="#334155"
          />
        </Setting>
        <Setting title="Beta channel" hint="Disabled · off">
          <Switch testID="switch-beta" disabled value={false} />
        </Setting>
        <Setting title="Managed by your team" hint="Disabled · on">
          <Switch testID="switch-managed" disabled value />
        </Setting>
        <Text testID="switch-status" style={styles.status}>{status}</Text>
      </View>
    </View>
  );
}
AppRegistry.registerComponent("SwitchExample", () => SwitchExample);

const styles = StyleSheet.create({
  screen: { width: "100%", height: "100%", padding: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#0b1120" },
  card: { width: "100%", padding: 24, gap: 14, backgroundColor: "#172033", borderWidth: 1, borderColor: "#334155", borderRadius: 20 },
  eyebrow: { color: "#5eead4", fontFamily: "NotoSans", fontSize: 12, fontWeight: "700" },
  title: { color: "#f8fafc", fontFamily: "NotoSans", fontSize: 24, fontWeight: "700", lineHeight: 32 },
  description: { color: "#cbd5e1", fontFamily: "NotoSans", fontSize: 14, lineHeight: 21 },
  setting: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, paddingVertical: 10, paddingHorizontal: 16, backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#334155", borderRadius: 14 },
  copy: { flexShrink: 1, gap: 2 },
  settingTitle: { color: "#f8fafc", fontFamily: "NotoSans", fontSize: 17, fontWeight: "700", lineHeight: 24 },
  settingHint: { color: "#94a3b8", fontFamily: "NotoSans", fontSize: 13, lineHeight: 19 },
  status: { color: "#94a3b8", fontFamily: "NotoSans", fontSize: 14, lineHeight: 20 },
});
