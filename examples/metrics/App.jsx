import React, { useEffect, useLayoutEffect, useState } from "react";
import { AppRegistry, Button, Dimensions, PixelRatio, Text, View, useWindowDimensions } from "react-native";

const observations = { mounts: 0, cleanups: 0, commits: 0, events: [], hook: null, local: null };
let setLocal;
let dimensionSubscription;
const copySize = ({ width, height, scale, fontScale }) => ({ width, height, scale, fontScale });
function subscribe() {
  if (dimensionSubscription) return;
  dimensionSubscription = Dimensions.addEventListener("change", ({ window, screen }) => {
    observations.events.push({ window: copySize(window), screen: copySize(screen) });
  });
}
function unsubscribe() {
  dimensionSubscription?.remove();
  dimensionSubscription = null;
}

export function MetricsPanel() {
  const window = useWindowDimensions();
  const screen = Dimensions.get("screen");
  const [local, updateLocal] = useState(0);
  useEffect(() => {
    observations.mounts++;
    setLocal = updateLocal;
    subscribe();
    return () => {
      unsubscribe();
      setLocal = null;
      observations.hook = null;
      observations.local = null;
      observations.cleanups++;
    };
  }, []);
  useLayoutEffect(() => {
    observations.commits++;
    observations.hook = copySize(window);
    observations.local = local;
  });
  return <View testID="metrics-panel" style={{ flex: 1, padding: 16, gap: 10,
    backgroundColor: "#111827", borderRadius: 16, borderWidth: 1, borderColor: "#334155" }}>
    <Text style={{ fontSize: 12, color: "#5eead4", fontWeight: "700" }}>GODOT FABRIC / WINDOW METRICS</Text>
    <Text style={{ fontSize: 26, color: "#f8fafc", fontWeight: "700" }}>React follows the window.</Text>
    <View style={{ flexDirection: "row", gap: 12 }}>
      <Metric id="metrics-window" title="WINDOW · LOGICAL POINTS" value={`${window.width} × ${window.height}`} />
      <Metric id="metrics-screen" title="SCREEN · LOGICAL POINTS" value={`${screen.width} × ${screen.height}`} />
    </View>
    <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
      <Text testID="metrics-density" style={{ fontSize: 16, color: "#5eead4" }}>{`Pixel ratio: ${PixelRatio.get()} px / point`}</Text>
      <Text testID="metrics-font" style={{ fontSize: 16, color: "#94a3b8" }}>{`Font: ${PixelRatio.getFontScale()}`}</Text>
    </View>
    <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
      <View testID="metrics-pixel-probe" style={{ width: 10.3, height: 4, backgroundColor: "#5eead4" }} />
      <Text style={{ fontSize: 12, color: "#94a3b8" }}>{`10.3 layout points round to ${PixelRatio.roundToNearestPixel(10.3)}`}</Text>
    </View>
    <Text testID="metrics-local" style={{ fontSize: 16, color: "#cbd5e1" }}>{`Local React state: ${local}`}</Text>
    <Button testID="metrics-increment" title="Increment local state" color="#0f766e" onPress={() => updateLocal((value) => value + 1)} />
    <Text style={{ fontSize: 12, color: "#94a3b8" }}>Resize the Godot window. Dimensions and the hook update while local state survives.</Text>
  </View>;
}
function Metric({ id, title, value }) {
  return <View style={{ flex: 1, padding: 12, gap: 6, backgroundColor: "#1e293b", borderRadius: 10 }}>
    <Text style={{ fontSize: 10, color: "#94a3b8", fontWeight: "700" }}>{title}</Text>
    <Text testID={id} style={{ fontSize: 20, color: "#5eead4" }}>{value}</Text>
  </View>;
}

AppRegistry.registerComponent("MetricsPanel", () => MetricsPanel);
globalThis.GodotMetrics = {
  subscribe,
  unsubscribe,
  setLocal(value) { setLocal?.(value); },
  publishEqualDimensions() {
    // Exercise RN's public setter with a new object containing equal values.
    // Dimensions emits; useWindowDimensions should retain its snapshot identity.
    Dimensions.set({ window: copySize(Dimensions.get("window")), screen: copySize(Dimensions.get("screen")) });
  },
  unknownEventError() {
    try {
      const unexpected = Dimensions.addEventListener("resize", () => {});
      unexpected.remove();
      return "";
    } catch (error) { return error.message; }
  },
  stats() {
    return { ...observations, events: [...observations.events], publicListeners: dimensionSubscription ? 1 : 0,
      window: copySize(Dimensions.get("window")), screen: copySize(Dimensions.get("screen")),
      pixelRatio: PixelRatio.get(), fontScale: PixelRatio.getFontScale(),
      pixelsFor12Points: PixelRatio.getPixelSizeForLayoutSize(12),
      rounded10Point3: PixelRatio.roundToNearestPixel(10.3) };
  },
};
