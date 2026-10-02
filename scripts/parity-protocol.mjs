import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

export const cases = JSON.parse(readFileSync(new URL("../tests/parity/cases.json", import.meta.url)));
export function provenance() {
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  return {
    fixtureSha256: hash(readFileSync(new URL("../tests/parity/fixture.jsx", import.meta.url))),
    runtimeSha256: hash(readFileSync(new URL("../tests/parity/runtime.js", import.meta.url))),
    casesSha256: hash(readFileSync(new URL("../tests/parity/cases.json", import.meta.url))),
    upstreamSha256: hash(readFileSync(new URL("../node_modules/react-native/types_generated/index.d.ts", import.meta.url))),
  };
}
export function assertReport(report, platform) {
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.fixture, "core-ui-v2");
  assert.equal(report.platform, platform);
  assert.equal(report.status, "passed");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.react, "19.2.3");
  assert.equal(report.renderer, "fabric");
  assert.equal(report.engine, "hermes");
  for (const [key, value] of Object.entries(provenance())) assert.equal(report[key], value, `Stale ${platform} report: ${key}`);
  assert.deepEqual(report.checks?.map((check) => check.id).sort(), cases.map((fixture) => fixture.id).sort(), "Missing, extra or duplicated cases");
  for (const check of report.checks) assert.equal(check.passed, true, `${platform}: ${check.id}`);
  assert.deepEqual(report.observations, {
    box: { x: 8, y: 8, width: 120, height: 40 }, rows: { A: 64, B: 0 }, counts: [0, 2, 3],
    renders: { A: 1, B: 1 }, mounts: ["A", "B"], cleanups: ["B", "A"], context: "updated", store: 7, subscribers: 0,
    runtime: { timeoutArgs: ["token", 42], objectIdentity: true, coercions: 1, cancelled: false,
      intervalTicks: 3, intervalArgs: [["tick", 2], ["tick", 2], ["tick", 2]],
      trace: ["sync", "promise", "microtask", "immediate", "nested", "timer"], frameCount: 2, monotonic: true, cancelledFrame: false },
  }, "Native geometry and lifecycle observations differ from the controlled fixture");
}
export function compareReports(godot, references) {
  assertReport(godot, "godot");
  assert.ok(references.length > 0, "An original native reference is required");
  const platforms = new Set();
  for (const reference of references) {
    assert.ok(["ios", "android"].includes(reference.platform), "Reference must be iOS or Android");
    assert.ok(!platforms.has(reference.platform), "Duplicate native platform reference");
    platforms.add(reference.platform);
    assertReport(reference, reference.platform);
  }
  return {
    schemaVersion: 1, status: "matched_subset", fixture: "core-ui-v2", ...provenance(),
    referencePlatforms: [...platforms].sort(), caseCount: cases.length,
    completeMobileReferences: platforms.has("ios") && platforms.has("android"),
    scope: "Only these fixture cases; not complete RN API, renderer semantics, event ordering or platform support",
    cases: cases.map((fixture) => ({ ...fixture, status: "matched_subset" })),
    observations: godot.observations,
  };
}
