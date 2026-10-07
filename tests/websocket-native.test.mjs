import assert from "node:assert/strict";
import {spawn, spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleWebSocketProbe, websocketNativeProducers} from "../scripts/websocket-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {verifyWebSocketReport} from "./websocket-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// The preceding host has no WebSocketModule: --allow-original-negative runs the same bundle on it, and every WebSocket
// check must fail there while the JavaScript ones hold. --sabotage[=name] runs it on a host whose WebSocket support was
// broken on purpose (scripts/websocket-sabotage.mjs builds those hosts and restores the source): the probe and the oracle
// must both reject it.
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const sabotageArgument = process.argv.find(argument => argument === "--sabotage" || argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : (sabotageArgument.split("=")[1] ?? "origin");
assert.ok([null, "origin", "stop"].includes(sabotage), "Unknown sabotage: " + sabotage);
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

// The suite's local server is a child process: it reports its ports on stdout, records every connection it
// receives and every frame on it, and ends when its stdin closes.
function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, "tests/websocket-server.mjs"), "--out", path.join(root, "build")],
      {stdio: ["pipe", "pipe", "inherit"]});
    let buffer = "";
    child.stdout.on("data", chunk => {
      buffer += chunk;
      if (buffer.includes("\n")) {
        resolve({child, info: JSON.parse(buffer.split("\n")[0])});
      }
    });
    child.on("error", reject);
    child.on("exit", code => reject(new Error("The websocket server exited before it was ready: " + code)));
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
    // A server that already ended, a crashed one, has no exit event left to wait for: waiting would hang the suite.
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.removeAllListeners("exit");
    child.on("exit", resolve);
    // A server that ends between the check and the write leaves a closed pipe, which is not an error here: its exit is.
    child.stdin.on("error", () => {});
    child.stdin.end();
  });
}

function runProbe(binary, server) {
  const {ports, files} = server.info;
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/websocket-probe.gd", "--",
    `--ports=${JSON.stringify(ports)}`, `--ca=${files.ca}`, `--other-ca=${files.untrustedCa}`,
    ...(allowOriginalNegative ? ["--allow-original-negative"] : []), ...(sabotage === null ? [] : ["--sabotage"])],
  {encoding: "utf8", timeout: 240000, maxBuffer: 64 * 1024 * 1024});
  return {result, log: (result.stdout ?? "") + (result.stderr ?? "")};
}

function oracleRejection(report, serverLog) {
  try {
    verifyWebSocketReport({...report, checks: report.checks.map(row => ({...row, passed: true}))}, serverLog);
  } catch (error) {
    return String(error.message).split("\n")[0];
  }
  return null;
}

function assertSameReproducer(control, report, bundle, name) {
  assert.deepEqual(control.checks.map(row => row.name), report.checks.map(row => row.name), name);
  assert.deepEqual(control.expectedOriginalFailures, report.expectedOriginalFailures, name);
  assert.equal(control.provenance.bundle.bundle.sha256, bundle.bundle.sha256, name + ": the same bundle runs on every host");
  // Only the compiled native producers differ between hosts; their bundle-time pins say nothing about them.
  for (const [file, sha] of Object.entries(bundle.sources)) {
    if (!websocketNativeProducers.includes(file)) {
      assert.equal(control.provenance.bundle.sources[file], sha, `${name} shares the reproducer and SDK producer: ${file}`);
    }
  }
  assert.notEqual(control.provenance.nativeHostSha256, report.provenance.nativeHostSha256, name);
}

// What the engine prints, as errors, for the failures the probe causes on purpose: each handshake it refuses (the cause
// and then its own summary) and each certificate it will not trust.
const handshakeErrors = [/^Invalid status code\. Got: '403', expected '101'\.$/, /^Invalid status code\. Got: '401', expected '101'\.$/,
  /^Missing or invalid header 'sec-websocket-accept'\. Expected value '[A-Za-z0-9+/=]{28}'\.$/, /^Received unrequested sub-protocol -> never-offered$/,
  /^Requested sub-protocol\(s\) but received none\.$/];
const handshakeSummary = "Invalid response headers.";
const tlsError = "TLS handshake error: -9984";

test("RN's own WebSocket runs over native sockets against a local server", async () => {
  const unit = spawnSync(path.join(root, ".deps/build/websocket_core_test"), [], {encoding: "utf8", timeout: 20000});
  if (sabotage === null && !allowOriginalNegative) {
    assert.equal(unit.error, undefined);
    assert.equal(unit.status, 0, unit.stdout + unit.stderr);
    assert.match(unit.stdout, /WEBSOCKET_CORE_PASSED/);
  }
  const bundle = await bundleWebSocketProbe();
  const binary = await ensureGodotBinary();
  await rm(path.join(root, "build/websocket-report.json"), {force: true});
  const server = await startServer();
  let probe, serverLog;
  try {
    probe = runProbe(binary, server);
    serverLog = await fetchLog(server.info.ports.ws);
  } finally {
    await stopServer(server);
  }
  const {result, log} = probe;
  await writeFile(path.join(root, `build/websocket-${lane}.log`), log);
  const report = await optionalJson("build/websocket-report.json");
  if (report != null) {
    report.provenance = {node: process.version, bundle, nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))),
      sourceReceiptDoesNotCertifyNativeBuild: true};
    report.server = {ports: server.info.ports, connections: serverLog.connections, holds: serverLog.holds};
    await writeFile(path.join(root, `build/websocket-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  // Artifacts are saved before assertions. A control flag never accepts unrelated failures or removes the
  // declared failures from the report.
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.equal(report.scenario, "websocket");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.equal(new Set(report.expectedOriginalFailures).size, report.expectedOriginalFailures.length);
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  // Every ERROR line is a failed check, or one the engine prints for a failure the probe causes on purpose: a handshake it
  // refuses or a certificate it will not trust. No native, script or engine error hides.
  const engineErrors = [...log.matchAll(/^ERROR: (?!FABRIC_CHECK_FAILED: )(.+)$/gm)].map(match => match[1]);
  const expectedHandshakes = allowOriginalNegative ? 0 : report.stages.deliberateEngineErrors.handshake;
  const expectedTls = allowOriginalNegative ? 0 : report.stages.deliberateTlsFailures;
  const causes = engineErrors.filter(text => handshakeErrors.some(pattern => pattern.test(text)));
  assert.equal(causes.length, expectedHandshakes, "The engine refused exactly the handshakes the probe offered it to refuse");
  assert.equal(engineErrors.filter(text => text === handshakeSummary).length, expectedHandshakes, "Each refused handshake is summarized once");
  assert.equal(engineErrors.filter(text => text === tlsError).length, expectedTls, "The engine refused exactly the certificates the probe offered it to refuse");
  assert.equal(engineErrors.length, expectedHandshakes * 2 + expectedTls, "No native diagnostic, script or engine error is hidden");
  for (const file of ["tests/websocket-fixture.jsx", "tests/websocket-probe.gd", "tests/websocket-native.test.mjs", "tests/websocket-oracle.mjs",
    "tests/websocket-server.mjs", "tests/networking-certificates.mjs", "scripts/websocket-bundle.mjs", "src/initialize.js", "src/platform-environment.js",
    "sdk/toolchain/platform-plugin.mjs", ...websocketNativeProducers]) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  for (const file of ["Libraries/Core/setUpXHR.js", "Libraries/WebSocket/WebSocket.js", "Libraries/Blob/BlobManager.js", "Libraries/EventEmitter/NativeEventEmitter.js",
    "ReactAndroid/src/main/java/com/facebook/react/modules/websocket/WebSocketModule.kt", "ReactAndroid/src/main/java/com/facebook/react/modules/blob/BlobModule.kt",
    "React/CoreModules/RCTWebSocketModule.mm"]) {
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  }
  // The checks that need the native module are normative; the rest hold on both hosts.
  assert.ok(report.expectedOriginalFailures.length > 0 && report.expectedOriginalFailures.length < report.checks.length);
  if (allowOriginalNegative) {
    assert.equal(result.status, 0, log);
    assert.ok(report.originalNegativeObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedOriginalFailures), "Only the WebSocket checks qualify as the old-host control");
    assert.match(log, new RegExp(`WEBSOCKET_ORIGINAL_NEGATIVE: ${failures.length}`));
    // Without the module the first WebSocket fails where RN looks it up, and no connection reaches the server.
    assert.equal(report.stages.modules.WebSocketModule, false);
    assert.match(report.stages.constructs.message, /'WebSocketModule' could not be found/);
    assert.deepEqual(serverLog.connections, [], "The preceding host reaches no server");
    assert.ok(oracleRejection(report, serverLog) != null, "The oracle rejects the preceding host");
    return;
  }
  assert.equal(report.originalNegativeObserved, false);
  if (sabotage !== null) {
    assert.equal(result.status, 0, log);
    assert.ok(failures.length > 0);
    assert.match(log, new RegExp(`WEBSOCKET_SABOTAGE_REJECTED: ${failures.length}`));
    assert.ok(oracleRejection(report, serverLog) != null, "The oracle rejects the sabotaged report");
    return;
  }
  assert.equal(result.status, 0, log);
  assert.deepEqual(failures, []);
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.match(log, /WEBSOCKET_PASSED: \d+/);
  const verified = verifyWebSocketReport(report, serverLog);
  const original = await optionalJson("build/websocket-original-report.json");
  if (original != null) {
    assert.ok(original.originalNegativeObserved);
    assertSameReproducer(original, report, bundle, "preceding host");
  }
  const sabotages = {};
  for (const name of ["origin", "stop"]) {
    const sabotaged = await optionalJson(`build/websocket-sabotage-${name}-report.json`);
    sabotages[name] = sabotaged == null ? null : {failures: sabotaged.checks.filter(row => !row.passed).map(row => row.name), rejection: oracleRejection(sabotaged, sabotaged.server)};
    if (sabotaged != null) {
      assert.ok(sabotages[name].failures.length > 0 && sabotages[name].rejection != null, `The ${name} sabotage is rejected by the probe and the oracle`);
      assertSameReproducer(sabotaged, report, bundle, `host with the ${name} sabotage`);
    }
  }
  await writeFile(path.join(root, "build/websocket-comparison.json"), JSON.stringify({scenario: report.scenario,
    originalControlPresent: original != null, intentionalNativeProducerDifferences: websocketNativeProducers,
    originalFailures: original?.checks.filter(row => !row.passed).map(row => row.name) ?? null, sabotages, oracle: verified,
    current: {checks: report.checks.length, nativeHostSha256: report.provenance.nativeHostSha256, bundleSha256: bundle.bundle.sha256}},
  null, 2) + "\n");
});
