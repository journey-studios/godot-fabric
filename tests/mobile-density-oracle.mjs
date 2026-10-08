import assert from "node:assert/strict";

// Independent oracle for the density slice (V05-08), written from RN and UIKit rather than from the probe or the host. It judges the
// raw data of a report: for every stage the frame that measureInWindow gave each view in the HUD, the seam that stated the unsafe
// bands, the scale of the window and what the host held. From those it recomputes
//  - the density: the window's size in points is its pixels over the scale, Dimensions and useWindowDimensions say so, and a
//    44-point Pressable measures 44 whatever the scale;
//  - the events: one didUpdateDimensions per change of the scale and none for a change of the insets;
//  - the padding of every SafeAreaView with UIKit's rule (the part of each band the view's frame reaches), rounded to a pixel
//    (RCTRoundPixelValue), held by the State until a side moves by a pixel and 0.01 (RCTSafeAreaViewComponentView);
//  - that the layout shows that padding (the child that fills the view sits inside it by exactly that much), and that the HUD
//    lies inside the safe rect.
const SIDES = ["left", "top", "right", "bottom"];
const VIEWS = ["hud", "bleed", "nested", "floating", "edge-top", "edge-corner"];
const HUD_CHILDREN = ["hud-top", "hud-left", "nested", "hud-right", "hud-bottom", "touch-target"];
const CANVAS_ITEMS = 1;
const zeros = () => ({left: 0, top: 0, right: 0, bottom: 0});
const near = (actual, expected, tolerance = 1e-3) => Math.abs(actual - expected) <= tolerance;
const sameEdges = (actual, expected, tolerance = 1e-3) => SIDES.every(side => near(actual[side], expected[side], tolerance));
const describe = edges => SIDES.map(side => `${side} ${edges?.[side]}`).join(", ");

// UIKit's safeAreaInsets: the part of each band that the frame of the view reaches. The distance from the window's edge to the
// view's edge is what the band loses.
function reached(frame, window, unsafe) {
  return {
    left: Math.max(0, unsafe.left - frame.x),
    top: Math.max(0, unsafe.top - frame.y),
    right: Math.max(0, unsafe.right - (window.width - frame.x - frame.width)),
    bottom: Math.max(0, unsafe.bottom - (window.height - frame.y - frame.height)),
  };
}
const pixel = (value, scale) => Math.round(value * scale) / scale;
const moved = (held, target, scale) => SIDES.some(side => Math.abs(target[side] - held[side]) >= 1 / scale + 0.01);

// The padding the layout shows: how far the child that fills a view sits inside it.
function laidOut(frames, id) {
  const view = frames[id];
  const fill = frames[id === "hud" ? "hud-fill" : `${id}-fill`];
  assert.ok(view && fill, `${id} and its filling child were measured`);
  return {
    left: fill.x - view.x,
    top: fill.y - view.y,
    right: view.x + view.width - (fill.x + fill.width),
    bottom: view.y + view.height - (fill.y + fill.height),
  };
}

const unsafeOf = seam => (seam == null ? zeros() : {...zeros(), ...seam});

// One stage: returns the padding every view should hold afterwards. `held` is what each view held before the stage.
function judgeInsets(stage, held, scale, label) {
  const window = stage.js.dimensions.window;
  const unsafe = unsafeOf(stage.seam);
  const expected = {};
  const changed = [];
  for (const id of VIEWS) {
    const frame = stage.js.frames[id];
    assert.ok(frame, `${label}: ${id} was measured`);
    const target = Object.fromEntries(SIDES.map(side => [side, pixel(reached(frame, window, unsafe)[side], scale)]));
    expected[id] = moved(held[id], target, scale) ? target : held[id];
    if (expected[id] !== held[id]) {
      changed.push(id);
    }
    // Yoga lays every edge out on the pixel grid of the scale: the padding shows to within a pixel.
    assert.ok(sameEdges(laidOut(stage.js.frames, id), expected[id], 1 / scale + 1e-3),
      `${label}: the layout of ${id} shows (${describe(laidOut(stage.js.frames, id))}), the rules give (${describe(expected[id])})`);
    const node = stage.native.nodes[id];
    assert.equal(node?.component, "SafeAreaView", `${label}: ${id} is RN's SafeAreaView`);
    assert.ok(node.safeArea && sameEdges(node.safeArea, expected[id]),
      `${label}: the State of ${id} holds (${describe(node.safeArea)}), the rules give (${describe(expected[id])})`);
  }
  return {expected, changed};
}

function judgeHud(stage, scale, label) {
  const window = stage.js.dimensions.window;
  const unsafe = unsafeOf(stage.seam);
  // The tolerance of the State itself: it follows the bands to within a pixel and 0.01.
  const slack = 1 / scale + 0.01;
  for (const id of HUD_CHILDREN) {
    const frame = stage.js.frames[id];
    assert.ok(frame, `${label}: ${id} was measured`);
    assert.ok(frame.x >= unsafe.left - slack && frame.y >= unsafe.top - slack
      && frame.x + frame.width <= window.width - unsafe.right + slack && frame.y + frame.height <= window.height - unsafe.bottom + slack,
    `${label}: ${id} lies inside the safe rect`);
  }
}

function judgeDensity(stage, previousScale, report, label) {
  const [pixelsX, pixelsY] = report.window;
  const {dimensions, hook, events, frames} = stage.js;
  assert.ok(near(dimensions.window.scale, stage.scale), `${label}: Dimensions.window.scale is ${stage.scale}, not ${dimensions.window.scale}`);
  assert.ok(near(dimensions.screen.scale, stage.scale), `${label}: Dimensions.screen.scale follows the window's`);
  assert.deepEqual(hook, dimensions.window, `${label}: useWindowDimensions agrees with Dimensions`);
  assert.ok(near(dimensions.window.width * stage.scale, pixelsX) && near(dimensions.window.height * stage.scale, pixelsY),
    `${label}: the window is ${pixelsX}x${pixelsY} pixels, so ${pixelsX / stage.scale}x${pixelsY / stage.scale} points`);
  assert.equal(dimensions.window.fontScale, 1);
  assert.equal(stage.godot.mode, CANVAS_ITEMS, `${label}: canvas_items stretch`);
  assert.deepEqual(stage.godot.contentSize, [0, 0], `${label}: no content size`);
  assert.ok(near(stage.godot.factor, stage.scale), `${label}: the content scale factor is the screen's scale`);
  assert.ok(near(stage.godot.visible[0], dimensions.window.width) && near(stage.godot.visible[1], dimensions.window.height),
    `${label}: the visible rect is the size Dimensions reports`);
  const touch = frames["touch-target"];
  assert.ok(near(touch.width, 44, 0.5) && near(touch.height, 44, 0.5), `${label}: a 44-point Pressable measures ${touch.width}x${touch.height}`);
  // One event per change of the scale, and the event carries the new metrics; none when only the insets move.
  const delivered = events.slice(stage.eventsBefore);
  const changes = near(previousScale, stage.scale) ? 0 : 1;
  assert.equal(delivered.length, changes, `${label}: ${delivered.length} didUpdateDimensions for ${changes} change of scale`);
  for (const event of delivered) {
    assert.ok(near(event.window.scale, stage.scale) && near(event.window.width, dimensions.window.width), `${label}: the event carries the new window`);
  }
}

function judgeCounters(stage, changed, label) {
  const {before, after} = stage;
  assert.ok(before.requested >= 0 && after.requested >= before.requested && after.committed >= before.committed, `${label}: the counters of the host`);
  assert.ok(after.committed <= after.requested, `${label}: an update is requested before it is applied`);
  if (changed.length === 0) {
    // Nothing moved by the threshold: the host asked RN for nothing, and so changed no State.
    assert.equal(after.requested, before.requested, `${label}: nothing moved by the threshold, so nothing was requested`);
    assert.equal(after.committed, before.committed, `${label}: ...and no State changed`);
  } else {
    // A view that the padding of another moves can be updated twice before it settles: only the least is certain.
    assert.ok(after.committed - before.committed >= changed.length, `${label}: ${changed.join(", ")} changed, so that many States did`);
  }
}

// Throws on the first difference between a report of the current host and the rules.
export function verifyMobileDensityReport(report) {
  assert.equal(report.scenario, "native-mobile-density");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.allowOriginalNegative, false);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length, "check names are unique");
  const [pixelsX] = report.window;
  assert.ok(pixelsX > 0);

  // The content policy: today's behavior, with the insets of the seam the only thing that SafeAreaViews follow.
  const content = report.content;
  assert.deepEqual(content.godot, content.originalWindow, "content: the stretch settings were left alone");
  assert.ok(near(content.js.dimensions.window.scale, 1) && near(content.js.dimensions.window.width, pixelsX),
    "content: Dimensions is the window's pixels at scale 1, whatever the screen scale seam says");
  assert.equal(content.js.events.length, 0, "content: no didUpdateDimensions");
  const contentTouch = content.js.frames["touch-target"];
  assert.ok(near(contentTouch.width, 44, 0.5) && near(contentTouch.height, 44, 0.5), "content: a 44-point Pressable measures 44");
  const contentJudged = judgeInsets({...content, seam: content.seam}, Object.fromEntries(VIEWS.map(id => [id, zeros()])), 1, "content");
  assert.ok(contentJudged.changed.includes("hud"), "content: the seam pads the HUD at scale 1 as well");

  const stages = report.stages.filter(stage => stage.scale !== undefined);
  assert.deepEqual(stages.map(stage => stage.name), ["mount", "scale-3", "sub-threshold", "moved", "cleared", "scale-2", "platform-scale"]);
  assert.deepEqual(stages.map(stage => stage.scale).slice(0, 6), [2, 3, 3, 3, 3, 2]);
  assert.ok(near(stages[6].scale, report.platformScale), "the last stage follows the DisplayServer's own scale");
  let held = Object.fromEntries(VIEWS.map(id => [id, zeros()]));
  let previousScale = stages[0].scale;
  const seen = {changed: new Set(), unchanged: 0};
  for (const stage of stages) {
    const label = stage.name;
    judgeDensity(stage, previousScale, report, label);
    assert.ok(sameEdges(stage.native.displayInsets.unsafe, unsafeOf(stage.seam)), `${label}: the host read the bands of the seam`);
    assert.ok(near(stage.native.dimensions.window.scale, stage.scale), `${label}: the host's own Dimensions are at the scale`);
    const {expected, changed} = judgeInsets(stage, held, stage.scale, label);
    judgeHud(stage, stage.scale, label);
    judgeCounters(stage, changed, label);
    changed.forEach(id => seen.changed.add(id));
    if (changed.length === 0) {
      seen.unchanged += 1;
    }
    held = expected;
    previousScale = stage.scale;
  }
  // The fixture exercises what it says: the HUD is padded by the bands; a view away from every edge is not; one on the top edge
  // only gets the top band; the corner gets two; the one that bleeds into the band gets part of it; a view nested inside the HUD's
  // padding gets none; and some stages move nothing.
  const first = stages[0];
  const padded = id => SIDES.filter(side => near(first.native.nodes[id].safeArea[side], 0) === false);
  assert.deepEqual(padded("hud"), SIDES, "the HUD is padded on every side");
  assert.deepEqual(padded("floating"), [], "a view away from every edge is not padded");
  assert.deepEqual(padded("nested"), [], "a view nested inside the HUD's padding has nothing left to overlap");
  assert.deepEqual(padded("edge-top"), ["top"], "a view on the top edge is padded on the top only");
  assert.deepEqual(padded("edge-corner"), ["right", "bottom"], "the corner view is padded on two sides");
  assert.deepEqual(padded("bleed"), ["left"], "the view that bleeds into the left band gets its own overlap");
  const bleed = first.native.nodes.bleed.safeArea.left;
  assert.ok(bleed > 0 && bleed < first.native.nodes.hud.safeArea.left, "...and less than the whole band");
  assert.ok(seen.unchanged >= 2, "at least two stages move nothing by the threshold");
  const sub = stages.find(stage => stage.name === "sub-threshold");
  assert.ok(SIDES.some(side => sub.seam[side] !== stages[1].seam[side]), "the sub-threshold stage does change the seam");
  // Clearing the insets clears the padding of every view that lies inside the window. The one that bleeds hangs 20 points outside
  // it without the HUD's padding, and UIKit's rule gives a view the part of it that lies outside the safe rect: that hang.
  const cleared = stages.find(stage => stage.name === "cleared");
  for (const id of VIEWS) {
    const frame = cleared.js.frames[id];
    const window = cleared.js.dimensions.window;
    const outside = frame.x < 0 || frame.y < 0 || frame.x + frame.width > window.width || frame.y + frame.height > window.height;
    assert.equal(outside, id === "bleed", `${id} ${outside ? "hangs outside" : "lies inside"} the cleared window`);
    assert.ok(outside || sameEdges(cleared.native.nodes[id].safeArea, zeros()), `clearing the insets clears the padding of ${id}`);
  }
  assert.ok(near(cleared.native.nodes.bleed.safeArea.left, -cleared.js.frames.bleed.x), "the view that hangs outside keeps the part that hangs");

  // Diagnostics and cleanup.
  const diagnostics = report.stages.find(stage => stage.name === "diagnostics");
  assert.deepEqual(diagnostics.errors, [report.expectedErrors[1]], "the policy refused a change after the application started, with a diagnostic");
  assert.equal(report.expectedErrors.length, 2);
  const cleanup = report.stages.find(stage => stage.name === "cleanup");
  assert.equal(cleanup.native.nativeTags, 0, "cleanup: every native Control was released");
  assert.equal(cleanup.native.displayInsets.views, 0, "cleanup: the host forgot its SafeAreaViews");
  return {stages: stages.length, views: VIEWS.length, unchangedStages: seen.unchanged, changedViews: [...seen.changed].sort()};
}

// The first complaint of the oracle about a report whose checks all claim to pass, or null when it accepts it.
export function oracleRejection(report) {
  try {
    verifyMobileDensityReport({...report, checks: report.checks.map(row => ({...row, passed: true}))});
  } catch (error) {
    return String(error.message).split("\n")[0];
  }
  return null;
}
