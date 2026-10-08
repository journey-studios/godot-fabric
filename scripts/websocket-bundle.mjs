import {bundleNativeProbe} from "./native-probe-bundle.mjs";

// Executed producers of the WebSocket slice: the pure WebSocket core and its unit test, the transport seam, the Godot
// HTTPClient/wslay connection and its bounded upgrade parser, the TLS options both transports build, the modules that carry the sockets (the
// WebSocketModule in its own translation unit and the BlobModule's hooks, over the state and blob store the networking
// modules share), the runtime wiring that polls and stops them, the validation seam for the TLS authority and the clock,
// and the Godot class profile and build that expose the stream classes.
export const websocketNativeProducers = ["native/websocket_core.h", "native/websocket_core_test.cpp", "native/websocket_transport.h",
  "native/godot_websocket_transport.h", "native/godot_websocket_transport.cpp", "native/godot_websocket_connection.h",
  "native/godot_websocket_connection.cpp", "native/websocket_handshake.h", "native/websocket_handshake_test.cpp",
  "tests/websocket-transport-smoke.test.mjs",
  "native/godot_tls.h", "native/http_core.h", "dependencies.json", "scripts/setup.py", "scripts/native-sdk.mjs",
  "scripts/pack-addon.mjs", "scripts/ios-build.py", "THIRD_PARTY_NOTICES.md",
  "native/blob_store.h", "native/networking_modules.h", "native/networking_modules.cpp", "native/networking_state.h", "native/stoppable_invoker.h",
  "native/websocket_module.h", "native/websocket_module.cpp", "native/application_runtime.cpp", "native/application_runtime.h",
  "native/fabric_application.cpp", "native/godot-profile.json", "native/CMakeLists.txt"];

export function bundleWebSocketProbe() {
  return bundleNativeProbe({name: "websocket", entryPoint: "tests/websocket-fixture.jsx",
    sources: ["tests/websocket-fixture.jsx", "tests/websocket-probe.gd", "tests/websocket-native.test.mjs",
      "tests/websocket-oracle.mjs", "tests/websocket-server.mjs", "tests/networking-certificates.mjs",
      "scripts/websocket-bundle.mjs", "scripts/native-probe-bundle.mjs", "src/initialize.js", "src/platform-environment.js",
      "src/react-native-platform.jsx", "sdk/toolchain/platform-plugin.mjs", ...websocketNativeProducers],
    seams: ["src/initialize.js", "src/platform-environment.js", "src/react-native-platform.jsx"],
    // The original modules this bundle runs: RN's WebSocket and its native spec, the events it dispatches, the Blob stack
    // that binary messages and Blob sends go through, the device event emitter its events arrive on, and the base64
    // conversion of a binary send.
    bundled: ["Libraries/Core/setUpXHR.js", "Libraries/WebSocket/WebSocket.js", "Libraries/WebSocket/NativeWebSocketModule.js",
      "src/private/specs_DEPRECATED/modules/NativeWebSocketModule.js", "src/private/webapis/websockets/events/CloseEvent.js",
      "src/private/webapis/html/events/MessageEvent.js", "Libraries/Blob/Blob.js", "Libraries/Blob/BlobManager.js",
      "Libraries/Blob/BlobRegistry.js", "Libraries/Blob/FileReader.js", "Libraries/Blob/NativeBlobModule.js",
      "Libraries/Blob/NativeFileReaderModule.js", "src/private/specs_DEPRECATED/modules/NativeBlobModule.js",
      "src/private/specs_DEPRECATED/modules/NativeFileReaderModule.js", "Libraries/EventEmitter/NativeEventEmitter.js",
      "Libraries/EventEmitter/RCTDeviceEventEmitter.js", "Libraries/Utilities/binaryToBase64.js",
      "Libraries/Utilities/PolyfillFunctions.js"],
    // What RN's platforms run under these modules, and the generated C++ contract this host implements.
    references: ["ReactAndroid/src/main/java/com/facebook/react/modules/websocket/WebSocketModule.kt",
      "ReactAndroid/src/main/java/com/facebook/react/modules/blob/BlobModule.kt", "React/CoreModules/RCTWebSocketModule.mm",
      "Libraries/Blob/RCTBlobManager.mm", "Libraries/WebSocket/WebSocketInterceptor.js", "React/FBReactNativeSpec/FBReactNativeSpecJSI.h",
      "ReactCommon/react/nativemodule/core/ReactCommon/TurboModule.cpp"]});
}
