import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ensureGodotBinary } from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const binary = await ensureGodotBinary();
function run(args) {
  return spawnSync(binary, ["--path", root, "--headless", ...args], {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

test("native shutdown completes when the real Hermes unmount throws", () => {
  const result = run(["--script", "res://tests/recovery_validation.gd"]);
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  const match = log.match(/FABRIC_RECOVERY_RESULT: (.+)/);
  assert.ok(match, log);
  const report = JSON.parse(match[1]);
  assert.equal(result.error, undefined, log);
  assert.equal(result.status, 0, JSON.stringify(report.checks));
  assert.ok(report.checks.every((entry) => entry.passed));
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed/);
  assert.match(log, /FABRIC_ERROR:.*FABRIC_INJECTED_UNMOUNT_FAILURE/);
});

test("an unwritable report exits explicitly rather than timing out", () => {
  const report = path.join(root, "build/report.json");
  const backup = path.join(root, "build/report-recovery-backup.json");
  assert.ok(
    !existsSync(backup),
    "A previous recovery fixture needs inspection",
  );
  const hadReport = existsSync(report);
  if (hadReport) renameSync(report, backup);
  mkdirSync(report);
  try {
    const result = run(["--", "--validate"]);
    const log = (result.stdout ?? "") + (result.stderr ?? "");
    assert.equal(result.error, undefined, log);
    assert.equal(result.status, 1, log);
    assert.match(log, /FABRIC_ERROR: cannot write report.json/);
    assert.doesNotMatch(log, /SCRIPT ERROR|FABRIC_VALIDATION_PASSED/);
  } finally {
    rmSync(report, { recursive: true });
    if (hadReport) renameSync(backup, report);
  }
});
