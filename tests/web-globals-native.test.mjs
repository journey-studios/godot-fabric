import assert from "node:assert/strict";
import {spawn, spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleWebGlobalsProbe, sabotageNames} from "../scripts/web-globals-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {derivedChecks, expectedFile, oracleRejection, sha256Of, shadowHits, verifyExpectedFile, verifyWebGlobalsReport, webGlobalsExpectations} from "./web-globals-oracle.mjs";

// GF-05 slice E. A lane is the current SDK on the host in addons/; --sabotage=<name> bundles the SDK with one in-memory override (scripts/web-globals-bundle.mjs), which the
// probe and the independent oracle must both reject. No source file is edited by either. This slice changes no native code, so there is no run on a previous host: the
// host is the one the earlier slices certified, and its SHA-256 is recorded beside every report.
const root = fileURLToPath(new URL("..", import.meta.url));
assert.ok(!process.argv.includes("--allow-original-negative"), "This slice changes no native code: there is no previous-host control");
const sabotageArgument = process.argv.find(argument => argument === "--sabotage" || argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : (sabotageArgument.split("=")[1] ?? sabotageNames[0]);
assert.ok(sabotage === null || sabotageNames.includes(sabotage), "Unknown sabotage: " + sabotage);
const lane = sabotage === null ? "current" : `sabotage-${sabotage}`;
const digest = value => createHash("sha256").update(value).digest("hex");
const sorted = values => [...values].sort();
const guarded = ["src/initialize.js", "node_modules/react-native/Libraries/Core/setUpXHR.js", "node_modules/react-native/Libraries/Blob/URLSearchParams.js"];

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

async function hashes() {
  return Object.fromEntries(await Promise.all(guarded.map(async file => [file, digest(await readFile(path.join(root, file)))])));
}

// The suite's local server is the networking suite's: a child process that reports its ports on stdout, records every request it receives, and ends when its stdin closes.
function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, "tests/networking-server.mjs"), "--out", path.join(root, "build")], {stdio: ["pipe", "pipe", "inherit"]});
    let buffer = "";
    child.stdout.on("data", chunk => {
      buffer += chunk;
      if (buffer.includes("\n")) {
        resolve({child, info: JSON.parse(buffer.split("\n")[0])});
      }
    });
    child.on("error", reject);
    child.on("exit", code => reject(new Error("The networking server exited before it was ready: " + code)));
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

// Every ERROR line of a log is a failed check: no native, script or engine error hides.
function assertOnlyCheckErrors(report, log) {
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length, "No native diagnostic, script or engine error is hidden");
  return failures;
}

test("RN's own URL, URLSearchParams, AbortController and AbortSignal and the engine's encoders behave as RN, Node and the pinned Hermes say, and TextDecoder is absent", async () => {
  const before = await hashes();
  const bundle = await bundleWebGlobalsProbe(sabotage);
  const bundleFile = sabotage === null ? "web-globals-probe.js" : `web-globals-sabotage-${sabotage}-probe.js`;
  const binary = await ensureGodotBinary();
  await rm(path.join(root, "build/web-globals-report.json"), {force: true});
  const server = await startServer();
  let result, serverLog;
  try {
    const flags = [`--bundle=${bundleFile}`, `--ports=${JSON.stringify({http: server.info.ports.http})}`, ...(sabotage === null ? [] : ["--sabotage"])];
    result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/web-globals-probe.gd", "--", ...flags],
      {encoding: "utf8", timeout: 240000, maxBuffer: 64 * 1024 * 1024});
    serverLog = await fetchLog(server.info.ports.http);
  } finally {
    await stopServer(server);
  }
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/web-globals-${lane}.log`), log);
  const report = await optionalJson("build/web-globals-report.json");
  if (report != null) {
    report.provenance = {node: process.version, lane, bundle, nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))),
      hermesSha256: digest(await readFile(path.join(root, "addons/frameworks/hermesvm.framework/hermesvm"))), expectedSha256: sha256Of(expectedFile),
      sourceReceiptDoesNotCertifyNativeBuild: true};
    report.server = {ports: server.info.ports, records: serverLog.records, holds: serverLog.holds};
    await writeFile(path.join(root, `build/web-globals-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  // Artifacts are saved before assertions.
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.ok(report != null, log);
  assert.equal(report.scenario, "native-web-globals");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.bundle, bundleFile);
  assert.equal(report.sabotage, sabotage !== null);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.deepEqual(await hashes(), before, "A sabotage never edits a source: it overrides it in memory");
  for (const file of ["tests/web-globals-fixture.jsx", "tests/web-globals-cases.mjs", "tests/web-globals-early.js", "tests/web-globals-host.js", "tests/web-globals-probe.gd",
    "tests/web-globals-native.test.mjs", "tests/web-globals-oracle.mjs", "tests/web-globals-sabotages.mjs", "tests/networking-server.mjs", "scripts/web-globals-bundle.mjs",
    "scripts/native-probe-bundle.mjs", "src/initialize.js", "sdk/toolchain/platform-plugin.mjs", "sdk/toolchain/metro-polyfills.mjs"]) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  // The probe judged the cases against the file that is in the repository now.
  assert.equal(report.stages.expectedSha256, sha256Of(expectedFile), "The probe read the expectation file that is on disk");
  const expectations = await webGlobalsExpectations(report.stages.environment.blobConstants);
  verifyExpectedFile(expectations);
  // The scan for a shadowing global bites: each way to put one of the eight in place of the engine's or RN's is found, and the genuine tree has none.
  assert.deepEqual(shadowHits("src/x.js", "globalThis.TextDecoder = class TextDecoder {};"), [{file: "src/x.js", kind: "assigns"}]);
  assert.deepEqual(shadowHits("src/x.js", "Object.defineProperty(globalThis, 'atob', {value() {}});"), [{file: "src/x.js", kind: "defines"}]);
  assert.deepEqual(shadowHits("src/x.js", "polyfillGlobal('URL', () => class URL {});"), [{file: "src/x.js", kind: "polyfills"}]);
  assert.deepEqual(shadowHits("native/x.cpp", 'global.setProperty(runtime, "btoa", function);'), [{file: "native/x.cpp", kind: "installs"}]);
  assert.deepEqual(shadowHits("src/x.js", "const decoded = globalThis.atob === other;"), []);
  assert.deepEqual(expectations.shadow, [], "Nothing in src/, the toolchain or native/ shadows a global of this slice");
  assert.deepEqual(derivedChecks(report, expectations), report.checks, "The oracle derives every verdict the probe gave, from the raw observations, RN, Node and the pinned Hermes");

  if (sabotage !== null) {
    assert.equal(result.status, 0, log);
    const failures = assertOnlyCheckErrors(report, log);
    assert.ok(failures.length > 0, "The probe's checks reject the sabotaged SDK");
    assert.match(log, new RegExp(`WEB_GLOBALS_SABOTAGE_REJECTED: ${failures.length}`));
    assert.ok(oracleRejection(report, expectations) != null, "The oracle rejects the sabotaged SDK");
    return;
  }

  // The injection order: the host-state module runs before everything, RN's polyfills included.
  const inputs = bundle.bundle.inputs;
  assert.equal(inputs[0], "tests/web-globals-host.js");
  for (const file of ["Libraries/Core/setUpXHR.js", "Libraries/Blob/URL.js", "Libraries/Blob/URLSearchParams.js", "Libraries/Network/fetch.js", "Libraries/Network/XMLHttpRequest.js",
    "src/private/webapis/dom/abort-api/AbortController.js", "src/private/webapis/dom/abort-api/AbortSignal.js", "src/private/webapis/errors/DOMException.js"]) {
    assert.ok(inputs.includes("node_modules/react-native/" + file), "The bundle runs RN's own module: " + file);
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  }
  for (const file of ["../whatwg-fetch/dist/fetch.umd.js", "../whatwg-fetch/package.json", "src/private/setup/setUpDefaultReactNativeEnvironment.js"]) {
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/, "Pin the source the oracle reads: " + file);
  }
  assert.equal(result.status, 0, log);
  assert.deepEqual(assertOnlyCheckErrors(report, log), []);
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.match(log, /WEB_GLOBALS_PASSED: \d+/);
  verifyWebGlobalsReport(report, expectations, {serverLog});
  // The requests the lane made are exactly the ones its cases make, and the server held and closed the three that were aborted.
  const requested = serverLog.records.map(record => record.url);
  assert.deepEqual(sorted(requested), sorted(["/hang/wg-fetch", "/hang/wg-reason", "/json?case=wg-completed", "/hang/wg-xhr"]));
  assert.deepEqual(serverLog.holds, {"wg-fetch": "closed-by-client", "wg-reason": "closed-by-client", "wg-xhr": "closed-by-client"});

  const rejections = {};
  for (const name of sabotageNames) {
    const sabotaged = await optionalJson(`build/web-globals-sabotage-${name}-report.json`);
    if (sabotaged != null) {
      const sabotagedExpectations = await webGlobalsExpectations(sabotaged.stages.environment.blobConstants);
      assert.ok(sabotaged.checks.some(row => !row.passed) && oracleRejection(sabotaged, sabotagedExpectations) != null, name);
      assert.notEqual(sabotaged.provenance.bundle.bundle.sha256, bundle.bundle.sha256, `${name} bundles another SDK`);
      assert.equal(sabotaged.provenance.nativeHostSha256, report.provenance.nativeHostSha256, `${name} runs on the same host`);
      rejections[name] = {failures: sabotaged.checks.filter(row => !row.passed).map(row => row.name), oracle: oracleRejection(sabotaged, sabotagedExpectations)};
    }
  }
  await writeFile(path.join(root, "build/web-globals-comparison.json"), JSON.stringify({scenario: report.scenario, previousHostControl: "not applicable: no native code changed",
    sabotagePresent: Object.keys(rejections), sabotages: rejections, hermes: expectations.hermes,
    current: {checks: report.checks.length, nativeHostSha256: report.provenance.nativeHostSha256, bundleSha256: bundle.bundle.sha256}}, null, 2) + "\n");
});
