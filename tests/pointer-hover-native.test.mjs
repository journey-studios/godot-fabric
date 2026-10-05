import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundlePointerHoverProbe} from "../scripts/event-target-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const lane = allowOriginalNegative ? "original" : "current";
const digest = value => createHash("sha256").update(value).digest("hex");
const nativeProducers = ["native/application_runtime.cpp", "scripts/rn-pointer-overlay.mjs"];
const hoverOffsets = new Set([0, 2, 23, 24, 26, 27, 28, 29]);
const rawTypes = {pointerover: "topPointerOver", pointerenter: "topPointerEnter", pointerout: "topPointerOut", pointerleave: "topPointerLeave"};
async function optionalFile(file) {
  try { return await readFile(path.join(root, file)); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
// RN's hover order for one transition, per listener placement: [label, phase,
// target, currentTarget] with T target, P parent, C container, R root handle.
const cases = {
  "target-bubble": {capture: false,
    manual: {pointerover: [["pointerover-bubble", 2, "T", "T"]], pointerenter: [["pointerenter-bubble", 2, "T", "T"]],
      pointerout: [["pointerout-bubble", 2, "T", "T"]], pointerleave: [["pointerleave-bubble", 2, "T", "T"]]},
    enter: [["pointerover-bubble", 2, "T", "T"], ["pointerenter-bubble", 2, "T", "T"]],
    enterRows: "T26t R23 C23 C0 P23 P0 T23 T0t",
    leave: [["pointerout-bubble", 2, "T", "T"], ["pointerleave-bubble", 2, "T", "T"]],
    leaveRows: "T27t R24 C24 C2 P24 P2 T24 T2t"},
  "target-capture": {capture: true,
    manual: {pointerover: [["pointerover-capture", 2, "T", "T"]], pointerenter: [["pointerenter-capture", 2, "T", "T"]],
      pointerout: [["pointerout-capture", 2, "T", "T"]], pointerleave: [["pointerleave-capture", 2, "T", "T"]]},
    enter: [["pointerover-capture", 2, "T", "T"], ["pointerenter-capture", 2, "T", "T"]],
    enterRows: "T26 T28t R23 C23 C0 P23 P0 T23t",
    leave: [["pointerout-capture", 2, "T", "T"], ["pointerleave-capture", 2, "T", "T"]],
    leaveRows: "T27 T29t R24 C24 C2 P24 P2 T24t"},
  "parent-bubble": {capture: false,
    manual: {pointerover: [["pointerover-bubble", 3, "T", "P"]], pointerenter: [], pointerout: [["pointerout-bubble", 3, "T", "P"]], pointerleave: []},
    enter: [["pointerover-bubble", 3, "T", "P"], ["pointerenter-bubble", 2, "P", "P"]],
    enterRows: "T26 T28 P26t R23 C23 C0 P23 P0t T23 T0",
    leave: [["pointerout-bubble", 3, "T", "P"], ["pointerleave-bubble", 2, "P", "P"]],
    leaveRows: "T27 T29 P27t R24 C24 C2 P24 P2t T24 T2"},
  "parent-capture": {capture: true,
    manual: {pointerover: [["pointerover-capture", 1, "T", "P"]], pointerenter: [["pointerenter-capture", 1, "T", "P"]],
      pointerout: [["pointerout-capture", 1, "T", "P"]], pointerleave: [["pointerleave-capture", 1, "T", "P"]]},
    enter: [["pointerover-capture", 1, "T", "P"], ["pointerenter-capture", 2, "P", "P"], ["pointerenter-capture", 1, "T", "P"]],
    enterRows: "T26 T28 P26 P28t R23 C23 C0 P23t T23",
    leave: [["pointerout-capture", 1, "T", "P"], ["pointerleave-capture", 1, "T", "P"], ["pointerleave-capture", 2, "P", "P"]],
    leaveRows: "T27 T29 P27 P29t R24 C24 C2 P24t T24"},
};
// Compact lookup notation: node key, offset and a trailing "t" for true.
const parseRows = rows => rows.split(" ").filter(Boolean).map(entry => {
  const match = /^([TPCR])(\d+)(t?)$/.exec(entry);
  return [match[1], Number(match[2]), match[3] === "t"];
});
const expectedFailures = [...Object.keys(cases).flatMap(id => ["enter", "leave"].flatMap(step => [
  `case/${id}/${step}/Native hover delivers exactly the qualified original callbacks in RN order phase and target`,
  `case/${id}/${step}/Hover Raw appears once per channel and dispatched event with each callback's payload`,
  `case/${id}/${step}/Native hover consults the original hover Maps at the exact pinned offsets and nodes`])),
  ...["down", "up"].flatMap(step => [
    `touch/target-bubble/${step}/Touch hover delivers exactly the qualified original callbacks before the touch event`,
    `touch/target-bubble/${step}/Touch hover Raw appears once per channel and dispatched event with each callback's payload`,
    `touch/target-bubble/${step}/Touch hover consults the original hover Maps at the exact pinned offsets and nodes`]),
  "sibling-no-listeners/enter/Native hover consults the original hover Maps at the exact pinned offsets and nodes",
  "sibling-no-listeners/leave/Native hover consults the original hover Maps at the exact pinned offsets and nodes"];

function nodeTags(react, nodes, name) {
  const panel = react.panels[name], containers = nodes.filter(node => node.testID === "");
  assert.equal(containers.length, 1);
  return {T: panel.tag, P: panel.parentTag, C: containers[0].tag, R: null};
}
function events(react, tags, expected) {
  assert.deepEqual(react.events.map(row => [row.label, row.phase, row.targetTag, row.currentTag]),
    expected.map(([label, phase, target, current]) => [label, phase, tags[target], tags[current]]));
}
// The probe's state() moves every hover lookup from query.rows to hoverRows.
function hoverRows(react, tags, expected) {
  assert.ok(react.query.hoverRows.every(row => hoverOffsets.has(row.offset)) && react.query.rows.every(row => !hoverOffsets.has(row.offset)));
  assert.deepEqual(react.query.hoverRows.map(row => [row.targetTag, row.offset, row.result, row.rootHandle]),
    expected.map(([node, offset, result]) => [tags[node], offset, result, node === "R"]));
}
const healthy = row => row.action === "delegate" && !row.matched && row.resultKind === "boolean";
function moveRows(react, tags, nodes) {
  assert.deepEqual(react.query.rows.filter(row => row.offset === 1 || row.offset === 25).map(row => [row.targetTag, row.offset, row.result, row.rootHandle]),
    nodes.flatMap(node => [[tags[node], 1, false, node === "R"], [tags[node], 25, false, node === "R"]]));
}
function clean(value) {
  assert.ok(value.globalEventRestored && value.currentPriority === value.defaultPriority);
  assert.equal(value.cleanup.length, value.events.length);
  assert.ok(value.cleanup.every(row => row.originalEvent && row.currentTargetNull && row.phase === 0 && row.pathEmpty));
}
// One transition: trusted Discrete callbacks with one typed/star Raw pair per
// dispatched event, exact hover lookups and false Move lookups on a hit.
function transition(stage, name, expected, rows, moveNodes) {
  const value = stage.react, tags = nodeTags(value, stage.after.nodes, name);
  events(value, tags, expected);
  assert.ok(value.events.every(row => row.trusted && row.originalEvent && row.originalSynthetic && row.currentMatches && row.globalEventMatches &&
    row.type === row.label.split("-")[0] && row.pointerType === "mouse" && row.buttons === 0 && row.currentPriority === value.discretePriority));
  const raw = value.raw.filter(row => Object.values(rawTypes).includes(row.type));
  assert.equal(raw.length, 2 * expected.length);
  value.events.forEach((row, index) => {
    const [typed, star] = raw.slice(2 * index, 2 * index + 2);
    assert.deepEqual([typed.channel, star.channel], ["typed", "star"]); assert.equal(typed.type, rawTypes[row.type]);
    assert.equal(typed.payloadId, star.payloadId); assert.equal(row.payloadId, typed.payloadId);
    assert.equal(row.timeStamp, typed.timeStamp); assert.ok(star.sequence < row.sequence);
  });
  hoverRows(value, tags, rows);
  moveRows(value, tags, moveNodes);
  assert.ok([...value.query.rows, ...value.query.hoverRows].every(healthy));
  assert.equal(stage.after.commits, stage.before.commits); assert.equal(stage.after.pointer.activePointers, 0); clean(value);
  return tags;
}
// A touch enters its path in the Down before the Down emission and leaves it
// after the Up emission; the touch event follows the hover callbacks.
function touchPhase(stage, start, expected, rows) {
  const value = stage.react, tags = nodeTags(value, stage.after.nodes, "A"), touch = start ? "touchstart" : "touchend";
  assert.deepEqual(value.events.map(row => row.label), [...expected.map(([label]) => label), touch]);
  const hover = value.events.slice(0, -1);
  assert.deepEqual(hover.map(row => [row.label, row.phase, row.targetTag, row.currentTag]),
    expected.map(([label, phase, target, current]) => [label, phase, tags[target], tags[current]]));
  assert.ok(hover.every(row => row.trusted && row.originalEvent && row.originalSynthetic && row.currentMatches && row.globalEventMatches &&
    row.type === row.label.split("-")[0] && row.pointerType === "touch" && row.buttons === (start ? 1 : 0) && row.currentPriority === value.discretePriority));
  const raw = value.raw.filter(row => Object.values(rawTypes).includes(row.type));
  assert.equal(raw.length, 2 * expected.length);
  hover.forEach((row, index) => {
    const [typed, star] = raw.slice(2 * index, 2 * index + 2);
    assert.deepEqual([typed.channel, star.channel], ["typed", "star"]); assert.equal(typed.type, rawTypes[row.type]);
    assert.equal(typed.payloadId, star.payloadId); assert.equal(row.payloadId, typed.payloadId); assert.ok(star.sequence < row.sequence);
  });
  assert.deepEqual(value.raw.filter(row => row.type === (start ? "topTouchStart" : "topTouchEnd")).map(row => row.channel), ["typed", "star"]);
  hoverRows(value, tags, rows);
  const category = start ? [34, 35] : [36, 37];
  assert.ok(value.query.rows.length > 0 && value.query.rows.every(row => category.includes(row.offset) && healthy(row) && row.result === false));
  assert.ok(value.query.hoverRows.every(row => healthy(row) && value.query.rows.every(other => (row.sequence < other.sequence) === start)));
  const held = start ? 1 : 0;
  assert.equal(stage.after.pointer.activeTouches, held); assert.equal(stage.application.pointerProcessor.hover, held);
  assert.equal(stage.application.pointerRouting.active, held); clean(value);
}

test("original imperative View hover listeners qualify native over/out/enter/leave in RN order", async () => {
  const bundles = await bundlePointerHoverProbe();
  await rm(path.join(root, "build/pointer-hover-report.json"), {force: true});
  const binary = await ensureGodotBinary();
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/pointer-hover-probe.gd", "--",
    ...(allowOriginalNegative ? ["--allow-original-negative"] : [])], {encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, "build/pointer-hover-" + lane + ".log"), log);
  const bytes = await optionalFile("build/pointer-hover-report.json"), report = bytes == null ? null : JSON.parse(bytes);
  if (report != null) {
    report.provenance = {node: process.version, bundles,
      nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, "build/pointer-hover-" + lane + "-report.json"), JSON.stringify(report, null, 2) + "\n");
  }
  // Save actual artifacts before assertions. The old-host flag never accepts
  // unrelated failures or removes the normative failures from the report.
  assert.equal(result.error, undefined, log); assert.equal(result.signal, null, log); assert.equal(result.status, 0, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.equal(report.scenario, "native-pointer-hover-view-interest"); assert.equal(report.reactNative, "0.87.1"); assert.equal(report.displayServer, "headless");
  assert.equal(report.allowOriginalNegative, allowOriginalNegative); assert.equal(report.originalNegativeObserved, allowOriginalNegative);
  assert.equal(report.allCurrentAssertionsPassed, !allowOriginalNegative);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.deepEqual([...report.expectedOriginalFailures].sort(), [...expectedFailures].sort());
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  assert.deepEqual([...failures].sort(), allowOriginalNegative ? [...expectedFailures].sort() : [], "Only the normative hover failures qualify as the old-host control");
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  const nativeErrors = [...log.matchAll(/^ERROR: FABRIC_ERROR: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual([...checkErrors].sort(), [...failures].sort());
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length + nativeErrors.length, "No script or engine error is hidden");
  assert.equal(nativeErrors.length, report.faultExpectedErrors.length);
  nativeErrors.forEach((line, index) => assert.ok(line.startsWith("E_POINTER_LISTENER_QUERY: ") && line.includes(report.faultExpectedErrors[index])));
  assert.match(log, allowOriginalNegative ? new RegExp(`POINTER_HOVER_ORIGINAL_NEGATIVE: ${expectedFailures.length}`) : /POINTER_HOVER_PASSED: \d+/);
  assert.equal(bundles.nativeDispatchMode, "experimental"); assert.equal(bundles.pointerInterestMode, "current");
  for (const file of ["tests/pointer-hover-fixture.jsx", "tests/pointer-hover-probe.gd", "tests/pointer-hover-native.test.mjs",
    "tests/pointer-query-fault-bootstrap.js", "tests/pointer-query-fault-fixture.jsx", "src/pointer-listener-query.js",
    "sdk/toolchain/platform-plugin.mjs", "sdk/toolchain/rn-pointer-interest-overlay.mjs", ...nativeProducers])
    assert.match(bundles.sources[file], /^[0-9a-f]{64}$/, "Pin every reused producer and SDK/native seam: " + file);
  assert.match(bundles.originalReactNativeSources["ReactCommon/react/renderer/uimanager/PointerHoverTracker.cpp"], /^[0-9a-f]{64}$/);
  const stages = report.stages, delivered = !allowOriginalNegative;
  for (const [id, spec] of Object.entries(cases)) {
    const prefix = "case/" + id, registration = stages[prefix + "/registration"];
    assert.equal(registration.capture, spec.capture); assert.deepEqual(registration.type, ["pointerover", "pointerenter", "pointerout", "pointerleave"]);
    transition(stages[prefix + "/start"], "A", [], [], []);
    const tags = transition(stages[prefix + "/enter"], "A", delivered ? spec.enter : [], delivered ? parseRows(spec.enterRows) : [], ["T", "P", "C", "R"]);
    for (const [type, expected] of Object.entries(spec.manual)) {
      const manual = stages[prefix + "/manual"][type];
      assert.ok(manual.result.returned && manual.result.cleaned && !manual.result.trusted && manual.result.targetMatches);
      events(manual.react, tags, expected);
      assert.ok(manual.react.events.every(row => !row.trusted && row.type === type));
      assert.deepEqual(manual.react.raw, []); assert.deepEqual(manual.react.query.rows, []);
      assert.deepEqual(manual.react.query.hoverRows, []); clean(manual.react);
    }
    transition(stages[prefix + "/inside"], "A", [], [], ["T", "P", "C", "R"]);
    transition(stages[prefix + "/leave"], "A", delivered ? spec.leave : [], delivered ? parseRows(spec.leaveRows) : [], []);
  }
  const touch = cases["target-bubble"];
  assert.equal(stages["touch/target-bubble/registration"].capture, false);
  touchPhase(stages["touch/target-bubble/down"], true, delivered ? touch.enter : [], delivered ? parseRows(touch.enterRows) : []);
  touchPhase(stages["touch/target-bubble/up"], false, delivered ? touch.leave : [], delivered ? parseRows(touch.leaveRows) : []);
  // B never dispatched an event: its container has no public instance, and the
  // query skips it without creating one.
  transition(stages["sibling-no-listeners/start"], "B", [], [], []);
  const bTags = transition(stages["sibling-no-listeners/enter"], "B", [], delivered ? parseRows("T26 T28 P26 P28 R26 R28 R23 P23 P0 T23 T0") : [], ["T", "P", "R"]);
  assert.ok(Number.isSafeInteger(bTags.C) && bTags.C > 0);
  transition(stages["sibling-no-listeners/leave"], "B", [], delivered ? parseRows("T27 T29 P27 P29 R27 R29 R24 P24 P2 T24 T2") : [], []);
  assert.deepEqual(report.afterStop.errors, []); assert.ok(report.afterStop.stopped && report.afterStop.rootCount === 0);
  assert.equal(report.afterStop.pointerProcessor.hover, 0);
  if (allowOriginalNegative) assert.deepEqual(report.faultExpectedErrors, []);
  else {
    // A repeated throwing Over lookup: rejected alone, retained once and then
    // counted; enter qualifies on its own lookups and the recovery delivers.
    assert.deepEqual(report.faultExpectedErrors, ["GF pointer query deliberate fault: over26"]);
    const faulted = parseRows("T26 T28 P26 P28 C26 C28 R26 R28 R23 C23 C0 P23 P0 T23 T0t");
    for (const round of [1, 2]) {
      const stage = stages[`fault/over26/round-${round}/enter`], tags = nodeTags(stage.react, stage.after.nodes, "A");
      assert.deepEqual(stage.react.query.hoverRows.map(row => [row.targetTag, row.offset, row.action, row.result]),
        faulted.map(([node, offset, result], index) => [tags[node], offset, index === 0 ? "throw" : "delegate", index === 0 ? null : result]));
      events(stage.react, tags, [["pointerenter-bubble", 2, "T", "T"]]);
      transition(stages[`fault/over26/round-${round}/leave`], "A", cases["target-bubble"].leave, parseRows(cases["target-bubble"].leaveRows), []);
    }
    transition(stages["fault/over26/recovery/enter"], "A", cases["target-bubble"].enter, parseRows(cases["target-bubble"].enterRows), ["T", "P", "C", "R"]);
    const stopped = stages["fault/stopped"];
    assert.equal(stopped.errors.length, 1); assert.ok(stopped.errors[0].includes("over26")); assert.equal(stopped.pointerListenerQuerySuppressed, 1);
  }
  if (!allowOriginalNegative) {
    const originalBytes = await optionalFile("build/pointer-hover-original-report.json"), original = originalBytes == null ? null : JSON.parse(originalBytes);
    if (original != null) {
      assert.ok(original.originalNegativeObserved);
      assert.deepEqual(original.checks.map(row => row.name), report.checks.filter(row => !row.name.startsWith("fault/")).map(row => row.name));
      assert.deepEqual(original.provenance.bundles.originalReactNativeSources, bundles.originalReactNativeSources);
      // The same SDK bundle runs on both hosts; only the compiled native
      // producers differ, and their bundle-time pins say nothing about it.
      assert.equal(original.provenance.bundles.bundles.enabled.sha256, bundles.bundles.enabled.sha256);
      for (const [file, sha] of Object.entries(bundles.sources))
        if (!nativeProducers.includes(file)) assert.equal(original.provenance.bundles.sources[file], sha, "Old/new hosts share the reproducer and SDK producer: " + file);
      assert.notEqual(original.provenance.nativeHostSha256, report.provenance.nativeHostSha256);
    }
    await writeFile(path.join(root, "build/pointer-hover-comparison.json"), JSON.stringify({scenario: report.scenario, originalControlPresent: original != null,
      sameSDKBundleRequired: true, intentionalNativeProducerDifferences: nativeProducers, original, current: report}, null, 2) + "\n");
  }
});
