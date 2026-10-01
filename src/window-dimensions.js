import { useSyncExternalStore } from "react";

let metrics = Object.freeze(godotWindowMetrics());
const listeners = new Set();
function update(next) {
  if (
    ["width", "height", "scale", "fontScale"].every(
      (key) => next[key] === metrics[key],
    )
  )
    return;
  metrics = Object.freeze(next);
  listeners.forEach((listener) => listener());
}
export function subscribeWindow(listener) {
  if (listeners.size === 0) {
    godotSetWindowListener(update);
    update(godotWindowMetrics());
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) godotSetWindowListener(null);
  };
}
export function windowSnapshot() {
  return metrics;
}
// Surface dimensions in Godot logical coordinates. Stable snapshots avoid
// tearing and spurious renders; native callbacks are queued by the host.
export function useWindowDimensions() {
  return useSyncExternalStore(subscribeWindow, windowSnapshot);
}
export function windowSubscriptionCount() {
  return listeners.size;
}
