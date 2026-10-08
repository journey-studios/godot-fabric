# AccessibilityInfo over Godot's accessibility settings

Status: executed isolated macOS validation against pinned RN 0.87.1 and official Godot
4.7.2, headless, for the second slice of GF-20 (accessibility), part a: the settings and
their events. The probe runs RN's original `AccessibilityInfo` through the public
`react-native` import in two actual `FabricApplication`s; the preceding host (the one built
from `main` before this slice) fails exactly the checks that need the native module, and
four retained host sabotages are rejected by the probe and by an independent oracle (a
fifth, the missing resolver alias, is rejected by the platform-seams test). The
[evidence record](../evidence/accessibility-info/README.md) pins the executions to the
implementation commit. Real operating-system settings (a user turning VoiceOver, Reduce
Motion, Reduce Transparency or Increase Contrast on), the mobile servers and a graphical CI
run are not certified; see "Remaining scope". Announcements and the refusal of programmatic focus are
part b of the slice, [accessibility-announcements.md](accessibility-announcements.md); this note records
part a, and where a row below says "none yet" or names slice 2b, that note has replaced it.

## What RN does

`Platform.OS` is `"godot"` here (`src/platform.js`; the roadmap forbids pretending to be iOS
or Android), and `Libraries/Components/AccessibilityInfo/AccessibilityInfo.js` branches on
`Platform.OS === 'android'` alone, so every other value takes the iOS branch.

**The module.** The iOS branch talks to `NativeAccessibilityManager`
(`src/private/specs_DEPRECATED/modules/NativeAccessibilityManager.js`), looked up with
`TurboModuleRegistry.get('AccessibilityManager')` when `AccessibilityInfo.js` is imported
(line 70 of the spec). The Android branch's `NativeAccessibilityInfo` is looked up the same
way at import (`TurboModuleRegistry.get('AccessibilityInfo')`) and is `null` on this host,
which registers only the iOS one. So importing `AccessibilityInfo` is what creates the
host's module, and a host without it fails only where a getter or a method needs it.
Generated spec: `NativeAccessibilityManagerCxxSpec` in
`React/FBReactNativeSpec/FBReactNativeSpecJSI.h` (lines 1022-1150) registers twelve methods:
the eight `getCurrent*State` getters (a success and an error callback each; two of them are
optional in the Flow spec), `setAccessibilityContentSizeMultipliers`, `setAccessibilityFocus`,
`announceForAccessibility` and `announceForAccessibilityWithOptions`. None can be left
unimplemented: the generated class asserts every method.

**The getters** (`AccessibilityInfo.js`): `isScreenReaderEnabled` (324) calls
`getCurrentVoiceOverState`; `isReduceMotionEnabled` (182) `getCurrentReduceMotionState`;
`isReduceTransparencyEnabled` (301) `getCurrentReduceTransparencyState`;
`isDarkerSystemColorsEnabled` (237) `getCurrentDarkerSystemColorsState`;
`isBoldTextEnabled` (89), `isGrayscaleEnabled` (114), `isInvertColorsEnabled` (149) and
`prefersCrossFadeTransitions` (269) call their `getCurrent*State`. Each is a
`new Promise((resolve, reject) => native.getCurrentXState(resolve, reject))`, and a missing
module rejects with `NativeAccessibilityManagerIOS is not available`. Three answers need no
native module on this branch: `isHighTextContrastEnabled` resolves `false` (211),
`isAccessibilityServiceEnabled` rejects `isAccessibilityServiceEnabled is only available on
Android` (353-375) and `getRecommendedTimeoutMillis` resolves the timeout it was given
(503-523, `Promise.resolve(originalTimeout)`).

**iOS never calls the error callback.** `RCTAccessibilityManager.mm` reads the seven
settings once, in `init` (lines 43-103: `UIAccessibilityIsVoiceOverRunning()` and its
siblings), and every getter answers `onSuccess(@[ @(_isXEnabled) ])` from that cached value
(lines 366-418). The error callback is `__unused`. Godot has settings it cannot know, so
this host needs the error callback and uses it.

**The events.** `AccessibilityInfo.js` maps nine public names to eight device events
(`EventNames`, lines 52-73): `change` is the alias of `screenReaderChanged`;
`announcementFinished`, `boldTextChanged`, `grayscaleChanged`, `invertColorsChanged`,
`reduceMotionChanged`, `reduceTransparencyChanged` and `darkerSystemColorsChanged` map to
themselves. `addEventListener` is `RCTDeviceEventEmitter.addListener(deviceEventName, handler)`
(419-428) and a name outside the map (`highTextContrastChanged`, a typo) returns
`{remove() {}}`. It does not go through the native module: a listener hears whatever the
host emits through `RCTDeviceEventEmitter`, and only a created module can emit.
`RCTAccessibilityManager.mm` emits (lines 126-221) only when the new value differs from the
cached one (`if (_isX != newX)`), with the boolean as the body, and `announcementFinished`
with `{announcement, success}` when the system finishes speaking.

**Focus and events from the renderer.** `setAccessibilityFocus(tag)` (436) calls
`legacySendAccessibilityEvent(tag, 'focus')`. `legacySendAccessibilityEvent.js` merely imports
itself (it is the deep-import shim); the `.ios.js` file calls
`NativeAccessibilityManager.setAccessibilityFocus` for a `focus` event and nothing else.
`sendAccessibilityEvent(handle, type)` (444-453) goes through the renderer to
`nativeFabricUIManager.sendAccessibilityEvent`, which reaches the host's
`UIManagerDelegate::uiManagerDidSendAccessibilityEvent`. iOS acts on `focus` alone
(`React/Fabric/Mounting/RCTMountingManager.mm:342-348`) and ignores every other type.

## What this host did

`src/platform-environment.js` exported a stub: `isReduceMotionEnabled` resolved `false` and
`addEventListener` accepted only `reduceMotionChanged`, with a listener set that nothing ever
called. `environmentStats().reduceMotion` counted those stub listeners and two Godot scenes
(`scripts/typography_validation.gd:95` and `scripts/nativewind_validation.gd:86`) require it to
be `0` on exit. `uiManagerDidSendAccessibilityEvent` failed for every type with
`Accessibility adapter is not implemented`. RN's own `legacySendAccessibilityEvent` could not be
bundled (the resolver picked the self-importing file).

## What Godot offers

- Four settings are readable, called by name on the `DisplayServer` singleton:
  `accessibility_screen_reader_active`, `accessibility_should_reduce_animation`,
  `accessibility_should_reduce_transparency` and `accessibility_should_increase_contrast`
  (`servers/display/display_server.cpp:1580-1583`; the extension API of 4.7.2 lists each as
  `int`, no arguments). Each answers `-1` (unknown), `0` or `1`.
- On macOS the values come from a cache the application delegate fills when it starts and
  refreshes on `NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification` and a KVO of
  `voiceOverEnabled` (`platform/macos/godot_application_delegate.mm:65-70,155-182`;
  `platform/macos/display_server_macos_base.mm:478-492`). The screen reader is VoiceOver's
  `NSWorkspace.isVoiceOverEnabled`. The values are `0` or `1`, never `-1`.
- The headless server and the mobile servers report `-1` for all four.
- **There is no signal or callback** for any of them: the class has no accessibility
  signal, and `set_system_theme_change_callback` is the only change hook of the display
  server. A change can only be seen by asking again.
- **No backing at all** for bold text, grayscale, inverted colors, cross-fade transitions and
  the content size category; Godot has no method that announces text to an extension (only the live region of
  a node, which AccessKit's macOS adapter speaks when the node has a value: slice 2b builds an element for each
  announcement) and no end-of-speech callback.
- `DisplayServer` is not in the class profile (`native/godot-profile.json`), so the host calls
  it through `Engine::get_singleton()->get_singleton("DisplayServer")->call(...)`, as
  `native/fabric_application.cpp` already does for the theme. The profile is unchanged.

## The contract

One owner, `AccessibilityInfo` (`native/accessibility_info.{h,cpp}`), belongs to each
`FabricApplication`, is shared by every root of its runtime and registers one C++
TurboModule, `AccessibilityManager`, with `registry.add(name, factory, dispose)`, as
`DeviceServices::install` does. A pure core (`native/accessibility_info_core.h`: the
three-valued reading, the change rule, the iOS names and error codes, the counters) needs
neither Godot nor RN and has its own test (`native/accessibility_info_core_test.cpp`, built as
`accessibility_info_core_test`). The queued events share `StoppableInvoker` with the
networking and device modules, so nothing queued runs after a stop.

| Public API | Native method | Backing in Godot | Contract here |
| --- | --- | --- | --- |
| `isScreenReaderEnabled` | `getCurrentVoiceOverState` | `accessibility_screen_reader_active` | `1` resolves `true`, `0` `false`, `-1` calls the error callback with `E_ACCESSIBILITY_UNKNOWN` |
| `isReduceMotionEnabled` | `getCurrentReduceMotionState` | `accessibility_should_reduce_animation` | the same |
| `isReduceTransparencyEnabled` | `getCurrentReduceTransparencyState` | `accessibility_should_reduce_transparency` | the same |
| `isDarkerSystemColorsEnabled` | `getCurrentDarkerSystemColorsState` | `accessibility_should_increase_contrast` | the same |
| `isBoldTextEnabled` | `getCurrentBoldTextState` | none | error callback with `E_ACCESSIBILITY_UNAVAILABLE`, never `false` |
| `isGrayscaleEnabled` | `getCurrentGrayscaleState` | none | the same |
| `isInvertColorsEnabled` | `getCurrentInvertColorsState` | none | the same |
| `prefersCrossFadeTransitions` | `getCurrentPrefersCrossFadeTransitionsState` | none | the same |
| none (module call) | `setAccessibilityContentSizeMultipliers` | none (no content size category) | an argument with a value that is not null, undefined or a number above zero for one of the twelve categories throws `E_ARGUMENT`; a valid one throws `E_UNSUPPORTED` |
| `setAccessibilityFocus` | `setAccessibilityFocus` | none: Godot has one focus | slice 2a threw `E_UNSUPPORTED` naming GF-20 slice 2b; slice 2b throws it with the reason (Godot has a single focus; moving the screen reader's would blur the focused control) |
| `announceForAccessibility` | `announceForAccessibility` | none | slice 2a threw `E_UNSUPPORTED` naming slice 2b; slice 2b speaks it through AccessKit |
| `announceForAccessibilityWithOptions` | `announceForAccessibilityWithOptions` | none | slice 2a threw `E_UNSUPPORTED` naming slice 2b; slice 2b speaks it (`priority: 'high'` is assertive) and refuses `queue: true` and `priority: 'low'` with their reasons |
| `isHighTextContrastEnabled`, `isAccessibilityServiceEnabled`, `getRecommendedTimeoutMillis` | none | none | RN's own JavaScript answers (`false`, a rejection, the timeout given) |
| `sendAccessibilityEvent(handle, type)` | UIManager delegate | none | a type other than `focus` is ignored and counted by type, as iOS does; `focus` fails out loud (slice 2a: `focus is not implemented yet (GF-20 slice 2b)`; slice 2b: the focus reason above) |

Events, by device event name (`change` is `screenReaderChanged`'s alias, and it is the same
single emission):

| Public name | Device event | Source | Contract here |
| --- | --- | --- | --- |
| `screenReaderChanged`, `change` | `screenReaderChanged` | screen reader reading | once per change |
| `reduceMotionChanged` | `reduceMotionChanged` | reduce animation reading | once per change |
| `reduceTransparencyChanged` | `reduceTransparencyChanged` | reduce transparency reading | once per change |
| `darkerSystemColorsChanged` | `darkerSystemColorsChanged` | increase contrast reading | once per change |
| `boldTextChanged`, `grayscaleChanged`, `invertColorsChanged` | the same | none | never fires |
| `announcementFinished` | the same | none (macOS, AccessKit and Godot have no end-of-speech signal; Godot's text to speech is not the screen reader) | never fires |
| `highTextContrastChanged`, `accessibilityServiceChanged`, any other name | none | RN's map has no entry | `{remove() {}}`, as RN |

Decisions:

1. **Getters answer the last reading, taken at module creation and then every frame.** The
   module is created by the first import of `AccessibilityInfo.js`, and its constructor reads
   the four settings once, as `RCTAccessibilityManager`'s `init` does; a getter never reads
   the platform itself. A getter called right after a change is therefore as fresh as the last
   frame's poll (one pump).
2. **`-1` is unknown, never `false`.** The error callback receives an `Error` (not a string),
   so the promise rejects with a normal error whose message starts with
   `E_ACCESSIBILITY_UNKNOWN:`. The settings with no backing reject the same way with
   `E_ACCESSIBILITY_UNAVAILABLE:`; resolving `false` for them would answer a question Godot
   cannot ask (the roadmap's GF-04 rule: no silent success).
3. **Polling, once per frame.** Godot has no change signal, so `ApplicationRuntime::Impl::pump`
   calls `AccessibilityInfo::poll()` after the networking and image polls and before it drains
   the queued work. The device event of a change is queued by `emitDeviceEvent` and the same
   pump's drain delivers it to JS. Polling does nothing until the module exists (an
   application whose JS never imports `AccessibilityInfo` reads nothing) and nothing after
   stop.
4. **A reading is an integer or it is unknown.** A `DisplayServer` that lacks the method, or a
   call that returns anything other than an integer (nil is what a wrong method name would
   give), is `-1`, never `0`. Everything that names a setting (its getter, event, snapshot key,
   error description, meta key and `DisplayServer` method) is one row of one table in
   `native/accessibility_info_core.h`, so a setting is added or changed in one place.
5. **A change is a known value that differs from the last known one.** An unknown reading
   changes nothing and emits nothing, and the last known value is kept: a setting that goes
   `1`, `-1`, `1` emits nothing, and one that goes `1`, `-1`, `0` emits `false`. `-1` after `-1`
   emits nothing. The first known value after only unknown readings has no earlier known value
   to equal, so it is a change (a screen reader that appears after the platform could not
   report one emits once). iOS emits only on a difference from its cached value (lines
   126-221); this is the same rule with a third state.
6. **One owner per application, one module per runtime.** Two applications are independent:
   each reads its own settings and counts its own events.
7. **Validation seam.** The application's `validation_accessibility_settings` meta is a
   Dictionary with the keys `screen_reader`, `reduce_animation`, `reduce_transparency` and
   `increase_contrast`, each `-1`, `0` or `1`. Only the keys present replace the
   `DisplayServer`'s reading, and a value that is not one of those integers is unknown. The meta
   is read on every reading, so a validation run changes a setting by setting the meta again
   and waits for the host's own poll counter (frames the host delivered), never for time.
8. **Module calls after stop throw `E_MODULE_DISPOSED`** synchronously, for all twelve
   methods; queued callbacks and events are dropped and counted.
9. **`uiManagerDidSendAccessibilityEvent`**: `focus` fails out loud (the message above; slice 2b
   replaced "not implemented yet" by the reason) and is counted; every other type is counted by type (at most sixteen distinct types, then one
   overflow count).

`RN's index.js` exposes `AccessibilityInfo` through a lazy getter, so
`src/accessibility-info.js` is a CommonJS module that returns RN's original object from a
getter and `src/platform-environment.js` re-exports it in place of the stub. `src/react-native-platform.jsx`
is unchanged. `environmentStats().reduceMotion` is now
`RCTDeviceEventEmitter.listenerCount('reduceMotionChanged')`, and `disposeEnvironment` removes the
listeners of all eight accessibility device events, as it does for AppState, Appearance and
networking. The bundler resolves RN's `legacySendAccessibilityEvent` to its `.ios.js` file
(`sdk/toolchain/platform-plugin.mjs`), the iOS function whose contract this module implements,
the way `RCTNetworking` resolves to its Android wrapper.

## What the tests prove

`npm run test:accessibility-info` runs a headless probe with the same bundle in two actual
applications and replays what it recorded through an independent oracle that is written from
RN's rules and not from the host:

- **A** (the validation meta, two roots): the module is not created by mounting roots or by
  looking up RN's Android module (which is `null`), and the first public read creates it and
  takes the baseline; every getter with a known value, `-1`, an absent key and an invalid value;
  the four events, each exactly once per change, to the listeners of both roots in
  subscription order, including the `change` alias; four settings changing in one frame (four
  events, in the settings' order); an unchanged platform, `-1` after `-1`, and a return to the
  last known value emitting nothing; the callbacks of the module itself; the content size
  argument; the announcements and focus; `sendAccessibilityEvent` of the types iOS ignores;
  unsubscribing, unmounting a root, and stop.
- **R** (the real backend): in headless every setting is `-1`, so every getter rejects and no
  event ever arrives, while A changes four settings and stops; a `focus` event still fails
  (with the slice-2a message here, the reason since slice 2b).
- Order and counts, never time: the probe waits for the host's poll counter, and the oracle
  checks the host polled at least the frames it waited for and that a stopped application
  polls no more.
- The names of the readings are held to the engine's, not to the host's. In headless all four real
  readings are `-1`, so a reading taken from the wrong method looks like the right one; what tells
  them apart is the `displayMethod` the host's snapshot names for each setting. The probe checks, in
  the real-backend application, that each one is a method `DisplayServer` has
  (`ClassDB.class_has_method`) and that what the script gets from calling it is what the host last
  read; the oracle checks the four names against its own list of Godot 4.7.2's.
- The preceding host fails exactly the 40 normative checks of 54, the getters reject with RN's
  own `NativeAccessibilityManagerIOS is not available` and no event arrives. Four host
  sabotages are rejected: `unknown-as-false` (`-1` read as off, 12 checks fail), `emit-every-poll`
  (every poll reports the known value, 17), `swapped-settings` (the meta keys of reduce motion and
  reduce transparency swapped in the descriptor table, 8) and `display-name` (a `DisplayServer`
  method that does not exist for reduce motion: the host reads `-1`, the getter still rejects, and
  the 2 checks that hold the names to the engine's fail). The missing resolver alias breaks the
  bundle (the platform-seams test).

## Remaining scope

- **Not certified: the real operating system.** The suite never changes a real VoiceOver,
  Reduce Motion, Reduce Transparency or Increase Contrast setting; macOS values are the
  delegate's cache that Godot fills, read by name, and only the validation meta changes
  them in the tests. Because all four readings are `-1` in headless, the suite proves that
  each setting names a method the engine has and that the engine answers it as the host read
  it, not that the method is the one of that setting on a machine that reports a value: a swap
  of two existing methods would pass in headless. The names are the oracle's list of Godot
  4.7.2's, and the meta's key mapping, which headless does distinguish, is what the
  `swapped-settings` sabotage exercises.
- **Mobile.** Godot's iOS and Android servers report `-1` today, so every getter rejects
  `E_ACCESSIBILITY_UNKNOWN` there. A bridge to UIKit and Android's accessibility manager is
  the work of the mobile slices (GF-34 and GF-35).
- **No graphical CI.** The hosted run is headless.
- **Slice 2b** ([accessibility-announcements.md](accessibility-announcements.md), [record](../evidence/accessibility-announcements/README.md)). The spike
  found that AccessKit's macOS adapter speaks a live node's value (measured), so announcements are
  elements made for each call; programmatic focus has no way to move the screen reader's focus
  without moving the keyboard focus, and stays refused with that reason; `announcementFinished`
  never fires.
- **Text scale.** `setAccessibilityContentSizeMultipliers` and `fontScale` wait for a content
  size category that Godot does not have. iOS stores whatever number it is given and falls back
  to `1.0` with an `RCTLogError` when it uses a multiplier of zero or less
  (`RCTAccessibilityManager.mm:238-246`); this host cannot use any multiplier, so it rejects the
  argument iOS would repair.
- **Windows and Linux.** The `DisplayServer` methods exist, but their values are unverified here.
- **One frame of latency.** A change is seen at the next poll. A game that needs it sooner
  reads the `DisplayServer` itself.

## Sources

- `Libraries/Components/AccessibilityInfo/AccessibilityInfo.js`: 52-73 (`EventNames`), 89-375
  (getters), 419-428 (`addEventListener`), 436, 444-453, 459, 479 (focus, events,
  announcements).
- `Libraries/Components/AccessibilityInfo/legacySendAccessibilityEvent.js` (self-import) and
  `.ios.js`.
- `src/private/specs_DEPRECATED/modules/NativeAccessibilityManager.js` (the Flow spec; line 70).
- `React/CoreModules/RCTAccessibilityManager.mm`: 43-103 (init), 126-221 (events), 238-246
  and 277-309 (multipliers), 311-357 (focus and announcements), 366-418 (getters).
- `React/Fabric/Mounting/RCTMountingManager.mm`: 342-348.
- `React/FBReactNativeSpec/FBReactNativeSpecJSI.h`: 1022-1150 (`NativeAccessibilityManagerCxxSpec`).
- Godot 4.7.2: `servers/display/display_server.cpp:1580-1583`,
  `platform/macos/godot_application_delegate.mm:65-70,155-182`,
  `platform/macos/display_server_macos_base.mm:478-492`, and the extension API
  (`DisplayServer` methods; no accessibility signal).
