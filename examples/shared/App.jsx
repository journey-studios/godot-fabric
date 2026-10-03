import React, { useContext, useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { AppRegistry, RootTagContext, View, Text, Button } from "react-native";

// The module store and timer belong to the application. Only subscriptions
// and local state belong to a mounted React root.
let shared = 0;
let ticks = 0;
const listeners = new Set();
const roots = {};
const setters = {};
const cleanups = {};
const evaluations = (globalThis.sharedModuleEvaluations || 0) + 1;
globalThis.sharedModuleEvaluations = evaluations;
setInterval(() => { ticks++; }, 20);
function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function share(value) {
  shared = value;
  for (const listener of listeners) listener();
}

function Panel({ panel, title }) {
  const rootTag = useContext(RootTagContext);
  const [local, setLocal] = useState(0);
  const value = useSyncExternalStore(subscribe, () => shared);
  useLayoutEffect(() => {
    roots[panel] = { local, shared: value, rootTag, title };
  }, [panel, local, value, rootTag, title]);
  useEffect(() => {
    setters[panel] = setLocal;
    return () => {
      delete setters[panel];
      delete roots[panel];
      cleanups[panel] = (cleanups[panel] || 0) + 1;
    };
  }, [panel]);
  const color = panel === "hud" ? "#2563eb" : "#7c3aed";
  return <View testID={`${panel}-panel`} style={{ flex: 1, padding: 24, gap: 18,
    backgroundColor: "#111827", borderWidth: 2, borderColor: color, borderRadius: 16 }}>
    <Text style={{ fontSize: 14, color: "#94a3b8" }}>ONE APPLICATION · TWO REACT ROOTS</Text>
    <Text testID={`${panel}-title`} style={{ fontSize: 30, color: "#f8fafc" }}>{title}</Text>
    <Text style={{ fontSize: 17, color: "#cbd5e1" }}>{`RootTagContext: ${rootTag}`}</Text>
    <Text testID={`${panel}-local`} style={{ fontSize: 24, color: "#f8fafc" }}>{`Local state: ${local}`}</Text>
    <Text testID={`${panel}-shared`} style={{ fontSize: 24, color: "#a7f3d0" }}>{`Shared store: ${value}`}</Text>
    <Button testID={`${panel}-increment`} title="Increment local" color={color} onPress={() => setLocal((n) => n + 1)} />
    <Button testID={`${panel}-publish`} title="Update shared store" color="#0f766e" onPress={() => share(shared + 1)} />
    <Text style={{ fontSize: 14, color: "#94a3b8" }}>Unmount one root. The other keeps its state.</Text>
  </View>;
}
const HUD = (props) => <Panel {...props} />;
const Inventory = (props) => <Panel {...props} />;
AppRegistry.registerComponent("HUD", () => HUD);
AppRegistry.registerComponent("Inventory", () => Inventory);
globalThis.SharedRoots = {
  local(panel, value) { setters[panel]?.(value); },
  share,
  registrationProbe(kind) {
    try {
      if (kind === "duplicate") AppRegistry.registerComponent("HUD", () => Inventory);
      else if (kind === "section") AppRegistry.registerComponent("Section", () => HUD, true);
      else AppRegistry.registerComponent("__proto__", () => HUD);
      return "unexpected success";
    } catch (error) { return error.message; }
  },
  stats() { return { evaluations, ticks, subscribers: listeners.size, roots, cleanups }; },
};
