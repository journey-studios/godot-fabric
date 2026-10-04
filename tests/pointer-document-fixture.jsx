import {bootstrap, interestMode, documentQueryControl} from "./pointer-document-bootstrap";
import React, {useEffect, useRef, useState} from "react";
import {AppRegistry, View} from "react-native";
import RawEventEmitter from "react-native/Libraries/Core/RawEventEmitter";
import * as OriginalRenderer from "../node_modules/react-native/Libraries/Renderer/implementations/ReactFabric-prod";
import OriginalEvent from "../node_modules/react-native/src/private/webapis/dom/events/Event";
import OriginalEventTarget from "../node_modules/react-native/src/private/webapis/dom/events/EventTarget";
import ReactNativeDocument from "../node_modules/react-native/src/private/webapis/dom/nodes/ReactNativeDocument";
import ReactNativeElement from "../node_modules/react-native/src/private/webapis/dom/nodes/ReactNativeElement";
import LegacySyntheticEvent from "../node_modules/react-native/src/private/renderer/events/LegacySyntheticEvent";
import {getInternalInstanceHandleFromNativeTag, getInternalInstanceHandleFromPublicInstance,
  getNativeTagFromPublicInstance} from "../src/private-interface";

const panels = new Map(), retained = new Map(), mounts = {}, cleanups = {};
let active = null, sequence = 0;
const methods = object => object == null ? null : ["addEventListener", "removeEventListener", "dispatchEvent"].map(key => typeof object[key]);
function noRefSnapshot(name) {
  const panel = panels.get(name), handle = getInternalInstanceHandleFromNativeTag(panel.leafTag);
  return {noRef: panel.noRef, handleExists: handle != null,
    canonicalPresent: handle?.stateNode?.canonical != null,
    publicInstanceNull: handle?.stateNode?.canonical?.publicInstance == null,
    refAssigned: panel.refs.leaf != null, lazyHelperCalled: false};
}
function payloadId(payload) {
  if (payload == null || typeof payload !== "object") return null;
  if (!active.payloads.has(payload)) active.payloads.set(payload, active.payloads.size + 1);
  return active.payloads.get(payload);
}
function record(name, label, expectedCurrent, receiver, event) {
  if (active == null) return;
  const panel = panels.get(name), native = event.nativeEvent, manual = active.manualTarget != null;
  const targetTag = manual ? null : typeof event.target === "number" ? event.target : getNativeTagFromPublicInstance(event.target) ?? null;
  active.events.push({sequence: ++sequence, name, label, type: event.type ?? null,
    trusted: event.isTrusted === true, phase: event.eventPhase ?? null,
    thisMatches: receiver === expectedCurrent, currentMatches: event.currentTarget === expectedCurrent,
    targetMatches: manual ? event.target === active.manualTarget : targetTag === active.targetTag,
    targetTag, targetOriginalElement: event.target instanceof ReactNativeElement,
    ownerDocumentMatches: manual ? event.target === active.manualTarget : event.target?.ownerDocument === panel?.doc,
    originalEvent: event instanceof OriginalEvent, originalSynthetic: event instanceof LegacySyntheticEvent,
    compiledLegacySynthetic: !(event instanceof OriginalEvent) && typeof event.persist === "function" && typeof event.isPropagationStopped === "function",
    globalEventMatches: globalThis.event === event,
    payloadId: payloadId(native), nativeTarget: native?.target ?? null,
    timeStamp: event.timeStamp ?? null, nativeTimeStamp: native?.timeStamp ?? native?.timestamp ?? null,
    currentPriority: nativeFabricUIManager.unstable_getCurrentEventPriority(),
    ...(active.eventType === "pointerup" ? {pointerId: native?.pointerId ?? null,
      buttons: native?.buttons ?? null, pressure: native?.pressure ?? null, pointerType: native?.pointerType ?? null} : {})});
  active.eventRefs.push(event);
  if (native != null && panel != null &&
      (panel.eventType !== "pointerup" || !["TouchEnd", "TouchCancel"].includes(label))) panel.setCount(value => value + 1);
}
function reset(name) {
  const panel = panels.get(name);
  if (panel == null) return;
  for (const binding of panel.bindings.splice(0)) {
    if (!binding.keep) binding.ref.removeEventListener(binding.eventType, binding.callback, binding.capture);
  }
  panel.controller = null;
}
function Fixture({name, noRef = false, eventType = "pointerdown"}) {
  const panel = useRef({refs: {}, bindings: [], name, noRef, doc: null, element: null, surfaceId: null,
    leafTag: null, sentinelTag: null, controller: null, eventType}).current;
  const [count, setCount] = useState(0), [revision, setRevision] = useState(0), [faultTouch, setFaultTouch] = useState(false);
  Object.assign(panel, {count, setCount, revision, setRevision, faultTouch, setFaultTouch});
  panels.set(name, panel);
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
    return () => { reset(name); cleanups[name] = (cleanups[name] ?? 0) + 1; panels.delete(name); };
  }, [name]);
  return <View testID={name + "-parent"} pointerEvents="box-none" style={{flex: 1, backgroundColor: "#0f172a"}}>
    <View ref={noRef ? undefined : ref => { panel.refs.leaf = ref; }} testID={name + "-leaf"}
      onTouchStart={faultTouch ? function(event) { record(name, "TouchStart", event.currentTarget, this, event); } : undefined}
      onTouchEnd={panel.eventType === "pointerup" ? function(event) { record(name, "TouchEnd", event.currentTarget, this, event); } : undefined}
      onTouchCancel={panel.eventType === "pointerup" ? function(event) { record(name, "TouchCancel", event.currentTarget, this, event); } : undefined}
      style={{position: "absolute", left: 20, top: 20, width: 110, height: 70, backgroundColor: "#2563eb"}} />
    <View testID={name + "-sentinel"}
      onPointerDown={panel.eventType === "pointerdown" ? function(event) { record(name, "JSX", event.currentTarget, this, event); } : undefined}
      onPointerUp={panel.eventType === "pointerup" ? function(event) { record(name, "JSX", event.currentTarget, this, event); } : undefined}
      onTouchEnd={panel.eventType === "pointerup" ? function(event) { record(name, "TouchEnd", event.currentTarget, this, event); } : undefined}
      style={{position: "absolute", left: 200, top: 20, width: 120, height: 70, backgroundColor: "#0f766e"}} />
    <View testID={name + "-counter"} style={{position: "absolute", left: 20, top: 170, height: 15,
      width: 20 + count * 4, backgroundColor: "#fde047"}} />
    <View testID={name + "-revision"} style={{position: "absolute", left: 200, top: 170, height: 15,
      width: 20 + revision * 4, backgroundColor: "#a855f7"}} />
  </View>;
}
AppRegistry.registerComponent("PointerDocumentProbe", () => Fixture);
function raw(channel, value) {
  if (active == null) return;
  const selected = active.eventType === "pointerup"
    ? ["topPointerDown", "topPointerUp", "topTouchEnd", "topTouchCancel"].includes(value.eventName)
    : value.eventName === "topPointerDown" || (active.kind === "rootfault" && value.eventName === "topTouchStart");
  if (!selected) return;
  active.raw.push({sequence: ++sequence, channel, type: value.eventName, payloadId: payloadId(value.nativeEvent),
    target: value.nativeEvent.target, timeStamp: value.nativeEvent.timeStamp ?? value.nativeEvent.timestamp ?? null,
    ...(active.eventType === "pointerup" ? {pointerId: value.nativeEvent.pointerId ?? null,
      buttons: value.nativeEvent.buttons ?? null, pressure: value.nativeEvent.pressure ?? null,
      pointerType: value.nativeEvent.pointerType ?? null} : {})});
}
for (const type of ["topPointerDown", "topTouchStart", "topPointerUp", "topTouchEnd", "topTouchCancel"]) RawEventEmitter.addListener(type, value => raw("typed", value));
RawEventEmitter.addListener("*", value => raw("star", value));
function bindRoot(name, surfaceId, leafTag, sentinelTag) {
  const panel = panels.get(name), doc = OriginalRenderer.getPublicInstanceFromRootTag(surfaceId);
  if (!(doc instanceof ReactNativeDocument)) throw Error("Root getter must return the existing original Document");
  Object.assign(panel, {surfaceId, leafTag, sentinelTag, doc, element: doc.documentElement});
  const handle = getInternalInstanceHandleFromPublicInstance(doc.documentElement);
  documentQueryControl.bind(name, doc.documentElement, handle, () => noRefSnapshot(name));
  return capability(name);
}
function capability(name) {
  const panel = panels.get(name), doc = panel.doc, ref = panel.refs.leaf;
  return {name, flags: documentQueryControl.currentFlags(), mode: bootstrap.mode, interestMode,
    originalDoc: doc instanceof ReactNativeDocument, originalElement: panel.element instanceof ReactNativeElement,
    docEventTarget: doc instanceof OriginalEventTarget, rootEventTarget: panel.element instanceof OriginalEventTarget,
    leafEventTarget: ref == null ? null : ref instanceof OriginalEventTarget,
    methods: {doc: methods(doc), element: methods(panel.element), view: methods(ref)},
    docConnected: doc.isConnected, elementConnected: panel.element.isConnected,
    docOwnsElement: panel.element.ownerDocument === doc, docOwnsRef: ref == null ? null : ref.ownerDocument === doc,
    originalRootGetterIdentity: OriginalRenderer.getPublicInstanceFromRootTag(panel.surfaceId) === doc,
    distinctOtherRoot: [...panels.values()].every(other => other === panel || other.doc == null || other.doc !== doc),
    surfaceId: panel.surfaceId, leafTag: panel.leafTag, sentinelTag: panel.sentinelTag,
    noRef: noRefSnapshot(name), query: documentQueryControl.snapshot()};
}
function add(panel, ref, label, capture = false, options = {}, keep = false) {
  const callback = function(event) { record(panel.name, label, ref, this, event); };
  ref.addEventListener(panel.eventType, callback, {...options, capture});
  panel.bindings.push({ref, callback, capture, keep, label, eventType: panel.eventType});
}
function configure(name, kind, eventType = "pointerdown") {
  if (!["pointerdown", "pointerup"].includes(eventType)) throw Error("Unsupported document probe event type");
  reset(name); const panel = panels.get(name), doc = panel.doc, element = panel.element;
  panel.eventType = eventType;
  const D = bootstrap.flags.nativeDispatch, I = bootstrap.flags.imperative;
  if (kind === "all") {
    if (D) add(panel, doc, "DocC", true);
    if (D && I) { add(panel, element, "RootC", true); add(panel, element, "RootB"); }
    if (D) add(panel, doc, "DocB");
  } else if (kind === "element") {
    if (D && I) { add(panel, element, "RootC", true); add(panel, element, "RootB"); }
  } else if (kind === "doc-capture-only") {
    if (D) add(panel, doc, "DocC", true);
  } else if (kind === "element-capture-only") {
    if (D && I) add(panel, element, "RootC", true);
  } else if (kind === "doc") {
    if (D) { add(panel, doc, "DocC", true); add(panel, doc, "DocB"); }
  } else if (kind === "view") {
    if (D && I && panel.refs.leaf != null) add(panel, panel.refs.leaf, "ViewB");
  } else if (kind === "doc-once" || kind === "doc-remove" || kind === "doc-retain") {
    if (D) add(panel, doc, kind === "doc-retain" ? "OldDoc" : "DocB", false,
      kind === "doc-once" ? {once: true} : {}, kind === "doc-retain");
    if (kind === "doc-retain" && D && I) add(panel, element, "OldRoot", false, {}, true);
  } else if (kind === "doc-abort-pre" || kind === "doc-abort-after") {
    if (D) {
      panel.controller = new AbortController();
      if (kind === "doc-abort-pre") panel.controller.abort();
      add(panel, doc, "DocB", false, {signal: panel.controller.signal});
    }
  } else if (kind !== "none") throw Error("Unknown document configuration: " + kind);
  return {name, kind, installed: panel.bindings.map(binding => binding.label), noPrototypeBorrow: true,
    ...(eventType === "pointerup" ? {eventType} : {})};
}
function arm(name, caseId, target = "leaf", kind = "normal") {
  const panel = panels.get(name);
  active = {name, caseId, kind, eventType: panel.eventType, targetTag: target === "sentinel" ? panel.sentinelTag : panel.leafTag,
    manualTarget: null, baselineCount: panel.count, events: [], eventRefs: [], raw: [], payloads: new Map()};
  documentQueryControl.clearObservations();
  return {targetTag: active.targetTag, baselineCount: active.baselineCount};
}
function manualDocument(name) {
  const doc = panels.get(name).doc;
  if (typeof doc.dispatchEvent !== "function") return {available: false, noPrototypeBorrow: true};
  active.manualTarget = doc;
  const event = new OriginalEvent(panels.get(name).eventType, {bubbles: true}), returned = doc.dispatchEvent(event);
  return {available: true, returned, trusted: event.isTrusted, targetMatches: event.target === doc,
    cleaned: event.currentTarget === null && event.eventPhase === 0 && event.composedPath().length === 0,
    noPrototypeBorrow: true};
}
function manualElement(name) {
  const element = panels.get(name).element;
  if (typeof element.dispatchEvent !== "function") return {available: false, noPrototypeBorrow: true};
  active.manualTarget = element;
  const event = new OriginalEvent(panels.get(name).eventType, {bubbles: true}), returned = element.dispatchEvent(event);
  return {available: true, returned, trusted: event.isTrusted, targetMatches: event.target === element,
    cleaned: event.currentTarget === null && event.eventPhase === 0 && event.composedPath().length === 0,
    noPrototypeBorrow: true};
}
function retainRoot(name) {
  configure(name, "doc-retain");
  const panel = panels.get(name), key = name + "-" + panel.surfaceId;
  retained.set(key, {name, doc: panel.doc, element: panel.element, surfaceId: panel.surfaceId});
  return {key, surfaceId: panel.surfaceId};
}
function inspectRetained(key, name = "A") {
  const old = retained.get(key), current = panels.get(name);
  return {docConnected: old.doc.isConnected, elementConnected: old.element.isConnected,
    oldRootGetterNull: OriginalRenderer.getPublicInstanceFromRootTag(old.surfaceId) == null,
    currentDocFresh: current == null || current.doc !== old.doc,
    currentElementFresh: current == null || current.element !== old.element,
    methods: methods(old.doc), originalDoc: old.doc instanceof ReactNativeDocument};
}
function manualRetained(key) {
  const old = retained.get(key);
  if (typeof old.doc.dispatchEvent !== "function") return {available: false, noPrototypeBorrow: true};
  active.manualTarget = old.doc;
  const event = new OriginalEvent("pointerdown", {bubbles: true}), returned = old.doc.dispatchEvent(event);
  return {available: true, returned, trusted: event.isTrusted, targetMatches: event.target === old.doc,
    cleaned: event.currentTarget === null && event.eventPhase === 0 && event.composedPath().length === 0};
}
function snapshot() {
  const upRefs = active?.eventType === "pointerup" ? active.eventRefs.filter((event, index) =>
    !["TouchEnd", "TouchCancel"].includes(active.events[index].label)) : [];
  const touchEndRefs = active?.eventRefs.filter((event, index) => active.events[index].label === "TouchEnd") ?? [];
  return {flags: documentQueryControl.currentFlags(), mode: bootstrap.mode, interestMode, caseId: active?.caseId ?? null,
    name: active?.name ?? null, kind: active?.kind ?? null, targetTag: active?.targetTag ?? null,
    baselineCount: active?.baselineCount ?? null, events: active ? [...active.events] : [], raw: active ? [...active.raw] : [],
    cleanup: active ? active.eventRefs.map(event => ({currentTargetNull: event.currentTarget === null,
      phase: event.eventPhase ?? null, pathEmpty: typeof event.composedPath === "function" ? event.composedPath().length === 0 : null,
      originalEvent: event instanceof OriginalEvent})) : [],
    panels: Object.fromEntries([...panels].map(([name, panel]) => [name, {count: panel.count, revision: panel.revision,
      faultTouch: panel.faultTouch, surfaceId: panel.surfaceId, leafTag: panel.leafTag, noRef: noRefSnapshot(name)}])),
    mounts: {...mounts}, cleanups: {...cleanups}, query: documentQueryControl.snapshot(),
    currentPriority: nativeFabricUIManager.unstable_getCurrentEventPriority(), defaultPriority: nativeFabricUIManager.unstable_DefaultEventPriority,
    globalEventRestored: globalThis.event == null,
    ...(active?.eventType === "pointerup" ? {eventType: active.eventType,
      discretePriority: nativeFabricUIManager.unstable_DiscreteEventPriority,
      upEventIdentity: {callbackCount: upRefs.length,
        sameObject: upRefs.length > 0 ? upRefs.every(event => event === upRefs[0]) : null,
        touchEndDistinct: upRefs.length > 0 && touchEndRefs.length > 0
          ? touchEndRefs.every(event => !upRefs.includes(event)) : null}} : {})};
}
globalThis.PointerDocumentProbe = {bindRoot, capability, configure, arm, manualDocument, manualElement, snapshot, noRefSnapshot,
  resetAll() { for (const name of panels.keys()) reset(name); return true; },
  removeFinal(name) { reset(name); return true; },
  abortRegistered(name) { panels.get(name).controller?.abort(); return true; },
  rerender(name) { const panel = panels.get(name); panel.beforeIdentity = {doc: panel.doc, element: panel.element, ref: panel.refs.leaf};
    panel.setRevision(value => value + 1); return true; },
  inspectIdentity(name) { const panel = panels.get(name); return {docSame: panel.doc === panel.beforeIdentity.doc,
    elementSame: panel.element === panel.beforeIdentity.element, refSame: panel.refs.leaf === panel.beforeIdentity.ref,
    getterSame: OriginalRenderer.getPublicInstanceFromRootTag(panel.surfaceId) === panel.doc, revision: panel.revision}; },
  retainRoot, inspectRetained, manualRetained,
  prepareRootFault(name) { configure(name, "doc-remove"); panels.get(name).setFaultTouch(true); return true; },
  faultRoot(name, offset = 34, mode = "throw") {
    return documentQueryControl.setFault(panels.get(name).element, offset, mode, "root" + offset); },
  clearFault(name) { documentQueryControl.clearFault(); panels.get(name)?.setFaultTouch(false); return true; },
  rejectLateOverride() { return bootstrap.rejectedOverride(); },
};
