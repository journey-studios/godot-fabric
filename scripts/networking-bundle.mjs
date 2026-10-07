import {bundleNativeProbe} from "./native-probe-bundle.mjs";

// Executed producers of the networking slice: the pure HTTP core and its unit test, the transport seam and
// the Godot transport behind it, the blob store and the three modules over it, the runtime wiring that polls
// and stops them, the validation seam for the TLS authority, and the Godot class profile and build that
// bring HTTPClient in.
export const networkingNativeProducers = ["native/http_core.h", "native/http_core_test.cpp", "native/http_transport.h",
  "native/godot_http_transport.h", "native/godot_http_transport.cpp", "native/blob_store.h", "native/networking_modules.h",
  "native/networking_modules.cpp", "native/application_runtime.cpp", "native/application_runtime.h", "native/fabric_application.cpp",
  "native/godot-profile.json", "native/CMakeLists.txt"];

export function bundleNetworkingProbe() {
  return bundleNativeProbe({name: "networking", entryPoint: "tests/networking-fixture.jsx",
    sources: ["tests/networking-fixture.jsx", "tests/networking-probe.gd", "tests/networking-native.test.mjs",
      "tests/networking-oracle.mjs", "tests/networking-server.mjs", "tests/networking-certificates.mjs",
      "scripts/networking-bundle.mjs", "scripts/native-probe-bundle.mjs", "src/initialize.js", "src/platform-environment.js",
      "src/react-native-platform.jsx", "sdk/toolchain/platform-plugin.mjs", ...networkingNativeProducers],
    seams: ["src/initialize.js", "src/platform-environment.js", "src/react-native-platform.jsx"],
    // The original modules this bundle runs: the globals RN installs, fetch and its polyfill's callers, XMLHttpRequest
    // and the Android wrapper over its native module, FormData, the Blob stack and AbortController.
    bundled: ["Libraries/Core/setUpXHR.js", "Libraries/Network/XMLHttpRequest.js", "Libraries/Network/RCTNetworking.android.js",
      "Libraries/Network/NativeNetworkingAndroid.js", "src/private/specs_DEPRECATED/modules/NativeNetworkingAndroid.js",
      "Libraries/Network/fetch.js", "Libraries/Network/FormData.js", "Libraries/Network/convertRequestBody.js",
      "Libraries/Blob/Blob.js", "Libraries/Blob/BlobManager.js", "Libraries/Blob/BlobRegistry.js", "Libraries/Blob/File.js",
      "Libraries/Blob/FileReader.js", "Libraries/Blob/URL.js", "Libraries/Blob/NativeBlobModule.js",
      "Libraries/Blob/NativeFileReaderModule.js", "src/private/specs_DEPRECATED/modules/NativeBlobModule.js",
      "src/private/specs_DEPRECATED/modules/NativeFileReaderModule.js", "src/private/webapis/dom/abort-api/AbortController.js",
      "src/private/webapis/dom/abort-api/AbortSignal.js", "Libraries/EventEmitter/NativeEventEmitter.js",
      "Libraries/EventEmitter/RCTDeviceEventEmitter.js", "Libraries/Utilities/PolyfillFunctions.js"],
    // What RN's platforms run under these modules, and the generated C++ contract this host implements.
    references: ["Libraries/Network/RCTNetworking.js", "Libraries/Network/RCTNetworking.ios.js", "Libraries/Network/RCTNetworking.mm",
      "Libraries/Network/RCTNetworkingEventDefinitions.flow.js",
      "ReactAndroid/src/main/java/com/facebook/react/modules/network/NetworkingModule.kt",
      "ReactAndroid/src/main/java/com/facebook/react/modules/network/NetworkEventUtil.kt",
      "ReactAndroid/src/main/java/com/facebook/react/modules/network/RequestBodyUtil.kt",
      "ReactAndroid/src/main/java/com/facebook/react/modules/network/HeaderUtil.kt",
      "ReactAndroid/src/main/java/com/facebook/react/modules/blob/BlobModule.kt",
      "ReactAndroid/src/main/java/com/facebook/react/modules/blob/FileReaderModule.kt",
      "Libraries/Blob/RCTBlobManager.mm", "Libraries/Blob/RCTFileReaderModule.mm", "Libraries/WebSocket/WebSocket.js",
      "React/FBReactNativeSpec/FBReactNativeSpecJSI.h", "ReactCommon/react/nativemodule/core/ReactCommon/TurboModule.cpp"]});
}
