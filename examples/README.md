# Runnable examples

These examples share the root Godot project and pinned native runtime. Each
folder has a JSX application, a Godot scene and instructions. They are runnable
fixtures, not independent npm packages or a published SDK.

## Start

Requirements: macOS arm64, Node 22.13+, Python 3.12+, Xcode Command Line Tools
and official Godot 4.7.2. Follow the [root setup instructions](../README.md#run).

```sh
npm run setup
npm run examples:list
npm run example -- react
```

The launcher rebuilds JSX/styles, prepares extension startup, imports resources
and opens the selected scene. Edit that example's `App.jsx`, close Godot and run
the command again. Rebuild native C++ changes with `npm run setup`.

## Catalog

| Name | Case | UI API | Source and scene |
| --- | --- | --- | --- |
| [react](react/README.md) | State, keyed reconciliation, effects, Suspense and errors | Internal | [App](react/App.jsx) · [scene](react/scene.tscn) |
| [layout](layout/README.md) | Intrinsic text measurement and responsive layout | Internal | [App](layout/App.jsx) · [scene](layout/scene.tscn) |
| [input](input/README.md) | Controlled native editing, selection and focus | Internal | [App](input/App.jsx) · [scene](input/scene.tscn) |
| [pressable](pressable/README.md) | Upstream Pressability and responder negotiation | Internal | [App](pressable/App.jsx) · [scene](pressable/scene.tscn) |
| [scroll](scroll/README.md) | Scrolling, filtering, selection and editing | Internal | [App](scroll/App.jsx) · [scene](scroll/scene.tscn) |
| [chart](chart/README.md) | Original Chart Kit with the supported SVG subset | Internal | [App](chart/App.jsx) · [scene](chart/scene.tscn) |
| [nativewind](nativewind/README.md) | Utility classes, variables, breakpoints and manual theme | Public | [App](nativewind/App.jsx) · [scene](nativewind/scene.tscn) |
| [typography](typography/README.md) | Nested text, fonts, wrapping and retained child state | Mixed | [App](typography/App.jsx) · [scene](typography/scene.tscn) |
| [parity](parity/README.md) | Nine shared RN/Godot reference cases; automated | Public | [fixture](../tests/parity/fixture.jsx) · [scene](parity/scene.tscn) |

**Public** means the UI uses supported `react-native` imports. Diagnostic
exports may still call local harness helpers. **Internal** uses wrappers in
`src/components.jsx` and cannot be copied unchanged into an ordinary RN app.
**Mixed** combines public UI with internal probes. These labels do not certify
the full RN API. Public `TextInput` remains unavailable; the input and scroll
editing probes use an internal native adapter. See the [API limits](../docs/API.md)
and [parity baseline](../docs/compatibility/BASELINE.md).

## Validation and images

```sh
npm run example -- layout --check       # bounded native check; exits
npm run example -- layout --headless    # bounded contracts; no GPU rendering
npm run example -- layout --capture     # native check plus renderer readbacks
npm run test:examples                   # every interactive case, sequentially
npm run example -- parity --headless    # automated differential-oracle fixture
```

The default mode is interactive. `--check`, `--headless` and `--capture` run
acceptance assertions and close Godot. Capture requires a graphical renderer
and cannot be combined with `--headless`. Individual runs write `build/report.json`;
the full suite preserves one report per case in `build/examples/headless/`.
Native checks must run sequentially because they share generated output.
Images are Godot Viewport readbacks, not desktop screenshots. Retained results
are in [validation evidence](../docs/evidence/README.md).

The parity case always runs automatically; it has no manual gallery mode or
capture flag. Its reference runners launch original RN on iOS/Android. They
do not establish Godot support on either OS. Godot builds remain macOS arm64.

## Organization

[catalog.json](catalog.json) supplies the launcher and native scene runner.
[entry.jsx](entry.jsx) is the shared Fabric bootstrap and diagnostic bridge;
`src/` contains the renderer/platform implementation. Native acceptance helpers
remain in `scripts/`. Parity's identical fixture stays in `tests/parity/` so
the Godot, iOS and Android oracles use the same source.

The root `main.tscn`, `layout.tscn` and other original scene paths delegate to
these scenes for compatibility. Godot's main scene remains the React lifecycle
demo. Each example scene also opens directly in the root Godot editor after setup.
