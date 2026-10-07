import "./runtime";
import "./native-module-runtime";
// RN's own web-standard globals over its original JS modules: XMLHttpRequest,
// fetch with Headers, Request and Response, FormData, Blob, File, FileReader,
// URL, URLSearchParams, AbortController and AbortSignal (and WebSocket, which
// fails where it is first used until the host has a WebSocketModule). Each is
// installed lazily, so an application that never touches one loads none.
import "react-native/Libraries/Core/setUpXHR";

// The native host installs Hermes/Fabric and TimerManager first; the portable
// RN microtask/immediate modules initialize before the renderer evaluates.
if (!globalThis.nativeFabricUIManager || !globalThis.HermesInternal) {
  throw new Error("This bundle requires real Hermes and Fabric JSI bindings");
}
