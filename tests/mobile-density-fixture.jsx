import React from "react";
import {AppRegistry, Dimensions, Pressable, SafeAreaView, View, useWindowDimensions} from "react-native";

// A HUD of the shape the Frontier game renders, through the public react-native import: a full-window SafeAreaView with a top bar,
// side panels, a bottom bar and a 44-point Pressable, and SafeAreaViews that touch the window's edges, sit away from them, nest
// in the HUD and bleed into the band the OS leaves out. The fixture only records what JS observes (the window metrics, the events
// of Dimensions, and the frame that measureInWindow reports for every view); the Godot probe decides what the host should have
// done and tests/mobile-density-oracle.mjs recomputes it from these frames and the stages' seams.
const events = [];
const refs = {};
let hook = null;
let presses = 0;

// A SafeAreaView's padding is not read from the host: a child that fills its content box shows it in its own frame, which is
// what a HUD sees. ref() keeps the instance that measureInWindow is called on.
function ref(id) {
  return node => {
    if (node) {
      refs[id] = node;
    } else {
      delete refs[id];
    }
  };
}

const metrics = value => ({width: value.width, height: value.height, scale: value.scale, fontScale: value.fontScale});
Dimensions.addEventListener("change", ({window, screen}) => {
  events.push({window: metrics(window), screen: metrics(screen)});
});

function MobileDensityProbe() {
  hook = metrics(useWindowDimensions());
  const fill = {flex: 1};
  return (
    <View testID="root" collapsable={false} style={{flex: 1, backgroundColor: "#0b1220"}}>
      <SafeAreaView testID="hud" ref={ref("hud")} style={{flex: 1}}>
        <View testID="hud-fill" ref={ref("hud-fill")} collapsable={false} style={{flex: 1, backgroundColor: "#13233a"}}>
          <View testID="hud-top" ref={ref("hud-top")} collapsable={false} style={{height: 36, backgroundColor: "#1d4ed8", flexDirection: "row"}}>
            <SafeAreaView testID="bleed" ref={ref("bleed")} style={{marginLeft: -20, width: 90, height: 30}}>
              <View testID="bleed-fill" ref={ref("bleed-fill")} collapsable={false} style={fill} />
            </SafeAreaView>
          </View>
          <View testID="hud-middle" collapsable={false} style={{flex: 1, flexDirection: "row", justifyContent: "space-between"}}>
            <View testID="hud-left" ref={ref("hud-left")} collapsable={false} style={{width: 70, backgroundColor: "#f59e0b"}} />
            <SafeAreaView testID="nested" ref={ref("nested")} style={{width: 60}}>
              <View testID="nested-fill" ref={ref("nested-fill")} collapsable={false} style={fill} />
            </SafeAreaView>
            <View testID="hud-right" ref={ref("hud-right")} collapsable={false} style={{width: 70, backgroundColor: "#f59e0b"}} />
          </View>
          <View testID="hud-bottom" ref={ref("hud-bottom")} collapsable={false} style={{height: 52, backgroundColor: "#1d4ed8", justifyContent: "center"}}>
            <Pressable testID="touch-target" ref={ref("touch-target")} onPress={() => { presses += 1; }}
              style={{width: 44, height: 44, backgroundColor: "#22c55e"}} />
          </View>
        </View>
      </SafeAreaView>
      <SafeAreaView testID="floating" ref={ref("floating")} style={{position: "absolute", left: 200, top: 120, width: 100, height: 60}}>
        <View testID="floating-fill" ref={ref("floating-fill")} collapsable={false} style={fill} />
      </SafeAreaView>
      <SafeAreaView testID="edge-top" ref={ref("edge-top")} style={{position: "absolute", left: 250, top: 0, width: 100, height: 50}}>
        <View testID="edge-top-fill" ref={ref("edge-top-fill")} collapsable={false} style={fill} />
      </SafeAreaView>
      <SafeAreaView testID="edge-corner" ref={ref("edge-corner")} style={{position: "absolute", right: 10, bottom: 5, width: 120, height: 60}}>
        <View testID="edge-corner-fill" ref={ref("edge-corner-fill")} collapsable={false} style={fill} />
      </SafeAreaView>
    </View>
  );
}

AppRegistry.registerComponent("MobileDensityProbe", () => MobileDensityProbe);

// The HUD over a Godot world, with a full-screen root that is a SafeAreaView or, as the control, a View, with pointerEvents "box-none"
// or "auto". A bar with a handler and a Pressable inside it are the only Views that own a pointer under box-none; the root's own handler
// hears what bubbles up to it, and under "auto" every pointer of the window. The counters are JS's side of what the HUD heard; the probe
// counts the world's side. props: root "safe" | "view", pointerEvents "box-none" | "auto".
const worldCounts = {};
const worldRefs = {};
const worldHit = key => {
  worldCounts[key] = (worldCounts[key] ?? 0) + 1;
};
const worldRef = id => node => {
  if (node) {
    worldRefs[id] = node;
  }
};
function MobileDensityWorld({root = "safe", pointerEvents = "box-none"}) {
  const Root = root === "safe" ? SafeAreaView : View;
  return (
    <Root testID="world-root" ref={worldRef("root")} pointerEvents={pointerEvents} onPointerDown={() => worldHit("rootDown")} style={{flex: 1}}>
      <View testID="world-bar" ref={worldRef("bar")} collapsable={false} onPointerDown={() => worldHit("barDown")}
        style={{width: 300, height: 100, backgroundColor: "#223344"}}>
        <Pressable testID="world-button" ref={worldRef("button")} onPress={() => worldHit("press")}
          style={{position: "absolute", left: 20, top: 20, width: 100, height: 40, backgroundColor: "#4466aa"}} />
      </View>
    </Root>
  );
}
AppRegistry.registerComponent("MobileDensityWorld", () => MobileDensityWorld);
globalThis.MobileDensityWorld = {
  snapshot() {
    return {...worldCounts};
  },
  reset() {
    for (const key of Object.keys(worldCounts)) {
      delete worldCounts[key];
    }
    return true;
  },
  frames() {
    const out = {};
    for (const [id, node] of Object.entries(worldRefs)) {
      node.measureInWindow((x, y, width, height) => {
        out[id] = {x, y, width, height};
      });
    }
    return {frames: out, window: metrics(Dimensions.get("window"))};
  },
};

// Synchronous: measureInWindow calls its callback before it returns.
globalThis.MobileDensityProbe = {
  snapshot() {
    const frames = {};
    for (const [id, node] of Object.entries(refs)) {
      node.measureInWindow((x, y, width, height) => {
        frames[id] = {x, y, width, height};
      });
    }
    return {dimensions: {window: metrics(Dimensions.get("window")), screen: metrics(Dimensions.get("screen"))}, hook, events: [...events],
      frames, presses};
  },
};
