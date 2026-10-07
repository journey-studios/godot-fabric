import assert from "node:assert/strict";
import {spawn, spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleNetworkingProbe, networkingNativeProducers} from "../scripts/networking-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {verifyNetworkingReport} from "./networking-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// The preceding host has no networking modules: --allow-original-negative runs the same bundle on it, and
// every network check must fail there while the JavaScript ones hold. --sabotage[=name] runs it on a host
// whose transport was broken on purpose (scripts/networking-sabotage.mjs builds those hosts and restores the
// source): the probe and the oracle must both reject it.
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const sabotageArgument = process.argv.find(argument => argument === "--sabotage" || argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : (sabotageArgument.split("=")[1] ?? "redirects");
assert.ok([null, "redirects", "headers"].includes(sabotage), "Unknown sabotage: " + sabotage);
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

// The suite's local server is a child process: it reports its ports on stdout, records every request it
// receives, and ends when its stdin closes.
function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, "tests/networking-server.mjs"), "--out", path.join(root, "build")],
      {stdio: ["pipe", "pipe", "inherit"]});
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

function runProbe(binary, bundle, server) {
  const {ports, files} = server.info;
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/networking-probe.gd", "--",
    `--ports=${JSON.stringify(ports)}`, `--ca=${files.ca}`, `--other-ca=${files.untrustedCa}`,
    ...(allowOriginalNegative ? ["--allow-original-negative"] : []), ...(sabotage === null ? [] : ["--sabotage"])],
  {encoding: "utf8", timeout: 240000, maxBuffer: 64 * 1024 * 1024});
  return {result, log: (result.stdout ?? "") + (result.stderr ?? "")};
}

function oracleRejection(report, serverLog) {
  try {
    verifyNetworkingReport({...report, checks: report.checks.map(row => ({...row, passed: true}))}, serverLog);
  } catch (error) {
    return String(error.message).split("\n")[0];
  }
  return null;
}

function assertTruncatedBodyOracleMutations(report, serverLog) {
  const port = report.server.ports.http;
  const reasons = [
    `unexpected end of stream from 127.0.0.1:${port}`,
    `Connection to 127.0.0.1:${port} was lost while receiving the response`,
  ];
  for (const reason of reasons) {
    const candidate = structuredClone(report);
    candidate.stages.networkErrors.result.truncated.responseText = reason;
    assert.doesNotThrow(() => verifyNetworkingReport(candidate, serverLog), "the exact short-body error is accepted");
  }

  const load = structuredClone(report);
  load.stages.networkErrors.result.truncated.events[3].type = "load";
  assert.throws(() => verifyNetworkingReport(load, serverLog), /networking oracle: a body cut short is an error/, "a short body cannot finish with load");

  const missingError = structuredClone(report);
  missingError.stages.networkErrors.result.truncated.events = missingError.stages.networkErrors.result.truncated.events
    .filter(event => event.type !== "error");
  assert.throws(() => verifyNetworkingReport(missingError, serverLog), /networking oracle: a body cut short is an error/, "a short body must dispatch error");

  const deliveredBody = structuredClone(report);
  const xhr = deliveredBody.stages.networkErrors.result.truncated;
  xhr.responseText = "only ten b";
  xhr.events = [
    {type: "readystatechange", readyState: 1, status: 0},
    {type: "readystatechange", readyState: 2, status: 200},
    {type: "readystatechange", readyState: 3, status: 200},
    {type: "progress", readyState: 3, status: 200},
    {type: "readystatechange", readyState: 4, status: 200},
    {type: "load", readyState: 4, status: 200},
    {type: "loadend", readyState: 4, status: 200},
  ];
  assert.throws(() => verifyNetworkingReport(deliveredBody, serverLog), /networking oracle: a body cut short is an error/, "ten partial bytes cannot be delivered as a success");

  const wrongPort = structuredClone(report);
  wrongPort.stages.networkErrors.result.truncated.responseText = `unexpected end of stream from 127.0.0.1:${port + 1}`;
  assert.throws(() => verifyNetworkingReport(wrongPort, serverLog), /networking oracle: with its reason/, "the reported endpoint must be this server's port");

  const arbitraryReason = structuredClone(report);
  arbitraryReason.stages.networkErrors.result.truncated.responseText = `arbitrary failure from 127.0.0.1:${port}`;
  assert.throws(() => verifyNetworkingReport(arbitraryReason, serverLog), /networking oracle: with its reason/, "an unrelated message is not a short-body result");
}

function assertSameReproducer(control, report, bundle, name) {
  assert.deepEqual(control.checks.map(row => row.name), report.checks.map(row => row.name), name);
  assert.deepEqual(control.expectedOriginalFailures, report.expectedOriginalFailures, name);
  assert.equal(control.provenance.bundle.bundle.sha256, bundle.bundle.sha256, name + ": the same bundle runs on every host");
  // Only the compiled native producers differ between hosts; their bundle-time pins say nothing about them.
  for (const [file, sha] of Object.entries(bundle.sources)) {
    if (!networkingNativeProducers.includes(file)) {
      assert.equal(control.provenance.bundle.sources[file], sha, `${name} shares the reproducer and SDK producer: ${file}`);
    }
  }
  assert.notEqual(control.provenance.nativeHostSha256, report.provenance.nativeHostSha256, name);
}

test("RN's own fetch, XMLHttpRequest, FormData, Blob and AbortController run over native networking against a local server", async () => {
  const unit = spawnSync(path.join(root, ".deps/build/http_core_test"), [], {encoding: "utf8", timeout: 20000});
  if (sabotage === null && !allowOriginalNegative) {
    assert.equal(unit.error, undefined);
    assert.equal(unit.status, 0, unit.stdout + unit.stderr);
    assert.match(unit.stdout, /HTTP_CORE_PASSED/);
  }
  const bundle = await bundleNetworkingProbe();
  const binary = await ensureGodotBinary();
  await rm(path.join(root, "build/networking-report.json"), {force: true});
  const server = await startServer();
  let probe, serverLog;
  try {
    probe = runProbe(binary, bundle, server);
    serverLog = await fetchLog(server.info.ports.http);
  } finally {
    await stopServer(server);
  }
  const {result, log} = probe;
  await writeFile(path.join(root, `build/networking-${lane}.log`), log);
  const report = await optionalJson("build/networking-report.json");
  if (report != null) {
    report.provenance = {node: process.version, bundle, nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))),
      sourceReceiptDoesNotCertifyNativeBuild: true};
    report.server = {ports: server.info.ports, records: serverLog.records, holds: serverLog.holds};
    await writeFile(path.join(root, `build/networking-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  // Artifacts are saved before assertions. A control flag never accepts unrelated failures or removes the
  // declared failures from the report.
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.equal(report.scenario, "networking");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.equal(new Set(report.expectedOriginalFailures).size, report.expectedOriginalFailures.length);
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  // Every ERROR line is a failed check or one of the handshake errors the engine prints for each certificate the
  // negative TLS cases make it refuse: no native, script or engine error hides.
  const engineErrors = [...log.matchAll(/^ERROR: (?!FABRIC_CHECK_FAILED: )(.+)$/gm)].map(match => match[1]);
  const handshakeErrors = engineErrors.filter(text => text === "TLS handshake error: -9984");
  assert.deepEqual(engineErrors, handshakeErrors, "No native diagnostic, script or engine error is hidden");
  assert.equal(handshakeErrors.length, allowOriginalNegative ? 0 : report.stages.deliberateTlsFailures,
    "The engine refused exactly the certificates the probe offered it to refuse");
  for (const file of ["tests/networking-fixture.jsx", "tests/networking-probe.gd", "tests/networking-native.test.mjs", "tests/networking-oracle.mjs",
    "tests/networking-server.mjs", "tests/networking-certificates.mjs", "scripts/networking-bundle.mjs", "src/initialize.js", "src/platform-environment.js",
    "sdk/toolchain/platform-plugin.mjs", ...networkingNativeProducers]) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  for (const file of ["Libraries/Core/setUpXHR.js", "Libraries/Network/XMLHttpRequest.js", "Libraries/Network/RCTNetworking.android.js",
    "Libraries/Blob/BlobManager.js", "Libraries/Blob/FileReader.js", "ReactAndroid/src/main/java/com/facebook/react/modules/network/NetworkingModule.kt",
    "ReactAndroid/src/main/java/com/facebook/react/modules/blob/BlobModule.kt", "Libraries/Network/RCTNetworking.mm"]) {
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  }
  // The checks that need the native modules are normative; the rest hold on both hosts.
  assert.ok(report.expectedOriginalFailures.length > 0 && report.expectedOriginalFailures.length < report.checks.length);
  if (allowOriginalNegative) {
    assert.equal(result.status, 0, log);
    assert.ok(report.originalNegativeObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedOriginalFailures), "Only the networking checks qualify as the old-host control");
    assert.match(log, new RegExp(`NETWORKING_ORIGINAL_NEGATIVE: ${failures.length}`));
    // Without the modules the first use of each web API fails where RN looks the module up (the lazy global then
    // stays undefined, as RN leaves it), and no request reaches the server.
    const modules = report.stages.modules;
    assert.equal(modules.Networking, false);
    assert.match(report.stages.globals.result.XMLHttpRequest, /^throws: .*'Networking' could not be found/);
    assert.match(report.stages.globals.result.FileReader, /^throws: .*'FileReaderModule' could not be found/);
    assert.deepEqual(serverLog.records, [], "The preceding host reaches no server");
    assert.ok(oracleRejection(report, serverLog) != null, "The oracle rejects the preceding host");
    return;
  }
  assert.equal(report.originalNegativeObserved, false);
  if (sabotage !== null) {
    assert.equal(result.status, 0, log);
    assert.ok(failures.length > 0);
    assert.match(log, new RegExp(`NETWORKING_SABOTAGE_REJECTED: ${failures.length}`));
    assert.ok(oracleRejection(report, serverLog) != null, "The oracle rejects the sabotaged report");
    return;
  }
  assert.equal(result.status, 0, log);
  assert.deepEqual(failures, []);
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.match(log, /NETWORKING_PASSED: \d+/);
  const verified = verifyNetworkingReport(report, serverLog);
  assertTruncatedBodyOracleMutations(report, serverLog);
  const original = await optionalJson("build/networking-original-report.json");
  if (original != null) {
    assert.ok(original.originalNegativeObserved);
    assertSameReproducer(original, report, bundle, "preceding host");
  }
  const redirects = await optionalJson("build/networking-sabotage-redirects-report.json");
  const redirectsRejection = redirects == null ? null : oracleRejection(redirects, redirects.server);
  if (redirects != null) {
    assert.ok(redirects.checks.some(row => !row.passed) && redirectsRejection != null);
    assertSameReproducer(redirects, report, bundle, "host that does not follow redirects");
  }
  const headers = await optionalJson("build/networking-sabotage-headers-report.json");
  const headersRejection = headers == null ? null : oracleRejection(headers, headers.server);
  if (headers != null) {
    assert.ok(headers.checks.some(row => !row.passed) && headersRejection != null);
    assertSameReproducer(headers, report, bundle, "host that does not join repeated headers");
  }
  await writeFile(path.join(root, "build/networking-comparison.json"), JSON.stringify({scenario: report.scenario,
    originalControlPresent: original != null, sabotageRedirectsPresent: redirects != null, sabotageHeadersPresent: headers != null,
    intentionalNativeProducerDifferences: networkingNativeProducers,
    originalFailures: original?.checks.filter(row => !row.passed).map(row => row.name) ?? null,
    sabotageRedirectsFailures: redirects?.checks.filter(row => !row.passed).map(row => row.name) ?? null, sabotageRedirectsRejection: redirectsRejection,
    sabotageHeadersFailures: headers?.checks.filter(row => !row.passed).map(row => row.name) ?? null, sabotageHeadersRejection: headersRejection,
    oracle: verified,
    current: {checks: report.checks.length, nativeHostSha256: report.provenance.nativeHostSha256, bundleSha256: bundle.bundle.sha256}},
  null, 2) + "\n");
});
