import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleImagesProbe, imagesNativeProducers} from "../scripts/images-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {expectedCheckCount, jsOnlyChecks, verifyImagesReport} from "./images-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// The preceding host has no image pipeline: --allow-original-negative runs the same bundle on it, and every check that
// needs the native pipeline must fail there while the JavaScript ones hold. --sabotage=<name> runs it on a host whose
// source was broken on purpose (scripts/images-sabotage.mjs builds those hosts and restores the source): the probe and the
// oracle must both reject it.
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const sabotageArgument = process.argv.find(argument => argument === "--sabotage" || argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : (sabotageArgument.split("=")[1] ?? "main-thread");
assert.ok([null, "main-thread", "stale-request"].includes(sabotage), "Unknown sabotage: " + sabotage);
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

function oracleRejection(report) {
  try {
    verifyImagesReport({...structuredClone(report), checks: report.checks.map(row => ({...row, passed: true})), allCurrentAssertionsPassed: true});
  } catch (error) {
    return String(error.message).split("\n")[0];
  }
  return null;
}

// The oracle is not vacuous: each of these damaged copies of the genuine report must be refused, for the reason that
// the damage names.
function assertOracleMutations(report) {
  const mutate = (change, pattern, name) => {
    const candidate = structuredClone(report);
    change(candidate);
    assert.throws(() => verifyImagesReport(candidate), pattern, name);
  };
  const view = (candidate, id) => candidate.stages.mount.surface.nodes.find(entry => entry.testID === id).image;
  mutate(candidate => { candidate.stages.mount.react.logs["A-user-png"].find(event => event.type === "progress").loaded += 1; }, /progress/,
    "a file's progress is its size over its size");
  mutate(candidate => { candidate.stages.afterStop.loader.jobs[3].thread.worker = false; }, /worker thread/, "every job ran on a worker");
  mutate(candidate => { candidate.stages.afterStop.loader.jobs[3].thread.id = candidate.stages.afterStop.loader.hostThread; }, /off the main thread/,
    "no job ran on the main thread");
  mutate(candidate => { view(candidate, "A-badge").image.width = 16; }, /picture|texture/, "the texture has the pixels of the chosen variant");
  mutate(candidate => { view(candidate, "A-mode-cover").drawn.src.x = 0; }, /src/, "cover crops the picture");
  mutate(candidate => { view(candidate, "A-mode-repeat").drawn.tiled = false; }, /tiled/, "repeat tiles");
  mutate(candidate => { const log = candidate.stages.mount.react.logs["A-user-png"]; log.push(log.shift()); }, /precedes the loadStart of its request/,
    "no event reaches JS before the loadStart of its request");
  mutate(candidate => { const events = view(candidate, "A-badge").events; events.push(events.shift()); }, /precedes the loadStart of its request/,
    "no event leaves the view before the loadStart of its request");
  mutate(candidate => { candidate.stages.swap.log.push({type: "progress"}); }, /follows the loadEnd of its request/, "a request reports nothing after its loadEnd");
  mutate(candidate => { candidate.stages.inflight.jobs.at(-1).outcome = "loaded"; }, /outcome|dropped|expected/, "a cancelled decode is dropped");
  mutate(candidate => { candidate.stages.inflight.after.uploads += 1; }, /uploads|expected/, "a cancelled decode creates no texture");
  mutate(candidate => { candidate.stages.budget.after.peakUploadsPerPoll = 2; }, /peakUploadsPerPoll/, "a poll creates one texture at a budget of one byte");
  mutate(candidate => { candidate.stages.afterStop.loader.counters.tasksAwaited -= 1; }, /tasksStarted|expected/, "every task is awaited");
  mutate(candidate => { candidate.stages.mount.react.logs["A-neg-missing"].find(event => event.type === "error").error = "boom"; }, /neg-missing/,
    "a missing file says so");
  mutate(candidate => { candidate.stages.mount.react.logs["A-neg-scheme"].splice(1, 1); }, /events|has no result of its request/, "an unknown scheme fails through onError");
  mutate(candidate => { candidate.stages.contract.assets.badge.descriptor.hash = "0".repeat(32); }, /hash|expected/, "the descriptor is Metro's");
  mutate(candidate => { candidate.stages.api.results["prefetch-missing"].message = "E_PREFETCH_FAILURE: nothing"; }, /E_PREFETCH_FAILURE/, "prefetch says why it fails");
  mutate(candidate => { candidate.stages.scales.results[0].uri = candidate.stages.scales.results[0].uri.replace("@3x", "@2x"); }, /badge@3x|expected/,
    "pickScale chooses by pixel ratio");
}

function assertSameReproducer(control, report, bundle, name) {
  // The old host stops after the contract: it runs the checks of the stages that need nothing of the native pipeline, the same
  // ones, in the same order, as the current host. Every other check of the current host needs the pipeline.
  const names = report.checks.map(row => row.name);
  const ran = control.checks.map(row => row.name);
  let cursor = 0;
  for (const check of ran) {
    cursor = names.indexOf(check, cursor);
    assert.ok(cursor >= 0, `${name} runs only checks of the current host, in its order: ${check}`);
    cursor += 1;
  }
  assert.ok(jsOnlyChecks.every(check => ran.includes(check)), name + " runs every check that needs nothing of the native pipeline");
  assert.equal(ran.length < names.length, control.allowOriginalNegative, name + ": only the old host stops short");
  assert.ok(control.expectedOriginalFailures.every(check => report.expectedOriginalFailures.includes(check)), name);
  assert.equal(control.provenance.bundle.bundle.sha256, bundle.bundle.sha256, name + ": the same bundle runs on every host");
  // Only the compiled native producers differ between hosts; their bundle-time pins say nothing about them.
  for (const [file, sha] of Object.entries(bundle.sources)) {
    if (!imagesNativeProducers.includes(file)) {
      assert.equal(control.provenance.bundle.sources[file], sha, `${name} shares the reproducer and SDK producer: ${file}`);
    }
  }
  assert.notEqual(control.provenance.nativeHostSha256, report.provenance.nativeHostSha256, name);
}

test("RN's own Image over native worker-thread image loading renders bundled, file and data pictures and releases every request", async () => {
  const bundle = await bundleImagesProbe();
  const binary = await ensureGodotBinary();
  if (sabotage === null && !allowOriginalNegative) {
    const unit = spawnSync(path.join(root, ".deps/build/image_core_test"), [], {encoding: "utf8", timeout: 20000});
    assert.equal(unit.error, undefined);
    assert.equal(unit.status, 0, unit.stdout + unit.stderr);
    assert.match(unit.stdout, /IMAGE_CORE_PASSED/);
  }
  await rm(path.join(root, "build/images-report.json"), {force: true});
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/images-probe.gd", "--",
    ...(allowOriginalNegative ? ["--allow-original-negative"] : []), ...(sabotage === null ? [] : ["--sabotage"])],
  {encoding: "utf8", timeout: 240000, maxBuffer: 64 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/images-${lane}.log`), log);
  const report = await optionalJson("build/images-report.json");
  if (report != null) {
    report.provenance = {node: process.version, bundle, nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))),
      sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, `build/images-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  // Artifacts are saved before assertions. A control flag never accepts unrelated failures or removes the declared
  // failures from the report.
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.equal(report.scenario, "images");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.equal(new Set(report.expectedOriginalFailures).size, report.expectedOriginalFailures.length);
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  // Every other ERROR line is Godot's own PNG decoder refusing a picture the fixture made corrupt on purpose, three lines
  // per refusal: no native, script or engine error hides.
  const engineErrors = [...log.matchAll(/^ERROR: (?!FABRIC_CHECK_FAILED: )(.+)$/gm)].map(match => match[1]);
  const pngRefusals = new Set(['Condition "!success" is true. Returning: ERR_FILE_CORRUPT', 'Condition "err" is true. Returning: Ref<Image>()',
    'Condition "image.is_null()" is true. Returning: ERR_PARSE_ERROR']);
  assert.deepEqual(engineErrors.filter(text => !pngRefusals.has(text)), [], "No native diagnostic, script or engine error is hidden");
  if (sabotage === null) {
    const decoderRefusals = (report.stages.afterStop.loader.jobs ?? []).filter(job => /the png decoder rejected the data/.test(job.error)).length;
    assert.equal(engineErrors.length, allowOriginalNegative ? 0 : 3 * decoderRefusals, "The engine refused exactly the pictures the host offered it to refuse");
  }
  for (const file of ["tests/images-fixture.jsx", "tests/images-probe.gd", "tests/images-native.test.mjs", "tests/images-oracle.mjs", "tests/images-pattern.mjs",
    "tests/fixtures/images/manifest.json", "scripts/images-bundle.mjs", "src/image.jsx", "src/image-contract.mjs", "src/react-native-platform.jsx",
    "sdk/toolchain/platform-plugin.mjs", "sdk/toolchain/asset-plugin.mjs", ...imagesNativeProducers]) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  for (const file of ["Libraries/Image/Image.ios.js", "Libraries/Image/ImageViewNativeComponent.js", "Libraries/Image/NativeImageLoaderIOS.js",
    "Libraries/Image/resolveAssetSource.js", "Libraries/Image/AssetSourceResolver.js", "Libraries/Image/ImageBackground.js",
    "Libraries/Animated/components/AnimatedImage.js", "Libraries/Image/RCTImageLoader.mm", "React/Fabric/Mounting/ComponentViews/Image/RCTImageComponentView.mm",
    "ReactCommon/react/renderer/components/image/ImageShadowNode.cpp"]) {
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  }
  assert.ok(bundle.assets.files.length === 5 && bundle.assets.path === "build/images-probe.js.assets.json", "The bundle's assets are listed beside it");
  // The checks that need the native pipeline are normative; the rest hold on every host.
  assert.ok(report.expectedOriginalFailures.length > 0 && report.expectedOriginalFailures.length < expectedCheckCount);
  assert.ok(jsOnlyChecks.every(name => !report.expectedOriginalFailures.includes(name)));
  if (allowOriginalNegative) {
    assert.equal(result.status, 0, log);
    assert.ok(report.originalNegativeObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedOriginalFailures), "Only the native image checks qualify as the old-host control");
    assert.match(log, new RegExp(`IMAGES_ORIGINAL_NEGATIVE: ${failures.length}`));
    verifyImagesReport(report, {original: true});
    return;
  }
  assert.equal(report.originalNegativeObserved, false);
  if (sabotage !== null) {
    assert.equal(result.status, 0, log);
    assert.ok(failures.length > 0);
    assert.match(log, new RegExp(`IMAGES_SABOTAGE_REJECTED: ${failures.length}`));
    assert.ok(oracleRejection(report) != null, "The oracle rejects the sabotaged report");
    return;
  }
  assert.equal(result.status, 0, log);
  assert.deepEqual(failures, []);
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.equal(report.checks.length, expectedCheckCount);
  assert.match(log, /IMAGES_PASSED: \d+/);
  const verified = verifyImagesReport(report);
  assertOracleMutations(report);
  const original = await optionalJson("build/images-original-report.json");
  if (original != null) {
    assert.ok(original.originalNegativeObserved);
    verifyImagesReport(original, {original: true});
    assertSameReproducer(original, report, bundle, "preceding host");
  }
  const rejections = {};
  for (const name of ["main-thread", "stale-request"]) {
    const broken = await optionalJson(`build/images-sabotage-${name}-report.json`);
    if (broken != null) {
      assert.ok(broken.checks.some(row => !row.passed) && oracleRejection(broken) != null);
      assertSameReproducer(broken, report, bundle, `host with the ${name} sabotage`);
      rejections[name] = {failures: broken.checks.filter(row => !row.passed).map(row => row.name), oracle: oracleRejection(broken)};
    }
  }
  await writeFile(path.join(root, "build/images-comparison.json"), JSON.stringify({scenario: report.scenario, originalControlPresent: original != null,
    sabotagePresent: Object.keys(rejections), intentionalNativeProducerDifferences: imagesNativeProducers,
    originalFailures: original?.checks.filter(row => !row.passed).map(row => row.name) ?? null, sabotage: rejections, oracle: verified,
    current: {checks: report.checks.length, nativeHostSha256: report.provenance.nativeHostSha256, bundleSha256: bundle.bundle.sha256}}, null, 2) + "\n");
});
