import path from "node:path";
import {fileURLToPath} from "node:url";
import {bundleNativeProbe} from "./native-probe-bundle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

// Executed producers of the density slice: the policy and the seams (the application), the metrics the runtime reads every
// pump, the SafeAreaView module and its pure core, and the CMake target that compiles RN's SafeAreaView.
export const mobileDensityNativeProducers = ["native/display_insets_core.h", "native/display_insets.h", "native/display_insets.cpp",
  "native/window_metrics.h", "native/fabric_application.h", "native/fabric_application.cpp", "native/application_runtime.cpp",
  "native/CMakeLists.txt"];

const mobileDensitySources = ["tests/mobile-density-fixture.jsx", "tests/mobile-density-probe.gd", "tests/mobile-density-native.test.mjs",
  "tests/mobile-density-oracle.mjs", "scripts/mobile-density-bundle.mjs", "scripts/mobile-density-sabotage.mjs",
  "scripts/native-probe-bundle.mjs", "src/react-native-platform.jsx", "sdk/toolchain/platform-plugin.mjs", ...mobileDensityNativeProducers];

// The fixture over the SDK in src/ (the default) or over another one: the control that bundles the SDK of main before this slice
// names its directory in platformRoot (build/mobile-density-previous/src), where RN's SafeAreaView is still the View.
export function bundleMobileDensityProbe({platformRoot, name = "mobile-density"} = {}) {
  const previous = platformRoot !== undefined;
  const facade = previous ? path.relative(root, path.join(platformRoot, "react-native-platform.jsx")) : "src/react-native-platform.jsx";
  return bundleNativeProbe({name, entryPoint: "tests/mobile-density-fixture.jsx", sources: mobileDensitySources, seams: [facade],
    bundled: previous
      ? ["Libraries/Components/SafeAreaView/SafeAreaView.js", "Libraries/Components/View/View.js", "Libraries/Utilities/Dimensions.js"]
      : ["Libraries/Components/SafeAreaView/RCTSafeAreaViewNativeComponent.js",
        "src/private/components/safeareaview/specs/RCTSafeAreaViewNativeComponent.js", "Libraries/Components/View/View.js",
        "Libraries/Utilities/Dimensions.js"],
    // What the host follows: RN's iOS component and its view, the density of the window and the states of the padding.
    references: ["Libraries/Components/SafeAreaView/SafeAreaView.js", "React/Fabric/Mounting/ComponentViews/SafeAreaView/RCTSafeAreaViewComponentView.mm",
      "ReactCommon/react/renderer/components/safeareaview/SafeAreaViewComponentDescriptor.h",
      "ReactCommon/react/renderer/components/safeareaview/SafeAreaViewState.h", "React/Base/RCTUtils.mm",
      "React/CoreModules/RCTDeviceInfo.mm"],
    ...(previous ? {platformRoot} : {})});
}
