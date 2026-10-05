import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ensureGodotBinary } from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
test("terminal pre-mount stop and synchronous game-owned application destruction release native authority", async () => {
  const reportPath = join(root, "build", "services-lifetime-report.json");
  mkdirSync(join(root, "build"), { recursive: true });
  rmSync(reportPath, { force: true });
  const result = spawnSync(await ensureGodotBinary(), ["--path", root, "--headless", "--script", "res://tests/services_lifetime.gd"], {
    encoding: "utf8", timeout: 15000, maxBuffer: 4 * 1024 * 1024,
  });
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(join(root, "build", "services-lifetime.log"), log);
  assert.equal(result.error, undefined, log);
  assert.equal(result.status, 0, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|FABRIC_CHECK_FAILED|LIFETIME_UNEXPECTED_SUCCESS/);
  assert.deepEqual([...log.matchAll(/(?:^|\n)ERROR: (.*)/g)].map(match => match[1]),
    ["FABRIC_ERROR: E_RUNTIME_STOPPED: Application cannot mount after stop"], log);
  assert.match(log, /HERMES: LIFETIME_CANCELLED E_SERVICE_STOPPED/);
  assert.match(log, /SERVICES_LIFETIME_PASSED/);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.equal(report.scenario, "service-lifetime");
  assert.equal(report.engine, "hermes");
  assert.equal(report.renderer, "fabric");
  assert.equal(report.checks.length, 15);
  assert.ok(report.checks.every(check => check.passed), JSON.stringify(report));
  assert.equal(report.observations.stopBeforeMount.runtimeInitialized, false);
  assert.equal(report.observations.stopBeforeMount.bundleEvaluations, 0);
  assert.equal(report.observations.afterFree.gameServices.hostTasksCanceled, 1);
  assert.equal(report.observations.afterFree.hostPhasePending, false);
});
