import assert from "node:assert/strict";
import {timingDriver} from "./transform-timing-driver.mjs";

// The oracle for examples/transforms/uniform-scale.gd, written apart from it. The
// planar matrix of each declaration in examples/transforms/App.jsx is derived here
// with plain arithmetic, and what the probe recorded from the actual Godot
// Controls (and from the saved frame) is compared with it. The probe's own pass
// flags are never consulted: a report with every flag forced true must still be
// rejected when the Controls it recorded are wrong or missing.
export const MODES = ["uniform", "uniform-rotate", "uniform-origin", "uniform-animated", "uniform-press"];
// The cases whose static matrix is checked: the three plain Views and the Pressable.
const MATRIX_MODES = ["uniform", "uniform-rotate", "uniform-origin", "uniform-press"];
const ANIMATED = "uniform-animated";
const PRESS = "uniform-press";
// Where examples/transforms/App.jsx puts each case: the Godot Surface it runs in
// ([x, y, width, height] in the window) and the left edge of the unscaled layout box
// inside it; the box is 160 x 100 at top 140 everywhere.
const BOX = {top: 140, width: 160, height: 100};
const LAYOUT = {
  uniform: {surface: [5, 10, 290, 325], left: 65},
  "uniform-rotate": {surface: [305, 10, 290, 325], left: 65},
  "uniform-origin": {surface: [605, 10, 290, 325], left: 65},
  [ANIMATED]: {surface: [5, 345, 440, 325], left: 140},
  [PRESS]: {surface: [455, 345, 440, 325], left: 140},
};
const DECLARED = {
  uniform: {factor: 1.5, degrees: 0, originPercent: null},
  "uniform-rotate": {factor: 0.5, degrees: 30, originPercent: null},
  "uniform-origin": {factor: 1.5, degrees: 0, originPercent: [25, 75]},
  [ANIMATED]: {factor: 1.5, degrees: 0, originPercent: null},
  [PRESS]: {factor: 1.2, degrees: 0, originPercent: null},
};
// The two presses on the scaled Pressable, in the layout box's own coordinates. The
// scale 1.2 about the centre covers (-16, -10) to (176, 110): the miss is left of
// both boxes, the hit is left of and below the layout box and inside the scaled one.
const PRESS_MISS = [-24, 50];
const PRESS_HIT = [-8, 104];
export const COLORS = {uniform: "0ea5e9", "uniform-rotate": "f59e0b", "uniform-origin": "a855f7", [ANIMATED]: "22c55e", [PRESS]: "ec4899",
  card: "16233b", marker: "f8fafc"};
// Checks per case (uniform-scale.gd): four on a static case plus its release; the
// Pressable's two presses on top of those; on the animated case its rest, its run, its
// frames, its end, the press back and its release; and one for the independence of the
// runtimes.
const CHECKS = {uniform: 5, "uniform-rotate": 5, "uniform-origin": 5, [ANIMATED]: 6, [PRESS]: 7};
// What the Control's scale may differ from the value RN's driver applied, once the value is
// rounded to the float the Control stores its scale in. The host reproduces that float to
// double rounding (maximumFactorError); this leaves the room of about 16 ulps at 1 that the
// Animated lane gives an opacity.
const FACTOR_TOLERANCE = 1e-6;

const close = (actual, expected, tolerance, what) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} against ${expected}`);
const wrap = turn => Math.atan2(Math.sin(turn), Math.cos(turn));

// The planar matrix of a case at a scale factor, in Godot's Transform2D layout
// [x.x, x.y, y.x, y.y, origin.x, origin.y], in the window: the scale (and
// rotation) about the transform origin, placed at the box's Yoga position inside
// its Surface. `position` is what the Control's own position holds, because a
// Control pivots about its centre: the origin's translation measured from there.
function planar(mode, factor = DECLARED[mode].factor) {
  const {degrees, originPercent} = DECLARED[mode];
  const turn = degrees * Math.PI / 180;
  const a = factor * Math.cos(turn), b = factor * Math.sin(turn);
  const map = (x, y) => [a * x - b * y, b * x + a * y];
  const centre = [BOX.width / 2, BOX.height / 2];
  const origin = originPercent == null ? centre
    : [BOX.width * originPercent[0] / 100, BOX.height * originPercent[1] / 100];
  const {surface: [surfaceX, surfaceY], left} = LAYOUT[mode];
  const [mappedX, mappedY] = map(...origin);
  const shift = [origin[0] - centre[0], origin[1] - centre[1]];
  const [shiftedX, shiftedY] = map(...shift);
  return {affine: [a, b, -b, a, surfaceX + left + origin[0] - mappedX, surfaceY + BOX.top + origin[1] - mappedY], turn,
    position: [left + shift[0] - shiftedX, BOX.top + shift[1] - shiftedY]};
}

const place = (affine, x, y) => [affine[0] * x + affine[2] * y + affine[4], affine[1] * x + affine[3] * y + affine[5]];
const corners = affine => [[0, 0], [BOX.width, 0], [BOX.width, BOX.height], [0, BOX.height]].map(([x, y]) => place(affine, x, y));

// A point of the window in the box's own coordinates: invert the matrix.
function unplace(affine, [x, y]) {
  const determinant = affine[0] * affine[3] - affine[2] * affine[1];
  const dx = x - affine[4], dy = y - affine[5];
  return [(affine[3] * dx - affine[2] * dy) / determinant, (-affine[1] * dx + affine[0] * dy) / determinant];
}

const insideBox = ([x, y]) => x >= 0 && x <= BOX.width && y >= 0 && y <= BOX.height;
// Whether a point of the window lies inside the painted box.
const paints = (affine, point) => insideBox(unplace(affine, point));

// The window point of a position given in the layout box's own coordinates.
const windowPoint = (mode, [x, y]) => [LAYOUT[mode].surface[0] + LAYOUT[mode].left + x, LAYOUT[mode].surface[1] + BOX.top + y];

// The window point (logical pixels) of a pixel sample, and the color it must have.
function expectedPixel(entry) {
  const point = windowPoint(entry.case, entry.offset);
  const final = planar(entry.case, entry.case === ANIMATED ? 1.5 : DECLARED[entry.case].factor).affine;
  const color = entry.kind === "marker" ? COLORS.marker : paints(final, point) ? COLORS[entry.case] : COLORS.card;
  return {point, color};
}

function verifyStaticCase(report, mode, worst) {
  const entry = report.cases[mode];
  assert.ok(entry?.native && entry.expected, `${mode}: the Control's transform was recorded`);
  const want = planar(mode), {native} = entry;
  native.global.forEach((value, index) => {
    const tolerance = index < 4 ? 1e-5 : 1e-3;
    close(value, want.affine[index], tolerance, `${mode}: affine coefficient ${index}`);
    worst[index < 4 ? "linear" : "translation"] = Math.max(worst[index < 4 ? "linear" : "translation"], Math.abs(value - want.affine[index]));
  });
  corners(want.affine).forEach((corner, index) => corner.forEach((value, axis) =>
    close(native.corners[index][axis], value, 1e-3, `${mode}: corner ${index}`)));
  close(native.scale[0], DECLARED[mode].factor, 1e-6, `${mode}: scale x`);
  close(native.scale[1], DECLARED[mode].factor, 1e-6, `${mode}: scale y`);
  close(wrap(native.angle - want.turn), 0, 1e-5, `${mode}: drawn angle`);
  close(native.position[0], want.position[0], 1e-3, `${mode}: position x`);
  close(native.position[1], want.position[1], 1e-3, `${mode}: position y`);
  assert.deepEqual(native.size, [BOX.width, BOX.height], `${mode}: the Control keeps its layout size`);
  assert.deepEqual(entry.afterStop.errors, [], `${mode}: no host error`);
}

// The scaled Pressable under two real mouse presses. Where the matrix puts each press is
// derived here from the declaration, not read from the probe: the miss lies outside the
// painted box and reaches nothing; the hit lies outside the layout box and inside the
// painted one, so it reaches the Pressable only if hit testing follows the scaled
// geometry, and the point it reports is the matrix's inverse of it.
function verifyPressCase(report) {
  const entry = report.cases[PRESS], press = entry?.press;
  assert.ok(press, "The Pressable's presses were recorded");
  const want = planar(PRESS), {left} = LAYOUT[PRESS];
  const miss = windowPoint(PRESS, PRESS_MISS), hit = windowPoint(PRESS, PRESS_HIT);
  assert.deepEqual(press.missPoint, miss, "The miss is where the declaration puts it");
  assert.deepEqual(press.hitPoint, hit, "The hit is where the declaration puts it");
  assert.ok(!insideBox(PRESS_MISS) && !paints(want.affine, miss), "The miss is outside both the layout box and the painted one");
  assert.ok(!insideBox(PRESS_HIT) && paints(want.affine, hit), "The hit is outside the layout box and inside the painted one");
  assert.deepEqual(press.afterMiss.presses, [], "A press outside the painted box reaches no Pressable");
  assert.equal(press.afterMiss.caption, "a Pressable under a uniform scale", "The miss leaves the rendered caption as it was");
  assert.equal(press.afterMiss.pointer.activeTouches, 0, "The miss leaves no contact");
  assert.equal(press.afterMiss.pointer.responder, 0, "The miss grants no responder");
  assert.ok(Number.isInteger(press.targetTag) && press.targetTag > 0, "The probe resolved the Pressable's native tag");
  assert.equal(press.held.activeTouches, 1, "The held press is one contact");
  assert.equal(press.held.responder, press.targetTag, "The Pressable holds the responder during the press");
  assert.deepEqual(press.presses.map(event => event.type).sort(), ["in", "out", "press"], "pressIn, pressOut and press fire once each");
  assert.equal(press.presses[0].type, "in", "pressIn comes first");
  const local = unplace(want.affine, hit), page = [left + PRESS_HIT[0], BOX.top + PRESS_HIT[1]];
  for (const event of press.presses) {
    assert.equal(event.target, press.targetTag, `${event.type}: the Pressable is the target`);
    close(event.locationX, local[0], 0.01, `${event.type}: target-local x`);
    close(event.locationY, local[1], 0.01, `${event.type}: target-local y`);
    close(event.pageX, page[0], 0.01, `${event.type}: root x`);
    close(event.pageY, page[1], 0.01, `${event.type}: root y`);
  }
  assert.equal(press.caption, `pressed at (${local[0].toFixed(1)}, ${local[1].toFixed(1)}) in its own coordinates`,
    "The rendered caption names the point the matrix maps the press to");
  // The scale is what moved the point: the layout-box offset of the press is another number.
  assert.ok(Math.abs(press.presses[0].locationX - PRESS_HIT[0]) > 10, "The reported x is not the unscaled offset");
  assert.equal(press.afterHit.activeTouches, 0, "The release leaves no contact");
  assert.equal(press.afterHit.responder, 0, "The release leaves no responder");
}

// One animation, frame by frame, from a sample taken before it ran: uniform scale and no
// rotation, in time order, every frame the planar matrix of its own factor. The backend
// delivers one timestamp per Godot frame, however the host paces them, and RN's native timing
// driver turns each into the scale the node takes (transform-timing-driver.mjs recomputes it,
// the extension of the table between its entries included, and completes on the first frame
// past the last). So every sample is judged against the driver's own value for the frames
// delivered so far, never against a count of frames or a curve that moves one way, which no
// pacing guarantees; a Godot frame in which the backend delivered nothing leaves the Control as
// it was. Returns how many frames the host delivered during the leg and how many of them
// applied a scale strictly between the ends.
function verifyLeg(samples, from, to, label, worst) {
  assert.ok(Array.isArray(samples) && samples.length >= 2, `${label}: the Control was sampled frame by frame`);
  assert.ok(Number.isInteger(samples[0].frames), `${label}: the backend's frame count was sampled`);
  const driver = timingDriver({from, to});
  let value = from, complete = false, delivered = 0, between = 0, elapsed = -1;
  for (const [index, sample] of samples.entries()) {
    assert.ok(sample.ms >= elapsed, `${label} sample ${index} is in time order`);
    elapsed = sample.ms;
    if (index > 0) {
      const before = samples[index - 1], frames = sample.frames - before.frames;
      assert.ok(frames === 0 || frames === 1, `${label} sample ${index}: at most one frame per Godot frame`);
      if (frames === 0) {
        assert.equal(sample.ts, before.ts, `${label} sample ${index}: no frame, no new timestamp`);
      } else {
        assert.ok(typeof sample.ts === "number" && (before.ts === null || sample.ts > before.ts),
          `${label} sample ${index}: frame timestamps increase`);
        delivered += 1;
        // A frame after the driver completed has none to run.
        if (!complete) {
          ({value, complete} = driver(sample.ts));
          if (value > Math.min(from, to) && value < Math.max(from, to)) {
            between += 1;
          }
        }
      }
    }
    const applied = Math.fround(value), [x, y] = sample.scale;
    close(x, y, 1e-6, `${label} sample ${index}: uniform scale`);
    close(sample.angle, 0, 1e-6, `${label} sample ${index}: no rotation`);
    close(x, applied, FACTOR_TOLERANCE, `${label} sample ${index}: the scale RN's driver applied`);
    worst.factor = Math.max(worst.factor, Math.abs(x - applied));
    // The whole matrix, not just the scale: every frame is the planar matrix of its own factor.
    planar(ANIMATED, x).affine.forEach((expected, axis) => {
      close(sample.global[axis], expected, axis < 4 ? 1e-5 : 1e-3, `${label} sample ${index}: affine coefficient ${axis}`);
      worst[axis < 4 ? "linear" : "translation"] = Math.max(worst[axis < 4 ? "linear" : "translation"], Math.abs(sample.global[axis] - expected));
    });
  }
  assert.ok(complete, `${label}: RN's driver completed over the frames delivered`);
  return {delivered, between};
}

function verifyAnimatedCase(report, worst) {
  const entry = report.cases[ANIMATED];
  assert.ok(entry?.samples && entry.back, "The animated Control was recorded on both legs");
  assert.deepEqual([entry.samples[0].frames, entry.samples[0].ts], [0, null], "rise: the backend had delivered no frame before the animation");
  const rise = verifyLeg(entry.samples, 1, 1.5, "rise", worst);
  assert.deepEqual(entry.react.ends, [{toValue: 1.5, finished: true}], "RN reports one finished animation");
  assert.equal(entry.react.renders, 2, "React rendered at mount and at the end only");
  assert.ok(entry.backend.directUpdates > 0 && entry.backend.staleDirectUpdates === 0 && entry.backend.active === false,
    "RN's backend applied the frames directly and idles");
  // The press on Pop: the same animation back, to the identity matrix, from where the backend
  // stood when the first leg ended: it delivers nothing while it is idle.
  assert.deepEqual([entry.back.samples[0].frames, entry.back.samples[0].ts], [entry.samples.at(-1).frames, entry.samples.at(-1).ts],
    "The backend delivered no frame between the legs");
  const fall = verifyLeg(entry.back.samples, 1.5, 1, "fall", worst);
  assert.deepEqual(entry.back.react.ends, [{toValue: 1.5, finished: true}, {toValue: 1, finished: true}]);
  assert.equal(entry.back.react.runs, 2);
  assert.equal(entry.back.react.renders, 3, "React rendered at mount and at each end only");
  assert.deepEqual(entry.back.errors, [], "animated: no host error on the way back");
  // The probe's own derivations agree with this oracle's, at rest and at the end.
  planar(ANIMATED, 1).affine.forEach((value, axis) => close(entry.expected.restGlobal[axis], value, 1e-6, `rest matrix ${axis}`));
  planar(ANIMATED, 1.5).affine.forEach((value, axis) => close(entry.expected.finalGlobal[axis], value, 1e-6, `final matrix ${axis}`));
  entry.back.samples.at(-1).global.forEach((value, axis) =>
    close(value, planar(ANIMATED, 1).affine[axis], 1e-6, `The Control is back at the identity matrix: coefficient ${axis}`));
  assert.deepEqual(entry.afterStop.errors, [], "animated: no host error");
  return [rise, fall];
}

// Throws on the first derivation the report does not meet; returns the largest
// error observed so a receipt can state how tight the agreement is.
export function verifyUniformScaleReport(report, {capture = false} = {}) {
  assert.equal(report.scenario, "transforms-uniform-scale");
  assert.deepEqual(report.modes, MODES);
  assert.deepEqual(report.layout, {boxTop: BOX.top, boxSize: [BOX.width, BOX.height],
    boxLeft: Object.fromEntries(MODES.map(mode => [mode, LAYOUT[mode].left])),
    surfaces: Object.fromEntries(MODES.map(mode => [mode, LAYOUT[mode].surface]))});
  const names = report.checks.map(row => row.name);
  assert.equal(new Set(names).size, names.length, "Check names are unique");
  for (const mode of MODES) {
    assert.equal(names.filter(name => name.startsWith(mode + "/")).length, CHECKS[mode] + (capture ? 1 : 0), `${mode}: executed checks`);
  }
  assert.equal(names.length, 1 + MODES.reduce((total, mode) => total + CHECKS[mode], 0) + (capture ? 1 + MODES.length : 0),
    "No check is missing or extra");
  assert.equal(new Set(MODES.map(mode => report.cases[mode]?.runtimeId)).size, MODES.length, "Five independent runtimes");
  const worst = {linear: 0, translation: 0, factor: 0};
  for (const mode of MATRIX_MODES) {
    verifyStaticCase(report, mode, worst);
  }
  verifyPressCase(report);
  const legs = verifyAnimatedCase(report, worst);
  if (capture) {
    assert.equal(report.images.length, 1);
    const [image] = report.images;
    assert.equal(image.file, "build/transform-uniform-scale.png");
    assert.ok(image.samples.length >= 20, "The frame was sampled at the analytical points");
    for (const sample of image.samples) {
      const {point, color} = expectedPixel(sample);
      assert.deepEqual(sample.point, point, `${sample.case}: sample point`);
      assert.equal(sample.expected, color, `${sample.case}: sample color at ${point}`);
      assert.equal(sample.passed, true, `${sample.case}: pixel at ${point}`);
    }
  }
  return {maximumLinearError: worst.linear, maximumTranslationError: worst.translation, maximumFactorError: worst.factor,
    animatedFrames: legs[0].delivered + legs[1].delivered, animatedIntermediateFrames: legs[0].between + legs[1].between};
}

// The rejection the oracle gives on its own derivations, with every probe flag
// forced to passed. Null means it accepted the report.
export function oracleRejection(report, options) {
  try {
    verifyUniformScaleReport({...report, checks: report.checks.map(row => ({...row, passed: true}))}, options);
  } catch (error) {
    return String(error.message).split("\n")[0];
  }
  return null;
}
