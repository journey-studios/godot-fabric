import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { exerciseRuntime } from "../../tests/parity/runtime";

const observations = { status: "Ready", ticks: 0, frames: 0, mounts: 0, cleanups: 0, clockCleanups: 0, checks: [], report: null };
export function runtimeStats() {
  return { ...observations, checks: [...observations.checks] };
}

export function RuntimeApp() {
  const [status, setStatus] = useState("Ready");
  const [running, setRunning] = useState(false);
  const [ticks, setTicks] = useState(0);
  const [frames, setFrames] = useState(0);
  const [checks, setChecks] = useState([]);
  const [report, setReport] = useState(null);
  const live = useRef(true);
  const generation = useRef(0);
  const tickCount = useRef(0);
  useLayoutEffect(() => {
    Object.assign(observations, { status, ticks, frames, checks, report });
  }, [status, ticks, frames, checks, report]);
  useEffect(() => {
    observations.mounts++;
    return () => { live.current = false; observations.cleanups++; };
  }, []);
  useEffect(() => {
    if (!running) return;
    let active = true;
    let frame;
    const interval = setInterval((increment) => {
      tickCount.current += increment;
      setTicks(tickCount.current);
      if (tickCount.current >= 6) { setRunning(false); setStatus("Complete"); }
    }, 250, 1);
    const animate = () => {
      if (!active) return;
      setFrames(value => value + 1);
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => {
      active = false;
      clearInterval(interval);
      cancelAnimationFrame(frame);
      observations.clockCleanups++;
    };
  }, [running]);

  const start = () => {
    if (running) return;
    tickCount.current = 0;
    setTicks(0); setFrames(0); setChecks([]); setReport(null);
    setStatus("Running"); setRunning(true);
    const current = ++generation.current;
    const results = [];
    exerciseRuntime((id, passed) => {
      if (!passed) throw new Error(`Runtime contract failed: ${id}`);
      results.push({ id, passed });
      if (live.current && current === generation.current) setChecks([...results]);
    }).then(value => {
      if (live.current && current === generation.current) setReport(value);
    }).catch(error => {
      if (live.current && current === generation.current) {
        setRunning(false);
        setStatus(`Failed: ${error.message}`);
      }
    });
  };
  return <View testID="runtime-root" style={styles.screen}>
    <View style={styles.content}>
      <Text style={styles.eyebrow}>GODOT FABRIC / JAVASCRIPT RUNTIME</Text>
      <Text style={styles.title}>One runtime. Native UI.</Text>
      <Text style={styles.description}>Timers update React state. Fabric commits the result to Godot Controls.</Text>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.section}>INTERVAL + ANIMATION FRAME</Text>
          <Text testID="runtime-status" style={styles.status}>{status}</Text>
        </View>
        <View style={styles.row}>
          <Text testID="runtime-value" style={styles.value}>{ticks} / 6</Text>
          <Text testID="runtime-frames" style={styles.detail}>{frames} frame callbacks</Text>
        </View>
        <View testID="runtime-track" style={styles.track}>
          <View testID="runtime-progress" style={[styles.progress, { width: `${ticks / 6 * 100}%` }]} />
        </View>
        <Text style={styles.detail}>One tick every 250 ms. Pause cancels both native schedules.</Text>
      </View>
      <View style={styles.row}>
        <Action id="runtime-start" label={status === "Ready" ? "Start" : "Run again"} disabled={running} onPress={start} />
        <Action id="runtime-pause" label="Pause" disabled={!running} onPress={() => { setRunning(false); setStatus("Paused"); }} />
      </View>
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.section}>SHARED REACT NATIVE CONTRACT</Text>
          <Text testID="runtime-checks" style={styles.status}>{checks.length} / 4 passed</Text>
        </View>
        <Text style={styles.description}>Timeout arguments · interval cancellation · task order · monotonic frames</Text>
        <View testID="runtime-trace" style={styles.trace}>
          {(report?.trace || ["sync", "promise", "microtask", "immediate", "nested", "timer"]).map((name, index) =>
            <View key={name} style={[styles.chip, { opacity: report ? 1 : 0.4 }]}>
              <Text style={styles.chipText}>{index + 1}. {name}</Text>
            </View>)}
        </View>
        <Text style={styles.detail}>The same probe runs on the original RN iOS and Android reference apps.</Text>
      </View>
      <Text style={styles.caption}>Public React + React Native imports. Official Godot, without an engine fork.</Text>
    </View>
  </View>;
}
function Action({ id, label, disabled, onPress }) {
  return <Pressable testID={id} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.button, { opacity: disabled ? 0.35 : pressed ? 0.7 : 1 }]}>
    <Text style={styles.buttonText}>{label}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({
  screen: { width: "100%", height: "100%", padding: 24, backgroundColor: "#0b1120", alignItems: "center", justifyContent: "center" },
  content: { width: "100%", maxWidth: 760, gap: 16 },
  eyebrow: { color: "#5eead4", fontFamily: "NotoSans", fontSize: 12, fontWeight: "700" },
  title: { color: "#f8fafc", fontFamily: "NotoSans", fontSize: 32, fontWeight: "700", lineHeight: 42 },
  description: { color: "#cbd5e1", fontFamily: "NotoSans", fontSize: 15, lineHeight: 23 },
  card: { padding: 20, gap: 14, backgroundColor: "#172033", borderWidth: 1, borderColor: "#334155", borderRadius: 16 },
  row: { flexDirection: "row", gap: 12, alignItems: "center", justifyContent: "space-between" },
  section: { color: "#94a3b8", fontFamily: "NotoSans", fontSize: 12, fontWeight: "700" },
  status: { color: "#5eead4", fontFamily: "NotoSans", fontSize: 14, fontWeight: "700" },
  value: { color: "#5eead4", fontFamily: "NotoSans", fontSize: 40, lineHeight: 52, fontWeight: "700" },
  detail: { color: "#94a3b8", fontFamily: "NotoSans", fontSize: 12, lineHeight: 18 },
  track: { height: 10, backgroundColor: "#334155", borderRadius: 5, overflow: "hidden" },
  progress: { height: 10, backgroundColor: "#5eead4" },
  button: { flexGrow: 1, padding: 12, backgroundColor: "#2563eb", alignItems: "center", borderRadius: 10 },
  buttonText: { color: "#ffffff", fontFamily: "NotoSans", fontSize: 16, fontWeight: "700" },
  trace: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 6, paddingHorizontal: 9, backgroundColor: "#25453f", borderRadius: 6 },
  chipText: { color: "#5eead4", fontFamily: "NotoSans", fontSize: 12 },
  caption: { color: "#64748b", fontFamily: "NotoSans", fontSize: 12, lineHeight: 18 },
});
