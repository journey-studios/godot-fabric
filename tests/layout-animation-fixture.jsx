import React, {useLayoutEffect, useRef, useState} from "react";
import {AppRegistry, LayoutAnimation, UIManager, View} from "react-native";
import {BASE, CASES, CHILD, DOOMED, POSES, STAGE} from "./layout-animation-cases.mjs";

// Runs RN's original LayoutAnimation (and the legacy UIManager.configureNextLayoutAnimation) through the public
// react-native import, over one stage of absolute boxes: "box" moves between poses, "child" is added and "doomed" is
// removed. Everything JS observes is recorded in order in one log, each entry stamped with Date.now(); the Godot probe
// reads the Controls and the host's counters. The fixture never decides what the animation should look like: it records
// the config RN's helpers handed to the host and which of RN's callbacks ran, and whether RN's JS timer (the race
// LayoutAnimation.js arms against the native end) fired or was cleared first.
const log = [];
const mounted = {};
let sequence = 0;
let setScene = null;
let boxRef = null;
let current = null;

function note(entry) {
  log.push({sequence: ++sequence, t: Date.now(), ...entry});
}

// RN arms setTimeout(onAnimationComplete, duration + 17) inside configureNext (LayoutAnimation.js:73-90) and clears it
// when the animation ends natively. The timer RN arms while a case configures is the one recorded, with how it ended:
// armed, cleared (the native end got there first) or fired (the race did).
const races = [];
let capturing = null;
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = function (callback, delay, ...rest) {
  const entry = capturing !== null && capturing.race === null ? {label: capturing.label, delay, state: "armed", id: null} : null;
  if (entry === null) {
    return realSetTimeout(callback, delay, ...rest);
  }
  capturing.race = entry;
  races.push(entry);
  entry.id = realSetTimeout(() => {
    if (entry.state === "armed") {
      entry.state = "fired";
    }
    callback(...rest);
  }, delay);
  return entry.id;
};
globalThis.clearTimeout = function (id) {
  for (const entry of races) {
    if (entry.id === id && entry.state === "armed") {
      entry.state = "cleared";
    }
  }
  return realClearTimeout(id);
};

const color = {box: "#6366f1", child: "#22c55e", doomed: "#ef4444"};
function frame(rect, name) {
  return {position: "absolute", left: rect.x, top: rect.y, width: rect.width, height: rect.height, backgroundColor: color[name]};
}
function Stage() {
  const [scene, update] = useState(BASE);
  const ref = useRef(null);
  setScene = update;
  boxRef = ref;
  current = scene;
  // After every commit of the stage, in JS order with the callbacks.
  useLayoutEffect(() => {
    note({kind: "commit", scene});
  });
  const onLayout = id => event => note({kind: "layout", id, layout: event.nativeEvent.layout});
  return <View testID="la-stage" style={{width: STAGE.width, height: STAGE.height}}>
    <View ref={ref} testID="la-box" onLayout={onLayout("box")} style={frame(POSES[scene.box], "box")} />
    {scene.child ? <View testID="la-child" onLayout={onLayout("child")} style={frame(CHILD, "child")} /> : null}
    {scene.doomed ? <View testID="la-doomed" onLayout={onLayout("doomed")} style={frame(DOOMED, "doomed")} /> : null}
  </View>;
}
function Probe({name}) {
  useLayoutEffect(() => {
    mounted[name] = (mounted[name] ?? 0) + 1;
    return () => { mounted[name] -= 1; };
  }, [name]);
  return <Stage />;
}
AppRegistry.registerComponent("LayoutAnimationProbe", () => Probe);

// The two callbacks RN is given. Each call is recorded with the race of its configure call and the scene the stage
// shows when RN calls it.
function callbacks(label) {
  return {
    end: () => {
      let race = null;
      for (const entry of races) {
        if (entry.label === label) {
          race = entry;
        }
      }
      note({kind: "end", label, scene: current, race: race?.state ?? null});
    },
    fail: () => {
      note({kind: "fail", label});
    },
  };
}

function configure(label, spec) {
  const {end, fail} = callbacks(label);
  let given = null;
  const probe = config => {
    given = config;
    return config;
  };
  capturing = {label, race: null};
  try {
    if (spec.via === "legacy") {
      UIManager.configureNextLayoutAnimation(probe(LayoutAnimation.create(...spec.args)), end, fail);
    } else if (spec.how === "create") {
      LayoutAnimation.configureNext(probe(LayoutAnimation.create(...spec.args)), end, fail);
    } else if (spec.how === "preset") {
      LayoutAnimation.configureNext(probe(LayoutAnimation.Presets[spec.name]), end, fail);
    } else if (spec.how === "shorthand") {
      // The shorthand binds the preset itself; the config it passes is the preset.
      given = LayoutAnimation.Presets[spec.name];
      LayoutAnimation[spec.name](end);
    } else {
      LayoutAnimation.configureNext(probe(spec.config), end, fail);
    }
  } finally {
    capturing = null;
  }
  return given;
}

globalThis.LayoutAnimationProbe = {
  cases() { return {cases: CASES, base: BASE}; },
  mounted() { return {...mounted}; },
  // Everything recorded since the last call.
  take() { return log.splice(0); },
  races() { return races.map(({label, delay, state}) => ({label, delay, state})); },
  // The stage set to a scene with no animation armed: the start of a case.
  reset() { setScene(BASE); },
  // One case: arm the animation exactly as RN's API is used, then commit the new scene. configureNext only records the
  // config; the next commit that mutates the tree is the one RN's driver animates.
  run(name) {
    const spec = CASES[name];
    note({kind: "run", label: name});
    let given = null;
    if (spec.via === "flag") {
      // RN's New Architecture ignores this flag: the commit that follows animates nothing.
      let threw = false;
      let result;
      try {
        result = UIManager.setLayoutAnimationEnabledExperimental(true);
      } catch (error) {
        threw = String(error?.message ?? error);
      }
      note({kind: "flag", label: name, threw, result: result === undefined ? "undefined" : result});
    } else {
      given = configure(name, spec);
      note({kind: "configure", label: name, via: spec.via, config: given});
    }
    setScene({...current, ...spec.to});
    return {name, config: given};
  },
  // What RN's public node APIs report for the box now: measure, getBoundingClientRect.
  measureBox() {
    const node = boxRef.current;
    let measured = null;
    node.measure((x, y, width, height, pageX, pageY) => { measured = {x, y, width, height, pageX, pageY}; });
    const rect = node.getBoundingClientRect();
    return {measure: measured, rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height}};
  },
  // A call RN's old UIManager answered with an error, to show it still does.
  unknownLegacy() {
    try {
      UIManager.createView();
      return {threw: false};
    } catch (error) {
      return {threw: String(error?.message ?? error)};
    }
  },
  publicApi() {
    return {
      LayoutAnimation: Object.fromEntries(["configureNext", "create", "checkConfig", "easeInEaseOut", "linear", "spring", "setEnabled"]
        .map(key => [key, typeof LayoutAnimation[key]])),
      Types: Object.keys(LayoutAnimation.Types), Properties: Object.keys(LayoutAnimation.Properties),
      Presets: Object.keys(LayoutAnimation.Presets),
      UIManager: Object.fromEntries(["setLayoutAnimationEnabledExperimental", "configureNextLayoutAnimation"].map(key => [key, typeof UIManager[key]])),
    };
  },
};
