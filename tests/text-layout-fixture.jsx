import React, {Component, useState} from "react";
import {AppRegistry, Text, View} from "react-native";
import {Button as LegacyButton} from "../src/components";

// The public Text, as an application writes it: the platform wrapper renders RN's Paragraph with
// onTextLayout and the host answers with the lines of the paragraph it measured and paints. The
// fixture records what JS observes; nothing here knows what the host measures.
let sequence = 0, log = [];
const rejections = [];
const controls = {};
const ink = "#f8fafc";

// One row per paragraph with a handler: how the oracle recomputes it from the font tables.
const specs = [
  {id: "wrap", family: "NotoSans", size: 18, lineHeight: 0, align: "left", width: 150, numberOfLines: 0,
    text: "The quick brown fox jumps over the lazy dog"},
  {id: "center", family: "NotoSans", size: 16, lineHeight: 0, align: "center", width: 200, numberOfLines: 0,
    text: "Centered lines are narrower than the box they sit in"},
  {id: "right", family: "NotoSans", size: 16, lineHeight: 0, align: "right", width: 200, numberOfLines: 0,
    text: "Right aligned lines end at the edge of the box"},
  {id: "breaks", family: "NotoSans", size: 16, lineHeight: 0, align: "left", width: 220, numberOfLines: 0,
    text: "alpha\nbeta gamma delta epsilon zeta eta theta"},
  {id: "limited", family: "NotoSans", size: 16, lineHeight: 0, align: "left", width: 150, numberOfLines: 2,
    text: "A paragraph that wants far more than two lines of a narrow box to say all it has"},
  {id: "mono", family: "JetBrainsMono", size: 16, lineHeight: 0, align: "left", width: 200, numberOfLines: 0,
    text: "Monospaced text wraps by columns and words"},
  {id: "leading", family: "NotoSans", size: 14, lineHeight: 28, align: "left", width: 140, numberOfLines: 0,
    text: "Explicit leading centres each baseline in its line box"},
  {id: "monoLeading", family: "JetBrainsMono", size: 12, lineHeight: 24, align: "center", width: 170, numberOfLines: 0,
    text: "Mono with an explicit line height wraps too"},
];

function textStyle(spec) {
  return {width: spec.width, fontFamily: spec.family, fontSize: spec.size, textAlign: spec.align, color: ink,
    ...(spec.lineHeight > 0 ? {lineHeight: spec.lineHeight} : {})};
}

function record(id, event) {
  const native = event.nativeEvent;
  log.push({sequence: ++sequence, id, keys: Object.keys(native).sort(),
    lines: native.lines.map(line => ({...line})), currentTag: event.currentTarget?.tag ?? null});
}

class Guard extends Component {
  state = {failed: false};

  static getDerivedStateFromError() {
    return {failed: true};
  }

  componentDidCatch(error) {
    rejections.push(String(error.message));
  }

  render() {
    return this.state.failed ? <View testID="guard-fallback" style={{width: 8, height: 8}} /> : this.props.children;
  }
}

// What an application passes that this Text does not implement or accept.
const attempts = {
  string: {onTextLayout: "not a function"},
  object: {onTextLayout: {}},
  press: {onPress: () => {}},
  selectable: {selectable: true},
  fit: {adjustsFontSizeToFit: true},
};

function Dynamic() {
  const [state, setState] = useState({width: 160, text: "Dynamic text that wraps over several lines", color: ink,
    numberOfLines: 0, listen: true});
  controls.dynamic = patch => setState(current => ({...current, ...patch}));
  return <Text testID="dynamic" numberOfLines={state.numberOfLines}
    onTextLayout={state.listen ? event => record("dynamic", event) : undefined}
    style={{width: state.width, fontFamily: "NotoSans", fontSize: 16, color: state.color}}>{state.text}</Text>;
}

function TextLayoutProbe() {
  const [attempt, setAttempt] = useState({count: 0, kind: null});
  controls.attempt = kind => setAttempt(current => ({count: current.count + 1, kind}));
  return <View testID="text-layout-root" style={{width: 360, padding: 8, backgroundColor: "#0b1120"}}>
    {specs.map(spec => <Text key={spec.id} testID={spec.id} numberOfLines={spec.numberOfLines}
      onTextLayout={event => record(spec.id, event)} style={textStyle(spec)}>{spec.text}</Text>)}
    <Dynamic />
    <Text testID="silent" style={{width: 150, fontFamily: "NotoSans", fontSize: 16, color: ink}}>
      No handler here, and the paragraph wraps over lines.</Text>
    <Text testID="span-outer" onTextLayout={event => record("span-outer", event)}
      style={{width: 220, fontFamily: "NotoSans", fontSize: 16, color: ink}}>
      Outer before <Text testID="span-inner" onTextLayout={event => record("span-inner", event)}
        style={{fontWeight: "bold"}}>inner span</Text> and after</Text>
    <Guard key={attempt.count}>{attempt.kind === null ? null :
      <Text testID="guarded" style={{fontSize: 16}} {...attempts[attempt.kind]}>guarded</Text>}</Guard>
  </View>;
}

// Rows whose baselines Yoga aligns. No Text here has a handler, so every measureLines call the
// host counts while this root mounts is the baseline callback.
function TextLayoutBaseline() {
  const sans = size => ({fontFamily: "NotoSans", fontSize: size, color: ink});
  const row = {backgroundColor: "#1e293b", marginTop: 8};
  return <View testID="baseline-root" style={{width: 360, padding: 8, backgroundColor: "#0b1120"}}>
    <View testID="baseline-row" style={{...row, flexDirection: "row", alignItems: "baseline"}}>
      <Text testID="baseline-small" style={sans(14)}>Small</Text>
      <Text testID="baseline-large" style={sans(28)}>Large</Text>
    </View>
    <View testID="baseline-self" style={{...row, flexDirection: "row"}}>
      <Text testID="self-large" style={{...sans(24), alignSelf: "baseline"}}>Tall</Text>
      <Text testID="self-small" style={{...sans(12), alignSelf: "baseline"}}>baseline</Text>
    </View>
    <View testID="baseline-mixed" style={{...row, flexDirection: "row", alignItems: "baseline"}}>
      <Text testID="mixed-sans" style={sans(14)}>Sans</Text>
      <Text testID="mixed-mono" style={{fontFamily: "JetBrainsMono", fontSize: 12, lineHeight: 40, color: ink}}>Mono</Text>
    </View>
  </View>;
}

// An inline Control inside Text bypasses the facade's check and fails in the host: measure and
// measureLines both report it, and the baseline callback of Yoga, a C function, is not unwound.
// The sibling View has no text, so every text call of this root belongs to the failing paragraph.
function TextLayoutFailure({listen}) {
  return <View testID="failure-row" style={{width: 240, flexDirection: "row", alignItems: "baseline"}}>
    <Text testID="failure-text" onTextLayout={listen ? event => record("failure", event) : undefined}>
      <LegacyButton text="Unsupported attachment" style={{width: 60, height: 30}} />
    </Text>
    <View testID="failure-peer" style={{width: 20, height: 20}} />
  </View>;
}

AppRegistry.registerComponent("TextLayoutProbe", () => TextLayoutProbe);
AppRegistry.registerComponent("TextLayoutBaseline", () => TextLayoutBaseline);
AppRegistry.registerComponent("TextLayoutFailure", () => TextLayoutFailure);

globalThis.TextLayoutProbe = {
  arm() {
    log = [];
    return {sequence};
  },
  snapshot() {
    return {specs, log: [...log], rejections: [...rejections]};
  },
  dynamic(patch) {
    controls.dynamic(patch);
  },
  attempt(kind) {
    controls.attempt(kind);
  },
};
