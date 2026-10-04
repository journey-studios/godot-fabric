import {bootstrap} from "./event-target-bootstrap";
import React, {useEffect, useRef, useState} from "react";
import {AppRegistry, View} from "react-native";
import RawEventEmitter from "react-native/Libraries/Core/RawEventEmitter";
import {customBubblingEventTypes, customDirectEventTypes} from "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry";
import OriginalEvent from "../node_modules/react-native/src/private/webapis/dom/events/Event";
import OriginalEventTarget from "../node_modules/react-native/src/private/webapis/dom/events/EventTarget";
import ReactNativeElement from "../node_modules/react-native/src/private/webapis/dom/nodes/ReactNativeElement";
import dispatchNativeEvent from "../node_modules/react-native/src/private/renderer/events/dispatchNativeEvent";
import LegacySyntheticEvent from "../node_modules/react-native/src/private/renderer/events/LegacySyntheticEvent";
import ResponderEvent from "../node_modules/react-native/src/private/renderer/events/ResponderEvent";
import TouchHistory from "../node_modules/react-native/src/private/renderer/events/ResponderTouchHistoryStore";
import {getInternalInstanceHandleFromNativeTag, getInternalInstanceHandleFromPublicInstance} from "../src/private-interface";

const panels = new Map(), checks = [], gaps = [], errors = [], contexts = [], mounts = {}, cleanups = {};
let active = null, nextTimestamp = 1000, retiredLookup = null;
const check = (condition, name) => checks.push({name, passed: Boolean(condition)});
const equal = (actual, expected, name) => check(JSON.stringify(actual) === JSON.stringify(expected), name);
const labels = values => values.map(entry => entry.id + "/" + entry.source + "/" + (entry.capture ? "capture" : "bubble"));
function gap(id, observed, expectation, details) {
  gaps.push({id, observed: Boolean(observed), status: observed ? "original-gap-observed" : "gap-not-reproduced", expectation, details});
  check(observed, "gap/" + id + "/Original difference is actually reproduced");
}
function listen(node, type, callback, capture = false) {
  node.addEventListener(type, callback, capture);
  return () => node.removeEventListener(type, callback, capture);
}
function context() { return contexts[contexts.length - 1]; }
function eventClean(event) {
  return event.currentTarget === null && event.eventPhase === OriginalEvent.NONE && event.composedPath().length === 0;
}
function recordNormal(name, id, source, capture, receiver, event) {
  if (!active) return;
  const ctx = context(), node = panels.get(name).refs[id];
  const entry = {kind: "normal", name, id, source, capture, type: event.type, phase: event.eventPhase ?? null,
    trusted: event.isTrusted ?? null, currentMatches: event.currentTarget === node, thisMatches: receiver === node,
    targetMatches: ctx ? event.target === ctx.target : null, payloadSame: ctx ? event.nativeEvent === ctx.payload : null,
    phaseMatches: ctx ? event.eventPhase === (node === ctx.target ? OriginalEvent.AT_TARGET : capture ? OriginalEvent.CAPTURING_PHASE : OriginalEvent.BUBBLING_PHASE) : null,
    marker: event.nativeEvent?.marker ?? null, timeStamp: event.timeStamp, bubbles: event.bubbles ?? null,
    cancelable: event.cancelable ?? null, defaultPrevented: event.defaultPrevented ?? null,
    originalSynthetic: event instanceof LegacySyntheticEvent, pointerId: event.nativeEvent?.pointerId ?? null,
    pageX: event.nativeEvent?.pageX ?? null, clientX: event.nativeEvent?.clientX ?? null,
    pressure: event.nativeEvent?.pressure ?? null};
  active.normal.push(entry); active.trace.push(entry); active.normalEvents.push(event);
  active.lastEvent = event;
  const actions = active.actions;
  if (actions.stopCapture && id === "flat" && source === "imperative" && capture) event.stopPropagation();
  if (actions.stopImmediate && id === "first" && source === "jsx" && !capture) event.stopImmediatePropagation();
  if (actions.cancel && id === "first" && source === "imperative" && !capture) event.preventDefault();
  if (actions.throwNormal && id === "first" && !capture) {
    const marker = source === "jsx" ? active.jsxError : active.imperativeError;
    active.faultAttempts.push(marker.message); throw marker;
  }
  if (actions.reenter && id === "first" && source === "imperative" && !capture && ctx?.payload.marker === "outer") {
    const outerCurrent = event.currentTarget, nested = {...ctx.payload, marker: "nested", pointerId: 12, timeStamp: 4444.5};
    const result = perform(ctx.target, "topPointerDown", nested);
    active.reentrant = {caught: result.error, outerRestored: event.currentTarget === outerCurrent && globalThis.event === event,
      nestedCleaned: eventClean(active.lastEvent), separateEvents: active.lastEvent !== event};
  }
}
function recordResponder(name, id, handler, event) {
  if (!active) return;
  const ctx = context(), node = panels.get(name).refs[id], negotiation = handler.includes("ShouldSetResponder");
  const entry = {kind: negotiation ? "negotiation" : "lifecycle", name, id, handler, type: event.type,
    currentMatches: event.currentTarget === node, targetMatches: ctx ? event.target === ctx.target : null,
    payloadSame: ctx ? event.nativeEvent === ctx.payload : null, originalResponder: event instanceof ResponderEvent,
    trusted: event.isTrusted ?? null, phase: event.eventPhase ?? null, pathEmpty: typeof event.composedPath === "function" && event.composedPath().length === 0,
    activeTouches: event.touchHistory?.numberActiveTouches ?? null, changedTargets: event.nativeEvent?.changedTouches?.map(touch => touch.target) ?? [],
    remainingTargets: event.nativeEvent?.touches?.map(touch => touch.target) ?? []};
  active.trace.push(entry);
  if (negotiation) active.negotiation.push(entry);
  else { active.lifecycle.push(id + "/" + handler.replace("onResponder", "").toLowerCase()); active.lifecycleEvents.push(event); }
  if (active.faultAt === id + "/" + handler) {
    active.shouldFaultEvent = event;
    active.faultAttempts.push(active.handlerError.message); throw active.handlerError;
  }
  if (handler === "onResponderTerminationRequest") return active.termination;
  if (handler === "onResponderGrant") return false;
  if (handler.includes("ShouldSetResponder")) {
    const capture = handler.endsWith("Capture"), isMove = handler.includes("Move");
    return id === (isMove ? active.moveAt : active.startAt) && capture === (isMove ? false : active.startCapture) ? active.shouldReturn : false;
  }
  return undefined;
}
function handlers(name, id) {
  const result = {};
  for (const type of ["PointerDown", "PointerMove", "PointerUp", "PointerEnter", "TouchStart", "TouchMove", "TouchEnd", "TouchCancel"]) {
    for (const capture of [true, false]) result["on" + type + (capture ? "Capture" : "")] = function(event) {
      recordNormal(name, id, "jsx", capture, this, event);
    };
  }
  result.onLayout = function(event) { recordNormal(name, id, "jsx", false, this, event); };
  for (const handler of ["onStartShouldSetResponderCapture", "onStartShouldSetResponder", "onMoveShouldSetResponderCapture", "onMoveShouldSetResponder",
    "onResponderGrant", "onResponderStart", "onResponderMove", "onResponderEnd", "onResponderRelease", "onResponderTerminate", "onResponderReject", "onResponderTerminationRequest"])
    result[handler] = event => recordResponder(name, id, handler, event);
  return result;
}
function Fixture({name}) {
  const refs = useRef({}).current;
  const [otherAlive, setOtherAlive] = useState(true);
  panels.set(name, {refs, removeOther: () => setOtherAlive(false)});
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
    return () => { cleanups[name] = (cleanups[name] ?? 0) + 1; panels.delete(name); };
  }, [name]);
  const attach = id => instance => { refs[id] = instance; };
  return <View ref={attach("parent")} testID={name + "-parent"} pointerEvents="box-none" {...handlers(name, "parent")} style={{flex: 1}}>
    <View ref={attach("branch")} testID={name + "-branch"} {...handlers(name, "branch")}
      style={{position: "absolute", left: 20, top: 20, width: 140, height: 160}}>
      <View ref={attach("flat")} style={{width: 130, height: 140}}>
        <View ref={attach("first")} testID={name + "-first"} {...handlers(name, "first")}
          style={{position: "absolute", left: 10, top: 10, width: 50, height: 50}} />
        <View ref={attach("second")} testID={name + "-second"} {...handlers(name, "second")}
          style={{position: "absolute", left: 70, top: 10, width: 50, height: 50}} />
      </View>
    </View>
    {otherAlive && <View ref={attach("other")} testID={name + "-other"} {...handlers(name, "other")}
      style={{position: "absolute", left: 220, top: 20, width: 110, height: 100}} />
    }
  </View>;
}
AppRegistry.registerComponent("NativeEventDispatchProbe", () => Fixture);
RawEventEmitter.addListener("*", value => {
  if (!active) return;
  active.raw.push({type: value.eventName, target: value.nativeEvent?.target ?? null,
    changedTargets: value.nativeEvent?.changedTouches?.map(touch => touch.target) ?? [],
    remainingTargets: value.nativeEvent?.touches?.map(touch => touch.target) ?? []});
});

function arm(name, id, transport = "manual-original") {
  active = {name, id, transport, actions: {}, trace: [], normal: [], normalEvents: [], lifecycle: [], lifecycleEvents: [], negotiation: [],
    raw: [], errors: [], faultAttempts: [], contacts: new Map(), startAt: "branch", startCapture: false, moveAt: null,
    shouldReturn: true, termination: true, faultAt: null, handlerError: Error(id + " deliberate handler fault"),
    jsxError: Error("trusted JSX deliberate fault"), imperativeError: Error("trusted imperative deliberate fault")};
  return active;
}
function perform(target, type, payload) {
  const ctx = {target, type, payload}; contexts.push(ctx);
  let caught = null, value;
  try { value = dispatchNativeEvent(target, type, payload); }
  catch (error) {
    caught = error;
    const observation = {case: active.id, type, message: error.message, name: error.name,
      sameHandlerError: error === active.handlerError, sameJSXError: error === active.jsxError};
    active.errors.push(observation); errors.push(observation);
  } finally { contexts.pop(); }
  return {returnedUndefined: value === undefined, error: caught?.message ?? null, errorName: caught?.name ?? null,
    sameHandlerError: caught === active.handlerError, sameJSXError: caught === active.jsxError};
}
function capability(name) {
  const refs = panels.get(name).refs, first = refs.first;
  return {mode: bootstrap.mode, flags: bootstrap.flags, originalElement: first instanceof ReactNativeElement,
    originalEventTarget: first instanceof OriginalEventTarget, methods: ["addEventListener", "removeEventListener", "dispatchEvent"].map(key => typeof first[key]),
    logicalFlat: first.parentNode === refs.flat && refs.flat.parentNode === refs.branch && refs.branch.parentNode === refs.parent,
    flatTag: refs.flat.tag, firstTag: first.tag, branchTag: refs.branch.tag, parentTag: refs.parent.tag, otherTag: refs.other.tag,
    secondIsInside: refs.branch.contains(refs.second), otherIsOutside: !refs.branch.contains(refs.other)};
}
function nativePayload(target, marker = "normal") {
  return {target: target.tag, pointerId: 7, pointerType: "touch", clientX: 24.5, clientY: 35.5,
    pageX: 24.5, pageY: 35.5, screenX: 80.5, screenY: 90.5, offsetX: 4.5, offsetY: 5.5,
    pressure: 0.75, buttons: 1, button: 0, isPrimary: true, timeStamp: 1234.5, marker};
}
function installNormal(name, type) {
  const refs = panels.get(name).refs, document = refs.first.ownerDocument;
  refs.document = document; refs.root = document.documentElement;
  return ["document", "root", "parent", "branch", "flat", "first"].flatMap(id => [true, false].map(capture =>
    listen(refs[id], type, function(event) { recordNormal(name, id, "imperative", capture, this, event); }, capture)));
}
const fullOrder = ["document/imperative/capture", "root/imperative/capture", "parent/jsx/capture", "parent/imperative/capture",
  "branch/jsx/capture", "branch/imperative/capture", "flat/imperative/capture", "first/jsx/capture", "first/imperative/capture",
  "first/jsx/bubble", "first/imperative/bubble", "flat/imperative/bubble", "branch/jsx/bubble", "branch/imperative/bubble",
  "parent/jsx/bubble", "parent/imperative/bubble", "root/imperative/bubble", "document/imperative/bubble"];
function exactNormal(prefix, expected, payload, target) {
  equal(labels(active.normal), expected, prefix + "/Exact JSX-before-imperative capture and bubble order");
  check(active.normal.length === expected.length && active.normal.every(entry => entry.currentMatches && entry.thisMatches && entry.targetMatches &&
    entry.phase === (entry.id === "first" ? OriginalEvent.AT_TARGET : entry.capture ? OriginalEvent.CAPTURING_PHASE : OriginalEvent.BUBBLING_PHASE)),
    prefix + "/Every callback has original target currentTarget this and exact phase");
  check(active.normal.length > 0 && active.normal.every(entry => entry.trusted === true && entry.originalSynthetic && entry.payloadSame &&
    entry.timeStamp === (payload.timeStamp ?? payload.timestamp) && entry.pointerId === payload.pointerId &&
    entry.clientX === payload.clientX && entry.pageX === payload.pageX && entry.pressure === payload.pressure),
    prefix + "/Original trusted bridge preserves payload identity timestamp and native values");
  check(active.normalEvents.every(event => eventClean(event) && event.target === target && event.nativeEvent === payload), prefix + "/Trusted dispatch clears transient fields while preserving native payload and target");
  check(active.raw.length === 0, prefix + "/Explicit dispatcher call does not impersonate RawEventEmitter transport");
}
function testNormal(name) {
  const target = panels.get(name).refs.first, stages = {};
  for (const variant of ["normal", "timestamp-fallback", "zero-timestamp", "skip-bubbling", "direct", "cancel", "stop-capture", "stop-immediate", "trusted-fault", "fault-recovery", "reentrant"]) {
    arm(name, name + "/" + variant);
    const type = variant === "skip-bubbling" ? "pointerenter" : variant === "direct" ? "layout" : "pointerdown";
    const top = variant === "skip-bubbling" ? "topPointerEnter" : variant === "direct" ? "topLayout" : "topPointerDown";
    const removals = installNormal(name, type), payload = nativePayload(target, variant === "reentrant" ? "outer" : variant);
    if (variant === "timestamp-fallback") { delete payload.timeStamp; payload.timestamp = 3456.25; }
    if (variant === "zero-timestamp") payload.timeStamp = 0;
    active.actions = {cancel: variant === "cancel", stopCapture: variant === "stop-capture", stopImmediate: variant === "stop-immediate",
      throwNormal: variant === "trusted-fault", reenter: variant === "reentrant"};
    const result = perform(target, top, payload), prefix = name + "/" + variant;
    if (variant === "trusted-fault") {
      check(result.sameJSXError && active.errors.length === 1 && active.faultAttempts.length === 2, prefix + "/First synchronous listener error is rethrown once after both faulty peers execute");
      exactNormal(prefix, fullOrder, payload, target);
    } else if (variant === "reentrant") {
      const outer = active.normal.filter(entry => entry.marker === "outer"), nested = active.normal.filter(entry => entry.marker === "nested");
      equal(labels(outer), fullOrder, prefix + "/Outer dispatch completes exact original path");
      equal(labels(nested), fullOrder, prefix + "/Fresh nested native dispatch completes exact original path");
      check(active.reentrant && !active.reentrant.caught && active.reentrant.outerRestored && active.reentrant.nestedCleaned && active.reentrant.separateEvents,
        prefix + "/Reentrancy restores outer currentTarget global event and independent inner event cleanup");
      check(active.normal.length === 36 && active.normal.every(entry => entry.payloadSame && entry.trusted && entry.currentMatches && entry.thisMatches && entry.targetMatches),
        prefix + "/Nested payload context and callback identity never leak to outer dispatch");
      check(active.normalEvents.every(eventClean) && active.errors.length === 0 && active.raw.length === 0, prefix + "/Both trusted dispatches finish without stale transient fields or transport delivery");
    } else {
      check(result.error === null && result.returnedUndefined, prefix + "/Original dispatcher returns void without error");
      const expected = variant === "skip-bubbling" ? fullOrder.slice(0, 11) : variant === "direct" ?
        ["document/imperative/capture", "root/imperative/capture", "parent/imperative/capture", "branch/imperative/capture", "flat/imperative/capture", "first/imperative/capture", "first/jsx/bubble", "first/imperative/bubble"] :
        variant === "stop-capture" ? fullOrder.slice(0, 7) : variant === "stop-immediate" ? fullOrder.slice(0, 10) : fullOrder;
      exactNormal(prefix, expected, payload, target);
      if (variant === "cancel") check(active.lastEvent.defaultPrevented && active.lastEvent.isDefaultPrevented() && active.normal.some(entry => entry.id === "parent" && !entry.capture && entry.defaultPrevented),
        prefix + "/Native cancelable bridge preserves preventDefault while later ancestor listeners continue");
      if (variant === "direct") check(!active.lastEvent.bubbles && active.lastEvent.dispatchConfig === customDirectEventTypes.topLayout,
        prefix + "/Direct view config preserves original direct dispatch metadata");
      if (variant === "skip-bubbling") check(!active.lastEvent.bubbles && active.lastEvent.dispatchConfig === customBubblingEventTypes.topPointerEnter,
        prefix + "/skipBubbling keeps ancestor capture and limits bubble to target");
      if (variant === "normal") { active.lastEvent.persist(); check(active.lastEvent.nativeEvent === payload && !active.lastEvent.isPropagationStopped(), prefix + "/Original legacy bridge persist and propagation wrappers remain usable"); }
    }
    stages[variant] = {result, normal: [...active.normal], errors: [...active.errors], raw: [...active.raw]};
    removals.forEach(remove => remove());
  }
  arm(name, name + "/unregistered");
  let calls = 0;
  const remove = listen(target, "fabricunregistered", () => calls++);
  target.dispatchEvent(new OriginalEvent("fabricunregistered"));
  check(calls === 1, name + "/unregistered/Actual original ref listener positively responds to public Event dispatch");
  calls = 0;
  const inert = perform(target, "topFabricUnregistered", nativePayload(target));
  check(inert.error === null && calls === 0 && active.normal.length === 0, name + "/unregistered/Unregistered top-level event creates no native synthetic event");
  remove();
  stages.unregistered = {calls, result: inert};
  return stages;
}
function testNullTargets(name) {
  arm(name, "null-targets");
  const unregistered = perform(null, "topFabricUnregistered", {timeStamp: 9000});
  check(unregistered.error === null && active.normal.length === 0, "null-target/Unregistered null-target event is inert in original dispatcher");
  const registered = perform(null, "topPointerDown", {pointerId: 1, timeStamp: 9001});
  check(registered.errorName === "TypeError" && active.errors.length === 1 && active.normal.length === 0,
    "null-target/Registered null target throws synchronously before any listener");
  const recovery = perform(panels.get(name).refs.first, "topPointerDown", nativePayload(panels.get(name).refs.first));
  check(recovery.error === null && active.normal.length === 6 && active.normalEvents.every(eventClean), "null-target/Next registered dispatch to a real original ref recovers");
  return {unregistered, registered, recovery, registeredNullAccepted: false, malformedInputOnly: true};
}
function testJSXFastPath(name) {
  const target = panels.get(name).refs.first, stages = {}, expected = ["parent/jsx/capture", "branch/jsx/capture", "first/jsx/capture",
    "first/jsx/bubble", "branch/jsx/bubble", "parent/jsx/bubble"];
  // No pointermove imperative listener is ever installed by this fixture. This
  // exercises the original prop-only invoke branch, including its catch path.
  for (const fault of [true, false]) {
    const id = fault ? "jsx-fast-path-fault" : "jsx-fast-path-recovery";
    arm(name, name + "/" + id); active.actions.throwNormal = fault;
    const payload = nativePayload(target, id), result = perform(target, "topPointerMove", payload), prefix = name + "/" + id;
    equal(labels(active.normal), expected, prefix + "/Prop-only trusted invoke preserves complete capture and bubble peer order");
    check(active.normal.length === 6 && active.normal.every(entry => entry.source === "jsx" && entry.currentMatches && entry.thisMatches &&
      entry.targetMatches && entry.payloadSame && entry.trusted && entry.originalSynthetic && entry.phase ===
      (entry.id === "first" ? OriginalEvent.AT_TARGET : entry.capture ? OriginalEvent.CAPTURING_PHASE : OriginalEvent.BUBBLING_PHASE)),
      prefix + "/Every JSX-only callback observes exact original phase receiver and native payload");
    check(fault ? result.sameJSXError && active.errors.length === 1 && active.faultAttempts.length === 1 : result.error === null && active.errors.length === 0,
      prefix + "/Prop-only fault is rethrown once and subsequent prop-only dispatch recovers");
    check(active.normalEvents.length === 6 && active.normalEvents.every(eventClean) && active.raw.length === 0,
      prefix + "/Prop-only dispatch clears transient event fields without native transport or pending errors");
    stages[id] = {result, normal: [...active.normal], errors: [...active.errors]};
  }
  return stages;
}
function testImperativeOnly(name) {
  arm(name, name + "/imperative-only-flat");
  const target = panels.get(name).refs.flat, payload = nativePayload(target, "imperative-only-flat");
  const removals = [true, false].map(capture => listen(target, "pointerup", function(event) {
    recordNormal(name, "flat", "imperative", capture, this, event);
  }, capture));
  const result = perform(target, "topPointerUp", payload), prefix = name + "/imperative-only-flat";
  equal(labels(active.normal), ["parent/jsx/capture", "branch/jsx/capture", "flat/imperative/capture", "flat/imperative/bubble", "branch/jsx/bubble", "parent/jsx/bubble"],
    prefix + "/Registered native event reaches imperative-only flattened target without target JSX interest");
  check(result.error === null && active.normal.length === 6 && active.normal.every(entry => entry.currentMatches && entry.thisMatches && entry.targetMatches &&
    entry.payloadSame && entry.originalSynthetic && entry.trusted && entry.phase === (entry.id === "flat" ? OriginalEvent.AT_TARGET :
      entry.capture ? OriginalEvent.CAPTURING_PHASE : OriginalEvent.BUBBLING_PHASE)),
    prefix + "/Imperative-only real logical ref receives trusted exact target and phase through original dispatcher");
  check(active.normalEvents.every(eventClean) && active.raw.length === 0 && !active.normal.some(entry => entry.id === "flat" && entry.source === "jsx"),
    prefix + "/Positive manual original delivery is independent from absent native interest and leaves no callback state");
  removals.forEach(remove => remove());
  return {result, normal: [...active.normal], raw: [...active.raw], flattenedTargetTag: target.tag, manualOriginalOnly: true};
}
function crossRoots() {
  arm("A", "cross-roots");
  const a = panels.get("A").refs.first, b = panels.get("B").refs.first, trace = [];
  const removeA = listen(a.ownerDocument, "pointerdown", event => trace.push({root: "A", correct: event.target === a}));
  const removeB = listen(b.ownerDocument, "pointerdown", event => trace.push({root: "B", correct: event.target === b}));
  perform(a, "topPointerDown", nativePayload(a)); perform(b, "topPointerDown", nativePayload(b)); removeA(); removeB();
  equal(trace.map(entry => entry.root), ["A", "B"], "shared/Explicit trusted dispatch follows only its own actual document");
  check(a.ownerDocument !== b.ownerDocument && trace.length === 2 && trace.every(entry => entry.correct) && active.errors.length === 0,
    "shared/Distinct original documents and correct real targets survive shared Hermes dispatch");
  return {trace, differentDocuments: a.ownerDocument !== b.ownerDocument};
}

const ordinary = ["branch/grant", "branch/start", "branch/move", "branch/end", "branch/release"];
const accepted = ["first/grant", "first/start", "parent/grant", "first/terminationrequest", "first/terminate", "parent/move", "parent/end", "parent/release"];
const rejected = ["first/grant", "first/start", "parent/grant", "first/terminationrequest", "parent/reject", "first/move", "first/end", "first/release"];
function beginScenario(name, id, transport = "manual-original") {
  arm(name, id, transport);
  if (id === "capture") { active.startAt = "parent"; active.startCapture = true; }
  if (id.startsWith("transfer") || id === "undefined-termination") { active.startAt = "first"; active.moveAt = "parent"; }
  if (id === "transfer-reject") active.termination = false;
  if (id === "undefined-termination") active.termination = undefined;
  if (id === "truthy-should") active.shouldReturn = 1;
  if (id === "should-fault") active.faultAt = "parent/onStartShouldSetResponderCapture";
  if (id === "grant-fault") active.faultAt = "branch/onResponderGrant";
  if (id === "lifecycle-fault") active.faultAt = "branch/onResponderStart";
  const refs = panels.get(name).refs;
  return {first: refs.first.tag, second: refs.second.tag, branch: refs.branch.tag, parent: refs.parent.tag, other: refs.other.tag,
    mode: bootstrap.mode, transport};
}
function manualStep(name, phase, who, identifier) {
  const refs = panels.get(name).refs, target = refs[who], timestamp = ++nextTimestamp;
  const touch = {identifier, target: target.tag, pageX: who === "other" ? 250 : who === "second" ? 110 : 50,
    pageY: 50, locationX: 10, locationY: 10, timestamp, timeStamp: timestamp};
  if (phase === "start" || phase === "move") active.contacts.set(identifier, touch);
  else active.contacts.delete(identifier);
  const payload = {...touch, changedTouches: [touch], touches: [...active.contacts.values()], marker: active.id + "/" + phase + "/" + identifier};
  const result = perform(target, "topTouch" + phase[0].toUpperCase() + phase.slice(1), payload);
  return {...result, lifecycle: [...active.lifecycle], remainingTargets: payload.touches.map(item => item.target),
    changedTargets: payload.changedTouches.map(item => item.target), activeTouches: TouchHistory.touchHistory.numberActiveTouches};
}
function expectedLifecycle(id, legacy = false) {
  if (id === "capture") return ["parent/grant", "parent/start", "parent/end", "parent/release"];
  if (id === "cancel") return ["branch/grant", "branch/start", "branch/end", "branch/terminate"];
  if (id === "transfer-accept" || id === "undefined-termination" && !legacy) return accepted;
  if (id === "transfer-reject" || id === "undefined-termination" && legacy) return rejected;
  if (id === "inside-two" || id === "outside-two" && !legacy) return ["branch/grant", "branch/start", "branch/start", "branch/end", "branch/end", "branch/release"];
  if (id === "outside-two" && legacy) return ["branch/grant", "branch/start", "branch/start", "branch/end", "branch/release"];
  if (id === "should-fault" || id === "truthy-should" && !legacy) return [];
  if (id === "truthy-should" || id === "recovery") return ["branch/grant", "branch/start", "branch/end", "branch/release"];
  return ordinary;
}
function finishScenario(name, id, transport = "manual-original") {
  const legacy = transport === "native-compiled-legacy", prefix = transport + "/" + id, expected = expectedLifecycle(id, legacy);
  equal(active.lifecycle, expected, prefix + "/Exact responder grant start move end release terminate and transfer sequence");
  if (!legacy) {
    const fault = id.endsWith("fault");
    check(active.errors.length === (fault ? 1 : 0) && active.errors.every(entry => entry.sameHandlerError), prefix + "/Expected synchronous handler error is caught once without unrelated errors");
    check(active.lifecycleEvents.every(event => event.currentTarget === null && event instanceof ResponderEvent), prefix + "/Original responder lifecycle cleans currentTarget after every handler including errors");
    check(active.normalEvents.every(event => eventClean(event) && event.isTrusted && event instanceof LegacySyntheticEvent), prefix + "/Normal trusted touch delivery finishes cleanup after negotiation");
    const groups = new Map();
    for (const entry of active.normal) {
      if (!groups.has(entry.marker)) groups.set(entry.marker, []);
      groups.get(entry.marker).push(entry);
    }
    check(groups.size === (id === "should-fault" ? 1 : id === "inside-two" || id === "outside-two" ? 4 : id === "capture" || id === "cancel" || id === "recovery" || id === "truthy-should" ? 2 : 3),
      prefix + "/Every expected touch dispatch positively delivers its complete normal event");
    for (const [marker, entries] of groups) {
      const who = entries.find(entry => entry.phase === OriginalEvent.AT_TARGET)?.id;
      const expectedOrder = who === "other" ? ["parent/capture", "other/capture", "other/bubble", "parent/bubble"] :
        ["parent/capture", "branch/capture", who + "/capture", who + "/bubble", "branch/bubble", "parent/bubble"];
      equal(entries.map(entry => entry.id + (entry.capture ? "/capture" : "/bubble")), expectedOrder, prefix + "/Exact positive touch capture/bubble order: " + marker);
      check(entries.every(entry => entry.currentMatches && entry.targetMatches && entry.payloadSame && entry.phaseMatches && entry.trusted && entry.originalSynthetic),
        prefix + "/All touch callbacks preserve payload target currentTarget and phase: " + marker);
    }
    check(active.trace.filter(entry => entry.kind === "lifecycle").every(entry => entry.currentMatches && entry.targetMatches && entry.payloadSame && entry.originalResponder),
      prefix + "/Each real responder callback observes original event class currentTarget target and payload");
    check(active.trace.filter(entry => entry.kind !== "normal").length > 0 && active.trace.filter(entry => entry.kind !== "normal").every(entry =>
      entry.originalResponder && entry.trusted === false && entry.phase === OriginalEvent.NONE && entry.pathEmpty),
      prefix + "/Original direct negotiation and lifecycle stay untrusted at NONE with an empty propagation path");
    check(active.contacts.size === 0 && TouchHistory.touchHistory.numberActiveTouches === 0 && TouchHistory.touchHistory.touchBank.every(touch => !touch || !touch.touchActive),
      prefix + "/Every manual contact balances through original touch history");
    check(active.raw.length === 0, prefix + "/Manual dispatcher remains separate from compiled native RawEventEmitter");
    const firstStart = active.negotiation.filter(entry => entry.type === "startShouldSetResponder" && entry.changedTargets[0] === panels.get(name).refs.first.tag);
    const expectedNegotiation = id === "capture" ? ["parent/onStartShouldSetResponderCapture"] : id === "should-fault" ? ["parent/onStartShouldSetResponderCapture"] :
      ["parent/onStartShouldSetResponderCapture", "branch/onStartShouldSetResponderCapture", "first/onStartShouldSetResponderCapture", "first/onStartShouldSetResponder",
        ...(["transfer-accept", "transfer-reject", "undefined-termination"].includes(id) ? [] : ["branch/onStartShouldSetResponder"]),
        ...(id === "truthy-should" ? ["parent/onStartShouldSetResponder"] : [])];
    equal(firstStart.map(entry => entry.id + "/" + entry.handler), expectedNegotiation, prefix + "/First gesture negotiation follows exact capture then bubble candidate order");
    if (id === "should-fault") {
      const event = active.shouldFaultEvent;
      gap("should-currentTarget-retained", event instanceof ResponderEvent && event.currentTarget === panels.get(name).refs.parent && event.target === panels.get(name).refs.first,
        "A thrown should-set callback must clear its transient currentTarget before propagation exits.",
        {retainedCurrentTarget: event.currentTarget?.tag ?? null, expectedCurrentTarget: null, caught: active.errors[0]?.message ?? null,
          normalTouchStartDelivered: active.normal.some(entry => entry.type === "touchstart")});
      check(!active.normal.some(entry => entry.type === "touchstart") && active.normal.some(entry => entry.type === "touchend"), prefix + "/Should-set error aborts only that start and a balancing end remains deliverable");
    }
    if (id === "grant-fault" || id === "lifecycle-fault") {
      const lifecycleIndex = active.trace.findIndex(entry => entry.kind === "lifecycle" && entry.handler === "onResponderStart");
      const normalIndex = active.trace.findIndex(entry => entry.kind === "normal" && entry.type === "touchstart");
      check(lifecycleIndex >= 0 && normalIndex > lifecycleIndex && active.normal.filter(entry => entry.type === "touchstart").length === 6,
        prefix + "/Lifecycle error rethrows only after real normal start delivery completes all JSX peers");
    }
  } else {
    check(bootstrap.mode === "disabled" && active.raw.filter(entry => /^topTouch/.test(entry.type)).length > 0,
      prefix + "/Control comes through genuine compiled native touch and RawEventEmitter delivery with flags off");
  }
  const report = {id, transport, expectedLifecycle: expected, lifecycle: [...active.lifecycle], trace: [...active.trace], raw: [...active.raw], errors: [...active.errors],
    normalEventsCleaned: !legacy && active.normalEvents.every(eventClean), originalResponderEvents: !legacy && active.lifecycleEvents.every(event => event instanceof ResponderEvent),
    activeTouches: legacy ? null : TouchHistory.touchHistory.numberActiveTouches};
  active = null;
  return report;
}
function recordOutsideGap(step, nativeResponder, branchTag) {
  gap("outside-contact-withholds-release", step.lifecycle.join() === ["branch/grant", "branch/start", "branch/start", "branch/end"].join() &&
    step.remainingTargets.length === 1 && step.activeTouches === 1 && nativeResponder === branchTag,
    "Responder branch must release when its last descendant contact ends even if an unrelated branch contact remains.",
    {manualOriginal: step, nativeResponder, expectedResponder: 0, branchTag});
  return true;
}
function compareLegacy(manual, legacy, nativeStates) {
  check(JSON.stringify(manual.cancel.lifecycle) === JSON.stringify(legacy.cancel.lifecycle), "differential/cancel/Original manual and actual legacy native cancellation agree exactly");
  check(JSON.stringify(manual["outside-two"].lifecycle) !== JSON.stringify(legacy["outside-two"].lifecycle) && nativeStates["outside-two"][2].responder === 0,
    "differential/outside/Actual compiled native control releases while original dispatcher retains unrelated contact");
  gap("truthy-should-set", manual["truthy-should"].lifecycle.length === 0 && legacy["truthy-should"].lifecycle.join() === "branch/grant,branch/start,branch/end,branch/release",
    "Installed should-set handlers must preserve the legacy acceptance of truthy return values unless the contract explicitly changes.",
    {manualOriginal: manual["truthy-should"].lifecycle, nativeCompiledLegacy: legacy["truthy-should"].lifecycle});
  gap("undefined-termination-transfer", manual["undefined-termination"].lifecycle.join() === accepted.join() && legacy["undefined-termination"].lifecycle.join() === rejected.join(),
    "An installed termination handler returning undefined must preserve the legacy rejection contract unless explicitly changed.",
    {manualOriginal: manual["undefined-termination"].lifecycle, nativeCompiledLegacy: legacy["undefined-termination"].lifecycle});
  return {sameTopology: true, samePayloadProvenance: false, manualOriginalTransport: "explicit-original-dispatchNativeEvent-real-refs",
    legacyTransport: "Input.parse_input_event-original-compiled-ReactFabric-flags-disabled", cancelAgreement: true};
}
function testNativeLookup(name) {
  const {refs} = panels.get(name), results = [];
  for (const id of ["parent", "branch", "flat", "first", "second", "other"]) {
    const handle = getInternalInstanceHandleFromPublicInstance(refs[id]);
    const same = getInternalInstanceHandleFromNativeTag(refs[id].tag) === handle;
    check(same && handle != null, name + "/tag-lookup/Actual current native family returns exact original Fiber: " + id);
    results.push({id, tag: refs[id].tag, same});
  }
  const invalid = [undefined, null, "4", {}, -1, 0, 1.5, NaN, Infinity, 2 ** 53];
  check(invalid.every(value => getInternalInstanceHandleFromNativeTag(value) === null), name + "/tag-lookup/Invalid tags return null without coercion or native errors");
  return results;
}
function removeLookupNode(name) {
  const panel = panels.get(name);
  retiredLookup = {ref: panel.refs.other, tag: panel.refs.other.tag};
  panel.removeOther();
  return true;
}
function inspectLookupRemoval(name) {
  const absent = getInternalInstanceHandleFromNativeTag(retiredLookup.tag) === null;
  check(absent && !retiredLookup.ref.isConnected && retiredLookup.ref.parentNode === null,
    name + "/tag-lookup/Removed native family cannot resolve a stale opaque Fiber");
  const live = panels.get(name).refs.first;
  check(getInternalInstanceHandleFromNativeTag(live.tag) === getInternalInstanceHandleFromPublicInstance(live),
    name + "/tag-lookup/Surviving node keeps exact current Fiber after real React removal");
  return {absent, tag: retiredLookup.tag, disconnected: !retiredLookup.ref.isConnected};
}
globalThis.NativeDispatchProbe = {
  capability, testNormal, testNullTargets, testJSXFastPath, testImperativeOnly, crossRoots, beginScenario, manualStep, finishScenario, recordOutsideGap, compareLegacy,
  testNativeLookup, removeLookupNode, inspectLookupRemoval,
  snapshot: () => ({checks: [...checks], gaps: [...gaps], errors: [...errors], mounts, cleanups, mode: bootstrap.mode, flags: bootstrap.flags,
    currentPriority: nativeFabricUIManager.unstable_getCurrentEventPriority(), defaultPriority: nativeFabricUIManager.unstable_DefaultEventPriority}),
};
