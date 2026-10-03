import React, { useContext, useState, useSyncExternalStore } from "react";
import { AppRegistry, RootTagContext, View, Text, Button, TextInput } from "react-native";
import { readShared, subscribe, publish } from "./store";
import { platformMessage } from "./platform";

type PanelProps = { panel: string; title: string };
function Panel({ panel, title }: PanelProps) {
  const root = useContext(RootTagContext);
  const [local, setLocal] = useState(0);
  const [query, setQuery] = useState("");
  const shared = useSyncExternalStore(subscribe, readShared);
  const color = panel === "hud" ? "#0284c7" : "#d97706";
  return <View testID={`${panel}-panel`} style={{ flex: 1, padding: 24, gap: 18,
    backgroundColor: "#101b2e", borderWidth: 2, borderColor: color, borderRadius: 16 }}>
    <Text style={{ color: "#94a3b8", fontSize: 13 }}>{platformMessage}</Text>
    <Text testID={`${panel}-title`} style={{ color: "#f8fafc", fontSize: 30, fontWeight: "700" }}>{title}</Text>
    <Text style={{ color: "#94a3b8", fontSize: 16 }}>{`Root ${String(root)} · private SDK tools`}</Text>
    <Text testID={`${panel}-local`} style={{ color: "#ffffff", fontSize: 24 }}>{`Local: ${local}`}</Text>
    <Text testID={`${panel}-shared`} style={{ color: "#a7f3d0", fontSize: 24 }}>{`Shared: ${shared}`}</Text>
    <Button testID={`${panel}-increment`} title="Increment local" color={color} onPress={() => setLocal((n) => n + 1)} />
    <Button testID={`${panel}-publish`} title="Publish shared" color="#0f766e" onPress={publish} />
    <TextInput testID={`${panel}-input`} placeholder="Type in this root" value={query} onChangeText={setQuery}
      style={{ backgroundColor: "#1e293b", borderRadius: 8, color: "#ffffff", fontSize: 16, padding: 10 }} />
    <Text testID={`${panel}-query`} style={{ color: "#cbd5e1", fontSize: 16 }}>{`Input: ${query}`}</Text>
  </View>;
}
AppRegistry.registerComponent("HUD", () => Panel);
AppRegistry.registerComponent("Inventory", () => Panel);
