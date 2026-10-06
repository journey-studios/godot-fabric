import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {appearanceNativeProducers, bundleAppearanceProbe} from "../scripts/appearance-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {verifyAppearanceReport} from "./appearance-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// The preceding host has no Appearance module; the pre-fix host registered one
// system theme callback per application, so the last one displaced the others.
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const allowPrefixNegative = process.argv.includes("--allow-prefix-negative");
const lane = allowOriginalNegative ? "original" : allowPrefixNegative ? "prefix" : "current";
const negative = allowOriginalNegative || allowPrefixNegative;
const digest = value => createHash("sha256").update(value).digest("hex");

async function optionalReport(file) {
  const bytes = await optionalFile(file);
  return bytes == null ? null : JSON.parse(bytes);
}

// A control replays the same SDK bundle and reproducer; only the compiled
// native producers differ, and their bundle-time pins say nothing about it.
function assertSameReproducer(control, report, bundle, label) {
  assert.deepEqual(control.checks.map(row => row.name), report.checks.map(row => row.name), label);
  assert.deepEqual(control.expectedOriginalFailures, report.expectedOriginalFailures, label);
  assert.deepEqual(control.expectedPreFixFailures, report.expectedPreFixFailures, label);
  assert.deepEqual(control.provenance.bundle.originalReactNativeSources, bundle.originalReactNativeSources, label);
  assert.equal(control.provenance.bundle.bundle.sha256, bundle.bundle.sha256, label);
  for (const [file, sha] of Object.entries(bundle.sources)) {
    if (!appearanceNativeProducers.includes(file)) {
      assert.equal(control.provenance.bundle.sources[file], sha, label + " shares the reproducer and SDK producer: " + file);
    }
  }
  assert.notEqual(control.provenance.nativeHostSha256, report.provenance.nativeHostSha256, label);
}

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
  await rm(path.join(root, "build/appearance-report.json"), {force: true});
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/appearance-probe.gd", "--",
    ...(allowOriginalNegative ? ["--allow-original-negative"] : []), ...(allowPrefixNegative ? ["--allow-prefix-negative"] : [])],
  {encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, "build/appearance-" + label + ".log"), log);
  const bytes = await optionalFile("build/appearance-report.json");
  const report = bytes == null ? null : JSON.parse(bytes);
  if (report != null) {
    report.provenance = {node: process.version, bundle,
      nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, "build/appearance-" + label + "-report.json"), JSON.stringify(report, null, 2) + "\n");
  }
  return {result, log, report};
}

test("Godot's system theme and setColorScheme drive RN's original Appearance and useColorScheme", async () => {
  const bundle = await bundleAppearanceProbe();
  const binary = await ensureGodotBinary();
  const {result, log, report} = await runProbe(binary, bundle, lane);
  // Artifacts are saved before assertions. The old-host flags never accept
  // unrelated failures or remove the declared failures from the report.
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.equal(result.status, 0, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.equal(report.scenario, "native-appearance");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.scope.headlessDisplayServerThemeSupported, false);
  assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  assert.equal(report.originalNegativeObserved, allowOriginalNegative);
  assert.equal(report.allowPrefixNegative, allowPrefixNegative);
  assert.equal(report.prefixNegativeObserved, allowPrefixNegative);
  assert.equal(report.allCurrentAssertionsPassed, !negative);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.equal(new Set(report.expectedOriginalFailures).size, report.expectedOriginalFailures.length);
  assert.equal(new Set(report.expectedPreFixFailures).size, report.expectedPreFixFailures.length);
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const expectedFailures = allowOriginalNegative ? report.expectedOriginalFailures : allowPrefixNegative ? report.expectedPreFixFailures : [];
  assert.deepEqual([...failures].sort(), [...expectedFailures].sort(),
    "Only the declared failures qualify as a control: the normative ones or the shared-callback ones");
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual([...checkErrors].sort(), [...failures].sort());
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length, "No native diagnostic, script or engine error is hidden");
  assert.match(log, allowOriginalNegative ? new RegExp(`APPEARANCE_ORIGINAL_NEGATIVE: ${failures.length}`)
    : allowPrefixNegative ? new RegExp(`APPEARANCE_PREFIX_NEGATIVE: ${failures.length}`) : /APPEARANCE_PASSED: \d+/);
  for (const file of ["tests/appearance-fixture.jsx", "tests/appearance-probe.gd", "tests/appearance-native.test.mjs",
    "tests/appearance-oracle.mjs", "scripts/appearance-bundle.mjs", "scripts/native-probe-bundle.mjs",
    "src/platform-environment.js", "src/react-native-platform.jsx", "sdk/toolchain/platform-plugin.mjs",
    ...appearanceNativeProducers]) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  for (const file of ["Libraries/Utilities/Appearance.js", "Libraries/Utilities/useColorScheme.js",
    "src/private/specs_DEPRECATED/modules/NativeAppearance.js", "React/CoreModules/RCTAppearance.mm",
    "ReactAndroid/src/main/java/com/facebook/react/modules/appearance/AppearanceModule.kt"]) {
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  }
  // Every check that needs the native module is normative; the remaining
  // checks hold on both hosts. The shared-callback checks are normative too,
  // and all belong to the stage where two applications observe at once.
  assert.ok(report.expectedOriginalFailures.length > 0 && report.expectedOriginalFailures.length < report.checks.length);
  assert.ok(report.expectedPreFixFailures.length > 0);
  for (const name of report.expectedPreFixFailures) {
    assert.ok(report.expectedOriginalFailures.includes(name), name);
    assert.match(name, /^two-applications\//);
  }
  if (allowPrefixNegative) {
    // The second application's registration displaced the first's: the first
    // never hears a change, while the second keeps hearing them after it stops.
    const pair = report.stages["two-applications"];
    assert.deepEqual(report.stages.initial.owner, {});
    assert.equal(report.stages.initial.native.callbackRegistered, true);
    assert.equal(pair.both.after.P.native.notifications, 0);
    assert.equal(pair.both.after.P.js.colorScheme, "dark");
    assert.equal(pair.both.after.Q.native.notifications, 1);
    assert.equal(pair.both.after.Q.js.colorScheme, "light");
    assert.equal(pair["second-stopped"].after.Q.native.notifications, 2);
    assert.equal(pair["second-stopped"].after.Q.native.observed, false);
    assert.equal(pair["second-freed"].after.P.native.notifications, 0);
    assert.throws(() => verifyAppearanceReport(report), assert.AssertionError, "The independent oracle rejects the pre-fix host");
    return;
  }
  if (allowOriginalNegative) {
    // The preceding host has no Appearance module: RN's Appearance reads null
    // and emits nothing, while both roots still mount and stop.
    const initial = report.stages.initial;
    assert.equal(initial.js.nativeModule, false);
    assert.equal(initial.js.colorScheme, null);
    assert.deepEqual(initial.native, {});
    assert.deepEqual(report.stages.stop.late.log.map(row => [row.root, row.event]), [["A", "cleanup"], ["B", "cleanup"]]);
    return;
  }
  verifyAppearanceReport(report);
  const original = await optionalReport("build/appearance-original-report.json");
  if (original != null) {
    assert.ok(original.originalNegativeObserved);
    assertSameReproducer(original, report, bundle, "preceding host");
  }
  const prefix = await optionalReport("build/appearance-prefix-report.json");
  if (prefix != null) {
    assert.ok(prefix.prefixNegativeObserved);
    assertSameReproducer(prefix, report, bundle, "pre-fix host");
  }
  await writeFile(path.join(root, "build/appearance-comparison.json"), JSON.stringify({scenario: report.scenario,
    originalControlPresent: original != null, prefixControlPresent: prefix != null, sameSDKBundleRequired: true,
    intentionalNativeProducerDifferences: appearanceNativeProducers, original, prefix, current: report}, null, 2) + "\n");
});
