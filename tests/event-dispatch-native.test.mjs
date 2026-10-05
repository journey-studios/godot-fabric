import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleNativeEventDispatchProbe} from "../scripts/event-target-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const digest = value => createHash("sha256").update(value).digest("hex");
async function publicBundleHash() {
  try { return digest(await readFile(path.join(root, "build/app.js"))); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
test("original native dispatcher executes trusted and responder contracts separately from actual legacy input", async () => {
  const before = await publicBundleHash(), reports = {};
  for (const rendererTagMode of ["original", "current"]) {
  const bundles = await bundleNativeEventDispatchProbe({rendererTagMode});
  const reportPath = path.join(root, "build/event-dispatch-report.json");
  await rm(reportPath, {force: true});
  const binary = await ensureGodotBinary();
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/event-dispatch-probe.gd", "--", "--renderer-tag-mode=" + rendererTagMode],
    {encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, "build/event-dispatch-" + rendererTagMode + ".log"), log);
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const failed = report.checks.filter(entry => !entry.passed);
  const expectedFailures = [
    "native-compiled-legacy/inside-two/Native responder owner matches lifecycle at step 2",
    "native-compiled-legacy/inside-two/Exact responder grant start move end release terminate and transfer sequence",
  ];
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|FABRIC_ERROR|ObjectDB instances leaked|Resources still in use/);
  if (rendererTagMode === "original") {
    assert.equal(result.status, 1, log);
    assert.deepEqual(failed.map(entry => entry.name), expectedFailures, "Identical original control must fail exactly the two normative descendant-retention checks");
    assert.deepEqual([...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]), expectedFailures);
    assert.equal([...log.matchAll(/^ERROR:/gm)].length, 2, "No unrelated native errors can be hidden by the negative control");
    assert.match(log, /NATIVE_EVENT_DISPATCH_FAILED/);
  } else {
    assert.equal(result.status, 0, log);
    assert.deepEqual(failed, [], "Corrected renderer must meet every unchanged normative assertion");
    assert.doesNotMatch(log, /(?:^|\n)ERROR:|FABRIC_CHECK_FAILED/);
    assert.match(log, /NATIVE_EVENT_DISPATCH_PASSED/);
  }
  assert.equal(report.scenario, "original-native-event-dispatch");
  assert.equal(report.displayServer, "headless");
  assert.ok(report.checks.length >= 200);
  assert.equal(report.rendererTagMode, rendererTagMode);
  assert.equal(new Set(report.checks.map(entry => entry.name)).size, report.checks.length);
  const gaps = [...report.original.gaps, ...report.legacy.gaps];
  assert.deepEqual(gaps.map(entry => entry.id).sort(), ["outside-contact-withholds-release", "should-currentTarget-retained", "truthy-should-set", "undefined-termination-transfer"].sort());
  assert.ok(gaps.every(entry => entry.observed));
  for (const mode of ["enabled", "disabled"]) {
    const stopped = report.stages[mode + "AfterStop"];
    assert.ok(stopped.stopped && stopped.rootCount === 0 && stopped.pendingWork === 0 && stopped.pendingTimers === 0 && stopped.pendingAnimationFrames === 0 && stopped.errors.length === 0);
  }
  assert.deepEqual(report.scope, {explicitOriginalDispatcher: true, actualCompiledLegacyNativeInput: true,
    nativeEventTargetIntegrated: false, publicDefaultEnabled: false, nativeInterestSolved: false,
    originalResponderUnmodified: true, parentOverlay: "current", rendererTagOverlay: rendererTagMode,
    legacyTouchTagResolutionFixed: rendererTagMode === "current", hardwareCertified: false, mobileCertified: false});
  assert.equal(await publicBundleHash(), before, "Isolated dispatch probes cannot overwrite the public application bundle");
  report.provenance = {node: process.version, bundles, publicBundleSha256: before,
    nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib")))};
  await writeFile(path.join(root, "build/event-dispatch-" + rendererTagMode + "-report.json"), JSON.stringify(report, null, 2) + "\n");
  reports[rendererTagMode] = report;
  }
  assert.deepEqual(reports.original.checks.map(entry => entry.name), reports.current.checks.map(entry => entry.name));
  assert.deepEqual(reports.original.provenance.bundles.sources, reports.current.provenance.bundles.sources);
  assert.deepEqual(reports.original.provenance.bundles.originalReactNativeSources, reports.current.provenance.bundles.originalReactNativeSources);
  assert.equal(reports.original.provenance.nativeHostSha256, reports.current.provenance.nativeHostSha256);
  assert.equal(reports.original.provenance.bundles.rendererTagOverlay.generatedSourceSha256,
    reports.original.provenance.bundles.rendererTagOverlay.originalSha256);
  assert.notEqual(reports.current.provenance.bundles.rendererTagOverlay.generatedSourceSha256,
    reports.current.provenance.bundles.rendererTagOverlay.originalSha256);
  assert.notDeepEqual(reports.original.legacyScenarios["inside-two"].lifecycle, reports.current.legacyScenarios["inside-two"].lifecycle);
  assert.deepEqual(reports.current.legacyScenarios["inside-two"].lifecycle, reports.current.manualScenarios["inside-two"].lifecycle);
  await writeFile(path.join(root, "build/event-dispatch-comparison.json"), JSON.stringify({scenario: "native-touch-tag-resolution-comparison", original: reports.original, current: reports.current}, null, 2) + "\n");
});
