import React, { useState } from "react";
import { AppRegistry, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";

// A small feedback form with the accessibility props the Godot host maps to the OS's assistive technology
// (accessibilityLabel/Hint/Role/State, aria-*, accessibilityLiveRegion, hidden, onAccessibilityTap), written the
// way RN writes them: View, Pressable and TouchableOpacity from the public react-native import. Nothing here
// names Godot; the host gives each View an accessibility element with that name, role, state and press.
const observations = { renders: 0, values: {}, taps: [] };
globalThis.AccessibilityExample = {
  state: () => ({ renders: observations.renders, taps: observations.taps.map((row) => ({ ...row })), ...observations.values }),
};

const RATINGS = [1, 2, 3];

function AccessibilityExample() {
  const [rating, setRating] = useState(0);
  const [mode, setMode] = useState("compact");
  const [sent, setSent] = useState(false);
  const status = sent ? `Thanks! You rated this ${rating} of 3` : rating === 0 ? "Choose a rating to send" : `${rating} of 3 chosen`;
  const reset = () => {
    setRating(0);
    setSent(false);
  };
  observations.renders += 1;
  observations.values = { rating, mode, sent, status };

  return (
    <View testID="a11y-root" style={styles.screen}>
      <View style={styles.card}>
        <View testID="a11y-title" accessible accessibilityRole="header" accessibilityLabel="Send feedback" style={styles.copy}>
          <Text style={styles.eyebrow}>GODOT FABRIC / ACCESSIBILITY</Text>
          <Text style={styles.title}>Send feedback</Text>
        </View>
        <Text style={styles.description}>
          Every control below is named, described and given a role, so an assistive technology can read and press it.
        </Text>
        <View testID="a11y-modes" accessibilityRole="tablist" accessibilityLabel="Layout" style={styles.row}>
          {["compact", "detailed"].map((name) => (
            <Pressable
              key={name}
              testID={`a11y-mode-${name}`}
              role="tab"
              aria-label={name === "compact" ? "Compact" : "Detailed"}
              aria-selected={mode === name}
              onPress={() => setMode(name)}
              style={[styles.tab, mode === name && styles.tabSelected]}
            >
              <Text style={styles.tabText}>{name === "compact" ? "Compact" : "Detailed"}</Text>
            </Pressable>
          ))}
        </View>
        <View testID="a11y-rating" accessibilityRole="radiogroup" accessibilityLabel="Rating" style={styles.row}>
          {RATINGS.map((value) => (
            <Pressable
              key={value}
              testID={`a11y-rating-${value}`}
              accessibilityRole="radio"
              accessibilityLabel={`${value} of 3`}
              accessibilityHint="Rates this screen"
              accessibilityState={{ checked: rating === value }}
              onPress={() => setRating(value)}
              style={[styles.choice, rating === value && styles.choiceChecked]}
            >
              <Text style={styles.choiceText}>{value}</Text>
            </Pressable>
          ))}
        </View>
        <TouchableOpacity
          testID="a11y-send"
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityHint="Sends your feedback"
          disabled={rating === 0 || sent}
          onPress={() => setSent(true)}
          style={[styles.send, (rating === 0 || sent) && styles.sendDisabled]}
        >
          <Text style={styles.sendText}>{sent ? "Sent" : "Send"}</Text>
        </TouchableOpacity>
        <Pressable
          testID="a11y-reset"
          accessibilityRole="button"
          accessibilityLabel="Start over"
          onPress={reset}
          onAccessibilityTap={() => {
            observations.taps.push({ id: "reset" });
            reset();
          }}
          style={styles.reset}
        >
          <Text style={styles.resetText}>Start over</Text>
        </Pressable>
        <View testID="a11y-status" accessibilityLiveRegion="polite" accessibilityLabel={status} style={styles.status}>
          <Text style={styles.statusText}>{status}</Text>
        </View>
        <View testID="a11y-decoration" aria-hidden style={styles.decoration}>
          <Text style={styles.decorationText}>Decorative flourish, hidden from assistive technologies</Text>
        </View>
      </View>
    </View>
  );
}
AppRegistry.registerComponent("AccessibilityExample", () => AccessibilityExample);

const styles = StyleSheet.create({
  screen: { width: "100%", height: "100%", padding: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#0b1120" },
  card: { width: "100%", padding: 24, gap: 12, backgroundColor: "#172033", borderWidth: 1, borderColor: "#334155", borderRadius: 20 },
  copy: { gap: 4 },
  eyebrow: { color: "#5eead4", fontFamily: "NotoSans", fontSize: 12, fontWeight: "700" },
  title: { color: "#f8fafc", fontFamily: "NotoSans", fontSize: 24, fontWeight: "700", lineHeight: 32 },
  description: { color: "#cbd5e1", fontFamily: "NotoSans", fontSize: 14, lineHeight: 21 },
  row: { flexDirection: "row", gap: 8 },
  tab: { flexGrow: 1, alignItems: "center", paddingVertical: 8, backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#334155", borderRadius: 10 },
  tabSelected: { backgroundColor: "#1d4ed8", borderColor: "#60a5fa" },
  tabText: { color: "#f8fafc", fontFamily: "NotoSans", fontSize: 14, fontWeight: "700", lineHeight: 20 },
  choice: { width: 56, height: 44, alignItems: "center", justifyContent: "center", backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#334155", borderRadius: 12 },
  choiceChecked: { backgroundColor: "#0f766e", borderColor: "#5eead4" },
  choiceText: { color: "#f8fafc", fontFamily: "NotoSans", fontSize: 16, fontWeight: "700", lineHeight: 22 },
  send: { alignItems: "center", paddingVertical: 12, backgroundColor: "#16a34a", borderRadius: 12 },
  sendDisabled: { backgroundColor: "#475569" },
  sendText: { color: "#f8fafc", fontFamily: "NotoSans", fontSize: 16, fontWeight: "700", lineHeight: 22 },
  reset: { alignItems: "center", paddingVertical: 8, borderWidth: 1, borderColor: "#475569", borderRadius: 12 },
  resetText: { color: "#cbd5e1", fontFamily: "NotoSans", fontSize: 14, lineHeight: 20 },
  status: { padding: 12, backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#334155", borderRadius: 12 },
  statusText: { color: "#94a3b8", fontFamily: "NotoSans", fontSize: 14, lineHeight: 20 },
  decoration: { padding: 8 },
  decorationText: { color: "#475569", fontFamily: "NotoSans", fontSize: 12, lineHeight: 18 },
});
