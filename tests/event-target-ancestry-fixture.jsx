import {bootstrap} from "./event-target-bootstrap";
import React, {useEffect, useRef, useState} from "react";
import {AppRegistry, View} from "react-native";
import OriginalEvent from "../node_modules/react-native/src/private/webapis/dom/events/Event";
import OriginalEventTarget from "../node_modules/react-native/src/private/webapis/dom/events/EventTarget";
import ReactNativeElement from "../node_modules/react-native/src/private/webapis/dom/nodes/ReactNativeElement";
import {EVENT_TARGET_GET_THE_PARENT_KEY} from "../node_modules/react-native/src/private/webapis/dom/events/internals/EventTargetInternals";

const panels = new Map(), retained = new Map(), checks = [], mounts = {}, cleanups = {};
const check = (condition, name) => checks.push({name, passed: Boolean(condition)});
const equal = (actual, expected, name) => check(JSON.stringify(actual) === JSON.stringify(expected), name);
function listen(target, type, callback, capture = false) {
  target.addEventListener(type, callback, capture);
  return () => target.removeEventListener(type, callback, capture);
}
function Fixture({name}) {
  const refs = useRef({}).current;
  const [items, setItems] = useState(true), [ancestor, setAncestor] = useState(true), [reverse, setReverse] = useState(false);
  panels.set(name, {refs, removeItems: () => setItems(false), removeAncestor: () => setAncestor(false), reorder: () => setReverse(value => !value)});
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
    return () => { cleanups[name] = (cleanups[name] ?? 0) + 1; panels.delete(name); };
  }, [name]);
  const attach = id => instance => { refs[id] = instance; };
  return <View ref={attach("parent")} testID={name + "-parent"} pointerEvents="box-none" style={{flex: 1}}>
    {ancestor && <View ref={attach("ancestor")} testID={name + "-ancestor"} style={{width: 320, height: 100}}>
      <View ref={attach("flat")} style={{width: 310, height: 90}}>
        {items && <View ref={attach("warm")} testID={name + "-warm"} style={{width: 80, height: 20}} />}
        {items && <View ref={attach("cold")} testID={name + "-cold"} style={{width: 80, height: 20}} />}
        <View ref={attach("nested")} testID={name + "-nested"} style={{width: 80, height: 20}} />
      </View>
    </View>}
    {(reverse ? ["key-b", "key-a"] : ["key-a", "key-b"]).map(id =>
      <View key={id} ref={attach(id)} testID={name + "-" + id} style={{width: 80, height: 20}} />)}
    <View ref={attach("rootWarm")} testID={name + "-root-warm"} style={{width: 80, height: 20}} />
    <View ref={attach("rootCold")} testID={name + "-root-cold"} style={{width: 80, height: 20}} />
  </View>;
}
AppRegistry.registerComponent("EventTargetAncestryProbe", () => Fixture);

function shape(entry, targetLabel) {
  return entry.thisMatches && entry.currentMatches && entry.targetMatches &&
    entry.phase === (entry.label === targetLabel ? OriginalEvent.AT_TARGET : entry.capture ? OriginalEvent.CAPTURING_PHASE : OriginalEvent.BUBBLING_PHASE);
}
function cleanup(event, target) {
  return event.target === target && event.currentTarget === null && event.eventPhase === OriginalEvent.NONE &&
    event.composedPath().length === 0 && !event.isTrusted;
}
function capability(name) {
  const {refs} = panels.get(name), target = refs.nested;
  return {original: target instanceof ReactNativeElement && target instanceof OriginalEventTarget,
    flags: bootstrap.flags, flatTag: refs.flat.tag, parentTag: refs.parent.tag,
    nativeAncestry: target.parentNode === refs.flat && refs.flat.parentNode === refs.ancestor && refs.ancestor.parentNode === refs.parent,
    documentConnected: target.ownerDocument.isConnected,
    documentRootLinked: target.ownerDocument.documentElement.parentNode === target.ownerDocument,
    documentHasNoParent: target.ownerDocument.parentNode === null};
}
function manual(name) {
  const {refs} = panels.get(name), target = refs.nested, document = target.ownerDocument;
  const prefix = name + "/manual/", type = "gf-ancestry:manual:" + name, trace = [], removals = [];
  const targets = [[document, "document"], [document.documentElement, "root"], [refs.parent, "parent"],
    [refs.ancestor, "ancestor"], [refs.flat, "flat"], [target, "self"]];
  let path = [], independent = false;
  for (const [node, label] of targets) for (const capture of [true, false]) {
    removals.push(listen(node, type, function(event) {
      trace.push({label, capture, phase: event.eventPhase, thisMatches: this === node,
        currentMatches: event.currentTarget === node, targetMatches: event.target === target});
      if (node === target && !capture) {
        path = event.composedPath(); const copy = event.composedPath(); copy.shift();
        independent = event.composedPath()[0] === target;
      }
    }, capture));
  }
  const event = new OriginalEvent(type, {bubbles: true});
  check(target.dispatchEvent(event) === true, prefix + "Original public dispatch returns true");
  equal(trace.map(entry => entry.label + (entry.capture ? "/capture" : "/bubble")),
    ["document/capture", "root/capture", "parent/capture", "ancestor/capture", "flat/capture", "self/capture",
      "self/bubble", "flat/bubble", "ancestor/bubble", "parent/bubble", "root/bubble", "document/bubble"], prefix + "Exact nested capture and bubble order");
  check(trace.length === 12 && trace.every(entry => shape(entry, "self")), prefix + "Every callback exposes exact phase target currentTarget and this");
  check(path[0] === target && path[1] === refs.flat && path[2] === refs.ancestor && path[3] === refs.parent &&
    path.includes(document.documentElement) && path[path.length - 1] === document, prefix + "Original path includes logical flattened and document roots");
  check(independent && cleanup(event, target), prefix + "Path copies and original transient field cleanup");
  trace.length = 0;
  const nonBubbling = new OriginalEvent(type);
  target.dispatchEvent(nonBubbling);
  equal(trace.map(entry => entry.label + (entry.capture ? "/capture" : "/bubble")),
    ["document/capture", "root/capture", "parent/capture", "ancestor/capture", "flat/capture", "self/capture", "self/bubble"], prefix + "Non-bubbling event captures and runs both AT_TARGET phases");
  check(trace.length === 7 && trace.every(entry => shape(entry, "self")) && cleanup(nonBubbling, target), prefix + "Non-bubbling phase metadata and cleanup");
  removals.forEach(remove => remove());
  return {trace, checks: checks.filter(entry => entry.name.startsWith(prefix))};
}
function crossRoots(left, right, stage) {
  const a = panels.get(left).refs["key-a"], b = panels.get(right).refs["key-a"], trace = [];
  const type = "gf-ancestry:roots:" + stage;
  const removeA = listen(a.ownerDocument, type, event => trace.push({root: left, target: event.target === a, phase: event.eventPhase}));
  const removeB = listen(b.ownerDocument, type, event => trace.push({root: right, target: event.target === b, phase: event.eventPhase}));
  a.dispatchEvent(new OriginalEvent(type, {bubbles: true})); b.dispatchEvent(new OriginalEvent(type, {bubbles: true}));
  removeA(); removeB();
  check(a.ownerDocument !== b.ownerDocument && trace.length === 2 && trace.every(entry => entry.target && entry.phase === OriginalEvent.BUBBLING_PHASE),
    "shared/" + stage + "/Documents isolate actual native roots");
  equal(trace.map(entry => entry.root), [left, right], "shared/" + stage + "/Exact independent document deliveries");
  return {differentDocuments: a.ownerDocument !== b.ownerDocument, trace};
}
function retainPair(name, key, rootPair = false) {
  const {refs} = panels.get(name), warm = refs[rootPair ? "rootWarm" : "warm"], cold = refs[rootPair ? "rootCold" : "cold"];
  const document = warm.ownerDocument, trace = [], type = "gf-ancestry:retained:" + key;
  const ancestors = rootPair ? [[refs.parent, "parent"], [document.documentElement, "root"], [document, "document"]] :
    [[refs.flat, "flat"], [refs.ancestor, "ancestor"], [refs.parent, "parent"], [document.documentElement, "root"], [document, "document"]];
  const removals = [];
  const old = {name, warm, cold, document, root: document.documentElement, parent: refs.parent,
    flat: refs.flat, ancestor: refs.ancestor, trace, type, ancestors, removals, rootPair, metrics: warm.getNativeMetrics()};
  retained.set(key, old);
  for (const [node, label] of [[warm, "self"], [cold, "self"], ...ancestors]) {
    removals.push(listen(node, type, function(event) {
      trace.push({id: event.target === warm ? "warm" : event.target === cold ? "cold" : "foreign", label,
        capture: false, phase: event.eventPhase, thisMatches: this === node, currentMatches: event.currentTarget === node,
        targetMatches: event.target === warm || event.target === cold});
    }));
  }
  const event = new OriginalEvent(type, {bubbles: true});
  warm.dispatchEvent(event);
  const expected = ["warm/self", ...ancestors.map(([, label]) => "warm/" + label)];
  equal(trace.map(entry => entry.id + "/" + entry.label), expected, key + "/prime/Warm listener and every real ancestor positively deliver");
  check(trace.length === expected.length && trace.every(entry => shape(entry, "self")) && cleanup(event, warm), key + "/prime/Exact warm phase metadata and cleanup");
  check(warm !== cold && warm.isConnected && cold.isConnected && warm.parentNode === cold.parentNode &&
    document.isConnected && old.root.parentNode === document, key + "/prime/Distinct connected siblings have authoritative current NativeDOM ancestry");
  trace.length = 0;
  return {warmTag: warm.tag, coldTag: cold.tag, expectedPrime: expected, nativeId: old.metrics?.id ?? null};
}
function inspectRetained(key, parentMode, scope) {
  const old = retained.get(key), prefix = key + "/" + scope + "/";
  const state = {warmConnected: old.warm.isConnected, coldConnected: old.cold.isConnected,
    warmParentNull: old.warm.parentNode === null, coldParentNull: old.cold.parentNode === null,
    parentConnected: old.parent.isConnected, flatConnected: old.flat.isConnected,
    ancestorConnected: old.ancestor.isConnected, documentConnected: old.document.isConnected,
    rootConnected: old.root.isConnected};
  old.trace.length = 0;
  const events = [];
  for (const node of [old.warm, old.cold]) {
    const event = new OriginalEvent(old.type, {bubbles: true});
    check(node.dispatchEvent(event) === true, prefix + (node === old.warm ? "Warm" : "Cold") + " detached public dispatch remains legal");
    events.push(event);
  }
  const expected = parentMode === "current" ? ["warm/self", "cold/self"] :
    ["warm/self", ...old.ancestors.map(([, label]) => "warm/" + label), "cold/self"];
  equal(old.trace.map(entry => entry.id + "/" + entry.label), expected,
    prefix + (parentMode === "current" ? "Current ancestry removes all old ancestor deliveries" : "Original cached warm ancestry remains reproduced"));
  check(old.trace.length === expected.length && old.trace.every(entry => shape(entry, "self")) &&
    events.every((event, index) => cleanup(event, index === 0 ? old.warm : old.cold)), prefix + "Detached events retain exact phases targets and cleanup");
  check(!state.warmConnected && !state.coldConnected && state.warmParentNull && state.coldParentNull,
    prefix + "NativeDOM independently confirms both real refs are disconnected");
  if (scope === "items") check(state.flatConnected && state.ancestorConnected && state.parentConnected && state.documentConnected,
    prefix + "Former ancestors remain mounted while only sibling items retire");
  if (scope === "ancestor") check(!state.flatConnected && !state.ancestorConnected && state.parentConnected && state.documentConnected,
    prefix + "Entire logical ancestor subtree retires while its former parent remains live");
  if (scope === "root") check(!state.parentConnected && !state.rootConnected && !state.documentConnected,
    prefix + "Document and documentElement lose native connection after root retirement");
  return {...state, trace: [...old.trace], expected, parentMode};
}
function prepareReorder(name) {
  const {refs} = panels.get(name);
  const old = {a: refs["key-a"], b: refs["key-b"], parent: refs.parent,
    aId: refs["key-a"].getNativeMetrics().id, bId: refs["key-b"].getNativeMetrics().id,
    trace: [], removals: [], type: "gf-ancestry:reorder:" + name};
  retained.set("reorder-" + name, old);
  for (const [node, label] of [[old.a, "a"], [old.b, "b"], [old.parent, "parent"]]) {
    old.removals.push(listen(node, old.type, function(event) {
      old.trace.push({at: label, target: event.target === old.a ? "a" : event.target === old.b ? "b" : "foreign",
        exact: this === node && event.currentTarget === node && event.eventPhase ===
          (node === old.parent ? OriginalEvent.BUBBLING_PHASE : OriginalEvent.AT_TARGET)});
    }));
  }
  old.a.dispatchEvent(new OriginalEvent(old.type, {bubbles: true}));
  old.b.dispatchEvent(new OriginalEvent(old.type, {bubbles: true}));
  equal(old.trace.map(entry => entry.at + "/" + entry.target), ["a/a", "parent/a", "b/b", "parent/b"],
    name + "/reorder/All registered listeners positively deliver before the React reorder");
  check(old.trace.length === 4 && old.trace.every(entry => entry.exact),
    name + "/reorder/Preexisting listeners expose exact phases and currentTarget");
  old.trace.length = 0;
  return {aTag: refs["key-a"].tag, bTag: refs["key-b"].tag};
}
function inspectReorder(name) {
  const {refs} = panels.get(name), old = retained.get("reorder-" + name), prefix = name + "/reorder/";
  check(refs["key-a"] === old.a && refs["key-b"] === old.b && old.a.getNativeMetrics().id === old.aId && old.b.getNativeMetrics().id === old.bId,
    prefix + "Keyed sibling reorder preserves actual public ref and native Control identities");
  check(old.a.previousSibling === old.b && old.b.nextSibling === old.a && old.a.parentNode === old.parent && old.b.parentNode === old.parent,
    prefix + "NativeDOM sibling order changes while logical parent is unchanged");
  old.a.dispatchEvent(new OriginalEvent(old.type, {bubbles: true}));
  old.b.dispatchEvent(new OriginalEvent(old.type, {bubbles: true}));
  old.removals.forEach(remove => remove());
  check(old.trace.length === 4 && old.trace.every(entry => entry.exact) &&
    JSON.stringify(old.trace.map(entry => entry.at + "/" + entry.target)) === JSON.stringify(["a/a", "parent/a", "b/b", "parent/b"]),
    prefix + "Listeners registered before reorder survive on both preserved refs and parent");
  return {sameRefs: refs["key-a"] === old.a && refs["key-b"] === old.b, trace: [...old.trace]};
}
function inspectRemount(name, key) {
  const {refs} = panels.get(name), old = retained.get(key), prefix = name + "/remount/";
  check(refs.rootWarm !== old.warm && refs.rootCold !== old.cold && refs.rootWarm.tag !== old.warm.tag && refs.rootCold.tag !== old.cold.tag,
    prefix + "Fresh React mount creates new public refs and native tags");
  check(refs.rootWarm.ownerDocument !== old.document && refs.rootWarm.ownerDocument.isConnected && !old.document.isConnected &&
    refs.rootWarm.getNativeMetrics().id !== old.metrics.id && !old.warm.isConnected,
    prefix + "New document and native Control generation cannot revive retained old refs");
  const trace = [], type = "gf-ancestry:remount:" + name;
  const remove = listen(refs.parent, type, event => trace.push(event.target === refs.rootWarm));
  refs.rootWarm.dispatchEvent(new OriginalEvent(type, {bubbles: true})); remove();
  equal(trace, [true], prefix + "Fresh native root supports original public propagation");
  return {differentRefs: refs.rootWarm !== old.warm, differentDocuments: refs.rootWarm.ownerDocument !== old.document,
    oldTag: old.warm.tag, newTag: refs.rootWarm.tag};
}

// This is a synchronous causal graph of ORIGINAL EventTarget objects, not a
// claim that React can preserve a keyed host ref while moving it between parents.
class MutableParentTarget extends OriginalEventTarget {
  constructor(label, parent = null) { super(); this.label = label; this.parent = parent; this.parentReads = 0; }
  [EVENT_TARGET_GET_THE_PARENT_KEY]() { this.parentReads++; return this.parent; }
}
function mutableGraph(parentMode) {
  const prefix = "graph/", root = new MutableParentTarget("root"), old = new MutableParentTarget("old", root),
    next = new MutableParentTarget("next", root), self = new MutableParentTarget("self", old);
  const trace = [], removals = [], type = "gf-ancestry:graph";
  let mutate = true;
  for (const node of [root, old, next, self]) for (const capture of [true, false]) {
    removals.push(listen(node, type, function(event) {
      trace.push({label: node.label, capture, phase: event.eventPhase, thisMatches: this === node,
        currentMatches: event.currentTarget === node, targetMatches: event.target === self,
        path: event.composedPath().map(item => item.label)});
      if (node === root && capture && mutate) { self.parent = next; mutate = false; }
    }, capture));
  }
  check(self instanceof OriginalEventTarget && self !== old && self !== next, prefix + "Mutable graph uses actual original EventTarget objects");
  const dispatch = (stage, expectedPath) => {
    trace.length = 0;
    const event = new OriginalEvent(type, {bubbles: true});
    check(self.dispatchEvent(event) === true, prefix + stage + "/Public original graph dispatch succeeds");
    const expectedOrder = [...expectedPath].reverse().map(label => label + "/capture").concat(expectedPath.map(label => label + "/bubble"));
    equal(trace.map(entry => entry.label + (entry.capture ? "/capture" : "/bubble")), expectedOrder, prefix + stage + "/Exact capture and bubble delivery order");
    check(trace.length === expectedOrder.length && trace.every(entry => shape(entry, "self") && JSON.stringify(entry.path) === JSON.stringify(expectedPath)),
      prefix + stage + "/Every callback retains snapshot path exact phases and identities");
    check(cleanup(event, self), prefix + stage + "/Original dispatch clears transient event fields");
    return [...trace];
  };
  const first = dispatch("capture-mutation", ["self", "old", "root"]);
  check(self.parent === next && !mutate, prefix + "Capture listener actually changes parent before later callbacks");
  const second = dispatch("next-dispatch", ["self", parentMode === "current" ? "next" : "old", "root"]);
  self.parent = null;
  const third = dispatch("detached-dispatch", parentMode === "current" ? ["self"] : ["self", "old", "root"]);
  check(self.parentReads === (parentMode === "current" ? 3 : 1), prefix + "Parent resolution occurs per path only in current overlay");
  removals.forEach(remove => remove());
  // Null itself is cached upstream; cover gaining a parent after an initial
  // self-only dispatch without representing it as React native reparenting.
  const cold = new MutableParentTarget("cold"), nullTrace = [], nullType = "gf-ancestry:null-cache";
  const nullRemovals = [listen(cold, nullType, () => nullTrace.push("self")), listen(next, nullType, () => nullTrace.push("next")), listen(root, nullType, () => nullTrace.push("root"))];
  cold.dispatchEvent(new OriginalEvent(nullType, {bubbles: true}));
  equal(nullTrace, ["self"], prefix + "Null-parent original object first dispatch is self-only positive");
  cold.parent = next; nullTrace.length = 0;
  cold.dispatchEvent(new OriginalEvent(nullType, {bubbles: true}));
  equal(nullTrace, parentMode === "current" ? ["self", "next", "root"] : ["self"], prefix + "Current getter also replaces original cached null parent");
  nullRemovals.forEach(remove => remove());
  return {parentMode, first, second, third, nullTrace, selfParentReads: self.parentReads, originalObjects: true};
}
globalThis.EventTargetAncestry = {
  capability, manual, crossRoots, retainPair, inspectRetained, prepareReorder, inspectReorder, inspectRemount, mutableGraph,
  removeItems(name) { panels.get(name).removeItems(); return true; },
  removeAncestor(name) { panels.get(name).removeAncestor(); return true; },
  reorder(name) { panels.get(name).reorder(); return true; },
  snapshot: () => ({checks: [...checks], mounts, cleanups, flags: bootstrap.flags, mode: bootstrap.mode,
    currentPriority: nativeFabricUIManager.unstable_getCurrentEventPriority(), defaultPriority: nativeFabricUIManager.unstable_DefaultEventPriority}),
};
