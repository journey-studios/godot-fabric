import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import { ensureGodotBinary } from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
mkdirSync(join(root, "build"), { recursive: true });
for (const [label, timeScale, artifact] of [
  ["registered roots share Hermes while preserving independent mount lifetimes", 1, "shared-application"],
  ["Hermes timers remain live when the Godot simulation clock is accelerated", 1000, "shared-clock"],
]) test(label, async () => {
  const reportPath = join(root, "build", "report.json");
  const artifactPath = join(root, "build", artifact + "-report.json");
  rmSync(reportPath, { force: true });
  rmSync(artifactPath, { force: true });
  const result = spawnSync(await ensureGodotBinary(), ["--path", root, "--headless", "--time-scale", String(timeScale), "res://examples/shared/scene.tscn", "--", "--validate"], {
    encoding: "utf8", timeout: 20000, maxBuffer: 4 * 1024 * 1024,
  });
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(join(root, "build", artifact + ".log"), log);
  assert.equal(result.error, undefined, log);
  assert.equal(result.status, 0, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|(?:^|\n)ERROR:|Program crashed|FABRIC_ERROR/);
  assert.match(log, /FABRIC_VALIDATION_PASSED: shared/);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.equal(report.checks.length, 35, "Incomplete root lifecycle report");
  assert.ok(report.checks.every(check => check.passed), JSON.stringify(report));
  assert.equal(report.engine, "hermes");
  assert.equal(report.renderer, "fabric");
  writeFileSync(artifactPath, JSON.stringify(report, null, 2) + "\n");
});

test("legacy scene replacement and surface reentry allocate fresh implicit owners", async () => {
  const reportPath = join(root, "build", "legacy-application-report.json");
  rmSync(reportPath, { force: true });
  const result = spawnSync(await ensureGodotBinary(), ["--path", root, "--headless", "--script", "res://tests/legacy_application.gd"], {
    encoding: "utf8", timeout: 20000, maxBuffer: 4 * 1024 * 1024,
  });
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(join(root, "build", "legacy-application.log"), log);
  assert.equal(result.error, undefined, log);
  assert.equal(result.status, 0, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|(?:^|\n)ERROR:|Program crashed|FABRIC_ERROR/);
  assert.match(log, /LEGACY_APPLICATION_PASSED/);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.equal(report.checks.length, 8);
  assert.ok(report.checks.every(check => check.passed), JSON.stringify(report));
});

test("failed root activation is visible, bounded and leaves no native authority", async () => {
  const reportPath = join(root, "build", "shared-failures-report.json");
  rmSync(reportPath, { force: true });
  const result = spawnSync(await ensureGodotBinary(), ["--path", root, "--headless", "--script", "res://tests/shared_application_failures.gd"], {
    encoding: "utf8", timeout: 20000, maxBuffer: 4 * 1024 * 1024,
  });
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(join(root, "build", "shared-failures.log"), log);
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
  assert.equal(report.checks.length, 19, "Incomplete activation failure report");
  assert.ok(report.checks.every(check => check.passed), JSON.stringify(report));
});
