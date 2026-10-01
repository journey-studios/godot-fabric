// Runtime globals, timers, microtasks and JSI bindings are installed by the
// Godot native host before the original React Native renderer is evaluated.
if (!globalThis.nativeFabricUIManager || !globalThis.HermesInternal) {
  throw new Error("This bundle requires real Hermes and Fabric JSI bindings");
}
