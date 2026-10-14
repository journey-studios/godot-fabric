// RN's own JavaScript environment, in the order of src/private/setup/setUpDefaultReactNativeEnvironment.js, over the Hermes and the
// Fabric this host runs. docs/compatibility/bootstrap-audit-0.87.1.json says, for every step of that chain, whether it runs here,
// is replaced, or is the host's. The Metro polyfills RN runs before all of it (console today) are not imported here: the build
// injects them ahead of the first module (sdk/toolchain/metro-polyfills.mjs).
import "react-native/Libraries/Core/setUpGlobals";
// A relative path because RN does not export it: the platform plugin resolves it for this file only.
import setUpDOM from "../node_modules/react-native/src/private/setup/setUpDOM";
import "react-native/Libraries/Core/setUpPerformance";
// The timers, the microtasks, the immediates and the animation frame, over the TimerManager the host attached.
import "./runtime";
import "./native-module-runtime";
// RN's own web-standard globals over its original JS modules: XMLHttpRequest,
// fetch with Headers, Request and Response, FormData, Blob, File, FileReader,
// URL, URLSearchParams, AbortController and AbortSignal, and RN's WebSocket
// over the host's WebSocketModule. Each is installed lazily, so an application
// that never touches one loads none.
import "react-native/Libraries/Core/setUpXHR";
import "react-native/Libraries/Core/setUpNavigator";

// RN calls it between setUpGlobals and setUpPerformance; it only registers lazy getters, so after the imports is the same.
setUpDOM();

// The native host installs Hermes/Fabric and TimerManager first; the portable
// RN microtask/immediate modules initialize before the renderer evaluates.
if (!globalThis.nativeFabricUIManager || !globalThis.HermesInternal) {
  throw new Error("This bundle requires real Hermes and Fabric JSI bindings");
}
