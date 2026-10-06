# Appearance and useColorScheme from Godot's system theme

Status: executed isolated macOS validation against pinned RN 0.87.1 and official
Godot 4.7.2. The [evidence](../evidence/appearance/README.md) owns the 79 headless
checks, the preceding-host control (the same bundle fails exactly its 56 normative
checks), the control on the host from before the shared system theme callback (it
fails exactly the 9 checks where two applications observe at once) and a retained
sabotage of the change rule. The headless DisplayServer has no system theme, so
real OS theme changes are not certified.

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
system theme callback slot for the whole process,
`set_system_theme_change_callback(Callable)`, which replaces the previous
Callable and is called with no arguments on the main thread (`call_deferred` on
Android). The base and headless DisplayServers return `false` and ignore the
callback (`servers/display/display_server.h`). macOS calls it on
`AppleInterfaceThemeChangedNotification` and
`AppleColorPreferencesChangedNotification` and reads `AppleInterfaceStyle`;
Windows calls it on every `WM_SETTINGCHANGE` and `WM_SYSCOLORCHANGE`; the Linux
portal, iOS and Android call it on their theme signals. Every platform checks
`is_valid()` first. In the engine only the editor's `EditorNode` registers the
slot, and only in editor processes.

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
- **System callback.** DisplayServer holds one callback for the whole process,
  so one `SystemThemeOwner` serves every application. The first Appearance
  module to start registers the owner's static Callable, once and never in
  editor processes; each change is dispatched through it once and delivered to
  every application whose module observes, which reads the system again. A
  module joins when it starts and leaves when it is released, on stop or when
  its application is freed, so a stopped or freed application hears nothing
  and the others keep hearing. Members are instance IDs resolved through
  ObjectDB on every change, so none dangles, and the owner's copy of the
  Callable is released when the extension's scene level terminates. On stop the
  module also releases its observer and sends nothing. The registration stays
  when the last application leaves: it is idle, and clearing it could drop a
  callback registered later by someone else. A game that registers its own
  callback replaces Fabric's for every application, and Fabric's first module
  replaces one a game registered before it. The first version registered
  `_on_system_theme_changed` per application, so a second application displaced
  the first, which kept a stale scheme (found in review on #35).
- **Teardown.** `disposeEnvironment()` removes Appearance's device subscription,
  as destroying the VM would, so its JS listeners can no longer be reached; the
  last scheme stays. `environmentStats().appearance` counts that subscription,
  and the `theme` field is gone.

## Why the probe is discriminating

The [probe](../../tests/appearance-probe.gd) supplies the system scheme through
each live application's `validation_system_color_scheme` meta and calls, once
per change, the Callable the shared owner registered with DisplayServer, read
through `FabricApplication.validation_system_theme_callback()`: the headless
DisplayServer drops it, so the probe calls it as DisplayServer would. On a host
without that seam the probe emulates DisplayServer's single slot with the
`Callable(application, "_on_system_theme_changed")` of the last application that
registered. Two roots render through `useColorScheme` and paint their View with
the scheme; each root and a library-style subscription made at bundle evaluation
listen through `Appearance.addChangeListener`. The steps cover an unsupported
initial system, a system change, a repeated one, overrides against the system,
`unspecified`, `auto` without a change, an override equal to the system, an
unknown override, a removed listener, a root's unmount and the application's
stop, a second application that starts from a supported dark system, and two
applications that observe at once: one change reaches both, stopping one leaves
the other receiving while the stopped one hears nothing, freeing it leaves
nothing dangling, and freeing the other while it still observes leaves the
callback registered and idle. The [oracle](../../tests/appearance-oracle.mjs)
re-derives every event, listener, re-render, native color and counter from the
probe's actions and RN's rules, and the owner's single registration, members,
dispatches and deliveries.

On the preceding host the same bundle mounts and stops every root, but RN's
Appearance finds no module: it reads `null`, the roots paint the fallback color
and nothing is emitted. It fails exactly the 56 checks that need the module. On
the host from before the shared owner, where each application registered its
own callback, the other 70 checks pass and exactly the 9 shared-callback checks
fail: the first application, displaced by the second's registration, never hears
a change, while the second keeps hearing them after it stops. The oracle rejects
that report. A host that sent `appearanceChanged` for every callback and
override failed 17 of the first execution's 67 checks, and the oracle rejected
its report.

## Remaining scope

Real OS theme changes on each platform, the single DisplayServer callback shared
with a game that sets its own (the last registration wins), accent and base
colors, `PlatformColor`/`DynamicColorIOS`, per-window themes, Godot Android and
iOS exports, device configuration and the remaining GF-21 items stay open.
