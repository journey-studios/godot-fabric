import React, {Component, useEffect, useState} from "react";
import {AppRegistry, Pressable, TouchableOpacity, View} from "react-native";
import RawEventEmitter from "react-native/Libraries/Core/RawEventEmitter";

// Public View, Pressable and TouchableOpacity with accessibility props on two real roots. Every element is
// a plain RN element: its props are RN's, and what the host made of them is read natively by the probe.
// The `dyn` and `dyn-aria` views take whatever props the probe sends, so that updates, removals, role sweeps
// and invalid values run through the same ViewConfig; a render error of theirs is kept by their boundary.
const roots = new Map(), mounts = {}, cleanups = {}, errors = [];
let stage = null, sequence = 0, log = [];
const rawTypes = ["topTouchStart", "topTouchMove", "topTouchEnd", "topTouchCancel", "topAccessibilityTap"];

function push(entry) {
  log.push({sequence: ++sequence, stage, ...entry});
}
RawEventEmitter.addListener("*", value => {
  if (rawTypes.includes(value.eventName)) {
    push({label: "raw", type: value.eventName, nativeTarget: value.nativeEvent?.target ?? null});
  }
});
const tap = (root, id) => event => push({root, id, label: "tap", target: event?.nativeEvent?.target ?? null});
const press = (root, id) => event => push({root, id, label: "press", target: event?.nativeEvent?.target ?? null});

class Slot extends Component {
  state = {error: null};
  static getDerivedStateFromError(error) {
    return {error};
  }
  componentDidCatch(error) {
    errors.push({root: this.props.root, slot: this.props.slot, stage, message: String(error?.message ?? error)});
  }
  render() {
    return this.state.error ? null : this.props.children;
  }
}

// The props the probe sends are JSON; a function prop is asked for by `true`.
function withHandlers(root, id, props) {
  const resolved = {...props};
  if (resolved.onAccessibilityTap === true) {
    resolved.onAccessibilityTap = tap(root, id);
  }
  return resolved;
}

const box = {width: 156, height: 36};

function AccessibilityProbe({name}) {
  const [dyn, setDyn] = useState({});
  const [ariaProps, setAriaProps] = useState({});
  const [slotKey, setSlotKey] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [present, setPresent] = useState(true);
  const [label, setLabel] = useState("Save draft");
  roots.set(name, {setDyn, setAriaProps, setSlotKey, setHidden, setPresent, setLabel, dyn, ariaProps, hidden, present, label});
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
    return () => {
      cleanups[name] = (cleanups[name] ?? 0) + 1;
      roots.delete(name);
    };
  }, [name]);
  const id = suffix => `${name}-${suffix}`;
  return <View testID={id("root")} style={{flex: 1, flexDirection: "row", flexWrap: "wrap", alignContent: "flex-start", gap: 6, padding: 6, backgroundColor: "#0b1120"}}>
    <View testID={id("labeled")} accessible accessibilityLabel={label} accessibilityHint="Saves the draft" accessibilityRole="button"
      accessibilityLiveRegion="polite" onAccessibilityTap={tap(name, "labeled")} style={{...box, backgroundColor: "#1d4ed8"}} />
    <Pressable testID={id("tap-press")} accessibilityLabel="Tap wins" onPress={press(name, "tap-press")}
      onAccessibilityTap={tap(name, "tap-press")} style={{...box, backgroundColor: "#7c3aed"}} />
    <Pressable testID={id("pressable")} accessibilityLabel="Open" accessibilityHint="Opens the file" accessibilityRole="button"
      onPress={press(name, "pressable")} style={{...box, backgroundColor: "#0f766e"}} />
    <TouchableOpacity testID={id("touchable")} accessibilityLabel="Share" accessibilityHint="Shares the file" accessibilityRole="button"
      onPress={press(name, "touchable")} style={{...box, backgroundColor: "#b45309"}} />
    <TouchableOpacity testID={id("touchable-aria")} aria-label="Mute" aria-busy aria-expanded={false} aria-live="assertive"
      accessibilityRole="button" onPress={press(name, "touchable-aria")} style={{...box, backgroundColor: "#be123c"}} />
    <Pressable testID={id("pressable-aria")} aria-label="Like" aria-live="polite" aria-selected={false} accessibilityRole="tab"
      onPress={press(name, "pressable-aria")} style={{...box, backgroundColor: "#4d7c0f"}} />
    <Pressable testID={id("disabled-pressable")} disabled accessibilityLabel="Locked" onPress={press(name, "disabled-pressable")}
      style={{...box, backgroundColor: "#475569"}} />
    <View testID={id("disabled-state")} accessible accessibilityRole="button" accessibilityLabel="Off"
      accessibilityState={{disabled: true}} onAccessibilityTap={tap(name, "disabled-state")} style={{...box, backgroundColor: "#334155"}} />
    <View testID={id("hidden-group")} aria-hidden={hidden} style={{...box, backgroundColor: "#0e7490"}}>
      <View testID={id("hidden-child")} accessible accessibilityLabel="Inside" accessibilityRole="button"
        onAccessibilityTap={tap(name, "hidden-child")} style={{width: 60, height: 20, backgroundColor: "#22d3ee"}} />
    </View>
    <View testID={id("important")} importantForAccessibility="no-hide-descendants" accessibilityLabel="Skipped" style={{...box, backgroundColor: "#1e293b"}} />
    <Slot key={`dyn-${slotKey}`} root={name} slot="dyn">
      <View testID={id("dyn")} {...withHandlers(name, "dyn", dyn)} style={{...box, backgroundColor: "#a21caf"}} />
    </Slot>
    <Slot key={`aria-${slotKey}`} root={name} slot="dyn-aria">
      <View testID={id("dyn-aria")} {...withHandlers(name, "dyn-aria", ariaProps)} style={{...box, backgroundColor: "#c026d3"}} />
    </Slot>
    {present && <View testID={id("removable")} accessible accessibilityLabel="Temporary" accessibilityRole="button"
      onAccessibilityTap={tap(name, "removable")} style={{...box, backgroundColor: "#ca8a04"}} />}
    <View testID={id("plain")} style={{...box, backgroundColor: "#111827"}} />
    <View testID={id("gone")} accessibilityLabel="Gone" accessibilityRole="button" style={{display: "none"}} />
    <View testID={id("translated")} accessibilityLabel="Save" accessibilityHint="Save" style={{...box, backgroundColor: "#065f46"}} />
  </View>;
}
AppRegistry.registerComponent("AccessibilityProbe", () => AccessibilityProbe);

globalThis.AccessibilityProbe = {
  arm(name) {
    stage = name;
    log = [];
    return {stage};
  },
  snapshot() {
    return {stage, log: [...log], errors: [...errors], mounts: {...mounts}, cleanups: {...cleanups},
      roots: Object.fromEntries(["A", "B"].map(name => {
        const root = roots.get(name);
        return [name, root ? {dyn: root.dyn, aria: root.ariaProps, hidden: root.hidden, present: root.present, label: root.label} : null];
      }))};
  },
  // Props for the view that takes any. A render error of the previous props is kept by the boundary until the
  // slot is remounted, which `remount` does.
  setDyn(name, props, remount = false) {
    const root = roots.get(name);
    root.setDyn(props);
    if (remount) {
      root.setSlotKey(key => key + 1);
    }
  },
  setAria(name, props, remount = false) {
    const root = roots.get(name);
    root.setAriaProps(props);
    if (remount) {
      root.setSlotKey(key => key + 1);
    }
  },
  hide(name, value) {
    roots.get(name).setHidden(value);
  },
  remove(name) {
    roots.get(name).setPresent(false);
  },
  restore(name) {
    roots.get(name).setPresent(true);
  },
  relabel(name, value) {
    roots.get(name).setLabel(value);
  },
};
