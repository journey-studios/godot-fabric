import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundlePointerQueryFaultProbe} from "../scripts/event-target-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const capture = process.argv.includes("--capture");
assert.ok(!capture || !allowOriginalNegative, "Graphical captures are only the corrected-host lane");
const mode = allowOriginalNegative ? "original" : "current";
const digest = value => createHash("sha256").update(value).digest("hex");
const cases = {throw34: {offset: 34, action: "throw"}, nonboolean34: {offset: 34, action: "nonboolean"},
  throw35: {offset: 35, action: "throw"}, nonboolean35: {offset: 35, action: "nonboolean"}};
const expectedFailures = Object.keys(cases).flatMap(id => [
  "case/" + id + "/Same-batch TouchStart callback survives query failure",
  "case/" + id + "/Same-batch Raw touchstart survives query failure",
  "case/" + id + "/Same-batch TouchStart commits functional React state",
]);
async function optionalFile(filename) {
  try { return await readFile(path.join(root, filename)); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function publicBundleHash() {
  const source = await optionalFile("build/app.js");
  return source == null ? null : digest(source);
}
function labels(react) { return react.events.map(row => row.label); }
function assertContextClean(react) {
  assert.ok(react.globalEventRestored && react.currentPriority === react.defaultPriority);
  assert.equal(react.cleanup.length, react.events.length);
  assert.ok(react.cleanup.every(row => row.currentTargetNull && row.phase === 0 && row.pathEmpty && row.originalEvent));
}
function assertNativeEvent(react, label, rawType) {
  const events = react.events.filter(row => row.label === label), raw = react.raw.filter(row => row.type === rawType);
  assert.equal(events.length, 1, label + " requires a real original callback");
  const event = events[0];
  assert.ok(event.trusted && event.originalSynthetic && event.originalEvent && event.phase === 2 && event.currentMatches &&
    event.thisMatches && event.targetMatches && event.globalEventMatches, label + " exact trusted original identities");
  assert.deepEqual(raw.map(row => row.channel), ["typed", "star"], rawType + " delivers once per Raw channel");
  assert.equal(raw[0].payloadId, raw[1].payloadId);
  assert.equal(event.payloadId, raw[0].payloadId);
  assert.equal(event.nativeTarget, raw[0].target);
  assert.equal(event.timeStamp, event.nativeTimeStamp);
  assert.equal(event.timeStamp, raw[0].timeStamp);
  assert.ok(raw[1].sequence < event.sequence);
}

test("one failing SDK pointer query preserves the same native batch and every contact cleanup boundary", async () => {
  const publicBefore = await publicBundleHash(), bundles = await bundlePointerQueryFaultProbe();
  const reportPath = path.join(root, "build/pointer-query-fault-report.json");
  await rm(reportPath, {force: true});
  const binary = await ensureGodotBinary();
  const result = spawnSync(binary, ["--path", root, ...(capture ? [] : ["--headless"]), "--script", "res://tests/pointer-query-fault-probe.gd", "--",
    ...(allowOriginalNegative ? ["--allow-original-negative"] : []), ...(capture ? ["--capture"] : [])], {encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, "build/pointer-query-fault-" + mode + ".log"), log);
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.equal(result.status, 0, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use|Inconsistency between local and platform pointer registries/);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  report.provenance = {node: process.version, bundles, publicBundleSha256: publicBefore,
    nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib")))};
  await writeFile(path.join(root, "build/pointer-query-fault-" + mode + "-report.json"), JSON.stringify(report, null, 2) + "\n");
  assert.equal(report.scenario, "native-pointer-query-fault-batch-isolation");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, capture ? "macOS" : "headless");
  assert.equal(report.captures.length, capture ? 2 : 0);
  for (const frame of report.captures) {
    assert.equal(frame.width, 680); assert.equal(frame.height, 160);
    assert.equal(frame.pixels.length, 8);
    assert.ok(frame.pixels.every(pixel => pixel.color === pixel.expected));
    const bytes = await readFile(path.join(root, frame.file));
    assert.equal(bytes.readUInt32BE(16), 680); assert.equal(bytes.readUInt32BE(20), 160);
    if (frame.file.endsWith("updated.png")) {
      assert.equal(frame.reactCounters.A.starts, 3);
      assert.equal(frame.reactCounters.B.starts, 1);
    } else {
      assert.equal(frame.reactCounters.A.starts, 0);
      assert.equal(frame.reactCounters.B.starts, 0);
    }
  }
  assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  assert.ok(report.checks.length >= 100, "The complete real-query and cleanup matrix must execute");
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.deepEqual([...report.expectedOriginalFailures].sort(), [...expectedFailures].sort());
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  assert.deepEqual([...failures].sort(), allowOriginalNegative ? [...expectedFailures].sort() : [],
    "The old-host control may fail only the twelve explicitly declared batch-preservation contracts");
  assert.equal(report.originalNegativeObserved, allowOriginalNegative);
  assert.equal(report.allCurrentAssertionsPassed, !allowOriginalNegative);
  assert.match(log, allowOriginalNegative ? /POINTER_QUERY_FAULT_ORIGINAL_NEGATIVE: 12/ : /POINTER_QUERY_FAULT_PASSED: \d+/);
  const nativeDiagnostics = [...log.matchAll(/^ERROR: FABRIC_ERROR: (.+)$/gm)].map(match => match[1]);
  const failedDiagnostics = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.equal(nativeDiagnostics.length, 4, "Every configured query failure reports once through the real native error route");
  assert.deepEqual([...failedDiagnostics].sort(), [...failures].sort(), "Normative failures stay visibly red in the old-host control");
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, nativeDiagnostics.length + failedDiagnostics.length,
    "No unexpected error is hidden by deliberate-error allowances");
  assert.deepEqual(report.expectedErrors, ["GF pointer query deliberate fault: throw34", "Pointer listener query must return a boolean",
    "GF pointer query deliberate fault: throw35", "Pointer listener query must return a boolean"]);
  assert.equal(report.afterStop.errors.length, 4);
  for (const [index, expected] of report.expectedErrors.entries()) {
    assert.ok(nativeDiagnostics[index].includes(expected), "Native diagnostic preserves its actual configured cause");
    assert.ok(report.afterStop.errors[index].includes(expected), "Stop retains the actual diagnostic instead of clearing it");
  }
  assert.deepEqual(report.scope, {actualNativeInput: true, experimentalNativeDispatch: true, originalFlagsEnabled: true,
    realSDKQueryWrappedOnlyForTest: true, listenerRegistryMirrored: false, publicAPIAdded: false,
    heldContactAfterDownIsLegitimate: true, publicDefaultEnabled: false, hardwareCertified: false});
  assert.equal(bundles.nativeDispatchMode, "experimental");
  assert.equal(bundles.pointerInterestMode, "current");
  assert.equal(Object.keys(bundles.originalReactNativeSources).length, 15, "Pinned oracle includes both queue source files");
  for (const file of ["tests/pointer-query-fault-bootstrap.js", "tests/pointer-query-fault-fixture.jsx",
    "tests/pointer-query-fault-probe.gd", "tests/pointer-query-fault-native.test.mjs"])
    assert.match(bundles.sources[file], /^[0-9a-f]{64}$/, "Every authored probe input is hash-pinned: " + file);
  for (const name of ["A", "B"]) {
    const capability = report.stages["capability" + name];
    assert.ok(capability.original && capability.connected && capability.flags.imperative && capability.flags.nativeDispatch);
    assert.equal(capability.query.installations, 1);
    assert.equal(capability.query.restoredInstaller, true);
  }
  for (const [id, spec] of Object.entries(cases)) {
    const prefix = "case/" + id, stage = report.stages[prefix + "/down"], react = stage.react;
    const attempts = react.query.rows.filter(row => row.matched);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].offset, spec.offset);
    assert.equal(attempts[0].targetTag, react.targetTag);
    assert.equal(attempts[0].action, spec.action);
    assert.equal(react.query.fault.remaining, 0);
    assert.equal(react.query.fault.label, id);
    assert.equal(stage.application.errors.length, Object.keys(cases).indexOf(id) + 1);
    assert.equal(stage.after.pointer.pointerDowns, stage.before.pointer.pointerDowns + 1);
    assert.equal(stage.after.pointer.starts, stage.before.pointer.starts + 1);
    assert.equal(stage.after.pointer.activePointers, 1, "A still-pressed physical contact is not a leak");
    assert.equal(stage.after.pointer.activeTouches, 1);
    assert.equal(stage.application.pointerProcessor.active, 1);
    assert.equal(stage.application.pointerRouting.active, 1);
    assert.deepEqual(labels(react), allowOriginalNegative ? [] : ["touchstart"]);
    assert.equal(react.panels.A.starts, react.baselineStarts + (allowOriginalNegative ? 0 : 1));
    assert.equal(react.raw.filter(row => row.type === "topPointerDown").length, 0);
    assertContextClean(react);
    if (allowOriginalNegative) assert.deepEqual(react.raw, [], "Old host genuinely drops the following same-batch TouchStart");
    else assertNativeEvent(react, "touchstart", "topTouchStart");
    const manual = report.stages[prefix + "/manual"];
    assert.deepEqual(labels(manual.react), [spec.offset === 35 ? "pointerdown-capture" : "pointerdown-bubble"]);
    assert.ok(manual.result.returned && manual.result.cleaned && !manual.result.trusted && manual.result.targetMatches);
    assert.deepEqual(manual.react.raw, []);
    assert.deepEqual(manual.react.query.rows, []);
    const survivor = report.stages[prefix + "/survivor-held/down"];
    assert.deepEqual(labels(survivor), ["pointerdown-bubble", "touchstart"]);
    assertNativeEvent(survivor, "pointerdown-bubble", "topPointerDown");
    assertNativeEvent(survivor, "touchstart", "topTouchStart");
    assertContextClean(survivor);
    if (spec.offset === 35) {
      assert.ok(react.query.rows.some(row => row.targetTag === react.targetTag && row.offset === 34 && row.action === "delegate" &&
        row.resultKind === "boolean" && row.result === false && row.sequence < attempts[0].sequence));
    }
  }
  for (const prefix of ["positive-bubble", "positive-capture", "case/throw34/next-gesture", "case/nonboolean34/next-gesture",
    "case/throw35/survivor-after-retirement", "case/throw35/next-gesture"]) {
    const down = report.stages[prefix + "/down"], end = report.stages[prefix + "/end"];
    const pointerLabel = prefix === "positive-capture" ? "pointerdown-capture" : "pointerdown-bubble";
    assert.deepEqual(labels(down), [pointerLabel, "touchstart"]);
    assertNativeEvent(down, pointerLabel, "topPointerDown");
    assertNativeEvent(down, "touchstart", "topTouchStart");
    assert.deepEqual(labels(end), ["touchend"]);
    assertNativeEvent(end, "touchend", "topTouchEnd");
    assertContextClean(down); assertContextClean(end);
    assert.ok(down.query.rows.every(row => row.action === "delegate" && row.resultKind === "boolean"));
    assert.deepEqual(end.query.rows, []);
  }
  for (const [id, label, rawType] of [["throw34", "touchend", "topTouchEnd"], ["nonboolean34", "touchcancel", "topTouchCancel"]]) {
    const terminal = report.stages["case/" + id + "/terminal"];
    assert.deepEqual(labels(terminal), [label]);
    assertNativeEvent(terminal, label, rawType);
    assert.deepEqual(terminal.query.rows, []);
    assertContextClean(terminal);
  }
  const retired = report.stages["case/throw35/retired"];
  assert.ok(retired.application.pointerListenerQueryInstalled && retired.application.rootCount === 1);
  assert.equal(retired.application.pointerProcessor.active, 0);
  assert.equal(retired.application.pointerRouting.contacts, 0);
  assert.equal(retired.root.nativeTags, 0);
  assert.equal(retired.root.creates, retired.root.deletes);
  assert.ok(report.afterStop.stopped && !report.afterStop.pointerListenerQueryInstalled && report.afterStop.rootCount === 0);
  for (const field of ["pendingWork", "pendingTimers", "pendingAnimationFrames", "pendingRootRetirements"])
    assert.equal(report.afterStop[field], 0);
  assert.deepEqual(report.afterStop.pointerProcessor, {active: 0, pendingCapture: 0, activeCapture: 0, hover: 0});
  assert.ok(report.afterStop.pointerRouting.contacts === 0 && report.afterStop.pointerRouting.stored === 0);
  assert.equal(report.stages.beforeStop.react.query.installations, 1);
  for (const name of ["A", "B"]) {
    const stopped = report.stages["stoppedRoot" + name];
    assert.equal(stopped.nativeTags, 0);
    assert.equal(stopped.creates, stopped.deletes);
    assert.equal(stopped.pointer.activePointers, 0);
    assert.equal(stopped.pointer.activeTouches, 0);
  }
  assert.equal(await publicBundleHash(), publicBefore, "The isolated fault probe preserves build/app.js");
  if (!allowOriginalNegative) {
    const originalBytes = await optionalFile("build/pointer-query-fault-original-report.json");
    const original = originalBytes == null ? null : JSON.parse(originalBytes);
    if (original != null) {
      assert.equal(original.originalNegativeObserved, true);
      assert.deepEqual(original.provenance.bundles.originalReactNativeSources, bundles.originalReactNativeSources);
      for (const [file, sha256] of Object.entries(bundles.sources))
        if (file !== "native/application_runtime.cpp") assert.equal(original.provenance.bundles.sources[file], sha256,
          "Old and corrected native hosts run the unchanged causal fixture: " + file);
      assert.notEqual(original.provenance.nativeHostSha256, report.provenance.nativeHostSha256,
        "The executed old-host failure and corrected-host success use different compiled native hosts");
    }
    await writeFile(path.join(root, "build/pointer-query-fault-comparison.json"), JSON.stringify({
      scenario: report.scenario, originalControlPresent: original != null, original, current: report, scope: report.scope,
    }, null, 2) + "\n");
  }
});
