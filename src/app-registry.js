import * as Registry from "react-native/Libraries/ReactNative/AppRegistryImpl";
import * as Fabric from "react-native/Libraries/Renderer/implementations/ReactFabric-prod";
import { forgetSurface, isRunningSurface } from "./render-application";
export { RootTagContext } from "react-native/Libraries/ReactNative/RootTag";

// UIManager's upstream AppRegistryBinding calls these functions for every root.
// Godot replaces only renderApplication's native container, not the registry or
// reconciler. Native FabricApplication owns mounting and global shutdown.
globalThis.RN$AppRegistry = Registry;
// The host stops a root through this global. The facade learns from it that the
// surface is gone, so that a later run or update of its tag is refused.
globalThis.RN$stopSurface = rootTag => {
  try {
    return Fabric.stopSurface(rootTag);
  } finally {
    forgetSurface(rootTag);
  }
};

// The code leads the message and is also a field, as in the E_* errors of godot-fabric.js.
function failure(code, message) {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}

// V2-D01: the registry is one table whatever the route that fills it (component, section, runnable or config), and a key
// registered once is never replaced. RN's own registry overwrites silently, and its plain object lets `__proto__` change the
// prototype of the table.
const RESERVED_KEYS = ["__proto__", "constructor", "prototype"];
function isKey(key) {
  return typeof key === "string" && key.trim() !== "";
}
function claimable(key) {
  if (Registry.getAppKeys().includes(key) || RESERVED_KEYS.includes(key)) {
    throw new Error(`AppRegistry component key is already registered or reserved: ${key}`);
  }
}

// The four headless-task members exist so that RN code that names them still loads, and they fail where they are called: a
// headless task is an Android service (HeadlessJsTaskService) that runs JS with no UI, and a Godot application has no such
// service to start one.
function headlessTask(member) {
  return () => {
    throw failure("E_APP_REGISTRY_HEADLESS_TASK",
      `AppRegistry.${member} is not implemented: headless JS tasks are an Android service feature and Godot has no background service to run them`);
  };
}

// Godot creates a surface from the scene (FabricSurface.mount()), so JS can only run or update a surface that exists.
function requireSurface(member, appParameters) {
  const rootTag = appParameters?.rootTag;
  if (!isRunningSurface(rootTag)) {
    throw failure("E_APP_REGISTRY_UNKNOWN_ROOT",
      `AppRegistry.${member} found no running surface with rootTag ${String(rootTag)}: mount a FabricSurface to create one`);
  }
}

export const AppRegistry = Object.freeze({
  setWrapperComponentProvider: Registry.setWrapperComponentProvider,
  setRootViewStyleProvider: Registry.setRootViewStyleProvider,
  registerConfig(config) {
    if (!Array.isArray(config)) {
      throw new TypeError("AppRegistry.registerConfig requires an array of app configs");
    }
    const keys = new Set();
    for (const appConfig of config) {
      if (!isKey(appConfig?.appKey) || (appConfig.run != null && typeof appConfig.run !== "function") ||
        (appConfig.component != null && typeof appConfig.component !== "function")) {
        throw new TypeError("AppRegistry.registerConfig requires a nonempty appKey and a component provider or run function");
      }
      claimable(appConfig.appKey);
      if (keys.has(appConfig.appKey)) {
        throw new Error(`AppRegistry component key is already registered or reserved: ${appConfig.appKey}`);
      }
      keys.add(appConfig.appKey);
    }
    // RN's own invariant still judges a config that has neither `run` nor `component`, after the entries before it.
    return Registry.registerConfig(config);
  },
  registerComponent(key, provider, section) {
    if (!isKey(key) || typeof provider !== "function") {
      throw new TypeError("AppRegistry requires a nonempty key and component provider");
    }
    claimable(key);
    return Registry.registerComponent(key, provider, section);
  },
  registerRunnable(key, run) {
    if (!isKey(key) || typeof run !== "function") {
      throw new TypeError("AppRegistry requires a nonempty key and run function");
    }
    claimable(key);
    return Registry.registerRunnable(key, run);
  },
  registerSection(key, provider) {
    if (!isKey(key) || typeof provider !== "function") {
      throw new TypeError("AppRegistry requires a nonempty key and component provider");
    }
    claimable(key);
    return Registry.registerSection(key, provider);
  },
  getAppKeys: Registry.getAppKeys,
  getSectionKeys: Registry.getSectionKeys,
  getSections: Registry.getSections,
  // RN reads a plain object, so a name such as "toString" would answer Object.prototype's function for a key nobody registered.
  getRunnable(key) {
    return Registry.getAppKeys().includes(key) ? Registry.getRunnable(key) : undefined;
  },
  getRegistry: Registry.getRegistry,
  setComponentProviderInstrumentationHook: Registry.setComponentProviderInstrumentationHook,
  runApplication(appKey, appParameters, displayMode) {
    requireSurface("runApplication", appParameters);
    return Registry.runApplication(appKey, appParameters, displayMode);
  },
  setSurfaceProps(appKey, appParameters, displayMode) {
    requireSurface("setSurfaceProps", appParameters);
    return Registry.setSurfaceProps(appKey, appParameters, displayMode);
  },
  // RN's Fabric logs an error and unmounts nothing: the unmount belongs to the host, here FabricSurface.unmount().
  unmountApplicationComponentAtRootTag: Registry.unmountApplicationComponentAtRootTag,
  registerHeadlessTask: headlessTask("registerHeadlessTask"),
  registerCancellableHeadlessTask: headlessTask("registerCancellableHeadlessTask"),
  startHeadlessTask: headlessTask("startHeadlessTask"),
  cancelHeadlessTask: headlessTask("cancelHeadlessTask"),
});
