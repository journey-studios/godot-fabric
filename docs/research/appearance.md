# Appearance and useColorScheme from Godot's system theme

Status: executed isolated macOS validation against pinned RN 0.87.1 and official
Godot 4.7.2. The [evidence](../evidence/appearance/README.md) owns the 67 headless
checks, the preceding-host control (the same bundle fails exactly its 45 normative
checks) and a retained sabotage of the change rule. The headless DisplayServer has
no system theme, so real OS theme changes are not certified.

## What RN does

`Libraries/Utilities/Appearance.js` is a lazy module. Its first call looks the
native module up with `TurboModuleRegistry.get('Appearance')`, which is
nullable: without the module, `getColorScheme()` returns `null` and nothing is
ever emitted. With it, the module hands the native module to
`NativeEventEmitter` on every platform, subscribes one `appearanceChanged`
listener that caches `{colorScheme}` and re-emits it to its own JS listeners,
and caches the first `getColorScheme()` read. `setColorScheme()` calls native
and updates the cache at once: with the override itself, or with a fresh native
read for `auto` and `unspecified`. It does not notify listeners; only the
native event does. `useColorScheme.js` is `useSyncExternalStore` over
`addChangeListener` and `getColorScheme`, and `index.js` exposes both through
lazy getters.

The two platforms agree on the contract and differ in mechanics:

- **iOS** (`React/CoreModules/RCTAppearance.mm`) caches `_currentColorScheme`
  from the key window's trait collection when the module is created.
  `setColorScheme` sets `overrideUserInterfaceStyle` on every window, with
  `RCTConvert` mapping `light` and `dark` to explicit styles and `auto`,
  `unspecified` or any unknown value to `UIUserInterfaceStyleUnspecified`, which
  follows the system. A trait change sends `appearanceChanged` only when the
  recomputed scheme differs from the cached one, and the scheme is light unless
  the style is dark.
- **Android** (`ReactAndroid/.../appearance/AppearanceModule.kt`) computes the
  scheme from the current configuration (`UiModeUtils.isDarkMode`) on every
  read. `setColorScheme` calls `AppCompatDelegate.setDefaultNightMode`, with
  `auto` and `unspecified` following the system and unknown values ignored.
  `onConfigurationChanged` sends the event only when the scheme differs from
  the last one sent, which starts as `null`; `addListener` and
  `removeListeners` are stubs.

The generated `NativeAppearanceCxxSpec` is in
`React/FBReactNativeSpec/FBReactNativeSpecJSI.h`, and a C++ module emits device
events with `TurboModule::emitDeviceEvent`.

## What this host did

`src/platform-environment.js` exported a manual theme: `getColorScheme()` started
`light`, `setColorScheme()` accepted only `light` or `dark` and called its
listeners synchronously, and nothing read the system. `useColorScheme` in
`src/react-native-platform.jsx` threw (`Chart platform system color scheme is not
implemented`), so chart-kit's `ChartKitProvider`, which always calls it, could
not render.

## What Godot reports

`DisplayServer` exposes `is_dark_mode_supported()`, `is_dark_mode()` and one
system theme callback slot, `set_system_theme_change_callback(Callable)`, called
with no arguments on the main thread (`call_deferred` on Android). The base and
headless DisplayServers return `false` and ignore the callback
(`servers/display/display_server.h`). macOS calls it on
`AppleInterfaceThemeChangedNotification` and `AppleColorPreferencesChangedNotification`
and reads `AppleInterfaceStyle`; Windows calls it on every `WM_SETTINGCHANGE` and
`WM_SYSCOLORCHANGE`; the Linux portal, iOS and Android call it on their theme
signals. Every platform checks `is_valid()` first. In the engine only the editor's
`EditorNode` registers the slot, and only in editor processes.

## The mapping

One `SystemAppearance` belongs to each `FabricApplication`, and every root of its
runtime reads it through one native `Appearance` module:

- **Scheme.** An explicit `light` or `dark` override wins; otherwise the system
  scheme, which is `light` unless DisplayServer supports dark mode and reports
  it. Both RN platforms report light whenever the system style is not dark, so a
  system without a dark style (headless included) starts `light`, not `null`:
  RN's JS returns `null` only when the native module is missing.
- **Initial value.** The system is read when the module is created, as
  RCTAppearance caches it in `init`, and that scheme is the baseline for later
  changes. The first JS call to Appearance creates the module.
- **Changes.** `appearanceChanged {colorScheme}` is sent only when the effective
  scheme differs from the last one sent, starting from the baseline: never for a
  repeated or overridden system change, nor for an override that changes
  nothing. Windows calls the callback for unrelated setting changes, so the rule
  matters there.
- **Overrides.** `auto` and `unspecified` follow the system again, as on both
  platforms. Unknown values fail with `E_ARGUMENT` instead of following the
  system (iOS) or being ignored (Android), the SDK's rule for unsupported input.
  `getColorScheme()` returns the effective scheme at once, which is what RN's JS
  reads back after `auto` or `unspecified`.
- **Listeners.** `addListener` and `removeListeners` only count, for
  diagnostics; nothing is gated on the count, as on Android.
- **System callback.** The module registers `_on_system_theme_changed` on the
  application with DisplayServer when it starts observing, never in editor
  processes, and the callback reads the system again. On stop the module
  releases its observer and sends nothing. The registration stays, pointing at
  the application: it is inert, and invalid once the application is freed.
  Clearing it could drop a callback registered later by someone else.
- **Teardown.** `disposeEnvironment()` removes Appearance's device subscription,
  as destroying the VM would, so its JS listeners can no longer be reached; the
  last scheme stays. `environmentStats().appearance` counts that subscription,
  and the `theme` field is gone.

## Why the probe is discriminating

The [probe](../../tests/appearance-probe.gd) supplies the system scheme through
the application's `validation_system_color_scheme` meta and invokes
`Callable(application, "_on_system_theme_changed")`, the Callable the module
registers with DisplayServer. Two roots render through `useColorScheme` and paint
their View with the scheme; each root and a library-style subscription made at
bundle evaluation listen through `Appearance.addChangeListener`. The steps cover
an unsupported initial system, a system change, a repeated one, overrides
against the system, `unspecified`, `auto` without a change, an override equal to
the system, an unknown override, a removed listener, a root's unmount and the
application's stop, plus a second application that starts from a supported dark
system. The [oracle](../../tests/appearance-oracle.mjs) re-derives every event,
listener, re-render, native color and counter from the probe's actions and RN's
rules.

On the preceding host the same bundle mounts and stops both roots, but RN's
Appearance finds no module: it reads `null`, the roots paint the fallback color
and nothing is emitted. It fails exactly the 45 checks that need the module. A
host that sends `appearanceChanged` for every callback and override fails 17
checks, and the oracle rejects its report.

## Remaining scope

Real OS theme changes on each platform, the single DisplayServer callback shared
with a game that sets its own (the last registration wins), accent and base
colors, `PlatformColor`/`DynamicColorIOS`, per-window themes, Godot Android and
iOS exports, device configuration and the remaining GF-21 items stay open.
