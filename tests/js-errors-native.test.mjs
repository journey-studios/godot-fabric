import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleJsErrorsProbe, jsErrorsNativeProducers, sabotageNamed, sabotageNames} from "../scripts/js-errors-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {derivedChecks, oracleRejection, rnExpectations, verifyJsErrorsReport} from "./js-errors-oracle.mjs";

// GF-05 slice C. A lane is the current SDK on the current host; --allow-original-negative runs the same bundle on the host this slice
// replaced (it had no ErrorUtils, no RN$handleException and no ExceptionsManager module, and recorded an error where it caught it), which
// must fail exactly the checks that need the new host; --sabotage=<name> runs it with one deliberate fault (tests/js-errors-sabotages.mjs):
// a bundle with an in-memory override, or, for the sabotages of the host, the host that scripts/js-errors-sabotage.mjs built from the broken
// source. The probe and the independent oracle must both reject it. No source file is edited by a lane.
const root = fileURLToPath(new URL("..", import.meta.url));
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const sabotageArgument = process.argv.find(argument => argument === "--sabotage" || argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : (sabotageArgument.split("=")[1] ?? sabotageNames[0]);
assert.ok(sabotage === null || sabotageNames.includes(sabotage), "Unknown sabotage: " + sabotage);
assert.ok(!(allowOriginalNegative && sabotage !== null), "A run is the current host and SDK, the previous host, or one sabotage");
const lane = allowOriginalNegative ? "original" : sabotage === null ? "current" : `sabotage-${sabotage}`;
const digest = value => createHash("sha256").update(value).digest("hex");
const sorted = values => [...values].sort();
const guarded = ["src/initialize.js", "sdk/toolchain/metro-polyfills.mjs", "native/application_runtime.cpp", "node_modules/@react-native/js-polyfills/error-guard.js"];

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

// Every ERROR line of a log is a failed check or the FABRIC_ERROR of a host failure: no native, script or engine error hides. The failures
// the fatal cases make on purpose are the ones the report lists (the application's own record of them), and only those.
function assertErrorLines(report, log) {
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const lines = [...log.matchAll(/^ERROR: (.*)$/gm)].map(match => match[1]);
  const checkErrors = lines.filter(line => line.startsWith("FABRIC_CHECK_FAILED: ")).map(line => line.slice("FABRIC_CHECK_FAILED: ".length));
  const hostFailures = lines.filter(line => line.startsWith("FABRIC_ERROR: ")).map(line => line.slice("FABRIC_ERROR: ".length));
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  assert.equal(lines.length, checkErrors.length + hostFailures.length, "No native diagnostic, script or engine error is hidden");
  return {failures, hostFailures};
}

// The failures the lanes of the current host record on purpose: three fatal errors in the ready lane, one in the early lane and the one that
// escapes the bundle. The first line of each is what FABRIC_ERROR printed.
function expectedHostFailures(report) {
  const stages = report.stages;
  return [...(stages.settled?.errors ?? []), ...(stages.early_settled?.errors ?? []), ...(stages.escape?.application?.errors ?? [])]
    .map(text => text.split("\n")[0]);
}

// The host printed every soft exception the module and the pipeline counted: one HERMES line for each, in the order they were delivered,
// in the log of the process that ran the three applications. The messages are the report's own, so nothing here depends on the pace of the
// frames.
function assertSoftLogged(report, log) {
  const reports = [...(report.stages.settled?.jsErrors?.reports ?? []), ...(report.stages.early_settled?.jsErrors?.reports ?? [])];
  const soft = reports.filter(entry => !entry.fatal).map(entry => entry.message);
  let cursor = 0;
  for (const message of soft) {
    const at = log.indexOf(`HERMES: ExceptionsManager soft exception: ${message}, stack:\n`, cursor);
    assert.notEqual(at, -1, `The host logged the soft exception "${message}" after the previous one`);
    cursor = at + 1;
  }
  assert.equal([...log.matchAll(/^HERMES: ExceptionsManager soft exception: /gm)].length, soft.length, "The host logs a soft exception once, and logs nothing else as one");
  return soft.length;
}

test("RN's error path runs in the host: ErrorUtils, setUpErrorHandling and ExceptionsManager over the host's module, and JsErrorHandler's globals", async () => {
  const before = await hashes();
  const bundle = await bundleJsErrorsProbe(sabotage);
  const variant = sabotage === null ? null : sabotageNamed(sabotage);
  const bundleFile = sabotage === null || variant.host === true ? "js-errors-probe.js" : `js-errors-sabotage-${sabotage}-probe.js`;
  const binary = await ensureGodotBinary();
  await rm(path.join(root, "build/js-errors-report.json"), {force: true});
  const flags = [`--bundle=${bundleFile}`, ...(allowOriginalNegative ? ["--allow-original-negative"] : []), ...(sabotage === null ? [] : ["--sabotage"])];
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/js-errors-probe.gd", "--", ...flags],
    {encoding: "utf8", timeout: 180000, maxBuffer: 32 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/js-errors-${lane}.log`), log);
  const report = await optionalJson("build/js-errors-report.json");
  if (report != null) {
    report.provenance = {node: process.version, lane, bundle, nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))),
      sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, `build/js-errors-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  // Artifacts are saved before assertions. A control never accepts unrelated failures or removes the declared failures from the report.
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.ok(report != null, log);
  assert.equal(report.scenario, "native-js-errors");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.bundle, bundleFile);
  assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  assert.equal(report.sabotage, sabotage !== null);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.equal(new Set(report.expectedOriginalFailures).size, report.expectedOriginalFailures.length);
  assert.deepEqual(await hashes(), before, "A sabotage never edits a source: it overrides it in memory, or builds a host from a copy the script restores");
  for (const file of ["tests/js-errors-fixture.jsx", "tests/js-errors-early.js", "tests/js-errors-host.js", "tests/js-errors-cases.mjs", "tests/js-errors-probe.gd",
    "tests/js-errors-native.test.mjs", "tests/js-errors-oracle.mjs", "tests/js-errors-sabotages.mjs", "scripts/js-errors-bundle.mjs", "scripts/js-errors-sabotage.mjs",
    "scripts/native-probe-bundle.mjs", "src/initialize.js", "sdk/toolchain/platform-plugin.mjs", "sdk/toolchain/metro-polyfills.mjs", ...jsErrorsNativeProducers]) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  // The checks that need the new host are normative; the rest hold on both hosts.
  assert.ok(report.expectedOriginalFailures.length > 0 && report.expectedOriginalFailures.length < report.checks.length);
  const expected = await rnExpectations(root);
  assert.deepEqual(derivedChecks(report, expected), report.checks, "The oracle derives every verdict the probe gave, from the raw observations, RN's sources and RN's JavaScript run in V8");

  if (sabotage !== null) {
    assert.equal(result.status, 0, log);
    const {failures} = assertErrorLines(report, log);
    assert.ok(failures.length > 0, "The probe's checks reject the sabotaged lane");
    assert.match(log, new RegExp(`JS_ERRORS_SABOTAGE_REJECTED: ${failures.length}`));
    assert.ok(oracleRejection(report, expected) != null, "The oracle rejects the sabotaged lane");
    return;
  }

  // The injection order: the host-state module runs before the Metro polyfills, in RN's order, and all of them before every module of the bundle.
  const inputs = bundle.bundle.inputs;
  assert.deepEqual(inputs.slice(0, 3), ["tests/js-errors-host.js", "node_modules/@react-native/js-polyfills/console.js", "node_modules/@react-native/js-polyfills/error-guard.js"]);
  assert.ok(inputs.includes("src/initialize.js"));
  for (const file of ["Libraries/Core/setUpErrorHandling.js", "Libraries/Core/ExceptionsManager.js", "Libraries/Core/NativeExceptionsManager.js",
    "Libraries/vendor/core/ErrorUtils.js"]) {
    assert.ok(inputs.includes("node_modules/react-native/" + file), "The bundle runs RN's own module: " + file);
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  }
  for (const file of ["../@react-native/js-polyfills/error-guard.js", "../@react-native/js-polyfills/index.js", "ReactCommon/react/runtime/ReactInstance.cpp",
    "ReactCommon/jserrorhandler/JsErrorHandler.cpp", "ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler_Modern.cpp",
    "ReactAndroid/src/main/java/com/facebook/react/modules/core/ExceptionsManagerModule.kt", "React/CoreModules/RCTExceptionsManager.mm"]) {
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/, "Pin the RN source the oracle reads: " + file);
  }

  if (allowOriginalNegative) {
    assert.equal(result.status, 0, log);
    const {failures} = assertErrorLines(report, log);
    assert.ok(report.originalNegativeObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedOriginalFailures), "Only the checks that need the new host qualify as the control");
    assert.match(log, new RegExp(`JS_ERRORS_ORIGINAL_NEGATIVE: ${failures.length}`));
    // The previous host defines none of the globals ReactInstance installs, and answers no ExceptionsManager lookup.
    assert.equal(report.stages.host.globals["RN$handleException"].type, "undefined");
    assert.equal(report.stages.environment.native.loaded, false);
    assert.ok(oracleRejection(report, expected) != null, "The oracle rejects the previous host");
    return;
  }

  assert.equal(result.status, 0, log);
  assert.equal(report.originalNegativeObserved, false);
  const {failures, hostFailures} = assertErrorLines(report, log);
  assert.deepEqual(failures, []);
  assert.deepEqual(sorted(hostFailures), sorted(expectedHostFailures(report)), "The log holds the host failures of the fatal cases, and no other");
  assert.equal(hostFailures.length, 5, "Three fatal errors in the ready lane, one in the early lane, one that escapes the bundle");
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.match(log, /JS_ERRORS_PASSED: \d+/);
  verifyJsErrorsReport(report, expected);
  const logged = assertSoftLogged(report, log);

  const original = await optionalJson("build/js-errors-original-report.json");
  if (original != null) {
    assert.ok(original.originalNegativeObserved);
    assert.deepEqual(original.checks.map(row => row.name), report.checks.map(row => row.name));
    assert.deepEqual(original.expectedOriginalFailures, report.expectedOriginalFailures);
    // The same SDK bundle runs on both hosts; only the compiled native producers differ.
    assert.equal(original.provenance.bundle.bundle.sha256, bundle.bundle.sha256);
    for (const [file, sha] of Object.entries(bundle.sources)) {
      if (!jsErrorsNativeProducers.includes(file)) {
        assert.equal(original.provenance.bundle.sources[file], sha, "Old/new hosts share the reproducer and SDK producer: " + file);
      }
    }
    assert.notEqual(original.provenance.nativeHostSha256, report.provenance.nativeHostSha256);
  }
  const rejections = {};
  for (const name of sabotageNames) {
    const sabotaged = await optionalJson(`build/js-errors-sabotage-${name}-report.json`);
    if (sabotaged != null) {
      assert.ok(sabotaged.checks.some(row => !row.passed) && oracleRejection(sabotaged, expected) != null, name);
      if (sabotageNamed(name).host === true) {
        assert.equal(sabotaged.provenance.bundle.bundle.sha256, bundle.bundle.sha256, `${name} runs the current bundle`);
        assert.notEqual(sabotaged.provenance.nativeHostSha256, report.provenance.nativeHostSha256, `${name} runs on another host`);
      } else {
        assert.notEqual(sabotaged.provenance.bundle.bundle.sha256, bundle.bundle.sha256, `${name} bundles another SDK`);
        assert.equal(sabotaged.provenance.nativeHostSha256, report.provenance.nativeHostSha256, `${name} runs on the same host`);
      }
      rejections[name] = {failures: sabotaged.checks.filter(row => !row.passed).map(row => row.name), oracle: oracleRejection(sabotaged, expected)};
    }
  }
  await writeFile(path.join(root, "build/js-errors-comparison.json"), JSON.stringify({scenario: report.scenario,
    originalControlPresent: original != null, sabotagePresent: Object.keys(rejections), hostLoggedSoftExceptions: logged, hostFailureLines: hostFailures.length,
    original: original == null ? null : {failures: original.checks.filter(row => !row.passed).map(row => row.name),
      nativeHostSha256: original.provenance.nativeHostSha256},
    sabotages: rejections, current: {checks: report.checks.length, nativeHostSha256: report.provenance.nativeHostSha256,
      bundleSha256: bundle.bundle.sha256}}, null, 2) + "\n");
});
