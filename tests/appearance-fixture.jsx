import React, {useEffect} from "react";
import {AppRegistry, Appearance, TurboModuleRegistry, View, useColorScheme} from "react-native";
import {disposeEnvironment, environmentStats} from "../src/platform-environment";

// Records what JS observes of RN's original Appearance and useColorScheme
// through the public react-native import. Appearance looks its native module
// up with TurboModuleRegistry.get, so on a host without the module every read
// is null and nothing is ever emitted, while the roots still mount and stop.
const colors = {light: "#e2e8f0", dark: "#0f172a", none: "#ef4444"};
const log = [];
const renders = [];
const roots = {};
const errors = [];
let sequence = 0;

function record(root, colorScheme) {
  log.push({sequence: ++sequence, root, event: "change", colorScheme, read: Appearance.getColorScheme()});
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
Appearance.addChangeListener(({colorScheme}) => record("library", colorScheme));
const retainedGetColorScheme = TurboModuleRegistry.get("Appearance")?.getColorScheme ?? null;

function AppearanceProbe({name}) {
  const scheme = useColorScheme();
  useEffect(() => {
    renders.push({sequence: ++sequence, root: name, scheme});
  }, [name, scheme]);
  useEffect(() => {
    const subscription = Appearance.addChangeListener(({colorScheme}) => record(name, colorScheme));
    roots[name] = {subscription, mounted: true, cleanups: 0, listening: true};
    return () => {
      subscription.remove();
      roots[name].mounted = false;
      roots[name].listening = false;
      roots[name].cleanups += 1;
      log.push({sequence: ++sequence, root: name, event: "cleanup", colorScheme: null, read: Appearance.getColorScheme()});
    };
  }, [name]);
  return <View testID={"appearance-" + name} style={{width: 120, height: 40, backgroundColor: colors[scheme ?? "none"]}} />;
}
AppRegistry.registerComponent("AppearanceProbe", () => AppearanceProbe);

globalThis.AppearanceProbe = {
  // Pure JS reads only: this stays valid after the application stops.
  snapshot() {
    const emitter = globalThis.__rctDeviceEventEmitter;
    return {
      colorScheme: Appearance.getColorScheme(),
      nativeModule: retainedGetColorScheme != null,
      deviceListeners: emitter.listenerCount("appearanceChanged"),
      roots: Object.fromEntries(Object.entries(roots).map(([name, root]) => [name,
        {mounted: root.mounted, listening: root.listening, cleanups: root.cleanups}])),
      log, renders, errors,
    };
  },
  set(value) {
    const error = message(() => Appearance.setColorScheme(value));
    if (error != null) {
      errors.push({value, error});
    }
    return {error, colorScheme: Appearance.getColorScheme()};
  },
  remove(name) {
    // Removing twice must be as harmless as RN's original subscription.
    roots[name].subscription.remove();
    roots[name].subscription.remove();
    roots[name].listening = false;
  },
  afterStop() {
    return {
      colorScheme: Appearance.getColorScheme(),
      retainedGetColorScheme: retainedGetColorScheme == null ? null : message(() => retainedGetColorScheme()),
      lookup: message(() => TurboModuleRegistry.get("Appearance")),
    };
  },
  // The SDK's exit helper, as the NativeWind and typography examples call it.
  dispose() {
    disposeEnvironment();
    return {environment: environmentStats(), log: log.length, colorScheme: Appearance.getColorScheme()};
  },
};
