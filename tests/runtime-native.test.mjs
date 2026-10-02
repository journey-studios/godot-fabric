import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ensureGodotBinary } from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const binary = await ensureGodotBinary();
test("the native deadline registry bounds dispatch and cannot resurrect cancelled timers", () => {
  const result = spawnSync(fileURLToPath(new URL("../.deps/build/timer_registry_test", import.meta.url)), [], { encoding: "utf8", timeout: 5000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /TIMER_REGISTRY_PASSED/);
});
test("real Hermes reports timer, microtask and frame errors while releasing failed callbacks", () => {
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/runtime_errors.gd"], {
    encoding: "utf8", timeout: 10000, maxBuffer: 4 * 1024 * 1024,
  });
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(new URL("../build/runtime-errors.log", import.meta.url), log);
  assert.equal(result.error, undefined, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed/);
  const match = log.match(/RUNTIME_ERRORS_RESULT: (.+)/);
  assert.ok(match, log);
  const report = JSON.parse(match[1]);
  writeFileSync(new URL("../build/runtime-errors-report.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
  assert.equal(result.status, 0, JSON.stringify(report));
  assert.equal(report.checks.length, 6);
  assert.ok(report.checks.every(check => check.passed), JSON.stringify(report));
  for (const kind of ["TIMEOUT", "MICROTASK", "FRAME"])
    assert.equal(report.errors.filter(error => error.includes(`EXPECTED_RUNTIME_${kind}`)).length, 1);
  assert.equal(report.errors.filter(error => error.includes("EXPECTED_RUNTIME_INTERVAL")).length, 2);
  assert.equal((log.match(/ERROR: FABRIC_ERROR:/g) || []).length, 5, log);
});
