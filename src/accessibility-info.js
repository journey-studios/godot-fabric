// React Native's index.js exposes AccessibilityInfo through a lazy getter:
// importing react-native never constructs it. AccessibilityInfo.js looks up its
// native modules when it is first imported (NativeAccessibilityManager with
// TurboModuleRegistry.get, which on Godot's iOS-contract branch is the module
// the host installs, and NativeAccessibilityInfo, the Android one, which the
// host does not install and so is null), so a bundle that never reads
// AccessibilityInfo never creates the host's module, and a host without it
// fails only where an API that needs it is called. ESM exports cannot be
// getters, so this CommonJS module keeps that laziness and returns RN's original
// object.
module.exports = {
  get AccessibilityInfo() {
    return require("react-native/Libraries/Components/AccessibilityInfo/AccessibilityInfo").default;
  },
};
