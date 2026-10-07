import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {startWebSocketServer} from "./websocket-server.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

function runGodot(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {stdio: ["ignore", "pipe", "pipe"]});
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
    child.once("error", error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (status, signal) => {
      clearTimeout(timeout);
      clearTimeout(forceKill);
      resolve({status, signal, timedOut, stdout, stderr});
    });
  });
}

test("Godot TLS streams expose WebSocket close frames before close_notify", async t => {
  const server = await startWebSocketServer(path.join(root, "build"));
  try {
    const binary = await ensureGodotBinary();
    const result = await runGodot(binary, ["--path", root, "--headless", "--script", "res://tests/websocket-stream-spike.gd", "--",
      `--port=${server.ports.wss}`, `--control-port=${server.ports.ws}`, `--ca=${server.files.ca}`],
    );
    const log = result.stdout + result.stderr;
    assert.equal(result.timedOut, false, log);
    assert.equal(result.signal, null, log);
    assert.equal(result.status, 0, log);
    assert.doesNotMatch(log, /SCRIPT ERROR:|ERROR:/);
    const line = log.split("\n").find(value => value.startsWith("WEBSOCKET_STREAM_SPIKE: "));
    assert.ok(line, log);
    const report = JSON.parse(line.slice("WEBSOCKET_STREAM_SPIKE: ".length));
    assert.deepEqual(report.failures, []);
    assert.deepEqual(report.cases.echo.response, {kind: "close", code: 1000, reason: "client"});
    assert.deepEqual(report.cases.different.response, {kind: "close", code: 4002, reason: "peer selected"});
    assert.equal(report.cases.drop.response.kind, "error");
    assert.ok(report.cases.echo.serverConnection, "echo server connection was missing from control log");
    assert.ok(report.cases.different.serverConnection, "different-close server connection was missing from control log");
    assert.ok(report.cases.drop.serverConnection, "drop server connection was missing from control log");
    assert.equal(report.cases.echo.serverConnection.clientClose.code, 1000);
    assert.equal(report.cases.echo.serverConnection.serverClose.code, 1000);
    assert.equal(report.cases.different.serverConnection.clientClose.code, 3000);
    assert.equal(report.cases.different.serverConnection.serverClose.code, 4002);
    assert.equal(report.cases.drop.serverConnection.clientClose.code, 3000);
    assert.equal(report.cases.drop.serverConnection.serverDropped, true);
    t.diagnostic(JSON.stringify({godot: report.godot, echo: report.cases.echo.response,
      serverEcho: report.cases.echo.serverConnection.frames.filter(frame => frame.opcode === "close").map(frame => `${frame.direction}:${frame.closeCode}`),
      different: report.cases.different.response,
      serverDifferent: report.cases.different.serverConnection.frames.filter(frame => frame.opcode === "close").map(frame => `${frame.direction}:${frame.closeCode}`),
      drop: report.cases.drop.response, serverDrop: report.cases.drop.serverConnection.serverDropped}));
  } finally {
    await server.close();
  }
});
