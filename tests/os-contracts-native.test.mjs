import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleLane, bundledOriginals, precedingCommit, previousSdkFacade, sabotageNames} from "../scripts/os-contracts-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {verifyOsContractsReport} from "./os-contracts-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// --allow-previous-sdk bundles the same fixture with the SDK that origin/main had before this slice, which exports none
// of these APIs: every check that needs them must fail there while the rest hold. This slice has no native code, so
// that is its control in place of a previous host. --sabotage=<name> bundles the SDK of this slice with one in-memory
// override (scripts/os-contracts-bundle.mjs), which the probe and the independent oracle must both reject. No source
// file is edited by either.
const allowPreviousSdk = process.argv.includes("--allow-previous-sdk");
const sabotageArgument = process.argv.find(argument => argument === "--sabotage" || argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : (sabotageArgument.split("=")[1] ?? sabotageNames[0]);
assert.ok(sabotage === null || sabotageNames.includes(sabotage), "Unknown sabotage: " + sabotage);
assert.ok(!(allowPreviousSdk && sabotage !== null), "A run is the current SDK, the previous one, or one sabotage");
const lane = allowPreviousSdk ? "previous-sdk" : sabotage === null ? "current" : `sabotage-${sabotage}`;
const digest = value => createHash("sha256").update(value).digest("hex");
const sorted = values => [...values].sort();
const guarded = ["src/os-specific.js", "src/platform.js", "src/react-native-platform.jsx"];

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

async function hashes() {
  return Object.fromEntries(await Promise.all(guarded.map(async file => [file, digest(await readFile(path.join(root, file)))])));
}

// The oracle's first complaint about a report whose checks all claim to pass, or null when it accepts it.
function oracleRejection(report) {
  try {
    verifyOsContractsReport({...report, checks: report.checks.map(row => ({...row, passed: true}))});
  } catch (error) {
    return String(error.message).split("\n")[0];
  }
  return null;
}

// Every ERROR line of a log is a failed check: no native, script or engine error hides.
function assertOnlyCheckErrors(report, log) {
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length, "No native diagnostic, script or engine error is hidden");
  return failures;
}

// The comparison of a control with the current lane: the same fixture, probe and oracle run on another SDK.
function assertSameReproducer(control, report, bundle, label) {
  assert.deepEqual(control.checks.map(row => row.name), report.checks.map(row => row.name), label);
  assert.deepEqual(control.expectedPreviousSdkFailures, report.expectedPreviousSdkFailures, label);
  assert.notEqual(control.provenance.bundle.bundle.sha256, bundle.bundle.sha256, label + " bundles another SDK");
  for (const file of ["tests/os-contracts-fixture.jsx", "tests/os-contracts-probe.gd", "tests/os-contracts-native.test.mjs", "tests/os-contracts-oracle.mjs",
    "scripts/os-contracts-bundle.mjs", "sdk/toolchain/platform-plugin.mjs"]) {
    assert.equal(control.provenance.bundle.sources[file], bundle.sources[file], `${label} shares the reproducer: ${file}`);
  }
  assert.equal(control.provenance.nativeHostSha256, report.provenance.nativeHostSha256, label + " runs on the same host: this slice has no native code");
}

// What a sabotage left in the report, so that it is rejected for the reason it was made.
function assertSabotageEffect(name, report) {
  const mount = report.apps.A.mount.js;
  const reads = report.apps.A.reads?.js.reads ?? [];
  const calls = report.apps.A.calls?.js.calls ?? [];
  if (name === "platform-android") {
    // Android's branch sends a native background and native commands to a host that has neither.
    assert.ok(mount.seen["A-native-feedback"].keys.includes("nativeBackgroundAndroid"));
    assert.ok(calls.some(entry => entry.op === "PermissionsAndroid.check" && entry.state === "threw"));
  } else if (name === "silent-shim") {
    assert.deepEqual(calls.find(entry => entry.op === "ToastAndroid.show").warnings, []);
    assert.equal(calls.find(entry => entry.op === "PermissionsAndroid.request").value, "granted");
  } else {
    assert.equal(reads.find(entry => entry.name === "ToastAndroid").available, false);
  }
}

test("RN's iOS- and Android-specific APIs keep their upstream unavailability on Godot, in two Hermes applications", async () => {
  const before = await hashes();
  const bundle = await bundleLane(lane);
  const bundleFile = lane === "current" ? "os-contracts-probe.js" : `os-contracts-${lane}-probe.js`;
  const binary = await ensureGodotBinary();
  await rm(path.join(root, "build/os-contracts-report.json"), {force: true});
  const flags = [`--bundle=${bundleFile}`, ...(allowPreviousSdk ? ["--allow-previous-sdk"] : []), ...(sabotage === null ? [] : ["--sabotage"])];
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/os-contracts-probe.gd", "--", ...flags],
    {encoding: "utf8", timeout: 180000, maxBuffer: 16 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/os-contracts-${lane}.log`), log);
  const report = await optionalJson("build/os-contracts-report.json");
  if (report != null) {
    report.provenance = {node: process.version, lane, bundle, nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))),
      sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, `build/os-contracts-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  // Artifacts are saved before assertions. A control never accepts unrelated failures or removes the declared
  // failures from the report.
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.ok(report != null, log);
  assert.equal(report.scenario, "native-os-contracts");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.bundle, bundleFile);
  assert.equal(report.allowPreviousSdk, allowPreviousSdk);
  assert.equal(report.sabotage, sabotage !== null);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.equal(new Set(report.expectedPreviousSdkFailures).size, report.expectedPreviousSdkFailures.length);
  assert.deepEqual(await hashes(), before, "A control never edits the SDK source: it overrides it in memory");
  for (const file of ["tests/os-contracts-fixture.jsx", "tests/os-contracts-probe.gd", "tests/os-contracts-native.test.mjs", "tests/os-contracts-oracle.mjs",
    "scripts/os-contracts-bundle.mjs", "scripts/os-contracts-sabotage.mjs", "scripts/native-probe-bundle.mjs", "src/react-native-platform.jsx",
    "src/platform.js", "src/os-specific.js", "sdk/toolchain/platform-plugin.mjs"]) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  // The checks that need this slice's SDK are normative; the rest hold on every SDK.
  assert.ok(report.expectedPreviousSdkFailures.length > 0 && report.expectedPreviousSdkFailures.length < report.checks.length);

  if (allowPreviousSdk) {
    assert.equal(result.status, 0, log);
    // The bundle holds the facade extracted from git (its hash is checked when it is extracted) and not the one in src/.
    assert.match(bundle.sources[previousSdkFacade], /^[0-9a-f]{64}$/);
    assert.ok(bundle.bundle.inputs.includes(previousSdkFacade) && !bundle.bundle.inputs.includes("src/react-native-platform.jsx"));
    const failures = assertOnlyCheckErrors(report, log);
    assert.ok(report.previousSdkObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedPreviousSdkFailures), "Only the checks that need this slice's SDK qualify as the control");
    assert.match(log, new RegExp(`OS_CONTRACTS_PREVIOUS_SDK: ${failures.length}`));
    // The previous SDK exports none of the APIs, so every read finds undefined and the cases render nothing.
    const reads = report.apps.A.reads.js.reads;
    for (const name of ["ToastAndroid", "PermissionsAndroid", "DynamicColorIOS", "ActionSheetIOS", "ProgressBarAndroid", "DrawerLayoutAndroid",
      "InputAccessoryView", "PushNotificationIOS", "TouchableNativeFeedback"]) {
      assert.deepEqual([reads.find(entry => entry.name === name).available, reads.find(entry => entry.name === name).type], [false, "undefined"], name);
    }
    assert.ok(report.apps.A.mount.js.renderErrors.length > 2, "Without the exports the cases fail at render");
    assert.ok(oracleRejection(report) != null, "The oracle rejects the previous SDK");
    return;
  }
  if (sabotage !== null) {
    assert.equal(result.status, 0, log);
    const failures = report.checks.filter(row => !row.passed).map(row => row.name);
    assert.ok(failures.length > 0, "The probe's checks reject the sabotaged SDK");
    assert.match(log, new RegExp(`OS_CONTRACTS_SABOTAGE_REJECTED: ${failures.length}`));
    assert.ok(oracleRejection(report) != null, "The oracle rejects the sabotaged SDK");
    assertSabotageEffect(sabotage, report);
    return;
  }

  assert.equal(result.status, 0, log);
  const failures = assertOnlyCheckErrors(report, log);
  assert.deepEqual(failures, []);
  assert.equal(report.previousSdkObserved, false);
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.match(log, /OS_CONTRACTS_PASSED: \d+/);
  for (const file of bundledOriginals) {
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/, "Pin the original RN module the bundle runs: " + file);
  }
  const verified = verifyOsContractsReport(report);

  // The host printed every warning JS made: one HERMES line for each, in the log of the process that ran both
  // applications. Nothing printed by the APIs is lost between console.warn and the host.
  const expected = new Map();
  for (const text of [...report.apps.A.afterStop.js.warnings, ...report.apps.B.final.js.warnings]) {
    expected.set(text, (expected.get(text) ?? 0) + 1);
  }
  const printed = new Map();
  for (const match of log.matchAll(/^HERMES: (.*)$/gm)) {
    printed.set(match[1], (printed.get(match[1]) ?? 0) + 1);
  }
  for (const [text, count] of expected) {
    assert.equal(printed.get(text), count, `The host printed "${text}" ${count} times`);
  }

  const previous = await optionalJson("build/os-contracts-previous-sdk-report.json");
  if (previous != null) {
    assert.ok(previous.previousSdkObserved);
    assertSameReproducer(previous, report, bundle, "previous SDK");
  }
  const rejections = {};
  for (const name of sabotageNames) {
    const sabotaged = await optionalJson(`build/os-contracts-sabotage-${name}-report.json`);
    if (sabotaged != null) {
      assert.ok(sabotaged.checks.some(row => !row.passed) && oracleRejection(sabotaged) != null, name);
      assertSameReproducer(sabotaged, report, bundle, `${name} sabotage`);
      rejections[name] = {failures: sabotaged.checks.filter(row => !row.passed).map(row => row.name), oracle: oracleRejection(sabotaged)};
    }
  }
  await writeFile(path.join(root, "build/os-contracts-comparison.json"), JSON.stringify({scenario: report.scenario, precedingCommit,
    previousSdkControlPresent: previous != null, sabotagePresent: Object.keys(rejections),
    previousSdkFailures: previous?.checks.filter(row => !row.passed).map(row => row.name) ?? null, sabotages: rejections,
    oracle: verified, hermesLines: Object.fromEntries(expected),
    current: {checks: report.checks.length, nativeHostSha256: report.provenance.nativeHostSha256, bundleSha256: bundle.bundle.sha256}}, null, 2) + "\n");
});
