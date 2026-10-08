// React Native's index.js exposes its iOS- and Android-specific APIs through lazy
// getters. Several of them fail when they are imported on another platform
// (ToastAndroid and DrawerLayoutAndroid import themselves, StatusBar requires a
// native module at import), so importing react-native must not construct any
// of them: a bundle that never reads one still runs, and a read fails or warns
// only where RN itself does. ESM exports cannot be getters, so this CommonJS
// module keeps that laziness and returns RN's original modules.
//
// Godot is neither iOS nor Android: Platform.OS is "godot", so each module takes
// the branch RN gives every platform that is not its own. ToastAndroid and
// DrawerLayoutAndroid are resolved to RN's own non-Android implementations
// (ToastAndroidFallback.js, DrawerLayoutAndroidFallback.js, which RN's own
// .ios.js files export), because the generic files import themselves and the
// platform files they stand for are .android.js and .ios.js, which Godot does not
// resolve. A third-party package that imports a generic path keeps failing.
module.exports = {
  // Every call warns "ToastAndroid is not supported on this platform."; the
  // constants are 0.
  get ToastAndroid() {
    return require("react-native/Libraries/Components/ToastAndroid/ToastAndroidFallback").default;
  },
  // check resolves false, request 'denied' and requestMultiple {}, each after a
  // warning that the module works only on Android.
  get PermissionsAndroid() {
    return require("react-native/Libraries/PermissionsAndroid/PermissionsAndroid").default;
  },
  // Throws "DynamicColorIOS is not available on this platform.".
  get DynamicColorIOS() {
    return require("react-native/Libraries/StyleSheet/PlatformColorValueTypesIOS").DynamicColorIOS;
  },
  // Throws RN's argument invariants first, then "ActionSheetManager doesn't exist".
  get ActionSheetIOS() {
    return require("react-native/Libraries/ActionSheetIOS/ActionSheetIOS").default;
  },
  // The extraction notice is RN's own, printed once on the first read, as in
  // index.js. Off Android RN renders an UnimplementedView.
  get ProgressBarAndroid() {
    require("react-native/Libraries/Utilities/warnOnce").default(
      "progress-bar-android-moved",
      "ProgressBarAndroid has been extracted from react-native core and will be removed in a future release. " +
        "It can now be installed and imported from '@react-native-community/progress-bar-android' instead of 'react-native'. " +
        "See https://github.com/react-native-progress-view/progress-bar-android",
    );
    return require("react-native/Libraries/Components/ProgressBarAndroid/ProgressBarAndroid").default;
  },
  // The deprecation notice is RN's own, printed once on the first read. The
  // component renders an UnimplementedView and its methods throw "is only
  // available on Android".
  get DrawerLayoutAndroid() {
    require("react-native/Libraries/Utilities/warnOnce").default(
      "drawer-layout-android-deprecated",
      "DrawerLayoutAndroid is deprecated and will be removed in a future release. " +
        "Use 'react-native-drawer-layout' instead. " +
        "See https://reactnavigation.org/docs/drawer-layout/",
    );
    return require("react-native/Libraries/Components/DrawerAndroid/DrawerLayoutAndroidFallback").default;
  },
  // Warns "<InputAccessoryView> is only supported on iOS." and renders null.
  get InputAccessoryView() {
    return require("react-native/Libraries/Components/TextInput/InputAccessoryView").default;
  },
  // The extraction notice is RN's own, printed once on the first read. Every
  // static method throws "PushNotificationManager is not available.".
  get PushNotificationIOS() {
    require("react-native/Libraries/Utilities/warnOnce").default(
      "pushNotificationIOS-moved",
      "PushNotificationIOS has been extracted from react-native core and will be removed in a future release. " +
        "It can now be installed and imported from '@react-native-community/push-notification-ios' instead of 'react-native'. " +
        "See https://github.com/react-native-push-notification/ios",
    );
    return require("react-native/Libraries/PushNotificationIOS/PushNotificationIOS").default;
  },
};
