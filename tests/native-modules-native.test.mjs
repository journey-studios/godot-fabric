import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import { ensureGodotBinary } from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const binary = await ensureGodotBinary();
test("public native-module imports preserve upstream JSI, events and per-runtime lifetime", () => {
  const reportPath = join(root, "build", "native-modules-report.json");
  rmSync(reportPath, { force: true });
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/native_modules.gd"], {
    encoding: "utf8", timeout: 15000, maxBuffer: 4 * 1024 * 1024,
  });
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(join(root, "build", "native-modules.log"), log);
  assert.equal(result.error, undefined, log);
  assert.equal(result.status, 0, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|(?:^|\n)ERROR:|Program crashed|FABRIC_ERROR/);
  assert.match(log, /NATIVE_MODULES_PASSED/);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.equal(report.engine, "hermes");
  assert.equal(report.renderer, "fabric");
  assert.ok(report.checks.length >= 76, "The native fixture must run its positive and negative contracts");
  assert.ok(report.checks.every(check => check.passed), JSON.stringify(report.checks));
  const { first, second } = report.afterStop;
  assert.notEqual(first.runtimeId, second.runtimeId);
  for (const status of [first, second]) {
    assert.equal(status.nativeModules.callableCalls, 2);
    assert.equal(status.nativeModules.loaded, 0);
    assert.equal(status.nativeModules.fixture.disposals, 1);
    assert.equal(status.pendingWork, 0);
    assert.deepEqual(status.errors, []);
  }
});
