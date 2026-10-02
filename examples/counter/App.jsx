import React, { useEffect, useLayoutEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

// Optional observations for this repository's native acceptance harness.
// The application only imports React and public React Native primitives.
const observations = { count: 0, mounts: 0, cleanups: 0 };
export function counterStats() {
  return { ...observations };
}

export function CounterApp() {
  const [count, setCount] = useState(0);
  useLayoutEffect(() => { observations.count = count; }, [count]);
  useEffect(() => {
    observations.mounts++;
    return () => { observations.cleanups++; };
  }, []);

  return (
    <View testID="counter-root" style={styles.screen}>
      <View testID="counter-card" style={styles.card}>
        <Text style={styles.eyebrow}>GODOT FABRIC / FIRST EXAMPLE</Text>
        <Text style={styles.title}>A little React, inside Godot.</Text>
        <Text style={styles.description}>
          Public React Native components. State updates become native Controls.
        </Text>
        <Text testID="counter-value" style={styles.value}>{count}</Text>
        <View style={styles.row}>
          <CounterButton testID="counter-minus" label="−" disabled={count === 0}
            onPress={() => setCount(value => Math.max(0, value - 1))} />
          <CounterButton testID="counter-plus" label="+"
            onPress={() => setCount(value => value + 1)} />
        </View>
        <CounterButton testID="counter-reset" label="Reset"
          onPress={() => setCount(0)} />
        <Text style={styles.caption}>Edit this App.jsx, then rerun the example.</Text>
      </View>
    </View>
  );
}

function CounterButton({ testID, label, disabled = false, onPress }) {
  return (
    <Pressable testID={testID} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.button, { opacity: disabled ? 0.35 : pressed ? 0.72 : 1 }]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { width: "100%", height: "100%", padding: 24, alignItems: "center", justifyContent: "center", backgroundColor: "#0b1120" },
  card: { width: "100%", maxWidth: 460, padding: 28, gap: 18, backgroundColor: "#172033", borderWidth: 1, borderColor: "#334155", borderRadius: 20 },
  eyebrow: { color: "#5eead4", fontFamily: "NotoSans", fontSize: 12, fontWeight: "700" },
  title: { color: "#f8fafc", fontFamily: "NotoSans", fontSize: 28, fontWeight: "700", lineHeight: 36 },
  description: { color: "#cbd5e1", fontFamily: "NotoSans", fontSize: 15, lineHeight: 23 },
  value: { color: "#5eead4", fontFamily: "NotoSans", fontSize: 64, fontWeight: "700", lineHeight: 84, textAlign: "center" },
  row: { flexDirection: "row", gap: 12 },
  button: { flexGrow: 1, paddingVertical: 12, paddingHorizontal: 20, alignItems: "center", backgroundColor: "#2563eb", borderRadius: 10 },
  buttonText: { color: "#ffffff", fontFamily: "NotoSans", fontSize: 20, fontWeight: "700", lineHeight: 28 },
  caption: { color: "#94a3b8", fontFamily: "NotoSans", fontSize: 12, lineHeight: 18 },
});
