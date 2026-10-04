import {bootstrap, queryFaultControl} from "./pointer-query-fault-bootstrap";
import React, {useEffect, useRef, useState} from "react";
import {AppRegistry, View} from "react-native";
import RawEventEmitter from "react-native/Libraries/Core/RawEventEmitter";
import OriginalEvent from "../node_modules/react-native/src/private/webapis/dom/events/Event";
import OriginalEventTarget from "../node_modules/react-native/src/private/webapis/dom/events/EventTarget";
import ReactNativeElement from "../node_modules/react-native/src/private/webapis/dom/nodes/ReactNativeElement";
import LegacySyntheticEvent from "../node_modules/react-native/src/private/renderer/events/LegacySyntheticEvent";

const panels = new Map(), mounts = {}, cleanups = {};
let active = null, sequence = 0;
function payloadId(payload) {
  if (payload == null || typeof payload !== "object") return null;
  if (!active.payloads.has(payload)) active.payloads.set(payload, active.payloads.size + 1);
  return active.payloads.get(payload);
}
function record(name, label, receiver, event) {
  if (!active) return;
  const native = event.nativeEvent;
  active.events.push({sequence: ++sequence, name, label, type: event.type, trusted: event.isTrusted,
    phase: event.eventPhase, currentMatches: event.currentTarget === receiver, thisMatches: receiver === active.target,
    targetMatches: event.target === active.target, originalSynthetic: event instanceof LegacySyntheticEvent,
    originalEvent: event instanceof OriginalEvent, globalEventMatches: globalThis.event === event,
    payloadId: payloadId(native), nativeTarget: native?.target ?? null,
    timeStamp: event.timeStamp, nativeTimeStamp: native?.timeStamp ?? native?.timestamp ?? null,
    currentPriority: nativeFabricUIManager.unstable_getCurrentEventPriority()});
  active.eventRefs.push(event);
  if (event.isTrusted && label === "touchstart" && panels.has(name)) panels.get(name).setStarts(value => value + 1);
}
function reset(name) {
  const panel = panels.get(name);
  for (const binding of panel.bindings.splice(0)) binding.ref.removeEventListener("pointerdown", binding.callback, binding.capture);
}
function Fixture({name}) {
  const refs = useRef({}).current, bindings = useRef([]).current;
  const [starts, setStarts] = useState(0);
  panels.set(name, {refs, bindings, starts, setStarts});
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
    return () => { reset(name); cleanups[name] = (cleanups[name] ?? 0) + 1; panels.delete(name); };
  }, [name]);
  return <View testID={name + "-parent"} pointerEvents="box-none" style={{flex: 1, backgroundColor: "#0f172a"}}>
    <View ref={ref => { refs.only = ref; }} testID={name + "-only"}
      onTouchStart={function(event) { record(name, "touchstart", this, event); }}
      onTouchEnd={function(event) { record(name, "touchend", this, event); }}
      onTouchCancel={function(event) { record(name, "touchcancel", this, event); }}
      style={{position: "absolute", left: 20, top: 20, width: 130, height: 80, backgroundColor: "#2563eb"}} />
    <View testID={name + "-counter"} style={{position: "absolute", left: 20, top: 120, height: 15, width: 20 + starts * 4, backgroundColor: "#fde047"}} />
  </View>;
}
AppRegistry.registerComponent("PointerQueryFaultProbe", () => Fixture);
const rawTypes = ["topPointerDown", "topTouchStart", "topTouchEnd", "topTouchCancel"];
function raw(channel, value) {
  if (!active || !rawTypes.includes(value.eventName)) return;
  active.raw.push({sequence: ++sequence, channel, type: value.eventName, payloadId: payloadId(value.nativeEvent),
    target: value.nativeEvent.target, timeStamp: value.nativeEvent.timeStamp ?? value.nativeEvent.timestamp ?? null});
}
for (const type of rawTypes) RawEventEmitter.addListener(type, value => raw("typed", value));
RawEventEmitter.addListener("*", value => raw("star", value));
function capability(name) {
  const ref = panels.get(name).refs.only;
  return {flags: bootstrap.flags, original: ref instanceof OriginalEventTarget && ref instanceof ReactNativeElement,
    methods: ["addEventListener", "removeEventListener", "dispatchEvent"].map(key => typeof ref[key]),
    targetTag: ref.tag, connected: ref.isConnected, point: [75, 55], query: queryFaultControl.snapshot()};
}
function configure(name, capture = false) {
  reset(name); const panel = panels.get(name), ref = panel.refs.only;
  const callback = function(event) { record(name, capture ? "pointerdown-capture" : "pointerdown-bubble", this, event); };
  ref.addEventListener("pointerdown", callback, capture);
  panel.bindings.push({ref, callback, capture});
  return {targetTag: ref.tag, capture};
}
function arm(name, caseId) {
  const panel = panels.get(name);
  active = {name, caseId, target: panel.refs.only, baselineStarts: panel.starts, events: [], eventRefs: [], raw: [], payloads: new Map()};
  queryFaultControl.clearObservations();
  return {targetTag: active.target.tag, baselineStarts: active.baselineStarts};
}
function publicControl(name) {
  const ref = panels.get(name).refs.only, event = new OriginalEvent("pointerdown", {bubbles: true});
  const returned = ref.dispatchEvent(event);
  return {returned, trusted: event.isTrusted, targetMatches: event.target === ref,
    cleaned: event.currentTarget === null && event.eventPhase === OriginalEvent.NONE && event.composedPath().length === 0};
}
function snapshot() {
  return {flags: bootstrap.flags, caseId: active?.caseId ?? null, name: active?.name ?? null, targetTag: active?.target.tag ?? null,
    events: active ? [...active.events] : [], raw: active ? [...active.raw] : [], baselineStarts: active?.baselineStarts ?? null,
    cleanup: active ? active.eventRefs.map(event => ({currentTargetNull: event.currentTarget === null, phase: event.eventPhase,
      pathEmpty: event.composedPath().length === 0, originalEvent: event instanceof OriginalEvent})) : [],
    panels: Object.fromEntries([...panels].map(([name, panel]) => [name, {starts: panel.starts, tag: panel.refs.only?.tag ?? null}])),
    mounts: {...mounts}, cleanups: {...cleanups}, query: queryFaultControl.snapshot(),
    currentPriority: nativeFabricUIManager.unstable_getCurrentEventPriority(), defaultPriority: nativeFabricUIManager.unstable_DefaultEventPriority,
    globalEventRestored: globalThis.event == null,
    scope: {actualNativeInput: true, realSDKQueryWrappedOnlyForTest: true, listenerRegistryMirrored: false,
      manualDispatchIsOnlyInstallationControl: true, publicDefaultEnabled: false, hardwareCertified: false}};
}
globalThis.QueryFaultProbe = {capability, configure, arm, publicControl, snapshot,
  fault(name, offset, mode, label) { return queryFaultControl.setFault({targetref: panels.get(name).refs.only, offset, mode, remaining: 1, label}); },
  clearFault() { return queryFaultControl.clearFault(); }};
