# API and compatibility limits

The [native modules and refs checkpoint](NATIVE_MODULES.md) documents original
RN element/document refs, measurement, `setNativeProps`, `NativeModules`,
`TurboModuleRegistry`, `NativeEventEmitter` and DeviceInfo-backed
Dimensions/PixelRatio. Its [evidence](evidence/native-foundation/README.md)
is bounded; complete API and platform parity remain roadmap requirements.

The experimental [game-service API](GAME_SERVICES.md) adds the public
`@godot-fabric/runtime` import: typed calls, signals and revisioned initial state
connections to GDScript. The [services example](../examples/services/README.md)
keeps game rules on Godot and shares its React representation through Zustand.

The [Codegen experiment](CODEGEN.md) derives common C++/ViewConfig contracts from
original RN specs. The experimental [native extension SDK](NATIVE_EXTENSIONS.md)
now selects an external package, registers its original generated descriptor and
module, and mounts its Godot Control through Fabric. This remains a bounded
macOS arm64 implementation; unrestricted schema/package support, other targets
and native adapter exports remain open.

The examples use React and JSX. `react-native` imports resolve to the Godot
facade through the provided bundler; another bundler needs equivalent platform
resolution and the original React Native syntax transforms.

The facade exposes View, Text, Pressable, ScrollView, Button and single-line
TextInput; the touchables (TouchableWithoutFeedback, TouchableHighlight and
TouchableOpacity); Switch and ActivityIndicator; RN's original lists (FlatList,
SectionList, VirtualizedList and VirtualizedSectionList); Animated, Easing,
useAnimatedValue and useAnimatedValueXY; PanResponder; the environment modules
(AppState, Appearance, useColorScheme, Dimensions, PixelRatio, useWindowDimensions,
Platform, StyleSheet, AccessibilityInfo and I18nManager); the device services (Linking,
Clipboard and Vibration); and the native-module
entrypoints (AppRegistry, RootTagContext, NativeModules, NativeEventEmitter,
TurboModuleRegistry, UIManager, findNodeHandle and the codegen helpers). Image,
ImageBackground, KeyboardAvoidingView, RefreshControl and StatusBar are exported
placeholders that throw when used; the other names of RN's root are not exported.
The [typed form](../examples/form/README.md) exercises the controls through
ordinary RN imports. Internal probes remain separate; neither those probes nor
the public form certify the complete mobile API. NativeWind TextInput interop
still requires dedicated validation.

The [live status board](compatibility/BASELINE.md) counts the current public
exports and lists the evidence behind each area; the [parity audit](PARITY.md)
records the dated 2026-10-01 export inventory and verified gaps, followed by later
checkpoints; the [1.0 roadmap](../ROADMAP.md) assigns their priorities,
dependencies and completion criteria. Current implementation evidence is distinct
from planned RN compatibility.

| Area | Implemented subset | Important limits |
| --- | --- | --- |
| React | State/effects, Context, memo, keyed identity, callback refs/cleanup, external store, transitions, async Suspense, error boundaries, concurrent root | Production renderer; no certified dev StrictMode, Fast Refresh or DevTools integration |
| View / Yoga | Original public RCTView/View descriptor, Yoga layout, Fabric stacking order, rectangular overflow clipping, solid physical-edge border colors, public geometry and planar 2D affine styles, a singular one collapsing its View as RN does; the accessibility props of the Accessibility row below | RTL, 3D transforms, rounded descendant masks, fractional geometry and full StyleSheet utilities remain open |
| Text | Nested/composite Text, inherited attributes, variable family/weight, size/spacing, lineHeight, wrapping, left/center/right alignment, numberOfLines, tail/clip, `onTextLayout` on the outer paragraph (one entry per visible line) and the Yoga baseline for `alignItems`/`alignSelf: 'baseline'`, both from the lines the host measures and paints ([record](evidence/text-layout/README.md), [research](research/text-layout.md)) | Two bundled families plus initial Theme default; no selection, span press, inline Controls, italic/decoration/shadow, head/middle ellipsis, font scaling; `onTextLayout` is not emitted on a nested span, as in RN |
| Button | Public title/onPress/disabled/static color/testID/ref; native Button, measured title and keyboard activation | Godot color sets the background; casing is preserved; callback has no mobile gesture payload; accessibility/TV props are rejected |
| Switch | RN's original Switch.js over RN's shared iOS/macOS Switch descriptor: value, onValueChange/onChange, disabled, trackColor/thumbColor/ios_backgroundColor, setValue restore of an unchanged value, testID/ref; mouse click and touch tap | 63×28 default frame (RN's iOS 26 size); custom-drawn, without animation, thumb dragging, keyboard activation or accessibility; Android-only props are unused |
| ActivityIndicator | RN's original ActivityIndicator.js over the generated ActivityIndicatorView descriptor: animating, hidesWhenStopped, color, small/large/numeric size, testID/ref; the spinner advances with real frame time only while animating | Custom-drawn eight-spoke spinner filling the frame (UIKit keeps its own size); RN's iOS gray without a color; no accessibility or reduced-motion handling |
| Accessibility | RN's `View`, `Pressable` and `TouchableOpacity` accessibility props, mapped to Godot's AccessKit tree: `accessible`, `accessibilityLabel` / `aria-label` (the element's name, literally), `accessibilityHint` (its description), `accessibilityRole` / `role` (61 accepted spellings naming 44 distinct roles, 42 of them a Godot role, in the [research note](research/accessibility.md); `role` wins), `accessibilityState` / `aria-busy`, `aria-checked`, `aria-disabled`, `aria-expanded`, `aria-selected` (disabled and busy on any role, checked true/false on checkbox, radio, switch and togglebutton, selected on tab, listitem and option, expanded on button and menuitem), `accessibilityLiveRegion` / `aria-live`, `accessibilityElementsHidden` / `importantForAccessibility="no-hide-descendants"` / `aria-hidden` (hide the element with its descendants), and `onAccessibilityTap` on `View` and `Pressable`. The OS's press follows iOS: with `onAccessibilityTap` it dispatches only that event, without it the View is clicked at its center and `onPress` runs; a hidden or disabled element has no press. The types (View and TouchableOpacity; Pressable has no Godot declaration yet) list only the supported roles | Fails where the View renders, naming the prop: a value of the wrong type, a role outside RN's two vocabularies, `accessibilityLiveRegion` or `importantForAccessibility` outside RN's values, non-empty `accessibilityActions`. Fails at the host with the reason (a `FABRIC_ERROR`; the View then carries no semantics): the 44 role spellings (39 distinct names) with no Godot equivalent (such as `webview`, `adjustable`, `slider`, `table`), `checked: "mixed"`, a state on a role that cannot show it, `importantForAccessibility="no"`. Not mapped yet and dropped like any unregistered prop: `accessibilityValue`, `accessibilityLabelledBy`, `accessibilityViewIsModal`, `accessibilityLanguage`, `focusable`/`tabIndex`. Open: AccessibilityInfo settings and events, text scale, focus and keyboard, announcements, custom actions, grouping under `accessible`, Text, Button, TextInput and Switch semantics, Android and iOS (Godot 4.7.2 has no bridge there), any screen reader's speech. The headless run proves metadata only and ran locally (the hosted CI step is pending); the OS tree is read by a local macOS test ([evidence](evidence/accessibility/README.md)) |
| TextInput | Public controlled/uncontrolled single-line LineEdit, acknowledged edits, UTF-16 selection, initial autoFocus, original TextInput.State and native focus/blur coordination, editing events, native measurement and ref commands | Only layout/appearance/fontSize/static color styles; unsupported props fail; system IME, virtual keyboard, multiline, mobile policy and undo parity remain open |
| Pressable | Original Pressability and responder negotiation, supported press callbacks, disabled behavior, move-out/return under Godot surface translation/scale, mouse/touch movement under RN affine parents | Hover, keyboard activation, focus and complete multitouch require more work; its accessibility props are in the Accessibility row |
| Touchables | [Original TouchableWithoutFeedback, TouchableHighlight](../examples/touchables/README.md) and TouchableOpacity: RN's Pressability, callback order, underlay and child opacity, delayPressOut, long press, hitSlop/retention, nesting, disabled and removal mid-press, on two roots; TouchableOpacity dims through RN's native animated driver (0 ms on the grant, 250 ms back) | No TouchableNativeFeedback, focus/keyboard activation or concurrent cross-root presses; accessibility props are verified on TouchableOpacity only (Accessibility row), not on TouchableHighlight or TouchableWithoutFeedback |
| PanResponder | [RN's original PanResponder](evidence/pan-responder/README.md) over Godot mouse and touch input: `panHandlers`, the gesture state (`dx`, `dy`, `x0`, `y0`, `moveX`, `moveY`, velocity, active touches), a free pan view, parents that claim a gesture or capture every start, a child that refuses to yield and a view removed mid-gesture, in the four responder flag lanes | Pinch zoom through chart libraries, `InteractionManager` handles, velocity on real hardware, nested scroll views and negotiation with native Godot controls remain open |
| Animated | [RN's original Animated, Easing, useAnimatedValue and useAnimatedValueXY](../examples/animated/README.md): values, timing, spring, decay, composition, interpolation, Animated.View and createAnimatedComponent over the public View; the JS driver on requestAnimationFrame, or with `useNativeDriver` RN's own C++ Native Animated and AnimationBackend advanced by the ticks of the host's frame clock ([frame clock record](evidence/frame-clock/README.md)) | Animated.Text, Image, ScrollView, FlatList and SectionList fail where they render; LayoutAnimation, Animated.event with the native driver on the Godot ScrollView, reduced motion, PlatformColor interpolation, `unstable_disableBatchingForNativeCreate`, performance budgets and mobile exports remain open; Animated.View does not reject View styles Godot lacks; a uniform `transform: [{ scale }]`, animated or not, renders as a planar uniform scale ([uniform scale record](evidence/uniform-scale/README.md)); `scale: 0` and other singular transforms, animated or not, collapse their View as RN does ([singular transforms record](evidence/singular-transforms/README.md)) |
| Networking | [RN's own `fetch` (with Headers, Request and Response), `XMLHttpRequest`, `FormData`, `Blob`, `File`, `FileReader`, `URL`, `URLSearchParams`, `AbortController` and `AbortSignal`](../examples/networking/README.md) as lazy globals: the host's initialization imports RN's `setUpXHR` and three native modules (`Networking`, with the contract of RN's Android wrapper, `BlobModule` and `FileReaderModule`) give them HTTP/1.1 and HTTPS over Godot's `HTTPClient`; redirects (up to 20) and the total time-out are the host's; `text`, `base64` and `blob` responses; string, base64, multipart and blob bodies; abort, network errors and disposal at application stop ([record](evidence/networking/README.md)). RN's own `WebSocket` runs through `WebSocketModule` (RN Android contract) and BlobModule's socket hooks. Godot `HTTPClient` owns asynchronous DNS/TCP/TLS setup; the adapter then uses its public `StreamPeer` connection with pinned wslay for RFC 6455 framing. ws/wss, text/binary (`arraybuffer`/`blob`), protocols, handshake headers, Origin, peer close codes/reasons and silent stop are covered ([record](evidence/websocket/README.md)) | WebSocket: no extensions such as `permessage-deflate`, cookies, proxy/system trust configuration or HTTP/2; connection plus upgrade has a 30-second host deadline and close has a separate 60-second deadline. The 95-check local product probe covers 60 connections and 53 required wire/JS comparisons; each WebSocket poll admits at most 1 MiB of inbound wire bytes across WebSocket sockets; its 256-event cap uses canonical pending networking-event capacity after the separate HTTP poll. TLS close code/reason are reported only when a peer close frame arrives; a drop after client close is abnormal. A server selecting no subprotocol is accepted; an unoffered protocol is rejected. Closing while connecting fails, unlike Android's no-op. HTTP: no cookies (`withCredentials` has no effect, `clearCookies` calls back `false`); compressed responses fail explicitly; no HTTP/2, pooling, proxy or system trust configuration, upload or download progress, incremental streaming, `uri` bodies or `FormData` file parts; `Networking` is not exported from `react-native`. Local runtime proof is macOS arm64; hosted CI passed five jobs for pinned head `422c2ee` ([receipt](evidence/websocket/hosted-ci.json)), while later PR-head changes require new green checks. The parity job’s 13 Android/iOS `core-ui-v2` cases do not establish WebSocket differential or Godot mobile runtime behavior |
| ScrollView | Original Fabric descriptor/state, vertical/horizontal scroll, contentOffset, scrollTo/scrollToEnd without animation, scroll events with Android's `scrollEventThrottle` rule, RN's ref methods and responder-mediated drag in the ScrollView's own coordinates | All children mount; no inertia/momentum, bounce, paging, zoom, sticky headers, refresh, indicators or complete nested/multitouch scrolling |
| Lists | RN's original FlatList, SectionList, VirtualizedList and VirtualizedSectionList on that ScrollView: windowing, getItemLayout and measured cells, viewability, onEndReached, scroll commands and their failures, header/footer/empty, separators, horizontal and inverted lists | Animated scrolling, sticky section headers, RefreshControl, maintainVisibleContentPosition, initialScrollIndex, numColumns, nested lists and the 10,000-row performance acceptance remain open |
| AppState and Appearance | [RN's original AppState](evidence/app-state/README.md), fed by the Godot application lifecycle: focus loss is `inactive`, a pause is `background`, `change`, `focus`, `blur` and `memoryWarning` are sent, the roots of an application share one state and stop sends nothing. [RN's original Appearance and useColorScheme](evidence/appearance/README.md), fed by Godot's system theme: `getColorScheme`, `addChangeListener`, `setColorScheme` overrides that win over the system and `unspecified` following it again, a change event only when the effective scheme changes, one theme callback shared by every application | Minimizing or hiding a desktop window sends no Godot notification; real OS focus and theme changes on each system, resume with pending timers or network, accent colors, `PlatformColor`/`DynamicColorIOS`, per-window themes and Godot mobile exports remain open |
| Device services | [RN's original Linking, Clipboard (legacy) and Vibration](../examples/device-services/README.md) over three C++ TurboModules (`LinkingManager` with iOS's contract, `Clipboard`, `Vibration`) and Godot's `OS.shell_open`, `DisplayServer` clipboard and `Input.vibrate_handheld`: `openURL`, `canOpenURL`, `getInitialURL`, the `url` event that `FabricApplication.deliver_url` delivers once to every listener of every root, `getString` and `setString`, `vibrate` and the patterns RN's own JavaScript schedules; every platform call can be replaced by a validation backend ([record](evidence/device-services/README.md), [research](research/device-services.md)) | Godot cannot ask which handlers are installed, so `canOpenURL` resolves `true` for any URL with a scheme; `openURL` is synchronous and cannot be cancelled; `openSettings` and `sendIntent` reject; a clipboard-less display server (headless) rejects `getString` and throws from `setString` with `E_CLIPBOARD_UNAVAILABLE`; a vibration cannot be cancelled in Godot, `vibrateByPattern` throws if called directly and RN's repeating pattern is not cancelled by `cancel()`, as in RN; Alert, Share, Settings and BackHandler, mobile deep-link plugins, Windows/Linux and real-device behavior remain open |
| NativeWind | Resolved utility styles, responsive logical viewport, supported pressed styles, CSS variables and manual theme | Unsupported style/native modules fail explicitly; no Reanimated or automatic system-theme contract |
| SVG / charts | SVG/G/Defs/ClipPath/Path/Rect/Circle/Line/LinearGradient/Stop and simple SVG text, tested with unmodified Chart Kit | Budget 2048×2048, unscaled viewBox, no arbitrary transforms, nested SVG certification or full SVG typography |

## Typed consumer and native controls

Run `npm run type-check` with [tsconfig.godot.json](../tsconfig.godot.json).
The declarations in [types/react-native.ts](../types/react-native.ts) derive
View, Text, Button, Switch, ActivityIndicator, TouchableOpacity, TextInput,
styles/events and native refs from the pinned RN types, narrowing them to this
implementation. They are checked as
project source with strict TypeScript. Third-party declaration bodies use
`skipLibCheck`; the upstream contract inventory still checks their source hashes
and signatures. Positive consumer assignments and negative unsupported-prop
fixtures run in CI. AppRegistry's registration subset and RootTagContext are
also typed, and so are the exports declared from RN's own types: AppState, Linking,
Clipboard, Vibration, Appearance and useColorScheme, the four lists, Animated, Easing and the two
animated-value hooks, NativeModules, NativeEventEmitter, TurboModuleRegistry, the
codegen helpers, findNodeHandle and a UIManager measurement subset. Pressable,
ScrollView, TouchableWithoutFeedback, TouchableHighlight, PanResponder, Platform,
Dimensions, PixelRatio, useWindowDimensions, AccessibilityInfo and I18nManager do
not yet have Godot declarations;
this is not the complete typed SDK. The
[independent consumer](../consumers/minimal/README.md) now packages this bounded
type surface with a provisioned addon; full SDK types remain open.

The bundler accepts TS/TSX. Both resolvers prefer `.ts`, then `.tsx`, then
JavaScript; within an extension they prefer `.godot`, then `.native`, then
generic source. A mixed-extension fixture guards that order. Runtime resolution
excludes declaration-only `.d.ts` files. Its `react-native` alias selects the Godot facade; TypeScript's
`paths` selects the narrowed declarations. Match these mappings in another
consumer/bundler. The original ReactFabric renderer remains in the bundle.

RN's stock TextInput selects only iOS/Android native hosts. Godot uses its own
wrapper over the existing single-line adapter and Fabric host instance. It
preserves native edit counts before forwarding user callbacks; imperative
`clear` and `setSelection` acknowledge the latest count. Ref cleanup releases
the host, so retained wrapper commands become harmless after unmount.
`focus`, `blur`, `isFocused`, `measure`, `measureInWindow`, `clear`,
`setSelection` and `getNativeRef` are the exposed input ref subset.

`TextInput.State` exposes `currentlyFocusedInput`, `currentlyFocusedField`,
`focusTextInput` and `blurTextInput`. It uses the original RN focused-instance
singleton and registration set. The Godot bridge supplies focus/blur commands
through original Codegen and Fabric dispatch. The getters return
`NativeInstance | null` and `number | null`; focus/blur accept public host
instances or null/undefined. Deprecated numeric arguments remain upstream no-ops
at runtime and are rejected by the public types.

Inputs register before external ref callbacks. Native focus/blur events update
the original singleton before user callbacks. Eligibility follows mounted
native editability and lifetime: canonical RN props can change during a
speculative render and are not an authority for native focus. Input retirement
clears registration and focused authority. Ref callback replacement preserves
the registration of an input that remains mounted. The original element
prototype owns `focus()`/`blur()`; ordinary View refs retain upstream no-op
behavior while `enableImperativeFocus` is disabled.

The [focus example](../examples/focus/README.md) records the bounded desktop
contract. Full HostInstance, hidden-tree behavior, multiline, IME composition,
virtual keyboards/insets and mobile reference differentials remain open.

Button supports `title`, `onPress`, `disabled`, static string `color`, `testID`
and ref. TextInput supports `value`, `defaultValue`, `selection`, `editable`,
`placeholder`, `submitBehavior`, `multiline={false}`, initial `autoFocus`,
`style`, `testID`, ref and `onLayout`, `onChange`, `onChangeText`,
`onSelectionChange`, `onFocus`, `onBlur`, `onEndEditing`, `onSubmitEditing`,
`onKeyPress`. Single-line string props reject newlines. Selection uses ordered,
nonnegative UTF-16 offsets; the native adapter clamps to valid character
boundaries. Submission is `submit` or `blurAndSubmit`. Unsupported defined props
throw; no unsupported mobile prop is silently forwarded by these two wrappers.
This prop audit is still incomplete for the other public facade components.

## Read-only refs and native IDs

Public `View` now delegates to original RN `View.js` before `RCTView`. It maps
`id` to `nativeID`, with `id` precedence when both are supplied. ViewConfig
forwards `nativeID`; narrowed types admit View IDs and Text `nativeID`.
`ref.ownerDocument.getElementById` searches the current Fabric revision of that
root, including flattened logical Views. Declaring an ID can materialize a View.

The [tree example](../examples/tree/README.md) checks original parent/child and
sibling APIs, containment, document position, node properties, root isolation,
key replacement and retirement. Pinned NodeList/HTMLCollection getters return
membership snapshots; read them again for the current tree. Their member refs
retain their own current-prop/connection semantics. `namedItem` returns null in
the pinned upstream implementation.

Changing a string creates a new RawText public instance; unchanged span text
retains identity. This production renderer leaves RawText `ownerDocument` null.
An imperative native ID changes lookup without changing canonical `.id`; the
fixture’s next children-only React commit keeps it, as RN's JS thread holds the clone
`setNativeProps` committed. See
[executed evidence and source links](evidence/tree/README.md) for these exact
limits. Full HostInstance, imperative EventTarget, remaining native commands
and all-platform differential acceptance remain open under GF-08.

## Public pointer events and capture

Original public `View` accepts `onPointerDown/Move/Up/Cancel/Over/Out/Enter/Leave`,
`onGotPointerCapture` and `onLostPointerCapture`, including capture-phase props.
Original refs expose `setPointerCapture(id)`, `hasPointerCapture(id)` and
`releasePointerCapture(id)`. Pending ownership is queried immediately; the next
native sample delivers got/lost. Release by the wrong ref and inactive IDs are
original silent no-ops. Disconnected/stopping refs have no capture authority.

Godot mouse/touch samples route once per shared application with stable live
IDs, physical-origin ownership and independently resolved hit/capture targets.
Capture can receive drag outside all roots. Mouse button masks and selective
cancel preserve unrelated contacts. Retiring an application revokes its
continuations immediately, with final teardown deferred when inside a callback.
A listener exception remains visible and retires only its pointer authority;
a fresh Down can capture again. The binding restores event priority after a
throw. Original TouchEvent/Pressability runs alongside this pointer transport.

For a visible dispatched target, `offsetX/offsetY` are local coordinates from
its full inverse native/logical affine. `clientX/clientY`, `x/y` and `pageX/pageY`
stay in the contact's physical origin root; screen coordinates keep the native
sample's window units. Cross-root transfer does not rewrite those fields.
Materialized targets use real Godot transforms; flattened refs compose their
committed logical suffix from the nearest mounted ancestor.

If an embedding becomes singular, terminal cancellation can reuse the same
family's offset at the exact last valid native point. With no valid history it
omits that terminal callback while releasing original contact authority.
A connected `display:none` target retains original RN delivery using its empty
layout metrics; this case has no painted local inverse. The public fixture
checks its captured offsets equal client coordinates. A target or capture owner inside
a View whose JSX transform is singular (a collapsed View) follows the same path and
keeps RN's own offsets, as the
[singular transforms record](evidence/singular-transforms/README.md) shows.

This bounded desktop path uses a generated, SHA-pinned native RN overlay; the
downloaded sources and reconciler remain unchanged. SDK headers and binaries
identify the overlay and require a freshly packaged matching SDK. It does not
enable original imperative EventTarget flags. The pinned RN AABB-subtraction
capture algorithm is explicitly incomplete; Godot local offsets intentionally
differ under rotation/skew/other-root embeddings. See the
[geometry receipt](evidence/pointer-geometry/README.md) and preceding
[lifetime receipt](evidence/pointers/README.md).

Actual queued coalescing, the complete responder contract (RN's PanResponder runs
on these samples, with the limits of the [PanResponder record](evidence/pan-responder/README.md)),
hardware, scroll/windows, cross-application stacking and mobile differentials
remain open. These executed subsets do not close GF-08/GF-13.

## Public View geometry

The [View example](../examples/view/README.md) uses original
`View.js`, `ViewNativeComponent` (`RCTView`) and `ViewComponentDescriptor`. Fabric's mount
order determines drawing and hit selection with Godot z indices at zero,
including static-position and nested-context behavior in the executed fixture.
Rectangular hidden/scroll overflow clips drawing and targeting while public refs
retain the child's full geometry. `collapsable` and `collapsableChildren` reach
the original View traits. Internal View, Pressable and ScrollView content remain
GodotControl wrappers.

Supported physical `borderLeftColor`, `borderTopColor`, `borderRightColor` and
`borderBottomColor` use original color processing and resolved border metrics.
Uniform borders retain StyleBoxFlat; multiple colors paint through a StyleBox
Resource on the same CanvasItem without adding nodes. The
[executed evidence](evidence/view/README.md) records opaque/translucent colors,
removal and an asymmetric rounded self-border. It does not establish rounded
descendant clipping or full mobile/fractional antialiasing parity.

The offset-surface input/measurement gap discovered here is addressed by the
later [coordinate checkpoint](evidence/coordinates/README.md). It exercises
genuine movement with its own reports and source identities.

## RN affine transforms

`View` styles accept `transform` and `transformOrigin` through the original RN
processors. The [public gallery](../examples/transforms/README.md) executes
ordered scale/rotation, percentage translation, absolute/percentage origins,
skew, a reflected/sheared matrix and nested transforms. For example:

```jsx
<View style={{
  width: 100,
  height: 60,
  transformOrigin: ["25%", "75%", 0],
  transform: [{ scaleX: 1.25 }, { rotate: "20deg" }],
}} />
```

Original `ViewProps.resolveTransform` owns operation order and resolves
percentages/origins from the current layout size. The native adapter applies its
invertible 2D affine result to the same Control's base and public offset
transforms, with `offset_transform_visual_only=false`. Shear and reflections
therefore affect drawing, the actual GUI transform and target-local input
together. Size-only updates re-resolve percentages; removing the style resets
the Control. No extra wrapper nodes or Godot engine rebuild are required.

`measure` and `measureInWindow` include original RN transformed bounds. Nested
public bounds accumulate an axis-aligned box at each ancestor, so they can be
larger than the exact quadrilateral painted by Godot. `measureLayout` excludes
visual transforms and `onLayout` reports Yoga geometry. Flattening an anonymous
wrapper, materializing it through a transform and removing the transform
preserve the retained child's native identity, ref and React state in the
executed fixture. See the [assertions and captures](evidence/transforms/README.md).

A uniform `scale: n`, static or animated, is accepted: RN writes it as
`scale3d(n, n, n)`, and the entry at index 10 only multiplies z, which cannot move
a point of a planar Control (iOS and Android render it in the plane too), so it is
not part of the planar rule. That rule has one definition,
`planar_violation` in `native/affine_transform.h`, used by the transform adapter
and by pointer projection. A `Pressable` with a `scale` takes real presses where
only the scale reaches and reports target-local points from the scaled matrix. See
the [uniform scale record](evidence/uniform-scale/README.md).

A singular transform (`scale: 0`, `scaleX: 0`, a rank-one matrix, an animation through
0), or one that loses rank at the Control's native precision, collapses its View as RN's
platforms do. The Control and its subtree are hidden (nothing is drawn or hit and the
contacts inside are canceled), the Control keeps the last invertible transform it
carried, no error is raised, and the next invertible transform restores it, through a
React commit or through the native driver. Hiding the subtree is a deliberate choice:
Android skips a child whose matrix does not invert together with its subtree, and so
does iOS when the container clips, but iOS's `hitTest:` can still reach descendants of
an unclipped container with a nonzero `overflowInset`, which the host does not
reproduce. Layout, `onLayout` and RN's measurement APIs
stay RN's own, so a singular matrix reports a degenerate box. The transform step returns
that result explicitly (`PlanarTransform` in `native/affine_transform.h`) and visibility
is decided in one place, `displayType != None && !collapsed`. Keyboard focus inside a
collapsed View is released when the native driver collapses it (asserted by the suite);
a collapse through a React commit was observed to keep it, because the host's transaction
restores the focus owner, as it does for `display: none` (an exploratory observation the
suite does not assert). RN keeps focus in both, and a guard on `is_visible_in_tree()` in
that restoration is an open item. See the
[singular transforms record](evidence/singular-transforms/README.md).

The native host rejects 3D or perspective (`E_TRANSFORM_3D`: any entry that couples z,
such as `rotateX` or `perspective`, or a weight other than 1), nonfinite matrices
(`E_TRANSFORM_NONFINITE`) and results or inverses outside native coordinate
precision (`E_TRANSFORM_RANGE`). The six public rejection cases also verify cleanup
after a partially mounted tree; unsupported transforms do not silently fall back to
identity.

The pinned upstream JS processor accepts CSS transform strings, but its
`translateX/translateY` string branch discards percentage units. Use array
syntax such as `{ translateX: "25%" }` for percentages. Array percentages have
native execution proof; CSS pixel strings have processor-contract proof only.
The adapter does not substitute a new CSS parser. This checkpoint does not
certify transformed clipping, every host component, transform animation,
3D support or mobile reference parity.

## Input coordinate contract

For the supported native Window, `pageX/pageY` are logical React-root points,
matching the page coordinates returned by original NativeDOM `measure`.
`locationX/locationY` remain relative to the original touch target throughout
a gesture, including movement outside it. Godot projects the Viewport point
through the inverse surface and target transforms respectively. `measureLayout`
uses the logical React family; `measureInWindow` and DOMRect include the Godot
embedding.

`screenX/screenY` include the native Window client-area position and its current
content transform, normalized by content density. Transform and density are
sampled together for the first input after a scale change. Ordinary raw window
input is already localized by Godot before this projection; page/local points
are not divided by density again.

The [public example](../examples/coordinates/README.md) verifies translated and
positively scaled Godot surfaces, genuine Pressability move-out/return/release,
independent nonoverlapping roots and raw window pixels at density two. The
separate [affine checkpoint](evidence/transforms/README.md) adds RN styles and
genuine mouse/touch movement under transformed parents, including parent-local
hitSlop rejection outside a rotated quad.

If an external Godot embedding becomes non-invertible or its composed inverse
exceeds native precision, an existing contact cancels using its last valid
coordinates. That invalid event is consumed before Godot GUI attempts its own
inverse. The separate [input-guard proof](evidence/transforms/input-guards.json)
executes determinant overflow despite finite local matrices, an ignored START,
restoration and a genuine press, and cancellation after overflow or a singular
Surface offset transform. It verifies no fabricated points, completed press or
stale responder. This input safety behavior is separate from rendering singular JSX
transforms, which the [singular transforms record](evidence/singular-transforms/README.md)
covers. Valid rotation/style changes during a held gesture, overlapping-root
routing, simultaneous multitouch, hardware/DPI policy, SubViewport and embedded
Windows require separate acceptance.

## Shared application and root authoring

The [shared example](../examples/shared/README.md) registers named root
components with the original RN AppRegistry. Godot's `renderApplication`
container supplies the original RootTagContext and invokes the original
production Fabric renderer. Component children require no registration.
The typed public subset is `AppRegistry.registerComponent(key, provider)` and
`getAppKeys()`. Empty/duplicate/reserved keys and a section argument fail;
headless-task, section, instrumentation and public mounting APIs are not exposed.

An experimental `FabricApplication` Node owns one Hermes runtime, module cache,
UIManager, scheduler and timer/frame queues. Set its `bundle_path` before first
mount (default `res://build/app.js`). A bundle evaluates once and registers all
entries. Each `FabricSurface` Control uses:

| Property/API | Behavior |
| --- | --- |
| `application_path` | NodePath to its application owner; the example uses `../SharedApplication` |
| `component_name` | AppRegistry entry key; HUD and Inventory use different registered components |
| `initial_props` | Dictionary serialized through Godot JSON for that root; use JSON-compatible values |
| `update_props(props)` | Replace root props, preserving root/component identity and local state; before mounting, save props for the next mount |
| `mount()` | Mount a registered entry, or return true if already mounted; reentrant mounting reserves a new root identity and defers starting Fabric until the current native stack returns; return false with a visible error on failure |
| `unmount()` / named `stop()` | Immediately retire this root's input/event/command authority; defer original React cleanup, input cancellation and native tree/tag deletion to the host's surface phase |
| `get_surface_id()` | Current native root tag, or zero after unmount; remount receives a new identity |
| `hide()` / `show()` | Godot visibility; the mounted React state and effects continue |

`unmount()` sets `get_surface_id()` to zero before returning. The root snapshot
reports `retiring` while physical cleanup is pending; mounted Controls are
detached and retained until the deferred phase, rather than deleted from their
own Godot signal stack. React effects and the original Fabric ShadowTree are
cleaned up in that phase, so this API does not promise synchronous effect
cleanup or immediate disconnection of upstream DOM refs.

Calling `unmount(); mount()` from a resize or input callback creates a new
generation on the same host. Its deferred `startSurface` avoids adding a new
ShadowTree while the original Fabric registry is being visited. Completion of
the old retirement is qualified by application and surface identity; it cannot
clear a replacement mount, including one owned by another application whose
root IDs start again at one.

Control sizes provide separate Yoga constraints. The module store is shared
only because both roots import the same module and subscribe explicitly; React
Context does not cross roots. Put the owner in a persistent part of the SceneTree
when replacing UI scenes. Removing a surface unmounts only its root. Removing
the owner or calling `FabricApplication.stop()` shuts down all its roots and
scheduling. This prototype's stopped owner cannot be restarted; retaining
Hermes until owner destruction allows diagnostic `evaluate()`/`snapshot()`.
These diagnostic methods are separate from the typed `GodotFabric` game-service API.

An individual root retirement preserves the application's renderer, Hermes
runtime, module instances and scheduling queues. Surviving roots can continue
state updates, events and remaining RAF/timer callbacks. Native core Button and
LineEdit connections capture their originating runtime, surface, tag and mount
generation. A queued old signal therefore cannot acquire a replacement root's
authority by following the host's current `application_path`.

The legacy anonymous single-root fixtures retain implicit owner lookup, root 1
and application shutdown on `stop()`/scene exit. A new anonymous scene, or
reentry of the same surface, retires the stopped implicit owner and creates a
fresh runtime with fresh React/module state. This compatibility path does not
restart an explicitly shared application. These fixtures do not demonstrate named
registration. New UI should use registered roots; the independent consumer
does so through a Resource/scene wrapper and provisioned private tools.

[Shared-root evidence](evidence/shared-roots/README.md) covers two nonoverlapping
roots, updates, replacement, zero-root survival and activation failures.
The [root-retirement checkpoint](evidence/root-retirement/README.md) adds the
reentrant retirement/replacement boundary and deferred core-signal origin.
Its [surviving-root capture](evidence/root-retirement/root-unmounted.png),
[remounted-root capture](evidence/root-retirement/root-remounted.png) and
[owner-switch capture](evidence/root-retirement/root-owner-switched.png)
show the corresponding native UI states.
Complete SDK singleton activation, reload/restart
policy, complete game-service codegen, bootstrap/dev tooling, portals/overlapping-root
input, pause/resume, Activity hidden mode, transformed/multiwindow geometry and
original mobile multi-root comparison remain open. The pending V2 decisions
retain their status; these native properties are an experimental validation API.

## Provisioned consumer prototype

The [consumer](../consumers/minimal/README.md) imports public React/RN, selects
its TSX entry through a `GodotFabricApplication` Resource, and mounts HUD and
Inventory through one scene-owned native runtime. The editor builder reads
`godot_fabric/application`; the Application wrapper references the same Resource.
Managed output is `res://.godot_fabric/app.js`. Format version 1 and these
authoring properties are experimental.

The addon provides private Node/tools and protects SDK React/RN identity for
project library imports. Project-owned additional dependencies must be declared
and installed explicitly. Missing tools, type/syntax errors, incompatible core
versions and unsupported Babel configuration reject the editor build. The
[SDK guide](../sdk/README.md) explains provisioning, dependency boundaries and
current resolution/NativeWind limits. The automatic headless editor check
exercises `_build`; graphical consumer checks exercise native rendering/input
separately. Full `GodotFabric` game services, singleton activation, development
tooling and exports remain pending.

## Text details

- `font-sans` is Noto Sans; `font-mono` is JetBrains Mono. Original assets and
  licenses are in [assets/fonts](../assets/fonts/README.md).
- Weight uses the actual variable-font axis. Noto supports 100..900; bundled
  JetBrains Mono supports 100..800. Mono 900 is not certified.
- Godot rounds effective font size and glyph spacing to integers. Line height
  can remain fractional; Yoga rounds the overall frame.
- Only the outer paragraph accepts numberOfLines/truncation. Nested spans
  accept text attributes; layout/background styles and inline Controls fail.
- Latin accents are exercised. Bidi, emoji/fallback and colored truncation
  need dedicated tests before claiming parity.
- `onTextLayout` receives RN's event, `{lines}`, where each line has `text`, `x`,
  `y`, `width`, `height`, `ascender`, `descender`, `capHeight` and `xHeight`: the
  line box with the baseline inside it as on iOS (an explicit `lineHeight`
  centres the baseline), `capHeight` and `xHeight` as the ink height of "T" and
  "x" as on Android, and `text` without the host's internal sentinel. It is
  emitted after the layout, once per change of the lines (a change of color, or
  a width that wraps the same lines, emits nothing), with one line per visible
  line under `numberOfLines`. The same lines give Yoga the baseline of a Text in
  a baseline-aligned row. Measured against the bundled fonts' tables the
  host is within one pixel
  ([tolerance](research/text-layout.md#tolerance-measured)).
- `onTextLayout` must be a function (or `undefined`/`null`): any other value
  throws `Godot Text onTextLayout must be a function`. A nested `Text` ignores it, as RN's
  virtual text does. `onPress`, `onPressIn`, `onPressOut`, `onLongPress`,
  `selectable` and `adjustsFontSizeToFit` still throw
  `Godot Text does not implement <name>`.
- The text of a truncated last line, empty text, a `lineHeight` smaller than the
  font and lines beyond a fixed node height differ between RN's platforms and
  are not part of the contract ([divergences](research/text-layout.md#documented-divergences-not-normative)).
- The initial Theme font is captured from the application's first surface.
  Per-root Theme fonts, dynamic Theme/font loading and system font scaling
  are pending.

## Platform and performance

### JavaScript runtime

The host compiles the pinned RN `TimerManager.cpp` unchanged. `setTimeout` and
`setInterval` preserve callback arguments and upstream delay coercion;
`clearTimeout`/`clearInterval` share cancellation authority. Missing callbacks
throw, while non-function timer callbacks return zero in this pinned RN version.
The original portable RN microtask and immediate modules provide
`queueMicrotask`, `setImmediate` and `clearImmediate` over Hermes Promise jobs.

Godot supplies deadlines and a bounded native work pump. Overdue intervals do
not replay missed ticks in a burst. RAF callbacks and RN's Native Animated frames
run on the ticks of the host's frame clock, not on every Godot process frame;
`performance.now()` uses the same monotonic clock as their timestamp.

The frame clock (`native/frame_clock.h`, [evidence](evidence/frame-clock/README.md)) is
the only place where that cadence is decided, as RN's platforms leave it to a display
link (a `CADisplayLink` on iOS, a `Choreographer` on Android). The runtime asks it once
per Godot frame, with the time of the frame, the refresh rate the display reports for
the window's screen, the window's pacing and whether anything consumes frames (pending
RAF callbacks, or a Native Animated backend with an animation to run). A frame is a tick
only if something consumes frames, and then the window's pacing decides:

- **Presentation** (a window on a real display that can draw, with V-Sync enabled or
  adaptive): every frame with a consumer is a tick, however close it is to the one before
  (the pipelined frames of a V-Sync window arrive about 3 ms apart).
- **Time** (headless, V-Sync disabled or mailbox, a window that cannot draw, or unknown):
  with `T = 1000 / R` ms, `R` being the reported refresh rate when it is positive and
  finite and 60 otherwise, the frame at time `t` is a tick iff no tick has served a
  consumer yet, or `t - (the previous Godot frame) >= T / 2`, or `t - (the previous
  tick) >= T`. So, under Time pacing, two ticks are never closer than `T / 2`, a loop
  capped at the refresh rate or slower ticks on every frame, a faster loop ticks about
  once per `T`, a stall gives one late tick (the catch-up frames behind it wait), and the
  first frame with a consumer after idling ticks at once only when it is due: when no tick
  has served a consumer yet, when it starts `T / 2` after the previous Godot frame, or
  when a period has passed since the last tick. On a loop faster than `T / 2`, a request
  within a period of the last tick waits out the period, as a display link would.

A window that cannot draw (a minimized one, say) is not presented, and Godot's main loop
then sleeps `low_processor_usage_mode_sleep_usec` per frame even with V-Sync, so that
sleep paces the frames and not presentation: it is paced by time. The pacing is detected
per frame (`headless`, `undrawable` and `unpaced` give Time, `vsync` gives Presentation;
`DisplayServer.window_can_draw` tells whether the window can draw) and reported, with the
rate and its source and the counters, in the application snapshot's `frameClock`;
`validation_refresh_rate` and `validation_frame_pacing` meta values state them where the
DisplayServer cannot (headless).

Only a tick runs the callbacks and the animation frame. The host binds its own
`requestAnimationFrame` and `cancelAnimationFrame` after RN's `TimerManager` installs its
globals (`native/application_runtime.cpp`), so a callback is not a 0 ms timer: a tick runs
the callbacks pending when it starts, in order, passing every one of them and the Native
Animated frame the tick's one timestamp, and a callback requested during a tick waits for
the next one. RN 0.87.1's `TimerManager` rAF would pass `performance.now()`, sampled when
each callback runs; the frame's shared timestamp, which browsers pass too, is a deliberate
departure. Timers, input, the host phase and the work queue still run on every Godot
frame, so `setTimeout(fn, 0)` and short intervals are not quantized to ticks as they are
on RN's platforms. A Presentation tick's timestamp is the CPU time of its Godot frame, not
the regular presentation time iOS gives RN, so the steps of a decay under V-Sync are as
uneven as those frames.

Callback exceptions reach the host error channel. A failed one-shot releases
its registration; a failed interval remains recurring until cancelled.
Application shutdown cancels registered timers/frames and suppresses pending
portable microtask/immediate callbacks. Retained scheduling functions cannot
restart them after shutdown. Individual named root unmounts preserve application
timers/frames and module state; component effects must dispose their own subscriptions
and clocks. Ordinary Promises are not a cancellation API.

[Runtime evidence](evidence/runtime/README.md) documents the positive and
negative native checks. This is a partial GF-05 bootstrap: idle callbacks,
unhandled rejection/error-handler parity, encoding globals and microtask starvation
protection remain uncertified, and so does the full contract of `URL`, `URLSearchParams`,
`AbortController` and `AbortSignal`, which are RN's own since the
[networking record](evidence/networking/README.md) (see [Networking and web-standard
globals](#networking-and-web-standard-globals)). No worker thread is used.

### Networking and web-standard globals

The host's initialization imports RN's own `Libraries/Core/setUpXHR`, so these globals
exist and load on first read: `fetch`, `Headers`, `Request`, `Response`, `XMLHttpRequest`,
`FormData`, `Blob`, `File`, `FileReader`, `URL`, `URLSearchParams`, `AbortController`,
`AbortSignal` and `WebSocket`. They are RN's JavaScript, unchanged. The host supplies the
native side RN asks for: the SDK's bundler plugin aliases RN's `RCTNetworking` to its
Android wrapper (RN ships it only as `.ios.js` and `.android.js`), and four C++
TurboModules, `Networking` (RN's generated Android spec), `BlobModule`,
`FileReaderModule` and `WebSocketModule`, share one application state (a blob store and one
stoppable call invoker). The first three run their requests on Godot's `HTTPClient`
(`native/http_transport.h` is the seam a platform transport can replace). WebSocket connection
setup uses `HTTPClient` for asynchronous DNS/TCP/TLS, then retains its public `StreamPeer`
connection and pinned wslay for framing behind `native/websocket_transport.h`. Everything runs
on the main thread, which is the JS thread, and ends with the
application: a stop cancels the requests in flight, attempts a best-effort 1001 close on open
sockets, refuses retained module methods with `E_MODULE_DISPOSED`, and sends no later event to JS
afterwards. The `react-native` facade gains no export: `Networking` is
still missing, and the globals are the supported surface. The
[record](evidence/networking/README.md) has the 100 headless checks, the preceding-host
control and two retained sabotages; [the research note](research/networking.md) explains
the contract and where this host departs from RN. The
[WebSocket record](evidence/websocket/README.md) has 95 local product checks across 60
connections and 53 required wire/JS comparisons. Its research note describes the current
adapter and keeps the former WebSocketPeer findings in a separate historical section.

What the checks cover, against a local Node server over HTTP and over HTTPS with a test CA
(macOS arm64):

- **Requests.** GET, HEAD and POST are exercised (PUT, DELETE, OPTIONS, TRACE and PATCH
  map to Godot's client without a check of their own); one HTTP/1.1 connection per request;
  headers go out as RN hands them over (whatwg-fetch lowercases the names, and RN's
  `Headers` joins repeats); non-ASCII header values go out as UTF-8. String and base64
  bodies need a Content-Type, as on Android, and are sent as bytes with it unchanged;
  `FormData` with string parts is sent as `multipart/form-data`; `Blob` bodies keep their
  bytes and type.
- **Responses.** `fetch` reads bodies through `FileReader`; `XMLHttpRequest` supports
  `text`, `json`, `arraybuffer` and `blob`; text decodes by the Content-Type charset
  (UTF-8, ISO-8859-1, US-ASCII or UTF-16, a BOM first, invalid UTF-8 as U+FFFD); repeated
  response headers are joined with `", "`; 4xx and 5xx are responses; the response URL is
  the final one.
- **Redirects.** The host follows up to 20: 301, 302 and 303 turn a non-GET, non-HEAD request
  into a GET without a body, 307 and 308 keep method and body, `Authorization` is dropped when
  the origin changes, the 21st follow-up or a loop ends in a network error, and a redirect to a
  scheme the host cannot follow is delivered as the response.
- **Time-out, abort and errors.** `XMLHttpRequest.timeout` covers the whole exchange; aborting
  closes the connection and delivers nothing more; a refused, reset or truncated connection,
  an invalid URL or an unsupported method is `TypeError: Network request failed` for `fetch`
  and `error` for XHR.
- **HTTPS.** Godot's default roots verify certificates. The suite's CA reaches the
  host only through a validation seam (`validation_tls_trusted_authorities`, never set by
  a product); an untrusted or malformed authority is a network error.
- **WebSocket.** RN's own `WebSocket` opens `ws:` and `wss:` URLs (an `http:` or `https:` URL
  connects too, as OkHttp reads it), with the subprotocols and `options.headers` RN passes
  and, when the caller sets none, an Origin made of the URL; the server's choice of
  subprotocol is `protocol`. Text, `ArrayBuffer`, views and `Blob`s go out; binary messages
  arrive as `ArrayBuffer`s or, with `binaryType = 'blob'`, as blobs in native memory. Close
  codes and reasons are sent and received as given (OkHttp's rules apply: a code outside
  1000-4999, a reserved one or a reason over 123 bytes is refused with a warning and the
  socket stays open), a server's close frame without a status is `1005`, a refused handshake,
  a lost connection or a close the server never answers within 60 seconds is an `error` and a
  `close` with `1006`, and `send` or `ping` while CONNECTING throw as in RN. A peer close code
  and reason are reported only when its close frame arrives; a drop after client close is an
  abnormal failure. Application stop attempts a nonblocking 1001 close on open sockets and
  emits no later JS event; delivery is best effort if unread input remains.

Explicit limits: WebSocket connection plus upgrade has a 30-second host deadline, and the close
handshake a separate 60-second deadline; the 30-second value is host policy, not inherited from
OkHttp. Each WebSocket poll shares a 1 MiB wire-byte budget across WebSocket sockets; its 256
event cap uses canonical pending networking-event capacity after the separate HTTP poll.
Incomplete messages reserve a slot across polls. The eight-socket load proof reached
each limit. Cookies are neither stored nor sent (`withCredentials` has no effect and
`clearCookies` calls back `false`); a response with a `Content-Encoding` other than
`identity` fails, and so does a string request body with `Content-Encoding: gzip` (that path
has no check of its own; the header is dropped for other bodies, as on Android); the body is
buffered and delivered once (no incremental updates, no upload or download progress events);
`uri` bodies and `FormData` file parts fail explicitly; there is no pooling, keep-alive,
HTTP/2, proxy or system trust configuration, offline or reconnect behavior. For `WebSocket`:
no extensions (OkHttp offers `permessage-deflate`), cookies, proxy, HTTP/2 or reconnect policy;
the adapter constructs handshake-owned `Host`, `Upgrade`, `Connection`, key, version and
protocol headers. A server selecting no subprotocol is accepted; an unoffered protocol is
rejected. Invalid UTF-8 text sends protocol close 1007 on the wire, while RN observes terminal
error and close 1006. A peer close code/reason is never inferred from the client's request.
Closing while CONNECTING fails the attempt, unlike Android's module no-op; failure text differs
from OkHttp. Cancellation sends 1001 best-effort, with an immediate TCP drop possible when
input remains unread. Godot Android WebSocket runtime is untested. A Web export needs a
browser-specific WebSocket transport; browser WebSocket behavior is outside this proof.

### Device services

`Linking`, `Clipboard` and `Vibration` are RN's original modules, exported from `react-native`
through lazy getters (`src/device-services.js`): importing `react-native` constructs none of
them, and a host without the native modules fails only where an API is first read. One
`DeviceServices` per `FabricApplication` (`native/device_services.{h,cpp}`) installs three C++
TurboModules in the application's registry: `LinkingManager` (the iOS contract, which is what
`Linking.js` uses when `Platform.OS` is `"godot"`), `Clipboard` and `Vibration`. The platform calls
sit behind a backend struct (`native/device_services_core.h`); the default is Godot's
(`native/godot_device_backend.cpp`) and a validation run replaces any of it through the
application's `validation_device_services` meta, a Dictionary of Callables. The modules are created
by the first read of their API; a stop makes retained methods throw `E_MODULE_DISPOSED`
synchronously and drops every queued event and settlement. The [research
note](research/device-services.md) has the contract and its sources.

| API | Supported | Rejected, and how |
| --- | --- | --- |
| `Linking.openURL(url)` | Resolves `true` after `OS.shell_open` returns `OK` for an absolute URL with an RFC 3986 scheme | A non-string or `''` throws RN's own invariant (`Invalid URL: ...`) before any native call; a string without a scheme, or a backend that refuses, rejects `Unable to open URL: <url>`; the scheme-less string never reaches the backend |
| `Linking.canOpenURL(url)` | `true` for a URL with a scheme and at least one character after the colon, `false` otherwise, never asking the platform | The same invariant for a non-string or `''` |
| `Linking.getInitialURL()` | The first valid `--uri=<url>` of `OS.get_cmdline_user_args()`, then of `OS.get_cmdline_args()`, one pair of quotes removed; `null` without one; stable for the application | Throws `E_MODULE_DISPOSED` after a stop |
| `Linking.addEventListener('url', listener)` | `{url}` once per link, to every listener of every root, in subscription order, from `FabricApplication.deliver_url(url)` | `deliver_url` returns `false` and emits nothing for a string without a scheme and after a stop |
| `Linking.openSettings()` | none | Rejects `Unable to open app settings: unavailable on Godot` |
| `Linking.sendIntent(...)` | none | Rejects `Unsupported` in RN's JavaScript outside Android |
| `Clipboard.getString()` | The text, `''` for an empty clipboard, read from the platform on every call | Rejects `E_CLIPBOARD_UNAVAILABLE` where the DisplayServer has no clipboard (headless) |
| `Clipboard.setString(text)` | Returns nothing; multibyte text and line breaks survive | `setString(undefined)` or a non-string fails at the bridge; throws `E_CLIPBOARD_UNAVAILABLE` without a clipboard. RN prints its deprecation notice once on the first read of `Clipboard` |
| `Vibration.vibrate(ms)` | `vibrate()` is 400 ms; a finite, non-negative number goes to `Input.vibrate_handheld` (a silent no-op on desktop); an array is scheduled by RN's JavaScript, one `vibrate(400)` per step | A pattern that is neither number nor array throws RN's own error; a negative or non-finite number throws `E_ARGUMENT` |
| `Vibration.cancel()` | Reaches the native module; Godot has nothing to cancel, so it is a no-op | RN's repeating pattern is not stopped by it, and a later `vibrate()` is ignored while it runs: RN's own behavior |
| `vibrateByPattern` on the native module | none: RN's JavaScript never calls it with this platform | Throws `E_UNSUPPORTED` |

`FabricApplication.deliver_url(url: String) -> bool` is the entry point of a deep link that reaches
the running application; a mobile plugin or a launcher script would call it. A link delivered before
JavaScript has read `Linking` is accepted and reaches no listener. The headless engine has no
clipboard, so the real backend rejects there; every test and example application replaces the
backend, so nothing opens a real URL or touches the real pasteboard. Alert, Share, Settings and
BackHandler are not implemented, and `canOpenURL` cannot know which handlers are installed.

Native runtime acceptance currently targets macOS arm64. The experimental
[iOS build path](IOS_BUILD.md) has arm64 device/simulator build and link proof;
exported runtime acceptance remains pending. Linux, Windows, Android and Web
need their own dependency/toolchain and runtime validation. Installing
Godot on those systems does not by itself make this GDExtension available.

Two named surfaces are exercised by the shared example. Portals, overlapping
surface input, ecosystem TurboModules, JS worker-thread execution,
10,000-row virtualized lists and Hermes RSS/heap profiling are not certified.
The generic list demonstrates reconciliation and scrolling of mounted rows, while
RN's original lists window their cells on the ScrollView (the Lists row above).

Native GUI readback proves rendering at logical dimensions. Viewport-injected
input does not prove physical mouse/touch hardware, system IME or DPI/Retina.
