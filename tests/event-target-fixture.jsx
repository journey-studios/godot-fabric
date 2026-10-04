import {bootstrap} from "./event-target-bootstrap";
import React, {useEffect, useRef, useState} from "react";
import {AppRegistry, View} from "react-native";
import RawEventEmitter from "react-native/Libraries/Core/RawEventEmitter";
import ReactNativeElement from "../node_modules/react-native/src/private/webapis/dom/nodes/ReactNativeElement";
import OriginalEvent from "../node_modules/react-native/src/private/webapis/dom/events/Event";
import OriginalEventTarget from "../node_modules/react-native/src/private/webapis/dom/events/EventTarget";
import OriginalCustomEvent from "../node_modules/react-native/src/private/webapis/dom/events/CustomEvent";
import {AbortController as OriginalAbortController} from "../node_modules/react-native/src/private/webapis/dom/abort-api/AbortController";
import {AbortSignal_public as OriginalAbortSignal} from "../node_modules/react-native/src/private/webapis/dom/abort-api/AbortSignal";

const panels = new Map(), retained = new Map(), checks = [], raw = [], declarative = [], imperative = [];
const mounts = {}, cleanups = {};
RawEventEmitter.addListener("*", event => {
  if (event.eventName === "topPointerDown") raw.push({type: event.eventName, target: event.nativeEvent.target,
    pointerId: event.nativeEvent.pointerId, timeStamp: event.nativeEvent.timeStamp});
});
function check(condition, name) { checks.push({name, passed: Boolean(condition)}); }
function equal(actual, expected, name) { check(JSON.stringify(actual) === JSON.stringify(expected), name); }
function rejects(fn, pattern) { try { fn(); return false; } catch (error) { return pattern.test(error.message); } }
function listen(target, type, callback, options) {
  target.addEventListener(type, callback, options);
  return () => target.removeEventListener(type, callback, options);
}
function Fixture({name}) {
  const refs = useRef({}).current;
  const [alive, setAlive] = useState(true);
  panels.set(name, {refs, remove: () => setAlive(false)});
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
    return () => { cleanups[name] = (cleanups[name] ?? 0) + 1; panels.delete(name); };
  }, [name]);
  const attach = id => instance => { refs[id] = instance; };
  return <View ref={attach("parent")} testID={name + "-parent"} pointerEvents="box-none"
    style={{flex: 1, backgroundColor: "#10243a"}}>
    <View ref={attach("only")} testID={name + "-only"}
      style={{position: "absolute", left: 20, top: 20, width: 120, height: 100, backgroundColor: "#0284c7"}} />
    <View ref={attach("mixed")} testID={name + "-mixed"}
      onPointerDown={event => declarative.push({name, target: event.nativeEvent?.target ?? null,
        pointerId: event.nativeEvent?.pointerId ?? null, trusted: event.isTrusted ?? null})}
      style={{position: "absolute", left: 180, top: 20, width: 120, height: 100, backgroundColor: "#0f766e"}} />
    <View ref={attach("flat")} style={{position: "absolute", left: 20, top: 140, width: 120, height: 50}}>
      <View ref={attach("child")} testID={name + "-child"} style={{width: 100, height: 40, backgroundColor: "#a855f7"}} />
    </View>
    {alive && <View ref={attach("warm")} testID={name + "-warm"}
      style={{position: "absolute", left: 180, top: 140, width: 50, height: 40, backgroundColor: "#f59e0b"}} />}
    {alive && <View ref={attach("cold")} testID={name + "-cold"}
      style={{position: "absolute", left: 250, top: 140, width: 50, height: 40, backgroundColor: "#f59e0b"}} />}
  </View>;
}
AppRegistry.registerComponent("EventTargetProbe", () => Fixture);

function capability(name) {
  const refs = panels.get(name).refs, target = refs.child;
  return {name, mode: bootstrap.mode, flags: bootstrap.flags,
    originalElement: target instanceof ReactNativeElement,
    originalEventTarget: target instanceof OriginalEventTarget,
    methods: Object.fromEntries(["addEventListener", "removeEventListener", "dispatchEvent"].map(key => [key, typeof target[key]])),
    // The document is a different final class; record it without pretending
    // that the gated element/text prototype applies to every RN node class.
    documentMethods: Object.fromEntries(["addEventListener", "removeEventListener", "dispatchEvent"].map(key => [key, typeof target.ownerDocument[key]])),
    globalsOriginal: Event === OriginalEvent && EventTarget === OriginalEventTarget && CustomEvent === OriginalCustomEvent &&
      AbortController === OriginalAbortController && AbortSignal === OriginalAbortSignal,
    overrideRejection: bootstrap.rejectedOverride(),
    logicalFlatParent: target.parentNode === refs.flat && refs.flat.parentNode === refs.parent,
    flatTag: refs.flat.tag,
  };
}

function manual(name) {
  const {refs} = panels.get(name), child = refs.child, parent = refs.parent, flat = refs.flat;
  const prefix = name + "/manual/";
  check(child instanceof OriginalEventTarget && typeof child.dispatchEvent === "function", prefix + "Original ref exposes EventTarget");
  const removals = [], trace = [], event = new CustomEvent("gf-probe:path", {bubbles: true, cancelable: true, detail: {root: name}});
  let path, copiedPathIndependent = false, callbacksHaveOriginalThis = true;
  for (const [target, label] of [[parent, "parent"], [flat, "flat"], [child, "child"]]) {
    for (const capture of [true, false]) removals.push(listen(target, event.type, function(current) {
      trace.push(label + (capture ? ":capture" : ":bubble"));
      callbacksHaveOriginalThis &&= this === target && current.currentTarget === target && current.target === child &&
        current.eventPhase === (target === child ? Event.AT_TARGET : capture ? Event.CAPTURING_PHASE : Event.BUBBLING_PHASE);
      if (target === child && !capture) {
        path = current.composedPath();
        const copy = current.composedPath(); copy.shift();
        copiedPathIndependent = current.composedPath()[0] === child;
      }
    }, capture));
  }
  check(child.dispatchEvent(event) === true, prefix + "Non-cancelled custom event returns true");
  equal(trace, ["parent:capture", "flat:capture", "child:capture", "child:bubble", "flat:bubble", "parent:bubble"], prefix + "Logical capture and bubble order includes flattened node");
  check(callbacksHaveOriginalThis && path[0] === child && path[1] === flat && path[2] === parent && path.includes(child.ownerDocument), prefix + "Public target/currentTarget/this, exact eventPhase and original document path");
  check(copiedPathIndependent, prefix + "composedPath returns a separate array");
  check(event.detail.root === name && event.isTrusted === false && Number.isFinite(event.timeStamp), prefix + "Original CustomEvent detail, timestamp and untrusted dispatch");
  check(event.eventPhase === Event.NONE && event.currentTarget === null && event.composedPath().length === 0 && event.target === child, prefix + "Dispatch cleanup preserves target and clears transient fields");
  trace.length = 0;
  child.dispatchEvent(new Event(event.type));
  equal(trace, ["parent:capture", "flat:capture", "child:capture", "child:bubble"], prefix + "Non-bubbling event still captures and reaches both target phases");
  removals.forEach(remove => remove());

  let calls = 0;
  const callback = () => calls++;
  child.addEventListener("gf-probe:identity", callback);
  child.addEventListener("gf-probe:identity", callback, {once: true});
  child.addEventListener("gf-probe:identity", callback, true);
  child.dispatchEvent(new Event("gf-probe:identity"));
  child.dispatchEvent(new Event("gf-probe:identity"));
  check(calls === 4, prefix + "Dedupe includes capture and duplicate options do not replace registration");
  child.removeEventListener("gf-probe:identity", callback, {passive: true, once: true});
  child.dispatchEvent(new Event("gf-probe:identity"));
  check(calls === 5, prefix + "Removal matches callback/type/capture and ignores passive/once");
  child.removeEventListener("gf-probe:identity", callback, true);
  child.dispatchEvent(new Event("gf-probe:identity"));
  check(calls === 5, prefix + "Removing capture registration leaves no duplicate listeners");
  let objectThis = false;
  const object = {handleEvent(current) { objectThis = this === object && current.currentTarget === child; }};
  const removeObject = listen(child, "gf-probe:object", object);
  child.dispatchEvent(new Event("gf-probe:object")); removeObject();
  check(objectThis, prefix + "Object handleEvent retains object this");

  let once = 0, peer = 0;
  child.addEventListener("gf-probe:once", () => { once++; child.dispatchEvent(new Event("gf-probe:once")); }, {once: true});
  const removePeer = listen(child, "gf-probe:once", () => peer++);
  child.dispatchEvent(new Event("gf-probe:once"));
  check(once === 1 && peer === 2, prefix + "once is removed before a nested dispatch of a fresh event");
  child.dispatchEvent(new Event("gf-probe:once")); removePeer();
  check(once === 1 && peer === 3, prefix + "once remains absent on later dispatch");
  const changes = [], second = () => changes.push("second"), added = () => changes.push("added");
  const removeFirst = listen(child, "gf-probe:mutation", () => {
    changes.push("first"); child.removeEventListener("gf-probe:mutation", second); child.addEventListener("gf-probe:mutation", added);
  });
  child.addEventListener("gf-probe:mutation", second);
  child.dispatchEvent(new Event("gf-probe:mutation"));
  equal(changes, ["first"], prefix + "Removal affects snapshot but additions wait for a future dispatch");
  child.dispatchEvent(new Event("gf-probe:mutation")); removeFirst(); child.removeEventListener("gf-probe:mutation", added);
  equal(changes, ["first", "first", "added"], prefix + "A newly registered listener participates in the next dispatch");

  let abortedCalls = 0;
  const cancelled = new AbortController(); cancelled.abort("already");
  const abortedCallback = () => abortedCalls++;
  child.addEventListener("gf-probe:abort", abortedCallback, {signal: cancelled.signal});
  child.dispatchEvent(new Event("gf-probe:abort"));
  check(abortedCalls === 0 && cancelled.signal instanceof AbortSignal, prefix + "Original aborted signal prevents registration");
  const oldController = new AbortController(), newController = new AbortController();
  child.addEventListener("gf-probe:abort", abortedCallback, {signal: oldController.signal});
  child.removeEventListener("gf-probe:abort", abortedCallback);
  child.addEventListener("gf-probe:abort", abortedCallback, {signal: newController.signal});
  oldController.abort("old"); child.dispatchEvent(new Event("gf-probe:abort"));
  check(abortedCalls === 1, prefix + "Old signal cannot remove a new registration of the same callback");
  newController.abort("new"); child.dispatchEvent(new Event("gf-probe:abort"));
  check(abortedCalls === 1 && newController.signal.reason === "new", prefix + "Abort removes the current registration and preserves original reason");

  const passiveEvent = new Event("gf-probe:passive", {cancelable: true});
  const removePassive = listen(child, passiveEvent.type, current => current.preventDefault(), {passive: true});
  check(child.dispatchEvent(passiveEvent) === true && !passiveEvent.defaultPrevented, prefix + "Passive listener cannot cancel a cancelable event"); removePassive();
  const removeCancel = listen(child, "gf-probe:cancel", current => current.preventDefault());
  const cancelEvent = new Event("gf-probe:cancel", {cancelable: true});
  check(child.dispatchEvent(cancelEvent) === false && cancelEvent.defaultPrevented, prefix + "preventDefault controls dispatchEvent boolean");
  const uncancellable = new Event("gf-probe:cancel");
  check(child.dispatchEvent(uncancellable) === true && !uncancellable.defaultPrevented, prefix + "Non-cancelable event ignores preventDefault"); removeCancel();

  const stopped = [];
  const removeStop = listen(parent, "gf-probe:stop", current => { stopped.push("parent"); current.stopPropagation(); }, true);
  const removeStopChild = listen(child, "gf-probe:stop", () => stopped.push("child"));
  child.dispatchEvent(new Event("gf-probe:stop", {bubbles: true})); removeStop(); removeStopChild();
  equal(stopped, ["parent"], prefix + "Ancestor stopPropagation prevents descendant delivery");
  const immediate = [];
  const removeImmediate = listen(child, "gf-probe:immediate", current => { immediate.push("first"); current.stopImmediatePropagation(); });
  const removeImmediatePeer = listen(child, "gf-probe:immediate", () => immediate.push("second"));
  child.dispatchEvent(new Event("gf-probe:immediate")); removeImmediate(); removeImmediatePeer();
  equal(immediate, ["first"], prefix + "stopImmediatePropagation prevents later listeners on same target");

  let rejectedSameEvent = 0;
  const reused = new Event("gf-probe:reentrant");
  const removeReentrant = listen(child, reused.type, current => {
    if (rejects(() => child.dispatchEvent(current), /already being dispatched/)) rejectedSameEvent++;
  });
  child.dispatchEvent(reused); child.dispatchEvent(reused); removeReentrant();
  check(rejectedSameEvent === 2 && reused.currentTarget === null && reused.eventPhase === Event.NONE, prefix + "Same event rejects reentrant dispatch but can be reused after cleanup");
  check(rejects(() => child.dispatchEvent({type: "foreign"}), /not of type 'Event'/), prefix + "Foreign event-shaped object is rejected");
  check(rejects(() => child.addEventListener("missing"), /2 arguments required/), prefix + "Missing callback argument is rejected");
  check(rejects(() => child.addEventListener("bad", "callback"), /callback.*function|callback.*object|parameter 2/i), prefix + "Primitive callback is rejected");
  check(rejects(() => child.addEventListener("bad-signal", callback, {signal: {aborted: false}}), /AbortSignal/), prefix + "Foreign AbortSignal-shaped object is rejected");
  check(rejects(() => new AbortSignal(), /Illegal constructor/), prefix + "Original public AbortSignal cannot be constructed directly");
  // These are pinned upstream boundaries, not browser-parity successes.
  check(rejects(() => child.addEventListener("null-signal", callback, {signal: null}), /AbortSignal/), prefix + "Pinned original explicitly rejects null signal option");
  check(rejects(() => child.removeEventListener("null-options", callback, null), /null|capture/i), prefix + "Pinned original rejects null removal options");
  child.addEventListener("gf-probe:null", null); child.removeEventListener("gf-probe:null", null);
  check(child.dispatchEvent(new Event("gf-probe:null")), prefix + "Null callback is an inert registration/removal");
  return {name, checks: checks.filter(entry => entry.name.startsWith(prefix))};
}

function armNative(name) {
  const {refs} = panels.get(name);
  for (const id of ["only", "mixed"]) refs[id].addEventListener("pointerdown", event => imperative.push({name, id,
    targetIsOriginalRef: event.target === refs[id], trusted: event.isTrusted, pointerId: event.nativeEvent?.pointerId ?? null}));
  return {onlyTag: refs.only.tag, mixedTag: refs.mixed.tag};
}
function primeCache(name) {
  const {refs, remove} = panels.get(name), trace = [];
  const old = {warm: refs.warm, cold: refs.cold, parent: refs.parent, trace, remove};
  retained.set(name, old);
  for (const id of ["warm", "cold"]) {
    old[id].addEventListener("gf-probe:cache", event => trace.push({id, at: "self", target: event.target === old[id]}));
  }
  refs.parent.addEventListener("gf-probe:cache", event => trace.push({id: event.target === old.warm ? "warm" : "cold", at: "old-parent", target: true}));
  old.warm.dispatchEvent(new Event("gf-probe:cache", {bubbles: true}));
  const primed = {warmParent: old.warm.parentNode === old.parent, coldParent: old.cold.parentNode === old.parent,
    trace: [...trace], warmConnected: old.warm.isConnected, coldConnected: old.cold.isConnected};
  trace.length = 0;
  return primed;
}
function removeCache(name) { retained.get(name).remove(); return true; }
function inspectCache(name) {
  const old = retained.get(name), before = {warmConnected: old.warm.isConnected, coldConnected: old.cold.isConnected,
    warmParentNull: old.warm.parentNode === null, coldParentNull: old.cold.parentNode === null,
    parentConnected: old.parent.isConnected};
  old.trace.length = 0;
  old.warm.dispatchEvent(new Event("gf-probe:cache", {bubbles: true}));
  old.cold.dispatchEvent(new Event("gf-probe:cache", {bubbles: true}));
  return {...before, trace: [...old.trace],
    originalParentCacheObserved: old.trace.some(entry => entry.id === "warm" && entry.at === "old-parent"),
    coldStaleParentAbsent: !old.trace.some(entry => entry.id === "cold" && entry.at === "old-parent")};
}
function publicFault(name) {
  const child = panels.get(name).refs.child, event = new Event("gf-probe:public-fault");
  const trace = [], previous = globalThis.event, marker = {};
  globalThis.event = marker;
  const removeFault = listen(child, event.type, () => { trace.push("fault"); throw Error("EventTarget deliberate public listener fault"); }, {once: true});
  const removePeer = listen(child, event.type, () => trace.push("peer"));
  let returned = null, caught = null;
  try { returned = child.dispatchEvent(event); } catch (error) { caught = error.message; }
  check(caught === null && returned === true && trace.join() === "fault,peer", name + "/fault/Public dispatch reports listener fault asynchronously and continues peers");
  check(event.currentTarget === null && event.eventPhase === Event.NONE && event.composedPath().length === 0 && globalThis.event === marker,
    name + "/fault/Public fault restores original event/global transient fields");
  globalThis.event = previous; removeFault(); removePeer();
  return {returned, caught, trace};
}
function crossRoots(left, right) {
  const a = panels.get(left).refs.child, b = panels.get(right).refs.child;
  const trace = [];
  const removeA = listen(a.ownerDocument, "gf-probe:roots", () => trace.push(left));
  const removeB = listen(b.ownerDocument, "gf-probe:roots", () => trace.push(right));
  a.dispatchEvent(new Event("gf-probe:roots", {bubbles: true}));
  b.dispatchEvent(new Event("gf-probe:roots", {bubbles: true})); removeA(); removeB();
  check(a.ownerDocument !== b.ownerDocument && trace.join() === [left, right].join(), "shared/manual/Original documents isolate two React roots in one runtime");
  return {differentDocuments: a.ownerDocument !== b.ownerDocument, trace};
}
globalThis.EventTargetProbe = {
  capability, manual, armNative, primeCache, removeCache, inspectCache, publicFault, crossRoots,
  pokeOnly(name) { return panels.get(name).refs.only.dispatchEvent(new Event("pointerdown", {bubbles: true})); },
  pokeMixed(name) { return panels.get(name).refs.mixed.dispatchEvent(new Event("pointerdown", {bubbles: true})); },
  clearNative() { raw.length = 0; declarative.length = 0; imperative.length = 0; return true; },
  snapshot: () => ({mode: bootstrap.mode, flags: bootstrap.flags, mounts, cleanups, checks: [...checks],
    raw: [...raw], declarative: [...declarative], imperative: [...imperative],
    currentPriority: nativeFabricUIManager.unstable_getCurrentEventPriority(),
    defaultPriority: nativeFabricUIManager.unstable_DefaultEventPriority}),
};
