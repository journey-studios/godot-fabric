import assert from "node:assert/strict";
import {spawn, spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {copyFile, mkdir, readFile, writeFile} from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {websocketNativeProducers} from "../scripts/websocket-bundle.mjs";
import {startWebSocketServer} from "./websocket-server.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const project = path.join(root, "build/websocket-transport-test");

function runGodot(binary, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["--path", project, "--headless", "--script", "res://lifetime-probe.gd", "--", `--port=${port}`],
      {stdio: ["ignore", "pipe", "pipe"]});
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let forceKill;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKill = setTimeout(() => child.kill("SIGKILL"), 2000);
    }, 30000);
    child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    child.once("error", error => { clearTimeout(timeout); clearTimeout(forceKill); reject(error); });
    child.once("close", (status, signal) => { clearTimeout(timeout); clearTimeout(forceKill); resolve({status, signal, timedOut, stdout, stderr}); });
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

test("transport cancel and stop are safe inside open and message listeners", async () => {
  const cmake = path.join(root, ".deps/python/bin/cmake");
  const configure = spawnSync(cmake, ["-S", "native", "-B", ".deps/build", "-DFABRIC_BUILD_WEBSOCKET_TRANSPORT_TEST=ON"],
    {cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024});
  assert.equal(configure.error, undefined, configure.stdout + configure.stderr);
  assert.equal(configure.status, 0, configure.stdout + configure.stderr);
  const build = spawnSync(cmake, ["--build", ".deps/build", "--target", "websocket_transport_test", "--parallel", "4"],
    {cwd: root, encoding: "utf8", timeout: 300000, maxBuffer: 16 * 1024 * 1024});
  assert.equal(build.error, undefined, build.stdout + build.stderr);
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const server = await startWebSocketServer(path.join(root, "build"));
  try {
    await mkdir(project, {recursive: true});
    await copyFile(path.join(root, ".deps/build/websocket-transport-test/websocket_transport_test.dylib"),
      path.join(project, "websocket_transport_test.dylib"));
    await writeFile(path.join(project, "project.godot"), "config_version=5\n\n[application]\nconfig/name=\"WebSocket transport lifetime probe\"\n");
    await writeFile(path.join(project, "websocket_transport_test.gdextension"),
      "[configuration]\nentry_symbol=\"websocket_transport_test_library_init\"\ncompatibility_minimum=\"4.7.2\"\nreloadable=false\n\n[libraries]\nmacos.debug.arm64=\"res://websocket_transport_test.dylib\"\nmacos.release.arm64=\"res://websocket_transport_test.dylib\"\n");
    await copyFile(path.join(root, "tests/websocket-transport-lifetime-probe.gd"), path.join(project, "lifetime-probe.gd"));
    const binary = await ensureGodotBinary();
    const result = await runGodot(binary, server.ports.ws);
    const log = result.stdout + result.stderr;
    const serverLog = await fetchLog(server.ports.ws);
    const line = log.split("\n").find(value => value.startsWith("WEBSOCKET_TRANSPORT_LIFETIME: "));
    await writeFile(path.join(root, "build/websocket-transport-lifetime-run.log"), log);
    await writeFile(path.join(root, "build/websocket-transport-lifetime-server.json"), JSON.stringify(serverLog, null, 2) + "\n");
    const runReport = line === undefined ? null : JSON.parse(line.slice("WEBSOCKET_TRANSPORT_LIFETIME: ".length));
    const sources = [...new Set([...websocketNativeProducers, "native/CMakeLists.txt", "native/websocket_transport_test_fixture.cpp",
      "tests/websocket-transport-lifetime-probe.gd", "tests/websocket-transport-lifetime.test.mjs"])].sort();
    const hashes = Object.fromEntries(await Promise.all(sources.map(async file => [file,
      createHash("sha256").update(await readFile(path.join(root, file))).digest("hex")])));
    if (runReport !== null) {
      const evidence = {format: "godot-fabric.websocket-transport-lifetime/v1", godot: runReport.godot,
        results: runReport.results, wire: serverLog.connections.map(connection => ({url: connection.url, state: connection.state,
          tcp: connection.tcp, clientClose: connection.clientClose})),
        cancellationWireContract: "The drained /echo cases must deliver close 1001. /greeting cases cancel while server data is pending; report the observed close or TCP drop without treating a drop as a completed handshake.",
        loadedTestLibrarySha256: createHash("sha256").update(await readFile(path.join(project, "websocket_transport_test.dylib"))).digest("hex"),
        sources: hashes};
      await writeFile(path.join(root, "build/websocket-transport-lifetime.json"), JSON.stringify(evidence, null, 2) + "\n");
    }
    assert.equal(result.timedOut, false, log);
    assert.equal(result.signal, null, log);
    assert.equal(result.status, 0, log);
    assert.doesNotMatch(log, /SCRIPT ERROR|ERROR:|Program crashed/);
    assert.ok(line, log);
    assert.deepEqual(runReport.failures, []);
    const names = ["cancel-open", "stop-open", "cancel-message", "stop-message", "cancel-greeting-open", "stop-greeting-open",
      "cancel-greeting-message", "stop-greeting-message"];
    for (const name of names) {
      const connection = serverLog.connections.find(entry => entry.url.includes(`case=lifetime-${name}`));
      assert.ok(connection, `${name}: server connection missing`);
      assert.ok(["closed", "dropped-by-client"].includes(connection.state), `${name}: peer connection did not end`);
      if (!name.includes("greeting")) {
        assert.equal(connection.clientClose?.code, 1001, `${name}: the drained peer connection must receive the goodbye close`);
        assert.equal(connection.state, "closed", `${name}: server must complete the close exchange`);
      } else if (connection.clientClose === null) {
        assert.equal(connection.state, "dropped-by-client", `${name}: missing close is recorded as a peer drop`);
      } else {
        assert.equal(connection.clientClose.code, 1001, `${name}: any delivered close keeps its actual code`);
      }
      const result = runReport.results[name];
      assert.equal(result.opened, 1, `${name}: open callback count`);
      assert.equal(result.messages, name.endsWith("message") ? 1 : 0, `${name}: message callback stops after cancellation`);
      assert.equal(result.actions, 1, `${name}: exactly one reentrant action`);
      assert.equal(result.closed, 0, `${name}: no close callback after cancellation`);
      assert.equal(result.failed, 0, `${name}: no failure callback after cancellation`);
      assert.equal(result.active, 0, `${name}: no active connection remains`);
    }
  } finally {
    await server.close();
  }
});
