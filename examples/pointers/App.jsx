import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppRegistry, View, Text, Pressable, findNodeHandle } from "react-native";
import { GodotFabric } from "@godot-fabric/runtime";

const panels = new Map(), retained = new Map();
const observations = { mounts: {}, cleanups: {}, events: [], actions: [], operations: [], errors: [] };
const pointerFields = ["pointerId", "pointerType", "isPrimary", "button", "buttons", "pressure", "width", "height",
  "tiltX", "tiltY", "twist", "tangentialPressure", "detail", "ctrlKey", "shiftKey", "altKey", "metaKey",
  "clientX", "clientY", "x", "y", "pageX", "pageY", "screenX", "screenY", "offsetX", "offsetY", "target", "timeStamp"];
const types = ["Down", "Move", "Up", "Cancel", "GotPointerCapture", "LostPointerCapture", "Over", "Out", "Enter", "Leave"];

function capture(instance, pointerId) {
  return Boolean(instance && Number.isInteger(pointerId) && instance.hasPointerCapture(pointerId));
}
function describe(instance, ids = []) {
  if (!instance) return null;
  return { tag: findNodeHandle(instance), connected: instance.isConnected,
    methods: ["hasPointerCapture", "setPointerCapture", "releasePointerCapture"].every(key => typeof instance[key] === "function"),
    capture: Object.fromEntries(ids.map(id => [id, capture(instance, id)])) };
}
function contact(native) {
  return Object.fromEntries(["target", "identifier", "pageX", "pageY", "screenX", "screenY", "locationX", "locationY", "timestamp"]
    .map(key => [key, native[key]]));
}
function invoke(name, operation) {
  return GodotFabric.call("pointer." + operation, [name]).then(value => {
    observations.operations.push({ name, operation, ...value });
  }).catch(error => {
    // The executing stop operation can be canceled by its own shutdown. Keep
    // that exact protocol outcome visible instead of expecting a completion
    // callback from a retired runtime. Other rejections remain failures.
    const outcome = { name, operation, code: error.code, message: error.message };
    if (operation === "stop" && error.code === "E_SERVICE_STOPPED") observations.operations.push({ ...outcome, canceledByShutdown: true });
    else observations.errors.push(outcome);
  });
}
function record(name, id, type, instance, event) {
  const native = event.nativeEvent;
  const panel = panels.get(name);
  const pointer = native.pointerId;
  if (Number.isInteger(pointer)) panel?.ids.add(pointer);
  const entry = { name, id, type, tag: findNodeHandle(instance),
    native: Object.fromEntries(pointerFields.map(field => [field, native[field]])),
    captures: panel ? Object.fromEntries(["left", "right"].map(key => [key, capture(panel.refs[key], pointer)])) : {},
    contact: contact(native), touches: (native.touches ?? []).map(contact), changedTouches: (native.changedTouches ?? []).map(contact) };
  observations.events.push(entry);
  if (panel && type === "Down" && panel.arm === id) {
    instance.setPointerCapture(pointer);
    observations.actions.push({ name, id, operation: "autoCapture", pointerId: pointer, captured: capture(instance, pointer), events: observations.events.length });
    panel.arm = null;
  }
  if (panel?.callback?.id === id && panel.callback.type === type) {
    const callback = panel.callback;
    panel.callback = null;
    observations.actions.push({ name, id, operation: "callback:" + callback.operation, pointerId: pointer, events: observations.events.length });
    if (callback.operation === "remove") {
      retained.set("callback-removed", instance);
      panel.actions.remove(id);
    } else invoke(name, callback.operation);
  }
}

function PointerBox({ name, id, revision, refs }) {
  const own = useRef(null);
  const attach = useCallback(instance => { own.current = instance; refs[id] = instance; }, [refs, id]);
  const props = {};
  for (const type of types) {
    const prop = type.endsWith("PointerCapture") ? "on" + type : "onPointer" + type;
    props[prop] = event => record(name, id, type, own.current, event);
  }
  for (const type of ["Start", "Move", "End", "Cancel"])
    props["onTouch" + type] = event => record(name, id, "Touch" + type, own.current, event);
  return <View ref={attach} testID={name + "-" + id} {...props}
    style={{ position: "absolute", left: id === "left" ? 20 : 200, top: 125, width: 140, height: 145,
      backgroundColor: id === "left" ? "#0284c7" : "#0f766e", borderRadius: 8, padding: 12 }}>
    <Text pointerEvents="none" style={{ height: 27, fontSize: 19, color: "#ffffff" }}>{id} · v{revision}</Text>
    <Text pointerEvents="none" style={{ height: 64, fontSize: 12, color: "#dbeafe" }}>Original View ref{"\n"}Capture across siblings{"\n"}Real Godot input</Text>
  </View>;
}

export function PointerPanel({ name }) {
  const refs = useRef({}).current;
  const [alive, setAlive] = useState({ left: true, right: true });
  const [revisions, setRevisions] = useState({ left: 0, right: 0 });
  const [presses, setPresses] = useState(0);
  const [label, setLabel] = useState("Pointer transport / public capture");
  const panel = useRef({ refs, ids: new Set(), arm: null, callback: null, actions: {} }).current;
  panel.actions = { remove: id => setAlive(value => ({ ...value, [id]: false })),
    restore: id => setAlive(value => ({ ...value, [id]: true })),
    replace: id => setRevisions(value => ({ ...value, [id]: value[id] + 1 })), label: setLabel };
  panels.set(name, panel);
  useEffect(() => {
    observations.mounts[name] = (observations.mounts[name] ?? 0) + 1;
    return () => { observations.cleanups[name] = (observations.cleanups[name] ?? 0) + 1; panels.delete(name); };
  }, [name]);
  useLayoutEffect(() => { panel.state = { alive, revisions, presses, label }; });
  return <View testID={name + "-panel"} pointerEvents="box-none"
    style={{ flex: 1, backgroundColor: name === "A" ? "#111c31" : name === "B" ? "#112b32" : "#302138" }}>
    <Text style={{ position: "absolute", left: 20, top: 18, width: 320, height: 35, fontSize: 23, color: "#f8fafc" }}>Root {name} · pointers</Text>
    <Text style={{ position: "absolute", left: 20, top: 60, width: 320, height: 48, fontSize: 12, color: "#b7c7df" }}>Pending capture is queried immediately.{"\n"}The next real event delivers got / lost.</Text>
    {["left", "right"].map(id => alive[id] ?
      <PointerBox key={id + "/" + revisions[id]} name={name} id={id} revision={revisions[id]} refs={refs} /> :
      <View key={id + "/removed"} testID={name + "-" + id + "-removed"}
        style={{ position: "absolute", left: id === "left" ? 20 : 200, top: 125, width: 140, height: 145, padding: 12, backgroundColor: "#475569" }}>
        <Text style={{ height: 48, fontSize: 14, color: "#ffffff" }}>Removed target{"\n"}Capture released</Text>
      </View>)}
    <Pressable testID={name + "-press"} delayLongPress={10000}
      onTouchStart={event => record(name, "press", "TouchStart", refs.press, event)}
      onTouchEnd={event => record(name, "press", "TouchEnd", refs.press, event)}
      onTouchCancel={event => record(name, "press", "TouchCancel", refs.press, event)}
      onPressIn={event => record(name, "press", "PressIn", refs.press, event)}
      onPressOut={event => record(name, "press", "PressOut", refs.press, event)}
      onPress={event => { record(name, "press", "Press", refs.press, event); setPresses(value => value + 1); }}
      ref={instance => { refs.press = instance; }}
      style={{ position: "absolute", left: 20, top: 320, width: 320, height: 60, padding: 14, backgroundColor: "#475569" }}>
      <Text pointerEvents="none" style={{ height: 30, fontSize: 16, color: "#ffffff" }}>Original Pressability · {presses} presses</Text>
    </Pressable>
    <Text style={{ position: "absolute", left: 20, top: 410, width: 320, height: 50, fontSize: 13, color: "#5eead4" }}>{label}</Text>
  </View>;
}

function snapshot() {
  return { ...JSON.parse(JSON.stringify(observations)),
    live: Object.fromEntries(Array.from(panels, ([name, panel]) => [name, { state: panel.state, arm: panel.arm,
      refs: Object.fromEntries(Object.entries(panel.refs).map(([key, instance]) => [key, describe(instance, [...panel.ids])])), ids: [...panel.ids] }])),
    retained: Object.fromEntries(Array.from(retained, ([key, instance]) => [key, describe(instance,
      [...new Set(Array.from(panels.values()).flatMap(panel => [...panel.ids]))])])) };
}
AppRegistry.registerComponent("PointerPanel", () => PointerPanel);
globalThis.GodotPointers = {
  snapshot,
  clear() { observations.events.length = 0; observations.actions.length = 0; },
  retain(name, id, key) { retained.set(key, panels.get(name)?.refs[id]); },
  query(name, id, pointerId) { return capture(panels.get(name)?.refs[id], pointerId); },
  stale(key, pointerId) {
    const instance = retained.get(key);
    const before = capture(instance, pointerId);
    instance?.setPointerCapture(pointerId);
    const afterSet = capture(instance, pointerId);
    instance?.releasePointerCapture(pointerId);
    return { before, afterSet, afterRelease: capture(instance, pointerId), ...describe(instance, [pointerId]) };
  },
  action(name, operation, id = "left", pointerId = null) {
    const panel = panels.get(name), instance = panel?.refs[id];
    if (!panel) return false;
    if (operation === "arm") panel.arm = id;
    else if (operation === "capture") instance?.setPointerCapture(pointerId);
    else if (operation === "release") instance?.releasePointerCapture(pointerId);
    else if (["remove", "restore", "replace", "label"].includes(operation)) panel.actions[operation](id);
    else if (operation.startsWith("callback:")) {
      const [, type, action] = operation.split(":"); panel.callback = { id, type, operation: action };
    } else return false;
    observations.actions.push({ name, id, operation, pointerId, captured: capture(instance, pointerId), events: observations.events.length });
    return true;
  },
};
