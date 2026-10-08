import {bundleNativeProbe} from "./native-probe-bundle.mjs";

// Executed producers of the Accessibility slice: the semantic core, the View that applies it, and the
// hub files that create the View and carry its press to RN.
export const accessibilityNativeProducers = ["native/accessibility_core.h", "native/accessible_view.h",
  "native/accessible_view.cpp", "native/application_runtime.cpp", "native/register.cpp", "native/CMakeLists.txt"];

export function bundleAccessibilityProbe() {
  return bundleNativeProbe({name: "accessibility", entryPoint: "tests/accessibility-fixture.jsx",
    sources: ["tests/accessibility-fixture.jsx", "tests/accessibility-probe.gd", "tests/accessibility-native.test.mjs",
      "tests/accessibility-oracle.mjs", "scripts/accessibility-bundle.mjs", "scripts/native-probe-bundle.mjs",
      "src/accessibility-view-config.js", "src/base-view-config.js", "src/react-native-platform.jsx", "src/components.jsx",
      "sdk/toolchain/platform-plugin.mjs", "native/accessibility_core_test.cpp", ...accessibilityNativeProducers],
    seams: ["src/accessibility-view-config.js", "src/base-view-config.js", "src/react-native-platform.jsx"],
    // The original modules this bundle runs: the View that turns aria-* into accessibility props, the host
    // component whose view config lets them through, and the touchable that forwards them.
    bundled: ["Libraries/Components/View/View.js", "Libraries/Components/View/ViewNativeComponent.js",
      "Libraries/Components/Touchable/TouchableOpacity.js", "Libraries/NativeComponent/ViewConfig.js",
      "Libraries/Pressability/usePressability.js"],
    // The platform sources whose accessibility semantics the host follows.
    references: ["Libraries/Components/View/ViewAccessibility.js", "Libraries/Components/Pressable/Pressable.js",
      "Libraries/NativeComponent/BaseViewConfig.ios.js", "Libraries/NativeComponent/BaseViewConfig.android.js",
      "React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm",
      "ReactCommon/react/renderer/components/view/AccessibilityProps.h",
      "ReactCommon/react/renderer/components/view/AccessibilityProps.cpp",
      "ReactCommon/react/renderer/components/view/AccessibilityPrimitives.h",
      "ReactCommon/react/renderer/components/view/accessibilityPropsConversions.h",
      "ReactCommon/react/renderer/components/view/BaseViewEventEmitter.cpp"]});
}
