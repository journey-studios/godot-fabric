# Runnable examples

These examples share the root Godot project and pinned native runtime. Each
folder has a JSX/TSX application, a Godot scene and instructions. They are runnable
fixtures, not independent npm packages or a published SDK.

## Start

Requirements: macOS arm64, Node 22.13+, Python 3.12+, Xcode Command Line Tools
and official Godot 4.7.2. Follow the [root setup instructions](../README.md#run).

```sh
npm run setup
npm run examples:list
npm run example -- counter
```

The launcher rebuilds JSX/styles, prepares extension startup, imports resources
and opens the selected scene. Edit that example's `App.jsx` or `App.tsx`, close Godot and run
the command again. Rebuild native C++ changes with `npm run setup`.

## Catalog

| Name | Case | UI API | Source and scene |
| --- | --- | --- | --- |
| [shared](shared/README.md) | Two AppRegistry roots, props and independent lifetimes | Public | [App](shared/App.jsx) · [scene](shared/scene.tscn) |
| [counter](counter/README.md) | Minimal React state and public Pressable | Public | [App](counter/App.jsx) · [scene](counter/scene.tscn) |
| [view](view/README.md) | Fabric stacking, rectangular overflow, public geometry and four solid border colors | Public | [App](view/App.jsx) · [scene](view/scene.tscn) |
| [coordinates](coordinates/README.md) | Root/local/screen points, genuine move-out/return and content density | Public | [App](coordinates/App.jsx) · [scene](coordinates/scene.tscn) |
| [transforms](transforms/README.md) | Original RN affine styles, percentage origins, flattening, public measures and transformed input | Public | [App](transforms/App.jsx) · [scene](transforms/scene.tscn) |
| [runtime](runtime/README.md) | Intervals, microtasks, task order and cancellable frames | Public | [App](runtime/App.jsx) · [scene](runtime/scene.tscn) |
| [refs](refs/README.md) | Original RN refs, affine measures and imperative props | Public | [App](refs/App.jsx) · [scene](refs/scene.tscn) |
| [tree](tree/README.md) | Native IDs, original documents, logical traversal, RawText and retained collection snapshots | Public | [App](tree/App.jsx) · [scene](tree/scene.tscn) |
| [focus](focus/README.md) | Original TextInput.State, real LineEdit focus, ref replacement and reentrant retirement | Public | [App](focus/App.jsx) · [scene](focus/scene.tscn) |
| [pointers](pointers/README.md) | Original pointer transport, public View capture and selective multi-root lifetime | Public | [App](pointers/App.jsx) · [scene](pointers/scene.tscn) |
| [metrics](metrics/README.md) | Original Dimensions, uniform content density and subscription lifetime | Public | [App](metrics/App.jsx) · [scene](metrics/scene.tscn) |
| [services](services/README.md) | Typed GDScript calls/signals, consistent state and shared Zustand data | Public | [App](services/App.jsx) · [scene](services/scene.tscn) |
| [form](form/README.md) | Typed public Button/TextInput with native editing and focus | Public | [App](form/App.tsx) · [scene](form/scene.tscn) |
| [react](react/README.md) | State, keyed reconciliation, effects, Suspense and errors | Internal | [App](react/App.jsx) · [scene](react/scene.tscn) |
| [layout](layout/README.md) | Intrinsic text measurement and responsive layout | Internal | [App](layout/App.jsx) · [scene](layout/scene.tscn) |
| [input](input/README.md) | Controlled native editing, selection and focus | Internal | [App](input/App.jsx) · [scene](input/scene.tscn) |
| [pressable](pressable/README.md) | Upstream Pressability and responder negotiation | Internal | [App](pressable/App.jsx) · [scene](pressable/scene.tscn) |
| [scroll](scroll/README.md) | Scrolling, filtering, selection and editing | Internal | [App](scroll/App.jsx) · [scene](scroll/scene.tscn) |
| [chart](chart/README.md) | Original Chart Kit with the supported SVG subset | Internal | [App](chart/App.jsx) · [scene](chart/scene.tscn) |
| [nativewind](nativewind/README.md) | Utility classes, variables, breakpoints and manual theme | Public | [App](nativewind/App.jsx) · [scene](nativewind/scene.tscn) |
| [typography](typography/README.md) | Nested text, fonts, wrapping and retained child state | Mixed | [App](typography/App.jsx) · [scene](typography/scene.tscn) |
| [parity](parity/README.md) | Thirteen shared RN/Godot reference cases; automated | Public | [fixture](../tests/parity/fixture.jsx) · [scene](parity/scene.tscn) |

**Public** means the UI uses supported `react-native` imports. Diagnostic
exports may still call local harness helpers. **Internal** uses wrappers in
`src/components.jsx` and cannot be copied unchanged into an ordinary RN app.
**Mixed** combines public UI with internal probes. These labels do not certify
the full RN API. The form exercises the new public single-line `TextInput`;
the older input and scroll probes still use the internal adapter. See the [API limits](../docs/API.md)
and [parity baseline](../docs/compatibility/BASELINE.md).

## Gallery

| Public TSX form | Public counter | NativeWind |
| --- | --- | --- |
| [![Public form](../docs/evidence/public-controls/form-initial.png)](form/README.md) | [![Counter](../docs/evidence/public-controls/counter-initial.png)](counter/README.md) | [![NativeWind](../docs/evidence/public-controls/nativewind-initial.png)](nativewind/README.md) |

Every interactive example's README has its own renderer capture.

![Original RN focused input after callback ref replacement](../docs/evidence/focus/focus-updated.png)

The [focus example](focus/README.md) compares the original input singleton with
the actual Viewport owner and LineEdit signals. It exercises two roots,
editability, retained refs, reparenting and reentrant retirement. Hardware
keyboard/IME and mobile differentials remain separate acceptance requirements.

![Public View ordering, clipping and border colors](../docs/evidence/view/view-initial.png)

The [View example](view/README.md) compares injected input targets, public/native
geometry and actual renderer RGBA samples, including keyed reorder and border
removal. Its [checkpoint](../docs/evidence/view/README.md) preserves the previous
host's expected failures and the offset-root input/measurement gap discovered
in that checkpoint. The later [coordinate example](coordinates/README.md)
addresses it through genuine movement gestures and independent public measures.

![Scaled root A stays held while root B remains ready](../docs/evidence/coordinates/coordinate-scaled.png)

Its [evidence](../docs/evidence/coordinates/README.md) records root/target/screen
coordinates, surface movement and scaling, raw window pixels at density two,
and the first contact before cached metrics refresh.

![Original RN percentage origins, ordered transforms and mirrored/sheared Views](../docs/evidence/transforms/transform-initial.png)

The [transform gallery](transforms/README.md) compares independent analytical
matrices/corners with actual Controls, original public measurements, mouse/touch
events and renderer pixels. Resize and removal preserve refs and React state
while an anonymous wrapper materializes and flattens again. Its
[evidence](../docs/evidence/transforms/README.md) keeps the previous host's
expected failures, explicit unsupported-transform cases and invalid-embedding
input cancellation separate.

![Original RN documents and keyed traversal](../docs/evidence/tree/tree-updated.png)

The [read-only tree example](tree/README.md) uses original RN documents and
collections to check IDs, root isolation, keyed reorder/replacement, text updates
and retirement. It records pinned collection snapshots and RawText quirks;
its [evidence](../docs/evidence/tree/README.md) includes the same fixture failing
against the previous JS configuration with the unchanged native host.

![Two registered roots share one application](../docs/evidence/shared-roots/updated.png)

The [shared application](shared/README.md) adds explicit native application and
surface properties. Its controls use public RN imports; final resource/SDK
authoring and multi-root mobile reference certification remain open.

![Game state reaches both roots through typed services](../docs/evidence/game-services/services-remounted.png)

The [services example](services/README.md) adds GDScript methods/signals, a
consistent initial snapshot, shared Zustand state, pause and accepted-job
lifetime. Its images and positive/negative assertions have a separate
[evidence record](../docs/evidence/game-services/README.md).

## Validation and images

```sh
npm run example -- layout --check       # bounded native check; exits
npm run example -- layout --headless    # bounded contracts; no GPU rendering
npm run example -- layout --capture     # native check plus renderer readbacks
npm run test:examples                   # every interactive case, headless
npm run test:examples -- --capture       # same suite, renderer + screenshots
npm run example -- parity --headless    # automated differential-oracle fixture
```

The default example is the public counter; the default mode is interactive.
`--check`, `--headless` and `--capture` run
acceptance assertions and close Godot. Capture requires a graphical renderer
and cannot be combined with `--headless`. Individual runs write `build/report.json`;
the full suite preserves one report per case in `build/examples/headless/` or
`build/examples/native/`.
Native checks must run sequentially because they share generated output.
Images are Godot Viewport readbacks, not desktop screenshots. Retained results
are in [validation evidence](../docs/evidence/README.md).

The parity case always runs automatically; it has no manual gallery mode or
capture flag. Its reference runners launch original RN on iOS/Android. They
do not establish Godot support on either OS. The separate
[iOS consumer experiment](../docs/IOS_BUILD.md) records its narrower export and
runtime proof; the interactive catalog remains a macOS arm64 laboratory.

## Organization

[catalog.json](catalog.json) supplies the launcher and native scene runner.
[entry.jsx](entry.jsx) is the shared Fabric bootstrap and diagnostic bridge;
`src/` contains the renderer/platform implementation. Native acceptance helpers
remain in `scripts/`. Parity's identical fixture stays in `tests/parity/` so
the Godot, iOS and Android oracles use the same source.

The root `main.tscn`, `layout.tscn` and other original scene paths delegate to
these scenes for compatibility. Godot's main scene remains the React lifecycle
demo. Each example scene also opens directly in the root Godot editor after setup.

## Public pointer capture

![Original RN pointer roots after React key replacement](../docs/evidence/pointers/pointers-updated.png)

The [pointer laboratory](pointers/README.md) tests pending queries, next-event
got/lost, shared-root contact IDs, selective cancellation, removal and app
retirement. It passes 132/146 headless/native checks with 12 pixels; the isolated
exception/real-focus stop fixture passes 43. See [curated evidence](../docs/evidence/pointers/README.md)
for 144 native assertions, two unchanged-source crash controls and remaining
hardware/transformed/mobile boundaries.
