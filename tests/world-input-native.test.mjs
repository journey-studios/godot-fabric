import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleWorldInputProbe, worldInputNativeProducers} from "../scripts/world-input-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {verifyWorldInputReport} from "./world-input-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// --allow-original-negative runs the same bundle on the preceding host (build/world-input-previous-host/fabric_godot.dylib,
// which scripts/world-input-sabotage.mjs puts in place and takes out again): the Surface there takes the pointer of the
// empty area, so every check that needs the policy must fail while the others hold. --sabotage=<name> runs it on the current
// host with the policy broken on purpose by the probe: the probe and the independent oracle must both reject it.
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const sabotageArgument = process.argv.find(argument => argument === "--sabotage" || argument.startsWith("--sabotage="));
const sabotageNames = ["surface-stop", "views-ignore"];
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
    verifyWorldInputReport({...report, checks: report.checks.map(row => ({...row, passed: true}))});
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

function assertSameReproducer(control, report, bundle, name) {
  assert.deepEqual(control.checks.map(row => row.name), report.checks.map(row => row.name), name);
  assert.deepEqual(control.expectedOriginalFailures, report.expectedOriginalFailures, name);
  assert.equal(control.provenance.bundle.bundle.sha256, bundle.bundle.sha256, name + ": the same bundle runs on every host");
  // Only the compiled native producers differ between hosts; their bundle-time pins say nothing about them.
  for (const [file, sha] of Object.entries(bundle.sources)) {
    if (!worldInputNativeProducers.includes(file)) {
      assert.equal(control.provenance.bundle.sources[file], sha, `${name} shares the reproducer and SDK producer: ${file}`);
    }
  }
}

test("a click on the empty area of the HUD reaches the Godot world once, and a Pressable never does", async () => {
  const hostSha256 = digest(await readFile(host));
  if (allowOriginalNegative) {
    // The control is only a control on the host that predates the policy.
    const preserved = digest(await readFile(path.join(root, "build/world-input-previous-host/fabric_godot.dylib")));
    assert.equal(hostSha256, preserved, "addons/fabric_godot.dylib must be the preserved previous host");
  }
  const bundle = await bundleWorldInputProbe();
  const binary = await ensureGodotBinary();
  await rm(path.join(root, "build/world-input-report.json"), {force: true});
  const flags = [...(allowOriginalNegative ? ["--allow-original-negative"] : []), ...(sabotage === null ? [] : [`--sabotage=${sabotage}`])];
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/world-input-probe.gd", "--", ...flags],
    {encoding: "utf8", timeout: 180000, maxBuffer: 16 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/world-input-${lane}.log`), log);
  const report = await optionalJson("build/world-input-report.json");
  if (report != null) {
    report.provenance = {node: process.version, lane, bundle, nativeHostSha256: hostSha256, sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, `build/world-input-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  // Artifacts are saved before assertions. A control flag never accepts unrelated failures or removes the declared
  // failures from the report.
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.ok(report != null, log);
  assert.equal(report.scenario, "native-world-input");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  assert.equal(report.sabotage, sabotage ?? "");
  assert.equal(new Set(report.checks.map(check => check.name)).size, report.checks.length);
  assert.equal(new Set(report.expectedOriginalFailures).size, report.expectedOriginalFailures.length);
  const failures = assertOnlyCheckErrors(report, log);
  for (const file of ["tests/world-input-fixture.jsx", "tests/world-input-probe.gd", "tests/world-input-native.test.mjs",
    "tests/world-input-oracle.mjs", "examples/world-input/world.gd", "examples/world-input/scene.tscn", "examples/world-input/panels.tscn",
    "scripts/world-input-bundle.mjs", "src/react-native-platform.jsx", "sdk/toolchain/platform-plugin.mjs", ...worldInputNativeProducers]) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  for (const file of ["Libraries/Modal/Modal.js", "Libraries/Components/View/View.js", "React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm",
    "ReactAndroid/src/main/java/com/facebook/react/uimanager/TouchTargetHelper.kt"]) {
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  }
  // The checks that need the policy are normative; the rest hold on both hosts.
  assert.ok(report.expectedOriginalFailures.length > 0 && report.expectedOriginalFailures.length < report.checks.length);

  if (allowOriginalNegative) {
    assert.equal(result.status, 0, log);
    assert.ok(report.originalNegativeObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedOriginalFailures), "Only the checks that need the policy qualify as the old-host control");
    assert.match(log, new RegExp(`WORLD_INPUT_ORIGINAL_NEGATIVE: ${failures.length}`));
    // The Surface of the preceding host takes the pointer of the empty area: nothing of it reaches the world, and
    // the Pressable keeps working there.
    const a = report.topologies.a;
    assert.equal(a.surfaces[0].mouseFilter, 0);
    assert.deepEqual(a.rows.find(row => row.id === "a/void/left").world, {});
    assert.deepEqual(a.rows.find(row => row.id === "a/button/left").rn, {"hud/press": 100, "hud/barDown": 100});
    assert.ok(oracleRejection(report) != null, "The oracle rejects the preceding host");
    return;
  }
  assert.equal(report.originalNegativeObserved, false);
  if (sabotage !== null) {
    assert.equal(result.status, 0, log);
    assert.ok(failures.length > 0);
    assert.match(log, new RegExp(`WORLD_INPUT_SABOTAGE_REJECTED: ${failures.length}`));
    assert.ok(oracleRejection(report) != null, "The oracle rejects the sabotaged report");
    return;
  }
  assert.equal(result.status, 0, log);
  assert.deepEqual(failures, []);
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.match(log, /WORLD_INPUT_PASSED: \d+/);
  const verified = verifyWorldInputReport(report);
  const original = await optionalJson("build/world-input-original-report.json");
  if (original != null) {
    assert.ok(original.originalNegativeObserved);
    assertSameReproducer(original, report, bundle, "preceding host");
    assert.notEqual(original.provenance.nativeHostSha256, report.provenance.nativeHostSha256, "preceding host");
  }
  const rejections = {};
  for (const name of sabotageNames) {
    const sabotaged = await optionalJson(`build/world-input-sabotage-${name}-report.json`);
    if (sabotaged != null) {
      assert.ok(sabotaged.checks.some(row => !row.passed) && oracleRejection(sabotaged) != null, name);
      assertSameReproducer(sabotaged, report, bundle, `${name} sabotage`);
      rejections[name] = {failures: sabotaged.checks.filter(row => !row.passed).map(row => row.name), oracle: oracleRejection(sabotaged)};
    }
  }
  await writeFile(path.join(root, "build/world-input-comparison.json"), JSON.stringify({scenario: report.scenario,
    originalControlPresent: original != null, sabotagePresent: Object.keys(rejections),
    intentionalNativeProducerDifferences: worldInputNativeProducers,
    originalFailures: original?.checks.filter(row => !row.passed).map(row => row.name) ?? null, sabotages: rejections,
    oracle: verified, gaps: Object.fromEntries(Object.entries(report.topologies).map(([name, topology]) =>
      [name, topology.gaps.map(gap => ({id: gap.id, n: gap.n, world: gap.world, rn: gap.rn}))])),
    current: {checks: report.checks.length, nativeHostSha256: report.provenance.nativeHostSha256, bundleSha256: bundle.bundle.sha256}}, null, 2) + "\n");
});
