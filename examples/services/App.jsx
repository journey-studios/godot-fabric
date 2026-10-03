import React, { useEffect, useState } from "react";
import { AppRegistry, Button, Text, View } from "react-native";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { GodotFabric } from "@godot-fabric/runtime";

// This store belongs to the application. Godot Fabric only carries game data,
// revisions, operation responses and events; it does not own this UI state.
const store = createStore(() => ({ health: null, healthRevision: -1,
  healthGeneration: null, equipment: { item: "none", count: 0 },
  equipmentRevision: -1, damages: [], finished: [], operations: [], errors: [], ready: 0, uiTicks: 0 }));
const lifecycle = { hudMounts: 0, hudCleanups: 0, inventoryMounts: 0, inventoryCleanups: 0 };
const subscriptions = [];
let setInventoryLocal = null;
let disposed = false;

function ready(subscription) {
  subscriptions.push(subscription);
  subscription.ready.then(() => store.setState(s => ({ ready: s.ready + 1 })))
    .catch(error => store.setState(s => ({ errors: [...s.errors, { code: error.code, message: error.message }] })));
}
// Install happenings before the state read whose getter deliberately emits a
// change. Each connection still uses the public coordinated native protocol.
ready(GodotFabric.subscribe("player.damaged", (amount, reason) =>
  store.setState(s => ({ damages: [...s.damages, { amount, reason }] }))));
ready(GodotFabric.subscribe("inventory.finished", (job, item, cancelled) =>
  store.setState(s => ({ finished: [...s.finished, { job, item, cancelled }] }))));
ready(GodotFabric.connect("player.health", snapshot => store.setState({
  health: snapshot.value, healthRevision: snapshot.revision, healthGeneration: snapshot.generation,
})));
ready(GodotFabric.connect("inventory.equipment", snapshot => store.setState({
  equipment: snapshot.value, equipmentRevision: snapshot.revision,
})));

function invoke(name, args) {
  return GodotFabric.call(name, args).then(result => {
    store.setState(s => ({ operations: [...s.operations, { name, ...result }] }));
    return result;
  }).catch(error => {
    store.setState(s => ({ errors: [...s.errors, { name, code: error.code, message: error.message }] }));
    return null;
  });
}

const panel = { flex: 1, padding: 24, gap: 14, backgroundColor: "#101b2e", borderRadius: 16,
  borderWidth: 2, borderColor: "#0284c7" };
const label = { color: "#59e5d0", fontSize: 16, fontWeight: "700" };
const text = { color: "#f4f7fc", fontSize: 22 };

function HUD() {
  const state = useStore(store);
  const [local, setLocal] = useState(0);
  useEffect(() => { lifecycle.hudMounts++; return () => { lifecycle.hudCleanups++; }; }, []);
  return <View testID="services-hud" style={panel}>
    <Text style={label}>GODOT FABRIC / SHARED GAME DATA</Text>
    <Text style={{ ...text, fontSize: 32, fontWeight: "700" }}>HUD</Text>
    <Text testID="services-health" style={text}>Health: {state.health ?? "connecting"}</Text>
    <Text style={text}>Revision: {state.healthRevision}</Text>
    <Text testID="services-equipment" style={text}>Equipped: {state.equipment.item}</Text>
    <Text style={{ ...text, fontSize: 16 }}>Game events: {state.damages.length} · completed jobs: {state.finished.length}</Text>
    <Button testID="services-damage" title="Damage in Godot (-10)" color="#0f766e"
      onPress={() => invoke("player.damage", [10, "HUD button"])} />
    <Button title={`HUD local state: ${local}`} onPress={() => setLocal(x => x + 1)} />
    <Text style={{ ...text, fontSize: 15 }}>Zustand owns this UI representation. Godot owns health and equipment.</Text>
  </View>;
}
function Inventory() {
  const state = useStore(store);
  const [local, setLocal] = useState(0);
  setInventoryLocal = setLocal;
  useEffect(() => { lifecycle.inventoryMounts++; return () => {
    lifecycle.inventoryCleanups++; setInventoryLocal = null;
  }; }, []);
  return <View testID="services-inventory" style={panel}>
    <Text style={label}>GODOT FABRIC / TYPED OPERATIONS</Text>
    <Text style={{ ...text, fontSize: 32, fontWeight: "700" }}>Inventory</Text>
    <Text style={text}>Health shared with HUD: {state.health ?? "connecting"}</Text>
    <Text testID="services-inventory-equipment" style={text}>Equipped: {state.equipment.item}</Text>
    <Text testID="services-inventory-local" style={text}>Inventory local state: {local}</Text>
    <Button testID="services-equip" title="Ask Godot to equip bronze blade" color="#0f766e"
      onPress={() => invoke("inventory.equip", ["bronze-blade"])} />
    <Button title="Change local inventory state" onPress={() => setLocal(x => x + 1)} />
    <Text style={{ ...text, fontSize: 15 }}>The game returns acceptance, then completes its job through a native signal. Closing this panel does not cancel the game job.</Text>
  </View>;
}
AppRegistry.registerComponent("ServicesHUD", () => HUD);
AppRegistry.registerComponent("ServicesInventory", () => Inventory);
globalThis.GodotServices = {
  stats() { return { ...store.getState(), ...lifecycle, disposed }; },
  invoke, setInventoryLocal(value) { setInventoryLocal?.(value); },
  scheduleUITick() { setTimeout(() => store.setState(s => ({ uiTicks: s.uiTicks + 1 })), 50); },
  dispose() { if (disposed) return; disposed = true; for (const subscription of subscriptions) subscription.remove(); },
};
