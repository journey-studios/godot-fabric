import React, { useCallback, useEffect, useState } from "react";
import { AccessibilityInfo, AppRegistry, Pressable, StyleSheet, Text, View } from "react-native";

// RN's original AccessibilityInfo through the public react-native import. The screen asks each getter and listens to
// each event RN's iOS branch has: Godot backs the screen reader, reduce motion, reduce transparency and increase
// contrast (RN calls the last one "darker system colors"); a setting the platform does not report rejects as unknown, and
// bold text, grayscale, inverted colors and the cross-fade preference reject as unavailable, never as off.
const settings = [
  { id: "screen-reader", label: "Screen reader", read: () => AccessibilityInfo.isScreenReaderEnabled(), event: "screenReaderChanged" },
  { id: "reduce-motion", label: "Reduce motion", read: () => AccessibilityInfo.isReduceMotionEnabled(), event: "reduceMotionChanged" },
  { id: "reduce-transparency", label: "Reduce transparency", read: () => AccessibilityInfo.isReduceTransparencyEnabled(), event: "reduceTransparencyChanged" },
  { id: "increase-contrast", label: "Increase contrast", read: () => AccessibilityInfo.isDarkerSystemColorsEnabled(), event: "darkerSystemColorsChanged" },
  { id: "bold-text", label: "Bold text", read: () => AccessibilityInfo.isBoldTextEnabled(), event: "boldTextChanged" },
  { id: "grayscale", label: "Grayscale", read: () => AccessibilityInfo.isGrayscaleEnabled(), event: "grayscaleChanged" },
  { id: "invert-colors", label: "Inverted colors", read: () => AccessibilityInfo.isInvertColorsEnabled(), event: "invertColorsChanged" },
  { id: "cross-fade", label: "Cross-fade transitions", read: () => AccessibilityInfo.prefersCrossFadeTransitions(), event: null },
];
const observations = { renders: 0, refreshes: 0, values: {}, heard: [], errors: [] };
globalThis.AccessibilityInfoExample = {
  state: () => ({ ...observations, values: { ...observations.values }, heard: [...observations.heard], errors: [...observations.errors] }),
};

// The error codes the host rejects with, as words.
function describe(error) {
  const message = String(error?.message ?? error);
  if (message.startsWith("E_ACCESSIBILITY_UNKNOWN")) return "unknown";
  if (message.startsWith("E_ACCESSIBILITY_UNAVAILABLE")) return "unavailable";
  return "error";
}
const words = (value) => (value ? "on" : "off");

function Row({ id, label, value }) {
  return (
    <View testID={`a11y-row-${id}`} style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text testID={`a11y-value-${id}`} style={styles.rowValue}>{value ?? "…"}</Text>
    </View>
  );
}

function AccessibilityInfoExample() {
  const [values, setValues] = useState({});
  const [heard, setHeard] = useState([]);
  const [refreshes, setRefreshes] = useState(0);
  const refresh = useCallback(() => {
    for (const setting of settings) {
      setting.read().then(
        (value) => setValues((current) => ({ ...current, [setting.id]: words(value) })),
        (error) => {
          if (describe(error) === "error") observations.errors.push(String(error?.message ?? error));
          setValues((current) => ({ ...current, [setting.id]: describe(error) }));
        },
      );
    }
  }, []);
  useEffect(() => {
    refresh();
    const subscriptions = settings.filter((setting) => setting.event != null).map((setting) =>
      AccessibilityInfo.addEventListener(setting.event, (value) => {
        observations.heard.push(`${setting.event}=${value}`);
        setHeard([...observations.heard]);
        setValues((current) => ({ ...current, [setting.id]: words(value) }));
      }));
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [refresh]);
  observations.renders += 1;
  observations.refreshes = refreshes;
  observations.values = values;

  return (
    <View testID="a11y-root" style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>GODOT FABRIC / ACCESSIBILITY INFO</Text>
        <Text style={styles.title}>What the system says, and when it changes.</Text>
        <Text style={styles.description}>
          Godot reads four settings from the operating system; the rest are unavailable, never off.
        </Text>
        {settings.map((setting) => <Row key={setting.id} id={setting.id} label={setting.label} value={values[setting.id]} />)}
        <Row id="heard" label="Events heard" value={heard.length ? `${heard.length} · ${heard[heard.length - 1]}` : "none yet"} />
        <Pressable testID="a11y-refresh" style={styles.button} onPress={() => { setRefreshes((count) => count + 1); refresh(); }}>
          <Text style={styles.buttonText}>Ask again</Text>
        </Pressable>
      </View>
    </View>
  );
}
AppRegistry.registerComponent("AccessibilityInfoExample", () => AccessibilityInfoExample);

const styles = StyleSheet.create({
  screen: { width: "100%", height: "100%", padding: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#e2e8f0" },
  card: { width: "100%", padding: 20, gap: 8, borderWidth: 1, borderRadius: 20, backgroundColor: "#ffffff", borderColor: "#cbd5e1" },
  eyebrow: { fontFamily: "NotoSans", fontSize: 12, fontWeight: "700", color: "#0f766e" },
  title: { fontFamily: "NotoSans", fontSize: 22, fontWeight: "700", lineHeight: 30, color: "#0f172a" },
  description: { fontFamily: "NotoSans", fontSize: 13, lineHeight: 19, color: "#475569" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 7, paddingHorizontal: 14, borderWidth: 1, borderRadius: 10, backgroundColor: "#f1f5f9", borderColor: "#cbd5e1" },
  rowLabel: { fontFamily: "NotoSans", fontSize: 14, lineHeight: 20, color: "#475569" },
  rowValue: { fontFamily: "NotoSans", fontSize: 14, fontWeight: "700", lineHeight: 20, color: "#0f172a" },
  button: { marginTop: 4, paddingVertical: 10, alignItems: "center", borderRadius: 10, backgroundColor: "#2563eb" },
  buttonText: { fontFamily: "NotoSans", fontSize: 15, fontWeight: "700", lineHeight: 22, color: "#ffffff" },
});
