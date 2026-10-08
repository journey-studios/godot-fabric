# React Native parity audit

Audit date: **2026-10-01**. Runtime source: public main
[`72d2bc6`](https://github.com/journey-studios/godot-fabric/tree/72d2bc6d7a10fd90dfea53754cf405ff5c75e5da).
Target baseline: **React Native 0.87.1 / React 19.2.3 / Hermes 250829098.0.17**,
with official **Godot 4.7.2**. The npm `latest` tag was checked on the audit date;
0.87.1 is the current stable baseline. Upgrade decisions must recheck the
[upstream release policy](https://reactnative.dev/releases/).

The renderer already runs original ReactFabric, Hermes and Fabric inside
Godot. The remaining work is primarily the platform host contract, public API,
system integration, developer tooling and distributable builds. The
[roadmap](../ROADMAP.md) owns live work status; this document records the dated
audit and the meaning of parity.

## Subsequent checkpoint — 2026-10-02

Public Button and single-line TextInput now have a typed TSX form, native
editing/ref/activation checks and explicit unsupported-prop errors. The
[API](API.md), [live status board](compatibility/BASELINE.md) and
[public control evidence](evidence/public-controls/README.md) describe that
bounded implementation. The tables below and their machine-readable 97-name
audit remain the original 2026-10-01 snapshot; they must not be read as current
export counts. Full types/props, mobile editing and differential certification
remain open in GF-03/GF-04/GF-12/GF-17.

The bounded GF-05 runtime implementation and its 13-case original-native
comparison are recorded in [the runtime example](evidence/runtime/README.md).
The tables below preserve the audit-date findings.

## Subsequent checkpoint — 2026-10-03

The [native foundation evidence](evidence/native-foundation/README.md) adds
original public refs/NativeDOM, original TurboModuleBinding and generated
bootstrap modules, plus original Dimensions/PixelRatio with live Godot content
metrics. Module lifetime, callable re-registration, stale refs and rejected
metrics cleanup have native acceptance tests. The external consumer also runs
with the new original public-instance initialization path.

GF-08/GF-09/GF-25 remain in progress: this checkpoint does not complete the
full public contracts or typed game-service operations/revisions. The
[iOS build evidence](IOS_BUILD.md) starts GF-31 with device/simulator build,
link and packaging only; Godot consumer export and runtime proof remain open.
The audit-date tables below remain historical.

The bounded GF-07 [shared application](evidence/shared-roots/README.md) adds
original AppRegistry/RootTagContext, distinct native roots, prop updates and
independent unmount/remount over one runtime. Native positive/negative checks
and captures exercise two nonoverlapping roots; full bootstrap, portals,
pause/resume, SDK activation and original RN multi-root comparison remain open.

The [2B independent consumer](evidence/consumer/README.md) now provisions a
Resource/scene/editor prototype with private tools, project-owned TSX and
dependencies, protected React identity and offline/no-global-Node build checks.
Its native roots/props/state/lifecycle and captures are separately validated.
This advances GF-28/GF-29 without closing their complete SDK/export/dev-tool or
per-target acceptance; pending V2 decisions retain their status.

## Subsequent checkpoint — 2026-10-06

The public facade now exports **56 names awaiting differential certification and 3
explicit placeholders** (KeyboardAvoidingView, RefreshControl and StatusBar) and omits 38
of the 97 root values, as `npm run parity:status` counts them; Linking, Clipboard and Vibration
(the first slice of GF-23), Modal and SafeAreaView (the Modal slice), AssetRegistry with Image and
ImageBackground (the Image slice, which also took those two out of the placeholders), and
ToastAndroid, PermissionsAndroid, DynamicColorIOS, ActionSheetIOS, ProgressBarAndroid,
DrawerLayoutAndroid, InputAccessoryView, PushNotificationIOS and TouchableNativeFeedback (the first
slice of GF-24) are the seventeen names added to the 39 and subtracted from the 53 of 2026-10-06. The [live status board](compatibility/BASELINE.md)
keeps those counts and a per-area table of the evidence below. The tables further
down and the machine-readable [97-name audit](compatibility/react-native-0.87.1.json)
remain the 2026-10-01 snapshot, except the three GF-23 entries and the nine GF-24 entries
now updated (5 usable components, 20 environment names, 14 unavailable names and 58
missing), and must not be read as current counts.

Since the 2026-10-03 checkpoint these slices ran on macOS arm64 over original RN
source, each with retained negative controls and a hosted CI run that repeated its
headless checks (the [evidence index](evidence/README.md) lists every record and receipt):

- **Environment:** the original [AppState](evidence/app-state/README.md) (75 checks),
  fed by Godot's application lifecycle, and [Appearance and
  useColorScheme](evidence/appearance/README.md) (79), fed by its system theme.
- **Accessibility settings:** the original [AccessibilityInfo](research/accessibility-info.md) (GF-20's
  second slice, part a), over a C++ TurboModule and Godot's `DisplayServer`: the screen reader, reduce motion,
  reduce transparency and increase contrast, read once per frame, with the events of their changes; bold text,
  grayscale, inverted colors and cross-fade reject as unavailable, and announcements and programmatic focus wait
  for the slice's second part. A headless probe in two applications with an independent oracle, the preceding host
  as the control and three retained sabotages; its hosted CI run is pending.
- **Input:** the original [PanResponder](evidence/pan-responder/README.md) (128 checks
  in four flag lanes), the [shared touches](evidence/shared-touches/README.md) (92)
  that let the roots of one application share RN's single responder, and the
  [capture notifications](evidence/pointer-capture-notifications/README.md) (672),
  next to the View and Document pointer matrices (up, move, hover, click) whose
  public flags stay off.
- **Components:** the original [Switch](evidence/switch/README.md) (108),
  [ActivityIndicator](evidence/activity-indicator/README.md) (33),
  [touchables](evidence/touchables/README.md) (93) and [lists](evidence/virtualized-list/README.md)
  (44: FlatList, SectionList, VirtualizedList and VirtualizedSectionList).
- **Animation and transforms:** the original [Animated](evidence/native-animated/README.md)
  over RN's C++ Native Animated (75), RN's uniform [scale](evidence/uniform-scale/README.md)
  (29) and [singular transforms](evidence/singular-transforms/README.md) (49) on
  planar Controls, and the [frame clock](evidence/frame-clock/README.md) (37) that
  paces `requestAnimationFrame` and the native animation like a display link.
- **Runtime globals:** RN's own web-standard globals, installed by the host's
  initialization and backed by native networking: the original
  [fetch, XMLHttpRequest, FormData, Blob, FileReader and AbortController](evidence/networking/README.md)
  (100 checks against a local server over HTTP and HTTPS; its hosted CI run is pending), and
  the original [WebSocket](evidence/websocket/README.md) over Godot `HTTPClient`'s public
  `StreamPeer` connection and pinned wslay (95 local product checks, 60 server connections,
  53 required wire/JS comparisons; 1 MiB inbound bytes across WebSocket sockets and a 256-event
  admission cap using canonical pending events after HTTP polling; all five hosted CI jobs passed
  for pinned head `422c2ee` ([receipt](evidence/websocket/hosted-ci.json)). The hosted parity job's
  13 `core-ui-v2` Android/iOS cases are not WebSocket differential or Godot mobile runtime proof;
  later PR-head changes require new green CI).
  They are globals, not names of the `react-native` root: they do not move the facade's counts,
  and RN's `Networking` export stays among the missing 48.
- **Device services:** the original [Linking, Clipboard and Vibration](evidence/device-services/README.md)
  over three native TurboModules and Godot's `OS.shell_open`, clipboard and `Input.vibrate_handheld`
  (GF-23's first slice; a headless probe in two applications with an independent oracle, the
  preceding host as the control and two retained sabotages; its hosted CI run is pending). Alert,
  Share, Settings and BackHandler, mobile deep-link plugins and real-device behavior stay open.
- **OS-specific contracts:** the original [ToastAndroid (its fallback), PermissionsAndroid, DynamicColorIOS,
  ActionSheetIOS, ProgressBarAndroid, DrawerLayoutAndroid (its fallback), InputAccessoryView, PushNotificationIOS
  and TouchableNativeFeedback](evidence/os-contracts/README.md), each on the branch RN takes off its own
  platform, with no host module (GF-24's first slice: reproduce the upstream unavailability; a headless probe in two
  applications with an independent oracle that reads every text, key and count from the pinned sources, the
  previous SDK as the control because the slice has no native code, and three retained sabotages; its hosted CI run
  is pending). `'denied'` and `false` from PermissionsAndroid mean unavailable on Godot. StatusBar stays a placeholder.
  The Android and iOS implementations, the OS-specific props and the OS-version comparison stay open, and so does the
  toolchain alias for the generic deep paths, which still resolve to `undefined`.

None of these is an original-native differential: the 13-case core-ui-v2
comparison with iOS and Android remains the only one. They complete no GF item
and add no weight or denominator; the first-slice checkpoints they closed are in
the [dashboard](../dashboard/README.md), and each record keeps its own open
boundaries (hardware, mobile exports, complete contracts). The audit-date tables
below preserve the findings of 2026-10-01.

## What 1.0 must mean

A supported application should import the stable public `react-native` API,
write React/JSX or TypeScript, and obtain the same applicable props, callbacks,
ref commands, state transitions and layout semantics as the pinned upstream
renderer. Godot supplies actual Controls and painters, OS services and exported
applications through a GDExtension. The official engine and export templates
remain unchanged.

Required targets are **macOS, Linux, Windows, Android and iOS**. Each needs
its own build, export and runtime evidence. Desktop equivalents need documented
behavior where upstream is mobile-specific; an iOS-only API must preserve its
upstream platform boundary. Shared APIs cannot be excused as “platform-specific”
when they are essential on the target. Experimental/unstable exports are
separately tracked; `unstable_batchedUpdates`, a compatibility API, remains in
the 1.0 target.

This does not imply identical pixels across different OS text engines, browser
DOM support, server rendering, or automatic compatibility with every native
library. Layout tolerances and permitted OS differences must be declared before
comparison. Kotlin/Swift/UIKit components still need a Godot backend or an OS
integration bridge. The extension contracts that make those ports possible are
part of 1.0.

## Evidence already available

| Layer | Implemented and retained evidence | Boundary still open |
| --- | --- | --- |
| React and reconciliation | Original production ReactFabric; hooks, effects, Context, memo, keyed identity, refs/cleanup, external stores, transitions, async Suspense, error boundaries and concurrent root | Dev renderer/StrictMode, the complete pinned React feature suite, root APIs and multiple surfaces are not certified |
| Fabric and Yoga | Original descriptors, ShadowTree, state, mounting transactions, EventEmitter/Queue/Beat; Controls created only from committed mounts | Full host-instance/DOM-node contracts, event priorities, surface lifecycle and arbitrary native component registration |
| View | Yoga constraints and supported layout/appearance on native Controls; accessibility name, hint, role, state, live region, hidden and the OS's press mapped to Godot's AccessKit tree (first GF-20 slice; macOS tree read through NSAccessibility) | Full styles/props, transform geometry, RTL, focus/keyboard, announcements (AccessibilityInfo's settings and events run; its announcements and focus do not), custom actions, grouping, text scale, Windows/Linux trees, mobile bridges (Godot 4.7.2 has none) and screen-reader speech |
| Text | Fabric attributed strings, virtual nested spans, variable font weights, wrapping, per-run color/spacing/line height and tail/clip truncation; `onTextLayout` and the Yoga baseline from the lines of the shaped paragraph, within one pixel of the bundled fonts' tables, with the preceding host failing exactly 5 checks and three retained sabotages rejected ([evidence](evidence/text-layout/README.md), [research](research/text-layout.md); hosted CI pending) | Selection/pressable spans, font scaling, bidi/emoji/grapheme clusters, font loading/fallback, full truncation/decoration, inline views and a reference measurement on iOS/Android |
| TextInput | Legacy single-line LineEdit probe; controlled/uncontrolled edits, event-count acknowledgement, UTF-16 selection and focus/ref commands | Public `react-native` export throws; multiline, real IME/virtual keyboard, undo and full mobile props need work |
| Pressable | Upstream Pressability and responder negotiation; transfer/refusal/cancel and supported callbacks | Physical input, keyboard/hover, pointer events, multitouch, hit geometry and accessibility focus/actions (its role, label, state and press props are mapped) |
| ScrollView | Original descriptor/state/emitter; native vertical/horizontal scroll, offsets/events, nonanimated commands and responder handoff | Every child mounts; inertia, virtualization, nested/multitouch, refresh/paging/snap and keyboard interactions |
| Styling/libraries | Original NativeWind compiler/runtime; supported utilities, responsive logical viewport, variables/manual theme; unmodified Chart Kit with the local SVG adapter | Complete RN styles, automatic system theme, general SVG and native library infrastructure |
| Runtime/build | Hermes JSI, monotonic animation frames, timers/microtasks and visible cleanup failures; pinned archive checksums and standalone native build | Production-only, one surface/main thread, narrow globals, macOS-arm64-only setup and no native hosted CI |

The [retained evidence](evidence/README.md) contains **764 passing assertions in
16 macOS runs**, plus contract, negative and recovery checks. These prove those
fixtures and modes. They are neither a percentage of RN compatibility nor new
runs performed for this documentation audit. Logical Viewport events do not
certify physical input, DPI, IME, assistive technologies or mobile behavior.
The hosted [Contracts workflow](../.github/workflows/contracts.yml) checks
JS/Python/compiler/static/publication contracts, not native rendering.

## Root public API inventory

The versioned [inventory](compatibility/react-native-0.87.1.json) enumerates
**97 runtime value exports** from RN 0.87.1's strict generated TypeScript root
entry. It records upstream/source hashes, facade status and one roadmap owner
for every name. [Reproduction and interpretation](compatibility/README.md)
explain the scope.

| Current public facade classification | Count | Meaning |
| --- | ---: | --- |
| Usable component subset | 5 | View, Text, Pressable, ScrollView, TouchableNativeFeedback; none certifies its complete upstream contract |
| Environment/utility subset | 20 | StyleSheet, Platform, Dimensions, PixelRatio, Appearance, AppState, AccessibilityInfo, I18nManager, useWindowDimensions, Linking, Clipboard, Vibration, ToastAndroid, PermissionsAndroid, DynamicColorIOS, ActionSheetIOS, ProgressBarAndroid, DrawerLayoutAndroid, InputAccessoryView, PushNotificationIOS |
| Exported but unavailable | 14 | TextInput, Image/ImageBackground, Switch, touchables, ActivityIndicator, StatusBar, FlatList, VirtualizedList, KeyboardAvoidingView, PanResponder, useColorScheme throw when used |
| Missing public export | 58 | Includes Button, SectionList, Modal, Animated, AppRegistry, Keyboard, Networking and module/codegen entrypoints |

The inventory assigns **84 exports to 1.0** and **13 experimental/unstable
exports to post-1.0 review**. These are scope assignments, not promises already
met. Deprecated stable exports retain the pinned upstream compatibility
behavior. Imports into the prototype's internal files are not a public API pass.
The next audit must expand beyond names to types, methods, props, styles, events,
commands and globals; even an exported utility can implement only one method.

## Verified gaps and risks to attack first

| Finding in current source | Consequence | Work owner |
| --- | --- | --- |
| Clean editor import crashed with signal 11; cached import passed; the font-only control passed | A first installation is unreliable. Cause remains unresolved; never hide it with retries | GF-02 |
| [`fabric.gdextension`](../fabric.gdextension) declares minimum 4.6, while the supported runtime requires 4.7.2 and uses `set_custom_maximum_size` | Metadata admits an older engine without a supported contract | GF-02 |
| [`react-native-platform.jsx`](../src/react-native-platform.jsx) exports unavailable TextInput; the implementation is only in [`components.jsx`](../src/components.jsx) | A tested native probe cannot be used through ordinary RN imports or NativeWind | GF-03, GF-12 |
| View drops `userSelect`; the valid-attribute schema narrows what reaches native nodes. The accessibility props the host maps are registered and checked (GF-20); the rest of RN's accessibility set (`accessibilityValue`, `accessibilityLabelledBy`, `accessibilityViewIsModal`, `accessibilityLanguage`, `focusable`) is still dropped like any unregistered prop | Some inputs are accepted without their promised behavior. Blanket “unsupported always throws” wording is inaccurate | GF-04, GF-10, GF-20 |
| [`appearance_adapter.cpp`](../native/appearance_adapter.cpp) reads left border color for all edges | Asymmetric borders need a reproducer and a corrected per-edge contract; this is source evidence, not a new visual test | GF-10 |
| [`platform-environment.js`](../src/platform-environment.js) uses manual theme, fixed active state/RTL policies; native metrics set scale/fontScale to 1 (AccessibilityInfo is now RN's original over the host's module) | Environment subscriptions can look complete while missing OS changes and font scaling; the accessibility settings Godot cannot read (bold text, grayscale, inverted colors, cross-fade) reject, and the four it can are not certified against real operating-system changes | GF-09, GF-20, GF-21 |
| [`private-interface.js`](../src/private-interface.js) supplies narrowed public instances/root refs and refuses public text instances/accessibility dispatch | Measurement, node traversal, commands and libraries relying on current host refs need parity tests | GF-08 |
| [`fabric_surface.cpp`](../native/fabric_surface.cpp) installs narrow globals, hardcodes surface 1, runs JS/Godot on the main thread | Multiple roots and real app lifecycle need design; networking/idle/timer contracts and scheduling cannot be assumed | GF-05, GF-07, GF-30 |
| [`native-modules.js`](../src/native-modules.js) is empty; [`bundle.mjs`](../scripts/bundle.mjs) aliases only selected modules and sets production mode | Upstream module availability does not translate to a Godot native implementation, typed SDK or working dev tools | GF-25, GF-26, GF-29 |
| [`setup.py`](../scripts/setup.py), [`CMakeLists.txt`](../native/CMakeLists.txt) and extension libraries only provide Darwin arm64/frameworks | Installing Godot on another OS cannot run this addon; each native port is a release gate | GF-31 through GF-36 |

Until these gaps are closed, fail explicitly for unsupported behavior and keep
failures observable. Do not replace real system values with success-shaped
stubs. Diagnostic guards are interim safety; they do not complete parity.

## Platform and library certification

| Target | Current evidence | Required before 1.0 support |
| --- | --- | --- |
| macOS arm64 | Official Godot 4.7.2; native subset validated, cold-import failure open | Clean install, packaged debug/release consumer, Retina/physical input/IME, lifecycle, accessibility (the View tree is read through NSAccessibility locally; screen-reader speech, AccessibilityInfo and focus are open) and system-service contracts |
| Linux x86_64 | No native build/runtime proof | Portable dependency build, exported consumer, display/input/scaling/IME/AT contracts and native CI |
| Windows x86_64 | No native build/runtime proof | MSVC/ABI/DLL packaging, exported consumer, focus/input/DPI/IME/AT contracts and native CI |
| Android arm64 | No native build/runtime proof | NDK/shared libraries/JNI and exported Gradle packaging, real device touch/keyboard/insets, lifecycle/permissions/services and native CI |
| iOS arm64 + simulator | No native build/runtime proof | Static/xcframework linkage and exported Xcode packaging, signing/install proof, touch/keyboard/insets, lifecycle/services and native CI |

These architectures define the initial release targets. Additional CPU
architectures require their own evidence, not an OS-wide blanket claim. OS
minimum versions must be established during GF-31 and included in release
artifacts. Web/WASM and macOS x86_64 are explicitly later ports.

Godot documents platform library/dependency exports in its
[GDExtension file format](https://docs.godotengine.org/en/4.7/engine_details/engine_api/gdextension/gdextension_file.html)
and iOS export integration through
[EditorExportPlugin](https://docs.godotengine.org/en/stable/classes/class_editorexportplugin.html).
Those are available integration mechanisms, not proof that Fabric/Hermes or
all OS APIs are already portable here. Investigate Android/iOS feasibility early,
including accessibility and native-view composition, without an engine fork.

| Library category | Current result | Certification needed |
| --- | --- | --- |
| React logic without a native host dependency | Original React executes | Test its exact React/runtime requirements; no universal compatibility claim |
| NativeWind 4.2.7 + css-interop 0.2.7 | Supported compiler/runtime subset works | Full supported styles, public TextInput, OS theme/scaling and clear unsupported-value errors |
| Chart Kit 7.0.4 | Original package exercised with synthetic data | Supported chart types/events/resize/empty states, scrolling/layout/animation lifecycle |
| react-native-svg 15.15.5 API | Local subset adapter; upstream native module does not execute | Broader SVG props, transforms, clipping, text and commands; document implemented API/version |
| Reanimated/worklets, Gesture Handler, safe-area-context, screens/navigation | No certified backend; Reanimated and safe-area aliases refuse use | Separate host ports, codegen/modules/worklets/threading/gesture/insets/navigation proofs; no automatic reuse of mobile native binaries |
| App-defined TurboModules and Fabric components | No public extension contract | A compiled example of each, typed schema, calls/events/commands, lifecycle and consumer packaging |

1.0 requires the selected NativeWind/chart integrations and app-defined native
extension examples. Broader named-library ports are follow-up work unless
explicitly added to the release promise. Their missing native functionality must
not weaken core Animated, gestures, insets, safe areas or component contracts.

## Comparison and architecture decisions

React Native's native modules use typed specs, Codegen and platform
implementations; native components add descriptors, props/events/commands and
host registration. Reuse that architecture for Godot's extension boundary.
[TurboModules](https://reactnative.dev/docs/turbo-native-modules-introduction),
[Fabric components](https://reactnative.dev/docs/fabric-native-components-introduction)
and [external platforms](https://reactnative.dev/docs/out-of-tree-platforms)
explain the upstream model.

Keep upstream React/Fabric/Yoga authoritative. Reuse upstream JS wrappers and
algorithms where host contracts permit, particularly Pressability, lists and
animation helpers. Track each private import as a versioned compatibility seam;
the [0.87 release](https://reactnative.dev/blog/2026/08/11/react-native-0.87)
makes strict public TypeScript contracts the default. Extending today's alias
list alone will not deliver a platform SDK.

GDSS is not currently loaded by this renderer. A future Godot-specific styling
extension can be additive, but cannot substitute for the RN style API or become
a requirement for ordinary RN imports. NativeWind should continue resolving
styles through the public host contract.

The native renderer is already C++. Rust is an optional implementation tool for
measured hotspots or isolated services, not a prerequisite for parity. First
profile frame time, Hermes heap, mount/shaping cost and thread blocking. Any
worker/Rust path must preserve JSI ownership, commit/event ordering and Godot's
main-thread constraints. Follow the
[upstream threading model](https://reactnative.dev/architecture/threading-model).
