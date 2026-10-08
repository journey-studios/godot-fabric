# Text style: `fontStyle` italic and `textDecorationLine` on the paragraph

Status: third slice of GF-11, executed locally on macOS arm64 against pinned RN 0.87.1 and
official Godot 4.7.2, headless. The probe ran **61 checks**; the SDK and the host of main before
the slice (`0f2cc7e`) ran the same fixture and failed exactly **47**; the same bundle on that host
alone (nothing slants, draws a line or refuses) failed exactly **27**; eight retained sabotages each
fail the probe and the independent oracle rejects every one of them in the section meant for it.
The typography laboratory gained a line of italic, underline, line-through and colored decoration
and a span that cancels it, with pixel checks in the renderer lane. The evidence record, the hosted
CI run of the new step and the Pages publication are **pending**.

## What RN does

| Item | RN C++, shared by both platforms | iOS | Android | This host |
| --- | --- | --- | --- | --- |
| `fontStyle` | Parsed at `BaseTextProps.cpp:58-63`; `conversions.h:276-304` knows `normal`, `italic`, `oblique` and logs any other value, which becomes `normal`. Flow types allow `normal` and `italic` only (`StyleSheetTypes.js:1018`) | `RCTFontUtils.mm:291-306`: the system font gets the italic trait. A named family (`:355-392`) picks the closest member by weight and traits: with no italic member the text stays upright, nothing is slanted | `ReactTypefaceUtils.kt:44-49` asks for `Typeface.ITALIC`; with no italic face Skia applies its fake italic skew | `normal` and `italic` accepted; the slant is synthetic (below). `oblique` and anything else rejected |
| `textDecorationLine` | `conversions.h:867-893`: `none`, `underline`, `strikethrough` or `line-through`, `underline-strikethrough` or `underline line-through`; an invalid value becomes `none` without a word. Flow types allow the four strings `none`, `underline`, `line-through`, `underline line-through` (`StyleSheetTypes.js:1044-1048`) | `RCTAttributedTextUtils.mm:252-304`: `NSUnderlineStyleAttributeName` and `NSStrikethroughStyleAttributeName` | `TextAttributeProps.kt:271-290`, `TextLayoutManager.kt:337-358`: `ReactUnderlineSpan` and `ReactStrikethroughSpan` | The four Flow strings. The native parser's aliases, the reversed order and `overline` rejected |
| `textDecorationColor` | `BaseTextProps.cpp:134-139`; a color style (`ReactNativeStyleAttributes.js:267`, `colorAttribute`), so the value must be processed to a number before the C++ reads it | The color is set only when the style sets one (`:292-294`) | An unset color falls back to the foreground color of the span (`TextDecorationStyle.kt:132-143`) | Any color `processColor` accepts; unset, the line takes the color of the run |
| `textDecorationStyle` | Five values (`solid`, `double`, `dotted`, `dashed`, `wavy`), an invalid one becomes `solid` (`conversions.h`) | UIKit styles for solid and double, custom drawing for the others (`:263-283`) | `TextDecorationStyle.kt:122-165` draws all five | `solid` only; the other four rejected |
| Inheritance | `TextAttributes.cpp:79-87`: a child replaces its parent's `textDecorationColor`, `textDecorationLineType` and `textDecorationStyle` field by field, so `none` in the child cancels the parent's underline and `line-through` replaces an `underline` | same | same | Same: the host receives the merged attributes of every fragment |

`textDecorationColor` and `textDecorationStyle` without a line are inert in RN, and so they are here.

## What Godot gives

- The `TextServer` draws glyphs and nothing else, so the lines are the host's. `RichTextLabel`
  (`scene/gui/rich_text_label.cpp:1210-1211`, `1425-1476`) draws the underline with `draw_line` at
  the baseline plus the font's underline position, `max(1, thickness)` thick, and the
  strike-through at `-ascent + size.y / 2`, the middle of the box of ascent plus descent. The host
  follows those two rules (decision 4 below).
- `Font::get_underline_position(size)` is the **center** of the stroke: FreeType adds half the
  thickness to the `post` table's `underlinePosition`. In Node the center is
  `(-underlinePosition + underlineThickness / 2) / unitsPerEm * size`.
- The bundled fonts have no italic face and no `ital` or `slnt` axis: NotoSans `[wdth,wght]` and
  JetBrainsMono `[wght]`.
- `FontVariation::set_variation_transform(Transform2D(Vector2(1, 0.25), Vector2(0, 1), Vector2.ZERO))`
  slants the glyph outline (`modules/text_server_adv/text_server_adv.cpp:1363-1365`, `1665-1667`),
  and HarfBuzz receives the synthetic slant. Measured in 4.7.2 on the outline of "I" at 64 px: the
  top moves right by 0.25 of the height (11.5 of 46 px), the bottom and the advance stay. The
  transposed matrix (`Vector2(1, 0)`, `Vector2(0.25, 1)`) shears vertically instead, and the glyph's
  height changes.

## Decisions

1. **Accepted:** `fontStyle` `normal` or `italic`; `textDecorationLine` `none`, `underline`,
   `line-through` or `underline line-through`; `textDecorationColor`; `textDecorationStyle`
   `solid` or absent. The child replaces the parent field by field, as in RN.
2. **Rejected where the Text renders** (GF-04), in the words of the other style errors:
   - `Godot Text does not implement style fontStyle <value>: use normal or italic`;
   - `Godot Text does not implement style textDecorationLine <value>: use none, underline, line-through or underline line-through`
     (the aliases `strikethrough` and `underline-strikethrough`, the reversed order and `overline`
     included);
   - `Godot Text does not implement style textDecorationStyle <value>: only solid`.

   The host repeats the refusal of `oblique` and of any non-solid `textDecorationStyle` in
   `ParagraphLayout::prepare`, with the same words, for a `NativeText` that skips the facade
   (`measure`, `measureLines` and the apply report it). On a `View` or a `TextInput` the three
   styles keep failing as before.
3. **Synthetic italic.** A skew of 0.25 on a `FontVariation` of the run's family and weight, for
   both bundled families, with `:italic` in the font cache key. A paragraph that names no family
   and asks for italic does not take the shortcut to the fallback font: it is NotoSans, as a bold
   paragraph with no family already is.
4. **Geometry**, Godot's metrics, the convention of `RichTextLabel`:
   - underline: `y = baseline + get_underline_position(size)`, thick `max(1, get_underline_thickness(size))`;
   - strike-through: `y = baseline - ascent + (ascent + descent) / 2`, as thick, with the ascent and
     descent of the run's font.
5. **Segments.** One per run and per visual row, from where the first painted glyph of the run starts
   to where its last one ends, over the glyphs that are painted: the truncated text has no line, and
   a group without width (the sentinel, a trimmed space) has none. One function,
   `PreparedParagraph::decoration_segments()`, feeds `draw` and `snapshot`, so the snapshot is
   exactly what was drawn; it runs in `draw` and `snapshot`, never in `prepare`, which runs in
   measure. Painting does not change a measure: a decorated paragraph measures and breaks like the
   same without the decoration.
6. **The ellipsis takes the run of the last glyph painted before it**, for its color and for its
   line (see below).
7. **Color.** `textDecorationColor` unset is the color of the run; explicit or not, the opacity of
   the run multiplies it as it does the text.
8. **Controls.** `previous`: the SDK and the host of main before the slice. `previous-host`: this
   SDK on that host.

## The divergence of the formulas, measured

RN's platforms do not agree with each other, and neither agrees with Godot's metrics. Android draws
the underline at `baseline + thickness + 1` (`ReactUnderlineSpan.kt:32`, `thickness` being the
paint's underline thickness) and the strike-through at `baseline + (fontMetrics.ascent +
fontMetrics.descent) / 2 + 1` (`ReactStrikethroughSpan.kt:37`); iOS leaves both to TextKit, and
this environment has no iOS to measure. Taken from the fonts' own tables (the oracle reads the same
numbers) at 16 px:

| Font, 16 px | Underline here (below the baseline) | Android's formula | Strike-through here (above the baseline) | Android's formula |
| --- | --- | --- | --- | --- |
| NotoSans | 2.0 px, 0.797 px thick (drawn 1 px) | 1.8 px | 6.5 px (ascent 18, descent 5) | 5.2 px |
| JetBrainsMono | 2.875 px, 0.797 px thick (drawn 1 px) | 1.8 px | 6.0 px (ascent 17, descent 5) | 4.8 px |

So the underline here sits 0.2 px lower than Android's in NotoSans and 1.1 px lower in
JetBrainsMono, and the strike-through 1.3 and 1.2 px higher: sub-pixel to one pixel, and not claimed
as parity. The thickness is the font's, at least one pixel (28 px NotoSans: 1.4 px; 12 px: 1 px),
and it does not vary with the weight.

## The synthetic italic

- 0.25 is the value of Android's fake italic: a quarter of the glyph's height, to the right.
  The iOS of RN does not slant a custom family that has no italic face, so the two platforms have no
  common reference; the Android value was kept.
- The outline is slanted by FreeType, so the advance, the width and the line breaks do not change;
  the oracle checks that on the outline of "I" (top +0.25 x height, bottom and advance equal) and
  on the measures of paragraphs with and without italic.
- Each run of the snapshot says `fontStyle` and `syntheticItalic`, and reports the outline of "I" of
  its own font (`glyphI`), which is where the skew is read from.
- **Open:** real italic faces (the `Italic` TTFs of the same google/fonts commit) instead of the
  transform.

## The ellipsis fix

The glyphs of the ellipsis come from `shaped_text_get_ellipsis_glyphs`, with `start = end = -1`,
and the old drawing looked their run up by that position: `run_index_at(runs, -1)` returned run 0.
A truncated paragraph whose last visible text was in another run painted its ellipsis in the color
of the **first** run. They now take the run of the last glyph painted before them (the row's first
run when none is), so the color and the decoration go on under the ellipsis, as RN's span covers the
truncated text. The probe and the oracle read it from the rows the snapshot reports as painted
(`painted`, with the ellipsis split from the text) and check the red tail of a truncated paragraph,
its second row and a clipped paragraph, which has none.

## What the host reports

Each paragraph of the native snapshot gained: in every run, `fontStyle`, `syntheticItalic`,
`textDecorationLine`, `textDecorationColor` and `glyphI` (top, bottom, topX, bottomX and advance of
"I" in the run's font); `decorations`, one row per drawn line (`line`, `run`, `kind`, `x0`, `x1`, `y`
the center of the stroke, `thickness`, `color`); and `painted`, the runs of the glyphs of each row in
painting order, with `ellipsis` on the group the ellipsis took.

## How it is verified

- `npm run test:text-style` bundles `tests/text-style-fixture.jsx` (the public `react-native` import)
  and runs it in one Hermes application with `tests/text-style-probe.gd`: 41 paragraphs of two
  families and eight pairs that measure with and without their decoration, 18 rejected styles in
  their own boundaries and five `NativeText` that skip the facade. The bundle must contain
  `Text.js`, `TextNativeComponent.js`, `TextAncestorContext.js`, `View.js`, the renderer and the
  registry, or the test fails.
- The independent oracle (`tests/text-style-oracle.mjs`) judges the raw report without the probe's
  verdicts, in ten sections: the mount; the runs, with their style; the skew on the outline of "I",
  checked against the capital height of the `OS/2` table; the measures; the geometry of every line,
  recomputed from `head`, `hhea` and `post` and the painted rows (the segments are contiguous, a run
  that covers its row goes from the row's x to its x plus its width, the truncated text has none);
  the inheritance and the opacity; the ellipsis and the clipped text; every rejected style word for
  word; the bypass refusals; and the stop.
- `scripts/text-style-sabotage.mjs` retains the controls and restores every source byte for byte:
  - **previous SDK and host**: fails exactly 47 checks (the facade rejects the styles at render, so
    the cases that use them are not mounted); the oracle rejects it in nine sections;
  - **previous host with this SDK**: fails exactly 27: the styles are accepted, nothing slants, no
    line is reported and the five bypass cases are silent; the oracle rejects `runs`, `italic`,
    `decorations`, `inheritance`, `ellipsis` and `bypass`, and nothing else;
  - eight sabotages, each rejected by the probe and by the oracle in the section named here:
    `decoration-above` (the underline's offset has the wrong sign: 1 check, `decorations`),
    `color-ignored` (the line takes the text color: 5, `decorations`), `inherit` (the facade drops a
    child's `none`: 1, `inheritance`), `whole-line` (the line covers the whole row, whatever the run
    and the cut: 3, `decorations`), `skew-sign` (the slant leans the other way: 2, `italic`),
    `facade-dotted` (the facade lets `dotted` through: 4, `negative`), `ellipsis-run` (the ellipsis
    takes the first run again: 2, `ellipsis`) and `guard` (the host does not refuse: 5, `bypass`).
- The regressions: `test:text-original` keeps its 119 checks (`font-style` and `decoration` moved to
  `oblique` and a dotted `textDecorationStyle`, which the previous SDK rejects in the same words),
  `test:text-layout` its 76, the typography laboratory (55 checks headless and 72 with the renderer,
  four of which are new pixel reads of the italic, the colored underline, the strike-through and the
  gap under the cancelling span), `test:touchables`, `test:examples`, the type check, the static check
  and the parity inventory pass.

## Limitations and open

- **Real italic faces** instead of the synthetic slant; `oblique` stays rejected.
- **`double`, `dotted`, `dashed` and `wavy`** lines, and `overline` (which RN's types do not have).
- **The lines follow Godot's metrics**, not either platform's: up to about one pixel from Android's,
  and not measured against iOS.
- **Bidirectional text.** The groups are consecutive painted glyphs of one run; a run that a bidi
  reordering splits would get one line per piece. Bidi is outside the slice.
- An invalid color string in `textDecorationColor` is dropped by `processColor` as it is for `color`:
  the line takes the text color.
- The hosted run of the new CI step and the Pages publication are pending.
