import {bootstrap, interestMode, documentQueryControl} from "./pointer-document-bootstrap";
import React, {useEffect, useRef, useState} from "react";
import {AppRegistry, View} from "react-native";
import RawEventEmitter from "react-native/Libraries/Core/RawEventEmitter";
import * as OriginalRenderer from "../node_modules/react-native/Libraries/Renderer/implementations/ReactFabric-prod";
import OriginalEvent from "../node_modules/react-native/src/private/webapis/dom/events/Event";
import ReactNativeDocument from "../node_modules/react-native/src/private/webapis/dom/nodes/ReactNativeDocument";
import LegacySyntheticEvent from "../node_modules/react-native/src/private/renderer/events/LegacySyntheticEvent";
import {getNativeTagFromPublicInstance} from "../src/private-interface";

// Original View refs, Documents and listeners only. JSX props observe capture
// notifications, hover on two leaves, the contact and its click; the container's
// pointerdown/pointermove props call the original ref capture methods. Added
// listeners exist only where the lane's flags expose methods. The probe drives
// actual Godot input and owns no listener registry.
const panels = new Map(), mounts = {}, cleanups = {};
const rawTypes = ["topGotPointerCapture", "topLostPointerCapture", "topPointerDown", "topPointerMove", "topPointerUp",
  "topPointerCancel", "topPointerOver", "topPointerOut", "topPointerEnter", "topPointerLeave", "topClick"];
const notificationTypes = [["got", "gotpointercapture"], ["lost", "lostpointercapture"]];
const captureKeys = ["L1", "L2", "S", "G", "C", "X"];
const methods = object => object == null ? null : ["addEventListener", "removeEventListener", "dispatchEvent"].map(key => typeof object[key]);
let active = null, sequence = 0;
function payloadId(payload) {
  if (payload == null || typeof payload !== "object") {
    return null;
  }
  if (!active.payloads.has(payload)) {
    active.payloads.set(payload, active.payloads.size + 1);
  }
  return active.payloads.get(payload);
}
const tagOf = value => value == null ? null : typeof value === "number" ? value : getNativeTagFromPublicInstance(value) ?? null;
function pointerFields(native) {
  return {pointerId: native?.pointerId ?? null, pointerType: native?.pointerType ?? null, button: native?.button ?? null,
    buttons: native?.buttons ?? null, isPrimary: native?.isPrimary ?? null, clientX: native?.clientX ?? null,
    clientY: native?.clientY ?? null, offsetX: native?.offsetX ?? null, offsetY: native?.offsetY ?? null,
    timeStamp: native?.timeStamp ?? native?.timestamp ?? null};
}
function record(name, label, kind, event) {
  if (active == null) {
    return;
  }
  const panel = panels.get(name), native = event.nativeEvent;
  active.events.push({sequence: ++sequence, name, label, kind, type: event.type ?? null, phase: event.eventPhase ?? null,
    trusted: event.isTrusted === true, targetTag: tagOf(event.target), currentTag: tagOf(event.currentTarget),
    currentIsDocument: event.currentTarget instanceof ReactNativeDocument,
    currentIsElement: panel != null && event.currentTarget === panel.element,
    originalEvent: event instanceof OriginalEvent, originalSynthetic: event instanceof LegacySyntheticEvent,
    compiledLegacySynthetic: !(event instanceof OriginalEvent) && typeof event.persist === "function",
    bubbles: event.bubbles ?? null, cancelable: event.cancelable ?? null,
    payloadId: payloadId(native), pointerId: native?.pointerId ?? null,
    // Inside got/lost, hasPointerCapture reads the pending owner at that moment.
    has: panel != null && (kind === "got" || kind === "lost") ? captures(panel, native?.pointerId) : null,
    currentPriority: nativeFabricUIManager.unstable_getCurrentEventPriority()});
}
function jsx(name, label, kind) {
  return event => record(name, label, kind, event);
}
// hasPointerCapture of every candidate for one pointer: the pending owner.
function captures(panel, pointerId) {
  return Object.fromEntries(captureKeys.map(key => [key, panel.refs[key] == null ? null : panel.refs[key].hasPointerCapture(pointerId)]));
}
function act(panel, at, action, node, pointerId) {
  if (action === "capture") {
    panel.refs[node].setPointerCapture(pointerId);
  } else if (action === "release") {
    panel.refs[node].releasePointerCapture(pointerId);
  } else if (action !== "check") {
    throw Error("Unknown capture action: " + action);
  }
  active?.actions.push({sequence: ++sequence, name: panel.name, at, action, node, pointerId, has: captures(panel, pointerId)});
}
// The container's contact props record each Down, Move, Up and Cancel that
// bubbles to it and run the case's plan: the nth Down captures the nth node
// ("-" only reads hasPointerCapture), and a scheduled action runs inside the
// next delivered move.
function contact(name, kind) {
  return event => {
    record(name, "C", kind, event);
    const panel = panels.get(name), pointerId = event.nativeEvent?.pointerId;
    if (kind === "down") {
      const node = panel.downs.shift();
      if (node === "-") {
        act(panel, "down", "check", "", pointerId);
      } else if (node != null) {
        act(panel, "down", "capture", node, pointerId);
      }
    } else if (kind === "move") {
      const step = panel.queue.shift();
      if (step != null) {
        act(panel, "move", step.action, step.node, pointerId);
      }
    }
  };
}
function notifications(name, label, withCapture = false) {
  return {onGotPointerCapture: jsx(name, label, "got"), onLostPointerCapture: jsx(name, label, "lost"),
    ...(withCapture ? {onGotPointerCaptureCapture: jsx(name, label + "-capture", "got"),
      onLostPointerCaptureCapture: jsx(name, label + "-capture", "lost")} : {})};
}
function hover(name, label) {
  return {onPointerOver: jsx(name, label, "over"), onPointerOut: jsx(name, label, "out"),
    onPointerEnter: jsx(name, label, "enter"), onPointerLeave: jsx(name, label, "leave")};
}
function Fixture({name}) {
  const panel = useRef({name, refs: {}, retained: {}, bindings: [], downs: [], queue: [], doc: null, element: null,
    surfaceId: null}).current;
  const [removed, setRemoved] = useState(false);
  Object.assign(panel, {removed, setRemoved});
  panels.set(name, panel);
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
    return () => {
      for (const binding of panel.bindings.splice(0)) {
        binding.ref.removeEventListener(binding.type, binding.callback, binding.capture);
      }
      cleanups[name] = (cleanups[name] ?? 0) + 1;
      panels.delete(name);
    };
  }, [name, panel]);
  const ref = key => value => { panel.refs[key] = value; };
  const box = (left, top, width, height, backgroundColor) => ({position: "absolute", left, top, width, height, backgroundColor});
  // Layout (root-relative): C 0,0 box-none; G 10,10 with L1 20,20 and L2 90,20
  // (both 50x40); S 160,10. X 230,10 is a second child of the root with no
  // listener at all. Empty root points lie right of C, below X.
  return <>
    <View ref={ref("C")} testID={name + "-container"} pointerEvents="box-none"
      style={{position: "absolute", left: 0, top: 0, width: 220, height: 200}}
      onPointerDown={contact(name, "down")} onPointerMove={contact(name, "move")} onPointerUp={contact(name, "up")}
      onPointerCancel={contact(name, "cancel")} onClick={jsx(name, "C", "click")} {...notifications(name, "C", true)}>
      <View ref={ref("G")} testID={name + "-group"} style={box(10, 10, 140, 70, "#1e293b")} {...notifications(name, "G")}>
        <View ref={ref("L1")} testID={name + "-left"} style={box(10, 10, 50, 40, "#2563eb")}
          {...notifications(name, "L1", true)} {...hover(name, "L1")} />
        {!removed && <View ref={ref("L2")} testID={name + "-right"} style={box(80, 10, 50, 40, "#16a34a")}
          {...notifications(name, "L2")} {...hover(name, "L2")} />}
      </View>
      <View ref={ref("S")} testID={name + "-side"} style={box(160, 10, 50, 70, "#9333ea")} {...notifications(name, "S")} />
    </View>
    <View ref={ref("X")} testID={name + "-other"} collapsable={false} style={box(230, 10, 60, 70, "#be123c")} />
    <View testID={name + "-removed"} style={box(230, 190, removed ? 40 : 10, 6, "#fde047")} />
  </>;
}
AppRegistry.registerComponent("PointerCaptureNotificationsProbe", () => Fixture);
function raw(value) {
  if (active == null || !rawTypes.includes(value.eventName)) {
    return;
  }
  active.raw.push({sequence: ++sequence, type: value.eventName, payloadId: payloadId(value.nativeEvent),
    target: value.nativeEvent?.target ?? null, ...pointerFields(value.nativeEvent)});
}
for (const type of rawTypes) {
  RawEventEmitter.addListener(type, raw);
}
function tags(name) {
  const refs = panels.get(name).refs;
  return Object.fromEntries(captureKeys.map(key => [key, tagOf(refs[key])]));
}
// Binds each root's original Document and registers the lane's original
// got/lost listeners: capture and bubble on the Document and documentElement,
// capture and bubble on L1 and bubble on G, wherever the flags expose methods.
function configure(name, surfaceId) {
  const panel = panels.get(name), doc = OriginalRenderer.getPublicInstanceFromRootTag(surfaceId);
  if (!(doc instanceof ReactNativeDocument)) {
    throw Error("Root getter must return the existing original Document");
  }
  Object.assign(panel, {surfaceId, doc, element: doc.documentElement});
  const installed = [];
  const add = (target, label, capture) => {
    if (typeof target?.addEventListener !== "function") {
      return;
    }
    for (const [kind, type] of notificationTypes) {
      const callback = function(event) { record(name, label, kind, event); };
      target.addEventListener(type, callback, capture);
      panel.bindings.push({ref: target, type, callback, capture});
    }
    installed.push(label);
  };
  add(doc, "DocC", true); add(panel.element, "RootC", true); add(panel.refs.L1, "L1C", true);
  add(panel.refs.L1, "L1B", false); add(panel.refs.G, "GB", false);
  add(panel.element, "RootB", false); add(doc, "DocB", false);
  return {name, flags: documentQueryControl.currentFlags(), mode: bootstrap.mode, interestMode, installed,
    methods: {doc: methods(doc), element: methods(panel.element), view: methods(panel.refs.L1)},
    captureMethods: ["setPointerCapture", "hasPointerCapture", "releasePointerCapture"].map(key => typeof panel.refs.L1?.[key]),
    tags: tags(name), query: documentQueryControl.snapshot()};
}
function arm(name, caseId, downs) {
  for (const panel of panels.values()) {
    panel.downs = [];
    panel.queue = [];
  }
  panels.get(name).downs = [...downs];
  active = {name, caseId, events: [], raw: [], actions: [], payloads: new Map()};
  documentQueryControl.clearObservations();
  return {caseId, tags: tags(name)};
}
// The pointer of the case's latest Down; outside handlers only reads state.
function current(name) {
  const down = active?.raw.filter(row => row.type === "topPointerDown").at(-1);
  const panel = panels.get(name);
  return {pointerId: down?.pointerId ?? null, has: down == null ? null : captures(panel, down.pointerId),
    retained: Object.fromEntries(Object.entries(panel.retained).map(([key, ref]) => [key,
      {connected: ref.isConnected, has: down == null ? null : ref.hasPointerCapture(down.pointerId)}]))};
}
function snapshot() {
  return {flags: bootstrap.flags, mode: bootstrap.mode, interestMode, caseId: active?.caseId ?? null, name: active?.name ?? null,
    events: active ? [...active.events] : [], raw: active ? [...active.raw] : [], actions: active ? [...active.actions] : [],
    panels: Object.fromEntries([...panels].map(([name, panel]) => [name, {removed: panel.removed, tags: tags(name),
      pending: {downs: panel.downs.length, queue: panel.queue.length}}])),
    mounts: {...mounts}, cleanups: {...cleanups}, query: documentQueryControl.snapshot(),
    currentPriority: nativeFabricUIManager.unstable_getCurrentEventPriority(),
    defaultPriority: nativeFabricUIManager.unstable_DefaultEventPriority,
    discretePriority: nativeFabricUIManager.unstable_DiscreteEventPriority,
    globalEventRestored: globalThis.event == null,
    scope: {actualNativeInput: true, originalHostComponents: true, originalCaptureMethods: true,
      realSDKQueryObservedOnlyForTest: true, listenerRegistryMirrored: false, publicDefaultEnabled: false,
      hardwareCertified: false}};
}
globalThis.PointerCaptureNotificationsProbe = {configure, arm, snapshot, tags, current,
  schedule(name, action, node) {
    panels.get(name).queue.push({action, node});
    return true;
  },
  remove(name, node) {
    if (node !== "L2") {
      throw Error("Only the right leaf can be removed");
    }
    const panel = panels.get(name);
    panel.retained[node] = panel.refs[node];
    panel.setRemoved(true);
    return true;
  },
  restore(name) {
    const panel = panels.get(name);
    panel.retained = {};
    panel.setRemoved(false);
    return true;
  }};
