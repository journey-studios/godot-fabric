import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleReactMicrotasksProbe, reactMicrotasksNativeProducers, sabotageNamed, sabotageNames} from "../scripts/react-microtasks-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {derivedChecks, explainedByModel, oracleRejection, rnExpectations, verifyReactMicrotasksReport} from "./react-microtasks-oracle.mjs";

// GF-05 slice D1. A lane is the current SDK on the current host; --allow-original-negative runs the same bundle on the host this slice replaced (it
// registered no NativeMicrotasks module, so queueMicrotask had nothing to reach and the first React update threw), which must fail exactly the checks that
// need the new module; --sabotage=<name> runs it with one deliberate fault (tests/react-microtasks-sabotages.mjs): a bundle with an in-memory override or,
// for the sabotage of the host, the host that scripts/react-microtasks-sabotage.mjs built from the broken source. The probe and the independent oracle must
// both reject it. No source file is edited by a lane.
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

// Where the tree stood when the lane ran: the commit it was on and every path that differed from it (a modified, added or untracked file; ignored
// paths such as build/ are not listed). The committed record of the lanes (scripts/react-microtasks-evidence.mjs) reads this and not the state of the
// tree at the time it is written, which can be another commit. docs/evidence/runtime/react-microtasks.json is left out: it is what that script writes.
function gitState() {
  const run = (...args) => spawnSync("git", args, {cwd: root, encoding: "utf8"});
  const head = run("rev-parse", "HEAD");
  const status = run("status", "--porcelain", "--untracked-files=all", "--", ".", ":(exclude)docs/evidence/runtime/react-microtasks.json");
  if (head.status !== 0 || status.status !== 0) {
    return null;
  }
  return {head: head.stdout.trim(), dirtyPaths: status.stdout.split("\n").filter(line => line !== "").map(line => line.slice(3)).sort()};
}

async function hashes() {
  return Object.fromEntries(await Promise.all(guarded.map(async file => [file, digest(await readFile(path.join(root, file)))])));
}

// Every ERROR line of a log is a failed check or the FABRIC_ERROR of a host failure: no native, script or engine error hides. The current lane makes no
// host failure; a lane that runs on a host without the module makes the ones the throwing queueMicrotask causes.
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

test("React's sync work flushes in a microtask over RN's NativeMicrotasks module: the flag, the global, the queue's order and the lifecycle gate", async () => {
  const before = await hashes();
  const bundle = await bundleReactMicrotasksProbe(sabotage);
  const variant = sabotage === null ? null : sabotageNamed(sabotage);
  const bundleFile = sabotage === null || variant.host === true ? "react-microtasks-probe.js" : `react-microtasks-sabotage-${sabotage}-probe.js`;
  const binary = await ensureGodotBinary();
  await rm(path.join(root, "build/react-microtasks-report.json"), {force: true});
  const flags = [`--bundle=${bundleFile}`, ...(allowOriginalNegative ? ["--allow-original-negative"] : []), ...(sabotage === null ? [] : ["--sabotage"])];
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/react-microtasks-probe.gd", "--", ...flags],
    {encoding: "utf8", timeout: 180000, maxBuffer: 32 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/react-microtasks-${lane}.log`), log);
  const report = await optionalJson("build/react-microtasks-report.json");
  if (report != null) {
    report.provenance = {node: process.version, lane, bundle, nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))),
      git: gitState(), sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, `build/react-microtasks-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  // Artifacts are saved before assertions. A control never accepts unrelated failures or removes the declared failures from the report.
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.ok(report != null, log);
  assert.equal(report.scenario, "native-react-microtasks");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.bundle, bundleFile);
  assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  assert.equal(report.sabotage, sabotage !== null);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.equal(new Set(report.expectedOriginalFailures).size, report.expectedOriginalFailures.length);
  assert.deepEqual(await hashes(), before, "A sabotage never edits a source: it overrides it in memory, or builds a host from a copy the script restores");
  for (const file of ["tests/react-microtasks-fixture.jsx", "tests/react-microtasks-host.js", "tests/react-microtasks-cases.mjs", "tests/react-microtasks-probe.gd",
    "tests/react-microtasks-native.test.mjs", "tests/react-microtasks-oracle.mjs", "tests/react-microtasks-sabotages.mjs", "scripts/react-microtasks-bundle.mjs",
    "scripts/react-microtasks-sabotage.mjs", "scripts/native-probe-bundle.mjs", "src/runtime.js", "src/initialize.js", "sdk/toolchain/platform-plugin.mjs",
    "sdk/toolchain/metro-polyfills.mjs", ...reactMicrotasksNativeProducers]) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  // The checks that need the new module are normative; the rest hold on both hosts.
  assert.ok(report.expectedOriginalFailures.length > 0 && report.expectedOriginalFailures.length < report.checks.length);
  const expected = await rnExpectations(root);
  assert.deepEqual(derivedChecks(report, expected), report.checks, "The oracle derives every verdict the probe gave, from the raw observations, RN's sources, the pinned renderer and V8");

  if (sabotage !== null) {
    assert.equal(result.status, 0, log);
    const {failures} = assertErrorLines(report, log);
    assert.ok(failures.length > 0, "The probe's checks reject the sabotaged lane");
    assert.match(log, new RegExp(`REACT_MICROTASKS_SABOTAGE_REJECTED: ${failures.length}`));
    assert.ok(oracleRejection(report, expected) != null, "The oracle rejects the sabotaged lane");
    if (sabotage === "flag-unset") {
      // With the flag off the cases come out in the order the model derives for the flag off: React's job is a RuntimeScheduler task again, behind the
      // microtasks queued after the update. That says the model describes this host, in the direction the passing lane does not show.
      assert.equal(explainedByModel(report, expected), null);
      assert.notDeepEqual(orderOf(report, "react-microtask"), expected.orders.on["react-microtask"]);
    }
    return;
  }

  // The injection order: the host-state module runs before everything else in the bundle.
  const inputs = bundle.bundle.inputs;
  assert.equal(inputs[0], "tests/react-microtasks-host.js");
  assert.ok(inputs.includes("src/runtime.js") && inputs.includes("src/initialize.js"));
  for (const file of ["src/private/webapis/microtasks/specs/NativeMicrotasks.js", "Libraries/TurboModule/TurboModuleRegistry.js", "Libraries/Core/Timers/immediateShim.js"]) {
    assert.ok(inputs.includes("node_modules/react-native/" + file), "The bundle runs RN's own module: " + file);
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  }
  assert.ok(!inputs.includes("node_modules/react-native/Libraries/Core/Timers/queueMicrotask.js"), "The portable queueMicrotask shim is no longer in the bundle");
  for (const file of ["Libraries/Core/setUpTimers.js", "Libraries/Core/Timers/queueMicrotask.js", "Libraries/Renderer/implementations/ReactFabric-prod.js",
    "ReactCommon/react/nativemodule/microtasks/NativeMicrotasks.cpp", "ReactCommon/react/nativemodule/microtasks/NativeMicrotasks.h",
    "ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler_Modern.cpp", "ReactCommon/react/renderer/runtimescheduler/SchedulerPriorityUtils.h",
    "ReactCommon/react/renderer/runtimescheduler/Task.h", "ReactCommon/react/renderer/core/EventBeat.cpp", "src/private/setup/setUpDefaultReactNativeEnvironment.js"]) {
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/, "Pin the RN source the oracle reads: " + file);
  }

  if (allowOriginalNegative) {
    assert.equal(result.status, 0, log);
    const {failures} = assertErrorLines(report, log);
    assert.ok(report.originalNegativeObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedOriginalFailures), "Only the checks that need the new module qualify as the control");
    assert.match(log, new RegExp(`REACT_MICROTASKS_ORIGINAL_NEGATIVE: ${failures.length}`));
    // The previous host registers no NativeMicrotasksCxx: the spec module cannot load, and the registry has no counter.
    assert.equal(report.stages.environment.native.loaded, false);
    assert.equal(report.stages.registry?.microtasks, undefined);
    assert.ok(oracleRejection(report, expected) != null, "The oracle rejects the previous host");
    return;
  }

  assert.equal(result.status, 0, log);
  assert.equal(report.originalNegativeObserved, false);
  const {failures, hostFailures} = assertErrorLines(report, log);
  assert.deepEqual(failures, []);
  assert.deepEqual(hostFailures, [], "The current lane records no host failure");
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.match(log, /REACT_MICROTASKS_PASSED: \d+/);
  verifyReactMicrotasksReport(report, expected);
  assert.equal(explainedByModel(report, expected), null);
  // The counter never goes back: the calls after the batch are at least the batch.
  assert.ok(report.stages.after_stop.calls >= report.stages.queue_many.after, "The counter never goes back");

  const original = await optionalJson("build/react-microtasks-original-report.json");
  if (original != null) {
    assert.ok(original.originalNegativeObserved);
    assert.deepEqual(original.checks.map(row => row.name), report.checks.map(row => row.name));
    assert.deepEqual(original.expectedOriginalFailures, report.expectedOriginalFailures);
    // The same SDK bundle runs on both hosts; only the compiled native producers differ.
    assert.equal(original.provenance.bundle.bundle.sha256, bundle.bundle.sha256);
    for (const [file, sha] of Object.entries(bundle.sources)) {
      if (!reactMicrotasksNativeProducers.includes(file)) {
        assert.equal(original.provenance.bundle.sources[file], sha, "Old/new hosts share the reproducer and SDK producer: " + file);
      }
    }
    assert.notEqual(original.provenance.nativeHostSha256, report.provenance.nativeHostSha256);
  }
  const rejections = {};
  for (const name of sabotageNames) {
    const sabotaged = await optionalJson(`build/react-microtasks-sabotage-${name}-report.json`);
    if (sabotaged != null) {
      assert.ok(sabotaged.checks.some(row => !row.passed) && oracleRejection(sabotaged, expected) != null, name);
      if (name === "flag-unset") {
        assert.equal(explainedByModel(sabotaged, expected), null, "The flag-unset lane comes out in the order the model gives for the flag off");
      }
      if (sabotageNamed(name).host === true) {
        assert.equal(sabotaged.provenance.bundle.bundle.sha256, bundle.bundle.sha256, `${name} runs the current bundle`);
        assert.notEqual(sabotaged.provenance.nativeHostSha256, report.provenance.nativeHostSha256, `${name} runs on another host`);
      } else {
        assert.notEqual(sabotaged.provenance.bundle.bundle.sha256, bundle.bundle.sha256, `${name} bundles another SDK`);
        assert.equal(sabotaged.provenance.nativeHostSha256, report.provenance.nativeHostSha256, `${name} runs on the same host`);
      }
      rejections[name] = {failures: sabotaged.checks.filter(row => !row.passed).map(row => row.name), oracle: oracleRejection(sabotaged, expected),
        orders: Object.fromEntries(Object.keys(expected.orders.on).map(key => [key, orderOf(sabotaged, key)]))};
    }
  }
  await writeFile(path.join(root, "build/react-microtasks-comparison.json"), JSON.stringify({scenario: report.scenario,
    originalControlPresent: original != null, sabotagePresent: Object.keys(rejections),
    original: original == null ? null : {failures: original.checks.filter(row => !row.passed).map(row => row.name),
      nativeHostSha256: original.provenance.nativeHostSha256},
    sabotages: rejections, current: {checks: report.checks.length, nativeHostSha256: report.provenance.nativeHostSha256,
      bundleSha256: bundle.bundle.sha256, orders: Object.fromEntries(Object.keys(expected.orders.on).map(key => [key, orderOf(report, key)])),
      modelFlagOff: expected.orders.off}}, null, 2) + "\n");
});
