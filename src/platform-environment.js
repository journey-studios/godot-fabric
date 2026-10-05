import NativeDimensions from "react-native/Libraries/Utilities/Dimensions";
import RCTDeviceEventEmitter from "react-native/Libraries/EventEmitter/RCTDeviceEventEmitter";
import { subscribeDimensions, disposeWindowSubscriptions, windowSnapshot } from "./window-dimensions";
export { default as PixelRatio } from "react-native/Libraries/Utilities/PixelRatio";
// RN's original AppState, fed by the native module that observes Godot's
// application lifecycle notifications. It is constructed on first read.
export { AppState } from "./app-state";

// Políticas explícitas desta surface: tema manual e texto LTR.
// Não são sondas de acessibilidade ou tema do sistema.
let scheme = "light";
const appearanceListeners = new Set();
const motionListeners = new Set();
const dimensionSubscriptions = new Set();
// The device events AppState subscribes to, including its own currentState
// listener. Counting them never constructs AppState.
const appStateEvents = ["appStateDidChange", "appStateFocusChange", "memoryWarning"];
function subscription(listeners, listener) {
  listeners.add(listener);
  return { remove: () => listeners.delete(listener) };
}
function requireEvent(actual, supported) {
  if (actual !== supported)
    throw new Error(`Godot platform does not implement event ${actual}`);
}
export const Dimensions = {
  get: (name) => NativeDimensions.get(name),
  set: (dimensions) => NativeDimensions.set(dimensions),
  addEventListener(event, listener) {
    const native = subscribeDimensions(event, listener);
    const remove = () => {
      if (!dimensionSubscriptions.delete(remove)) return;
      native.remove();
    };
    dimensionSubscriptions.add(remove);
    return { remove };
  },
};
export const Appearance = {
  getColorScheme: () => scheme,
  setColorScheme(value) {
    if (value !== "light" && value !== "dark")
      throw new Error(
        "Godot Appearance requires an explicit light or dark theme",
      );
    scheme = value;
    appearanceListeners.forEach((listener) =>
      listener({ colorScheme: scheme }),
    );
  },
  addChangeListener: (listener) => subscription(appearanceListeners, listener),
};
export const AccessibilityInfo = {
  isReduceMotionEnabled: () => Promise.resolve(false),
  addEventListener(event, listener) {
    requireEvent(event, "reduceMotionChanged");
    return subscription(motionListeners, listener);
  },
};
export const I18nManager = { isRTL: false };
export function environmentStats() {
  return {
    theme: scheme,
    dimensions: dimensionSubscriptions.size,
    appearance: appearanceListeners.size,
    appState: appStateEvents.reduce(
      (count, type) => count + RCTDeviceEventEmitter.listenerCount(type),
      0,
    ),
    reduceMotion: motionListeners.size,
    window: windowSnapshot(),
  };
}
export function disposeEnvironment() {
  // RN sends no AppState event on teardown (Android's onHostDestroy, iOS
  // invalidation), and the native module stops with the application. Release
  // the AppState subscriptions as destroying the VM would.
  for (const type of appStateEvents) {
    RCTDeviceEventEmitter.removeAllListeners(type);
  }
  for (const remove of dimensionSubscriptions) remove();
  disposeWindowSubscriptions();
  for (const listeners of [appearanceListeners, motionListeners]) {
    listeners.clear();
  }
}
