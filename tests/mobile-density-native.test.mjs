import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync} from "node:fs";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleMobileDensityProbe, mobileDensityNativeProducers} from "../scripts/mobile-density-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {oracleRejection, verifyMobileDensityReport} from "./mobile-density-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// V05-08, density and insets, on the desktop headless host (see tests/mobile-density-probe.gd). Three more runs are retained controls:
//   --previous         the host and the SDK of main before this slice (b0e40aa, whose SafeAreaView is a plain View and whose
//                      FabricApplication has no density policy and reads no seam). The host in addons/ has to be the preserved one
//                      (build/mobile-density-previous-host); the SDK is taken from the commit into build/mobile-density-previous/src.
//                      It must fail exactly the normative checks.
//   --sabotage=<name>  a host that was broken on purpose (scripts/mobile-density-sabotage.mjs builds those hosts and restores the
//                      sources byte for byte): the probe and the independent oracle must both reject it.
const previousCommit = "b0e40aa";
const previous = process.argv.includes("--previous");
const sabotageArgument = process.argv.find(argument => argument === "--sabotage" || argument.startsWith("--sabotage="));
const sabotageNames = ["ignore-frame", "no-threshold", "no-reapply", "ignore-seam"];
const sabotage = sabotageArgument === undefined ? null : (sabotageArgument.split("=")[1] ?? sabotageNames[0]);
assert.ok(sabotage === null || sabotageNames.includes(sabotage), "Unknown sabotage: " + sabotage);
assert.ok(!(previous && sabotage !== null), "A run is the current host, the previous one, or one sabotage");
const lane = previous ? "previous" : sabotage === null ? "current" : `sabotage-${sabotage}`;
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

// The SDK of the commit that precedes this slice, as `git archive` has it: only src/ is read.
async function previousSdk() {
  const directory = path.join(root, "build/mobile-density-previous");
  if (!existsSync(path.join(directory, "src/react-native-platform.jsx"))) {
    await mkdir(directory, {recursive: true});
    const archive = spawnSync("git", ["archive", previousCommit, "src"], {cwd: root, maxBuffer: 64 * 1024 * 1024});
    assert.equal(archive.status, 0, `git archive ${previousCommit} src: ${archive.stderr}`);
    const unpack = spawnSync("tar", ["-x", "-C", directory], {input: archive.stdout});
    assert.equal(unpack.status, 0, String(unpack.stderr));
  }
  const files = ["src/react-native-platform.jsx", "src/components.jsx", "src/prop-scope.mjs"];
  const pins = Object.fromEntries(await Promise.all(files.map(async file => [file, digest(await readFile(path.join(directory, file)))])));
  return {platformRoot: path.join(directory, "src"), commit: previousCommit, pins};
}

function assertSameReproducer(control, report, bundle, name) {
  assert.deepEqual(control.checks.map(row => row.name), report.checks.map(row => row.name), name);
  assert.deepEqual(control.expectedOriginalFailures, report.expectedOriginalFailures, name);
  assert.notEqual(control.provenance.nativeHostSha256, report.provenance.nativeHostSha256, name);
  // Only the compiled native producers differ between hosts; the reproducer is the same file.
  for (const [file, sha] of Object.entries(bundle.sources)) {
    if (!mobileDensityNativeProducers.includes(file)) {
      assert.equal(control.provenance.bundle.sources[file], sha, `${name} shares the reproducer: ${file}`);
    }
  }
}

test("density_policy screen follows the screen's scale and RN's SafeAreaView follows the unsafe bands, on the headless host", async () => {
  const hostSha256 = digest(await readFile(host));
  if (previous) {
    const preserved = digest(await readFile(path.join(root, "build/mobile-density-previous-host/fabric_godot.dylib")));
    assert.equal(hostSha256, preserved, "addons/fabric_godot.dylib must be the preserved previous host");
  }
  const sdk = previous ? await previousSdk() : null;
  const bundle = await bundleMobileDensityProbe(sdk === null ? {} : {platformRoot: sdk.platformRoot});
  const binary = await ensureGodotBinary();
  await rm(path.join(root, "build/mobile-density-report.json"), {force: true});
  const flags = [...(previous ? ["--allow-original-negative"] : []), ...(sabotage === null ? [] : ["--sabotage"])];
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/mobile-density-probe.gd", "--", ...flags],
    {encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/mobile-density-${lane}.log`), log);
  const report = await optionalJson("build/mobile-density-report.json");
  if (report != null) {
    report.provenance = {node: process.version, lane, bundle, previousSdk: sdk, nativeHostSha256: hostSha256,
      sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, `build/mobile-density-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  // Artifacts are saved before assertions. A control never accepts unrelated failures or removes the declared failures.
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.ok(report != null, log);
  assert.equal(report.scenario, "native-mobile-density");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.allowOriginalNegative, previous);
  assert.equal(report.sabotage, sabotage !== null);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.equal(new Set(report.expectedOriginalFailures).size, report.expectedOriginalFailures.length);
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  // The two diagnostics of the policy (an unknown value, a change after the start) are provoked on purpose; the previous host has
  // no policy to refuse anything. No other diagnostic may appear.
  const fabricErrors = [...log.matchAll(/^ERROR: FABRIC_ERROR: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(fabricErrors, previous ? [] : report.expectedErrors, "The only host diagnostics are the ones the probe provoked");
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length + fabricErrors.length, "No script or engine error is hidden");
  for (const file of Object.keys(bundle.sources)) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  for (const file of previous
    ? ["Libraries/Components/SafeAreaView/SafeAreaView.js", "React/Fabric/Mounting/ComponentViews/SafeAreaView/RCTSafeAreaViewComponentView.mm"]
    : ["Libraries/Components/SafeAreaView/RCTSafeAreaViewNativeComponent.js",
      "src/private/components/safeareaview/specs/RCTSafeAreaViewNativeComponent.js",
      "React/Fabric/Mounting/ComponentViews/SafeAreaView/RCTSafeAreaViewComponentView.mm",
      "ReactCommon/react/renderer/components/safeareaview/SafeAreaViewComponentDescriptor.h", "React/Base/RCTUtils.mm"]) {
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  }
  // The checks that need this slice's host are normative; the ones that hold on both hosts (the mount, a 44-point Pressable) are not.
  assert.ok(report.expectedOriginalFailures.length > 0 && report.expectedOriginalFailures.length < report.checks.length);

  if (previous) {
    assert.equal(result.status, 0, log);
    assert.ok(report.originalNegativeObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedOriginalFailures), "Only the slice's checks qualify as the old-host control");
    assert.match(log, new RegExp(`MOBILE_DENSITY_ORIGINAL_NEGATIVE: ${failures.length}`));
    // Scale stays 1 and SafeAreaView is a View with no padding: the facts the control is about.
    assert.ok(report.stages.filter(stage => stage.scale !== undefined).every(stage => stage.js.dimensions.window.scale === 1));
    assert.ok(report.stages.filter(stage => stage.scale !== undefined).every(stage =>
      Object.values(stage.native.nodes).filter(node => node.testID !== undefined).every(node => node.safeArea === undefined)));
    // The world group on that host: a click on the empty HUD or in the padding band of a box-none root never reaches the world (the Surface of
    // main before the pointer spike takes it: 2 scales x 2 roots x 2 points) and nothing pads the SafeAreaView root (2 scales x 2 pointerEvents).
    // What holds on both hosts holds there too: the mount, the parity of the SafeAreaView with the View, the Pressable and the auto root.
    const worldFailures = failures.filter(name => name.startsWith("world/"));
    assert.equal(worldFailures.filter(name => /\/box-none\/(safe|view)\/(void|band)\//.test(name)).length, 8, "the empty area and the band of a box-none root");
    assert.equal(worldFailures.filter(name => / root pads the HUD by the insets of the seam/.test(name)).length, 4, "the padding of the SafeAreaView root");
    assert.equal(worldFailures.length, 12, worldFailures.join("\n"));
    assert.ok(oracleRejection(report) != null, "The oracle rejects the previous host");
    return;
  }
  assert.equal(report.originalNegativeObserved, false);
  if (sabotage !== null) {
    assert.equal(result.status, 0, log);
    assert.ok(failures.length > 0);
    assert.match(log, new RegExp(`MOBILE_DENSITY_SABOTAGE_REJECTED: ${failures.length}`));
    assert.ok(oracleRejection(report) != null, "The oracle rejects the sabotaged report");
    return;
  }
  assert.equal(result.status, 0, log);
  assert.deepEqual(failures, []);
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.match(log, /MOBILE_DENSITY_PASSED: \d+/);
  const verified = verifyMobileDensityReport(report);
  const control = await optionalJson("build/mobile-density-previous-report.json");
  if (control != null) {
    assert.ok(control.originalNegativeObserved);
    assertSameReproducer(control, report, bundle, "previous host");
  }
  const rejections = {};
  for (const name of sabotageNames) {
    const sabotaged = await optionalJson(`build/mobile-density-sabotage-${name}-report.json`);
    if (sabotaged != null) {
      assert.ok(sabotaged.checks.some(row => !row.passed) && oracleRejection(sabotaged) != null, name);
      assertSameReproducer(sabotaged, report, bundle, `${name} host`);
      rejections[name] = {failures: sabotaged.checks.filter(row => !row.passed).map(row => row.name), oracle: oracleRejection(sabotaged)};
    }
  }
  await writeFile(path.join(root, "build/mobile-density-comparison.json"), JSON.stringify({scenario: report.scenario,
    previousControlPresent: control != null, sabotagePresent: Object.keys(rejections),
    intentionalNativeProducerDifferences: mobileDensityNativeProducers,
    previousFailures: control?.checks.filter(row => !row.passed).map(row => row.name) ?? null, sabotages: rejections, oracle: verified,
    current: {checks: report.checks.length, nativeHostSha256: report.provenance.nativeHostSha256, bundleSha256: bundle.bundle.sha256}}, null, 2) + "\n");
});
