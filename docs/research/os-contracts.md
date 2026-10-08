# iOS- and Android-specific APIs on Godot: the upstream unavailability, reproduced

Status: executed isolated macOS validation against pinned RN 0.87.1 and official Godot
4.7.2, headless, for the first slice of GF-24 (OS-specific public contracts). The slice has
no native code. It exports RN's original ToastAndroid, PermissionsAndroid, DynamicColorIOS,
ActionSheetIOS, ProgressBarAndroid, DrawerLayoutAndroid, InputAccessoryView,
PushNotificationIOS and TouchableNativeFeedback from the public `react-native` import, each
running the branch RN itself takes on a platform that is neither iOS nor Android. The
probe runs them in two actual `FabricApplication`s (two Hermes runtimes, the real host
TurboModule registry) with an independent oracle that reads every text, key and count from
the pinned sources. The previous SDK fails exactly the checks that need the slice, and three
retained sabotages are rejected by the probe and by the oracle. The [evidence record](../evidence/os-contracts/README.md)
pins the execution once the implementation is committed. Nothing here certifies Android or iOS
behavior, the implementations those platforms ship (GF-34 and GF-35), or real devices; see
"Remaining scope".

## What GF-24 asks

The roadmap criterion (GF-24) is to map every pinned iOS- and Android-specific
component, API and prop, to implement it on the OSs where it applies, to reproduce the
upstream unavailability elsewhere, and to compare API and OS-version restrictions
explicitly; deprecation does not silently remove the pinned contract. Godot is the
"elsewhere": `Platform.OS` is `"godot"` here (`src/platform.js`; the roadmap forbids
pretending to be iOS or Android), so every module takes the branch RN gives any other
platform. This slice is the part "reproduce upstream unavailability elsewhere", for the nine
names above. The implementations on the OSs where the APIs exist, the per-OS props and the
OS-version restrictions are not part of it.

## What RN does

All line numbers are in the pinned package (`react-native` 0.87.1). RN's `index.js` exposes
each API through a lazy getter, so importing the root constructs none of them.

| API | Getter in `index.js` | Behavior with `Platform.OS` `"godot"` | Source |
| --- | --- | --- | --- |
| `ToastAndroid` | 362-363 requires `ToastAndroid/ToastAndroid` | The generic file only imports itself (`ToastAndroid.js:15`) and resolves `undefined`: RN ships the real module as `.android.js` and `.ios.js`. `ToastAndroidFallback.js` is RN's own non-Android implementation, the one `ToastAndroid.ios.js` exports: `SHORT`, `LONG`, `TOP`, `BOTTOM` and `CENTER` are 0, and `show`, `showWithGravity` and `showWithGravityAndOffset` each print `console.warn('ToastAndroid is not supported on this platform.')` and return `undefined` | `ToastAndroid.js:15,17`; `ToastAndroid.ios.js:11-13`; `ToastAndroidFallback.js:15-20,22-23,31,41`; the Android module requires `getEnforcing('ToastAndroid')` (`NativeToastAndroid.js:38`) |
| `PermissionsAndroid` | 312-313 | `PERMISSIONS` (44 names) and `RESULTS` (`granted`, `denied`, `never_ask_again`) are frozen tables. `check` warns `"PermissionsAndroid" module works only for Android platform.` and resolves `false`; `request` warns the same and resolves `'denied'`, with or without a rationale; `requestMultiple` warns and resolves `{}`. The deprecated `checkPermission` and `requestPermission` first warn of their deprecation, then of the platform, and resolve `false`. The native modules are `get` lookups, so a host without them is safe | `PermissionsAndroid.js:28-31,84-130`; `check` 178-183, `request` 235-243, `requestMultiple` 285-292, `checkPermission` 155-163, `requestPermission` 208-219; `NativePermissionsAndroid.js:80`, `NativeDialogManagerAndroid.js:48` |
| `DynamicColorIOS` | 269-271, the named export of `PlatformColorValueTypesIOS` | Throws `DynamicColorIOS is not available on this platform.` (the iOS file is `PlatformColorValueTypesIOS.ios.js`) | `PlatformColorValueTypesIOS.js:26-27` |
| `ActionSheetIOS` | 213-214 | Argument invariants run first (`Options must be a valid object`, `Must provide a valid callback`, and for the share sheet `Must provide a valid failureCallback` and `Must provide a valid successCallback`); with valid arguments `showActionSheetWithOptions`, `showShareActionSheetWithOptions` and `dismissActionSheet` throw `ActionSheetManager doesn't exist`, because the module is a `get` lookup that finds nothing | `ActionSheetIOS.js:82-89,161-175,187-188`; `NativeActionSheetManager.js` (spec `NativeActionSheetManager.js:56`) |
| `ProgressBarAndroid` | 103-112, with a `warnOnce` extraction notice | Off Android it is `UnimplementedView`: a `View` with no style of its own in production (`__DEV__` only adds a red border) that renders its children | `ProgressBarAndroid.js:39-43`; `UnimplementedView.js:31-34,39-47` |
| `DrawerLayoutAndroid` | 46-55, with a `warnOnce` deprecation notice | The generic file imports itself (`DrawerLayoutAndroid.js:15`) and resolves `undefined`. `DrawerLayoutAndroidFallback.js` is RN's non-Android class, the one `DrawerLayoutAndroid.ios.js` exports: it renders `UnimplementedView` with its props (so `renderNavigationView` is never called) and its eight methods (`openDrawer`, `closeDrawer`, `blur`, `focus`, `measure`, `measureInWindow`, `measureLayout`, `setNativeProps`) throw `DrawerLayoutAndroid is only available on Android` | `DrawerLayoutAndroid.ios.js:13-17`; `DrawerLayoutAndroidFallback.js:31-32,36-69` |
| `InputAccessoryView` | 79-81 | A function component that warns `<InputAccessoryView> is only supported on iOS.` on each render and returns `null` | `InputAccessoryView.js:45-47,62-64` |
| `PushNotificationIOS` | 325-334, with a `warnOnce` extraction notice | Fifteen static methods throw `PushNotificationManager is not available.` (`presentLocalNotification` ... `getAuthorizationStatus`; `checkPermissions` validates its callback first). `addEventListener` and `removeEventListener` do not use the module: RN builds the emitter with `null` unless `Platform.OS` is `'ios'`, so they register and remove a JavaScript listener for `notification`, `register`, `registrationError` and `localNotification`, and throw an invariant for any other event. `FetchResult` is a plain object | `PushNotificationIOS.js:66-71,192,210-531`; `NativePushNotificationManagerIOS.js:105` |
| `TouchableNativeFeedback` | 156-158 | Resolves and works as a Pressability touchable that clones its single child: `getBackgroundProp` is `null` off Android, so neither `nativeBackgroundAndroid` nor `nativeForegroundAndroid` reaches the child, and the press and hotspot native commands run only for `Platform.OS === 'android'`. The statics are RN's: `SelectableBackground`, `SelectableBackgroundBorderless`, `Ripple` and `canUseNativeForeground` (false) | `TouchableNativeFeedback.js:128-190,208,224-263,384-392` |
| `StatusBar` | 137-139 | Requires `NativeStatusBarManagerAndroid` and `NativeStatusBarManagerIOS` at import, each with `getEnforcing('StatusBarManager')` at the top of the spec, so the import throws on a host without the module | `StatusBar.js:15-16`; `NativeStatusBarManagerIOS.js:39`, `NativeStatusBarManagerAndroid.js:29` |

`console.*` is the host's: it prints `HERMES: <message>` through `nativeLoggingHook`
(`native/application_runtime.cpp:894-897`, the console installed at 1058-1059).

## What this host did

None of the nine names was exported (`missing_public_export` in the compatibility audit, all
assigned to GF-24) and `StatusBar` was an exported placeholder that throws when it renders.
The host registered none of the native modules they look up, and still registers none.

## The contract

- **Original modules, never copies.** `src/os-specific.js` is a CommonJS module with lazy
  getters, copying the pattern of `src/device-services.js` (ESM exports cannot be getters).
  `react-native-platform.jsx` re-exports it with `export { ... } from "./os-specific"`. Each
  getter returns the original module of the table above; ProgressBarAndroid, DrawerLayoutAndroid
  and PushNotificationIOS print RN's own `warnOnce` notice first, with the same keys and texts as
  `index.js` (the oracle reads them from there).
- **The Fallback files by public path.** ToastAndroid and DrawerLayoutAndroid come from
  `ToastAndroidFallback` and `DrawerLayoutAndroidFallback`. They are what RN's own `.ios.js` files export for a
  platform that is not Android, they are public subpaths, and they are not a reimplementation.
- **TouchableNativeFeedback** is the facade's guarded wrapper over RN's class, as the
  other touchables are: inside `Text` it throws `Inline Controls are not implemented in Godot
  Text`, and it keeps RN's four statics (`SelectableBackground`, `SelectableBackgroundBorderless`,
  `Ripple`, `canUseNativeForeground`), assigned from RN's class. It is not given a style
  check: it renders no View of its own.
- **No host module.** The host registers none of `ToastAndroid`, `PermissionsAndroid`,
  `ActionSheetManager`, `DialogManagerAndroid`, `PushNotificationManager` and `StatusBarManager`
  (`adapter-manifest` reserves their names as host core, so an extension cannot register them
  either). The contract is the absence: `TurboModuleRegistry.get` returns `null` and
  `getEnforcing` throws RN's own error. A module that pretended to support StatusBar, for
  example, would turn a missing capability into a silent no-op.
- **`'denied'`, `false` and `{}` mean unavailable.** RN's own answers on a platform that is not
  Android are `check` -> `false`, `request` -> `'denied'`, `requestMultiple` -> `{}`, after a
  warning. That is the upstream behavior the roadmap asks to reproduce, so it is not replaced by
  an error: an application that must tell a refusal from an absence reads Platform.OS, as it
  does for RN on any non-Android platform. The documentation says so.
- **StatusBar stays a placeholder** (`unavailable("StatusBar")`: rendering it throws
  `Godot platform does not implement StatusBar`), with a negative check. The probe also checks that
  the host has no `StatusBarManager`.
- **Out of scope.** Alert, Share, Settings and BackHandler (GF-23, V2-D30); the OS-specific props
  of other components; the implementations the mobile ports ship (GF-34, GF-35); the alias in
  `sdk/toolchain/platform-plugin.mjs` that would map the generic deep paths to the Fallback files
  (the toolchain is another delivery's area). Until that alias exists, a third-party package that
  imports `react-native/Libraries/Components/ToastAndroid/ToastAndroid` or the generic
  `DrawerLayoutAndroid` path still gets `undefined`; the probe records that fact for ToastAndroid.

## The probe

`tests/os-contracts-probe.gd` runs two `FabricApplication`s with the same bundle
(`tests/os-contracts-fixture.jsx`), each with its own Hermes runtime. The fixture wraps
`console.warn` before it evaluates `react-native` (it still forwards to the host), reads every
API through the public import and records, for each read and call, where its warnings start and
what it returned, threw or resolved. Application A mounts a root with a case per component, each
in its own error boundary, and:

1. checks the structure that mounted (below), the render errors, and that importing
   `react-native` printed nothing;
2. reads each export (the notice of PushNotificationIOS prints on its first read; those of
   ProgressBarAndroid and DrawerLayoutAndroid printed at mount, once, and a second read prints
   nothing) and runs the 46 calls the sources imply;
3. finds the PushNotificationIOS statics and the DrawerLayoutAndroid methods on the classes
   themselves, so a method RN adds cannot go unchecked;
4. presses the TouchableNativeFeedback with a real mouse and a real touch;
5. asks the host registry for the six modules;
6. stops, and runs the synchronous parts of the APIs again.

Application B repeats a few reads in its own runtime and shows that `warnOnce` is per runtime.
After the run the Node test compares the log with the report: every warning the fixture saw is a
`HERMES:` line, the same number of times.

Native structure. UnimplementedView adds a plain `View` that Fabric flattens, so ProgressBarAndroid
and DrawerLayoutAndroid commit no view of their own. The probe proves they "mount as a View, with
children" by comparison: a control case renders `View > View > child` and the progress tree commits
the same wrapper, child, sizes and offset, and the drawer commits its main child only (the
navigation view, which `renderNavigationView` would build, is absent). Each root commits exactly
12 native views.

## Hermes/Godot against the Node vm research

The research that fixed the table ran RN's modules in Node `vm`. The probe confirms every row in
Hermes inside Godot, with these differences and refinements:

| Finding | Research | Hermes/Godot |
| --- | --- | --- |
| PushNotificationIOS methods | "the static methods throw `PushNotificationManager is not available.`" | Fifteen do. `addEventListener` and `removeEventListener` do not throw for RN's four events: they use a JavaScript-only emitter (`PushNotificationIOS.js:66-71`). The probe and the oracle separate the two groups from the source. |
| Press order | `onPressIn`, `onPress`, `onPressOut` | Pressability calls `_deactivate` before `onPress` on a release (`Pressability.js:737-757`) and `minPressDuration` is 0, so a press is `onPressIn` on contact, then `onPressOut`, then `onPress`, for mouse and touch. The oracle reads the order from that function. |
| ProgressBar and Drawer as View | mounts as View with children | UnimplementedView's own view is flattened by Fabric and has no native node; the children commit as a plain nested View does (compared with a control in the same root). |
| InputAccessoryView warnings | one warning | One per render, and a root renders more than once while it mounts, so the log holds two at mount. The oracle states it as one per render of the case. |
| After stop | not examined | The synchronous parts still work (a warning, a throw); a returned promise stays pending, because a stopping runtime no longer drains microtasks (`application_runtime.cpp:1117,1140-1142`). |
| `testID` of a TouchableNativeFeedback | not examined | RN clones the child with the touchable's own `testID` (`TouchableNativeFeedback.js:362`), so the child's is replaced. |

Everything else matches: the warnings, errors, constants, resolved values, counts (44 permissions,
15 + 2 PushNotificationIOS statics, 8 drawer methods, 5 Toast constants) and the six host modules
that are absent. With `Platform.OS` forced to `"android"` (retained sabotage) the same host answers
`Unsupported native command: setPressed` and `hotspotUpdate` to TouchableNativeFeedback, which is
why the Android branch must not be taken.

## Why the probe is discriminating

The slice has no native code, so the "previous host" control of other slices does not
discriminate (the binary is the same). The control is the **previous SDK**: the same fixture,
probe and oracle bundled, through the same `bundleNativeProbe` as the current SDK, with the
`src/` of `origin/main` before this slice (commit `6d02746`, with the Image and Accessibility
slices, extracted from git into `build/os-contracts-previous-sdk/`). Its facade exports none
of the nine names, so every read is `undefined`. It fails exactly the 30 normative checks of
37, and the 7 that hold on any SDK (the mount of the roots, nothing printed on import, StatusBar,
the absent host modules, the generic path, no diagnostic, a balanced stop) pass there.

Three sabotages, each an in-memory esbuild override of one SDK file (no source is edited; the
receipt hashes the files before and after):

- `platform-android`: `Platform.OS` is `"android"`. The modules that need a host module
  throw, TouchableNativeFeedback sends a native background, `setPressed` and `hotspotUpdate`
  (14 checks fail).
- `silent-shim`: ToastAndroid without a warning and PermissionsAndroid that grants (8 fail).
- `self-import`: the facade uses RN's generic ToastAndroid path, which is `undefined` (5 fail).

The oracle (`tests/os-contracts-oracle.mjs`) reads the texts, keys and counts from the pinned
sources instead of copying them: the warnings and the error of each module, the 44 permission
names and the results, the Toast constants, the methods of the Fallback class and the statics of
PushNotificationIOS, the invariants of ActionSheetIOS in order, the notices from `index.js`, the
host module names from the specs, the registry's error template and Pressability's order. It
compares each recorded call, the accounting of every warning (each belongs to a read, a call or
the mount), the native tree, the host's answers and the press, and it rejects the previous SDK and
the three sabotages even when their own checks are marked as passed.

## Limitations

- Platform.OS stays `"godot"`: a library that branches on `Platform.OS === 'android'` or
  `'ios'` takes its own non-native branch, as it does on any other platform.
- A third-party package that imports a generic path (`.../ToastAndroid/ToastAndroid`,
  `.../DrawerAndroid/DrawerLayoutAndroid`) gets `undefined`, because RN's generic files import
  themselves. Only imports of the public root are covered.
- `PermissionsAndroid` cannot tell a refusal from an absence: `false` and `'denied'` mean
  unavailable on Godot.
- A promise returned by these APIs (PermissionsAndroid) stays pending after a stop.
- No native look-alike: ProgressBarAndroid and DrawerLayoutAndroid draw nothing of their own.
- The suite runs headless on macOS arm64 only.

## Remaining scope

OS-specific completion needs the relevant port: the Android and iOS implementations of these
APIs (ToastAndroid, runtime permissions, ActionSheetIOS, DynamicColorIOS, PushNotificationIOS,
StatusBar, InputAccessoryView, the Android drawable of TouchableNativeFeedback), the OS-specific
props and the OS-version comparison belong to GF-34 and GF-35 and the rest of GF-24. The toolchain alias for the
generic deep paths follows the images delivery that owns `sdk/toolchain/`. Windows and Linux
have the same JavaScript behavior but no run; hosted CI is recorded separately.
