import test from "node:test";
import assert from "node:assert/strict";
import { cases, compareReports, provenance } from "../scripts/parity-protocol.mjs";

const report = (platform) => ({ schemaVersion: 1, fixture: "core-ui-v2", platform, status: "passed", reactNative: "0.87.1", react: "19.2.3", renderer: "fabric", engine: "hermes", ...provenance(), checks: cases.map(({ id }) => ({ id, passed: true })), observations: { box: { x: 8, y: 8, width: 120, height: 40 }, rows: { A: 64, B: 0 }, counts: [0, 2, 3], renders: { A: 1, B: 1 }, mounts: ["A", "B"], cleanups: ["B", "A"], context: "updated", store: 7, subscribers: 0, runtime: { timeoutArgs: ["token", 42], objectIdentity: true, coercions: 1, cancelled: false, intervalTicks: 3, intervalArgs: [["tick", 2], ["tick", 2], ["tick", 2]], trace: ["sync", "promise", "microtask", "immediate", "nested", "timer"], frameCount: 2, monotonic: true, cancelledFrame: false } } });
test("a complete comparison requires two original references and only certifies a subset", () => {
  const result = compareReports(report("godot"), [report("ios"), report("android")]);
  assert.equal(result.completeMobileReferences, true);
  assert.equal(result.status, "matched_subset");
  assert.equal(compareReports(report("godot"), [report("ios")]).completeMobileReferences, false);
  assert.equal(result.caseCount, 13);
});
test("missing, stale, failed, duplicated and non-native references are rejected", () => {
  const candidate = report("godot");
  assert.throws(() => compareReports(candidate, []), /original native reference/);
  for (const changed of [
    { fixtureSha256: "stale" }, { runtimeSha256: "stale" }, { upstreamSha256: "stale" }, { casesSha256: "stale" },
    { status: "failed" }, { renderer: "mock" }, { engine: "javascriptcore" },
    { observations: { ...candidate.observations, rows: { A: 0, B: 64 } } },
    { observations: { ...candidate.observations, runtime: { ...candidate.observations.runtime, trace: ["timer", "microtask"] } } },
    { checks: candidate.checks.slice(1) },
    { checks: [...candidate.checks.slice(1), candidate.checks[1]] },
    { checks: candidate.checks.map((check, index) => ({ ...check, passed: index !== 0 })) },
  ]) assert.throws(() => compareReports(candidate, [{ ...report("ios"), ...changed }]));
  assert.throws(() => compareReports(candidate, [report("ios"), report("ios")]), /Duplicate/);
  assert.throws(() => compareReports(candidate, [report("web")]), /iOS or Android/);
});
