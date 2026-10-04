import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundlePointerInterestProbe} from "../scripts/event-target-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const capture = process.argv.includes("--capture");
const digest = value => createHash("sha256").update(value).digest("hex");
const labels = react => react.events.map(row => row.label);
const cases = {
  bubble: ["bubble"], capture: ["capture"], both: ["capture", "bubble"], duplicate: ["duplicate"], once: ["once"],
  none: [], "wrong-type": [], "abort-pre": [], "abort-after": [], "remove-final": [], "remove-peer": ["remove-peer"],
  flat: ["flat-capture", "flat-bubble"], mixed: ["jsx", "mixed-imperative"], document: ["document-only"],
};
const manualCases = {...cases, "wrong-type": ["wrong-type"], "abort-after": ["abort-after"],
  "remove-final": ["remove-final"], document: ["document-only"]};
async function publicBundleHash() {
  try { return digest(await readFile(path.join(root, "build/app.js"))); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
function verifyNativeDelivery(react, expected, label) {
  assert.deepEqual(labels(react), expected, label);
  assert.equal(react.cleanup.length, expected.length, label + " cleanup count");
  assert.ok(react.globalEventRestored && react.currentPriority === react.defaultPriority, label + " dispatch context cleanup");
  assert.ok(react.cleanup.every(row => row.currentTargetNull && row.phase === 0 && row.pathEmpty && row.originalEvent), label + " original transient fields cleanup");
  if (expected.length === 0) {
    assert.deepEqual(react.raw, [], label + " must filter Raw down as well as callbacks");
    return;
  }
  assert.ok(react.events.every(row => row.trusted && row.originalSynthetic && row.currentMatches && row.thisMatches &&
    row.targetMatches && row.globalEventMatches && row.type === "pointerdown"), label + " exact trusted original identities");
  assert.deepEqual(react.events.map(row => row.phase), expected.map(value => value === "flat-capture" ? 1 : ["flat-bubble", "document-only"].includes(value) ? 3 : 2), label + " exact event phases");
  assert.deepEqual(react.raw.map(row => row.channel), ["typed", "star"], label + " one Raw delivery per channel");
  assert.equal(react.raw[0].payloadId, react.raw[1].payloadId, label + " same Raw payload");
  assert.ok(react.raw[1].sequence < react.events[0].sequence, label + " Raw precedes both listener paths");
  assert.ok(react.events.every(row => row.payloadId === react.raw[0].payloadId && row.nativeTarget === react.raw[0].target &&
    row.pointerId === react.raw[0].pointerId && row.timeStamp === row.nativeTimeStamp && row.timeStamp === react.raw[0].timeStamp),
    label + " identical payload identity, target and native timestamp");
}

test("actual native pointerdown consults original View EventTarget Maps without a parallel listener registry", async () => {
  const before = await publicBundleHash(), reports = {}, binary = await ensureGodotBinary();
  for (const interestMode of ["original", "current"]) {
    const bundles = await bundlePointerInterestProbe({interestMode});
    const reportPath = path.join(root, "build/pointer-interest-report.json");
    await rm(reportPath, {force: true});
    const headed = capture && interestMode === "current";
    const result = spawnSync(binary, ["--path", root, ...(headed ? [] : ["--headless"]), "--script", "res://tests/pointer-interest-probe.gd",
      "--", "--interest-mode=" + interestMode, ...(headed ? ["--capture"] : [])],
      {encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024});
    const log = (result.stdout ?? "") + (result.stderr ?? "");
    await writeFile(path.join(root, "build/pointer-interest-" + interestMode + ".log"), log);
    assert.equal(result.error, undefined, log);
    assert.equal(result.signal, null, log);
    assert.equal(result.status, 0, log);
    assert.doesNotMatch(log, /SCRIPT ERROR|^ERROR:|Program crashed|ObjectDB instances leaked|Resources still in use|FABRIC_CHECK_FAILED|Inconsistency between local and platform pointer registries/m);
    assert.match(log, /POINTER_INTEREST_PASSED: \d+/);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    report.provenance = {node: process.version, bundles, publicBundleSha256: before,
      nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib")))};
    await writeFile(path.join(root, "build/pointer-interest-" + interestMode + "-report.json"), JSON.stringify(report, null, 2) + "\n");
    assert.equal(report.scenario, "original-EventTarget-pointerdown-interest");
    assert.equal(report.reactNative, "0.87.1");
    assert.equal(report.interestMode, interestMode);
    assert.equal(report.displayServer, headed ? "macOS" : "headless");
    assert.deepEqual(report.checks.filter(row => !row.passed), []);
    assert.ok(report.checks.length >= 100, "Probe must execute the full native membership and retirement matrix");
    assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length, "Every executed check has a unique evidence name");
    assert.deepEqual(report.scope, {actualNativeInput: true, experimentalNativeDispatch: true, originalFlagsEnabled: true,
      interestType: "View-pointerdown", documentInterestResolved: interestMode === "current", otherPointerTypesResolved: false,
      listenerRegistryMirrored: false, publicDefaultEnabled: false, hardwareCertified: false});
    assert.equal(report.stages.initialApplication.pointerListenerQueryInstalled, interestMode === "current");
    for (const name of ["A", "B"]) {
      const capability = report.stages["capability" + name];
      assert.ok(capability.original && capability.logicalFlat && capability.flatNativeMetricsNull && capability.flatOriginalHandleLive,
        "The flattened path must retain an original logical ref without a Control: " + name);
      assert.deepEqual(capability.methods, ["function", "function", "function"]);
      assert.ok(capability.flags.imperative && capability.flags.nativeDispatch);
      assert.equal(capability.queries.available, interestMode === "current");
    }
    for (const [kind, currentExpected] of Object.entries(cases)) {
      const prefix = "case/" + kind, manual = report.stages[prefix + "/manual"], stage = report.stages[prefix + "/native"];
      assert.deepEqual(labels(manual.react), manualCases[kind], prefix + " independently exercises the same original listeners");
      assert.ok(manual.result.returned && manual.result.cleaned && !manual.result.trusted && manual.result.targetMatches,
        prefix + " original public dispatch is untrusted and cleans transient fields");
      assert.deepEqual(manual.react.raw, [], prefix + " public dispatch must not fabricate native Raw delivery");
      assert.equal(manual.react.cleanup.length, manualCases[kind].length);
      assert.ok(manual.react.events.every(row => !row.trusted && row.currentMatches && row.thisMatches && row.targetMatches));
      assert.ok(manual.react.cleanup.every(row => row.originalEvent && row.currentTargetNull && row.phase === 0 && row.pathEmpty));
      const expected = interestMode === "current" || kind === "mixed" ? currentExpected : [];
      verifyNativeDelivery(stage.react, expected, interestMode + "/" + prefix);
      assert.equal(stage.after.pointer.pointerDowns, stage.before.pointer.pointerDowns + 1, prefix + " receives a real Godot pointer sample");
      assert.equal(stage.after.pointer.activePointers, 1, prefix + " is not a vacuous no-input negative");
      if (interestMode === "current" && expected.length > 0)
        assert.equal(stage.react.panels.A.count, stage.react.baselineCount + expected.length, prefix + " executes functional React state updates");
      if (interestMode === "current" && ["abort-after", "remove-final"].includes(kind)) {
        const mutation = report.stages[prefix + "/mutation"];
        assert.equal(mutation.before.bubble, true);
        assert.equal(mutation.after.bubble, false);
        assert.equal(mutation.after.capture, false);
      }
    }
    for (const kind of ["once", "remove-peer"])
      verifyNativeDelivery(report.stages["case/" + kind + "/next"], [], interestMode + "/" + kind + "/next-membership");
    assert.equal(report.stages["case/abort-after/mutation"].aborted, true);
    if (interestMode === "current") {
      assert.equal(report.stages["case/once/native"].react.events[0].queryBefore.bubble, false, "once removal precedes its real callback");
      assert.equal(report.stages["case/duplicate/native"].react.events[0].queryBefore.bubble, true, "duplicate registration cannot replace original once options");
      const peer = report.stages["case/remove-peer/native"].react.events[0];
      assert.equal(peer.queryBefore.bubble, true, "The not-yet-removed peer alone supplies current native interest");
      assert.equal(peer.queryAfter.bubble, false, "Removing that peer changes the original Map during dispatch");
      const captureOnly = report.stages["case/capture/configuration"].queries;
      assert.equal(captureOnly.capture, true);
      assert.equal(captureOnly.bubble, false);
      const documentOnly = report.stages["case/document/configuration"];
      assert.equal(documentOnly.documentQueries.bubble, true, "The document-only case has an actual installed original listener");
      assert.ok(!documentOnly.queries.bubble && !documentOnly.queries.capture && !documentOnly.flatQueries.bubble && !documentOnly.flatQueries.capture,
        "No View helper listener supplies the document-only native interest");
    }
    verifyNativeDelivery(report.stages.mixedAfterRemoval, ["jsx"], interestMode + "/JSX-after-imperative-removal");
    assert.ok(report.stages.rerender.sameRef && report.stages.rerender.sameTag);
    verifyNativeDelivery(report.stages.rerenderNative, interestMode === "current" ? ["bubble"] : [], interestMode + "/rerender-retains-listener");
    for (const [stageName, retainedLabel] of [["replacementManual", "retained-replacement"], ["rootManual", "retained-root"]]) {
      const stage = report.stages[stageName];
      assert.deepEqual(labels(stage.react), [retainedLabel], "Retirement negative has a still-functional original self listener");
      assert.ok(stage.result.cleaned && !stage.result.trusted && stage.result.targetMatches);
      assert.deepEqual(stage.react.raw, []);
    }
    assert.ok(report.stages.replaced.parentNull && !report.stages.replaced.connected && report.stages.replaced.nativeLookupNull && report.stages.replaced.nativeMetricsNull && !report.stages.replaced.sameAsCurrent);
    verifyNativeDelivery(report.stages.replacementNative, [], interestMode + "/retired-keyed-ref-native-negative");
    assert.ok(report.stages.retiredRoot.parentNull && !report.stages.retiredRoot.connected && report.stages.retiredRoot.nativeLookupNull);
    verifyNativeDelivery(report.stages.survivor, interestMode === "current" ? ["bubble"] : [], interestMode + "/other-root-survives");
    assert.ok(!report.stages.afterRemount.sameAsCurrent && report.stages.afterRemount.nativeLookupNull);
    verifyNativeDelivery(report.stages.remountNative, [], interestMode + "/old-root-ref-cannot-deliver-after-remount");
    verifyNativeDelivery(report.stages.beforeStopReact, interestMode === "current" ? ["bubble"] : [], interestMode + "/held-contact-before-stop");
    assert.deepEqual(report.stages.beforeStopReact.mounts, {A: 2, B: 1});
    assert.equal(report.stages.beforeStopReact.cleanups.A, 1);
    assert.ok(report.afterStop.stopped && !report.afterStop.pointerListenerQueryInstalled && report.afterStop.rootCount === 0);
    assert.deepEqual(report.afterStop.errors, []);
    assert.ok(report.afterStop.pendingWork === 0 && report.afterStop.pendingTimers === 0 && report.afterStop.pendingAnimationFrames === 0 && report.afterStop.pendingRootRetirements === 0);
    assert.ok(report.afterStop.pointerRouting.contacts === 0 && report.afterStop.pointerRouting.stored === 0);
    assert.equal(report.captures.length, headed ? 2 : 0);
    if (headed) {
      assert.ok(report.captures.every(row => row.width === 820 && row.height === 280 && row.pixels.length === 14));
      const [beforeFrame, afterFrame] = report.captures;
      assert.notEqual(beforeFrame.pixels[6].color, afterFrame.pixels[6].color, "Actual committed functional state expands the visible count bar");
    }
    assert.equal(await publicBundleHash(), before, "Isolated pointer-interest validation preserves the public app bundle");
    reports[interestMode] = report;
  }
  const original = reports.original.provenance.bundles, current = reports.current.provenance.bundles;
  assert.deepEqual(original.sources, current.sources, "Both runs use identical authored source inputs");
  assert.deepEqual(original.originalReactNativeSources, current.originalReactNativeSources, "Both runs use the same pinned original RN oracle");
  assert.deepEqual(original.parentOverlay, current.parentOverlay);
  assert.deepEqual(original.rendererTagOverlay, current.rendererTagOverlay);
  assert.equal(original.nativeDispatchMode, "experimental");
  assert.equal(current.nativeDispatchMode, "experimental");
  assert.equal(original.pointerInterestMode, "original");
  assert.equal(current.pointerInterestMode, "current");
  assert.equal(original.pointerInterestOverlay.generatedSourceSha256, original.pointerInterestOverlay.originalSha256,
    "The control retains byte-identical original EventTarget source");
  assert.equal(current.pointerInterestOverlay.originalSha256, original.pointerInterestOverlay.originalSha256);
  assert.notEqual(current.pointerInterestOverlay.generatedSourceSha256, current.pointerInterestOverlay.originalSha256,
    "Current query is a distinct guarded Map-reader overlay");
  assert.equal(reports.original.provenance.nativeHostSha256, reports.current.provenance.nativeHostSha256,
    "Causal mode comparison runs the identical compiled native host");
  for (const kind of Object.keys(cases))
    assert.deepEqual(labels(reports.original.stages["case/" + kind + "/manual"].react), labels(reports.current.stages["case/" + kind + "/manual"].react),
      "Changing native interest preserves original public listener semantics: " + kind);
  await writeFile(path.join(root, "build/pointer-interest-comparison.json"), JSON.stringify({scenario: "original-EventTarget-pointerdown-interest",
    scope: reports.current.scope, reports}, null, 2) + "\n");
});
