import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Animated, AppRegistry, Easing, View, Text, Pressable, findNodeHandle, useAnimatedValue } from "react-native";

const refs = new Map();
const retained = new Map();
const actions = {};
const observations = { mounts: {}, cleanups: {}, layouts: {}, events: [], commits: 0, state: {} };
const cases = [
  ["percent", "Percentage translation", "#0284c7"],
  ["absolute-origin", "Origin: 0 × 0 points", "#0f766e"],
  ["percent-origin", "Origin: 25% × 75%", "#a855f7"],
  ["scale-rotate", "Scale X, then rotate", "#e05252"],
  ["rotate-scale", "Rotate, then scale X", "#f59e0b"],
  ["mirror", "Mirrored affine matrix", "#14b8a6"],
  ["skew", "Skew X and skew Y", "#06b6d4"],
  ["flatten", "Flatten → transform → flatten", "#3b82f6"],
  ["gesture", "Rotated parent and touch space", "#22c55e"],
];
const attach = id => instance => { if (instance) refs.set(id, instance); else refs.delete(id); };
const layout = id => event => {
  const history = observations.layouts[id] ??= [];
  history.push({ ...event.nativeEvent.layout });
};
function contact(value) {
  return { target: value.target, identifier: value.identifier,
    pageX: value.pageX, pageY: value.pageY,
    screenX: value.screenX, screenY: value.screenY,
    locationX: value.locationX, locationY: value.locationY, timestamp: value.timestamp };
}
function record(type, event) {
  const native = event.nativeEvent;
  observations.events.push({ type, ...contact(native),
    touches: (native.touches ?? []).map(contact), changedTouches: (native.changedTouches ?? []).map(contact) });
}
function read(instance, parent) {
  if (!instance) return null;
  const result = { tag: findNodeHandle(instance), connected: instance.isConnected,
    rect: instance.getBoundingClientRect().toJSON(),
    offset: [instance.offsetLeft, instance.offsetTop, instance.offsetWidth, instance.offsetHeight] };
  instance.measure((...args) => { result.measure = args; });
  instance.measureInWindow((...args) => { result.window = args; });
  if (parent) instance.measureLayout(parent, (...args) => { result.relative = args; },
    () => { result.relativeFailed = true; });
  return result;
}
function transformStyle(id, phase) {
  if (phase === "reset") return {};
  if (id === "percent") return { transform: [{ translateX: "25%" }, { translateY: "-20%" }] };
  if (id === "absolute-origin") return { transformOrigin: [0, 0, 0], transform: [{ rotate: "25deg" }] };
  if (id === "percent-origin") return { transformOrigin: ["25%", "75%", 0], transform: [{ scaleX: 1.25 }, { rotate: "20deg" }] };
  if (id === "scale-rotate") return { transform: [{ scaleX: 1.5 }, { rotate: "25deg" }] };
  if (id === "rotate-scale") return { transform: [{ rotate: "25deg" }, { scaleX: 1.5 }] };
  if (id === "mirror") return { transform: [{ matrix: [-1, 0, 0, 0, 0.25, 1, 0, 0, 0, 0, 1, 0, 12, -4, 0, 1] }] };
  if (id === "skew") return { transform: [{ skewX: "18deg" }, { skewY: "-12deg" }] };
  return {};
}
function Tile({ id, color, phase }) {
  useEffect(() => {
    observations.mounts[id] = (observations.mounts[id] ?? 0) + 1;
    return () => { observations.cleanups[id] = (observations.cleanups[id] ?? 0) + 1; };
  }, [id]);
  const resized = phase === "updated" && ["percent", "percent-origin"].includes(id);
  return <View ref={attach(id)} testID={id} onLayout={layout(id)} style={{ position: "absolute", left: 70, top: 35,
    width: resized ? 100 : 80, height: resized ? 60 : 50, backgroundColor: color, ...transformStyle(id, phase) }}>
    {id === "percent-origin" && <View ref={attach("nested-child")} testID="nested-child" onLayout={layout("nested-child")}
      style={{ position: "absolute", left: 15, top: 12, width: 30, height: 20, backgroundColor: "#f8fafc",
        ...(phase === "reset" ? {} : { transform: [{ rotate: "-15deg" }] }) }} />}
  </View>;
}
function StableFlattenedChild() {
  const [count, setCount] = useState(0);
  actions.bump = () => setCount(value => value + 1);
  useEffect(() => {
    observations.mounts.flatten = (observations.mounts.flatten ?? 0) + 1;
    return () => { observations.cleanups.flatten = (observations.cleanups.flatten ?? 0) + 1; };
  }, []);
  useLayoutEffect(() => { observations.state.flattenCount = count; });
  return <View ref={attach("flatten")} testID="flatten" onLayout={layout("flatten")}
    style={{ position: "absolute", left: 25, top: 20, width: 70, height: 40, backgroundColor: "#3b82f6" }} />;
}
function GestureTile() {
  const [presses, setPresses] = useState(0);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    observations.mounts.gesture = (observations.mounts.gesture ?? 0) + 1;
    return () => { observations.cleanups.gesture = (observations.cleanups.gesture ?? 0) + 1; };
  }, []);
  useLayoutEffect(() => { observations.state.gesture = { presses, held }; });
  return <Pressable ref={attach("gesture")} testID="gesture" hitSlop={40} delayLongPress={10000}
    pressRetentionOffset={{ left: 12, top: 12, right: 12, bottom: 12 }} onLayout={layout("gesture")}
    onTouchStart={event => record("TouchStart", event)} onTouchMove={event => record("TouchMove", event)}
    onTouchEnd={event => record("TouchEnd", event)} onPressMove={event => record("PressMove", event)}
    onPressIn={event => { record("PressIn", event); setHeld(true); }}
    onPressOut={event => { record("PressOut", event); setHeld(false); }}
    onPress={event => { record("Press", event); setPresses(value => value + 1); }}
    style={({ pressed }) => ({ position: "absolute", left: 20, top: 20, width: 60, height: 50,
      backgroundColor: pressed ? "#f59e0b" : "#22c55e" })} />;
}
function TransformGallery() {
  const [phase, setPhase] = useState("initial");
  const [alive, setAlive] = useState(true);
  const initial = useRef(null);
  actions.phase = setPhase;
  actions.remove = () => setAlive(false);
  actions.clear = () => { observations.events.length = 0; };
  useEffect(() => {
    observations.mounts.gallery = (observations.mounts.gallery ?? 0) + 1;
    return () => { observations.cleanups.gallery = (observations.cleanups.gallery ?? 0) + 1; refs.clear(); };
  }, []);
  useLayoutEffect(() => {
    observations.commits++;
    observations.state.phase = phase;
    observations.state.alive = alive;
    if (!initial.current) initial.current = Object.fromEntries(refs);
  });
  return <View ref={attach("root")} testID="transform-root" pointerEvents="box-none"
    style={{ flex: 1, backgroundColor: "#0b1220" }}>
    <Text style={{ position: "absolute", left: 18, top: 14, width: 820, height: 32,
      color: "#f8fafc", fontSize: 25, fontWeight: "700" }}>Original React Native transforms · {phase}</Text>
    <View style={{ position: "absolute", left: 18, top: 52, flexDirection: "row", gap: 12 }}>
      {["initial", "updated", "reset"].map(value => <Pressable key={value} onPress={() => setPhase(value)}
        style={{ padding: 7, backgroundColor: phase === value ? "#0f766e" : "#253752" }}>
        <Text style={{ color: "#f8fafc", fontSize: 12 }}>{value === "updated" ? "Resize and unflatten" : value === "reset" ? "Remove transforms" : "Initial transforms"}</Text>
      </Pressable>)}
    </View>
    {cases.map(([id, title, color], index) => <View key={id} ref={attach(`${id}-card`)} testID={`${id}-card`}
      pointerEvents="box-none" style={{ position: "absolute", left: 18 + index % 3 * 282, top: 90 + Math.floor(index / 3) * 186,
        width: 270, height: 170, backgroundColor: "#16233b" }}>
      <Text style={{ position: "absolute", left: 12, top: 8, width: 246, height: 20,
        color: "#b5c6e0", fontSize: 12 }}>{title}</Text>
      <View ref={attach(`${id}-frame`)} testID={`${id}-frame`} pointerEvents="box-none"
        style={{ position: "absolute", left: 12, top: 34, width: 246, height: 124, backgroundColor: "#253752",
          // An explicit frame context anchors this experiment's physical parent.
          // Background and testID alone form a View and still allow child hoisting.
          ...(id === "flatten" ? { zIndex: 0 } : {}) }}>
        {id === "flatten" ? <View ref={attach("flatten-wrapper")} onLayout={layout("flatten-wrapper")}
          style={{ position: "absolute", left: 45, top: 25, width: 140, height: 85,
            ...(phase === "updated" ? { transformOrigin: [0, 0, 0], transform: [{ scaleX: 1.3 }, { rotate: "-20deg" }] } : {}) }}>
          <StableFlattenedChild />
        </View> : id === "gesture" ? <View ref={attach("gesture-parent")} testID="gesture-parent" onLayout={layout("gesture-parent")}
          pointerEvents="box-none" style={{ position: "absolute", left: 75, top: 20, width: 100, height: 90,
            backgroundColor: "#3b4f6a", ...(phase === "reset" ? {} : {
              transform: phase === "updated" ? [{ scaleX: 1.25 }, { rotate: "-20deg" }] : [{ rotate: "30deg" }] }) }}>
          {alive && <GestureTile />}
        </View> : <Tile id={id} color={color} phase={phase} />}
      </View>
    </View>)}
  </View>;
}

AppRegistry.registerComponent("TransformGallery", () => TransformGallery);
export function TransformGuardCase({ mode }) {
  const transforms = {
    singular: [{ scaleX: 0 }],
    "rank-one": [{ matrix: [1, 5, 0, 0, 5, 25, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }],
    "3d": [{ perspective: 300 }],
    "rotate-x": [{ rotateX: "30deg" }],
    "w-not-one": [{ matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 2] }],
    "range-large": [{ scaleX: 1e25 }, { scaleY: 1e25 }],
    "range-small": [{ matrix: [1e-25, 0, 0, 0, 0, 1e-25, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }],
    "range-pivot": [{ scaleX: 1e38 }, { scaleY: 1e38 }],
  };
  return <View testID="transform-guard" style={{ width: 100, height: 100,
    backgroundColor: "#0284c7", transform: transforms[mode] }} />;
}
AppRegistry.registerComponent("TransformGuardCase", () => TransformGuardCase);

// A uniform scale. RN writes `scale: n` as scale3d(n, n, n); on a planar Control
// the z factor moves nothing, so the host draws it in the plane. Each case is its
// own AppRegistry root: uniform-scale.gd mounts them in independent applications,
// so a host that rejects one cannot hide what it does with another. `width` is
// the size of the Godot Surface the case runs in and `left` centres the box in it.
const SCALE_SIZE = { width: 160, height: 100 };
const SCALE_CASES = {
  uniform: { title: "scale: 1.5", color: "#0ea5e9", width: 290, left: 65, style: { transform: [{ scale: 1.5 }] } },
  "uniform-rotate": { title: 'scale: 0.5, then rotate: "30deg"', color: "#f59e0b", width: 290, left: 65,
    style: { transform: [{ scale: 0.5 }, { rotate: "30deg" }] } },
  "uniform-origin": { title: 'scale: 1.5 about transformOrigin ["25%", "75%"]', color: "#a855f7", width: 290, left: 65,
    style: { transformOrigin: ["25%", "75%", 0], transform: [{ scale: 1.5 }] } },
  "uniform-animated": { title: "Animated scale 1 to 1.5 with useNativeDriver", color: "#22c55e", width: 440, left: 140 },
  "uniform-press": { title: "Pressable with scale: 1.2, pressed outside its layout box", color: "#ec4899", width: 440, left: 140,
    style: { transform: [{ scale: 1.2 }] } },
};
const scaleBox = mode => ({ position: "absolute", left: SCALE_CASES[mode].left, top: 140, ...SCALE_SIZE });
const scaleAnimation = { renders: 0, runs: 0, ends: [], target: 1, run: null };
const pressLog = [];
globalThis.UniformScale = {
  run: () => scaleAnimation.run(),
  state: () => ({ renders: scaleAnimation.renders, runs: scaleAnimation.runs, ends: [...scaleAnimation.ends],
    presses: pressLog.map(entry => ({ ...entry })) }),
};
// `reserve` keeps the caption clear of a button at the card's right edge.
function ScaleFrame({ mode, caption, reserve = 0, children }) {
  const { title, width } = SCALE_CASES[mode];
  return <View testID="scale-root" style={{ flex: 1, backgroundColor: "#16233b" }}>
    <Text style={{ position: "absolute", left: 16, top: 10, width: width - 32, height: 38,
      color: "#f8fafc", fontSize: 14, fontWeight: "700" }}>{title}</Text>
    <Text testID="scale-caption" style={{ position: "absolute", left: 16, top: 288, width: width - 32 - reserve, height: 20,
      color: "#b5c6e0", fontSize: 12 }}>{caption}</Text>
    {children}
    {/* The layout box without the transform: the outline the scale departs from. */}
    <View testID="scale-layout" pointerEvents="none"
      style={{ ...scaleBox(mode), borderWidth: 2, borderColor: "#e2e8f0" }} />
  </View>;
}
function StaticScaleCase({ mode }) {
  const { color, style } = SCALE_CASES[mode];
  const box = scaleBox(mode);
  return <ScaleFrame mode={mode} caption="a uniform scale on a planar Control">
    <View testID="scale-box" style={{ ...box, backgroundColor: color, ...style }} />
    {mode === "uniform-origin" && <View testID="scale-origin" pointerEvents="none" style={{ position: "absolute",
      left: box.left + 0.25 * box.width - 5, top: box.top + 0.75 * box.height - 5,
      width: 10, height: 10, borderRadius: 5, backgroundColor: "#f8fafc" }} />}
  </ScaleFrame>;
}
function AnimatedScaleCase() {
  const scale = useAnimatedValue(1);
  const [caption, setCaption] = useState("scale 1");
  scaleAnimation.renders += 1;
  scaleAnimation.run = () => {
    scaleAnimation.target = scaleAnimation.target === 1 ? 1.5 : 1;
    const toValue = scaleAnimation.target;
    scaleAnimation.runs += 1;
    Animated.timing(scale, { toValue, duration: 600, easing: Easing.inOut(Easing.cubic), useNativeDriver: true })
      .start(({ finished }) => {
        scaleAnimation.ends.push({ toValue, finished });
        setCaption(`scale ${toValue} · finished: ${finished}`);
      });
  };
  return <ScaleFrame mode="uniform-animated" caption={caption} reserve={100}>
    <Animated.View testID="scale-box" style={{ ...scaleBox("uniform-animated"),
      backgroundColor: SCALE_CASES["uniform-animated"].color, transform: [{ scale }] }} />
    <Pressable testID="scale-pop" onPress={() => scaleAnimation.run()} style={{ position: "absolute", left: 340, top: 282,
      width: 80, height: 30, alignItems: "center", justifyContent: "center", backgroundColor: "#0f766e" }}>
      <Text style={{ color: "#f8fafc", fontSize: 13 }}>Pop</Text>
    </Pressable>
  </ScaleFrame>;
}
// The Pressable itself carries the scale. Godot's hit testing and RN's responder
// system see its scaled bounds: a press left of its layout box, where only the
// scale reaches, is the Pressable's, and so is the target-local point it reports.
function PressScaleCase() {
  const { color, style } = SCALE_CASES["uniform-press"];
  const [caption, setCaption] = useState("a Pressable under a uniform scale");
  const record = type => event => {
    const { target, locationX, locationY, pageX, pageY } = event.nativeEvent;
    pressLog.push({ type, target, locationX, locationY, pageX, pageY });
    if (type === "press") {
      setCaption(`pressed at (${locationX.toFixed(1)}, ${locationY.toFixed(1)}) in its own coordinates`);
    }
  };
  return <ScaleFrame mode="uniform-press" caption={caption}>
    <Pressable testID="scale-box" onPressIn={record("in")} onPressOut={record("out")} onPress={record("press")}
      style={{ ...scaleBox("uniform-press"), backgroundColor: color, ...style }} />
  </ScaleFrame>;
}
function UniformScaleCase({ mode }) {
  if (mode === "uniform-animated") {
    return <AnimatedScaleCase />;
  }
  return mode === "uniform-press" ? <PressScaleCase /> : <StaticScaleCase mode={mode} />;
}
AppRegistry.registerComponent("UniformScaleCase", () => UniformScaleCase);
globalThis.GodotTransforms = {
  stats: () => ({ mounts: { ...observations.mounts }, cleanups: { ...observations.cleanups },
    layouts: JSON.parse(JSON.stringify(observations.layouts)), events: [...observations.events],
    commits: observations.commits, state: JSON.parse(JSON.stringify(observations.state)) }),
  action: (name, ...args) => actions[name](...args),
  read: (id, parent = "root") => read(refs.get(id), refs.get(parent)),
  retain: id => { retained.set(id, refs.get(id)); },
  identity: id => ({ same: retained.get(id) === refs.get(id), retainedTag: findNodeHandle(retained.get(id)), currentTag: findNodeHandle(refs.get(id)) }),
  stale: id => read(retained.get(id)),
};
