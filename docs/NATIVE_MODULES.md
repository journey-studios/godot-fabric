# Native modules and refs checkpoint

Godot Fabric installs original RN `TurboModuleBinding` before evaluating the
bundle. Its registry owns providers, lazy instances and shutdown per Hermes
runtime. RN supplies `RuntimeSchedulerCallInvoker`, TurboModule host objects,
generated specs, the native Promise bridge and typed async event emitter.
The facade exposes original NativeModules, TurboModuleRegistry and
NativeEventEmitter through public `react-native` imports.

```jsx
import { TurboModuleRegistry, NativeEventEmitter } from "react-native";

const module = TurboModuleRegistry.getEnforcing("GodotFabricNativeFixture");
const answer = module.add(19, 23);
const asyncAnswer = await module.addAsync(19, 23);
const typed = module.onValue(value => console.log(value));
const legacy = new NativeEventEmitter(module).addListener(
  "GodotFabricNativeFixture.value", value => console.log(value),
);
typed.remove();
legacy.remove();
```

The fixture provider is enabled only in `refs` and native-module validation.
It is a C++ provider example, not a production game service. Missing modules
use original get/getEnforcing behavior; native exceptions reach JavaScript.
Promises, events and callable modules execute through the owning RN scheduler.
Subscription removal is idempotent. Shutdown invalidates authority before
dropping caches, clears RN long-lived objects and retains native host objects
until VM destruction so extracted methods fail safely.

`FabricApplication.invoke_callable(name, method, args)` is the validation
host's native-to-JS path. It uses original registerCallableModule factories,
lazily creates a module and copies JSON-compatible arguments. It is not the
planned public GodotFabric game-service API.
Re-registering a callable preserves the first factory or resolved module,
matching the original ReactInstance; it does not replace an active module.

Bootstrap modules use generated specs: SourceCode reports the actual evaluated
bundle URL; DeviceInfo supplies window/screen constants; the feature flag
module is original pinned C++. NativeDOMCxx inherits original RN DOM behavior,
adds Godot window projection and guards retired-document comparisons. Refs
are original RN elements/documents/text instances, with existing Godot control
commands added. The renderer proxy loads the original CJS renderer lazily:
eager loading starts a public-instance initialization cycle, while named
export copying loses methods populated later. Both laboratory and external
consumer entry orders must reach the same completed renderer exports.

The [networking record](evidence/networking/README.md) registers three more C++
TurboModules in the same registry: `Networking` (RN's generated Android spec), `BlobModule`
and `FileReaderModule`, created when JS first asks for them. They share one application
state: a blob store, one stoppable call invoker (so every device event and promise
settlement leaves through the RN scheduler in order and is dropped after the stop) and a
transport over Godot's `HTTPClient` that the runtime polls on each frame. Stopping the
application cancels the requests in flight, releases the blobs and makes retained methods
fail with `E_MODULE_DISPOSED`. The bundler plugin aliases RN's `RCTNetworking` to its
Android wrapper; the `react-native` facade exports no `Networking`.

The [WebSocket record](evidence/websocket/README.md) registers a fourth, `WebSocketModule`
(RN's generated Android spec), in its own translation unit (`native/websocket_module.cpp`)
over the same application state (`native/networking_state.h`): it queues its events through
the same stoppable invoker, keeps the phase of every socket that has not ended, and also
implements the socket hooks of `BlobModule` (binary messages as blobs in the shared store, a
blob sent as one binary message). Godot `HTTPClient` owns asynchronous DNS/TCP/TLS setup; the
transport retains its public `StreamPeer` connection and uses pinned wslay for WebSocket
framing. A WebSocket poll shares a 1 MiB inbound wire-byte budget across WebSocket connections;
its 256-event admission cap uses canonical pending networking-event capacity after the HTTP poll,
with slots reserved for incomplete messages across polls. Stopping the application attempts a
nonblocking 1001 close, forgets the sockets and makes retained methods
fail with `E_MODULE_DISPOSED`; nothing reaches JS afterwards. Close-frame delivery during
cancellation is best effort when input remains unread. The hosted native suite passed for pinned
head `422c2ee` ([receipt](evidence/websocket/hosted-ci.json)); later PR-head changes require a
new green run. See the [WebSocket evidence](evidence/websocket/README.md) for local and hosted
proof and target limits.

The device services register three more C++ TurboModules, `LinkingManager` (RN's generated
`NativeLinkingManagerCxxSpec`, the iOS contract `Linking.js` takes when `Platform.OS` is `"godot"`),
`Clipboard` and `Vibration`, created when JS first reads their public API, from one `DeviceServices`
owned by each `FabricApplication` (`native/device_services.{h,cpp}`) and shared by its roots. Each
promise settlement and the `url` event leave through RN's scheduler on a stoppable call invoker, so a
stop drops what was queued; retained methods then throw `E_MODULE_DISPOSED` synchronously, and
`FabricApplication.deliver_url` returns `false`. The platform calls (`OS.shell_open`, the
`DisplayServer` clipboard, `Input.vibrate_handheld`) are a backend struct that the validation meta
`validation_device_services` can replace per function. `LinkingManager`: `getInitialURL` resolves the
launch `--uri=` or `null`, `canOpenURL` the scheme rule, `openURL` `true` or `Unable to open URL:
<url>`, `openSettings` always rejects; `addListener` and `removeListeners` are no-ops. `Clipboard`:
`getString` and `setString` fail with `E_CLIPBOARD_UNAVAILABLE` where the DisplayServer has no
clipboard. `Vibration`: `vibrate(ms)` for a finite, non-negative duration (`E_ARGUMENT` otherwise),
`cancel()` to the backend and `vibrateByPattern` refused with `E_UNSUPPORTED`. See the [research
note](research/device-services.md).

AccessibilityInfo registers one more C++ TurboModule, `AccessibilityManager` (RN's generated
`NativeAccessibilityManagerCxxSpec`, the iOS contract `AccessibilityInfo.js` takes when `Platform.OS` is `"godot"`),
created when JS first imports `AccessibilityInfo.js` (RN's Android `AccessibilityInfo` module is not installed and its
lookup returns `null`), from one `AccessibilityInfo` owned by each `FabricApplication`
(`native/accessibility_info.{h,cpp}`) and shared by its roots. Its constructor takes the baseline reading of the four settings
Godot's `DisplayServer` can report (the screen reader, reduce motion, reduce transparency and increase contrast), and
`ApplicationRuntime`'s pump reads them again once per frame, before it drains the queued work, because Godot has no change
signal; a reading is an integer, and a method the `DisplayServer` lacks or a non-integer answer is unknown (`-1`), never off.
A getter calls its success callback with the last reading, or its error callback with an `Error` whose message starts
`E_ACCESSIBILITY_UNKNOWN` when the platform reports `-1`; the four settings Godot cannot read (bold text, grayscale, inverted
colors, cross-fade) call it with `E_ACCESSIBILITY_UNAVAILABLE`. A change is a known value that differs from the last known one
and leaves as a device event (`screenReaderChanged`, `reduceMotionChanged`, `reduceTransparencyChanged`,
`darkerSystemColorsChanged`) through RN's scheduler on the same stoppable call invoker as the device services, so a stop drops
what was queued; retained methods then throw `E_MODULE_DISPOSED` synchronously, for all twelve. The readings are a backend
struct that the validation meta `validation_accessibility_settings` can replace per setting.
`setAccessibilityContentSizeMultipliers` validates its argument (`E_ARGUMENT`) and throws `E_UNSUPPORTED`; `setAccessibilityFocus`
throws `E_UNSUPPORTED` with the reason (Godot has one focus, so moving the screen reader's would blur the keyboard's), and so does a
`focus` event of the `UIManager`; its accessibility events of any other type are ignored and counted by type.
`announceForAccessibility` and `announceForAccessibilityWithOptions` are announced through AccessKit (the post to AppKit is proven, the audible speech is not verified): the `Announcer`
(`native/accessibility_announcement_core.h`, pure, with a core test of its own) keeps each announcement until the accessibility update
that `FabricApplication` receives as `NOTIFICATION_ACCESSIBILITY_UPDATE` and publishes it there as a new static text element under the
application's own element, with the text as its value and `LIVE_POLITE` (`LIVE_ASSERTIVE` for `priority: 'high'`), then frees it
outside the update after it, one announcement per update in the order they were asked for; `queue: true` and `priority: 'low'` throw `E_UNSUPPORTED`, an option of the wrong type `E_ARGUMENT`, and
with no screen reader (or an application with no element) the call returns and the announcement is dropped and counted, never kept
for a screen reader that turns on later. The engine's `AccessibilityServer` is called by name through
`native/accessibility_announcer.{h,cpp}`, whose names are asked of the ClassDB, and a validation run replaces it by a recorder with the
`validation_accessibility_announcer` meta. `announcementFinished` never fires. See the [research
note](research/accessibility-info.md) and the [announcements note](research/accessibility-announcements.md).

The OS-specific APIs (`ToastAndroid`, `PermissionsAndroid`, `ActionSheetIOS`, `PushNotificationIOS`,
`StatusBar` and the rest of the [OS-specific contracts](research/os-contracts.md)) add **no native
module**, and their absence is the contract. RN looks the modules up by name (`ToastAndroid` with
`getEnforcing`, `PermissionsAndroid`, `ActionSheetManager`, `DialogManagerAndroid` and
`PushNotificationManager` with `get`, `StatusBarManager` with `getEnforcing`). The host registers none
of the six: `TurboModuleRegistry.get` returns `null` and `getEnforcing` throws `'<name>' could not be
found`, which the original JavaScript turns into its own warning, resolved value or error. The
adapter manifest reserves the six names as host core, so a native extension cannot register one
to make an API look supported. See the [OS-specific APIs](API.md#os-specific-apis) contract.

## Original logical tree and IDs

The later [tree checkpoint](evidence/tree/README.md) adds View `id`/`nativeID`,
Text `nativeID`, root-scoped document lookup, original read-only traversal and
snapshot collections. It reuses this native host and original DOM implementation.
It also records pinned RawText replacement/null document behavior and the
children-only commit that keeps an imperatively changed native ID, as RN's JS thread
holds the clone `setNativeProps` committed (the record's executed files observed the
opposite before the Animated slice and stay as history).
Public refs expose the Fabric logical hierarchy, which can differ from Godot
Control parenting. Full HostInstance/focus/commands and mobile differentials
remain separate acceptance work.

## Geometry and environment boundary

Fabric/Yoga points correspond to Godot Window content coordinates. Scalar
pixel density comes from uniform content scaling, also applied to Yoga pixel
rounding. OS screen scale is not substituted for this mapping. Window resize
and screen/density changes enqueue original didUpdateDimensions events.
Original RN Dimensions owns state and normalization; PixelRatio reads it.
The hook retains stable immutable snapshots. Updates continue with no public
hook/listener mounted.

Font scale is the current layout multiplier, 1. OS accessibility font settings,
safe insets, device-specific density policies and mobile behavior require
GF-09/GF-20 acceptance. Headless screen size remains its real zero size.
This checkpoint rejects nonuniform Window content scaling, embedded Windows,
viewport stretch, SubViewport surfaces, cross-window roots and live migration
between native Windows. Those contracts remain roadmap work.

A live unsupported metrics configuration records a visible diagnostic and
preserves the last valid Dimensions snapshot. Repeated equal failures do not
flood the log. React updates and cleanup continue; partial unmount and stop
must drain work even when metrics cannot be sampled. Shutdown skips metrics
sampling and invalidates the native module authority before VM destruction.

## Accessibility

The first GF-20 slice adds no TurboModule. The semantic tree is not a module: it
is the host component that every `View` mounts as (`GodotAccessibleView`, a `Panel`
that fills Godot's accessibility element from RN's props and answers the OS's
press), with the pure, Godot-free semantic core in
`native/accessibility_core.h` that a mobile bridge can consume. Its contract is
in the [research note](research/accessibility.md). `AccessibilityInfo`, the settings and
events of iOS's `AccessibilityManager`, is the first half of the second slice and is a
TurboModule (`AccessibilityManager`, above); announcements (and the reason programmatic focus stays refused)
are its second half. Godot's `AccessibilityServer` is reached by name through the engine's
singleton registry, since the binding profile does not include it.

## Validation and remaining work

```sh
npm run test:modules
npm run example -- refs --headless
npm run example -- refs --capture
npm run example -- metrics --capture
```

The [evidence](evidence/native-foundation/README.md) records execution and
graphical results. GF-08/GF-09/GF-25 remain in progress. External provider/codegen
packaging, versioned DTOs, game-service reads/operations/revisions, subscription
races, platform services and complete pinned ref/command behavior remain
required. The fixture does not make an iOS/Android binary portable to Godot.
