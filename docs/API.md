# API and compatibility limits

The examples use React and JSX. `react-native` imports resolve to the Godot
facade through the provided bundler; another bundler needs equivalent platform
resolution and the original React Native syntax transforms.

The facade exposes View, Text, Pressable, ScrollView, Button and single-line
TextInput for public composition. The [typed form](../examples/form/README.md)
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
| View / Yoga | Layout, constraint-based sizes, supported appearance and native Controls | No promise of all React Native styles or intrinsic native widget behaviors |
| Text | Nested/composite Text, inherited attributes, variable family/weight, size/spacing, lineHeight, wrapping, left/center/right alignment, numberOfLines, tail/clip | Two bundled families plus initial Theme default; no selection, span press, onTextLayout, inline Controls, italic/decoration/shadow, head/middle ellipsis |
| Button | Public title/onPress/disabled/static color/testID/ref; native Button, measured title and keyboard activation | Godot color sets the background; casing is preserved; callback has no mobile gesture payload; accessibility/TV props are rejected |
| TextInput | Public controlled/uncontrolled single-line LineEdit, acknowledged edits, UTF-16 selection, initial autoFocus, editing events, native measurement and ref commands | Only layout/appearance/fontSize/static color styles; unsupported props fail; system IME, virtual keyboard, multiline, mobile policy and undo parity remain open |
| Pressable | Original Pressability and responder negotiation, supported press callbacks, disabled behavior | Hover, keyboard activation, accessibility integration and complete multitouch require more work |
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
fixtures run in CI. Other facade exports do not yet have Godot declarations;
this is not the complete typed SDK or an independently packaged consumer.

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
`setSelection` and `getNativeRef` are the exposed input ref subset. Static
`TextInput.State`, richer host/DOM-node methods and platform keyboard services
are not implemented.

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
- The initial Theme font is captured when a surface starts. Dynamic Theme/font
  loading, system font scaling and React Native baseline semantics are pending.

## Platform and performance

The build currently targets macOS arm64 only. Linux, Windows, iOS, Android and
Web need their own dependency/toolchain and runtime validation. Installing
Godot on those systems does not by itself make this GDExtension available.

Multiple surfaces/portals, ecosystem TurboModules, JS worker-thread execution,
10,000-row virtualized lists and Hermes RSS/heap profiling are not certified.
The generic list demonstrates reconciliation and scrolling of mounted rows.

Native GUI readback proves rendering at logical dimensions. Viewport-injected
input does not prove physical mouse/touch hardware, system IME or DPI/Retina.
