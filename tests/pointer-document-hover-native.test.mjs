import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundlePointerDocumentHoverProbe} from "../scripts/event-target-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const flagModes = ["disabled", "imperative-only", "internal-only", "enabled"];
const requestedInterest = process.argv.find(value => value.startsWith("--interest="))?.slice(11);
const requestedFlag = process.argv.find(value => value.startsWith("--flag="))?.slice(7);
assert.ok(requestedInterest == null || ["original", "current"].includes(requestedInterest));
assert.ok(requestedFlag == null || flagModes.includes(requestedFlag));
const interests = requestedInterest == null ? ["original", "current"] : [requestedInterest];
const modes = requestedFlag == null ? flagModes : [requestedFlag];
const digest = value => createHash("sha256").update(value).digest("hex");
const flags = mode => ({imperative: ["imperative-only", "enabled"].includes(mode), nativeDispatch: ["internal-only", "enabled"].includes(mode)});
const methods = available => Array(3).fill(available ? "function" : "undefined");
const hoverOffsets = new Set([0, 2, 23, 24, 26, 27, 28, 29]);
const rawTypes = {pointerover: "topPointerOver", pointerenter: "topPointerEnter", pointerout: "topPointerOut", pointerleave: "topPointerLeave"};
async function optionalFile(file) { try { return await readFile(path.join(root, file)); } catch (error) { if (error.code === "ENOENT") return null; throw error; } }
async function publicHash() { const bytes = await optionalFile("build/app.js"); return bytes == null ? null : digest(bytes); }

// An independent statement of the expected DOM delivery. Document methods need
// D and documentElement methods need I and D; only the current interest with D
// installs the root query. Capture runs top-down at phase 1 (Document, then
// documentElement) and over/out bubble bottom-up at phase 3; pointerenter and
// pointerleave never bubble. An empty point inside the root keeps the root in
// RN's hover path, so its capture Maps propagate only on surface entry and exit.
function model(I, D, installed) {
  const kinds = {all: ["DocC", "RootC", "RootB", "DocB"], doc: ["DocC", "DocB"], element: ["RootC", "RootB"],
    "doc-capture-only": ["DocC"], "element-capture-only": ["RootC"], none: []};
  const registered = kind => kinds[kind].filter(label => D && (label.startsWith("Doc") || I));
  const callbacks = (listeners, type, node) => [
    ...["DocC", "RootC"].filter(label => listeners.includes(label)).map(label => [type, label, 1, node]),
    ...(type === "pointerover" || type === "pointerout" ? ["RootB", "DocB"].filter(label => listeners.includes(label)).map(label => [type, label, 3, node]) : [])];
  const capturing = listeners => installed && listeners.some(label => label.endsWith("C"));
  const bubbling = listeners => installed && listeners.some(label => label.endsWith("B"));
  const qualifying = listeners => installed && listeners.length > 0;
  const pathRows = (listeners, bubble) => !installed ? [] : bubbling(listeners) ? [[bubble, true]] : [[bubble, false], [bubble + 2, capturing(listeners)]];
  const enter = listeners => ({events: [...(qualifying(listeners) ? callbacks(listeners, "pointerover", "L") : []),
    ...(capturing(listeners) ? ["C", "P", "L"].flatMap(node => callbacks(listeners, "pointerenter", node)) : [])],
    rows: [...pathRows(listeners, 26), ...(installed ? [[23, capturing(listeners)]] : [])]});
  const exit = listeners => ({events: [...(qualifying(listeners) ? callbacks(listeners, "pointerout", "L") : []),
    ...(capturing(listeners) ? ["L", "P", "C"].flatMap(node => callbacks(listeners, "pointerleave", node)) : [])],
    rows: [...pathRows(listeners, 27), ...(installed ? [[24, capturing(listeners)]] : [])]});
  const within = (listeners, type) => ({events: qualifying(listeners) ? callbacks(listeners, type, "L") : [],
    rows: pathRows(listeners, type === "pointerover" ? 26 : 27)});
  return {registered, enter, exit, within};
}

function tags(stage, name) {
  const nodes = stage.after.nodes, byTestID = id => nodes.find(node => node.testID === id)?.tag;
  const containers = nodes.filter(node => node.testID === "");
  assert.equal(containers.length, 1);
  return {L: stage.react.panels[name].leafTag, P: byTestID(name + "-parent"), C: containers[0].tag, S: byTestID(name + "-sentinel")};
}

function step(stage, name, expected, hovered, D, installed, {pointerType = "mouse", legacy = false} = {}) {
  const value = stage.react, map = tags(stage, name);
  // A compiled legacy JSX handler (no native dispatch) carries no event type.
  assert.deepEqual(value.events.map(row => [row.type, row.label, row.phase, row.targetTag]),
    expected.events.map(([type, label, phase, node]) => [legacy ? null : type, label, phase, map[node]]));
  if (legacy) assert.ok(value.events.every(row => row.compiledLegacySynthetic && !row.originalEvent));
  else assert.ok(value.events.every(row => row.trusted && row.originalEvent && row.currentMatches && row.thisMatches && row.globalEventMatches &&
    row.pointerType === pointerType && row.currentPriority === value.discretePriority));
  // One typed/star pair per dispatched native event, shared by its callbacks.
  const dispatched = [];
  value.events.forEach((row, index) => {
    if (dispatched.at(-1)?.payloadId !== row.payloadId) dispatched.push({payloadId: row.payloadId, type: expected.events[index][0]});
  });
  assert.deepEqual(value.raw.map(row => [row.channel, row.type, row.payloadId]),
    dispatched.flatMap(row => [["typed", rawTypes[row.type], row.payloadId], ["star", rawTypes[row.type], row.payloadId]]));
  const roots = value.query.hoverRows.filter(row => row.isRootHandle);
  assert.deepEqual(roots.map(row => [row.offset, row.result]), expected.rows);
  assert.ok(roots.every(row => row.name === name && row.candidateTag === value.panels[name].surfaceId && row.expectedHandle &&
    row.before.publicInstanceNull === row.after.publicInstanceNull && row.before.refAssigned === row.after.refAssigned));
  assert.ok(value.query.hoverRows.every(row => hoverOffsets.has(row.offset) && row.action === "delegate" && !row.matched &&
    row.resultKind === "boolean" && (row.isRootHandle || row.result === false)));
  if (!installed) assert.deepEqual([...value.query.rows, ...value.query.hoverRows], []);
  assert.equal(stage.application.pointerProcessor.hover, hovered);
  assert.equal(value.panels[name].count, value.baselineCount + value.events.length);
  assert.ok(value.globalEventRestored && value.currentPriority === value.defaultPriority);
  assert.ok(value.cleanup.every(row => row.currentTargetNull && (!D || row.originalEvent && row.phase === 0 && row.pathEmpty)));
}

// A manual bubbling pointerover at the Document reaches its own listeners at
// phase 2; at the documentElement the Document is an ancestor (1 and 3).
function manual(stage, listeners, element, supported) {
  const order = element ? [["DocC", 1], ["RootC", 2], ["RootB", 2], ["DocB", 3]] : [["DocC", 2], ["DocB", 2]];
  assert.equal(stage.result.available, supported); assert.ok(stage.result.noPrototypeBorrow);
  assert.deepEqual(stage.react.events.map(row => [row.label, row.phase]), order.filter(([label]) => supported && listeners.includes(label)));
  assert.ok(stage.react.events.every(row => row.type === "pointerover" && !row.trusted && row.targetMatches && row.currentMatches));
  if (supported) assert.ok(stage.result.returned && !stage.result.trusted && stage.result.targetMatches && stage.result.cleaned);
  assert.deepEqual(stage.react.raw, []); assert.deepEqual(stage.react.query.rows, []); assert.deepEqual(stage.react.query.hoverRows, []);
}

function verify({report, result, log, interestMode, flagMode}) {
  assert.equal(result.error, undefined, log); assert.equal(result.signal, null, log); assert.equal(result.status, 0, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use|Inconsistency between local and platform pointer registries/);
  assert.equal(report.scenario, "native-pointer-document-hover-four-flags"); assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.flagMode, flagMode); assert.equal(report.interestMode, interestMode); assert.equal(report.displayServer, "headless");
  assert.ok(report.allAssertionsPassed); assert.deepEqual(report.failures, []);
  assert.ok(report.checks.length > 0 && report.checks.every(row => row.passed));
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, 0, "The healthy hover matrix prints no native or script error");
  assert.match(log, /POINTER_DOCUMENT_HOVER_PASSED: \d+/);
  const {imperative: I, nativeDispatch: D} = flags(flagMode), installed = interestMode === "current" && D;
  for (const name of ["A", "B"]) {
    const capability = report.stages["capability" + name];
    assert.deepEqual(capability.flags, flags(flagMode)); assert.equal(capability.mode, flagMode); assert.equal(capability.interestMode, interestMode);
    assert.deepEqual(capability.methods.doc, methods(D)); assert.deepEqual(capability.methods.element, methods(I && D));
    assert.equal(capability.query.installations, installed ? 1 : 0);
  }
  const stages = report.stages, {registered, enter, exit, within} = model(I, D, installed);
  for (const kind of ["all", "doc", "element", "doc-capture-only", "element-capture-only"]) {
    const prefix = "case/" + kind, listeners = registered(kind);
    assert.deepEqual(stages[prefix + "/configuration"].installed, listeners);
    assert.equal(stages[prefix + "/configuration"].eventType, "pointerhover");
    if (!kind.startsWith("element")) manual(stages[prefix + "/manual"], listeners, false, D);
    if (kind !== "doc" && kind !== "doc-capture-only") manual(stages[prefix + "/element/manual"], listeners, true, D && I);
    step(stages[prefix + "/enter"], "A", enter(listeners), 1, D, installed);
    step(stages[prefix + "/empty"], "A", within(listeners, "pointerout"), 1, D, installed);
    step(stages[prefix + "/back"], "A", within(listeners, "pointerover"), 1, D, installed);
    step(stages[prefix + "/exit"], "A", exit(listeners), 0, D, installed);
  }
  const all = registered("all");
  step(stages["touch/down"], "A", enter(all), 1, D, installed, {pointerType: "touch"});
  step(stages["touch/up"], "A", exit(all), 0, D, installed, {pointerType: "touch"});
  // The sentinel's own JSX enter/leave props qualify in every lane.
  const none = registered("none");
  const sentinelIn = {events: [["pointerenter", "JSX", D ? 2 : null, "S"]], rows: enter(none).rows};
  const sentinelOut = {events: [["pointerleave", "JSX", D ? 2 : null, "S"]], rows: exit(none).rows};
  step(stages["sentinel/enter"], "A", sentinelIn, 1, D, installed, {legacy: !D});
  step(stages["sentinel/exit"], "A", sentinelOut, 0, D, installed, {legacy: !D});
  step(stages["isolation/A-negative/enter"], "A", enter(none), 1, D, installed);
  step(stages["isolation/A-negative/exit"], "A", exit(none), 0, D, installed);
  const doc = registered("doc");
  assert.deepEqual(stages["isolation/B-configuration"].installed, doc);
  step(stages["isolation/B-positive/enter"], "B", enter(doc), 1, D, installed);
  step(stages["isolation/B-positive/exit"], "B", exit(doc), 0, D, installed);
  step(stages["removal/enter"], "A", enter(doc), 1, D, installed);
  assert.equal(stages["removal/removed"], true);
  step(stages["removal/exit"], "A", exit(none), 0, D, installed);
  assert.deepEqual(report.afterStop.errors, []);
  assert.ok(report.afterStop.stopped && !report.afterStop.pointerListenerQueryInstalled && report.afterStop.rootCount === 0);
  assert.deepEqual(report.afterStop.pointerProcessor, {active: 0, pendingCapture: 0, activeCapture: 0, hover: 0});
}

test("original Document and documentElement hover listeners obey four immutable flags with RN's root-resolved hover path", async () => {
  const before = await publicHash(), binary = await ensureGodotBinary(), results = [], reports = {};
  const nativeHostSha256 = digest(await readFile(path.join(root, "addons/fabric_godot.dylib")));
  // Keep every actual report before asserting a lane.
  for (const interestMode of interests) {
    const bundles = await bundlePointerDocumentHoverProbe({interestMode});
    for (const flagMode of modes) {
      await rm(path.join(root, "build/pointer-document-hover-report.json"), {force: true});
      const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/pointer-document-hover-probe.gd", "--",
        "--interest=" + interestMode, "--flag=" + flagMode], {encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024});
      const log = (result.stdout ?? "") + (result.stderr ?? ""), id = interestMode + "-" + flagMode;
      await writeFile(path.join(root, "build/pointer-document-hover-" + id + ".log"), log);
      const bytes = await optionalFile("build/pointer-document-hover-report.json"), report = bytes == null ? null : JSON.parse(bytes);
      if (report != null) {
        report.provenance = {node: process.version, bundles, publicBundleSha256: before, nativeHostSha256, sourceReceiptDoesNotCertifyNativeBuild: true};
        await writeFile(path.join(root, "build/pointer-document-hover-" + id + "-report.json"), JSON.stringify(report, null, 2) + "\n"); reports[id] = report;
      }
      results.push({report, result, log, interestMode, flagMode});
      assert.equal(await publicHash(), before, "Each isolated hover bundle preserves build/app.js");
      assert.equal(digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), nativeHostSha256, "All lanes use the same actual compiled native host");
    }
  }
  await writeFile(path.join(root, "build/pointer-document-hover-comparison.json"), JSON.stringify({scenario: "native-pointer-document-hover-four-flags", interests, flagModes: modes, nativeHostSha256, reports,
    scope: {actualNativeInput: true, sameNativeHostAcrossControls: true, fourIndependentHermesFlagConfigurations: modes.length === 4, publicDefaultEnabled: false, hardwareCertified: false}}, null, 2) + "\n");
  for (const result of results) verify(result);
  if (interests.length === 2 && modes.length === 4) {
    for (const mode of flagModes) {
      const original = reports["original-" + mode], current = reports["current-" + mode];
      assert.deepEqual(original.provenance.bundles.sources, current.provenance.bundles.sources);
      assert.deepEqual(original.provenance.bundles.originalReactNativeSources, current.provenance.bundles.originalReactNativeSources);
      assert.equal(original.provenance.nativeHostSha256, current.provenance.nativeHostSha256);
    }
  }
});
