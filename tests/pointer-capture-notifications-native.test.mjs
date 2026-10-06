import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleProbe, eventTargetProbeModes} from "../scripts/event-target-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const requestedInterest = process.argv.find(value => value.startsWith("--interest="))?.slice(11);
const requestedFlag = process.argv.find(value => value.startsWith("--flag="))?.slice(7);
// Control mode: re-verify one saved report with the independent oracle only,
// without the probe's own status gates, and state whether it must be rejected.
const oracleReport = process.argv.find(value => value.startsWith("--oracle-report="))?.slice(16);
const expectReject = process.argv.includes("--expect-reject");
assert.ok(requestedInterest == null || ["original", "current"].includes(requestedInterest));
assert.ok(requestedFlag == null || eventTargetProbeModes.includes(requestedFlag));
const interests = requestedInterest == null ? ["original", "current"] : [requestedInterest];
const modes = requestedFlag == null ? eventTargetProbeModes : [requestedFlag];
const digest = value => createHash("sha256").update(value).digest("hex");
const flags = mode => ({imperative: ["imperative-only", "enabled"].includes(mode), nativeDispatch: ["internal-only", "enabled"].includes(mode)});
async function optionalFile(file) { try { return await readFile(path.join(root, file)); } catch (error) { if (error.code === "ENOENT") { return null; } throw error; } }
async function publicHash() { const bytes = await optionalFile("build/app.js"); return bytes == null ? null : digest(bytes); }

// An independent statement of the scene. Rectangles are root-relative
// [left, top, width, height]; W is the mounted AppRegistry View (box-none) and
// R the root view, which is never an event target. Later views paint on top.
const views = {
  W: {parent: "R", rect: [0, 0, 300, 200], boxNone: true}, C: {parent: "W", rect: [0, 0, 220, 200], boxNone: true},
  G: {parent: "C", rect: [10, 10, 140, 70]}, L1: {parent: "G", rect: [20, 20, 50, 40]},
  L2: {parent: "G", rect: [90, 20, 50, 40]}, S: {parent: "C", rect: [160, 10, 50, 70]}, X: {parent: "W", rect: [230, 10, 60, 70]},
};
const paintOrder = ["W", "C", "G", "L1", "L2", "S", "X"];
const points = {L1: [45, 40], L1b: [46, 41], L1c: [47, 42], L2: [115, 40], L2b: [116, 41], G: [80, 70], S: [185, 45], EMPTY: [260, 150]};
const surfaceX = {A: 0, B: 340}, away = [320, 60];
// JSX props: [label, phase] per kind. C's contact props and every got/lost
// prop are what RN's ViewProps see; hover props sit on the two leaves only.
const hoverKinds = ["over", "out", "enter", "leave"], notifyKinds = ["got", "lost"];
const jsxProps = {
  C: {got: [["C-capture", "capture"], ["C", "bubble"]], lost: [["C-capture", "capture"], ["C", "bubble"]],
    down: [["C", "bubble"]], move: [["C", "bubble"]], up: [["C", "bubble"]], cancel: [["C", "bubble"]], click: [["C", "bubble"]]},
  G: {got: [["G", "bubble"]], lost: [["G", "bubble"]]},
  L1: {got: [["L1-capture", "capture"], ["L1", "bubble"]], lost: [["L1-capture", "capture"], ["L1", "bubble"]],
    ...Object.fromEntries(hoverKinds.map(kind => [kind, [["L1", "bubble"]]]))},
  L2: {got: [["L2", "bubble"]], lost: [["L2", "bubble"]], ...Object.fromEntries(hoverKinds.map(kind => [kind, [["L2", "bubble"]]]))},
  S: {got: [["S", "bubble"]], lost: [["S", "bubble"]]},
};
// addEventListener registrations (got and lost only): the Document's need D,
// the documentElement's and Views' also I.
const added = {Doc: [["DocC", "capture"], ["DocB", "bubble"]], Root: [["RootC", "capture"], ["RootB", "bubble"]],
  L1: [["L1C", "capture"], ["L1B", "bubble"]], G: [["GB", "bubble"]]};
const lineage = node => { const path = []; for (let key = node; key != null; key = views[key]?.parent) { path.push(key); } return path; };
const listens = (node, kind) => (jsxProps[node]?.[kind] ?? []).length > 0;
const contains = (key, [x, y]) => { const [left, top, width, height] = views[key].rect; return x >= left && x < left + width && y >= top && y < top + height; };
function hit(point) {
  const hits = paintOrder.filter(key => !views[key].boxNone && contains(key, point));
  if (hits.length > 0) { return hits.at(-1); }
  return contains("W", point) ? "R" : null;
}

// Each case restates the probe's actual input: [action, point, finger], with
// points named on the case's root, "AWAY" between roots or "B:<point>".
const cases = {
  "mouse/capture-self": {downs: ["L1"], input: [["move", "L1"], ["press", "L1"], ["move", "L2"], ["move", "G"], ["move", "EMPTY"],
    ["move", "AWAY"], ["move", "B:L1"], ["move", "L2"], ["release", "L2"], ["move", "L2b"]]},
  "mouse/capture-up": {downs: ["L1"], input: [["move", "L1"], ["press", "L1"], ["release", "L1"]]},
  "mouse/transfer": {downs: ["L1"], input: [["move", "L1"], ["press", "L1"], ["schedule", "capture", "L2"], ["move", "L2"],
    ["move", "G"], ["move", "L1"], ["release", "L1"], ["move", "L1b"]]},
  "mouse/release": {downs: ["L1"], input: [["move", "L1"], ["press", "L1"], ["schedule", "release", "L1"], ["move", "L2"],
    ["move", "L2b"], ["release", "L2b"]]},
  "mouse/cancel": {downs: ["L1"], input: [["move", "L1"], ["press", "L1"], ["move", "L2"], ["cancel", "L2"], ["move", "L2b"]]},
  "mouse/remove-target": {downs: ["L2"], input: [["move", "L1"], ["press", "L1"], ["move", "L1b"], ["remove", "L2"], ["move", "L1c"],
    ["release", "L1c"], ["restore"]]},
  "mouse/remove-captured-origin": {downs: ["L2"], input: [["move", "L2"], ["press", "L2"], ["move", "L2b"], ["remove", "L2"],
    ["move", "L1"], ["release", "L1"], ["move", "L1b"], ["restore"]]},
  "mouse/capture-elsewhere": {downs: ["S"], input: [["move", "L1"], ["press", "L1"], ["release", "L1"], ["move", "L1b"]]},
  "mouse/listener-free-target": {downs: ["X"], input: [["move", "L1"], ["press", "L1"], ["move", "L2"], ["move", "G"],
    ["release", "L2"], ["move", "L2b"]]},
  "mouse/no-buttons": {downs: [], input: [["schedule", "capture", "L1"], ["move", "L1"], ["move", "L2"]]},
  "touch/capture-self": {downs: ["L1"], input: [["touch", "L1", 0], ["drag", "L2", 0], ["drag", "AWAY", 0], ["drag", "L2b", 0], ["lift", "L2b", 0]]},
  "touch/no-capture": {downs: ["-"], input: [["touch", "L1", 0], ["drag", "L2", 0], ["lift", "L2", 0]]},
  "touch/cancel": {downs: ["L1"], input: [["touch", "L1", 0], ["drag", "L2", 0], ["touch-cancel", "L2", 0]]},
  "touch/two-fingers": {downs: ["L1", "L2"], input: [["touch", "L1", 0], ["touch", "L2", 1], ["drag", "L2b", 0], ["drag", "L1b", 1],
    ["lift", "L1b", 1], ["lift", "L2b", 0]]},
  "B/mouse/capture-self": {panel: "B", downs: ["L1"], input: [["move", "L1"], ["press", "L1"], ["move", "L2"], ["release", "L2"]]},
};
// The probe's names for the same input, compared before the model runs.
const probeAction = {press: (point) => ["left", point, true], release: (point) => ["left", point, false], move: (point) => ["move", point],
  cancel: (point) => ["cancel-left", point], touch: (point, finger) => ["touch", point, finger, true],
  lift: (point, finger) => ["touch", point, finger, false], drag: (point, finger) => ["drag", point, finger],
  "touch-cancel": (point, finger) => ["touch-cancel", point, finger]};
function sameInput(id, step, executed) {
  const [action, ...rest] = step;
  const named = value => typeof value === "string" && value.startsWith("B:") ? ["B", value.slice(2)] : value;
  if (action === "schedule") { assert.deepEqual(executed, ["schedule", rest[0], rest[1]], id); return; }
  if (action === "remove" || action === "restore") { assert.deepEqual(executed, step, id); return; }
  assert.deepEqual(executed, probeAction[action](named(rest[0]), rest[1]), id);
}
function samplePoint(panel, name) {
  if (name === "AWAY") { return [away[0] - surfaceX[panel], away[1]]; }
  if (name.startsWith("B:")) { const [x, y] = points[name.slice(2)]; return [x + surfaceX.B - surfaceX[panel], y]; }
  return points[name];
}

// RN 0.87.1's PointerEventsProcessor over this scene: pending capture is
// processed at the pointer's next event (lost to the previous owner, got to
// the new one), then the event is retargeted to the pending owner, hover is
// tracked against that target and the event is emitted when its target's path
// listens (got/lost and click always pass). Up and Cancel leave a non-hovering
// pointer, then release capture implicitly. Removing an owner clears it
// without an event: RN has no path that targets the Document, and its only
// non-crashing branch, an expired owner, clears silently. The host cancels a
// contact whose current hit view or origin is removed; that cancel targets the
// removed view and reaches nobody, and a held mouse button stays inert until
// released. Click (Android's JSPointerDispatcher, iOS's filter): a primary
// main-button release clicks the deepest view on both physical hit paths,
// after that release.
function simulate(spec) {
  const pending = new Map(), active = new Map(), hovered = new Map(), pointers = new Map(), removed = new Set();
  const downs = [...spec.downs], queue = [], steps = [];
  let mouse = "m", suppressed = false;
  const live = node => node != null && !removed.has(node);
  const captures = slot => Object.fromEntries(["L1", "L2", "S", "G", "C", "X"].map(key => [key, removed.has(key) ? null : pending.get(slot) === key]));
  let emitted, actions = [];
  const emit = (kind, node, slot) => emitted.push({kind, node, slot,
    ...(kind === "got" || kind === "lost" ? {has: captures(slot)} : {})});
  function processPending(slot) {
    const want = live(pending.get(slot)) ? pending.get(slot) : null, owner = live(active.get(slot)) ? active.get(slot) : null;
    if (owner != null && owner !== want) { emit("lost", owner, slot); }
    if (want != null && owner !== want) { emit("got", want, slot); }
    if (want == null) { active.delete(slot); } else { active.set(slot, want); }
  }
  function hover(slot, target) {
    const previous = hovered.get(slot) ?? null;
    const before = previous == null ? [] : lineage(previous).reverse(), after = target == null ? [] : lineage(target).reverse();
    const same = previous != null && target != null && previous === target;
    if (!same && live(previous) && before.some(node => live(node) && listens(node, "out"))) { emit("out", previous, slot); }
    let common = 0;
    while (common < before.length && common < after.length && before[common] === after[common]) { common += 1; }
    before.slice(common).filter(node => live(node) && listens(node, "leave")).reverse().forEach(node => emit("leave", node, slot));
    if (!same && target != null && after.some(node => listens(node, "over"))) { emit("over", target, slot); }
    after.slice(common).filter(node => listens(node, "enter")).forEach(node => emit("enter", node, slot));
    if (target == null) { hovered.delete(slot); } else { hovered.set(slot, target); }
  }
  // C's contact props run the case's plan inside the delivered Down or Move.
  function handler(kind, slot) {
    if (kind === "down" && downs.length > 0) {
      const node = downs.shift();
      if (node !== "-") { capture(slot, node); }
      actions.push({at: "down", action: node === "-" ? "check" : "capture", node: node === "-" ? "" : node, has: captures(slot)});
    } else if (kind === "move" && queue.length > 0) {
      const {action, node} = queue.shift();
      if (action === "capture") { capture(slot, node); } else if (pointers.get(slot)?.active && pending.get(slot) === node) { pending.delete(slot); }
      actions.push({at: "move", action, node, has: captures(slot)});
    }
  }
  function capture(slot, node) {
    if (pointers.get(slot)?.active && pointers.get(slot).buttons !== 0) { pending.set(slot, node); }
  }
  function intercept(slot, kind, physical) {
    processPending(slot);
    const owner = live(pending.get(slot)) ? pending.get(slot) : null;
    const target = owner ?? physical;
    if (kind === "down") { pointers.set(slot, {...pointers.get(slot), active: true, buttons: 1, leaves: !hovered.has(slot)}); }
    hover(slot, target);
    if (target != null && target !== "R" && lineage(target).some(node => listens(node, kind))) {
      emit(kind, target, slot);
      handler(kind, slot);
    }
    if (kind === "cancel" || (kind === "up" && pointers.get(slot)?.leaves)) { hover(slot, null); }
    if (owner != null && (kind === "up" || kind === "cancel")) {
      if (pending.get(slot) === owner) { pending.delete(slot); }
      processPending(slot);
    }
    if (kind === "up" || kind === "cancel") { pointers.set(slot, {...pointers.get(slot), active: false, buttons: 0}); }
    // A native cancel reuses the contact's last sample and its physical target.
    if (pointers.has(slot)) { pointers.set(slot, {...pointers.get(slot), last: physical}); }
  }
  const mounted = node => node != null && node !== "R" ? lineage(node).filter(key => key !== "R") : [];
  function click(slot, physical) {
    const contact = pointers.get(slot), down = contact.downPath ?? [];
    if (!contact.primary) { return; }
    const target = mounted(physical).find(node => down.includes(node));
    if (target != null) { emit("click", target, slot); }
  }
  for (const step of spec.input) {
    emitted = []; actions = [];
    const [action, name, finger] = step, physical = name == null || action === "schedule" || action === "remove" ? null : hit(samplePoint(spec.panel ?? "A", name));
    // A pointer whose surface is A never hits B's views: B is outside A's root.
    const local = name?.startsWith?.("B:") || name === "AWAY" ? null : physical;
    if (action === "schedule") { queue.push({action: step[1], node: step[2]}); }
    else if (action === "remove") {
      removed.add(name);
      for (const map of [pending, active]) { for (const [slot, node] of map) { if (node === name) { map.delete(slot); } } }
      for (const [slot, value] of [...pointers]) {
        if (value.active && (value.last === name || value.downPath?.[0] === name)) {
          intercept(slot, "cancel", null); pointers.delete(slot); hovered.delete(slot);
          if (slot === mouse) { suppressed = true; mouse += "+"; }
        }
      }
    }
    else if (action === "restore") { removed.clear(); }
    else if (action === "move") { if (!suppressed) { intercept(mouse, "move", local); } }
    else if (action === "press") {
      pointers.set(mouse, {...pointers.get(mouse), primary: true, downPath: mounted(local)});
      intercept(mouse, "down", local);
    } else if (action === "release") {
      if (suppressed) { suppressed = false; } else { intercept(mouse, "up", local); click(mouse, local); }
    } else if (action === "cancel") {
      intercept(mouse, "cancel", pointers.get(mouse)?.last ?? null);
      // The host retires a canceled mouse's route: it returns as a new pointer.
      hovered.delete(mouse); pointers.delete(mouse); mouse += "+";
    } else if (action === "touch") {
      const slot = "f" + finger, primary = ![...pointers].some(([key, value]) => key.startsWith("f") && value.active);
      pointers.set(slot, {primary, downPath: mounted(local)});
      intercept(slot, "down", local);
    } else if (action === "drag") { intercept("f" + finger, "move", local); }
    else if (action === "lift") { intercept("f" + finger, "up", local); click("f" + finger, local); pointers.delete("f" + finger); hovered.delete("f" + finger); }
    else if (action === "touch-cancel") { intercept("f" + finger, "cancel", pointers.get("f" + finger)?.last ?? null); pointers.delete("f" + finger); hovered.delete("f" + finger); }
    steps.push({events: emitted, actions, counts: [pending.size, active.size]});
  }
  return steps;
}

// RN's EventTarget dispatch in native-dispatch lanes: capture from the
// Document down to the target (its own capture listeners at phase 2), then
// bubble from the target (phase 2) up to the Document, unless the event does
// not bubble; on each node the JSX prop precedes added listeners. Legacy lanes
// run JSX props only: capture props from the root down, then bubble props.
function propagation(kind, target, I, D) {
  const elements = lineage(target).filter(node => node !== "R"), chain = D ? [...elements, "Root", "Doc"] : elements;
  const bubbles = !["enter", "leave"].includes(kind);
  const on = (node, phaseName) => [
    ...(jsxProps[node]?.[kind] ?? []).filter(([, phase]) => phase === phaseName).map(([label]) => label),
    ...(D && notifyKinds.includes(kind) && (node === "Doc" || I) ? (added[node] ?? []).filter(([, phase]) => phase === phaseName).map(([label]) => label) : [])];
  const rows = [];
  for (const node of [...chain].reverse()) { for (const label of on(node, "capture")) { rows.push([label, D ? (node === target ? 2 : 1) : null]); } }
  for (const node of chain) {
    if (!bubbles && node !== target) { break; }
    for (const label of on(node, "bubble")) { rows.push([label, D ? (node === target ? 2 : 3) : null]); }
  }
  return rows.map(([label, phase]) => [label, kind, phase]);
}

const rawTypes = {got: "topGotPointerCapture", lost: "topLostPointerCapture", down: "topPointerDown", move: "topPointerMove", up: "topPointerUp",
  cancel: "topPointerCancel", over: "topPointerOver", out: "topPointerOut", enter: "topPointerEnter", leave: "topPointerLeave", click: "topClick"};
const domTypes = {got: "gotpointercapture", lost: "lostpointercapture", down: "pointerdown", move: "pointermove", up: "pointerup",
  cancel: "pointercancel", over: "pointerover", out: "pointerout", enter: "pointerenter", leave: "pointerleave", click: "click"};

function verifyCase(id, stage, I, D) {
  const spec = cases[id], panel = spec.panel ?? "A", react = stage.react, tags = stage.tags;
  assert.equal(stage.steps.length, spec.input.length, id);
  spec.input.forEach((step, index) => sameInput(id, step, stage.steps[index].action));
  const model = simulate(spec);
  const expected = model.flatMap((step, index) => step.events.map(event => ({...event, step: index})));
  // Sequence: types, targets, pointer identities and the step that caused them.
  assert.deepEqual(react.raw.map(row => [row.type, row.target]), expected.map(event => [rawTypes[event.kind], tags[event.node]]), id);
  const slots = new Map();
  expected.forEach((event, index) => {
    const row = react.raw[index];
    if (!slots.has(event.slot)) { slots.set(event.slot, row.pointerId); }
    assert.equal(row.pointerId, slots.get(event.slot), id);
    assert.ok(stage.steps[event.step].raw.includes(row.sequence), id);
  });
  assert.equal(new Set(slots.values()).size, slots.size, id);
  // Payload: the step's sample, an offset local to every non-hover target, and
  // got/lost copying the sample of the event that processed them. A native
  // cancel repeats the contact's last sample; each cancel here happens where
  // its contact last moved.
  expected.forEach((event, index) => {
    const row = react.raw[index], [x, y] = samplePoint(panel, spec.input[event.step][1]);
    assert.equal(row.pointerType, id.startsWith("touch/") ? "touch" : "mouse", id);
    assert.deepEqual([row.clientX, row.clientY], [x, y], id);
    if (!hoverKinds.includes(event.kind)) {
      const [left, top] = views[event.node].rect;
      assert.deepEqual([row.offsetX, row.offsetY], [x - left, y - top], `${id} ${event.kind}@${event.node}`);
    }
    if (notifyKinds.includes(event.kind)) {
      const siblings = react.raw.filter(other => stage.steps[event.step].raw.includes(other.sequence) && other.pointerId === row.pointerId &&
        !["topGotPointerCapture", "topLostPointerCapture"].includes(other.type));
      assert.ok(siblings.length > 0, id);
      for (const other of siblings) {
        assert.deepEqual([other.timeStamp, other.button, other.buttons, other.isPrimary], [row.timeStamp, row.button, row.buttons, row.isPrimary], id);
      }
    }
  });
  // Delivery: each raw event's callbacks follow, share its payload and target.
  const flat = [];
  expected.forEach((event, index) => {
    const row = react.raw[index], next = react.raw[index + 1]?.sequence ?? Number.POSITIVE_INFINITY;
    const own = react.events.filter(entry => entry.sequence > row.sequence && entry.sequence < next);
    const want = propagation(event.kind, event.node, I, D);
    flat.push(...want);
    assert.deepEqual(own.map(entry => [entry.label, entry.kind, entry.phase]), want, `${id} ${event.kind}@${event.node}`);
    for (const entry of own) {
      assert.equal(entry.name, panel, id);
      assert.deepEqual([entry.payloadId, entry.targetTag, entry.type, entry.trusted, entry.originalEvent, entry.compiledLegacySynthetic],
        [row.payloadId, row.target, D ? domTypes[event.kind] : null, D, D, !D], id);
      if (D) { assert.deepEqual([entry.bubbles, entry.cancelable], [!["enter", "leave"].includes(event.kind), true], id); }
      if ([...notifyKinds, ...hoverKinds, "click"].includes(event.kind)) { assert.equal(entry.currentPriority, react.discretePriority, id); }
      if (notifyKinds.includes(event.kind)) { assert.deepEqual(entry.has, event.has, `${id} ${event.kind} pending owner`); }
      const current = entry.label.startsWith("Doc") ? "Doc" : entry.label.startsWith("Root") ? "Root" : entry.label.match(/^(L1|L2|C|G|S)/)[1];
      if (current === "Doc") { assert.ok(entry.currentIsDocument, id); }
      else if (current === "Root") { assert.ok(entry.currentIsElement, id); }
      else { assert.equal(entry.currentTag, tags[current], id); }
    }
  });
  assert.equal(react.events.length, flat.length, id);
  assert.ok(react.globalEventRestored && react.currentPriority === react.defaultPriority, id);
  // Capture state: methods read the pending owner at once; the native maps hold
  // [pending, active] owners between samples.
  assert.deepEqual(react.actions.map(row => ({at: row.at, action: row.action, node: row.node, has: row.has})),
    model.flatMap(step => step.actions), id);
  assert.deepEqual(stage.steps.map(step => step.capture), model.map(step => step.counts), id);
  stage.steps.filter(step => step.action[0] === "remove").forEach(({current: removed}) =>
    assert.deepEqual([removed.has.L2, removed.has.L1, removed.retained.L2], [null, false, {connected: false, has: false}], id));
  assert.deepEqual([stage.after.pointer.activeTouches, stage.application.pointerProcessor.active, stage.application.pointerProcessor.pendingCapture,
    stage.application.pointerProcessor.activeCapture, stage.application.pointerRouting.active], [0, 0, 0, 0, 0], id);
}

// The model and DOM rules alone, without the probe's own status gates.
function verifySemantics(report) {
  const {imperative: I, nativeDispatch: D} = flags(report.flagMode), installed = report.interestMode === "current" && D;
  const methods = available => Array(3).fill(available ? "function" : "undefined");
  for (const name of ["A", "B"]) {
    const capability = report.stages["capability" + name];
    assert.deepEqual(capability.flags, flags(report.flagMode)); assert.equal(capability.mode, report.flagMode);
    assert.deepEqual(capability.methods, {doc: methods(D), element: methods(I && D), view: methods(I && D)});
    assert.deepEqual(capability.captureMethods, methods(true));
    assert.deepEqual(capability.installed, ["DocC", "RootC", "L1C", "L1B", "GB", "RootB", "DocB"].filter(label => D && (label.startsWith("Doc") || I)));
    assert.equal(capability.query.installations, installed ? 1 : 0);
  }
  for (const id of Object.keys(cases)) { verifyCase(id, report.stages[id], I, D); }
  // RN emits got/lost without consulting any listener: no Map read for them.
  for (const id of Object.keys(cases)) {
    assert.ok(report.stages[id].react.query.rows.every(row => row.offset !== 32 && row.offset !== 33), id);
    if (!installed) { assert.deepEqual(report.stages[id].react.query.rows, [], id); }
  }
  assert.deepEqual(report.stages.captureLookups, []);
  assert.deepEqual(report.afterStop.errors, []);
  assert.ok(report.afterStop.stopped && !report.afterStop.pointerListenerQueryInstalled && report.afterStop.rootCount === 0);
  assert.deepEqual(report.afterStop.pointerProcessor, {active: 0, pendingCapture: 0, activeCapture: 0, hover: 0});
}

function verify({report, result, log, interestMode, flagMode}) {
  assert.equal(result.error, undefined, log); assert.equal(result.signal, null, log); assert.equal(result.status, 0, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use|Inconsistency between local and platform pointer registries/);
  assert.equal(report.scenario, "native-pointer-capture-notifications"); assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.flagMode, flagMode); assert.equal(report.interestMode, interestMode); assert.equal(report.displayServer, "headless");
  assert.ok(report.allAssertionsPassed); assert.deepEqual(report.failures, []);
  assert.equal(report.checks.length, 9 + 5 * Object.keys(cases).length);
  assert.ok(report.checks.every(row => row.passed));
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, 0, "No native, script or engine error is printed");
  assert.match(log, /POINTER_CAPTURE_NOTIFICATIONS_PASSED: \d+/);
  verifySemantics(report);
}

if (oracleReport != null) {
  test("the independent oracle re-verifies one saved capture report", async () => {
    const report = JSON.parse(await readFile(path.resolve(root, oracleReport), "utf8"));
    if (!expectReject) { verifySemantics(report); return; }
    assert.throws(() => verifySemantics(report), error => {
      console.log("ORACLE_REJECTED: " + error.message.split("\n")[0]);
      return error instanceof assert.AssertionError;
    });
  });
} else {
  test("capture notifications reach RN's listeners in order, retargeted, and hover and click follow RN while captured", async () => {
    const before = await publicHash(), binary = await ensureGodotBinary(), results = [], reports = {};
    const nativeHostSha256 = digest(await readFile(path.join(root, "addons/fabric_godot.dylib")));
    // Keep every actual report before asserting a lane.
    for (const interestMode of interests) {
      const bundles = await bundleProbe({entryPoint: "tests/pointer-capture-notifications-fixture.jsx", modes,
        prefix: "pointer-capture-notifications", parentMode: "current", rendererTagMode: "current",
        nativeDispatchMode: "experimental", pointerInterestMode: interestMode,
        defines: {__POINTER_DOCUMENT_INTEREST_MODE__: JSON.stringify(interestMode)},
        sources: ["tests/event-target-bootstrap.js", "tests/pointer-document-bootstrap.js",
          "tests/pointer-capture-notifications-fixture.jsx", "tests/pointer-capture-notifications-probe.gd",
          "tests/pointer-capture-notifications-native.test.mjs", "scripts/event-target-bundle.mjs",
          "sdk/toolchain/platform-plugin.mjs", "sdk/toolchain/rn-event-target-overlay.mjs",
          "sdk/toolchain/rn-renderer-tag-overlay.mjs", "sdk/toolchain/rn-pointer-interest-overlay.mjs",
          "src/private-interface.js", "src/pointer-listener-query.js", "src/base-view-config.js", "src/render-application.jsx",
          "native/application_runtime.cpp", "native/pointer_adapter.cpp", "native/pointer_adapter.h", "native/pointer_event.h",
          "native/godot_dom.cpp", "scripts/rn-pointer-overlay.mjs"],
        extraUpstreamFiles: ["src/private/renderer/events/dispatchNativeEvent.js",
          "src/private/renderer/events/LegacySyntheticEvent.js", "src/private/renderer/events/ReactNativeEventTypeMapping.js",
          "src/private/webapis/dom/nodes/ReadOnlyElement.js", "src/private/webapis/dom/nodes/ReactNativeDocument.js",
          "Libraries/NativeComponent/BaseViewConfig.android.js", "Libraries/NativeComponent/BaseViewConfig.ios.js",
          "ReactAndroid/src/main/java/com/facebook/react/uimanager/JSPointerDispatcher.kt",
          "React/Fabric/RCTSurfacePointerHandler.mm", "ReactCommon/react/nativemodule/dom/NativeDOM.cpp",
          "ReactCommon/react/renderer/components/view/TouchEventEmitter.cpp",
          "ReactCommon/react/renderer/uimanager/PointerEventsProcessor.cpp",
          "ReactCommon/react/renderer/uimanager/PointerEventsProcessor.h",
          "ReactCommon/react/renderer/uimanager/PointerHoverTracker.cpp",
          "ReactCommon/react/renderer/uimanager/UIManagerBinding.cpp",
          "ReactCommon/react/renderer/core/EventQueueProcessor.cpp"]});
      for (const flagMode of modes) {
        await rm(path.join(root, "build/pointer-capture-notifications-report.json"), {force: true});
        const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/pointer-capture-notifications-probe.gd", "--",
          "--interest=" + interestMode, "--flag=" + flagMode], {encoding: "utf8", timeout: 120000, maxBuffer: 32 * 1024 * 1024});
        const log = (result.stdout ?? "") + (result.stderr ?? ""), id = interestMode + "-" + flagMode;
        await writeFile(path.join(root, "build/pointer-capture-notifications-" + id + ".log"), log);
        const bytes = await optionalFile("build/pointer-capture-notifications-report.json"), report = bytes == null ? null : JSON.parse(bytes);
        if (report != null) {
          report.provenance = {node: process.version, bundles, publicBundleSha256: before, nativeHostSha256, sourceReceiptDoesNotCertifyNativeBuild: true};
          await writeFile(path.join(root, "build/pointer-capture-notifications-" + id + "-report.json"), JSON.stringify(report, null, 2) + "\n");
          reports[id] = report;
        }
        results.push({report, result, log, interestMode, flagMode});
        assert.equal(await publicHash(), before, "Each isolated capture bundle preserves build/app.js");
        assert.equal(digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), nativeHostSha256, "All lanes use the same actual compiled native host");
      }
    }
    await writeFile(path.join(root, "build/pointer-capture-notifications-comparison.json"), JSON.stringify({scenario: "native-pointer-capture-notifications",
      interests, flagModes: modes, nativeHostSha256, reports,
      scope: {actualNativeInput: true, sameNativeHostAcrossLanes: true, publicDefaultEnabled: false, hardwareCertified: false}}, null, 2) + "\n");
    for (const result of results) { verify(result); }
    // The same Godot input yields the same native sequence in every lane, and
    // the interest mode never changes a capture notification's delivery.
    const key = (stage, tag) => Object.keys(stage.tags).find(name => stage.tags[name] === tag) ?? null;
    const trace = report => Object.fromEntries(Object.keys(cases).map(id => [id,
      report.stages[id].react.raw.map(row => [row.type, key(report.stages[id], row.target)])]));
    const delivery = report => Object.fromEntries(Object.keys(cases).map(id => [id, report.stages[id].react.events.map(row => [row.label, row.kind, row.phase])]));
    const ids = Object.keys(reports), reference = trace(reports[ids[0]]);
    for (const id of ids) { assert.deepEqual(trace(reports[id]), reference, id); }
    if (interests.length === 2) {
      for (const mode of modes) {
        const original = reports["original-" + mode], current = reports["current-" + mode];
        assert.deepEqual(delivery(current), delivery(original), mode);
        assert.deepEqual(original.provenance.bundles.sources, current.provenance.bundles.sources);
        assert.deepEqual(original.provenance.bundles.originalReactNativeSources, current.provenance.bundles.originalReactNativeSources);
      }
    }
  });
}
