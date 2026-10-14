// The retained sabotages of the error path slice (GF-05 slice C), written once: scripts/js-errors-sabotage.mjs runs them, scripts/js-errors-bundle.mjs applies the
// ones that break the bundle (in memory: no file is edited) and tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It
// has no side effects, so the test can import it. An entry with `host: true` breaks the host's C++: the script patches the source, rebuilds the host, runs the
// lane and puts the source back byte for byte.
//
//   no-error-guard   the toolchain does not inject RN's error-guard polyfill: there is no ErrorUtils, and setUpErrorHandling cannot register its handler.
//   no-setup         src/initialize.js does not import setUpErrorHandling: ErrorUtils keeps the polyfill's handler, which throws what it is handed, and
//                    console.error is not wrapped.
//   soft-fails       the host records a soft exception (console.error, ErrorUtils.reportError) as a failure, as it recorded every error before.
//   fatal-swallowed  the host logs a fatal exception and records no failure: an uncaught error no longer fails a headless suite.
//   scheduler-site   an exception that escapes a task of the RuntimeScheduler goes to fail() again, not to JsErrorHandler.
//   bundle-site      an exception that escapes the evaluation of the bundle goes to fail() again, not to JsErrorHandler (no "[runtime not ready]").
//   never-ready      the runtime is never marked ready after the bundle, so RN$handleException keeps taking every error into C++ and JS's
//                    ExceptionsManager is never reached.
export const SABOTAGES = [
  {name: "no-error-guard", file: "sdk/toolchain/metro-polyfills.mjs",
    find: '"@react-native/js-polyfills/console.js", "@react-native/js-polyfills/error-guard.js"]', replace: '"@react-native/js-polyfills/console.js"]'},
  {name: "no-setup", file: "src/initialize.js", find: 'import "react-native/Libraries/Core/setUpErrorHandling";\n', replace: ""},
  {name: "soft-fails", host: true, hostDirectory: "build/js-errors-sabotage-soft-fails-host", file: "native/application_runtime.cpp",
    find: "    if (report.fatal) {", replace: "    if (true) {"},
  {name: "fatal-swallowed", host: true, hostDirectory: "build/js-errors-sabotage-fatal-swallowed-host", file: "native/application_runtime.cpp",
    find: "      fail(fabric_godot::format_exception(report));",
    replace: '      UtilityFunctions::print(String("HERMES: swallowed ") + gd(fabric_godot::format_exception(report)));'},
  {name: "scheduler-site", host: true, hostDirectory: "build/js-errors-sabotage-scheduler-site-host", file: "native/application_runtime.cpp",
    find: "[this](jsi::Runtime &rt, jsi::JSError &error) { js_errors->handle_fatal(rt, error); });",
    replace: "[this](jsi::Runtime &, jsi::JSError &error) { fail(error.what()); });"},
  {name: "bundle-site", host: true, hostDirectory: "build/js-errors-sabotage-bundle-site-host", file: "native/application_runtime.cpp",
    find: "catch (const std::exception &error) { js_errors->handle_fatal(*runtime, error); return false; }",
    replace: "catch (const std::exception &error) { fail(error.what()); return false; }"},
  {name: "never-ready", host: true, hostDirectory: "build/js-errors-sabotage-never-ready-host", file: "native/application_runtime.cpp",
    find: "    js_errors->bundle_evaluated();\n", replace: ""},
];
