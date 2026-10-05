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
    pointerId: native?.pointerId ?? null, buttons: native?.buttons ?? null, pressure: native?.pressure ?? null,
    pointerType: native?.pointerType ?? null, touchIdentifier: native?.changedTouches?.[0]?.identifier ?? null,
    timeStamp: event.timeStamp, nativeTimeStamp: native?.timeStamp ?? native?.timestamp ?? null,
    currentPriority: nativeFabricUIManager.unstable_getCurrentEventPriority(),
    // Move cases also listen on the parent and compare coalesced coordinates.
    ...(panels.get(name)?.probePointerMove ? {currentTag: event.currentTarget?.tag ?? null,
      offsetX: native?.offsetX ?? null, offsetY: native?.offsetY ?? null} : {})});
  active.eventRefs.push(event);
  if (event.isTrusted && label === "touchstart" && panels.has(name)) panels.get(name).setStarts(value => value + 1);
  if (event.isTrusted && event.type === "pointerup" && panels.get(name)?.probePointerUp) panels.get(name).setUps(value => value + 1);
  if (event.isTrusted && event.type === "pointermove" && panels.get(name)?.probePointerMove) panels.get(name).setMoves(value => value + 1);
}
function reset(name) {
  const panel = panels.get(name);
  for (const binding of panel.bindings.splice(0)) binding.ref.removeEventListener(binding.type ?? "pointerdown", binding.callback, binding.capture);
}
function Fixture({name, probePointerUp = false, probePointerMove = false}) {
  const refs = useRef({}).current, bindings = useRef([]).current;
  const [starts, setStarts] = useState(0);
  const [ups, setUps] = useState(0);
  const [moves, setMoves] = useState(0);
  panels.set(name, {refs, bindings, starts, setStarts, ups, setUps, probePointerUp, moves, setMoves, probePointerMove});
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
    return () => { reset(name); cleanups[name] = (cleanups[name] ?? 0) + 1; panels.delete(name); };
  }, [name]);
  return <View ref={ref => { refs.parent = ref; }} testID={name + "-parent"} pointerEvents="box-none" style={{flex: 1, backgroundColor: "#0f172a"}}>
    <View ref={ref => { refs.only = ref; }} testID={name + "-only"}
      onTouchStart={function(event) { record(name, "touchstart", this, event); }}
      onTouchEnd={function(event) { record(name, "touchend", this, event); }}
      onTouchCancel={function(event) { record(name, "touchcancel", this, event); }}
      style={{position: "absolute", left: 20, top: 20, width: 130, height: 80, backgroundColor: "#2563eb"}} />
    <View testID={name + "-counter"} style={{position: "absolute", left: 20, top: 120, height: 15, width: 20 + starts * 4, backgroundColor: "#fde047"}} />
    {probePointerUp && <View testID={name + "-up-counter"} style={{position: "absolute", left: 20, top: 140, height: 10, width: 20 + ups * 4, backgroundColor: "#22c55e"}} />}
    {probePointerMove && <View testID={name + "-move-counter"} style={{position: "absolute", left: 160, top: 120, height: 10, width: 20 + moves * 4, backgroundColor: "#f97316"}} />}
  </View>;
}
AppRegistry.registerComponent("PointerQueryFaultProbe", () => Fixture);
const rawTypes = ["topPointerDown", "topPointerUp", "topPointerMove", "topTouchStart", "topTouchMove", "topTouchEnd", "topTouchCancel"];
function raw(channel, value) {
  if (!active || !rawTypes.includes(value.eventName)) return;
  active.raw.push({sequence: ++sequence, channel, type: value.eventName, payloadId: payloadId(value.nativeEvent),
    pointerId: value.nativeEvent.pointerId ?? null, buttons: value.nativeEvent.buttons ?? null, pressure: value.nativeEvent.pressure ?? null,
    pointerType: value.nativeEvent.pointerType ?? null, target: value.nativeEvent.target, timeStamp: value.nativeEvent.timeStamp ?? value.nativeEvent.timestamp ?? null});
}
for (const type of rawTypes) RawEventEmitter.addListener(type, value => raw("typed", value));
RawEventEmitter.addListener("*", value => raw("star", value));
function capability(name) {
  const ref = panels.get(name).refs.only;
  return {flags: bootstrap.flags, original: ref instanceof OriginalEventTarget && ref instanceof ReactNativeElement,
    methods: ["addEventListener", "removeEventListener", "dispatchEvent"].map(key => typeof ref[key]),
    targetTag: ref.tag, connected: ref.isConnected, point: [75, 55], query: queryFaultControl.snapshot()};
}
// capture is true, false or "both" (one capture and one bubble listener). The
// listener sits on the hit target ("only") or on its original parent View.
function configure(name, capture = false, type = "pointerdown", where = "only") {
  if (!["pointerdown", "pointerup", "pointermove"].includes(type)) throw Error("Probe supports only declared pointerdown/pointerup/pointermove types");
  if (!["only", "parent"].includes(where)) throw Error("Probe listeners sit on the hit target or its parent View");
  reset(name); const panel = panels.get(name), ref = panel.refs[where];
  for (const phase of capture === "both" ? [true, false] : [capture]) {
    const callback = function(event) { record(name, type + (phase ? "-capture" : "-bubble"), this, event); };
    ref.addEventListener(type, callback, phase);
    panel.bindings.push({ref, callback, capture: phase, type});
  }
  return {targetTag: panel.refs.only.tag, capture, type, ...(where === "parent" ? {where, listenerTag: ref.tag} : {})};
}
function arm(name, caseId) {
  const panel = panels.get(name);
  active = {name, caseId, target: panel.refs.only, baselineStarts: panel.starts, baselineUps: panel.ups, baselineMoves: panel.moves,
    events: [], eventRefs: [], raw: [], payloads: new Map()};
  queryFaultControl.clearObservations();
  return {targetTag: active.target.tag, baselineStarts: active.baselineStarts};
}
function publicControl(name, type = "pointerdown") {
  if (!["pointerdown", "pointerup", "pointermove"].includes(type)) throw Error("Public control requires a declared pointer type");
  const ref = panels.get(name).refs.only, event = new OriginalEvent(type, {bubbles: true});
  const returned = ref.dispatchEvent(event);
  return {returned, trusted: event.isTrusted, targetMatches: event.target === ref,
    cleaned: event.currentTarget === null && event.eventPhase === OriginalEvent.NONE && event.composedPath().length === 0};
}
function snapshot() {
  return {flags: bootstrap.flags, caseId: active?.caseId ?? null, name: active?.name ?? null, targetTag: active?.target.tag ?? null,
    events: active ? [...active.events] : [], raw: active ? [...active.raw] : [], baselineStarts: active?.baselineStarts ?? null,
    baselineUps: active?.baselineUps ?? null, ...(active?.target != null && panels.get(active.name)?.probePointerMove ? {baselineMoves: active.baselineMoves} : {}),
    cleanup: active ? active.eventRefs.map(event => ({currentTargetNull: event.currentTarget === null, phase: event.eventPhase,
      pathEmpty: event.composedPath().length === 0, originalEvent: event instanceof OriginalEvent})) : [],
    panels: Object.fromEntries([...panels].map(([name, panel]) => [name, {starts: panel.starts, tag: panel.refs.only?.tag ?? null,
      ...(panel.probePointerUp ? {ups: panel.ups} : {}), ...(panel.probePointerMove ? {moves: panel.moves, parentTag: panel.refs.parent?.tag ?? null} : {})}])),
    mounts: {...mounts}, cleanups: {...cleanups}, query: queryFaultControl.snapshot(),
    currentPriority: nativeFabricUIManager.unstable_getCurrentEventPriority(), defaultPriority: nativeFabricUIManager.unstable_DefaultEventPriority,
    discretePriority: nativeFabricUIManager.unstable_DiscreteEventPriority,
    globalEventRestored: globalThis.event == null,
    scope: {actualNativeInput: true, realSDKQueryWrappedOnlyForTest: true, listenerRegistryMirrored: false,
      manualDispatchIsOnlyInstallationControl: true, publicDefaultEnabled: false, hardwareCertified: false}};
}
globalThis.QueryFaultProbe = {capability, configure, arm, publicControl, snapshot,
  fault(name, offset, mode, label) { return queryFaultControl.setFault({targetref: panels.get(name).refs.only, offset, mode, remaining: 1, label}); },
  clearFault() { return queryFaultControl.clearFault(); }};
