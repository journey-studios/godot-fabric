# Text layout: `onTextLayout` and the Yoga baseline from one shaped paragraph

Status: first slice of GF-11, executed locally on macOS arm64 against pinned RN
0.87.1 and official Godot 4.7.2, headless. The probe ran **76 checks**; the
preceding host (main before this slice) ran the same bundle and failed exactly
its **5 normative checks**; three retained sabotages each fail the probe and the
independent oracle rejects every one of them. The example ran 18 checks
headless and 32 with the renderer. There is no hosted CI receipt and no
evidence record yet: both follow the implementation commit.

## What RN does

`ParagraphShadowNode` asks the platform's `TextLayoutManager` for the lines of a
paragraph in two places, both guarded by
`TextLayoutManagerExtended::supportsLineMeasurement()`:

- `layout()` (`ParagraphShadowNode.cpp:351-360`) calls `measureLines` when the
  `onTextLayout` prop is set and hands the rows to
  `ParagraphEventEmitter::onTextLayout`.
- `baseline()` (`ParagraphShadowNode.cpp:276-300`) calls it for Yoga's baseline
  callback and returns `LineMeasurement::baseline(lines)`, which is the first
  line's `ascender` (`TextMeasureCache.h:19-42`).

`supportsLineMeasurement()` (`TextLayoutManagerExtended.h:58-65`) is a
compile-time `requires` over the platform's `TextLayoutManager` type: it holds
only when that class has a `measureLines(AttributedStringBox, ParagraphAttributes,
Size)` returning `LinesMeasurements`. Where it does not hold, RN logs a warning
and the event is never emitted; the baseline is zero.

`ParagraphEventEmitter::onTextLayout` (`ParagraphEventEmitter.cpp:38-52`)
compares the rows with the last ones it dispatched and returns when they are
equal, so an unchanged layout is never emitted again; it records them before it
dispatches. The payload is `{lines: [{text, x, y, width, height, descender,
capHeight, ascender, xHeight}]}` as the event `textLayout` (`topTextLayout`).
`BaseParagraphProps.cpp:36-40` turns the `onTextLayout` prop into a boolean, and
`TextNativeComponent.js:47-55` declares the prop and the direct event
registration for the paragraph (`RCTText`) only: `NativeVirtualText` has neither,
so a nested `Text` never emits it. The TypeScript declaration is
`TextLayoutEvent` (`CoreEventTypes.js:64-86`).

What the two platforms report:

- **iOS** (`RCTTextLayoutManager.mm:365-413`, `getLinesForAttributedString`)
  enumerates the line fragments of the `NSLayoutManager`. `x`, `y`, `width` and
  `height` are the used rectangle of each fragment, `text` is the line's
  character range, `ascender` is the baseline measured down from the fragment's
  top and `descender` the rest of the fragment (`overallRect.height - baseline`).
  `capHeight` and `xHeight` are the font's, read at the line's first character.
  A `lineHeight` shifts the baseline by `(lineHeight - font.lineHeight) / 2`
  (`RCTAttributedTextUtils.mm:339-378`).
- **Android** (`FontMetricsUtil.kt:20-70`) reads the `Layout`: the line bounds,
  `-getLineAscent` and `getLineDescent`, the text range of the line, and
  `capHeight`/`xHeight` from the height of the bounds of the glyphs "T" and "x"
  drawn at 100 times the size. It adds a `baseline` field that iOS and the
  payload do not have.

## What this host did before

The host's `ParagraphLayout` derives from RN's portable `cxx`
`TextLayoutManager`, which has `measure` and no `measureLines`. So
`supportsLineMeasurement()` was false: `onTextLayout` was never delivered and a
`alignItems: 'baseline'` row aligned the tops of its texts, as if every baseline
were zero. `src/text.jsx` also rejected `onTextLayout` before it reached
native code.

## The implementation

- **A Godot platform `TextLayoutManager`.** RN selects one `TextLayoutManager`
  per platform directory. `native/text_platform/react/renderer/textlayoutmanager/`
  holds the Godot one: the public surface of the portable `cxx` class plus a
  virtual `measureLines` that answers no rows by default. `native/CMakeLists.txt`
  compiles its `.cpp` and puts its directory on the include path in place of the
  `cxx` ones, header and source together. With it
  `supportsLineMeasurement()` is true, which the probe observes as events and as
  a baseline callback that reaches the host.
- **A guard against drift.** The platform manager is a copy of RN's portable one
  plus four documented additions (its header comment, the `Size.h` include, the
  virtual `measureLines` declaration and its default definition).
  `tests/text-platform-manager.test.mjs`, part of `test:contracts` and static,
  removes those blocks by their exact text and compares the rest of both files
  with the pinned `ReactCommon/.../platform/cxx` ones; any other difference fails
  and says to update the copy from the pinned RN. It also checks that
  `TextLayoutManagerExtended.h` and `ParagraphShadowNode.cpp` still probe and call
  `measureLines(AttributedStringBox, ParagraphAttributes, Size)` returning
  `LinesMeasurements`, as our declaration has it.
- **One shaper.** `ParagraphLayout` overrides `measure` and `measureLines` over
  the same `prepare()`, the `PreparedParagraph` that also paints. `measureLines`
  converts the prepared rows; it has no line breaker of its own, so the rows
  RN receives are the rows that were measured and are drawn. `ParagraphLine`
  gained the row's top and the code-point range it covers (`start`, `end`).
- **Contract of the fields.**
  - `x`, `y`, `width`, `height`, `ascender` and `descender` follow iOS: the used
    rectangle of the line box, `ascender` the baseline inside the box (so it
    includes the offset that centres an explicit `lineHeight`, which the host
    already applies when it places the glyphs) and `descender = height -
    ascender`.
  - `capHeight` and `xHeight` follow Android: the height of the ink bounds of
    "T" and "x" at the font and size of the line's first run, taken from the
    glyph outline (`TextServer.font_get_glyph_contours`).
  - `text` is the line's own text. The rows tile the paragraph's text: a line
    owns its break characters and the spaces trimmed at a wrap, the last one
    runs to the end, and the host's U+200B sentinel is never in any of them.
- **Failure.** Yoga calls the baseline through a C function pointer, so
  `measureLines` has the `try`/`catch` that `measure` has: a paragraph that
  cannot be laid out reports its error once through the host's reporter and
  yields no rows (an empty event is never dispatched and the baseline is zero).
- **Counters.** The application status gained `textLineMeasurements`, the number
  of `measureLines` calls, next to `textMeasurements`; the probe uses it to tell
  the baseline callback apart from the event.
- **JS.** `src/text.jsx` accepts `onTextLayout` on the paragraph and registers
  the prop and `topTextLayout` on the `RCTText` ViewConfig only. A non-function
  value throws `Godot Text onTextLayout must be a function`. On a nested span the
  handler is dropped, as RN does. `onPress`, `onPressIn`, `onPressOut`,
  `onLongPress`, `selectable` and `adjustsFontSizeToFit` are still rejected.
  `types/react-native.ts` gains `onTextLayout` and `TextLayoutEvent`.
- **SDK.** The platform header is published at
  `include/sdk/text_platform/react/renderer/textlayoutmanager/TextLayoutManager.h`
  and its sources belong to the SDK revision (`scripts/native-sdk.mjs`): an
  adapter that includes RN's `TextLayoutManager.h` now gets this header.
  `npm run sdk:native:pack` and `sdk:native:verify` pass with it.

## Tolerance, measured

The oracle ([`tests/text-layout-oracle.mjs`](../../tests/text-layout-oracle.mjs))
reads the TrueType files in Node, with no Godot: `head.unitsPerEm`,
`hhea.ascender`/`descender` and the `glyf` `yMax` of "T" and "x" (found through
the `cmap`), for NotoSans (1000 units per em, 1069/-293, cap 714, x 536) and
JetBrainsMono (1000, 1020/-300, cap 731, x 550). The normative tolerance is
**±1 px** per measure.

Measured over the eight paragraphs of the probe (NotoSans 14, 16 and 18,
JetBrainsMono 12 and 16, two explicit line heights) and three baseline rows:

| Measure | Maximum deviation of the host from the tables |
| --- | ---: |
| `ascender`, `descender`, `height` | 0 |
| `capHeight` | 0.576 |
| `xHeight` | 0.496 |
| baseline offset between two texts in a row | 0.5 |

The raw `hhea` scale is not what the host measures. Godot's text server reads
FreeType's scaled metrics, and FreeType documents that it rounds the scaled
ascender up and the descender down to whole pixels (`FT_Size_Metrics`). The host
also rounds the font size to a whole pixel. The oracle models those two
documented roundings (`ascent = ceil(hhea.ascender * size / unitsPerEm)`, the
descent likewise from its magnitude), and then the host agrees with it exactly.
Without that rounding the tables are off by 0.896 (`ascender`), 0.726
(`descender`) and **1.484** (`height`, the sum of the two) at the worst: the
plain table scale does not hold the proposed ±1 px for the natural line height,
and the error adds up in `y`, one line height per line above. The cap and x
heights are ink bounds of an outline that lands on the pixel grid, and they hold
±1 against the plain scale. The oracle takes the weight 400 outlines that the
default instance of the variable fonts provides, and every paragraph whose numbers
the probe checks against the tables is weight 400. No tolerance was loosened: ±1
holds against the rounded model.

Yoga places frames on whole pixels, so a baseline offset can differ by half a
pixel from the difference of the two ascenders (9 against 9.5 in the mixed row).

## Why the probe is discriminating

[`tests/text-layout-probe.gd`](../../tests/text-layout-probe.gd) mounts the
fixture ([`tests/text-layout-fixture.jsx`](../../tests/text-layout-fixture.jsx))
in one Hermes application and reads what JS received next to the host's
snapshots of the same paragraphs. The test judges delivery and order, never time:
it waits for the events by condition and gives late ones frames to appear.

- **First event.** The emitter is enabled when the node mounts and records its
  last rows before it dispatches, so a first dispatch lost would be lost for
  good. Every paragraph with the prop received exactly one event for its first
  layout in the probe, and none received two.
- **Payload.** Each event has `lines`, plus the `target` and `timeStamp` RN
  mixes into every event; each line has exactly the nine fields, all finite.
- **Measurement and painting agree.** The number of lines is the visible lines;
  without truncation the line texts concatenate to the paragraph's text;
  `y` is the sum of the heights above it and the heights add up to the node's
  height (±1); `x` follows `textAlign` from the box and the line's own width
  and equals the host's line metrics; the painted baseline is `y + ascender`.
  With `numberOfLines` the number of lines is the visible lines.
- **Tables.** Every `ascender`, `descender`, `height`, `capHeight` and `xHeight`
  against the oracle, in two fonts and with an explicit `lineHeight` (a 14 px
  text with `lineHeight` 28 puts the baseline 4 px below its natural place).
- **Emitter dedupe.** A change of color alone, and a width that wraps the same
  lines, ask `measureLines` again (the counter moves) and emit nothing; a new
  width, text or `numberOfLines` emits once; removing the prop stops the events
  and the paragraph is no longer asked.
- **Baseline.** An `alignItems: 'baseline'` row of a 14 px and a 28 px text, an
  `alignSelf: 'baseline'` pair and a NotoSans 14 against a JetBrainsMono 12
  with `lineHeight` 40: the second text sits lower by the difference of the
  ascenders the tables predict (15, 13 and 9.5 px). The root has no `onTextLayout`
  handler, so every `measureLines` call it causes is Yoga's.
- **Negatives.** A non-function `onTextLayout` and the unsupported props are
  rejected by the wrapper before any native layout, an error boundary recovers,
  the host reports nothing. A handler on a nested span, and a paragraph without
  one, receive nothing. A paragraph holding an inline Control (which bypasses the
  facade's check) fails in the host: `measure` and `measureLines` each report,
  Yoga's baseline callback survives, the application stops with every Control
  balanced, and no `onTextLayout` is emitted.

The preceding host fails exactly the event check and the four baseline checks
(it never reaches `measureLines`). The retained sabotages break
`native/paragraph_layout.cpp` and rebuild the host (`node
scripts/text-layout-sabotage.mjs`, which restores the source byte for byte and
the genuine host): reporting every line ignoring `numberOfLines` (the probe
fails 4 checks), an ascender without the centred `lineHeight` offset (3) and the
sentinel left in the last line's text (9). The oracle rejects the report of each,
with every probe check marked as passed.

## Documented divergences (not normative)

The platforms disagree, or leave open, the following; the host picks one answer
and no check depends on it:

- **Text of the last truncated line.** The host reports the line's own text up
  to where the next hidden line starts, with no ellipsis. iOS and Android
  report what their layout holds for the truncated line.
- **Empty text.** By construction (no check covers it) the host keeps one row
  with empty text and the font's line box, because of its sentinel. iOS measures
  a placeholder character for an empty string (`TextLayoutManager.mm:60-64`).
- **When `lineHeight` centres the baseline.** The host always centres: a
  `lineHeight` smaller than the font's natural height moves the baseline up
  by half the difference. iOS applies the offset only when the line height
  is not smaller, unless a feature flag asks otherwise
  (`RCTAttributedTextUtils.mm:372-378`).
- **Lines beyond a fixed node height.** `measureLines` receives the node's size
  and uses its width only; a fixed height does not drop lines. iOS lays the
  text out in a container of that size.
- **The Android `baseline` field.** The payload has the nine fields RN's
  declaration lists; the extra field is not sent.

## Still open

- The original `Libraries/Text/Text.js` instead of this repository's wrapper
  (the next slice of GF-11); press and selection on spans, which belong to the
  pointer pipeline.
- Font loading and fallback (V2-D24 and the asset pipeline).
- Bidi, emoji and grapheme clusters, which need a deterministic bundled font.
- `textDecoration` and `fontStyle`, head and middle ellipsis, font scaling and
  `adjustsFontSizeToFit`, inline views.
- A reference measurement on an iOS simulator and an Android emulator.
- Weights other than 400 for `capHeight` and `xHeight`: the host reads the
  outline of the variation; the oracle reads the default instance.
- A hosted CI run and the evidence record.
