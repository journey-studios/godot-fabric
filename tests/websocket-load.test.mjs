import assert from "node:assert/strict";
import {spawn, spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {websocketNativeProducers, bundleWebSocketProbe} from "../scripts/websocket-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {startWebSocketServer} from "./websocket-server.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

function fetchLog(port) {
  return new Promise((resolve, reject) => {
    http.get({host: "127.0.0.1", port, path: "/__control/log"}, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
    }).on("error", reject);
  });
}

function runGodot(binary, ports, bytes) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["--path", root, "--headless", "--script", "res://tests/websocket-load-probe.gd", "--",
      `--ports=${JSON.stringify(ports)}`, `--bytes=${bytes}`], {stdio: ["ignore", "pipe", "pipe"]});
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let forceKill;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKill = setTimeout(() => child.kill("SIGKILL"), 2000);
    }, 90000);
    child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    child.once("error", error => { clearTimeout(timeout); clearTimeout(forceKill); reject(error); });
    child.once("close", (status, signal) => { clearTimeout(timeout); clearTimeout(forceKill); resolve({status, signal, timedOut, stdout, stderr}); });
  });
}

test("real WebSocket handlers and React work remain bounded and fair under a multi-socket flood", async () => {
  const cmake = path.join(root, ".deps/python/bin/cmake");
  const configure = spawnSync(cmake, ["-S", "native", "-B", ".deps/build", "-DFABRIC_BUILD_WEBSOCKET_TRANSPORT_TEST=ON"],
    {cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024});
  await writeFile(path.join(root, "build/websocket-load-cmake-configure.log"), configure.stdout + configure.stderr);
  assert.equal(configure.error, undefined, configure.stdout + configure.stderr);
  assert.equal(configure.status, 0, configure.stdout + configure.stderr);
  const build = spawnSync(cmake, ["--build", ".deps/build", "--target", "fabric_godot", "--parallel", "4"],
    {cwd: root, encoding: "utf8", timeout: 300000, maxBuffer: 16 * 1024 * 1024});
  await writeFile(path.join(root, "build/websocket-load-cmake-build.log"), build.stdout + build.stderr);
  assert.equal(build.error, undefined, build.stdout + build.stderr);
  assert.equal(build.status, 0, build.stdout + build.stderr);
  const bundle = await bundleWebSocketProbe();
  const binary = await ensureGodotBinary();
  const server = await startWebSocketServer(path.join(root, "build"));
  try {
    const phases = [];
    for (const [phaseIndex, bytes] of [8192, 512].entries()) {
      const result = await runGodot(binary, server.ports, bytes);
      const log = result.stdout + result.stderr;
      const serverLog = await fetchLog(server.ports.ws);
      const line = log.split("\n").find(value => value.startsWith("WEBSOCKET_LOAD: "));
      await writeFile(path.join(root, `build/websocket-load-${bytes}-run.log`), log);
      await writeFile(path.join(root, `build/websocket-load-${bytes}-server.json`), JSON.stringify(serverLog, null, 2) + "\n");
      const report = line === undefined ? null : JSON.parse(line.slice("WEBSOCKET_LOAD: ".length));
      phases.push({bytes, phaseIndex, result, log, serverLog, report});
    }
    const reports = phases.map(phase => phase.report);
    const report = {format: "godot-fabric.websocket-load/v1", phases: reports};
    const sources = [...new Set([...websocketNativeProducers, "native/application_runtime.cpp", "tests/websocket-fixture.jsx",
      "tests/websocket-server.mjs", "tests/websocket-load-probe.gd", "tests/websocket-load.test.mjs"])].sort();
    const hashes = Object.fromEntries(await Promise.all(sources.map(async file => [file,
      createHash("sha256").update(await readFile(path.join(root, file))).digest("hex")])));
    if (reports.every(phaseReport => phaseReport !== null)) {
      const hostHash = createHash("sha256").update(await readFile(path.join(root, "addons/fabric_godot.dylib"))).digest("hex");
      const evidencePhases = phases.map(phase => ({bytes: phase.bytes,
        godot: phase.report.godot,
        bundleSha256: bundle.bundle.sha256,
        nativeHostSha256: hostHash,
        report: phase.report, wire: phase.serverLog.connections.slice(phase.phaseIndex * 8, phase.phaseIndex * 8 + 8).map(connection => ({url: connection.url,
          state: connection.state, clientClose: connection.clientClose, serverClose: connection.serverClose,
          incomingFrames: connection.frames.filter(frame => frame.direction === "in").length,
          outgoingFrames: connection.frames.filter(frame => frame.direction === "out").length})), sources: hashes}));
      await writeFile(path.join(root, "build/websocket-load.json"), JSON.stringify({format: report.format, phases: evidencePhases}, null, 2) + "\n");
    }
    for (const phase of phases) {
      const {bytes, result, log, serverLog, report: phaseReport} = phase;
      assert.equal(result.timedOut, false, log);
      assert.equal(result.signal, null, log);
      assert.equal(result.status, 0, log);
      assert.doesNotMatch(log, /SCRIPT ERROR|ERROR:|Program crashed/);
      assert.ok(phaseReport !== null, log);
      assert.deepEqual(phaseReport.failures, []);
      assert.equal(phaseReport.runtime.pendingWork, 0, "all admitted runtime work drained after the flood");
      assert.ok(phaseReport.runtime.networking.events.peakPending <= 256, "the canonical networking event queue stayed within capacity");
      assert.equal(phaseReport.runtime.networking.events.pending, 0, "all networking events drained after the flood");
      assert.ok(phaseReport.transport.maxBytesPerPoll <= 1048576, "one shared poll never exceeded its one-megabyte wire budget");
      assert.ok(phaseReport.transport.maxMessagesPerPoll <= 256, "one shared poll never exceeded its 256-message admission budget");
      assert.ok(phaseReport.transport.maxEventsAdmittedPerPoll <= 256, "one shared poll never exceeded its 256-event admission budget");
      if (bytes === 8192) assert.ok(phaseReport.transport.maxBytesPerPoll >= 900000, "large frames exercised the shared byte budget");
      else {
        assert.ok(phaseReport.transport.maxEventsAdmittedPerPoll >= 200, "small frames saturated the shared event admission budget");
        assert.ok(phaseReport.runtime.networking.events.peakPending >= 200, "the canonical event queue reached the admitted burst");
      }
      assert.ok(phaseReport.fairnessSpan <= 12, "all eight sockets made progress within twelve sampled frames");
      assert.ok(phaseReport.case.timerTicks >= 4 && phaseReport.case.renders >= 2 && phaseReport.case.setStateCalls === 1024,
        "real WebSocket handlers, React state updates and timer callbacks ran during the flood");
      const phaseConnections = serverLog.connections.slice(phase.phaseIndex * 8, phase.phaseIndex * 8 + 8);
      for (let index = 0; index < 8; index += 1) {
        const connection = phaseConnections.find(entry => entry.url.includes(`case=load-${index}`));
        assert.ok(connection, `socket ${index} is present in the server wire log`);
        assert.equal(connection.frames.filter(frame => frame.direction === "out" && frame.opcode === "text").length, 128,
          `socket ${index} received all 128 server messages`);
        assert.equal(connection.clientClose?.code, 1000, `socket ${index} closed after its last message`);
        assert.equal(connection.serverClose?.code, 1000, `socket ${index} received the server's close response`);
        assert.equal(connection.state, "closed", `socket ${index} completed its peer close exchange`);
      }
      assert.ok(phaseReport.transport.bytesPolled >= 8 * 128 * bytes, "the transport read the complete aggregate flood");
    }
  } finally {
    await server.close();
  }
});
