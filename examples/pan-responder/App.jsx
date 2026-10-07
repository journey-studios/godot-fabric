import React, { useRef, useState } from "react";
import { AppRegistry, PanResponder, StyleSheet, Text, View } from "react-native";

// RN's original PanResponder through the public react-native import. A box
// follows a drag by the gesture state's dx and dy, which accumulate from where
// the box was when the responder was granted; release leaves it where it is.
const TRACK = { width: 504, height: 232 };
const BOX = { width: 104, height: 64 };
const START = { x: 24, y: 24 };
const events = [];
const observations = { phase: "idle", x: START.x, y: START.y, gesture: null, renders: 0 };
globalThis.PanResponderExample = { state: () => ({ ...JSON.parse(JSON.stringify(observations)), events: [...events] }) };

const clamp = (value, max) => Math.min(Math.max(value, 0), max);
const summary = (gesture) => ({
  dx: gesture.dx, dy: gesture.dy, x0: gesture.x0, y0: gesture.y0, moveX: gesture.moveX, moveY: gesture.moveY,
  vx: gesture.vx, vy: gesture.vy, numberActiveTouches: gesture.numberActiveTouches,
});

function PanResponderExample() {
  const [view, setView] = useState({ x: START.x, y: START.y, phase: "idle", gesture: null });
  const current = useRef({ x: START.x, y: START.y });
  const origin = useRef({ x: START.x, y: START.y });
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      // The gesture state is one object that RN mutates and resets, so it is copied before any
      // updater runs.
      onPanResponderGrant: (_event, gesture) => {
        events.push("grant");
        origin.current = { ...current.current };
        const copy = summary(gesture);
        setView((state) => ({ ...state, phase: "dragging", gesture: copy }));
      },
      onPanResponderStart: () => events.push("start"),
      onPanResponderMove: (_event, gesture) => {
        events.push("move");
        current.current = {
          x: clamp(origin.current.x + gesture.dx, TRACK.width - BOX.width),
          y: clamp(origin.current.y + gesture.dy, TRACK.height - BOX.height),
        };
        setView({ ...current.current, phase: "dragging", gesture: summary(gesture) });
      },
      onPanResponderRelease: (_event, gesture) => {
        events.push("release");
        const copy = summary(gesture);
        setView((state) => ({ ...state, phase: "released", gesture: copy }));
      },
      onPanResponderTerminate: () => {
        events.push("terminate");
        setView((state) => ({ ...state, phase: "terminated" }));
      },
      onPanResponderEnd: () => events.push("end"),
    }),
  ).current;
  observations.renders += 1;
  Object.assign(observations, { phase: view.phase, x: view.x, y: view.y, gesture: view.gesture });
  const gesture = view.gesture
    ? `dx ${Math.round(view.gesture.dx)} · dy ${Math.round(view.gesture.dy)} · touches ${view.gesture.numberActiveTouches}`
    : "no gesture yet";

  return (
    <View testID="pan-root" style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>GODOT FABRIC / PANRESPONDER</Text>
        <Text style={styles.title}>A box that follows a drag.</Text>
        <Text style={styles.description}>
          RN's own PanResponder over Godot's pointer input. Press the box, drag it, and let go where you like.
        </Text>
        <View testID="pan-track" style={[styles.track, { width: TRACK.width, height: TRACK.height }]}>
          <View testID="pan-box" {...responder.panHandlers}
            style={[styles.box, { left: view.x, top: view.y, backgroundColor: view.phase === "dragging" ? "#f59e0b" : "#5eead4" }]}>
            <Text style={styles.boxText}>Drag me</Text>
          </View>
        </View>
        <View style={styles.readout}>
          <Text testID="pan-phase" style={styles.phase}>{view.phase}</Text>
          <Text testID="pan-gesture" style={styles.status}>{gesture}</Text>
          <Text testID="pan-position" style={styles.status}>{`x ${Math.round(view.x)} · y ${Math.round(view.y)}`}</Text>
        </View>
      </View>
    </View>
  );
}
AppRegistry.registerComponent("PanResponderExample", () => PanResponderExample);

const styles = StyleSheet.create({
  screen: { width: "100%", height: "100%", padding: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#0b1120" },
  card: { width: "100%", padding: 24, gap: 14, backgroundColor: "#172033", borderWidth: 1, borderColor: "#334155", borderRadius: 20 },
  eyebrow: { color: "#5eead4", fontFamily: "NotoSans", fontSize: 12, fontWeight: "700" },
  title: { color: "#f8fafc", fontFamily: "NotoSans", fontSize: 24, fontWeight: "700", lineHeight: 32 },
  description: { color: "#cbd5e1", fontFamily: "NotoSans", fontSize: 14, lineHeight: 21 },
  track: { backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#334155", borderRadius: 14 },
  box: { position: "absolute", width: BOX.width, height: BOX.height, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  boxText: { color: "#0b1120", fontFamily: "NotoSans", fontSize: 16, fontWeight: "700", lineHeight: 24 },
  readout: { flexDirection: "row", alignItems: "center", gap: 16 },
  phase: { color: "#f8fafc", fontFamily: "NotoSans", fontSize: 16, fontWeight: "700", lineHeight: 24, minWidth: 96 },
  status: { color: "#94a3b8", fontFamily: "NotoSans", fontSize: 14, lineHeight: 20 },
});
