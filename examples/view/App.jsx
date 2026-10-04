import React, { useEffect, useLayoutEffect, useState } from "react";
import { AppRegistry, View, Pressable, Text, Button, findNodeHandle } from "react-native";

const refs = new Map();
const retained = new Map();
const observations = { mounts: 0, cleanups: 0, commits: 0, events: [], state: null };
const actions = {};
const colors = {
  red: "#e05252", blue: "#3b82f6", purple: "#a855f7", cyan: "#06b6d4",
  teal: "#14b8a6", green: "#22c55e", panel: "#16233b", arena: "#26364f",
};
function attach(id) {
  return instance => { if (instance) refs.set(id, instance); else refs.delete(id); };
}
function record(id, event) {
  observations.events.push({ id, target: event.nativeEvent.target,
    pageX: event.nativeEvent.pageX, pageY: event.nativeEvent.pageY });
  actions.select?.(id);
}
function Tile({ id, title, color, style }) {
  return <Pressable ref={attach(id)} testID={id} onPress={event => record(id, event)}
    style={{ width: 130, height: 80, backgroundColor: color, ...style }}>
    <Text style={{ color: "#ffffff", fontSize: 12, height: 20, margin: 8 }}>{title}</Text>
  </Pressable>;
}
function Card({ title, description, children, height = 190, onTitlePress }) {
  return <View pointerEvents="box-none" style={{ flex: 1, height, padding: 12,
    gap: 7, backgroundColor: colors.panel, borderRadius: 10 }}>
    {onTitlePress ? <Pressable testID="view-context" onPress={onTitlePress}>
      <Text style={{ color: "#f8fafc", fontSize: 17, fontWeight: "700" }}>{title}</Text>
    </Pressable> : <Text style={{ color: "#f8fafc", fontSize: 17, fontWeight: "700" }}>{title}</Text>}
    <Text style={{ color: "#a3b4cc", fontSize: 11 }}>{description}</Text>
    {children}
  </View>;
}

export function ViewGeometry() {
  const [order, setOrder] = useState(["red", "blue"]);
  const [z, setZ] = useState({ red: 4, blue: -2 });
  const [overflow, setOverflow] = useState("hidden");
  const [parentContext, setParentContext] = useState(true);
  const [border, setBorder] = useState("opaque");
  const [last, setLast] = useState("Choose a colored tile");
  actions.raise = () => setZ({ red: -3, blue: 6 });
  actions.equal = () => setZ({ red: 0, blue: 0 });
  actions.reorder = () => setOrder(value => [...value].reverse());
  actions.remove = () => setOrder(value => value.filter(id => id !== "red"));
  actions.high = () => { setOrder(["red", "blue"]); setZ({ red: 5001, blue: 4097 }); };
  actions.overflow = value => setOverflow(value);
  actions.context = value => setParentContext(value);
  actions.border = value => setBorder(value);
  actions.select = id => setLast(`Selected: ${id}`);
  actions.clear = () => { observations.events.length = 0; };
  actions.reset = () => { setOrder(["red", "blue"]); setZ({ red: 4, blue: -2 }); setOverflow("hidden"); setParentContext(true); setBorder("opaque"); };
  useEffect(() => {
    observations.mounts++;
    return () => { observations.cleanups++; refs.clear(); };
  }, []);
  useLayoutEffect(() => {
    observations.commits++;
    observations.state = { order: [...order], z: { ...z }, overflow: overflow ?? "default", parentContext, border };
  });
  const choose = action => () => { actions[action](); setLast(action === "remove" ? "Red tile removed" : "Compare the colored tiles"); };
  const borderColors = border === "removed" ? {} : border === "opaque" ? {
    borderTopColor: "#ef4444", borderRightColor: "#22c55e",
    borderBottomColor: "#3b82f6", borderLeftColor: "#f59e0b",
  } : {
    borderTopColor: "rgba(255,0,0,0.5)",
    borderRightColor: border === "uniform" ? "rgba(255,0,0,0.5)" : "rgba(0,255,0,0.5)",
    borderBottomColor: border === "uniform" ? "rgba(255,0,0,0.5)" : "rgba(0,0,255,0.5)",
    borderLeftColor: border === "uniform" ? "rgba(255,0,0,0.5)" : "rgba(255,255,0,0.5)",
  };
  return <View testID="view-root" pointerEvents="box-none"
    style={{ flex: 1, padding: 18, gap: 12, backgroundColor: "#0b1220" }}>
    <Text style={{ color: "#f8fafc", fontSize: 26, fontWeight: "700" }}>Layers, edges and visible space</Text>
    <Text style={{ color: "#a3b4cc", fontSize: 13 }}>Tap the overlaps. Change a layer or the visible region and compare what responds.</Text>
    <View style={{ flexDirection: "row", gap: 8 }}>
      {[["raise", "Raise blue"], ["equal", "Equal"], ["reorder", "Reorder"], ["remove", "Remove red"], ["high", "High z"]].map(([action, label]) =>
        <View key={action} style={{ flex: 1 }}><Button testID={`view-${action}`} title={label} color="#315782" onPress={choose(action)} /></View>)}
      <View style={{ flex: 1 }}><Button testID="view-reset" title="Reset" color="#0f766e" onPress={choose("reset")} /></View>
    </View>
    <View pointerEvents="box-none" style={{ flexDirection: "row", gap: 14 }}>
      <Card title="Sibling layers" description={`Red ${z.red} · Blue ${z.blue} · later wins a tie`}>
        <View ref={attach("siblings-arena")} testID="siblings-arena" pointerEvents="box-none"
          style={{ width: 260, height: 110, position: "relative", zIndex: 0, backgroundColor: colors.arena }}>
          {order.map(id => <Tile key={id} id={`sibling-${id}`} title={id === "red" ? "Red" : "Blue"}
            color={colors[id]} style={{ position: "absolute", left: 20, top: 15, zIndex: z[id] }} />)}
        </View>
      </Card>
      <Card title={parentContext ? "Inside a layer · isolated" : "Inside a layer · shared"}
        description="Tap this heading to isolate or merge the parent layer"
        onTitlePress={() => setParentContext(value => !value)}>
        <View ref={attach("nested-arena")} testID="nested-arena" pointerEvents="box-none"
          style={{ width: 260, height: 110, position: "relative", zIndex: 0, backgroundColor: colors.arena }}>
          <View ref={attach("nested-parent")} testID="nested-parent" style={{ position: "absolute", left: 20, top: 10,
            width: 130, height: 95, ...(parentContext ? { zIndex: 1 } : {}), backgroundColor: "#f59e0b" }}>
            <Tile id="nested-child" title="Child · 100" color={colors.purple}
              style={{ position: "absolute", left: 20, top: 15, width: 110, height: 70, zIndex: 100 }} />
          </View>
          <Tile id="nested-front" title="Sibling · 2" color={colors.cyan}
            style={{ position: "absolute", left: 60, top: 30, height: 70, zIndex: 2 }} />
        </View>
      </Card>
    </View>
    <View pointerEvents="box-none" style={{ flexDirection: "row", gap: 14 }}>
      <Card title="Static position" description="A static view has no z-order override" height={215}>
        <View ref={attach("static-arena")} testID="static-arena" pointerEvents="box-none"
          style={{ width: 220, height: 110, paddingTop: 15, paddingLeft: 10,
            flexDirection: "row", position: "relative", zIndex: 0, backgroundColor: colors.arena }}>
          <Tile id="static-back" title="Static · 99" color={colors.red} style={{ position: "static", zIndex: 99 }} />
          <Tile id="static-front" title="Later · 0" color={colors.teal} style={{ position: "relative", marginLeft: -100, zIndex: 0 }} />
        </View>
      </Card>
      <Card title="Visible region" description={`Overflow: ${overflow ?? "default"}`} height={215}>
        <View ref={attach("clip-parent")} testID="clip-parent" pointerEvents="box-none"
          style={{ width: 80, height: 80, position: "relative", zIndex: 0,
            backgroundColor: colors.arena, ...(overflow === undefined ? {} : { overflow }) }}>
          <Tile id="clip-child" title="Outside" color={colors.green}
            style={{ position: "absolute", left: 60, top: 20, width: 60, height: 40 }} />
        </View>
        <Button testID="view-overflow" title="Change visibility" color="#315782" onPress={() => {
          const choices = ["hidden", "visible", "scroll", undefined];
          setOverflow(choices[(choices.indexOf(overflow) + 1) % choices.length]);
        }} />
      </Card>
      <Card title="Four border colors" description={`Edge colors: ${border}`} height={215}>
        <View ref={attach("border-box")} testID="border-box"
          style={{ width: 180, height: 100, position: "relative", zIndex: 0,
            borderWidth: border === "removed" ? 0 : 8, ...borderColors,
            backgroundColor: border === "opaque" ? "#111827" : "#ffffff" }}>
          <Tile id="border-child" title="Inside" color={colors.purple}
            style={{ position: "absolute", left: 22, top: 22, width: 100, height: 40 }} />
          <View ref={attach("border-corner")} testID="border-corner"
            style={{ position: "absolute", right: 6, top: 20, width: 60, height: 60,
              backgroundColor: "#ffffff", borderRadius: 18,
              borderLeftWidth: 2, borderTopWidth: 10, borderRightWidth: 2, borderBottomWidth: 10,
              borderLeftColor: "#ff0000", borderTopColor: "#0000ff",
              borderRightColor: "#ff0000", borderBottomColor: "#0000ff" }} />
        </View>
        <Button testID="view-border" title="Change edges" color="#315782" onPress={() => {
          const choices = ["opaque", "alpha", "uniform", "removed"];
          setBorder(choices[(choices.indexOf(border) + 1) % choices.length]);
        }} />
      </Card>
    </View>
    <Text testID="view-last" style={{ color: "#a3b4cc", fontSize: 12 }}>{last}</Text>
  </View>;
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
AppRegistry.registerComponent("ViewGeometry", () => ViewGeometry);
globalThis.GodotView = {
  action(name, ...args) {
    if (!actions[name]) throw new Error(`Unknown View action: ${name}`);
    actions[name](...args);
  },
  stats: () => ({ ...observations, events: [...observations.events] }),
  read: (id, parentId) => read(refs.get(id), refs.get(parentId)),
  retain: id => retained.set(id, refs.get(id)),
  stale: id => read(retained.get(id)),
};
