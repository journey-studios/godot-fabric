import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cases, compareReports, fixtureTreeSha256, provenance } from "../scripts/parity-protocol.mjs";

const launches = [["parity-import"], ["parity-guards"], ["parity-run"]].map(([step]) => ({ step, attempts: 1, status: 0, signal: null }));
const coldProject = { disposable: true, userData: "fresh", resourceCacheBeforeImport: ["extension_list.cfg"], files: 242, treeSha256: "a".repeat(64), bundleSha256: "b".repeat(64), launches };
const report = (platform) => ({ schemaVersion: 1, fixture: "core-ui-v2", platform, status: "passed", reactNative: "0.87.1", react: "19.2.3", renderer: "fabric", engine: "hermes", ...provenance(), ...(platform === "godot" ? { coldProject } : {}), checks: cases.map(({ id }) => ({ id, passed: true })), observations: { box: { x: 8, y: 8, width: 120, height: 40 }, rows: { A: 64, B: 0 }, counts: [0, 2, 3], renders: { A: 1, B: 1 }, mounts: ["A", "B"], cleanups: ["B", "A"], context: "updated", store: 7, subscribers: 0, runtime: { timeoutArgs: ["token", 42], objectIdentity: true, coercions: 1, cancelled: false, intervalTicks: 3, intervalArgs: [["tick", 2], ["tick", 2], ["tick", 2]], trace: ["sync", "promise", "microtask", "immediate", "nested", "timer"], frameCount: 2, monotonic: true, cancelledFrame: false } } });
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
    { fixtureTreeSha256: "stale" }, { fixtureSha256: "stale" }, { runtimeSha256: "stale" }, { upstreamSha256: "stale" }, { casesSha256: "stale" },
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
test("the Godot report must come from a disposable cold project that launched each step once", () => {
  const godot = report("godot");
  const references = [report("ios"), report("android")];
  assert.deepEqual(compareReports(godot, references).godotColdProject, coldProject);
  const withoutCold = { ...godot };
  delete withoutCold.coldProject;
  const mutations = {
    "a run in the checkout (no cold project)": withoutCold,
    "a project that was not disposable": { ...godot, coldProject: { ...coldProject, disposable: false } },
    "user data that was not fresh": { ...godot, coldProject: { ...coldProject, userData: "inherited" } },
    "a resource cache that was already warm": { ...godot, coldProject: { ...coldProject, resourceCacheBeforeImport: ["extension_list.cfg", "uid_cache.bin"] } },
    "a project with no tree hash": { ...godot, coldProject: { ...coldProject, treeSha256: "" } },
    "a project with no bundle hash": { ...godot, coldProject: { ...coldProject, bundleSha256: "stale" } },
    "a start that ran twice": { ...godot, coldProject: { ...coldProject, launches: [...launches, launches[2]] } },
    "a retried step": { ...godot, coldProject: { ...coldProject, launches: launches.map((launch, index) => (index === 2 ? { ...launch, attempts: 2 } : launch)) } },
    "a start that died by a signal": { ...godot, coldProject: { ...coldProject, launches: launches.map((launch, index) => (index === 0 ? { ...launch, status: null, signal: "SIGABRT" } : launch)) } },
    "a launch that was skipped": { ...godot, coldProject: { ...coldProject, launches: launches.slice(1) } },
  };
  for (const [name, mutated] of Object.entries(mutations)) {
    assert.throws(() => compareReports(mutated, references), undefined, name);
  }
});
test("the references need no cold project", () => {
  assert.doesNotThrow(() => compareReports(report("godot"), [report("ios")]));
});
test("the fixture directory hash follows the files of the directory, not editor leftovers", () => {
  const copy = mkdtempSync(path.join(tmpdir(), "fabric-parity-tree-"));
  try {
    cpSync(fileURLToPath(new URL("../tests/parity/", import.meta.url)), copy, { recursive: true });
    const original = fixtureTreeSha256(copy);
    assert.equal(original, provenance().fixtureTreeSha256);
    // Hidden files and installed packages are not part of the fixture.
    writeFileSync(path.join(copy, ".DS_Store"), "x");
    mkdirSync(path.join(copy, "reference/node_modules"), { recursive: true });
    writeFileSync(path.join(copy, "reference/node_modules/x.js"), "x");
    assert.equal(fixtureTreeSha256(copy), original);
    // A file added to the directory, one changed and one moved each change the hash.
    writeFileSync(path.join(copy, "helper.js"), "export {}\n");
    const added = fixtureTreeSha256(copy);
    assert.notEqual(added, original);
    writeFileSync(path.join(copy, "helper.js"), "export const x = 1\n");
    const changed = fixtureTreeSha256(copy);
    assert.notEqual(changed, added);
    rmSync(path.join(copy, "helper.js"));
    writeFileSync(path.join(copy, "reference/helper.js"), "export const x = 1\n");
    assert.notEqual(fixtureTreeSha256(copy), changed);
    rmSync(path.join(copy, "reference/helper.js"));
    rmSync(path.join(copy, "runtime.js"));
    assert.notEqual(fixtureTreeSha256(copy), original);
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});
