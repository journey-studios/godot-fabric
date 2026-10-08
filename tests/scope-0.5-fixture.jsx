import React, {Component, useEffect, useLayoutEffect, useState} from "react";
import {ActivityIndicator, AppRegistry, Image, Modal, Pressable, ScrollView, Text, View} from "react-native";
import {legacyProps, probeValue, propTable, refusalMessage, refusalTable, scopedComponents} from "../src/prop-scope.mjs";

// The six components of the 0.5 scope through the public facade, with every prop RN declares for them driven from the
// tables of src/prop-scope.mjs. A "case" is one prop of one component, rendered alone in its own boundary beside a baseline
// that carries no case prop: the refused ones must fail there with exactly the error of the table (on the mount and on an
// update in place), the ignored ones must change nothing the host shows, and the controls prove that a supported prop does.
// What the host made of each case is read natively by the probe; nothing here asserts. The oracle (tests/scope-0.5-oracle.mjs)
// recomputes the expected outcomes from the inventory and the manifest, not from these tables.
const components = {View, Text, Pressable, Image, Modal, ActivityIndicator, ScrollView};
const image = {uri: "res://tests/fixtures/images/formats/format.png", width: 24, height: 24};
const errors = [], mounts = {}, cleanups = {};
let generation = 0, requested = 0, committed = 0, current = {group: null, mode: "off"};

// A value of the right kind for the ignored props that need one (RN's View.js splits aria-labelledby, for instance). The
// others take true, or a function for an event.
const samples = {
  accessibilityLabelledBy: "label", "aria-labelledby": "label, other", "aria-modal": true, "aria-valuemax": 10, "aria-valuemin": 0,
  "aria-valuenow": 5, "aria-valuetext": "five", "aria-live": "polite", "aria-label": "label", "aria-hidden": true,
  nativeBackgroundAndroid: {type: "RippleAndroid", color: 0, borderless: false, rippleRadius: null},
  nativeForegroundAndroid: {type: "RippleAndroid", color: 0, borderless: false, rippleRadius: null},
  nextFocusDown: 1, nextFocusForward: 1, nextFocusLeft: 1, nextFocusRight: 1, nextFocusUp: 1, tabIndex: 0, id: "ignored-id",
  allowFontScaling: false, maxFontSizeMultiplier: 1.5, dynamicTypeRamp: "body", minimumFontScale: 0.5,
  defaultSource: image, loadingIndicatorSource: [image], fadeDuration: 100, resizeMethod: "resize", resizeMultiplier: 2,
  internal_analyticTag: "tag", android_ripple: {color: "red"}, delayHoverIn: 100, delayHoverOut: 100,
};
// Keys that RN declares for none of the six components. Several are names only the host's Control lists (kind, text, onActivate, svg),
// which a Pressable must not hand to it; the others are names no view config lists.
const undeclared = {kind: "input", text: "leaked", onActivate: () => {}, svg: true, placeholder: "leaked", submitBehavior: "submit",
  unknownProp: 1, "data-test": "x", className: "p-4"};
const sample = name => (name in samples ? samples[name] : /^on[A-Z]/.test(name) ? () => {} : true);
const describe = value => (typeof value === "function" ? "function" : JSON.parse(JSON.stringify(value)));
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const box = {width: 56, height: 28, backgroundColor: "#1d4ed8"};
function render(component, id, props) {
  const child = <View testID={`${id}-child`} style={{width: 8, height: 8, backgroundColor: "#f59e0b"}} />;
  switch (component) {
    case "View":
      return <View testID={`${id}-el`} style={box} {...props}>{child}</View>;
    case "Text":
      return <Text testID={`${id}-el`} style={{color: "#ffffff", width: 56}} {...props}>Scope scope scope scope</Text>;
    case "Pressable":
      return <Pressable testID={`${id}-el`} style={box} {...props}>{child}</Pressable>;
    case "Image":
      return <Image testID={`${id}-el`} source={image} style={{width: 24, height: 24}} {...props} />;
    case "Modal":
      return <Modal testID={`${id}-el`} visible transparent presentationStyle="overFullScreen" {...props}>{child}</Modal>;
    case "ScrollView":
      return <ScrollView testID={`${id}-el`} style={{width: 56, height: 28}} {...props}>{child}</ScrollView>;
    default:
      return <ActivityIndicator testID={`${id}-el`} style={{margin: 2}} {...props} />;
  }
}

// The cases, grouped so that no more windows or Controls are alive than the host should have to carry: a Modal opens a window.
const SIZE = {Modal: 8};
// The props that the host of main before this slice refuses itself, from inside the mount (native/modal_presentation.cpp):
// the exception stops the application, so the causal control on that host cannot drive them. They stay in the plan of every
// other lane.
const hostFatalOnPrevious = {Modal: ["animationType", "presentationStyle", "statusBarTranslucent", "navigationBarTranslucent",
  "hardwareAccelerated", "allowSwipeDismissal"]};
// One supported prop per component whose effect the host shows, so that an equal snapshot means something.
const controls = [
  {component: "View", prop: "accessibilityLabel", value: "Control"},
  {component: "Text", prop: "numberOfLines", value: 1},
  {component: "Pressable", prop: "accessibilityLabel", value: "Control"},
  {component: "Image", prop: "blurRadius", value: 3},
  {component: "Modal", prop: "visible", value: false},
  {component: "ActivityIndicator", prop: "animating", value: false},
  {component: "ScrollView", prop: "scrollEnabled", value: false},
];
let groups = [], skipped = [];
function buildGroups(lane) {
  const built = [];
  skipped = [];
  const addGroup = (component, kind, cases) => {
    const size = SIZE[component] ?? 40;
    for (let first = 0; first < cases.length; first += size) {
      const id = `${component}/${kind}/${built.filter(group => group.component === component && group.kind === kind).length}`;
      built.push({id, component, kind, cases: cases.slice(first, first + size).map((entry, index) => ({...entry, slot: `${id}#${index}`}))});
    }
  };
  for (const component of scopedComponents) {
    const refusedCases = [], ignoredCases = [], allowedCases = [], defaultCases = [];
    // Every refused prop, the ones that only the lists declare included, and every ignored one.
    for (const [prop, entry] of refusalTable(component)) {
      if (lane === "previous" && hostFatalOnPrevious[component]?.includes(prop)) {
        skipped.push({component, prop});
        continue;
      }
      refusedCases.push({prop, value: probeValue(component, prop)});
      // The first value a refused prop accepts is RN's default: it leaves the host as the baseline has it. The others only
      // have to be accepted.
      for (const [index, value] of (entry.accepts ?? []).entries()) {
        (index === 0 ? defaultCases : allowedCases).push({prop, value});
      }
    }
    for (const [prop, entry] of propTable(component)) {
      if (entry.decision === "ignored") {
        ignoredCases.push({prop, value: sample(prop)});
      }
    }
    addGroup(component, "refused", refusedCases);
    addGroup(component, "ignored", ignoredCases);
    addGroup(component, "allowed", allowedCases);
    addGroup(component, "default", defaultCases);
    // Not RN's: the Text wrapper's props fail with a hint (the one exception), every other key is not checked.
    const legacy = Object.keys(legacyProps[component] ?? {});
    addGroup(component, "legacy", legacy.map(prop => ({prop, value: true})));
    addGroup(component, "undeclared", Object.entries(undeclared).filter(([prop]) => !legacy.includes(prop)).map(([prop, value]) => ({prop, value})));
  }
  built.push({id: "controls", component: null, kind: "controls", cases: controls.map(entry => ({...entry, slot: `controls#${entry.component}`}))});
  groups = built;
}
// Each control has a baseline of its own: the same component without the prop.
const slotsOf = group => (group.kind === "controls"
  ? group.cases.flatMap(entry => [{slot: `${entry.slot}#base`, component: entry.component, base: true}, entry])
  : [{slot: `${group.id}#base`, component: group.component, base: true}, ...group.cases]);

class Slot extends Component {
  state = {failed: false};
  static getDerivedStateFromError() {
    return {failed: true};
  }
  componentDidCatch(error) {
    errors.push({slot: this.props.slot, group: current.group, generation, message: String(error?.message ?? error)});
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function ScopeProbe() {
  const [view, setView] = useState({group: null, mode: "off", generation: 0, epoch: 0});
  setRoot = setView;
  useEffect(() => {
    mounts.root = (mounts.root ?? 0) + 1;
    return () => {
      cleanups.root = (cleanups.root ?? 0) + 1;
    };
  }, []);
  useLayoutEffect(() => {
    committed = view.epoch;
  });
  const group = groups.find(entry => entry.id === view.group);
  if (group === undefined) {
    return <View testID="scope-root" style={{flex: 1}} />;
  }
  // The baseline slot carries no case prop in either mode. A case slot carries its prop only in the "case" mode.
  const slots = slotsOf(group);
  return <View testID="scope-root" style={{flex: 1, flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start", gap: 4, padding: 4}}>
    {slots.map(entry => {
      const component = entry.component ?? group.component;
      const props = entry.base || view.mode !== "case" ? {} : {[entry.prop]: entry.value};
      return <View key={`${entry.slot}@${view.generation}`} testID={`${entry.slot}-cell`} collapsable={false}
        style={{width: 64, height: 36, backgroundColor: "#111827"}}>
        <Slot slot={entry.slot}>{render(component, entry.slot, props)}</Slot>
      </View>;
    })}
  </View>;
}
let setRoot = () => {};
AppRegistry.registerComponent("ScopeProbe", () => ScopeProbe);

globalThis.ScopeProbe = {
  plan(lane) {
    buildGroups(lane);
    return {
      lane, skipped,
      groups: groups.map(group => ({id: group.id, component: group.component, kind: group.kind,
        baselines: slotsOf(group).filter(entry => entry.base).map(entry => ({slot: entry.slot, component: entry.component})),
        cases: group.cases.map(entry => ({slot: entry.slot, component: entry.component ?? group.component, prop: entry.prop,
          value: describe(entry.value),
          message: group.kind === "refused" ? refusalMessage(group.component, entry.prop)
            : group.kind === "legacy" ? `Godot ${group.component} does not implement ${entry.prop}: ${legacyProps[group.component][entry.prop]}` : null}))})),
      components: scopedComponents,
    };
  },
  // Shows a group in the "base" mode (no case prop anywhere) or the "case" mode. `remount` replaces every slot, boundaries
  // included, so that a mount is a mount; without it the same elements update in place.
  show(groupId, mode, remount) {
    if (remount) {
      generation += 1;
    }
    current = {group: groupId, mode};
    requested += 1;
    setRoot({group: groupId, mode, generation, epoch: requested});
  },
  clear() {
    current = {group: null, mode: "off"};
    requested += 1;
    setRoot({group: null, mode: "off", generation, epoch: requested});
  },
  snapshot() {
    return {requested, committed, generation, current, errors: [...errors], mounts: {...mounts}, cleanups: {...cleanups}};
  },
};
