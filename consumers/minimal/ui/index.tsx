import React, { useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AppRegistry, RootTagContext, View, Text, Button, TextInput } from "react-native";
import type { ViewInstance } from "react-native";
import { GodotFabric } from "@godot-fabric/runtime";
import type { ServiceCallResult, ServiceSubscription } from "@godot-fabric/runtime";
import { readShared, subscribe, publish } from "./store";
import { platformMessage } from "./platform";

type GameState = {
  health: number | null; revision: number; generation: string | null;
  ready: number; damages: { amount: number; reason: string }[];
  operations: ServiceCallResult<number>[]; errors: { code: string; message: string }[];
};
let gameState: GameState = { health: null, revision: -1, generation: null,
  ready: 0, damages: [], operations: [], errors: [] };
const gameListeners = new Set<() => void>();
let serviceConnections: ServiceSubscription<unknown>[] = [];
let activePanels = 0;
let serviceCleanups = 0;
let panelMounts = 0;
let panelCleanups = 0;
let servicesDisposed = false;
function updateGame(values: Partial<GameState>) {
  gameState = { ...gameState, ...values };
  for (const listener of gameListeners) listener();
}
function serviceError(error: unknown) {
  const failure = error as Error & { code?: string };
  updateGame({ errors: [...gameState.errors, { code: failure.code ?? "UNKNOWN", message: failure.message }] });
}
function startServices() {
  if (serviceConnections.length) return;
  servicesDisposed = false;
  updateGame({ ready: 0 });
  // Install the happening listener before the getter that deliberately emits
  // its first changed revision. These connections belong to the application.
  const damaged = GodotFabric.subscribe<[number, string]>("consumer.damaged", (amount, reason) =>
    updateGame({ damages: [...gameState.damages, { amount, reason }] }));
  const health = GodotFabric.connect<number>("consumer.health", snapshot =>
    updateGame({ health: snapshot.value, revision: snapshot.revision, generation: snapshot.generation }));
  serviceConnections = [damaged, health];
  for (const connection of serviceConnections) connection.ready.then(() =>
    updateGame({ ready: gameState.ready + 1 })).catch(error => {
      if (!servicesDisposed) serviceError(error);
    });
}
function disposeServices() {
  if (servicesDisposed) return;
  servicesDisposed = true;
  for (const connection of serviceConnections) connection.remove();
  serviceConnections = [];
  serviceCleanups++;
}
function damageGame(amount: number, reason: string) {
  return GodotFabric.call<number>("consumer.damage", [amount, reason]).then(result => {
    updateGame({ operations: [...gameState.operations, result] });
    return result;
  }).catch(serviceError);
}
function subscribeGame(listener: () => void) {
  gameListeners.add(listener);
  return () => { gameListeners.delete(listener); };
}
startServices();
declare global {
  var ConsumerServices: {
    damage: typeof damageGame;
    stats(): GameState & { activePanels: number; panelMounts: number; panelCleanups: number;
      serviceCleanups: number; disposed: boolean; listeners: number; connections: number };
  };
}
globalThis.ConsumerServices = {
  damage: damageGame,
  stats: () => ({ ...gameState, activePanels, panelMounts, panelCleanups, serviceCleanups,
    disposed: servicesDisposed, listeners: gameListeners.size, connections: serviceConnections.length }),
};

type PanelProps = { panel: string; title: string };
type WindowRect = { x: number; y: number; width: number; height: number };
const panelRefs = new Map<string, ViewInstance>();
const panelMeasures: Record<string, WindowRect | null> = {};
declare global {
  var ConsumerGeometry: {
    measure(panel: string): void;
    stats(): Record<string, WindowRect | null>;
  };
}
globalThis.ConsumerGeometry = {
  measure(panel) {
    panelMeasures[panel] = null;
    const ref = panelRefs.get(panel);
    ref?.measureInWindow((x, y, width, height) => {
      if (panelRefs.get(panel) === ref) panelMeasures[panel] = { x, y, width, height };
    });
  },
  stats: () => ({ ...panelMeasures }),
};
function Panel({ panel, title }: PanelProps) {
  const root = useContext(RootTagContext);
  const host = useRef<ViewInstance | null>(null);
  const [local, setLocal] = useState(0);
  const [query, setQuery] = useState("");
  const shared = useSyncExternalStore(subscribe, readShared);
  const game = useSyncExternalStore(subscribeGame, () => gameState);
  useEffect(() => {
    startServices();
    activePanels++;
    panelMounts++;
    return () => {
      activePanels--;
      panelCleanups++;
      if (!activePanels) disposeServices();
    };
  }, []);
  useEffect(() => {
    const ref = host.current;
    if (ref) panelRefs.set(panel, ref);
    return () => { if (panelRefs.get(panel) === ref) panelRefs.delete(panel); };
  }, [panel]);
  const color = panel === "hud" ? "#0284c7" : "#d97706";
  return <View ref={host} testID={`${panel}-panel`} style={{ flex: 1, padding: 20, gap: 10,
    backgroundColor: "#101b2e", borderWidth: 2, borderColor: color, borderRadius: 16 }}>
    <Text style={{ color: "#94a3b8", fontSize: 13 }}>{platformMessage}</Text>
    <Text testID={`${panel}-title`} style={{ color: "#f8fafc", fontSize: 30, fontWeight: "700" }}>{title}</Text>
    <Text style={{ color: "#94a3b8", fontSize: 16 }}>{`Root ${String(root)} · private SDK tools`}</Text>
    <Text testID={`${panel}-local`} style={{ color: "#ffffff", fontSize: 24 }}>{`Local: ${local}`}</Text>
    <Text testID={`${panel}-shared`} style={{ color: "#a7f3d0", fontSize: 24 }}>{`Shared: ${shared}`}</Text>
    <Button testID={`${panel}-increment`} title="Increment local" color={color} onPress={() => setLocal((n) => n + 1)} />
    <Button testID={`${panel}-publish`} title="Publish shared" color="#0f766e" onPress={publish} />
    <Text testID={`${panel}-health`} style={{ color: "#fbbf24", fontSize: 18 }}>{`Game health: ${game.health ?? "connecting"}`}</Text>
    <Text testID={`${panel}-events`} style={{ color: "#94a3b8", fontSize: 13 }}>{`Game revision: ${game.revision} · events: ${game.damages.length}`}</Text>
    <Button testID={`${panel}-damage`} title="Damage game health" color="#b45309" onPress={() => { void damageGame(3, "consumer-button"); }} />
    <TextInput testID={`${panel}-input`} placeholder="Type in this root" value={query} onChangeText={setQuery}
      style={{ backgroundColor: "#1e293b", borderRadius: 8, color: "#ffffff", fontSize: 16, padding: 10 }} />
    <Text testID={`${panel}-query`} style={{ color: "#cbd5e1", fontSize: 16 }}>{`Input: ${query}`}</Text>
  </View>;
}
AppRegistry.registerComponent("HUD", () => Panel);
AppRegistry.registerComponent("Inventory", () => Panel);
