import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundlePointerClickProbe} from "../scripts/event-target-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const flagModes = ["disabled", "imperative-only", "internal-only", "enabled"];
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const requestedInterest = process.argv.find(value => value.startsWith("--interest="))?.slice(11);
const requestedFlag = process.argv.find(value => value.startsWith("--flag="))?.slice(7);
assert.ok(requestedInterest == null || ["original", "current"].includes(requestedInterest));
assert.ok(requestedFlag == null || flagModes.includes(requestedFlag));
// The preceding host runs once, in the lane with every listener kind.
const interests = allowOriginalNegative ? ["current"] : requestedInterest == null ? ["original", "current"] : [requestedInterest];
const modes = allowOriginalNegative ? ["enabled"] : requestedFlag == null ? flagModes : [requestedFlag];
const digest = value => createHash("sha256").update(value).digest("hex");
const flags = mode => ({imperative: ["imperative-only", "enabled"].includes(mode), nativeDispatch: ["internal-only", "enabled"].includes(mode)});
const nativeProducers = ["native/application_runtime.cpp", "native/pointer_adapter.cpp", "native/pointer_adapter.h",
  "native/pointer_event.h", "native/scroll_adapter.cpp", "native/scroll_adapter.h", "scripts/rn-pointer-overlay.mjs"];
async function optionalFile(file) { try { return await readFile(path.join(root, file)); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
async function publicHash() { const bytes = await optionalFile("build/app.js"); return bytes == null ? null : digest(bytes); }

// An independent statement of the scene and of RN's click: the deepest view on
// both the Down and Up hit paths (Android), primary pointer and main button
// only (iOS, W3C), never a shared root; a scroll drag cancels its contact.
const point = {L1: [45, 40], L2: [115, 40], G: [80, 70], S: [185, 45], X: [260, 45], P: [40, 110], I0: [145, 110]};
const origin = {L1: [20, 20], L2: [90, 20], G: [10, 10], S: [160, 10], C: [0, 0], W: [0, 0], X: [230, 10], P: [10, 90], I0: [80, 90]};
const parent = {L1: "G", L2: "G", G: "C", S: "C", P: "C", I0: "CT", CT: "SV", SV: "C", C: "W", X: "W", W: null};
const withJSX = new Set(["L1", "L2", "G", "S", "X", "C", "I0"]);
const click = (target, release, pointer = "mouse") => ({target, release, pointer});
const none = (pointer = "mouse") => ({target: null, pointer});
const cases = {
  "mouse/same": click("L1", "L1"), "mouse/siblings": click("G", "L2"), "mouse/leaf-to-group": click("G", "G"),
  "mouse/group-to-leaf": click("G", "L1"), "mouse/cousin": click("C", "S"), "mouse/top-level": click("W", "X"),
  "mouse/root-empty": none(), "mouse/outside": none(), "mouse/empty-down": none(), "mouse/right": none(), "mouse/middle": none(),
  "mouse/chord-left-last": click("L1", "L1"), "mouse/chord-right-last": none(), "mouse/cancel": none(),
  "touch/same": click("L1", "L1", "touch"), "touch/drag": click("G", "L2", "touch"), "touch/secondary": click("L1", "L1", "touch"),
  "touch/cancel": none("touch"), "touch/pressable": {...click("P", "P", "touch"), presses: 1}, "touch/scroll-tap": click("I0", "I0", "touch"),
  "touch/scroll-takeover": {...none("touch"), takeover: 55}, "mouse/scroll-takeover": {...none(), takeover: 0},
  "mouse/after-scroll": click("L1", "L1"), "mouse/cross-root": none(), "B/mouse/same": {...click("L1", "L1"), panel: "B"},
  "mouse/removed": none(),
};

function lineage(target) {
  const path = [];
  for (let node = target; node != null; node = parent[node]) path.push(node);
  return path;
}
// Document listeners need D, documentElement and View listeners I and D. A
// node's JSX prop runs before its added listeners; capture top-down at phase 1,
// the target at 2, bubbling at 3. A compiled legacy JSX handler has no phase.
function callbacks(target, I, D) {
  const path = lineage(target), at = (node, capture) => !D ? null : node === target ? 2 : capture ? 1 : 3;
  return [...(D ? [["DocC", 1, "Doc"]] : []), ...(I && D ? [["RootC", 1, "Root"]] : []),
    ...(path.includes("C") ? [["C-capture", at("C", true), "C"]] : []),
    ...path.flatMap(node => [...(withJSX.has(node) ? [[node, at(node, false), node]] : []),
      ...(node === "G" && I && D ? [["GB", at("G", false), "G"]] : [])]),
    ...(I && D ? [["RootB", 3, "Root"], ["DocB", 3, "Doc"]] : D ? [["DocB", 3, "Doc"]] : [])];
}
const node = (host, testID) => host.nodes.find(entry => entry.testID === testID);
function tagMap(stage, name) {
  const fixture = stage.react.panels[name].tags;
  return {...fixture, W: node(stage.after, "").tag, CT: node(stage.after, name + "-scroll-content").tag};
}
const typed = (react, type) => react.raw.filter(row => row.channel === "typed" && row.type === type);

function verifyCase(id, stage, I, D) {
  const spec = cases[id], name = spec.panel ?? "A", react = stage.react, tags = tagMap(stage, name);
  const clicks = react.raw.filter(row => row.type === "topClick");
  if (spec.target == null) assert.deepEqual(clicks, [], id);
  else {
    assert.deepEqual(clicks.map(row => [row.channel, row.target]), [["typed", tags[spec.target]], ["star", tags[spec.target]]], id);
    const [row] = clicks, up = typed(react, "topPointerUp").filter(entry => entry.pointerId === row.pointerId && entry.sequence < row.sequence).at(-1);
    const end = typed(react, "topTouchEnd").find(entry => entry.sequence > up.sequence);
    assert.equal(clicks[1].payloadId, row.payloadId);
    assert.ok(up != null && end != null && row.sequence < end.sequence, id);
    const [x, y] = point[spec.release], [ox, oy] = origin[spec.target];
    assert.deepEqual([row.pointerType, row.button, row.buttons, row.isPrimary, row.clientX, row.clientY, row.offsetX, row.offsetY, row.timeStamp],
      [spec.pointer, 0, 0, true, x, y, x - ox, y - oy, up.timeStamp], id);
    assert.deepEqual([up.clientX, up.clientY, up.pointerType], [x, y, spec.pointer], id);
  }
  const expected = spec.target == null ? [] : callbacks(spec.target, I, D).map(([label, phase, current]) =>
    [name, label, phase, tags[spec.target], current === "Doc" || current === "Root" ? current : tags[current]]);
  assert.deepEqual(react.events.map(row => [row.name, row.label, row.phase, row.targetTag,
    row.currentIsDocument ? "Doc" : row.currentIsElement ? "Root" : row.currentTag]), expected, id);
  assert.ok(react.events.every(row => row.type === (D ? "click" : null) && row.trusted === D && row.originalEvent === D &&
    row.compiledLegacySynthetic === !D && row.ownPointerType && row.payloadId === clicks[0]?.payloadId &&
    row.currentPriority === react.discretePriority), id);
  assert.ok(react.globalEventRestored && react.currentPriority === react.defaultPriority, id);
  if (spec.presses != null) {
    assert.equal(react.presses.length, spec.presses, id);
    assert.ok(react.presses.every(sequence => sequence > clicks[0].sequence), "Press follows the ignored pointer click");
  }
  if (spec.takeover != null) {
    const [cancel, ...extra] = typed(react, "topPointerCancel");
    assert.ok(cancel != null && extra.length === 0, id);
    const after = type => typed(react, type).filter(row => row.sequence > cancel.sequence);
    assert.equal(typed(react, "topPointerDown").length, 1, id); assert.deepEqual(typed(react, "topPointerUp"), [], id);
    assert.deepEqual(after("topPointerMove").filter(row => row.pointerId === cancel.pointerId), [], id);
    assert.ok(after("topTouchMove").length > 0 && after("topTouchEnd").length === 1, id);
    assert.deepEqual([cancel.pointerType, cancel.buttons], [spec.pointer, 0], id);
    assert.ok(react.scrollBegins.length === 1 && react.scrollBegins[0] < cancel.sequence, id);
    const before = node(stage.before, name + "-scroll").scroll, scrolled = node(stage.after, name + "-scroll").scroll;
    assert.deepEqual([scrolled.y, scrolled.begins, scrolled.ends, scrolled.dragging], [spec.takeover, before.begins + 1, before.ends + 1, false], id);
    assert.equal(stage.after.pointer.pointerTakeovers, stage.before.pointer.pointerTakeovers + 1, id);
  } else assert.equal(typed(react, "topPointerCancel").length, id.endsWith("/cancel") ? 1 : 0, id);
  assert.deepEqual([stage.after.pointer.activeTouches, stage.after.pointer.takenPointers, stage.application.pointerProcessor.active,
    stage.application.pointerRouting.active], [0, 0, 0, 0], id);
}

function verify({report, result, log, interestMode, flagMode}) {
  assert.equal(result.error, undefined, log); assert.equal(result.signal, null, log); assert.equal(result.status, 0, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.equal(report.scenario, "native-pointer-click"); assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.flagMode, flagMode); assert.equal(report.interestMode, interestMode); assert.equal(report.displayServer, "headless");
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual([...checkErrors].sort(), [...report.failures].sort());
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length, "No native diagnostic, script or engine error is hidden");
  if (allowOriginalNegative) {
    // The preceding host never synthesizes click or takes a scroll over. The
    // flag never accepts other failures or hides these normative ones.
    assert.ok(report.originalNegativeObserved && !report.allAssertionsPassed);
    assert.deepEqual([...report.failures].sort(), [...report.expectedOriginalFailures].sort());
    const clicked = Object.entries(cases).filter(([, spec]) => spec.target != null).map(([id]) => id);
    assert.deepEqual([...report.expectedOriginalFailures].sort(), [
      ...clicked.flatMap(id => [`${id}/The release synthesizes exactly the expected click from its own sample`,
        `${id}/Click callbacks follow RN's propagation for this lane`]),
      "touch/scroll-takeover/A native scroll drag takes the contact over: one cancel, then only touches",
      "mouse/scroll-takeover/A native scroll drag takes the contact over: one cancel, then only touches",
      "native/Each root's adapter counts exactly its synthesized clicks and takeovers"].sort());
    assert.match(log, new RegExp(`POINTER_CLICK_ORIGINAL_NEGATIVE: ${report.expectedOriginalFailures.length}`));
    return;
  }
  assert.ok(report.allAssertionsPassed); assert.deepEqual(report.failures, []);
  assert.ok(report.checks.length > 0 && report.checks.every(row => row.passed));
  assert.match(log, /POINTER_CLICK_PASSED: \d+/);
  const {imperative: I, nativeDispatch: D} = flags(flagMode), installed = interestMode === "current" && D;
  const methods = available => Array(3).fill(available ? "function" : "undefined");
  for (const name of ["A", "B"]) {
    const capability = report.stages["capability" + name];
    assert.deepEqual(capability.flags, flags(flagMode)); assert.equal(capability.mode, flagMode); assert.equal(capability.interestMode, interestMode);
    assert.deepEqual(capability.methods, {doc: methods(D), element: methods(I && D), view: methods(I && D)});
    assert.deepEqual(capability.installed, ["DocC", "RootC", "GB", "RootB", "DocB"].filter(label => D && (label.startsWith("Doc") || I)));
    assert.equal(capability.query.installations, installed ? 1 : 0);
  }
  for (const id of Object.keys(cases)) verifyCase(id, report.stages[id], I, D);
  // RN dispatches each synthesized click without consulting a listener Map.
  for (const [id, stage] of Object.entries(report.stages))
    if (stage?.react?.query) assert.ok(stage.react.query.rows.every(row => row.offset !== 30 && row.offset !== 31), id);
  assert.deepEqual(report.stages.clickLookups, []);
  const clicksOf = name => Object.values(cases).filter(spec => spec.target != null && (spec.panel ?? "A") === name).length;
  assert.deepEqual([report.stages.counters.A.pointerClicks, report.stages.counters.B.pointerClicks,
    report.stages.counters.A.pointerTakeovers, report.stages.counters.B.pointerTakeovers], [clicksOf("A"), clicksOf("B"), 2, 0]);
  assert.deepEqual(report.afterStop.errors, []);
  assert.ok(report.afterStop.stopped && !report.afterStop.pointerListenerQueryInstalled && report.afterStop.rootCount === 0);
  assert.deepEqual(report.afterStop.pointerProcessor, {active: 0, pendingCapture: 0, activeCapture: 0, hover: 0});
}

test("a primary release clicks the deepest view both hit paths share, and a scroll takeover cancels its contact", async () => {
  const before = await publicHash(), binary = await ensureGodotBinary(), results = [], reports = {};
  const nativeHostSha256 = digest(await readFile(path.join(root, "addons/fabric_godot.dylib")));
  const lane = allowOriginalNegative ? "original" : null;
  // Keep every actual report before asserting a lane.
  for (const interestMode of interests) {
    const bundles = await bundlePointerClickProbe({interestMode});
    for (const flagMode of modes) {
      await rm(path.join(root, "build/pointer-click-report.json"), {force: true});
      const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/pointer-click-probe.gd", "--",
        "--interest=" + interestMode, "--flag=" + flagMode, ...(allowOriginalNegative ? ["--allow-original-negative"] : [])],
      {encoding: "utf8", timeout: 300000, maxBuffer: 16 * 1024 * 1024});
      const log = (result.stdout ?? "") + (result.stderr ?? ""), id = lane ?? interestMode + "-" + flagMode;
      await writeFile(path.join(root, "build/pointer-click-" + id + ".log"), log);
      const bytes = await optionalFile("build/pointer-click-report.json"), report = bytes == null ? null : JSON.parse(bytes);
      if (report != null) {
        report.provenance = {node: process.version, bundles, publicBundleSha256: before, nativeHostSha256, sourceReceiptDoesNotCertifyNativeBuild: true};
        await writeFile(path.join(root, "build/pointer-click-" + id + "-report.json"), JSON.stringify(report, null, 2) + "\n"); reports[id] = report;
      }
      results.push({report, result, log, interestMode, flagMode});
      assert.equal(await publicHash(), before, "Each isolated click bundle preserves build/app.js");
      assert.equal(digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), nativeHostSha256, "All lanes use the same actual compiled native host");
    }
  }
  if (!allowOriginalNegative)
    await writeFile(path.join(root, "build/pointer-click-comparison.json"), JSON.stringify({scenario: "native-pointer-click", interests, flagModes: modes,
      nativeHostSha256, reports, scope: {actualNativeInput: true, sameNativeHostAcrossLanes: true, publicDefaultEnabled: false, hardwareCertified: false}}, null, 2) + "\n");
  for (const result of results) verify(result);
  if (allowOriginalNegative) return;
  // The interest mode never changes a click: same callbacks in every case.
  if (interests.length === 2)
    for (const mode of modes) {
      const original = reports["original-" + mode], current = reports["current-" + mode];
      for (const id of Object.keys(cases))
        assert.deepEqual(current.stages[id].react.events.map(row => [row.label, row.phase]),
          original.stages[id].react.events.map(row => [row.label, row.phase]), id);
      assert.deepEqual(original.provenance.bundles.sources, current.provenance.bundles.sources);
      assert.deepEqual(original.provenance.bundles.originalReactNativeSources, current.provenance.bundles.originalReactNativeSources);
    }
  const originalBytes = await optionalFile("build/pointer-click-original-report.json"), original = originalBytes == null ? null : JSON.parse(originalBytes);
  const current = reports["current-enabled"];
  if (original != null && current != null) {
    assert.ok(original.originalNegativeObserved);
    assert.deepEqual(original.checks.map(row => row.name), current.checks.map(row => row.name));
    assert.equal(original.provenance.bundles.bundles.enabled.sha256, current.provenance.bundles.bundles.enabled.sha256);
    assert.deepEqual(original.provenance.bundles.originalReactNativeSources, current.provenance.bundles.originalReactNativeSources);
    // The same SDK bundle runs on both hosts; only compiled native producers differ.
    for (const [file, sha] of Object.entries(current.provenance.bundles.sources))
      if (!nativeProducers.includes(file)) assert.equal(original.provenance.bundles.sources[file], sha, "Old/new hosts share the reproducer and SDK: " + file);
    assert.notEqual(original.provenance.nativeHostSha256, current.provenance.nativeHostSha256);
  }
  if (current != null)
    await writeFile(path.join(root, "build/pointer-click-old-host-comparison.json"), JSON.stringify({scenario: "native-pointer-click",
      originalControlPresent: original != null, sameSDKBundleRequired: true, intentionalNativeProducerDifferences: nativeProducers,
      original, current}, null, 2) + "\n");
});
