import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleVirtualizedListProbe, lanes, virtualizedListNativeProducers} from "../scripts/virtualized-list-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {verifyVirtualizedListReport} from "./virtualized-list-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const laneArgument = process.argv.indexOf("--lane");
const lane = laneArgument >= 0 ? process.argv[laneArgument + 1] : "current";
// The preceding host runs the current bundle; its report is the "original" one.
const label = allowOriginalNegative ? "original" : lane;
const digest = value => createHash("sha256").update(value).digest("hex");
const sorted = values => [...values].sort();

async function optionalJson(file) {
  try {
    return JSON.parse(await readFile(path.join(root, file), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function runProbe(binary, bundle) {
  await rm(path.join(root, "build/virtualized-list-report.json"), {force: true});
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/virtualized-list-probe.gd", "--",
    "--lane", lane, ...(allowOriginalNegative ? ["--allow-original-negative"] : [])],
  {encoding: "utf8", timeout: 180000, maxBuffer: 16 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/virtualized-list-${label}.log`), log);
  const report = await optionalJson("build/virtualized-list-report.json");
  if (report != null) {
    report.provenance = {node: process.version, bundle,
      nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, `build/virtualized-list-${label}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  return {result, log, report};
}

// The oracle must reject a sabotaged report on its own derivations, even with
// every probe check marked as passed.
function oracleRejection(report) {
  try {
    verifyVirtualizedListReport({...report, checks: report.checks.map(row => ({...row, passed: true}))});
  } catch (error) {
    return String(error.message).split("\n")[0];
  }
  return null;
}

test("RN's original lists window, report and scroll on the SDK ScrollView under real Godot input", async () => {
  assert.ok(lanes.includes(lane), "Unknown virtualized-list lane " + lane);
  assert.ok(!allowOriginalNegative || lane === "current", "The preceding host runs the current bundle");
  const bundle = await bundleVirtualizedListProbe(lane);
  const binary = await ensureGodotBinary();
  const {result, log, report} = await runProbe(binary, bundle);
  // Artifacts are saved before assertions. A control flag never accepts
  // unrelated failures or removes the expected failures from the report.
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.equal(result.status, 0, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.equal(report.scenario, "native-virtualized-list");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.lane, lane);
  assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  // Every ERROR line is a failed check: no native, script or engine error hides.
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length, "No native diagnostic, script or engine error is hidden");
  for (const file of ["tests/virtualized-list-fixture.jsx", "tests/virtualized-list-probe.gd", "tests/virtualized-list-native.test.mjs",
    "tests/virtualized-list-oracle.mjs", "scripts/virtualized-list-bundle.mjs", "src/lists.js", "src/list-props.mjs",
    "src/scroll-view.jsx", "src/react-native-platform.jsx", "sdk/toolchain/platform-plugin.mjs", ...virtualizedListNativeProducers]) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  for (const file of ["Libraries/Lists/FlatList.js", "Libraries/Lists/SectionList.js", "index.js",
    "ReactCommon/react/renderer/components/scrollview/ScrollEvent.cpp",
    "ReactAndroid/src/main/java/com/facebook/react/views/scroll/ReactScrollViewHelper.kt"]) {
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  }
  assert.match(bundle.originalVirtualizedListSources["Lists/VirtualizedList.js"], /^[0-9a-f]{64}$/);
  if (lane === "preceding-sdk") {
    // The preceding facade: FlatList and VirtualizedList are placeholders that
    // throw, SectionList is no export, and ScrollView rejects
    // scrollEventThrottle. The roots still mount and stop.
    assert.ok(report.negativeObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedPrecedingSdkFailures));
    assert.match(log, new RegExp(`VIRTUALIZED_LIST_PRECEDING_SDK_NEGATIVE: ${failures.length}`));
    assert.deepEqual(sorted(report.renderErrors.map(row => row.case)), ["agenda", "chat", "empty", "feed", "shelf", "ticker"]);
    const message = name => report.renderErrors.find(row => row.case === name).message;
    assert.match(message("feed"), /FlatList/);
    assert.match(message("shelf"), /VirtualizedList/);
    assert.match(message("ticker"), /scrollEventThrottle/);
    assert.ok(report.stages.afterStop.stopped && report.stages.afterStop.rootCount === 0);
    return;
  }
  if (lane === "sabotage") {
    assert.ok(failures.length > 0);
    assert.match(log, new RegExp(`VIRTUALIZED_LIST_SABOTAGE_REJECTED: ${failures.length}`));
    assert.ok(oracleRejection(report) != null, "The oracle rejects the sabotaged report");
    return;
  }
  assert.equal(report.negativeObserved, allowOriginalNegative);
  assert.ok(report.expectedOriginalFailures.length > 0 && report.expectedOriginalFailures.length < report.checks.length);
  if (allowOriginalNegative) {
    // The preceding host drags a flipped ScrollView in page coordinates, so an
    // inverted list moves against the finger, and it sends every scroll event.
    assert.deepEqual(sorted(failures), sorted(report.expectedOriginalFailures),
      "Only the normative ScrollView failures qualify as the old-host control");
    assert.match(log, new RegExp(`VIRTUALIZED_LIST_ORIGINAL_NEGATIVE: ${failures.length}`));
    assert.equal(report.stages["chat/drag"].offsets.chat.y, 0);
    assert.deepEqual([report.stages["ticker/burst"].offsets.ticker.scrolls, report.stages["ticker/burst"].offsets.ticker.throttled],
      [5, undefined]);
    return;
  }
  assert.deepEqual(failures, []);
  assert.match(log, /VIRTUALIZED_LIST_PASSED: \d+/);
  verifyVirtualizedListReport(report);
  const original = await optionalJson("build/virtualized-list-original-report.json");
  if (original != null) {
    assert.ok(original.negativeObserved);
    assert.deepEqual(original.checks.map(row => row.name), report.checks.map(row => row.name));
    assert.deepEqual(original.expectedOriginalFailures, report.expectedOriginalFailures);
    // The same SDK bundle runs on both hosts; only the compiled native
    // producers differ, and their bundle-time pins say nothing about it.
    assert.equal(original.provenance.bundle.bundle.sha256, bundle.bundle.sha256);
    for (const [file, sha] of Object.entries(bundle.sources)) {
      if (!virtualizedListNativeProducers.includes(file)) {
        assert.equal(original.provenance.bundle.sources[file], sha, "Old/new hosts share the reproducer and SDK producer: " + file);
      }
    }
    assert.notEqual(original.provenance.nativeHostSha256, report.provenance.nativeHostSha256);
  }
  const preceding = await optionalJson("build/virtualized-list-preceding-sdk-report.json");
  if (preceding != null) {
    assert.ok(preceding.negativeObserved);
    assert.deepEqual(sorted(preceding.checks.filter(row => !row.passed).map(row => row.name)), sorted(report.expectedPrecedingSdkFailures));
    assert.equal(preceding.provenance.nativeHostSha256, report.provenance.nativeHostSha256);
    assert.notEqual(preceding.provenance.bundle.bundle.sha256, bundle.bundle.sha256);
  }
  const sabotage = await optionalJson("build/virtualized-list-sabotage-report.json");
  const sabotageRejection = sabotage == null ? null : oracleRejection(sabotage);
  if (sabotage != null) {
    assert.ok(sabotage.checks.some(row => !row.passed) && sabotageRejection != null);
    assert.equal(sabotage.provenance.nativeHostSha256, report.provenance.nativeHostSha256);
  }
  await writeFile(path.join(root, "build/virtualized-list-comparison.json"), JSON.stringify({scenario: report.scenario,
    originalControlPresent: original != null, precedingSdkControlPresent: preceding != null, sabotagePresent: sabotage != null,
    intentionalNativeProducerDifferences: virtualizedListNativeProducers,
    originalFailures: original?.checks.filter(row => !row.passed).map(row => row.name) ?? null,
    precedingSdkFailures: preceding?.checks.filter(row => !row.passed).map(row => row.name) ?? null,
    sabotageFailures: sabotage?.checks.filter(row => !row.passed).map(row => row.name) ?? null, sabotageRejection,
    current: {checks: report.checks.length, nativeHostSha256: report.provenance.nativeHostSha256,
      bundleSha256: bundle.bundle.sha256}}, null, 2) + "\n");
});
