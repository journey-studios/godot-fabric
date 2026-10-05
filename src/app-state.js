// React Native's index.js exposes AppState through a lazy getter: importing
// react-native never constructs it, and a host without the native AppState
// module fails only where AppState is read. ESM exports cannot be getters, so
// this CommonJS module keeps that laziness and returns RN's original instance.
module.exports = {
  get AppState() {
    return require("react-native/Libraries/AppState/AppState").default;
  },
};
