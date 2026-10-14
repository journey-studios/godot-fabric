// The retained sabotages of the callback exceptions slice (GF-05 slice F), written once: scripts/js-exceptions-sabotage.mjs runs them and
// tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it. Every entry
// breaks the host's C++ (`host: true`): the script patches the source, rebuilds the host, runs the lane and puts the source back byte for byte.
//
//   timer-site       a timer callback's exception is recorded where it is caught, as `error.what()`, as the host did before this slice: no JsErrorHandler, no
//                    message and stack in RN's format.
//   no-retry-bound   the microtask checkpoint loops until the queue is clean, without RN's retry bound: a self-requeuing callback that throws is never cut off, and
//                    "Hits microtasks retries bound." is never reported.
//   soft-as-fatal    the host records a soft exception (ErrorUtils.reportError) as a failure, as it recorded every error before slice C.
//   drop-remaining   the work queue is dropped after a timer's exception, so the other timers due in the tick do not run.
//   no-resume        the checkpoint stops at the first exception, as the host's single drain did: the microtasks behind the callback that threw are left for the
//                    next drain, and there is no retry to count.
export const SABOTAGES = [
  {name: "timer-site", host: true, hostDirectory: "build/js-exceptions-sabotage-timer-site-host", file: "native/application_runtime.cpp",
    find: "catch (const std::exception &error) { js_errors->handle_fatal(rt, error); }", replace: "catch (const std::exception &error) { fail(error.what()); }"},
  {name: "no-retry-bound", host: true, hostDirectory: "build/js-exceptions-sabotage-no-retry-bound-host", file: "native/application_runtime.cpp",
    find: "    while (retries < kRetriesBound) {", replace: "    while (true) {"},
  {name: "soft-as-fatal", host: true, hostDirectory: "build/js-exceptions-sabotage-soft-as-fatal-host", file: "native/application_runtime.cpp",
    find: "    if (report.fatal) {", replace: "    if (true) {"},
  {name: "drop-remaining", host: true, hostDirectory: "build/js-exceptions-sabotage-drop-remaining-host", file: "native/application_runtime.cpp",
    find: "catch (const std::exception &error) { js_errors->handle_fatal(rt, error); }", replace: "catch (const std::exception &error) { js_errors->handle_fatal(rt, error); work.clear(); }"},
  {name: "no-resume", host: true, hostDirectory: "build/js-exceptions-sabotage-no-resume-host", file: "native/application_runtime.cpp",
    find: "        js_errors->handle_task_error(*runtime, error);\n", replace: "        js_errors->handle_task_error(*runtime, error);\n        break;\n"},
];
