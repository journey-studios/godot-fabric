import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync} from "node:fs";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {bundleScopeProbe, scopeSources} from "../scripts/scope-bundle.mjs";
import {oracleRejection, verifyScopeReport} from "./scope-0.5-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// --previous (or --allow-original-negative, the flag the other suites use) runs the same fixture over the SDK of main before this
// slice, taken from `previousCommit` into build/frontier-scope-previous/src: the host is the same, because the slice changes no
// native code, so the failures are the ones the SDK causes. --sabotage=<name> runs it over an SDK that was broken on purpose
// (scripts/scope-sabotage.mjs swaps the source and restores it); the probe and the oracle have to reject it.
const previousCommit = "57e41f2";
const previous = process.argv.includes("--previous") || process.argv.includes("--allow-original-negative");
const sabotageArgument = process.argv.find(argument => argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : sabotageArgument.split("=")[1];
const probeSabotages = ["updates", "undeclared", "modal", "defaults"];
assert.ok([null, ...probeSabotages, "reason"].includes(sabotage), "Unknown sabotage: " + sabotage);
const lane = previous ? "original" : sabotage === null ? "current" : `sabotage-${sabotage}`;
const digest = value => createHash("sha256").update(value).digest("hex");
const readJson = async file => JSON.parse(await readFile(path.join(root, file), "utf8"));

async function optionalJson(file) {
  try {
    return await readJson(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

// The SDK of the commit that precedes this slice, as `git archive` has it: only src/ is read.
async function previousSdk() {
  const directory = path.join(root, "build/frontier-scope-previous");
  if (!existsSync(path.join(directory, "src/react-native-platform.jsx"))) {
    await mkdir(directory, {recursive: true});
    const archive = spawnSync("git", ["archive", previousCommit, "src"], {cwd: root, maxBuffer: 64 * 1024 * 1024});
    assert.equal(archive.status, 0, `git archive ${previousCommit} src: ${archive.stderr}`);
    const unpack = spawnSync("tar", ["-x", "-C", directory], {input: archive.stdout});
    assert.equal(unpack.status, 0, String(unpack.stderr));
  }
  const files = ["src/react-native-platform.jsx", "src/components.jsx", "src/text.jsx", "src/image-contract.mjs"];
  const pins = Object.fromEntries(await Promise.all(files.map(async file => [file, digest(await readFile(path.join(directory, file)))])));
  assert.ok(!existsSync(path.join(directory, "src/prop-scope.mjs")), "the previous SDK has no prop policy");
  return {platformRoot: path.join(directory, "src"), commit: previousCommit, pins};
}

async function runProbe(binary, bundle, sdk) {
  await rm(path.join(root, "build/scope-0.5-report.json"), {force: true});
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/scope-0.5-probe.gd", "--",
    ...(previous ? ["--allow-original-negative"] : [])], {encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/scope-0.5-${lane}.log`), log);
  const report = await optionalJson("build/scope-0.5-report.json");
  if (report != null) {
    report.provenance = {node: process.version, bundle, previousSdk: sdk,
      nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, `build/scope-0.5-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  return {result, log, report};
}

test("the prop policy holds through the real host: refused props fail on mount and update, ignored ones change nothing", async () => {
  const sdk = previous ? await previousSdk() : null;
  const bundle = await bundleScopeProbe(sdk === null ? {} : {platformRoot: sdk.platformRoot});
  const {result, log, report} = await runProbe(await ensureGodotBinary(), bundle, sdk);
  const context = {manifest: await readJson("docs/compatibility/scope-0.5.json"), inventory: await readJson("docs/compatibility/contracts-0.87.1.json"), original: previous};
  // Artifacts are saved before any assertion. The previous-SDK lane accepts only the failures of the refused props that main
  // did not already refuse; a sabotaged lane is expected to fail.
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual([...checkErrors].sort(), [...failures].sort());
  const fabricErrors = [...log.matchAll(/^ERROR: FABRIC_ERROR: (.+)$/gm)].map(match => match[1]);
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length + fabricErrors.length, "No other diagnostic is hidden");
  for (const file of scopeSources) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  if (sabotage !== null) {
    // The probe's own checks or its abort reject a sabotaged SDK, and the oracle, which judges the raw cases and the manifest, does
    // too. A sabotaged manifest (a reason taken away) is no host failure: only the oracle reads it.
    if (probeSabotages.includes(sabotage)) {
      assert.ok(failures.length > 0 || report.aborted !== "", "the probe rejects the sabotaged SDK");
      assert.notEqual(result.status, 0, log);
      assert.match(log, /SCOPE_FAILED/);
    }
    assert.ok(oracleRejection(report, context) != null, "the oracle rejects the sabotaged report");
    return;
  }
  if (previous) {
    assert.equal(result.status, 0, log);
    assert.match(log, new RegExp(`SCOPE_ORIGINAL_NEGATIVE: ${failures.length}`));
    assert.equal(fabricErrors.length, 0, "main reports no host error for the props the control drives");
    const outcome = verifyScopeReport(report, context);
    assert.ok(outcome.silent > 0 && outcome.leaked > 0);
    return;
  }
  assert.equal(result.status, 0, log);
  assert.deepEqual(fabricErrors, []);
  assert.deepEqual(failures, []);
  assert.match(log, /SCOPE_PASSED: \d+/);
  const outcome = verifyScopeReport(report, context);
  assert.ok(outcome.refusedCases > 100 && outcome.ignoredCases > 100);
  const original = await optionalJson("build/scope-0.5-original-report.json");
  await writeFile(path.join(root, "build/scope-0.5-comparison.json"), JSON.stringify({scenario: report.scenario, originalControlPresent: original != null,
    sameHostRequired: true, original: original === null ? null : {checks: original.checks.length, failed: original.checks.filter(row => !row.passed).length,
      nativeHostSha256: original.provenance.nativeHostSha256, previousSdk: original.provenance.previousSdk},
    current: {checks: report.checks.length, nativeHostSha256: report.provenance.nativeHostSha256, outcome}}, null, 2) + "\n");
  if (original != null) {
    // No native producer changed: the control runs on the same host, so what differs is the SDK alone.
    assert.equal(original.provenance.nativeHostSha256, report.provenance.nativeHostSha256);
    assert.deepEqual(original.plan.groups.map(group => group.id).filter(id => !report.plan.groups.some(entry => entry.id === id)), []);
  }
});
