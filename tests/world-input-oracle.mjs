import assert from "node:assert/strict";

// Independent oracle, written from the rules of the policy and the geometry of the HUD and not from the probe or the
// host. It re-derives, for every burst of a report, what the world and the HUD's handlers must have heard, from where
// the burst was aimed and what stood there, and compares it with what the report says they heard; it throws on any
// difference. A burst is `n` repetitions of its parts, each a click, a right click, a wheel tick, a tap or the mouse
// Godot emulates from a touch, at a point.
//
// The rules, which are those of React Native on a phone: what its hit test finds belongs to the HUD, and the rest to the world.
//  - The HUD's root is pointerEvents="box-none": the empty area belongs to the world. The World hears each part
//    there as the stream of its input: a click or a right click as the mouse button's press and release, a wheel tick
//    as the wheel button's press and release, a tap as ScreenTouch and the mouse Godot emulates from it (device
//    -1), the emulated mouse as its own press and release. It hears a left press, or a tap, as a tile selection, and
//    the tile is the one the Camera2D gives.
//  - Every region the HUD paints is a View the hit test of React Native finds: the bar, the plain panel, the Pressables, the
//    ScrollView, the area of a hit slop around a button, a Text, the gap of a ScrollView. Nothing of what lands there
//    reaches the world, whatever the input and whether or not the View has a handler (a click, a right click, a wheel
//    tick, a tap and the emulated mouse alike). Its React handlers hear a click or a tap, a press on a Pressable reaching
//    the handlers of the bar it sits in as pointerdown bubbles; they never hear a wheel tick or the emulated mouse (React
//    Native ignores device -1). A plain panel without handlers swallows the pointer and nothing hears it.
//  - An open overlay (a View in the tree, or a Modal) covers the whole HUD and the world: nothing under it hears
//    anything, and the overlay's own Pressable is pressed.
//  - The Surface itself takes no pointer from the GUI: mouse_filter IGNORE.
//  - A node that stands in the HUD's layer, after the world in the tree, hears an event before the world does (the order the
//    Surface's claim depends on): the witness the probe adds heard each event when the world had not.
// What the rule leaves alone, the pointer motion over the HUD and a drag that starts on it, is only recorded: the oracle
// checks its shape and never judges it.
const inside = ([x, y], [left, top, width, height]) => x >= left && x < left + width && y >= top && y < top + height;

// The HUD of tests/world-input-fixture.jsx in the 800x600 root, in the order a pointer meets it (the top-most first).
// Topology (a): one root, panel "hud". Topology (b): two roots of 400x600, panels "left" and "right".
const hudA = [
  ["button", [20, 20, 100, 40]], ["bar", [0, 0, 300, 100]], ["plain", [320, 0, 160, 100]],
  ["scroll-button", [0, 120, 280, 150]],
  // A Switch of 51x31 at (620, 20): a native Control of the Godot GUI.
  ["switch", [620, 20, 51, 31]],
  // A Pressable of 60x40 at (500, 100) with a hitSlop of 20 is hit from (480, 80) to (580, 160).
  ["slop", [480, 80, 100, 80]],
  // A Text of 80x30 at (500, 200).
  ["text", [500, 200, 80, 30]],
  // A box-none wrapper of 300x150 at (400, 300) that a ScrollView, hit anywhere in it, fills.
  ["scroll-gap", [400, 300, 300, 150]],
];
const hudB = side => {
  const offset = side === "left" ? 0 : 400;
  return [["button", [offset + 20, 20, 100, 40]], ["bar", [offset, 0, 360, 80]]];
};
const overlayButton = [300, 300, 100, 40];
const regionAt = (at, topology, overlay) => {
  if (overlay != null) {
    return inside(at, overlayButton) ? overlay + "-button" : "covered";
  }
  for (const [region, rect] of topology === "a" ? hudA : hudB(at[0] < 400 ? "left" : "right")) {
    if (inside(at, rect)) {
      return region;
    }
  }
  return "void";
};
const panelAt = (at, topology) => topology === "a" ? "hud" : at[0] < 400 ? "left" : "right";

const worldStream = {
  emulated: n => ({"emulated/press/1": n, "emulated/release/1": n}),
  left: n => ({"mouse/press/1": n, "mouse/release/1": n}),
  right: n => ({"mouse/press/2": n, "mouse/release/2": n}),
  wheel: n => ({"mouse/press/4": n, "mouse/release/4": n}),
  touch: n => ({"touch/press": n, "touch/release": n, "emulated/press/1": n, "emulated/release/1": n}),
};
// What the handlers of the HUD hear of a part on each region it can land on, by panel.
const handlers = {
  void: () => ({}), covered: () => ({}), plain: () => ({}),
  button: panel => ({[panel + "/press"]: 1, [panel + "/barDown"]: 1}),
  bar: panel => ({[panel + "/barDown"]: 1}),
  "scroll-button": panel => ({[panel + "/scrollPress"]: 1}),
  switch: panel => ({[panel + "/switchChange"]: 1}),
  slop: panel => ({[panel + "/slopPress"]: 1}),
  text: panel => ({[panel + "/textPress"]: 1}),
  "scroll-gap": panel => ({[panel + "/wrapDown"]: 1}),
  "tree-button": panel => ({[panel + "/treePress"]: 1}),
  "modal-button": panel => ({[panel + "/modalPress"]: 1}),
};

const add = (total, extra, n) => {
  for (const [key, value] of Object.entries(extra)) {
    total[key] = (total[key] ?? 0) + value * n;
  }
};

// The bursts a report has, in order, with the points the probe is held to. Positions are the oracle's own.
function bursts(topology, full, small) {
  if (topology === "a") {
    const points = {void: [700, 550], voidB: [650, 250], voidC: [400, 520], button: [70, 40], bar: [250, 80], plain: [400, 50],
      scrollButton: [100, 200], overlayButton: [350, 320], switch: [645, 35], slop: [490, 120], text: [520, 212], scrollGap: [550, 400]};
    const rows = [["void/left", full, [["left", points.void]]], ["void/right", full, [["right", points.void]]],
      ["void/wheel", full, [["wheel", points.void]]], ["void/touch", full, [["touch", points.void]]],
      ["void/tile-b", 1, [["left", points.voidB]]], ["void/tile-c", 1, [["left", points.voidC]]],
      ["button/left", full, [["left", points.button]]], ["bar/left", full, [["left", points.bar]]],
      ["plain/left", full, [["left", points.plain]]], ["scroll-button/left", full, [["left", points.scrollButton]]],
      ["switch/left", full, [["left", points.switch]]], ["switch/touch", full, [["touch", points.switch]]],
      ["alternating", full, [["left", points.button], ["left", points.void]]],
      ["button/touch", full, [["touch", points.button]]], ["plain/touch", full, [["touch", points.plain]]]];
    for (const overlay of ["tree", "modal"]) {
      const inputs = ["left", "right", "wheel", "touch"];
      for (const phase of ["closed", "open", "closed-again"]) {
        for (const input of inputs) {
          rows.push([`${overlay}/${phase}/${input}`, full, [[input, points.void]], {overlay, phase}]);
        }
        if (phase === "open") {
          rows.push([`${overlay}/open/button`, full, [["left", points.overlayButton]], {overlay, phase}]);
        }
      }
    }
    // The places the GUI would let through to the world: a click, a tap and the emulated mouse, then the wheel over them and
    // over the rest of the HUD.
    for (const [id, at] of [["hit-slop", points.slop], ["text-onpress", points.text], ["scroll-gap", points.scrollGap]]) {
      for (const input of ["left", "touch", "emulated"]) {
        rows.push([`gap/${id}/${input}`, full, [[input, at]]]);
      }
    }
    for (const [id, at] of [["bar", points.bar], ["plain", points.plain], ["button", points.button], ["scroll", points.scrollButton],
      ["hit-slop", points.slop], ["text-onpress", points.text], ["scroll-gap", points.scrollGap]]) {
      rows.push([`wheel/${id}`, full, [["wheel", at]]]);
    }
    return rows;
  }
  const points = {left: {button: [70, 40], bar: [300, 70], void: [200, 400]}, right: {button: [470, 40], bar: [700, 70], void: [600, 400]}};
  const rows = [];
  for (const side of ["left", "right"]) {
    for (const input of ["left", "right", "wheel", "touch"]) {
      rows.push([`void/${side}/${input}`, small, [[input, points[side].void]]]);
    }
    rows.push([`void/${side}/tile`, 1, [["left", points[side].void]]]);
    for (const input of ["left", "touch"]) {
      rows.push([`button/${side}/${input}`, small, [[input, points[side].button]]]);
    }
    rows.push([`bar/${side}/left`, small, [["left", points[side].bar]]]);
    rows.push([`bar/${side}/wheel`, small, [["wheel", points[side].bar]]]);
  }
  rows.push(["alternating", small, [["left", points.left.button], ["left", points.right.void]]]);
  return rows;
}

function verifyTopology(report, name) {
  const topology = report.topologies[name];
  const [width, height] = report.viewport;
  const {tile, camera} = report.world;
  const tileAt = ([x, y]) => `${Math.floor(((x - width / 2) / camera.zoom[0] + camera.position[0]) / tile)},${Math.floor(((y - height / 2) / camera.zoom[1] + camera.position[1]) / tile)}`;
  // The Surfaces cover the root and take no pointer.
  const rects = name === "a" ? [[0, 0, 800, 600]] : [[0, 0, 400, 600], [400, 0, 400, 600]];
  assert.deepEqual(topology.surfaces.map(surface => surface.rect), rects, name + ": the Surfaces cover the root");
  assert.deepEqual(topology.surfaces.map(surface => surface.mouseFilter), rects.map(() => 2), name + ": a Surface takes no pointer (IGNORE)");
  const expected = bursts(name, report.full, report.small);
  assert.deepEqual(topology.rows.map(row => row.id), expected.map(([id]) => `${name}/${id}`), name + ": the bursts, in order");
  const verified = [];
  for (const [index, [id, n, parts, extra = {}]] of expected.entries()) {
    const row = topology.rows[index];
    const label = `${name}/${id}`;
    assert.equal(row.n, n, label + ": repetitions");
    assert.equal(row.phase ?? "", extra.phase ?? "", label + ": phase");
    assert.equal(row.overlay ?? "", extra.overlay ?? "", label + ": overlay");
    // The region the probe says it aimed at must be the one the geometry gives, with an overlay open or not.
    const covering = extra.phase === "open" ? extra.overlay : null;
    assert.deepEqual(row.parts.map(part => [part.input, part.at]), parts, label + ": the parts");
    const world = {};
    const heard = {};
    const tiles = {};
    for (const [index, [input, at]] of parts.entries()) {
      const region = regionAt(at, name, covering);
      const panel = panelAt(at, name);
      assert.equal(row.parts[index].region, region, label + ": what stands at " + at);
      assert.equal(row.parts[index].panel, panel, label + ": the panel at " + at);
      if (region !== "void") {
        assert.ok(input !== "right" || region === "covered", label + ": a right click is only aimed at the empty area or under an overlay");
      }
      if (region === "void") {
        add(world, worldStream[input](1), n);
        if (input === "left" || input === "touch" || input === "emulated") {
          add(tiles, {[tileAt(at)]: 1}, n);
        }
      }
      // A handler hears a left press or a tap; the overlays' covered area and the empty area have none.
      if (input === "left" || input === "touch") {
        add(heard, handlers[region](panel), n);
      }
    }
    assert.deepEqual(row.world, world, label + ": what the world heard");
    assert.deepEqual(row.rn, heard, label + ": what the HUD's handlers heard");
    assert.deepEqual(row.tiles, tiles, label + ": the tiles the camera gives");
    verified.push(label);
  }
  // The pointer over the map hovers nothing; over the HUD it hovers one of the HUD's own controls.
  const hovers = name === "a" ? [["void", [700, 550], "void"], ["button", [70, 40], "button"]] : [
    ["void/left", [200, 400], "void"], ["button/left", [70, 40], "button"], ["void/right", [600, 400], "void"], ["button/right", [470, 40], "button"]];
  assert.deepEqual(topology.hovers.map(row => [row.id, row.at, row.region]), hovers.map(([id, at, region]) => [`${name}/${id}`, at, region]), name + ": the hovers");
  for (const row of topology.hovers) {
    if (row.region === "void") {
      assert.equal(row.hovered, null, row.id + ": nothing is hovered over the map");
    } else {
      assert.ok(row.hovered != null && row.hovered.class !== "FabricSurface", row.id + ": a control of the HUD is hovered, not the Surface");
    }
  }
  // The order the Surface's claim depends on: the witness in the HUD's layer heard each button event before the world did, that is,
  // when the world had heard exactly the events that came before it.
  assert.ok(topology.order.worldIndices.length >= 2, name + ": the order witness had events to hear");
  assert.deepEqual(topology.order.heard, topology.order.worldIndices, name + ": the witness hears _unhandled_input before the world");
  // The overlays opened and closed, each when the probe waited for it.
  assert.deepEqual(topology.transitions, name === "a" ? ["tree", "modal"].flatMap(overlay => ["open", "closed"].map(to => ({overlay, to, reached: true}))) : [],
    name + ": the overlays opened and closed");
  // What the rule leaves alone, motion and drag: only their shape.
  const openCases = name === "a" ? [["motion", "bar", [250, 80]], ["drag", "bar", [250, 80]], ["motion", "hit-slop", [490, 120]], ["drag", "hit-slop", [490, 120]]] : [];
  assert.deepEqual(topology.gaps.map(row => row.id), openCases.map(([input, id]) => `${name}/open/${input}-over-${id}`), name + ": the open cases");
  for (const [index, [input, , at]] of openCases.entries()) {
    const gap = topology.gaps[index];
    assert.deepEqual(gap.parts.map(part => [part.input, part.at, part.region]), [[input, at, regionAt(at, name, null)]], gap.id + ": the part and what stands there");
    assert.equal(gap.n, report.small, gap.id + ": repetitions");
    for (const counts of [gap.world, gap.rn]) {
      assert.ok(Object.values(counts).every(value => Number.isInteger(value) && value >= 0 && value <= gap.n * 2), gap.id + ": counts");
    }
    for (const field of [gap.motion, gap.drag]) {
      assert.ok(Number.isInteger(field) && field >= 0 && field <= gap.n * 2, gap.id + ": motion and drag counts");
    }
  }
  return {bursts: verified.length, hovers: topology.hovers.length, gaps: topology.gaps.length};
}

// Re-derives every burst of a current-host report; throws on any difference.
export function verifyWorldInputReport(report) {
  assert.deepEqual(report.viewport, [800, 600]);
  assert.deepEqual(report.world, {tile: 32, columns: 24, rows: 16, camera: {position: [384, 256], zoom: [2, 2]}}, "the world and its camera");
  assert.equal(report.emulatingMouseFromTouch, true, "a tap reaches an unhandled world as ScreenTouch and as the emulated mouse");
  assert.equal(report.full, 100);
  assert.equal(report.small, 20);
  assert.deepEqual(Object.keys(report.topologies), ["a", "b"]);
  const a = verifyTopology(report, "a");
  const b = verifyTopology(report, "b");
  return {a, b, checks: report.checks.length};
}
