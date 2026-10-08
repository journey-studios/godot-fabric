import assert from "node:assert/strict";
import {spawn, spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleImagesNetworkProbe, imagesNetworkNativeProducers} from "../scripts/images-network-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {networkCheckCount, networkJsOnlyChecks, verifyImagesNetworkReport} from "./images-network-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// The preceding host fails every http(s) source: --allow-original-negative runs the same bundle on it (scripts/images-network-control.mjs
// puts the preserved host in place and restores the genuine one), and every check that needs the network must fail there while the
// others hold. --sabotage=<name> runs it on a host whose source was broken on purpose (scripts/images-network-sabotage.mjs builds those
// hosts and restores the source): the probe and the oracle must both reject it.
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const sabotageArgument = process.argv.find(argument => argument === "--sabotage" || argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : (sabotageArgument.split("=")[1] ?? "decoded-reload");
const sabotages = ["decoded-reload", "cancel-open", "texture-mutation"];
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

// The suite's local server is a child process: it reports its ports on stdout, records every request it receives, and ends when
// its stdin closes.
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
  const {ports, files} = server.info;
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/images-network-probe.gd", "--",
    `--ports=${JSON.stringify(ports)}`, `--ca=${files.ca}`, ...(allowOriginalNegative ? ["--allow-original-negative"] : []), ...(sabotage === null ? [] : ["--sabotage"])],
  {encoding: "utf8", timeout: 280000, maxBuffer: 128 * 1024 * 1024});
  return {result, log: (result.stdout ?? "") + (result.stderr ?? "")};
}

function oracleRejection(report) {
  try {
    verifyImagesNetworkReport({...structuredClone(report), checks: report.checks.map(row => ({...row, passed: true})), allCurrentAssertionsPassed: true});
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
    assert.throws(() => verifyImagesNetworkReport(candidate), pattern, name);
  };
  const record = (candidate, url) => candidate.server.records.find(row => row.url === url);
  const node = (candidate, id) => candidate.stages.mount.surface.nodes.find(entry => entry.testID === id);
  const op = (candidate, label) => candidate.stages.ops.find(entry => entry.label === label);
  mutate(candidate => { candidate.stages.mount.react.logs.ok.find(event => event.type === "progress").loaded += 1; }, /progress|cumulative|whole/, "progress counts the bytes that arrived");
  mutate(candidate => { candidate.stages.mount.react.logs["ok-chunked"].find(event => event.type === "progress").progress = 1; }, /progress is loaded over total/, "the fraction of an unknown length is negative");
  mutate(candidate => { const log = candidate.stages.mount.react.logs["err-404"]; log.find(event => event.type === "error").responseCode = 403; }, /responseCode/, "a failure carries the status of its response");
  mutate(candidate => { delete candidate.stages.mount.react.logs["err-404"].find(event => event.type === "error").httpResponseHeaders["X-Reason"]; }, /header x-reason/, "a failure carries the headers of its response");
  mutate(candidate => { candidate.stages.mount.react.logs["err-empty200"].find(event => event.type === "error").error = "Failed to load x"; }, /err-empty200/, "an empty body is Unknown image download error");
  mutate(candidate => { node(candidate, "ok-wide").image.image.textureWidth = 20; }, /texture/, "a texture is never resized");
  mutate(candidate => { record(candidate, "/pic/plain/quad24.png?post").method = "PUT"; }, /method/, "the method reaches the server as declared");
  mutate(candidate => { record(candidate, "/pic/plain/quad24.png?post").rawHeaders.push("Cookie", "a=1"); }, /no cookies/, "no cookies are sent");
  mutate(candidate => { record(candidate, "/hang-body/cancel-body").state = "responded"; }, /the client left/, "a cancelled download closes its request");
  mutate(candidate => { candidate.server.records = candidate.server.records.filter(row => row.url !== "/hang-body/h3"); }, /h3/, "the server holds every download that started");
  mutate(candidate => { op(candidate, "c1-same").served = "network"; }, /where the picture came from/, "a second Image of one picture is answered by the decoded cache");
  mutate(candidate => { op(candidate, "c1-reload").served = "decoded"; }, /where the picture came from/, "reload asks the server again");
  mutate(candidate => { op(candidate, "c11-auth").served = "decoded"; }, /where the picture came from/, "a request that carries credentials is not answered by the decoded cache");
  mutate(candidate => { op(candidate, "c11-plain-3").served = "bytes"; }, /where the picture came from/, "a request that carries credentials does not leave its response in the byte cache");
  mutate(candidate => { op(candidate, "c11-gs-plain").served = "bytes"; }, /where the response came from/, "a size measured with credentials does not leave its response in the byte cache");
  mutate(candidate => { op(candidate, "c11-http-auth").served = "network"; }, /where the picture came from/, "a request that carries credentials is not sent over http");
  mutate(candidate => { op(candidate, "c11-gs-http").served = "network"; }, /where the response came from/, "a size measured with credentials is not asked over http");
  mutate(candidate => { candidate.server.records.find(row => row.listener === "other" && row.url === "/pic/plain/quad24.png").rawHeaders.push("X-Keep", "kept"); }, /other origin gets neither/, "a redirect drops the source's headers");
  mutate(candidate => { op(candidate, "max-age-3").served = "decoded"; }, /where the picture came from/, "a stale picture is loaded again");
  mutate(candidate => { op(candidate, "heuristic-3").served = "network"; }, /where the picture came from/, "a heuristic stale time is a tenth of the age");
  mutate(candidate => { op(candidate, "lru-1-again").served = "decoded"; }, /where the picture came from/, "the decoded cache gives up the least recently used");
  mutate(candidate => { candidate.server.records.splice(candidate.server.records.findIndex(row => row.url === "/pic/no-store/quad24.png?c4"), 1); }, /server saw/, "a response that forbids caching is fetched every time");
  mutate(candidate => { op(candidate, "q-noise").result.value = {}; }, /queryCache/, "queryCache reports what the byte cache holds");
  mutate(candidate => { candidate.stages.ops.find(entry => entry.label === "after-byte-lru").bytes.reverse(); }, /byte cache holds these responses/, "the byte cache gives up the least recently used");
  mutate(candidate => { candidate.stages.ops.find(entry => entry.label === "memory-2").before.decoded += 1; }, /held what the model holds/, "the memory warning found the caches the model expects");
  mutate(candidate => { candidate.stages.jobs.find(job => job.served === "network" && job.format === "png").thread.worker = false; }, /worker thread/, "every network picture was decoded on a worker");
  mutate(candidate => { const job = candidate.stages.jobs.find(entry => entry.served === "network" && entry.format === "png"); job.thread.id = candidate.stages.afterStop.loader.hostThread; }, /off the main thread/, "no network picture was decoded on the main thread");
  mutate(candidate => { candidate.stages.afterStop.loader.liveTextures = 1; }, /liveTextures/, "no texture outlives the application");
  mutate(candidate => { candidate.stages.afterStop.loader.network.active = 1; }, /nothing downloads/, "no download outlives the application");
  mutate(candidate => { candidate.stages.afterStop.logsAfter["stop-body-1"].push({type: "error"}); }, /nothing reached JS/, "nothing reaches JS after the stop");
  mutate(candidate => { candidate.stages.concurrency.atPeak.peakActive = 5; }, /four were active/, "no more than four downloads at once");
  mutate(candidate => { candidate.stages.limits.chunked.error = "boom"; }, /download passed the host limit|boom/, "a body past the limit is refused");
  mutate(candidate => { candidate.stages.shared.b.image.textureWidth = 20; }, /share|texture/, "a texture the views share is never resized");
}

function assertSameReproducer(control, report, bundle, name) {
  // The old host stops after the checks that need nothing of the stages with holds: the checks it ran are the current host's, in
  // its order. Every other check needs the stages that only the network can run.
  const names = report.checks.map(row => row.name);
  const ran = control.checks.map(row => row.name);
  let cursor = 0;
  for (const check of ran) {
    cursor = names.indexOf(check, cursor);
    assert.ok(cursor >= 0, `${name} runs only checks of the current host, in its order: ${check}`);
    cursor += 1;
  }
  assert.ok(networkJsOnlyChecks.filter(check => ran.includes(check)).length >= 4, name + " runs the checks that need nothing of the network");
  assert.equal(ran.length < names.length, control.allowOriginalNegative, name + ": only the old host stops short");
  assert.ok(control.expectedOriginalFailures.every(check => report.expectedOriginalFailures.includes(check)), name);
  assert.equal(control.provenance.bundle.bundle.sha256, bundle.bundle.sha256, name + ": the same bundle runs on every host");
  // Only the compiled native producers differ between hosts; their bundle-time pins say nothing about them.
  for (const [file, sha] of Object.entries(bundle.sources)) {
    if (!imagesNetworkNativeProducers.includes(file)) {
      assert.equal(control.provenance.bundle.sources[file], sha, `${name} shares the reproducer and SDK producer: ${file}`);
    }
  }
  assert.notEqual(control.provenance.nativeHostSha256, report.provenance.nativeHostSha256, name);
}

test("RN's own Image downloads over the host's HTTP transport, decodes on worker threads and keeps pictures in two memory caches", async () => {
  const bundle = await bundleImagesNetworkProbe();
  const binary = await ensureGodotBinary();
  if (sabotage === null && !allowOriginalNegative) {
    for (const [unit, marker] of [["image_core_test", /IMAGE_CORE_PASSED/], ["image_cache_test", /IMAGE_CACHE_PASSED/], ["image_network_test", /IMAGE_NETWORK_PASSED/]]) {
      const result = spawnSync(path.join(root, ".deps/build", unit), [], {encoding: "utf8", timeout: 20000});
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, marker);
    }
  }
  await rm(path.join(root, "build/images-network-report.json"), {force: true});
  const server = await startServer();
  let probe, serverLog;
  try {
    probe = runProbe(binary, server);
    serverLog = await fetchLog(server.info.ports.http);
  } finally {
    await stopServer(server);
  }
  const {result, log} = probe;
  await writeFile(path.join(root, `build/images-network-${lane}.log`), log);
  const report = await optionalJson("build/images-network-report.json");
  if (report != null) {
    report.provenance = {node: process.version, bundle, nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))),
      sourceReceiptDoesNotCertifyNativeBuild: true};
    report.server = {ports: server.info.ports, records: serverLog.records, holds: serverLog.holds};
    await writeFile(path.join(root, `build/images-network-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  // Artifacts are saved before assertions. A control flag never accepts unrelated failures or removes the declared failures from the report.
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.equal(report.scenario, "images-network");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.equal(new Set(report.expectedOriginalFailures).size, report.expectedOriginalFailures.length);
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  // Every other ERROR line is Godot's own PNG decoder refusing a picture the server made corrupt on purpose, three lines per refusal:
  // no native, script or engine error hides.
  const engineErrors = [...log.matchAll(/^ERROR: (?!FABRIC_CHECK_FAILED: )(.+)$/gm)].map(match => match[1]);
  const pngRefusals = new Set(['Condition "!success" is true. Returning: ERR_FILE_CORRUPT', 'Condition "err" is true. Returning: Ref<Image>()',
    'Condition "image.is_null()" is true. Returning: ERR_PARSE_ERROR']);
  assert.deepEqual(engineErrors.filter(text => !pngRefusals.has(text)), [], "No native diagnostic, script or engine error is hidden");
  if (sabotage === null && !allowOriginalNegative) {
    const refusals = (report.stages.jobs ?? []).filter(job => /the png decoder rejected the data/.test(job.error)).length;
    assert.equal(engineErrors.length, 3 * refusals, "The engine refused exactly the pictures the host offered it to refuse");
  }
  for (const file of ["tests/images-network-fixture.jsx", "tests/images-network-probe.gd", "tests/images-network-base.gd", "tests/images-network-native.test.mjs", "tests/images-network-oracle.mjs",
    "tests/images-network-server.mjs", "tests/images-pattern.mjs", "scripts/images-network-bundle.mjs", "src/image.jsx", "src/image-contract.mjs", "src/react-native-platform.jsx",
    "sdk/toolchain/platform-plugin.mjs", ...imagesNetworkNativeProducers]) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  for (const file of ["Libraries/Image/Image.ios.js", "Libraries/Image/ImageSourceUtils.js", "Libraries/Image/NativeImageLoaderIOS.js", "Libraries/Image/RCTImageLoader.mm",
    "Libraries/Image/RCTImageCache.mm", "Libraries/Network/RCTNetworkTask.mm", "Libraries/Network/RCTHTTPRequestHandler.mm",
    "React/Fabric/Mounting/ComponentViews/Image/RCTImageComponentView.mm"]) {
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  }
  // The checks that need the network are normative; the rest hold on every host.
  assert.ok(report.expectedOriginalFailures.length > 0 && report.expectedOriginalFailures.length < networkCheckCount);
  assert.ok(networkJsOnlyChecks.every(name => !report.expectedOriginalFailures.includes(name)));
  if (allowOriginalNegative) {
    assert.equal(result.status, 0, log);
    assert.ok(report.originalNegativeObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedOriginalFailures), "Only the network checks qualify as the old-host control");
    assert.match(log, new RegExp(`IMAGES_NETWORK_ORIGINAL_NEGATIVE: ${failures.length}`));
    verifyImagesNetworkReport(report, {original: true});
    return;
  }
  assert.equal(report.originalNegativeObserved, false);
  if (sabotage !== null) {
    assert.equal(result.status, 0, log);
    assert.ok(failures.length > 0);
    assert.match(log, new RegExp(`IMAGES_NETWORK_SABOTAGE_REJECTED: ${failures.length}`));
    assert.ok(oracleRejection(report) != null, "The oracle rejects the sabotaged report");
    return;
  }
  assert.equal(result.status, 0, log);
  assert.deepEqual(failures, []);
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.equal(report.checks.length, networkCheckCount);
  assert.match(log, /IMAGES_NETWORK_PASSED: \d+/);
  const verified = verifyImagesNetworkReport(report);
  assertOracleMutations(report);
  const original = await optionalJson("build/images-network-original-report.json");
  if (original != null) {
    assert.ok(original.originalNegativeObserved);
    verifyImagesNetworkReport(original, {original: true});
    assertSameReproducer(original, report, bundle, "preceding host");
  }
  const rejections = {};
  for (const name of sabotages) {
    const broken = await optionalJson(`build/images-network-sabotage-${name}-report.json`);
    if (broken != null) {
      assert.ok(broken.checks.some(row => !row.passed) && oracleRejection(broken) != null);
      assertSameReproducer(broken, report, bundle, `host with the ${name} sabotage`);
      rejections[name] = {failures: broken.checks.filter(row => !row.passed).map(row => row.name), oracle: oracleRejection(broken)};
    }
  }
  await writeFile(path.join(root, "build/images-network-comparison.json"), JSON.stringify({scenario: report.scenario, originalControlPresent: original != null,
    sabotagePresent: Object.keys(rejections), intentionalNativeProducerDifferences: imagesNetworkNativeProducers,
    originalFailures: original?.checks.filter(row => !row.passed).map(row => row.name) ?? null, sabotage: rejections, oracle: verified,
    current: {checks: report.checks.length, nativeHostSha256: report.provenance.nativeHostSha256, bundleSha256: bundle.bundle.sha256}}, null, 2) + "\n");
});
