import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleJsExceptionsProbe, jsExceptionsNativeProducers, sabotageNames} from "../scripts/js-exceptions-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {exceptionsDerivedChecks, exceptionsExpectations, exceptionsOracleRejection, verifyJsExceptionsReport} from "./js-exceptions-oracle.mjs";

// GF-05 slice F. A lane is the current SDK on the current host; --allow-original-negative runs the same bundle on the host this slice replaced (it recorded a callback's exception where
// it caught it, as error.what(), and drained the microtasks with a single call), which must fail exactly the checks that need the new routing; --sabotage=<name> runs it on a host
// with one deliberate fault (tests/js-exceptions-sabotages.mjs, built by scripts/js-exceptions-sabotage.mjs). The probe and the independent oracle must both reject it. No source
// file is edited by a lane.
const root = fileURLToPath(new URL("..", import.meta.url));
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const sabotageArgument = process.argv.find(argument => argument === "--sabotage" || argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : (sabotageArgument.split("=")[1] ?? sabotageNames[0]);
assert.ok(sabotage === null || sabotageNames.includes(sabotage), "Unknown sabotage: " + sabotage);
assert.ok(!(allowOriginalNegative && sabotage !== null), "A run is the current host, the previous host, or one sabotage");
const lane = allowOriginalNegative ? "original" : sabotage === null ? "current" : `sabotage-${sabotage}`;
const digest = value => createHash("sha256").update(value).digest("hex");
const sorted = values => [...values].sort();
const guarded = ["src/initialize.js", "src/runtime.js", "native/application_runtime.cpp", "native/js_error_path.cpp"];

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

// Where the tree stood when the lane ran: the commit it was on and every path that differed from it (a modified, added or untracked file; ignored paths such as build/ are not
// listed). The committed record of the lanes (scripts/js-exceptions-evidence.mjs) reads this and not the state of the tree at the time it is written, which can be another commit.
// docs/evidence/runtime/js-exceptions.json is left out: it is what that script writes.
function gitState() {
  const run = (...args) => spawnSync("git", args, {cwd: root, encoding: "utf8"});
  const head = run("rev-parse", "HEAD");
  const status = run("status", "--porcelain", "--untracked-files=all", "--", ".", ":(exclude)docs/evidence/runtime/js-exceptions.json");
  if (head.status !== 0 || status.status !== 0) {
    return null;
  }
  return {head: head.stdout.trim(), dirtyPaths: status.stdout.split("\n").filter(line => line !== "").map(line => line.slice(3)).sort()};
}

async function hashes() {
  return Object.fromEntries(await Promise.all(guarded.map(async file => [file, digest(await readFile(path.join(root, file)))])));
}

// Every ERROR line of a log is a failed check or the FABRIC_ERROR of a host failure: no native, script or engine error hides.
function assertErrorLines(report, log) {
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const lines = [...log.matchAll(/^ERROR: (.*)$/gm)].map(match => match[1]);
  const checkErrors = lines.filter(line => line.startsWith("FABRIC_CHECK_FAILED: ")).map(line => line.slice("FABRIC_CHECK_FAILED: ".length));
  const hostFailures = lines.filter(line => line.startsWith("FABRIC_ERROR: ")).map(line => line.slice("FABRIC_ERROR: ".length));
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  assert.equal(lines.length, checkErrors.length + hostFailures.length, "No native diagnostic, script or engine error is hidden");
  return {failures, hostFailures};
}

// The failures the two applications recorded, in order: the first line of each is what FABRIC_ERROR printed. The main application's list is read after its stop, so it holds the
// whole run; the application that lost its scheduler has a list of its own.
function recordedFailures(report) {
  const stages = report.stages;
  return [...(stages.stop?.application?.errors ?? []), ...(stages.wedge_stop?.application?.errors ?? [])].map(text => text.split("\n")[0]);
}

// The host printed every soft exception the module counted: one HERMES line for each, in the log of the process that ran both applications.
function assertSoftLogged(report, log) {
  const soft = Number(report.stages.stop?.application?.jsErrors?.module?.soft ?? 0) + Number(report.stages.wedge_stop?.application?.jsErrors?.module?.soft ?? 0);
  const lines = [...log.matchAll(/^HERMES: ExceptionsManager soft exception: (.*)$/gm)].map(match => match[1]);
  assert.equal(lines.length, soft, "The host logs a soft exception once, and logs nothing else as one");
  for (const line of lines) {
    assert.match(line, /^Error: js-exceptions soft\/soft, stack:$/);
  }
  return soft;
}

test("RN's callback exceptions and its microtask checkpoint run in the host: where each kind reports, what still runs, the retry bound, and a Promise storm", async () => {
  const before = await hashes();
  const bundle = await bundleJsExceptionsProbe();
  const bundleFile = "js-exceptions-probe.js";
  const binary = await ensureGodotBinary();
  await rm(path.join(root, "build/js-exceptions-report.json"), {force: true});
  const flags = [`--bundle=${bundleFile}`, ...(allowOriginalNegative ? ["--allow-original-negative"] : []), ...(sabotage === null ? [] : ["--sabotage"])];
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/js-exceptions-probe.gd", "--", ...flags],
    {encoding: "utf8", timeout: 240000, maxBuffer: 256 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/js-exceptions-${lane}.log`), log);
  const report = await optionalJson("build/js-exceptions-report.json");
  if (report != null) {
    report.provenance = {node: process.version, lane, bundle, nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))),
      git: gitState(), sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, `build/js-exceptions-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  // Artifacts are saved before assertions. A control never accepts unrelated failures or removes the declared failures from the report.
  assert.equal(result.error, undefined, log.slice(-4000));
  assert.equal(result.signal, null, log.slice(-4000));
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.ok(report != null, log.slice(-4000));
  assert.equal(report.scenario, "native-js-exceptions");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.bundle, bundleFile);
  assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  assert.equal(report.sabotage, sabotage !== null);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.equal(new Set(report.expectedOriginalFailures).size, report.expectedOriginalFailures.length);
  assert.deepEqual(await hashes(), before, "A sabotage never edits a source: it builds a host from a copy the script restores");
  for (const file of ["tests/js-exceptions-fixture.jsx", "tests/js-exceptions-host.js", "tests/js-exceptions-cases.mjs", "tests/js-exceptions-probe.gd", "tests/js-exceptions-native.test.mjs",
    "tests/js-exceptions-oracle.mjs", "tests/js-exceptions-sabotages.mjs", "scripts/js-exceptions-bundle.mjs", "scripts/js-exceptions-sabotage.mjs", "scripts/native-probe-bundle.mjs",
    "src/initialize.js", "src/runtime.js", "sdk/toolchain/platform-plugin.mjs", "sdk/toolchain/metro-polyfills.mjs", ...jsExceptionsNativeProducers]) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  // The checks that need the new routing are normative; the rest hold on both hosts.
  assert.ok(report.expectedOriginalFailures.length > 0 && report.expectedOriginalFailures.length < report.checks.length);
  const expected = await exceptionsExpectations(root);
  assert.deepEqual(exceptionsDerivedChecks(report, expected), report.checks, "The oracle derives every verdict the probe gave, from the raw observations, RN's sources and a model of RN's event loop");
  const {failures, hostFailures} = assertErrorLines(report, log);
  assert.deepEqual(hostFailures, recordedFailures(report), "The log holds the failures the applications recorded, in order, and no other");

  if (sabotage !== null) {
    assert.equal(result.status, 0, log.slice(-4000));
    assert.ok(failures.length > 0, "The probe's checks reject the sabotaged lane");
    assert.match(log, new RegExp(`JS_EXCEPTIONS_SABOTAGE_REJECTED: ${failures.length}`));
    assert.ok(exceptionsOracleRejection(report, expected) != null, "The oracle rejects the sabotaged lane");
    return;
  }

  // The injection order: the host-state module runs before the Metro polyfills, and all of them before every module of the bundle.
  const inputs = bundle.bundle.inputs;
  assert.equal(inputs[0], "tests/js-exceptions-host.js");
  assert.ok(inputs.includes("src/initialize.js") && inputs.includes("src/runtime.js"));
  for (const file of ["Libraries/Core/setUpTimers.js", "Libraries/Core/Timers/immediateShim.js", "Libraries/Core/setUpErrorHandling.js", "Libraries/Core/ExceptionsManager.js",
    "src/private/webapis/microtasks/specs/NativeMicrotasks.js", "src/private/webapis/idlecallbacks/specs/NativeIdleCallbacks.js"]) {
    assert.ok(inputs.includes("node_modules/react-native/" + file), "The bundle runs RN's own module: " + file);
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  }
  for (const file of ["ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler_Modern.cpp", "ReactCommon/react/runtime/TimerManager.cpp", "ReactCommon/react/runtime/ReactInstance.cpp",
    "ReactCommon/react/nativemodule/idlecallbacks/NativeIdleCallbacks.cpp", "Libraries/Core/polyfillPromise.js", "Libraries/Renderer/implementations/ReactFabric-prod.js",
    "React/Fabric/RCTScheduler.mm", "ReactCommon/jsi/jsi/jsi.h"]) {
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/, "Pin the RN source the oracle reads: " + file);
  }

  if (allowOriginalNegative) {
    assert.equal(result.status, 0, log.slice(-4000));
    assert.ok(report.originalNegativeObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedOriginalFailures), "Only the checks that need the new routing qualify as the control");
    assert.match(log, new RegExp(`JS_EXCEPTIONS_ORIGINAL_NEGATIVE: ${failures.length}`));
    assert.ok(exceptionsOracleRejection(report, expected) != null, "The oracle rejects the previous host");
    return;
  }

  assert.equal(result.status, 0, log.slice(-4000));
  assert.equal(report.originalNegativeObserved, false);
  assert.deepEqual(failures, []);
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.match(log, /JS_EXCEPTIONS_PASSED: \d+/);
  verifyJsExceptionsReport(report, expected);
  const logged = assertSoftLogged(report, log);

  const original = await optionalJson("build/js-exceptions-original-report.json");
  if (original != null) {
    assert.ok(original.originalNegativeObserved);
    assert.deepEqual(original.checks.map(row => row.name), report.checks.map(row => row.name));
    assert.deepEqual(original.expectedOriginalFailures, report.expectedOriginalFailures);
    // The same SDK bundle runs on both hosts; only the compiled native producers differ.
    assert.equal(original.provenance.bundle.bundle.sha256, bundle.bundle.sha256);
    for (const [file, sha] of Object.entries(bundle.sources)) {
      if (!jsExceptionsNativeProducers.includes(file)) {
        assert.equal(original.provenance.bundle.sources[file], sha, "Old/new hosts share the reproducer and SDK producer: " + file);
      }
    }
    assert.notEqual(original.provenance.nativeHostSha256, report.provenance.nativeHostSha256);
  }
  const rejections = {};
  for (const name of sabotageNames) {
    const sabotaged = await optionalJson(`build/js-exceptions-sabotage-${name}-report.json`);
    if (sabotaged != null) {
      assert.ok(sabotaged.checks.some(row => !row.passed) && exceptionsOracleRejection(sabotaged, expected) != null, name);
      assert.equal(sabotaged.provenance.bundle.bundle.sha256, bundle.bundle.sha256, `${name} runs the current bundle`);
      assert.notEqual(sabotaged.provenance.nativeHostSha256, report.provenance.nativeHostSha256, `${name} runs on another host`);
      rejections[name] = {failures: sabotaged.checks.filter(row => !row.passed).map(row => row.name), oracle: exceptionsOracleRejection(sabotaged, expected)};
    }
  }
  await writeFile(path.join(root, "build/js-exceptions-comparison.json"), JSON.stringify({scenario: report.scenario,
    originalControlPresent: original != null, sabotagePresent: Object.keys(rejections), hostLoggedSoftExceptions: logged, hostFailureLines: hostFailures.length,
    original: original == null ? null : {failures: original.checks.filter(row => !row.passed).map(row => row.name), nativeHostSha256: original.provenance.nativeHostSha256},
    sabotages: rejections, current: {checks: report.checks.length, nativeHostSha256: report.provenance.nativeHostSha256, bundleSha256: bundle.bundle.sha256}}, null, 2) + "\n");
});
