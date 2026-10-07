import React, { useState } from "react";
import { ActivityIndicator, AppRegistry, Pressable, StyleSheet, Text, View } from "react-native";

// RN's original ActivityIndicator.js through the public react-native import:
// the small and large sizes, a numeric size, colors, animating and
// hidesWhenStopped. The spinner is a native Godot control that advances with
// real frame time while it animates.
const observations = { renders: 0, animating: true, toggles: 0 };
globalThis.ActivityIndicatorExample = { state: () => ({ ...observations }) };

function Tile({ title, caption, children }) {
  return (
    <View style={styles.tile}>
      <View style={styles.stage}>{children}</View>
      <Text style={styles.tileTitle}>{title}</Text>
      <Text style={styles.tileCaption}>{caption}</Text>
    </View>
  );
}

function ActivityIndicatorExample() {
  const [animating, setAnimating] = useState(true);
  observations.renders += 1;
  observations.animating = animating;

  const toggle = () => {
    observations.toggles += 1;
    setAnimating((value) => !value);
  };

  return (
    <View testID="spinner-root" style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>GODOT FABRIC / ACTIVITYINDICATOR</Text>
        <Text style={styles.title}>Loading states that keep time.</Text>
        <Text style={styles.description}>
          RN's own ActivityIndicator.js over a native Godot spinner that advances one step per frame while it animates.
        </Text>
        <View style={styles.grid}>
          <Tile title="Small" caption="defaults">
            <ActivityIndicator testID="spinner-small" />
          </Tile>
          <Tile title="Large" caption={'size="large" color="#38bdf8"'}>
            <ActivityIndicator testID="spinner-large" size="large" color="#38bdf8" />
          </Tile>
          <Tile title="Numeric" caption={'size={48} color="#f97316"'}>
            <ActivityIndicator testID="spinner-sized" size={48} color="#f97316" />
          </Tile>
          <Tile title="Another color" caption={'size={28} color="#a78bfa"'}>
            <ActivityIndicator testID="spinner-violet" size={28} color="#a78bfa" />
          </Tile>
          <Tile title="Hides when stopped" caption="default hidesWhenStopped">
            <ActivityIndicator testID="spinner-hides" size="large" color="#5eead4" animating={animating} />
          </Tile>
          <Tile title="Stays when stopped" caption="hidesWhenStopped={false}">
            <ActivityIndicator testID="spinner-keeps" size="large" color="#facc15" animating={animating} hidesWhenStopped={false} />
          </Tile>
        </View>
        <View style={styles.footer}>
          <Pressable testID="spinner-toggle" onPress={toggle}
            style={({ pressed }) => [styles.button, { opacity: pressed ? 0.72 : 1 }]}>
            <Text style={styles.buttonText}>{animating ? "Stop the last two" : "Start them again"}</Text>
          </Pressable>
          <Text testID="spinner-status" style={styles.status}>{animating ? "animating: true" : "animating: false"}</Text>
        </View>
      </View>
    </View>
  );
}
AppRegistry.registerComponent("ActivityIndicatorExample", () => ActivityIndicatorExample);

const styles = StyleSheet.create({
  screen: { width: "100%", height: "100%", padding: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#0b1120" },
  card: { width: "100%", padding: 24, gap: 14, backgroundColor: "#172033", borderWidth: 1, borderColor: "#334155", borderRadius: 20 },
  eyebrow: { color: "#5eead4", fontFamily: "NotoSans", fontSize: 12, fontWeight: "700" },
  title: { color: "#f8fafc", fontFamily: "NotoSans", fontSize: 24, fontWeight: "700", lineHeight: 32 },
  description: { color: "#cbd5e1", fontFamily: "NotoSans", fontSize: 14, lineHeight: 21 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: { width: 216, padding: 12, gap: 2, backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#334155", borderRadius: 14 },
  stage: { height: 68, alignItems: "center", justifyContent: "center", backgroundColor: "#111c33", borderRadius: 10, marginBottom: 8 },
  tileTitle: { color: "#f8fafc", fontFamily: "NotoSans", fontSize: 16, fontWeight: "700", lineHeight: 22 },
  tileCaption: { color: "#94a3b8", fontFamily: "NotoSans", fontSize: 12, lineHeight: 18 },
  footer: { flexDirection: "row", alignItems: "center", gap: 16 },
  button: { paddingVertical: 12, paddingHorizontal: 20, alignItems: "center", backgroundColor: "#2563eb", borderRadius: 10 },
  buttonText: { color: "#ffffff", fontFamily: "NotoSans", fontSize: 16, fontWeight: "700", lineHeight: 24 },
  status: { color: "#94a3b8", fontFamily: "NotoSans", fontSize: 14, lineHeight: 20 },
});
