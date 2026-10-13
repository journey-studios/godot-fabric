import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function verifyRaw(repo, campaignDir, auditFile, protocolFile) {
  assert.ok(repo && campaignDir && auditFile, "Use <repo> <campaign-dir> <audit-file>");
  const moduleAt = (name) => import(pathToFileURL(path.join(repo, "scripts", name)));
  const { analyse, executionOf } = await moduleAt("frontier-comparison-run-campaign.mjs");
  const { CONFIGURATION_PROBLEMS } = await moduleAt("frontier-comparison-run-windows.mjs");
  const { processOf } = await moduleAt("frontier-comparison-run.mjs");
  const { assess, campaignFor, verdictOf } = await moduleAt("frontier-comparison-campaign-state.mjs");
  const protocolBytes = await readFile(protocolFile ?? path.join(repo, "docs/research/frontier-comparison-protocol.json"));
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
  const derivedAttempts = [];
  for (const attempt of state.attempts) {
    const key = `${attempt.lane}-${attempt.slot}-${attempt.attempt}`;
    assert.equal(attempt.log, `raw/${key}.log`, "the log path must match its lane, slot and attempt");
    if (attempt.raw !== null) {
      assert.equal(attempt.raw, `raw/${key}.json`, "the raw path must match its lane, slot and attempt");
    }
    const log = await readFile(path.join(campaignDir, attempt.log), "utf8");
    assert.equal(sha256(log), attempt.logSha256);
    const ended = processOf({ status: attempt.exitCode, signal: attempt.signal }, log);
    assert.equal(ended.crashed, attempt.crashed);
    if (attempt.raw === null) {
      assert.equal(attempt.execution, null, "an attempt without raw data cannot carry an execution");
      assert.deepEqual(attempt.configProblems, [], "an attempt without raw data cannot carry configuration problems");
      derivedAttempts.push({ ...attempt, execution: null });
      verified.push({ lane: attempt.lane, slot: attempt.slot, attempt: attempt.attempt, reported: false });
      continue;
    }
    const raw = JSON.parse(await readFile(path.join(campaignDir, attempt.raw)));
    const derived = analyse(raw, protocol);
    assert.deepEqual(derived.problems, attempt.problems);
    const configProblems = derived.problems.filter((problem) => CONFIGURATION_PROBLEMS.includes(problem.code));
    assert.deepEqual(attempt.configProblems, configProblems, "stored configuration problems differ from the raw-derived problems");
    assert.ok(derived.derived !== null);
    const execution = executionOf({
      report: raw, derived: derived.derived, protocol,
      slot: attempt.slot, attempt: attempt.attempt, build: "release",
      load: attempt.load, hashes: attempt.hashes, ended,
    });
    assert.deepEqual(execution, attempt.execution);
    assert.equal(attempt.assumedRefreshHz, null);
    derivedAttempts.push({ ...attempt, configProblems, execution });
    verified.push({
      lane: attempt.lane, slot: attempt.slot, arm: attempt.arm,
      attempt: attempt.attempt, reported: true, accepted: attempt.verdict.accepted,
      rawSha256: sha256(await readFile(path.join(campaignDir, attempt.raw))),
      logSha256: attempt.logSha256,
    });
  }

  // Judge the executions reconstructed from raw data, independently of the verdicts
  // retained in the operational state. This also judges attempts with no report.
  const validity = assess({ ...state, attempts: derivedAttempts }, protocol);
  for (const [index, attempt] of derivedAttempts.entries()) {
    const verdict = verdictOf(validity, attempt);
    assert.deepEqual(attempt.verdict, verdict, `${attempt.lane}/${attempt.slot}/${attempt.attempt}: stored verdict differs from the raw-derived verdict`);
    if (verified[index].reported) {
      verified[index].accepted = verdict.accepted;
    }
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
  return audit;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const audit = await verifyRaw(...process.argv.slice(2));
  console.log(`FRONTIER_RAW_VERIFIED: ${audit.rawDerivationsVerified} attempts, ${Object.keys(audit.files).length} raw/self-check files`);
}
