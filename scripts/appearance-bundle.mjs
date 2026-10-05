import {bundleNativeProbe} from "./native-probe-bundle.mjs";

// Executed producers of the Appearance slice: the reproducer, the public SDK
// seam and the native module fed by Godot's system theme.
export const appearanceNativeProducers = ["native/system_appearance.h", "native/fabric_application.cpp",
  "native/fabric_application.h", "native/turbo_module_registry.cpp", "native/turbo_module_registry.h",
  "native/application_runtime.cpp", "native/application_runtime.h"];

export function bundleAppearanceProbe() {
  return bundleNativeProbe({name: "appearance", entryPoint: "tests/appearance-fixture.jsx",
    sources: ["tests/appearance-fixture.jsx", "tests/appearance-probe.gd", "tests/appearance-native.test.mjs",
      "tests/appearance-oracle.mjs", "scripts/appearance-bundle.mjs", "scripts/native-probe-bundle.mjs",
      "src/platform-environment.js", "src/react-native-platform.jsx", "sdk/toolchain/platform-plugin.mjs",
      ...appearanceNativeProducers],
    seams: ["src/platform-environment.js", "src/react-native-platform.jsx"],
    // The original modules this bundle runs, and the RN platform implementations
    // whose Appearance semantics the native module follows.
    bundled: ["Libraries/Utilities/Appearance.js", "Libraries/Utilities/NativeAppearance.js",
      "src/private/specs_DEPRECATED/modules/NativeAppearance.js", "Libraries/Utilities/useColorScheme.js",
      "Libraries/EventEmitter/NativeEventEmitter.js", "Libraries/EventEmitter/RCTDeviceEventEmitter.js",
      "Libraries/vendor/emitter/EventEmitter.js", "Libraries/TurboModule/TurboModuleRegistry.js"],
    references: ["index.js", "React/CoreModules/RCTAppearance.mm", "React/Base/RCTConvert.mm",
      "React/Modules/RCTEventEmitter.m",
      "ReactAndroid/src/main/java/com/facebook/react/modules/appearance/AppearanceModule.kt",
      "ReactAndroid/src/main/java/com/facebook/react/views/common/UiModeUtils.kt",
      "React/FBReactNativeSpec/FBReactNativeSpecJSI.h", "ReactCommon/react/nativemodule/core/ReactCommon/TurboModule.cpp"]});
}
