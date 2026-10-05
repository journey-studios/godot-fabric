import {bootstrap} from "./event-target-bootstrap";
import React, {useEffect, useRef, useState} from "react";
import {AppRegistry, View} from "react-native";
import RawEventEmitter from "react-native/Libraries/Core/RawEventEmitter";
import OriginalEvent from "../node_modules/react-native/src/private/webapis/dom/events/Event";
import * as OriginalEventTargetModule from "../node_modules/react-native/src/private/webapis/dom/events/EventTarget";
import ReactNativeElement from "../node_modules/react-native/src/private/webapis/dom/nodes/ReactNativeElement";
import LegacySyntheticEvent from "../node_modules/react-native/src/private/renderer/events/LegacySyntheticEvent";
import {getInternalInstanceHandleFromNativeTag, getInternalInstanceHandleFromPublicInstance} from "../src/private-interface";

const mode = __POINTER_INTEREST_PROBE_MODE__, panels = new Map(), retained = new Map(), mounts = {}, cleanups = {};
if (!["original", "current"].includes(mode)) throw Error("Unknown pointer-interest probe mode: " + mode);
let active = null, sequence = 0;
function queries(ref) {
  const query = Reflect.get(OriginalEventTargetModule, "hasPointerDownListenerForGodot");
  return {available: typeof query === "function", bubble: typeof query === "function" ? query(ref, false) : null,
    capture: typeof query === "function" ? query(ref, true) : null};
}
function payloadId(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (!active.payloads.has(payload)) active.payloads.set(payload, active.payloads.size + 1);
  return active.payloads.get(payload);
}
function record(name, id, label, ref, capture, receiver, event, action) {
  if (!active) return;
  const native = event.nativeEvent, expectedTarget = active.targetRef;
  const row = {sequence: ++sequence, name, id, label, source: label === "jsx" ? "jsx" : "imperative", capture,
    type: event.type, trusted: event.isTrusted, phase: event.eventPhase, currentMatches: event.currentTarget === ref,
    thisMatches: receiver === ref, targetMatches: event.target === expectedTarget, originalSynthetic: event instanceof LegacySyntheticEvent,
    currentTag: ref.tag ?? null, nativeTarget: native?.target ?? null, payloadId: payloadId(native), pointerId: native?.pointerId ?? null,
    timeStamp: event.timeStamp, nativeTimeStamp: native?.timeStamp ?? native?.timestamp ?? null,
    globalEventMatches: globalThis.event === event, queryBefore: queries(ref), queryAfter: null,
    pageX: native?.pageX ?? null, clientX: native?.clientX ?? null, offsetX: native?.offsetX ?? null};
  active.events.push(row); active.eventRefs.push(event);
  action?.(); row.queryAfter = queries(ref);
  if (event.isTrusted && panels.has(name)) panels.get(name).setCount(value => value + 1);
}
function add(name, id, label, capture = false, options = {}, action = null, keep = false) {
  const panel = panels.get(name), ref = id === "document" ? panel.refs.only.ownerDocument : panel.refs[id];
  const callback = function(event) { record(name, id, label, ref, capture, this, event, action); };
  const type = options.type ?? "pointerdown", registration = {...options, capture}; delete registration.type;
  ref.addEventListener(type, callback, registration);
  const binding = {ref, callback, type, capture, keep, remove: () => ref.removeEventListener(type, callback, capture)};
  panel.bindings.push(binding); return binding;
}
function reset(name) {
  const panel = panels.get(name);
  for (const binding of panel.bindings.splice(0)) if (!binding.keep) binding.remove();
  panel.abort = null; panel.finalBinding = null;
}
function Fixture({name}) {
  const refs = useRef({}).current, bindings = useRef([]).current;
  const [count, setCount] = useState(0), [revision, setRevision] = useState(0), [replacement, setReplacement] = useState(0);
  const previous = panels.get(name);
  panels.set(name, {refs, bindings, count, revision, replacement, setCount, setRevision, setReplacement,
    abort: previous?.abort ?? null, finalBinding: previous?.finalBinding ?? null});
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
    return () => { reset(name); cleanups[name] = (cleanups[name] ?? 0) + 1; panels.delete(name); };
  }, [name]);
  const attach = id => ref => { refs[id] = ref; };
  return <View ref={attach("parent")} testID={name + "-parent"} pointerEvents="box-none" style={{flex: 1, backgroundColor: "#0f172a"}}>
    <View ref={attach("only")} testID={name + "-only"}
      style={{position: "absolute", left: 20, top: 20, width: 110, height: 70, backgroundColor: revision % 2 ? "#38bdf8" : "#2563eb"}} />
    <View ref={attach("mixed")} testID={name + "-mixed"} onPointerDown={function(event) {
      record(name, "mixed", "jsx", refs.mixed, false, this, event);
    }} style={{position: "absolute", left: 200, top: 20, width: 120, height: 70, backgroundColor: "#0f766e"}} />
    <View ref={attach("flat")} style={{position: "absolute", left: 20, top: 120, width: 130, height: 90}}>
      <View ref={attach("child")} testID={name + "-child"} style={{position: "absolute", left: 10, top: 10, width: 80, height: 50, backgroundColor: "#7c3aed"}} />
    </View>
    <View key={replacement} ref={attach("replace")} testID={name + "-replace"}
      style={{position: "absolute", left: 200, top: 120, width: 120, height: 70, backgroundColor: replacement % 2 ? "#fbbf24" : "#d97706"}} />
    <View ref={attach("counter")} testID={name + "-counter"}
      style={{position: "absolute", left: 20, top: 225, width: 20 + count * 5, height: 15, backgroundColor: "#fde047"}} />
  </View>;
}
AppRegistry.registerComponent("PointerInterestProbe", () => Fixture);
function raw(channel, value) {
  if (!active || value.eventName !== "topPointerDown") return;
  active.raw.push({sequence: ++sequence, channel, type: value.eventName, payloadId: payloadId(value.nativeEvent),
    target: value.nativeEvent.target, pointerId: value.nativeEvent.pointerId,
    timeStamp: value.nativeEvent.timeStamp ?? value.nativeEvent.timestamp ?? null});
}
RawEventEmitter.addListener("topPointerDown", value => raw("typed", value));
RawEventEmitter.addListener("*", value => raw("star", value));
function capability(name) {
  const panel = panels.get(name), refs = panel.refs;
  return {name, mode, flags: bootstrap.flags, original: refs.only instanceof ReactNativeElement && refs.only instanceof OriginalEventTargetModule.default,
    methods: ["addEventListener", "removeEventListener", "dispatchEvent"].map(key => typeof refs.only[key]),
    tags: Object.fromEntries(Object.entries(refs).map(([id, ref]) => [id, ref?.tag ?? null])),
    logicalFlat: refs.child.parentNode === refs.flat && refs.flat.parentNode === refs.parent,
    flatNativeMetricsNull: refs.flat.getNativeMetrics() == null,
    flatOriginalHandleLive: getInternalInstanceHandleFromPublicInstance(refs.flat) != null &&
      getInternalInstanceHandleFromNativeTag(refs.flat.tag) === getInternalInstanceHandleFromPublicInstance(refs.flat),
    queries: queries(refs.only), points: {only: [75, 55], mixed: [260, 55], child: [70, 155], replace: [260, 155]}};
}
function arm(name, caseId, target = "only") {
  const panel = panels.get(name);
  active = {name, caseId, targetRef: panel.refs[target], events: [], eventRefs: [], raw: [], payloads: new Map(), baselineCount: panel.count};
  return {caseId, target, targetTag: active.targetRef.tag, queries: queries(active.targetRef)};
}
function configure(name, kind) {
  reset(name); const panel = panels.get(name);
  if (kind === "none") return {kind, queries: queries(panel.refs.only)};
  if (kind === "wrong-type") add(name, "only", "wrong-type", false, {type: "pointerup"});
  else if (kind === "capture") add(name, "only", "capture", true);
  else if (kind === "both") { add(name, "only", "capture", true); add(name, "only", "bubble"); }
  else if (kind === "duplicate") {
    const binding = add(name, "only", "duplicate"); binding.ref.addEventListener(binding.type, binding.callback, {once: true});
  } else if (kind === "once") add(name, "only", "once", false, {once: true});
  else if (kind === "abort-pre") {
    panel.abort = new AbortController(); panel.abort.abort(); add(name, "only", "abort-pre", false, {signal: panel.abort.signal});
  } else if (kind === "abort-after") {
    panel.abort = new AbortController(); add(name, "only", "abort-after", false, {signal: panel.abort.signal});
  } else if (kind === "remove-final") panel.finalBinding = add(name, "only", "remove-final");
  else if (kind === "remove-peer") {
    let peer;
    add(name, "only", "remove-peer", false, {once: true}, () => peer.remove());
    peer = add(name, "only", "peer-must-not-run");
  } else if (kind === "flat") { add(name, "flat", "flat-capture", true); add(name, "flat", "flat-bubble"); }
  else if (kind === "mixed") add(name, "mixed", "mixed-imperative");
  else if (kind === "document") add(name, "document", "document-only");
  else if (kind === "bubble") add(name, "only", "bubble");
  else throw Error("Unknown pointer-interest fixture case: " + kind);
  return {kind, queries: queries(panel.refs.only), flatQueries: queries(panel.refs.flat), documentQueries: queries(panel.refs.only.ownerDocument)};
}
function poke(name, target = "only", type = "pointerdown") {
  const ref = panels.get(name).refs[target], event = new OriginalEvent(type, {bubbles: true, cancelable: true});
  const returned = ref.dispatchEvent(event);
  return {returned, cleaned: event.currentTarget === null && event.eventPhase === OriginalEvent.NONE && event.composedPath().length === 0,
    trusted: event.isTrusted, targetMatches: event.target === ref};
}
function abortRegistered(name) {
  const panel = panels.get(name), before = queries(panel.refs.only); panel.abort.abort();
  return {before, after: queries(panel.refs.only), aborted: panel.abort.signal.aborted};
}
function removeFinal(name) {
  const panel = panels.get(name), before = queries(panel.refs.only); panel.finalBinding.remove();
  return {before, after: queries(panel.refs.only)};
}
function retain(name, key, id = "replace") {
  reset(name); const ref = panels.get(name).refs[id];
  const binding = add(name, id, "retained-" + key, false, {}, null, true);
  retained.set(key, {name, id, ref, tag: ref.tag, binding});
  return {key, tag: ref.tag, connected: ref.isConnected, query: queries(ref)};
}
function inspectRetained(key) {
  const old = retained.get(key);
  return {key, tag: old.tag, connected: old.ref.isConnected, parentNull: old.ref.parentNode === null,
    nativeLookupNull: getInternalInstanceHandleFromNativeTag(old.tag) === null, nativeMetricsNull: old.ref.getNativeMetrics() == null,
    sameAsCurrent: panels.get(old.name)?.refs[old.id] === old.ref, query: queries(old.ref)};
}
function pokeRetained(key) {
  const old = retained.get(key); active.targetRef = old.ref;
  const event = new OriginalEvent("pointerdown", {bubbles: true}), returned = old.ref.dispatchEvent(event);
  return {key, returned, cleaned: event.currentTarget === null && event.eventPhase === OriginalEvent.NONE && event.composedPath().length === 0,
    trusted: event.isTrusted, targetMatches: event.target === old.ref};
}
function snapshot() {
  return {mode, flags: bootstrap.flags, mounts: {...mounts}, cleanups: {...cleanups}, caseId: active?.caseId ?? null,
    events: active ? [...active.events] : [], raw: active ? [...active.raw] : [], baselineCount: active?.baselineCount ?? null,
    cleanup: active ? active.eventRefs.map(event => ({currentTargetNull: event.currentTarget === null, phase: event.eventPhase,
      pathEmpty: event.composedPath().length === 0, originalEvent: event instanceof OriginalEvent})) : [],
    panels: Object.fromEntries([...panels].map(([name, panel]) => [name, {count: panel.count, revision: panel.revision, replacement: panel.replacement}])),
    globalEventRestored: globalThis.event == null, currentPriority: nativeFabricUIManager.unstable_getCurrentEventPriority(),
    defaultPriority: nativeFabricUIManager.unstable_DefaultEventPriority,
    scope: {nativeInterestType: "View-pointerdown", rawPointerDownOnly: true, publicDefaultEnabled: false,
      documentInterestResolved: false, otherPointerTypesResolved: false, hardwareCertified: false}};
}
globalThis.PointerInterestProbe = {capability, arm, configure, poke, abortRegistered, removeFinal, retain, inspectRetained, pokeRetained, snapshot,
  rerender(name) { const panel = panels.get(name); const ref = panel.refs.only; retained.set(name + "/live", {ref, tag: ref.tag}); panel.setRevision(value => value + 1); return true; },
  inspectLive(name) { const old = retained.get(name + "/live"); return {sameRef: panels.get(name).refs.only === old.ref, sameTag: panels.get(name).refs.only.tag === old.tag, query: queries(old.ref)}; },
  replace(name) { panels.get(name).setReplacement(value => value + 1); return true; },
  removeImperative(name) { reset(name); return true; },
  disarm() { active = null; return true; }};
