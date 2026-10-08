import React, { useState } from "react";
import { AppRegistry, LayoutAnimation, StyleSheet, Text, TouchableOpacity, View } from "react-native";

// RN's own LayoutAnimation through the public react-native import. configureNext arms the next commit:
// RN's C++ LayoutAnimationDriver turns that commit's mutations into frames, one per tick of the host's
// frame clock, so the tiles below move, appear and disappear without a React commit per frame. Only the
// root re-renders: when a button is pressed, and when the animation ends.
const observations = { renders: 0, requests: [], ends: [], fails: 0, label: "idle" };
globalThis.LayoutAnimationExample = {
  state: () => ({ ...observations, requests: [...observations.requests], ends: [...observations.ends] }),
};

const COLORS = { 1: "#f97316", 2: "#5eead4", 3: "#a78bfa", 4: "#facc15" };
const FIRST = [1, 2, 3];
const SECOND = [2, 3, 4];

function LayoutAnimationExample() {
  const [direction, setDirection] = useState("row");
  const [items, setItems] = useState(FIRST);
  const [label, setLabel] = useState("idle");
  observations.renders += 1;
  observations.label = label;

  // The preset is armed first and the state changes in the same turn, so the commit that follows is the
  // one RN animates; the callback is RN's onAnimationDidEnd.
  const animate = (name, preset, change) => {
    observations.requests.push(name);
    LayoutAnimation.configureNext(
      preset,
      () => {
        observations.ends.push(name);
        setLabel(`${name}: finished`);
      },
      () => {
        observations.fails += 1;
      },
    );
    change();
    setLabel(`${name}: running`);
  };
  const spring = () => animate("spring", LayoutAnimation.Presets.spring, () => setDirection((current) => (current === "row" ? "column" : "row")));
  const ease = () => animate("easeInEaseOut", LayoutAnimation.Presets.easeInEaseOut, () => setItems((current) => (current === FIRST ? SECOND : FIRST)));

  return (
    <View testID="layout-animation-root" style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>GODOT FABRIC / LAYOUTANIMATION</Text>
        <Text style={styles.title}>RN's LayoutAnimation, one Godot frame at a time.</Text>
        <View testID="layout-animation-stage" style={[styles.stage, { flexDirection: direction }]}>
          {items.map((id) => (
            <View key={id} testID={`layout-animation-tile-${id}`} style={[styles.tile, { backgroundColor: COLORS[id] }]} />
          ))}
        </View>
        <Text testID="layout-animation-status" numberOfLines={1} style={styles.status}>{label}</Text>
        <View style={styles.row}>
          <TouchableOpacity testID="layout-animation-spring" activeOpacity={0.4} onPress={spring} style={styles.button}>
            <Text style={styles.buttonText}>Spring row / column</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="layout-animation-ease" activeOpacity={0.4} onPress={ease} style={styles.button}>
            <Text style={styles.buttonText}>Ease in / out</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
AppRegistry.registerComponent("LayoutAnimationExample", () => LayoutAnimationExample);

// The tiles are 72 points with a 12 point gap inside 16 points of padding, so every layout is exact.
const styles = StyleSheet.create({
  screen: { width: "100%", height: "100%", padding: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#0b1120" },
  card: { width: "100%", padding: 24, gap: 16, backgroundColor: "#172033", borderWidth: 1, borderColor: "#334155", borderRadius: 20 },
  eyebrow: { color: "#5eead4", fontFamily: "NotoSans", fontSize: 12, fontWeight: "700" },
  title: { color: "#f8fafc", fontFamily: "NotoSans", fontSize: 24, fontWeight: "700", lineHeight: 32 },
  stage: { width: "100%", height: 292, padding: 16, gap: 12, alignItems: "flex-start", backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#334155", borderRadius: 14 },
  tile: { width: 72, height: 72, borderRadius: 12 },
  status: { height: 20, color: "#94a3b8", fontFamily: "NotoSans", fontSize: 14, lineHeight: 20 },
  row: { flexDirection: "row", gap: 12 },
  button: { flexGrow: 1, paddingVertical: 12, paddingHorizontal: 20, alignItems: "center", backgroundColor: "#2563eb", borderRadius: 10 },
  buttonText: { color: "#ffffff", fontFamily: "NotoSans", fontSize: 16, fontWeight: "700", lineHeight: 24 },
});
