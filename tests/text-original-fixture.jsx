import React, {Component, useState} from "react";
import {AppRegistry, Pressable, Text, TouchableHighlight, View} from "react-native";

// The public Text, as an application writes it: the platform wrapper renders RN's ORIGINAL Libraries/Text/Text.js.
// This fixture only records what JS observes (press events, onTextLayout, the render errors of the rejected
// props and the registry); nothing here knows what the host paints or measures.
const ink = "#f8fafc";
const registry = require("react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry");
let sequence = 0;
const events = [], layouts = [], rejections = [], renderErrors = [], controls = {};
const payloads = new Map();
function payloadId(nativeEvent) {
  if (nativeEvent == null || typeof nativeEvent !== "object") {
    return null;
  }
  if (!payloads.has(nativeEvent)) {
    payloads.set(nativeEvent, payloads.size + 1);
  }
  return payloads.get(nativeEvent);
}
// One row per handler call: the registration RN dispatched through, the responder payload and the wall clock, from
// which the probe's and the oracle's ordering and timing judgements follow.
function record(id, type, event) {
  const native = event?.nativeEvent;
  events.push({sequence: ++sequence, id, type, at: Date.now(),
    registration: event?.dispatchConfig?.registrationName ?? null,
    target: native?.target ?? null, currentTarget: event?.currentTarget?.__nativeTag ?? null,
    pageX: native?.pageX ?? null, pageY: native?.pageY ?? null,
    locationX: native?.locationX ?? null, locationY: native?.locationY ?? null,
    touches: native?.touches?.length ?? null, changedTouches: native?.changedTouches?.length ?? null,
    timestamp: native?.timestamp ?? null, identifier: native?.identifier ?? null, payloadId: payloadId(native)});
}
const handlers = id => ({onPressIn: event => record(id, "in", event), onPressOut: event => record(id, "out", event),
  onPress: event => record(id, "press", event)});
const box = (left, top, width, height, backgroundColor) =>
  ({position: "absolute", left, top, width, height, backgroundColor, color: ink, fontFamily: "NotoSans", fontSize: 16});

// Every case sits in its own boundary, so an SDK that rejects one of them at render (the preceding SDK rejects every
// press) still mounts the others and reports which case failed and why.
class Case extends Component {
  state = {failed: false};

  static getDerivedStateFromError() {
    return {failed: true};
  }

  componentDidCatch(error) {
    renderErrors.push({case: this.props.name, message: String(error.message)});
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// The press targets are paragraphs of the public Text. Each is a case of its own in the oracle.
function TextOriginalPress() {
  return <View testID="press-root" style={{flex: 1, backgroundColor: "#0f172a"}}>
    <Case name="tap"><Text testID="tap" {...handlers("tap")} style={box(16, 16, 150, 48, "#7c2d12")}>Tap this paragraph</Text></Case>
    <Case name="long"><Text testID="long" {...handlers("long")} onLongPress={event => record("long", "long", event)}
      style={box(200, 16, 150, 48, "#0f766e")}>Hold this paragraph</Text></Case>
    <Case name="retention"><Text testID="retention" {...handlers("retention")}
      pressRetentionOffset={{top: 10, left: 14, bottom: 10, right: 14}} style={box(56, 96, 100, 32, "#a16207")}>Retain</Text></Case>
    <Case name="disabled"><Text testID="disabled" disabled {...handlers("disabled")}
      style={box(200, 96, 150, 48, "#64748b")}>Disabled</Text></Case>
    <Case name="span"><Text testID="span" {...handlers("span")} style={box(16, 160, 280, 48, "#1e293b")}><Text
      style={{fontWeight: "bold", color: "#fbbf24"}}>Bold span</Text> then the rest of the paragraph</Text></Case>
    <Case name="inert"><Text testID="inert" allowFontScaling={false} maxFontSizeMultiplier={1.2} dynamicTypeRamp="body"
      suppressHighlighting {...handlers("inert")} style={box(16, 224, 280, 48, "#365314")}>Inert props leave the press alone</Text></Case>
    <Case name="responder"><Text testID="responder" onStartShouldSetResponder={() => true}
      onResponderGrant={event => record("responder", "grant", event)}
      onResponderRelease={event => record("responder", "release", event)}
      style={box(16, 288, 150, 48, "#581c87")}>Responder</Text></Case>
    <Case name="plain"><Text testID="plain" style={box(200, 288, 150, 48, "#0e7490")}>No handlers</Text></Case>
    <Case name="sentinel"><Pressable testID="sentinel" onPressIn={event => record("sentinel", "in", event)}
      onPressOut={event => record("sentinel", "out", event)} onPress={event => record("sentinel", "press", event)}
      style={{position: "absolute", left: 16, top: 352, width: 150, height: 48, backgroundColor: "#0369a1"}} /></Case>
  </View>;
}

const layoutHandler = id => event => layouts.push({id, text: event.nativeEvent.lines.map(line => line.text).join(""),
  lines: event.nativeEvent.lines.length});
const narrow = {width: 150, color: ink, fontFamily: "NotoSans", fontSize: 16};
// The paragraphs whose style the host paints. Their expected runs are the oracle's, not the fixture's.
function TextOriginalStatic() {
  const sans = size => ({width: 320, color: ink, fontFamily: "NotoSans", fontSize: size});
  return <View testID="static-root" style={{width: 360, padding: 8, backgroundColor: "#0b1120"}}>
    <Case name="s-default"><Text testID="s-default" style={{width: 320, color: ink, fontFamily: "NotoSans"}}>Default size paragraph</Text></Case>
    <Case name="s-18"><Text testID="s-18" style={sans(18)}>Default size paragraph</Text></Case>
    <Case name="s-14"><Text testID="s-14" style={sans(14)}>Default size paragraph</Text></Case>
    <Case name="s-mono"><Text testID="s-mono" style={{width: 320, color: ink, fontFamily: "JetBrainsMono", fontSize: 16}}>Monospaced paragraph</Text></Case>
    <Case name="s-bold"><Text testID="s-bold" style={{...sans(16), fontWeight: "bold"}}>Bold paragraph</Text></Case>
    <Case name="s-600"><Text testID="s-600" style={{...sans(16), fontWeight: 600}}>Semibold paragraph</Text></Case>
    <Case name="s-lh"><Text testID="s-lh" style={{width: 140, color: ink, fontFamily: "NotoSans", fontSize: 16, lineHeight: 30}}>
      Explicit leading over several lines</Text></Case>
    <Case name="s-ls"><Text testID="s-ls" style={{...sans(16), letterSpacing: 3}}>Spaced letters</Text></Case>
    <Case name="s-nols"><Text testID="s-nols" style={sans(16)}>Spaced letters</Text></Case>
    <Case name="s-center"><Text testID="s-center" style={{...sans(16), width: 200, textAlign: "center"}}>Centered</Text></Case>
    <Case name="s-right"><Text testID="s-right" style={{...sans(16), width: 200, textAlign: "right"}}>Right</Text></Case>
    <Case name="s-color"><Text testID="s-color" style={{...sans(16), color: "#38bdf8"}}>Colored paragraph</Text></Case>
    <Case name="s-spans"><Text testID="s-spans" style={{width: 320, color: ink, fontFamily: "NotoSans", fontSize: 20}}>base <Text
      style={{fontWeight: "bold"}}>bold<Text style={{color: "#f59e0b"}}> amber</Text></Text> <Text style={{fontSize: 28}}>big</Text> tail</Text></Case>
    <Case name="s-inherit"><Text testID="s-inherit" style={{width: 320, color: ink}}>plain <Text style={{fontWeight: "bold"}}>bold</Text> <Text
      style={{fontSize: 30}}>big</Text> end</Text></Case>
    <Case name="s-layout"><Text testID="s-layout" onTextLayout={layoutHandler("s-layout")} style={narrow}>
      The text layout still reaches JS through the original Text</Text></Case>
    <Case name="s-span-layout"><Text testID="s-span-layout" onTextLayout={layoutHandler("s-span-layout")} style={narrow}>Outer <Text
      onTextLayout={layoutHandler("s-span-inner")} style={{fontWeight: "bold"}}>inner</Text></Text></Case>
    <Case name="s-accepted"><Text testID="s-accepted" allowFontScaling={false} maxFontSizeMultiplier={1.2} dynamicTypeRamp="body"
      suppressHighlighting style={sans(18)}>Default size paragraph</Text></Case>
    <Case name="s-lines"><Text testID="s-lines" numberOfLines={2} style={narrow}>
      A paragraph that wants far more than two lines of a narrow box to say all it has</Text></Case>
    <Case name="s-clip"><Text testID="s-clip" numberOfLines={1} ellipsizeMode="clip" style={narrow}>
      A paragraph that wants far more than one line of a narrow box</Text></Case>
  </View>;
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

// What an application passes that this Text does not implement or accept. Each renders in its own boundary.
const attempts = {
  "span-press": () => <Text>a <Text onPress={() => {}}>span</Text></Text>,
  "span-press-in": () => <Text>a <Text onPressIn={() => {}}>span</Text></Text>,
  "span-press-out": () => <Text>a <Text onPressOut={() => {}}>span</Text></Text>,
  "span-long-press": () => <Text>a <Text onLongPress={() => {}}>span</Text></Text>,
  "span-responder": () => <Text>a <Text onResponderGrant={() => {}}>span</Text></Text>,
  "span-start": () => <Text>a <Text onStartShouldSetResponder={() => true}>span</Text></Text>,
  selectable: () => <Text selectable>guarded</Text>,
  fit: () => <Text adjustsFontSizeToFit>guarded</Text>,
  head: () => <Text ellipsizeMode="head" numberOfLines={1}>guarded</Text>,
  middle: () => <Text ellipsizeMode="middle" numberOfLines={1}>guarded</Text>,
  bogus: () => <Text ellipsizeMode="wrap">guarded</Text>,
  "selection-color": () => <Text selectionColor="#38bdf8">guarded</Text>,
  detector: () => <Text dataDetectorType="link">guarded</Text>,
  "break-strategy": () => <Text textBreakStrategy="simple">guarded</Text>,
  "line-break-ios": () => <Text lineBreakStrategyIOS="standard">guarded</Text>,
  hyphenation: () => <Text android_hyphenationFrequency="full">guarded</Text>,
  "text-prop": () => <Text text="guarded" />,
  "font-size-prop": () => <Text fontSize={20}>guarded</Text>,
  "font-style": () => <Text style={{fontStyle: "italic"}}>guarded</Text>,
  decoration: () => <Text style={{textDecorationLine: "underline"}}>guarded</Text>,
  "lines-negative": () => <Text numberOfLines={-1}>guarded</Text>,
  "lines-fraction": () => <Text numberOfLines={1.5}>guarded</Text>,
  "lines-span": () => <Text>a <Text numberOfLines={1}>span</Text></Text>,
  "layout-string": () => <Text onTextLayout="not a function">guarded</Text>,
  "inline-view": () => <Text>a <View style={{width: 10, height: 10}} /></Text>,
  "inline-pressable": () => <Text>a <Pressable style={{width: 10, height: 10}} /></Text>,
  "inline-touchable": () => <Text>a <TouchableHighlight onPress={() => {}}><View style={{width: 10, height: 10}} /></TouchableHighlight></Text>,
};

function TextOriginalAttempt() {
  const [attempt, setAttempt] = useState({count: 0, kind: null});
  controls.attempt = kind => setAttempt(current => ({count: current.count + 1, kind}));
  return <View testID="attempt-root" style={{width: 360, padding: 8, backgroundColor: "#0b1120"}}>
    <Guard key={attempt.count}>{attempt.kind === null ? null : attempts[attempt.kind]()}</Guard>
  </View>;
}

// NativeText imported directly bypasses the wrapper, so only the host stands between a prop it cannot honor and
// a silent substitute. Required lazily: an SDK that still registers RCTText itself fails here, at render, and
// the case reports the registry's error instead of stopping the whole fixture at import.
const bypassProps = {
  fit: {adjustsFontSizeToFit: true},
  head: {ellipsizeMode: "head", numberOfLines: 1},
  middle: {ellipsizeMode: "middle", numberOfLines: 1},
};
function Bypass({kind}) {
  const {NativeText} = require("react-native/Libraries/Text/TextNativeComponent");
  return <NativeText testID="bypass" {...bypassProps[kind]} style={{width: 150, fontSize: 16, color: ink}}>
    A paragraph that wants more than one line</NativeText>;
}
function TextOriginalBypass({kind}) {
  return <View testID="bypass-root" style={{width: 200, padding: 8, backgroundColor: "#0b1120"}}>
    <Case name={"bypass-" + kind}><Bypass kind={kind} /></Case>
  </View>;
}

AppRegistry.registerComponent("TextOriginalPress", () => TextOriginalPress);
AppRegistry.registerComponent("TextOriginalStatic", () => TextOriginalStatic);
AppRegistry.registerComponent("TextOriginalAttempt", () => TextOriginalAttempt);
AppRegistry.registerComponent("TextOriginalBypass", () => TextOriginalBypass);

// What the registry holds for the two host components Text.js renders, and whether a second registration of each
// name is refused (it is, exactly when one is already registered).
function describe(name) {
  const config = registry.get(name);
  return {name, uiViewClassName: config.uiViewClassName, onTextLayout: config.validAttributes.onTextLayout === true,
    isPressable: config.validAttributes.isPressable === true, styleNames: Object.keys(config.validAttributes.style ?? {}).sort(),
    topTextLayout: config.directEventTypes?.topTextLayout?.registrationName ?? null};
}
function refusal(name) {
  try {
    registry.register(name, () => ({}));
  } catch (error) {
    return String(error.message);
  }
  return null;
}
// RN's own TextNativeComponent: the module whose registration is the one RCTText and RCTVirtualText, which can only
// load when nothing else registered those names first (register returns the name).
function original() {
  try {
    const module = require("react-native/Libraries/Text/TextNativeComponent");
    return {loaded: true, text: module.NativeText, virtual: module.NativeVirtualText, error: null};
  } catch (error) {
    return {loaded: false, text: null, virtual: null, error: String(error.message)};
  }
}

globalThis.TextOriginalProbe = {
  take() {
    return events.splice(0);
  },
  snapshot() {
    return {rejections: [...rejections], renderErrors: [...renderErrors], layouts: [...layouts]};
  },
  attempt(kind) {
    controls.attempt(kind);
  },
  attemptKinds() {
    return Object.keys(attempts);
  },
  registry() {
    return {text: describe("RCTText"), virtual: describe("RCTVirtualText"), secondText: refusal("RCTText"),
      secondVirtual: refusal("RCTVirtualText"), original: original()};
  },
};
