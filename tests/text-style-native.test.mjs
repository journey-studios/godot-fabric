import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleTextStylePrevious, bundleTextStyleProbe, precedingCommit, previousSdkFacade, textStyleBundled,
  textStyleNativeProducers, textStyleSdkProducers} from "../scripts/text-style-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {oracleRejections, sections, verifyTextStyleReport} from "./text-style-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// The controls of the slice. Each runs this same fixture and probe, and the independent oracle judges it:
//   --previous          the SDK and the host of main before the slice: the facade rejects fontStyle and textDecoration*.
//                       The host is installed in addons/ by scripts/text-style-sabotage.mjs.
//   --previous-host     this SDK on that host: the styles are accepted and nothing slants, draws or refuses.
//   --sabotage=<name>   a source broken on purpose by scripts/text-style-sabotage.mjs, with the section of the oracle
//                       that must reject it:
const SABOTAGES = {
  "decoration-above": "decorations", // the underline sits above the baseline (its offset has the wrong sign)
  "color-ignored": "decorations",    // textDecorationColor is ignored: the line takes the text color
  inherit: "inheritance",            // a child's textDecorationLine none is dropped, so the child inherits the underline
  "whole-line": "decorations",       // the line covers the whole row, whatever the run and the truncation
  "skew-sign": "italic",             // the slant leans the other way
  "facade-dotted": "negative",       // the facade lets textDecorationStyle dotted through
  "ellipsis-run": "ellipsis",        // the ellipsis takes the color and the line of the first run again
  guard: "bypass",                   // ParagraphLayout::prepare does not refuse oblique and the non-solid styles
};
// The facade of main before the slice, as the control extracts it from its commit.
const PRECEDING_FACADE_SHA256 = "057831cf113ea86b3a231822f1f9c2c6f65a682038d3041463c412b922847ade";
const previous = process.argv.includes("--previous");
const previousHost = process.argv.includes("--previous-host");
const sabotageArgument = process.argv.find(argument => argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : sabotageArgument.split("=")[1];
assert.ok(sabotage === null || sabotage in SABOTAGES, "Unknown sabotage: " + sabotage);
assert.ok([previous, previousHost, sabotage !== null].filter(Boolean).length <= 1, "At most one control per run");
const lane = previous ? "previous" : previousHost ? "previous-host" : sabotage !== null ? `sabotage-${sabotage}` : "current";
const probeLane = previous ? "previous" : previousHost ? "previous-host" : sabotage !== null ? "sabotage" : "current";
const previousHostFile = path.join(root, "build/text-style-previous-host/fabric_godot.dylib");
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

async function runProbe(binary, bundle) {
  await rm(path.join(root, "build/text-style-report.json"), {force: true});
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/text-style-probe.gd", "--", "--lane", probeLane],
    {encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/text-style-${lane}.log`), log);
  const report = await optionalJson("build/text-style-report.json");
  if (report != null) {
    report.provenance = {node: process.version, bundle, nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))),
      sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, `build/text-style-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  return {result, log, report};
}

// The probe's raw observations judged by the oracle without its verdicts: the sections that reject a report.
const rejectedSections = report => Object.entries(oracleRejections(report)).filter(([, reason]) => reason !== null).map(([name]) => name);
// What the host of main before the slice cannot show: it does not slant, draw lines, report them or refuse the rest.
const HOST_SECTIONS = ["runs", "italic", "decorations", "inheritance", "ellipsis", "bypass"];

test("the public Text slants fontStyle italic and draws solid textDecorationLine over the host paragraph", async () => {
  const binary = await ensureGodotBinary();
  const facadeBefore = digest(await readFile(path.join(root, "src/react-native-platform.jsx")));
  const bundle = previous ? await bundleTextStylePrevious() : await bundleTextStyleProbe();
  const inputs = bundle.bundle.inputs;
  const original = Object.fromEntries(textStyleBundled.map(file => [file, inputs.includes("node_modules/react-native/" + file)]));
  for (const [file, present] of Object.entries(original)) {
    assert.ok(present, "The public bundle runs the original module: " + file);
  }
  if (previous) {
    // The bundle holds the facade extracted from the commit (pinned in its receipt), not the one in src/.
    assert.equal(bundle.sources[previousSdkFacade], PRECEDING_FACADE_SHA256, "The control runs the pinned previous SDK");
    assert.ok(inputs.includes(previousSdkFacade) && !inputs.includes("src/react-native-platform.jsx"));
    assert.doesNotMatch(readFileSync(path.join(root, previousSdkFacade), "utf8"), /textDecorationStyle/, "The previous facade does not know the styles");
  } else {
    for (const file of [...textStyleSdkProducers, ...textStyleNativeProducers, "tests/text-style-oracle.mjs"]) {
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
  assert.doesNotMatch(log, /Parse JSON failed/);
  assert.equal(report.scenario, "native-text-style");
  assert.equal(report.lane, probeLane);
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  // The host reports exactly the errors the application recorded, and every ERROR line is a check or one of those.
  const fabricErrors = [...log.matchAll(/^ERROR: FABRIC_ERROR: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(fabricErrors, report.expectedErrors);
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length + fabricErrors.length, "No native diagnostic, script or engine error is hidden");
  const hostSha = report.provenance.nativeHostSha256;
  // The host of main before the slice is kept by the bootstrap of a worktree; a checkout without it runs the slice alone.
  const previousHostBytes = await optionalFile(previousHostFile);
  const previousHostSha = previousHostBytes == null ? null : digest(previousHostBytes);
  assert.equal(digest(await readFile(path.join(root, "src/react-native-platform.jsx"))), facadeBefore, "The run never edits the SDK source");

  if (previous || previousHost) {
    assert.ok(previousHostSha != null, "The control needs build/text-style-previous-host/fabric_godot.dylib");
    assert.equal(hostSha, previousHostSha, "The control runs on the host of main before the slice");
  } else if (sabotage === null && previousHostSha != null) {
    assert.notEqual(hostSha, previousHostSha, "The slice runs on its own host");
  }
  const rejected = rejectedSections(report);
  if (previous) {
    assert.ok(report.previousNegativeObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedPreviousFailures), "Exactly the normative checks fail on the previous SDK and host");
    assert.match(log, new RegExp(`TEXT_STYLE_PREVIOUS_NEGATIVE: ${failures.length}$`, "m"));
    for (const section of ["mount", "runs", "measure", "italic", "decorations", "inheritance", "ellipsis", "negative", "bypass"]) {
      assert.ok(rejected.includes(section), `The oracle rejects the previous SDK and host in ${section}: ${rejected}`);
    }
    return;
  }
  if (previousHost) {
    assert.ok(report.previousHostNegativeObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedPreviousHostFailures), "Exactly the host checks fail on the previous host");
    assert.match(log, new RegExp(`TEXT_STYLE_PREVIOUS_HOST_NEGATIVE: ${failures.length}$`, "m"));
    assert.deepEqual(rejected, HOST_SECTIONS, "Only what the host paints and refuses is missing; the oracle rejects nothing else");
    assert.deepEqual(report.stages.static.react.renderErrors, [], "The facade of this slice accepts every style on the previous host");
    assert.ok(report.stages.bypass.reports.every(row => row.errors.length === 0 && row.mounted), "The previous host stays silent on the bypass cases");
    return;
  }
  if (sabotage !== null) {
    assert.ok(failures.length > 0, "The probe's checks reject the sabotage");
    assert.match(log, new RegExp(`TEXT_STYLE_SABOTAGE_REJECTED: ${failures.length}$`, "m"));
    assert.ok(rejected.includes(SABOTAGES[sabotage]), `The independent oracle rejects the sabotage in ${SABOTAGES[sabotage]}: ${rejected}`);
    return;
  }

  assert.deepEqual(failures, []);
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.equal(report.previousNegativeObserved, false);
  assert.match(log, new RegExp(`TEXT_STYLE_PASSED: ${report.checks.length}$`, "m"));
  verifyTextStyleReport(report);
  assert.deepEqual(rejected, []);
  assert.deepEqual(Object.keys(sections), ["mount", "runs", "italic", "measure", "decorations", "inheritance", "ellipsis", "negative", "bypass", "stop"]);

  // The retained controls, when they have run: each must have failed the way it is meant to. A report left by an
  // older probe, oracle or fixture is not a control of this one: it is skipped, and the comparison says so.
  const controls = {};
  const harness = ["tests/text-style-fixture.jsx", "tests/text-style-probe.gd", "tests/text-style-oracle.mjs", "scripts/text-style-bundle.mjs"];
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
  const priorReport = await retained("build/text-style-previous-report.json");
  if (priorReport != null) {
    assert.ok(priorReport.previousNegativeObserved);
    assert.deepEqual(priorReport.checks.map(row => row.name), report.checks.map(row => row.name), "The control runs the same checks");
    assert.equal(priorReport.provenance.bundle.sources[previousSdkFacade], PRECEDING_FACADE_SHA256);
    controls.previous = {checks: priorReport.checks.length, failures: priorReport.checks.filter(row => !row.passed).map(row => row.name),
      oracleRejections: oracleRejections(priorReport), nativeHostSha256: priorReport.provenance.nativeHostSha256};
  }
  const priorHost = await retained("build/text-style-previous-host-report.json");
  if (priorHost != null) {
    assert.ok(priorHost.previousHostNegativeObserved);
    assert.deepEqual(priorHost.checks.map(row => row.name), report.checks.map(row => row.name), "The control runs the same checks");
    assert.equal(priorHost.provenance.bundle.bundle.sha256, bundle.bundle.sha256, "The previous host runs the very bundle of this slice");
    controls.previousHost = {checks: priorHost.checks.length, failures: priorHost.checks.filter(row => !row.passed).map(row => row.name),
      oracleRejections: oracleRejections(priorHost), nativeHostSha256: priorHost.provenance.nativeHostSha256};
  }
  const sabotages = {};
  for (const [name, section] of Object.entries(SABOTAGES)) {
    const broken = await retained(`build/text-style-sabotage-${name}-report.json`);
    if (broken != null) {
      assert.ok(broken.checks.some(row => !row.passed), `${name}: the probe rejects it`);
      const reasons = oracleRejections(broken);
      assert.ok(reasons[section] != null, `${name}: the oracle rejects it in ${section}`);
      assert.notEqual(broken.provenance.bundle.bundle.sha256 + broken.provenance.nativeHostSha256,
        bundle.bundle.sha256 + hostSha, `${name}: it is not the genuine build`);
      sabotages[name] = {section, failures: broken.checks.filter(row => !row.passed).map(row => row.name), oracleRejections: reasons};
    }
  }
  await writeFile(path.join(root, "build/text-style-comparison.json"), JSON.stringify({scenario: report.scenario,
    originalModules: original, precedingCommit, previousHostSha256: previousHostSha,
    current: {checks: report.checks.length, nativeHostSha256: hostSha, bundleSha256: bundle.bundle.sha256}, controls, sabotages,
    staleReportsSkipped: stale}, null, 2) + "\n");
});
