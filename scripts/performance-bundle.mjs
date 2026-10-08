import {bundleNativeProbe} from "./native-probe-bundle.mjs";

// Executed producers of the performance slice: the accounting and its unit test, the runtime that
// feeds it from the pump, the mounting callback and the surfaces, and the application that lets a
// validation run ask for a collection before every heap reading.
export const performanceNativeProducers = ["native/performance_metrics.h", "native/performance_metrics_test.cpp",
  "native/application_runtime.cpp", "native/application_runtime.h", "native/fabric_application.cpp", "native/CMakeLists.txt"];

export function bundlePerformanceProbe() {
  return bundleNativeProbe({name: "performance", entryPoint: "tests/performance-fixture.jsx",
    sources: ["tests/performance-fixture.jsx", "tests/performance-cases.mjs", "tests/performance-probe.gd", "tests/performance-sampler.gd",
      "tests/performance-native.test.mjs", "tests/performance-oracle.mjs", "scripts/performance-bundle.mjs",
      "scripts/native-probe-bundle.mjs", "src/react-native-platform.jsx", "src/svg.jsx", "sdk/toolchain/platform-plugin.mjs",
      ".deps/hermes/destroot/include/jsi/instrumentation.h", ...performanceNativeProducers],
    seams: ["src/react-native-platform.jsx", "src/svg.jsx"],
    // The original modules the workloads run: the list, and the chart library the SVG seam serves.
    bundled: ["Libraries/Lists/FlatList.js"],
    // Where RN reads the same numbers the host reports: Hermes' heap through the instrumentation
    // (NativePerformance.getSimpleMemoryInfo), and the layout, diff and commit times that a
    // revision carries (ShadowTree::tryCommit and MountingCoordinator::pullTransaction time them
    // into the TransactionTelemetry the mounting callback receives).
    references: ["ReactCommon/react/nativemodule/webperformance/NativePerformance.cpp",
      "ReactCommon/react/renderer/mounting/ShadowTree.cpp", "ReactCommon/react/renderer/mounting/MountingCoordinator.cpp",
      "ReactCommon/react/renderer/telemetry/TransactionTelemetry.cpp"]});
}
