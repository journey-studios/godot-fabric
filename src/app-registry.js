import * as Registry from "react-native/Libraries/ReactNative/AppRegistryImpl";
import * as Fabric from "react-native/Libraries/Renderer/implementations/ReactFabric-prod";
export { RootTagContext } from "react-native/Libraries/ReactNative/RootTag";

// UIManager's upstream AppRegistryBinding calls these functions for every root.
// Godot replaces only renderApplication's native container, not the registry or
// reconciler. Native FabricApplication owns mounting and global shutdown.
globalThis.RN$AppRegistry = Registry;
globalThis.RN$stopSurface = Fabric.stopSurface;

export const AppRegistry = Object.freeze({
  registerComponent(key, provider, section) {
    if (typeof key !== "string" || !key.trim() || typeof provider !== "function")
      throw new TypeError("AppRegistry requires a nonempty key and component provider");
    if (section != null)
      throw new Error("Godot AppRegistry does not implement sections");
    if (Registry.getAppKeys().includes(key) || ["__proto__", "constructor", "prototype"].includes(key))
      throw new Error(`AppRegistry component key is already registered or reserved: ${key}`);
    return Registry.registerComponent(key, provider);
  },
  getAppKeys: Registry.getAppKeys,
});
