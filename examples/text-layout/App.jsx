import React, { useState } from "react";
import { AppRegistry, Pressable, StyleSheet, Text, View } from "react-native";

// onTextLayout through the public react-native import: the host answers with one entry per
// visible line of the paragraph it measures and paints. Each paragraph here draws what it was
// told: a translucent box at the line's x, y, width and height, and a thin rule at its baseline
// (y + ascender). The row of three texts uses alignItems: "baseline", which Yoga resolves from
// the same lines. The last line of the right column is a paragraph with onPress, onPressIn and onPressOut,
// which RN's original Text presses.
const observations = { events: {}, lines: {}, frames: {}, narrow: false, presses: 0, pressLog: [] };
globalThis.TextLayoutExample = {
  state: () => ({
    narrow: observations.narrow,
    presses: observations.presses,
    pressLog: [...observations.pressLog],
    events: { ...observations.events },
    lines: Object.fromEntries(Object.entries(observations.lines).map(([id, rows]) => [id, rows.map((row) => ({ ...row }))])),
    frames: { ...observations.frames },
  }),
};

function Measured({ id, width, numberOfLines = 0, textStyle, onLines, children }) {
  const [lines, setLines] = useState([]);
  const onTextLayout = (event) => {
    observations.events[id] = (observations.events[id] ?? 0) + 1;
    observations.lines[id] = event.nativeEvent.lines.map((line) => ({ ...line }));
    setLines(event.nativeEvent.lines);
    onLines?.(event.nativeEvent.lines);
  };
  return (
    <View testID={`${id}-box`} style={{ width }}>
      {lines.map((line, index) => (
        <React.Fragment key={index}>
          <View testID={`${id}-line-${index}`} pointerEvents="none"
            style={[styles.frame, { left: line.x, top: line.y, width: line.width, height: line.height }]} />
          <View testID={`${id}-base-${index}`} pointerEvents="none"
            style={[styles.rule, { left: line.x, top: line.y + line.ascender, width: line.width }]} />
        </React.Fragment>
      ))}
      <Text testID={id} numberOfLines={numberOfLines} onTextLayout={onTextLayout} style={textStyle}>{children}</Text>
    </View>
  );
}

const faces = [
  { id: "face-small", size: 14, family: "NotoSans", label: "Small 14" },
  { id: "face-large", size: 28, family: "NotoSans", label: "Large 28" },
  { id: "face-mono", size: 18, family: "JetBrainsMono", label: "Mono 18", lineHeight: 36 },
];

function BaselineRow() {
  const [frames, setFrames] = useState({});
  const note = (id, patch) => {
    observations.frames[id] = { ...observations.frames[id], ...patch };
    setFrames((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  };
  const first = frames[faces[0].id];
  return (
    <View testID="baseline-wrap">
      <View testID="baseline-row" style={styles.baselineRow}>
        {faces.map((face) => (
          <Text key={face.id} testID={face.id}
            onLayout={(event) => note(face.id, { y: event.nativeEvent.layout.y })}
            onTextLayout={(event) => note(face.id, { ascender: event.nativeEvent.lines[0].ascender })}
            style={{ color: "#f8fafc", fontFamily: face.family, fontSize: face.size, ...(face.lineHeight ? { lineHeight: face.lineHeight } : {}) }}>
            {face.label}
          </Text>
        ))}
      </View>
      {first?.y !== undefined && first?.ascender !== undefined ? (
        <View testID="baseline-rule" pointerEvents="none" style={[styles.rule, { left: 0, right: 0, top: first.y + first.ascender }]} />
      ) : null}
    </View>
  );
}

// A paragraph presses through RN's original Text: onPressIn, onPress and onPressOut reach React from a click on it.
function PressLine() {
  const [presses, setPresses] = useState(0);
  const [held, setHeld] = useState(false);
  const note = (type) => observations.pressLog.push(type);
  return (
    <Text testID="press-line" style={[styles.pressLine, held ? styles.pressLineHeld : null]}
      onPressIn={() => { note("in"); setHeld(true); }}
      onPressOut={() => { note("out"); setHeld(false); }}
      onPress={() => { note("press"); observations.presses += 1; setPresses((count) => count + 1); }}>
      Press this paragraph: pressed {presses} times
    </Text>
  );
}

function TextLayoutExample() {
  const [narrow, setNarrow] = useState(false);
  const [wrap, setWrap] = useState(null);
  observations.narrow = narrow;
  const width = narrow ? 200 : 300;
  const summary = wrap
    ? `wrap: ${wrap.length} lines · ascender ${wrap[0].ascender} · capHeight ${wrap[0].capHeight} · xHeight ${wrap[0].xHeight}`
    : "waiting for onTextLayout";
  return (
    <View testID="text-layout-root" style={styles.screen}>
      <View style={styles.column}>
        <Text style={styles.eyebrow}>GODOT FABRIC / TEXT LAYOUT</Text>
        <Text style={styles.title}>Every line, reported.</Text>
        <Measured id="wrap" width={width} textStyle={styles.body} onLines={setWrap}>
          The quick brown fox jumps over the lazy dog, and onTextLayout says where each line sits.
        </Measured>
        <Measured id="center" width={width} textStyle={[styles.body, { textAlign: "center" }]}>
          Centred lines start where the box leaves room.
        </Measured>
        <Measured id="limited" width={width} numberOfLines={2} textStyle={styles.body}>
          Only the visible lines are reported: this paragraph wants far more than two lines of a narrow column.
        </Measured>
        <Measured id="leading" width={width} textStyle={styles.leading}>
          An explicit lineHeight centres the baseline inside each line box.
        </Measured>
      </View>
      <View style={styles.column}>
        <Text style={styles.label}>alignItems: baseline</Text>
        <BaselineRow />
        <Text style={styles.label}>HEH and xxx sit on the baseline, as tall as capHeight and xHeight</Text>
        <Measured id="heh" width={220} textStyle={styles.heh}>HEH</Measured>
        <Measured id="xxx" width={220} textStyle={styles.heh}>xxx</Measured>
        <Pressable testID="resize" onPress={() => setNarrow((value) => !value)} style={styles.button}>
          <Text style={styles.buttonLabel}>{narrow ? "Widen the column" : "Narrow the column"}</Text>
        </Pressable>
        <Text testID="summary" style={styles.summary}>{summary}</Text>
        <PressLine />
      </View>
    </View>
  );
}
AppRegistry.registerComponent("TextLayoutExample", () => TextLayoutExample);

const styles = StyleSheet.create({
  screen: { width: "100%", height: "100%", padding: 16, flexDirection: "row", gap: 24, backgroundColor: "#0b1120" },
  column: { flexShrink: 1, gap: 12 },
  eyebrow: { color: "#5eead4", fontFamily: "NotoSans", fontSize: 12, fontWeight: "700" },
  title: { color: "#f8fafc", fontFamily: "NotoSans", fontSize: 24, fontWeight: "700", lineHeight: 32 },
  label: { color: "#94a3b8", fontFamily: "NotoSans", fontSize: 13, lineHeight: 19 },
  body: { color: "#f8fafc", fontFamily: "NotoSans", fontSize: 16 },
  leading: { color: "#f8fafc", fontFamily: "NotoSans", fontSize: 14, lineHeight: 28 },
  heh: { color: "#f8fafc", fontFamily: "NotoSans", fontSize: 48 },
  frame: { position: "absolute", backgroundColor: "rgba(56, 189, 248, 0.22)", borderWidth: 1, borderColor: "rgba(56, 189, 248, 0.6)" },
  rule: { position: "absolute", height: 1, backgroundColor: "#f97316" },
  baselineRow: { flexDirection: "row", alignItems: "baseline", gap: 12, paddingHorizontal: 8, backgroundColor: "#172033" },
  button: { alignSelf: "flex-start", paddingVertical: 10, paddingHorizontal: 16, backgroundColor: "#0f766e", borderRadius: 12 },
  buttonLabel: { color: "#f8fafc", fontFamily: "NotoSans", fontSize: 14, fontWeight: "700" },
  summary: { color: "#94a3b8", fontFamily: "NotoSans", fontSize: 13, lineHeight: 19 },
  pressLine: { alignSelf: "flex-start", paddingVertical: 8, paddingHorizontal: 12, color: "#f8fafc", backgroundColor: "#1d4ed8", fontFamily: "NotoSans", fontSize: 14 },
  pressLineHeld: { backgroundColor: "#1e3a8a" },
});
