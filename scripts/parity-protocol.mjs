import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

export const cases = JSON.parse(readFileSync(new URL("../tests/parity/cases.json", import.meta.url)));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
// The fixture directory itself, not only the three files the report names: every file under tests/parity (hidden
// files and node_modules left out) as `path<TAB>sha256` lines in path order, so a file added to or removed from the
// directory changes the hash of every platform's report.
export function fixtureTreeSha256(directory = fileURLToPath(new URL("../tests/parity/", import.meta.url))) {
  const lines = [];
  const walk = (current) => {
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        lines.push(`${path.relative(directory, full).split(path.sep).join("/")}\t${hash(readFileSync(full))}\n`);
      }
    }
  };
  walk(directory);
  return hash(lines.join(""));
}
export function provenance() {
  return {
    fixtureTreeSha256: fixtureTreeSha256(),
    fixtureSha256: hash(readFileSync(new URL("../tests/parity/fixture.jsx", import.meta.url))),
    runtimeSha256: hash(readFileSync(new URL("../tests/parity/runtime.js", import.meta.url))),
    casesSha256: hash(readFileSync(new URL("../tests/parity/cases.json", import.meta.url))),
    upstreamSha256: hash(readFileSync(new URL("../node_modules/react-native/types_generated/index.d.ts", import.meta.url))),
  };
}
// The Godot report must come from a disposable cold project (scripts/parity-godot.mjs): an empty resource cache but
// the startup list, a fresh HOME, and each launch made once, in order. A report made in the checkout has none of this.
function assertColdProject(cold) {
  assert.ok(cold, "The Godot report was not produced in a cold project");
  assert.equal(cold.disposable, true, "The Godot report was not produced in a disposable project");
  assert.equal(cold.userData, "fresh", "The Godot report did not start from fresh user data");
  assert.deepEqual(cold.resourceCacheBeforeImport, ["extension_list.cfg"], "The cold project did not start from an empty resource cache");
  assert.match(cold.treeSha256, /^[0-9a-f]{64}$/, "The cold project has no tree hash");
  assert.match(cold.bundleSha256, /^[0-9a-f]{64}$/, "The cold project has no bundle hash");
  assert.ok(Number.isInteger(cold.files) && cold.files > 0, "The cold project has no file count");
  assert.deepEqual(
    cold.launches?.map(({ step, attempts, status, signal }) => [step, attempts, status, signal]),
    [["parity-import", 1, 0, null], ["parity-guards", 1, 0, null], ["parity-run", 1, 0, null]],
    "The cold project did not launch import, guards and run once each, cleanly",
  );
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
  if (platform === "godot") {
    assertColdProject(report.coldProject);
  }
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
    godotColdProject: godot.coldProject,
    observations: godot.observations,
  };
}
