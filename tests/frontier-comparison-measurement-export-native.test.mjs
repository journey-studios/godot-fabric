import assert from "node:assert/strict";
import { lstat, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { after } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { root } from "../scripts/consumer-harness.mjs";
import { runCampaign } from "../scripts/frontier-comparison-campaign.mjs";
import { createReleaseLauncher } from "../scripts/frontier-comparison-campaign-launchers.mjs";
import { armProject } from "../scripts/frontier-comparison-arms.mjs";
import { exportMeasurementProject } from "../scripts/frontier-comparison-measurement-export.mjs";
import { ARMS, PROBE_ARM, hashesOf, hashProblems, readExports, readProbeExport } from "../scripts/frontier-comparison-release.mjs";
import { protocolErrors } from "../scripts/frontier-comparison-protocol.mjs";
import { analyse, sha256 } from "../scripts/frontier-comparison-run-campaign.mjs";
import { PROTOCOL_FILE, launchScenario, prepareProject, processOf, runTimed, scenarioArguments } from "../scripts/frontier-comparison-run.mjs";
import { runSelfCheck } from "../scripts/frontier-comparison-campaign-instrument.mjs";

// The Release exports of the comparative campaign, for real (V05-10, `execucao`; docs/research/frontier-comparison-entry.md, "The measurement exports"), headless. In this order, with one .app of the
// product at a time and the disk of this machine in mind:
//   1. the whole script (scripts/frontier-comparison-measurement-export.mjs): the measurement `.app` of A, B and C and of the probe project, each with its manifest, and the product of each arm twice;
//   2. the proof of each arm's set of files: its measurement `.app` runs the whole script, headless, as `Contents/MacOS/<exe> --headless -- --arm --lane --out`, and its report has the counts of the Debug
//      rehearsal of the entry (docs/evidence/frontier-comparison-entry/comparison.json) and of a Debug run of the same tree, made here as the control;
//   3. the instrument's self-check through the exported probe, and a short rehearsal of the campaign over the three exports (`--build release --exports <dir> --rehearsal --slots 1-3`);
//   4. the four .app are removed (the disk is small); the manifests and the summaries stay in build/frontier-comparison-measurement-exports/.
// It needs MACOS_EXPORT_TEMPLATE, the derived arm64 Release template ZIP, like the other export lanes. It is a REHEARSAL: the sizes are those of one trial and no time here is a measurement of an arm.
const template = process.env.MACOS_EXPORT_TEMPLATE ? path.resolve(process.env.MACOS_EXPORT_TEMPLATE) : null;
const skip = template ? false : "MACOS_EXPORT_TEMPLATE is unset; the export requires the reviewed Godot arm64 Release template";
const out = path.join(root, "build", "frontier-comparison-measurement-exports");
const rehearsalOut = path.join(root, "build", "frontier-comparison-release-rehearsal");
const REPORT = path.join(out, "native-report.json");
const LANE = "presented";
const TIMEOUT_MS = 1800000;
const RECORD = path.join(root, "docs", "evidence", "frontier-comparison-entry", "comparison.json");
// The one count in which the committed record of the Debug rehearsal of the entry is behind this tree: arm C's `scene-nodes` reads 30 in it, and main.tscn has had one more node since V05-07 (#135 added
// ReplayValidation). The Debug control below, made on this tree, reads the same as the Release app; the record's number is kept as it is.
const RECORD_BEHIND = { C: { sceneNodes: 30 } };

const exists = (file) => stat(file).then(() => true, () => false);
let exported = null;
const report = { notAResult: "A rehearsal of the exports, headless, one execution per arm: no time in it is a measurement of an arm, and the sizes are those of one trial.", arms: {} };

// What a report counts, none of it a time: the fields of the record of the entry (hashes, nodes, parity, notifications, trace, windows), computed the way that record computed them.
function countsOf(run, protocol) {
  const { derived, problems } = analyse(run, protocol);
  assert.deepEqual(problems, []);
  const kinds = [...new Set(run.trace.map((entry) => entry.kind))].sort();
  return {
    mainLoop: run.provenance.mainLoop,
    sceneNodes: run.readings.sceneNodes,
    replayGoldenHash: run.game.replayGoldenHash,
    replaySteps: run.game.replaySteps,
    replayStepMismatches: run.game.replayStepMismatches.length,
    soakFinalHash: run.game.soakFinalHash,
    soakTurns: run.game.soakTurnHashes.length,
    soakDecisions: run.game.soakDecisions,
    soakRefusals: run.game.soakRefusals,
    parity: { checked: run.parity.checked, contexts: run.parity.contexts, matches: run.parity.matches },
    counters: run.counters,
    unavailable: run.unavailable,
    switches: run.switches.length,
    stressRounds: run.stress.rounds,
    latencyClicks: run.latency.frames.length,
    traceByKind: Object.fromEntries(kinds.map((kind) => [kind, run.trace.filter((entry) => entry.kind === kind).length])),
    idleFrames: derived.idle.cpuUsec.length,
    windows: Object.fromEntries(Object.entries(derived.windows).map(([id, window]) => [id, {
      available: window.available,
      occurrences: window.occurrences.length,
      measured: window.occurrences.filter((occurrence) => !occurrence.warmup).length,
      frames: window.occurrences.reduce((total, occurrence) => total + occurrence.frameUsec.length, 0),
    }])),
    anomalies: run.anomalies,
    aborted: run.aborted,
    soakTurnHashes: run.game.soakTurnHashes,
  };
}

// The fields on which `counts` differs from `other`: [field, counts' value, other's value].
const differences = (counts, other) => Object.keys(other).filter((field) => !isDeepStrictEqual(counts[field], other[field])).map((field) => [field, counts[field], other[field]]);

after(async () => {
  if (skip) {
    return;
  }
  // The four .app are the big files of this lane: they go, and the manifests and the summaries stay.
  for (const arm of [...ARMS, PROBE_ARM]) {
    for (const entry of await readdir(path.join(out, arm)).catch(() => [])) {
      if (entry.endsWith(".app")) {
        await rm(path.join(out, arm, entry), { recursive: true, force: true });
      }
    }
  }
  await mkdir(out, { recursive: true });
  await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`);
});

test("the script exports the measurement app of A, B, C and the probe, each with a manifest the launcher accepts, and the product of each arm twice with equal sizes", { skip }, async () => {
  await rm(out, { recursive: true, force: true });
  exported = await exportMeasurementProject({ out, template, log: (line) => console.log(line) });
  const entries = await readExports(out);
  const probe = await readProbeExport(out);
  assert.notEqual(probe, null);
  const template256 = exported.arms.A.manifest.templateSha256;
  for (const [arm, entry] of [...Object.entries(entries), [PROBE_ARM, probe]]) {
    assert.deepEqual(hashProblems(entry, await hashesOf(entry)), [], `${arm}: the files are those the manifest registered`);
    assert.equal(entry.manifest.templateSha256, template256, `${arm}: one template for the four`);
    assert.match(entry.manifest.godot, /^4\.7\.2\.stable/);
    assert.equal(entry.manifest.scriptFiles["tests/cpu-time-instrument.gd"], sha256(await readFile(path.join(root, "tests", "cpu-time-instrument.gd"))));
  }
  // No Fabric in A, B or the probe: the bundle holds no framework, no host and no extension; C has the host and both frameworks.
  for (const arm of ["A", "B", PROBE_ARM]) {
    assert.deepEqual(await readdir(path.join(out, arm, arm === PROBE_ARM ? "FrontierProbe.app" : `Frontier-${arm}.app`, "Contents", "Frameworks")), [], `${arm}: nothing in Contents/Frameworks`);
  }
  const cFrameworks = (await readdir(path.join(out, "C", "Frontier-C.app", "Contents", "Frameworks"))).sort();
  assert.deepEqual(cFrameworks, ["fabric_godot.dylib", "frameworks"]);
  // The product: twice the same size, and the whole app is what weighs (the HUD of C is the frameworks and the host).
  const sizes = Object.fromEntries(ARMS.map((arm) => [arm, exported.arms[arm].products.map((product) => product.appBytes)]));
  for (const arm of ARMS) {
    assert.equal(sizes[arm][0], sizes[arm][1], `${arm}: the two exports have the same size`);
    assert.deepEqual(entries[arm].manifest.exportBytes, sizes[arm]);
    assert.equal(exported.arms[arm].products[0].pckBytes, exported.arms[arm].products[1].pckBytes);
    assert.deepEqual(exported.arms[arm].products[0].paths, exported.arms[arm].products[1].paths, `${arm}: the same files in the two exports`);
    assert.ok(exported.arms[arm].products[0].paths.every((file) => !/^comparison\/|^override\.cfg$|FrontierComparison/.test(file)), `${arm}: no measurement file in the product's package`);
    assert.equal(exported.arms[arm].measurement.paths.some((file) => /^comparison\//.test(file) && file.endsWith(".gdc")), true, `${arm}: the scenario is in the measurement app`);
    assert.ok(exported.arms[arm].measurement.paths.includes("override.cfg"), `${arm}: override.cfg is inside the PCK`);
    report.arms[arm] = {
      sets: { includes: armProject(arm).includes, measurementIncludes: armProject(arm).measurementIncludes, product: armProject(arm).product, measurement: armProject(arm).measurement },
      product: exported.arms[arm].products.map(({ appBytes, pckBytes, pckFiles, pckSha256 }) => ({ appBytes, pckBytes, pckFiles, pckSha256 })),
      measurement: { appBytes: exported.arms[arm].measurement.appBytes, pckBytes: exported.arms[arm].measurement.pckBytes, pckFiles: exported.arms[arm].measurement.pckFiles },
    };
  }
  assert.ok(sizes.C[0] > sizes.B[0] && sizes.C[0] > sizes.A[0], "C weighs more than A and B: its app carries the host and the frameworks");
  assert.ok(sizes.B[0] >= sizes.A[0], "B is A and its HUD");
  report.probe = { appBytes: exported.probe.measurement.appBytes, pckFiles: exported.probe.measurement.pckFiles };
  report.templateSha256 = template256;
});

test("each measurement app runs the whole script headless with the counts of the Debug rehearsal of the entry, and of a Debug run of this tree", { skip }, async () => {
  assert.notEqual(exported, null, "the export ran");
  const protocolBytes = await readFile(PROTOCOL_FILE);
  const protocol = JSON.parse(protocolBytes);
  assert.deepEqual(protocolErrors(protocol), []);
  const entries = await readExports(out);
  const record = JSON.parse(await readFile(RECORD, "utf8")).arms;
  await mkdir(path.join(out, "proof"), { recursive: true });
  const release = {};
  for (const arm of ARMS) {
    const reportFile = path.join(out, "proof", `run-${arm}.json`);
    const ran = runTimed({ executable: entries[arm].executable, args: scenarioArguments({ arm, lane: LANE, windowed: false, out: reportFile }), cwd: path.join(out, "proof"), env: process.env, timeout: TIMEOUT_MS });
    await writeFile(path.join(out, "proof", `run-${arm}.log`), ran.log);
    assert.deepEqual(processOf(ran.result, ran.log), { exitCode: 0, crashed: false, scriptErrors: 0, godotLogErrors: 0 }, ran.log.slice(-2000));
    assert.match(ran.log, new RegExp(`FRONTIER_COMPARISON_SCENARIO_DONE: arm ${arm}, lane ${LANE}`));
    release[arm] = countsOf(JSON.parse(await readFile(reportFile, "utf8")), protocol);
    assert.equal(release[arm].mainLoop, "FrontierComparisonEntry", `${arm}: the scenario ran as the main loop of the measurement project, from a PCK`);
    assert.equal(release[arm].aborted, "");
    assert.deepEqual(release[arm].anomalies, []);
    assert.equal(release[arm].soakTurns, 100);
    for (const [id, window] of Object.entries(release[arm].windows)) {
      assert.equal(window.available, true, `${arm}: ${id} is measured`);
    }
    // Against the committed record of the Debug rehearsal of the entry: nothing differs but what RECORD_BEHIND says.
    const { exitCode, ...recorded } = record[arm].entry;
    const behind = differences(release[arm], recorded);
    assert.deepEqual(behind.map(([field, now, was]) => [field, was]), Object.entries(RECORD_BEHIND[arm] ?? {}), `${arm}: the counts of the Release app against the committed record`);
    report.arms[arm].proof = { seconds: ran.seconds, frames: JSON.parse(await readFile(reportFile, "utf8")).frames.frame.length, againstRecord: behind.map(([field, now, was]) => ({ field, release: now, record: was })) };
  }
  // The control: a Debug run of the same tree (a provisioned copy, with the extension, as the entry's rehearsal ran), arm by arm. The Release app must count what it counts.
  const prepared = await prepareProject({ name: "frontier-comparison-measurement-export-control" });
  try {
    for (const arm of ARMS) {
      const run = launchScenario({ prepared, arm, lane: LANE, timeout: TIMEOUT_MS });
      assert.deepEqual(run.process, { exitCode: 0, crashed: false, scriptErrors: 0, godotLogErrors: 0 }, run.log.slice(-2000));
      const debug = countsOf(JSON.parse(await readFile(run.reportFile, "utf8")), protocol);
      assert.deepEqual(differences(release[arm], debug), [], `${arm}: the Release app counts what the Debug run of this tree counts`);
      report.arms[arm].debugControl = { sceneNodes: debug.sceneNodes, replayGoldenHash: debug.replayGoldenHash, soakFinalHash: debug.soakFinalHash, equalToRelease: true };
    }
  } finally {
    await prepared.harness.cleanup();
  }
  assert.equal(release.A.sceneNodes, 4);
  assert.equal(release.B.sceneNodes, 31);
  assert.equal(release.C.sceneNodes, 31);
  assert.equal(release.A.parity.checked, 0, "arm A has no HUD to check");
  assert.equal(release.B.parity.matches, true);
  assert.equal(release.C.parity.matches, true);
  assert.equal(release.B.counters.consumed, release.B.counters.emitted);
  assert.equal(release.C.counters.consumed, release.C.counters.emitted);
  assert.equal(release.A.replayGoldenHash, release.B.replayGoldenHash);
  assert.equal(release.B.replayGoldenHash, release.C.replayGoldenHash);
  assert.equal(release.A.soakFinalHash, release.C.soakFinalHash);
});

test("the instrument's self-check passes through the exported probe, and a headless rehearsal of the campaign over the three exports is rejected as a rehearsal must be", { skip }, async () => {
  assert.notEqual(exported, null, "the export ran");
  const direct = await runSelfCheck({ engine: "unused", windowed: false, outDirectory: path.join(out, "proof", "self-check"), entry: "release", executable: (await readProbeExport(out)).executable });
  assert.deepEqual([direct.passed, direct.why, direct.entry, direct.lane], [true, [], "release", "headless"]);
  report.probe.directSelfCheck = { passed: direct.passed, seconds: direct.seconds, checks: direct.probe.checks };

  await rm(rehearsalOut, { recursive: true, force: true });
  const bytes = await readFile(PROTOCOL_FILE);
  const protocol = JSON.parse(bytes);
  const entries = await readExports(out);
  const rehearsal = await runCampaign({
    launcher: createReleaseLauncher({ exportsDirectory: out, windowed: false }),
    protocol,
    protocolSha256: sha256(bytes),
    out: rehearsalOut,
    lanes: [LANE],
    slots: [1, 3],
    rehearsal: true,
    assumeRefreshHz: 60,
    maxWaitSeconds: 0,
    log: (line) => console.log(line),
  });
  assert.equal(rehearsal.status, "done", JSON.stringify(rehearsal.state.stopped));
  assert.deepEqual(rehearsal.formatErrors, []);
  assert.ok(rehearsal.analysis !== null, rehearsal.analysisError);
  assert.deepEqual(rehearsal.state.attempts.map((attempt) => [attempt.lane, attempt.slot, attempt.arm, attempt.attempt]), ARMS.map((arm, index) => [LANE, index + 1, arm, 1]));
  // The gate: the probe's export, through the release entry, headless, with the repository's instrument.
  const { selfCheck } = rehearsal.state;
  assert.equal(selfCheck.passed, true, selfCheck.why.join("; "));
  assert.deepEqual([selfCheck.entry, selfCheck.lane], ["release", "headless"]);
  assert.deepEqual(selfCheck.oracle.violations, []);
  assert.deepEqual(rehearsal.campaign.instrument, { selfCheckPassed: true, sha256: sha256(await readFile(path.join(root, "tests", "cpu-time-instrument.gd"))) });
  // What it registers is what the manifests say, and the sizes are the product's, twice.
  for (const arm of ARMS) {
    const { binarySha256, packageSha256, scriptSha256 } = entries[arm].manifest;
    assert.deepEqual(rehearsal.campaign.registered.arms[arm], { binarySha256, packageSha256, scriptSha256 });
    assert.deepEqual(rehearsal.campaign.packages[arm].exportBytes, entries[arm].manifest.exportBytes);
  }
  const reasons = {};
  for (const attempt of rehearsal.state.attempts) {
    assert.equal(attempt.exitCode, 0, await readFile(path.join(rehearsalOut, attempt.log), "utf8"));
    assert.equal(attempt.aborted, "");
    assert.deepEqual([attempt.anomalies, attempt.configProblems, attempt.problems], [[], [], []]);
    assert.equal(attempt.execution.build, "release");
    assert.deepEqual(attempt.hashes.binary, entries[attempt.arm].manifest.binarySha256);
    assert.equal((await stat(path.join(rehearsalOut, attempt.raw))).isFile(), true);
    reasons[attempt.arm] = attempt.verdict.reasons.map((reason) => `${reason.rule}:${reason.clause}`);
    // A headless display draws and paces nothing, and the machine is not quiet: those, and neither the build nor an error.
    assert.ok(reasons[attempt.arm].includes("not-presented:intent-not-drawn"), `arm ${attempt.arm}: a headless display draws nothing`);
    assert.ok(reasons[attempt.arm].every((reason) => /^(not-presented:|load:)/.test(reason)), `arm ${attempt.arm}: ${reasons[attempt.arm]}`);
    assert.ok(!reasons[attempt.arm].some((reason) => /not-the-registered-build|^errors/.test(reason)), `arm ${attempt.arm}: the build is the registered one and no process erred`);
    assert.equal(attempt.verdict.accepted, false);
  }
  assert.equal(rehearsal.analysis.status, "incomplete");
  assert.deepEqual(rehearsal.campaign.executions.map((execution) => execution.build), ["release", "release", "release"]);
  const deviations = rehearsal.campaign.provenance.deviations.join("\n");
  for (const part of [/^REHEARSAL/, /the Release exports ran headless/, /a rehearsal does not redo/, /only the slots 1 to 3 of the 36/, /60 Hz was assumed/, /self-check ran headless/]) {
    assert.match(deviations, part);
  }
  assert.ok(!/Debug build, not the Release export/.test(deviations), "the build is Release");
  const sidecar = JSON.parse(await readFile(path.join(rehearsalOut, "rehearsal.json"), "utf8"));
  assert.equal(sidecar.rehearsal, true);
  assert.match(sidecar.sizesAre, /the whole \.app/);
  // The rehearsal's raw reports count what the proof's counted: the game is the same through the launcher.
  for (const attempt of rehearsal.state.attempts) {
    const counts = countsOf(JSON.parse(await readFile(path.join(rehearsalOut, attempt.raw), "utf8")), protocol);
    const proven = JSON.parse(await readFile(path.join(out, "proof", `run-${attempt.arm}.json`), "utf8"));
    assert.deepEqual(differences(counts, countsOf(proven, protocol)), [], `arm ${attempt.arm}: the rehearsal's counts are the proof's`);
  }
  report.rehearsal = {
    command: "--campaign --lanes presented --build release --exports <dir> --rehearsal --slots 1-3 --assume-refresh-hz 60 --max-wait 0",
    status: rehearsal.status,
    analysis: rehearsal.analysis.status,
    selfCheck: { passed: selfCheck.passed, entry: selfCheck.entry, lane: selfCheck.lane, seconds: selfCheck.seconds, probeChecks: selfCheck.probe.checks },
    attempts: rehearsal.state.attempts.map((attempt) => ({ arm: attempt.arm, slot: attempt.slot, seconds: attempt.seconds, load: attempt.load, reasons: reasons[attempt.arm] })),
    deviations: rehearsal.campaign.provenance.deviations,
  };
  console.log(`FRONTIER_COMPARISON_MEASUREMENT_EXPORTS: ${out}, rehearsal ${rehearsal.analysis.status}`);
  assert.equal(await exists(path.join(out, "export-summary.json")), true);
  assert.equal((await lstat(path.join(out, "A", "frontier-comparison-export.json"))).isFile(), true);
});
