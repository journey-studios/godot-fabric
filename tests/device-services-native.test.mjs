import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleDeviceServicesProbe, deviceServicesNativeProducers} from "../scripts/device-services-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {verifyDeviceServicesReport, verifyLaunchReport} from "./device-services-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// --allow-original-negative runs the same bundle on the preceding host, which has no device services: every
// check that needs them must fail there while the JavaScript ones hold. --sabotage=<name> runs it on a host
// whose source was broken on purpose (scripts/device-services-sabotage.mjs builds those hosts and restores the
// source): the probe and the independent oracle must both reject it.
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const sabotageArgument = process.argv.find(argument => argument === "--sabotage" || argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : (sabotageArgument.split("=")[1] ?? "duplicate-url");
assert.ok([null, "duplicate-url", "stale-clipboard"].includes(sabotage), "Unknown sabotage: " + sabotage);
const lane = allowOriginalNegative ? "original" : sabotage === null ? "current" : `sabotage-${sabotage}`;
// The URL the process is started with, as macOS LaunchServices would pass it.
const launchURL = "godotfabric://launch/initial?from=args&n=1";
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

function runProbe(binary, flags, userArguments) {
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/device-services-probe.gd", "--",
    ...userArguments, ...flags], {encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024});
  return {result, log: (result.stdout ?? "") + (result.stderr ?? "")};
}

async function collect(name, probe, bundle, file) {
  await writeFile(path.join(root, `build/device-services-${name}-${lane}.log`), probe.log);
  const report = await optionalJson(file);
  if (report != null) {
    report.provenance = {node: process.version, bundle, nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))),
      sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, `build/device-services-${name}-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  return report;
}

// Every ERROR line of a log is a failed check: no native, script or engine error hides.
function assertOnlyCheckErrors(report, log) {
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length, "No native diagnostic, script or engine error is hidden");
  return failures;
}

function assertSameReproducer(control, report, bundle, name) {
  assert.deepEqual(control.checks.map(row => row.name), report.checks.map(row => row.name), name);
  assert.deepEqual(control.expectedOriginalFailures, report.expectedOriginalFailures, name);
  assert.equal(control.provenance.bundle.bundle.sha256, bundle.bundle.sha256, name + ": the same bundle runs on every host");
  // Only the compiled native producers differ between hosts; their bundle-time pins say nothing about them.
  for (const [file, sha] of Object.entries(bundle.sources)) {
    if (!deviceServicesNativeProducers.includes(file)) {
      assert.equal(control.provenance.bundle.sources[file], sha, `${name} shares the reproducer and SDK producer: ${file}`);
    }
  }
  assert.notEqual(control.provenance.nativeHostSha256, report.provenance.nativeHostSha256, name);
}

function oracleRejection(verify, report) {
  try {
    verify({...report, checks: report.checks.map(row => ({...row, passed: true}))});
  } catch (error) {
    return String(error.message).split("\n")[0];
  }
  return null;
}

test("RN's own Linking, Clipboard and Vibration run over the host's device services in two applications", async () => {
  const unit = spawnSync(path.join(root, ".deps/build/device_services_core_test"), [], {encoding: "utf8", timeout: 20000});
  if (sabotage === null && !allowOriginalNegative) {
    assert.equal(unit.error, undefined);
    assert.equal(unit.status, 0, unit.stdout + unit.stderr);
    assert.match(unit.stdout, /DEVICE_SERVICES_CORE_PASSED/);
  }
  const bundle = await bundleDeviceServicesProbe();
  const binary = await ensureGodotBinary();
  await rm(path.join(root, "build/device-services-report.json"), {force: true});
  await rm(path.join(root, "build/device-services-launch-report.json"), {force: true});
  const flags = [...(allowOriginalNegative ? ["--allow-original-negative"] : []), ...(sabotage === null ? [] : ["--sabotage"])];
  // The process is started with the URL a launcher would pass, and once without it.
  const main = runProbe(binary, flags, [`--uri=${launchURL}`, `--launch-expected=${launchURL}`]);
  const report = await collect("probe", main, bundle, "build/device-services-report.json");
  const launch = runProbe(binary, [...flags, "--launch-only"], []);
  const launchReport = await collect("launch", launch, bundle, "build/device-services-launch-report.json");
  // Artifacts are saved before assertions. A control flag never accepts unrelated failures or removes the
  // declared failures from the report.
  for (const {result, log} of [main, launch]) {
    assert.equal(result.error, undefined, log);
    assert.equal(result.signal, null, log);
    assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  }
  assert.ok(report != null, main.log);
  assert.ok(launchReport != null, launch.log);
  for (const [which, row] of [["main", report], ["launch", launchReport]]) {
    assert.equal(row.scenario, "native-device-services", which);
    assert.equal(row.reactNative, "0.87.1", which);
    assert.equal(row.displayServer, "headless", which);
    assert.equal(row.allowOriginalNegative, allowOriginalNegative, which);
    assert.equal(new Set(row.checks.map(check => check.name)).size, row.checks.length, which);
    assert.equal(new Set(row.expectedOriginalFailures).size, row.expectedOriginalFailures.length, which);
  }
  assert.equal(report.launchOnly, false);
  assert.equal(launchReport.launchOnly, true);
  assert.equal(report.expectedLaunch, launchURL);
  assert.equal(launchReport.expectedLaunch, null);
  const failures = assertOnlyCheckErrors(report, main.log);
  const launchFailures = assertOnlyCheckErrors(launchReport, launch.log);
  for (const file of ["tests/device-services-fixture.jsx", "tests/device-services-probe.gd", "tests/device-services-native.test.mjs",
    "tests/device-services-oracle.mjs", "scripts/device-services-bundle.mjs", "src/device-services.js", "src/react-native-platform.jsx",
    "sdk/toolchain/platform-plugin.mjs", ...deviceServicesNativeProducers]) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  for (const file of ["Libraries/Linking/Linking.js", "src/private/specs_DEPRECATED/modules/NativeLinkingManager.js",
    "Libraries/Vibration/Vibration.js", "src/private/specs_DEPRECATED/modules/NativeVibration.js", "Libraries/Components/Clipboard/Clipboard.js",
    "src/private/specs_DEPRECATED/modules/NativeClipboard.js", "Libraries/LinkingIOS/RCTLinkingManager.mm", "Libraries/Vibration/RCTVibration.mm",
    "React/CoreModules/RCTClipboard.mm", "ReactAndroid/src/main/java/com/facebook/react/modules/intent/IntentModule.kt"]) {
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  }
  // The checks that need the native device services are normative; the rest hold on both hosts.
  assert.ok(report.expectedOriginalFailures.length > 0 && report.expectedOriginalFailures.length < report.checks.length);
  assert.ok(launchReport.expectedOriginalFailures.length > 0);
  // RN's own deprecation notice prints once per runtime that reads Clipboard: two applications, two notices, and
  // as a plain log line, never as an engine error.
  const notices = text => [...text.matchAll(/^HERMES: Clipboard has been extracted from react-native core/gm)].length;
  assert.equal(notices(main.log), 2, "The Clipboard deprecation notice prints once per application that reads it");
  assert.equal(notices(launch.log), 0);

  if (allowOriginalNegative) {
    assert.equal(main.result.status, 0, main.log);
    assert.equal(launch.result.status, 0, launch.log);
    assert.ok(report.originalNegativeObserved && launchReport.originalNegativeObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedOriginalFailures), "Only the device services checks qualify as the old-host control");
    assert.deepEqual(sorted(launchFailures), sorted(launchReport.expectedOriginalFailures));
    assert.match(main.log, new RegExp(`DEVICE_SERVICES_ORIGINAL_NEGATIVE: ${failures.length}`));
    // Without the modules the first read of Clipboard and Vibration fails where RN looks the module up
    // (getEnforcing), Linking loads but its module is missing, and no application is given a deep link.
    const access = report.stages.A["lazy-clipboard"].js.access;
    assert.equal(access.Clipboard.available, false);
    assert.match(access.Clipboard.error, /'Clipboard' could not be found/);
    assert.match(report.stages.A["lazy-vibration"].js.access.Vibration.error, /'Vibration' could not be found/);
    assert.deepEqual(report.stages.A["lazy-linking"].commands[1].result, {LinkingManager: false, Clipboard: false, Vibration: false});
    assert.equal(report.stages.A["linking-open"].calls[0].state, "threw");
    assert.equal(report.stages.A.stop.commands.at(-3).result, null, "The preceding host has no deliver_url");
    assert.ok(oracleRejection(verifyDeviceServicesReport, report) != null, "The oracle rejects the preceding host");
    return;
  }
  assert.equal(report.originalNegativeObserved, false);
  if (sabotage !== null) {
    assert.equal(main.result.status, 0, main.log);
    assert.ok(failures.length > 0 || launchFailures.length > 0);
    assert.match(main.log, new RegExp(`DEVICE_SERVICES_SABOTAGE_REJECTED: ${failures.length}`));
    assert.ok(oracleRejection(verifyDeviceServicesReport, report) != null, "The oracle rejects the sabotaged report");
    return;
  }
  assert.equal(main.result.status, 0, main.log);
  assert.equal(launch.result.status, 0, launch.log);
  assert.deepEqual(failures, []);
  assert.deepEqual(launchFailures, []);
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.match(main.log, /DEVICE_SERVICES_PASSED: \d+/);
  assert.match(launch.log, /DEVICE_SERVICES_LAUNCH_PASSED: \d+/);
  const verified = verifyDeviceServicesReport(report);
  const verifiedLaunch = verifyLaunchReport(launchReport);
  const original = await optionalJson("build/device-services-probe-original-report.json");
  const originalLaunch = await optionalJson("build/device-services-launch-original-report.json");
  if (original != null) {
    assert.ok(original.originalNegativeObserved);
    assertSameReproducer(original, report, bundle, "preceding host");
    assertSameReproducer(originalLaunch, launchReport, bundle, "preceding host (launch)");
  }
  const rejections = {};
  for (const name of ["duplicate-url", "stale-clipboard"]) {
    const sabotaged = await optionalJson(`build/device-services-probe-sabotage-${name}-report.json`);
    if (sabotaged != null) {
      assert.ok(sabotaged.checks.some(row => !row.passed) && oracleRejection(verifyDeviceServicesReport, sabotaged) != null, name);
      assertSameReproducer(sabotaged, report, bundle, `${name} host`);
      rejections[name] = {failures: sabotaged.checks.filter(row => !row.passed).map(row => row.name),
        oracle: oracleRejection(verifyDeviceServicesReport, sabotaged)};
    }
  }
  await writeFile(path.join(root, "build/device-services-comparison.json"), JSON.stringify({scenario: report.scenario,
    originalControlPresent: original != null, sabotagePresent: Object.keys(rejections),
    intentionalNativeProducerDifferences: deviceServicesNativeProducers,
    originalFailures: original?.checks.filter(row => !row.passed).map(row => row.name) ?? null, sabotages: rejections,
    oracle: {main: verified, launch: verifiedLaunch},
    current: {checks: report.checks.length, launchChecks: launchReport.checks.length, nativeHostSha256: report.provenance.nativeHostSha256,
      bundleSha256: bundle.bundle.sha256}}, null, 2) + "\n");
});
