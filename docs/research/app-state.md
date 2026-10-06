# AppState from the Godot application lifecycle

Status: executed isolated macOS validation against pinned RN 0.87.1 and official
Godot 4.7.2. The [evidence](../evidence/app-state/README.md) owns the 75 headless
checks, the preceding-host control (the same bundle fails exactly its 62 normative
checks) and a retained sabotage of the state mapping. Hosted run 37382633328 repeated the 75 checks
with identical IDs and bundle ([receipt](../evidence/app-state/hosted-ci.json)).
Mobile exports and real OS focus changes are not certified.

## What RN does

`Libraries/AppState/AppState.js` is the whole public module. At construction it
reads `NativeAppState.getConstants().initialAppState`, subscribes its own
`appStateDidChange` listener that keeps `currentState` current, and reconciles
once through the asynchronous `getCurrentAppState`. Public events map to device
events: `change` to `appStateDidChange` (`{app_state}`), `memoryWarning` to
`memoryWarning`, and `focus`/`blur` to `appStateFocusChange` (a boolean). It
passes the native module to `NativeEventEmitter` only on iOS, so elsewhere
listeners register with `RCTDeviceEventEmitter` alone. The spec
(`src/private/specs_DEPRECATED/modules/NativeAppState.js`) requires the module
with `getEnforcing('AppState')`, and `index.js` exposes `AppState` through a lazy
getter, so importing `react-native` never constructs it.

The two platforms disagree:

- **iOS** (`React/CoreModules/RCTAppState.mm`) has three states from
  `UIApplicationState`. `WillResignActive` reports `inactive`,
  `WillEnterForeground` still reports `background`, and `DidEnterBackground`/
  `DidBecomeActive` report the current state. It sends `appStateDidChange` only
  when the state differs from `_lastKnownState` (initially nil), sends
  `memoryWarning` without a body, captures `initialAppState` in `initialize` and
  never sends focus events.
- **Android** (`ReactAndroid/.../appstate/AppStateModule.kt`) has two states:
  `onHostResume` sends `active` and `onHostPause` sends `background`, every time.
  Window focus changes send `appStateFocusChange`. `onHostDestroy` deliberately
  sets no state and sends nothing, and `addListener`/`removeListeners` are no-ops.

A C++ TurboModule emits device events with `TurboModule::emitDeviceEvent`
(`ReactCommon/react/nativemodule/core/ReactCommon/TurboModule.cpp`), which queues
`RCTDeviceEventEmitter.emit` on the JS invoker; `AnimatedModule` does the same.
The generated `NativeAppStateCxxSpec` and its payload bridging are in
`React/FBReactNativeSpec/FBReactNativeSpecJSI.h`.

## What this host did

`src/platform-environment.js` exported a fixed object: `currentState` was always
`active`, only `change` could be subscribed, and nothing native fed it. The SDK's
`disposeEnvironment()` then set `inactive` and called every listener, a
transition neither RN platform ever reports on teardown.

## What Godot reports

The platform layers call `MainLoop.notification()` on the running main loop, and
`SceneTree::_notification` propagates `NOTIFICATION_APPLICATION_FOCUS_IN/OUT`,
`NOTIFICATION_APPLICATION_PAUSED/RESUMED` and `NOTIFICATION_OS_MEMORY_WARNING` to
every node (`scene/main/scene_tree.cpp`, tag `4.7.2-stable`).

- **Desktop** sends application focus only: macOS on `applicationDidResignActive`/
  `applicationDidBecomeActive`, Windows on `WM_ACTIVATEAPP`, X11 when every
  window has lost focus for 250 ms. Godot's documentation lists PAUSED/RESUMED as
  Android and iOS only, and the memory warning as iOS only.
- **iOS** (`drivers/apple_embedded/app_delegate_service.mm` and
  `os_apple_embedded.mm`) sends FOCUS_OUT on `WillResignActive`; PAUSED on
  `DidEnterBackground`; FOCUS_IN then RESUMED on `WillEnterForeground`; nothing
  more on `DidBecomeActive`; and the memory warning.
- **Android** (`GodotGLRenderView.java`, `GodotRenderer.java`,
  `java_godot_lib_jni.cpp`) sends FOCUS_OUT then PAUSED from `Activity.onPause`,
  and FOCUS_IN on `onResume` with RESUMED on the next drawn frame.

Godot's `Input` starts with `application_focused = true` (`core/input/input.h`)
and changes it only on these notifications.

## The mapping

One `AppLifecycle` belongs to each `FabricApplication`, and every root of its
runtime reads it through one native `AppState` module:

- **State.** `background` while paused, otherwise `inactive` while the
  application is unfocused, otherwise `active`. On iOS this reproduces
  RCTAppState's sequence exactly: resign is `inactive`, background is
  `background`, and the foreground pair (FOCUS_IN while still paused, then
  RESUMED) yields one `active`. A desktop application that loses focus to
  another one stays in the foreground without receiving events, which is iOS's
  definition of `inactive` and the state Godot's own FOCUS_OUT means on iOS. A
  desktop host has no `background`, because Godot reports no pause there.
- **Changes.** `appStateDidChange` is sent only for a new state, as iOS does.
  The source starts from the state it was created in, so it never repeats
  `active` the way iOS can at launch or Android does on every resume.
- **Focus.** Every actual change of application focus sends
  `appStateFocusChange`, as Android does for window focus; iOS never sends it.
  The state event comes first, so focus and blur listeners read the new state.
- **Memory.** Every memory warning sends `memoryWarning` without a body.
- **Constants and queries.** `initialAppState` is the state when the module is
  created, like iOS's `initialize`, including notifications the application
  received before its runtime existed. `getCurrentAppState` answers through RN's
  `AsyncCallback` and never calls the error callback, as on both platforms.
  `addListener` and `removeListeners` are Android's no-ops.
- **Teardown.** Stopping the application disposes the module: it releases its
  observer and sends nothing, like Android's `onHostDestroy` and iOS
  invalidation. Later notifications are counted but never emitted, and a
  retained method fails with `E_MODULE_DISPOSED`. `disposeEnvironment()` no
  longer invents `inactive`: it removes the AppState device listeners, as
  destroying the VM would, and `currentState` keeps its last native value.
- **Game pause.** `SceneTree.paused` is not the application lifecycle (V2-D11):
  the FabricApplication always processes, so a paused game keeps delivering
  AppState events.
- **Laziness.** ESM exports cannot be getters, so `src/app-state.js` is a
  CommonJS getter that preserves `index.js`'s laziness and returns RN's original
  instance. A bundle that never reads AppState still runs on a host without the
  module, which keeps the preceding hosts of earlier slices able to replay new
  bundles; a host without it fails exactly where AppState is first read.

Android consumers see one deviation: Godot sends FOCUS_OUT before PAUSED, so a
Godot Android export reports a transitional `inactive` before `background`, a
state RN's Android module never produces. iOS consumers see `focus`/`blur`,
which RN's iOS module never sends.

## Why the probe is discriminating

The [probe](../../tests/app-state-probe.gd) calls `notification()` on the actual
main loop, the call the platform layers make, so SceneTree propagates each
notification to the actual FabricApplication as for an OS event. Two roots and a
library-style subscription made at bundle evaluation observe the public
`react-native` AppState. Focus leaves before the bundle loads, so the module must
start `inactive`. The steps cover focus in and out, a repeated notification, a
memory warning, Godot's mobile background and foreground pairs, pause while
focused, focus loss while paused, resume while unfocused, a paused game tree,
subscription removal, a root's unmount and the application's stop. The
[oracle](../../tests/app-state-oracle.mjs) re-derives every event, listener
order, state and native counter from RN's rules and the fixture's own
subscription records.

On the preceding host the same bundle mounts both roots and stops cleanly, but
the first read of AppState fails with `getEnforcing`'s `'AppState' could not be
found`: it fails exactly the 62 checks that need the native lifecycle. A host
whose focus outranks the pause fails 5 checks, where focus and pause interact,
and the oracle rejects its report.

## Remaining scope

Window minimization and occlusion (Godot sends no lifecycle notification for
them on desktop), real OS focus on hardware, Godot Android and iOS exports,
Appearance and `useColorScheme`, device configuration, multi-window focus
semantics and resume with pending timers, network or animations remain open
under GF-21. NativeWind's css-interop applies Appearance changes only while
AppState is `active`, so a headed desktop run without focus defers a manual
theme change until focus returns, as RN does on iOS.
