import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {TARGETS_MS, deriveTerms, judgeCpuTimeInstrumentReport, verifyCpuTimeInstrumentReport} from "./cpu-time-instrument-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// The self-check of the CPU-time instrument, headless: the probe (tests/cpu-time-instrument-probe.gd) runs the instrument in a lab scene of its own, with a
// busy loop of 2, 5, 10 and 20 ms in the frames of a block, and the oracle (tests/cpu-time-instrument-oracle.mjs) judges its raw report. The slice changes no
// C++ and the arms of the comparison have no host, so there is no preceding host to run it on and the probe does not use the Fabric host.
// --sabotage=<reads-interval|load-outside-frame|reads-monitor> runs the probe once on a source that scripts/cpu-time-instrument-sabotage.mjs broke on
// purpose (it swaps the source and restores it byte for byte): the probe's checks and the oracle must each reject it.
// --replay=<report.json> judges a report that was recorded before, a hosted run's artifact say, with the oracle only.
// The windowed lane is local: npm run bench:cpu-time-instrument-graphics.
const replayArgument = process.argv.find(argument => argument.startsWith("--replay="));
const sabotageArgument = process.argv.find(argument => argument === "--sabotage" || argument.startsWith("--sabotage="));
const sabotageNames = ["reads-interval", "load-outside-frame", "reads-monitor"];
const sabotage = sabotageArgument === undefined ? null : (sabotageArgument.split("=")[1] ?? sabotageNames[0]);
assert.ok(sabotage === null || sabotageNames.includes(sabotage), "Unknown sabotage: " + sabotage);
const lane = sabotage === null ? "current" : `sabotage-${sabotage}`;
const reportFile = `build/cpu-time-instrument-${lane}-report.json`;
const sorted = values => [...values].sort();

async function optionalJson(file) {
  try {
    return JSON.parse(await readFile(path.join(root, file), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function runProbe(binary) {
  await rm(path.join(root, reportFile), {force: true});
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/cpu-time-instrument-probe.gd", "--",
    `--report=${path.basename(reportFile)}`, ...(sabotage === null ? [] : ["--sabotage"])], {encoding: "utf8", timeout: 900000, maxBuffer: 64 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/cpu-time-instrument-${lane}.log`), log);
  const report = await optionalJson(reportFile);
  if (report !== null) {
    const pinned = JSON.parse(await readFile(path.join(root, "dependencies.json"), "utf8"));
    report.provenance = {...report.provenance, node: process.version, pinnedGodot: pinned.godot.version};
    await writeFile(path.join(root, reportFile), JSON.stringify(report) + "\n");
  }
  return {result, log, report};
}

// The report with its raw stamps changed the way a broken instrument would have taken them, and the terms derived again from them: the oracle has to
// refuse each by the rule that the change breaks. Nothing is rebuilt and nothing runs.
function changed(report, change) {
  const copy = structuredClone(report);
  change(copy);
  Object.assign(copy.frames, deriveTerms(copy.frames, copy.renderReadings));
  return copy;
}
const framesOf = (report, name) => report.frames.block.flatMap((block, index) => (report.config.blocks[block].name === name ? [index] : []));
const mutations = {
  // The instrument reads 15% over what the load took.
  "target-out-of-10-percent": {rule: /within 10% of the 10 ms load/, change: copy => {
    for (const index of framesOf(copy, "load-10")) {
      const start = copy.frames.startUsec[index];
      copy.frames.lastProcessUsec[index] = start + Math.round((copy.frames.lastProcessUsec[index] - start) * 1.15);
    }
  }},
  // The instrument reads the time to the next frame where it should read the time of this one.
  "interval-for-cpu": {rule: /reads CPU time and not the interval between frames/, change: copy => {
    copy.frames.lastProcessUsec = copy.frames.lastProcessUsec.map((last, index) => (index + 1 < copy.frames.startUsec.length
      ? copy.frames.startUsec[index + 1] : last));
  }},
  // The load ran, as the engine's clock says, but not between the instrument's stamps.
  "load-outside-frame": {rule: /within 10% of the 2 ms load/, change: copy => {
    copy.frames.lastProcessUsec = copy.frames.lastProcessUsec.map((last, index) => Math.max(copy.frames.startUsec[index], last - copy.frames.burnUsec[index]));
  }},
  // A frame of the schedule has no sample.
  "missing-sample": {rule: /one entry for each of the \d+ scheduled frames/, change: copy => {
    for (const column of Object.values(copy.frames)) {
      column.splice(1500, 1);
    }
  }},
};

test("The CPU-time instrument reads a busy loop of 2, 5, 10 and 20 ms to within 10%, from the CPU and not from the interval between frames", async () => {
  if (replayArgument !== undefined) {
    const file = path.resolve(replayArgument.slice("--replay=".length));
    const verdict = verifyCpuTimeInstrumentReport(JSON.parse(await readFile(file, "utf8")));
    console.log(`${path.basename(file)}: the oracle accepts it\n${JSON.stringify(verdict, null, 2)}`);
    return;
  }
  const binary = await ensureGodotBinary();
  const {result, log, report} = await runProbe(binary);
  // Artifacts are saved before assertions.
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.equal(result.status, 0, log);
  assert.ok(report !== null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.equal(report.scenario, "cpu-time-instrument");
  assert.equal(report.lane, "headless");
  assert.equal(report.sabotage, sabotage !== null);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  // Every ERROR line is a failed check: no native, script or engine error hides.
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length, "No native diagnostic, script or engine error is hidden");
  if (sabotage !== null) {
    // The oracle rejects the sabotaged report on its own derivations. The verdict is written for the script that ran the variant, which counts a
    // missing verdict as a variant that was not rejected.
    assert.ok(failures.length > 0, "The probe's checks reject the sabotaged source");
    assert.match(log, new RegExp(`CPU_TIME_INSTRUMENT_SABOTAGE_REJECTED: ${failures.length}`));
    const verdict = judgeCpuTimeInstrumentReport(report);
    await writeFile(path.join(root, `build/cpu-time-instrument-sabotage-${sabotage}-verdict.json`),
      JSON.stringify({sabotage, probeFailures: failures, oracleRejection: verdict.violations[0] ?? null, oracleViolations: verdict.violations}, null, 2) + "\n");
    assert.ok(verdict.violations.length > 0, "The oracle rejects the sabotaged report");
    return;
  }
  assert.deepEqual(failures, []);
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.match(log, /CPU_TIME_INSTRUMENT_PASSED: \d+/);
  assert.ok(report.provenance.godot.startsWith(report.provenance.pinnedGodot), "The engine is the pinned Godot");
  const verdict = verifyCpuTimeInstrumentReport(report);
  assert.equal(verdict.judged, true);
  for (const target of TARGETS_MS) {
    assert.ok(Math.abs(verdict.accuracy[target].error) <= 0.1, `The ${target} ms load is read to within 10%`);
  }
  console.log(`CPU-time instrument against the busy loop (headless, ${report.frames.frame.length} frames):\n${JSON.stringify(Object.fromEntries(TARGETS_MS.map(target => [target,
    {burnedMs: verdict.accuracy[target].burnedMs, readMs: verdict.accuracy[target].readMs, error: verdict.accuracy[target].error}])), null, 2)}\nidle: ${
    JSON.stringify(verdict.cpu)}\nengine monitor: ${JSON.stringify(verdict.engine)}`);
  // The same breakages that the retained sabotages make in the source, made in the recorded stamps: the oracle refuses each by the rule it breaks.
  const negatives = {};
  for (const [name, {rule, change}] of Object.entries(mutations)) {
    const rejected = judgeCpuTimeInstrumentReport(changed(report, change));
    assert.ok(rejected.violations.length > 0, `${name}: the oracle rejects it`);
    assert.match(rejected.violations[0], rule, `${name}: by the rule that it breaks`);
    negatives[name] = rejected.violations[0];
  }
  const sabotages = {};
  for (const name of sabotageNames) {
    sabotages[name] = await optionalJson(`build/cpu-time-instrument-sabotage-${name}-verdict.json`);
  }
  await writeFile(path.join(root, "build/cpu-time-instrument-comparison.json"), JSON.stringify({scenario: report.scenario,
    previousHostControl: "not applicable: the slice changes no C++ and the arms of the comparison have no host", sabotages, reportLevelNegatives: negatives,
    oracle: verdict}, null, 2) + "\n");
});
