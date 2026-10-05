import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundlePointerRootPathProbe} from "../scripts/event-target-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const lane = allowOriginalNegative ? "original" : "current";
const digest = value => createHash("sha256").update(value).digest("hex");
const nativeProducers = ["native/application_runtime.cpp", "native/pointer_adapter.cpp", "native/pointer_adapter.h",
  "native/pointer_event.h", "scripts/rn-pointer-overlay.mjs"];
const hoverOffsets = new Set([0, 2, 23, 24, 26, 27, 28, 29]);
const rawTypes = {pointerover: "topPointerOver", pointerenter: "topPointerEnter", pointerout: "topPointerOut", pointerleave: "topPointerLeave"};
async function optionalFile(file) {
  try { return await readFile(path.join(root, file)); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
// Compact lookup notation: node key, offset and a trailing "t" for true.
const parseRows = rows => rows.split(" ").filter(Boolean).map(entry => {
  const match = /^([TPCR])(\d+)(t?)$/.exec(entry);
  return [match[1], Number(match[2]), match[3] === "t"];
});
const overPath = "T26 T28 P26 P28 C26 C28 R26 R28", outPath = "T27 T29 P27 P29 C27 C29 R27 R29";
const targetEnter = [["pointerover-bubble", 2, "T", "T"], ["pointerenter-bubble", 2, "T", "T"]];
const targetLeave = [["pointerout-bubble", 2, "T", "T"], ["pointerleave-bubble", 2, "T", "T"]];
const docEnter = [["pointerenter-capture", 1, "C", "D"], ["pointerenter-capture", 1, "P", "D"], ["pointerenter-capture", 1, "T", "D"]];
const docLeave = [["pointerleave-capture", 1, "T", "D"], ["pointerleave-capture", 1, "P", "D"], ["pointerleave-capture", 1, "C", "D"]];
const hitPath = ["T", "P", "C", "R"];
// RN's hover algorithm with the root resolved for an empty point inside it.
// The root reads only its capture Maps and is never an event target; normative
// lists what the preceding host, which leaves the root there, fails.
const steps = {
  "view-bubble/start": {events: [], rows: "", moves: [], hovered: 0, normative: []},
  "view-bubble/enter": {events: targetEnter, rows: "T26t R23 C23 C0 P23 P0 T23 T0t", moves: hitPath, hovered: 1, normative: ["query"]},
  "view-bubble/empty": {events: targetLeave, rows: "T27t C24 C2 P24 P2 T24 T2t", moves: [], hovered: 1, normative: ["query", "hover"]},
  "view-bubble/back": {events: targetEnter, rows: "T26t C23 C0 P23 P0 T23 T0t", moves: hitPath, hovered: 1, normative: ["query"]},
  "view-bubble/exit": {events: targetLeave, rows: "T27t R24 C24 C2 P24 P2 T24 T2t", moves: [], hovered: 0, normative: ["query"]},
  "view-bubble/empty-in": {events: [], rows: "R23", moves: [], hovered: 1, normative: ["query", "hover"]},
  "view-bubble/empty-out": {events: [], rows: "R24", moves: [], hovered: 0, normative: ["query"]},
  "document-capture/enter": {events: docEnter, rows: overPath + " R23t C23 P23 T23", moves: hitPath, hovered: 1, normative: []},
  "document-capture/empty": {events: [], rows: outPath + " C24 C2 P24 P2 T24 T2", moves: [], hovered: 1, normative: []},
  "document-capture/back": {events: [], rows: overPath + " C23 C0 P23 P0 T23 T0", moves: hitPath, hovered: 1, normative: []},
  "document-capture/exit": {events: docLeave, rows: outPath + " R24t C24 P24 T24", moves: [], hovered: 0, normative: []},
  "document-capture/touch/down": {events: docEnter, rows: overPath + " R23t C23 P23 T23", moves: [], hovered: 1, normative: [], touch: "touchstart"},
  "document-capture/touch/drag-empty": {events: [], rows: outPath + " C24 C2 P24 P2 T24 T2", moves: [], hovered: 1, normative: []},
  "document-capture/touch/up-empty": {events: [], rows: "R24t", moves: [], hovered: 0, normative: [], touch: "touchend"},
};
const checkNames = {
  delivery: "Native hover delivers exactly the qualified original callbacks in RN order phase and target",
  raw: "Hover Raw appears once per channel and dispatched event, never for the root",
  query: "Native hover consults the root and path Maps exactly as RN's root-resolved path requires",
  hover: "The processor holds the hover path RN resolves for this point",
};
const rootOwnCheck = "hover/A root's own enter and leave Maps are never read; only its capture Maps propagate";
// The preceding host crashes in the first Document capture step (it emits to
// the root), so no Document check is normative: its control runs the View case
// alone and the Document case apart, expecting that crash.
const expectedFailures = [...Object.entries(steps).flatMap(([prefix, step]) => step.normative.map(kind => `${prefix}/${checkNames[kind]}`)), rootOwnCheck];

function nodeTags(react, nodes) {
  const panel = react.panels.A, containers = nodes.filter(node => node.testID === "");
  assert.equal(containers.length, 1);
  return {T: panel.tag, P: panel.parentTag, C: containers[0].tag, R: null, D: null};
}
function clean(value) {
  assert.ok(value.globalEventRestored && value.currentPriority === value.defaultPriority);
  assert.equal(value.cleanup.length, value.events.length);
  assert.ok(value.cleanup.every(row => row.originalEvent && row.currentTargetNull && row.phase === 0 && row.pathEmpty));
}
function verifyStep(prefix, stage, step) {
  const value = stage.react, tags = nodeTags(value, stage.after.nodes);
  const hover = value.events.filter(row => row.label !== step.touch);
  assert.deepEqual(value.events.map(row => row.label), [...step.events.map(([label]) => label), ...(step.touch ? [step.touch] : [])], prefix);
  assert.deepEqual(hover.map(row => [row.label, row.phase, row.targetTag, row.currentIsDocument ? null : row.currentTag]),
    step.events.map(([label, phase, target, current]) => [label, phase, tags[target], tags[current]]), prefix);
  const pointerType = step.touch || prefix.includes("/touch/") ? "touch" : "mouse";
  assert.ok(hover.every(row => row.trusted && row.originalEvent && row.currentMatches && row.type === row.label.split("-")[0] &&
    row.pointerType === pointerType && row.currentPriority === value.discretePriority), prefix);
  // One typed/star Raw pair per dispatched hover callback, none for the root.
  const raw = value.raw.filter(row => Object.values(rawTypes).includes(row.type));
  assert.equal(raw.length, 2 * step.events.length, prefix);
  hover.forEach((row, index) => {
    const [typed, star] = raw.slice(2 * index, 2 * index + 2);
    assert.deepEqual([typed.channel, star.channel, typed.type], ["typed", "star", rawTypes[row.type]]);
    assert.equal(typed.payloadId, star.payloadId); assert.equal(row.payloadId, typed.payloadId);
  });
  assert.ok(value.query.hoverRows.every(row => hoverOffsets.has(row.offset) && row.action === "delegate" && !row.matched && row.resultKind === "boolean"));
  assert.ok(value.query.rows.every(row => !hoverOffsets.has(row.offset)));
  assert.deepEqual(value.query.hoverRows.map(row => [row.targetTag, row.offset, row.result, row.rootHandle]),
    parseRows(step.rows).map(([node, offset, result]) => [tags[node], offset, result, node === "R"]), prefix);
  assert.deepEqual(value.query.rows.filter(row => row.offset === 1 || row.offset === 25).map(row => [row.targetTag, row.offset, row.result]),
    step.moves.flatMap(node => [[tags[node], 1, false], [tags[node], 25, false]]), prefix);
  assert.equal(stage.application.pointerProcessor.hover, step.hovered, prefix);
  clean(value);
}

async function runProbe(binary, bundles, label, args) {
  await rm(path.join(root, "build/pointer-root-path-report.json"), {force: true});
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/pointer-root-path-probe.gd", "--", ...args],
    {encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, "build/pointer-root-path-" + label + ".log"), log);
  const bytes = await optionalFile("build/pointer-root-path-report.json"), report = bytes == null ? null : JSON.parse(bytes);
  if (report != null) {
    report.provenance = {node: process.version, bundles,
      nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, "build/pointer-root-path-" + label + "-report.json"), JSON.stringify(report, null, 2) + "\n");
  }
  return {result, log, report};
}

test("an empty point inside a root keeps the root in RN's hover path without making it an event target", async () => {
  const bundles = await bundlePointerRootPathProbe();
  const binary = await ensureGodotBinary();
  if (allowOriginalNegative) {
    // The preceding host emits Document capture enter/leave to the root and
    // dereferences its missing instance handle: the process crashes in the
    // first Document step, before any of its checks. No report is written.
    const crash = await runProbe(binary, bundles, "original-document", ["--allow-original-negative", "--document-only"]);
    assert.notEqual(crash.result.status ?? crash.result.signal, 0, crash.log);
    assert.equal(crash.report, null, crash.log);
    assert.match(crash.log, /handle_crash: Program crashed with signal 11/);
    assert.match(crash.log, /UIManagerBinding::dispatchEventToJS[\s\S]*PointerEventsProcessor::handleIncomingPointerEventOnNode/);
    assert.deepEqual([...crash.log.matchAll(/^POINTER_ROOT_PATH_STEP: (.+)$/gm)].map(match => match[1]), ["document-capture/enter"]);
    assert.doesNotMatch(crash.log, /FABRIC_CHECK_FAILED|SCRIPT ERROR/);
  }
  const {result, log, report} = await runProbe(binary, bundles, lane, allowOriginalNegative ? ["--allow-original-negative", "--view-only"] : []);
  // Save actual artifacts before assertions. The old-host flag never accepts
  // unrelated failures or removes the normative failures from the report.
  assert.equal(result.error, undefined, log); assert.equal(result.signal, null, log); assert.equal(result.status, 0, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.equal(report.scenario, "native-pointer-root-path"); assert.equal(report.reactNative, "0.87.1"); assert.equal(report.displayServer, "headless");
  assert.equal(report.allowOriginalNegative, allowOriginalNegative); assert.equal(report.originalNegativeObserved, allowOriginalNegative);
  assert.equal(report.allCurrentAssertionsPassed, !allowOriginalNegative);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.deepEqual([...report.expectedOriginalFailures].sort(), [...expectedFailures].sort());
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  assert.deepEqual([...failures].sort(), allowOriginalNegative ? [...expectedFailures].sort() : [], "Only the normative root-path failures qualify as the old-host control");
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual([...checkErrors].sort(), [...failures].sort());
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length, "No native diagnostic, script or engine error is hidden");
  assert.match(log, allowOriginalNegative ? new RegExp(`POINTER_ROOT_PATH_ORIGINAL_NEGATIVE: ${expectedFailures.length}`) : /POINTER_ROOT_PATH_PASSED: \d+/);
  assert.equal(bundles.nativeDispatchMode, "experimental"); assert.equal(bundles.pointerInterestMode, "current");
  for (const file of ["tests/pointer-root-path-fixture.jsx", "tests/pointer-root-path-probe.gd", "tests/pointer-root-path-native.test.mjs",
    "tests/pointer-hover-probe.gd", "tests/pointer-query-fault-bootstrap.js", "tests/pointer-query-fault-fixture.jsx",
    "src/pointer-listener-query.js", "sdk/toolchain/platform-plugin.mjs", "sdk/toolchain/rn-pointer-interest-overlay.mjs", ...nativeProducers])
    assert.match(bundles.sources[file], /^[0-9a-f]{64}$/, "Pin every reused producer and SDK/native seam: " + file);
  for (const file of ["ReactCommon/react/renderer/uimanager/PointerHoverTracker.cpp", "ReactCommon/react/renderer/mounting/ShadowTree.cpp",
    "ReactCommon/react/renderer/core/EventTarget.cpp"])
    assert.match(bundles.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  assert.deepEqual(report.cases, {view: true, document: !allowOriginalNegative});
  if (!allowOriginalNegative) {
    const registration = report.stages["document-capture/registration"];
    assert.ok(registration.capture === true && registration.listenerIsDocument);
    assert.deepEqual(registration.type, ["pointerenter", "pointerleave"]);
    for (const [prefix, step] of Object.entries(steps)) verifyStep(prefix, report.stages[prefix], step);
    assert.deepEqual(report.stages.rootOwnHoverLookups, []);
    assert.deepEqual(report.afterStop.errors, []); assert.ok(report.afterStop.stopped && report.afterStop.rootCount === 0);
    assert.equal(report.afterStop.pointerProcessor.hover, 0);
    const originalBytes = await optionalFile("build/pointer-root-path-original-report.json"), original = originalBytes == null ? null : JSON.parse(originalBytes);
    if (original != null) {
      assert.ok(original.originalNegativeObserved);
      assert.deepEqual(original.cases, {view: true, document: false});
      assert.deepEqual(original.checks.map(row => row.name), report.checks.filter(row => !row.name.startsWith("document-capture/")).map(row => row.name));
      assert.deepEqual(original.provenance.bundles.originalReactNativeSources, bundles.originalReactNativeSources);
      // The same SDK bundle runs on both hosts; only the compiled native
      // producers differ, and their bundle-time pins say nothing about it.
      assert.equal(original.provenance.bundles.bundles.enabled.sha256, bundles.bundles.enabled.sha256);
      for (const [file, sha] of Object.entries(bundles.sources))
        if (!nativeProducers.includes(file)) assert.equal(original.provenance.bundles.sources[file], sha, "Old/new hosts share the reproducer and SDK producer: " + file);
      assert.notEqual(original.provenance.nativeHostSha256, report.provenance.nativeHostSha256);
      // Its Document lane crashed in the first Document capture step.
      const crashLog = await optionalFile("build/pointer-root-path-original-document.log");
      assert.ok(crashLog != null && /handle_crash: Program crashed with signal 11/.test(crashLog.toString()));
    }
    await writeFile(path.join(root, "build/pointer-root-path-comparison.json"), JSON.stringify({scenario: report.scenario, originalControlPresent: original != null,
      sameSDKBundleRequired: true, intentionalNativeProducerDifferences: nativeProducers, original, current: report}, null, 2) + "\n");
  }
});
