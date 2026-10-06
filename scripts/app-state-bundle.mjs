import {bundleNativeProbe} from "./native-probe-bundle.mjs";

// Executed producers of the AppState slice: the reproducer, the public SDK seam
// and the native module fed by Godot's lifecycle notifications.
export const appStateNativeProducers = ["native/app_lifecycle.h", "native/fabric_application.cpp",
  "native/fabric_application.h", "native/turbo_module_registry.cpp", "native/turbo_module_registry.h",
  "native/application_runtime.cpp", "native/application_runtime.h"];

export function bundleAppStateProbe() {
  return bundleNativeProbe({name: "app-state", entryPoint: "tests/app-state-fixture.jsx",
    sources: ["tests/app-state-fixture.jsx", "tests/app-state-probe.gd", "tests/app-state-native.test.mjs",
      "tests/app-state-oracle.mjs", "scripts/app-state-bundle.mjs", "scripts/native-probe-bundle.mjs",
      "src/app-state.js", "src/platform-environment.js", "src/react-native-platform.jsx",
      "sdk/toolchain/platform-plugin.mjs", ...appStateNativeProducers],
    seams: ["src/app-state.js", "src/platform-environment.js", "src/react-native-platform.jsx"],
    // The original modules this bundle runs, and the RN platform implementations
    // whose AppState semantics the native module follows.
    bundled: ["Libraries/AppState/AppState.js", "Libraries/AppState/NativeAppState.js",
      "src/private/specs_DEPRECATED/modules/NativeAppState.js", "Libraries/EventEmitter/NativeEventEmitter.js",
      "Libraries/EventEmitter/RCTDeviceEventEmitter.js", "Libraries/vendor/emitter/EventEmitter.js",
      "Libraries/TurboModule/TurboModuleRegistry.js"],
    references: ["index.js", "React/CoreModules/RCTAppState.mm", "React/Modules/RCTEventEmitter.m",
      "ReactAndroid/src/main/java/com/facebook/react/modules/appstate/AppStateModule.kt",
      "React/FBReactNativeSpec/FBReactNativeSpecJSI.h", "ReactCommon/react/nativemodule/core/ReactCommon/TurboModule.cpp",
      "ReactCommon/react/bridging/Function.h"]});
}
