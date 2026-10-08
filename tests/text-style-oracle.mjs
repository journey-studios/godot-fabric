import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

// Independent oracle of the text-style probe. It judges the raw observations of tests/text-style-probe.gd (the
// native snapshots of the paragraphs and the errors) against rules restated here, never against the probe's verdicts:
//   the font files   head unitsPerEm, hhea ascender and descender, post underlinePosition and underlineThickness and
//                    OS/2 sCapHeight, read in Node with no Godot and no FreeType: where an underline and a strike-through
//                    sit and how thick they are, and that the measured "I" is the font's own
//   RN's attributes  a child's textDecorationLine and textDecorationColor replace its parent's (TextAttributes.cpp:79-87),
//                    the color of a line is the color of the text unless one is set, and opacity multiplies both
//   the style types  what the facade must accept and reject (StyleSheetTypes.js) and the words of each error
// It is run on every lane: a lane that does not behave as the slice says is rejected here by what it observed.

// The slack of the slice, in pixels, for what the host takes from the font tables and rounds to a pixel (the same as
// tests/text-layout-oracle.mjs), and for the metrics that FreeType keeps in 26.6 fixed point.
const PIXEL = 1;
const FINE = 0.1;
// Floats the host computed twice from the same numbers.
const EXACT = 1e-3;
const SKEW = 0.25;
const fontFiles = {
  NotoSans: new URL("../assets/fonts/NotoSans.ttf", import.meta.url),
  JetBrainsMono: new URL("../assets/fonts/JetBrainsMono.ttf", import.meta.url),
};
const INK = "f8fafcff", GREEN = "22c55eff", ORANGE = "f97316ff", RED = "ef4444ff", SKY = "38bdf8ff";
const STYLED = "Styled paragraph";
const WRAP = "The quick brown fox jumps over the lazy dog again and again";

function tables(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found = {};
  for (let index = 0; index < view.getUint16(4); index += 1) {
    const at = 12 + index * 16;
    found[String.fromCharCode(...bytes.subarray(at, at + 4))] = {offset: view.getUint32(at + 8), length: view.getUint32(at + 12)};
  }
  return {view, found};
}

const cache = new Map();
// What the oracle needs from one font file, in font units.
function fontTables(family) {
  if (!cache.has(family)) {
    const {view, found} = tables(readFileSync(fontFiles[family]));
    assert.ok(view.getUint16(found["OS/2"].offset) >= 2, family + ": an OS/2 table that has sCapHeight");
    cache.set(family, {unitsPerEm: view.getUint16(found.head.offset + 18),
      ascender: view.getInt16(found.hhea.offset + 4), descender: view.getInt16(found.hhea.offset + 6),
      underlinePosition: view.getInt16(found.post.offset + 8), underlineThickness: view.getInt16(found.post.offset + 10),
      capHeight: view.getInt16(found["OS/2"].offset + 88)});
  }
  return cache.get(family);
}

// The lines a run draws, in pixels, from its font and size. The host rounds the ascent up and the descent down (the
// magnitude up) to whole pixels, like FreeType's scaled metrics, and the line box between them is what a strike-through
// halves; an underline is centered where post says, which stores the top of the stroke: its center is half a thickness
// further down.
function lineMetrics(family, size) {
  const font = fontTables(family), scale = size / font.unitsPerEm;
  const ascent = Math.ceil(font.ascender * scale - 1e-6), descent = Math.ceil(-font.descender * scale - 1e-6);
  return {underline: (-font.underlinePosition + font.underlineThickness / 2) * scale, strike: -ascent + (ascent + descent) / 2,
    thickness: Math.max(1, font.underlineThickness * scale), capHeight: font.capHeight * scale};
}

const close = (actual, expected, label, slack = EXACT) => {
  assert.ok(typeof actual === "number" && Number.isFinite(actual), `${label}: ${actual} is a number`);
  assert.ok(Math.abs(actual - expected) <= slack, `${label}: ${actual} differs from ${expected} by more than ${slack}`);
};

// [text, fontSize, fontWeight, fontFamily, color, fontStyle, textDecorationLine, textDecorationColor] of every run of a
// paragraph, as its style says. The decoration color is the text's unless the style sets one.
const run = (text, extra = {}) => ({text, size: 16, weight: 400, family: "NotoSans", color: INK, style: "normal", line: "none", decoration: extra.color ?? INK, ...extra});
const UNDERLINE = "underline", STRIKE = "line-through", BOTH = "underline line-through";
const expectedRuns = {
  base: [run(STYLED)], normal: [run(STYLED)], italic: [run(STYLED, {style: "italic"})], mono: [run(STYLED, {family: "JetBrainsMono"})],
  "italic-mono": [run(STYLED, {family: "JetBrainsMono", style: "italic"})], bold: [run(STYLED, {weight: 700})],
  "italic-bold": [run(STYLED, {weight: 700, style: "italic"})], "italic-default": [run(STYLED, {size: 18, family: "", style: "italic"})],
  "italic-span": [run("upright "), run("slanted", {style: "italic"}), run(" upright again")],
  underline: [run(STYLED, {line: UNDERLINE})], strike: [run(STYLED, {line: STRIKE})], both: [run(STYLED, {line: BOTH})],
  none: [run(STYLED)], color: [run(STYLED, {line: UNDERLINE, decoration: ORANGE})], inert: [run(STYLED, {decoration: ORANGE})],
  solid: [run(STYLED, {line: UNDERLINE})], "mono-underline": [run(STYLED, {family: "JetBrainsMono", line: UNDERLINE})],
  "big-underline": [run(STYLED, {size: 28, line: UNDERLINE})], "small-underline": [run(STYLED, {size: 12, line: UNDERLINE})],
  spans: [run("plain "), run("under", {line: UNDERLINE}), run(" and "), run("strike", {line: STRIKE, decoration: GREEN}), run(" and "),
    run("italic", {style: "italic"}), run(" end")],
  adjacent: [run("one", {line: UNDERLINE}), run("two", {line: UNDERLINE, weight: 700}), run("three", {line: UNDERLINE, color: SKY})],
  inherit: [run("one ", {line: UNDERLINE, decoration: GREEN}), run("two", {decoration: GREEN}), run(" three ", {line: UNDERLINE, decoration: GREEN}),
    run("four", {line: STRIKE, decoration: GREEN}), run(" five ", {line: UNDERLINE, decoration: GREEN}), run("six", {line: UNDERLINE, decoration: ORANGE}),
    run(" ", {line: UNDERLINE, decoration: GREEN}), run("seven", {line: BOTH, decoration: RED})],
  empty: [run("", {line: UNDERLINE})],
};
const pair = (id, runs, plain) => {
  expectedRuns[id] = runs;
  expectedRuns[id + "-base"] = plain;
};
pair("wrap", [run(WRAP, {line: UNDERLINE})], [run(WRAP)]);
const crossing = line => [run("The quick "), run("brown fox jumps over the lazy", {weight: 700, line}), run(" dog")];
pair("wrap-spans", crossing(UNDERLINE), crossing("none"));
pair("centered", [run("Centered", {line: UNDERLINE})], [run("Centered")]);
pair("spaced", [run(STYLED, {line: UNDERLINE})], [run(STYLED)]);
pair("newline", [run("line one\n", {line: UNDERLINE})], [run("line one\n")]);
const CLIP = "A paragraph that wants far more than one line of a narrow box";
pair("clip", [run(CLIP, {line: UNDERLINE})], [run(CLIP)]);
const TAIL = "red tail that is far too long to fit";
pair("truncated", [run("Short "), run(TAIL, {color: RED, line: UNDERLINE})], [run("Short "), run(TAIL, {color: RED})]);
const DELTA = "delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron";
pair("truncated-two", [run("Alpha beta gamma "), run(DELTA, {color: RED, line: BOTH, decoration: GREEN})],
  [run("Alpha beta gamma "), run(DELTA, {color: RED})]);
const paragraphIds = Object.keys(expectedRuns);

// The lines each decorated paragraph draws, by [run, kind, color], as the styles above say.
const drawn = {
  underline: [[0, "underline", INK]], strike: [[0, "line-through", INK]], both: [[0, "underline", INK], [0, "line-through", INK]],
  solid: [[0, "underline", INK]], color: [[0, "underline", ORANGE]], "mono-underline": [[0, "underline", INK]],
  "big-underline": [[0, "underline", INK]], "small-underline": [[0, "underline", INK]],
  spans: [[1, "underline", INK], [3, "line-through", GREEN]],
  adjacent: [[0, "underline", INK], [1, "underline", INK], [2, "underline", SKY]],
  // A child replaces its parent's line and color field by field: "two" is none, "four" strikes in the parent's green,
  // "six" only changes the color, and "seven" sets both.
  inherit: [[0, "underline", GREEN], [2, "underline", GREEN], [3, "line-through", GREEN], [4, "underline", GREEN],
    [5, "underline", ORANGE], [6, "underline", GREEN], [7, "underline", RED], [7, "line-through", RED]],
};
const PLAIN = ["base", "normal", "italic", "mono", "italic-mono", "bold", "italic-bold", "italic-default", "italic-span", "none", "inert", "empty"];

// What the facade must reject and the words of each error (a prefix, where the message goes on to explain).
const USE_LINES = "use none, underline, line-through or underline line-through";
const rejections = {
  oblique: "Godot Text does not implement style fontStyle oblique: use normal or italic",
  "font-style-bogus": "Godot Text does not implement style fontStyle slanted: use normal or italic",
  "line-strikethrough": `Godot Text does not implement style textDecorationLine strikethrough: ${USE_LINES}`,
  "line-underline-strikethrough": `Godot Text does not implement style textDecorationLine underline-strikethrough: ${USE_LINES}`,
  "line-reversed": `Godot Text does not implement style textDecorationLine line-through underline: ${USE_LINES}`,
  "line-overline": `Godot Text does not implement style textDecorationLine overline: ${USE_LINES}`,
  "line-bogus": `Godot Text does not implement style textDecorationLine sideways: ${USE_LINES}`,
  "style-double": "Godot Text does not implement style textDecorationStyle double: only solid",
  "style-dotted": "Godot Text does not implement style textDecorationStyle dotted: only solid",
  "style-dashed": "Godot Text does not implement style textDecorationStyle dashed: only solid",
  "style-wavy": "Godot Text does not implement style textDecorationStyle wavy: only solid",
  "style-alone": "Godot Text does not implement style textDecorationStyle dotted: only solid",
  "span-oblique": "Godot Text does not implement style fontStyle oblique: use normal or italic",
  "span-dotted": "Godot Text does not implement style textDecorationStyle dotted: only solid",
  "view-italic": "Godot View does not implement style fontStyle",
  "view-decoration": "Godot View does not implement style textDecorationLine",
  "input-italic": "Godot TextInput does not implement style fontStyle",
  "input-decoration": "Godot TextInput does not implement style textDecorationLine",
};
// A NativeText that skips the facade: the host's own refusal, word for word.
const bypass = {
  oblique: "Godot Text does not implement style fontStyle oblique: use normal or italic",
  double: "Godot Text does not implement style textDecorationStyle double: only solid",
  dotted: "Godot Text does not implement style textDecorationStyle dotted: only solid",
  dashed: "Godot Text does not implement style textDecorationStyle dashed: only solid",
  wavy: "Godot Text does not implement style textDecorationStyle wavy: only solid",
};

function paragraph(report, id) {
  const node = report.stages.static.paragraphs[id];
  assert.ok(node != null, `${id} is mounted as a paragraph`);
  return node;
}

// The painted rows of a paragraph, with the ellipsis folded into the run it follows: what a line under a run covers.
function coverage(node) {
  const groups = [];
  for (const row of node.painted ?? []) {
    const last = groups.at(-1);
    if (last != null && last.line === row.line && last.run === row.run) {
      last.x1 = row.x1;
    } else {
      groups.push({line: row.line, run: row.run, x0: row.x0, x1: row.x1});
    }
  }
  return groups;
}

const kindsOf = line => (line === "none" ? [] : line === BOTH ? ["underline", "line-through"] : [line === UNDERLINE ? "underline" : "line-through"]);

export const sections = {
  mount(report) {
    assert.deepEqual(report.stages.static.react.renderErrors, []);
    assert.deepEqual(Object.keys(report.stages.static.paragraphs).sort(), [...paragraphIds, "fade", "fade-default"].sort());
  },
  // The styles reach the runs the host paints, with what the declarations say.
  runs(report) {
    for (const [id, expected] of Object.entries(expectedRuns)) {
      const node = paragraph(report, id);
      assert.equal(node.runs.length, expected.length, `${id}: the runs`);
      expected.forEach((want, index) => {
        const got = node.runs[index];
        assert.equal(node.nativeText.slice(got.start, got.end), want.text, `${id}: run ${index} text`);
        assert.deepEqual([got.fontSize, got.fontWeight, got.fontFamily, got.color, got.fontStyle, got.syntheticItalic, got.textDecorationLine, got.textDecorationColor],
          [want.size, want.weight, want.family, want.color, want.style, want.style === "italic", want.line, want.decoration], `${id}: run ${index} style`);
      });
    }
  },
  // The skew of the synthetic italic, measured on the outline of "I" in the font each run paints with.
  italic(report) {
    const outline = (id, index = 0) => {
      const glyph = paragraph(report, id).runs[index].glyphI;
      assert.ok(glyph != null && glyph.bottom > glyph.top, `${id}: the run's font has an I`);
      return glyph;
    };
    for (const id of ["base", "normal", "mono", "bold", "italic", "italic-mono", "italic-bold"]) {
      const glyph = outline(id), first = expectedRuns[id][0], want = lineMetrics(first.family, first.size);
      // The I the host measures is the font's own: a flat-topped capital as tall as the OS/2 table says.
      close(glyph.bottom - glyph.top, want.capHeight, `${id}: the height of I`, PIXEL);
    }
    for (const [slanted, upright] of [["italic", "base"], ["italic-mono", "mono"], ["italic-bold", "bold"]]) {
      const lean = outline(slanted), straight = outline(upright), height = straight.bottom - straight.top;
      assert.equal(straight.topX, straight.bottomX, `${upright}: an upright I does not lean`);
      close(lean.top, straight.top, `${slanted}: the top stays`);
      close(lean.bottom, straight.bottom, `${slanted}: the bottom stays`);
      close(lean.bottomX, straight.bottomX, `${slanted}: the foot stays where it was`, FINE);
      close(lean.topX - straight.topX, SKEW * height, `${slanted}: the top leans to the right by a quarter of the height`, FINE);
      close(lean.advance, straight.advance, `${slanted}: the advance does not change`);
    }
    // A paragraph that names no family is slanted too, in the family a bold one without a name takes.
    const fallback = outline("italic-default");
    close(fallback.topX - fallback.bottomX, SKEW * (fallback.bottom - fallback.top), "italic-default: it leans", FINE);
    const spans = paragraph(report, "italic-span").runs.map(row => row.glyphI);
    close(spans[1].topX - spans[1].bottomX, SKEW * (spans[1].bottom - spans[1].top), "italic-span: the span leans", FINE);
    for (const index of [0, 2]) {
      assert.equal(spans[index].topX, spans[index].bottomX, `italic-span: run ${index} stays upright`);
    }
  },
  // Nothing about the style changes what the paragraph measures or where it breaks.
  measure(report) {
    const fields = ["lines", "visibleLines", "measuredWidth", "measuredHeight", "ellipses", "lineMetrics"];
    const same = (id, other) => {
      for (const field of fields) {
        assert.deepEqual(paragraph(report, id)[field], paragraph(report, other)[field], `${id} and ${other} have the same ${field}`);
      }
    };
    for (const id of ["normal", "italic", "underline", "strike", "both", "none", "color", "inert", "solid"]) {
      same(id, "base");
    }
    for (const id of ["wrap", "wrap-spans", "centered", "spaced", "newline", "clip", "truncated", "truncated-two"]) {
      same(id, id + "-base");
    }
    assert.ok(paragraph(report, "wrap").visibleLines > 1 && paragraph(report, "wrap-base").visibleLines > 1, "the wrapped pair really wraps");
  },
  // The geometry of every line, recomputed from the painted rows and the font tables.
  decorations(report) {
    for (const id of paragraphIds) {
      const node = paragraph(report, id);
      assert.ok(Array.isArray(node.painted) && Array.isArray(node.decorations), `${id}: the host reports what it paints and the lines it draws`);
      const groups = coverage(node);
      const want = [];
      groups.forEach(group => {
        const style = expectedRuns[id][group.run];
        assert.ok(style != null, `${id}: painted run ${group.run} exists`);
        // A group without width (the sentinel, a trimmed space) has nothing to draw a line under.
        if (group.x1 - group.x0 <= EXACT) {
          return;
        }
        const metrics = lineMetrics(style.family === "" ? "NotoSans" : style.family, style.size);
        const baseline = node.lineMetrics[group.line].baseline;
        for (const kind of kindsOf(style.line)) {
          want.push({line: group.line, run: group.run, kind, x0: group.x0, x1: group.x1, thickness: metrics.thickness,
            y: baseline + (kind === "underline" ? metrics.underline : metrics.strike), color: style.decoration});
        }
      });
      const got = node.decorations;
      assert.deepEqual(got.map(row => [row.line, row.run, row.kind, row.color]), want.map(row => [row.line, row.run, row.kind, row.color]),
        `${id}: the lines are the ones its runs ask for, in the colors they ask for`);
      got.forEach((row, index) => {
        close(row.x0, want[index].x0, `${id}: line ${index} starts where its glyphs do`);
        close(row.x1, want[index].x1, `${id}: line ${index} ends where its glyphs do`);
        close(row.thickness, want[index].thickness, `${id}: line ${index} thickness`, FINE);
        // The underline sits below the baseline and the strike-through above it; both on the font's metrics.
        assert.ok(row.kind === "underline" ? row.y > node.lineMetrics[row.line].baseline : row.y < node.lineMetrics[row.line].baseline,
          `${id}: line ${index} is on the right side of the baseline`);
        close(row.y, want[index].y, `${id}: line ${index} height`, FINE);
      });
      // The lines of a paragraph are in painting order, and lines under adjacent runs touch.
      groups.forEach((group, index) => {
        const next = groups[index + 1];
        if (next != null && next.line === group.line) {
          close(next.x0, group.x1, `${id}: the glyphs of run ${group.run} and run ${next.run} touch`);
        }
      });
      // A run that covers its row goes from the row's x to its x plus its width, which the host rounds to a pixel.
      node.lineMetrics.forEach((metric, line) => {
        const row = groups.filter(group => group.line === line);
        if (row.length === 1 && node.ellipses === 0 && row[0].x1 - row[0].x0 > EXACT) {
          close(row[0].x0, metric.x, `${id}: row ${line} starts at its x`);
          close(row[0].x1, metric.x + metric.width, `${id}: row ${line} ends at its x plus its width`, PIXEL);
        }
      });
    }
    // The cases the lines above cannot tell apart from a whole-row line.
    const named = id => paragraph(report, id);
    for (const id of PLAIN) {
      assert.deepEqual(named(id).decorations ?? [null], [], `${id}: draws no line`);
    }
    for (const [id, rows] of Object.entries(drawn)) {
      assert.deepEqual((named(id).decorations ?? []).map(row => [row.run, row.kind, row.color]), rows, `${id}: draws its lines`);
    }
    // Underline, strike-through and both under one run sit on the same strokes as when drawn alone.
    const alone = (id, kind) => named(id).decorations.find(row => row.kind === kind);
    for (const kind of ["underline", "line-through"]) {
      close(alone("both", kind).y, alone(kind === "underline" ? "underline" : "strike", kind).y, `both: the ${kind} is where it is alone`);
    }
    assert.ok(alone("big-underline", "underline").thickness > 1 && alone("small-underline", "underline").thickness === 1, "thickness follows the size, at least a pixel");
    assert.ok(named("wrap").decorations.length === named("wrap").visibleLines && named("wrap").visibleLines > 1, "a wrapped run draws a line on each row");
    const crossingRows = named("wrap-spans").decorations;
    assert.ok(crossingRows.length > 1 && new Set(crossingRows.map(row => row.line)).size === crossingRows.length && crossingRows.every(row => row.run === 1),
      "a run that wraps draws one line per row, under itself only");
    assert.equal(named("newline").visibleLines, 2);
    assert.ok(named("newline").decorations.every(row => row.line === 0), "the empty row after a newline has no line");
    assert.ok(named("centered").lineMetrics[0].x > 0 && named("centered").decorations[0].x0 === named("centered").lineMetrics[0].x, "the line follows an aligned row");
  },
  // A child replaces its parent's line and color field by field, and opacity multiplies the text and the line alike.
  inheritance(report) {
    const rows = id => (paragraph(report, id).decorations ?? []).map(row => [row.run, row.kind, row.color]);
    assert.deepEqual(rows("inherit"), drawn.inherit, "inherit: none cancels, line-through replaces, a color alone recolors");
    assert.deepEqual(rows("spans"), drawn.spans);
    assert.deepEqual(rows("adjacent"), drawn.adjacent);
    const alphaOf = color => parseInt(color.slice(6, 8), 16);
    for (const id of ["fade", "fade-default"]) {
      const node = paragraph(report, id);
      assert.ok(node.runs[1].color.startsWith("ffffff") && [127, 128].includes(alphaOf(node.runs[1].color)), `${id}: half the text color`);
      assert.equal(node.runs[0].color, INK, `${id}: the paragraph is not dimmed`);
      assert.equal(node.decorations.length, 1, `${id}: one line`);
    }
    const explicit = paragraph(report, "fade"), implicit = paragraph(report, "fade-default");
    assert.equal(explicit.decorations[0].color, "ff0000" + explicit.runs[1].color.slice(6, 8), "fade: an explicit line color is dimmed as the text is");
    assert.equal(implicit.decorations[0].color, implicit.runs[1].color, "fade-default: a line without a color follows the dimmed text");
    assert.equal(explicit.runs[1].textDecorationColor, "ff0000" + explicit.runs[1].color.slice(6, 8));
  },
  // The text the host cut off has no line of its own, and the ellipsis belongs to the run before it.
  ellipsis(report) {
    for (const id of ["truncated", "truncated-two"]) {
      const node = paragraph(report, id);
      assert.equal(node.ellipses, 1, `${id}: truncated`);
      const painted = node.painted;
      const tail = painted.filter(row => row.ellipsis);
      assert.equal(tail.length, 1, `${id}: one ellipsis`);
      const before = painted[painted.indexOf(tail[0]) - 1];
      assert.equal(tail[0].run, 1, `${id}: the ellipsis takes the run of the red tail, not the run of the first glyph`);
      assert.equal(tail[0].run, before.run, `${id}: the ellipsis takes the run of the last glyph before it`);
      assert.equal(tail[0].line, before.line);
      close(tail[0].x0, before.x1, `${id}: the ellipsis follows the text`);
      // The line under the tail goes on under the ellipsis, to where the last painted glyph ends and no further.
      const lines = node.decorations.filter(row => row.run === 1 && row.line === tail[0].line);
      assert.ok(lines.length > 0, `${id}: the tail has its line`);
      for (const row of lines) {
        close(row.x1, tail[0].x1, `${id}: the line ends with the ellipsis`);
      }
      assert.ok(tail[0].x1 <= 150 + PIXEL, `${id}: it fits the box`);
    }
    // The first run is not decorated, so the line starts where the tail does.
    const truncated = paragraph(report, "truncated");
    close(truncated.decorations[0].x0, truncated.painted.find(row => row.run === 1).x0, "truncated: the line starts at the tail");
    assert.ok(truncated.decorations[0].x0 > 0, "truncated: nothing under the first run");
    // Clipped text: no ellipsis, the line stops at the last glyph that is painted.
    const clipped = paragraph(report, "clip");
    assert.equal(clipped.ellipses, 0);
    assert.equal(clipped.painted.length, 1);
    close(clipped.decorations[0].x1, clipped.painted[0].x1, "clip: the line stops where the glyphs do");
    assert.ok(clipped.decorations[0].x1 <= 150 + EXACT, "clip: it stays inside the box");
  },
  negative(report) {
    const {failures, react} = report.stages.negative;
    assert.deepEqual(failures.map(row => row.kind), Object.keys(rejections), "every rejected style was tried");
    for (const row of failures) {
      assert.ok(row.message.startsWith(rejections[row.kind]), `${row.kind} fails with ${rejections[row.kind]}, not ${row.message}`);
      assert.equal(row.fallback, true, `${row.kind}: the boundary caught it`);
    }
    assert.equal(react.rejections.length, Object.keys(rejections).length, "each style failed once");
  },
  bypass(report) {
    const {reports} = report.stages.bypass;
    assert.deepEqual(reports.map(row => row.kind), Object.keys(bypass));
    for (const row of reports) {
      assert.deepEqual(row.renderErrors, [], `${row.kind}: the import itself works`);
      assert.equal(row.mounted, true, `${row.kind}: the paragraph is mounted`);
      assert.ok(row.errors.length > 0, `${row.kind}: the host refuses it`);
      assert.ok(row.errors.every(error => error === bypass[row.kind]), `${row.kind}: refused with ${bypass[row.kind]}`);
    }
  },
  stop(report) {
    const stopped = report.stages.afterStop;
    assert.ok(stopped.stopped && stopped.rootCount === 0 && stopped.pendingTimers === 0);
    // Every host error of the run is one of the bypass refusals, and nothing else.
    const allowed = new Set(Object.values(bypass));
    assert.ok(stopped.errors.every(error => allowed.has(error)), "no host error besides the refusals of the bypass cases");
  },
};

// Each section's first rejected observation of a report, by name; null where it accepts.
export function oracleRejections(report) {
  return Object.fromEntries(Object.entries(sections).map(([name, section]) => {
    try {
      section(report);
      return [name, null];
    } catch (error) {
      return [name, String(error.message).replace(/\s+/g, " ").slice(0, 300)];
    }
  }));
}

export function verifyTextStyleReport(report) {
  for (const section of Object.values(sections)) {
    section(report);
  }
}
