import React, { useEffect, useState } from "react";
import { AppRegistry, Pressable, StyleSheet, Text, View } from "react-native";

// RN's own AppRegistry through the public react-native import. The component below registers itself (and a section, so the
// registry has something to list); a button then sets the wrapper and the root view style providers and runs the surface again
// with setSurfaceProps, the way a React Native app decorates every one of its roots. The providers apply from the next run of
// a root. That first run puts the Frame above the component, so React mounts the component again and its state starts over, as
// it does in RN; the runs after it keep the shape of the tree, so setSurfaceProps then changes the props and keeps the state.
const observations = { renders: 0, mounts: 0, cleanups: 0, title: "", count: 0, rootTag: 0, wrapperCalls: [], styleCalls: [], runs: [] };
globalThis.AppRegistryExample = {
  state: () => ({ ...observations, wrapperCalls: [...observations.wrapperCalls], styleCalls: [...observations.styleCalls], runs: [...observations.runs] }),
};

const ROOT_STYLE = { flex: 1, padding: 16, backgroundColor: "#3730a3", borderRadius: 24 };

// The wrapper provider's component: a frame around the registered root's content.
function Frame({ children, initialProps }) {
  return (
    <View testID="app-registry-wrapper" style={styles.frame}>
      <Text testID="app-registry-frame-label" style={styles.frameLabel}>WRAPPER · {initialProps.title}</Text>
      {children}
    </View>
  );
}

function AppRegistryExample({ title, rootTag }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    observations.mounts += 1;
    return () => { observations.cleanups += 1; };
  }, []);
  observations.renders += 1;
  observations.title = title;
  observations.count = count;
  observations.rootTag = rootTag;

  const run = (nextTitle) => {
    observations.runs.push(nextTitle);
    AppRegistry.setSurfaceProps("AppRegistryExample", { rootTag, initialProps: { title: nextTitle } });
  };
  const applyProviders = () => {
    AppRegistry.setWrapperComponentProvider((appParameters, appKey) => {
      observations.wrapperCalls.push({ appKey, rootTag: appParameters.rootTag });
      return Frame;
    });
    AppRegistry.setRootViewStyleProvider((appParameters) => {
      observations.styleCalls.push({ rootTag: appParameters.rootTag });
      return ROOT_STYLE;
    });
    run("Providers applied");
  };

  return (
    <View testID="app-registry-card" style={styles.card}>
      <Text style={styles.eyebrow}>GODOT FABRIC / APPREGISTRY</Text>
      <Text testID="app-registry-title" style={styles.title}>{title}</Text>
      <Text testID="app-registry-tag" style={styles.line}>rootTag {String(rootTag)} · count {count}</Text>
      <Text testID="app-registry-keys" style={styles.line}>keys: {AppRegistry.getAppKeys().join(", ")}</Text>
      <Text testID="app-registry-sections" style={styles.line}>sections: {AppRegistry.getSectionKeys().join(", ")}</Text>
      <View testID="app-registry-row" style={styles.row}>
        <ExampleButton testID="app-registry-count" label="Count +1" onPress={() => setCount((value) => value + 1)} />
        <ExampleButton testID="app-registry-update" label="Update props" onPress={() => run("Props updated")} />
      </View>
      <ExampleButton testID="app-registry-apply" label="Apply wrapper and root style" onPress={applyProviders} />
    </View>
  );
}

function ExampleButton({ testID, label, onPress }) {
  return (
    <Pressable testID={testID} onPress={onPress} style={({ pressed }) => [styles.button, { opacity: pressed ? 0.72 : 1 }]}>
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

function SettingsSection() {
  return <Text style={styles.line}>A section is a component the registry lists apart.</Text>;
}

AppRegistry.registerComponent("AppRegistryExample", () => AppRegistryExample);
AppRegistry.registerSection("AppRegistrySettings", () => SettingsSection);

const styles = StyleSheet.create({
  card: { width: "100%", padding: 24, gap: 14, backgroundColor: "#172033", borderWidth: 1, borderColor: "#334155", borderRadius: 20 },
  frame: { flex: 1, padding: 14, gap: 10, borderWidth: 2, borderColor: "#5eead4", borderRadius: 16, backgroundColor: "#111827" },
  frameLabel: { color: "#5eead4", fontFamily: "NotoSans", fontSize: 12, fontWeight: "700" },
  eyebrow: { color: "#5eead4", fontFamily: "NotoSans", fontSize: 12, fontWeight: "700" },
  title: { color: "#f8fafc", fontFamily: "NotoSans", fontSize: 26, fontWeight: "700", lineHeight: 34 },
  line: { color: "#cbd5e1", fontFamily: "NotoSans", fontSize: 14, lineHeight: 22 },
  row: { flexDirection: "row", gap: 12 },
  button: { flexGrow: 1, paddingVertical: 12, paddingHorizontal: 16, alignItems: "center", backgroundColor: "#2563eb", borderRadius: 10 },
  buttonText: { color: "#ffffff", fontFamily: "NotoSans", fontSize: 15, fontWeight: "700", lineHeight: 22 },
});
