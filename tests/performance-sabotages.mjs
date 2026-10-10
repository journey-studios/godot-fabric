// The retained sabotages of scripts/performance-sabotage.mjs, written once: that script runs them (its header says what each breaks and what must reject it) and
// tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it.
export const SABOTAGES = [
  {name: "leak", argument: "--sabotage=leak", hostDirectory: "build/performance-sabotage-leak-host",
    file: "native/application_runtime.cpp", find: "      memdelete(it->second.control);\n",
    replace: "      (void)it->second.control;\n"},
  {name: "heap", argument: "--sabotage=heap", hostDirectory: "build/performance-sabotage-heap-host",
    file: "native/application_runtime.cpp", find: "    const auto info = runtime->instrumentation().getHeapInfo(false);\n",
    replace: "    static const auto info = runtime->instrumentation().getHeapInfo(false);\n"},
  {name: "phase", argument: "--sabotage=phase", hostDirectory: "build/performance-sabotage-phase-host",
    file: "native/performance_metrics.h", find: "        phases_[index].add(local_[index]);\n",
    replace: "        phases_[index].add(local_[index]);\n        phases_[index].add(local_[index]);\n"},
];
