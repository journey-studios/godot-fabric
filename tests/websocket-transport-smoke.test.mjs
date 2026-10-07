import assert from "node:assert/strict";
import {spawn, spawnSync} from "node:child_process";
import {readFile, rm} from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleWebSocketProbe} from "../scripts/websocket-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, "tests/websocket-server.mjs"), "--out", path.join(root, "build")],
      {stdio: ["pipe", "pipe", "inherit"]});
    let output = "";
    child.stdout.on("data", chunk => {
      output += chunk;
      if (output.includes("\n")) resolve({child, info: JSON.parse(output.split("\n")[0])});
    });
    child.once("error", reject);
    child.once("exit", code => reject(new Error("WebSocket fixture exited before reporting ports: " + code)));
  });
}

function readServerLog(port) {
  return new Promise((resolve, reject) => {
    http.get({host: "127.0.0.1", port, path: "/__control/log"}, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
    }).on("error", reject);
  });
}

function stopServer(child) {
  return new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", resolve);
    child.stdin.on("error", () => {});
    child.stdin.end();
  });
}

test("the wslay transport preserves TLS close frames and rejects a TLS drop", async () => {
  await bundleWebSocketProbe();
  const binary = await ensureGodotBinary();
  await rm(path.join(root, "build/websocket-report.json"), {force: true});
  const server = await startServer();
  let log, serverLog;
  try {
    log = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/websocket-probe.gd", "--",
      `--ports=${JSON.stringify(server.info.ports)}`, `--ca=${server.info.files.ca}`,
      `--other-ca=${server.info.files.untrustedCa}`, "--tls-close-smoke"],
    {encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024});
    serverLog = await readServerLog(server.info.ports.ws);
  } finally {
    await stopServer(server.child);
  }
  const output = (log.stdout ?? "") + (log.stderr ?? "");
  assert.equal(log.error, undefined, output);
  assert.equal(log.signal, null, output);
  assert.equal(log.status, 0, output);
  assert.doesNotMatch(output, /SCRIPT ERROR|^ERROR: (?!FABRIC_CHECK_FAILED: )/m);
  const report = JSON.parse(await readFile(path.join(root, "build/websocket-report.json"), "utf8"));
  assert.deepEqual(report.checks.filter(row => !row.passed), []);
  const sessions = report.stages.tlsCloseContract.result;
  assert.deepEqual(sessions.normal.events.map(event => event.type), ["open", "close"]);
  assert.deepEqual(sessions.different.events.map(event => event.type), ["open", "close"]);
  assert.deepEqual(sessions.dropped.events.map(event => event.type), ["open", "error", "close"]);
  assert.equal(sessions.normal.events.at(-1).code, 1000);
  assert.equal(sessions.normal.events.at(-1).reason, "");
  assert.equal(sessions.different.events.at(-1).code, 4002);
  assert.equal(sessions.different.events.at(-1).reason, "peer selected");
  assert.match(sessions.dropped.events.at(-1).reason, /ended without exposing a close frame/);
  assert.equal(sessions.dropped.events.at(-1).code, 1006);
  const connection = name => serverLog.connections.find(entry => new URL(entry.url, "ws://127.0.0.1").searchParams.get("case") === name);
  const close = (entry, direction) => entry.frames.find(frame => frame.direction === direction && frame.opcode === "close");
  const normalWire = connection("tls-close-normal");
  const differentWire = connection("tls-close-different");
  const droppedWire = connection("tls-close-drop");
  assert.deepEqual([close(normalWire, "in")?.closeCode, close(normalWire, "in")?.closeReason,
    close(normalWire, "out")?.closeCode, close(normalWire, "out")?.closeReason], [1000, "", 1000, ""]);
  assert.deepEqual([close(differentWire, "in")?.closeCode, close(differentWire, "in")?.closeReason,
    close(differentWire, "out")?.closeCode, close(differentWire, "out")?.closeReason], [1000, "client selected", 4002, "peer selected"]);
  assert.deepEqual([close(droppedWire, "in")?.closeCode, close(droppedWire, "in")?.closeReason, close(droppedWire, "out")], [1000, "client selected", undefined]);
  assert.equal(serverLog.connections.length, 3);
});
