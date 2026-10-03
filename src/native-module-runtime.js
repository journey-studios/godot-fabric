// Initialize the original RN native event/callable-module paths against the
// native TurboModuleBinding installed before bundle evaluation. No JS module
// implementations or registry substitutes live here.
import "react-native/Libraries/EventEmitter/RCTDeviceEventEmitter";

if (globalThis.RN$Bridgeless !== true || !globalThis.nativeModuleProxy ||
    typeof globalThis.RN$registerCallableModule !== "function") {
  throw new Error("Godot native modules require the upstream TurboModuleBinding and callable-module host");
}
