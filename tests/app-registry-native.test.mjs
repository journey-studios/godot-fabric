import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {appRegistryBundled, appRegistrySdkProducers, bundleAppRegistryProbe} from "../scripts/app-registry-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {SABOTAGES} from "./app-registry-sabotages.mjs";
import {declaredMembers, oracleRejections, sections, verifyAppRegistryReport} from "./app-registry-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// The causal controls of the slice. The slice changes the SDK and no native code, so its control is a retained sabotage in
// place of a previous host: --sabotage=<name> runs this same fixture, probe and oracle on an SDK that scripts/app-registry-
// sabotage.mjs broke on purpose (tests/app-registry-sabotages.mjs says how), and both the probe's checks and the oracle must
// reject it.
const sabotageArgument = process.argv.find(argument => argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : sabotageArgument.split("=")[1];
assert.ok(sabotage === null || SABOTAGES.some(entry => entry.name === sabotage), "Unknown sabotage: " + sabotage);
const lane = sabotage === null ? "current" : "sabotage-" + sabotage;
const probeLane = sabotage === null ? "current" : "sabotage";
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
  await rm(path.join(root, "build/app-registry-report.json"), {force: true});
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/app-registry-probe.gd", "--", "--lane", probeLane],
    {encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/app-registry-${lane}.log`), log);
  const report = await optionalJson("build/app-registry-report.json");
  if (report != null) {
    report.provenance = {node: process.version, bundle, nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))),
      sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, `build/app-registry-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  return {result, log, report};
}

const rejectedSections = report => Object.entries(oracleRejections(report)).filter(([, reason]) => reason !== null).map(([name]) => name);

test("the public AppRegistry exposes RN's members, mounts through its providers and refuses what a Godot surface cannot do", async () => {
  const binary = await ensureGodotBinary();
  const bundle = await bundleAppRegistryProbe();
  const inputs = bundle.bundle.inputs;
  for (const file of appRegistryBundled) {
    assert.ok(inputs.includes("node_modules/react-native/" + file), "The bundle runs the original module: " + file);
  }
  for (const file of [...appRegistrySdkProducers, "tests/app-registry-fixture.jsx", "tests/app-registry-probe.gd", "tests/app-registry-oracle.mjs",
    "tests/app-registry-sabotages.mjs", "scripts/app-registry-sabotage.mjs", "native/application_runtime.cpp"]) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  const {result, log, report} = await runProbe(binary, bundle);
  // Artifacts are saved before the assertions. A sabotage that makes the host die has no report: the death is the rejection.
  if (sabotage !== null && report == null) {
    assert.ok(result.signal !== null || result.status !== 0, "The sabotaged run rejected the SDK by dying");
    assert.match(log, /Program crashed|SCRIPT ERROR|FABRIC_ERROR/);
    return;
  }
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.equal(result.status, 0, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.equal(report.scenario, "native-app-registry");
  assert.equal(report.lane, probeLane);
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length, "Every check has its own name");
  assert.ok(report.checks.every(row => /^[a-z-]+[A-Za-z]*\//.test(row.name)), "Every check is named <case>/<sentence>");
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  const rejected = rejectedSections(report);

  if (sabotage !== null) {
    assert.ok(failures.length > 0, "The probe's checks reject the sabotage");
    assert.match(log, new RegExp(`APP_REGISTRY_SABOTAGE_REJECTED: ${failures.length}$`, "m"));
    assert.ok(rejected.length > 0, "The independent oracle rejects the sabotage: " + rejected);
    return;
  }

  // The genuine lane: every error line of the log is a check, so nothing native, script or engine hides in it.
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, 0, "No native diagnostic, script or engine error is hidden");
  assert.deepEqual(failures, []);
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.match(log, new RegExp(`APP_REGISTRY_PASSED: ${report.checks.length}$`, "m"));
  verifyAppRegistryReport(report);
  assert.deepEqual(rejected, []);
  assert.deepEqual(Object.keys(sections), ["members", "script", "mount", "runs", "surfaces", "stop"]);
  assert.equal(declaredMembers.length, 19);

  // The retained sabotages, when they have run: each must have failed the way it is meant to, on a bundle and an SDK that
  // are not the genuine ones. A report left by an older probe, oracle or fixture is not a control of this one and is skipped.
  const harness = ["tests/app-registry-fixture.jsx", "tests/app-registry-probe.gd", "tests/app-registry-oracle.mjs", "scripts/app-registry-bundle.mjs"];
  const fresh = control => control != null && harness.every(file => control.provenance.bundle.sources[file] === bundle.sources[file]);
  const controls = {};
  const stale = [];
  for (const {name} of SABOTAGES) {
    const broken = await optionalJson(`build/app-registry-sabotage-${name}-report.json`);
    if (broken == null) {
      continue;
    }
    if (!fresh(broken)) {
      stale.push(name);
      continue;
    }
    assert.ok(broken.checks.some(row => !row.passed), `${name}: the probe rejects it`);
    const reasons = oracleRejections(broken);
    assert.ok(Object.values(reasons).some(Boolean), `${name}: the oracle rejects it`);
    assert.notEqual(broken.provenance.bundle.bundle.sha256, bundle.bundle.sha256, `${name}: it is not the genuine bundle`);
    controls[name] = {failures: broken.checks.filter(row => !row.passed).map(row => row.name), oracleRejections: reasons};
  }
  await writeFile(path.join(root, "build/app-registry-comparison.json"), JSON.stringify({scenario: report.scenario, current: {checks: report.checks.length,
    bundleSha256: bundle.bundle.sha256, nativeHostSha256: report.provenance.nativeHostSha256}, controls, staleReportsSkipped: stale}, null, 2) + "\n");
});
