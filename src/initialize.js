import "./runtime";
import "./native-module-runtime";

// The native host installs Hermes/Fabric and TimerManager first; the portable
// RN microtask/immediate modules initialize before the renderer evaluates.
if (!globalThis.nativeFabricUIManager || !globalThis.HermesInternal) {
  throw new Error("This bundle requires real Hermes and Fabric JSI bindings");
}
