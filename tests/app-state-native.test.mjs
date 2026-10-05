import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {appStateNativeProducers, bundleAppStateProbe} from "../scripts/app-state-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {verifyAppStateReport} from "./app-state-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const lane = allowOriginalNegative ? "original" : "current";
const digest = value => createHash("sha256").update(value).digest("hex");

async function optionalFile(file) {
  try {
    return await readFile(path.join(root, file));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function runProbe(binary, bundle, label) {
  await rm(path.join(root, "build/app-state-report.json"), {force: true});
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/app-state-probe.gd", "--",
    ...(allowOriginalNegative ? ["--allow-original-negative"] : [])],
  {encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, "build/app-state-" + label + ".log"), log);
  const bytes = await optionalFile("build/app-state-report.json"), report = bytes == null ? null : JSON.parse(bytes);
  if (report != null) {
    report.provenance = {node: process.version, bundle,
      nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, "build/app-state-" + label + "-report.json"), JSON.stringify(report, null, 2) + "\n");
  }
  return {result, log, report};
}

test("Godot lifecycle notifications drive RN's original AppState shared by every root", async () => {
  const bundle = await bundleAppStateProbe();
  const binary = await ensureGodotBinary();
  const {result, log, report} = await runProbe(binary, bundle, lane);
  // Artifacts are saved before assertions. The old-host flag never accepts
  // unrelated failures or removes the normative failures from the report.
  assert.equal(result.error, undefined, log); assert.equal(result.signal, null, log); assert.equal(result.status, 0, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.equal(report.scenario, "native-app-state"); assert.equal(report.reactNative, "0.87.1"); assert.equal(report.displayServer, "headless");
  assert.equal(report.allowOriginalNegative, allowOriginalNegative); assert.equal(report.originalNegativeObserved, allowOriginalNegative);
  assert.equal(report.allCurrentAssertionsPassed, !allowOriginalNegative);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.equal(new Set(report.expectedOriginalFailures).size, report.expectedOriginalFailures.length);
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  assert.deepEqual([...failures].sort(), allowOriginalNegative ? [...report.expectedOriginalFailures].sort() : [],
    "Only the normative lifecycle failures qualify as the old-host control");
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual([...checkErrors].sort(), [...failures].sort());
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length, "No native diagnostic, script or engine error is hidden");
  assert.match(log, allowOriginalNegative ? new RegExp(`APP_STATE_ORIGINAL_NEGATIVE: ${failures.length}`) : /APP_STATE_PASSED: \d+/);
  for (const file of ["tests/app-state-fixture.jsx", "tests/app-state-probe.gd", "tests/app-state-native.test.mjs",
    "tests/app-state-oracle.mjs", "scripts/app-state-bundle.mjs", "src/app-state.js", "src/platform-environment.js", "src/react-native-platform.jsx",
    "sdk/toolchain/platform-plugin.mjs", ...appStateNativeProducers]) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  for (const file of ["Libraries/AppState/AppState.js", "src/private/specs_DEPRECATED/modules/NativeAppState.js",
    "React/CoreModules/RCTAppState.mm", "ReactAndroid/src/main/java/com/facebook/react/modules/appstate/AppStateModule.kt"]) {
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  }
  // Every check that needs the native lifecycle is normative; the remaining
  // checks hold on both hosts.
  assert.ok(report.expectedOriginalFailures.length > 0 && report.expectedOriginalFailures.length < report.checks.length);
  if (allowOriginalNegative) {
    // The preceding host has no AppState module: the first read of the public
    // AppState fails exactly there, while both roots still mount and stop.
    const initial = report.stages.initial;
    assert.equal(initial.js.access.available, false);
    assert.match(initial.js.access.error, /'AppState' could not be found/);
    assert.equal(initial.initial.nativeModule, false);
    assert.equal(initial.lifecycle.state, undefined);
    assert.deepEqual(report.stages.stop.late.log.map(row => [row.root, row.event]), [["A", "cleanup"], ["B", "cleanup"]]);
    return;
  }
  verifyAppStateReport(report);
  const originalBytes = await optionalFile("build/app-state-original-report.json");
  const original = originalBytes == null ? null : JSON.parse(originalBytes);
  if (original != null) {
    assert.ok(original.originalNegativeObserved);
    assert.deepEqual(original.checks.map(row => row.name), report.checks.map(row => row.name));
    assert.deepEqual(original.expectedOriginalFailures, report.expectedOriginalFailures);
    assert.deepEqual(original.provenance.bundle.originalReactNativeSources, bundle.originalReactNativeSources);
    // The same SDK bundle runs on both hosts; only the compiled native
    // producers differ, and their bundle-time pins say nothing about it.
    assert.equal(original.provenance.bundle.bundle.sha256, bundle.bundle.sha256);
    for (const [file, sha] of Object.entries(bundle.sources)) {
      if (!appStateNativeProducers.includes(file)) {
        assert.equal(original.provenance.bundle.sources[file], sha, "Old/new hosts share the reproducer and SDK producer: " + file);
      }
    }
    assert.notEqual(original.provenance.nativeHostSha256, report.provenance.nativeHostSha256);
  }
  await writeFile(path.join(root, "build/app-state-comparison.json"), JSON.stringify({scenario: report.scenario,
    originalControlPresent: original != null, sameSDKBundleRequired: true, intentionalNativeProducerDifferences: appStateNativeProducers,
    original, current: report}, null, 2) + "\n");
});
