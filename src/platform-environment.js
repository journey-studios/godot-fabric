import NativeDimensions from "react-native/Libraries/Utilities/Dimensions";
import RCTDeviceEventEmitter from "react-native/Libraries/EventEmitter/RCTDeviceEventEmitter";
import { subscribeDimensions, disposeWindowSubscriptions, windowSnapshot } from "./window-dimensions";
export { default as PixelRatio } from "react-native/Libraries/Utilities/PixelRatio";
// RN's original AppState, fed by the native module that observes Godot's
// application lifecycle notifications. It is constructed on first read.
export { AppState } from "./app-state";
// RN's original Appearance, fed by Godot's system theme and setColorScheme().
// It looks its native module up lazily, on its first call.
export * as Appearance from "react-native/Libraries/Utilities/Appearance";

// Políticas explícitas desta surface: movimento reduzido desligado e texto LTR.
// Não são sondas de acessibilidade do sistema.
const motionListeners = new Set();
const dimensionSubscriptions = new Set();
// The device events AppState and Appearance subscribe to, including their own
// internal listeners. Counting them never constructs either module.
const appStateEvents = ["appStateDidChange", "appStateFocusChange", "memoryWarning"];
const appearanceEvent = "appearanceChanged";
// The device events RN's XMLHttpRequest subscribes to for each request in flight.
const networkEvents = [
  "didSendNetworkData", "didReceiveNetworkResponse", "didReceiveNetworkData",
  "didReceiveNetworkIncrementalData", "didReceiveNetworkDataProgress", "didCompleteNetworkResponse",
];
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
    dimensions: dimensionSubscriptions.size,
    appearance: RCTDeviceEventEmitter.listenerCount(appearanceEvent),
    appState: appStateEvents.reduce(
      (count, type) => count + RCTDeviceEventEmitter.listenerCount(type),
      0,
    ),
    networking: networkEvents.reduce(
      (count, type) => count + RCTDeviceEventEmitter.listenerCount(type),
      0,
    ),
    reduceMotion: motionListeners.size,
    window: windowSnapshot(),
  };
}
export function disposeEnvironment() {
  // RN sends no AppState, Appearance or networking event on teardown (Android's
  // onHostDestroy, iOS invalidation), and the native modules stop with the
  // application. Release their device subscriptions as destroying the VM
  // would; Appearance's own change listeners hang off its single one, and a
  // request still in flight holds six of the networking ones.
  for (const type of [...appStateEvents, appearanceEvent, ...networkEvents]) {
    RCTDeviceEventEmitter.removeAllListeners(type);
  }
  for (const remove of dimensionSubscriptions) remove();
  disposeWindowSubscriptions();
  motionListeners.clear();
}
