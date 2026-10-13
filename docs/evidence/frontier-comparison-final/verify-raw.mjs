import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repo = process.argv[2];
const campaignDir = process.argv[3];
const auditFile = process.argv[4];
assert.ok(repo && campaignDir && auditFile, "Use <repo> <campaign-dir> <audit-file>");
const moduleAt = (name) => import(pathToFileURL(path.join(repo, "scripts", name)));
const { analyse, executionOf } = await moduleAt("frontier-comparison-run-campaign.mjs");
const { processOf } = await moduleAt("frontier-comparison-run.mjs");
const { campaignFor } = await moduleAt("frontier-comparison-campaign-state.mjs");
const protocolBytes = await readFile(process.argv[5] ?? path.join(repo, "docs/research/frontier-comparison-protocol.json"));
const protocol = JSON.parse(protocolBytes);
const stateBytes = await readFile(path.join(campaignDir, "campaign-state.json"));
const state = JSON.parse(stateBytes);
const campaignBytes = await readFile(path.join(campaignDir, "campaign.json"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
assert.equal(state.protocolSha256, sha256(protocolBytes));
assert.equal(state.rehearsal, false);
assert.equal(state.launcher.build, "release");
assert.equal(state.selfCheck.passed, true);
assert.equal(state.selfCheck.lane, "windowed");
assert.equal(campaignBytes.toString(), `${JSON.stringify(campaignFor(state, protocol))}\n`);

const verified = [];
for (const attempt of state.attempts) {
  const log = await readFile(path.join(campaignDir, attempt.log), "utf8");
  assert.equal(sha256(log), attempt.logSha256);
  const ended = processOf({ status: attempt.exitCode, signal: attempt.signal }, log);
  assert.equal(ended.crashed, attempt.crashed);
  if (attempt.raw === null) {
    verified.push({ lane: attempt.lane, slot: attempt.slot, attempt: attempt.attempt, reported: false });
    continue;
  }
  const raw = JSON.parse(await readFile(path.join(campaignDir, attempt.raw)));
  const derived = analyse(raw, protocol);
  assert.deepEqual(derived.problems, attempt.problems);
  assert.ok(derived.derived !== null);
  const execution = executionOf({
    report: raw, derived: derived.derived, protocol,
    slot: attempt.slot, attempt: attempt.attempt, build: "release",
    load: attempt.load, hashes: attempt.hashes, ended,
  });
  assert.deepEqual(execution, attempt.execution);
  assert.equal(attempt.assumedRefreshHz, null);
  verified.push({
    lane: attempt.lane, slot: attempt.slot, arm: attempt.arm,
    attempt: attempt.attempt, reported: true, accepted: attempt.verdict.accepted,
    rawSha256: sha256(await readFile(path.join(campaignDir, attempt.raw))),
    logSha256: attempt.logSha256,
  });
}

const files = {};
async function indexFiles(directory, relative = "") {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const key = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) {
      await indexFiles(path.join(directory, entry.name), key);
    } else if (entry.isFile()) {
      const bytes = await readFile(path.join(directory, entry.name));
      files[key] = { bytes: bytes.length, sha256: sha256(bytes) };
    } else {
      throw new Error(`Unexpected non-file: ${key}`);
    }
  }
}
await indexFiles(path.join(campaignDir, "raw"), "raw");
await indexFiles(path.join(campaignDir, "self-check"), "self-check");
const audit = {
  format: "godot-fabric.frontier-comparison-raw-verification/v1",
  protocolSha256: sha256(protocolBytes),
  stateSha256: sha256(stateBytes),
  campaignSha256: sha256(campaignBytes),
  rehearsal: state.rehearsal,
  build: state.launcher.build,
  selfCheckPassed: state.selfCheck.passed,
  rawDerivationsVerified: verified.length,
  reported: verified.filter((entry) => entry.reported).length,
  unreported: verified.filter((entry) => !entry.reported).length,
  attempts: verified,
  files,
};
await writeFile(auditFile, `${JSON.stringify(audit, null, 2)}\n`);
console.log(`FRONTIER_RAW_VERIFIED: ${verified.length} attempts, ${Object.keys(files).length} raw/self-check files`);
