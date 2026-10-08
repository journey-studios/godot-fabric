# Linking, Clipboard and Vibration over Godot's device services

Status: executed isolated macOS validation against pinned RN 0.87.1 and official
Godot 4.7.2, headless, for the first slice of GF-23 (shared device services). The
probe runs the three original modules through the public `react-native` import in two
actual `FabricApplication`s; the preceding host (the one built from `main` before this
slice) fails exactly the checks that need the native services, and two retained
sabotages are rejected by the probe and by an independent oracle. The [evidence record](../evidence/device-services/README.md) pins the execution
and has the captures; its hosted CI run is pending. Real OS behavior (a real browser opening a
URL, the real pasteboard, real vibration hardware, a launcher passing a real `--uri=`)
and mobile exports are not certified; see "Remaining scope".

## What RN does

`Platform.OS` is `"godot"` here (`src/platform.js`; the roadmap forbids pretending to be
iOS or Android), so every RN module takes its non-Android branch.

**Linking** (`Libraries/Linking/Linking.js`) is one `NativeEventEmitter` subclass,
constructed at import. It hands its native module to the emitter only when
`Platform.OS === 'ios'` (line 26), so with `"godot"` the `url` event reaches listeners
through `RCTDeviceEventEmitter` alone and nothing calls `addListener` or
`removeListeners` on the module. `openURL` and `canOpenURL` validate in JavaScript
first, a non-string and then the empty string (`_validateURL`, lines 118-124), and then
call `nullthrows(NativeLinkingManager)` (lines 49-70); so does `openSettings` (77-82) and
`getInitialURL` (90-94). `sendIntent` rejects `Unsupported` in JavaScript outside Android
(103-116). The native spec (`src/private/specs_DEPRECATED/modules/NativeLinkingManager.js:15-27`)
requires `getInitialURL`, `canOpenURL`, `openURL`, `openSettings`, `addListener` and
`removeListeners`, and looks the module up with `TurboModuleRegistry.get('LinkingManager')`
at import, so a host without it fails only where a method is used. iOS
(`Libraries/LinkingIOS/RCTLinkingManager.mm`) resolves `true` from `openURL` or rejects
`Unable to open URL: <url>` (lines 91-113), answers `canOpenURL` with a boolean
(116-149), resolves `getInitialURL` with the launch URL or `null` (151-165), rejects
`openSettings` with `Unable to open app settings` when the settings URL cannot be opened
(166-176) and sends `url` with the URL as `{url}` (85-88). Android
(`ReactAndroid/.../intent/IntentModule.kt`) is a different contract that `Linking.js` only
takes for `Platform.OS === 'android'`.

**Clipboard** (`Libraries/Components/Clipboard/Clipboard.js`) is the legacy
module RN deprecated in favor of a community package. Its spec requires the module with
`getEnforcing('Clipboard')` at import (`NativeClipboard.js`, spec
`src/private/specs_DEPRECATED/modules/NativeClipboard.js`), with `getConstants`,
`getString(): Promise<string>` and `setString(string): void`. iOS resolves `""` for an
empty pasteboard and writes `""` for a missing argument (`React/CoreModules/RCTClipboard.mm`
lines 28-44); Android resolves `""` too (`ClipboardModule.kt:27-41`). `index.js` exposes
`Clipboard` through a lazy getter that prints a deprecation notice once with
`warnOnce('clipboard-moved', ...)` (lines 239-247).

**Vibration** (`Libraries/Vibration/Vibration.js`) calls `NativeVibration.vibrate` for a
number. For an array and any platform other than Android it schedules the pattern in
JavaScript, one `vibrate(400)` per step (`vibrateByPattern`/`vibrateScheduler`, lines
19-61, 77-98). `cancel()` only calls the native module outside iOS and does not touch the
JavaScript state (106-111): a repeating pattern keeps running, and the next `vibrate()` is
ignored while `_vibrating` stays set (lines 90-92). That is RN's own behavior; the host
neither causes nor fixes it. `vibrateByPattern` is Android's native call and
unreachable from this module with `Platform.OS` `"godot"`.

All three native specs are generated in
`React/FBReactNativeSpec/FBReactNativeSpecJSI.h`, as CRTP classes like `NativeAppStateCxxSpec`:
`NativeClipboardCxxSpec` (line 2333), `NativeLinkingManagerCxxSpec` (3810) and
`NativeVibrationCxxSpec` (5453). The generated bridge converts every argument before the
module runs, so `setString(undefined)` fails there with `Value is undefined, expected a
String`. A C++ TurboModule emits device events through
`TurboModule::emitDeviceEvent` (`ReactCommon/react/nativemodule/core/ReactCommon/TurboModule.cpp:42-62`),
which queues `RCTDeviceEventEmitter.emit` on the call invoker, and settles promises with
`AsyncPromise` (`ReactCommon/react/bridging/Promise.h`).

## What this host did

None of the three names was exported and no native module existed. The compatibility
audit listed them as `missing_public_export` and the roadmap assigned them to GF-23.

## What Godot offers

- `OS.shell_open(uri) -> Error` opens a URI with the system handler. On macOS the
  pinned engine returns `OK` whatever the handler does, and it assumes `file://` for a
  string without a scheme, so a scheme-less string is never given to it. It is
  synchronous: there is nothing to cancel in flight.
- There is no query for installed handlers, so `canOpenURL` cannot be answered by the
  platform.
- `DisplayServer.clipboard_get`, `clipboard_set` and `has_feature(FEATURE_CLIPBOARD)`
  (feature 5). The headless DisplayServer reports `has_feature` as `false` and logs an
  engine error from `clipboard_get`, which the runner rejects; availability is therefore
  checked before every call. The probe asserts the headless fact (`DisplayServer.has_feature(5)`
  is `false`) before its real-backend checks.
- `Input.vibrate_handheld(duration_ms, amplitude)` is a silent no-op on desktop, takes a
  duration only (no pattern, no repeat) and has no cancel and no capability query. The
  probe's real-backend application calls it and `cancel` and sees no error or log line.
- macOS LaunchServices puts `--uri="..."` in `OS.get_cmdline_args()` when a URL
  launches the application; the engine emits no event for a URL that arrives while it
  runs.
- `OS` is already in `native/godot-profile.json`; `DisplayServer` and `Input` are not, so
  they are called through `Engine::get_singleton()->get_singleton(...)->call(...)`, as
  `native/fabric_application.cpp` already does for the display. The class profile is
  unchanged.

The Godot behaviors above come from the pinned engine's documentation and the source
that the design relied on, plus what the probe executes in headless Godot 4.7.2
(the clipboard feature, the silent vibration, the launch argument). The suite never
calls `OS.shell_open` or the real pasteboard: every application that opens a URL or
touches the clipboard has its backend replaced by a recording stand-in.

## The contract

One owner, `DeviceServices` (`native/device_services.{h,cpp}`), belongs to each
`FabricApplication`, is shared by every root of its runtime and installs three C++
TurboModules in the application's registry with `registry.add(name, factory, dispose)`,
as `Networking::install` does. A pure core (`native/device_services_core.h`: URL rules,
launch arguments, the backend seam and the counters) needs neither Godot nor RN and has
its own test (`native/device_services_core_test.cpp`, built as `device_services_core_test`).
`native/godot_device_backend.{h,cpp}` is the Godot backend.

1. **Linking is iOS's `LinkingManager`.** That is the contract `Linking.js` takes when
   `Platform.OS` is not `"android"`. Clipboard and Vibration use their neutral specs.
2. **Backend seam.** The services take a struct of functions, `open_url`,
   `clipboard_available`, `clipboard_get`, `clipboard_set`, `vibrate` and
   `cancel_vibration`. The default is Godot's. A validation run sets the application's
   `validation_device_services` meta to a Dictionary of Callables keyed by those names,
   and only the keys present replace the Godot function (the pattern of the other
   `validation_*` metas in `native/fabric_application.cpp`). A key whose Callable is no
   longer valid is a backend that refuses, never the real one. The Callable `open_url`
   returns a Godot `Error` as an int (0 opens).
3. **`canOpenURL`** resolves `true` if and only if its string is an absolute URL with an
   RFC 3986 scheme (`ALPHA *(ALPHA / DIGIT / "+" / "-" / ".")`, then `:`) and at least one
   character after the colon, and `false` otherwise. It does not ask the platform. Because
   the scheme alone decides, `c:\file` is a URL with scheme `c`, and there is no block list.
4. **`openURL`** rejects `Unable to open URL: <url>` without calling the backend when the
   string has no valid scheme, rejects the same message when the backend refuses (an
   `Error` other than `OK`, or a validation Callable that returns one) and resolves `true`
   otherwise, as iOS does. A non-string or the empty string never reaches native code: RN's
   own invariant throws first.
5. **`openSettings`** rejects `Unable to open app settings: unavailable on Godot`. It never
   resolves in silence.
6. **`getInitialURL`** resolves the first valid `--uri=<url>` of
   `OS.get_cmdline_user_args()` and, failing that, of `OS.get_cmdline_args()`, or `null`.
   One pair of single or double quotes around the value is removed, and a value without a
   scheme is not a launch URL. The value is read when the application is created and stays
   the same for its life, whatever links arrive later.
7. **`FabricApplication.deliver_url(url: String) -> bool`** is how a platform hands a deep
   link to the running application, and the entry point a future mobile plugin
   (GF-34/35, outside this slice) would call. It emits Linking's `url` event with `{url}`
   once on the application's one `RCTDeviceEventEmitter`, so every listener of every root
   hears it exactly once, in subscription order. It returns `false` and emits nothing for a
   string without a scheme and for an application that has stopped. If no `LinkingManager`
   module exists yet (JS never read `Linking`) the link is accepted and counted apart
   (`urlsUnobserved`): there is no JS listener to carry it to, and nothing is buffered for a
   later one.
8. **An unavailable clipboard is an error.** `getString` rejects and `setString` throws
   `E_CLIPBOARD_UNAVAILABLE: this display server has no clipboard` where the DisplayServer
   has no clipboard feature (the headless engine), with no engine error in the log. With a
   clipboard, an empty one resolves `""`, as iOS and Android do. The reason: the GF-04
   rule against accepting an operation in silence.
9. **Vibration.** `vibrate(ms)` calls `Input.vibrate_handheld(ms)` for a finite,
   non-negative `ms` and throws `E_ARGUMENT` otherwise. `cancel()` reaches the backend,
   and Godot's backend has nothing to cancel, so it is a no-op that the stand-in records.
   `vibrateByPattern`, which RN's JavaScript never calls with this platform, throws
   `E_UNSUPPORTED` if a retained module is called directly. The hazard above is retained
   as RN's normative behavior, with a probe case that demonstrates it.
10. **Lifecycle.** The modules are created by the first read of their public API. A stop
    of the application makes retained methods throw `E_MODULE_DISPOSED` synchronously (as
    `AppState` does: nothing is pumped after a stop), makes `deliver_url` return `false`,
    drops every queued event and promise settlement and never calls the backend again.
    Unmounting one root leaves the services to the other.

Module construction, promises and events are RN's. The three modules share one
`StoppableInvoker` (`native/stoppable_invoker.h`, which the networking modules use too), so an event
or a settlement queued before a stop and run after it is dropped and counted. `src/device-services.js` is a CommonJS
module of three getters, like `src/app-state.js`, so importing `react-native` constructs
none of the three modules and a host without them fails only where an API is read; the
`Clipboard` getter prints RN's deprecation notice once per application's runtime, as `index.js`
does, through `console.warn`, which the host prints as an ordinary log line.

## Why the probe is discriminating

Application A has the validation backend, which records every call
(`["open", url]`, `["get"]`, `["set", text]`, `["vibrate", ms]`, `["cancel"]`), and two
roots. It covers laziness (no module before the first read of its API), the clipboard
(ASCII, multibyte text with an astral emoji and a combining mark, line breaks including
CRLF, the empty string, overwrite, an outside change, set and get in one JavaScript turn,
the bridge failure of `setString(undefined)`, an unavailable clipboard),
Linking (`canOpenURL` for valid and invalid URLs, `openURL` with a refusing backend, a
scheme-less string and RN's own invariants, `openSettings`, `sendIntent`, `getInitialURL`
from a real `--uri=` argument), deep links (one emission per listener across a library
subscription and two roots, order, invalid links, removing a subscription twice, unmounting
a root), Vibration (default, number, the pattern `[0, 100, 50, 100]` as four ordered
calls, cancel, RN's own argument error, native argument errors, direct `vibrateByPattern`)
and the repeat hazard, then a stop with retained modules. The pattern checks judge order
and counts, never time. Application R keeps the real Godot backend (its `open_url` alone
is a failing stand-in): in headless Godot the clipboard reports `E_CLIPBOARD_UNAVAILABLE`,
vibration is a no-op and `getInitialURL` reads this very process's argument. A second
launch of the probe without `--uri=` shows `null`.

The [oracle](../../tests/device-services-oracle.mjs) replays the commands each step ran
against a model written from RN's rules (the JavaScript invariants, `Vibration.js`'s
scheduler and `_vibrating`, one `url` emission per listener) and compares the calls, the
backend log, the events and the host's counters with it, without trusting the probe's own
checks (the test feeds it a report whose checks were all marked passed).

The preceding host runs the same bundle: both applications mount and stop, reading
`Clipboard` or `Vibration` fails with `getEnforcing`'s `'Clipboard' could not be found`,
`Linking` loads but its methods fail with `nullthrows`, and the host has no `deliver_url`.
It fails exactly the checks that need the native services and passes the structural ones.
Two retained sabotages, a host that emits `url` twice for each link (as a per-root emission
would with two roots) and a `getString` that answers from a stale cache, are rejected.

## Limitations

- **`canOpenURL` does not know installed handlers.** Godot has no API for it, so a URL with
  a valid scheme resolves `true` even if nothing on the machine handles that scheme.
- **`openURL` cannot be cancelled** and does not tell whether a handler took the URL:
  `OS.shell_open` is synchronous and, on macOS, reports `OK` for any URL it is given.
- **A vibration cannot be cancelled** in Godot; patterns are RN's JavaScript scheduler
  calling `vibrate(400)`, whatever the durations in the array say, as on iOS.
- **Deep links while the application runs** exist only through `deliver_url`: the engine
  emits no event. A launcher that starts the process with `--uri=` is covered by
  `getInitialURL` only on the platform that passes the argument.
- **A deep link before JS reads `Linking`** reaches no listener and is not replayed.
- **`openSettings` and `sendIntent` always reject.**
- **The real pasteboard, a real browser and real vibration are not exercised**: the suite
  replaces every backend that could touch them.

## Remaining scope

Still open under GF-23: `Alert`, `Share`, `Settings` and `BackHandler` (they depend on the
open V2-D30 decision and on the Modal work of GF-18), mobile deep-link plugins (GF-34 and
GF-35), Windows and Linux, a cancellable `openURL`, capability-aware `canOpenURL`, vibration
patterns and cancellation through a platform plugin, and real-device runs. The roadmap and
the dashboard are updated after the implementation commit.
