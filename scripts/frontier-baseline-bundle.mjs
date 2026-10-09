import {bundleNativeProbe} from "./native-probe-bundle.mjs";
import {performanceNativeProducers} from "./performance-bundle.mjs";
import {worldInputNativeProducers} from "./world-input-bundle.mjs";

// Executed producers of the performance baseline on the pointer spike's scene: the pointer policy and the adapter that
// deliver the click (world-input), and the accounting that counts what the swap does (performance). The slice changes no
// C++, so these are pins of the host the baseline ran on and not of anything it built.
export const frontierBaselineNativeProducers = [...new Set([...worldInputNativeProducers, ...performanceNativeProducers])];

// The files the probes and the suites execute, pinned in the bundle's receipt.
export const frontierBaselineSources = ["tests/frontier-baseline-fixture.jsx", "tests/frontier-baseline-cases.mjs",
  "tests/frontier-baseline-probe.gd", "tests/frontier-baseline-graphics-probe.gd", "tests/frontier-baseline-swap.gd",
  "tests/frontier-baseline-oracle.mjs", "tests/frontier-baseline-native.test.mjs", "tests/performance-sampler.gd",
  "tests/performance-cases.mjs", "tests/performance-oracle.mjs", "tests/world-input-driver.gd",
  "examples/frontier-baseline/scene.tscn", "examples/world-input/world.gd", "examples/world-input/world.tscn",
  "scripts/frontier-baseline-bundle.mjs", "scripts/frontier-baseline-graphics.mjs", "scripts/native-probe-bundle.mjs",
  "src/react-native-platform.jsx", "sdk/toolchain/platform-plugin.mjs", ...frontierBaselineNativeProducers];

export function bundleFrontierBaselineProbe() {
  return bundleNativeProbe({name: "frontier-baseline", entryPoint: "tests/frontier-baseline-fixture.jsx",
    sources: frontierBaselineSources, seams: ["src/react-native-platform.jsx"],
    // The original module under every View of the HUD.
    bundled: ["Libraries/Components/View/View.js"],
    // The platforms' own answers to "who gets a touch" (the HUD's hit test), and where RN reads the numbers the host
    // reports: Hermes' heap and the telemetry of a revision.
    references: ["React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm",
      "ReactAndroid/src/main/java/com/facebook/react/uimanager/TouchTargetHelper.kt",
      "ReactCommon/react/nativemodule/webperformance/NativePerformance.cpp",
      "ReactCommon/react/renderer/mounting/ShadowTree.cpp", "ReactCommon/react/renderer/mounting/MountingCoordinator.cpp",
      "ReactCommon/react/renderer/telemetry/TransactionTelemetry.cpp"]});
}
