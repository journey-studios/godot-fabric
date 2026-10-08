import React, {useEffect} from "react";
import {AppRegistry, Clipboard, Linking, TurboModuleRegistry, Vibration, View} from "react-native";

// Records what JS observes of RN's original Linking, Clipboard and Vibration
// through the public react-native import. RN's index.js reads each lazily, so a
// host without the native module fails only where the API is first read: the
// fixture records that failure and the roots still mount and stop.
const apis = {
  Linking: {read: () => Linking, original: () => require("react-native/Libraries/Linking/Linking").default},
  Clipboard: {read: () => Clipboard, original: () => require("react-native/Libraries/Components/Clipboard/Clipboard").default},
  Vibration: {read: () => Vibration, original: () => require("react-native/Libraries/Vibration/Vibration").default},
};
const access = {};
const calls = [];
const events = [];
const roots = {};
const library = {};
const retained = {};
let sequence = 0;

// JSON cannot carry NaN or Infinity: the probe sends them as {"$number": "NaN"}.
function decode(value) {
  return value != null && typeof value === "object" && "$number" in value ? Number(value.$number) : value;
}
// The first line of an error's message: a host function's exception adds its stack below it.
function message(error) {
  return String(error?.message ?? error).split("\n")[0];
}
// The first read constructs RN's module through the public getter.
function api(name) {
  if (access[name] == null) {
    try {
      const value = apis[name].read();
      access[name] = {available: true, value, sameAsOriginal: value === apis[name].original(), error: null};
    } catch (error) {
      access[name] = {available: false, value: null, sameAsOriginal: false, error: message(error)};
    }
  }
  return access[name];
}
// An API call is recorded whatever happens: it returns, throws, or its promise
// settles later. sequence orders settlements and events against each other.
function record(label, root, name, run) {
  const entry = {id: calls.length + 1, label, root, api: name, state: "pending", value: null, valueUndefined: false, error: null,
    settledAt: null};
  calls.push(entry);
  const target = api(name.split(".")[0]);
  if (!target.available) {
    entry.state = "unavailable";
    entry.error = target.error;
    return;
  }
  const finish = (state, value, error) => {
    entry.state = state;
    entry.valueUndefined = value === undefined;
    entry.value = value === undefined ? null : value;
    entry.error = error;
    entry.settledAt = ++sequence;
  };
  let result;
  try {
    result = run(target.value);
  } catch (error) {
    finish("threw", undefined, message(error));
    return;
  }
  if (result != null && typeof result.then === "function") {
    result.then(value => finish("resolved", value, null), error => finish("rejected", undefined, message(error)));
  } else {
    finish("returned", result, null);
  }
}
const operations = {
  "Linking.openURL": (module, url) => module.openURL(url),
  "Linking.canOpenURL": (module, url) => module.canOpenURL(url),
  "Linking.getInitialURL": module => module.getInitialURL(),
  "Linking.openSettings": module => module.openSettings(),
  "Linking.sendIntent": (module, action) => module.sendIntent(action),
  "Clipboard.getString": module => module.getString(),
  "Clipboard.setString": (module, ...args) => module.setString(...args),
  "Vibration.vibrate": (module, ...args) => module.vibrate(...args),
  "Vibration.cancel": module => module.cancel(),
};
function subscribe(listener, target) {
  const {value} = api("Linking");
  target.url = value.addEventListener("url", event => events.push({sequence: ++sequence, listener, url: event.url, fields: Object.keys(event)}));
}
function directModule(name) {
  const module = TurboModuleRegistry.get(name);
  return module == null ? null : module;
}

function DeviceServicesProbe({name}) {
  useEffect(() => {
    const subscriptions = {};
    roots[name] = {subscriptions, mounted: true, cleanups: 0};
    return () => {
      subscriptions.url?.remove();
      delete subscriptions.url;
      roots[name].mounted = false;
      roots[name].cleanups += 1;
      events.push({sequence: ++sequence, listener: name, url: null, cleanup: true});
    };
  }, [name]);
  return <View testID={"device-services-" + name} style={{width: 120, height: 40, backgroundColor: "#0f766e"}} />;
}
AppRegistry.registerComponent("DeviceServicesProbe", () => DeviceServicesProbe);

globalThis.DeviceServicesProbe = {
  // One call of the public API on behalf of a root. Arguments arrive as JSON.
  run(label, root, name, args = []) {
    record(label, root, name, module => operations[name](module, ...args.map(decode)));
  },
  // A set and a get in one JavaScript turn, with no frame between them.
  sameTick(label, root, value) {
    record(label + "/set", root, "Clipboard.setString", module => module.setString(value));
    record(label + "/get", root, "Clipboard.getString", module => module.getString());
  },
  // The public read of an API on its own: this is what creates the native module.
  read(name) {
    const state = api(name);
    return {available: state.available, sameAsOriginal: state.sameAsOriginal, error: state.error};
  },
  subscribe(root) {
    const target = root === "library" ? library : roots[root]?.subscriptions;
    if (api("Linking").available && target != null) {
      subscribe(root, target);
    }
  },
  // Removing twice must be as harmless as RN's original subscription.
  unsubscribe(root) {
    const target = root === "library" ? library : roots[root]?.subscriptions;
    target?.url?.remove();
    target?.url?.remove();
    if (target != null) {
      delete target.url;
    }
  },
  // The JS-side vibration state machine is RN's: these read nothing native.
  retain() {
    for (const name of ["LinkingManager", "Clipboard", "Vibration"]) {
      retained[name] = directModule(name);
    }
    return Object.fromEntries(Object.entries(retained).map(([name, module]) => [name, module != null]));
  },
  // A call on the native module itself, with whatever arguments, as a retained
  // reference would make after stop.
  direct(label, moduleName, method, args = []) {
    const entry = {id: calls.length + 1, label, root: null, api: moduleName + "." + method, state: "pending", value: null,
      valueUndefined: false, error: null, settledAt: null};
    calls.push(entry);
    try {
      const module = retained[moduleName] ?? directModule(moduleName);
      if (module == null) {
        entry.state = "unavailable";
        entry.error = "native module is missing";
        return;
      }
      const result = module[method](...args.map(decode));
      if (result != null && typeof result.then === "function") {
        result.then(value => Object.assign(entry, {state: "resolved", value: value ?? null, settledAt: ++sequence}),
          error => Object.assign(entry, {state: "rejected", error: message(error), settledAt: ++sequence}));
      } else {
        Object.assign(entry, {state: "returned", value: result ?? null, settledAt: ++sequence});
      }
    } catch (error) {
      Object.assign(entry, {state: "threw", error: message(error), settledAt: ++sequence});
    }
  },
  // Pure JS reads only: this stays valid after the application stops.
  snapshot() {
    const emitter = globalThis.__rctDeviceEventEmitter;
    return {
      access: Object.fromEntries(Object.entries(access).map(([name, state]) =>
        [name, {available: state.available, sameAsOriginal: state.sameAsOriginal, error: state.error}])),
      listeners: {url: emitter == null ? null : emitter.listenerCount("url")},
      roots: Object.fromEntries(Object.entries(roots).map(([name, root]) =>
        [name, {mounted: root.mounted, cleanups: root.cleanups, subscriptions: Object.keys(root.subscriptions)}])),
      library: Object.keys(library),
      retained: Object.fromEntries(Object.entries(retained).map(([name, module]) => [name, module != null])),
      calls, events,
    };
  },
};
