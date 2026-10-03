import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import { ensureGodotBinary } from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const expectedErrors = {
  viewport: "Embedded windows and viewport stretch require a complete React Native metrics adapter",
  nonuniform: "React Native window metrics require uniform positive Godot content scaling",
};

test("invalid live window metrics remain visible without starving React updates or teardown", async () => {
  const reportPath = join(root, "build", "metrics-errors-report.json");
  mkdirSync(join(root, "build"), { recursive: true });
  rmSync(reportPath, { force: true });
  const result = spawnSync(await ensureGodotBinary(), [
    "--path", root, "--headless", "--script", "res://tests/metrics_errors.gd",
  ], { encoding: "utf8", timeout: 25000, maxBuffer: 4 * 1024 * 1024 });
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(join(root, "build", "metrics-errors.log"), log);
  assert.equal(result.error, undefined, log);
  assert.equal(result.status, 0, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|FABRIC_CHECK_FAILED/);
  const errors = [...log.matchAll(/^ERROR: (.+)$/gm)].map(match => match[1]);
  const allowed = Object.values(expectedErrors).flatMap(message => [
    `FABRIC_ERROR: ${message}`, `FABRIC_ERROR: ${message}`,
  ]);
  assert.deepEqual(errors.sort(), allowed.sort(), "Unexpected, missing or repeated native diagnostic:\n" + log);
  assert.match(log, /METRICS_ERRORS_PASSED/);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.equal(report.scenario, "metrics-errors");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.engine, "hermes");
  assert.equal(report.renderer, "fabric");
  assert.ok(report.checks.length >= 58, "Incomplete metrics failure acceptance report");
  assert.ok(report.checks.every(check => check.passed), JSON.stringify(report.checks));
  assert.deepEqual(report.cases.map(({ mode, teardown }) => `${mode}/${teardown}`), [
    "viewport/unmount", "viewport/stop", "nonuniform/unmount", "nonuniform/stop",
  ]);
  assert.equal(new Set(report.cases.map(entry => entry.initial.runtimeId)).size, 4,
    "Every mode and teardown order must begin in a fresh application");
  for (const entry of report.cases) {
    if (entry.mode === "nonuniform") {
      const [x, y] = entry.injectedGeometry.transformScale;
      assert.ok(Number.isFinite(x) && Number.isFinite(y) && x > 0 && y > 0);
      assert.notEqual(x, y, "The nonuniform fixture must change the actual Godot content transform");
    }
    assert.deepEqual(entry.afterError.errors, [expectedErrors[entry.mode]]);
    assert.deepEqual(entry.afterStop.errors, [expectedErrors[entry.mode]]);
    assert.equal(entry.subscriptions, 0);
    assert.equal(entry.react.publicListeners, 0);
    assert.equal(entry.react.cleanups, 1);
    assert.equal(entry.afterStop.rootCount, 0);
    assert.equal(entry.afterStop.nativeModules.loaded, 0);
    assert.equal(entry.afterStop.nativeModules.stopped, true);
    for (const name of ["pendingTimers", "pendingAnimationFrames", "pendingWork"])
      assert.equal(entry.afterStop[name], 0, `${entry.mode}/${entry.teardown}: ${name}`);
  }
});
