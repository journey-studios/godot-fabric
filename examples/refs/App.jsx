import React, { useRef, useState } from "react";
import { AppRegistry, View, Text, UIManager, findNodeHandle } from "react-native";
// Test-only identity check: bundlers may rename a class, so constructor.name
// alone cannot establish that this is the original pinned RN implementation.
import ReactNativeElement from "../../node_modules/react-native/src/private/webapis/dom/nodes/ReactNativeElement";

const panels = new Map();
const retained = new Map();

function read(instance, parent) {
  const result = { tag: findNodeHandle(instance), connected: instance.isConnected,
    originalInstance: instance instanceof ReactNativeElement,
    className: instance.constructor.name, rect: instance.getBoundingClientRect().toJSON(),
    offset: [instance.offsetLeft, instance.offsetTop, instance.offsetWidth, instance.offsetHeight],
    parentMatches: instance.parentNode === parent, contained: parent.contains(instance),
    sameDocument: instance.ownerDocument === parent.ownerDocument,
    rootMatches: instance.getRootNode() === instance.ownerDocument,
    documentConnected: instance.ownerDocument.isConnected,
    parentChildren: parent.children.length };
  instance.measure((...args) => { result.measure = args; });
  instance.measureInWindow((...args) => { result.window = args; });
  instance.measureLayout(parent, (...args) => { result.relative = args; }, () => { result.failed = true; });
  UIManager.measureInWindow(result.tag, (...args) => { result.legacyWindow = args; });
  UIManager.measureLayout(result.tag, findNodeHandle(parent), () => { result.legacyFailed = true; },
    (...args) => { result.legacyRelative = args; });
  return result;
}

export function RefPanel({ name }) {
  const panel = useRef(null);
  const child = useRef(null);
  const zero = useRef(null);
  const hidden = useRef(null);
  const [count, setCount] = useState(0);
  const [width, setWidth] = useState(100);
  const [key, setKey] = useState(0);
  panels.set(name, { read: () => ({ ...read(child.current, panel.current), zero: zero.current.getBoundingClientRect().toJSON(),
    hidden: hidden.current.getBoundingClientRect().toJSON() }),
    nativeProps: () => child.current.setNativeProps({ style: { width: 95, opacity: 0.5 } }),
    rerender: () => setCount(value => value + 1),
    overwrite: () => setWidth(130),
    replace() { retained.set(name, child.current); setKey(value => value + 1); },
    retain: () => retained.set(name, child.current),
    child: () => child.current });
  return <View testID={`${name}-panel`} ref={panel}
    style={{ width: 200, height: 180, padding: 16, backgroundColor: "#1e293b" }}>
    <View key={key} ref={child} testID={`${name}-child`}
      style={{ width, height: 40, backgroundColor: "#38bdf8", opacity: 1 }} />
    <Text testID={`${name}-text`} style={{ color: "#f8fafc", fontSize: 16 }}>
      {name} · original RN refs · {count}
    </Text>
    <View ref={zero} testID={`${name}-zero`}
      style={{ position: "absolute", left: 35, top: 90, width: 0, height: 0 }} />
    <View ref={hidden} testID={`${name}-hidden`}
      style={{ display: "none", width: 40, height: 40 }} />
  </View>;
}
AppRegistry.registerComponent("RefPanel", () => RefPanel);

globalThis.GodotRefs = {
  read: name => panels.get(name).read(),
  run: (name, action) => panels.get(name)[action](),
  cross() {
    const result = {};
    panels.get("A").child().measureLayout(panels.get("B").child(),
      () => { result.succeeded = true; }, () => { result.failed = true; });
    return result;
  },
  staleDocument() {
    const document = retained.get("B").ownerDocument;
    return { connected: document.isConnected,
      position: panels.get("A").child().compareDocumentPosition(document) };
  },
  invalidTags() {
    let failures = 0;
    let successes = 0;
    for (const tag of [NaN, Infinity, -Infinity, -1, 0, 0.5, 2 ** 32, "2", {}])
      UIManager.measureLayout(tag, findNodeHandle(panels.get("A").child()),
        () => { failures++; }, () => { successes++; });
    return { failures, successes };
  },
  stale(name) {
    const instance = retained.get(name);
    let callbacks = 0;
    instance.measure(() => { callbacks++; });
    instance.measureInWindow(() => { callbacks++; });
    instance.setNativeProps({ style: { width: 999 } });
    instance.focus();
    return { connected: instance.isConnected, callbacks, tag: findNodeHandle(instance),
      rect: instance.getBoundingClientRect().toJSON() };
  },
};
