import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppRegistry, View, Text, TextInput, Pressable, codegenNativeCommands, findNodeHandle } from "react-native";
// Test-only imports prove the public API uses the original RN singleton and
// element methods, rather than a parallel Godot focus registry.
import TextInputState from "../../node_modules/react-native/Libraries/Components/TextInput/TextInputState";
import ReactNativeElement from "../../node_modules/react-native/src/private/webapis/dom/nodes/ReactNativeElement";

const Commands = codegenNativeCommands({ supportedCommands: ["focus", "blur"] });
const panels = new Map(), retained = new Map(), instances = new Map();
const observations = { mounts: {}, cleanups: {}, fields: {}, states: {}, events: [], callbackFocus: [] };

function focused() { return TextInput.State?.currentlyFocusedInput?.() ?? null; }
function label(instance) {
  if (!instance) return null;
  return { tag: findNodeHandle(instance), connected: instance.isConnected,
    focused: instance.isFocused?.() ?? false, nativeRefSame: instance.getNativeRef?.() === instance,
    effectiveEditable: instance.currentProps?.editable,
    nativeEditable: instance.getNativeMetrics?.()?.editable };
}
function check(checks, condition, name) { checks.push({ name, passed: Boolean(condition) }); }
function record(name, id, type, instance, event) {
  const current = focused();
  observations.events.push({ name, id, type, tag: instance ? findNodeHandle(instance) : null,
    currentTag: current ? findNodeHandle(current) : null,
    stateAgrees: TextInputState.currentlyFocusedInput() === current &&
      (type === "focus" ? current === instance && instance?.isFocused() : type === "blur" ? current !== instance && !instance?.isFocused() : true),
    nativeEvent: { text: event.nativeEvent.text, eventCount: event.nativeEvent.eventCount } });
}

function FocusField({ name, id, revision, churn, editable, refs, onEvent }) {
  const own = useRef(null);
  const key = name + "/" + id + "/" + revision;
  observations.fields[key] ??= { mounts: 0, cleanups: 0, attaches: 0, refCleanups: 0, callbacksRegistered: [] };
  const attach = useCallback(instance => {
    own.current = instance;
    refs[id] = instance;
    if (!instance) return;
    instances.set(key, instance);
    const field = observations.fields[key];
    field.attaches++;
    field.callbacksRegistered.push(TextInputState.isTextInput(instance));
    // A proves registration before forwarding a callback ref. B independently
    // exercises autoFocus; validation mounts B after proving A's focus.
    if (name === "A" && id === "primary" && revision === 0 && field.attaches === 1) {
      instance.focus();
      observations.callbackFocus.push({ name, id, registered: TextInputState.isTextInput(instance),
        stateFocused: focused() === instance && TextInputState.currentlyFocusedInput() === instance });
    }
    return () => {
      observations.fields[key].refCleanups++;
      if (refs[id] === instance) refs[id] = null;
      own.current = null;
    };
  }, [name, id, revision, churn, refs, key]);
  useEffect(() => {
    observations.fields[key].mounts++;
    return () => { observations.fields[key].cleanups++; };
  }, [key]);
  const event = type => e => {
    record(name, id, type, own.current, e);
    onEvent(id, type);
  };
  return <View style={{ height: 78, gap: 6 }}>
    <Text style={{ height: 22, color: "#b7c7df", fontSize: 13 }}>
      {id === "primary" ? "Callback ref / replacement" : id === "secondary" ? "AutoFocus / native transfer" : "Committed editable = false"}
    </Text>
    <TextInput ref={attach} testID={name + "-" + id} editable={editable}
      autoFocus={name === "B" && id === "secondary"}
      defaultValue={name + " " + id + " · v" + revision}
      onFocus={event("focus")} onBlur={event("blur")} onEndEditing={event("end")}
      style={{ height: 50, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16, color: "#ffffff",
        backgroundColor: id === "readonly" ? "#46303f" : "#203251", borderWidth: 1, borderColor: "#64748b", borderRadius: 8 }} />
  </View>;
}

export function FocusPanel({ name }) {
  const refs = useRef({}).current;
  const attachPanel = useCallback(instance => { refs.panel = instance; }, [refs]);
  const attachView = useCallback(instance => { refs.view = instance; }, [refs]);
  const [revision, setRevision] = useState(0);
  const [churn, setChurn] = useState(0);
  const [secondaryAlive, setSecondaryAlive] = useState(true);
  const [secondaryEditable, setSecondaryEditable] = useState(true);
  const [anchored, setAnchored] = useState(true);
  const [lastFocus, setLastFocus] = useState("none");
  const onEvent = (id, type) => {
    if (type === "focus") setLastFocus(id);
    else if (type === "blur") setLastFocus(previous => previous === id ? "none" : previous);
  };
  panels.set(name, { refs, actions: {
    churn: () => setChurn(value => value + 1),
    replace: () => setRevision(value => value + 1),
    remove: () => setSecondaryAlive(false),
    lock: () => setSecondaryEditable(false),
    unlock: () => setSecondaryEditable(true),
    flatten: () => setAnchored(false),
  } });
  useEffect(() => {
    observations.mounts[name] = (observations.mounts[name] ?? 0) + 1;
    return () => { observations.cleanups[name] = (observations.cleanups[name] ?? 0) + 1; panels.delete(name); };
  }, [name]);
  useLayoutEffect(() => { observations.states[name] = { revision, churn, secondaryAlive, secondaryEditable, anchored, lastFocus }; });
  return <View ref={attachPanel} testID={name + "-panel"}
    style={{ flex: 1, padding: 20, gap: 10, zIndex: 0, backgroundColor: name === "A" ? "#111c31" : "#112b32" }}>
    <Text style={{ height: 34, fontSize: 24, color: "#f8fafc" }}>Root {name} · native focus</Text>
    <Text style={{ height: 36, fontSize: 12, color: "#b7c7df" }}>One RN State coordinates public refs.{"\n"}The Viewport owns actual keyboard focus.</Text>
    <View ref={instance => { refs.anchor = instance; }} nativeID={anchored ? name + "-primary-anchor" : undefined}
      style={{ height: 78 }}>
      <FocusField key={"primary/" + revision} name={name} id="primary" revision={revision} churn={churn}
        editable refs={refs} onEvent={onEvent} />
    </View>
    {secondaryAlive ? <FocusField key="secondary/0" name={name} id="secondary" revision={0} churn={0}
      editable={secondaryEditable} refs={refs} onEvent={onEvent} /> :
      <View testID={name + "-removed"} style={{ height: 78, backgroundColor: "#293349", padding: 14 }}>
        <Text style={{ height: 24, fontSize: 14, color: "#cbd5e1" }}>The secondary input was retired.</Text>
      </View>}
    <FocusField key="readonly/0" name={name} id="readonly" revision={0} churn={0}
      editable={false} refs={refs} onEvent={onEvent} />
    <View ref={attachView} testID={name + "-view"}
      style={{ height: 44, padding: 10, backgroundColor: "#30415e" }}>
      <Text style={{ height: 24, fontSize: 13, color: "#ffffff" }}>Ordinary View · imperative focus flag off</Text>
    </View>
    <Text testID={name + "-status"} style={{ height: 30, fontSize: 15, color: "#5eead4" }}>Focus events: {lastFocus} · ref revision {churn}</Text>
    <Pressable onPress={() => refs.primary?.focus()} style={{ height: 40, padding: 10, backgroundColor: "#315782" }}>
      <Text style={{ height: 20, fontSize: 13, color: "#ffffff" }}>Focus the primary native input</Text>
    </Pressable>
    <Text style={{ height: 24, fontSize: 11, color: "#94a3b8" }}>Original React / Fabric · real LineEdit signals</Text>
  </View>;
}

function snapshot() {
  const live = {};
  for (const [name, panel] of panels) {
    live[name] = {};
    for (const [id, instance] of Object.entries(panel.refs)) live[name][id] = label(instance);
  }
  const registration = Array.from(instances, ([key, instance]) => ({ key, ...label(instance), registered: TextInputState.isTextInput(instance) }));
  return { ...JSON.parse(JSON.stringify(observations)), live, registration,
    retained: Object.fromEntries(Array.from(retained, ([key, instance]) => [key, label(instance)])),
    focused: label(focused()), originalFocused: label(TextInputState.currentlyFocusedInput()) };
}
function probe(stage) {
  const checks = [], state = snapshot();
  check(checks, TextInput.State != null && Object.keys(TextInput.State).sort().join(",") ===
    "blurTextInput,currentlyFocusedField,currentlyFocusedInput,focusTextInput", "Public TextInput.State exposes exactly the four upstream static methods");
  check(checks, TextInput.State?.currentlyFocusedInput === TextInputState.currentlyFocusedInput &&
    TextInput.State?.currentlyFocusedField === TextInputState.currentlyFocusedField &&
    TextInput.State?.focusTextInput === TextInputState.focusTextInput && TextInput.State?.blurTextInput === TextInputState.blurTextInput,
    "Public statics share the original singleton and its Godot command seam");
  check(checks, observations.events.filter(event => event.type === "focus" || event.type === "blur").every(event => event.stateAgrees),
    "Original State is synchronized before every user focus and blur callback");
  const current = focused();
  check(checks, TextInput.State?.currentlyFocusedField?.() === (current ? findNodeHandle(current) : null),
    "Deprecated focused-field query retains upstream native-tag semantics");
  for (const [name, panel] of panels) {
    const r = panel.refs;
    const fields = [r.primary, r.readonly, ...(observations.states[name]?.secondaryAlive ? [r.secondary] : [])];
    check(checks, fields.every(instance => instance instanceof ReactNativeElement && TextInputState.isTextInput(instance)),
      name + ": Mounted public TextInputs are original elements registered with the original State");
    check(checks, fields.every(instance => instance?.isFocused?.() === (current === instance)),
      name + ": Public isFocused follows the singleton for every mounted input");
    check(checks, r.view?.focus === ReactNativeElement.prototype.focus && r.view?.blur === ReactNativeElement.prototype.blur &&
      !TextInputState.isTextInput(r.view), name + ": Ordinary View retains original prototype focus and blur methods");
  }
  if (stage === "initial-A") {
    check(checks, observations.callbackFocus.length === 1 && observations.callbackFocus[0].registered && observations.callbackFocus[0].stateFocused,
      "A callback ref can focus its input because registration precedes the user callback");
  }
  if (stage === "churned") {
    const field = observations.fields["A/primary/0"], old = retained.get("original");
    check(checks, panels.get("A")?.refs.primary === old && field?.attaches === 2 && field.refCleanups === 1 &&
      field.callbacksRegistered.every(Boolean), "Changing a callback ref preserves the public input and reattaches with registration intact");
    check(checks, focused() === old && old?.isFocused(), "Callback ref cleanup does not clear the live input's focused State");
  }
  if (stage === "replaced") {
    const old = retained.get("original"), fresh = panels.get("A")?.refs.primary;
    check(checks, old instanceof ReactNativeElement && fresh instanceof ReactNativeElement && old !== fresh &&
      findNodeHandle(old) !== findNodeHandle(fresh) && !old.isConnected && old.getNativeRef() === null && !old.isFocused() && !TextInputState.isTextInput(old),
      "Key replacement disconnects and unregisters the retained original ref without aliasing the replacement");
    check(checks, observations.fields["A/primary/0"]?.cleanups === 1 && observations.fields["A/primary/1"]?.mounts === 1,
      "A key replacement performs one component cleanup and one fresh mount");
  }
  if (stage === "removed") {
    const old = retained.get("removed");
    check(checks, old instanceof ReactNativeElement && !old.isConnected && old.getNativeRef() === null && !old.isFocused() &&
      !TextInputState.isTextInput(old) && focused() === null, "Removing the focused input releases its ref, registration and singleton focus");
  }
  if (stage === "partial") {
    check(checks, state.registration.filter(entry => entry.key.startsWith("A/")).every(entry => !entry.registered && !entry.connected && !entry.focused) &&
      state.registration.filter(entry => entry.key.startsWith("B/")).every(entry => entry.registered && entry.connected),
      "Root retirement unregisters only its own public inputs and preserves the surviving registry");
    check(checks, focused() === panels.get("B")?.refs.secondary, "Retiring root A preserves root B's focused singleton entry");
  }
  if (stage === "retiring") {
    const old = retained.get("retiring");
    check(checks, old instanceof ReactNativeElement && old.isConnected && TextInputState.isTextInput(old) &&
      old.getNativeMetrics() === null && old.currentProps?.editable === false,
      "Stopping root rejects focus while its original ref is still connected and registered");
    check(checks, focused() === panels.get("B")?.refs.secondary && !old?.isFocused(),
      "A retained stopping-root ref cannot steal the surviving root's singleton focus");
  }
  if (stage === "off-tree") {
    const old = retained.get("original"), metrics = old?.getNativeMetrics();
    check(checks, old instanceof ReactNativeElement && old.isConnected && TextInputState.isTextInput(old) &&
      metrics?.insideTree === false && old.currentProps?.editable === false,
      "Reparenting rejects focus while the same original registered input is temporarily off-tree");
    check(checks, focused() === panels.get("B")?.refs.secondary && !old?.isFocused(),
      "An off-tree retained ref cannot steal the surviving native input's singleton focus");
  }
  if (stage === "stopped") {
    check(checks, state.registration.length === 7 && state.registration.every(entry => !entry.registered && !entry.connected && !entry.focused && !entry.nativeRefSame) &&
      focused() === null && TextInputState.currentlyFocusedInput() === null && panels.size === 0,
      "Application shutdown clears every original input registration and focused ref");
    check(checks, Object.values(observations.fields).every(field => field.mounts === 1 && field.cleanups === 1 &&
      field.attaches === field.refCleanups && field.callbacksRegistered.every(Boolean)) &&
      observations.cleanups.A === 1 && observations.cleanups.B === 1,
      "All components and callback refs clean up exactly once per mount or attachment");
  }
  return { checks, state };
}
function action(name, operation, id = "primary") {
  const panel = panels.get(name), instance = panel?.refs[id];
  if (panel?.actions[operation]) panel.actions[operation]();
  else if (operation === "focus") instance?.focus();
  else if (operation === "blur") instance?.blur();
  else if (operation === "stateFocus") TextInput.State?.focusTextInput?.(instance);
  else if (operation === "stateBlur") TextInput.State?.blurTextInput?.(instance);
  else if (operation === "commandFocus" && instance) Commands.focus(instance);
  else if (operation === "commandBlur" && instance) Commands.blur(instance);
  else if (operation === "stale") {
    const old = retained.get(id);
    old?.focus(); old?.blur();
    if (old) { Commands.focus(old); Commands.blur(old); }
  }
}
globalThis.GodotFocus = { snapshot, probe, action,
  retain(name, id, key) { retained.set(key, panels.get(name)?.refs[id]); },
};
AppRegistry.registerComponent("FocusPanel", () => FocusPanel);
