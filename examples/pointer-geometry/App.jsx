import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppRegistry, View, Text, findNodeHandle, Dimensions, PixelRatio } from "react-native";

const panels = new Map(), retained = new Map();
const observations = { mounts: {}, cleanups: {}, events: [], touches: [], actions: [], layouts: {} };
const phases = ["Down", "Move", "Up", "Cancel", "Over", "Out", "Enter", "Leave", "GotPointerCapture", "LostPointerCapture"];
const fields = ["pointerId", "pointerType", "isPrimary", "button", "buttons", "pressure", "clientX", "clientY", "x", "y",
  "pageX", "pageY", "screenX", "screenY", "offsetX", "offsetY", "target", "timeStamp"];
const pointerProp = type => "on" + (type.endsWith("PointerCapture") ? type : "Pointer" + type);
const capture = (instance, id) => Boolean(instance && Number.isInteger(id) && instance.hasPointerCapture(id));

function record(name, id, type, event) {
  const panel = panels.get(name), native = event.nativeEvent;
  if (Number.isInteger(native.pointerId)) panel?.ids.add(native.pointerId);
  observations.events.push({ name, id, type, phase: panel?.phase, hidden: id === "capture" && panel?.hiddenCapture === true,
    native: Object.fromEntries(fields.map(field => [field, native[field]])) });
  if (type === "Down" && panel?.arm === id) {
    panel.refs[id].setPointerCapture(native.pointerId);
    observations.actions.push({ name, id, operation: "captureOnDown", pointerId: native.pointerId,
      captured: capture(panel.refs[id], native.pointerId) });
    panel.arm = null;
  }
  if (type === "Move" && panel?.updateOnMove === id) {
    panel.updateOnMove = null;
    panel.update("updated");
    observations.actions.push({ name, id, operation: "updateInsideMove", pointerId: native.pointerId });
  }
}
function contact(native) {
  return Object.fromEntries(["target", "identifier", "pageX", "pageY", "screenX", "screenY", "locationX", "locationY", "timestamp"]
    .map(field => [field, native[field]]));
}
function describe(instance, ids = []) {
  if (!instance) return null;
  const result = { tag: findNodeHandle(instance), connected: instance.isConnected,
    captures: Object.fromEntries(ids.map(id => [id, capture(instance, id)])), rect: instance.getBoundingClientRect().toJSON() };
  instance.measure((...args) => { result.measure = args; });
  instance.measureInWindow((...args) => { result.window = args; });
  return result;
}
function parentStyle(name, id) {
  if (id === "origin") return { left: 25, top: 140, width: 180, height: 160,
    transformOrigin: [0, 0, 0], transform: [{ rotate: "-12deg" }] };
  if (name === "A") return { left: 275, top: 160, width: 190, height: 200,
    transformOrigin: [0, 0, 0], transform: [{ scaleX: 1.15 }, { rotate: "-10deg" }] };
  return { left: 120, top: 165, width: 210, height: 190,
    transformOrigin: [0, 0, 0], transform: [{ rotate: "12deg" }, { scaleX: 0.9 }, { scaleY: 1.1 }] };
}
function targetStyle(name, id, phase) {
  if (id === "origin") return { left: 20, top: 25, width: 100, height: 80,
    transformOrigin: [0, 0, 0], transform: [{ rotate: "18deg" }] };
  if (name === "A") return { left: 20, top: 25, width: 120, height: 90,
    transformOrigin: [0, 0, 0], transform: phase === "initial" ? [{ rotate: "30deg" }] :
      [{ translateY: 135 }, { scaleX: 0.8 }, { rotate: "-25deg" }] };
  return { left: 30, top: 35, width: 120, height: 90,
    transformOrigin: ["25%", "75%", 0], transform: phase === "initial" ?
      [{ skewX: "15deg" }, { rotate: "-20deg" }] :
      [{ matrix: [-1, 0, 0, 0, 0.25, 1, 0, 0, 0, 0, 1, 0, 5, -8, 0, 1] }] };
}
function GeometryTarget({ name, id, phase, refs, hidden = false }) {
  const attach = useCallback(instance => { refs[id] = instance; }, [refs, id]);
  const events = Object.fromEntries(phases.map(type => [pointerProp(type), event => record(name, id, type, event)]));
  const touchEvents = id === "origin" ? Object.fromEntries(["Start", "Move", "End", "Cancel"].map(type =>
    ["onTouch" + type, event => {
      const native = event.nativeEvent;
      observations.touches.push({ name, id, type, native: contact(native),
        touches: (native.touches ?? []).map(contact), changedTouches: (native.changedTouches ?? []).map(contact) });
    }])) : {};
  return <View ref={instance => { refs[id + "-parent"] = instance; }} testID={name + "-" + id + "-parent"}
    pointerEvents="box-none" style={{ position: "absolute", backgroundColor: "#334155", ...parentStyle(name, id) }}>
    <View ref={attach} testID={name + "-" + id} {...events} {...touchEvents}
      onLayout={event => { (observations.layouts[name + "/" + id] ??= []).push({ ...event.nativeEvent.layout }); }}
      style={{ position: "absolute", backgroundColor: id === "origin" ? "#0284c7" : name === "A" ? "#0f766e" : "#a855f7",
        ...targetStyle(name, id, phase), ...(hidden ? { display: "none" } : {}) }}>
      <Text pointerEvents="none" style={{ position: "absolute", left: 8, top: 8, width: 95, height: 35, color: "#ffffff", fontSize: 13 }}>
        {name}/{id}{"\n"}{phase}
      </Text>
    </View>
  </View>;
}

export function PointerGeometryPanel({ name }) {
  const refs = useRef({}).current;
  const [phase, setPhase] = useState("initial");
  const [hiddenCapture, setHiddenCapture] = useState(false);
  const panel = useRef({ refs, ids: new Set(), phase, arm: null, updateOnMove: null, update: setPhase, setHiddenCapture }).current;
  panel.phase = phase;
  panel.hiddenCapture = hiddenCapture;
  panels.set(name, panel);
  useEffect(() => {
    observations.mounts[name] = (observations.mounts[name] ?? 0) + 1;
    return () => { observations.cleanups[name] = (observations.cleanups[name] ?? 0) + 1; panels.delete(name); };
  }, [name]);
  useLayoutEffect(() => { panel.phase = phase; });
  // These ancestor listeners expose events on the genuinely flattened View.
  // A ref alone does not force it to become a native Control. Events from the
  // concrete targets have their own JSX handlers and are not recorded twice.
  const logicalEvents = Object.fromEntries(phases.map(type => [pointerProp(type) + "Capture", event => {
    if (refs.flat && event.nativeEvent.target === findNodeHandle(refs.flat)) record(name, "flat", type, event);
  }]));
  return <View ref={instance => { refs.panel = instance; }} testID={name + "-panel"} pointerEvents="box-none"
    {...logicalEvents} style={{ flex: 1, backgroundColor: name === "A" ? "#111c31" : "#202039" }}>
    <Text pointerEvents="none" style={{ position: "absolute", left: 20, top: 18, width: 460, height: 35, color: "#f8fafc", fontSize: 23 }}>
      Root {name} · capture geometry
    </Text>
    <Text pointerEvents="none" style={{ position: "absolute", left: 20, top: 62, width: 460, height: 55, color: "#cbd5e1", fontSize: 12 }}>
      Original View refs / original Fabric event order{"\n"}Client stays in the physical root. Offset follows the capture target.
    </Text>
    {name === "A" && <GeometryTarget name={name} id="origin" phase={phase} refs={refs} />}
    <GeometryTarget name={name} id="capture" phase={phase} refs={refs} hidden={hiddenCapture} />
    {name === "A" && <View ref={instance => { refs["flat-parent"] = instance; }} testID="A-flat-parent" pointerEvents="box-none"
      style={{ position: "absolute", left: 25, top: 435, width: 300, height: 150, backgroundColor: "#334155",
        transformOrigin: [0, 0, 0], transform: [{ scaleX: 1.2 }, { rotate: "-8deg" }] }}>
      <View ref={instance => { refs.flat = instance; }}
        style={{ position: "absolute", left: 20, top: 20, width: 210, height: 120 }}>
        <View testID="A-flat-paint" pointerEvents="none"
          style={{ position: "absolute", left: 20, top: 20, width: 110, height: 70, backgroundColor: "#eab308" }}>
          <Text pointerEvents="none" style={{ left: 8, top: 8, width: 95, height: 35, color: "#111827", fontSize: 12 }}>
            Flattened logical ref{"\n"}No Control for its wrapper
          </Text>
        </View>
      </View>
    </View>}
    <Text pointerEvents="none" style={{ position: "absolute", left: 20, top: 595, width: 460, height: 38, color: "#5eead4", fontSize: 12 }}>
      {phase} · local inverse differs from upstream AABB subtraction
    </Text>
  </View>;
}

AppRegistry.registerComponent("PointerGeometryPanel", () => PointerGeometryPanel);
globalThis.GodotPointerGeometry = {
  snapshot() {
    return { ...JSON.parse(JSON.stringify(observations)),
      live: Object.fromEntries(Array.from(panels, ([name, panel]) => [name, { phase: panel.phase, hiddenCapture: panel.hiddenCapture,
        refs: Object.fromEntries(Object.entries(panel.refs).map(([id, instance]) => [id, describe(instance, [...panel.ids])])), ids: [...panel.ids] }])),
      retained: Object.fromEntries(Array.from(retained, ([key, instance]) => [key, describe(instance)])) };
  },
  metrics: () => ({ dimensions: { ...Dimensions.get("window") }, pixelRatio: PixelRatio.get() }),
  clear() { observations.events.length = 0; observations.touches.length = 0; },
  read(name, id, parent = "panel") {
    const refs = panels.get(name)?.refs, instance = refs?.[id], result = describe(instance);
    if (result && refs[parent]) instance.measureLayout(refs[parent], (...args) => { result.relative = args; },
      () => { result.relativeFailed = true; });
    return result;
  },
  retain(name, id, key) { retained.set(key, panels.get(name)?.refs[id]); },
  query(name, id, pointerId) { return capture(panels.get(name)?.refs[id], pointerId); },
  stale(key, pointerId) {
    const instance = retained.get(key), before = capture(instance, pointerId);
    instance?.setPointerCapture(pointerId);
    const afterSet = capture(instance, pointerId);
    instance?.releasePointerCapture(pointerId);
    return { ...describe(instance), before, afterSet, afterRelease: capture(instance, pointerId) };
  },
  action(name, operation, id = "capture", pointerId = -1) {
    const panel = panels.get(name), instance = panel?.refs[id];
    if (!panel) return false;
    if (operation === "arm") panel.arm = id;
    else if (operation === "capture") instance?.setPointerCapture(pointerId);
    else if (operation === "release") instance?.releasePointerCapture(pointerId);
    else if (operation === "updateOnMove") panel.updateOnMove = id;
    else if (operation === "update") panel.update("updated");
    else if (operation === "hide") panel.setHiddenCapture(true);
    else if (operation === "show") panel.setHiddenCapture(false);
    else return false;
    observations.actions.push({ name, id, operation, pointerId, captured: capture(instance, pointerId) });
    return true;
  },
};
