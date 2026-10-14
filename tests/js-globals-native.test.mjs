import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleJsGlobalsProbe, jsGlobalsNativeProducers, sabotageNames} from "../scripts/js-globals-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {derivedChecks, oracleRejection, rnExpectations, verifyJsGlobalsReport} from "./js-globals-oracle.mjs";

// GF-05 slice B. A lane is the current SDK on the current host; --allow-original-negative runs the same bundle on the host this slice
// replaced (it defined a performance stub and a console of three functions before any JS ran), which must fail exactly the checks that need
// the new host; --sabotage=<name> bundles the SDK with one in-memory override (scripts/js-globals-bundle.mjs), which the probe and the
// independent oracle must both reject. No source file is edited by either.
const root = fileURLToPath(new URL("..", import.meta.url));
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const sabotageArgument = process.argv.find(argument => argument === "--sabotage" || argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : (sabotageArgument.split("=")[1] ?? sabotageNames[0]);
assert.ok(sabotage === null || sabotageNames.includes(sabotage), "Unknown sabotage: " + sabotage);
assert.ok(!(allowOriginalNegative && sabotage !== null), "A run is the current host and SDK, the previous host, or one sabotage");
const lane = allowOriginalNegative ? "original" : sabotage === null ? "current" : `sabotage-${sabotage}`;
const digest = value => createHash("sha256").update(value).digest("hex");
const sorted = values => [...values].sort();
const guarded = ["src/initialize.js", "node_modules/@react-native/js-polyfills/console.js"];

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

// Every ERROR line of a log is a failed check: no native, script or engine error hides.
function assertOnlyCheckErrors(report, log) {
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length, "No native diagnostic, script or engine error is hidden");
  return failures;
}

// The host printed what JS sent its hook: one HERMES line per message, in the order the hook received them, in the log of the process that
// ran both. A multi-line message (a table, a group) is the same text after "HERMES: ". The messages are the report's own, so nothing here
// depends on how many frames came or in which order Godot ran them.
function assertHostPrinted(report, log) {
  const messages = [...report.stages.early, ...report.stages.console.perCall.flatMap(call => call.logged)].map(entry => entry.message);
  let cursor = 0;
  for (const message of messages) {
    const at = log.indexOf("HERMES: " + message, cursor);
    assert.notEqual(at, -1, `The host printed "${message}" after the previous message`);
    cursor = at + message.length;
  }
  return messages.length;
}

test("RN's own setup modules and console polyfill build the JavaScript environment of a host that defines neither performance nor console", async () => {
  const before = await hashes();
  const bundle = await bundleJsGlobalsProbe(sabotage);
  const bundleFile = sabotage === null ? "js-globals-probe.js" : `js-globals-sabotage-${sabotage}-probe.js`;
  const binary = await ensureGodotBinary();
  await rm(path.join(root, "build/js-globals-report.json"), {force: true});
  const flags = [`--bundle=${bundleFile}`, ...(allowOriginalNegative ? ["--allow-original-negative"] : []), ...(sabotage === null ? [] : ["--sabotage"])];
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/js-globals-probe.gd", "--", ...flags],
    {encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/js-globals-${lane}.log`), log);
  const report = await optionalJson("build/js-globals-report.json");
  if (report != null) {
    report.provenance = {node: process.version, lane, bundle, nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))),
      sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, `build/js-globals-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  // Artifacts are saved before assertions. A control never accepts unrelated failures or removes the declared failures from the report.
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.ok(report != null, log);
  assert.equal(report.scenario, "native-js-globals");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.bundle, bundleFile);
  assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  assert.equal(report.sabotage, sabotage !== null);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.equal(new Set(report.expectedOriginalFailures).size, report.expectedOriginalFailures.length);
  assert.deepEqual(await hashes(), before, "A sabotage never edits a source: it overrides it in memory");
  for (const file of ["tests/js-globals-fixture.jsx", "tests/js-globals-early.js", "tests/js-globals-host.js", "tests/js-globals-probe.gd",
    "tests/js-globals-native.test.mjs", "tests/js-globals-oracle.mjs", "scripts/js-globals-bundle.mjs", "scripts/native-probe-bundle.mjs",
    "src/initialize.js", "sdk/toolchain/platform-plugin.mjs", "sdk/toolchain/metro-polyfills.mjs", ...jsGlobalsNativeProducers]) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  // The checks that need the new host are normative; the rest hold on both hosts.
  assert.ok(report.expectedOriginalFailures.length > 0 && report.expectedOriginalFailures.length < report.checks.length);
  const expected = rnExpectations(root);
  assert.deepEqual(derivedChecks(report, expected), report.checks, "The oracle derives every verdict the probe gave, from the raw observations and RN's sources");

  if (sabotage !== null) {
    assert.equal(result.status, 0, log);
    const failures = assertOnlyCheckErrors(report, log);
    assert.ok(failures.length > 0, "The probe's checks reject the sabotaged SDK");
    assert.match(log, new RegExp(`JS_GLOBALS_SABOTAGE_REJECTED: ${failures.length}`));
    assert.ok(oracleRejection(report, expected) != null, "The oracle rejects the sabotaged SDK");
    return;
  }

  // The injection order: the host-state module runs before the console polyfill, and both before every module of the bundle.
  const inputs = bundle.bundle.inputs;
  assert.deepEqual(inputs.slice(0, 2), ["tests/js-globals-host.js", "node_modules/@react-native/js-polyfills/console.js"]);
  assert.ok(inputs.includes("src/initialize.js"));
  for (const file of ["Libraries/Core/setUpGlobals.js", "src/private/setup/setUpDOM.js", "Libraries/Core/setUpPerformance.js", "Libraries/Core/setUpNavigator.js"]) {
    assert.ok(inputs.includes("node_modules/react-native/" + file), "The bundle runs RN's own module: " + file);
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  }
  for (const file of ["../@react-native/js-polyfills/console.js", "../@react-native/js-polyfills/index.js",
    "src/private/setup/setUpDefaultReactNativeEnvironment.js", "ReactCommon/jsitooling/react/runtime/JSRuntimeBindings.cpp"]) {
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/, "Pin the RN source the oracle reads: " + file);
  }

  if (allowOriginalNegative) {
    assert.equal(result.status, 0, log);
    const failures = assertOnlyCheckErrors(report, log);
    assert.ok(report.originalNegativeObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedOriginalFailures), "Only the checks that need the new host qualify as the control");
    assert.match(log, new RegExp(`JS_GLOBALS_ORIGINAL_NEGATIVE: ${failures.length}`));
    // The previous host defined a console and a performance stub with only now before any JS of the bundle, so RN's fallback never installed.
    assert.equal(report.stages.host.console, "object");
    assert.equal(report.stages.host.performance, "object");
    assert.deepEqual(report.stages.environment.performance.ownKeys, ["now"]);
    assert.ok(oracleRejection(report, expected) != null, "The oracle rejects the previous host");
    return;
  }

  assert.equal(result.status, 0, log);
  assert.equal(report.originalNegativeObserved, false);
  assert.deepEqual(assertOnlyCheckErrors(report, log), []);
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.match(log, /JS_GLOBALS_PASSED: \d+/);
  verifyJsGlobalsReport(report, expected);
  const printed = assertHostPrinted(report, log);

  const original = await optionalJson("build/js-globals-original-report.json");
  if (original != null) {
    assert.ok(original.originalNegativeObserved);
    assert.deepEqual(original.checks.map(row => row.name), report.checks.map(row => row.name));
    assert.deepEqual(original.expectedOriginalFailures, report.expectedOriginalFailures);
    // The same SDK bundle runs on both hosts; only the compiled native producers differ.
    assert.equal(original.provenance.bundle.bundle.sha256, bundle.bundle.sha256);
    for (const [file, sha] of Object.entries(bundle.sources)) {
      if (!jsGlobalsNativeProducers.includes(file)) {
        assert.equal(original.provenance.bundle.sources[file], sha, "Old/new hosts share the reproducer and SDK producer: " + file);
      }
    }
    assert.notEqual(original.provenance.nativeHostSha256, report.provenance.nativeHostSha256);
  }
  const rejections = {};
  for (const name of sabotageNames) {
    const sabotaged = await optionalJson(`build/js-globals-sabotage-${name}-report.json`);
    if (sabotaged != null) {
      assert.ok(sabotaged.checks.some(row => !row.passed) && oracleRejection(sabotaged, expected) != null, name);
      assert.notEqual(sabotaged.provenance.bundle.bundle.sha256, bundle.bundle.sha256, `${name} bundles another SDK`);
      assert.equal(sabotaged.provenance.nativeHostSha256, report.provenance.nativeHostSha256, `${name} runs on the same host`);
      rejections[name] = {failures: sabotaged.checks.filter(row => !row.passed).map(row => row.name), oracle: oracleRejection(sabotaged, expected)};
    }
  }
  await writeFile(path.join(root, "build/js-globals-comparison.json"), JSON.stringify({scenario: report.scenario,
    originalControlPresent: original != null, sabotagePresent: Object.keys(rejections), hostPrintedMessages: printed,
    original: original == null ? null : {failures: original.checks.filter(row => !row.passed).map(row => row.name),
      nativeHostSha256: original.provenance.nativeHostSha256},
    sabotages: rejections, current: {checks: report.checks.length, nativeHostSha256: report.provenance.nativeHostSha256,
      bundleSha256: bundle.bundle.sha256}}, null, 2) + "\n");
});
