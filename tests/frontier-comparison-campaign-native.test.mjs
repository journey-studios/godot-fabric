import assert from "node:assert/strict";
import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { root } from "../scripts/consumer-harness.mjs";
import { runCampaign } from "../scripts/frontier-comparison-campaign.mjs";
import { createDebugLauncher } from "../scripts/frontier-comparison-campaign-launchers.mjs";
import { engineOf } from "../scripts/frontier-comparison-campaign-state.mjs";
import { protocolErrors } from "../scripts/frontier-comparison-protocol.mjs";
import { sha256 } from "../scripts/frontier-comparison-run-campaign.mjs";
import { PROTOCOL_FILE } from "../scripts/frontier-comparison-run.mjs";

// The short rehearsal of the comparative campaign (V05-10, `execucao`, part 2), run for real and headless: `--slots 1-3` of the presented lane, which is one slot of each arm, through the Debug
// launcher (a provisioned copy of civ-lite and the engine's executable), with the real instrument self-check as the gate, the real load average and the real clock. It is a REHEARSAL: a
// Debug build, one attempt per slot and no redo, and no number of it is a measurement of an arm. What it proves is that the orchestrator drives the real launcher, that the self-check
// (the probe in the engine, then the oracle) passes and goes into the campaign with the hash of the instrument's file, that the state and the raw data of every attempt are written, that the
// campaign is strictly in the format and the analysis reads it, and that it rejects each attempt for the reasons a rehearsal must show: the Debug build, a headless display that draws and
// paces nothing, and the load of a machine that is not quiet (the repository's other lanes run on it). The run is left in build/frontier-comparison-campaign-rehearsal/.
//
// The headless display server has no refresh rate (it reads -1) and the format requires a positive one, so the rehearsal assumes 60 Hz for the format and says so in its deviations. It does not
// wait for a quiet machine (--max-wait 0): on a busy one the wait would only delay the rejection it is there to show.
const ARMS = ["A", "B", "C"];
const out = path.join(root, "build", "frontier-comparison-campaign-rehearsal");
const exists = (file) => stat(file).then(() => true, () => false);
const read = async (file) => JSON.parse(await readFile(path.join(out, file), "utf8"));

let rehearsal = null;

test("the rehearsal drives the real launcher through one slot of each arm, with the real self-check as the gate, and builds a campaign in the format", async () => {
  await rm(out, { recursive: true, force: true });
  const bytes = await readFile(PROTOCOL_FILE);
  const protocol = JSON.parse(bytes);
  assert.deepEqual(protocolErrors(protocol), []);
  rehearsal = await runCampaign({
    launcher: createDebugLauncher({ name: "frontier-comparison-campaign" }),
    protocol,
    protocolSha256: sha256(bytes),
    out,
    lanes: ["presented"],
    slots: [1, 3],
    rehearsal: true,
    assumeRefreshHz: 60,
    maxWaitSeconds: 0,
    log: (line) => console.log(line),
  });
  assert.equal(rehearsal.status, "done", JSON.stringify(rehearsal.state.stopped));
  assert.deepEqual(rehearsal.formatErrors, []);
  assert.ok(rehearsal.analysis !== null, rehearsal.analysisError);
  assert.deepEqual(rehearsal.state.stopped, []);
  assert.deepEqual(rehearsal.state.attempts.map((attempt) => [attempt.lane, attempt.slot, attempt.arm, attempt.attempt]), ARMS.map((arm, index) => ["presented", index + 1, arm, 1]));
  for (const attempt of rehearsal.state.attempts) {
    assert.equal(attempt.exitCode, 0, await readFile(path.join(out, attempt.log), "utf8"));
    assert.equal(attempt.aborted, "");
    assert.deepEqual(attempt.anomalies, []);
    assert.deepEqual(attempt.configProblems, []);
    assert.deepEqual(attempt.problems, []);
    assert.equal(attempt.execution.build, "debug");
    assert.ok(Object.values(attempt.hashes).every((hash) => /^[0-9a-f]{64}$/.test(hash)), JSON.stringify(attempt.hashes));
    assert.ok(Number.isFinite(attempt.load.before) && Number.isFinite(attempt.load.after), "the load before and after, as numbers");
    assert.ok(await exists(path.join(out, attempt.raw)) && (await exists(path.join(out, attempt.log))), "the raw report and the log of the attempt");
    assert.equal((await read(attempt.raw)).provenance.mainLoop, "FrontierComparisonEntry", `arm ${attempt.arm}: the scenario ran as the main loop of the measurement project, without -s`);
  }
});

test("the instrument's self-check ran in the campaign's engine, passed, and its file's hash is in the campaign", async () => {
  const { selfCheck } = rehearsal.state;
  assert.equal(selfCheck.passed, true, selfCheck.why.join("; "));
  assert.equal(selfCheck.lane, "headless");
  assert.deepEqual(selfCheck.oracle.violations, []);
  assert.equal(selfCheck.oracle.judged, true);
  assert.equal(selfCheck.probe.exitCode, 0);
  assert.deepEqual(selfCheck.probe.failed, []);
  assert.ok(selfCheck.probe.checks > 0);
  const instrument = sha256(await readFile(path.join(root, "tests", "cpu-time-instrument.gd")));
  assert.deepEqual(rehearsal.campaign.instrument, { selfCheckPassed: true, sha256: instrument });
  assert.equal(rehearsal.campaign.registered.instrumentSha256, instrument);
  assert.ok(await exists(path.join(out, "self-check", "probe-report.json")));
  // The engine, the display server, the driver, the rendering method and the adapter of the probe are the scenario's: the campaign did not stop on them.
  assert.deepEqual(rehearsal.state.scenarioEngine, engineOf(selfCheck.provenance));
  assert.equal(selfCheck.provenance.displayServer, "headless");
});

test("the analysis rejects every attempt of the rehearsal as a Debug build on a headless display, and nothing else of the registered values is wrong", async () => {
  const slots = rehearsal.analysis.sections.validity.slots.filter((slot) => slot.lane === "presented" && slot.attempts.length > 0);
  assert.deepEqual(slots.map((slot) => slot.arm), ARMS);
  for (const slot of slots) {
    const reasons = slot.attempts[0].reasons.map((reason) => `${reason.rule}:${reason.clause}`);
    assert.ok(reasons.includes("not-the-registered-build:build"), `arm ${slot.arm} is rejected as a Debug build`);
    assert.ok(reasons.includes("not-presented:intent-not-drawn"), `arm ${slot.arm}: a headless display draws nothing`);
    // The headless loop is not paced, and a machine that is not quiet is rejected for its load, which the rehearsal does not control; no other rule fires.
    assert.ok(reasons.every((reason) => /^(not-the-registered-build:build|not-presented:|load:)/.test(reason)), `arm ${slot.arm}: ${reasons}`);
    assert.equal(slot.state, "open", "a rehearsal does not redo");
  }
  assert.equal(rehearsal.analysis.status, "incomplete", "the self-check passed; no attempt was accepted");
  assert.deepEqual(rehearsal.campaign.executions.map((execution) => execution.build), ["debug", "debug", "debug"]);
  assert.deepEqual(rehearsal.state.attempts.map((attempt) => attempt.verdict.accepted), [false, false, false]);
  assert.equal(rehearsal.analysis.sections.provenance.instrument.passed, true);
});

test("the campaign is marked as a rehearsal beside it, says in its deviations that it is not a result, and its files are written", async () => {
  const sidecar = await read("rehearsal.json");
  assert.equal(sidecar.rehearsal, true);
  assert.equal(sidecar.campaignSha256, sha256(await readFile(path.join(out, "campaign.json"))));
  assert.deepEqual(sidecar.provenance.readCosts.statsUsec, { B: 0.86, C: 4.5 });
  assert.ok(!("rehearsal" in rehearsal.campaign), "the campaign itself is strictly in the format: the mark is beside it");
  const deviations = rehearsal.campaign.provenance.deviations.join("\n");
  assert.match(rehearsal.campaign.provenance.deviations[0], /^REHEARSAL/);
  for (const part of [/Debug build, not the Release export of V05-07/, /a rehearsal does not redo/, /only the slots 1 to 3 of the 36/, /60 Hz was assumed/, /self-check ran headless, because the launcher runs headless/]) {
    assert.match(deviations, part);
  }
  const summary = await read("summary.json");
  assert.equal(summary.status, "done");
  assert.equal(summary.analysis.status, "incomplete");
  assert.deepEqual(Object.keys(summary.lanes.presented), ARMS);
  for (const file of ["campaign.json", "campaign-state.json", "report.json", "summary.json"]) {
    assert.ok(await exists(path.join(out, file)), file);
  }
  for (const attempt of rehearsal.state.attempts) {
    console.log(`${attempt.arm}: ${attempt.seconds} s, load ${attempt.load.before} -> ${attempt.load.after}, rejected ${attempt.verdict.reasons.map((reason) => `${reason.rule}:${reason.clause}`)}`);
  }
  console.log(`FRONTIER_COMPARISON_CAMPAIGN_REHEARSAL: ${out}, self-check ${rehearsal.state.selfCheck.seconds} s, analysis ${rehearsal.analysis.status}`);
});
