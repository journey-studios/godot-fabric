import React, {Component, useEffect, useState} from "react";
import {Animated, AppRegistry, Easing, TouchableOpacity, View, useAnimatedValue, useAnimatedValueXY} from "react-native";
import {ANIMATIONS, BOXES, COMPOSITION, INTERRUPT, TOUCHABLE} from "./native-animated-cases.mjs";

// Runs RN's original Animated, Easing, useAnimatedValue(XY) and TouchableOpacity
// through the public react-native import, with both drivers. Everything JS
// observes is recorded in order in one log, each entry stamped with Date.now()
// where it was recorded; the Godot probe reads the Controls and the host's
// counters. On a host without the native module every Animated.View fails at
// mount (RN's NativeAnimatedHelper asserts the module in its effect), so each
// view sits under its own error boundary and the JS-only cases need no view.
const EASINGS = {linear: Easing.linear, "inOut(ease)": Easing.inOut(Easing.ease), "out(cubic)": Easing.out(Easing.cubic),
  "inOut(quad)": Easing.inOut(Easing.quad)};
const log = [];
const renderErrors = [];
const registry = new Map();
const mounted = {};
const counts = {valueEvents: 0};
let sequence = 0;
function note(entry) {
  log.push({sequence: ++sequence, t: Date.now(), ...entry});
}
// An entry whose fields take time to compute is stamped before them.
function stamped(compute) {
  const t = Date.now();
  log.push({sequence: ++sequence, t, ...compute()});
}
// Counts every onAnimatedValueUpdate that reaches JS, whether or not an
// AnimatedValue listens: only JS asking the native node to report makes it send.
globalThis.__rctDeviceEventEmitter?.addListener("onAnimatedValueUpdate", () => {
  counts.valueEvents += 1;
});

class Case extends Component {
  state = {error: null};
  static getDerivedStateFromError(error) { return {error}; }
  componentDidCatch(error) {
    renderErrors.push({root: this.props.root, case: this.props.name, message: String(error?.message ?? error)});
  }
  render() { return this.state.error ? null : this.props.children; }
}

const AnimatedBox = Animated.createAnimatedComponent(View);
const COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#0ea5e9", "#6366f1", "#a855f7", "#ec4899", "#64748b",
  "#84cc16", "#f43f5e"];
const rows = Object.keys(BOXES);
function layout(id) {
  return {position: "absolute", left: 20, top: 10 + rows.indexOf(id) * 40, width: 60, height: 30, backgroundColor: COLORS[rows.indexOf(id)]};
}
// The styles an Animated.Value drives: opacity (direct, or interpolated from
// the box's ranges) with translateX and a string-output rotate.
function animatedStyle(value, map) {
  if (map.opacity === "direct") {
    return {opacity: value};
  }
  const through = outputRange => value.interpolate({inputRange: map.input, outputRange});
  return {opacity: through(map.opacity), transform: [{translateX: through(map.translateX)},
    {rotate: through(map.rotate.map(degrees => `${degrees}deg`))}]};
}

function ValueBox({root, id}) {
  const value = useAnimatedValue(0);
  const [view, setView] = useState({shown: true, renders: 0});
  registry.set(`${root}/${id}`, {value, setView});
  if (!view.shown) {
    return null;
  }
  const Component = BOXES[id].view === "created" ? AnimatedBox : Animated.View;
  return <Case root={root} name={id}>
    <Component testID={`${root}-${id}`} style={[layout(id), animatedStyle(value, BOXES[id].map)]} />
  </Case>;
}
function XYBox({root, id}) {
  const xy = useAnimatedValueXY({x: 0, y: 0});
  registry.set(`${root}/${id}`, {value: xy});
  return <Case root={root} name={id}>
    <Animated.View testID={`${root}-${id}`} style={[layout(id), {transform: xy.getTranslateTransform()}]} />
  </Case>;
}
function TouchableBox({root}) {
  const record = type => () => note({kind: "touchable", root, type});
  return <Case root={root} name="touchable">
    <TouchableOpacity testID={`${root}-touchable`} activeOpacity={TOUCHABLE.activeOpacity} onPress={record("press")}
      onPressIn={record("in")} onPressOut={record("out")}
      style={{position: "absolute", left: 20, top: 10 + rows.length * 40, width: 120, height: 44, backgroundColor: "#0369a1"}}>
      <View style={{width: 10, height: 10}} />
    </TouchableOpacity>
  </Case>;
}
// RN's Animated.Text, Image, ScrollView, FlatList and SectionList wrap RN's own
// components, not the Godot ones; each fails where it renders.
function Unsupported({root}) {
  return <>
    {["Text", "Image", "ScrollView", "FlatList", "SectionList"].map(kind => {
      const Wrapper = Animated[kind];
      return <Case key={kind} root={root} name={`animated-${kind}`}><Wrapper /></Case>;
    })}
  </>;
}
function Probe({name}) {
  useEffect(() => {
    mounted[name] = (mounted[name] ?? 0) + 1;
    return () => { mounted[name] -= 1; };
  }, [name]);
  return <View testID={`${name}-root`} pointerEvents="box-none" style={{flex: 1}}>
    {rows.map(id => BOXES[id].view === "xy" ? <XYBox key={id} root={name} id={id} /> : <ValueBox key={id} root={name} id={id} />)}
    <TouchableBox root={name} />
    <Unsupported root={name} />
  </View>;
}
AppRegistry.registerComponent("NativeAnimatedProbe", () => Probe);

function build(target, config) {
  const useNativeDriver = config.driver === "native";
  if (config.kind === "spring") {
    return Animated.spring(target, {toValue: config.to, stiffness: config.stiffness, damping: config.damping, mass: config.mass, useNativeDriver});
  }
  if (config.kind === "decay") {
    return Animated.decay(target, {velocity: config.velocity, deceleration: config.deceleration, useNativeDriver});
  }
  return Animated.timing(target, {toValue: config.to, duration: config.duration, easing: EASINGS[config.easing], useNativeDriver});
}
function observe(animation, label) {
  return {...animation, start: callback => animation.start(result => {
    note({kind: "end", label, result});
    callback?.(result);
  })};
}
// A bare value reports itself and its interpolated outputs in one entry per
// update, stamped by note() with the Date.now() the listener ran at. An
// interpolation reports only to a view, so its output is read here directly.
function reportValue(label, value, map) {
  const through = outputRange => value.interpolate({inputRange: map.input, outputRange});
  const outputs = {opacity: through(map.opacity), translateX: through(map.translateX),
    rotate: through(map.rotate.map(degrees => `${degrees}deg`))};
  value.addListener(({value: raw}) => stamped(() => ({kind: "value", label, value: raw, opacity: outputs.opacity.__getValue(),
    translateX: outputs.translateX.__getValue(), rotate: outputs.rotate.__getValue()})));
}

globalThis.NativeAnimatedProbe = {
  cases() { return {animations: ANIMATIONS, boxes: BOXES}; },
  // Whether each public export this slice adds is there, by name.
  publicApi() {
    const names = (object, list) => Object.fromEntries(list.map(name => [name, typeof object[name]]));
    return {
      Animated: names(Animated, ["timing", "spring", "decay", "sequence", "parallel", "stagger", "loop", "delay", "event", "add",
        "subtract", "multiply", "divide", "modulo", "diffClamp", "createAnimatedComponent", "forkEvent", "unforkEvent", "Value", "ValueXY",
        "Color", "View", "Text", "Image", "ScrollView", "FlatList", "SectionList"]),
      Easing: names(Easing, ["linear", "ease", "quad", "cubic", "poly", "sin", "circle", "exp", "elastic", "back", "bounce", "bezier",
        "in", "out", "inOut", "step0", "step1"]),
      hooks: {useAnimatedValue: typeof useAnimatedValue, useAnimatedValueXY: typeof useAnimatedValueXY, TouchableOpacity: typeof TouchableOpacity},
    };
  },
  mounted() { return {...mounted}; },
  renderErrors() { return [...renderErrors]; },
  counts() { return {...counts, listeners: globalThis.__rctDeviceEventEmitter?.listenerCount("onAnimatedValueUpdate") ?? null}; },
  // Everything recorded since the last call.
  take() { return log.splice(0); },

  // A JS-driver value on a bare Animated.Value: no view, so it runs on any host.
  // It starts from a frame callback: a decay started and then run by a frame
  // callback in the same millisecond would end at once, since its first step
  // is then zero (RN's DecayAnimation ends when a step is below 0.1).
  startBare(name) {
    const config = ANIMATIONS[name];
    const value = new Animated.Value(config.from);
    reportValue(name, value, config.map);
    requestAnimationFrame(() => {
      const before = Date.now();
      build(value, config).start(result => note({kind: "end", label: name, result}));
      note({kind: "start", label: name, before, after: Date.now()});
    });
  },
  // Animated.sequence, parallel, stagger and loop, each over its own values.
  startComposition() {
    const ramp = (label, duration) => {
      const value = new Animated.Value(0);
      value.addListener(({value: raw}) => note({kind: "value", label, value: raw}));
      return observe(Animated.timing(value, {toValue: 1, duration, easing: Easing.linear, useNativeDriver: false}), label);
    };
    const done = label => result => note({kind: "end", label, result});
    const before = Date.now();
    Animated.sequence(COMPOSITION.sequence.map((duration, index) => ramp(`sequence-${index}`, duration))).start(done("sequence"));
    Animated.parallel(COMPOSITION.parallel.map((duration, index) => ramp(`parallel-${index}`, duration))).start(done("parallel"));
    Animated.stagger(COMPOSITION.stagger.delay, COMPOSITION.stagger.durations.map((duration, index) => ramp(`stagger-${index}`, duration)))
      .start(done("stagger"));
    Animated.loop(ramp("loop-iteration", COMPOSITION.loop.duration), {iterations: COMPOSITION.loop.iterations}).start(done("loop"));
    return {startBefore: before, startAfter: Date.now()};
  },
  // stop() and a replacing animation on the same value: both interrupted
  // animations report finished: false.
  startInterrupt() {
    const stopped = new Animated.Value(0);
    stopped.addListener(({value}) => note({kind: "value", label: "stopped", value}));
    const long = Animated.timing(stopped, {toValue: 1, duration: INTERRUPT.longDuration, easing: Easing.linear, useNativeDriver: false});
    const before = Date.now();
    long.start(result => note({kind: "end", label: "stopped", result}));
    const replaced = new Animated.Value(0);
    replaced.addListener(({value}) => note({kind: "value", label: "replaced", value}));
    Animated.timing(replaced, {toValue: 1, duration: INTERRUPT.longDuration, easing: Easing.linear, useNativeDriver: false})
      .start(result => note({kind: "end", label: "first", result}));
    setTimeout(() => {
      long.stop();
      stopped.stopAnimation(value => note({kind: "stopAnimation", label: "stopped", value}));
      Animated.timing(replaced, {toValue: INTERRUPT.replacement.to, duration: INTERRUPT.replacement.duration, easing: Easing.linear,
        useNativeDriver: false}).start(result => note({kind: "end", label: "second", result}));
    }, INTERRUPT.stopAfter);
    return {startBefore: before, startAfter: Date.now()};
  },

  // An animation of a rendered box. The end callback is recorded with RN's own
  // result; a listener on the value is added only when asked.
  start(root, name, listen = false) {
    const config = ANIMATIONS[name];
    const entry = registry.get(`${root}/${config.box}`);
    if (listen) {
      entry.listener = entry.value.addListener(({value}) => note({kind: "listener", root, name, value}));
    }
    const before = Date.now();
    build(entry.value, config).start(result => note({kind: "end", root, label: name, result}));
    return {name, root, startBefore: before, startAfter: Date.now()};
  },
  stopAnimation(root, box) {
    registry.get(`${root}/${box}`).value.stopAnimation(value => note({kind: "stopAnimation", root, box, value}));
  },
  unlisten(root, box) {
    const entry = registry.get(`${root}/${box}`);
    entry.value.removeListener(entry.listener);
    entry.listener = null;
  },
  // React state of one box: re-render it (new interpolation nodes each time),
  // hide it or show it again.
  rerender(root, box) { registry.get(`${root}/${box}`).setView(view => ({...view, renders: view.renders + 1})); },
  setShown(root, box, shown) { registry.get(`${root}/${box}`).setView(view => ({...view, shown})); },
  // RN flushes its operation queue in a microtask. Moving that to a timer
  // models a native side that applies operations later than JS removes a view,
  // as a separate UI thread does on a device.
  deferQueueFlush(milliseconds) {
    const original = {setImmediate: globalThis.setImmediate, clearImmediate: globalThis.clearImmediate};
    globalThis.setImmediate = callback => setTimeout(callback, milliseconds);
    globalThis.clearImmediate = handle => clearTimeout(handle);
    this.restoreQueueFlush = () => {
      globalThis.setImmediate = original.setImmediate;
      globalThis.clearImmediate = original.clearImmediate;
    };
  },
  restoreQueueFlush() {},
};
