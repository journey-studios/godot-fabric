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

The facade exposes View, Text, Pressable, TouchableWithoutFeedback,
TouchableHighlight, ScrollView, Button and single-line TextInput for public
composition. The [typed form](../examples/form/README.md)
exercises the new controls through ordinary RN imports. Internal probes remain
separate; neither those probes nor the public form certify the complete mobile
API. NativeWind TextInput interop still requires dedicated validation.

The [parity audit](PARITY.md) records current public exports and verified gaps;
the [1.0 roadmap](../ROADMAP.md) assigns their priorities, dependencies and
completion criteria. Current implementation evidence is distinct from planned
RN compatibility.

| Area | Implemented subset | Important limits |
| --- | --- | --- |
| React | State/effects, Context, memo, keyed identity, callback refs/cleanup, external store, transitions, async Suspense, error boundaries, concurrent root | Production renderer; no certified dev StrictMode, Fast Refresh or DevTools integration |
| View / Yoga | Original public RCTView/View descriptor, Yoga layout, Fabric stacking order, rectangular overflow clipping, solid physical-edge border colors, public geometry and invertible 2D affine styles | RTL, singular/3D transforms, rounded descendant masks, fractional geometry and full StyleSheet utilities remain open |
| Text | Nested/composite Text, inherited attributes, variable family/weight, size/spacing, lineHeight, wrapping, left/center/right alignment, numberOfLines, tail/clip | Two bundled families plus initial Theme default; no selection, span press, onTextLayout, inline Controls, italic/decoration/shadow, head/middle ellipsis |
| Button | Public title/onPress/disabled/static color/testID/ref; native Button, measured title and keyboard activation | Godot color sets the background; casing is preserved; callback has no mobile gesture payload; accessibility/TV props are rejected |
| TextInput | Public controlled/uncontrolled single-line LineEdit, acknowledged edits, UTF-16 selection, initial autoFocus, original TextInput.State and native focus/blur coordination, editing events, native measurement and ref commands | Only layout/appearance/fontSize/static color styles; unsupported props fail; system IME, virtual keyboard, multiline, mobile policy and undo parity remain open |
| Pressable | Original Pressability and responder negotiation, supported press callbacks, disabled behavior, move-out/return under Godot surface translation/scale, mouse/touch movement under RN affine parents | Hover, keyboard activation, accessibility integration and complete multitouch require more work |
| Touchables | [Original TouchableWithoutFeedback and TouchableHighlight](../examples/touchables/README.md): RN's Pressability, callback order, underlay and child opacity, delayPressOut, long press, hitSlop/retention, nesting, disabled and removal mid-press, on two roots | TouchableOpacity throws (RN 0.87.1 Animated requires NativeAnimatedModule); no TouchableNativeFeedback, focus/keyboard activation, accessibility or concurrent cross-root presses |
| ScrollView | Original Fabric descriptor/state, vertical/horizontal scroll, contentOffset, scrollTo/scrollToEnd without animation, scroll events and responder-mediated drag | All children mount; no virtualization, inertia, bounce, paging, zoom or complete nested/multitouch scrolling |
| NativeWind | Resolved utility styles, responsive logical viewport, supported pressed styles, CSS variables and manual theme | Unsupported style/native modules fail explicitly; no Reanimated or automatic system-theme contract |
| SVG / charts | SVG/G/Defs/ClipPath/Path/Rect/Circle/Line/LinearGradient/Stop and simple SVG text, tested with unmodified Chart Kit | Budget 2048×2048, unscaled viewBox, no arbitrary transforms, nested SVG certification or full SVG typography |

## Typed consumer and native controls

Run `npm run type-check` with [tsconfig.godot.json](../tsconfig.godot.json).
The declarations in [types/react-native.ts](../types/react-native.ts) derive
View, Text, Button, TextInput, styles/events and native refs from the pinned RN
types, narrowing them to this implementation. They are checked as project
source with strict TypeScript. Third-party declaration bodies use
`skipLibCheck`; the upstream contract inventory still checks their source hashes
and signatures. Positive consumer assignments and negative unsupported-prop
fixtures run in CI. AppRegistry's registration subset and RootTagContext are
also typed. Other facade exports do not yet have Godot declarations;
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
fixture’s next children-only React commit restores the declared native ID. See
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
checks its captured offsets equal client coordinates.

This bounded desktop path uses a generated, SHA-pinned native RN overlay; the
downloaded sources and reconciler remain unchanged. SDK headers and binaries
identify the overlay and require a freshly packaged matching SDK. It does not
enable original imperative EventTarget flags. The pinned RN AABB-subtraction
capture algorithm is explicitly incomplete; Godot local offsets intentionally
differ under rotation/skew/other-root embeddings. See the
[geometry receipt](evidence/pointer-geometry/README.md) and preceding
[lifetime receipt](evidence/pointers/README.md).

Actual queued coalescing, complete responder/PanResponder, hardware,
scroll/windows, cross-application stacking and mobile differentials remain
open. These executed subsets do not close GF-08/GF-13.

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

The native host rejects singular matrices (`E_TRANSFORM_SINGULAR`), 3D or
perspective (`E_TRANSFORM_3D`), nonfinite matrices (`E_TRANSFORM_NONFINITE`) and
results or inverses outside native coordinate precision (`E_TRANSFORM_RANGE`).
The six public rejection cases also verify cleanup after a partially mounted
tree; unsupported transforms do not silently fall back to identity.

The pinned upstream JS processor accepts CSS transform strings, but its
`translateX/translateY` string branch discards percentage units. Use array
syntax such as `{ translateX: "25%" }` for percentages. Array percentages have
native execution proof; CSS pixel strings have processor-contract proof only.
The adapter does not substitute a new CSS parser. This checkpoint does not
certify transformed clipping, every host component, transform animation,
singular/3D support or mobile reference parity.

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
stale responder. This input safety behavior does not implement singular JSX
rendering. Valid rotation/style changes during a held gesture, overlapping-root
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
- The initial Theme font is captured from the application's first surface.
  Per-root Theme fonts, dynamic Theme/font loading, system font scaling and
  React Native baseline semantics are pending.

## Platform and performance

### JavaScript runtime

The host compiles the pinned RN `TimerManager.cpp` unchanged. `setTimeout` and
`setInterval` preserve callback arguments and upstream delay coercion;
`clearTimeout`/`clearInterval` share cancellation authority. Missing callbacks
throw, while non-function timer callbacks return zero in this pinned RN version.
The original portable RN microtask and immediate modules provide
`queueMicrotask`, `setImmediate` and `clearImmediate` over Hermes Promise jobs.

Godot supplies deadlines and a bounded native work pump. Overdue intervals do
not replay missed ticks in a burst. RAF runs on Godot process frames with a
shared monotonic timestamp; callbacks scheduled during a frame wait for the
next frame. `performance.now()` uses the same monotonic clock.

Callback exceptions reach the host error channel. A failed one-shot releases
its registration; a failed interval remains recurring until cancelled.
Application shutdown cancels registered timers/frames and suppresses pending
portable microtask/immediate callbacks. Retained scheduling functions cannot
restart them after shutdown. Individual named root unmounts preserve application
timers/frames and module state; component effects must dispose their own subscriptions
and clocks. Ordinary Promises are not a cancellation API.

[Runtime evidence](evidence/runtime/README.md) documents the positive and
negative native checks. This is a partial GF-05 bootstrap: idle callbacks,
unhandled rejection/error-handler parity, URL/encoding/abort globals and
microtask starvation protection remain uncertified. No worker thread is used.

Native runtime acceptance currently targets macOS arm64. The experimental
[iOS build path](IOS_BUILD.md) has arm64 device/simulator build and link proof;
exported runtime acceptance remains pending. Linux, Windows, Android and Web
need their own dependency/toolchain and runtime validation. Installing
Godot on those systems does not by itself make this GDExtension available.

Two named surfaces are exercised by the shared example. Portals, overlapping
surface input, ecosystem TurboModules, JS worker-thread execution,
10,000-row virtualized lists and Hermes RSS/heap profiling are not certified.
The generic list demonstrates reconciliation and scrolling of mounted rows.

Native GUI readback proves rendering at logical dimensions. Viewport-injected
input does not prove physical mouse/touch hardware, system IME or DPI/Retina.
