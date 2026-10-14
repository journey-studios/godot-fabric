// The retained sabotages of the idle callbacks slice (GF-05 slice D2), written once: scripts/idle-callbacks-sabotage.mjs runs them, scripts/idle-callbacks-bundle.mjs
// applies the ones that break the bundle (in memory: no file is edited) and tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file.
// It has no side effects, so the test can import it. An entry with `host: true` breaks the host's C++: the script patches the source, rebuilds the host, runs the lane and
// puts the source back byte for byte.
//
//   set-up-timers-not-imported  src/initialize.js does not import RN's setUpTimers: none of the globals it installs is there for the host's gate to wrap, the gate refuses to
//                               start, and the bundle does not evaluate.
//   timeout-ignored             the gate drops the options of requestIdleCallback: the timeout never reaches RN's module, so didTimeout is false for a callback that ran late.
//   reimplemented               requestIdleCallback is a timer again, a reimplementation in the host's gate instead of RN's function: no call reaches the C++ module, and the
//                               callbacks run with a deadline of its own.
//   cancel-dropped              the gate does not pass cancelIdleCallback on: a canceled callback runs.
//   gate-removed                the callback handed to the module no longer checks the lifecycle gate: an idle callback runs after the application stopped.
//   window-open                 the idle callbacks use the gate that stop()'s unmount window opens: an idle callback queued before the stop runs while the roots unmount.
//   no-module                   the host does not register NativeIdleCallbacksCxx: the first read of requestIdleCallback throws, as on the host this slice replaced.
//   strict-ignored              the host's godotRuntimeActive ignores its strict argument: the unmount window is open to the idle callbacks, in the native half of window-open.
export const SABOTAGES = [
  {name: "set-up-timers-not-imported", file: "src/initialize.js", find: "import \"react-native/Libraries/Core/setUpTimers\";\n", replace: ""},
  {name: "timeout-ignored", file: "src/runtime.js", find: "request((deadline) => { if (live()) { callback(deadline); } }, ...options)", replace: "request((deadline) => { if (live()) { callback(deadline); } })"},
  {name: "reimplemented", file: "src/runtime.js", find: "request((deadline) => { if (live()) { callback(deadline); } }, ...options)",
    replace: "setTimeout(() => { if (live()) { callback({didTimeout: false, timeRemaining: () => 50}); } }, 0)"},
  {name: "cancel-dropped", file: "src/runtime.js", find: "    cancel(handle);\n", replace: "    void handle;\n"},
  {name: "gate-removed", file: "src/runtime.js", find: "request((deadline) => { if (live()) { callback(deadline); } }, ...options)", replace: "request(callback, ...options)"},
  {name: "window-open", file: "src/runtime.js", find: "const live = () => active(true);", replace: "const live = () => active();"},
  {name: "no-module", host: true, hostDirectory: "build/idle-callbacks-sabotage-no-module-host", file: "native/application_runtime.cpp",
    find: "    native_modules->add_idle_callbacks();\n", replace: ""},
  {name: "strict-ignored", host: true, hostDirectory: "build/idle-callbacks-sabotage-strict-ignored-host", file: "native/application_runtime.cpp",
    find: "const bool strict = count > 0 && args[0].isBool() && args[0].getBool();", replace: "const bool strict = false;"},
];
