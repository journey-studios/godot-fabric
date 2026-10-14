import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleIdleCallbacksProbe, idleCallbacksNativeProducers, sabotageNamed, sabotageNames} from "../scripts/idle-callbacks-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {idleDerivedChecks, idleOracleRejection, idleExpectations, verifyIdleCallbacksReport} from "./idle-callbacks-oracle.mjs";

// GF-05 slice D2. A lane is the current SDK on the current host; --allow-original-negative runs the same bundle on the host this slice replaced (it
// registered no NativeIdleCallbacks module, so requestIdleCallback had nothing to reach), which must fail exactly the checks that need the new module;
// --sabotage=<name> runs it with one deliberate fault (tests/idle-callbacks-sabotages.mjs): a bundle with an in-memory override or, for the sabotage of the
// host, the host that scripts/idle-callbacks-sabotage.mjs built from the broken source. The probe and the independent oracle must both reject it. No source
// file is edited by a lane.
const root = fileURLToPath(new URL("..", import.meta.url));
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const sabotageArgument = process.argv.find(argument => argument === "--sabotage" || argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : (sabotageArgument.split("=")[1] ?? sabotageNames[0]);
assert.ok(sabotage === null || sabotageNames.includes(sabotage), "Unknown sabotage: " + sabotage);
assert.ok(!(allowOriginalNegative && sabotage !== null), "A run is the current host and SDK, the previous host, or one sabotage");
const lane = allowOriginalNegative ? "original" : sabotage === null ? "current" : `sabotage-${sabotage}`;
const digest = value => createHash("sha256").update(value).digest("hex");
const sorted = values => [...values].sort();
const guarded = ["src/runtime.js", "src/initialize.js", "sdk/toolchain/platform-plugin.mjs", "native/application_runtime.cpp", "native/turbo_module_registry.cpp"];

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

// Every ERROR line of a log is a failed check or the FABRIC_ERROR of a host failure: no native, script or engine error hides. The current lane makes no host
// failure; a lane whose bundle does not evaluate (setUpTimers not imported) makes the one that says so.
function assertErrorLines(report, log) {
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const lines = [...log.matchAll(/^ERROR: (.*)$/gm)].map(match => match[1]);
  const checkErrors = lines.filter(line => line.startsWith("FABRIC_CHECK_FAILED: ")).map(line => line.slice("FABRIC_CHECK_FAILED: ".length));
  const hostFailures = lines.filter(line => line.startsWith("FABRIC_ERROR: ")).map(line => line.slice("FABRIC_ERROR: ".length));
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  assert.equal(lines.length, checkErrors.length + hostFailures.length, "No native diagnostic, script or engine error is hidden");
  return {failures, hostFailures};
}

// The order each case came out in, for the comparison file.
const orderOf = (report, name) => report.stages[`case_${name.replace("-", "_")}`]?.labels ?? [];

test("RN's idle callbacks run over its NativeIdleCallbacks module under setUpTimers imported unchanged: the module, the deadline, the timeout, cancel, the order and the lifecycle gate", async () => {
  const before = await hashes();
  const bundle = await bundleIdleCallbacksProbe(sabotage);
  const variant = sabotage === null ? null : sabotageNamed(sabotage);
  const bundleFile = sabotage === null || variant.host === true ? "idle-callbacks-probe.js" : `idle-callbacks-sabotage-${sabotage}-probe.js`;
  const binary = await ensureGodotBinary();
  await rm(path.join(root, "build/idle-callbacks-report.json"), {force: true});
  const flags = [`--bundle=${bundleFile}`, ...(allowOriginalNegative ? ["--allow-original-negative"] : []), ...(sabotage === null ? [] : ["--sabotage"])];
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/idle-callbacks-probe.gd", "--", ...flags],
    {encoding: "utf8", timeout: 180000, maxBuffer: 32 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/idle-callbacks-${lane}.log`), log);
  const report = await optionalJson("build/idle-callbacks-report.json");
  if (report != null) {
    report.provenance = {node: process.version, lane, bundle, nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))),
      sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, `build/idle-callbacks-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  // Artifacts are saved before assertions. A control never accepts unrelated failures or removes the declared failures from the report.
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.ok(report != null, log);
  assert.equal(report.scenario, "native-idle-callbacks");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.bundle, bundleFile);
  assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  assert.equal(report.sabotage, sabotage !== null);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.equal(new Set(report.expectedOriginalFailures).size, report.expectedOriginalFailures.length);
  assert.deepEqual(await hashes(), before, "A sabotage never edits a source: it overrides it in memory, or builds a host from a copy the script restores");
  for (const file of ["tests/idle-callbacks-fixture.jsx", "tests/idle-callbacks-cases.mjs", "tests/idle-callbacks-probe.gd", "tests/idle-callbacks-native.test.mjs",
    "tests/idle-callbacks-oracle.mjs", "tests/idle-callbacks-sabotages.mjs", "tests/react-microtasks-host.js", "tests/react-microtasks-oracle.mjs", "scripts/idle-callbacks-bundle.mjs",
    "scripts/idle-callbacks-sabotage.mjs", "scripts/native-probe-bundle.mjs", "src/runtime.js", "src/initialize.js", "sdk/toolchain/platform-plugin.mjs",
    "sdk/toolchain/metro-polyfills.mjs", ...idleCallbacksNativeProducers]) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  // The checks that need the new module are normative; the rest hold on both hosts.
  assert.ok(report.expectedOriginalFailures.length > 0 && report.expectedOriginalFailures.length < report.checks.length);
  const expected = await idleExpectations(root);
  assert.deepEqual(idleDerivedChecks(report, expected), report.checks, "The oracle derives every verdict the probe gave, from the raw observations, RN's sources and V8");

  if (sabotage !== null) {
    assert.equal(result.status, 0, log);
    const {failures} = assertErrorLines(report, log);
    assert.ok(failures.length > 0, "The probe's checks reject the sabotaged lane");
    assert.match(log, new RegExp(`IDLE_CALLBACKS_SABOTAGE_REJECTED: ${failures.length}`));
    assert.ok(idleOracleRejection(report, expected) != null, "The oracle rejects the sabotaged lane");
    return;
  }

  // The bundle runs RN's own setUpTimers and the modules it installs the globals from, and the host's source holds only the gate: none of what setUpTimers installs
  // is installed by the host.
  const inputs = bundle.bundle.inputs;
  assert.equal(inputs[0], "tests/react-microtasks-host.js");
  assert.ok(inputs.includes("src/runtime.js") && inputs.includes("src/initialize.js"));
  for (const file of ["Libraries/Core/setUpTimers.js", "Libraries/Utilities/PolyfillFunctions.js", "src/private/webapis/idlecallbacks/specs/NativeIdleCallbacks.js",
    "src/private/webapis/microtasks/specs/NativeMicrotasks.js", "Libraries/TurboModule/TurboModuleRegistry.js", "Libraries/Core/Timers/immediateShim.js"]) {
    assert.ok(inputs.includes("node_modules/react-native/" + file), "The bundle runs RN's own module: " + file);
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  }
  for (const file of ["Libraries/Core/setUpTimers.js", "ReactCommon/react/nativemodule/idlecallbacks/NativeIdleCallbacks.cpp", "ReactCommon/react/nativemodule/idlecallbacks/NativeIdleCallbacks.h",
    "ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler.cpp", "ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler.h",
    "ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler_Modern.cpp", "ReactCommon/react/renderer/runtimescheduler/SchedulerPriorityUtils.h",
    "ReactCommon/react/renderer/runtimescheduler/Task.h", "ReactCommon/react/renderer/runtimescheduler/Task.cpp", "ReactCommon/react/renderer/core/EventBeat.cpp",
    "src/private/setup/setUpDefaultReactNativeEnvironment.js"]) {
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/, "Pin the RN source the oracle reads: " + file);
  }
  const runtime = (await readFile(path.join(root, "src/runtime.js"), "utf8")).replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(runtime, /RN\$enableMicrotasksInReact|immediateShim|globalThis\.(?:setImmediate|clearImmediate|queueMicrotask|requestIdleCallback|cancelIdleCallback)\s*=/,
    "src/runtime.js installs nothing that setUpTimers installs");
  const initialize = await readFile(path.join(root, "src/initialize.js"), "utf8");
  const position = specifier => initialize.indexOf(`import "${specifier}";`);
  assert.ok(position("react-native/Libraries/Core/setUpPerformance") !== -1 && position("react-native/Libraries/Core/setUpPerformance") < position("react-native/Libraries/Core/setUpTimers")
    && position("react-native/Libraries/Core/setUpTimers") < position("./runtime") && position("./runtime") < position("react-native/Libraries/Core/setUpErrorHandling"),
  "src/initialize.js imports setUpTimers at RN's place in the chain, and the host's gate right after it");

  if (allowOriginalNegative) {
    assert.equal(result.status, 0, log);
    const {failures} = assertErrorLines(report, log);
    assert.ok(report.originalNegativeObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedOriginalFailures), "Only the checks that need the new module qualify as the control");
    assert.match(log, new RegExp(`IDLE_CALLBACKS_ORIGINAL_NEGATIVE: ${failures.length}`));
    // The previous host registers no NativeIdleCallbacksCxx: the spec module cannot load, and the registry has no counter.
    assert.equal(report.stages.environment.native.loaded, false);
    assert.equal(report.stages.registry?.nativeModules?.idleCallbacks, undefined);
    assert.ok(idleOracleRejection(report, expected) != null, "The oracle rejects the previous host");
    return;
  }

  assert.equal(result.status, 0, log);
  assert.equal(report.originalNegativeObserved, false);
  const {failures, hostFailures} = assertErrorLines(report, log);
  assert.deepEqual(failures, []);
  assert.deepEqual(hostFailures, [], "The current lane records no host failure");
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.match(log, /IDLE_CALLBACKS_PASSED: \d+/);
  verifyIdleCallbacksReport(report, expected);
  // The counters never go back: the requests after the stop are at least the batch and the cancels at least the batch's.
  assert.ok(report.stages.after_stop.requests >= report.stages.request_many.after.requests, "The request counter never goes back");
  assert.ok(report.stages.after_stop.cancels >= report.stages.cancel_many.after.cancels, "The cancel counter never goes back");

  const original = await optionalJson("build/idle-callbacks-original-report.json");
  if (original != null) {
    assert.ok(original.originalNegativeObserved);
    assert.deepEqual(original.checks.map(row => row.name), report.checks.map(row => row.name));
    assert.deepEqual(original.expectedOriginalFailures, report.expectedOriginalFailures);
    // The same SDK bundle runs on both hosts; only the compiled native producers differ.
    assert.equal(original.provenance.bundle.bundle.sha256, bundle.bundle.sha256);
    for (const [file, sha] of Object.entries(bundle.sources)) {
      if (!idleCallbacksNativeProducers.includes(file)) {
        assert.equal(original.provenance.bundle.sources[file], sha, "Old/new hosts share the reproducer and SDK producer: " + file);
      }
    }
    assert.notEqual(original.provenance.nativeHostSha256, report.provenance.nativeHostSha256);
  }
  const rejections = {};
  for (const name of sabotageNames) {
    const sabotaged = await optionalJson(`build/idle-callbacks-sabotage-${name}-report.json`);
    if (sabotaged != null) {
      assert.ok(sabotaged.checks.some(row => !row.passed) && idleOracleRejection(sabotaged, expected) != null, name);
      if (sabotageNamed(name).host === true) {
        assert.equal(sabotaged.provenance.bundle.bundle.sha256, bundle.bundle.sha256, `${name} runs the current bundle`);
        assert.notEqual(sabotaged.provenance.nativeHostSha256, report.provenance.nativeHostSha256, `${name} runs on another host`);
      } else {
        assert.notEqual(sabotaged.provenance.bundle.bundle.sha256, bundle.bundle.sha256, `${name} bundles another SDK`);
        assert.equal(sabotaged.provenance.nativeHostSha256, report.provenance.nativeHostSha256, `${name} runs on the same host`);
      }
      rejections[name] = {failures: sabotaged.checks.filter(row => !row.passed).map(row => row.name), oracle: idleOracleRejection(sabotaged, expected),
        orders: Object.fromEntries(Object.keys(expected.orders).map(key => [key, orderOf(sabotaged, key)]))};
    }
  }
  await writeFile(path.join(root, "build/idle-callbacks-comparison.json"), JSON.stringify({scenario: report.scenario,
    originalControlPresent: original != null, sabotagePresent: Object.keys(rejections),
    original: original == null ? null : {failures: original.checks.filter(row => !row.passed).map(row => row.name),
      nativeHostSha256: original.provenance.nativeHostSha256},
    sabotages: rejections, current: {checks: report.checks.length, nativeHostSha256: report.provenance.nativeHostSha256,
      bundleSha256: bundle.bundle.sha256, orders: Object.fromEntries(Object.keys(expected.orders).map(key => [key, orderOf(report, key)]))}}, null, 2) + "\n");
});
