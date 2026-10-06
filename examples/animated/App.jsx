import React, { useRef, useState } from "react";
import { Animated, AppRegistry, Easing, StyleSheet, Text, TouchableOpacity, View, useAnimatedValue } from "react-native";

// RN's own Animated through the public react-native import. With
// useNativeDriver the animation runs in RN's C++ Native Animated, which Godot's
// frame tick advances; the box's opacity, translation and rotation are applied
// to its Control on every frame without a React commit. Only the status text
// below re-renders, when the animation ends.
const observations = { renders: 0, runs: 0, ends: [], label: "idle" };
globalThis.AnimatedExample = { state: () => ({ ...observations, ends: [...observations.ends] }) };

const TRAVEL = 220;
function AnimatedExample() {
  const progress = useAnimatedValue(0);
  const [label, setLabel] = useState("idle");
  const running = useRef(null);
  observations.renders += 1;
  observations.label = label;

  const run = (toValue) => {
    running.current?.stop();
    observations.runs += 1;
    setLabel(toValue === 1 ? "running to the right" : "running back");
    running.current = Animated.timing(progress, {
      toValue, duration: 1200, easing: Easing.inOut(Easing.cubic), useNativeDriver: true,
    });
    running.current.start(({ finished }) => {
      observations.ends.push({ toValue, finished });
      setLabel(`finished: ${finished}`);
    });
  };

  return (
    <View testID="animated-root" style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>GODOT FABRIC / ANIMATED</Text>
        <Text style={styles.title}>RN's Animated, one Godot frame at a time.</Text>
        <Text style={styles.description}>
          useNativeDriver runs RN's own C++ Native Animated; the box below moves without a React commit.
        </Text>
        <View style={styles.track}>
          <Animated.View testID="animated-box" style={[styles.box, {
            opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }),
            transform: [
              { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, TRAVEL] }) },
              { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "90deg"] }) },
            ],
          }]} />
        </View>
        <Text testID="animated-status" style={styles.status}>{label}</Text>
        <View style={styles.row}>
          <TouchableOpacity testID="animated-run" activeOpacity={0.4} onPress={() => run(1)} style={styles.button}>
            <Text style={styles.buttonText}>Run</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="animated-back" activeOpacity={0.4} onPress={() => run(0)} style={styles.button}>
            <Text style={styles.buttonText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
AppRegistry.registerComponent("AnimatedExample", () => AnimatedExample);

const styles = StyleSheet.create({
  screen: { width: "100%", height: "100%", padding: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#0b1120" },
  card: { width: "100%", padding: 24, gap: 16, backgroundColor: "#172033", borderWidth: 1, borderColor: "#334155", borderRadius: 20 },
  eyebrow: { color: "#5eead4", fontFamily: "NotoSans", fontSize: 12, fontWeight: "700" },
  title: { color: "#f8fafc", fontFamily: "NotoSans", fontSize: 24, fontWeight: "700", lineHeight: 32 },
  description: { color: "#cbd5e1", fontFamily: "NotoSans", fontSize: 14, lineHeight: 21 },
  track: { height: 112, padding: 16, justifyContent: "center", backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#334155", borderRadius: 14 },
  box: { width: 72, height: 40, backgroundColor: "#5eead4", borderRadius: 10 },
  status: { color: "#94a3b8", fontFamily: "NotoSans", fontSize: 14, lineHeight: 20 },
  row: { flexDirection: "row", gap: 12 },
  button: { flexGrow: 1, paddingVertical: 12, paddingHorizontal: 20, alignItems: "center", backgroundColor: "#2563eb", borderRadius: 10 },
  buttonText: { color: "#ffffff", fontFamily: "NotoSans", fontSize: 18, fontWeight: "700", lineHeight: 26 },
});
