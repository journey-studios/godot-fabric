# API and compatibility limits

The examples use React and JSX. `react-native` imports resolve to the Godot
facade through the provided bundler; another bundler needs equivalent platform
resolution and the original React Native syntax transforms.

The facade currently exposes View, Text, Pressable and ScrollView for public
composition. The older Button and controlled TextInput probes import from
`src/components.jsx`; `react-native` TextInput/NativeWind styling is explicitly
unavailable. Passing the legacy probe is not evidence of that mobile API.

The [parity audit](PARITY.md) records current public exports and verified gaps;
the [1.0 roadmap](../ROADMAP.md) assigns their priorities, dependencies and
completion criteria. Current implementation evidence is distinct from planned
RN compatibility.

| Area | Implemented subset | Important limits |
| --- | --- | --- |
| React | State/effects, Context, memo, keyed identity, callback refs/cleanup, external store, transitions, async Suspense, error boundaries, concurrent root | Production renderer; no certified dev StrictMode, Fast Refresh or DevTools integration |
| View / Yoga | Layout, constraint-based sizes, supported appearance and native Controls | No promise of all React Native styles or intrinsic native widget behaviors |
| Text | Nested/composite Text, inherited attributes, variable family/weight, size/spacing, lineHeight, wrapping, left/center/right alignment, numberOfLines, tail/clip | Two bundled families plus initial Theme default; no selection, span press, onTextLayout, inline Controls, italic/decoration/shadow, head/middle ellipsis |
| TextInput legacy probe | Controlled single-line LineEdit, editing acknowledgement, selection and registered commands | Public RN export unavailable; system IME, virtual keyboard, multiline, arbitrary mobile props and undo transformation need separate proof |
| Pressable | Original Pressability and responder negotiation, supported press callbacks, disabled behavior | Hover, keyboard activation, accessibility integration and complete multitouch require more work |
| ScrollView | Original Fabric descriptor/state, vertical/horizontal scroll, contentOffset, scrollTo/scrollToEnd without animation, scroll events and responder-mediated drag | All children mount; no virtualization, inertia, bounce, paging, zoom or complete nested/multitouch scrolling |
| NativeWind | Resolved utility styles, responsive logical viewport, supported pressed styles, CSS variables and manual theme | Unsupported style/native modules fail explicitly; no Reanimated or automatic system-theme contract |
| SVG / charts | SVG/G/Defs/ClipPath/Path/Rect/Circle/Line/LinearGradient/Stop and simple SVG text, tested with unmodified Chart Kit | Budget 2048×2048, unscaled viewBox, no arbitrary transforms, nested SVG certification or full SVG typography |

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
