import test from "node:test";
import assert from "node:assert/strict";
import { cases, compareReports, provenance } from "../scripts/parity-protocol.mjs";

const report = (platform) => ({ schemaVersion: 1, fixture: "core-ui-v1", platform, status: "passed", reactNative: "0.87.1", react: "19.2.3", renderer: "fabric", engine: "hermes", ...provenance(), checks: cases.map(({ id }) => ({ id, passed: true })) });
test("a complete comparison requires two original references and only certifies a subset", () => {
  const result = compareReports(report("godot"), [report("ios"), report("android")]);
  assert.equal(result.completeMobileReferences, true);
  assert.equal(result.status, "matched_subset");
  assert.equal(compareReports(report("godot"), [report("ios")]).completeMobileReferences, false);
  assert.equal(result.caseCount, 9);
});
test("missing, stale, failed, duplicated and non-native references are rejected", () => {
  const candidate = report("godot");
  assert.throws(() => compareReports(candidate, []), /original native reference/);
  for (const changed of [
    { fixtureSha256: "stale" }, { upstreamSha256: "stale" }, { casesSha256: "stale" },
    { status: "failed" }, { renderer: "mock" }, { engine: "javascriptcore" },
    { checks: candidate.checks.slice(1) },
    { checks: [...candidate.checks.slice(1), candidate.checks[1]] },
    { checks: candidate.checks.map((check, index) => ({ ...check, passed: index !== 0 })) },
  ]) assert.throws(() => compareReports(candidate, [{ ...report("ios"), ...changed }]));
  assert.throws(() => compareReports(candidate, [report("ios"), report("ios")]), /Duplicate/);
  assert.throws(() => compareReports(candidate, [report("web")]), /iOS or Android/);
});
