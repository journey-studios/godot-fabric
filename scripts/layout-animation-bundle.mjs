import {bundleNativeProbe} from "./native-probe-bundle.mjs";

// Executed producers of the LayoutAnimation slice: the module that installs RN's LayoutAnimationDriver and keeps the
// counters, and the files that wire it into the application's frame tick and its CMake target.
export const layoutAnimationNativeProducers = ["native/layout_animation.h", "native/layout_animation.cpp",
  "native/application_runtime.cpp", "native/CMakeLists.txt"];

export function bundleLayoutAnimationProbe() {
  return bundleNativeProbe({name: "layout-animation", entryPoint: "tests/layout-animation-fixture.jsx",
    sources: ["tests/layout-animation-fixture.jsx", "tests/layout-animation-cases.mjs", "tests/layout-animation-probe.gd",
      "tests/layout-animation-native.test.mjs", "tests/layout-animation-oracle.mjs", "scripts/layout-animation-bundle.mjs",
      "scripts/layout-animation-sabotage.mjs", "scripts/native-probe-bundle.mjs", "src/react-native-platform.jsx",
      "src/private-interface.js", "sdk/toolchain/platform-plugin.mjs", ...layoutAnimationNativeProducers],
    seams: ["src/react-native-platform.jsx", "src/private-interface.js"],
    // The original modules this bundle runs: LayoutAnimation (configureNext, create and Presets) and the flag it reads.
    bundled: ["Libraries/LayoutAnimation/LayoutAnimation.js", "src/private/featureflags/ReactNativeFeatureFlags.js",
      "Libraries/ReactNative/FabricUIManager.js"],
    // The C++ engine the host runs and how RN's platforms install it, the conversions and curves the oracle cites, and
    // the legacy UIManager methods the private interface follows.
    references: ["index.js", "ReactCommon/react/renderer/animations/LayoutAnimationDriver.cpp",
      "ReactCommon/react/renderer/animations/LayoutAnimationKeyFrameManager.cpp", "ReactCommon/react/renderer/animations/utils.cpp",
      "ReactCommon/react/renderer/animations/conversions.h", "ReactCommon/react/renderer/animations/primitives.h",
      "ReactCommon/react/renderer/components/view/ViewPropsInterpolation.h", "ReactCommon/react/renderer/uimanager/UIManager.cpp",
      "ReactCommon/react/renderer/uimanager/UIManagerBinding.cpp", "ReactCommon/react/renderer/mounting/MountingCoordinator.cpp",
      "ReactCommon/react/renderer/scheduler/Scheduler.cpp", "React/Fabric/RCTScheduler.mm",
      "ReactAndroid/src/main/jni/react/fabric/FabricUIManagerBinding.cpp", "Libraries/ReactNative/BridgelessUIManager.js"]});
}
