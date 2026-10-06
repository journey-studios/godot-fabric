import React, {useEffect} from "react";
import {AppRegistry, AppState, TurboModuleRegistry, View} from "react-native";
import {disposeEnvironment, environmentStats} from "../src/platform-environment";

// Records what JS observes of RN's original AppState through the public
// react-native import. RN's index.js reads AppState lazily, so a host without
// the native AppState module fails only where AppState is first read: the
// fixture records that failure and the roots still mount and stop.
const events = ["change", "memoryWarning", "focus", "blur"];
const log = [];
const roots = {};
const queries = [];
const library = {};
let sequence = 0;
let access = null;
let retainedGetConstants = null;

function readAppState() {
  if (access == null) {
    try {
      // The first read constructs RN's AppStateImpl through the public getter.
      const appState = AppState;
      const original = require("react-native/Libraries/AppState/AppState").default;
      access = {available: true, appState, sameAsOriginal: appState === original, error: null};
    } catch (error) {
      access = {available: false, appState: null, sameAsOriginal: false, error: String(error?.message ?? error)};
    }
  }
  return access;
}
function currentState() {
  return readAppState().available ? AppState.currentState : null;
}
function record(root, event, value) {
  log.push({sequence: ++sequence, root, event, value: value ?? null, currentState: currentState()});
}
function subscribe(root, target) {
  const {appState} = readAppState();
  for (const event of events) {
    target[event] = appState.addEventListener(event, value => record(root, event, value));
  }
}
function message(callback) {
  try {
    callback();
    return null;
  } catch (error) {
    return String(error?.message ?? error);
  }
}

// A library-style subscription made at bundle evaluation, like css-interop's.
// It is never removed, so any event that crossed stop would reach it.
if (readAppState().available) {
  subscribe("library", library);
  retainedGetConstants = TurboModuleRegistry.get("AppState").getConstants;
}

function AppStateProbe({name}) {
  useEffect(() => {
    const subscriptions = {};
    roots[name] = {subscriptions, mounted: true, cleanups: 0};
    if (readAppState().available) {
      subscribe(name, subscriptions);
    }
    return () => {
      for (const subscription of Object.values(subscriptions)) {
        subscription.remove();
      }
      roots[name].mounted = false;
      roots[name].cleanups += 1;
      record(name, "cleanup", null);
    };
  }, [name]);
  return <View testID={"app-state-" + name} style={{width: 120, height: 40, backgroundColor: "#2563eb"}} />;
}
AppRegistry.registerComponent("AppStateProbe", () => AppStateProbe);

globalThis.AppStateProbe = {
  // Pure JS reads only: this stays valid after the application stops.
  snapshot() {
    const state = readAppState();
    const emitter = globalThis.__rctDeviceEventEmitter;
    return {
      access: {available: state.available, sameAsOriginal: state.sameAsOriginal, error: state.error,
        isAvailable: state.available ? AppState.isAvailable : null},
      currentState: currentState(),
      listeners: Object.fromEntries(["appStateDidChange", "appStateFocusChange", "memoryWarning"]
        .map(type => [type, emitter.listenerCount(type)])),
      roots: Object.fromEntries(Object.entries(roots).map(([name, root]) => [name,
        {mounted: root.mounted, cleanups: root.cleanups, subscriptions: Object.keys(root.subscriptions)}])),
      log, queries,
    };
  },
  initial() {
    const module = TurboModuleRegistry.get("AppState");
    return {
      nativeModule: module != null,
      constants: module == null ? null : module.getConstants(),
      unknownEvent: readAppState().available ? message(() => AppState.addEventListener("suspend", () => {})) : null,
    };
  },
  // RN's own getCurrentAppState on the actual native module; the reply arrives
  // asynchronously, as on iOS and Android.
  query(label) {
    const module = TurboModuleRegistry.get("AppState");
    if (module == null) {
      queries.push({label, value: null, error: "AppState native module is missing"});
      return;
    }
    module.getCurrentAppState(data => queries.push({label, value: data.app_state, error: null}),
      error => queries.push({label, value: null, error: String(error?.message ?? error)}));
  },
  remove(name, removed) {
    const subscriptions = roots[name]?.subscriptions ?? {};
    for (const event of removed) {
      // Removing twice must be as harmless as RN's original subscription.
      subscriptions[event]?.remove();
      subscriptions[event]?.remove();
      delete subscriptions[event];
    }
  },
  afterStop() {
    return {
      currentState: currentState(),
      retainedGetConstants: retainedGetConstants == null ? null : message(() => retainedGetConstants()),
      lookup: message(() => TurboModuleRegistry.get("AppState")),
    };
  },
  // The SDK's exit helper, as the NativeWind and typography examples call it.
  dispose() {
    disposeEnvironment();
    return {environment: environmentStats(), log: log.length, currentState: currentState()};
  },
};
