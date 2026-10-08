import {bundleNativeProbe} from "./native-probe-bundle.mjs";

// Executed producers of the device services slice: the host that owns the
// services, the core and the three TurboModules, Godot's backend, and the files
// that wire them into the application and its registry.
export const deviceServicesNativeProducers = ["native/device_services.h", "native/device_services.cpp",
  "native/device_services_core.h", "native/device_services_core_test.cpp", "native/godot_device_backend.h", "native/godot_device_backend.cpp", "native/stoppable_invoker.h",
  "native/fabric_application.cpp", "native/fabric_application.h", "native/application_runtime.cpp",
  "native/application_runtime.h", "native/CMakeLists.txt"];

export function bundleDeviceServicesProbe() {
  return bundleNativeProbe({name: "device-services", entryPoint: "tests/device-services-fixture.jsx",
    sources: ["tests/device-services-fixture.jsx", "tests/device-services-probe.gd", "tests/device-services-native.test.mjs",
      "tests/device-services-oracle.mjs", "scripts/device-services-bundle.mjs", "scripts/native-probe-bundle.mjs",
      "src/device-services.js", "src/react-native-platform.jsx", "sdk/toolchain/platform-plugin.mjs",
      ...deviceServicesNativeProducers],
    seams: ["src/device-services.js", "src/react-native-platform.jsx"],
    // The original modules this bundle runs, and the RN platform implementations
    // whose Linking, Clipboard and Vibration contracts the native modules follow.
    bundled: ["Libraries/Linking/Linking.js", "Libraries/Linking/NativeLinkingManager.js",
      "src/private/specs_DEPRECATED/modules/NativeLinkingManager.js", "Libraries/Vibration/Vibration.js",
      "src/private/specs_DEPRECATED/modules/NativeVibration.js", "Libraries/Components/Clipboard/Clipboard.js",
      "src/private/specs_DEPRECATED/modules/NativeClipboard.js", "Libraries/Utilities/warnOnce.js",
      "Libraries/EventEmitter/NativeEventEmitter.js", "Libraries/EventEmitter/RCTDeviceEventEmitter.js",
      "Libraries/vendor/emitter/EventEmitter.js", "Libraries/TurboModule/TurboModuleRegistry.js"],
    references: ["index.js", "Libraries/LinkingIOS/RCTLinkingManager.mm", "Libraries/Vibration/RCTVibration.mm",
      "React/CoreModules/RCTClipboard.mm",
      "ReactAndroid/src/main/java/com/facebook/react/modules/intent/IntentModule.kt",
      "ReactAndroid/src/main/java/com/facebook/react/modules/vibration/VibrationModule.kt",
      "ReactAndroid/src/main/java/com/facebook/react/modules/clipboard/ClipboardModule.kt",
      "React/FBReactNativeSpec/FBReactNativeSpecJSI.h", "ReactCommon/react/nativemodule/core/ReactCommon/TurboModule.cpp",
      "ReactCommon/react/bridging/Promise.h"]});
}
