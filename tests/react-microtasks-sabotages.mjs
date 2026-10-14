// The retained sabotages of the React microtasks slice (GF-05 slice D1), written once: scripts/react-microtasks-sabotage.mjs runs them, scripts/react-microtasks-bundle.mjs
// applies the ones that break the bundle (in memory: no file is edited) and tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file.
// It has no side effects, so the test can import it. An entry with `host: true` breaks the host's C++: the script patches the source, rebuilds the host, runs the lane and
// puts the source back byte for byte.
//
//   flag-unset            RN's setUpTimers does not set RN$enableMicrotasksInReact (the line is taken out of the bundled text of Libraries/Core/setUpTimers.js, in memory):
//                         the pinned renderer keeps its Immediate-task path, and React's sync work no longer commits in a microtask.
//   promise-shim          queueMicrotask is a Promise job again, as it was before this slice: the module is looked up and never called, so the host's counter stays at zero.
//   gate-removed          queueMicrotask no longer asks the gate whether to queue: once the application has stopped a microtask still reaches the module.
//   no-module             the host does not register NativeMicrotasksCxx: the first queueMicrotask throws, and so does React's first update.
//   gate-closed           the host closes the JS gate for the unmount at stop() too: React's own queueMicrotask is refused while the roots unmount, the root's
//                         effect cleanup never runs, and React believes a job is pending for good.
//   request-closes-gate   the host closes the JS gate at the stop request, as it did before the checkpoint: a stop that a native signal requests in the middle of a
//                         commit makes the queueMicrotask React calls to finish that commit refused, and the root is never unmounted.
//   checkpoint-gate-closed the pending microtasks drain with the gate already closed: what was queued before the stop, React's job included, is dropped.
//
// Slice D2 moved the flag and the installation to RN's setUpTimers and the gate to a wrapper of the global's getter in src/runtime.js; flag-unset, promise-shim and
// gate-removed were anchored again on those places and break the same behaviour.
export const SABOTAGES = [
  {name: "flag-unset", file: "node_modules/react-native/Libraries/Core/setUpTimers.js", find: "  global.RN$enableMicrotasksInReact = true;\n", replace: ""},
  {name: "promise-shim", file: "src/runtime.js", find: "queue(() => { if (active()) { callback(); } });", replace: "Promise.resolve().then(() => { if (active()) { callback(); } });"},
  {name: "gate-removed", file: "src/runtime.js", find: "  if (active()) {\n    queue(", replace: "  if (true) {\n    queue("},
  {name: "no-module", host: true, hostDirectory: "build/react-microtasks-sabotage-no-module-host", file: "native/application_runtime.cpp",
    find: "    native_modules->add_microtasks();\n", replace: ""},
  {name: "gate-closed", host: true, hostDirectory: "build/react-microtasks-sabotage-gate-closed-host", file: "native/application_runtime.cpp",
    find: "return jsi::Value(!(stopped || stopping) || unmounting_roots);", replace: "return jsi::Value(!(stopped || stopping));"},
  {name: "request-closes-gate", host: true, hostDirectory: "build/react-microtasks-sabotage-request-closes-gate-host", file: "native/application_runtime.cpp",
    find: "return jsi::Value(!(stopped || stopping) || unmounting_roots);", replace: "return jsi::Value(!inactive() || unmounting_roots);"},
  {name: "checkpoint-gate-closed", host: true, hostDirectory: "build/react-microtasks-sabotage-checkpoint-gate-closed-host", file: "native/application_runtime.cpp",
    find: "    draining_for_stop = true;\n", replace: "    draining_for_stop = true;\n    stopping = true;\n"},
];
