import React, {Component, useEffect, useState} from "react";
import {AppRegistry, Pressable, Text, TouchableHighlight, TouchableOpacity, TouchableWithoutFeedback, View} from "react-native";

// Public touchables on two real roots. Every case sits in its own error
// boundary, so an SDK whose touchables throw at render still mounts the
// sentinel and reports exactly which case failed and why.
const events = [], renderErrors = [], controls = {}, mounts = {}, refs = {};
const payloads = new Map();
let sequence = 0;
function payloadId(nativeEvent) {
  if (nativeEvent == null || typeof nativeEvent !== "object") {
    return null;
  }
  if (!payloads.has(nativeEvent)) {
    payloads.set(nativeEvent, payloads.size + 1);
  }
  return payloads.get(nativeEvent);
}
function record(root, id, type, event) {
  const native = event?.nativeEvent;
  events.push({sequence: ++sequence, root, id, type, at: Date.now(),
    registration: event?.dispatchConfig?.registrationName ?? null,
    target: native?.target ?? null, currentTarget: event?.currentTarget?.__nativeTag ?? null,
    pageX: native?.pageX ?? null, pageY: native?.pageY ?? null,
    locationX: native?.locationX ?? null, locationY: native?.locationY ?? null,
    timestamp: native?.timestamp ?? null, identifier: native?.identifier ?? null,
    touches: native?.touches?.length ?? null, changedTouches: native?.changedTouches?.length ?? null,
    payloadId: payloadId(native)});
}
function press(root, id) {
  return {onPressIn: event => record(root, id, "in", event), onPressOut: event => record(root, id, "out", event),
    onPress: event => record(root, id, "press", event)};
}
function underlay(root, id) {
  return {onShowUnderlay: () => record(root, id, "show"), onHideUnderlay: () => record(root, id, "hide")};
}
class Case extends Component {
  state = {error: null};
  static getDerivedStateFromError(error) { return {error}; }
  componentDidCatch(error) {
    renderErrors.push({root: this.props.root, case: this.props.name, message: String(error?.message ?? error)});
  }
  render() { return this.state.error ? null : this.props.children; }
}
const box = (left, top, width, height, backgroundColor) =>
  ({position: "absolute", left, top, width, height, ...(backgroundColor ? {backgroundColor} : {})});

function Fixture({name}) {
  const [present, setPresent] = useState(true);
  const [toggleDisabled, setToggleDisabled] = useState(false);
  controls[name] = {setPresent, setToggleDisabled};
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
    return () => { delete controls[name]; };
  }, [name]);
  const id = suffix => name + "-" + suffix;
  return <View testID={id("root")} pointerEvents="box-none" style={{flex: 1, backgroundColor: "#0f172a"}}>
    <Case root={name} name="twf">
      <TouchableWithoutFeedback {...press(name, "twf")}>
        <View testID={id("twf")} style={box(16, 16, 150, 48, "#334155")} />
      </TouchableWithoutFeedback>
    </Case>
    <Case root={name} name="th">
      <TouchableHighlight testID={id("th")} ref={instance => { refs[id("th")] = instance?.__nativeTag ?? null; }}
        underlayColor="#dc2626" activeOpacity={0.4} {...underlay(name, "th")}
        {...press(name, "th")} style={{...box(200, 16, 150, 48, "#16a34a"), padding: 6}}>
        <View testID={id("th-child")} style={{width: 138, height: 36, backgroundColor: "#2563eb"}} />
      </TouchableHighlight>
    </Case>
    <Case root={name} name="long">
      <TouchableHighlight testID={id("long")} underlayColor="#7c3aed" delayLongPress={250} {...underlay(name, "long")}
        {...press(name, "long")} onLongPress={event => record(name, "long", "long", event)}
        style={{...box(16, 96, 150, 48, "#0f766e"), padding: 6}}>
        <View testID={id("long-child")} style={{width: 138, height: 36, backgroundColor: "#1d4ed8"}} />
      </TouchableHighlight>
    </Case>
    <Case root={name} name="delayed">
      <TouchableHighlight testID={id("delayed")} underlayColor="#ea580c" activeOpacity={0.6} delayPressOut={160}
        {...underlay(name, "delayed")} {...press(name, "delayed")} style={{...box(200, 96, 150, 48, "#334155"), padding: 6}}>
        <View testID={id("delayed-child")} style={{width: 138, height: 36, backgroundColor: "#0891b2"}} />
      </TouchableHighlight>
    </Case>
    <Case root={name} name="slop">
      <TouchableWithoutFeedback hitSlop={{top: 8, left: 12, bottom: 8, right: 12}}
        pressRetentionOffset={{top: 10, left: 14, bottom: 10, right: 14}} {...press(name, "slop")}>
        <View testID={id("slop")} style={box(56, 184, 80, 32, "#a16207")} />
      </TouchableWithoutFeedback>
    </Case>
    <Case root={name} name="disabled">
      <TouchableHighlight testID={id("disabled")} disabled underlayColor="#000000" {...underlay(name, "disabled")}
        {...press(name, "disabled")} style={{...box(200, 176, 150, 48, "#64748b"), padding: 6}}>
        <View testID={id("disabled-child")} style={{width: 138, height: 36, backgroundColor: "#94a3b8"}} />
      </TouchableHighlight>
    </Case>
    <Case root={name} name="nested">
      <TouchableHighlight testID={id("outer")} underlayColor="#facc15" {...underlay(name, "outer")} {...press(name, "outer")}
        style={{...box(16, 256, 150, 64, "#1e293b"), padding: 12}}>
        <TouchableWithoutFeedback {...press(name, "inner")}>
          <View testID={id("inner")} style={{width: 90, height: 40, backgroundColor: "#be185d"}} />
        </TouchableWithoutFeedback>
      </TouchableHighlight>
    </Case>
    <Case root={name} name="card">
      <TouchableHighlight testID={id("card")} underlayColor="#0ea5e9" {...underlay(name, "card")} {...press(name, "card")}
        style={{...box(200, 256, 150, 64, "#1e293b"), padding: 12}}>
        <TouchableWithoutFeedback disabled {...press(name, "card-button")}>
          <View testID={id("card-button")} style={{width: 90, height: 40, backgroundColor: "#4d7c0f"}} />
        </TouchableWithoutFeedback>
      </TouchableHighlight>
    </Case>
    {present && <Case root={name} name="removable">
      <TouchableHighlight testID={id("removable")} underlayColor="#f43f5e" activeOpacity={0.5} delayLongPress={400}
        {...underlay(name, "removable")} {...press(name, "removable")}
        onLongPress={event => record(name, "removable", "long", event)} style={{...box(16, 344, 150, 48, "#475569"), padding: 6}}>
        <View testID={id("removable-child")} style={{width: 138, height: 36, backgroundColor: "#7e22ce"}} />
      </TouchableHighlight>
    </Case>}
    <Case root={name} name="toggle">
      <TouchableHighlight testID={id("toggle")} disabled={toggleDisabled} underlayColor="#22d3ee" {...underlay(name, "toggle")}
        {...press(name, "toggle")} style={{...box(200, 344, 150, 48, "#365314"), padding: 6}}>
        <View testID={id("toggle-child")} style={{width: 138, height: 36, backgroundColor: "#b45309"}} />
      </TouchableHighlight>
    </Case>
    <Case root={name} name="text">
      <TouchableHighlight testID={id("label")} underlayColor="#1d4ed8" activeOpacity={0.6} {...underlay(name, "label")}
        {...press(name, "label")} style={{...box(16, 412, 150, 40, "#0f766e"), padding: 6}}>
        <Text testID={id("label-child")} style={{height: 28, color: "#ffffff"}}>Abrir</Text>
      </TouchableHighlight>
    </Case>
    <Case root={name} name="caption">
      <TouchableWithoutFeedback {...press(name, "caption")}>
        <Text testID={id("caption")} style={box(16, 464, 150, 40, "#7c2d12")}>Fechar</Text>
      </TouchableWithoutFeedback>
    </Case>
    <Case root={name} name="single-two">
      <TouchableHighlight onPress={() => {}} style={box(16, 412, 40, 20)}>
        <View style={{width: 10, height: 10}} />
        <View style={{width: 10, height: 10}} />
      </TouchableHighlight>
    </Case>
    <Case root={name} name="single-none">
      <TouchableWithoutFeedback onPress={() => {}} />
    </Case>
    <Case root={name} name="opacity">
      <TouchableOpacity testID={id("opacity")} onPress={() => {}} style={box(72, 412, 40, 20, "#0e7490")}>
        <View style={{width: 10, height: 10}} />
      </TouchableOpacity>
    </Case>
    <Case root={name} name="inline">
      <Text style={box(128, 412, 40, 20)}>
        <TouchableHighlight onPress={() => {}}><View style={{width: 10, height: 10}} /></TouchableHighlight>
      </Text>
    </Case>
    <Case root={name} name="style">
      <TouchableHighlight onPress={() => {}} style={{...box(16, 440, 40, 20), shadowColor: "#000000"}}>
        <View style={{width: 10, height: 10}} />
      </TouchableHighlight>
    </Case>
    <Case root={name} name="sentinel">
      <Pressable testID={id("sentinel")} {...press(name, "sentinel")} style={box(200, 412, 150, 40, "#0369a1")} />
    </Case>
  </View>;
}
AppRegistry.registerComponent("TouchablesProbe", () => Fixture);

globalThis.TouchablesProbe = {
  take() { return events.splice(0); },
  renderErrors() { return [...renderErrors]; },
  mounts() { return {...mounts}; },
  refs() { return {...refs}; },
  act(root, action, value) {
    if (action === "present") {
      controls[root].setPresent(value);
    } else if (action === "toggleDisabled") {
      controls[root].setToggleDisabled(value);
    } else {
      throw Error("Unknown touchables probe action: " + action);
    }
    return true;
  },
};
