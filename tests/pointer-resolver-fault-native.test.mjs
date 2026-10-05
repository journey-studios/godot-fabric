import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {assertTerminalInterestQueries} from "./pointer-terminal-query-assertions.mjs";
import {bundlePointerResolverFaultProbe} from "../scripts/event-target-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const capture = process.argv.includes("--capture");
assert.ok(!capture || !allowOriginalNegative, "Native graphical captures are only the corrected-host lane");
const lane = allowOriginalNegative ? "original" : "current";
const digest = value => createHash("sha256").update(value).digest("hex");
const prefix = "case/canonical-publicInstance";
const cause = "GF pointer resolver deliberate fault: canonical.publicInstance";
const expectedFailures = [prefix + "/Same-batch TouchStart callback survives resolver failure",
  prefix + "/Same-batch Raw touchstart survives resolver failure", prefix + "/Same-batch TouchStart commits functional React state"];
async function optionalFile(file) {
  try { return await readFile(path.join(root, file)); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function publicHash() { const source = await optionalFile("build/app.js"); return source == null ? null : digest(source); }
const labels = value => value.events.map(row => row.label);
function clean(value) {
  assert.ok(value.globalEventRestored && value.currentPriority === value.defaultPriority);
  assert.equal(value.cleanup.length, value.events.length);
  assert.ok(value.cleanup.every(row => row.originalEvent && row.currentTargetNull && row.phase === 0 && row.pathEmpty));
}
function event(value, label, type) {
  const rows = value.events.filter(row => row.label === label), raw = value.raw.filter(row => row.type === type);
  assert.equal(rows.length, 1); assert.deepEqual(raw.map(row => row.channel), ["typed", "star"]);
  assert.equal(raw[0].payloadId, raw[1].payloadId);
  const row = rows[0];
  assert.ok(row.trusted && row.originalEvent && row.originalSynthetic && row.phase === 2 && row.currentMatches &&
    row.thisMatches && row.targetMatches && row.globalEventMatches);
  assert.equal(row.payloadId, raw[0].payloadId); assert.equal(row.nativeTarget, raw[0].target);
  assert.equal(row.timeStamp, row.nativeTimeStamp); assert.equal(row.timeStamp, raw[0].timeStamp);
  assert.ok(raw[1].sequence < row.sequence);
}

test("one native canonical.publicInstance resolver fault cannot discard the following original TouchStart batch", async () => {
  const before = await publicHash(), bundles = await bundlePointerResolverFaultProbe();
  const generic = path.join(root, "build/pointer-resolver-fault-report.json");
  await rm(generic, {force: true});
  const binary = await ensureGodotBinary();
  const result = spawnSync(binary, ["--path", root, ...(capture ? [] : ["--headless"]), "--script", "res://tests/pointer-resolver-fault-probe.gd", "--",
    ...(allowOriginalNegative ? ["--allow-original-negative"] : []), ...(capture ? ["--capture"] : [])],
    {encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, "build/pointer-resolver-fault-" + lane + ".log"), log);
  const bytes = await optionalFile("build/pointer-resolver-fault-report.json");
  const report = bytes == null ? null : JSON.parse(bytes);
  if (report != null) {
    report.provenance = {node: process.version, bundles, publicBundleSha256: before,
      nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, "build/pointer-resolver-fault-" + lane + "-report.json"), JSON.stringify(report, null, 2) + "\n");
  }
  // Actual artifacts are saved before asserting process or normative success.
  assert.equal(result.error, undefined, log); assert.equal(result.signal, null, log); assert.equal(result.status, 0, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use|Inconsistency between local and platform pointer registries/);
  assert.equal(report.scenario, "native-pointer-public-instance-resolver-fault");
  assert.equal(report.reactNative, "0.87.1"); assert.equal(report.displayServer, capture ? "macOS" : "headless");
  assert.equal(report.captureRequested, capture);
  assert.equal(report.captures.length, capture ? 2 : 0);
  for (const [index, frame] of report.captures.entries()) {
    const updated = index === 1, expectedA = updated ? 2 : 0;
    assert.equal(frame.file, "build/pointer-resolver-fault-" + (updated ? "updated" : "initial") + ".png");
    assert.equal(frame.width, 680); assert.equal(frame.height, 160);
    assert.deepEqual(frame.expectedReactCounters, {A: expectedA, B: 0});
    assert.equal(frame.reactCounters.A.starts, expectedA); assert.equal(frame.reactCounters.B.starts, 0);
    assert.deepEqual(frame.pixels.map(row => row.point), [[5, 5], [75, 55], [25, 127], [47, 127],
      [345, 5], [415, 55], [365, 127], [383, 127]]);
    assert.deepEqual(frame.pixels.map(row => row.expected), ["0f172aff", "2563ebff", "fde047ff", updated ? "fde047ff" : "0f172aff",
      "0f172aff", "2563ebff", "fde047ff", "0f172aff"]);
    assert.ok(frame.pixels.every(row => row.color === row.expected), "Actual native sampled pixels match the exact React stage");
    const image = await readFile(path.join(root, frame.file));
    assert.deepEqual(image.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    assert.equal(image.readUInt32BE(16), 680); assert.equal(image.readUInt32BE(20), 160);
  }
  assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  assert.equal(report.originalNegativeObserved, allowOriginalNegative);
  assert.equal(report.allCurrentAssertionsPassed, !allowOriginalNegative);
  assert.ok(report.checks.length >= 40);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.deepEqual([...report.expectedOriginalFailures].sort(), [...expectedFailures].sort());
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  assert.deepEqual([...failures].sort(), allowOriginalNegative ? [...expectedFailures].sort() : [],
    "Old-host control permits only the three explicitly visible same-batch normative failures");
  const diagnostics = [...log.matchAll(/^ERROR: FABRIC_ERROR: (.+)$/gm)].map(match => match[1]);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.equal(diagnostics.length, 1); assert.ok(diagnostics[0].includes(cause));
  if (!allowOriginalNegative) assert.ok(diagnostics[0].startsWith("E_POINTER_LISTENER_QUERY:"));
  assert.deepEqual([...checkErrors].sort(), [...failures].sort());
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, diagnostics.length + checkErrors.length, "No unrelated failure is hidden");
  assert.match(log, allowOriginalNegative ? /POINTER_RESOLVER_FAULT_ORIGINAL_NEGATIVE: 3/ : /POINTER_RESOLVER_FAULT_PASSED: \d+/);
  assert.deepEqual(report.expectedErrors, [cause]); assert.equal(report.afterStop.errors.length, 1);
  assert.ok(report.afterStop.errors[0].includes(cause));
  assert.equal(bundles.nativeDispatchMode, "experimental"); assert.equal(bundles.pointerInterestMode, "current");
  assert.equal(Object.keys(bundles.sources).length, 18); assert.equal(Object.keys(bundles.originalReactNativeSources).length, 18);
  for (const file of ["tests/pointer-terminal-query-assertions.mjs", "tests/pointer-resolver-fault-bootstrap.js", "tests/pointer-resolver-fault-fixture.jsx",
    "tests/pointer-resolver-fault-probe.gd", "tests/pointer-resolver-fault-native.test.mjs", "tests/pointer-query-fault-bootstrap.js",
    "tests/pointer-query-fault-fixture.jsx", "tests/pointer-query-fault-probe.gd"])
    assert.match(bundles.sources[file], /^[0-9a-f]{64}$/, "Every actual producer, including reused helpers, is pinned: " + file);
  for (const name of ["A", "B"]) {
    const capability = report.stages["capability" + name];
    assert.ok(capability.original && capability.connected && capability.flags.imperative && capability.flags.nativeDispatch);
    assert.equal(capability.query.installations, 1); assert.ok(capability.query.restoredInstaller);
  }
  const configuration = report.stages[prefix + "/configuration"];
  assert.ok(configuration.actualFiber && configuration.actualCanonical && configuration.descriptorOwnData && configuration.descriptorConfigurable &&
    configuration.originalRef && configuration.connected && configuration.valueTagMatches);
  // A touch Down reads the target's over pair and enter pair before its Down
  // lookup (RN's hover tracker runs first). The getter lets exactly those reads
  // through and fails the Down lookup's own read, before any of its SDK entries.
  const healthy = report.stages["positive-before-getter/down"];
  const passThrough = healthy.query.hoverRows.filter(row => row.targetTag === healthy.targetTag).length;
  assert.equal(passThrough, allowOriginalNegative ? 0 : 4);
  assert.equal(configuration.passThrough, passThrough);
  const stage = report.stages[prefix + "/down"], value = stage.react, resolver = value.resolver;
  assert.deepEqual(value.query.hoverRows.filter(row => row.targetTag === value.targetTag).map(row => row.offset),
    allowOriginalNegative ? [] : [26, 28, 23, 0]);
  assert.ok(value.query.hoverRows.every(row => row.action === "delegate" && row.resultKind === "boolean" && row.result === false &&
    value.query.rows.every(other => row.sequence < other.sequence)), "Hover lookups precede the Down lookups and stay false");
  assert.equal(resolver.attempts.length, passThrough + 1);
  assert.ok(resolver.attempts.slice(0, passThrough).every(attempt => attempt.passedThrough && attempt.ownerMatches));
  const thrown = resolver.attempts.at(-1);
  assert.ok(!thrown.passedThrough && thrown.ownerMatches && thrown.descriptorRestoredBeforeThrow);
  assert.equal(thrown.sdkEntriesBeforeThrow, value.query.hoverRows.length);
  assert.equal(thrown.remaining, 0); assert.equal(resolver.remaining, 0);
  assert.ok(!resolver.armed && resolver.descriptorRestored);
  assert.deepEqual(resolver.descriptor, {kind: "data", valueMatches: true, writableMatches: true, enumerableMatches: true, configurableMatches: true});
  assert.ok(value.query.rows.every(row => row.targetTag !== value.targetTag || row.offset !== 34),
    "Failed A offset34 property resolution never reaches the SDK callback");
  if (allowOriginalNegative) assert.deepEqual(value.query.rows, [], "Old resolver escape occurs before any query callback entry");
  else assert.ok(value.query.rows.length > 0 && value.query.rows.every(row => row.action === "delegate" && row.resultKind === "boolean" && row.result === false),
    "After restoration, later healthy offset35/root calls are allowed but cannot qualify the failed bubble interest");
  assert.equal(stage.application.errors.length, 1);
  assert.equal(stage.after.pointer.pointerDowns, stage.before.pointer.pointerDowns + 1);
  assert.equal(stage.after.pointer.starts, stage.before.pointer.starts + 1);
  assert.equal(stage.after.pointer.activePointers, 1); assert.equal(stage.after.pointer.activeTouches, 1);
  assert.equal(stage.application.pointerProcessor.active, 1); assert.equal(stage.application.pointerRouting.contacts, 1);
  assert.deepEqual(labels(value), allowOriginalNegative ? [] : ["touchstart"]);
  assert.equal(value.panels.A.starts, value.baselineStarts + (allowOriginalNegative ? 0 : 1));
  assert.equal(stage.after.commits, stage.before.commits + (allowOriginalNegative ? 0 : 1));
  assert.deepEqual(value.raw.filter(row => row.type === "topPointerDown"), []);
  if (allowOriginalNegative) assert.deepEqual(value.raw, []);
  else event(value, "touchstart", "topTouchStart");
  clean(value);
  for (const [name, owner] of [["positive-before-getter", "A"], ["survivor-while-held", "B"], ["next-gesture", "A"]]) {
    const down = report.stages[name + "/down"], terminal = report.stages[name + "/end"];
    assert.deepEqual(labels(down), ["pointerdown-bubble", "touchstart"]);
    assert.ok(down.events.every(row => row.name === owner));
    event(down, "pointerdown-bubble", "topPointerDown"); event(down, "touchstart", "topTouchStart"); clean(down);
    assert.equal(down.panels[owner].starts, down.baselineStarts + 1);
    assert.deepEqual(labels(terminal), ["touchend"]); event(terminal, "touchend", "topTouchEnd"); clean(terminal);
    assertTerminalInterestQueries(terminal.query.rows);
  }
  for (const id of ["positive-before-getter", prefix]) {
    const manual = report.stages[id + "/manual"];
    assert.deepEqual(labels(manual.react), ["pointerdown-bubble"]);
    assert.ok(manual.result.returned && manual.result.cleaned && manual.result.targetMatches && !manual.result.trusted);
    assert.deepEqual(manual.react.raw, []); assert.deepEqual(manual.react.query.rows, []);
    assert.deepEqual(manual.react.query.hoverRows, []); clean(manual.react);
  }
  const cancelled = report.stages[prefix + "/terminal"];
  assert.deepEqual(labels(cancelled), ["touchcancel"]); event(cancelled, "touchcancel", "topTouchCancel"); clean(cancelled);
  assert.deepEqual(cancelled.query.rows, []);
  const survivor = report.stages["survivor-while-held/down"];
  assert.ok(survivor.resolver.descriptorRestored && survivor.resolver.attempts.length === passThrough + 1);
  assert.ok(report.stages.beforeStop.react.resolver.descriptorRestored && report.stages.beforeStop.react.resolver.attempts.length === passThrough + 1);
  assert.ok(report.afterStop.stopped && !report.afterStop.pointerListenerQueryInstalled && report.afterStop.rootCount === 0);
  for (const field of ["pendingWork", "pendingTimers", "pendingAnimationFrames", "pendingRootRetirements"]) assert.equal(report.afterStop[field], 0);
  assert.deepEqual(report.afterStop.pointerProcessor, {active: 0, pendingCapture: 0, activeCapture: 0, hover: 0});
  assert.equal(report.afterStop.pointerRouting.contacts, 0); assert.equal(report.afterStop.pointerRouting.stored, 0);
  for (const name of ["A", "B"]) {
    const stopped = report.stages["stoppedRoot" + name];
    assert.equal(stopped.nativeTags, 0); assert.equal(stopped.creates, stopped.deletes);
    assert.equal(stopped.pointer.activePointers, 0); assert.equal(stopped.pointer.activeTouches, 0);
  }
  assert.equal(await publicHash(), before);
  if (!allowOriginalNegative) {
    const originalBytes = await optionalFile("build/pointer-resolver-fault-original-report.json");
    const original = originalBytes == null ? null : JSON.parse(originalBytes);
    if (original != null) {
      assert.ok(original.originalNegativeObserved);
      assert.deepEqual(original.checks.map(row => row.name), report.checks.filter(row => !row.name.startsWith("resolver-capture/")).map(row => row.name),
        "Both native hosts execute identical normative and cleanup check IDs");
      assert.equal(original.provenance.bundles.bundles.enabled.sha256, bundles.bundles.enabled.sha256,
        "Both native hosts consume identical executed JS bundle bytes");
      assert.deepEqual(original.provenance.bundles.originalReactNativeSources, bundles.originalReactNativeSources);
      for (const [file, sha256] of Object.entries(bundles.sources))
        if (!["native/application_runtime.cpp", "scripts/rn-pointer-overlay.mjs"].includes(file)) assert.equal(original.provenance.bundles.sources[file], sha256,
          "Executed old/new native hosts share unchanged reproducer inputs: " + file);
      assert.notEqual(original.provenance.nativeHostSha256, report.provenance.nativeHostSha256);
    }
    await writeFile(path.join(root, "build/pointer-resolver-fault-comparison.json"), JSON.stringify({
      scenario: report.scenario, originalControlPresent: original != null, original, current: report,
    }, null, 2) + "\n");
  }
});
