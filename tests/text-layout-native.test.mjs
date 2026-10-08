import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleTextLayoutProbe, textLayoutNativeProducers} from "../scripts/text-layout-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {normativeOriginalFailures, tolerance, verifyTextLayoutReport} from "./text-layout-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// The preceding host (main before this slice) has the portable TextLayoutManager: no measureLines, so
// RN never delivers onTextLayout and Yoga's baseline callback answers zero. --allow-original-negative runs
// the same bundle on it, installed in addons/. --sabotage=<name> runs it on a host that breaks one
// decision of measureLines on purpose (scripts/text-layout-sabotage.mjs builds those hosts, runs this
// test with each and restores the source):
//   all-lines     reports every line of the paragraph, ignoring numberOfLines
//   no-centering  ascender without the centred lineHeight offset
//   sentinel      the host's U+200B sentinel inside the last line's text
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const sabotageArgument = process.argv.find(argument => argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : sabotageArgument.split("=")[1];
assert.ok([null, "all-lines", "no-centering", "sentinel"].includes(sabotage), "Unknown sabotage: " + sabotage);
const lane = allowOriginalNegative ? "original" : sabotage === null ? "current" : `sabotage-${sabotage}`;
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
  await rm(path.join(root, "build/text-layout-report.json"), {force: true});
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/text-layout-probe.gd", "--",
    ...(allowOriginalNegative ? ["--allow-original-negative"] : []), ...(sabotage === null ? [] : ["--sabotage"])],
  {encoding: "utf8", timeout: 240000, maxBuffer: 64 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/text-layout-${lane}.log`), log);
  const report = await optionalJson("build/text-layout-report.json");
  if (report != null) {
    report.provenance = {node: process.version, bundle,
      nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, `build/text-layout-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  return {result, log, report};
}

// The oracle must reject a report on its own derivations, even with every probe check marked as passed.
function oracleRejection(report) {
  try {
    verifyTextLayoutReport({...report, checks: report.checks.map(row => ({...row, passed: true}))});
  } catch (error) {
    return String(error.message).split("\n")[0];
  }
  return null;
}

// The preceding host skips the stages that need its events (and one failure check that needs measureLines),
// so its checks are among the current ones; a sabotaged host runs them all.
function assertSameReproducer(control, report, bundle, name, {subset = false} = {}) {
  const names = report.checks.map(row => row.name);
  const controlled = control.checks.map(row => row.name);
  if (subset) {
    assert.ok(controlled.every(row => names.includes(row)), name + ": its checks are among the current ones");
  } else {
    assert.deepEqual(controlled, names, name + ": the same checks");
  }
  assert.equal(control.provenance.bundle.bundle.sha256, bundle.bundle.sha256, name + ": the same bundle runs on every host");
  // Only the compiled native producers differ between hosts; their bundle-time pins say nothing about them.
  for (const [file, sha] of Object.entries(bundle.sources)) {
    if (!textLayoutNativeProducers.includes(file)) {
      assert.equal(control.provenance.bundle.sources[file], sha, `${name} shares the reproducer: ${file}`);
    }
  }
  assert.notEqual(control.provenance.nativeHostSha256, report.provenance.nativeHostSha256, name);
}

const pixels = value => value.toFixed(3);

test("onTextLayout and the Yoga baseline come from the lines of the one paragraph the host measures and paints", async () => {
  const bundle = await bundleTextLayoutProbe();
  const {result, log, report} = await runProbe(await ensureGodotBinary(), bundle);
  // Artifacts are saved before assertions. A control flag never accepts unrelated failures or removes
  // the declared failures from the report.
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.equal(result.status, 0, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  assert.equal(report.sabotage, sabotage !== null);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.equal(new Set(report.expectedOriginalFailures).size, report.expectedOriginalFailures.length);
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  // The host reports exactly the failing paragraphs' errors, and every ERROR line is a check or one of those.
  const fabricErrors = [...log.matchAll(/^ERROR: FABRIC_ERROR: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(fabricErrors, report.expectedErrors);
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length + fabricErrors.length, "No native diagnostic, script or engine error is hidden");
  for (const file of ["tests/text-layout-fixture.jsx", "tests/text-layout-probe.gd", "tests/text-layout-native.test.mjs",
    "tests/text-layout-oracle.mjs", "scripts/text-layout-bundle.mjs", "src/text.jsx", ...textLayoutNativeProducers]) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  for (const file of ["ReactCommon/react/renderer/components/text/ParagraphShadowNode.cpp",
    "ReactCommon/react/renderer/components/text/ParagraphEventEmitter.cpp",
    "ReactCommon/react/renderer/textlayoutmanager/platform/ios/react/renderer/textlayoutmanager/RCTTextLayoutManager.mm",
    "ReactAndroid/src/main/java/com/facebook/react/views/text/FontMetricsUtil.kt", "Libraries/Text/TextNativeComponent.js"]) {
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  }
  // The measureLines checks are normative; everything else holds on every host.
  assert.deepEqual(sorted(report.expectedOriginalFailures), sorted(normativeOriginalFailures));
  assert.ok(report.expectedOriginalFailures.length > 0 && report.expectedOriginalFailures.length < report.checks.length);
  if (allowOriginalNegative) {
    assert.ok(report.originalNegativeObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedOriginalFailures), "Only the measureLines checks qualify as the old-host control");
    assert.match(log, new RegExp(`TEXT_LAYOUT_ORIGINAL_NEGATIVE: ${failures.length}`));
    assert.ok(oracleRejection(report) != null, "The oracle rejects the preceding host");
    verifyTextLayoutReport(report, {original: true});
    return;
  }
  assert.equal(report.originalNegativeObserved, false);
  if (sabotage !== null) {
    assert.ok(failures.length > 0);
    assert.match(log, new RegExp(`TEXT_LAYOUT_SABOTAGE_REJECTED: ${failures.length}`));
    assert.ok(oracleRejection(report) != null, "The oracle rejects the sabotaged report");
    return;
  }
  assert.deepEqual(failures, []);
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.match(log, /TEXT_LAYOUT_PASSED: \d+/);
  const stats = verifyTextLayoutReport(report);
  const {maxima} = stats;
  console.log(`Deviation of the host from the font tables (tolerance ${tolerance}): ascender ${pixels(maxima.ascender)}, descender ${
    pixels(maxima.descender)}, height ${pixels(maxima.height)}, capHeight ${pixels(maxima.capHeight)}, xHeight ${
    pixels(maxima.xHeight)}, baseline offset ${pixels(maxima.baselineOffset)}`);
  console.log(`Without FreeType's pixel rounding of the ascent and descent the tables are off by: ascender ${
    pixels(maxima.rawAscender)}, descender ${pixels(maxima.rawDescender)}, height ${pixels(maxima.rawHeight)}`);
  const original = await optionalJson("build/text-layout-original-report.json");
  if (original != null) {
    assert.ok(original.originalNegativeObserved);
    verifyTextLayoutReport(original, {original: true});
    assertSameReproducer(original, report, bundle, "preceding host", {subset: true});
  }
  const rejections = {};
  for (const name of ["all-lines", "no-centering", "sentinel"]) {
    const broken = await optionalJson(`build/text-layout-sabotage-${name}-report.json`);
    if (broken != null) {
      assert.ok(broken.checks.some(row => !row.passed));
      rejections[name] = oracleRejection(broken);
      assert.ok(rejections[name] != null, `The oracle rejects the ${name} host`);
      assertSameReproducer(broken, report, bundle, `${name} host`);
    }
  }
  await writeFile(path.join(root, "build/text-layout-comparison.json"), JSON.stringify({scenario: report.scenario,
    originalControlPresent: original != null, intentionalNativeProducerDifferences: textLayoutNativeProducers,
    originalFailures: original?.checks.filter(row => !row.passed).map(row => row.name) ?? null,
    sabotageRejections: rejections, tolerance, maxima, offsets: stats.offsets,
    current: {checks: report.checks.length, nativeHostSha256: report.provenance.nativeHostSha256, bundleSha256: bundle.bundle.sha256}},
  null, 2) + "\n");
});
