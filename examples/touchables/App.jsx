import React, { useState } from "react";
import {
  AppRegistry, StyleSheet, Text, TouchableHighlight, TouchableOpacity, TouchableWithoutFeedback, View,
} from "react-native";

// RN's original TouchableOpacity, TouchableHighlight and TouchableWithoutFeedback
// through the public react-native import. Pressability decides when a press
// starts and ends; what each touchable shows while pressed is RN's too: the
// opacity animates through the native driver, the highlight shows its underlay
// and dims its child, and the feedback-free one shows nothing by itself.
const events = [];
const observations = { opacity: {}, highlight: {}, feedback: {} };
globalThis.TouchablesExample = {
  state: () => ({ events: [...events], ...JSON.parse(JSON.stringify(observations)) }),
};

function usePress(name) {
  const [state, setState] = useState("idle");
  const [count, setCount] = useState(0);
  observations[name] = { state, count };
  const log = (type, update) => () => {
    events.push(`${name}:${type}`);
    update?.();
  };
  return {
    state, count,
    handlers: {
      onPressIn: log("in", () => setState("pressed")),
      onPressOut: log("out", () => setState("released")),
      onPress: log("press", () => setCount((value) => value + 1)),
    },
  };
}

function Caption({ id, press }) {
  return <Text testID={id} style={styles.caption}>{`${press.state} · ${press.count} ${press.count === 1 ? "press" : "presses"}`}</Text>;
}

function TouchablesExample() {
  const opacity = usePress("opacity");
  const highlight = usePress("highlight");
  const feedback = usePress("feedback");

  return (
    <View testID="touch-root" style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>GODOT FABRIC / TOUCHABLES</Text>
        <Text style={styles.title}>Touchables that show a press.</Text>
        <Text style={styles.description}>
          Hold the mouse on each one: RN's own touchables decide what a pressed state looks like, and what it does not.
        </Text>
        <View style={styles.row}>
          <View style={styles.tile}>
            <TouchableOpacity testID="touch-opacity" activeOpacity={0.35} {...opacity.handlers} style={styles.opacityButton}>
              <Text style={styles.buttonText}>TouchableOpacity</Text>
            </TouchableOpacity>
            <Text style={styles.tileHint}>activeOpacity 0.35, animated by the native driver</Text>
            <Caption id="touch-opacity-state" press={opacity} />
          </View>
          <View style={styles.tile}>
            <TouchableHighlight
              testID="touch-highlight" underlayColor="#f59e0b" activeOpacity={0.55} {...highlight.handlers}
              onShowUnderlay={() => events.push("highlight:show")} onHideUnderlay={() => events.push("highlight:hide")}
              style={styles.highlightButton}>
              <Text testID="touch-highlight-child" style={styles.buttonText}>TouchableHighlight</Text>
            </TouchableHighlight>
            <Text style={styles.tileHint}>underlayColor shown, the child dims to 0.55</Text>
            <Caption id="touch-highlight-state" press={highlight} />
          </View>
          <View style={styles.tile}>
            <TouchableWithoutFeedback {...feedback.handlers}>
              <View testID="touch-feedback" style={styles.feedbackBox}>
                <Text style={styles.buttonText}>TouchableWithoutFeedback</Text>
              </View>
            </TouchableWithoutFeedback>
            <Text style={styles.tileHint}>no visual feedback of its own</Text>
            <Caption id="touch-feedback-state" press={feedback} />
          </View>
        </View>
      </View>
    </View>
  );
}
AppRegistry.registerComponent("TouchablesExample", () => TouchablesExample);

const styles = StyleSheet.create({
  screen: { width: "100%", height: "100%", padding: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#0b1120" },
  card: { width: "100%", padding: 24, gap: 16, backgroundColor: "#172033", borderWidth: 1, borderColor: "#334155", borderRadius: 20 },
  eyebrow: { color: "#5eead4", fontFamily: "NotoSans", fontSize: 12, fontWeight: "700" },
  title: { color: "#f8fafc", fontFamily: "NotoSans", fontSize: 24, fontWeight: "700", lineHeight: 32 },
  description: { color: "#cbd5e1", fontFamily: "NotoSans", fontSize: 14, lineHeight: 21 },
  row: { flexDirection: "row", gap: 12 },
  tile: { flexGrow: 1, flexBasis: 0, padding: 12, gap: 8, backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#334155", borderRadius: 14 },
  opacityButton: { height: 72, alignItems: "center", justifyContent: "center", backgroundColor: "#2563eb", borderRadius: 12 },
  highlightButton: { height: 72, alignItems: "center", justifyContent: "center", backgroundColor: "#0f766e", borderRadius: 12 },
  feedbackBox: { height: 72, alignItems: "center", justifyContent: "center", backgroundColor: "#7c3aed", borderRadius: 12 },
  buttonText: { color: "#ffffff", fontFamily: "NotoSans", fontSize: 13, fontWeight: "700", lineHeight: 20, textAlign: "center" },
  tileHint: { color: "#94a3b8", fontFamily: "NotoSans", fontSize: 12, lineHeight: 18, minHeight: 36 },
  caption: { color: "#f8fafc", fontFamily: "NotoSans", fontSize: 14, fontWeight: "700", lineHeight: 20 },
});
