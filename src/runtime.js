// The host's timers, microtasks and immediates, over the TimerManager the host attached before this module is evaluated. RN's setUpTimers
// (Libraries/Core/setUpTimers.js, its RN$Bridgeless branch) is the model. Slice D2 adds NativeIdleCallbacks, imports setUpTimers unchanged
// and removes from this file what setUpTimers then installs; docs/compatibility/bootstrap-audit-0.87.1.json says which part is whose.
import { setImmediate, clearImmediate } from "react-native/Libraries/Core/Timers/immediateShim";

const active = globalThis.godotRuntimeActive;
// The host's lifecycle gate (V2-D27), which RN does not have: once the application is inactive, no timer, frame or microtask callback
// runs and none is scheduled. RN destroys its runtime with the callbacks still pending; this host stops an application while its Hermes
// still drains microtasks (Impl::stop pumps), so the callbacks check. The host keeps the gate open while stop() unmounts the roots,
// because React's own unmount queues a microtask (RN$enableMicrotasksInReact below), and drains what user code queued before the stop with
// the gate closed.
for (const name of ["setTimeout", "setInterval", "requestAnimationFrame"]) {
  const native = globalThis[name];
  globalThis[name] = (...args) => active() ? native(...args) : 0;
}
// As setUpTimers sets it, and before the renderer evaluates: ReactFabric-prod.js reads it once, when it evaluates, and with it true
// schedules the work of its sync lanes with queueMicrotask instead of a RuntimeScheduler Immediate task.
globalThis.RN$enableMicrotasksInReact = true;
// RN's NativeMicrotasks module queues the callback on the runtime's microtask queue, the one Hermes drains after each task. It is looked
// up on first use, as setUpTimers' polyfillGlobal does; RN installs the module's own function, and this is that function behind the gate.
let queueNative = null;
globalThis.queueMicrotask = (callback) => {
  if (typeof callback !== "function") throw new TypeError("queueMicrotask requires a function");
  if (active()) {
    if (queueNative === null) {
      queueNative = require("../node_modules/react-native/src/private/webapis/microtasks/specs/NativeMicrotasks").default.queueMicrotask;
    }
    queueNative(() => { if (active()) callback(); });
  }
};
globalThis.setImmediate = setImmediate;
globalThis.clearImmediate = clearImmediate;
