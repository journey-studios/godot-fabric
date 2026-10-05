import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleEventTargetAncestryProbe} from "../scripts/event-target-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const digest = content => createHash("sha256").update(content).digest("hex");
const traceNames = value => value.trace.map(entry => entry.id + "/" + entry.label);
const graphNames = value => value.map(entry => entry.label + (entry.capture ? "/capture" : "/bubble"));
async function publicBundleHash() {
  try { return digest(await readFile(path.join(root, "build/app.js"))); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

test("current-ancestry overlay fixes warmed native ref propagation while original dispatch paths remain snapshots", async () => {
  const publicBefore = await publicBundleHash(), binary = await ensureGodotBinary(), reports = {};
  for (const parentMode of ["original", "current"]) {
    const bundles = await bundleEventTargetAncestryProbe({parentMode});
    assert.equal(bundles.parentMode, parentMode);
    const reportPath = path.join(root, "build/event-target-ancestry-report.json");
    const artifact = "event-target-ancestry-" + parentMode;
    await rm(reportPath, {force: true});
    const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/event-target-ancestry-probe.gd", "--", "--parent-mode=" + parentMode],
      {encoding: "utf8", timeout: 45000, maxBuffer: 6 * 1024 * 1024});
    const log = (result.stdout ?? "") + (result.stderr ?? "");
    await writeFile(path.join(root, "build", artifact + ".log"), log);
    assert.equal(result.error, undefined, log);
    assert.equal(result.status, 0, "signal=" + result.signal + "\n" + log);
    assert.equal(result.signal, null, log);
    assert.doesNotMatch(log, /SCRIPT ERROR|(?:^|\n)ERROR:|Program crashed|FABRIC_CHECK_FAILED|FABRIC_ERROR|ObjectDB instances leaked|Resources still in use/);
    assert.match(log, /EVENT_TARGET_ANCESTRY_PASSED/);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.scenario, "event-target-current-ancestry");
    assert.equal(report.reactNative, "0.87.1");
    assert.equal(report.parentMode, parentMode);
    assert.equal(report.displayServer, "headless");
    assert.ok(report.checks.length >= 75);
    assert.ok(report.checks.every(entry => entry.passed), JSON.stringify(report.checks.filter(entry => !entry.passed)));
    assert.equal(new Set(report.checks.map(entry => entry.name)).size, report.checks.length);
    for (const name of ["A", "B"]) assert.equal(report.stages["manual" + name].checks.length, 7);
    for (const key of ["itemsRemoved", "ancestorRemoved", "rootRemoved", "oldRootAfterRemount"]) {
      const stage = report.stages[key];
      assert.ok(stage.warmParentNull && stage.coldParentNull && !stage.warmConnected && !stage.coldConnected);
      assert.deepEqual(traceNames(stage), stage.expected);
      assert.deepEqual(traceNames(stage).filter(value => value.startsWith("cold/")), ["cold/self"]);
      assert.equal(traceNames(stage).some(value => value === "warm/parent"), parentMode === "original");
    }
    assert.deepEqual(traceNames(report.stages.itemsRemoved), parentMode === "current" ? ["warm/self", "cold/self"] :
      ["warm/self", "warm/flat", "warm/ancestor", "warm/parent", "warm/root", "warm/document", "cold/self"]);
    const graph = report.stages.mutableGraph;
    assert.ok(graph.originalObjects);
    assert.deepEqual(graphNames(graph.first), ["root/capture", "old/capture", "self/capture", "self/bubble", "old/bubble", "root/bubble"]);
    assert.deepEqual(graphNames(graph.second), parentMode === "current" ?
      ["root/capture", "next/capture", "self/capture", "self/bubble", "next/bubble", "root/bubble"] : graphNames(graph.first));
    assert.deepEqual(graphNames(graph.third), parentMode === "current" ? ["self/capture", "self/bubble"] : graphNames(graph.first));
    assert.deepEqual(graph.nullTrace, parentMode === "current" ? ["self", "next", "root"] : ["self"]);
    assert.equal(graph.selfParentReads, parentMode === "current" ? 3 : 1);
    assert.ok(report.stages.reordered.sameRefs && report.stages.remount.differentRefs && report.stages.remount.differentDocuments);
    assert.deepEqual(report.scope, {manualDispatch: true, parentCacheFixed: parentMode === "current", nativeEventTargetIntegrated: false,
      publicDefaultEnabled: false, nativeReactReparentPreservedIdentity: false, mutableGraphUsesOriginalEventTarget: true});
    assert.equal(await publicBundleHash(), publicBefore, "Ancestry probe cannot overwrite the public default bundle");
    report.provenance = {node: process.version, bundles, publicBundleSha256: publicBefore,
      nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib")))};
    await writeFile(path.join(root, "build", artifact + "-report.json"), JSON.stringify(report, null, 2) + "\n");
    reports[parentMode] = report;
  }
  assert.deepEqual(reports.current.stages.mutableGraph.first, reports.original.stages.mutableGraph.first,
    "Overlay must preserve every callback and frozen path of the dispatch already in progress");
  assert.deepEqual(reports.current.provenance.bundles.sources, reports.original.provenance.bundles.sources,
    "Both variants must execute the identical public fixture, test and toolchain source bytes");
  assert.deepEqual(reports.current.provenance.bundles.originalReactNativeSources,
    reports.original.provenance.bundles.originalReactNativeSources, "Original RN source bytes must remain unchanged");
  assert.equal(reports.current.provenance.nativeHostSha256, reports.original.provenance.nativeHostSha256,
    "Only the generated parent source changes; native host must stay identical");
  assert.equal(reports.current.provenance.bundles.parentOverlay.originalSha256,
    reports.original.provenance.bundles.parentOverlay.generatedSourceSha256);
  assert.notEqual(reports.current.provenance.bundles.parentOverlay.generatedSourceSha256,
    reports.original.provenance.bundles.parentOverlay.generatedSourceSha256);
  assert.notDeepEqual(traceNames(reports.current.stages.itemsRemoved), traceNames(reports.original.stages.itemsRemoved),
    "Actual warmed native ref traces must differ; enabling methods or flags alone is insufficient");
  await writeFile(path.join(root, "build/event-target-ancestry-comparison.json"), JSON.stringify({
    scenario: "event-target-current-ancestry-comparison", reactNative: "0.87.1", original: reports.original, current: reports.current,
    scope: {manualNativeRefs: true, originalParentGapReproduced: true, currentParentFixExecuted: true,
      nativeEventTargetIntegrated: false, publicDefaultEnabled: false, nativeReactReparentPreservedIdentity: false},
  }, null, 2) + "\n");
});
