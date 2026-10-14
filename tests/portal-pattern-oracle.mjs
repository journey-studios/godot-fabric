import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";

// The independent oracle of the portal pattern slice. It shares no code with the example, the fixture or the probe, and it judges the raw
// report without the probe's verdicts. What it knows is the layout of the scenario (the fixture reports the example's own LAYOUT numbers: the
// sizes it fixed) and the rules it derives them from: RN's layout (Yoga: a column stacks its children, margin and padding inset them, an
// absolute child is placed from its parent's corner and a ScrollView clips its content), Fabric's stacking contexts (a positioned View with a
// zIndex is one, and the children of a View that forms none are hoisted into the nearest one) and the host's documented pointer rules (a View
// RN's hit test finds is RN's, pointerEvents box-none never finds itself, and a View outside the clip of an ancestor is not found).
//   report     the report is the genuine lane's, from a headless run, with every stage the sections read
//   layout     the frames of the scenario's Controls and the dropdown's, against the layout derived for each root's place in the window, and
//              what measureInWindow gave the trigger and the host
//   tree       the host is the last child of the root's View, the portal's Controls are exactly the children of the host and none of them is
//              under the ScrollView or the card, and they come last in tree order
//   clip       the Controls that clip, and that no ancestor of the dropdown cuts any part of it, though it reaches past the ScrollView's rectangle
//   input      each press replayed through the model of the pointer rules: the View under the point is the intent, and what each side of the
//              pointer heard follows from it
//   lifecycle  a closed portal leaves the host empty, an unmounted root and a stopped application leave no host and no portal Control
//   roots      two roots, two hosts, disjoint Controls, per-root state
//   context    the trigger's Context stays with the trigger: the portal reads the default
// The rules it quotes (the stacking context condition and the hoisting) are read from RN's own C++ in the installed package.
const requireRn = createRequire(import.meta.url);
const rnRoot = path.dirname(requireRn.resolve("react-native/package.json"));
const viewShadowNode = readFileSync(path.join(rnRoot, "ReactCommon/react/renderer/components/view/ViewShadowNode.cpp"), "utf8");
const slicing = readFileSync(path.join(rnRoot, "ReactCommon/react/renderer/mounting/internal/sliceChildShadowNodeViewPairs.cpp"), "utf8");
const stackingContextRule = /\(viewProps\.zIndex\.has_value\(\) &&\s*viewProps\.yogaStyle\.positionType\(\) != yoga::PositionType::Static\)/.test(viewShadowNode);
const hoistingRule = /FormsStackingContext/.test(slicing) && /sliceChildShadowNodeViewPairs/.test(slicing);

// Godot's Control.MOUSE_FILTER_IGNORE: what the host gives a View with pointerEvents box-none.
const IGNORE = 2;
const PORTAL = ["dropdown", "dropdown-header", "dropdown-context", "dropdown-live", "dropdown-item-Small", "dropdown-item-Medium", "dropdown-item-Large"];
const TOLERANCE = 0.5;
const near = (actual, expected, what) => {
  assert.equal(actual.length, expected.length, `${what}: a frame has four numbers`);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= TOLERANCE, `${what}: ${JSON.stringify(actual)} is not ${JSON.stringify(expected)}`));
};
const byName = (tree, name) => tree.filter(entry => entry.name === name);
const only = (tree, name) => {
  const found = byName(tree, name);
  assert.equal(found.length, 1, `exactly one Control named ${name} (found ${found.length})`);
  return found[0];
};
const inside = (point, [x, y, width, height]) => point[0] >= x && point[0] < x + width && point[1] >= y && point[1] < y + height;
const intersect = (a, b) => {
  const x = Math.max(a[0], b[0]);
  const y = Math.max(a[1], b[1]);
  const right = Math.min(a[0] + a[2], b[0] + b[2]);
  const bottom = Math.min(a[1] + a[3], b[1] + b[3]);
  return right > x && bottom > y ? [x, y, right - x, bottom - y] : [0, 0, 0, 0];
};

// ---- the layout the scenario fixes, as Yoga arranges it ----
function predicted(report, root) {
  const {layout: L, surface, offsets, options} = report.stages.setup;
  const [ox, oy] = offsets[root];
  const [width, height] = surface;
  const m = L.cardMargin;
  const p = L.cardPadding;
  const card = [ox + m, oy + m, width - 2 * m, 2 * p + L.headerHeight + L.gap + L.scrollHeight + L.gap + L.statusHeight];
  const innerX = card[0] + p;
  const innerWidth = card[2] - 2 * p;
  const header = [innerX, card[1] + p, innerWidth, L.headerHeight];
  const scroll = [innerX, header[1] + L.headerHeight + L.gap, innerWidth, L.scrollHeight];
  const status = [innerX, scroll[1] + L.scrollHeight + L.gap, innerWidth, L.statusHeight];
  const rows = Array.from({length: L.rows}, (_, index) => [scroll[0], scroll[1] + index * L.rowHeight, scroll[2], L.rowHeight]);
  const pickRow = rows[L.pickRow];
  const pick = [pickRow[0] + pickRow[2] - L.rowPadding - L.buttonWidth, pickRow[1] + (L.rowHeight - L.buttonHeight) / 2, L.buttonWidth, L.buttonHeight];
  // The dropdown is under the trigger with its right edge on the trigger's: the pattern's placement, in window coordinates.
  const dropdown = [pick[0] + pick[2] - L.dropdownWidth, pick[1] + pick[3] + L.dropdownGap, L.dropdownWidth, L.dropdownHeader + options.length * L.itemHeight];
  const header2 = [dropdown[0], dropdown[1], L.dropdownWidth, L.dropdownHeader];
  const items = options.map((option, index) => [dropdown[0], dropdown[1] + L.dropdownHeader + index * L.itemHeight, L.dropdownWidth, L.itemHeight]);
  return {root: [ox, oy, width, height], card, header, scroll, status, rows, pick, dropdown, dropdownHeader: header2, items, origin: [ox, oy]};
}

// ---- the pointer rules, as a model of what lies at a window point ----
// The Views that RN's hit test can find, topmost first. A View RN owns and that has no handler still takes the press (nothing falls
// through it); the host and the root are box-none, so they are never found; the ScrollView clips, so a row is found only inside its viewport.
function lieAt(report, root, point, open) {
  const frames = predicted(report, root);
  const {options} = report.stages.setup;
  if (open) {
    for (const [index, frame] of frames.items.entries()) {
      if (inside(point, frame)) {
        return {kind: "item", option: options[index]};
      }
    }
    if (inside(point, frames.dropdownHeader) || inside(point, frames.dropdown)) {
      return {kind: "dropdown-body"};
    }
  }
  if (inside(point, frames.status)) {
    return {kind: "inert"};
  }
  if (inside(point, frames.scroll)) {
    if (inside(point, frames.pick)) {
      return {kind: "pick"};
    }
    const index = frames.rows.findIndex(frame => inside(point, intersect(frame, frames.scroll)));
    return index >= 0 ? {kind: "row", index} : {kind: "inert"};
  }
  if (inside(point, frames.card)) {
    return {kind: "inert"};
  }
  return {kind: "world"};
}

const intentOf = intent => {
  const [kind, argument] = intent.split(":");
  return kind === "row" ? {kind, index: parseInt(argument, 10)} : kind === "item" ? {kind, option: argument} : {kind};
};

export const sections = {
  report(report) {
    assert.equal(report.scenario, "native-portal-pattern");
    assert.equal(report.reactNative, "0.87.1");
    assert.equal(report.displayServer, "headless");
    assert.ok(stackingContextRule, "RN's ViewShadowNode still forms a stacking context for a positioned View with a zIndex");
    assert.ok(hoistingRule, "RN still slices a stacking context's children out of the Views that form none");
    assert.deepEqual(report.stages.setup.keys, ["PortalPatternExample"], "the roots ran the example's own registered component");
    const {layout} = report.stages.setup;
    for (const value of Object.values(layout)) {
      assert.ok(Number.isFinite(value), "the layout is numbers");
    }
    for (const name of ["A", "B"]) {
      assert.ok(report.stages[name], `the ${name} stages are there`);
    }
    assert.ok(report.stages.clicks.length >= 12, "the scenario pressed the surfaces");
  },

  layout(report) {
    const {options} = report.stages.setup;
    for (const [root, stage] of [["A", report.stages.A.open], ["B", report.stages.B.open]]) {
      const frames = predicted(report, root);
      near(only(stage.tree, "portal-host").rect, frames.root, `${root}: the host fills the root`);
      near(only(stage.tree, "portal-card").rect, frames.card, `${root}: the card`);
      near(only(stage.tree, "portal-header").rect, frames.header, `${root}: the header`);
      near(only(stage.tree, "portal-scroll").rect, frames.scroll, `${root}: the ScrollView`);
      near(only(stage.tree, "portal-status-box").rect, frames.status, `${root}: the status`);
      frames.rows.forEach((frame, index) => near(only(stage.tree, `portal-row-${index}`).rect, frame, `${root}: row ${index}`));
      near(only(stage.tree, "portal-pick").rect, frames.pick, `${root}: the trigger`);
      near(only(stage.tree, "dropdown").rect, frames.dropdown, `${root}: the dropdown, under the trigger with its right edge on the trigger's`);
      near(only(stage.tree, "dropdown-header").rect, frames.dropdownHeader, `${root}: the dropdown's header`);
      options.forEach((option, index) => near(only(stage.tree, `dropdown-item-${option}`).rect, frames.items[index], `${root}: item ${option}`));
      // The dropdown reaches past the ScrollView's rectangle in the layout itself, and stays inside the root.
      assert.ok(frames.dropdown[1] + frames.dropdown[3] > frames.scroll[1] + frames.scroll[3], `${root}: the layout puts the dropdown past the ScrollView`);
      assert.ok(frames.dropdown[1] + frames.dropdown[3] <= frames.root[1] + frames.root[3] && frames.dropdown[0] >= frames.root[0]
        && frames.dropdown[0] + frames.dropdown[2] <= frames.root[0] + frames.root[2], `${root}: and inside the root`);
      // What the trigger measured with measureInWindow: its frame in the window, and the host's origin to subtract.
      const anchors = stage.example.anchors;
      assert.ok(anchors.length >= 1, `${root}: the trigger measured itself`);
      near(anchors[0].trigger, frames.pick, `${root}: measureInWindow of the trigger`);
      near(anchors[0].host, frames.origin, `${root}: measureInWindow of the host`);
      near([anchors[0].left, anchors[0].top], [frames.dropdown[0] - frames.origin[0], frames.dropdown[1] - frames.origin[1]], `${root}: the position the portal was given`);
    }
  },

  tree(report) {
    for (const [root, stage] of [["A", report.stages.A.open], ["B", report.stages.B.open], ["A", report.stages.A.reopened]]) {
      const {tree} = stage;
      const host = only(tree, "portal-host");
      const parent = tree.find(entry => entry.id === host.parent);
      assert.ok(parent && parent.parent !== 0, `${root}: the host's parent is the root's View, which is under the surface`);
      assert.equal(tree.find(entry => entry.id === parent.parent).parent, 0, `${root}: and the root's View is the surface's child`);
      const siblings = tree.filter(entry => entry.parent === parent.id).map(entry => entry.index).sort((a, b) => a - b);
      assert.deepEqual(siblings, siblings.map((_, index) => index), `${root}: the sibling indexes are 0..n-1`);
      assert.equal(host.index, siblings.length - 1, `${root}: the host is the last child of the root's View`);
      const children = tree.filter(entry => entry.parent === host.id).map(entry => entry.name).sort();
      assert.deepEqual(children, [...PORTAL].sort(), `${root}: the host's children are exactly the portal's Controls`);
      const ancestors = id => {
        const chain = [];
        for (let at = tree.find(entry => entry.id === id)?.parent; at; at = tree.find(entry => entry.id === at)?.parent) {
          chain.push(tree.find(entry => entry.id === at).name);
        }
        return chain;
      };
      for (const name of PORTAL) {
        const chain = ancestors(only(tree, name).id);
        assert.ok(!chain.includes("portal-scroll") && !chain.includes("portal-card"), `${root}: ${name} is under neither the ScrollView nor the card`);
        assert.equal(chain[0], "portal-host", `${root}: ${name} is a child of the host`);
      }
      // Tree order: children in index order, depth first. The host's subtree follows every Control that is not a part of the host's path.
      const order = [];
      const visit = id => {
        order.push(id);
        tree.filter(entry => entry.parent === id).sort((a, b) => a.index - b.index).forEach(entry => visit(entry.id));
      };
      visit(tree.find(entry => entry.parent === 0).id);
      const inSubtree = new Set();
      const collect = id => tree.filter(entry => entry.parent === id).forEach(entry => {
        inSubtree.add(entry.id);
        collect(entry.id);
      });
      collect(host.id);
      const spine = new Set([host.id, parent.id, parent.parent]);
      for (const entry of tree) {
        if (!inSubtree.has(entry.id) && !spine.has(entry.id)) {
          assert.ok(order.indexOf(entry.id) < order.indexOf(host.id), `${root}: ${entry.name} comes before the host in tree order`);
        }
      }
      assert.ok(inSubtree.size >= PORTAL.length, `${root}: the host's subtree holds the portal`);
      assert.equal(only(tree, "portal-host").filter, IGNORE, `${root}: the host's Control ignores the mouse, which is what box-none gives`);
      assert.equal(parent.filter, IGNORE, `${root}: the root's View ignores the mouse too`);
    }
    for (const root of ["A", "B"]) {
      const closed = report.stages[root].closed.tree;
      assert.equal(closed.filter(entry => entry.parent === only(closed, "portal-host").id).length, 0, `${root}: closed, the host has no children`);
      near(only(closed, "portal-host").rect, predicted(report, root).root, `${root}: closed, the host fills the root`);
    }
  },

  clip(report) {
    for (const [root, stage] of [["A", report.stages.A.open], ["B", report.stages.B.open]]) {
      const {tree} = stage;
      const dropdown = only(tree, "dropdown");
      const scroll = only(tree, "portal-scroll");
      assert.equal(scroll.clip, true, `${root}: the ScrollView clips its content`);
      assert.ok(dropdown.rect[1] + dropdown.rect[3] > scroll.rect[1] + scroll.rect[3], `${root}: the dropdown reaches past the ScrollView's rectangle`);
      let visible = dropdown.rect;
      const clippers = [];
      for (let at = tree.find(entry => entry.id === dropdown.parent); at; at = tree.find(entry => entry.id === at.parent)) {
        if (at.clip) {
          clippers.push(at.name);
          visible = intersect(visible, at.rect);
        }
      }
      assert.deepEqual(visible, dropdown.rect, `${root}: nothing cuts the dropdown (clipped by ${clippers})`);
      for (const name of PORTAL) {
        const entry = only(tree, name);
        let part = entry.rect;
        for (let at = tree.find(item => item.id === entry.parent); at; at = tree.find(item => item.id === at.parent)) {
          part = at.clip ? intersect(part, at.rect) : part;
        }
        assert.deepEqual(part, entry.rect, `${root}: ${name} is drawn whole`);
      }
      assert.equal(only(tree, "portal-host").clip, false, `${root}: the host does not clip`);
    }
  },

  input(report) {
    const state = {A: {open: false, rows: [], choices: [], picks: 0}, B: {open: false, rows: [], choices: [], picks: 0}};
    let worldPresses = 0;
    for (const click of report.stages.clicks) {
      const model = state[click.root];
      const lie = lieAt(report, click.root, click.at, model.open);
      const intent = intentOf(click.intent);
      assert.equal(lie.kind, intent.kind, `${click.id}: the View at the point is what the press meant to be`);
      if (intent.kind === "row") {
        assert.equal(lie.index, intent.index, `${click.id}: the row`);
      }
      if (intent.kind === "item") {
        assert.equal(lie.option, intent.option, `${click.id}: the item`);
      }
      // What follows from the View that lies there: the handler it has, or the world when none does.
      if (lie.kind === "world") {
        worldPresses += 1;
      } else if (lie.kind === "row") {
        model.rows.push(lie.index);
      } else if (lie.kind === "item") {
        model.choices.push(lie.option);
        model.open = false;
      } else if (lie.kind === "pick") {
        if (model.open) {
          model.open = false;
        } else {
          model.picks += 1;
          model.open = true;
        }
      }
      assert.equal(click.after.world.length, worldPresses, `${click.id}: the world heard ${worldPresses} presses`);
      if (lie.kind === "world") {
        assert.deepEqual(click.after.world.at(-1), click.at, `${click.id}: the world heard this very press, at its point`);
      }
      assert.deepEqual(click.after.rowPresses, model.rows, `${click.id}: the rows that heard a press`);
      assert.deepEqual(click.after.choices, model.choices, `${click.id}: the choices`);
      assert.equal(click.after.picks, model.picks, `${click.id}: the Pick presses that opened`);
      assert.equal(click.after.open, model.open, `${click.id}: whether the dropdown is open`);
      if (click.after.open && lie.kind === "row") {
        assert.ok(click.after.live.endsWith(`rows: ${model.rows.length}`), `${click.id}: the open dropdown shows the state (${click.after.live})`);
      }
    }
    // The scenario covers what the brief asks of the input: an item, a row outside the dropdown, the dropdown's own body, the row under the
    // closed area, and the world with the dropdown open and closed.
    const kinds = new Set(report.stages.clicks.map(click => click.intent.split(":")[0]));
    for (const kind of ["pick", "row", "item", "dropdown-body", "world"]) {
      assert.ok(kinds.has(kind), `the scenario pressed a ${kind}`);
    }
    const closedWorld = report.stages.clicks.find(click => click.id === "A/world-closed");
    const openWorld = report.stages.clicks.find(click => click.id === "A/world-while-open");
    assert.ok(closedWorld.after.world.length === 2 && openWorld.after.open, "the world heard a press with the dropdown open and another with it closed");
  },

  lifecycle(report) {
    const {A, B} = report.stages;
    assert.equal(A.closed.tree.filter(entry => PORTAL.includes(entry.name)).length, 0, "a Portal draws nothing until it mounts");
    for (const stage of [A.chosen, A.underClosed, A.worldClosed]) {
      assert.equal(stage.tree.filter(entry => PORTAL.includes(entry.name)).length, 0, "closing removes every one of the portal's Controls");
      assert.equal(stage.tree.filter(entry => entry.parent === only(stage.tree, "portal-host").id).length, 0, "and leaves the host empty");
    }
    const label = only(A.chosen.nodes.map(node => ({name: node.testID, text: node.nativeText ?? node.text})), "portal-row-label-2");
    assert.equal(label.text, "Size: Large", "the row shows the choice");
    const unmount = report.stages.unmountB;
    assert.equal(only(B.beforeUnmount.tree, "dropdown").name, "dropdown", "the root was unmounted with its portal open");
    assert.deepEqual([unmount.hostsBefore, unmount.hostsAfter, unmount.leaked, unmount.dropdownsAfter], [2, 1, 0, 1], "one host and one dropdown remain, and nothing leaked");
    assert.equal(unmount.surfaceId, 0);
    assert.equal(unmount.rootCount, 1);
    assert.equal(unmount.retired.nativeTags, 0, "the unmounted root holds no native Control");
    assert.equal(unmount.retired.creates, unmount.retired.deletes, "its Controls were created and deleted in balance");
    assert.ok(unmount.A.tree.some(entry => entry.name === "dropdown"), "the other root kept its portal");
    const {stop} = report.stages;
    assert.ok(stop.application.stopped && stop.application.rootCount === 0 && stop.application.errors.length === 0);
    assert.deepEqual([stop.hosts, stop.portalControls], [0, 0], "a stopped application leaves no host and no portal Control");
    assert.equal(stop.A.nativeTags, 0);
    assert.equal(stop.A.creates, stop.A.deletes, "and balances what it created");
  },

  roots(report) {
    const {A, B} = report.stages;
    const hostA = only(A.reopened.tree, "portal-host");
    const hostB = only(B.open.tree, "portal-host");
    assert.notEqual(hostA.id, hostB.id, "each root has its own host");
    const idsA = new Set(A.reopened.tree.map(entry => entry.id));
    assert.ok(B.open.tree.every(entry => !idsA.has(entry.id)), "no Control belongs to both roots");
    for (const [root, stage] of [["A", A.reopened], ["B", B.open]]) {
      assert.equal(byName(stage.tree, "dropdown").length, 1, `${root}: one dropdown`);
      const frames = predicted(report, root);
      const dropdown = only(stage.tree, "dropdown");
      assert.ok(inside([dropdown.rect[0], dropdown.rect[1]], frames.root) && inside([dropdown.rect[0] + dropdown.rect[2] - 1, dropdown.rect[1] + dropdown.rect[3] - 1], frames.root),
        `${root}: the dropdown is drawn inside its own root`);
    }
    assert.equal(B.closed.tree.filter(entry => PORTAL.includes(entry.name)).length, 0, "a portal open in A put nothing in the second root's host");
    // State is per root: B chose Small, A kept Large and kept its dropdown open.
    assert.deepEqual(B.chosen.example.choices, ["Small"]);
    assert.deepEqual(A.afterB.example.choices, ["Large"]);
    assert.ok(byName(A.afterB.tree, "dropdown").length === 1 && byName(B.chosen.tree, "dropdown").length === 0, "choosing in B closed B's dropdown and left A's open");
    const text = (stage, id) => stage.nodes.find(node => node.testID === id)?.nativeText ?? stage.nodes.find(node => node.testID === id)?.text;
    assert.equal(text(B.chosen, "portal-row-label-2"), "Size: Small");
    assert.equal(text(A.afterB, "portal-row-label-2"), "Size: Large");
    assert.deepEqual(B.chosen.example.rowPresses, [], "B's rows heard nothing of A's presses");
  },

  context(report) {
    const {accent} = report.stages.setup;
    for (const [root, stage] of [["A", report.stages.A.open], ["B", report.stages.B.open]]) {
      const text = id => stage.nodes.find(node => node.testID === id)?.nativeText ?? stage.nodes.find(node => node.testID === id)?.text;
      assert.equal(stage.example.triggerAccent, accent, `${root}: the trigger's subtree has the card's Context`);
      assert.equal(stage.example.portalAccent, "none", `${root}: the portal's content reads the default`);
      assert.notEqual(stage.example.portalAccent, stage.example.triggerAccent);
      assert.equal(text("dropdown-context"), "context: none", `${root}: and so does what is drawn`);
      assert.ok(text("dropdown-live").startsWith(`prop: ${accent}`), `${root}: a prop carries the value across`);
    }
  },
};

export function oracleRejections(report) {
  return Object.fromEntries(Object.entries(sections).map(([name, judge]) => {
    try {
      judge(report);
      return [name, null];
    } catch (error) {
      return [name, String(error.message).split("\n")[0]];
    }
  }));
}

export function verifyPortalPatternReport(report) {
  const rejected = Object.entries(oracleRejections(report)).filter(([, reason]) => reason !== null);
  assert.deepEqual(rejected, [], "the oracle accepts every section");
}
