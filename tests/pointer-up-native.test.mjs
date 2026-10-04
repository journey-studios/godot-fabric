import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundlePointerUpProbe} from "../scripts/event-target-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const lane = allowOriginalNegative ? "original" : "current";
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
function terminalClean(stage, remaining = 0) {
  assert.equal(stage.after.pointer.activePointers, 0); assert.equal(stage.after.pointer.activeTouches, 0);
  assert.deepEqual(stage.application.pointerProcessor, {active: remaining, pendingCapture: 0, activeCapture: 0, hover: remaining});
  for (const key of ["active", "contacts", "stored"]) assert.equal(stage.application.pointerRouting[key], remaining);
}

test("original imperative View pointerup qualifies native interest while original touch and terminal cleanup survive", async () => {
  const before = await publicHash(), bundles = await bundlePointerUpProbe();
  await rm(path.join(root, "build/pointer-up-report.json"), {force: true});
  const binary = await ensureGodotBinary();
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/pointer-up-probe.gd", "--",
    ...(allowOriginalNegative ? ["--allow-original-negative"] : [])], {encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024});
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
  assert.equal(report.displayServer, "headless"); assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  assert.equal(report.originalNegativeObserved, allowOriginalNegative); assert.equal(report.allCurrentAssertionsPassed, !allowOriginalNegative);
  assert.ok(report.checks.length >= 45); assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.deepEqual([...report.expectedOriginalFailures].sort(), [...expectedFailures].sort());
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  assert.deepEqual([...failures].sort(), allowOriginalNegative ? [...expectedFailures].sort() : [], "Only eight visible Up normative failures qualify as the old-host control");
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual([...checkErrors].sort(), [...failures].sort());
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length, "No diagnostic or unrelated error is hidden");
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
      assert.ok(original.originalNegativeObserved); assert.deepEqual(original.checks.map(row => row.name), report.checks.map(row => row.name));
      assert.deepEqual(original.provenance.bundles.originalReactNativeSources, bundles.originalReactNativeSources);
      // Native + SDK Up implementation can change generated bundle bytes. Pin
      // every causal test producer and the untouched upstream RN independently.
      const implementationInputs = new Set(["native/application_runtime.cpp", "scripts/rn-pointer-overlay.mjs", "sdk/toolchain/rn-pointer-interest-overlay.mjs", "sdk/toolchain/platform-plugin.mjs", "src/pointer-listener-query.js"]);
      for (const [file, sha] of Object.entries(bundles.sources)) if (!implementationInputs.has(file))
        assert.equal(original.provenance.bundles.sources[file], sha, "Old/new hosts share actual reproducer producer: " + file);
      assert.notEqual(original.provenance.nativeHostSha256, report.provenance.nativeHostSha256);
    }
    await writeFile(path.join(root, "build/pointer-up-comparison.json"), JSON.stringify({scenario: report.scenario, originalControlPresent: original != null,
      generatedBundleBytesMayDifferWithSDKUpImplementation: true, original, current: report}, null, 2) + "\n");
  }
});
