import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";
import { ensureGodotBinary } from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
test("real Godot/Hermes services preserve valid DTOs, reject accessors/lossy strings and invalidate generations", async () => {
  const reportPath = join(root, "build", "services-boundaries-report.json");
  mkdirSync(join(root, "build"), { recursive: true });
  rmSync(reportPath, { force: true });
  const result = spawnSync(await ensureGodotBinary(), ["--path", root, "--headless", "--script", "res://tests/services_boundaries.gd"], {
    encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024,
  });
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(join(root, "build", "services-boundaries.log"), log);
  assert.equal(result.error, undefined, log);
  assert.equal(result.status, 0, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|(?:^|\n)ERROR:|Program crashed|FABRIC_ERROR|FABRIC_CHECK_FAILED/);
  assert.match(log, /SERVICES_BOUNDARIES_PASSED/);
  // These terminal diagnostics are intentional lifecycle cases. All expected
  // negative DTO/queued-call cases are handled Promise rejections, not ERRORs.
  const diagnostics = [...log.matchAll(/^HERMES: GodotFabric Error: (E_[A-Z0-9_]+):/gm)].map(match => match[1]);
  assert.deepEqual(diagnostics, ["E_SERVICE_BINDING_REMOVED", "E_SERVICE_OWNER"], log);
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.equal(report.scenario, "service-boundaries");
  assert.equal(report.engine, "hermes");
  assert.equal(report.renderer, "fabric");
  assert.equal(report.displayServer, "headless");
  assert.ok(report.checks.length >= 48, "Native acceptance must include all data, failure and lifetime boundaries");
  assert.ok(report.checks.every(check => check.passed), JSON.stringify(report.checks));
  const rejected = {
    nodesFacade: "E_SERVICE_DTO_LIMIT", nodesNative: "E_SERVICE_DTO_LIMIT",
    depthFacade: "E_SERVICE_DTO_LIMIT", depthNative: "E_SERVICE_DTO_LIMIT",
    generation: "E_SERVICE_GENERATION", stopped: "E_SERVICE_STOPPED",
  };
  for (const kind of ["nul", "highSurrogate", "lowSurrogate"])
    for (const field of ["Value", "Key", "Name", "Origin", "KeyGetter"])
      for (const layer of ["Facade", "Native"])
        rejected[`${kind}${field}${layer}`] = "E_SERVICE_DTO_STRING";
  for (const kind of ["objectAccessor", "objectHidden", "objectHiddenExtra", "objectSymbol", "objectPrototype",
    "arrayHole", "arrayExtra", "arraySymbol", "arrayHidden", "arrayAccessor", "arrayPrototypeNull", "arrayPrototypeCustom",
    "outerArgsAccessor", "addressAccessor"])
    for (const layer of ["Facade", "Native"])
      rejected[`${kind}${layer}`] = "E_SERVICE_DTO";
  assert.deepEqual(report.javascript.rejected, rejected);
  assert.equal(report.javascript.getterCalls, 0);
  assert.deepEqual(report.javascript.diagnostics.map(entry => entry.code), diagnostics);
  for (const kind of ["unicode", "unicodeNative", "nullPrototypeFacade", "nullPrototypeNative"]) {
    assert.deepEqual(report.javascript.results[kind].keys, [[233, 128512]], kind);
    assert.deepEqual(report.javascript.results[kind].valueCodes, [231, 128640], kind);
    assert.equal(report.javascript.results[kind].response, "completion", kind);
  }
  assert.equal(report.javascript.results.arrayNative.length, 2);
  assert.equal(report.javascript.results.arrayNative.allNull, true);
  assert.equal(report.javascript.results.nodes.length, 9998);
  assert.equal(report.javascript.results.depth.depth, 31);
  for (const label of ["nodes", "depth"])
    assert.deepEqual(report.javascript.states[label].snapshots.map(entry => entry.revision), [0, 1]);
  assert.notEqual(report.javascript.states.oldGeneration.snapshots[0].generation,
    report.javascript.states.newGeneration.snapshots[0].generation);
  assert.deepEqual(report.javascript.burst.map(entry => entry.ordinal), Array.from({ length: 70 }, (_, index) => index));
  assert.ok(report.javascript.burst.every(entry => entry.value === 2));
  assert.deepEqual(report.javascript.clocks, { frame: 1, timer: 1 });
  assert.deepEqual(report.javascript.states.newGeneration.snapshots.slice(1).map(entry => [entry.revision, entry.value]),
    Array.from({ length: 140 }, (_, index) => [index + 1, index + 100]));
  assert.equal(report.afterStop.gameServices.hostTasksCanceled, 1);
  for (const key of ["bindings", "subscriptions", "pendingHostTasks", "pendingEvents"])
    assert.equal(report.afterStop.gameServices[key], 0, key);
  for (const key of ["pendingWork", "pendingTimers", "pendingAnimationFrames", "rootCount"])
    assert.equal(report.afterStop[key], 0, key);
  assert.equal(report.afterStop.nativeModules.loaded, 0);
  assert.deepEqual(report.afterStop.errors, []);
});
