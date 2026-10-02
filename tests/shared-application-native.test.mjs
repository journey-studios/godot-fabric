import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import { ensureGodotBinary } from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
test("registered roots share Hermes while preserving independent mount lifetimes", async () => {
  const reportPath = join(root, "build", "report.json");
  rmSync(reportPath, { force: true });
  const result = spawnSync(await ensureGodotBinary(), ["--path", root, "--headless", "res://examples/shared/scene.tscn", "--", "--validate"], {
    encoding: "utf8", timeout: 20000, maxBuffer: 4 * 1024 * 1024,
  });
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(new URL("../build/shared-application.log", import.meta.url), log);
  assert.equal(result.error, undefined, log);
  assert.equal(result.status, 0, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|(?:^|\n)ERROR:|Program crashed|FABRIC_ERROR/);
  assert.match(log, /FABRIC_VALIDATION_PASSED: shared/);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.ok(report.checks.length >= 20, "Incomplete root lifecycle report");
  assert.ok(report.checks.every(check => check.passed), JSON.stringify(report));
  assert.equal(report.engine, "hermes");
  assert.equal(report.renderer, "fabric");
});

test("failed root activation is visible, bounded and leaves no native authority", async () => {
  const reportPath = new URL("../build/shared-failures-report.json", import.meta.url);
  rmSync(reportPath, { force: true });
  const result = spawnSync(await ensureGodotBinary(), ["--path", root, "--headless", "--script", "res://tests/shared_application_failures.gd"], {
    encoding: "utf8", timeout: 20000, maxBuffer: 4 * 1024 * 1024,
  });
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(new URL("../build/shared-failures.log", import.meta.url), log);
  assert.equal(result.error, undefined, log);
  assert.equal(result.status, 0, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|FABRIC_CHECK_FAILED/);
  const allowed = new Set([
    "FABRIC_ERROR: application_path must point to FabricApplication",
    "FABRIC_ERROR: Unregistered AppRegistry component: MissingEntry",
    "FABRIC_ERROR: Unregistered AppRegistry component: toString",
    "FABRIC_ERROR: Application is stopped",
    "FABRIC_ERROR: Missing application bundle; run npm run bundle",
    "FABRIC_ERROR: FabricApplication must be inside the SceneTree",
  ]);
  const errors = [...log.matchAll(/^ERROR: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(new Set(errors), allowed, log);
  assert.equal(errors.length, allowed.size, "Unexpected or repeated native failure");
  assert.match(log, /SHARED_FAILURES_PASSED/);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.ok(report.checks.length >= 17, "Incomplete activation failure report");
  assert.ok(report.checks.every(check => check.passed), JSON.stringify(report));
});
