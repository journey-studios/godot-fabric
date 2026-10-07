import React, { useEffect, useState } from "react";
import { Appearance, AppRegistry, Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";

// RN's original Appearance and useColorScheme through the public react-native
// import. The effective scheme is the setColorScheme override when there is
// one, and otherwise the system's: Godot's DisplayServer reports it and calls
// back when the operating system changes it. RN sends a change only when the
// effective scheme changes.
const themes = {
  light: { page: "#e2e8f0", card: "#ffffff", border: "#cbd5e1", ink: "#0f172a", muted: "#475569", chip: "#f1f5f9", accent: "#0f766e" },
  dark: { page: "#0f172a", card: "#172033", border: "#334155", ink: "#f8fafc", muted: "#cbd5e1", chip: "#0b1120", accent: "#5eead4" },
};
const observations = { renders: 0, scheme: null, read: null, choice: "system", heard: [] };
globalThis.AppearanceExample = { state: () => ({ ...observations, heard: [...observations.heard] }) };

function Choice({ id, label, choice, theme, onChoose }) {
  const selected = choice === id;
  return (
    <Pressable testID={`appearance-${id}`} onPress={() => onChoose(id)}
      style={[styles.button, { backgroundColor: selected ? "#2563eb" : theme.chip, borderColor: selected ? "#2563eb" : theme.border }]}>
      <Text style={[styles.buttonText, { color: selected ? "#ffffff" : theme.ink }]}>{label}</Text>
    </Pressable>
  );
}

function Row({ id, label, value, theme }) {
  return (
    <View style={[styles.row, { backgroundColor: theme.chip, borderColor: theme.border }]}>
      <Text style={[styles.rowLabel, { color: theme.muted }]}>{label}</Text>
      <Text testID={id} style={[styles.rowValue, { color: theme.ink }]}>{value}</Text>
    </View>
  );
}

function AppearanceExample() {
  const scheme = useColorScheme() ?? "light";
  const [choice, setChoice] = useState("system");
  const [heard, setHeard] = useState([]);
  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      observations.heard.push(colorScheme);
      setHeard([...observations.heard]);
    });
    return () => subscription.remove();
  }, []);
  observations.renders += 1;
  observations.scheme = scheme;
  observations.read = Appearance.getColorScheme();
  observations.choice = choice;
  const theme = themes[scheme];

  const choose = (value) => {
    setChoice(value);
    Appearance.setColorScheme(value === "system" ? "unspecified" : value);
  };

  return (
    <View testID="appearance-root" style={[styles.screen, { backgroundColor: theme.page }]}>
      <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
        <Text style={[styles.eyebrow, { color: theme.accent }]}>GODOT FABRIC / APPEARANCE</Text>
        <Text style={[styles.title, { color: theme.ink }]}>Light, dark, or whatever the system says.</Text>
        <Text style={[styles.description, { color: theme.muted }]}>
          useColorScheme re-renders this screen when the effective scheme changes.
        </Text>
        <Row id="appearance-scheme" label="useColorScheme()" value={scheme} theme={theme} />
        <Row id="appearance-choice" label="Chosen by" theme={theme}
          value={choice === "system" ? "the system" : `setColorScheme("${choice}")`} />
        <Row id="appearance-heard" label="Change events heard" theme={theme}
          value={heard.length ? `${heard.length} · last ${heard[heard.length - 1]}` : "none yet"} />
        <View style={styles.buttons}>
          <Choice id="light" label="Light" choice={choice} theme={theme} onChoose={choose} />
          <Choice id="dark" label="Dark" choice={choice} theme={theme} onChoose={choose} />
          <Choice id="system" label="System" choice={choice} theme={theme} onChoose={choose} />
        </View>
      </View>
    </View>
  );
}
AppRegistry.registerComponent("AppearanceExample", () => AppearanceExample);

const styles = StyleSheet.create({
  screen: { width: "100%", height: "100%", padding: 16, alignItems: "center", justifyContent: "center" },
  card: { width: "100%", padding: 24, gap: 12, borderWidth: 1, borderRadius: 20 },
  eyebrow: { fontFamily: "NotoSans", fontSize: 12, fontWeight: "700" },
  title: { fontFamily: "NotoSans", fontSize: 24, fontWeight: "700", lineHeight: 32 },
  description: { fontFamily: "NotoSans", fontSize: 14, lineHeight: 21 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, paddingHorizontal: 16, borderWidth: 1, borderRadius: 12 },
  rowLabel: { fontFamily: "NotoSans", fontSize: 14, lineHeight: 20 },
  rowValue: { fontFamily: "NotoSans", fontSize: 15, fontWeight: "700", lineHeight: 22 },
  buttons: { flexDirection: "row", gap: 10 },
  button: { flexGrow: 1, flexBasis: 0, paddingVertical: 12, alignItems: "center", borderWidth: 1, borderRadius: 10 },
  buttonText: { fontFamily: "NotoSans", fontSize: 16, fontWeight: "700", lineHeight: 24 },
});
