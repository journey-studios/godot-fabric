import assert from "node:assert/strict";
import {spawn, spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleImagesVisualProbe, imagesVisualNativeProducers} from "../scripts/images-visual-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {verifyImagesVisualReport, visualCheckCount, visualJsOnlyChecks} from "./images-visual-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// The preceding host (build/images-visual-previous-host/, which scripts/images-visual-control.mjs puts in place and takes out again) is
// the one that was built from main before this work: it loads every picture and does nothing of what is done to it. --allow-original-negative
// runs the same bundle on it, and every check that needs an effect must fail there while the rest hold. --sabotage=<name> runs it on a host
// whose source was broken on purpose (scripts/images-visual-sabotage.mjs builds those hosts and restores the source): the probe and the
// oracle must both reject it.
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const sabotageArgument = process.argv.find(argument => argument === "--sabotage" || argument.startsWith("--sabotage="));
const sabotages = ["mask-borders", "blur-passes", "blur-cache", "nine-patch-scale"];
const sabotage = sabotageArgument === undefined ? null : (sabotageArgument.split("=")[1] ?? sabotages[0]);
assert.ok([null, ...sabotages].includes(sabotage), "Unknown sabotage: " + sabotage);
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

// The suite's local server is the network images suite's, a child process: it reports its ports on stdout, records every request it
// receives, and ends when its stdin closes. The picture it serves is the 24x24 quadrants of the images suite.
function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, "tests/images-network-server.mjs"), "--out", path.join(root, "build")], {stdio: ["pipe", "pipe", "inherit"]});
    let buffer = "";
    child.stdout.on("data", chunk => {
      buffer += chunk;
      if (buffer.includes("\n")) {
        resolve({child, info: JSON.parse(buffer.split("\n")[0])});
      }
    });
    child.on("error", reject);
    child.on("exit", code => reject(new Error("The images network server exited before it was ready: " + code)));
  });
}

function fetchLog(port) {
  return new Promise((resolve, reject) => {
    http.get({host: "127.0.0.1", port, path: "/__control/log"}, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
    }).on("error", reject);
  });
}

function stopServer({child}) {
  return new Promise(resolve => {
    // A server that already ended has no exit event left to wait for: waiting would hang the suite.
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.removeAllListeners("exit");
    child.on("exit", resolve);
    child.stdin.on("error", () => {});
    child.stdin.end();
  });
}

function runProbe(binary, server) {
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/images-visual-probe.gd", "--",
    `--ports=${JSON.stringify(server.info.ports)}`, ...(allowOriginalNegative ? ["--allow-original-negative"] : []), ...(sabotage === null ? [] : ["--sabotage"])],
  {encoding: "utf8", timeout: 280000, maxBuffer: 128 * 1024 * 1024});
  return {result, log: (result.stdout ?? "") + (result.stderr ?? "")};
}

function oracleRejection(report) {
  try {
    verifyImagesVisualReport({...structuredClone(report), checks: report.checks.map(row => ({...row, passed: true})), allCurrentAssertionsPassed: true});
  } catch (error) {
    return String(error.message).split("\n")[0];
  }
  return null;
}

// The oracle is not vacuous: each of these damaged copies of the genuine report must be refused, for the reason that the damage names.
function assertOracleMutations(report) {
  const mutate = (change, pattern, name) => {
    const candidate = structuredClone(report);
    change(candidate);
    assert.throws(() => verifyImagesVisualReport(candidate), pattern, name);
  };
  const view = (candidate, id) => candidate.stages.mount.surface.nodes.find(entry => entry.testID === id).image;
  const layer = (candidate, id) => view(candidate, id).drawn.effects.layer;
  const network = (candidate, step) => candidate.stages.network.steps[step];
  mutate(candidate => { view(candidate, "V-blur-2x-r2").image.fingerprint = view(candidate, "V-blur-2x-r1").image.fingerprint; }, /pixels of the bitmap/, "the blurred pixels are exactly those of the blur");
  mutate(candidate => { view(candidate, "V-blur-3x-r30").image.fingerprint = view(candidate, "V-blur-3x-r4").image.fingerprint; }, /pixels of the bitmap/, "a box wider than the picture extends its edge");
  mutate(candidate => { view(candidate, "V-blur-2x-r2").image.blur.kernel = 3; }, /the blur/, "the box is the formula's");
  mutate(candidate => { view(candidate, "V-blur-3x-r4").image.blur.passes = 3; }, /the blur/, "two passes reach the picture");
  mutate(candidate => { view(candidate, "V-blur-1x-r4").image.blur.scale = 2; }, /the blur/, "the box is measured in the picture's pixels per point");
  mutate(candidate => { view(candidate, "V-blur-kernel-1").image.blur.applies = true; }, /the blur/, "a box of one pixel changes nothing");
  mutate(candidate => { view(candidate, "V-blur-tint").drawn.effects.tint = [1, 0.5333, 0, 1]; }, /the tint/, "a blurred picture takes no tint");
  mutate(candidate => { view(candidate, "V-blur-repeat").drawn.effects.kind = "tile"; }, /how it is drawn/, "a blurred picture is not tiled");
  mutate(candidate => { layer(candidate, "V-tint-hex").params.tint[0] = 0.5; }, /parameters of the material/, "the shader gets the tint");
  mutate(candidate => { layer(candidate, "V-tint-hex").params.tinted = 0; }, /parameters of the material/, "the shader is told to tint");
  mutate(candidate => { layer(candidate, "V-tint-alpha").params.tint[3] = 1; }, /parameters of the material/, "the tint keeps its alpha");
  mutate(candidate => { view(candidate, "V-tint-prop-wins").drawn.effects.tint = [0, 1, 0, 1]; }, /the tint/, "the prop wins over the style");
  mutate(candidate => { view(candidate, "V-tint-transparent").drawn.effects.tint = null; }, /the tint/, "a fully transparent tint is a tint");
  mutate(candidate => { layer(candidate, "V-caps-object").commands[0].margins.left = 3; }, /the commands/, "margins are scale times the insets");
  mutate(candidate => { layer(candidate, "V-caps-oversize").commands[0].margins.right = 24; }, /the commands/, "margins are limited to what the picture holds");
  mutate(candidate => { layer(candidate, "V-caps-repeat").commands[0].xMode = "stretch"; }, /the commands/, "repeat tiles its nine-patch");
  mutate(candidate => { view(candidate, "V-caps-cover").drawn.effects.kind = "ninePatch"; }, /how it is drawn/, "cover ignores the caps");
  mutate(candidate => { layer(candidate, "V-caps-frame").commands[0].dst.x = 0; }, /the commands/, "the nine-patch lies in the content frame");
  mutate(candidate => { view(candidate, "V-mask-border").drawn.effects.clip.inner.radii.horizontal[0] = 10; }, /the clip/, "the inner radii lose the border");
  mutate(candidate => { view(candidate, "V-mask-padding").drawn.effects.clip.inner.rect.x = 2; }, /the clip/, "the inner shape is the content frame");
  mutate(candidate => { view(candidate, "V-mask-pill").drawn.effects.clip.outer.radii.vertical[1] = 40; }, /the clip/, "radii overlap no more than the side allows");
  mutate(candidate => { view(candidate, "V-mask-ellipse").drawn.effects.clip.outer.radii.vertical[0] = 30; }, /the clip/, "a percentage is of the height along the vertical radius");
  mutate(candidate => { view(candidate, "V-mask-visible").drawn.effects.clip = view(candidate, "V-mask-radius").drawn.effects.clip; }, /the clip/, "overflow visible clips nothing");
  mutate(candidate => { layer(candidate, "V-mask-3x").params.outer_rx[0] = 16; }, /parameters of the material/, "the shader's coordinates are pixels of the picture");
  mutate(candidate => { layer(candidate, "V-mask-radius").params.clipped = 0; }, /parameters of the material/, "the shader is told to clip");
  mutate(candidate => { view(candidate, "V-mask-radius").drawn.effects.layer.shaded = false; }, /the shader/, "a rounded view needs the shader");
  mutate(candidate => { view(candidate, "V-mask-square").drawn.effects.layer.shaded = true; }, /the shader/, "a square view does not");
  mutate(candidate => { view(candidate, "V-ignored-all").ignored.fadeDuration = 100; }, /ignored-all/, "an ignored prop never reaches the view");
  mutate(candidate => { view(candidate, "V-ignored-all").ignored.defaultSource = false; }, /ignored-all/, "defaultSource reaches it and is read by nothing");
  mutate(candidate => { candidate.stages.changes[0].view.image.fingerprint = candidate.stages.changes[1].view.image.fingerprint; }, /pixels of the bitmap/, "a live blur makes the blurred pixels");
  mutate(candidate => { candidate.stages.changes[3].view.drawn.effects.tint = null; }, /the tint/, "a live tint is in the view");
  mutate(candidate => { candidate.stages.changes[10].view.drawn.effects.clip = null; }, /the clip/, "a clipping view is clipped again");
  mutate(candidate => { candidate.stages.blurLive.types.unshift("loadStart"); }, /Expected values to be strictly deep-equal/, "a blur change has no onLoadStart");
  mutate(candidate => { network(candidate, 2).counters.decodedHits += 1; }, /Expected values to be strictly deep-equal/, "a blurred request does not read the decoded cache");
  mutate(candidate => { network(candidate, 0).decoded.entries = 1; }, /Expected values to be strictly deep-equal/, "a blurred request writes nothing to the decoded cache");
  mutate(candidate => { network(candidate, 1).views["plain-a"].image.fingerprint = network(candidate, 0).views["blur-a"].image.fingerprint; }, /Expected values to be strictly equal/, "no blurred pixel went into the decoded cache");
  mutate(candidate => { network(candidate, 3).views.tint.image.textureWidth = 20; }, /Expected values to be strictly deep-equal/, "two views of the cached picture hold one picture");
  mutate(candidate => { network(candidate, 3).live -= 1; }, /live textures/, "the live textures are the cached picture and the blurred ones");
  mutate(candidate => { candidate.server.records.push(structuredClone(candidate.server.records.find(row => row.url === "/pic/max-age/quad24.png"))); }, /once/, "everything but the first request came from the byte cache");
  mutate(candidate => { candidate.stages.lifecycle.afterTinted.materialsFreed -= 1; }, /Expected values to be strictly deep-equal/, "unmounting a tinted Image frees its material");
  mutate(candidate => { candidate.stages.lifecycle.first.shadersCreated = 2; }, /Expected values to be strictly deep-equal/, "one shader serves every view");
  mutate(candidate => { candidate.stages.lifecycle.local.materials += 1; }, /material for each/, "a material for each Image that tints or clips");
  mutate(candidate => { candidate.stages.afterStop.effects.itemsFreed -= 1; }, /No item outlives/, "no item outlives the application");
  mutate(candidate => { candidate.stages.afterStop.effects.shadersFreed = 1; }, /shader is the extension's/, "the shader is freed with the extension");
  mutate(candidate => { candidate.stages.afterStop.application.images.jobs.find(job => job.blur.applies).thread.worker = false; }, /on a worker/, "every blur ran on a worker");
  mutate(candidate => {
    const job = candidate.stages.afterStop.application.images.jobs.find(entry => entry.blur.applies);
    job.thread.id = candidate.stages.afterStop.application.images.hostThread;
  }, /main thread/, "no blur ran on the main thread");
  mutate(candidate => { candidate.stages.afterStop.application.images.counters.blurred += 1; }, /counted every picture/, "the loader counts what it blurred");
  mutate(candidate => { candidate.stages.mount.react.boundaries["V-refusal-capInsets-list"] = "boom"; }, /capInsets-list/, "a list of cap insets is refused with the host's words");
}

function assertSameReproducer(control, report, bundle, name) {
  // Every host runs every check, in the same order: what differs is which of them pass.
  assert.deepEqual(control.checks.map(row => row.name), report.checks.map(row => row.name), `${name} runs the same checks, in the same order`);
  assert.ok(control.expectedOriginalFailures.every(check => report.expectedOriginalFailures.includes(check)), name);
  assert.equal(control.provenance.bundle.bundle.sha256, bundle.bundle.sha256, `${name}: the same bundle runs on every host`);
  // Only the compiled native producers differ between hosts; their bundle-time pins say nothing about them.
  for (const [file, sha] of Object.entries(bundle.sources)) {
    if (!imagesVisualNativeProducers.includes(file)) {
      assert.equal(control.provenance.bundle.sources[file], sha, `${name} shares the reproducer and SDK producer: ${file}`);
    }
  }
  assert.notEqual(control.provenance.nativeHostSha256, report.provenance.nativeHostSha256, name);
}

test("RN's own Image tints, blurs, stretches by cap insets and clips to rounded corners, and takes the props iOS ignores", async () => {
  const bundle = await bundleImagesVisualProbe();
  const binary = await ensureGodotBinary();
  if (sabotage === null && !allowOriginalNegative) {
    const unit = spawnSync(path.join(root, ".deps/build/image_effects_test"), [], {encoding: "utf8", timeout: 60000});
    assert.equal(unit.error, undefined);
    assert.equal(unit.status, 0, unit.stdout + unit.stderr);
    assert.match(unit.stdout, /IMAGE_EFFECTS_PASSED/);
  }
  await rm(path.join(root, "build/images-visual-report.json"), {force: true});
  const server = await startServer();
  let probe, serverLog;
  try {
    probe = runProbe(binary, server);
    serverLog = await fetchLog(server.info.ports.http);
  } finally {
    await stopServer(server);
  }
  const {result, log} = probe;
  await writeFile(path.join(root, `build/images-visual-${lane}.log`), log);
  const report = await optionalJson("build/images-visual-report.json");
  if (report != null) {
    report.provenance = {node: process.version, bundle, nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))),
      sourceReceiptDoesNotCertifyNativeBuild: true};
    report.server = {ports: server.info.ports, records: serverLog.records};
    await writeFile(path.join(root, `build/images-visual-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  // Artifacts are saved before assertions. A control flag never accepts unrelated failures or removes the declared failures from the report.
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.equal(report.scenario, "images-visual");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.equal(new Set(report.expectedOriginalFailures).size, report.expectedOriginalFailures.length);
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  // No other ERROR line: no native, script or engine error hides.
  const engineErrors = [...log.matchAll(/^ERROR: (?!FABRIC_CHECK_FAILED: )(.+)$/gm)].map(match => match[1]);
  assert.deepEqual(engineErrors, [], "No native diagnostic, script or engine error is hidden");
  for (const file of ["tests/images-visual-fixture.jsx", "tests/images-visual-probe.gd", "tests/images-visual-native.test.mjs", "tests/images-visual-oracle.mjs",
    "tests/images-visual-pattern.mjs", "tests/images-pattern.mjs", "tests/images-network-server.mjs", "tests/fixtures/images-visual/manifest.json", "scripts/images-visual-bundle.mjs",
    "scripts/images-visual-fixtures.mjs", "src/image.jsx", "src/image-contract.mjs", "src/react-native-platform.jsx", "sdk/toolchain/platform-plugin.mjs", ...imagesVisualNativeProducers]) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  for (const file of ["Libraries/Image/Image.ios.js", "Libraries/Image/ImageViewNativeComponent.js", "Libraries/Image/RCTImageBlurUtils.mm",
    "React/Fabric/Mounting/ComponentViews/Image/RCTImageComponentView.mm", "React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm", "React/Views/RCTBorderDrawing.m"]) {
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  }
  // The checks that need an effect are normative; the rest hold on every host.
  assert.ok(report.expectedOriginalFailures.length > 0 && report.expectedOriginalFailures.length < visualCheckCount);
  assert.ok(visualJsOnlyChecks.every(name => !report.expectedOriginalFailures.includes(name)));
  if (allowOriginalNegative) {
    assert.equal(result.status, 0, log);
    assert.ok(report.originalNegativeObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedOriginalFailures), "Only the effect checks qualify as the old-host control");
    assert.match(log, new RegExp(`IMAGES_VISUAL_ORIGINAL_NEGATIVE: ${failures.length}`));
    verifyImagesVisualReport(report, {original: true});
    return;
  }
  assert.equal(report.originalNegativeObserved, false);
  if (sabotage !== null) {
    assert.equal(result.status, 0, log);
    assert.ok(failures.length > 0);
    assert.match(log, new RegExp(`IMAGES_VISUAL_SABOTAGE_REJECTED: ${failures.length}`));
    assert.ok(oracleRejection(report) != null, "The oracle rejects the sabotaged report");
    return;
  }
  assert.equal(result.status, 0, log);
  assert.deepEqual(failures, []);
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.equal(report.checks.length, visualCheckCount);
  assert.match(log, /IMAGES_VISUAL_PASSED: \d+/);
  const verified = verifyImagesVisualReport(report);
  assertOracleMutations(report);
  const original = await optionalJson("build/images-visual-original-report.json");
  if (original != null) {
    assert.ok(original.originalNegativeObserved);
    verifyImagesVisualReport(original, {original: true});
    assertSameReproducer(original, report, bundle, "preceding host");
  }
  const rejections = {};
  for (const name of sabotages) {
    const broken = await optionalJson(`build/images-visual-sabotage-${name}-report.json`);
    if (broken != null) {
      assert.ok(broken.checks.some(row => !row.passed) && oracleRejection(broken) != null);
      assertSameReproducer(broken, report, bundle, `host with the ${name} sabotage`);
      rejections[name] = {failures: broken.checks.filter(row => !row.passed).map(row => row.name), oracle: oracleRejection(broken)};
    }
  }
  await writeFile(path.join(root, "build/images-visual-comparison.json"), JSON.stringify({scenario: report.scenario, originalControlPresent: original != null,
    sabotagePresent: Object.keys(rejections), intentionalNativeProducerDifferences: imagesVisualNativeProducers,
    originalFailures: original?.checks.filter(row => !row.passed).map(row => row.name) ?? null, sabotage: rejections, oracle: verified,
    current: {checks: report.checks.length, nativeHostSha256: report.provenance.nativeHostSha256, bundleSha256: bundle.bundle.sha256}}, null, 2) + "\n");
});
