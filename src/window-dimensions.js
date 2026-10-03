import { useSyncExternalStore } from "react";
import Dimensions from "react-native/Libraries/Utilities/Dimensions";

let metrics;
const subscriptions = new Set();

// Track platform-owned subscriptions while RN owns dimension state, native
// event delivery, normalization, and each underlying EventSubscription.
export function subscribeDimensions(event, listener) {
  const native = Dimensions.addEventListener(event, listener);
  const remove = () => {
    if (!subscriptions.delete(remove)) return;
    native.remove();
  };
  subscriptions.add(remove);
  return { remove };
}
function subscribeWindow(listener) {
  return subscribeDimensions("change", listener).remove;
}
export function windowSnapshot() {
  const current = Dimensions.get("window");
  // Always read RN's state, including updates delivered with no subscribers.
  // Equal values retain one snapshot identity for useSyncExternalStore.
  if (!metrics || ["width", "height", "scale", "fontScale"].some(
    (key) => current[key] !== metrics[key],
  )) metrics = Object.freeze({ ...current });
  return metrics;
}
// Application window dimensions follow RN's original DeviceInfo and native
// didUpdateDimensions path. Each React root owns its subscription lifetime.
export function useWindowDimensions() {
  return useSyncExternalStore(subscribeWindow, windowSnapshot);
}
export function windowSubscriptionCount() {
  return subscriptions.size;
}
export function disposeWindowSubscriptions() {
  for (const remove of subscriptions) remove();
}
