// React Native's index.js exposes its lists through lazy getters: importing
// react-native never evaluates them. ESM exports cannot be getters, so this
// CommonJS module keeps that laziness and returns RN's original components.
// They render on the ScrollView that the public facade exports.
module.exports = {
  get FlatList() {
    return require("react-native/Libraries/Lists/FlatList").default;
  },
  get SectionList() {
    return require("react-native/Libraries/Lists/SectionList").default;
  },
  get VirtualizedList() {
    return require("react-native/Libraries/Lists/VirtualizedList").default;
  },
  get VirtualizedSectionList() {
    return require("react-native/Libraries/Lists/VirtualizedSectionList").default;
  },
};
