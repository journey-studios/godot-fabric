import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

// The independent oracle of the text layout slice. It reads the bundled TrueType files in Node, with no
// Godot and no FreeType, and derives from their tables what RN's line measurements must say:
//
//   head unitsPerEm, hhea ascender and descender   the line's ascent and descent. The host adds no
//                                                  line gap, like TextKit and StaticLayout metrics.
//   glyf yMax of "T" and "x"                       the ink height of capHeight and xHeight. Android's
//                                                  FontMetricsUtil measures the bounds of exactly
//                                                  these two glyphs.
//
// A report is judged by recomputing every relation from the numbers it records, so one is rejected
// on its own derivations even when every check of the probe is marked as passed.

// The normative tolerance of the slice: a measure of the host may differ from the tables by this many
// pixels. The host rounds a font size to a whole pixel (native/paragraph_layout.cpp font_size) and
// the glyph outlines of the ink heights land on the pixel grid, so those two differ by less than one.
export const tolerance = 1;
const fontFiles = {
  NotoSans: new URL("../assets/fonts/NotoSans.ttf", import.meta.url),
  JetBrainsMono: new URL("../assets/fonts/JetBrainsMono.ttf", import.meta.url),
};
const lineKeys = ["ascender", "capHeight", "descender", "height", "text", "width", "x", "xHeight", "y"];
// The sentinel the host appends to keep empty and trailing-newline rows; it never belongs to a line.
const sentinel = "​";
const inlineError = "Inline Controls are not implemented in Godot Text";
const rejectionMessages = ["onTextLayout must be a function", "onTextLayout must be a function",
  "does not implement onPress", "does not implement selectable", "does not implement adjustsFontSizeToFit"];
// The probe's checks that depend on the platform manager's measureLines, which the preceding host lacks:
// RN never delivers onTextLayout and the Yoga baseline callback answers zero.
export const normativeOriginalFailures = [
  "events/Every paragraph with onTextLayout receives exactly one event after its first layout",
  "baseline/In an alignItems baseline row the 14 px text sits below the top of the 28 px text",
  "baseline/With alignSelf baseline the 12 px text sits below the top of the 24 px text",
  "baseline/Across two fonts the baseline of a lineHeight 40 mono text pushes the 14 px sans text down",
  "baseline/Yoga's baseline callback reaches measureLines: no paragraph of this root has a handler",
];

function tables(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found = {};
  for (let index = 0; index < view.getUint16(4); index += 1) {
    const at = 12 + index * 16;
    found[String.fromCharCode(...bytes.subarray(at, at + 4))] = {offset: view.getUint32(at + 8), length: view.getUint32(at + 12)};
  }
  return {view, found};
}

// The glyph index of one code point from the format 4 subtable of the Windows Unicode cmap.
function glyphIndex(view, cmap, codePoint) {
  const count = view.getUint16(cmap.offset + 2);
  let base = null;
  for (let index = 0; index < count; index += 1) {
    const at = cmap.offset + 4 + index * 8;
    const offset = cmap.offset + view.getUint32(at + 4);
    if (view.getUint16(at) === 3 && view.getUint16(at + 2) === 1 && view.getUint16(offset) === 4) {
      base = offset;
    }
  }
  assert.ok(base != null, "a Windows Unicode format 4 cmap subtable");
  const segments = view.getUint16(base + 6) / 2;
  const endCodes = base + 14, startCodes = endCodes + segments * 2 + 2;
  const deltas = startCodes + segments * 2, rangeOffsets = deltas + segments * 2;
  for (let segment = 0; segment < segments; segment += 1) {
    if (codePoint > view.getUint16(endCodes + segment * 2)) {
      continue;
    }
    const start = view.getUint16(startCodes + segment * 2);
    if (codePoint < start) {
      return 0;
    }
    const rangeOffset = view.getUint16(rangeOffsets + segment * 2), delta = view.getInt16(deltas + segment * 2);
    if (rangeOffset === 0) {
      return (codePoint + delta) & 0xffff;
    }
    const glyph = view.getUint16(rangeOffsets + segment * 2 + rangeOffset + (codePoint - start) * 2);
    return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
  }
  return 0;
}

// The yMax of a glyph's own bounding box, in font units: the ink above the baseline.
function inkTop(view, found, codePoint) {
  const glyph = glyphIndex(view, found.cmap, codePoint);
  assert.ok(glyph > 0, "the font has a glyph for U+" + codePoint.toString(16));
  const long = view.getInt16(found.head.offset + 50) === 1;
  const location = index => (long ? view.getUint32(found.loca.offset + index * 4) : view.getUint16(found.loca.offset + index * 2) * 2);
  assert.ok(location(glyph + 1) > location(glyph), "the glyph has an outline");
  return view.getInt16(found.glyf.offset + location(glyph) + 8);
}

const cache = new Map();
// What the oracle needs from one font file, in font units.
function fontTables(family) {
  if (!cache.has(family)) {
    const {view, found} = tables(readFileSync(fontFiles[family]));
    cache.set(family, {family, unitsPerEm: view.getUint16(found.head.offset + 18),
      ascender: view.getInt16(found.hhea.offset + 4), descender: view.getInt16(found.hhea.offset + 6),
      lineGap: view.getInt16(found.hhea.offset + 8), capHeight: inkTop(view, found, 0x54), xHeight: inkTop(view, found, 0x78)});
  }
  return cache.get(family);
}

// A tiny slack for float32 values that sit on an integer.
const ceilPixels = value => Math.ceil(value - 1e-6);

// The line a font of this size sets, in pixels. The host rounds the size to a whole pixel first.
//
// ascent and descent follow FreeType's documented scaled metrics, which Godot's text server reads:
// the ascender is rounded up to a whole pixel and the descender is rounded down (its magnitude up),
// so the natural line height is a whole number of pixels. raw* are the same values without that
// rounding, kept to report how far the plain table scale is from the host.
function expectedMetrics(family, size, lineHeight = 0) {
  const font = fontTables(family);
  const pixels = Math.max(1, Math.round(size)), scale = pixels / font.unitsPerEm;
  const rawAscent = font.ascender * scale, rawDescent = -font.descender * scale;
  const ascent = ceilPixels(rawAscent), descent = ceilPixels(rawDescent);
  const natural = ascent + descent, height = lineHeight > 0 ? lineHeight : natural;
  // iOS puts the baseline inside the line box; an explicit lineHeight centres the glyphs in it
  // (RCTAttributedTextUtils.mm:375, and the host's own centring in paragraph_layout.cpp).
  const baseline = (height - natural) / 2 + ascent;
  const rawNatural = rawAscent + rawDescent, rawHeight = lineHeight > 0 ? lineHeight : rawNatural;
  return {size: pixels, ascent, descent, natural, height, baseline, descender: height - baseline,
    capHeight: font.capHeight * scale, xHeight: font.xHeight * scale,
    raw: {baseline: (rawHeight - rawNatural) / 2 + rawAscent, descender: rawHeight - ((rawHeight - rawNatural) / 2 + rawAscent), height: rawHeight}};
}

function close(actual, expected, label, slack = tolerance) {
  assert.ok(Number.isFinite(actual), `${label}: ${actual} is finite`);
  assert.ok(Math.abs(actual - expected) <= slack, `${label}: ${actual} differs from the font tables' ${expected} by more than ${slack}`);
  return Math.abs(actual - expected);
}

const newMaxima = () => ({ascender: 0, descender: 0, height: 0, capHeight: 0, xHeight: 0,
  rawAscender: 0, rawDescender: 0, rawHeight: 0, baselineOffset: 0});
const bump = (maxima, key, value) => {
  maxima[key] = Math.max(maxima[key], value);
};
const sum = values => values.reduce((total, value) => total + value, 0);
const joined = lines => lines.map(line => line.text).join("");

// One onTextLayout payload against the font tables and against the layout it describes.
function verifyEvent(spec, event, node, maxima) {
  const label = spec.id;
  const {lines} = event;
  assert.deepEqual(event.keys, ["lines", "target", "timeStamp"], label + ": RN adds only target and timeStamp to {lines}");
  assert.ok(Array.isArray(lines) && lines.length > 0, label + ": the event carries lines");
  assert.equal(lines.length, node.lineMetrics.length, label + ": one line per visible line");
  assert.equal(lines.length, node.visibleLines, label + ": the visible lines of the node");
  if (spec.numberOfLines > 0) {
    assert.equal(lines.length, spec.numberOfLines, label + ": numberOfLines limits the lines to the visible ones");
  } else {
    assert.equal(joined(lines), spec.text, label + ": the line texts tile the paragraph's text");
  }
  assert.ok(!joined(lines).includes(sentinel), label + ": the host's sentinel never reaches the payload");
  const expected = expectedMetrics(spec.family, spec.size, spec.lineHeight);
  let top = 0;
  lines.forEach((line, index) => {
    const where = `${label} line ${index}`;
    assert.deepEqual(Object.keys(line).sort(), lineKeys, where + ": exactly the nine RN fields");
    assert.equal(typeof line.text, "string", where + ": text");
    for (const key of lineKeys.filter(name => name !== "text")) {
      assert.ok(Number.isFinite(line[key]), `${where}: ${key} is finite`);
    }
    bump(maxima, "ascender", close(line.ascender, expected.baseline, where + " ascender"));
    bump(maxima, "descender", close(line.descender, expected.descender, where + " descender"));
    bump(maxima, "height", close(line.height, expected.height, where + " height"));
    bump(maxima, "capHeight", close(line.capHeight, expected.capHeight, where + " capHeight"));
    bump(maxima, "xHeight", close(line.xHeight, expected.xHeight, where + " xHeight"));
    bump(maxima, "rawAscender", Math.abs(line.ascender - expected.raw.baseline));
    bump(maxima, "rawDescender", Math.abs(line.descender - expected.raw.descender));
    bump(maxima, "rawHeight", Math.abs(line.height - expected.raw.height));
    // The line box: it starts where the one above ended, holds ascender and descender, and the
    // baseline the host paints at is the box's top plus the ascender.
    close(line.y, top, where + " y", 1e-3);
    close(line.ascender + line.descender, line.height, where + " ascender + descender", 1e-3);
    close(line.y + line.ascender, node.lineMetrics[index].baseline, where + " painted baseline", 1e-3);
    // The inked width is the line's own; alignment places it in the box the paragraph was given.
    assert.ok(line.width > 0 && line.width <= spec.width + 1e-3, where + ": the line fits the box");
    const aligned = spec.align === "center" ? (spec.width - line.width) / 2 : spec.align === "right" ? spec.width - line.width : 0;
    close(line.x, aligned, where + " x", 1e-3);
    close(line.x, node.lineMetrics[index].x, where + " painted x", 1e-3);
    close(line.width, node.lineMetrics[index].width, where + " painted width", 1e-3);
    top += line.height;
  });
  close(sum(lines.map(line => line.height)), node.fabricHeight, label + " sum of heights and the node's height");
}

// Rows whose offsets Yoga computes from the baselines: the second text sits lower by the difference.
const baselineRows = [
  {upper: "baseline-large", lower: "baseline-small", upperFont: ["NotoSans", 28, 0], lowerFont: ["NotoSans", 14, 0]},
  {upper: "self-large", lower: "self-small", upperFont: ["NotoSans", 24, 0], lowerFont: ["NotoSans", 12, 0]},
  {upper: "mixed-mono", lower: "mixed-sans", upperFont: ["JetBrainsMono", 12, 40], lowerFont: ["NotoSans", 14, 0]},
];

function verifyBaseline(stage, {original}, maxima) {
  const offsets = [];
  for (const row of baselineRows) {
    const upper = stage.nodes[row.upper], lower = stage.nodes[row.lower];
    assert.ok(upper != null && lower != null, `${row.upper} and ${row.lower} are mounted`);
    const expected = expectedMetrics(...row.upperFont).baseline - expectedMetrics(...row.lowerFont).baseline;
    assert.ok(expected > 1, `${row.lower}: the tables predict a lower text, by ${expected}`);
    const measured = lower.fabricY - upper.fabricY;
    offsets.push({row: row.lower, expected, measured});
    if (original) {
      assert.equal(measured, 0, `${row.lower}: without measureLines Yoga aligns the tops`);
    } else {
      // Yoga places frames on whole pixels, which can move the offset by half of one.
      bump(maxima, "baselineOffset", close(measured, expected, `${row.lower} baseline offset`));
    }
  }
  if (original) {
    assert.equal(stage.lineMeasurementCalls, 0, "the preceding host never reaches measureLines");
  } else {
    assert.ok(stage.lineMeasurementCalls > 0, "Yoga's baseline callback reaches measureLines");
  }
  return offsets;
}

function verifyDedupe(stage, mounted) {
  const [color, same, width, text, limit, removed] = stage.steps;
  assert.deepEqual(stage.steps.map(step => step.label), ["color", "sameLines", "width", "text", "numberOfLines", "withoutHandler"]);
  const total = mounted.react.log.length;
  for (const step of [color, same]) {
    assert.equal(step.eventsAfter, step.eventsBefore, step.label + ": the emitter drops identical measurements");
    assert.ok(step.lineMeasurementCalls > 0, step.label + ": measureLines was asked again");
    assert.equal(step.totalEventsAfter, step.totalEventsBefore, step.label + ": no paragraph emitted");
  }
  assert.notEqual(color.after.runs[0].color, color.before.runs[0].color);
  assert.notEqual(same.after.fabricWidth, same.before.fabricWidth);
  assert.equal(total, 10);
  for (const [step, key] of [[width, "width"], [text, "text"], [limit, "numberOfLines"]]) {
    assert.equal(step.eventsAfter, step.eventsBefore + 1, `${step.label}: a changed ${key} emits once`);
  }
  assert.equal(limit.lines.length, 2);
  assert.equal(removed.eventsAfter, removed.eventsBefore, "no handler, no event");
  assert.equal(removed.lineMeasurementCalls, color.lineMeasurementCalls - 1, "a paragraph without the prop is not asked");
}

function verifyFailure(stage, {original}) {
  for (const [name, variant] of Object.entries(stage)) {
    assert.ok(variant.errors.length > 0 && variant.errors.every(error => error === inlineError), name + ": only the host's error");
    assert.ok(variant.measureCalls > 0, name + ": the failing paragraph is measured");
    // Both paths report each failed call once; the paint preparation of the mount reports too.
    assert.ok(variant.errors.length >= variant.measureCalls + variant.lineCalls, name + ": every failed call reports");
    if (original) {
      assert.equal(variant.lineCalls, 0);
    } else {
      assert.ok(variant.lineCalls > 0, name + ": measureLines is reached and fails without unwinding");
    }
  }
  assert.equal(stage.baselineOnly.listen, false);
  assert.equal(stage.withHandler.listen, true);
  assert.ok(stage.baselineOnly.lineCalls > 0 || original, "the Yoga baseline callback alone reaches measureLines");
}

// Judges one report of the probe. original: the preceding host, without measureLines.
export function verifyTextLayoutReport(report, {original = false} = {}) {
  assert.equal(report.scenario, "native-text-layout");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  const maxima = newMaxima();
  const mounted = report.stages.mount;
  const log = mounted.react.log;
  assert.ok(log.every(row => row.id !== "silent" && row.id !== "span-inner"), "no event for a paragraph without the prop or for a span");
  assert.ok(log.every((row, index) => index === 0 || log[index - 1].sequence < row.sequence), "events are in dispatch order");
  assert.deepEqual(report.stages.negative.messages.map((message, index) => message.includes(rejectionMessages[index])),
    rejectionMessages.map(() => true), "the wrapper's rejections");
  verifyFailure(report.stages.failure, {original});
  const offsets = verifyBaseline(report.stages.baseline, {original}, maxima);
  if (original) {
    assert.equal(log.length, 0, "the preceding host delivers no onTextLayout");
    return {original: true, maxima, offsets};
  }
  assert.equal(log.length, mounted.expectedIds.length);
  for (const spec of mounted.react.specs) {
    const rows = log.filter(row => row.id === spec.id);
    assert.equal(rows.length, 1, spec.id + ": one event");
    verifyEvent(spec, rows[0], mounted.nodes[spec.id], maxima);
  }
  const outer = log.filter(row => row.id === "span-outer");
  assert.equal(outer.length, 1);
  assert.equal(joined(outer[0].lines), "Outer before inner span and after", "a composite paragraph's lines tile its nested text");
  verifyDedupe(report.stages.dedupe, mounted);
  // The deviation of the plain tables, without FreeType's rounding of the ascent and descent, is what
  // the proposed one pixel could not hold for the natural height: it is recorded, not asserted.
  return {original: false, tolerance, maxima, offsets};
}
