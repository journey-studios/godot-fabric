import React, {useEffect, useRef} from "react";
import {AccessibilityInfo, AppRegistry, TurboModuleRegistry, View} from "react-native";

// Records what JS observes of RN's original AccessibilityInfo through the public react-native import. RN's
// index.js reads it lazily, and AccessibilityInfo.js looks its native modules up when it is first imported, so a
// host without the AccessibilityManager module fails only where a getter needs it: the fixture records that
// failure and the roots still mount and stop.
const access = {};
const calls = [];
const events = [];
const roots = {};
const subscriptions = {};
const retained = {};
// The device events AccessibilityInfo.js maps its public names to on the iOS branch.
const deviceEvents = ["screenReaderChanged", "reduceMotionChanged", "reduceTransparencyChanged", "darkerSystemColorsChanged",
  "boldTextChanged", "grayscaleChanged", "invertColorsChanged", "announcementFinished"];
let sequence = 0;

// JSON cannot carry NaN or Infinity: the probe sends them as {"$number": "NaN"}.
function decode(value) {
  if (value != null && typeof value === "object" && !Array.isArray(value) && "$number" in value) {
    return Number(value.$number);
  }
  if (Array.isArray(value)) {
    return value.map(decode);
  }
  if (value != null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]));
  }
  return value;
}
// The first line of an error's message: a host function's exception adds its stack below it.
function message(error) {
  return String(error?.message ?? error).split("\n")[0];
}
// The first read constructs RN's AccessibilityInfo through the public getter.
function api() {
  if (access.AccessibilityInfo == null) {
    try {
      const value = AccessibilityInfo;
      access.AccessibilityInfo = {available: true, value, error: null,
        sameAsOriginal: value === require("react-native/Libraries/Components/AccessibilityInfo/AccessibilityInfo").default};
    } catch (error) {
      access.AccessibilityInfo = {available: false, value: null, sameAsOriginal: false, error: message(error)};
    }
  }
  return access.AccessibilityInfo;
}
// A call is recorded whatever happens: it returns, throws, or its promise settles later. sequence orders the
// settlements and the events against each other.
function record(label, root, name, run) {
  const entry = {id: calls.length + 1, label, root, api: name, state: "pending", value: null, valueUndefined: false, error: null,
    settledAt: null};
  calls.push(entry);
  const target = api();
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
  "AccessibilityInfo.isScreenReaderEnabled": module => module.isScreenReaderEnabled(),
  "AccessibilityInfo.isReduceMotionEnabled": module => module.isReduceMotionEnabled(),
  "AccessibilityInfo.isReduceTransparencyEnabled": module => module.isReduceTransparencyEnabled(),
  "AccessibilityInfo.isDarkerSystemColorsEnabled": module => module.isDarkerSystemColorsEnabled(),
  "AccessibilityInfo.isBoldTextEnabled": module => module.isBoldTextEnabled(),
  "AccessibilityInfo.isGrayscaleEnabled": module => module.isGrayscaleEnabled(),
  "AccessibilityInfo.isInvertColorsEnabled": module => module.isInvertColorsEnabled(),
  "AccessibilityInfo.prefersCrossFadeTransitions": module => module.prefersCrossFadeTransitions(),
  "AccessibilityInfo.isHighTextContrastEnabled": module => module.isHighTextContrastEnabled(),
  "AccessibilityInfo.isAccessibilityServiceEnabled": module => module.isAccessibilityServiceEnabled(),
  "AccessibilityInfo.getRecommendedTimeoutMillis": (module, args) => module.getRecommendedTimeoutMillis(...args),
  "AccessibilityInfo.announceForAccessibility": (module, args) => module.announceForAccessibility(...args),
  "AccessibilityInfo.announceForAccessibilityWithOptions": (module, args) => module.announceForAccessibilityWithOptions(...args),
  "AccessibilityInfo.setAccessibilityFocus": (module, args) => module.setAccessibilityFocus(...args),
};

function AccessibilityInfoProbe({name}) {
  const ref = useRef(null);
  useEffect(() => {
    roots[name] = {mounted: true, cleanups: 0, ref};
    return () => {
      // A root removes the subscriptions it made, as a screen's effect cleanup would.
      for (const [id, entry] of Object.entries(subscriptions)) {
        if (entry.root === name) {
          entry.subscription.remove();
          delete subscriptions[id];
        }
      }
      roots[name].mounted = false;
      roots[name].cleanups += 1;
      events.push({sequence: ++sequence, id: name, cleanup: true});
    };
  }, [name]);
  return <View ref={ref} testID={"accessibility-info-" + name} style={{width: 120, height: 40, backgroundColor: "#0f766e"}} />;
}
AppRegistry.registerComponent("AccessibilityInfoProbe", () => AccessibilityInfoProbe);

globalThis.AccessibilityInfoProbe = {
  // One call of the public API on behalf of a root. Arguments arrive as JSON.
  run(label, root, name, args = []) {
    record(label, root, name, module => operations[name](module, decode(args)));
  },
  // The public sendAccessibilityEvent on the root's own View.
  send(label, root, type) {
    record(label, root, "AccessibilityInfo.sendAccessibilityEvent", module => module.sendAccessibilityEvent(roots[root].ref.current, type));
  },
  // The public read of AccessibilityInfo on its own: this is what creates the native module.
  read() {
    const state = api();
    return {available: state.available, sameAsOriginal: state.sameAsOriginal, error: state.error};
  },
  // RN's Android module is not the host's: the lookup finds nothing, and it creates nothing.
  androidModule() {
    return TurboModuleRegistry.get("AccessibilityInfo") != null;
  },
  subscribe(id, root, event) {
    const target = api();
    if (!target.available) {
      return null;
    }
    const subscription = target.value.addEventListener(event, value => events.push({sequence: ++sequence, id, event, value}));
    subscriptions[id] = {subscription, event, root};
    return {removable: typeof subscription?.remove === "function", keys: Object.keys(subscription ?? {})};
  },
  // Removing twice must be as harmless as RN's original subscription.
  unsubscribe(id) {
    const entry = subscriptions[id];
    entry?.subscription.remove();
    entry?.subscription.remove();
    delete subscriptions[id];
  },
  retain() {
    retained.AccessibilityManager = TurboModuleRegistry.get("AccessibilityManager");
    return {AccessibilityManager: retained.AccessibilityManager != null};
  },
  // A call on the native module itself, with whatever arguments, as a retained reference would make after stop. An
  // argument {"$callback": name} is a function that records how it was called.
  direct(label, method, args = []) {
    const entry = {id: calls.length + 1, label, root: null, api: "AccessibilityManager." + method, state: "pending", value: null,
      valueUndefined: false, error: null, settledAt: null, callbacks: []};
    calls.push(entry);
    try {
      const module = retained.AccessibilityManager ?? TurboModuleRegistry.get("AccessibilityManager");
      if (module == null) {
        entry.state = "unavailable";
        entry.error = "native module is missing";
        return;
      }
      const real = args.map(arg => arg != null && typeof arg === "object" && "$callback" in arg
        ? received => entry.callbacks.push({name: arg.$callback, sequence: ++sequence, isError: received instanceof Error,
          value: received instanceof Error ? null : received, message: received instanceof Error ? message(received) : null})
        : decode(arg));
      const result = module[method](...real);
      Object.assign(entry, {state: "returned", value: result ?? null, valueUndefined: result === undefined, settledAt: ++sequence});
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
      listeners: Object.fromEntries(deviceEvents.map(name => [name, emitter == null ? null : emitter.listenerCount(name)])),
      roots: Object.fromEntries(Object.entries(roots).map(([name, root]) => [name, {mounted: root.mounted, cleanups: root.cleanups}])),
      subscriptions: Object.fromEntries(Object.entries(subscriptions).map(([id, entry]) => [id, entry.event])),
      retained: Object.fromEntries(Object.entries(retained).map(([name, module]) => [name, module != null])),
      calls, events,
    };
  },
};
