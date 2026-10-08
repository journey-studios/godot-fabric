import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleTextOriginalProbe, bundleTextOriginalProbeOn, textOriginalBundled, textOriginalNativeProducers,
  textOriginalSdkProducers} from "../scripts/text-original-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {oracleRejections, sections, verifyTextOriginalReport} from "./text-original-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// The controls of the slice. Each runs this same fixture and probe, and the independent oracle judges it:
//   --previous          the SDK and the host of main before the slice: the wrapper that registers RCTText itself,
//                       no press, no guard. The host is installed in addons/ by scripts/text-original-sabotage.mjs.
//   --previous-host     this SDK on that host: only the guard of the host is missing.
//   --sabotage=<name>   a source broken on purpose by scripts/text-original-sabotage.mjs:
//     register    the SDK registers RCTText and RCTVirtualText itself again, as before the slice
//     style       the base view config declares no text style
//     ancestor    the SDK reads a private text ancestor context instead of RN's
//     span-press  a nested Text may be pressable
//     guard       ParagraphLayout::prepare does not refuse head, middle and adjustsFontSizeToFit
//     default     the paragraph's default size is RN's 14 instead of this platform's 18
const PRECEDING_COMMIT = "6d02746bfe95ba48041ba1accbb6096ae4e8bb82";
const PRECEDING_FACADE_SHA256 = "2ffd51304b181de3946a09c29a58450398b11c134b9c48f46afce7fc45f71218";
const SABOTAGES = ["register", "style", "ancestor", "span-press", "guard", "default"];
const previous = process.argv.includes("--previous");
const previousHost = process.argv.includes("--previous-host");
const sabotageArgument = process.argv.find(argument => argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : sabotageArgument.split("=")[1];
assert.ok(sabotage === null || SABOTAGES.includes(sabotage), "Unknown sabotage: " + sabotage);
assert.ok([previous, previousHost, sabotage !== null].filter(Boolean).length <= 1, "At most one control per run");
const lane = previous ? "previous" : previousHost ? "previous-host" : sabotage !== null ? `sabotage-${sabotage}` : "current";
const probeLane = previous ? "previous" : previousHost ? "previous-host" : sabotage !== null ? "sabotage" : "current";
const previousHostFile = path.join(root, "build/text-original-previous-host/fabric_godot.dylib");
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

async function optionalFile(file) {
  try {
    return await readFile(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

// The public SDK of main before the slice, taken from its commit.
async function precedingSdkRoot() {
  const target = path.join(root, "build/text-original-previous-sdk");
  await rm(target, {recursive: true, force: true});
  const listed = spawnSync("git", ["ls-tree", "-r", "--name-only", PRECEDING_COMMIT, "src"], {cwd: root, encoding: "utf8"});
  assert.equal(listed.status, 0, "The previous SDK control needs commit " + PRECEDING_COMMIT + " locally");
  for (const file of listed.stdout.trim().split("\n")) {
    const shown = spawnSync("git", ["show", `${PRECEDING_COMMIT}:${file}`], {cwd: root, maxBuffer: 64 * 1024 * 1024});
    assert.equal(shown.status, 0);
    await mkdir(path.dirname(path.join(target, file)), {recursive: true});
    await writeFile(path.join(target, file), shown.stdout);
  }
  return path.join(target, "src");
}

async function runProbe(binary, bundle) {
  await rm(path.join(root, "build/text-original-report.json"), {force: true});
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/text-original-probe.gd", "--", "--lane", probeLane],
    {encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/text-original-${lane}.log`), log);
  const report = await optionalJson("build/text-original-report.json");
  if (report != null) {
    report.provenance = {node: process.version, bundle, nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))),
      sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, `build/text-original-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  return {result, log, report};
}

// The probe's raw observations judged by the oracle without its verdicts: the sections that reject a report.
const rejectedSections = report => Object.entries(oracleRejections(report)).filter(([, reason]) => reason !== null).map(([name]) => name);

test("the public Text runs RN's original Text.js and presses on the paragraph over real Godot input", async () => {
  const binary = await ensureGodotBinary();
  const facadeBefore = digest(await readFile(path.join(root, "src/react-native-platform.jsx")));
  const bundle = previous ? await bundleTextOriginalProbeOn(await precedingSdkRoot(), "text-original-previous") : await bundleTextOriginalProbe();
  const inputs = bundle.bundle.inputs;
  const original = Object.fromEntries(textOriginalBundled.map(file => [file, inputs.includes("node_modules/react-native/" + file)]));
  if (previous) {
    // The wrapper of main before the slice never loads RN's Text: that assertion is what the control fails.
    assert.equal(original["Libraries/Text/Text.js"], false, "The previous SDK does not run RN's Text.js");
    assert.equal(bundle.facadeSha256, PRECEDING_FACADE_SHA256, "The control runs the pinned previous SDK");
  } else {
    for (const [file, present] of Object.entries(original)) {
      assert.ok(present, "The public bundle runs the original module: " + file);
    }
    for (const file of [...textOriginalSdkProducers, ...textOriginalNativeProducers, "tests/text-original-oracle.mjs"]) {
      assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
    }
  }
  const {result, log, report} = await runProbe(binary, bundle);
  // Artifacts are saved before assertions. A control never accepts failures that are not its own.
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.equal(result.status, 0, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  if (sabotage !== "register") {
    assert.doesNotMatch(log, /Parse JSON failed/);
  }
  assert.equal(report.scenario, "native-text-original");
  assert.equal(report.lane, probeLane);
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  // The host reports exactly the errors the application recorded, and every ERROR line is a check or one of those.
  // A sabotage that stops the application from starting (register) reports multi-line errors of the engine itself.
  if (sabotage !== "register") {
    const fabricErrors = [...log.matchAll(/^ERROR: FABRIC_ERROR: (.+)$/gm)].map(match => match[1]);
    assert.deepEqual(fabricErrors, report.expectedErrors);
    assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length + fabricErrors.length, "No native diagnostic, script or engine error is hidden");
  }
  const hostSha = report.provenance.nativeHostSha256;
  // The host of main before the slice is kept by the bootstrap of a worktree; a checkout without it runs the slice alone.
  const previousHostBytes = await optionalFile(previousHostFile);
  const previousHostSha = previousHostBytes == null ? null : digest(previousHostBytes);
  assert.equal(digest(await readFile(path.join(root, "src/react-native-platform.jsx"))), facadeBefore, "The run never edits the SDK source");

  if (previous || previousHost) {
    assert.ok(previousHostSha != null, "The control needs build/text-original-previous-host/fabric_godot.dylib");
    assert.equal(hostSha, previousHostSha, "The control runs on the host of main before the slice");
  } else if (sabotage === null && previousHostSha != null) {
    assert.notEqual(hostSha, previousHostSha, "The slice runs on its own host");
  }
  const rejected = rejectedSections(report);
  if (previous) {
    assert.ok(report.previousNegativeObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedPreviousFailures), "Exactly the normative checks fail on the previous SDK and host");
    assert.match(log, new RegExp(`TEXT_ORIGINAL_PREVIOUS_NEGATIVE: ${failures.length}$`, "m"));
    assert.ok(rejected.includes("mount") && rejected.includes("registry") && rejected.includes("press") && rejected.includes("bypass"),
      "The oracle rejects the previous SDK and host by what it observed: " + rejected);
    return;
  }
  if (previousHost) {
    assert.ok(report.previousHostNegativeObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedPreviousHostFailures), "Exactly the bypass checks fail on the previous host");
    assert.equal(failures.length, 3);
    assert.match(log, new RegExp(`TEXT_ORIGINAL_PREVIOUS_HOST_NEGATIVE: ${failures.length}$`, "m"));
    assert.deepEqual(rejected, ["bypass"], "Only the host's guard is missing; the oracle rejects nothing else");
    assert.ok(report.stages.bypass.reports.every(row => row.errors.length === 0 && row.mounted), "The previous host stays silent on all three");
    return;
  }
  if (sabotage !== null) {
    assert.ok(failures.length > 0, "The probe's checks reject the sabotage");
    assert.match(log, new RegExp(`TEXT_ORIGINAL_SABOTAGE_REJECTED: ${failures.length}$`, "m"));
    assert.ok(rejected.length > 0, "The independent oracle rejects the sabotage: " + rejected);
    return;
  }

  assert.deepEqual(failures, []);
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.equal(report.previousNegativeObserved, false);
  assert.match(log, new RegExp(`TEXT_ORIGINAL_PASSED: ${report.checks.length}$`, "m"));
  verifyTextOriginalReport(report);
  assert.deepEqual(rejected, []);
  assert.deepEqual(Object.keys(sections), ["mount", "registry", "press", "static", "negative", "bypass", "stop"]);

  // The retained controls, when they have run: each must have failed the way it is meant to. A report left by an
  // older probe, oracle or fixture is not a control of this one: it is skipped, and the comparison says so.
  const controls = {};
  const harness = ["tests/text-original-fixture.jsx", "tests/text-original-probe.gd", "tests/text-original-oracle.mjs", "scripts/text-original-bundle.mjs"];
  const fresh = control => control != null && harness.every(file => control.provenance.bundle.sources[file] === digest(readFileSync(path.join(root, file))));
  const stale = [];
  const retained = async file => {
    const control = await optionalJson(file);
    if (control != null && !fresh(control)) {
      stale.push(file);
      return null;
    }
    return control;
  };
  const priorReport = await retained("build/text-original-previous-report.json");
  if (priorReport != null) {
    assert.ok(priorReport.previousNegativeObserved);
    assert.deepEqual(priorReport.checks.map(row => row.name), report.checks.map(row => row.name), "The control runs the same checks");
    assert.equal(priorReport.provenance.bundle.facadeSha256, PRECEDING_FACADE_SHA256);
    controls.previous = {checks: priorReport.checks.length, failures: priorReport.checks.filter(row => !row.passed).map(row => row.name),
      oracleRejections: oracleRejections(priorReport), nativeHostSha256: priorReport.provenance.nativeHostSha256};
  }
  const priorHost = await retained("build/text-original-previous-host-report.json");
  if (priorHost != null) {
    assert.ok(priorHost.previousHostNegativeObserved);
    assert.equal(priorHost.provenance.bundle.bundle.sha256, bundle.bundle.sha256, "The previous host runs the very bundle of this slice");
    controls.previousHost = {checks: priorHost.checks.length, failures: priorHost.checks.filter(row => !row.passed).map(row => row.name),
      oracleRejections: oracleRejections(priorHost), nativeHostSha256: priorHost.provenance.nativeHostSha256};
  }
  const sabotages = {};
  for (const name of SABOTAGES) {
    const broken = await retained(`build/text-original-sabotage-${name}-report.json`);
    if (broken != null) {
      assert.ok(broken.checks.some(row => !row.passed), `${name}: the probe rejects it`);
      const reasons = oracleRejections(broken);
      assert.ok(Object.values(reasons).some(Boolean), `${name}: the oracle rejects it`);
      assert.notEqual(broken.provenance.bundle.bundle.sha256 + broken.provenance.nativeHostSha256,
        bundle.bundle.sha256 + hostSha, `${name}: it is not the genuine build`);
      sabotages[name] = {failures: broken.checks.filter(row => !row.passed).map(row => row.name), oracleRejections: reasons};
    }
  }
  await writeFile(path.join(root, "build/text-original-comparison.json"), JSON.stringify({scenario: report.scenario,
    originalModules: original, precedingCommit: PRECEDING_COMMIT, previousHostSha256: previousHostSha,
    current: {checks: report.checks.length, nativeHostSha256: hostSha, bundleSha256: bundle.bundle.sha256}, controls, sabotages,
    staleReportsSkipped: stale}, null, 2) + "\n");
});
