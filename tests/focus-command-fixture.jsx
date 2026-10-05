import React, { useCallback, useLayoutEffect, useState } from "react";
import { AppRegistry, View, TextInput, codegenNativeCommands, findNodeHandle } from "react-native";
import * as Renderer from "react-native/Libraries/Renderer/implementations/ReactFabric-prod";
import OriginalTextInputState from "react-native/Libraries/Components/TextInput/TextInputState";

// Test-only dispatch intentionally bypasses the public State eligibility check
// so malformed arguments must be rejected by the actual native command guard.
const Commands = codegenNativeCommands({ supportedCommands: ["focus", "blur"] });
const roots = new Map(), fields = new Map(), mountedInputs = new Map(), retained = new Map();
const observations = { mounts: {}, cleanups: {}, events: [] };
const keyFor = (name, field) => `${name}-${field}`;
const tag = instance => instance ? findNodeHandle(instance) : null;

function record(name, field, type, instance) {
  const current = TextInput.State.currentlyFocusedInput();
  observations.events.push({ name, field, type, tag: tag(instance), focusedTag: tag(current),
    stateAgrees: OriginalTextInputState.currentlyFocusedInput() === current &&
      (type === "focus" ? current === instance : type === "blur" ? current !== instance : true) });
}

function FixtureInput({ name, field, editable = true, value }) {
  const ref = useCallback(instance => {
    if (!instance) return;
    fields.set(keyFor(name, field), instance);
    mountedInputs.set(keyFor(name, field), instance);
    return () => fields.delete(keyFor(name, field));
  }, [name, field]);
  return <TextInput testID={keyFor(name, field)} ref={ref} editable={editable} value={value}
    style={{ width: 220, height: 42, marginBottom: 8, backgroundColor: "#203251", color: "#ffffff" }}
    onFocus={() => record(name, field, "focus", fields.get(keyFor(name, field)))}
    onBlur={() => record(name, field, "blur", fields.get(keyFor(name, field)))}
    onEndEditing={() => record(name, field, "end", fields.get(keyFor(name, field)))} />;
}

function FocusCommandsFixture({ name }) {
  const [victim, setVictim] = useState(true);
  const [updates, setUpdates] = useState(0);
  useLayoutEffect(() => {
    observations.mounts[name] = (observations.mounts[name] ?? 0) + 1;
    return () => { observations.cleanups[name] = (observations.cleanups[name] ?? 0) + 1; };
  }, [name]);
  useLayoutEffect(() => {
    roots.set(name, { updates, remove: () => setVictim(false), update: () => setUpdates(count => count + 1) });
    return () => roots.delete(name);
  }, [name, updates]);
  return <View testID={keyFor(name, "panel")} style={{ width: 260, height: 200 }}>
    <FixtureInput name={name} field="input" value={`${name}:${updates}`} />
    <FixtureInput name={name} field="readonly" editable={false} value="Read only" />
    {victim && <FixtureInput name={name} field="victim" value="Removable" />}
  </View>;
}

globalThis.FocusCommandFixture = {
  command(name, field, command) { Commands[command](fields.get(keyFor(name, field))); },
  raw(name, field, command, kind) {
    const args = { null: null, object: { unexpected: true }, string: "unexpected", nonempty: [1] }[kind];
    Renderer.dispatchCommand(fields.get(keyFor(name, field)), command, args);
  },
  retain(name, field, key) { retained.set(key, fields.get(keyFor(name, field))); },
  stale(key) {
    const instance = retained.get(key);
    Renderer.dispatchCommand(instance, "focus", []);
    Renderer.dispatchCommand(instance, "blur", []);
    Renderer.dispatchCommand(instance, "focus", [1]);
    Renderer.dispatchCommand(instance, "blur", null);
    TextInput.State.focusTextInput(instance);
    TextInput.State.blurTextInput(instance);
  },
  action(name, action) { roots.get(name)?.[action](); },
  snapshot() {
    const current = TextInput.State.currentlyFocusedInput();
    const describe = instance => ({ tag: tag(instance), connected: instance.isConnected,
      registered: OriginalTextInputState.isTextInput(instance), focused: instance.isFocused(),
      nativeFocused: instance.getNativeMetrics()?.focused ?? false,
      editable: instance.currentProps?.editable });
    return { focusedTag: tag(current), focusedKey: [...fields].find(([, instance]) => instance === current)?.[0] ?? null,
      originalSingletonSame: current === OriginalTextInputState.currentlyFocusedInput(),
      live: Object.fromEntries([...fields].map(([key, instance]) => [key, describe(instance)])),
      registrations: Object.fromEntries([...mountedInputs].map(([key, instance]) => [key, describe(instance)])),
      retained: Object.fromEntries([...retained].map(([key, instance]) => [key, describe(instance)])),
      updates: Object.fromEntries([...roots].map(([name, entry]) => [name, entry.updates])),
      mounts: { ...observations.mounts }, cleanups: { ...observations.cleanups },
      events: observations.events.map(event => ({ ...event })) };
  },
};
AppRegistry.registerComponent("FocusCommandsFixture", () => FocusCommandsFixture);
