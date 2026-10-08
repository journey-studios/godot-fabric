import {bundleNativeProbe} from "./native-probe-bundle.mjs";

// Executed producers of the AccessibilityInfo slice: the owner of the settings, the core and the AccessibilityManager
// module, the invoker that ends queued events with the application, and the files that wire them into the application
// and its registry.
export const accessibilityInfoNativeProducers = ["native/accessibility_info.h", "native/accessibility_info.cpp",
  "native/accessibility_info_core.h", "native/accessibility_info_core_test.cpp", "native/stoppable_invoker.h",
  "native/fabric_application.cpp", "native/fabric_application.h", "native/application_runtime.cpp",
  "native/application_runtime.h", "native/CMakeLists.txt"];

export function bundleAccessibilityInfoProbe() {
  return bundleNativeProbe({name: "accessibility-info", entryPoint: "tests/accessibility-info-fixture.jsx",
    sources: ["tests/accessibility-info-fixture.jsx", "tests/accessibility-info-probe.gd", "tests/accessibility-info-native.test.mjs",
      "tests/accessibility-info-oracle.mjs", "scripts/accessibility-info-bundle.mjs",
      "scripts/native-probe-bundle.mjs", "src/accessibility-info.js", "src/platform-environment.js", "src/react-native-platform.jsx",
      "sdk/toolchain/platform-plugin.mjs", ...accessibilityInfoNativeProducers],
    seams: ["src/accessibility-info.js", "src/platform-environment.js", "src/react-native-platform.jsx"],
    // The original modules this bundle runs, and the RN platform sources whose contracts the native module follows.
    bundled: ["Libraries/Components/AccessibilityInfo/AccessibilityInfo.js", "Libraries/Components/AccessibilityInfo/NativeAccessibilityManager.js",
      "Libraries/Components/AccessibilityInfo/NativeAccessibilityInfo.js", "Libraries/Components/AccessibilityInfo/legacySendAccessibilityEvent.ios.js",
      "src/private/specs_DEPRECATED/modules/NativeAccessibilityManager.js", "src/private/specs_DEPRECATED/modules/NativeAccessibilityInfo.js",
      "Libraries/EventEmitter/RCTDeviceEventEmitter.js", "Libraries/vendor/emitter/EventEmitter.js", "Libraries/TurboModule/TurboModuleRegistry.js"],
    references: ["index.js", "Libraries/Components/AccessibilityInfo/legacySendAccessibilityEvent.js",
      "Libraries/Components/AccessibilityInfo/legacySendAccessibilityEvent.android.js", "React/CoreModules/RCTAccessibilityManager.mm",
      "React/Fabric/Mounting/RCTMountingManager.mm",
      "ReactAndroid/src/main/java/com/facebook/react/modules/accessibilityinfo/AccessibilityInfoModule.kt",
      "React/FBReactNativeSpec/FBReactNativeSpecJSI.h", "ReactCommon/react/nativemodule/core/ReactCommon/TurboModule.cpp"]});
}
