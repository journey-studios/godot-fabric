// The retained sabotages of the React microtasks slice (GF-05 slice D1), written once: scripts/react-microtasks-sabotage.mjs runs them, scripts/react-microtasks-bundle.mjs
// applies the ones that break the bundle (in memory: no file is edited) and tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file.
// It has no side effects, so the test can import it. An entry with `host: true` breaks the host's C++: the script patches the source, rebuilds the host, runs the lane and
// puts the source back byte for byte.
//
//   flag-unset    src/runtime.js does not set RN$enableMicrotasksInReact: the pinned renderer keeps its Immediate-task path, and React's sync work no longer commits
//                 in a microtask.
//   promise-shim  queueMicrotask is a Promise job again, as it was before this slice: the module is looked up and never called, so the host's counter stays at zero.
//   gate-removed  the callback queued through the module no longer checks the lifecycle gate: a microtask runs after the application stopped.
//   no-module     the host does not register NativeMicrotasksCxx: the first queueMicrotask throws, and so does React's first update.
//   gate-closed   the host closes the JS gate for the unmount at stop() too: React's own queueMicrotask is refused while the roots unmount, the root's
//                 effect cleanup never runs, and React believes a job is pending for good.
export const SABOTAGES = [
  {name: "flag-unset", file: "src/runtime.js", find: "globalThis.RN$enableMicrotasksInReact = true;\n", replace: ""},
  {name: "promise-shim", file: "src/runtime.js", find: "queueNative(() => { if (active()) callback(); });", replace: "Promise.resolve().then(() => { if (active()) callback(); });"},
  {name: "gate-removed", file: "src/runtime.js", find: "queueNative(() => { if (active()) callback(); });", replace: "queueNative(callback);"},
  {name: "no-module", host: true, hostDirectory: "build/react-microtasks-sabotage-no-module-host", file: "native/application_runtime.cpp",
    find: "    native_modules->add_microtasks();\n", replace: ""},
  {name: "gate-closed", host: true, hostDirectory: "build/react-microtasks-sabotage-gate-closed-host", file: "native/application_runtime.cpp",
    find: "return jsi::Value(!inactive() || unmounting_roots);", replace: "return jsi::Value(!inactive());"},
];
