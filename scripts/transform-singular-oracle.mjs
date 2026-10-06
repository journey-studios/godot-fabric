import assert from "node:assert/strict";
import {timingDriver} from "./transform-timing-driver.mjs";

// The oracle for examples/transforms/singular.gd, written apart from it. What RN
// computes for each declaration in examples/transforms/App.jsx (the box a degenerate
// matrix leaves, where a press lands, what a captured pointer reports) is derived
// here with plain arithmetic, and what the probe recorded from the actual Godot
// Controls, from RN's own measurement APIs, from real mouse presses and from the
// saved frame is compared with it. The probe's own pass flags are never consulted: a
// report with every flag forced true must still be rejected when what it recorded is
// wrong or missing.
export const MODES = ["scale-zero", "scale-x-zero", "rank-one", "rank-lost", "entrance", "exit", "toggle", "capture"];
const STATIC_MODES = ["scale-zero", "scale-x-zero", "rank-one", "rank-lost"];
const ENTRANCE = "entrance";
const EXIT = "exit";
const TOGGLE = "toggle";
const CAPTURE = "capture";
// Where examples/transforms/App.jsx puts each case: the Godot Surface it runs in
// ([x, y, width, height] in the window) and the unscaled layout box inside it, which
// is 160 x 100 at left 28 and top 140 everywhere.
const BOX = {left: 28, top: 140, width: 160, height: 100};
const SURFACES = {
  "scale-zero": [5, 10, 215, 325],
  "scale-x-zero": [230, 10, 215, 325],
  "rank-one": [455, 10, 215, 325],
  "rank-lost": [680, 10, 215, 325],
  entrance: [5, 345, 215, 325],
  exit: [230, 345, 215, 325],
  toggle: [455, 345, 215, 325],
  capture: [680, 345, 215, 325],
};
// The plate behind the box (card coordinates: margin on each side, top, height), the
// marker child of the box (box coordinates) and the capture case's source strip (card
// coordinates), all [x, y, width, height].
const PLATE = {margin: 6, top: 110, height: 160};
const MARKER = [14, 14, 28, 28];
const SOURCE = [28, 52, 160, 52];
// The planar part [a, b, c, d] each static case declares in its style: x' = a x + c y,
// y' = b x + d y, about the center of the box (RN's default transform origin). The
// rank-lost one is [2u u; u u] for the smallest float subnormal u = 2^-149.
const UNIT = 2 ** -149;
const MATRICES = {"scale-zero": [0, 0, 0, 0], "scale-x-zero": [0, 0, 0, 1], "rank-one": [1, 5, 5, 25],
  "rank-lost": [2 * UNIT, UNIT, UNIT, UNIT]};
// The scale each step of the toggle case declares, and the one each case declares at
// the moment the frame is captured (0 is collapsed).
const TOGGLE_STEPS = [0, 1.25, 0, 1];
const CAPTURED_SCALE = {"scale-zero": 0, "scale-x-zero": 0, "rank-one": 0, "rank-lost": 0, entrance: 1, exit: 0, toggle: 1.25, capture: 0};
// The capture case's gesture, in the card's coordinates.
const GESTURE = {down: [108, 78], first: [150, 256], second: [160, 260]};
export const COLORS = {"scale-zero": "0ea5e9", "scale-x-zero": "f59e0b", "rank-one": "a855f7", "rank-lost": "6366f1", entrance: "22c55e",
  exit: "ec4899", toggle: "14b8a6", capture: "f43f5e", card: "16233b", plate: "2d4166", source: "475569", marker: "f8fafc"};
// Checks per case (singular.gd): the static cases have mount, hidden, measured,
// behind, stable and release; the animated ones their rest, press before, run, frames,
// end and release, and the exit also the focus of its field; the toggle its four
// states, the canceled contact, the layout and release; the capture its three phases
// and release; and one for the independence of the runtimes.
const CHECKS = {"scale-zero": 6, "scale-x-zero": 6, "rank-one": 6, "rank-lost": 6, entrance: 6, exit: 7, toggle: 7, capture: 4};
// RN's Transform::Scale flattens a factor below this to exactly 0 (isZero): a View is
// collapsed then, and never shown at a smaller scale.
const RN_ZERO = 1e-5;
// What the Control's signed scale may differ from the value RN's driver applied, once the
// value is rounded to the float RN's props carry it in. The host splits the matrix into the
// Control's own scale and angle, which here reproduces that float to double rounding
// (maximumFactorError); this leaves the room of about 16 ulps at 1 that the Animated lane
// gives an opacity.
const FACTOR_TOLERANCE = 1e-6;

const close = (actual, expected, tolerance, what) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} against ${expected}`);
const closeAll = (actual, expected, tolerance, what) => {
  assert.equal(actual?.length, expected.length, `${what}: ${expected.length} values`);
  expected.forEach((value, index) => close(actual[index], value, tolerance, `${what}[${index}]`));
};

const surfaceOf = mode => SURFACES[mode];
const boxCenter = () => [BOX.left + BOX.width / 2, BOX.top + BOX.height / 2];
// The window point of a point of the card.
const windowPoint = (mode, [x, y]) => [surfaceOf(mode)[0] + x, surfaceOf(mode)[1] + y];
// Where a real press at the box's center lands, in the window.
const pressPoint = mode => windowPoint(mode, boxCenter());

// The planar matrix of a uniform scale about the box's center, in Godot's Transform2D
// layout [x.x, x.y, y.x, y.y, origin.x, origin.y], in the window: the box at its Yoga
// position inside its Surface, scaled about its own center.
function planar(mode, factor) {
  const [surfaceX, surfaceY] = surfaceOf(mode);
  return [factor, 0, 0, factor,
    surfaceX + BOX.left + BOX.width / 2 * (1 - factor), surfaceY + BOX.top + BOX.height / 2 * (1 - factor)];
}

// The box RN computes for a static case, in the card's coordinates: the bounding box
// of the four corners of the layout box mapped by the declared matrix about its center.
function declaredBox(mode) {
  const [a, b, c, d] = MATRICES[mode];
  const [cx, cy] = boxCenter();
  const corners = [[-BOX.width / 2, -BOX.height / 2], [BOX.width / 2, -BOX.height / 2],
    [BOX.width / 2, BOX.height / 2], [-BOX.width / 2, BOX.height / 2]].map(([x, y]) => [a * x + c * y + cx, b * x + d * y + cy]);
  const xs = corners.map(point => point[0]), ys = corners.map(point => point[1]);
  return {x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys)};
}

const finite = values => values.every(value => Number.isFinite(value));
// The singular values of [a c; b d], the larger first.
function singularValues([a, b, c, d]) {
  const sum = a * a + b * b + c * c + d * d, determinant = a * d - b * c;
  const larger = Math.sqrt((sum + Math.sqrt(Math.max(sum * sum - 4 * determinant * determinant, 0))) / 2);
  return [larger, Math.abs(determinant) / larger];
}
// A Control that was hidden keeps a finite transform with an inverse.
function assertKeptTransform(global, what) {
  assert.ok(global.length === 6 && finite(global), `${what}: the transform is finite`);
  assert.ok(Math.abs(global[0] * global[3] - global[1] * global[2]) > 0, `${what}: the transform is invertible`);
}
function assertHidden(native, what) {
  assert.equal(native.present, true, `${what}: the Control exists`);
  assert.equal(native.visible, false, `${what}: the Control is hidden`);
  assert.equal(native.visibleInTree, false, `${what}: the Control is not visible in the tree`);
  assert.equal(native.childVisibleInTree, false, `${what}: the marker child is hidden with it`);
  assertKeptTransform(native.global, what);
  assert.deepEqual(native.size, [BOX.width, BOX.height], `${what}: the Control keeps its layout size`);
}
function assertShown(native, mode, factor, what, worst) {
  assert.equal(native.present, true, `${what}: the Control exists`);
  assert.equal(native.visible, true, `${what}: the Control is shown`);
  assert.equal(native.visibleInTree, true, `${what}: the Control is visible in the tree`);
  assert.equal(native.childVisibleInTree, true, `${what}: the marker child is shown with it`);
  planar(mode, factor).forEach((value, index) => {
    const tolerance = index < 4 ? 1e-5 : 1e-3;
    close(native.global[index], value, tolerance, `${what}: affine coefficient ${index}`);
    if (worst) {
      worst[index < 4 ? "linear" : "translation"] = Math.max(worst[index < 4 ? "linear" : "translation"], Math.abs(native.global[index] - value));
    }
  });
  assert.deepEqual(native.size, [BOX.width, BOX.height], `${what}: the Control keeps its layout size`);
}

// A real press and release that landed on `who` once and nobody else: pressIn, then
// pressOut and press, each targeting the tag of `who` at the point the declaration puts
// the press in that target's own coordinates, and the contact released afterwards.
function assertPress(mode, press, who, what) {
  assert.deepEqual(press.point, pressPoint(mode), `${what}: the press is where the declaration puts the box's center`);
  assert.ok(Number.isInteger(press.tags.box) && press.tags.box > 0 && Number.isInteger(press.tags.behind) && press.tags.behind > 0 &&
    press.tags.box !== press.tags.behind, `${what}: the probe resolved both native tags`);
  assert.deepEqual(press.presses.map(event => event.type).sort(), ["in", "out", "press"], `${what}: pressIn, pressOut and press fire once each`);
  assert.equal(press.presses[0].type, "in", `${what}: pressIn comes first`);
  const [pageX, pageY] = boxCenter();
  // The plate's own coordinates: the center of the box is that far from its corner.
  const local = who === "behind" ? [pageX - PLATE.margin, pageY - PLATE.top] : [BOX.width / 2, BOX.height / 2];
  for (const event of press.presses) {
    assert.equal(event.who, who, `${what}: ${event.type} reached ${who}`);
    assert.equal(event.target, press.tags[who], `${what}: ${event.type} targets the tag of ${who}`);
    closeAll([event.locationX, event.locationY, event.pageX, event.pageY], [...local, pageX, pageY], 0.01, `${what}: ${event.type} coordinates`);
  }
  assert.equal(press.held.activeTouches, 1, `${what}: the held press is one contact`);
  assert.equal(press.held.responder, press.tags[who], `${what}: ${who} holds the responder during the press`);
  assert.equal(press.after.activeTouches, 0, `${what}: the release leaves no contact`);
  assert.equal(press.after.responder, 0, `${what}: the release leaves no responder`);
}

function verifyStaticCase(report, mode) {
  const entry = report.cases[mode];
  assert.ok(entry?.native && entry.rn && entry.press && entry.later, `${mode}: the collapsed case was recorded`);
  assert.deepEqual(entry.errors, [], `${mode}: no host error at mount`);
  assertHidden(entry.native, mode);
  // The layout RN keeps: onLayout reports the Yoga frame once, and its measurement
  // APIs the box RN computes for the degenerate matrix, which this oracle derives.
  const left = BOX.left, [surfaceX, surfaceY] = surfaceOf(mode), box = declaredBox(mode);
  assert.deepEqual(entry.rn.layouts, [{x: left, y: BOX.top, width: BOX.width, height: BOX.height}], `${mode}: onLayout reports the layout box once`);
  const {rect, measure, window, offset} = entry.rn.read;
  closeAll([rect.x, rect.y, rect.width, rect.height], [surfaceX + box.x, surfaceY + box.y, box.width, box.height], 1e-3, `${mode}: getBoundingClientRect`);
  closeAll([rect.left, rect.top, rect.right, rect.bottom],
    [surfaceX + box.x, surfaceY + box.y, surfaceX + box.x + box.width, surfaceY + box.y + box.height], 1e-3, `${mode}: the rect's edges`);
  closeAll(measure, [left, BOX.top, box.width, box.height, box.x, box.y], 1e-3, `${mode}: measure`);
  closeAll(window, [surfaceX + box.x, surfaceY + box.y, box.width, box.height], 1e-3, `${mode}: measureInWindow`);
  assert.deepEqual(offset, [left, BOX.top, BOX.width, BOX.height], `${mode}: the offsets are the layout box's`);
  // What the declaration means: the matrix has no inverse, or loses its rank in the float
  // the Control stores its scale in. Either way nothing of the box has an area.
  const [a, b, c, d] = MATRICES[mode], [larger, smaller] = singularValues(MATRICES[mode]);
  if (mode === "rank-lost") {
    assert.notEqual(a * d - b * c, 0, `${mode}: the declared matrix is not singular`);
    assert.ok(Math.fround(larger) > 0 && Math.fround(smaller) === 0, `${mode}: its smaller singular value ${smaller} rounds to zero in a float`);
  } else {
    assert.equal(a * d - b * c, 0, `${mode}: the declared matrix is singular`);
  }
  assertPress(mode, entry.press, "behind", mode);
  assert.equal(entry.press.caption, "box 0 · behind 1", `${mode}: the caption counts the press the plate received`);
  assertKeptTransform(entry.later.global, mode);
  closeAll(entry.later.global, entry.native.global, 1e-9, `${mode}: the transform stays put across later frames`);
  assert.equal(entry.later.visible, false, `${mode}: still hidden later`);
  assert.deepEqual(entry.afterStop.errors, [], `${mode}: no host error`);
}

// One animation, frame by frame, from a sample taken before it ran. The backend delivers one
// timestamp per Godot frame, however the host paces them, and RN's native timing driver turns
// each into the scale the node takes (transform-timing-driver.mjs recomputes it, the extension
// of the table between its entries included, and completes on the first frame past the last).
// So every sample is judged against the driver's own value for the frames delivered so far,
// never against a count of frames or a curve that moves one way, which no pacing guarantees.
// The Control is hidden exactly while that value collapses (RN flattens a factor below
// RN_ZERO to 0) and otherwise shown at the planar matrix of the signed scale its own scale and
// angle carry, which is the value: a value an ease curve extends below 0 in its first frames
// is a tiny mirrored scale, a half turn at that scale. A Godot frame in which the backend
// delivered nothing leaves the Control as it was. Returns how many frames the host delivered
// and how many of them applied a scale strictly between the ends.
function verifyLeg(mode, samples, rising, worst) {
  const label = rising ? "rise" : "fall";
  assert.ok(Array.isArray(samples) && samples.length >= 2, `${label}: the Control was sampled frame by frame`);
  const from = rising ? 0 : 1, to = rising ? 1 : 0;
  assert.equal(samples[0].frames, 0, `${label}: the backend had delivered no frame before the animation`);
  assert.equal(samples[0].ts, null, `${label}: and so no timestamp`);
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
    assertKeptTransform(sample.global, `${label} sample ${index}`);
    // The node's value as RN's props carry it, a float.
    const applied = Math.fround(value);
    if (Math.abs(applied) < RN_ZERO) {
      assert.equal(sample.visible, false, `${label} sample ${index}: hidden while RN's scale is zero (${value})`);
      assert.equal(sample.visibleInTree, false, `${label} sample ${index}: a hidden Control is not visible in the tree`);
      continue;
    }
    assert.equal(sample.visible, true, `${label} sample ${index}: shown while RN's scale is ${value}`);
    assert.equal(sample.visibleInTree, true, `${label} sample ${index}: a shown Control is visible in the tree`);
    // The signed scale comes from the Control's own scale and angle, apart from the global matrix it is compared with.
    const [scaleX, scaleY] = sample.scale, factor = scaleX * Math.cos(sample.angle);
    close(scaleY, scaleX, 1e-6, `${label} sample ${index}: uniform scale`);
    close(Math.sin(sample.angle), 0, 1e-6, `${label} sample ${index}: a turn of 0 or half a turn at most`);
    close(factor, applied, FACTOR_TOLERANCE, `${label} sample ${index}: the scale RN's driver applied`);
    worst.factor = Math.max(worst.factor, Math.abs(factor - applied));
    // The whole matrix, not just the scale: every shown frame is the planar matrix of its own factor.
    planar(mode, factor).forEach((expected, axis) => {
      close(sample.global[axis], expected, axis < 4 ? 1e-5 : 1e-3, `${label} sample ${index}: affine coefficient ${axis}`);
      worst[axis < 4 ? "linear" : "translation"] = Math.max(worst[axis < 4 ? "linear" : "translation"], Math.abs(sample.global[axis] - expected));
    });
  }
  assert.ok(complete, `${label}: RN's driver completed over the frames delivered`);
  return {delivered, between};
}

function verifyAnimatedCase(report, mode, worst) {
  const entry = report.cases[mode], rising = mode === ENTRANCE;
  assert.ok(entry?.samples && entry.rest && entry.pressBefore && entry.pressAfter && entry.end, `${mode}: the animated case was recorded`);
  assert.deepEqual(entry.errors, [], `${mode}: no host error at mount`);
  assert.equal(entry.rest.backend.enabled, true, `${mode}: RN's native backend is attached`);
  assert.equal(entry.rest.backend.frames, 0, `${mode}: the backend has run no frame at rest`);
  assert.equal(entry.rest.backend.active, false, `${mode}: the backend is idle at rest`);
  if (rising) {
    assertHidden(entry.rest.native, `${mode} at rest`);
  } else {
    assertShown(entry.rest.native, mode, 1, `${mode} at rest`, worst);
  }
  // A real press before the animation: on the collapsed Animated.View it reaches the
  // plate behind it, on the shown one the box.
  assertPress(mode, entry.pressBefore, rising ? "behind" : "box", `${mode} before`);
  const frames = verifyLeg(mode, entry.samples, rising, worst);
  assert.deepEqual(entry.react.ends, [{toValue: rising ? 1 : 0, finished: true}], `${mode}: RN reports one finished animation`);
  assert.equal(entry.react.runs, 1, `${mode}: the animation ran once`);
  assert.equal(entry.react.renders, entry.rendersBefore, `${mode}: React rendered no frame of the animation`);
  assert.ok(entry.backend.directUpdates > 0 && entry.backend.staleDirectUpdates === 0 && entry.backend.active === false,
    `${mode}: RN's backend applied the frames directly and idles`);
  assert.deepEqual(entry.errorsAfterRun, [], `${mode}: no host error through the animation`);
  // The end: the entrance rests shown at the identity matrix and a press reaches the
  // box; the exit is hidden and a press reaches the plate again.
  if (rising) {
    assertShown(entry.end, mode, 1, `${mode} at the end`, worst);
  } else {
    assertHidden(entry.end, `${mode} at the end`);
  }
  assertPress(mode, entry.pressAfter, rising ? "box" : "behind", `${mode} after`);
  if (!rising) {
    // The exit box holds a focused field. Godot releases the focus of a Control that
    // stops being visible, subtree included (RN would keep it): the field lost it, no
    // Control owns the keyboard, and JS saw focus and then blur.
    assert.deepEqual(entry.focus.before, {focused: true, js: ["focus"]}, `${mode}: the field had the focus before the animation`);
    assert.deepEqual(entry.focus.after, {focused: false, owner: "", js: ["focus", "blur"]}, `${mode}: the collapse released the field's focus`);
  } else {
    assert.equal(entry.focus, undefined, `${mode}: no field to focus`);
  }
  assert.deepEqual(entry.afterStop.errors, [], `${mode}: no host error`);
  return frames;
}

function verifyToggleCase(report, worst) {
  const entry = report.cases[TOGGLE];
  assert.ok(entry?.steps?.length === TOGGLE_STEPS.length && entry.rn, "toggle: the four states were recorded");
  assert.deepEqual(entry.errors, [], "toggle: no host error at mount");
  for (const [index, factor] of TOGGLE_STEPS.entries()) {
    const step = entry.steps[index], what = `toggle step ${index} (scale ${factor})`;
    assert.equal(step.step, index, `${what}: in order`);
    assert.equal(step.declared, factor, `${what}: the declared scale`);
    if (factor === 0) {
      assertHidden(step.native, what);
    } else {
      assertShown(step.native, TOGGLE, factor, what, worst);
    }
    assertPress(TOGGLE, step.press, factor === 0 ? "behind" : "box", what);
  }
  // The contact held on the box while React collapsed it: RN keeps the touch, the host
  // cancels it as for every hidden subtree, so pressOut fires and press never does.
  const held = entry.steps[2].heldAcrossCollapse, tag = entry.steps[0].press.tags.box;
  assert.deepEqual(held.presses.map(event => event.type), ["in", "out"], "toggle: pressIn then pressOut and no press for the canceled contact");
  for (const event of held.presses) {
    assert.equal(event.who, "box", `toggle: ${event.type} reached the box`);
    assert.equal(event.target, tag, `toggle: ${event.type} targets the box`);
  }
  assert.deepEqual(held.point, pressPoint(TOGGLE), "toggle: the held contact is on the box's center");
  assert.equal(held.held.activeTouches, 1, "toggle: the contact was live before the collapse");
  assert.equal(held.held.responder, tag, "toggle: the box held the responder before the collapse");
  assert.equal(held.canceled.activeTouches, 0, "toggle: the collapse released the contact");
  assert.equal(held.canceled.responder, 0, "toggle: the collapse released the responder");
  assert.equal(held.canceled.cancels, held.counters.cancels + 1, "toggle: the collapse canceled the touch once");
  assert.equal(held.canceled.pointerCancels, held.counters.pointerCancels + 1, "toggle: the collapse canceled the pointer once");
  assert.equal(held.after.cancels, held.canceled.cancels, "toggle: the release adds no cancel");
  assert.equal(held.after.activeTouches, 0, "toggle: the release leaves no contact");
  // onLayout never fired again and RN's measurements follow the last state, the identity box.
  assert.deepEqual(entry.rn.layouts, [{x: BOX.left, y: BOX.top, width: BOX.width, height: BOX.height}], "toggle: onLayout reports the layout box once");
  const [surfaceX, surfaceY] = surfaceOf(TOGGLE), {rect, measure, window} = entry.rn.read;
  closeAll([rect.x, rect.y, rect.width, rect.height], [surfaceX + BOX.left, surfaceY + BOX.top, BOX.width, BOX.height], 1e-3, "toggle: getBoundingClientRect");
  closeAll(measure, [BOX.left, BOX.top, BOX.width, BOX.height, BOX.left, BOX.top], 1e-3, "toggle: measure");
  closeAll(window, [surfaceX + BOX.left, surfaceY + BOX.top, BOX.width, BOX.height], 1e-3, "toggle: measureInWindow");
  assert.deepEqual(entry.afterStop.errors, [], "toggle: no host error");
}

// The pointer pressed on the source strip is captured by the box; the box collapses
// with the pointer still down. Its events keep reaching the capture owner: in the
// owner's own coordinates before the collapse, and with the offsets RN's own
// retargeter computes after it, because the host projects no offset through a
// collapsed View (it has no painted affine, like display: none). RN subtracts the origin
// of the owner's transformed box from the client point, and that box is the point
// scale: 0 leaves at the owner's center.
function verifyCaptureCase(report) {
  const entry = report.cases[CAPTURE], gesture = entry?.gesture;
  assert.ok(gesture, "capture: the gesture was recorded");
  assert.deepEqual([gesture.down, gesture.first, gesture.second], [GESTURE.down, GESTURE.first, GESTURE.second], "capture: the gesture is where the declaration puts it");
  assert.deepEqual(entry.errors, [], "capture: no host error at mount");
  for (const key of ["errorsBeforeCollapse", "errorsAfterMove", "errorsAtEnd"]) {
    assert.deepEqual(gesture[key], [], `capture: no host error (${key})`);
  }
  const {box, source} = gesture.tags;
  assert.ok(Number.isInteger(box) && box > 0 && Number.isInteger(source) && source > 0 && box !== source, "capture: the probe resolved the native tags");
  const left = BOX.left, [surfaceX, surfaceY] = surfaceOf(CAPTURE);
  const ownerLocal = ([x, y]) => [x - left, y - BOX.top];
  const [cx, cy] = boxCenter();
  const upstream = ([x, y]) => [x - cx, y - cy];
  const expected = [
    {who: "source", type: "down", target: source, offset: [GESTURE.down[0] - SOURCE[0], GESTURE.down[1] - SOURCE[1]], client: GESTURE.down},
    {who: "owner", type: "gotcapture", target: box, offset: ownerLocal(GESTURE.first), client: GESTURE.first},
    {who: "owner", type: "move", target: box, offset: ownerLocal(GESTURE.first), client: GESTURE.first},
    {who: "owner", type: "move", target: box, offset: upstream(GESTURE.second), client: GESTURE.second},
    {who: "owner", type: "up", target: box, offset: upstream(GESTURE.second), client: GESTURE.second},
    {who: "owner", type: "lostcapture", target: box, offset: upstream(GESTURE.second), client: GESTURE.second},
  ];
  assert.equal(gesture.events.length, expected.length, "capture: six events reached JS");
  for (const [index, want] of expected.entries()) {
    const event = gesture.events[index], what = `capture event ${index} (${want.who} ${want.type})`;
    assert.equal(event.who, want.who, `${what}: who`);
    assert.equal(event.type, want.type, `${what}: type`);
    assert.equal(event.target, want.target, `${what}: target`);
    assert.equal(event.pointerId, gesture.events[0].pointerId, `${what}: one pointer throughout`);
    closeAll([event.offsetX, event.offsetY, event.clientX, event.clientY], [...want.offset, ...want.client], 0.01, `${what}: offsets and client point`);
  }
  // The offsets before and after the collapse are different numbers: the owner's layout coordinates are not RN's payload for a collapsed box.
  assert.ok(Math.abs(expected[3].offset[0] - ownerLocal(GESTURE.second)[0]) > 10, "capture: the offsets after the collapse are not the owner's layout coordinates");
  assert.deepEqual(gesture.beforeCollapse, gesture.events.slice(0, 3), "capture: three events reached JS before the collapse");
  assert.deepEqual(gesture.afterMove, gesture.events.slice(0, 4), "capture: the move after the collapse was the fourth");
  assert.equal(gesture.ownerHiddenAfterCollapse, true, "capture: the owner is hidden after the collapse");
  assert.equal(gesture.pointerAtEnd.activePointers, 0, "capture: the release leaves no active pointer");
  assert.equal(gesture.pointerAtEnd.activeTouches, 0, "capture: the release leaves no contact");
  assert.equal(gesture.pointerAtEnd.responder, 0, "capture: the release leaves no responder");
  assert.equal(gesture.pointerAtEnd.pointerCancels, 0, "capture: the pointer's physical target was never in the collapsed subtree, so nothing is canceled");
  assert.deepEqual(entry.afterStop.errors, [], "capture: no host error");
}

// What the saved frame shows at a point: the analytical state of the case at the
// moment of capture decides whether it paints the box, its marker, the source strip, the
// plate or the card.
function expectedPixel(entry) {
  const point = windowPoint(entry.case, [BOX.left + entry.offset[0], BOX.top + entry.offset[1]]);
  const factor = CAPTURED_SCALE[entry.case];
  const [cx, cy] = [BOX.width / 2, BOX.height / 2];
  const inside = ([x, y, width, height], [px, py]) => px >= x && px <= x + width && py >= y && py <= y + height;
  const [offsetX, offsetY] = entry.offset;
  // The point in the box's own coordinates, where the scale about its center is undone.
  const own = factor === 0 ? null : [cx + (offsetX - cx) / factor, cy + (offsetY - cy) / factor];
  const card = [BOX.left + offsetX, BOX.top + offsetY];
  const plate = [PLATE.margin, PLATE.top, surfaceOf(entry.case)[2] - 2 * PLATE.margin, PLATE.height];
  let kind;
  if (own && inside(MARKER, own)) {
    kind = "marker";
  } else if (own && inside([0, 0, BOX.width, BOX.height], own)) {
    kind = "box";
  } else if (entry.case === CAPTURE && inside(SOURCE, card)) {
    kind = "source";
  } else {
    kind = inside(plate, card) ? "plate" : "card";
  }
  return {point, color: kind === "box" ? COLORS[entry.case] : COLORS[kind], kind};
}

// Throws on the first derivation the report does not meet; returns the largest
// error observed so a receipt can state how tight the agreement is.
export function verifySingularReport(report, {capture = false} = {}) {
  assert.equal(report.scenario, "transforms-singular");
  assert.deepEqual(report.modes, MODES);
  assert.deepEqual(report.layout, {boxLeft: BOX.left, boxTop: BOX.top, boxSize: [BOX.width, BOX.height],
    surfaces: Object.fromEntries(MODES.map(mode => [mode, surfaceOf(mode)]))});
  const names = report.checks.map(row => row.name);
  assert.equal(new Set(names).size, names.length, "Check names are unique");
  for (const mode of MODES) {
    assert.equal(names.filter(name => name.startsWith(mode + "/")).length, CHECKS[mode] + (capture ? 1 : 0), `${mode}: executed checks`);
  }
  assert.equal(names.length, 1 + MODES.reduce((total, mode) => total + CHECKS[mode], 0) + (capture ? 1 + MODES.length : 0), "No check is missing or extra");
  assert.equal(new Set(MODES.map(mode => report.cases[mode]?.runtimeId)).size, MODES.length, "Eight independent runtimes");
  const worst = {linear: 0, translation: 0, factor: 0};
  for (const mode of STATIC_MODES) {
    verifyStaticCase(report, mode);
  }
  const legs = [verifyAnimatedCase(report, ENTRANCE, worst), verifyAnimatedCase(report, EXIT, worst)];
  verifyToggleCase(report, worst);
  verifyCaptureCase(report);
  if (capture) {
    assert.equal(report.images.length, 1);
    const [image] = report.images;
    assert.equal(image.file, "build/transform-singular.png");
    assert.ok(image.samples.length >= 28, "The frame was sampled at the analytical points");
    assert.deepEqual([...new Set(image.samples.map(sample => sample.kind))].sort(), ["box", "card", "marker", "plate", "source"],
      "The frame was sampled where each kind of pixel is drawn");
    for (const sample of image.samples) {
      const {point, color, kind} = expectedPixel(sample);
      assert.deepEqual(sample.point, point, `${sample.case}: sample point`);
      assert.equal(sample.expected, color, `${sample.case}: sample color at ${point}`);
      assert.equal(sample.kind, kind, `${sample.case}: the sample table says what the analytical state paints at ${point}`);
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
    verifySingularReport({...report, checks: report.checks.map(row => ({...row, passed: true}))}, options);
  } catch (error) {
    return String(error.message).split("\n")[0];
  }
  return null;
}
