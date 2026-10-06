import React, {useEffect, useRef, useState} from "react";
import {AppRegistry, Switch, TextInput, View, findNodeHandle} from "react-native";
import RawEventEmitter from "react-native/Libraries/Core/RawEventEmitter";
import * as Renderer from "react-native/Libraries/Renderer/implementations/ReactFabric-prod";
import {customBubblingEventTypes, customDirectEventTypes} from "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry";
import {Commands as SwitchCommands} from "react-native/Libraries/Components/Switch/SwitchNativeComponent";

// Public Switch imports only: RN's original Switch.js renders the generated
// SwitchNativeComponent. The fixture records what JS observes per root.
const roots = new Map(), mounts = {}, cleanups = {};
let stage = null, sequence = 0, log = [];
const palettes = {
  first: {track: {false: "#ff3b30", true: "#5856d6"}, thumb: "#ffcc00", background: "#1c1c1e"},
  second: {track: {false: "#8e8e93", true: "#30b0c7"}, thumb: "#007aff", background: "#3a3a3c"},
  none: null,
};
const cases = ["controlled", "fixed", "disabled", "colors", "plain", "sized", "removable"];
function tagOf(instance) {
  return instance ? findNodeHandle(instance) : null;
}
function push(entry) {
  log.push({sequence: ++sequence, stage, ...entry});
}
function recordChange(name, caseId, label, ref, event) {
  const native = event.nativeEvent;
  push({root: name, caseId, label, value: native?.value ?? null, nativeTarget: native?.target ?? null,
    keys: native ? Object.keys(native).sort() : [], targetIsSwitch: event.target === ref.current,
    currentIsSwitch: event.currentTarget === ref.current, currentTag: event.currentTarget?.tag ?? null});
}
function recordParent(name, caseId, label, event) {
  push({root: name, caseId, label, value: event.nativeEvent?.value ?? null,
    nativeTarget: event.nativeEvent?.target ?? null, currentTag: event.currentTarget?.tag ?? null,
    text: event.nativeEvent?.text ?? null});
}
RawEventEmitter.addListener("*", value => {
  if (value.eventName === "topLayout") {
    return;
  }
  push({label: "raw", type: value.eventName, nativeTarget: value.nativeEvent?.target ?? null,
    value: value.nativeEvent?.value ?? null});
});

function Cell({name, caseId, children}) {
  return <View testID={`${name}-${caseId}-cell`} style={{width: 166, height: 60, padding: 6, backgroundColor: "#111827"}}
    onChangeCapture={event => recordParent(name, caseId, "parent-capture", event)}
    onChange={event => recordParent(name, caseId, "parent-bubble", event)}>{children}</View>;
}

function SwitchProbe({name}) {
  const refs = {
    controlled: useRef(null), fixed: useRef(null), disabled: useRef(null), colors: useRef(null),
    plain: useRef(null), sized: useRef(null), removable: useRef(null), input: useRef(null),
  };
  const retained = useRef(null);
  const [on, setOn] = useState(false);
  const [colorsOn, setColorsOn] = useState(false);
  const [palette, setPalette] = useState("first");
  const [show, setShow] = useState(true);
  const [text, setText] = useState("");
  const colors = palettes[palette];
  const handlers = caseId => ({
    onChange: event => recordChange(name, caseId, "switch-change", refs[caseId], event),
  });
  roots.set(name, {refs, retained, on, colorsOn, palette, show, text, setOn, setColorsOn, setPalette, setShow});
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
    return () => {
      cleanups[name] = (cleanups[name] ?? 0) + 1;
      roots.delete(name);
    };
  }, [name]);
  return <View testID={`${name}-root`} style={{flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 8, backgroundColor: "#0b1120"}}>
    <Cell name={name} caseId="controlled">
      <Switch ref={refs.controlled} testID={`${name}-controlled`} value={on} {...handlers("controlled")}
        onValueChange={value => { push({root: name, caseId: "controlled", label: "value-change", value}); setOn(value); }} />
    </Cell>
    <Cell name={name} caseId="fixed">
      <Switch ref={refs.fixed} testID={`${name}-fixed`} value={false} {...handlers("fixed")}
        onValueChange={value => push({root: name, caseId: "fixed", label: "value-change", value})} />
    </Cell>
    <Cell name={name} caseId="disabled">
      <Switch ref={refs.disabled} testID={`${name}-disabled`} disabled value={false} {...handlers("disabled")}
        onValueChange={value => push({root: name, caseId: "disabled", label: "value-change", value})} />
    </Cell>
    <Cell name={name} caseId="colors">
      <Switch ref={refs.colors} testID={`${name}-colors`} value={colorsOn} {...handlers("colors")}
        trackColor={colors?.track} thumbColor={colors?.thumb} ios_backgroundColor={colors?.background}
        onValueChange={value => { push({root: name, caseId: "colors", label: "value-change", value}); setColorsOn(value); }} />
    </Cell>
    <Cell name={name} caseId="plain">
      <Switch ref={refs.plain} testID={`${name}-plain`} {...handlers("plain")} />
    </Cell>
    <Cell name={name} caseId="sized">
      <Switch ref={refs.sized} testID={`${name}-sized`} value style={{width: 80, height: 40}} {...handlers("sized")} />
    </Cell>
    <Cell name={name} caseId="removable">
      {show && <Switch ref={instance => { refs.removable.current = instance; if (instance) { retained.current = instance; } }}
        testID={`${name}-removable`} value={false} {...handlers("removable")}
        onValueChange={value => push({root: name, caseId: "removable", label: "value-change", value})} />}
    </Cell>
    <Cell name={name} caseId="input">
      <TextInput ref={refs.input} testID={`${name}-input`} value={text} style={{width: 150, height: 40}}
        onChange={event => push({root: name, caseId: "input", label: "input-change", text: event.nativeEvent.text,
          currentTag: event.currentTarget?.tag ?? null})}
        onChangeText={setText} />
    </Cell>
  </View>;
}
AppRegistry.registerComponent("SwitchProbe", () => SwitchProbe);

function rootState(name) {
  const root = roots.get(name);
  if (!root) {
    return null;
  }
  return {on: root.on, colorsOn: root.colorsOn, palette: root.palette, show: root.show, text: root.text,
    tags: Object.fromEntries([...cases, "input"].map(caseId => [caseId, tagOf(root.refs[caseId].current)])),
    retainedTag: root.retained.current?.tag ?? null,
    hasSetNativeProps: typeof root.refs.controlled.current?.setNativeProps === "function"};
}
function registry() {
  const bubbling = customBubblingEventTypes.topChange, direct = customDirectEventTypes.topChange;
  return {bubbling: bubbling ? {...bubbling.phasedRegistrationNames} : null,
    direct: direct ? {...direct} : null};
}
globalThis.SwitchProbe = {
  arm(name) {
    stage = name;
    log = [];
    return {stage};
  },
  snapshot() {
    return {stage, log: [...log], mounts: {...mounts}, cleanups: {...cleanups}, registry: registry(),
      roots: Object.fromEntries(["A", "B"].map(name => [name, rootState(name)]))};
  },
  palette(name, value) {
    roots.get(name).setPalette(value);
  },
  controlled(name, value) {
    roots.get(name).setOn(value);
  },
  remove(name) {
    roots.get(name).setShow(false);
  },
  restore(name) {
    roots.get(name).setShow(true);
  },
  // RN's generated command, as Switch.js sends it.
  setValue(name, caseId, value) {
    SwitchCommands.setValue(roots.get(name).refs[caseId].current, value);
  },
  // A command through the retained ref of a removed Switch.
  staleSetValue(name, value) {
    const instance = roots.get(name).retained.current;
    SwitchCommands.setValue(instance, value);
    return {connected: instance.isConnected, tag: instance.tag};
  },
  // Malformed arguments bypass the generated helper on purpose.
  rawCommand(name, caseId, args) {
    Renderer.dispatchCommand(roots.get(name).refs[caseId].current, "setValue", args);
  },
  focusInput(name) {
    roots.get(name).refs.input.current.focus();
  },
};
