import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundlePointerDocumentMoveProbe} from "../scripts/event-target-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {decodeNativePng} from "./native-png.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const capture = process.argv.includes("--capture");
const flagModes = ["disabled", "imperative-only", "internal-only", "enabled"];
const requestedInterest = process.argv.find(value => value.startsWith("--interest="))?.slice(11);
const requestedFlag = process.argv.find(value => value.startsWith("--flag="))?.slice(7);
assert.ok(requestedInterest == null || ["original", "current"].includes(requestedInterest));
assert.ok(requestedFlag == null || flagModes.includes(requestedFlag));
assert.ok(!capture || requestedInterest === "current" && requestedFlag === "enabled", "Capture selects only current/enabled; other lanes remain headless controls");
const interests = requestedInterest == null ? ["original", "current"] : [requestedInterest];
const modes = requestedFlag == null ? flagModes : [requestedFlag];
const digest = value => createHash("sha256").update(value).digest("hex");
const flags = mode => ({imperative: ["imperative-only", "enabled"].includes(mode), nativeDispatch: ["internal-only", "enabled"].includes(mode)});
const methods = available => Array(3).fill(available ? "function" : "undefined");
async function optionalFile(file) { try { return await readFile(path.join(root, file)); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
async function publicHash() { const bytes = await optionalFile("build/app.js"); return bytes == null ? null : digest(bytes); }
const pointerRows = value => value.events.filter(row => !["TouchMove", "TouchEnd", "TouchCancel"].includes(row.label));
const rawRows = (value, type) => value.raw.filter(row => row.type === type);
// Moves are unique Continuous events: Default under the pinned priority mapping.
const movePriority = value => value.priorityMappingFixed ? value.continuousPriority : value.defaultPriority;
function clean(value, D) {
  const moves = pointerRows(value), hasTouch = value.events.some(row => row.label === "TouchMove");
  assert.deepEqual(value.moveEventIdentity, {callbackCount: moves.length, distinctObjects: moves.length > 0 ? 1 : 0,
    touchMoveDistinct: moves.length > 0 && hasTouch ? D : null});
  assert.ok(value.globalEventRestored && value.currentPriority === value.defaultPriority);
  assert.equal(value.cleanup.length, value.events.length);
  assert.ok(value.cleanup.every(row => row.currentTargetNull && (!D || row.originalEvent && row.phase === 0 && row.pathEmpty)));
}
function raw(value, type, callbacks) {
  const rows = rawRows(value, type);
  assert.ok(callbacks.length > 0);
  assert.deepEqual(rows.map(row => row.channel), ["typed", "star"]);
  assert.equal(rows[0].payloadId, rows[1].payloadId);
  assert.ok(callbacks.every(row => row.payloadId === rows[0].payloadId && row.nativeTarget === rows[0].target &&
    row.timeStamp === row.nativeTimeStamp && row.timeStamp === rows[0].timeStamp && row.sequence > rows[1].sequence));
}
// Root rows carry the actual offsets/results; owning-surface View ancestors
// read healthy false pairs first, starting at the physical target for Up/Move.
function query(value, name, installed, offsets, results, nativeNodes) {
  if (!installed) { assert.deepEqual(value.query.rows, []); return; }
  const roots = value.query.rows.filter(row => row.isRootHandle);
  assert.ok(roots.length > 0, "A negative root query cannot pass through empty membership");
  assert.deepEqual(roots.map(row => row.name), offsets.map(() => name));
  assert.deepEqual(roots.map(row => row.offset), offsets);
  assert.deepEqual(roots.map(row => row.result), results);
  const category = offsets[0] === 34 ? [34, 35] : offsets[0] === 36 ? [36, 37] : [1, 25];
  const components = value.query.rows.filter(row => !row.isRootHandle);
  const ownerTags = new Set(nativeNodes.map(node => node.tag));
  assert.ok(roots.every(row => row.candidateTag === value.panels[name].surfaceId));
  assert.ok(components.every(row => ownerTags.has(row.candidateTag)));
  if (category[0] !== 34) {
    assert.ok(components.length >= 2, "Real Up/Move checks the materialized physical target before its root");
    assert.equal(components[0].candidateTag, value.targetTag);
  }
  assert.equal(components.length % 2, 0);
  for (let index = 0; index < components.length; index += 2) {
    const [bubble, captured] = components.slice(index, index + 2);
    assert.deepEqual([bubble.offset, captured.offset], category);
    assert.ok(Number.isSafeInteger(bubble.candidateTag) && bubble.candidateTag > 0);
    assert.equal(bubble.candidateTag, captured.candidateTag);
    assert.equal(bubble.name, null); assert.equal(captured.name, null);
    assert.ok(bubble.sequence < captured.sequence && captured.sequence < roots[0].sequence);
    assert.equal(bubble.result, false); assert.equal(captured.result, false);
  }
  assert.ok(value.query.rows.every(row => row.action === "delegate" && !row.matched && row.resultKind === "boolean" && category.includes(row.offset)));
  assert.ok(roots.every(row => row.expectedHandle && row.before.handleExists && row.after.handleExists && row.before.canonicalPresent && row.after.canonicalPresent &&
    row.before.publicInstanceNull === row.after.publicInstanceNull && row.before.refAssigned === row.after.refAssigned));
  if (roots.length > 1) assert.ok(roots[0].sequence < roots[1].sequence);
}
function down(stage, name, D, installed, remaining = 0) {
  const value = stage.react;
  assert.deepEqual(value.events, []); assert.deepEqual(value.raw, []);
  assert.equal(value.panels[name].count, value.baselineCount); assert.equal(stage.after.commits, stage.before.commits);
  query(value, name, installed, [34, 35], [false, false], stage.after.nodes);
  assert.equal(stage.after.pointer.activePointers, 1); assert.equal(stage.after.pointer.activeTouches, 1);
  assert.equal(stage.application.pointerProcessor.active, remaining + 1); assert.equal(stage.application.pointerRouting.contacts, remaining + 1);
  clean(value, D);
}
function move(stage, expected, phases, name, D, installed, offsets, results, {legacy = false, sentinel = false} = {}) {
  const value = stage.react, pointers = pointerRows(value), touch = value.events.filter(row => row.label === "TouchMove");
  assert.deepEqual(value.events.map(row => row.label), [...expected, "TouchMove"]);
  assert.deepEqual(pointers.map(row => row.phase), phases);
  assert.ok(pointers.every(row => (legacy || row.type === "pointermove") && row.pointerId > 0 && row.pointerType === "touch" && row.buttons === 1 &&
    row.name === name && row.targetMatches && row.currentMatches && row.nativeTarget === value.targetTag && row.currentPriority === movePriority(value)));
  if (pointers.length === 0) assert.deepEqual(rawRows(value, "topPointerMove"), []);
  else {
    raw(value, "topPointerMove", pointers);
    assert.ok(rawRows(value, "topPointerMove").every(row => row.pointerId === pointers[0].pointerId && row.buttons === 1 && row.pointerType === "touch"));
    if (legacy) assert.ok(pointers.length === 1 && pointers[0].compiledLegacySynthetic && !pointers[0].originalEvent);
    else assert.ok(pointers.every(row => row.trusted && row.originalEvent && row.originalSynthetic && row.targetOriginalElement && row.ownerDocumentMatches && row.thisMatches && row.globalEventMatches));
  }
  assert.equal(touch.length, 1); raw(value, "topTouchMove", touch);
  assert.ok(touch[0].name === name && touch[0].targetMatches && touch[0].currentMatches && touch[0].currentPriority === movePriority(value));
  if (D) assert.ok(touch[0].trusted && touch[0].originalEvent && touch[0].originalSynthetic && touch[0].thisMatches && touch[0].globalEventMatches && touch[0].targetOriginalElement && touch[0].ownerDocumentMatches);
  else assert.ok(touch[0].compiledLegacySynthetic && !touch[0].originalEvent);
  if (pointers.length > 0) assert.ok(touch[0].sequence > pointers.at(-1).sequence);
  assert.equal(value.raw.length, expected.length === 0 ? 2 : 4);
  assert.deepEqual(rawRows(value, "topPointerDown"), []); assert.deepEqual(rawRows(value, "topPointerUp"), []);
  assert.equal(value.panels[name].count, value.baselineCount + expected.length);
  assert.equal(stage.after.commits, stage.before.commits + (expected.length > 0 ? 1 : 0));
  assert.equal(stage.after.pointer.pointerMoves, stage.before.pointer.pointerMoves + 1);
  assert.equal(stage.after.pointer.moves, stage.before.pointer.moves + 1);
  assert.equal(stage.after.pointer.activePointers, 1); assert.equal(stage.after.pointer.activeTouches, 1);
  if (sentinel) assert.deepEqual(value.query.rows, []);
  else query(value, name, installed, offsets, results, stage.after.nodes);
  clean(value, D);
}
// Release has no Up listener: an installed SDK reads only false Up pairs.
function release(stage, name, D, installed, remaining = 0) {
  const value = stage.react, rows = value.query.rows;
  assert.deepEqual(value.events, []); assert.deepEqual(value.raw, []);
  assert.equal(value.panels[name].count, value.baselineCount); assert.equal(stage.after.commits, stage.before.commits);
  assert.equal(rows.length > 0, installed);
  assert.equal(rows.length % 2, 0);
  for (let index = 0; index < rows.length; index += 2) {
    assert.deepEqual(rows.slice(index, index + 2).map(row => row.offset), [36, 37]);
    assert.equal(rows[index].candidateTag, rows[index + 1].candidateTag);
  }
  assert.ok(rows.every(row => row.action === "delegate" && !row.matched && row.resultKind === "boolean" && row.result === false));
  assert.equal(stage.after.pointer.pointerUps, stage.before.pointer.pointerUps + 1);
  assert.equal(stage.after.pointer.ends, stage.before.pointer.ends + 1);
  assert.equal(stage.after.pointer.activePointers, 0); assert.equal(stage.after.pointer.activeTouches, 0);
  assert.deepEqual(stage.application.pointerProcessor, {active: remaining, pendingCapture: 0, activeCapture: 0, hover: remaining});
  for (const key of ["active", "contacts", "stored"]) assert.equal(stage.application.pointerRouting[key], remaining);
  clean(value, D);
}
function manual(stage, expected, supported, D) {
  const value = stage.react;
  assert.equal(stage.result.available, supported); assert.ok(stage.result.noPrototypeBorrow);
  assert.deepEqual(value.events.map(row => row.label), expected);
  if (supported) assert.ok(stage.result.returned && !stage.result.trusted && stage.result.targetMatches && stage.result.cleaned);
  assert.ok(value.events.every(row => row.type === "pointermove" && !row.trusted && row.phase === 2 &&
    row.targetMatches && row.currentMatches && row.thisMatches && row.originalEvent && !row.originalSynthetic));
  assert.deepEqual(value.raw, []); assert.deepEqual(value.query.rows, []);
  assert.equal(value.panels.A.count, value.baselineCount); clean(value, D);
}

function verify({report, result, log, interestMode, flagMode, headed}) {
  assert.equal(result.error, undefined, log); assert.equal(result.signal, null, log); assert.equal(result.status, 0, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use|Inconsistency between local and platform pointer registries/);
  assert.equal(report.scenario, "native-pointer-document-move-four-flags"); assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.flagMode, flagMode); assert.equal(report.interestMode, interestMode);
  assert.equal(report.displayServer, headed ? "macOS" : "headless"); assert.equal(report.captureRequested, headed);
  assert.ok(report.allAssertionsPassed); assert.deepEqual(report.failures, []);
  assert.ok(report.checks.length > 0 && report.checks.every(row => row.passed));
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, 0, "The healthy Move matrix prints no native or script error");
  assert.match(log, /POINTER_DOCUMENT_MOVE_PASSED: \d+/);
  assert.ok(report.scope.actualNativeInput && report.scope.realOriginalDocuments && report.scope.experimentalNativeDispatch && report.scope.mouseHoverMoveCertified);
  for (const key of ["listenerRegistryMirrored", "publicDefaultEnabled", "hardwareCertified", "moveQueryFaultsCertified", "explicitCaptureCertified"]) assert.equal(report.scope[key], false);
  const {imperative: I, nativeDispatch: D} = flags(flagMode), installed = interestMode === "current" && D;
  for (const name of ["A", "B"]) {
    const capability = report.stages["capability" + name];
    assert.deepEqual(capability.flags, flags(flagMode)); assert.equal(capability.mode, flagMode); assert.equal(capability.interestMode, interestMode);
    for (const key of ["originalDoc", "originalElement", "docOwnsElement", "docConnected", "elementConnected", "originalRootGetterIdentity", "distinctOtherRoot"]) assert.equal(capability[key], true);
    assert.deepEqual(capability.methods.doc, methods(D)); assert.deepEqual(capability.methods.element, methods(I && D));
    assert.equal(capability.docEventTarget, D); assert.equal(capability.rootEventTarget, D);
    assert.equal(capability.query.installations, installed ? 1 : 0);
    if (installed) assert.ok(capability.query.restoredInstaller);
  }
  const stages = report.stages;
  for (const kind of ["doc", "all", "element", "doc-capture-only", "element-capture-only"]) {
    const prefix = "case/" + kind, supported = D && (!kind.startsWith("element") || I), delivered = installed && supported;
    const registered = !supported ? [] : kind === "all" ? (I ? ["DocC", "RootC", "RootB", "DocB"] : ["DocC", "DocB"]) : kind === "element" ? ["RootC", "RootB"] : kind === "doc-capture-only" ? ["DocC"] : kind === "element-capture-only" ? ["RootC"] : ["DocC", "DocB"];
    const expected = delivered ? registered : [];
    const configuration = stages[prefix + "/configuration"];
    assert.equal(configuration.eventType, "pointermove"); assert.ok(configuration.noPrototypeBorrow); assert.deepEqual(configuration.installed, registered);
    const manualExpected = !supported ? [] : kind === "element" ? ["RootC", "RootB"] : kind === "element-capture-only" ? ["RootC"] : kind === "doc-capture-only" ? ["DocC"] : ["DocC", "DocB"];
    manual(stages[prefix + "/manual"], manualExpected, supported, D);
    down(stages[prefix + "/down"], "A", D, installed);
    const phases = expected.map(label => label.endsWith("C") ? 1 : 3);
    const captureOnly = kind.endsWith("capture-only");
    const offsets = captureOnly || !delivered ? [1, 25] : [1], results = offsets.length === 2 ? [false, delivered] : [true];
    for (const sample of [1, 2]) move(stages[`${prefix}/move-${sample}`], expected, phases, "A", D, installed, offsets, results);
    release(stages[prefix + "/up"], "A", D, installed);
  }
  const docExpected = installed ? ["DocC", "DocB"] : [], docOffsets = installed ? [1] : [1, 25], docResults = installed ? [true] : [false, false];
  assert.deepEqual(stages["isolation/B-configuration"].installed, D ? ["DocC", "DocB"] : []);
  down(stages["isolation/B-held/down"], "B", D, installed);
  down(stages["isolation/A-negative/down"], "A", D, installed, 1);
  move(stages["isolation/A-negative/move"], [], [], "A", D, installed, [1, 25], [false, false]);
  const unchanged = stages["isolation/B-unchanged"];
  assert.deepEqual(unchanged.before.pointer, unchanged.after.pointer); assert.equal(unchanged.before.commits, unchanged.after.commits);
  assert.equal(unchanged.beforeCount, unchanged.afterCount);
  release(stages["isolation/A-negative/up"], "A", D, installed, 1);
  move(stages["isolation/B-positive/move"], docExpected, installed ? [1, 3] : [], "B", D, installed, docOffsets, docResults);
  release(stages["isolation/B-positive/up"], "B", D, installed);
  down(stages["removal/down"], "A", D, installed);
  move(stages["removal/positive/move"], docExpected, installed ? [1, 3] : [], "A", D, installed, docOffsets, docResults);
  assert.equal(stages["removal/removed"], true);
  move(stages["removal/negative/move"], [], [], "A", D, installed, [1, 25], [false, false]);
  release(stages["removal/up"], "A", D, installed);
  const cancel = stages["cancel/terminal"];
  assert.deepEqual(cancel.react.events, []); assert.deepEqual(cancel.react.raw, []); assert.deepEqual(cancel.react.query.rows, []);
  assert.equal(cancel.react.panels.A.count, cancel.react.baselineCount); assert.equal(cancel.after.commits, cancel.before.commits);
  assert.equal(cancel.after.pointer.pointerCancels, cancel.before.pointer.pointerCancels + 1); clean(cancel.react, D);
  // The JSX sentinel qualifies through its own props in every lane.
  move(stages["sentinel/move"], ["JSX"], [D ? 2 : null], "A", D, installed, [], [], {legacy: !D, sentinel: true});
  release(stages["sentinel/up"], "A", D, installed);
  const mouse = stages["mouse/hover"], hover = mouse.react, hoverMoves = pointerRows(hover);
  assert.deepEqual(hover.events.map(row => row.label), docExpected);
  assert.deepEqual(hoverMoves.map(row => row.phase), installed ? [1, 3] : []);
  assert.equal(mouse.before.pointer.activePointers, 0, "No contact holds a ContinuousStart before the mouse sample");
  assert.notEqual(hover.defaultPriority, hover.discretePriority);
  if (installed) {
    raw(hover, "topPointerMove", hoverMoves);
    assert.ok(hoverMoves.every(row => row.trusted && row.originalEvent && row.pointerType === "mouse" && row.buttons === 0 &&
      row.offsetX === mouse.point[0] && row.offsetY === mouse.point[1] && row.currentPriority === movePriority(hover)));
  }
  assert.deepEqual(rawRows(hover, "topTouchMove"), []);
  assert.equal(hover.panels.A.count, hover.baselineCount + docExpected.length);
  assert.equal(mouse.after.commits, mouse.before.commits + (installed ? 1 : 0));
  assert.equal(mouse.after.pointer.pointerMoves, mouse.before.pointer.pointerMoves + 1); assert.equal(mouse.after.pointer.activePointers, 0);
  query(hover, "A", installed, docOffsets, docResults, mouse.after.nodes); clean(hover, D);
  assert.deepEqual(report.afterStop.errors, []);
  assert.ok(report.afterStop.stopped && !report.afterStop.pointerListenerQueryInstalled && report.afterStop.rootCount === 0);
  assert.deepEqual(report.afterStop.pointerProcessor, {active: 0, pendingCapture: 0, activeCapture: 0, hover: 0});
  for (const name of ["A", "B"]) {
    const owner = stages["stoppedRoot" + name];
    assert.equal(owner.nativeTags, 0); assert.equal(owner.creates, owner.deletes);
  }
  // Two samples per positive case; Document callbacks count once each.
  assert.equal(report.captures.length, headed ? 2 : 0);
  for (const [index, frame] of report.captures.entries()) {
    const counts = index === 0 ? [0, 0] : [4, 0];
    assert.deepEqual([frame.reactCounters.A.count, frame.reactCounters.B.count], counts);
    assert.deepEqual(frame.pixels.map(row => row.point), [0, 400].flatMap((origin, side) => [[5, 5], [75, 55], [260, 55], [25, 175],
      [39 + 4 * counts[side], 175], [40 + 4 * counts[side], 175]].map(([x, y]) => [origin + x, y])));
  }
}

test("original Document and documentElement pointermove interest obey four immutable flags with native isolation and cleanup", async () => {
  const before = await publicHash(), binary = await ensureGodotBinary(), results = [], reports = {};
  const nativeHostSha256 = digest(await readFile(path.join(root, "addons/fabric_godot.dylib")));
  // Keep every actual report before asserting a lane.
  for (const interestMode of interests) {
    const bundles = await bundlePointerDocumentMoveProbe({interestMode});
    for (const flagMode of modes) {
      await rm(path.join(root, "build/pointer-document-move-report.json"), {force: true});
      const headed = capture && interestMode === "current" && flagMode === "enabled";
      const result = spawnSync(binary, ["--path", root, ...(headed ? [] : ["--headless"]), "--script", "res://tests/pointer-document-move-probe.gd", "--",
        "--interest=" + interestMode, "--flag=" + flagMode, ...(headed ? ["--capture"] : [])], {encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024});
      const log = (result.stdout ?? "") + (result.stderr ?? ""), id = interestMode + "-" + flagMode;
      await writeFile(path.join(root, "build/pointer-document-move-" + id + ".log"), log);
      const bytes = await optionalFile("build/pointer-document-move-report.json"), report = bytes == null ? null : JSON.parse(bytes);
      if (report != null) {
        report.provenance = {node: process.version, bundles, publicBundleSha256: before, nativeHostSha256, sourceReceiptDoesNotCertifyNativeBuild: true};
        await writeFile(path.join(root, "build/pointer-document-move-" + id + "-report.json"), JSON.stringify(report, null, 2) + "\n"); reports[id] = report;
      }
      results.push({report, result, log, interestMode, flagMode, headed});
      assert.equal(await publicHash(), before, "Each isolated Move bundle preserves build/app.js");
      assert.equal(digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), nativeHostSha256, "All lanes use the same actual compiled native host");
    }
  }
  await writeFile(path.join(root, "build/pointer-document-move-comparison.json"), JSON.stringify({scenario: "native-pointer-document-move-four-flags", interests, flagModes: modes, nativeHostSha256, reports,
    scope: {actualNativeInput: true, sameNativeHostAcrossControls: true, fourIndependentHermesFlagConfigurations: modes.length === 4, publicDefaultEnabled: false, hardwareCertified: false}}, null, 2) + "\n");
  for (const result of results) {
    verify(result);
    for (const frame of result.report.captures) {
      const image = decodeNativePng(await readFile(path.join(root, frame.file)), 760, 220);
      for (const row of frame.pixels) { assert.equal(row.color, row.expected); assert.equal(image.color(...row.point), row.expected, "Saved PNG independently agrees with actual native readback"); }
    }
  }
  if (interests.length === 2 && modes.length === 4) {
    for (const mode of flagModes) {
      const original = reports["original-" + mode], current = reports["current-" + mode];
      assert.deepEqual(original.provenance.bundles.sources, current.provenance.bundles.sources);
      assert.deepEqual(original.provenance.bundles.originalReactNativeSources, current.provenance.bundles.originalReactNativeSources);
      assert.equal(original.provenance.nativeHostSha256, current.provenance.nativeHostSha256);
    }
  }
});
