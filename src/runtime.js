// Reuse RN's bridgeless immediate implementation and portable microtask shim.
// TimerManager installs native timers before this module is evaluated.
import queueMicrotask from "react-native/Libraries/Core/Timers/queueMicrotask";
import { setImmediate, clearImmediate } from "react-native/Libraries/Core/Timers/immediateShim";

const active = globalThis.godotRuntimeActive;
for (const name of ["setTimeout", "setInterval", "requestAnimationFrame"]) {
  const native = globalThis[name];
  globalThis[name] = (...args) => active() ? native(...args) : 0;
}
globalThis.queueMicrotask = (callback) => {
  if (typeof callback !== "function") throw new TypeError("queueMicrotask requires a function");
  if (active()) queueMicrotask(() => { if (active()) callback(); });
};
globalThis.setImmediate = setImmediate;
globalThis.clearImmediate = clearImmediate;
