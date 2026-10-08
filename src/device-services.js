// React Native's index.js exposes Linking, Clipboard and Vibration through lazy
// getters. Linking.js looks its native module up when it is imported, and
// NativeClipboard and NativeVibration require theirs with getEnforcing at
// import, so importing react-native must not construct any of them: a bundle
// that never reads one still runs on a host without the native module, and a
// host without it fails only where the API is first read. ESM exports cannot be
// getters, so this CommonJS module keeps that laziness and returns RN's original
// instances.
module.exports = {
  get Linking() {
    return require("react-native/Libraries/Linking/Linking").default;
  },
  // The deprecation notice is RN's own, printed once on the first read, as in
  // index.js.
  get Clipboard() {
    require("react-native/Libraries/Utilities/warnOnce").default(
      "clipboard-moved",
      "Clipboard has been extracted from react-native core and will be removed in a future release. " +
        "It can now be installed and imported from '@react-native-clipboard/clipboard' instead of 'react-native'. " +
        "See https://github.com/react-native-clipboard/clipboard",
    );
    return require("react-native/Libraries/Components/Clipboard/Clipboard").default;
  },
  get Vibration() {
    return require("react-native/Libraries/Vibration/Vibration").default;
  },
};
