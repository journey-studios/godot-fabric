import "./native-module-runtime";

// The suffix keeps this original RN file out of the platform alias targeting
// extensionless NativeModules imports. RN exports the actual native JSI proxy.
export { default } from "react-native/Libraries/BatchedBridge/NativeModules.js";
