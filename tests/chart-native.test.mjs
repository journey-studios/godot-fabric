import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ensureGodotBinary } from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const binary = await ensureGodotBinary();
test("Unmodified chart rotated labels fail the native CLI with an explicit unsupported contract", () => {
  const result = spawnSync(
    binary,
    [
      "--path",
      root,
      "--headless",
      "--script",
      "res://tests/chart_unsupported_validation.gd",
    ],
    {
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(path.join(root, "build/chart-unsupported.log"), log);
  assert.equal(result.error, undefined, log);
  assert.equal(result.status, 1, log);
  assert.match(log, /FABRIC_ERROR:.*Unsupported Godot SVG g prop: transform/);
  assert.match(log, /CHART_UNSUPPORTED_RESULT:.*transform/);
  assert.doesNotMatch(
    log,
    /SCRIPT ERROR|Program crashed|FABRIC_VALIDATION_PASSED/,
  );
});

test("A native SVG refresh failure finalizes Fabric mounting and keeps later SVGs live", () => {
  const result = spawnSync(
    binary,
    [
      "--path",
      root,
      "--headless",
      "--script",
      "res://tests/svg_mount_recovery.gd",
    ],
    {
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(path.join(root, "build/svg-mount-recovery.log"), log);
  const match = log.match(/SVG_MOUNT_RECOVERY_RESULT: (.+)/);
  assert.ok(match, log);
  const report = JSON.parse(match[1]);
  writeFileSync(
    path.join(root, "build/svg-mount-recovery-report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  assert.equal(result.error, undefined, log);
  assert.equal(result.status, 0, JSON.stringify(report.checks));
  assert.ok(report.checks.every((check) => check.passed));
  assert.match(log, /FABRIC_ERROR:.*2048 pixel surface budget/);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed/);
});
