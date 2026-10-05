import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppRegistry, View, Text, Pressable, findNodeHandle } from "react-native";
// Original classes are imported only to prove public-instance identity.
import ReactNativeElement from "../../node_modules/react-native/src/private/webapis/dom/nodes/ReactNativeElement";
import ReactNativeDocument from "../../node_modules/react-native/src/private/webapis/dom/nodes/ReactNativeDocument";
import ReadOnlyText from "../../node_modules/react-native/src/private/webapis/dom/nodes/ReadOnlyText";
import NodeList from "../../node_modules/react-native/src/private/webapis/dom/oldstylecollections/NodeList";
import HTMLCollection from "../../node_modules/react-native/src/private/webapis/dom/oldstylecollections/HTMLCollection";

const panels = new Map(), retained = new Map();
const observations = { mounts: {}, cleanups: {}, rows: {}, states: {} };
const refSetters = new WeakMap();
function attach(refs, id) {
  let setters = refSetters.get(refs);
  if (!setters) refSetters.set(refs, setters = new Map());
  if (!setters.has(id)) setters.set(id, instance => { refs[id] = instance; });
  return setters.get(id);
}
function Row({ name, id, revision, refs, publicId, nativeId }) {
  useEffect(() => {
    const key = name + "/" + id + "/" + revision;
    observations.rows[key] ??= { mounts: 0, cleanups: 0 };
    observations.rows[key].mounts++;
    return () => { observations.rows[key].cleanups++; };
  }, [name, id, revision]);
  return <View ref={attach(refs, id)} testID={name + "-" + id}
    id={id === "first" ? publicId : undefined}
    nativeID={id === "first" ? nativeId : "shared-item"}
    style={{ width: 145, height: 90, padding: 12, backgroundColor: id === "first" ? "#0284c7" : "#0f766e" }}>
    <Text style={{ color: "#ffffff", fontSize: 16, height: 26 }}>{id === "first" ? "First item" : "Second item"}</Text>
  </View>;
}
function TreePanel({ name }) {
  const refs = useRef({}).current;
  const [phase, setPhase] = useState("initial");
  const [order, setOrder] = useState(["first", "second"]);
  const [revision, setRevision] = useState(0);
  const [alive, setAlive] = useState(true);
  const [publicId, setPublicId] = useState(name + "-jsx");
  const [nativeId, setNativeId] = useState(name + "-native");
  const [tick, setTick] = useState(0);
  panels.set(name, { refs, actions: {
    update() { setPhase("updated"); setOrder(["second", "first"]); setPublicId(name + "-jsx-updated"); },
    replace() { setRevision(value => value + 1); },
    remove() { setAlive(false); },
    fallback() { setPublicId(undefined); setNativeId(name + "-fallback"); },
    duplicate() { refs.first?.setNativeProps({ nativeID: "shared-item" }); },
    imperative() { refs.first?.setNativeProps({ nativeID: name + "-imperative" }); },
    rerender() { setTick(value => value + 1); },
    declare() { setPublicId(name + "-declared"); },
  }});
  useEffect(() => {
    observations.mounts[name] = (observations.mounts[name] ?? 0) + 1;
    return () => { observations.cleanups[name] = (observations.cleanups[name] ?? 0) + 1; panels.delete(name); };
  }, [name]);
  useLayoutEffect(() => { observations.states[name] = { phase, order, revision, alive, publicId: publicId ?? null, nativeId, tick }; });
  return <View ref={attach(refs, "panel")} testID={name + "-panel"} nativeID={name + "-panel-id"}
    style={{ flex: 1, padding: 20, gap: 10, backgroundColor: "#122039", zIndex: 0 }}>
    <Text style={{ color: "#f8fafc", fontSize: 24, height: 34 }}>Root {name} · original node tree</Text>
    <Text style={{ color: "#b5c6e0", fontSize: 12, height: 32 }}>Refs navigate the React tree.{"\n"}Controls can use a flatter hierarchy.</Text>
    <Pressable onPress={() => panels.get(name).actions.update()} style={{ backgroundColor: "#315782", padding: 10 }}>
      <Text style={{ color: "#ffffff", fontSize: 14, height: 20 }}>Update IDs, text and item order</Text>
    </Pressable>
    <View ref={attach(refs, "items")} testID={name + "-items"} nativeID={name + "-items-id"}
      style={{ flexDirection: "row", gap: 10, height: 90 }}>
      {order.map(id => id === "second" && !alive ? null : <Row key={id + "/" + (id === "first" ? revision : 0)}
        name={name} id={id} revision={id === "first" ? revision : 0} refs={refs} publicId={publicId} nativeId={nativeId} />)}
    </View>
    <Text ref={attach(refs, "message")} testID={name + "-message"} nativeID={name + "-message-id"}
      style={{ color: "#f8fafc", fontSize: 17, height: 44 }}>
      {phase === "initial" ? "Hello " : "Updated "}<Text ref={attach(refs, "span")} nativeID={name + "-span-id"}
        style={{ color: "#f59e0b", fontWeight: "700" }}>world 🌍</Text>{" from " + name}
    </Text>
    <View ref={attach(refs, "wrapper")} style={{ width: 300, height: 54 }}>
      <View ref={attach(refs, "leaf")} testID={name + "-leaf"} nativeID={name + "-leaf-id"}
        style={{ width: 280, height: 46, backgroundColor: "#3b82f6", padding: 10 }}>
        <Text style={{ color: "#ffffff", fontSize: 12 }}>Logical wrapper · no native Control</Text>
      </View>
    </View>
    <View ref={attach(refs, "identity")} nativeID={phase === "initial" ? name + "-identity-id" : undefined}
      style={{ width: 300, height: 30 }}>
      <View testID={name + "-identity-child"} style={{ width: 280, height: 24, backgroundColor: "#06b6d4" }} />
    </View>
    <Text style={{ color: "#b5c6e0", fontSize: 11, height: 30 }}>Stage: {phase} · retained state: {tick}{"\n"}IDs belong to this root's document.</Text>
  </View>;
}
AppRegistry.registerComponent("TreePanel", () => TreePanel);

function label(node) {
  if (!node) return null;
  return { type: node.nodeType, name: node.nodeName, id: node.id ?? null,
    tag: node instanceof ReactNativeElement ? findNodeHandle(node) : null,
    connected: node.isConnected, text: node.textContent, value: node.nodeValue };
}
function check(list, condition, name) { list.push({ name, passed: Boolean(condition) }); }
function retain(name) {
  const r = panels.get(name)?.refs ?? {};
  retained.set(name, { document: r.panel?.ownerDocument, root: r.panel?.ownerDocument?.documentElement,
    first: r.first, second: r.second, prefix: r.message?.firstChild, spanText: r.span?.firstChild,
    wrapper: r.wrapper, identity: r.identity, nodes: r.items?.childNodes, elements: r.items?.children });
}
function initial(name) {
  const r = panels.get(name)?.refs ?? {}, old = retained.get(name) ?? {};
  const d = r.panel?.ownerDocument, prefix = r.message?.firstChild, raw = r.span?.firstChild;
  const nodes = r.items?.childNodes, elements = r.items?.children, checks = [];
  check(checks, r.panel instanceof ReactNativeElement && d instanceof ReactNativeDocument && d?.documentElement instanceof ReactNativeElement && prefix instanceof ReadOnlyText && raw instanceof ReadOnlyText,
    "Original pinned element, document, documentElement and RawText classes");
  check(checks, d?.nodeName === "#document" && d?.nodeType === 9 && d?.nodeValue === null && d?.textContent === null && d?.ownerDocument === null && d?.parentNode === null && d?.getRootNode() === d,
    "Document node properties and root identity");
  check(checks, d?.isConnected && d?.children.length === 1 && d?.childNodes.length === 1 && d?.firstChild === d?.documentElement && d?.lastElementChild === d?.documentElement && d?.documentElement.parentNode === d,
    "One connected documentElement and original document traversal");
  check(checks, r.panel?.getRootNode() === d && d?.documentElement.contains(r.panel) && r.panel?.ownerDocument === r.first?.ownerDocument && d?.getElementById(name + "-panel-id") === r.panel,
    "Root traversal and nativeID lookup share the correct document");
  check(checks, r.first?.id === name + "-jsx" && d?.getElementById(name + "-jsx") === r.first && d?.getElementById(name + "-native") === null,
    "Original View resolves JSX id before nativeID");
  check(checks, r.second?.id === "shared-item" && d?.getElementById("shared-item") === r.second && d?.getElementById("missing") === null && d?.getElementById(name + "-message-id") === r.message,
    "Native IDs, paragraph lookup and null for absent IDs");
  check(checks, r.leaf?.parentNode === r.wrapper && r.leaf?.parentElement === r.wrapper && r.wrapper?.parentNode === r.panel && r.wrapper?.firstChild === r.leaf && r.wrapper?.lastElementChild === r.leaf,
    "Logical tree preserves the anonymous flattened wrapper");
  check(checks, nodes?.length === 2 && nodes?.[0] === r.first && nodes?.[1] === r.second && r.first?.nextSibling === r.second && r.second?.previousElementSibling === r.first && r.first?.previousSibling === null && r.second?.nextSibling === null,
    "Declared child order, sibling directions and boundary nulls");
  check(checks, r.first?.compareDocumentPosition(r.second) === 4 && r.second?.compareDocumentPosition(r.first) === 2 && r.first?.compareDocumentPosition(r.first) === 0,
    "Sibling comparison is bidirectional and self position is zero");
  check(checks, r.items?.compareDocumentPosition(r.first) === 20 && r.first?.compareDocumentPosition(r.items) === 10 && r.items?.contains(r.first) && !r.first?.contains(r.items),
    "Ancestor masks and contains follow original RN direction semantics");
  check(checks, d?.compareDocumentPosition(r.panel) === 20 && r.panel?.compareDocumentPosition(d) === 10,
    "Document comparisons work in both directions");
  check(checks, prefix?.nodeType === 3 && prefix?.nodeName === "#text" && prefix?.data === "Hello " && prefix?.nodeValue === "Hello " && prefix?.parentNode === r.message && prefix?.nextSibling === r.span && r.span?.nextSibling === r.message?.lastChild && r.message?.children.length === 1 && r.message?.firstElementChild === r.span,
    "Composed Text exposes RawText nodes and element-filtered traversal");
  let negative = false;
  try { raw?.substringData(-1, 1); } catch (error) { negative = error instanceof TypeError; }
  check(checks, raw?.data === "world 🌍" && raw?.length === 8 && raw?.substringData(6, 2) === "🌍" && raw?.substringData(6, -1) === "🌍" && negative && r.message?.textContent === "Hello world 🌍 from " + name,
    "ReadOnlyText Unicode data, UTF-16 length and original substringData");
  check(checks, nodes instanceof NodeList && elements instanceof HTMLCollection && nodes?.item(-1) === null && nodes?.item(2) === null && elements?.item(2) === null && elements?.namedItem(r.first?.id) === null,
    "Original collection classes, item bounds and namedItem null");
  const visited = [], context = {};
  nodes?.forEach(function(value, index, list) { visited.push(value === [r.first, r.second][index] && this === context && list === nodes); }, context);
  check(checks, visited.length === 2 && visited.every(Boolean) && Array.from(nodes?.keys() ?? []).join() === "0,1" && Array.from(nodes?.values() ?? [])[1] === r.second && Array.from(nodes?.entries() ?? [])[0]?.[1] === r.first && Array.from(elements ?? [])[0] === r.first,
    "Collection iterators and forEach retain values, indices and thisArg");
  check(checks, Object.getOwnPropertyDescriptor(nodes ?? {}, "0")?.writable === false && Object.getOwnPropertyDescriptor(elements ?? {}, "0")?.writable === false && Object.getOwnPropertyDescriptor(nodes ?? {}, "0")?.enumerable === false && Object.getOwnPropertyDescriptor(elements ?? {}, "0")?.enumerable === true && nodes !== r.items?.childNodes && elements !== r.items?.children,
    "Collection getters return new snapshots with read-only index descriptors");
  check(checks, old.document === d && old.prefix === prefix && r.panel?.nodeValue === null && prefix?.hasChildNodes() === false && prefix?.firstChild === null && r.items?.hasChildNodes() && r.identity?.id === name + "-identity-id" && d?.getElementById(name + "-identity-id") === r.identity,
    "Retained nodes, child boundaries and nativeID-only logical view");
  return { checks, items: Array.from(nodes ?? []).map(label), message: Array.from(r.message?.childNodes ?? []).map(label),
    document: label(d), wrapperTag: r.wrapper ? findNodeHandle(r.wrapper) : null, identityTag: r.identity ? findNodeHandle(r.identity) : null };
}
function mutation(name, stage) {
  const r = panels.get(name)?.refs ?? {}, old = retained.get(name) ?? {}, d = r.panel?.ownerDocument, checks = [];
  if (stage.startsWith("duplicate")) {
    const expected = observations.states[name].phase === "initial" ? r.first : r.second;
    check(checks, d?.getElementById("shared-item") === expected && r.first?.id === (observations.states[name].phase === "initial" ? name + "-jsx" : name + "-jsx-updated"),
      "Same-root duplicate IDs use current pre-order while public props stay declarative");
  } else if (stage === "updated") {
    old.updatedPrefix = r.message?.firstChild;
    check(checks, r.items?.firstChild === r.second && r.items?.lastChild === r.first && r.first === old.first && r.first?.compareDocumentPosition(r.second) === 2 && r.second?.compareDocumentPosition(r.first) === 4,
      "Keyed reorder changes both position directions and preserves refs");
    check(checks, d?.getElementById(name + "-jsx") === null && d?.getElementById(name + "-jsx-updated") === r.first && r.first?.id === name + "-jsx-updated",
      "Declarative ID update changes lookup and canonical public getter");
    check(checks, old.prefix !== r.message?.firstChild && !old.prefix?.isConnected && old.prefix?.data === "" && r.message?.firstChild?.isConnected && r.message?.firstChild?.data === "Updated " && r.message?.firstChild?.parentNode === r.message && r.message?.textContent === "Updated world 🌍 from " + name && old.spanText === r.span?.firstChild,
      "Changed strings replace RawText while unchanged spans retain their original public node");
    check(checks, old.nodes?.length === 2 && old.nodes?.[0] === old.first && old.nodes?.[1] === old.second && old.elements?.[0] === old.first && r.items?.children[0] === r.second,
      "Retained snapshots keep original order while fresh getters see updates");
    check(checks, r.identity === old.identity && r.identity?.id === "" && r.identity?.isConnected && d?.getElementById(name + "-identity-id") === null && observations.mounts[name] === 1 && !observations.cleanups[name],
      "Removing nativeID preserves the logical view and mounted React state");
  } else if (stage === "replaced") {
    check(checks, old.first !== r.first && findNodeHandle(old.first) !== findNodeHandle(r.first) && r.first instanceof ReactNativeElement && d?.getElementById(name + "-jsx-updated") === r.first,
      "Key replacement creates a new original public ref and lookup authority");
    check(checks, !old.first?.isConnected && old.first?.parentNode === null && old.first?.childNodes.length === 0 && old.first?.textContent === "" && old.first?.getRootNode() === old.first && old.first?.ownerDocument === d && old.first?.compareDocumentPosition(r.first) === 1 && r.first?.compareDocumentPosition(old.first) === 1,
      "Replaced retained element disconnects in both comparison directions");
  } else if (stage === "removed") {
    check(checks, !old.second?.isConnected && old.second?.parentNode === null && old.second?.textContent === "" && d?.getElementById("shared-item") === null && old.nodes?.length === 2 && old.nodes?.[1] === old.second,
      "Removed item disconnects while old collection snapshots stay intact");
    check(checks, r.items?.children.length === 1 && r.items?.firstChild === r.first && r.items?.lastChild === r.first && r.first?.nextElementSibling === null && r.first?.previousSibling === null,
      "Fresh traversal reflects removal and updated sibling boundaries");
  } else if (stage === "fallback") {
    check(checks, r.first?.id === name + "-fallback" && d?.getElementById(name + "-fallback") === r.first && d?.getElementById(name + "-jsx-updated") === null,
      "Removing JSX id restores the nativeID fallback");
  } else if (stage === "imperative") {
    check(checks, d?.getElementById(name + "-imperative") === r.first && d?.getElementById(name + "-fallback") === null && r.first?.id === name + "-fallback",
      "Imperative native ID lookup differs from canonical props");
  } else if (stage === "rerender") {
    // Upstream 0.87.1 clones with empty RawProps on a children-only commit;
    // that path does not merge family.nativeProps_DEPRECATED. This is a
    // bounded pinned-runtime observation, not a promise of persistence.
    check(checks, d?.getElementById(name + "-fallback") === r.first && d?.getElementById(name + "-imperative") === null && r.first?.id === name + "-fallback",
      "Pinned upstream children-only commit restores declarative native ID");
  } else if (stage === "declared") {
    check(checks, r.first?.id === name + "-declared" && d?.getElementById(name + "-declared") === r.first && d?.getElementById(name + "-imperative") === null,
      "Changed React props overwrite the imperative native ID");
  }
  return { checks, state: observations.states[name], currentFirst: label(r.first), oldFirst: label(old.first), oldSecond: label(old.second),
    rawTextDiagnostics: {samePrefix: old.prefix === r.message?.firstChild, currentPrefix: label(r.message?.firstChild),
      oldOwnerDocumentNull: old.prefix?.ownerDocument === null, currentOwnerDocumentNull: r.message?.firstChild?.ownerDocument === null,
      sameSpanText: old.spanText === r.span?.firstChild},
    prefix: label(old.prefix), currentOrder: Array.from(r.items?.children ?? []).map(label), oldCollection: Array.from(old.nodes ?? []).map(label),
    identityTag: r.identity ? findNodeHandle(r.identity) : null, oldFirstRect: old.first?.getBoundingClientRect().toJSON() };
}
function cross() {
  const a = panels.get("A")?.refs, b = panels.get("B")?.refs, da = a?.panel?.ownerDocument, db = b?.panel?.ownerDocument, checks = [];
  check(checks, da !== db && da instanceof ReactNativeDocument && db instanceof ReactNativeDocument && da?.getElementById("shared-item") === a?.second && db?.getElementById("shared-item") === b?.second,
    "Duplicate IDs are independently scoped to two original RN documents");
  check(checks, a?.panel?.compareDocumentPosition(b?.panel) === 1 && b?.panel?.compareDocumentPosition(a?.panel) === 1 && da?.compareDocumentPosition(db) === 1 && db?.compareDocumentPosition(da) === 1 && !a?.panel?.contains(b?.panel),
    "Cross-root element and document comparisons are disconnected both ways");
  return { checks, aDocument: label(da), bDocument: label(db) };
}
function retired(name) {
  const old = retained.get(name) ?? {}, d = old.document, checks = [];
  check(checks, !d?.isConnected && d?.childNodes.length === 0 && d?.children.length === 1 && d?.children[0] === old.root && d?.documentElement === old.root && !old.root?.isConnected && old.root?.childNodes.length === 0 && d?.getElementById(name + "-declared") === null,
    "Retired document disconnects while original documentElement getters remain cached");
  const textNodes = [old.prefix, old.updatedPrefix, old.spanText];
  check(checks, textNodes.every(node => node instanceof ReadOnlyText && !node.isConnected && node.data === "" && node.textContent === "" && node.nodeValue === "" && node.length === 0 && node.parentNode === null && node.getRootNode() === node && node.contains(node) && node.compareDocumentPosition(node) === 0 && node.ownerDocument === null),
    "Initial, updated and unchanged RawText objects all obey disconnected RN semantics");
  const other = panels.get(name === "A" ? "B" : "A")?.refs.panel;
  if (other) check(checks, other.compareDocumentPosition(d) === 1 && d?.compareDocumentPosition(other) === 1 && !d?.contains(other) && other.ownerDocument.isConnected,
    "Surviving root compares safely against the retired document in both directions");
  return { checks, retainedTextNodes: textNodes.map(label), rawTextDiagnostics: {ownerDocumentNull: old.prefix?.ownerDocument === null,
      sameOwnerDocument: old.prefix?.ownerDocument === d, rootIsSelf: old.prefix?.getRootNode() === old.prefix,
      containsSelf: old.prefix?.contains(old.prefix), selfPosition: old.prefix?.compareDocumentPosition(old.prefix),
      parent: label(old.prefix?.parentNode), length: old.prefix?.length}, document: label(d), root: label(old.root), prefix: label(old.prefix), cachedChildren: d?.children.length, childNodes: d?.childNodes.length };
}
globalThis.GodotTree = { retain, initial, mutation, cross, retired,
  action: (name, action) => panels.get(name).actions[action](),
  stats: () => JSON.parse(JSON.stringify(observations)),
};
