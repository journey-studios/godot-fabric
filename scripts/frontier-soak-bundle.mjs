import {bundleNativeProbe} from "./native-probe-bundle.mjs";
import {frontierBaselineNativeProducers} from "./frontier-baseline-bundle.mjs";
import {frontierServicesGameSources} from "./frontier-services-bundle.mjs";

// Executed producers of the 100-turn soak: the ones the baseline ran on (the pointer policy and the claim of a2, the performance accounting
// and the application that lets a probe ask for a collection before a heap reading) and the registry of the game services that carries the
// player's calls and the game's snapshots. The slice changes no C++, so these are pins of the host the soak ran on and not of anything it built.
export const frontierSoakNativeProducers = [...new Set([...frontierBaselineNativeProducers, "native/game_service_registry.cpp", "native/game_service_registry.h"])];

// The files the probe and the suite execute, pinned in the bundle's receipt: the game (P3), the services node and its schemas, the fixture's
// types, and the baseline's and GF-30's harness that the soak reuses and does not copy.
export const frontierSoakSources = ["tests/frontier-soak-fixture.jsx", "tests/frontier-soak-cases.mjs", "tests/frontier-soak-probe.gd",
  "tests/frontier-soak-oracle.mjs", "tests/frontier-soak-native.test.mjs", "tests/frontier-baseline-cases.mjs", "tests/frontier-baseline-oracle.mjs",
  "tests/performance-sampler.gd", "tests/performance-cases.mjs", "tests/performance-oracle.mjs", "tests/world-input-driver.gd", "examples/world-input/world.gd",
  "examples/world-input/world.tscn", "scripts/frontier-soak-bundle.mjs", "scripts/frontier-soak-sabotage.mjs", "scripts/frontier-baseline-bundle.mjs",
  "scripts/frontier-services-bundle.mjs", "scripts/native-probe-bundle.mjs", "consumers/civ-lite/ui/frontier-types.ts", "src/godot-fabric.js",
  "src/react-native-platform.jsx", "sdk/addon/godot_fabric.gd", "sdk/toolchain/platform-plugin.mjs", ...frontierServicesGameSources, ...frontierSoakNativeProducers];

export function bundleFrontierSoakProbe() {
  return bundleNativeProbe({name: "frontier-soak", entryPoint: "tests/frontier-soak-fixture.jsx", sources: frontierSoakSources,
    seams: ["src/godot-fabric.js", "src/react-native-platform.jsx", "consumers/civ-lite/ui/frontier-types.ts"],
    // The original modules the HUD and the transport run: the View under every node of the HUD, and the registry the facade reads the services through.
    bundled: ["Libraries/Components/View/View.js", "Libraries/TurboModule/TurboModuleRegistry.js"],
    // The platforms' own answers to "who gets a touch" (the hit test the closed panel must not take part in), and where RN reads the numbers the
    // host reports.
    references: ["React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm",
      "ReactAndroid/src/main/java/com/facebook/react/uimanager/TouchTargetHelper.kt",
      "ReactCommon/react/nativemodule/webperformance/NativePerformance.cpp"]});
}
