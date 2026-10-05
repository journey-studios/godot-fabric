import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundlePointerUpProbe} from "../scripts/event-target-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {decodeNativePng} from "./native-png.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const capture = process.argv.includes("--capture");
assert.ok(!capture || !allowOriginalNegative, "Native graphical captures run only against the corrected host");
const lane = capture ? "capture" : allowOriginalNegative ? "original" : "current";
// Checks added by the second-application component fault phase.
const FAULT_CHECKS = 234;
const digest = value => createHash("sha256").update(value).digest("hex");
const normativeSuffixes = ["Physical Up delivers exactly one trusted original imperative callback before TouchEnd",
  "Physical Up delivers typed and star Raw exactly once with the same actual callback payload",
  "Physical Up commits exactly one functional React increment and native counter width",
  "Physical Up uses actual original SDK offsets and the sole registered phase Map"];
const expectedFailures = ["bubble", "capture-only"].flatMap(id => normativeSuffixes.map(suffix => "case/" + id + "/" + suffix));
async function optionalFile(file) {
  try { return await readFile(path.join(root, file)); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function publicHash() { const bytes = await optionalFile("build/app.js"); return bytes == null ? null : digest(bytes); }
const labels = value => value.events.map(row => row.label);
function clean(value) {
  assert.ok(value.globalEventRestored && value.currentPriority === value.defaultPriority);
  assert.equal(value.cleanup.length, value.events.length);
  assert.ok(value.cleanup.every(row => row.originalEvent && row.currentTargetNull && row.phase === 0 && row.pathEmpty));
}
function nativeEvent(value, label, type) {
  const rows = value.events.filter(row => row.label === label), raw = value.raw.filter(row => row.type === type);
  assert.equal(rows.length, 1); assert.deepEqual(raw.map(row => row.channel), ["typed", "star"]);
  assert.equal(raw[0].payloadId, raw[1].payloadId);
  const row = rows[0];
  assert.ok(row.trusted && row.originalEvent && row.originalSynthetic && row.phase === 2 && row.currentMatches && row.thisMatches && row.targetMatches && row.globalEventMatches);
  assert.equal(row.payloadId, raw[0].payloadId); assert.equal(row.nativeTarget, raw[0].target);
  assert.equal(row.timeStamp, row.nativeTimeStamp); assert.equal(row.timeStamp, raw[0].timeStamp);
  assert.ok(raw[1].sequence < row.sequence);
}
// Component query and resolver getter faults at the Up offsets, in a second
// application after the healthy one stopped. Target rows are [offset, action,
// result]; every other lookup is an owning-surface ancestor or the root, read
// 36 then 37 and false, with the root handle as the final pair.
function faultedUp(stages, prefix, captureMode, expected, rows, consumed, cause, queryFault, recoveryRows) {
  const delivered = expected.length > 0, up = stages[prefix + "/up"], value = up.react;
  assert.deepEqual(labels(value), [...expected, "touchend"]);
  nativeEvent(value, "touchend", "topTouchEnd"); clean(value); terminalClean(up);
  if (delivered) {
    nativeEvent(value, expected[0], "topPointerUp");
    assert.ok(value.events.filter(row => row.type === "pointerup").every(row => row.trusted && row.phase === 2 && row.currentPriority === value.discretePriority));
  } else assert.deepEqual(value.raw.map(row => row.type), ["topTouchEnd", "topTouchEnd"]);
  assert.equal(value.panels.A.ups, value.baselineUps + expected.length); assert.equal(value.panels.A.starts, value.baselineStarts);
  assert.equal(up.after.commits, up.before.commits + (delivered ? 1 : 0));
  const own = value.query.rows.filter(row => row.targetTag === value.targetTag), others = value.query.rows.filter(row => row.targetTag !== value.targetTag);
  assert.deepEqual(own.map(row => [row.offset, row.action, row.result]), rows.map(([o, a, r]) => [o, a, a === "nonboolean" ? 1 : r]));
  assert.ok(own.every(row => row.matched === (row.action !== "delegate") && row.resultKind === (row.action === "delegate" ? "boolean" : row.action === "throw" ? "throw" : "number")));
  if (delivered) assert.deepEqual(others, []);
  else {
    // Owning-surface ancestors, then the root handle (no tag) as the final pair.
    const ownerTags = new Set(up.after.nodes.map(node => node.tag));
    assert.ok(others.length >= 2 && others.length % 2 === 0 && others.at(-1).targetTag === null && others.at(-2).targetTag === null);
    assert.ok(others.every(row => row.targetTag === null || ownerTags.has(row.targetTag)));
    for (let index = 0; index < others.length; index += 2) {
      const [bubble, captured] = others.slice(index, index + 2);
      assert.deepEqual([bubble.offset, captured.offset], [36, 37]); assert.equal(bubble.targetTag, captured.targetTag);
      assert.ok(bubble.sequence < captured.sequence && bubble.sequence > own.at(-1).sequence);
    }
    assert.ok(others.every(row => row.action === "delegate" && !row.matched && row.resultKind === "boolean" && row.result === false));
  }
  assert.equal(up.consumed, consumed);
  if (queryFault) assert.equal(value.query.fault.remaining, consumed ? 0 : 1); else assert.equal(value.query.fault, null);
  assert.equal(up.errorsAfter.length, up.errorsBefore.length + (consumed ? 1 : 0));
  if (consumed) assert.ok(up.errorsAfter.at(-1).startsWith("E_POINTER_LISTENER_QUERY: ") && up.errorsAfter.at(-1).includes(cause));
  assert.equal(stages[prefix + "/cleared"], true);
  const recovery = stages[prefix + "/recovery/up"], healthy = recovery.react;
  const recoveryLabels = captureMode === "both" ? ["pointerup-capture", "pointerup-bubble"] : captureMode ? ["pointerup-capture"] : ["pointerup-bubble"];
  assert.deepEqual(labels(healthy), [...recoveryLabels, "touchend"]); nativeEvent(healthy, "touchend", "topTouchEnd"); clean(healthy); terminalClean(recovery);
  assert.deepEqual(healthy.query.rows.map(row => [row.offset, row.action, row.result]), recoveryRows);
  assert.ok(healthy.query.rows.every(row => row.targetTag === healthy.targetTag)); assert.equal(healthy.query.fault, null);
  assert.equal(healthy.panels.A.ups, healthy.baselineUps + recoveryLabels.length); assert.equal(recovery.after.commits, recovery.before.commits + 1);
  assert.deepEqual(recovery.application.errors, up.errorsAfter);
}
function componentFaults(report) {
  const stages = report.stages, causes = [];
  const cases = [
    ["throw36", false, 36, "throw", [], [[36, "throw", null], [37, "delegate", false]], [[36, "delegate", true]]],
    ["throw36-both", "both", 36, "throw", ["pointerup-capture", "pointerup-bubble"], [[36, "throw", null], [37, "delegate", true]], [[36, "delegate", true]]],
    ["throw37", true, 37, "throw", [], [[36, "delegate", false], [37, "throw", null]], [[36, "delegate", false], [37, "delegate", true]]],
    ["nonboolean36", false, 36, "nonboolean", [], [[36, "nonboolean", null], [37, "delegate", false]], [[36, "delegate", true]]],
    ["nonboolean37", true, 37, "nonboolean", [], [[36, "delegate", false], [37, "nonboolean", null]], [[36, "delegate", false], [37, "delegate", true]]],
    ["armed37", false, 37, "throw", ["pointerup-bubble"], [[36, "delegate", true]], [[36, "delegate", true]]],
  ];
  for (const [id, captureMode, offset, mode, expected, rows, recoveryRows] of cases) {
    const prefix = "fault/" + id, consumed = rows.some(row => row[1] !== "delegate");
    assert.equal(stages[prefix + "/registration"].capture, captureMode);
    assert.deepEqual(stages[prefix + "/fault"], {targetTag: stages[prefix + "/registration"].targetTag, offset, mode, remaining: 1, label: id});
    const cause = mode === "throw" ? "GF pointer query deliberate fault: " + id : "Pointer listener query must return a boolean";
    faultedUp(stages, prefix, captureMode, expected, rows, consumed, cause, true, recoveryRows);
    if (consumed) causes.push(cause);
  }
  // A one-shot getter on the actual canonical.publicInstance, armed after Down,
  // fails the first native read before the SDK; the capture lookup then reads
  // the restored data descriptor and enters the SDK normally.
  const resolverCause = "GF pointer resolver deliberate fault: canonical.publicInstance";
  for (const [id, captureMode, expected, rows] of [["resolver-bubble", false, [], [[37, "delegate", false]]],
    ["resolver-both", "both", ["pointerup-capture", "pointerup-bubble"], [[37, "delegate", true]]]]) {
    const prefix = "fault/" + id, armed = stages[prefix + "/fault"];
    assert.equal(stages[prefix + "/registration"].capture, captureMode);
    assert.ok(armed.actualFiber && armed.actualCanonical && armed.descriptorOwnData && armed.descriptorConfigurable && armed.originalRef && armed.connected && armed.valueTagMatches);
    assert.equal(armed.remaining, 1); assert.equal(armed.targetTag, stages[prefix + "/registration"].targetTag); assert.equal(armed.cause, resolverCause);
    faultedUp(stages, prefix, captureMode, expected, rows, true, resolverCause, false, [[36, "delegate", true]]);
    const resolver = stages[prefix + "/up"].react.resolver;
    assert.ok(!resolver.armed && resolver.remaining === 0 && resolver.descriptorRestored);
    assert.equal(resolver.attempts.length, 1);
    assert.ok(resolver.attempts[0].ownerMatches && resolver.attempts[0].descriptorRestoredBeforeThrow);
    assert.equal(resolver.attempts[0].sdkEntriesBeforeThrow, 0);
    causes.push(resolverCause);
  }
  const b = stages["fault/B-healthy/up"];
  assert.deepEqual(labels(b.react), ["pointerup-bubble", "touchend"]); nativeEvent(b.react, "pointerup-bubble", "topPointerUp"); clean(b.react); terminalClean(b);
  assert.deepEqual(report.faultExpectedErrors, causes); assert.equal(causes.length, 7);
  const stopped = stages["fault/stopped"];
  assert.ok(stopped.stopped && !stopped.pointerListenerQueryInstalled && stopped.rootCount === 0);
  assert.equal(stopped.errors.length, causes.length);
  stopped.errors.forEach((line, index) => assert.ok(line.startsWith("E_POINTER_LISTENER_QUERY: ") && line.includes(causes[index])));
  return causes;
}
function terminalClean(stage, remaining = 0) {
  assert.equal(stage.after.pointer.activePointers, 0); assert.equal(stage.after.pointer.activeTouches, 0);
  assert.deepEqual(stage.application.pointerProcessor, {active: remaining, pendingCapture: 0, activeCapture: 0, hover: remaining});
  for (const key of ["active", "contacts", "stored"]) assert.equal(stage.application.pointerRouting[key], remaining);
}


test("original imperative View pointerup qualifies native interest while original touch and terminal cleanup survive", async () => {
  const before = await publicHash(), bundles = await bundlePointerUpProbe();
  await rm(path.join(root, "build/pointer-up-report.json"), {force: true});
  const binary = await ensureGodotBinary();
  const result = spawnSync(binary, ["--path", root, ...(capture ? [] : ["--headless"]), "--script", "res://tests/pointer-up-probe.gd", "--",
    ...(allowOriginalNegative ? ["--allow-original-negative"] : []), ...(capture ? ["--capture"] : [])], {encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, "build/pointer-up-" + lane + ".log"), log);
  const bytes = await optionalFile("build/pointer-up-report.json"), report = bytes == null ? null : JSON.parse(bytes);
  if (report != null) {
    report.provenance = {node: process.version, bundles, publicBundleSha256: before,
      nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, "build/pointer-up-" + lane + "-report.json"), JSON.stringify(report, null, 2) + "\n");
  }
  // Save actual artifacts before assertions. The old-host flag never accepts
  // unrelated failures or removes the eight normative failures from the report.
  assert.equal(result.error, undefined, log); assert.equal(result.signal, null, log); assert.equal(result.status, 0, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use|Inconsistency between local and platform pointer registries/);
  assert.equal(report.scenario, "native-pointer-up-view-interest"); assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, capture ? "macOS" : "headless"); assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  assert.equal(report.captureRequested, capture); assert.equal(report.captures.length, capture ? 2 : 0);
  assert.equal(report.originalNegativeObserved, allowOriginalNegative); assert.equal(report.allCurrentAssertionsPassed, !allowOriginalNegative);
  for (const [index, frame] of report.captures.entries()) {
    const updated = index === 1, starts = updated ? 1 : 0, ups = updated ? 1 : 0;
    assert.equal(frame.file, "build/pointer-up-" + (updated ? "updated" : "initial") + ".png");
    assert.equal(frame.width, 680); assert.equal(frame.height, 160);
    assert.deepEqual(frame.expectedReactCounters, {A: {starts, ups}, B: {starts, ups: 0}});
    assert.equal(frame.reactCounters.A.starts, starts); assert.equal(frame.reactCounters.B.starts, starts);
    assert.equal(frame.reactCounters.A.ups, ups); assert.equal(frame.reactCounters.B.ups, 0);
    assert.deepEqual(frame.pixels.map(row => row.point), [[5, 5], [75, 55], [25, 127], [43, 127], [25, 145], [43, 145],
      [345, 5], [415, 55], [365, 127], [383, 127], [365, 145], [383, 145]]);
    assert.deepEqual(frame.pixels.map(row => row.expected), ["0f172aff", "2563ebff", "fde047ff", updated ? "fde047ff" : "0f172aff", "22c55eff", updated ? "22c55eff" : "0f172aff",
      "0f172aff", "2563ebff", "fde047ff", updated ? "fde047ff" : "0f172aff", "22c55eff", "0f172aff"]);
    const image = decodeNativePng(await readFile(path.join(root, frame.file)), 680, 160);
    assert.equal(image.width, frame.width); assert.equal(image.height, frame.height);
    for (const row of frame.pixels) {
      assert.equal(row.color, row.expected, "Actual native viewport readback agrees with the fixed declared React stage");
      assert.equal(image.color(...row.point), row.expected, "Independently decoded saved PNG agrees with the actual pixel report");
    }
  }

  const base = row => !row.name.startsWith("up-capture/") && !row.name.startsWith("fault/");
  assert.equal(report.checks.filter(base).length, 63, "All executed base check IDs remain present");
  assert.equal(report.checks.filter(row => row.name.startsWith("fault/")).length, allowOriginalNegative ? 0 : FAULT_CHECKS, "The old-host control never reaches the second-application fault phase");
  assert.equal(report.checks.filter(row => row.name.startsWith("up-capture/")).length, capture ? 28 : 0, "Twelve actual pixels plus counters and save/dimensions per native frame");
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.deepEqual([...report.expectedOriginalFailures].sort(), [...expectedFailures].sort());
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  assert.deepEqual([...failures].sort(), allowOriginalNegative ? [...expectedFailures].sort() : [], "Only eight visible Up normative failures qualify as the old-host control");
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual([...checkErrors].sort(), [...failures].sort());
  // Only the second application's configured faults print native diagnostics.
  const nativeErrors = [...log.matchAll(/^ERROR: FABRIC_ERROR: (.+)$/gm)].map(match => match[1]);
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length + nativeErrors.length, "No diagnostic or unrelated error is hidden");
  const faultCauses = allowOriginalNegative ? [] : componentFaults(report);
  assert.deepEqual(report.faultExpectedErrors, faultCauses); assert.equal(nativeErrors.length, faultCauses.length);
  nativeErrors.forEach((line, index) => assert.ok(line.startsWith("E_POINTER_LISTENER_QUERY: ") && line.includes(faultCauses[index])));
  assert.match(log, allowOriginalNegative ? /POINTER_UP_ORIGINAL_NEGATIVE: 8/ : /POINTER_UP_PASSED: \d+/);
  assert.equal(bundles.nativeDispatchMode, "experimental"); assert.equal(bundles.pointerInterestMode, "current");
  for (const file of ["tests/pointer-up-fixture.jsx", "tests/pointer-up-probe.gd", "tests/pointer-up-native.test.mjs",
    "tests/pointer-query-fault-bootstrap.js", "tests/pointer-query-fault-fixture.jsx", "tests/pointer-query-fault-probe.gd",
    "src/pointer-listener-query.js", "sdk/toolchain/rn-pointer-interest-overlay.mjs", "scripts/rn-pointer-overlay.mjs", "native/application_runtime.cpp"])
    assert.match(bundles.sources[file], /^[0-9a-f]{64}$/, "Pin every reused producer and SDK/native seam: " + file);
  for (const file of ["ReactCommon/react/renderer/components/view/primitives.h", "ReactCommon/react/renderer/core/EventQueue.cpp",
    "ReactCommon/react/renderer/core/EventQueueProcessor.cpp", "ReactCommon/react/renderer/uimanager/PointerEventsProcessor.cpp",
    "ReactCommon/react/renderer/uimanager/PointerEventsProcessor.h"])
    assert.match(bundles.originalReactNativeSources[file], /^[0-9a-f]{64}$/, "Pin original enum, queue and processor: " + file);
  assert.ok(bundles.bundles.enabled.inputs.includes("node_modules/react-native/src/private/renderer/events/dispatchNativeEvent.js"));
  for (const name of ["A", "B"]) {
    const cap = report.stages["capability" + name];
    assert.ok(cap.original && cap.connected && cap.flags.imperative && cap.flags.nativeDispatch);
    assert.deepEqual(cap.methods, ["function", "function", "function"]); assert.equal(cap.query.installations, 1); assert.ok(cap.query.restoredInstaller);
  }
  for (const id of ["bubble", "capture-only"]) {
    const prefix = "case/" + id, captureOnly = id === "capture-only", label = "pointerup-" + (captureOnly ? "capture" : "bubble");
    const registration = report.stages[prefix + "/registration"], manual = report.stages[prefix + "/manual"];
    assert.equal(registration.type, "pointerup"); assert.equal(registration.capture, captureOnly);
    assert.ok(manual.result.returned && manual.result.cleaned && manual.result.targetMatches && !manual.result.trusted);
    assert.deepEqual(labels(manual.react), [label]); assert.equal(manual.react.events[0].phase, 2); assert.equal(manual.react.events[0].type, "pointerup");
    assert.ok(!manual.react.events[0].trusted && manual.react.events[0].currentMatches && manual.react.events[0].thisMatches && manual.react.events[0].targetMatches);
    assert.deepEqual(manual.react.raw, []); assert.deepEqual(manual.react.query.rows, []);
    assert.equal(manual.react.panels.A.ups, manual.react.baselineUps); clean(manual.react);
    const down = report.stages[prefix + "/down"];
    assert.deepEqual(labels(down.react), ["touchstart"]); nativeEvent(down.react, "touchstart", "topTouchStart"); clean(down.react);
    assert.equal(down.react.panels.A.starts, down.react.baselineStarts + 1); assert.equal(down.react.panels.A.ups, down.react.baselineUps);
    assert.equal(down.after.commits, down.before.commits + 1); assert.equal(down.after.pointer.pointerDowns, down.before.pointer.pointerDowns + 1);
    assert.equal(down.after.pointer.starts, down.before.pointer.starts + 1); assert.equal(down.after.pointer.activePointers, 1); assert.equal(down.after.pointer.activeTouches, 1);
    assert.equal(down.application.pointerProcessor.active, 1); assert.equal(down.application.pointerRouting.contacts, 1);
    assert.ok(down.react.query.rows.length > 0 && down.react.query.rows.every(row => row.action === "delegate" && row.resultKind === "boolean" && row.result === false && [34, 35].includes(row.offset)));
    const up = report.stages[prefix + "/up"], value = up.react;
    nativeEvent(value, "touchend", "topTouchEnd"); clean(value); terminalClean(up);
    assert.equal(up.after.pointer.pointerUps, up.before.pointer.pointerUps + 1); assert.equal(up.after.pointer.ends, up.before.pointer.ends + 1);
    assert.equal(value.panels.A.starts, value.baselineStarts);
    assert.deepEqual(labels(value), allowOriginalNegative ? ["touchend"] : [label, "touchend"]);
    assert.equal(up.observedFilteredUp, allowOriginalNegative); assert.equal(value.panels.A.ups, value.baselineUps + (allowOriginalNegative ? 0 : 1));
    assert.equal(up.after.commits, up.before.commits + (allowOriginalNegative ? 0 : 1)); assert.equal(up.nativeCounterWidth, 20 + value.panels.A.ups * 4);
    if (allowOriginalNegative) {
      assert.deepEqual(value.query.rows, [], "Old Down-only host never enters SDK for Up");
      assert.deepEqual(value.raw.map(row => row.type), ["topTouchEnd", "topTouchEnd"]);
    } else {
      nativeEvent(value, label, "topPointerUp");
      assert.equal(value.events.find(event => event.type === "pointerup").currentPriority, value.discretePriority);
      assert.deepEqual(value.raw.map(row => row.type), ["topPointerUp", "topPointerUp", "topTouchEnd", "topTouchEnd"]);
      assert.deepEqual(value.query.rows.map(row => [row.targetTag, row.offset, row.result]), captureOnly ? [[value.targetTag, 36, false], [value.targetTag, 37, true]] : [[value.targetTag, 36, true]]);
      assert.ok(value.query.rows.every(row => row.action === "delegate" && row.resultKind === "boolean"));
      for (const row of [...value.events.filter(row => row.type === "pointerup"), ...value.raw.filter(row => row.type === "topPointerUp")]) {
        assert.ok(Number.isSafeInteger(row.pointerId) && row.pointerId > 0);
        assert.equal(row.pointerId, value.events.find(event => event.type === "pointerup").pointerId);
        assert.equal(row.buttons, 0); assert.equal(row.pressure, 0); assert.equal(row.pointerType, "touch");
      }
    }
  }
  const bDown = report.stages["sibling-no-listeners/down"], bUp = report.stages["sibling-no-listeners/up"];
  assert.deepEqual(labels(bDown.react), ["touchstart"]); nativeEvent(bDown.react, "touchstart", "topTouchStart"); clean(bDown.react);
  assert.equal(bDown.application.pointerProcessor.active, 2); assert.equal(bDown.application.pointerRouting.active, 2);
  assert.deepEqual(labels(bUp.react), ["touchend"]); nativeEvent(bUp.react, "touchend", "topTouchEnd"); clean(bUp.react); terminalClean(bUp, 1);
  assert.equal(bUp.react.panels.B.ups, 0); assert.equal(bUp.after.commits, bUp.before.commits);
  assert.ok(bUp.react.query.rows.every(row => row.action === "delegate" && row.resultKind === "boolean" && row.result === false && [36, 37].includes(row.offset)));
  if (allowOriginalNegative) assert.deepEqual(bUp.react.query.rows, []);
  else {
    assert.ok(bUp.react.query.rows.length > 0, "Negative B is actually queried rather than only proving absence of delivery");
    assert.deepEqual(bUp.react.query.rows.filter(row => row.targetTag === bUp.react.targetTag).map(row => [row.offset, row.result]), [[36, false], [37, false]], "The actual B phase Maps are consulted before the same-root ancestors");
  }
  const cancel = report.stages["cancel-is-not-up/cancel"];
  assert.deepEqual(labels(cancel.react), ["touchcancel"]); nativeEvent(cancel.react, "touchcancel", "topTouchCancel"); clean(cancel.react); terminalClean(cancel);
  assert.deepEqual(cancel.react.query.rows, []); assert.equal(cancel.react.panels.A.ups, cancel.react.baselineUps);
  assert.equal(cancel.after.commits, cancel.before.commits); assert.equal(cancel.after.pointer.pointerCancels, cancel.before.pointer.pointerCancels + 1);
  assert.equal(cancel.after.pointer.cancels, cancel.before.pointer.cancels + 1);
  assert.equal(report.stages.beforeStop.react.panels.A.starts, 3); assert.equal(report.stages.beforeStop.react.panels.B.starts, 1);
  assert.equal(report.stages.beforeStop.react.panels.A.ups, allowOriginalNegative ? 0 : 2); assert.equal(report.stages.beforeStop.react.panels.B.ups, 0);
  assert.deepEqual(report.afterStop.errors, []); assert.ok(report.afterStop.stopped && !report.afterStop.pointerListenerQueryInstalled && report.afterStop.rootCount === 0);
  for (const key of ["pendingWork", "pendingTimers", "pendingAnimationFrames", "pendingRootRetirements"]) assert.equal(report.afterStop[key], 0);
  assert.deepEqual(report.afterStop.pointerProcessor, {active: 0, pendingCapture: 0, activeCapture: 0, hover: 0});
  assert.equal(report.afterStop.pointerRouting.contacts, 0); assert.equal(report.afterStop.pointerRouting.stored, 0);
  for (const name of ["A", "B"]) {
    const owner = report.stages["stoppedRoot" + name];
    assert.equal(owner.nativeTags, 0); assert.equal(owner.creates, owner.deletes); assert.equal(owner.pointer.activePointers, 0); assert.equal(owner.pointer.activeTouches, 0);
  }
  assert.equal(await publicHash(), before);
  if (!allowOriginalNegative) {
    const originalBytes = await optionalFile("build/pointer-up-original-report.json"), original = originalBytes == null ? null : JSON.parse(originalBytes);
    if (original != null) {
      assert.ok(original.originalNegativeObserved); assert.deepEqual(original.checks.filter(base).map(row => row.name),
        report.checks.filter(base).map(row => row.name), "Native capture and the second-application faults only add separate checks");
      assert.deepEqual(original.provenance.bundles.originalReactNativeSources, bundles.originalReactNativeSources);
      // The final causal control executes the current SDK bundle on both hosts.
      // Only the two verified native producer sources differ.
      assert.equal(original.provenance.bundles.bundles.enabled.sha256, bundles.bundles.enabled.sha256);
      for (const [file, sha] of Object.entries(bundles.sources))
        if (!["native/application_runtime.cpp", "scripts/rn-pointer-overlay.mjs"].includes(file))
          assert.equal(original.provenance.bundles.sources[file], sha, "Old/new hosts share actual current reproducer and SDK producer: " + file);
      assert.notEqual(original.provenance.nativeHostSha256, report.provenance.nativeHostSha256);
    }
    await writeFile(path.join(root, capture ? "build/pointer-up-capture-comparison.json" : "build/pointer-up-comparison.json"), JSON.stringify({scenario: report.scenario, originalControlPresent: original != null,
      sameCurrentSDKBundleRequired: true, intentionalNativeProducerDifferences: ["native/application_runtime.cpp", "scripts/rn-pointer-overlay.mjs"], original, current: report}, null, 2) + "\n");
  }
});
