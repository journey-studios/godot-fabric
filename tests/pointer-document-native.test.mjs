import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {assertTerminalInterestQueries} from "./pointer-terminal-query-assertions.mjs";
import {bundlePointerDocumentProbe} from "../scripts/event-target-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const capture = process.argv.includes("--capture");
const flagModes = ["disabled", "imperative-only", "internal-only", "enabled"];
const requestedInterest = process.argv.find(value => value.startsWith("--interest="))?.slice("--interest=".length);
const requestedFlag = process.argv.find(value => value.startsWith("--flag="))?.slice("--flag=".length);
assert.ok(requestedInterest == null || ["original", "current"].includes(requestedInterest));
assert.ok(requestedFlag == null || flagModes.includes(requestedFlag));
const interests = requestedInterest == null ? ["original", "current"] : [requestedInterest];
const modes = requestedFlag == null ? flagModes : [requestedFlag];
const digest = value => createHash("sha256").update(value).digest("hex");
const labels = value => value.events.map(row => row.label);
const flags = mode => ({imperative: ["imperative-only", "enabled"].includes(mode), nativeDispatch: ["internal-only", "enabled"].includes(mode)});
const methods = enabled => Array(3).fill(enabled ? "function" : "undefined");
async function optionalFile(filename) {
  try { return await readFile(path.join(root, filename)); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function publicHash() {
  const source = await optionalFile("build/app.js");
  return source == null ? null : digest(source);
}
function clean(value, D) {
  assert.ok(value.globalEventRestored && value.currentPriority === value.defaultPriority);
  assert.equal(value.cleanup.length, value.events.length);
  assert.ok(value.cleanup.every(row => row.currentTargetNull && (!D || row.originalEvent && row.phase === 0 && row.pathEmpty)));
}
function nativeDelivery(stage, expected, phases, name, D, legacy = false) {
  const value = stage.react;
  assert.deepEqual(labels(value), expected);
  assert.deepEqual(value.events.map(row => row.phase), phases);
  assert.ok(value.events.every(row => row.name === name && row.currentMatches && row.targetMatches && row.nativeTarget === value.targetTag));
  clean(value, D);
  assert.equal(value.panels[name].count, value.baselineCount + expected.length);
  const raw = value.raw.filter(row => row.type === "topPointerDown");
  if (expected.length === 0) assert.deepEqual(raw, [], "Absence includes actual Raw delivery, not only callback traces");
  else {
    assert.deepEqual(raw.map(row => row.channel), ["typed", "star"]);
    assert.equal(raw[0].payloadId, raw[1].payloadId);
    assert.ok(value.events.every(row => row.payloadId === raw[0].payloadId && row.nativeTarget === raw[0].target &&
      row.timeStamp === row.nativeTimeStamp && row.timeStamp === raw[0].timeStamp && row.sequence > raw[1].sequence));
    if (legacy) assert.ok(value.events[0].compiledLegacySynthetic && !value.events[0].originalEvent);
    else assert.ok(value.events.every(row => row.trusted && row.originalEvent && row.originalSynthetic && row.thisMatches &&
      row.globalEventMatches && row.targetOriginalElement && row.ownerDocumentMatches && row.type === "pointerdown"));
  }
  assert.equal(stage.after.pointer.pointerDowns, stage.before.pointer.pointerDowns + 1);
  assert.equal(stage.after.pointer.starts, stage.before.pointer.starts + 1);
  assert.equal(stage.after.pointer.activePointers, 1);
  assert.equal(stage.after.pointer.activeTouches, 1);
  assert.equal(stage.application.pointerProcessor.active, 1);
  assert.equal(stage.application.pointerRouting.contacts, 1);
}
function verifyReport({report, result, log, headed, interestMode, flagMode, bundles}) {
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.equal(result.status, 0, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use|Inconsistency between local and platform pointer registries/);
  assert.equal(report.scenario, "native-pointer-document-interest-four-flags");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.flagMode, flagMode); assert.equal(report.interestMode, interestMode);
  assert.equal(report.displayServer, headed ? "macOS" : "headless");
  assert.ok(report.allAssertionsPassed);
  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.checks.filter(row => !row.passed), []);
  assert.ok(report.checks.length >= 180, "Complete real native flags, membership, root lifetime and isolation matrix must execute");
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length, "Each executed check has a unique evidence ID");
  assert.match(log, /POINTER_DOCUMENT_PASSED: \d+/);
  assert.equal(bundles.nativeDispatchMode, "experimental");
  assert.equal(bundles.pointerInterestMode, interestMode);
  assert.equal(Object.keys(bundles.sources).length, 15);
  assert.equal(Object.keys(bundles.originalReactNativeSources).length, 18);
  for (const filename of ["tests/pointer-terminal-query-assertions.mjs","tests/pointer-document-bootstrap.js", "tests/pointer-document-fixture.jsx", "tests/pointer-document-probe.gd", "tests/pointer-document-native.test.mjs"])
    assert.match(bundles.sources[filename], /^[0-9a-f]{64}$/, filename + " is an actual hash-pinned producer");
  assert.match(bundles.bundles[flagMode].sha256, /^[0-9a-f]{64}$/);
  const {imperative: I, nativeDispatch: D} = flags(flagMode), installed = interestMode === "current" && D;
  for (const name of ["A", "B"]) {
    const capability = report.stages["capability" + name];
    assert.deepEqual(capability.flags, flags(flagMode));
    assert.ok(capability.originalDoc && capability.originalElement && capability.docOwnsElement && capability.docConnected &&
      capability.elementConnected && capability.originalRootGetterIdentity && capability.distinctOtherRoot);
    assert.deepEqual(capability.methods.doc, methods(D));
    assert.deepEqual(capability.methods.element, methods(I && D));
    assert.equal(capability.docEventTarget, D); assert.equal(capability.rootEventTarget, D);
    assert.equal(capability.query.installations, installed ? 1 : 0);
    if (installed) assert.ok(capability.query.restoredInstaller);
  }
  assert.deepEqual(report.stages.capabilityA.methods.view, methods(I && D));
  assert.ok(report.stages.capabilityA.docOwnsRef);
  assert.equal(report.stages.capabilityB.methods.view, null);
  assert.ok(report.stages.capabilityB.noRef.publicInstanceNull && !report.stages.capabilityB.noRef.refAssigned);
  const initialNoRef = report.stages["no-ref/before"], afterNoRef = report.stages["no-ref/after"], cold = report.stages["no-ref/cold-positive"];
  assert.ok(initialNoRef.noRef && initialNoRef.handleExists && initialNoRef.canonicalPresent && initialNoRef.publicInstanceNull && !initialNoRef.refAssigned);
  assert.ok(afterNoRef.handleExists && !afterNoRef.refAssigned && !afterNoRef.lazyHelperCalled,
    "After-dispatch lazy materialization is recorded; purity is asserted only inside the real query below");
  assert.ok(cold.publicInstanceNull && !cold.refAssigned && !cold.lazyHelperCalled);
  nativeDelivery(report.stages["no-ref/no-interest/down"], [], [], "B", D);
  if (installed) {
    const rows = report.stages["no-ref/no-interest/down"].react.query.rows.filter(row => row.isRootHandle && row.name === "B");
    assert.ok(rows.length > 0);
    assert.ok(rows.every(row => row.expectedHandle && row.resultKind === "boolean" && row.result === false &&
      row.before.publicInstanceNull && row.after.publicInstanceNull && !row.before.refAssigned && !row.after.refAssigned));
  } else assert.deepEqual(report.stages["no-ref/no-interest/down"].react.query.rows, []);
  const doc = installed ? ["DocC", "DocB"] : [], docPhases = installed ? [1, 3] : [];
  const all = installed ? I ? ["DocC", "RootC", "RootB", "DocB"] : doc : [];
  const allPhases = installed ? I ? [1, 1, 3, 3] : docPhases : [];
  for (const [prefix, name, expected, phases] of [["document/A", "A", doc, docPhases], ["document/B-no-ref", "B", doc, docPhases],
    ["ancestry/A", "A", all, allPhases], ["ancestry/B", "B", all, allPhases],
    ["rerender/listener-persists", "A", all, allPhases], ["retirement/sibling-survives", "B", doc, docPhases],
    ["remount/fresh-document", "A", doc, docPhases]]) nativeDelivery(report.stages[prefix + "/down"], expected, phases, name, D);
  for (const prefix of ["document/A", "document/B-no-ref"]) {
    const manual = report.stages[prefix + "/manual"];
    assert.equal(manual.result.available, D); assert.ok(manual.result.noPrototypeBorrow);
    assert.deepEqual(labels(manual.react), D ? ["DocC", "DocB"] : []);
    assert.ok(manual.react.events.every(row => !row.trusted && row.phase === 2 && row.targetMatches && row.currentMatches && row.thisMatches && row.originalEvent && !row.originalSynthetic));
    assert.deepEqual(manual.react.raw, []); assert.deepEqual(manual.react.query.rows, []);
    clean(manual.react, D);
    if (D) assert.ok(manual.result.returned && manual.result.targetMatches && manual.result.cleaned && !manual.result.trusted);
  }
  if (installed) {
    const positive = report.stages["document/B-no-ref/down"].react.query.rows.filter(row => row.isRootHandle && row.name === "B" && row.result === true);
    assert.ok(positive.length > 0, "Native Doc-only interest is actually reached on a cold no-ref leaf");
    assert.ok(positive.every(row => row.expectedHandle && row.before.publicInstanceNull && row.after.publicInstanceNull &&
      !row.before.refAssigned && !row.after.refAssigned && !row.before.lazyHelperCalled && !row.after.lazyHelperCalled));
  }
  assert.deepEqual(report.stages.identity, {docSame: true, elementSame: true, refSame: true, getterSame: true, revision: 1});
  const elementManual = report.stages["element-only/manual"];
  assert.equal(elementManual.result.available, I && D);
  assert.ok(elementManual.result.noPrototypeBorrow);
  assert.deepEqual(labels(elementManual.react), I && D ? ["RootC", "RootB"] : []);
  assert.ok(elementManual.react.events.every(row => row.phase === 2 && !row.trusted && row.currentMatches && row.thisMatches && row.targetMatches && row.originalEvent));
  assert.deepEqual(elementManual.react.raw, []); assert.deepEqual(elementManual.react.query.rows, []);
  clean(elementManual.react, D);
  assert.deepEqual(report.stages["element-only/configuration"].installed, I && D ? ["RootC", "RootB"] : []);
  nativeDelivery(report.stages["element-only/down"], installed && I ? ["RootC", "RootB"] : [], installed && I ? [1, 3] : [], "A", D);
  for (const kind of ["doc-capture-only", "element-capture-only"]) {
    const label = kind === "doc-capture-only" ? "DocC" : "RootC";
    const supported = D && (kind === "doc-capture-only" || I), delivered = installed && supported;
    const configuration = report.stages[kind + "/configuration"], manual = report.stages[kind + "/manual"];
    assert.deepEqual(configuration.installed, supported ? [label] : [], "Capture-only registry contains no qualifying bubble helper");
    assert.ok(configuration.noPrototypeBorrow);
    assert.equal(manual.result.available, supported);
    assert.ok(manual.result.noPrototypeBorrow);
    assert.deepEqual(labels(manual.react), supported ? [label] : []);
    assert.ok(manual.react.events.every(row => !row.trusted && row.phase === 2 && row.currentMatches && row.thisMatches && row.targetMatches && row.originalEvent && !row.originalSynthetic));
    if (supported) assert.ok(manual.result.returned && !manual.result.trusted && manual.result.targetMatches && manual.result.cleaned);
    assert.deepEqual(manual.react.raw, []); assert.deepEqual(manual.react.query.rows, []);
    assert.equal(manual.react.panels.A.count, manual.react.baselineCount);
    clean(manual.react, D);
    const stage = report.stages[kind + "/down"];
    nativeDelivery(stage, delivered ? [label] : [], delivered ? [1] : [], "A", D);
    if (installed) {
      const rows = stage.react.query.rows.filter(row => row.isRootHandle && row.name === "A");
      const bubble = rows.filter(row => row.offset === 34), captureRows = rows.filter(row => row.offset === 35);
      assert.ok(bubble.length > 0 && captureRows.length > 0, "Both actual root offsets are reached in an isolated capture-only gesture");
      assert.ok(bubble.every(row => row.resultKind === "boolean" && row.result === false), "Bubble offset34 cannot qualify this native Down");
      assert.ok(captureRows.every(row => row.resultKind === "boolean" && row.result === delivered),
        "Capture offset35 alone qualifies supported Doc FT/TT or element TT; FT element stays gated");
      assert.ok(bubble[0].sequence < captureRows[0].sequence);
      assert.ok(rows.every(row => row.expectedHandle && row.action === "delegate" && row.before.handleExists && row.after.handleExists &&
        row.before.canonicalPresent && row.after.canonicalPresent && row.before.publicInstanceNull === row.after.publicInstanceNull &&
        row.before.refAssigned === row.after.refAssigned));
    } else assert.deepEqual(stage.react.query.rows, [], "Original and D=false controls install no query");
  }
  assert.deepEqual(report.stages["isolation/B-only/configuration"].installed, D ? ["DocC", "DocB"] : []);
  assert.ok(report.stages["isolation/B-only/configuration"].noPrototypeBorrow);
  const isolatedA = report.stages["isolation/A-none-B-doc/down"], isolatedB = report.stages["isolation/B-only-positive/down"];
  nativeDelivery(isolatedA, [], [], "A", D);
  nativeDelivery(isolatedB, doc, docPhases, "B", D);
  const sibling = report.stages["isolation/B-unchanged"];
  assert.equal(isolatedA.react.panels.B.count, sibling.counterBefore, "A input cannot mutate the only registered sibling's React state");
  assert.equal(sibling.rootAfter.pointer.pointerDowns, sibling.rootBefore.pointer.pointerDowns);
  assert.equal(sibling.rootAfter.pointer.starts, sibling.rootBefore.pointer.starts);
  assert.equal(sibling.rootAfter.pointer.activePointers, 0); assert.equal(sibling.rootAfter.pointer.activeTouches, 0);
  assert.equal(isolatedB.react.panels.A.count, isolatedA.react.panels.A.count, "Following B positive must leave A unchanged");
  assert.ok(isolatedB.react.events.every(row => row.name === "B"));
  nativeDelivery(report.stages["view-only/down"], installed && I ? ["ViewB"] : [], installed && I ? [2] : [], "A", D);
  for (const kind of ["doc-once", "doc-remove", "doc-abort-pre", "doc-abort-after", "doc-once-consumed"])
    nativeDelivery(report.stages["membership/" + kind + "/down"], installed && kind === "doc-once" ? ["DocB"] : [],
      installed && kind === "doc-once" ? [3] : [], "A", D);
  nativeDelivery(report.stages["jsx-sentinel/down"], ["JSX"], D ? [2] : [null], "A", D, !D);
  const diagnosticExpected = interestMode === "current" && flagMode === "enabled";
  assert.deepEqual(report.expectedErrors, diagnosticExpected ? ["GF document query deliberate fault: root34"] : []);
  const nativeErrors = [...log.matchAll(/^ERROR: FABRIC_ERROR: (.+)$/gm)].map(match => match[1]);
  assert.equal(nativeErrors.length, diagnosticExpected ? 1 : 0);
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, nativeErrors.length, "No extra native or script errors are suppressed");
  if (diagnosticExpected) {
    assert.ok(nativeErrors[0].includes(report.expectedErrors[0]));
    const fault = report.stages["rootfault/throw34/down"].react;
    const attempts = fault.query.rows.filter(row => row.matched);
    assert.equal(attempts.length, 1);
    assert.ok(attempts[0].isRootHandle && attempts[0].expectedHandle && attempts[0].name === "A" && attempts[0].offset === 34 && attempts[0].action === "throw");
    assert.equal(fault.query.fault.remaining, 0);
    assert.deepEqual(labels(fault), ["TouchStart"]);
    assert.ok(fault.events[0].trusted && fault.events[0].originalEvent && fault.events[0].phase === 2 && fault.events[0].currentMatches && fault.events[0].targetMatches);
    assert.deepEqual(fault.raw.map(row => [row.type, row.channel]), [["topTouchStart", "typed"], ["topTouchStart", "star"]]);
    assert.equal(fault.raw[0].payloadId, fault.raw[1].payloadId);
    assert.equal(fault.events[0].payloadId, fault.raw[0].payloadId);
    assert.equal(fault.panels.A.count, fault.baselineCount + 1);
    clean(fault, true);
    nativeDelivery(report.stages["rootfault/throw34/recovery/down"], ["DocC", "DocB"], [1, 3], "A", true);
  }
  const retired = report.stages["retirement/identities"], fresh = report.stages["remount/identities"];
  assert.ok(!retired.docConnected && !retired.elementConnected && retired.oldRootGetterNull);
  assert.ok(fresh.currentDocFresh && fresh.currentElementFresh && fresh.oldRootGetterNull);
  nativeDelivery(report.stages["remount/retained-listeners-inert/down"], [], [], "A", D);
  const retainedManual = report.stages["remount/retained-manual"];
  assert.deepEqual(labels(retainedManual.react), D ? ["OldDoc"] : []);
  assert.equal(retainedManual.result.available, D);
  assert.deepEqual(retainedManual.react.raw, []); assert.deepEqual(retainedManual.react.query.rows, []);
  clean(retainedManual.react, D);
  for (const [key, stage] of Object.entries(report.stages)) {
    if (!key.endsWith("/terminal")) continue;
    assert.equal(stage.root.pointer.activePointers, 0); assert.equal(stage.root.pointer.activeTouches, 0);
    assert.equal(stage.application.pointerProcessor.active, 0); assert.equal(stage.application.pointerRouting.contacts, 0);
    assert.deepEqual(stage.react.events, []); assert.deepEqual(stage.react.raw, []);
    assertTerminalInterestQueries(stage.react.query.rows, {cancel: stage.phase === "cancel", installed: stage.application.pointerListenerQueryInstalled});
  }
  assert.ok(report.afterStop.stopped && !report.afterStop.pointerListenerQueryInstalled && report.afterStop.rootCount === 0);
  assert.equal(typeof report.stages.lateOverride, "string");
  assert.ok(report.stages.lateOverride.length > 0);
  assert.deepEqual(report.stages.finalCapability.flags, flags(flagMode));
  assert.deepEqual(report.stages.finalCapability.methods.doc, methods(D));
  assert.deepEqual(report.stages.finalCapability.methods.element, methods(I && D));
  assert.equal(report.afterStop.errors.length, diagnosticExpected ? 1 : 0);
  for (const field of ["pendingWork", "pendingTimers", "pendingAnimationFrames", "pendingRootRetirements"]) assert.equal(report.afterStop[field], 0);
  assert.deepEqual(report.afterStop.pointerProcessor, {active: 0, pendingCapture: 0, activeCapture: 0, hover: 0});
  assert.equal(report.afterStop.pointerRouting.contacts, 0); assert.equal(report.afterStop.pointerRouting.stored, 0);
  for (const name of ["A", "B"]) {
    const stopped = report.stages["stoppedRoot" + name];
    assert.equal(stopped.nativeTags, 0); assert.equal(stopped.creates, stopped.deletes);
    assert.equal(stopped.pointer.activePointers, 0); assert.equal(stopped.pointer.activeTouches, 0);
  }
  assert.equal(report.captures.length, headed ? 2 : 0);
  for (const frame of report.captures) {
    assert.equal(frame.width, 760); assert.equal(frame.height, 220); assert.equal(frame.pixels.length, 10);
    assert.ok(frame.pixels.every(row => row.color === row.expected));
    if (frame.file.endsWith("updated.png")) { assert.equal(frame.reactCounters.A.count, 2); assert.equal(frame.reactCounters.B.count, 0); }
  }
}

test("native pointerdown reaches original Document ancestry under the exact four RN flag configurations", async () => {
  const before = await publicHash(), binary = await ensureGodotBinary(), results = [], reports = {};
  const nativeHostSha256 = digest(await readFile(path.join(root, "addons/fabric_godot.dylib")));
  // Collect every selected process and durable report before asserting success.
  // This keeps an old native-host causal run visibly red without losing its
  // remaining flag controls or the original SDK lane's independent evidence.
  for (const interestMode of interests) {
    const bundles = await bundlePointerDocumentProbe({interestMode});
    for (const flagMode of modes) {
      const genericReport = path.join(root, "build/pointer-document-report.json");
      await rm(genericReport, {force: true});
      const headed = capture && interestMode === "current" && flagMode === "enabled";
      const result = spawnSync(binary, ["--path", root, ...(headed ? [] : ["--headless"]), "--script", "res://tests/pointer-document-probe.gd", "--",
        "--interest=" + interestMode, "--flag=" + flagMode, ...(headed ? ["--capture"] : [])],
        {encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024});
      const log = (result.stdout ?? "") + (result.stderr ?? "");
      const id = interestMode + "-" + flagMode;
      await writeFile(path.join(root, "build/pointer-document-" + id + ".log"), log);
      const reportBytes = await optionalFile("build/pointer-document-report.json");
      const report = reportBytes == null ? null : JSON.parse(reportBytes);
      if (report != null) {
        report.provenance = {node: process.version, bundles, publicBundleSha256: before, nativeHostSha256,
          sourceReceiptDoesNotCertifyNativeBuild: true};
        await writeFile(path.join(root, "build/pointer-document-" + id + "-report.json"), JSON.stringify(report, null, 2) + "\n");
        reports[id] = report;
      }
      results.push({report, result, log, headed, interestMode, flagMode, bundles});
      assert.equal(await publicHash(), before, "Isolated Document probe preserves the public app bundle after " + id);
      assert.equal(digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), nativeHostSha256,
        "All selected flag/interest controls execute the same compiled native host");
    }
  }
  await writeFile(path.join(root, "build/pointer-document-comparison.json"), JSON.stringify({
    scenario: "native-pointer-document-interest-four-flags", interests, flagModes: modes, nativeHostSha256, reports,
    scope: {actualNativeInput: true, sameNativeHostAcrossControls: true, fourIndependentHermesFlagConfigurations: modes.length === 4,
      listenerRegistryMirrored: false, publicDefaultEnabled: false, hardwareCertified: false},
  }, null, 2) + "\n");
  const errors = [];
  for (const entry of results) {
    try {
      assert.ok(entry.report != null, entry.interestMode + "/" + entry.flagMode + " must preserve an actual native report\n" + entry.log);
      verifyReport(entry);
      for (const frame of entry.report.captures) {
        const bytes = await readFile(path.join(root, frame.file));
        assert.equal(bytes.readUInt32BE(16), 760); assert.equal(bytes.readUInt32BE(20), 220);
      }
    } catch (error) { errors.push(new Error(entry.interestMode + "/" + entry.flagMode + ": " + error.message, {cause: error})); }
  }
  if (results.length > 1) {
    const baseline = results[0].bundles;
    for (const entry of results.slice(1)) {
      assert.deepEqual(entry.bundles.sources, baseline.sources, "Every causal control runs the unchanged authored producer inputs");
      assert.deepEqual(entry.bundles.originalReactNativeSources, baseline.originalReactNativeSources,
        "The complete original RN oracle stays identical across flags and interest controls");
    }
  }
  assert.equal(await publicHash(), before);
  if (errors.length) throw new AggregateError(errors, "Document native probe failed; all selected reports and logs are preserved: " + errors.map(error => error.message).join("\n"));
});
