import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleNativeAnimatedProbe, nativeAnimatedNativeProducers} from "../scripts/native-animated-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {verifyJsDriverReport, verifyNativeAnimatedReport, verifyPersistence} from "./native-animated-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// The preceding host has no NativeAnimatedModule: --allow-original-negative runs
// the same bundle on it. --sabotage runs it on a host whose choreographer hands
// RN's backend its timestamps in seconds, and --sabotage=persistence on one whose
// JS thread does not update the shadow node references JS holds, as RN's
// ReactInstance does (scripts/native-animated-sabotage.mjs builds those hosts and
// restores the source).
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const sabotageArgument = process.argv.find(argument => argument === "--sabotage" || argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : (sabotageArgument.split("=")[1] ?? "frames");
assert.ok([null, "frames", "persistence"].includes(sabotage), "Unknown sabotage: " + sabotage);
const lane = allowOriginalNegative ? "original" : sabotage === null ? "current" : sabotage === "frames" ? "sabotage" : `sabotage-${sabotage}`;
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

async function runProbe(binary, bundle) {
  await rm(path.join(root, "build/native-animated-report.json"), {force: true});
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/native-animated-probe.gd", "--",
    ...(allowOriginalNegative ? ["--allow-original-negative"] : []), ...(sabotage === null ? [] : ["--sabotage"])],
  {encoding: "utf8", timeout: 240000, maxBuffer: 32 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/native-animated-${lane}.log`), log);
  const report = await optionalJson("build/native-animated-report.json");
  if (report != null) {
    report.provenance = {node: process.version, bundle,
      nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, `build/native-animated-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  return {result, log, report};
}

// The oracle must reject a report on its own derivations, even with every
// probe check marked as passed.
function oracleRejection(report) {
  try {
    verifyNativeAnimatedReport({...report, checks: report.checks.map(row => ({...row, passed: true}))});
  } catch (error) {
    return String(error.message).split("\n")[0];
  }
  return null;
}

function assertSameReproducer(control, report, bundle, name) {
  assert.deepEqual(control.checks.map(row => row.name), report.checks.map(row => row.name), name);
  assert.deepEqual(control.expectedOriginalFailures, report.expectedOriginalFailures, name);
  assert.equal(control.provenance.bundle.bundle.sha256, bundle.bundle.sha256, name + ": the same bundle runs on every host");
  // Only the compiled native producers differ between hosts; their bundle-time pins say nothing about them.
  for (const [file, sha] of Object.entries(bundle.sources)) {
    if (!nativeAnimatedNativeProducers.includes(file)) {
      assert.equal(control.provenance.bundle.sources[file], sha, `${name} shares the reproducer and SDK producer: ${file}`);
    }
  }
  assert.notEqual(control.provenance.nativeHostSha256, report.provenance.nativeHostSha256, name);
}

test("RN's original Animated, Easing and TouchableOpacity run both drivers on the Godot frame tick", async () => {
  const bundle = await bundleNativeAnimatedProbe();
  const binary = await ensureGodotBinary();
  const {result, log, report} = await runProbe(binary, bundle);
  // Artifacts are saved before assertions. A control flag never accepts
  // unrelated failures or removes the declared failures from the report.
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.equal(result.status, 0, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.equal(report.scenario, "native-animated");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.equal(new Set(report.expectedOriginalFailures).size, report.expectedOriginalFailures.length);
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  // Every ERROR line is a failed check: no native, script or engine error hides.
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length, "No native diagnostic, script or engine error is hidden");
  for (const file of ["tests/native-animated-fixture.jsx", "tests/native-animated-cases.mjs", "tests/native-animated-probe.gd",
    "tests/native-animated-native.test.mjs", "tests/native-animated-oracle.mjs", "scripts/native-animated-bundle.mjs",
    "scripts/native-probe-bundle.mjs", "src/react-native-platform.jsx", "src/animated-exports.js", "src/platform-color-value-types.js",
    "sdk/toolchain/platform-plugin.mjs", ...nativeAnimatedNativeProducers]) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  for (const file of ["Libraries/Animated/Animated.js", "Libraries/Animated/AnimatedImplementation.js",
    "src/private/animated/NativeAnimatedHelper.js", "Libraries/Components/Touchable/TouchableOpacity.js",
    "ReactCommon/react/renderer/animated/drivers/FrameAnimationDriver.cpp",
    "ReactCommon/react/renderer/animationbackend/AnimationBackend.cpp", "React/Fabric/Mounting/RCTMountingManager.mm"]) {
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  }
  // The checks that need RN's native module are normative; the JS-driver and
  // surface ones hold on both hosts.
  assert.ok(report.expectedOriginalFailures.length > 0 && report.expectedOriginalFailures.length < report.checks.length);
  if (allowOriginalNegative) {
    // Without the module every Animated.View fails at mount (RN asserts it
    // there), so exactly the checks that need a mounted view or the backend fail.
    assert.ok(report.originalNegativeObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedOriginalFailures),
      "Only the checks that need RN's native module qualify as the old-host control");
    assert.match(log, new RegExp(`NATIVE_ANIMATED_ORIGINAL_NEGATIVE: ${failures.length}`));
    const mount = report.stages.mount;
    assert.ok(mount.errors.some(row => row.message === "Native animated module is not available"));
    assert.ok(!("enabled" in mount.animated));
    // The JS drivers match the oracle on this host too; everything native is rejected.
    verifyJsDriverReport(report);
    assert.ok(oracleRejection(report) != null, "The oracle rejects the preceding host");
    return;
  }
  assert.equal(report.originalNegativeObserved, false);
  if (sabotage !== null) {
    assert.ok(failures.length > 0);
    assert.match(log, new RegExp(`NATIVE_ANIMATED_SABOTAGE_REJECTED: ${failures.length}`));
    const rejection = oracleRejection(report);
    assert.ok(rejection != null, "The oracle rejects the sabotaged report");
    if (sabotage === "persistence") {
      // Everything else a host with RN's backend does is right: the animations
      // run on their curves. Only what React commits undo is wrong: the box
      // that animates back after other commits, and every box's final props.
      assert.deepEqual(sorted(failures), sorted([
        "native-two-roots/Unmounting one root mid-animation leaves the other's animation on its way to its end",
        "persistence/Boxes that finished or stopped an animation keep their final props through later unrelated React commits"]));
      assert.throws(() => verifyPersistence(report), /keeps its final props through every later React commit/);
    }
    return;
  }
  assert.deepEqual(failures, []);
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.match(log, /NATIVE_ANIMATED_PASSED: \d+/);
  const errors = verifyNativeAnimatedReport(report);
  const original = await optionalJson("build/native-animated-original-report.json");
  if (original != null) {
    assert.ok(original.originalNegativeObserved);
    assertSameReproducer(original, report, bundle, "preceding host");
  }
  const broken = await optionalJson("build/native-animated-sabotage-report.json");
  const brokenRejection = broken == null ? null : oracleRejection(broken);
  if (broken != null) {
    assert.ok(broken.checks.some(row => !row.passed) && brokenRejection != null);
    assertSameReproducer(broken, report, bundle, "sabotaged host");
  }
  const unreferenced = await optionalJson("build/native-animated-sabotage-persistence-report.json");
  const unreferencedRejection = unreferenced == null ? null : oracleRejection(unreferenced);
  if (unreferenced != null) {
    assert.ok(unreferenced.checks.some(row => !row.passed) && unreferencedRejection != null);
    assertSameReproducer(unreferenced, report, bundle, "host without the reference update");
  }
  await writeFile(path.join(root, "build/native-animated-comparison.json"), JSON.stringify({scenario: report.scenario,
    originalControlPresent: original != null, sabotagePresent: broken != null, persistenceSabotagePresent: unreferenced != null,
    intentionalNativeProducerDifferences: nativeAnimatedNativeProducers,
    originalFailures: original?.checks.filter(row => !row.passed).map(row => row.name) ?? null,
    sabotageFailures: broken?.checks.filter(row => !row.passed).map(row => row.name) ?? null, sabotageRejection: brokenRejection,
    persistenceSabotageFailures: unreferenced?.checks.filter(row => !row.passed).map(row => row.name) ?? null,
    persistenceSabotageRejection: unreferencedRejection,
    maximumErrorsAgainstTheOracle: errors,
    current: {checks: report.checks.length, nativeHostSha256: report.provenance.nativeHostSha256, bundleSha256: bundle.bundle.sha256}},
  null, 2) + "\n");
});
