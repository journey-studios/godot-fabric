import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {accessibilityInfoNativeProducers, bundleAccessibilityInfoProbe} from "../scripts/accessibility-info-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {verifyAccessibilityInfoReport} from "./accessibility-info-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// --allow-original-negative runs the same bundle on the preceding host (GF-20 slice 2a: the settings and events, with the
// announcements and the focus refused as "not implemented yet"): every check of what slice 2b added must fail there while the
// others, the settings and events, hold. The host in addons/ has to be the preserved one
// (build/accessibility-announcements-previous-host). --sabotage=<name> runs it on a host whose source was broken on purpose
// (scripts/accessibility-info-sabotage.mjs builds those hosts and restores the source): the probe and the independent
// oracle must both reject it.
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const sabotageArgument = process.argv.find(argument => argument === "--sabotage" || argument.startsWith("--sabotage="));
const sabotageNames = ["unknown-as-false", "emit-every-poll", "swapped-settings", "display-name", "announce-name", "swapped-priorities",
  "ungated-announce", "reused-element"];
const sabotage = sabotageArgument === undefined ? null : (sabotageArgument.split("=")[1] ?? sabotageNames[0]);
assert.ok(sabotage === null || sabotageNames.includes(sabotage), "Unknown sabotage: " + sabotage);
assert.ok(!(allowOriginalNegative && sabotage !== null), "A run is the current host, the previous one, or one sabotage");
const lane = allowOriginalNegative ? "original" : sabotage === null ? "current" : `sabotage-${sabotage}`;
const digest = value => createHash("sha256").update(value).digest("hex");
const sorted = values => [...values].sort();
const host = path.join(root, "addons/fabric_godot.dylib");

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

// The oracle's first complaint about a report whose checks all claim to pass, or null when it accepts it.
function oracleRejection(report) {
  try {
    verifyAccessibilityInfoReport({...report, checks: report.checks.map(row => ({...row, passed: true}))});
  } catch (error) {
    return String(error.message).split("\n")[0];
  }
  return null;
}

// Every ERROR line of a log is a failed check or a diagnostic the probe provoked on purpose and declared in its report:
// no native, script or engine error hides.
function assertOnlyExpectedErrors(report, log) {
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  const declared = report.expectedDiagnostics[allowOriginalNegative ? "original" : "current"];
  const wanted = Object.entries(declared).flatMap(([text, count]) => Array(count).fill(text));
  const diagnostics = [...log.matchAll(/^ERROR: (FABRIC_ERROR: .+)$/gm)].map(match => match[1]);
  assert.deepEqual(sorted(diagnostics), sorted(wanted), "The only native diagnostics are the ones the probe provoked");
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length + diagnostics.length, "No script or engine error is hidden");
  return failures;
}

function assertSameReproducer(control, report, bundle, name) {
  assert.deepEqual(control.checks.map(row => row.name), report.checks.map(row => row.name), name);
  assert.deepEqual(control.expectedOriginalFailures, report.expectedOriginalFailures, name);
  assert.equal(control.provenance.bundle.bundle.sha256, bundle.bundle.sha256, name + ": the same bundle runs on every host");
  // Only the compiled native producers differ between hosts; their bundle-time pins say nothing about them.
  for (const [file, sha] of Object.entries(bundle.sources)) {
    if (!accessibilityInfoNativeProducers.includes(file)) {
      assert.equal(control.provenance.bundle.sources[file], sha, `${name} shares the reproducer and SDK producer: ${file}`);
    }
  }
  assert.notEqual(control.provenance.nativeHostSha256, report.provenance.nativeHostSha256, name);
}

// The calls of a step that are not the same on every host, by label.
const stateOf = (report, app, step, label) => report.stages[app][step].calls.find(entry => entry.label === label);
const eventRows = (report, app, step) => report.stages[app][step].events.filter(event => !event.cleanup);

test("RN's own AccessibilityInfo runs over the host's accessibility settings and events in two applications", async () => {
  // The two pure cores, each in its own executable: the settings' and the announcements'.
  const units = [["accessibility_info_core_test", /ACCESSIBILITY_INFO_CORE_PASSED/],
    ["accessibility_announcement_core_test", /ACCESSIBILITY_ANNOUNCEMENT_CORE_PASSED/]].map(([name, passed]) =>
    ({passed, run: spawnSync(path.join(root, ".deps/build", name), [], {encoding: "utf8", timeout: 20000})}));
  if (sabotage === null && !allowOriginalNegative) {
    for (const {passed, run} of units) {
      assert.equal(run.error, undefined);
      assert.equal(run.status, 0, run.stdout + run.stderr);
      assert.match(run.stdout, passed);
    }
  }
  const hostSha256 = digest(await readFile(host));
  if (allowOriginalNegative) {
    // The control is only a control on the host that predates this slice.
    const preserved = digest(await readFile(path.join(root, "build/accessibility-announcements-previous-host/fabric_godot.dylib")));
    assert.equal(hostSha256, preserved, "addons/fabric_godot.dylib must be the preserved previous host");
  }
  const bundle = await bundleAccessibilityInfoProbe();
  const binary = await ensureGodotBinary();
  await rm(path.join(root, "build/accessibility-info-report.json"), {force: true});
  const flags = [...(allowOriginalNegative ? ["--allow-original-negative"] : []), ...(sabotage === null ? [] : ["--sabotage"])];
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/accessibility-info-probe.gd", "--", ...flags],
    {encoding: "utf8", timeout: 180000, maxBuffer: 16 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/accessibility-info-${lane}.log`), log);
  const report = await optionalJson("build/accessibility-info-report.json");
  if (report != null) {
    report.provenance = {node: process.version, lane, bundle, nativeHostSha256: hostSha256, sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, `build/accessibility-info-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  // Artifacts are saved before assertions. A control flag never accepts unrelated failures or removes the declared
  // failures from the report.
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.ok(report != null, log);
  assert.equal(report.scenario, "native-accessibility-info");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  assert.equal(new Set(report.checks.map(check => check.name)).size, report.checks.length);
  assert.equal(new Set(report.expectedOriginalFailures).size, report.expectedOriginalFailures.length);
  const failures = assertOnlyExpectedErrors(report, log);
  for (const file of ["tests/accessibility-info-fixture.jsx", "tests/accessibility-info-probe.gd", "tests/accessibility-info-native.test.mjs",
    "tests/accessibility-info-oracle.mjs", "scripts/accessibility-info-bundle.mjs", "src/accessibility-info.js", "src/platform-environment.js",
    "src/react-native-platform.jsx", "sdk/toolchain/platform-plugin.mjs", ...accessibilityInfoNativeProducers]) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  for (const file of ["Libraries/Components/AccessibilityInfo/AccessibilityInfo.js", "Libraries/Components/AccessibilityInfo/legacySendAccessibilityEvent.ios.js",
    "src/private/specs_DEPRECATED/modules/NativeAccessibilityManager.js", "React/CoreModules/RCTAccessibilityManager.mm",
    "React/Fabric/Mounting/RCTMountingManager.mm", "React/FBReactNativeSpec/FBReactNativeSpecJSI.h",
    "ReactAndroid/src/main/java/com/facebook/react/modules/accessibilityinfo/AccessibilityInfoModule.kt"]) {
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  }
  // The checks that need the native module are normative; the rest hold on both hosts.
  assert.ok(report.expectedOriginalFailures.length > 0 && report.expectedOriginalFailures.length < report.checks.length);
  // Both applications ran the same bundle, and the roots that were mounted were cleaned up as the script says.
  assert.ok(Object.keys(report.stages.A).length > 20 && Object.keys(report.stages.R).length >= 5);

  if (allowOriginalNegative) {
    assert.equal(result.status, 0, log);
    assert.ok(report.originalNegativeObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedOriginalFailures), "Only the AccessibilityManager checks qualify as the old-host control");
    assert.match(log, new RegExp(`ACCESSIBILITY_INFO_ORIGINAL_NEGATIVE: ${failures.length}`));
    // The preceding host has the module: the settings and the events hold, and what is missing is refused as "not implemented yet".
    assert.equal(stateOf(report, "A", "getters", "get/screen").state, "resolved");
    assert.equal(stateOf(report, "A", "getters", "get/screen").value, true);
    assert.equal(report.stages.A["lazy-read"].info.modules.AccessibilityManager, 1, "the preceding host has the AccessibilityManager module");
    assert.ok(eventRows(report, "A", "motion-on").length > 0, "the preceding host delivers the settings' events");
    for (const [step, label] of [["announce-basic", "announce/say"], ["announce-priorities", "priority/high"], ["announce-batch", "batch/three"],
      ["announce-empty", "odd/unicode"], ["focus-refused", "focus/public"], ["focus-refused", "focus/direct"], ["announce-no-reader", "silent/plain"]]) {
      const entry = stateOf(report, "A", step, label);
      assert.equal(entry.state, "threw", `${step}/${label}: the preceding host refuses`);
      assert.match(entry.error, /E_UNSUPPORTED.*GF-20 slice 2b/, `${step}/${label}: and says the slice that was to do it`);
    }
    for (const app of ["A", "R"]) {
      for (const step of Object.keys(report.stages[app])) {
        assert.equal(report.stages[app][step].info.announcements, undefined, `The preceding host has no announcements: ${app}/${step}`);
      }
    }
    assert.ok(oracleRejection(report) != null, "The oracle rejects the preceding host");
    return;
  }
  assert.equal(report.originalNegativeObserved, false);
  if (sabotage !== null) {
    assert.equal(result.status, 0, log);
    assert.ok(failures.length > 0);
    assert.match(log, new RegExp(`ACCESSIBILITY_INFO_SABOTAGE_REJECTED: ${failures.length}`));
    assert.ok(oracleRejection(report) != null, "The oracle rejects the sabotaged report");
    if (sabotage === "display-name") {
      // A method the engine lacks is unknown and never off: the real backend still rejects, and what fails is the proof that the
      // name is the engine's.
      const settings = report.stages.R["real-subscribe"].info.settings;
      assert.equal(settings.reduceMotion.displayMethod, "accessibility_should_reduce_animations");
      assert.equal(settings.reduceMotion.last, -1, "a method the DisplayServer lacks reads unknown, not off");
      assert.equal(stateOf(report, "R", "real-getters", "real/motion").state, "rejected");
      assert.match(stateOf(report, "R", "real-getters", "real/motion").error, /E_ACCESSIBILITY_UNKNOWN/);
      assert.ok(failures.some(name => /exists in the DisplayServer/.test(name)));
      assert.equal(report.displayMethods.reduceMotion.exists, false);
    }
    return;
  }
  assert.equal(result.status, 0, log);
  assert.deepEqual(failures, []);
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.match(log, /ACCESSIBILITY_INFO_PASSED: \d+/);
  const verified = verifyAccessibilityInfoReport(report);
  const original = await optionalJson("build/accessibility-info-original-report.json");
  if (original != null) {
    assert.ok(original.originalNegativeObserved);
    assertSameReproducer(original, report, bundle, "preceding host");
  }
  const rejections = {};
  for (const name of sabotageNames) {
    const sabotaged = await optionalJson(`build/accessibility-info-sabotage-${name}-report.json`);
    if (sabotaged != null) {
      assert.ok(sabotaged.checks.some(row => !row.passed) && oracleRejection(sabotaged) != null, name);
      assertSameReproducer(sabotaged, report, bundle, `${name} host`);
      rejections[name] = {failures: sabotaged.checks.filter(row => !row.passed).map(row => row.name), oracle: oracleRejection(sabotaged)};
    }
  }
  await writeFile(path.join(root, "build/accessibility-info-comparison.json"), JSON.stringify({scenario: report.scenario,
    originalControlPresent: original != null, sabotagePresent: Object.keys(rejections),
    intentionalNativeProducerDifferences: accessibilityInfoNativeProducers,
    originalFailures: original?.checks.filter(row => !row.passed).map(row => row.name) ?? null, sabotages: rejections, oracle: verified,
    current: {checks: report.checks.length, nativeHostSha256: report.provenance.nativeHostSha256, bundleSha256: bundle.bundle.sha256}}, null, 2) + "\n");
});
