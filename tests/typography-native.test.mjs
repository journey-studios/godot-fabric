import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ensureGodotBinary } from "../scripts/godot-binary.mjs";
const root = fileURLToPath(new URL("..", import.meta.url));
const binary = await ensureGodotBinary();
test("attachment que contorna a fachada falha explicitamente sem atravessar noexcept do Yoga", () => {
  const result = spawnSync(
    binary,
    [
      "--path",
      root,
      "--headless",
      "--script",
      "res://tests/typography_native_failure.gd",
    ],
    { encoding: "utf8", timeout: 10000, maxBuffer: 4 * 1024 * 1024 },
  );
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(path.join(root, "build/typography-native-failure.log"), log);
  assert.equal(result.error, undefined, log);
  assert.equal(result.status, 1, log);
  assert.match(log, /FABRIC_ERROR:.*Inline Controls/);
  assert.doesNotMatch(
    log,
    /SCRIPT ERROR|Program crashed|terminate called|FABRIC_VALIDATION_PASSED/,
  );
  const match = log.match(/TYPOGRAPHY_NATIVE_FAILURE: (.+)/);
  assert.ok(match, log);
  const report = JSON.parse(match[1]);
  assert.equal(report.reported, true);
  assert.equal(report.stopped, true);
  assert.equal(report.balanced, true);
});
