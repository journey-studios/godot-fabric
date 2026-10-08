import {bootstrap, interestMode, documentQueryControl} from "./pointer-document-bootstrap";
import React, {useEffect, useRef, useState} from "react";
import {AppRegistry, Pressable, ScrollView, View} from "react-native";
import RawEventEmitter from "react-native/Libraries/Core/RawEventEmitter";
import * as OriginalRenderer from "../node_modules/react-native/Libraries/Renderer/implementations/ReactFabric-prod";
import OriginalEvent from "../node_modules/react-native/src/private/webapis/dom/events/Event";
import ReactNativeDocument from "../node_modules/react-native/src/private/webapis/dom/nodes/ReactNativeDocument";
import LegacySyntheticEvent from "../node_modules/react-native/src/private/renderer/events/LegacySyntheticEvent";
import {getNativeTagFromPublicInstance} from "../src/private-interface";

// Original host components only: RN's View, and the SDK's Pressable and
// ScrollView. JSX click props sit on every View; original listeners are added
// where the lane's flags provide methods. The probe owns no listener registry.
const panels = new Map(), mounts = {}, cleanups = {};
const rawTypes = ["topClick", "topPointerDown", "topPointerUp", "topPointerCancel", "topPointerMove",
  "topTouchStart", "topTouchMove", "topTouchEnd", "topTouchCancel"];
const methods = object => object == null ? null : ["addEventListener", "removeEventListener", "dispatchEvent"].map(key => typeof object[key]);
let active = null, sequence = 0;
function payloadId(payload) {
  if (payload == null || typeof payload !== "object") return null;
  if (!active.payloads.has(payload)) active.payloads.set(payload, active.payloads.size + 1);
  return active.payloads.get(payload);
}
const tagOf = value => value == null ? null : typeof value === "number" ? value : getNativeTagFromPublicInstance(value) ?? null;
function pointerFields(native) {
  return {pointerId: native?.pointerId ?? null, pointerType: native?.pointerType ?? null, button: native?.button ?? null,
    buttons: native?.buttons ?? null, isPrimary: native?.isPrimary ?? null, clientX: native?.clientX ?? null,
    clientY: native?.clientY ?? null, offsetX: native?.offsetX ?? null, offsetY: native?.offsetY ?? null,
    timeStamp: native?.timeStamp ?? native?.timestamp ?? null};
}
function record(name, label, event) {
  if (active == null) return;
  const panel = panels.get(name), native = event.nativeEvent;
  active.events.push({sequence: ++sequence, name, label, type: event.type ?? null, phase: event.eventPhase ?? null,
    trusted: event.isTrusted === true, targetTag: tagOf(event.target), currentTag: tagOf(event.currentTarget),
    currentIsDocument: event.currentTarget instanceof ReactNativeDocument,
    currentIsElement: panel != null && event.currentTarget === panel.element,
    originalEvent: event instanceof OriginalEvent, originalSynthetic: event instanceof LegacySyntheticEvent,
    compiledLegacySynthetic: !(event instanceof OriginalEvent) && typeof event.persist === "function",
    // Pressability ignores a click whose payload owns pointerType.
    ownPointerType: native != null && Object.prototype.hasOwnProperty.call(native, "pointerType"),
    payloadId: payloadId(native), ...pointerFields(native),
    currentPriority: nativeFabricUIManager.unstable_getCurrentEventPriority()});
}
function jsx(name, label) { return event => record(name, label, event); }
// Inert pointer props make RN dispatch each contact's Down, Move, Up and Cancel
// to JS, so Raw can order them around the click. They record no callback.
const contact = {onPointerDown() {}, onPointerMove() {}, onPointerUp() {}, onPointerCancel() {}};
function Fixture({name}) {
  const panel = useRef({name, refs: {}, bindings: [], doc: null, element: null, surfaceId: null}).current;
  const [left, setLeft] = useState(true);
  const [presses, setPresses] = useState(0), [scrolls, setScrolls] = useState(0);
  Object.assign(panel, {left, setLeft, presses, setPresses, scrolls, setScrolls});
  panels.set(name, panel);
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
    return () => {
      for (const binding of panel.bindings.splice(0)) binding.ref.removeEventListener("click", binding.callback, binding.capture);
      cleanups[name] = (cleanups[name] ?? 0) + 1; panels.delete(name);
    };
  }, [name, panel]);
  const ref = key => value => { panel.refs[key] = value; };
  const box = (left, top, width, height, backgroundColor) => ({position: "absolute", left, top, width, height, backgroundColor});
  // Layout (root-relative): C 0,0 box-none; G 10,10 with L1 20,20 and L2 90,20;
  // S 160,10; P 10,90; the scroll view 80,90 with 40-high rows; X 230,10 is a
  // second child of the root. Empty root points exist outside C's children.
  return <>
    <View ref={ref("container")} testID={name + "-container"} pointerEvents="box-none" style={{position: "absolute", left: 0, top: 0, width: 220, height: 200}}
      onClick={jsx(name, "C")} onClickCapture={jsx(name, "C-capture")} {...contact}>
      <View ref={ref("group")} testID={name + "-group"} style={box(10, 10, 140, 70, "#1e293b")} onClick={jsx(name, "G")}>
        {left && <View ref={ref("left")} testID={name + "-left"} style={box(10, 10, 50, 40, "#2563eb")} onClick={jsx(name, "L1")} />}
        <View ref={ref("right")} testID={name + "-right"} style={box(80, 10, 50, 40, "#16a34a")} onClick={jsx(name, "L2")} />
      </View>
      <View ref={ref("side")} testID={name + "-side"} style={box(160, 10, 50, 70, "#9333ea")} onClick={jsx(name, "S")} />
      <Pressable ref={ref("press")} testID={name + "-press"} style={box(10, 90, 60, 40, "#f97316")}
        onPress={() => { panel.setPresses(value => value + 1); if (active) active.presses.push(++sequence); }} />
      <ScrollView ref={ref("scroll")} testID={name + "-scroll"} style={box(80, 90, 130, 100, "#0f172a")}
        onScrollBeginDrag={() => { panel.setScrolls(value => value + 1); if (active) active.scrollBegins.push(++sequence); }}>
        {[0, 1, 2, 3].map(index => <View key={index} ref={ref("item" + index)} testID={name + "-item" + index}
          style={{height: 40, backgroundColor: index % 2 ? "#334155" : "#475569"}} onClick={jsx(name, "I" + index)} />)}
      </ScrollView>
    </View>
    <View ref={ref("other")} testID={name + "-other"} style={box(230, 10, 60, 70, "#be123c")} onClick={jsx(name, "X")} {...contact} />
    <View testID={name + "-presses"} style={box(230, 180, 10 + presses * 4, 6, "#fde047")} />
    <View testID={name + "-scrolls"} style={box(230, 190, 10 + scrolls * 4, 6, "#22d3ee")} />
  </>;
}
AppRegistry.registerComponent("PointerClickProbe", () => Fixture);
function raw(channel, value) {
  if (active == null || !rawTypes.includes(value.eventName)) return;
  active.raw.push({sequence: ++sequence, channel, type: value.eventName, payloadId: payloadId(value.nativeEvent),
    target: value.nativeEvent?.target ?? null, ...pointerFields(value.nativeEvent)});
}
for (const type of rawTypes) RawEventEmitter.addListener(type, value => raw("typed", value));
RawEventEmitter.addListener("*", value => raw("star", value));
// Binds each root's original Document and registers the lane's original
// listeners: capture and bubble on the Document and its documentElement, and
// bubble on the group View, wherever the flags expose methods.
function configure(name, surfaceId) {
  const panel = panels.get(name), doc = OriginalRenderer.getPublicInstanceFromRootTag(surfaceId);
  if (!(doc instanceof ReactNativeDocument)) throw Error("Root getter must return the existing original Document");
  Object.assign(panel, {surfaceId, doc, element: doc.documentElement});
  const installed = [];
  const add = (target, label, capture) => {
    if (typeof target?.addEventListener !== "function") return;
    const callback = function(event) { record(name, label, event); };
    target.addEventListener("click", callback, capture);
    panel.bindings.push({ref: target, callback, capture});
    installed.push(label);
  };
  add(doc, "DocC", true); add(panel.element, "RootC", true); add(panel.refs.group, "GB", false);
  add(panel.element, "RootB", false); add(doc, "DocB", false);
  return {name, flags: documentQueryControl.currentFlags(), mode: bootstrap.mode, interestMode, installed,
    methods: {doc: methods(doc), element: methods(panel.element), view: methods(panel.refs.group)},
    tags: tags(name), query: documentQueryControl.snapshot()};
}
function tags(name) {
  const panel = panels.get(name), refs = panel.refs;
  const appRegistryView = refs.container?.parentElement;
  if (appRegistryView == null || appRegistryView !== refs.other?.parentElement || appRegistryView === panel.element) {
    throw Error("Fixture siblings must share the mounted AppRegistry View below the surface document element");
  }
  const tags = Object.fromEntries(Object.entries({C: "container", G: "group", L1: "left", L2: "right", S: "side", P: "press",
    SV: "scroll", I0: "item0", I1: "item1", I2: "item2", I3: "item3", X: "other"})
    .map(([key, ref]) => [key, tagOf(refs[ref])]));
  return {...tags, W: tagOf(appRegistryView)};
}
function arm(name, caseId) {
  active = {name, caseId, events: [], raw: [], presses: [], scrollBegins: [], payloads: new Map()};
  documentQueryControl.clearObservations();
  return {caseId, tags: tags(name)};
}
function snapshot() {
  return {flags: bootstrap.flags, mode: bootstrap.mode, interestMode, caseId: active?.caseId ?? null, name: active?.name ?? null,
    events: active ? [...active.events] : [], raw: active ? [...active.raw] : [],
    presses: active ? [...active.presses] : [], scrollBegins: active ? [...active.scrollBegins] : [],
    panels: Object.fromEntries([...panels].map(([name, panel]) => [name, {presses: panel.presses, scrolls: panel.scrolls,
      left: panel.left, tags: tags(name)}])),
    mounts: {...mounts}, cleanups: {...cleanups}, query: documentQueryControl.snapshot(),
    currentPriority: nativeFabricUIManager.unstable_getCurrentEventPriority(),
    defaultPriority: nativeFabricUIManager.unstable_DefaultEventPriority,
    discretePriority: nativeFabricUIManager.unstable_DiscreteEventPriority,
    globalEventRestored: globalThis.event == null,
    scope: {actualNativeInput: true, originalHostComponents: true, realSDKQueryObservedOnlyForTest: true,
      listenerRegistryMirrored: false, publicDefaultEnabled: false, hardwareCertified: false}};
}
globalThis.PointerClickProbe = {configure, arm, snapshot, tags,
  removeLeft(name) { panels.get(name).setLeft(false); return true; }};
