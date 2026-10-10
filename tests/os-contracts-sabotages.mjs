// The retained sabotages of the OS-specific contracts lane, written once: scripts/os-contracts-bundle.mjs hands each to esbuild as an in-memory override of one SDK file (no
// source file is edited), scripts/os-contracts-sabotage.mjs runs the lane on each, and tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its
// file. It has no side effects, so the test can import it.
//
//   platform-android  Platform.OS is "android": every module takes its Android branch, so the modules that need a host module throw, and
//                     TouchableNativeFeedback sends a native background to the host.
//   silent-shim       ToastAndroid stays silent and PermissionsAndroid grants: the shortcut that makes an Android-only API look supported.
//   self-import       The facade uses RN's generic ToastAndroid path, which imports itself and resolves to undefined.
const toastFallback = 'return require("react-native/Libraries/Components/ToastAndroid/ToastAndroidFallback").default;';
const permissions = 'return require("react-native/Libraries/PermissionsAndroid/PermissionsAndroid").default;';
export const SABOTAGES = [
  {name: "platform-android", file: "src/platform.js", edits: [{find: 'OS: "godot"', replace: 'OS: "android"'}, {find: "values.godot ??", replace: "values.android ??"}]},
  {name: "silent-shim", file: "src/os-specific.js", edits: [
    {find: toastFallback, replace: 'return {SHORT: 0, LONG: 0, TOP: 0, BOTTOM: 0, CENTER: 0, show() {}, showWithGravity() {}, showWithGravityAndOffset() {}};'},
    {find: permissions, replace: `const real = require("react-native/Libraries/PermissionsAndroid/PermissionsAndroid").default;
    const granted = async () => real.RESULTS.GRANTED;
    return {PERMISSIONS: real.PERMISSIONS, RESULTS: real.RESULTS, check: async () => true, request: granted,
      requestMultiple: async list => Object.fromEntries(list.map(permission => [permission, real.RESULTS.GRANTED]))};`}]},
  {name: "self-import", file: "src/os-specific.js", edits: [{find: toastFallback,
    replace: 'return require("react-native/Libraries/Components/ToastAndroid/ToastAndroid").default;'}]},
];
