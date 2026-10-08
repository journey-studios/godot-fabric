import React, {Component, useState} from "react";
import {AppRegistry, Text, TextInput, View} from "react-native";

// The public Text with the text styles the host paints: fontStyle italic and textDecorationLine with its color. The
// fixture only declares the styles and records what JS observes (render errors, the errors the facade throws); nothing
// here knows what the host paints or measures. tests/text-style-oracle.mjs holds the expectations for each case.
const ink = "#f8fafc";
const renderErrors = [], rejections = [], controls = {};

// Every case sits in its own boundary, so a facade that rejects one of them (the one before this slice rejects every
// style here) still mounts the others and reports which case failed and why.
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

const sans = (extra = {}) => ({width: 320, color: ink, fontFamily: "NotoSans", fontSize: 16, ...extra});
const mono = (extra = {}) => sans({fontFamily: "JetBrainsMono", ...extra});
const narrow = (extra = {}) => sans({width: 150, ...extra});
const underline = {textDecorationLine: "underline"};
const TEXT = "Styled paragraph";
const WRAP = "The quick brown fox jumps over the lazy dog again and again";

// A case that must measure the same with and without its decoration: it renders twice, decorated and as "<id>-base".
// make(on, id) returns the Text, with the decoration styles only when on.
const pairs = {
  wrap: (on, id) => <Text testID={id} style={narrow(on ? underline : {})}>{WRAP}</Text>,
  "wrap-spans": (on, id) => <Text testID={id} style={narrow()}>The quick <Text style={{fontWeight: "bold", ...(on ? underline : {})}}>
    brown fox jumps over the lazy</Text> dog</Text>,
  centered: (on, id) => <Text testID={id} style={sans({width: 200, textAlign: "center", ...(on ? underline : {})})}>Centered</Text>,
  spaced: (on, id) => <Text testID={id} style={sans({letterSpacing: 3, ...(on ? underline : {})})}>{TEXT}</Text>,
  newline: (on, id) => <Text testID={id} style={sans(on ? underline : {})}>{"line one\n"}</Text>,
  clip: (on, id) => <Text testID={id} numberOfLines={1} ellipsizeMode="clip" style={narrow(on ? underline : {})}>
    A paragraph that wants far more than one line of a narrow box</Text>,
  truncated: (on, id) => <Text testID={id} numberOfLines={1} style={narrow()}>Short <Text
    style={{color: "#ef4444", ...(on ? underline : {})}}>red tail that is far too long to fit</Text></Text>,
  "truncated-two": (on, id) => <Text testID={id} numberOfLines={2} style={narrow()}>Alpha beta gamma <Text
    style={{color: "#ef4444", ...(on ? {textDecorationLine: "underline line-through", textDecorationColor: "#22c55e"} : {})}}>delta
    epsilon zeta eta theta iota kappa lambda mu nu xi omicron</Text></Text>,
};

function TextStyleStatic() {
  return <View testID="static-root" style={{width: 360, padding: 8, backgroundColor: "#0b1120"}}>
    <Case name="base"><Text testID="base" style={sans()}>{TEXT}</Text></Case>
    <Case name="normal"><Text testID="normal" style={sans({fontStyle: "normal"})}>{TEXT}</Text></Case>
    <Case name="italic"><Text testID="italic" style={sans({fontStyle: "italic"})}>{TEXT}</Text></Case>
    <Case name="mono"><Text testID="mono" style={mono()}>{TEXT}</Text></Case>
    <Case name="italic-mono"><Text testID="italic-mono" style={mono({fontStyle: "italic"})}>{TEXT}</Text></Case>
    <Case name="bold"><Text testID="bold" style={sans({fontWeight: "bold"})}>{TEXT}</Text></Case>
    <Case name="italic-bold"><Text testID="italic-bold" style={sans({fontWeight: "bold", fontStyle: "italic"})}>{TEXT}</Text></Case>
    <Case name="italic-default"><Text testID="italic-default" style={{width: 320, color: ink, fontStyle: "italic"}}>{TEXT}</Text></Case>
    <Case name="italic-span"><Text testID="italic-span" style={sans()}>upright <Text style={{fontStyle: "italic"}}>slanted<Text
      style={{fontStyle: "normal"}}> upright again</Text></Text></Text></Case>
    <Case name="underline"><Text testID="underline" style={sans(underline)}>{TEXT}</Text></Case>
    <Case name="strike"><Text testID="strike" style={sans({textDecorationLine: "line-through"})}>{TEXT}</Text></Case>
    <Case name="both"><Text testID="both" style={sans({textDecorationLine: "underline line-through"})}>{TEXT}</Text></Case>
    <Case name="none"><Text testID="none" style={sans({textDecorationLine: "none"})}>{TEXT}</Text></Case>
    <Case name="color"><Text testID="color" style={sans({...underline, textDecorationColor: "#f97316"})}>{TEXT}</Text></Case>
    <Case name="inert"><Text testID="inert" style={sans({textDecorationColor: "#f97316", textDecorationStyle: "solid"})}>{TEXT}</Text></Case>
    <Case name="solid"><Text testID="solid" style={sans({...underline, textDecorationStyle: "solid"})}>{TEXT}</Text></Case>
    <Case name="mono-underline"><Text testID="mono-underline" style={mono(underline)}>{TEXT}</Text></Case>
    <Case name="big-underline"><Text testID="big-underline" style={sans({...underline, fontSize: 28})}>{TEXT}</Text></Case>
    <Case name="small-underline"><Text testID="small-underline" style={sans({...underline, fontSize: 12})}>{TEXT}</Text></Case>
    <Case name="spans"><Text testID="spans" style={sans()}>plain <Text style={underline}>under</Text> and <Text
      style={{textDecorationLine: "line-through", textDecorationColor: "#22c55e"}}>strike</Text> and <Text
      style={{fontStyle: "italic"}}>italic</Text> end</Text></Case>
    <Case name="adjacent"><Text testID="adjacent" style={sans()}><Text style={underline}>one<Text style={{fontWeight: "bold"}}>two</Text><Text
      style={{color: "#38bdf8"}}>three</Text></Text></Text></Case>
    <Case name="inherit"><Text testID="inherit" style={sans({...underline, textDecorationColor: "#22c55e"})}>one <Text
      style={{textDecorationLine: "none"}}>two</Text> three <Text style={{textDecorationLine: "line-through"}}>four</Text> five <Text
      style={{textDecorationColor: "#f97316"}}>six</Text> <Text style={{textDecorationLine: "underline line-through",
      textDecorationColor: "#ef4444"}}>seven</Text></Text></Case>
    <Case name="fade"><Text testID="fade" style={sans()}>plain <Text style={{opacity: 0.5, color: "#ffffff", textDecorationLine: "underline",
      textDecorationColor: "#ff0000"}}>dim</Text></Text></Case>
    <Case name="fade-default"><Text testID="fade-default" style={sans()}>plain <Text style={{opacity: 0.5, color: "#ffffff",
      textDecorationLine: "underline"}}>dim</Text></Text></Case>
    <Case name="empty"><Text testID="empty" style={sans(underline)}>{""}</Text></Case>
    {Object.entries(pairs).flatMap(([id, make]) => [
      <Case key={id} name={id}>{make(true, id)}</Case>,
      <Case key={id + "-base"} name={id + "-base"}>{make(false, id + "-base")}</Case>,
    ])}
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

// What an application passes that this Text does not implement. Each renders in its own boundary.
const attempts = {
  oblique: () => <Text style={{fontStyle: "oblique"}}>guarded</Text>,
  "font-style-bogus": () => <Text style={{fontStyle: "slanted"}}>guarded</Text>,
  "line-strikethrough": () => <Text style={{textDecorationLine: "strikethrough"}}>guarded</Text>,
  "line-underline-strikethrough": () => <Text style={{textDecorationLine: "underline-strikethrough"}}>guarded</Text>,
  "line-reversed": () => <Text style={{textDecorationLine: "line-through underline"}}>guarded</Text>,
  "line-overline": () => <Text style={{textDecorationLine: "overline"}}>guarded</Text>,
  "line-bogus": () => <Text style={{textDecorationLine: "sideways"}}>guarded</Text>,
  "style-double": () => <Text style={{textDecorationLine: "underline", textDecorationStyle: "double"}}>guarded</Text>,
  "style-dotted": () => <Text style={{textDecorationLine: "underline", textDecorationStyle: "dotted"}}>guarded</Text>,
  "style-dashed": () => <Text style={{textDecorationLine: "underline", textDecorationStyle: "dashed"}}>guarded</Text>,
  "style-wavy": () => <Text style={{textDecorationLine: "underline", textDecorationStyle: "wavy"}}>guarded</Text>,
  "style-alone": () => <Text style={{textDecorationStyle: "dotted"}}>guarded</Text>,
  "span-oblique": () => <Text>a <Text style={{fontStyle: "oblique"}}>span</Text></Text>,
  "span-dotted": () => <Text>a <Text style={{textDecorationLine: "underline", textDecorationStyle: "dotted"}}>span</Text></Text>,
  "view-italic": () => <View style={{fontStyle: "italic"}} />,
  "view-decoration": () => <View style={{textDecorationLine: "underline"}} />,
  "input-italic": () => <TextInput style={{fontStyle: "italic"}} />,
  "input-decoration": () => <TextInput style={{textDecorationLine: "underline"}} />,
};

function TextStyleAttempt() {
  const [attempt, setAttempt] = useState({count: 0, kind: null});
  controls.attempt = kind => setAttempt(current => ({count: current.count + 1, kind}));
  return <View testID="attempt-root" style={{width: 360, padding: 8, backgroundColor: "#0b1120"}}>
    <Guard key={attempt.count}>{attempt.kind === null ? null : attempts[attempt.kind]()}</Guard>
  </View>;
}

// NativeText imported directly bypasses the wrapper, so only the host stands between a style it cannot paint and a
// silent substitute. Required lazily: an SDK that fails to load it reports the error at render, in the case.
const bypassStyles = {
  oblique: {fontStyle: "oblique"},
  double: {textDecorationLine: "underline", textDecorationStyle: "double"},
  dotted: {textDecorationLine: "underline", textDecorationStyle: "dotted"},
  dashed: {textDecorationLine: "underline", textDecorationStyle: "dashed"},
  wavy: {textDecorationLine: "underline", textDecorationStyle: "wavy"},
};
function Bypass({kind}) {
  const {NativeText} = require("react-native/Libraries/Text/TextNativeComponent");
  return <NativeText testID="bypass" style={{width: 150, fontSize: 16, color: ink, ...bypassStyles[kind]}}>
    A paragraph with a style the host refuses</NativeText>;
}
function TextStyleBypass({kind}) {
  return <View testID="bypass-root" style={{width: 200, padding: 8, backgroundColor: "#0b1120"}}>
    <Case name={"bypass-" + kind}><Bypass kind={kind} /></Case>
  </View>;
}

AppRegistry.registerComponent("TextStyleStatic", () => TextStyleStatic);
AppRegistry.registerComponent("TextStyleAttempt", () => TextStyleAttempt);
AppRegistry.registerComponent("TextStyleBypass", () => TextStyleBypass);

globalThis.TextStyleProbe = {
  snapshot() {
    return {rejections: [...rejections], renderErrors: [...renderErrors]};
  },
  attempt(kind) {
    controls.attempt(kind);
  },
  attemptKinds() {
    return Object.keys(attempts);
  },
  bypassKinds() {
    return Object.keys(bypassStyles);
  },
};
