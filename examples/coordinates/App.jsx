import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppRegistry, View, Text, Pressable, Dimensions, PixelRatio, findNodeHandle } from "react-native";

const panels = new Map();
const observations = { mounts: {}, cleanups: {}, roots: {} };
const retained = new Map();

function contact(value) {
  return { target: value.target, identifier: value.identifier,
    pageX: value.pageX, pageY: value.pageY,
    screenX: value.screenX, screenY: value.screenY,
    locationX: value.locationX, locationY: value.locationY,
    timestamp: value.timestamp };
}
function read(instance, parent) {
  if (!instance) return null;
  const value = { tag: findNodeHandle(instance), connected: instance.isConnected,
    rect: instance.getBoundingClientRect().toJSON() };
  instance.measure((...args) => { value.measure = args; });
  instance.measureInWindow((...args) => { value.window = args; });
  if (parent) instance.measureLayout(parent, (...args) => { value.relative = args; },
    () => { value.relativeFailed = true; });
  return value;
}

function CoordinatePanel({ rootName }) {
  const refs = useRef({ root: null, frame: null, target: null });
  const [presses, setPresses] = useState(0);
  const [held, setHeld] = useState(false);
  const [embedding, setEmbedding] = useState("Offset in the Godot window");
  const [last, setLast] = useState("Tap, move outside, then return");
  const profile = observations.roots[rootName] ??= { events: [], commits: 0, state: null };
  panels.set(rootName, { refs: refs.current, setEmbedding });
  const record = (type, event) => {
    const native = event.nativeEvent;
    profile.events.push({ rootName, type, ...contact(native),
      currentTarget: event.currentTarget?.tag,
      touches: (native.touches ?? []).map(contact),
      changedTouches: (native.changedTouches ?? []).map(contact) });
    if (type.startsWith("Touch"))
      setLast(`Root: ${native.pageX.toFixed(1)}, ${native.pageY.toFixed(1)} · local: ${native.locationX.toFixed(1)}, ${native.locationY.toFixed(1)}`);
  };
  useEffect(() => {
    observations.mounts[rootName] = (observations.mounts[rootName] ?? 0) + 1;
    return () => {
      observations.cleanups[rootName] = (observations.cleanups[rootName] ?? 0) + 1;
      panels.delete(rootName);
    };
  }, [rootName]);
  useLayoutEffect(() => {
    profile.commits++;
    profile.state = { presses, held, embedding, last };
  });
  const blue = rootName === "A";
  return <View ref={instance => { refs.current.root = instance; }}
    testID={`${rootName}-root`} pointerEvents="box-none"
    style={{ flex: 1, padding: 20, gap: 14, backgroundColor: "#122039", borderRadius: 12 }}>
    <Text style={{ color: "#f8fafc", fontSize: 24, fontWeight: "700", height: 32 }}>Root {rootName} · coordinates</Text>
    <Text style={{ color: "#b5c6e0", fontSize: 12, height: 44 }}>{embedding}{"\n"}React layout stays in its own root.</Text>
    <View ref={instance => { refs.current.frame = instance; }}
      testID={`${rootName}-frame`} pointerEvents="box-none"
      style={{ width: 280, height: 200, position: "relative", backgroundColor: "#253752" }}>
      <Pressable ref={instance => { refs.current.target = instance; }}
        testID={`${rootName}-target`} delayLongPress={10000}
        pressRetentionOffset={{ left: 12, top: 12, right: 12, bottom: 12 }}
        onTouchStart={event => record("TouchStart", event)}
        onTouchMove={event => record("TouchMove", event)}
        onTouchEnd={event => record("TouchEnd", event)}
        onPressMove={event => record("PressMove", event)}
        onPressIn={event => { record("PressIn", event); setHeld(true); }}
        onPressOut={event => { record("PressOut", event); setHeld(false); }}
        onPress={event => { record("Press", event); setPresses(value => value + 1); }}
        style={({ pressed }) => ({ position: "absolute", left: 35, top: 50,
          width: 180, height: 90, backgroundColor: pressed ? "#f59e0b" : blue ? "#0284c7" : "#0f766e",
          borderRadius: 10, padding: 12 })}>
        {({ pressed }) => <Text testID={`${rootName}-pressed`}
          style={{ color: "#ffffff", fontSize: 16, height: 28 }}>
          {pressed ? "Held in this root" : "Press and move"}
        </Text>}
      </Pressable>
    </View>
    <Text testID={`${rootName}-count`} style={{ color: "#f8fafc", fontSize: 17, height: 26 }}>
      Completed presses: {presses} · {held ? "held" : "ready"}
    </Text>
    <Text style={{ color: "#b5c6e0", fontSize: 11, height: 44 }}>{last}</Text>
  </View>;
}

AppRegistry.registerComponent("CoordinatePanel", () => CoordinatePanel);
globalThis.GodotCoordinates = {
  metrics: () => ({ window: { ...Dimensions.get("window") }, pixelRatio: PixelRatio.get() }),
  stats: () => ({ mounts: { ...observations.mounts }, cleanups: { ...observations.cleanups },
    roots: Object.fromEntries(Object.entries(observations.roots).map(([name, value]) =>
      [name, { commits: value.commits, state: value.state, events: [...value.events] }])) }),
  read(name, id = "target", parent = "frame") {
    const refs = panels.get(name)?.refs;
    return read(refs?.[id], refs?.[parent]);
  },
  clear(name) { observations.roots[name].events.length = 0; },
  embedding(name, label) { panels.get(name).setEmbedding(label); },
  retain(name) { retained.set(name, panels.get(name).refs.target); },
  stale: name => read(retained.get(name)),
};
