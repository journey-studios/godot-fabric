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
// The seam the probe states for every case (tests/mobile-density-probe.gd, INSETS).
const INSETS = {left: 47, top: 20, right: 47.5, bottom: 21};
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

// The world group: the HUD over a Godot world, judged from the frames that measureInWindow gave, the click points, and the rule of React
// Native's hit test on a phone, which is not the host's: a pointer belongs to the HUD when it lies in the box of a View that takes it, and to
// the world otherwise. Under box-none the root takes none, so the View that owns a pointer is the bar (which has a handler) and the
// Pressable inside it; under auto the root takes every pointer of the window, its padding band included, because the box of a view includes
// its padding (UIKit's, and so RN's). What the HUD hears is counted by its handlers: a pointer on the Pressable presses it, reaches the bar's
// handler and bubbles to the root's; one on the bar reaches the bar's and the root's; one under auto in the void reaches the root's only.
const inRect = (point, frame) => point[0] >= frame.x && point[0] < frame.x + frame.width && point[1] >= frame.y && point[1] < frame.y + frame.height;

function judgeWorld(report) {
  const cases = report.world;
  assert.equal(cases.length, 8, "the world group has 2 scales, 2 roots and 2 pointerEvents");
  const bySlot = new Map();
  for (const entry of cases) {
    const label = `world scale ${entry.requested} ${entry.root} ${entry.events}`;
    assert.ok(entry.mounted && entry.points?.void, `${label}: the HUD over the world mounted and was clicked`);
    assert.ok(near(entry.scale, entry.requested), `${label}: the window runs at scale ${entry.requested}, not ${entry.scale}`);
    assert.ok(near(entry.window.width * entry.scale, report.window[0]), `${label}: the window is its pixels over the scale`);
    const {bar, button} = entry.frames;
    const window = {x: 0, y: 0, width: entry.window.width, height: entry.window.height};
    // The padding the seam gives the SafeAreaView root, and none for the View: the bar sits at the insets, or at the origin.
    const expectedOrigin = entry.root === "safe" ? [pixel(INSETS.left, entry.scale), pixel(INSETS.top, entry.scale)] : [0, 0];
    assert.ok(near(bar.x, expectedOrigin[0]) && near(bar.y, expectedOrigin[1]), `${label}: the bar is at (${bar.x}, ${bar.y}), the rules give (${expectedOrigin})`);
    assert.ok(near(button.width, 100) && near(button.height, 40), `${label}: the Pressable keeps its size`);
    assert.equal(entry.clicks, 20);
    for (const [name, row] of Object.entries(entry.points)) {
      const at = row.at;
      assert.ok(inRect(at, window), `${label}/${name}: the point lies in the window`);
      const onButton = inRect(at, button);
      const onBar = inRect(at, bar);
      assert.equal(name === "button", onButton, `${label}/${name}: only the button point lies on the Pressable`);
      if (name === "void" || name === "band") {
        assert.ok(!onBar, `${label}/${name}: the empty points lie clear of the bar`);
      }
      const claimed = entry.events === "auto" ? true : onBar;
      const expectedHud = {};
      if (claimed) {
        if (onButton) {
          expectedHud.press = entry.clicks;
        }
        if (onBar) {
          expectedHud.barDown = entry.clicks;
        }
        expectedHud.rootDown = entry.clicks;
      }
      assert.equal(row.world, claimed ? 0 : entry.clicks, `${label}/${name}: the world heard ${row.world} of ${entry.clicks} clicks`);
      assert.deepEqual(row.hud, expectedHud, `${label}/${name}: the HUD heard ${JSON.stringify(row.hud)}, the rule gives ${JSON.stringify(expectedHud)}`);
    }
    bySlot.set(`${entry.requested}/${entry.events}/${entry.root}`, entry);
  }
  // Parity: a SafeAreaView root leaves the world and the HUD exactly what a View root does, point by point.
  for (const scale of [1, 2]) {
    for (const events of ["box-none", "auto"]) {
      const safe = bySlot.get(`${scale}/${events}/safe`);
      const plain = bySlot.get(`${scale}/${events}/view`);
      for (const name of ["void", "band", "button"]) {
        assert.equal(safe.points[name].world, plain.points[name].world, `scale ${scale} ${events} ${name}: world parity`);
        assert.deepEqual(safe.points[name].hud, plain.points[name].hud, `scale ${scale} ${events} ${name}: HUD parity`);
      }
    }
  }
  return {cases: cases.length, points: cases.length * 3};
}

// The faults of the seam: one band of validation_safe_area that is not a finite non-negative number is refused with a diagnostic that names
// it, not turned into a padding. The host keeps the bands, and with them the padding of every SafeAreaView, of the last valid seam; no
// NaN and no negative ever reaches a State; and the next valid seam is followed again. The three faults and the valid seams between them
// are stated here, not taken from the report, and the padding is recomputed from the frames with UIKit's rule.
const MOVED = {left: 50, top: 24, right: 44, bottom: 30};
const SEAM_FAULTS = [["negative", "left"], ["string", "top"], ["not-a-number", "right"]];
const SEAM_VALID = [INSETS, MOVED, INSETS, MOVED];
const refusal = side => `validation_safe_area.${side} must be a finite non-negative number`;
const sound = edges => SIDES.every(side => Number.isFinite(edges?.[side]) && edges[side] >= 0);

function judgeSeamFaults(report) {
  const faults = report.seamFaults;
  assert.deepEqual(faults.map(fault => [fault.kind, fault.side]), SEAM_FAULTS, "the seam faults are a negative, a String and a NaN, each on its own side");
  assert.deepEqual(report.expectedErrors.slice(2), SEAM_FAULTS.map(([, side]) => refusal(side)), "the diagnostics the probe provoked name the band");
  faults.forEach((fault, index) => {
    const label = `seam ${fault.kind}`;
    const scale = fault.scale;
    assert.ok(near(scale, 2) && near(fault.window.scale, scale), `${label}: the faults run at scale 2`);
    assert.deepEqual(fault.validSeam, SEAM_VALID[index], `${label}: the last valid seam`);
    assert.deepEqual(fault.recoverySeam, SEAM_VALID[index + 1], `${label}: the valid seam that follows`);
    assert.deepEqual(fault.errors, SEAM_FAULTS.slice(0, index + 1).map(([, side]) => refusal(side)),
      `${label}: the host reported ${JSON.stringify(fault.errors)}, one diagnostic per refused band`);
    assert.ok(sameEdges(fault.unsafe, fault.validSeam), `${label}: the host kept the bands of the last valid seam, not (${describe(fault.unsafe)})`);
    assert.ok(sound(fault.unsafe), `${label}: the bands the host holds are finite and not negative`);
    for (const id of VIEWS) {
      const frame = fault.frames[id];
      assert.ok(frame, `${label}: ${id} was measured`);
      // The last valid seam's padding, to within the update threshold (the State only moves by a pixel and 0.01).
      const target = Object.fromEntries(SIDES.map(side => [side, pixel(reached(frame, fault.window, fault.validSeam)[side], scale)]));
      assert.ok(sameEdges(fault.before[id], target, 1 / scale + 0.011), `${label}: ${id} held (${describe(fault.before[id])}) before the fault, the rules give (${describe(target)})`);
      assert.deepEqual(fault.kept[id], fault.before[id], `${label}: ${id} kept its padding (${describe(fault.kept[id])}) through the refusal`);
      assert.ok(sound(fault.kept[id]), `${label}: ${id} holds a finite, non-negative padding (${describe(fault.kept[id])})`);
      // The valid seam after the fault moves the State by the rules, as if the fault had never happened.
      const next = Object.fromEntries(SIDES.map(side => [side, pixel(reached(fault.recovered.frames[id], fault.window, fault.recoverySeam)[side], scale)]));
      const expected = moved(fault.kept[id], next, scale) ? next : fault.kept[id];
      assert.ok(sameEdges(fault.recovered.padding[id], expected), `${label}: ${id} holds (${describe(fault.recovered.padding[id])}) after the next seam, the rules give (${describe(expected)})`);
    }
    const nextHud = Object.fromEntries(SIDES.map(side => [side, pixel(reached(fault.recovered.frames.hud, fault.window, fault.recoverySeam)[side], scale)]));
    assert.ok(moved(fault.kept.hud, nextHud, scale), `${label}: the seam after the fault moves the HUD, so the host is shown to follow it`);
  });
  return {faults: faults.length};
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
  assert.equal(report.expectedErrors.length, 2 + SEAM_FAULTS.length, "two diagnostics of the policy and one per refused band");
  const cleanup = report.stages.find(stage => stage.name === "cleanup");
  assert.equal(cleanup.native.nativeTags, 0, "cleanup: every native Control was released");
  assert.equal(cleanup.native.displayInsets.views, 0, "cleanup: the host forgot its SafeAreaViews");
  const seam = judgeSeamFaults(report);
  const world = judgeWorld(report);
  return {stages: stages.length, views: VIEWS.length, unchangedStages: seen.unchanged, changedViews: [...seen.changed].sort(), seam, world};
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
