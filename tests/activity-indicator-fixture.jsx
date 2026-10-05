import React, {useEffect, useRef, useState} from "react";
import {ActivityIndicator, AppRegistry, View, findNodeHandle} from "react-native";

// Public ActivityIndicator imports only: RN's original ActivityIndicator.js
// renders a sized View around the generated ActivityIndicatorView component.
const roots = new Map(), mounts = {}, cleanups = {};
const cases = ["default", "large", "numeric", "controlled", "removable"];

function Cell({name, caseId, children}) {
  return <View testID={`${name}-${caseId}-cell`} style={{width: 80, height: 80, backgroundColor: "#111827"}}>{children}</View>;
}

function IndicatorProbe({name}) {
  const refs = {default: useRef(null), large: useRef(null), numeric: useRef(null), controlled: useRef(null), removable: useRef(null)};
  const [animating, setAnimating] = useState(true);
  const [hides, setHides] = useState(true);
  const [color, setColor] = useState("#0a84ff");
  const [show, setShow] = useState(true);
  roots.set(name, {refs, animating, hides, color, show, setAnimating, setHides, setColor, setShow});
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
    return () => {
      cleanups[name] = (cleanups[name] ?? 0) + 1;
      roots.delete(name);
    };
  }, [name]);
  return <View testID={`${name}-root`} style={{flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 8, padding: 8, backgroundColor: "#0b1120"}}>
    <Cell name={name} caseId="default"><ActivityIndicator ref={refs.default} testID={`${name}-default`} /></Cell>
    <Cell name={name} caseId="large"><ActivityIndicator ref={refs.large} testID={`${name}-large`} size="large" color="#ff3b30" /></Cell>
    <Cell name={name} caseId="numeric"><ActivityIndicator ref={refs.numeric} testID={`${name}-numeric`} size={48} color="#ffcc00" /></Cell>
    <Cell name={name} caseId="controlled">
      <ActivityIndicator ref={refs.controlled} testID={`${name}-controlled`} animating={animating} hidesWhenStopped={hides}
        {...(color == null ? {} : {color})} />
    </Cell>
    <Cell name={name} caseId="removable">
      {show && <ActivityIndicator ref={refs.removable} testID={`${name}-removable`} color="#30b0c7" />}
    </Cell>
  </View>;
}
AppRegistry.registerComponent("IndicatorProbe", () => IndicatorProbe);

function rootState(name) {
  const root = roots.get(name);
  if (!root) {
    return null;
  }
  return {animating: root.animating, hides: root.hides, color: root.color, show: root.show,
    tags: Object.fromEntries(cases.map(caseId => [caseId, root.refs[caseId].current ? findNodeHandle(root.refs[caseId].current) : null]))};
}
globalThis.IndicatorProbe = {
  snapshot() {
    return {mounts: {...mounts}, cleanups: {...cleanups},
      roots: Object.fromEntries(["A", "B"].map(name => [name, rootState(name)]))};
  },
  animate(name, value) {
    roots.get(name).setAnimating(value);
  },
  hides(name, value) {
    roots.get(name).setHides(value);
  },
  color(name, value) {
    roots.get(name).setColor(value);
  },
  remove(name) {
    roots.get(name).setShow(false);
  },
  restore(name) {
    roots.get(name).setShow(true);
  },
};
