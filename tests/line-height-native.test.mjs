import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ensureGodotBinary } from "../scripts/godot-binary.mjs";

test("mixed line heights respect half-open run ranges and terminal sentinels", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const result = spawnSync(await ensureGodotBinary(), [
    "--path", root, "--headless", "res://tests/line_height.tscn",
  ], { encoding: "utf8", timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(new URL("../build/line-height.log", import.meta.url), log);
  assert.equal(result.error, undefined, log);
  assert.equal(result.status, 0, log);
  assert.match(log, /FABRIC_LINE_HEIGHT_PASSED/);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|FABRIC_ERROR|FABRIC_CHECK_FAILED/);
});
