import {bootstrap} from "./event-target-bootstrap";
import React, {useEffect, useLayoutEffect, useRef, useState} from "react";
import {AppRegistry, Text, View} from "react-native";
import RawEventEmitter from "react-native/Libraries/Core/RawEventEmitter";
import OriginalEvent from "../node_modules/react-native/src/private/webapis/dom/events/Event";
import OriginalEventTarget from "../node_modules/react-native/src/private/webapis/dom/events/EventTarget";
import ReactNativeElement from "../node_modules/react-native/src/private/webapis/dom/nodes/ReactNativeElement";
import dispatchNativeEvent from "../node_modules/react-native/src/private/renderer/events/dispatchNativeEvent";
import LegacySyntheticEvent from "../node_modules/react-native/src/private/renderer/events/LegacySyntheticEvent";
import ResponderEvent from "../node_modules/react-native/src/private/renderer/events/ResponderEvent";
import {getInternalInstanceHandleFromNativeTag, getInternalInstanceHandleFromPublicInstance} from "../src/private-interface";

const mode = __NATIVE_EVENT_INTEGRATION_PROBE_MODE__;
if (!["original", "integrated"].includes(mode)) throw Error("Unknown isolated renderer integration mode: " + mode);
const panels = new Map(), retained = new Map(), mounts = {}, cleanups = {}, lifecycle = [];
let active = null, sequence = 0;
const rawTypes = ["topTouchStart", "topTouchMove", "topTouchEnd", "topTouchCancel", "topPointerDown", "topPointerMove", "topPointerUp", "topPointerCancel"];
const tagOf = value => typeof value === "number" ? value : value?.tag ?? value?.__nativeTag ?? null;
const nativeTagOf = payload => payload?.target ?? payload?.changedTouches?.[0]?.target ?? null;
const finite = value => typeof value === "number" && Number.isFinite(value);
const cleanEvent = event => event.currentTarget === null && event.eventPhase === OriginalEvent.NONE && event.composedPath().length === 0;

function identity(value, collection) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return null;
  let id = collection.get(value);
  if (id === undefined) { id = collection.size + 1; collection.set(value, id); }
  return id;
}
function identifyTag(tag) {
  for (const [name, panel] of panels) for (const [id, ref] of Object.entries(panel.refs))
    if (ref?.tag === tag) return {name, id};
  return null;
}
function eventState(event, node) {
  const payload = event.nativeEvent, nativeTag = nativeTagOf(payload), target = identifyTag(nativeTag);
  const nativeTimeStamp = payload?.timeStamp ?? payload?.timestamp;
  return {eventId: identity(event, active.eventIdentities), payloadId: identity(payload, active.payloadIdentities),
    currentPriority: nativeFabricUIManager.unstable_getCurrentEventPriority(), defaultPriority: nativeFabricUIManager.unstable_DefaultEventPriority,
    type: event.type, originalSynthetic: event instanceof LegacySyntheticEvent, originalResponder: event instanceof ResponderEvent,
    trusted: event.isTrusted ?? null, phase: event.eventPhase ?? null, bubbles: event.bubbles ?? null, cancelable: event.cancelable ?? null,
    currentTargetMatches: event.currentTarget === node, currentTargetTag: tagOf(event.currentTarget), targetTag: tagOf(event.target),
    targetIsOriginalRef: Boolean(target && event.target === panels.get(target.name).refs[target.id]), nativeTarget: nativeTag, nativeTargetIdentity: target,
    globalEventMatches: globalThis.event === event, timeStamp: event.timeStamp ?? null, nativeTimeStamp: nativeTimeStamp ?? null,
    preservesNativeTimeStamp: finite(nativeTimeStamp) && event.timeStamp === nativeTimeStamp,
    defaultPrevented: event.defaultPrevented ?? event.isDefaultPrevented?.() ?? null,
    touches: payload?.touches?.length ?? null, changedTouches: payload?.changedTouches?.length ?? null,
    identifier: payload?.identifier ?? payload?.changedTouches?.[0]?.identifier ?? null,
    pointerId: payload?.pointerId ?? null, pageX: payload?.pageX ?? null, pageY: payload?.pageY ?? null,
    path: typeof event.composedPath === "function" ? event.composedPath().map(item => item === node.ownerDocument ? "document" :
      item === node.ownerDocument.documentElement ? "root" : identifyTag(item?.tag)) : null};
}
function maybeFault(id, source, capture, handler = null) {
  const fault = active.faults.find(item => item.remaining > 0 && item.id === id && item.source === source && item.capture === capture && item.handler === handler);
  if (!fault) return;
  fault.remaining--;
  active.faultAttempts.push({sequence: ++sequence, id, source, capture, handler, message: fault.error.message});
  // Actual native delivery must report this through the real host error path.
  // The fixture does not catch or suppress listener/renderer failures.
  throw fault.error;
}
function normal(name, id, source, capture, receiver, event) {
  if (!active) return;
  const panel = panels.get(name), node = panel.refs[id];
  const entry = {kind: "callback", sequence: ++sequence, name, id, source, capture, thisMatches: receiver === node,
    renderedCountAtEntry: panel.count, committedCountAtEntry: panel.committed.current, ...eventState(event, node)};
  active.events.push(entry); active.trace.push(entry); active.eventRefs.push({event, payload: event.nativeEvent});
  active.depth++;
  try {
    // Both installed callbacks are specifically touchstart handlers. The
    // compiled legacy synthetic event does not expose the EventTarget type.
    if (id === "mixed" && !capture && active.options.updateCount !== false) {
      active.updates.push({sequence: ++sequence, name, source, id});
      panel.setCount(value => value + 1);
    }
    if (!capture && active.options.preventDefault && id === active.options.actionTarget) event.preventDefault();
    if (!capture && active.options.stopPropagation && id === active.options.actionTarget) event.stopPropagation();
    maybeFault(id, source, capture);
  } finally {
    active.depth--;
    entry.defaultPreventedAtExit = event.defaultPrevented ?? event.isDefaultPrevented?.() ?? null;
    entry.committedCountAtExit = panels.get(name).committed.current;
    entry.exitSequence = ++sequence;
    active.trace.push({kind: "callback-exit", sequence: entry.exitSequence, name, id, source, capture});
  }
}
function responder(name, handler, event) {
  if (!active) return false;
  const node = panels.get(name).refs.responder, negotiation = handler === "should-set";
  const entry = {kind: negotiation ? "negotiation" : "responder", sequence: ++sequence, name, id: "responder", handler, ...eventState(event, node),
    activeTouches: event.touchHistory?.numberActiveTouches ?? null};
  active.responders.push(entry); active.trace.push(entry); active.responderRefs.push(event);
  maybeFault("responder", "responder", false, handler);
  if (negotiation) return active.options.responderShouldSet ?? true;
  if (handler === "grant") return active.options.blockNativeResponder === true;
  if (handler === "termination-request") return active.options.terminationRequest ?? true;
  return undefined;
}
function listen(node, type, callback, capture = false) {
  node.addEventListener(type, callback, capture);
  return () => node.removeEventListener(type, callback, capture);
}
function install(name) {
  const panel = panels.get(name);
  if (panel.removals.length > 0) return {installed: false, alreadyInstalled: true, count: panel.removals.length};
  const add = (id, type, capture = false) => panel.removals.push(listen(panel.refs[id], type, function(event) {
    normal(name, id, "imperative", capture, this, event);
  }, capture));
  add("only", "touchstart"); add("pointerOnly", "pointerdown");
  if (panel.refs.retired) add("retired", "touchstart");
  for (const id of ["mixedParent", "mixedFlat", "mixed"]) for (const capture of [true, false]) add(id, "touchstart", capture);
  return {installed: true, alreadyInstalled: false, count: panel.removals.length};
}
function removeListeners(name) {
  const panel = panels.get(name), count = panel.removals.length;
  panel.removals.splice(0).forEach(remove => remove());
  return {removed: count};
}
function Fixture({name}) {
  const refs = useRef({}).current, removals = useRef([]).current, committed = useRef(0);
  const [count, setCount] = useState(0), [retiredAlive, setRetiredAlive] = useState(true);
  panels.set(name, {refs, removals, committed, count, setCount, removeRetired: () => setRetiredAlive(false)});
  useLayoutEffect(() => {
    committed.current = count;
    const entry = {kind: "commit", sequence: ++sequence, name, count, callbackDepth: active?.depth ?? 0};
    lifecycle.push(entry);
    if (active) { active.commits.push(entry); active.trace.push(entry); }
  }, [name, count]);
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1; install(name);
    return () => {
      removeListeners(name); cleanups[name] = (cleanups[name] ?? 0) + 1;
      lifecycle.push({kind: "cleanup", sequence: ++sequence, name}); panels.delete(name);
    };
  }, [name]);
  const attach = id => ref => { refs[id] = ref; };
  const jsx = (id, capture) => function(event) { normal(name, id, "jsx", capture, this, event); };
  return <View ref={attach("parent")} testID={name + "-parent"} pointerEvents="box-none" style={{flex: 1}}>
    <Text style={{position: "absolute", left: 20, top: 0, width: 320, height: 18, color: "#f8fafc", fontSize: 12}}>{name} · original RN refs · {mode}</Text>
    {/* Neither this target nor any ancestor has JSX touch/pointer callbacks. */}
    <View ref={attach("only")} testID={name + "-only"}
      style={{position: "absolute", left: 20, top: 20, width: 80, height: 60, backgroundColor: "#38bdf8"}} />
    <View ref={attach("mixedParent")} testID={name + "-mixed-parent"} onTouchStartCapture={jsx("mixedParent", true)} onTouchStart={jsx("mixedParent", false)}
      style={{position: "absolute", left: 140, top: 20, width: 190, height: 90}}>
      <View ref={attach("mixedFlat")} style={{width: 180, height: 80}}>
        <View ref={attach("mixed")} testID={name + "-mixed"} onTouchStartCapture={jsx("mixed", true)} onTouchStart={jsx("mixed", false)}
          style={{position: "absolute", left: 10, top: 10, width: 70 + count, height: 50, backgroundColor: "#a78bfa"}} />
      </View>
    </View>
    {/* This remains a native-interest negative; integrating the renderer alone
        does not inform native ViewProps about an imperative pointer listener. */}
    <View ref={attach("pointerOnly")} testID={name + "-pointer-only"}
      style={{position: "absolute", left: 20, top: 110, width: 80, height: 50, backgroundColor: "#f59e0b"}} />
    <View ref={attach("responder")} testID={name + "-responder"}
      onStartShouldSetResponder={event => responder(name, "should-set", event)}
      onResponderGrant={event => responder(name, "grant", event)}
      onResponderStart={event => responder(name, "start", event)}
      onResponderMove={event => responder(name, "move", event)}
      onResponderEnd={event => responder(name, "end", event)}
      onResponderRelease={event => responder(name, "release", event)}
      onResponderTerminate={event => responder(name, "terminate", event)}
      onResponderTerminationRequest={event => responder(name, "termination-request", event)}
      style={{position: "absolute", left: 140, top: 130, width: 190, height: 90}}>
      <View ref={attach("responderFlat")} style={{width: 180, height: 80}}>
        <View ref={attach("first")} testID={name + "-first"} onTouchStart={jsx("first", false)}
          style={{position: "absolute", left: 10, top: 10, width: 50, height: 50, backgroundColor: "#34d399"}} />
        <View ref={attach("second")} testID={name + "-second"} style={{position: "absolute", left: 90, top: 10, width: 50, height: 50, backgroundColor: "#2dd4bf"}} />
      </View>
    </View>
    {retiredAlive && <View ref={attach("retired")} testID={name + "-retired"}
      style={{position: "absolute", left: 20, top: 190, width: 80, height: 40, backgroundColor: "#fb7185"}} />}
    <View ref={attach("counter")} testID={name + "-counter"}
      style={{position: "absolute", left: 140, top: 225, width: 20 + count * 10, height: 10, backgroundColor: "#f8fafc"}} />
    <Text style={{position: "absolute", left: 140, top: 237, width: 215, height: 18, color: "#f8fafc", fontSize: 11}}>Committed React updates: {count}</Text>
  </View>;
}
AppRegistry.registerComponent("NativeEventIntegratedProbe", () => Fixture);

function raw(channel, value) {
  if (!active) return;
  const payload = value.nativeEvent, entry = {kind: "raw", sequence: ++sequence, channel, type: value.eventName,
    currentPriority: nativeFabricUIManager.unstable_getCurrentEventPriority(), defaultPriority: nativeFabricUIManager.unstable_DefaultEventPriority,
    payloadId: identity(payload, active.payloadIdentities), nativeTarget: nativeTagOf(payload), nativeTargetIdentity: identifyTag(nativeTagOf(payload)),
    timeStamp: payload?.timeStamp ?? payload?.timestamp ?? null, touches: payload?.touches?.length ?? null,
    changedTouches: payload?.changedTouches?.length ?? null, identifier: payload?.identifier ?? payload?.changedTouches?.[0]?.identifier ?? null};
  active.raw.push(entry); active.trace.push(entry);
}
for (const type of rawTypes) RawEventEmitter.addListener(type, value => raw("typed", value));
RawEventEmitter.addListener("*", value => raw("star", value));

function capability(name) {
  const panel = panels.get(name), refs = panel.refs, only = refs.only;
  return {name, mode, flags: bootstrap.flags, originalElement: only instanceof ReactNativeElement, originalEventTarget: only instanceof OriginalEventTarget,
    methods: Object.fromEntries(["addEventListener", "removeEventListener", "dispatchEvent"].map(key => [key, typeof only[key]])),
    listenerCount: panel.removals.length, count: panel.count, committedCount: panel.committed.current,
    tags: Object.fromEntries(Object.entries(refs).map(([id, ref]) => [id, ref?.tag ?? null])),
    logicalMixedFlat: refs.mixed.parentNode === refs.mixedFlat && refs.mixedFlat.parentNode === refs.mixedParent,
    logicalResponderFlat: refs.first.parentNode === refs.responderFlat && refs.second.parentNode === refs.responderFlat && refs.responderFlat.parentNode === refs.responder,
    internalContactsContained: refs.responder.contains(refs.first) && refs.responder.contains(refs.second),
    independentImperativePath: only.parentNode === refs.parent && refs.pointerOnly.parentNode === refs.parent,
    originalGlobals: Event === OriginalEvent && EventTarget === OriginalEventTarget,
    points: {only: [60, 50], mixed: [185, 55], pointerOnly: [60, 135], first: [175, 165], second: [255, 165], retired: [60, 210]}};
}
function lookupCapabilities(name) {
  const refs = panels.get(name).refs;
  return {entries: Object.entries(refs).filter(([, ref]) => ref).map(([id, ref]) => {
    const publicHandle = getInternalInstanceHandleFromPublicInstance(ref), nativeHandle = getInternalInstanceHandleFromNativeTag(ref.tag);
    return {id, tag: ref.tag, connected: ref.isConnected, sameOriginalHandle: publicHandle != null && publicHandle === nativeHandle};
  }), invalidTagsNull: [undefined, null, "4", {}, -1, 0, 1.5, NaN, Infinity, 2 ** 53].every(tag => getInternalInstanceHandleFromNativeTag(tag) === null)};
}
function arm(name, caseId, options = {}) {
  const panel = panels.get(name);
  active = {name, caseId, options: {actionTarget: "mixed", ...options}, trace: [], events: [], responders: [], raw: [], updates: [], commits: [],
    eventRefs: [], responderRefs: [], eventIdentities: new Map(), payloadIdentities: new Map(), manualErrors: [], faultAttempts: [], faults: [],
    depth: 0, baselineCount: panel.count, baselineCommittedCount: panel.committed.current};
  return {caseId, mode, baselineCount: active.baselineCount, tags: capability(name).tags};
}
function configureFault(id = "mixed", source = "jsx", capture = false, handler = null, message = "Integrated native listener deliberate fault") {
  return configureFaults([{id, source, capture, handler, message}])[0];
}
function configureFaults(entries) {
  active.faults = entries.map(({id = "mixed", source = "jsx", capture = false, handler = null, message = "Integrated native listener deliberate fault"}) =>
    ({id, source, capture, handler, remaining: 1, error: Error(message)}));
  return active.faults.map(({id, source, capture, handler, error}) => ({id, source, capture, handler, message: error.message}));
}
function manual(name, id = "only", type = "touchstart") {
  const target = panels.get(name).refs[id], marker = active.caseId + "/manual", timestamp = 9000;
  const touch = {identifier: 1, target: target.tag, pageX: 25, pageY: 35, locationX: 5, locationY: 5, timestamp};
  const results = [];
  const call = (top, payload) => {
    let returned, caught = null;
    try { returned = dispatchNativeEvent(target, top, payload); }
    catch (error) { caught = {name: error.name, message: error.message}; active.manualErrors.push(caught); }
    results.push({top, returnedUndefined: returned === undefined, error: caught});
  };
  if (type === "touchstart") {
    call("topTouchStart", {...touch, touches: [touch], changedTouches: [touch], marker});
    call("topTouchEnd", {...touch, touches: [], changedTouches: [touch], marker});
  } else if (type === "pointerdown") call("topPointerDown", {target: target.tag, pointerId: 7, pointerType: "touch", pageX: 25, pageY: 35,
    clientX: 25, clientY: 35, screenX: 25, screenY: 35, offsetX: 5, offsetY: 5, pressure: 0.75, button: 0, buttons: 1, isPrimary: true, timeStamp: timestamp, marker});
  else throw Error("Unsupported explicit original positive control type: " + type);
  return {transport: "explicit-original-dispatchNativeEvent-real-ref", results};
}
function manualGlobalStep(name, id, phase, identifier, contacts) {
  if (!["start", "move", "end", "cancel"].includes(phase)) throw Error("Unsupported explicit global contact phase: " + phase);
  const timestamp = 10000 + ++sequence;
  const makeTouch = descriptor => {
    const ref = panels.get(descriptor.name).refs[descriptor.id], point = capability(descriptor.name).points[descriptor.id];
    if (!ref || !point || !Number.isInteger(descriptor.identifier) || descriptor.identifier < 0)
      throw Error("Global manual control requires a live public ref and a nonnegative integer identifier");
    return {identifier: descriptor.identifier, target: ref.tag, pageX: point[0], pageY: point[1], locationX: 5, locationY: 5, timestamp};
  };
  const changed = makeTouch({name, id, identifier}), touches = contacts.map(makeTouch);
  if (new Set(touches.map(touch => touch.identifier)).size !== touches.length)
    throw Error("Global manual control requires distinct active contact identifiers across roots");
  const target = panels.get(name).refs[id], top = "topTouch" + phase[0].toUpperCase() + phase.slice(1);
  // `contacts` is the caller's complete post-event active contact set. Dispatch
  // exactly once against the real public ref; this does not inject native input.
  const payload = {...changed, touches, changedTouches: [changed], targetTouches: touches.filter(touch => touch.target === changed.target),
    marker: active.caseId + "/manual-global/" + phase + "/" + identifier};
  let returned, caught = null, faultMatches = [];
  try { returned = dispatchNativeEvent(target, top, payload); }
  catch (error) {
    caught = {name: error.name, message: error.message}; active.manualErrors.push(caught);
    faultMatches = active.faults.flatMap((fault, index) => error === fault.error ? [index] : []);
  }
  return {transport: "explicit-original-dispatchNativeEvent-global-contact-descriptors", top, returnedUndefined: returned === undefined,
    error: caught, faultMatches, name, id, identifier, changedTargets: [changed.target], remainingTargets: touches.map(touch => touch.target),
    payload, contacts: contacts.map((descriptor, index) => ({...descriptor, target: touches[index].target})), dispatchCount: 1};
}
function retain(name, key, id = "retired") {
  const ref = panels.get(name).refs[id];
  retained.set(key, {ref, tag: ref.tag, parent: ref.parentNode, document: ref.ownerDocument, name, id});
  return {key, tag: ref.tag, connected: ref.isConnected, lookupLive: getInternalInstanceHandleFromNativeTag(ref.tag) != null};
}
function removeRetired(name, key = name + "/retired") {
  const result = retain(name, key); panels.get(name).removeRetired(); return result;
}
function inspectRetained(key) {
  const old = retained.get(key), trace = [], type = "gf-integrated-retired";
  const removals = [[old.ref, "self"], [old.parent, "former-parent"], [old.document, "former-document"]].filter(([ref]) => ref).map(([ref, label]) =>
    listen(ref, type, function(event) { trace.push({label, targetMatches: event.target === old.ref, currentMatches: event.currentTarget === ref,
      thisMatches: this === ref, trusted: event.isTrusted, phase: event.eventPhase}); }));
  const event = new OriginalEvent(type, {bubbles: true});
  const returned = old.ref.dispatchEvent(event); removals.forEach(remove => remove());
  return {key, tag: old.tag, connected: old.ref.isConnected, parentNull: old.ref.parentNode === null,
    nativeLookupNull: getInternalInstanceHandleFromNativeTag(old.tag) === null, returned, trace, cleaned: cleanEvent(event), publicManualOnly: true};
}
function snapshot() {
  const state = active;
  const payloads = state ? [...state.payloadIdentities.values()].map(payloadId => {
    const rawRows = state.raw.filter(entry => entry.payloadId === payloadId), normalRows = state.events.filter(entry => entry.payloadId === payloadId);
    return {payloadId, types: [...new Set(rawRows.map(entry => entry.type))], typed: rawRows.filter(entry => entry.channel === "typed").length,
      star: rawRows.filter(entry => entry.channel === "star").length, normalCallbacks: normalRows.length,
      jsxCallbacks: normalRows.filter(entry => entry.source === "jsx").length, imperativeCallbacks: normalRows.filter(entry => entry.source === "imperative").length};
  }) : [];
  return {mode, flags: bootstrap.flags, mounts: {...mounts}, cleanups: {...cleanups}, lifecycle: [...lifecycle],
    panels: Object.fromEntries([...panels].map(([name, panel]) => [name, {count: panel.count, committedCount: panel.committed.current,
      listenerCount: panel.removals.length, tags: Object.fromEntries(Object.entries(panel.refs).map(([id, ref]) => [id, ref?.tag ?? null]))}])),
    caseId: state?.caseId ?? null, baselineCount: state?.baselineCount ?? null, baselineCommittedCount: state?.baselineCommittedCount ?? null,
    trace: state ? [...state.trace] : [], events: state ? [...state.events] : [], responders: state ? [...state.responders] : [], raw: state ? [...state.raw] : [],
    updates: state ? [...state.updates] : [], commits: state ? [...state.commits] : [], payloads,
    manualErrors: state ? [...state.manualErrors] : [], faultAttempts: state ? [...state.faultAttempts] : [], callbackDepth: state?.depth ?? 0,
    configuredFaults: state ? state.faults.map(({id, source, capture, handler, remaining, error}) => ({id, source, capture, handler, remaining, message: error.message})) : [],
    cleanup: state ? state.eventRefs.map(({event, payload}) => ({originalEvent: event instanceof OriginalEvent,
      cleaned: event instanceof OriginalEvent ? cleanEvent(event) : null, targetTag: tagOf(event.target), nativePayloadRetained: event.nativeEvent === payload,
      currentTargetNull: event.currentTarget === null, phase: event.eventPhase ?? null})) : [],
    responderCleanup: state ? state.responderRefs.map(event => ({originalResponder: event instanceof ResponderEvent,
      currentTargetNull: event.currentTarget === null, phase: event.eventPhase ?? null,
      pathEmpty: typeof event.composedPath === "function" ? event.composedPath().length === 0 : null})) : [],
    globalEventRestored: globalThis.event == null, currentPriority: nativeFabricUIManager.unstable_getCurrentEventPriority(),
    defaultPriority: nativeFabricUIManager.unstable_DefaultEventPriority,
    scope: {requestedRendererMode: mode, testOnlyFlagsEnabled: true, explicitManualControls: true, publicDefaultEnabled: false,
      pointerImperativeInterestSolved: false, responderGapsResolved: false, physicalHardwareCertified: false}};
}
globalThis.NativeEventIntegratedProbe = {capability, lookupCapabilities, install, removeListeners, arm, configureFault, configureFaults,
  clearFault() { if (active) active.faults = []; return true; }, manual, manualGlobalStep, retain, removeRetired, inspectRetained, snapshot,
  disarm() { active = null; return true; },
  prepareStop(name, caseId = "stop-held") { return arm(name, caseId, {updateCount: false}); }};
