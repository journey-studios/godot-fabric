import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { verifyRaw } from "../docs/evidence/frontier-comparison-final/verify-raw.mjs";
import { assess, campaignFor, initialState, verdictOf } from "../scripts/frontier-comparison-campaign-state.mjs";
import { analyse, executionOf } from "../scripts/frontier-comparison-run-campaign.mjs";
import { CONFIGURATION_PROBLEMS } from "../scripts/frontier-comparison-run-windows.mjs";
import { processOf } from "../scripts/frontier-comparison-run.mjs";
import { attempts, fakeLauncher, selfCheck, sha, where } from "./frontier-comparison-campaign-fake.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const protocolFile = path.join(repo, "docs/research/frontier-comparison-protocol.json");
const protocolBytes = await readFile(protocolFile);
const protocol = JSON.parse(protocolBytes);
const protocolSha256 = sha(protocolBytes);

// A small synthetic cohort, never a measured campaign: a valid execution, a
// load rejection and redo, and a process without a report followed by its redo.
async function fixture(t, { plan = {}, sequence = [[1, "A", 1], [2, "B", 1], [2, "B", 2], [3, "C", 1], [3, "C", 2]] } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "frontier-raw-verification-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "raw"));
  await mkdir(path.join(directory, "self-check"));
  const launcher = fakeLauncher({ protocol, windowed: true, plan: { "presented/2/1": attempts.highLoad, "presented/3/1": attempts.silent, ...plan } });
  const state = initialState({
    protocolSha256,
    options: { lanes: ["presented"], slots: null, rehearsal: false, maxWaitSeconds: 10, assumeRefreshHz: null },
    launcher: { ...(await launcher.prepare()), name: launcher.name, build: launcher.build },
    provenance: { ...where(), rawDataDirectory: "synthetic" },
    environment: { display: "synthetic window", renderer: "synthetic renderer", adapter: "Fake GPU" },
    now: "2026-10-13T00:00:00.000Z",
  });
  state.selfCheck = await selfCheck()({ windowed: true });
  for (const [slot, arm, attempt] of sequence) {
    const launched = await launcher.launch({ lane: "presented", slot, arm, attempt });
    const log = `raw/presented-${slot}-${attempt}.log`;
    await writeFile(path.join(directory, log), launched.log);
    const ended = processOf({ status: launched.exitCode, signal: launched.signal }, launched.log);
    const hashes = { ...launched.hashes, protocol: protocolSha256 };
    const record = {
      lane: "presented", slot, arm, attempt,
      raw: null, log, logSha256: sha(launched.log),
      exitCode: launched.exitCode, signal: launched.signal, crashed: ended.crashed, timedOut: false,
      load: launched.load, hashes, assumedRefreshHz: null,
      problems: [], configProblems: [], execution: null, verdict: { accepted: false, reasons: [] },
    };
    if (launched.report !== null) {
      record.raw = `raw/presented-${slot}-${attempt}.json`;
      await writeFile(path.join(directory, record.raw), JSON.stringify(launched.report));
      const derived = analyse(launched.report, protocol);
      record.problems = derived.problems;
      record.configProblems = derived.problems.filter((problem) => CONFIGURATION_PROBLEMS.includes(problem.code));
      record.execution = executionOf({ report: launched.report, derived: derived.derived, protocol, slot, attempt, build: "release", load: launched.load, hashes, ended });
    }
    state.attempts.push(record);
  }
  const validity = assess(state, protocol);
  for (const record of state.attempts) {
    record.verdict = verdictOf(validity, record);
  }
  const save = async () => {
    await writeFile(path.join(directory, "campaign-state.json"), JSON.stringify(state));
    await writeFile(path.join(directory, "campaign.json"), `${JSON.stringify(campaignFor(state, protocol))}\n`);
  };
  await save();
  const auditFile = path.join(directory, "audit.json");
  return { directory, state, save, auditFile, verify: () => verifyRaw(repo, directory, auditFile, protocolFile) };
}

test("the raw verifier is importable and preserves the v1 receipt for correct verdicts", async (t) => {
  const { verify, auditFile, state } = await fixture(t);
  const audit = await verify();
  assert.equal(audit.format, "godot-fabric.frontier-comparison-raw-verification/v1");
  assert.deepEqual([audit.rawDerivationsVerified, audit.reported, audit.unreported], [5, 4, 1]);
  assert.deepEqual(audit.attempts.map((entry) => [entry.slot, entry.attempt, entry.reported, entry.accepted]), [
    [1, 1, true, true], [2, 1, true, false], [2, 2, true, true], [3, 1, false, undefined], [3, 2, true, true],
  ]);
  assert.equal(Object.keys(audit.files).length, 9);
  assert.equal(await readFile(auditFile, "utf8"), `${JSON.stringify(audit, null, 2)}\n`);
  const originalBytes = await readFile(auditFile);
  await verify();
  assert.deepEqual(await readFile(auditFile), originalBytes, "the added verdict checks do not add or change receipt fields");
  assert.deepEqual(state.attempts[1].verdict.reasons, [{ rule: "load", clause: "before", value: 9.3, limit: protocol.runs.load.limit1MinuteAverage }]);
});

for (const [name, index, change] of [
  ["a rejected report marked accepted", 1, (record) => { record.verdict.accepted = true; }],
  ["an accepted report marked rejected", 0, (record) => { record.verdict.accepted = false; }],
  ["a load rejection with its reasons erased", 1, (record) => { record.verdict.reasons = []; }],
  ["an accepted report given a fabricated reason", 0, (record) => { record.verdict.reasons = [{ rule: "load", clause: "before", value: 99, limit: 6 }]; }],
  ["a process without a report marked accepted", 3, (record) => { record.verdict.accepted = true; }],
  ["a process without a report with its reasons erased", 3, (record) => { record.verdict.reasons = []; }],
]) {
  test(`the raw verifier rejects ${name} even when campaign.json is regenerated`, async (t) => {
    const { state, save, verify, auditFile } = await fixture(t);
    change(state.attempts[index]);
    await save();
    await assert.rejects(verify(), /stored verdict differs from the raw-derived verdict/);
    await assert.rejects(stat(auditFile), { code: "ENOENT" }, "a rejected verification publishes no receipt");
  });
}

test("the raw verifier rejects a changed execution even with a matching campaign.json", async (t) => {
  const { state, save, verify, auditFile } = await fixture(t);
  state.attempts[0].execution.seed += 1;
  await save();
  await assert.rejects(verify(), { code: "ERR_ASSERTION" });
  await assert.rejects(stat(auditFile), { code: "ENOENT" });
});

test("an unreported attempt cannot smuggle a stored execution into the validity input", async (t) => {
  const { state, save, verify } = await fixture(t);
  state.attempts[3].execution = structuredClone(state.attempts[4].execution);
  state.attempts[3].execution.attempt = 1;
  await save();
  await assert.rejects(verify(), /an attempt without raw data cannot carry an execution/);
});

test("erasing configuration problems cannot hide a raw-derived scenario stop", async (t) => {
  const { state, save, verify, auditFile } = await fixture(t, { plan: { "presented/1/1": attempts.otherWaits }, sequence: [[1, "A", 1]] });
  const record = state.attempts[0];
  assert.deepEqual(record.configProblems.map((problem) => problem.code), ["config-waits"]);
  await verify();
  await rm(auditFile);
  record.configProblems = [];
  await save();
  await assert.rejects(verify(), /stored configuration problems differ from the raw-derived problems/);
  await assert.rejects(stat(auditFile), { code: "ENOENT" });
});

for (const [field, index, alias] of [["raw", 0, "raw/alias.json"], ["log", 0, "raw/alias.log"], ["log", 3, "raw/unreported-alias.log"]]) {
  test(`the verifier rejects an aliased ${field} path for attempt ${index} even with identical bytes`, async (t) => {
    const { directory, state, save, verify, auditFile } = await fixture(t);
    const record = state.attempts[index];
    await writeFile(path.join(directory, alias), await readFile(path.join(directory, record[field])));
    record[field] = alias;
    await save();
    await assert.rejects(verify(), new RegExp(`the ${field} path must match its lane, slot and attempt`));
    await assert.rejects(stat(auditFile), { code: "ENOENT" });
  });
}
