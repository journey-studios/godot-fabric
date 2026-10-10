import React, {useEffect, useState} from "react";
import {AppRegistry, Pressable, Text, View} from "react-native";
import {PANELS, SHAPES, TAB} from "./frontier-baseline-cases.mjs";

// The HUD of the performance baseline on the pointer spike's scene: a bar with one Pressable per panel and, below it, one
// panel at a time. The root is pointerEvents="box-none", so that the empty area is the Godot map's (the pointer policy of
// examples/world-input). A press on a button changes the React state and mounts the panel of that button in place of the
// one shown, a tree of the size the shapes say (tests/frontier-baseline-cases.mjs). The fixture only counts what React
// did, in one global; it holds no expectation.
const NOUNS = {units: "Unit", city: "Building", research: "Tech"};
const TITLES = {units: "Units", city: "City", research: "Research", empty: ""};
const COLORS = {
  units: {panel: "rgba(24, 40, 64, 0.92)", chip: "#2f5d8a"},
  city: {panel: "rgba(56, 38, 24, 0.92)", chip: "#8a5d2f"},
  research: {panel: "rgba(44, 28, 64, 0.92)", chip: "#6a3f9a"},
};

const counts = {presses: {}, changes: 0, shown: "empty"};
const resetCounts = () => {
  counts.presses = Object.fromEntries(PANELS.map(id => [id, 0]));
  counts.changes = 0;
};
resetCounts();

globalThis.FrontierBaselineProbe = {
  // What React did since the last reset: the presses each button took, the panels it committed and the one shown.
  snapshot() {
    return {presses: {...counts.presses}, changes: counts.changes, shown: counts.shown};
  },
  reset() {
    resetCounts();
  },
  // What the runtime says it is, for the report's provenance (the shared sampler reads it).
  engine() {
    const properties = typeof HermesInternal === "object" && HermesInternal !== null && typeof HermesInternal.getRuntimeProperties === "function"
      ? HermesInternal.getRuntimeProperties() : null;
    return {properties, hasHermesInternal: properties !== null};
  },
};

function Chip({id, index, last}) {
  return (
    <View style={{width: 100, height: 24, justifyContent: "center", paddingHorizontal: 6, backgroundColor: COLORS[id].chip}}>
      <Text testID={last ? "last-" + id : undefined} style={{color: "#ffffff", fontSize: 12}}>{`${NOUNS[id]} ${index + 1}`}</Text>
    </View>
  );
}

// A panel is a root, a header, a grid of chips and, for the city, its production bar: 50, 75 and 100 native nodes.
function Panel({id}) {
  const {chips, footer} = SHAPES[id];
  return (
    <View testID={"panel-" + id} style={{width: 440, flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start", padding: 8, gap: 6, backgroundColor: COLORS[id].panel}}>
      <Text testID={"header-" + id} style={{width: "100%", color: "#ffffff", fontSize: 16}}>{TITLES[id]}</Text>
      {Array.from({length: chips}, (_, index) => <Chip key={index} id={id} index={index} last={!footer && index === chips - 1} />)}
      {footer ? <View testID={"last-" + id} style={{width: "100%", height: 8, backgroundColor: "#d9a441"}} /> : null}
    </View>
  );
}

function BaselineHud() {
  const [panel, setPanel] = useState("empty");
  useEffect(() => {
    counts.shown = panel;
    counts.changes += 1;
  }, [panel]);
  const select = id => {
    counts.presses[id] += 1;
    setPanel(id);
  };
  return (
    <View testID="hud-root" pointerEvents="box-none" style={{flex: 1}}>
      <View testID="bar" pointerEvents="box-none" style={{position: "absolute", left: 0, top: 0, width: 800, height: 44, backgroundColor: "#223344"}}>
        {PANELS.map((id, index) => (
          <Pressable key={id} testID={`tab-${id}`} onPress={() => select(id)}
            style={{position: "absolute", left: TAB.left + TAB.step * index, top: TAB.top, width: TAB.width, height: TAB.height,
              justifyContent: "center", alignItems: "center", backgroundColor: panel === id ? "#6688cc" : "#445577"}}>
            <Text style={{color: "#ffffff", fontSize: 13}}>{id === "empty" ? "Close" : TITLES[id]}</Text>
          </Pressable>
        ))}
      </View>
      <View testID="region" pointerEvents="box-none" style={{position: "absolute", left: 12, top: 52, width: 440, height: 540}}>
        {panel !== "empty" ? <Panel key={panel} id={panel} /> : null}
      </View>
    </View>
  );
}

AppRegistry.registerComponent("BaselineHud", () => BaselineHud);
