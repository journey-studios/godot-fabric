# Findings from the platform experiments

This research describes the renderer and generic fixtures included in this
repository. Evidence is recorded separately from broader compatibility goals.

## Why Fabric

An original React renderer can preserve hooks and reconciliation while another
host provides native nodes. Fabric adds established ShadowTree, Yoga, mounting
transactions, event transport and immutable native state contracts. Godot supplies
the actual Controls and drawing. The implementation compiles the portable C++
pieces and adds a GDExtension without rebuilding Godot.

This makes Godot an experimental host for React Native's rendering architecture.
It does not make mobile native modules or every React Native library portable.
Host-neutral hooks and component composition are more reusable than dependencies
on platform modules, native gestures, Reanimated, browser DOM or unrestricted SVG.

## Libraries as contract probes

The unmodified React Native Chart Kit package exercises hooks, events, SVG
ordering, text and animation-frame scheduling. Its unsupported rotated-label
case must fail explicitly through the CLI. A native SVG refresh failure must
finish the mounting transaction and leave later SVGs usable.

NativeWind exercises its original compiler/runtime with supported host props,
responsive logical width, pressed styles, variables and manual theme changes.
The typography demo extends that probe to nested original Fabric Text, actual
variable-font weights and line-height measurement. Unsupported native modules
are not silently substituted with success.

## Bugs found by real native execution

1. **Paragraph props can outlive attributed state.** Read current ParagraphProps
   for numberOfLines and ellipsizeMode; old ParagraphState can retain content
   while those props change. Measure and paint must agree after prop-only updates.
2. **Godot line limits can force ellipses.** Clip limits measured/drawn lines
   separately; tail uses native trimming and ellipsis behavior.
3. **Yoga callbacks can be noexcept.** Report rejected native layouts without
   letting exceptions terminate the process. Preserve one hidden attachment
   measurement per rejected attachment, because original Fabric indexes them.
4. **Empty/trailing lines need a sentinel.** A zero-width sentinel preserves
   those rows. Its font must not add glyph spacing; its final run's line height
   must remain measurable.
5. **Line ranges are half-open.** Adjacent spans must not raise each other's
   line heights. A separate terminal-sentinel exception preserves empty and
   trailing-newline height. The release tests both directions and lifecycle cleanup.

## Verification boundaries

Editor import, headless native execution, graphical rendering, pixels, input,
state identity and negative CLI exits answer different questions. Exit 0 alone
is insufficient: the runner also checks error logs and an acceptance marker.
Native negative cases require explicit failure without crash/timeout and with
balanced cleanup. [Evidence](../evidence/README.md) states what actually ran.

## Host contract investigations

- [Pointer transport and capture lifetime](pointer-capture-boundary.md): pinned
  EventTarget flags, pending/active capture, removal and commit-order constraints.
  This is source investigation, distinct from executed focus/runtime proof.

- [Captured pointer geometry](pointer-geometry.md): original RN numerical
  counterexamples, native projection, contact history and executed Godot proof.

- [Imperative EventTarget boundary](event-target-boundary.md): three pinned
  source gaps reproduced with 119 original-ref checks; current-parent correction
  passes 102 checks/variant. Native integration and responder controls remain pending.

- [Text layout](text-layout.md): RN's `measureLines` through a Godot platform
  `TextLayoutManager`, so `onTextLayout` and the Yoga baseline come from the one
  shaped paragraph the host measures and paints; the font-table oracle, the
  measured tolerance and the platform divergences.

## Useful next experiments

- Span interaction and explicit font invalidation (Text's baseline and `onTextLayout` are done: see [Text layout](text-layout.md)).
- Keyboard focus/navigation and system IME, with real OS input proof.
- Virtualized lists with 10,000 records, using frame-time and Hermes memory profiles.
- Platform-specific builds and tests before advertising Windows/Linux/mobile support.

Rust should follow a measured bottleneck. Fabric/Hermes already execute C++; an
additional FFI boundary alone does not demonstrate better performance.

## Related projects

| Project | Approach | Relevance to Godot Fabric |
| --- | --- | --- |
| [Rufino](rufino.md) | TypeScript/TSX authoring that generates native Godot scenes and resources | Generated types, a development CLI and a possible static scene shell around a dynamic Fabric surface |

The Rufino note distinguishes its JSX authoring runtime from React execution
and records source evidence, compatibility boundaries and a proposed experiment.

## Primary references

- [React Native rendering overview](https://reactnative.dev/architecture/render-pipeline)
- [Out-of-tree platforms](https://reactnative.dev/docs/out-of-tree-platforms)
- [Original RN 0.87.1 renderer sources](https://github.com/facebook/react-native/tree/v0.87.1/packages/react-native/ReactCommon/react/renderer)
- [Nested Text and inheritance](https://reactnative.dev/docs/text)
- [Godot TextParagraph](https://docs.godotengine.org/en/stable/classes/class_textparagraph.html)
- [Godot TextServer](https://docs.godotengine.org/en/stable/classes/class_textserver.html)
- [NativeWind](https://www.nativewind.dev/)

The versioned source and lockfiles define this release; online documentation
may evolve independently.
