import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { after, before } from "node:test";
import { goldenReplayHash } from "../scripts/frontier-comparison-run-campaign.mjs";
import { launchScenario, MEASUREMENT_FILES, prepareProject, readCostsOf, rehearse, summaryOf } from "../scripts/frontier-comparison-run.mjs";

// The scenario of the comparative execution (tests/frontier-comparison-scenario.gd) run for real, headless, in each of the three arms, and the rehearsal that the runner builds from it
// (scripts/frontier-comparison-run.mjs). It is a REHEARSAL: a Debug build, one execution per arm, no campaign, and no number of it is a measurement of an arm. What it proves is that the
// script runs to its end in A, B and C, that the replay reaches its golden hash, that every window, derived from the trace the scenario recorded by the one rule there is (in JavaScript:
// scripts/frontier-comparison-run-windows.mjs), has the occurrences the protocol counts (or says why it cannot), and that the object it produces is in the format the analysis reads, which
// then rejects each execution as a Debug build. The player's equivalence with the soak of JavaScript is
// tests/frontier-comparison-player.test.mjs. `npm run test:frontier-comparison-run` runs both, one at a time.
//
// The headless display server has no refresh rate (it reads -1) and the format requires a positive one, so the rehearsal assumes 60 Hz for the format, and says so in its deviations.
//
// The scenario enters as the MAIN LOOP of the measurement project (`application/run/main_loop_type` in the copy's override.cfg), never with `-s`: it is the entry that a Release export runs.
// The test after the first one shows it, and the one after that runs arm A through `-s` as a control and compares what the scenario counts.
const ARMS = ["A", "B", "C"];
const ASSUMED_REFRESH_HZ = 60;
const SOAK_FINAL_HASH = "0b21c332c1f86fb41522cdbed0144f168831f6ab51bc427769a68a146aa6afd0";

let prepared = null;

before(async () => {
  prepared = await prepareProject({ name: "frontier-comparison-run" });
});

after(async () => {
  await prepared?.harness.cleanup();
});

let rehearsal = null;

test("the rehearsal runs the script to its end in the three arms and builds a campaign in the format", async () => {
  rehearsal = await rehearse({ prepared, arms: ARMS, lane: "presented", assumeRefreshHz: ASSUMED_REFRESH_HZ, log: (line) => console.log(line) });
  assert.deepEqual(rehearsal.problems, []);
  assert.deepEqual(rehearsal.formatErrors, []);
  assert.equal(rehearsal.runs.length, ARMS.length);
  for (const run of rehearsal.runs) {
    assert.equal(run.process.exitCode, 0, run.log);
    assert.deepEqual(run.process, { exitCode: 0, crashed: false, scriptErrors: 0, godotLogErrors: 0 }, run.log);
    assert.equal(run.report.aborted, "");
    assert.deepEqual(run.report.anomalies, []);
  }
});

test("the scenario entered as the main loop of the measurement project: no -s, the settings in the copy, the class in the cache, the product's project.godot untouched", async () => {
  const project = prepared.harness.project;
  assert.equal(await readFile(path.join(project, "override.cfg"), "utf8"), MEASUREMENT_FILES["override.cfg"]);
  assert.match(await readFile(path.join(project, ".godot", "global_script_class_cache.cfg"), "utf8"), /FrontierComparisonEntry/);
  assert.doesNotMatch(await readFile(path.join(project, "project.godot"), "utf8"), /main_loop_type|frontier-comparison/);
  for (const run of rehearsal.runs) {
    assert.deepEqual(run.args.slice(0, 2), ["--path", project]);
    assert.ok(!run.args.includes("-s") && !run.args.includes("--script"), `arm ${run.report.arm}: the process did not receive -s: ${run.args}`);
    assert.ok(run.args.slice(run.args.indexOf("--")).every((argument) => argument === "--" || /^--(arm|lane|out)=/.test(argument)));
    assert.equal(run.report.provenance.mainLoop, "FrontierComparisonEntry", `arm ${run.report.arm}: the script ran as the main loop, as the class the settings name`);
  }
});

// What a report counts, none of it a time: the nodes of the tree at the end, the game's hashes and counts, the parity, the notifications and the occurrences of the trace by kind.
const countsOf = (report) => ({
  sceneNodes: report.readings.sceneNodes,
  game: report.game,
  parity: report.parity,
  counters: report.counters,
  unavailable: report.unavailable,
  switches: report.switches.length,
  stressRounds: report.stress.rounds,
  idle: report.idle.last - report.idle.first + 1,
  trace: Object.fromEntries([...new Set(report.trace.map((entry) => entry.kind))].sort().map((kind) => [kind, report.trace.filter((entry) => entry.kind === kind).length])),
});

test("the empty main scene changes no reading: arm A through -s, without the settings, counts what it counts as the main loop", async () => {
  const settings = path.join(prepared.harness.project, "override.cfg");
  const genuine = await readFile(settings, "utf8");
  const out = path.join(prepared.harness.directory, "run-A-presented-s.json");
  await rm(out, { force: true });
  await rm(settings);
  let control = null;
  try {
    control = spawnSync(prepared.harness.godot, ["--path", prepared.harness.project, "--headless", "-s", "res://comparison/frontier-comparison-scenario.gd", "--", "--arm=A", "--lane=presented", `--out=${out}`],
      { env: prepared.harness.env, encoding: "utf8", timeout: 1800000, maxBuffer: 256 * 1024 * 1024 });
  } finally {
    await writeFile(settings, genuine);
  }
  assert.equal(control.status, 0, (control.stdout ?? "") + (control.stderr ?? ""));
  const through = JSON.parse(await readFile(out, "utf8"));
  const entered = rehearsal.runs.find((run) => run.report.arm === "A").report;
  assert.equal(through.provenance.mainLoop, "", "the control is the scenario script itself, run with -s");
  assert.ok(through.readings.sceneNodes > 0);
  assert.deepEqual(countsOf(entered), countsOf(through));
});

test("in each arm the replay reaches its golden hash, the soak its final hash, and every window has the occurrences the protocol counts or says why it has none", () => {
  const golden = goldenReplayHash(prepared.harness.root);
  for (const { report, derived } of rehearsal.runs) {
    const where = `arm ${report.arm}`;
    assert.equal(report.game.replayGoldenHash, golden, `${where}: the golden hash of the 12-turn replay`);
    assert.equal(report.game.replaySteps, 77, `${where}: the replay has 77 steps (the protocol's 73 intents are the amendment 3's 77)`);
    assert.deepEqual(report.game.replayStepMismatches, [], `${where}: every step of the replay gave the code it should`);
    assert.equal(report.game.soakFinalHash, SOAK_FINAL_HASH, `${where}: the final hash of the soak`);
    assert.equal(report.game.soakTurns, 100);
    assert.equal(report.seed, 4242);
    assert.equal(derived.idle.cpuUsec.length, rehearsal.protocol.idleReference.frames, `${where}: the idle window`);
    assert.equal(derived.idle.intervalsUsec.length, rehearsal.protocol.idleReference.frames);
    // The hooks of the stress and events slice are delivered, so the four windows are measured in the three arms, with the occurrences the protocol counts: the 2 of warm-up and the rest.
    for (const window of rehearsal.protocol.windows) {
      const found = derived.windows[window.id];
      assert.equal(found.available, true, `${where}: ${window.id} is measured (${found.reason})`);
      assert.equal(found.occurrences.length, window.warmupOccurrences + window.measuredOccurrences, `${where}: ${window.id} occurrences`);
      assert.equal(found.occurrences.filter((occurrence) => !occurrence.warmup).length, window.measuredOccurrences, `${where}: ${window.id} measured`);
    }
    assert.ok(derived.windows["ai-phase"].occurrences.every((occurrence) => occurrence.frameUsec.length === 5), `${where}: a direct call at the start of a frame runs the first phase in that frame, so the AI phase is five frames`);
    assert.ok(derived.windows["event-burst"].occurrences.every((occurrence) => occurrence.frameUsec.length >= 5), `${where}: an event burst is five frames at least`);
    assert.equal(report.trace.filter((entry) => entry.kind === "events-settled").length, 100, `${where}: the counters agreed at the end of every one of the 100 turns`);
    assert.ok(derived.windows["context-switches"].occurrences.every((occurrence) => occurrence.frameUsec.length === 3), `${where}: a context switch is 3 frames`);
    assert.ok(derived.windows.stress.occurrences.every((occurrence) => occurrence.frameUsec.length === 23), `${where}: a stress round is the begin, 20 steps and the 2 frames after the last`);
    assert.equal(report.stress.rounds, 32);
    assert.deepEqual(report.boot.hooks.eventBurstReason, "");
    assert.deepEqual(report.boot.hooks.stressReason, "");
    // At rest at the end the HUD has consumed everything the game emitted, in B and in C (in A there is no consumer: -1). The count is 3 notifications for each turn at least.
    assert.ok(report.counters.emitted > 300, `${where}: the game emitted its notifications`);
    assert.equal(report.counters.consumed, report.arm === "A" ? -1 : report.counters.emitted, `${where}: events equals notifications_emitted() at rest`);
  }
});

test("the cost of reading stats() is in the provenance of the rehearsal, from the record of the slice that delivered the hooks", async () => {
  const costs = await readCostsOf();
  assert.deepEqual(costs, { source: "docs/evidence/frontier-stress/costs.json", statsUsec: { B: 0.86, C: 4.5 }, notTaken: { evaluateUsec: 100, surfaceSnapshotUsec: 570 } });
  assert.deepEqual(rehearsal.sidecar.provenance.readCosts, costs);
  // What the scenario measured of the same reads in these runs, for the record beside the figures above.
  for (const { report } of rehearsal.runs.filter((run) => run.report.arm !== "A")) {
    assert.ok(report.costsUsec.statsUsec > 0, `arm ${report.arm}: stats() was read and timed`);
  }
});

test("the HUD arms pass the parity of the seven contexts and the latency pass clicks the controls it should, and arm A has neither", () => {
  for (const { report } of rehearsal.runs) {
    if (report.arm === "A") {
      assert.equal(report.latency.available, false);
      assert.equal(report.readings.clickToPanelFrames, undefined);
      assert.equal(report.readings.timeToInteractiveHudMs, undefined);
      continue;
    }
    assert.equal(report.parity.matches, true, `arm ${report.arm}: the visible testIDs are the context matrix's in the seven contexts`);
    assert.deepEqual(Object.keys(report.parity.contexts).sort(), ["city", "dialog", "none", "settler", "stack", "tile", "warrior"]);
    assert.deepEqual(report.latency.failed, []);
    assert.equal(report.readings.clickToPanelFrames.length, 30);
    assert.equal(report.latency.warmupFrames.length, 2);
    assert.ok(report.readings.timeToInteractiveHudMs > 0, `arm ${report.arm}: the time to the interactive HUD`);
  }
  const hermes = rehearsal.runs.find(({ report }) => report.arm === "C").report.readings.hermes;
  assert.ok(hermes.heapBytes > 0 && hermes.nativeViews > 0, "arm C reads Hermes' heap after a forced collection and the native views");
});

test("every switch of the cycle left the game in the context the cycle plans, 12 to a round, and the dialog's occurrence is the answer that closes it", () => {
  for (const { report } of rehearsal.runs) {
    assert.equal(report.switches.length, 74);
    assert.ok(report.switches.every((entry) => entry.ok === 1 && entry.reached === entry.to), `arm ${report.arm}: each intent was taken and reached its context`);
    const closing = report.switches.filter((entry) => entry.id === "close-dialog");
    assert.equal(closing.length, 6, `arm ${report.arm}: six whole rounds reach the dialog (74 switches are 6 rounds of 12 and 2 more)`);
    assert.ok(closing.every((entry) => entry.to === "none"));
    // The founding of the city, the End Turns and the earlier answers are setup and not switches: the city is entered once a round, by a selection, and left twice.
    assert.deepEqual(report.switches.slice(0, 12).map((entry) => entry.to), ["stack", "warrior", "none", "stack", "settler", "tile", "stack", "settler", "none", "city", "none", "none"]);
    assert.ok(report.switches.every((entry) => entry.id !== "found-city"));
    const reached = {};
    for (const entry of report.switches) {
      reached[entry.to] = (reached[entry.to] ?? 0) + 1;
    }
    assert.deepEqual(reached, { stack: 19, warrior: 7, none: 24, settler: 12, tile: 6, city: 6 }, `arm ${report.arm}: the contexts the 74 switches reach`);
  }
});

test("the analysis rejects every execution of the rehearsal as a Debug build, and nothing else of the registered values is wrong", () => {
  const slots = rehearsal.analysis.sections.validity.slots.filter((slot) => slot.lane === "presented" && slot.attempts.length > 0);
  assert.deepEqual(slots.map((slot) => slot.arm), ARMS);
  for (const slot of slots) {
    const reasons = slot.attempts[0].reasons.map((reason) => `${reason.rule}:${reason.clause}`);
    assert.ok(reasons.includes("not-the-registered-build:build"), `arm ${slot.arm} is rejected as a Debug build`);
    // The headless display draws nothing, so the rehearsal also says it was not presented; the windows that wait for a hook say they are incomplete; and a machine that is not
    // quiet (the other lanes of the repository run on it) is rejected for its load, which the rehearsal does not control.
    assert.ok(reasons.every((reason) => /^(not-the-registered-build:build|not-presented:|incomplete:|load:)/.test(reason)), `arm ${slot.arm}: ${reasons}`);
    assert.equal(slot.state, "open");
  }
  assert.equal(rehearsal.analysis.status, "stopped", "the instrument's self-check was not run for the rehearsal");
  assert.deepEqual(rehearsal.campaign.executions.map((execution) => execution.build), ["debug", "debug", "debug"]);
  assert.equal(rehearsal.sidecar.rehearsal, true);
  assert.ok(!("rehearsal" in rehearsal.campaign), "the campaign itself is strictly in the format: the mark is beside it");
  assert.match(rehearsal.campaign.provenance.deviations[0], /^REHEARSAL/);
});

test("the unlimited lane asks for the vsync DISABLED, reads it back and records what it read", async () => {
  const run = launchScenario({ prepared, arm: "A", lane: "unlimited" });
  assert.equal(run.process.exitCode, 0, run.log);
  const report = JSON.parse(await readFile(run.reportFile, "utf8"));
  assert.equal(report.lane, "unlimited");
  assert.equal(report.vsync.requested, "DISABLED");
  assert.ok(["DISABLED", "ENABLED"].includes(report.vsync.mode), "the mode is read back, whatever it is: the headless display server keeps ENABLED");
  assert.equal(report.game.soakFinalHash, SOAK_FINAL_HASH);
  assert.ok(rehearsal.runs.every((run) => run.report.lane === "presented" && run.report.vsync.requested === "default"), "the presented lane keeps the project's vsync");
});

// Replaces one place of a file of the provisioned copy and says how to put it back.
async function patched(file, edits) {
  const target = path.join(prepared.harness.project, file);
  const genuine = await readFile(target, "utf8");
  let text = genuine;
  for (const [find, replace] of edits) {
    assert.equal(text.split(find).length, 2, `${file}: the change is in exactly one place (${find.slice(0, 40)})`);
    text = text.replace(find, () => replace);
  }
  await writeFile(target, text);
  return () => writeFile(target, genuine);
}

test("a game without the hooks, or a HUD without its counters, makes the windows that wait for them unavailable, with the reason, and the rest is measured", async () => {
  const restore = [
    await patched("services/game_services.gd", [
      ["func stress_step() -> Dictionary:", "func stress_step_removed() -> Dictionary:"],
    ]),
    await patched("native_hud/hud.gd", [
      ["func stats() -> Dictionary:", "func stats_removed() -> Dictionary:"],
    ]),
  ];
  try {
    const bare = await rehearse({ prepared, arms: ["A", "B"], lane: "presented", assumeRefreshHz: ASSUMED_REFRESH_HZ });
    assert.deepEqual(bare.problems, []);
    const [a, b] = bare.runs.map((run) => run.derived);
    // The game lacks stress_step(): the stress window is unavailable in both, and says which hook is missing; arm A's event burst is measured, because the game's counter is there.
    for (const derived of [a, b]) {
      assert.equal(derived.windows.stress.available, false);
      assert.match(derived.windows.stress.reason, /GameServices has no stress_step\(\)/);
      assert.deepEqual(derived.windows.stress.occurrences, []);
      assert.equal(derived.windows["ai-phase"].occurrences.length, 100);
      assert.equal(derived.windows["context-switches"].occurrences.length, 74);
    }
    assert.equal(a.windows["event-burst"].available, true);
    // The HUD of B lacks stats(): its event burst is unavailable and the reason names the HUD.
    assert.equal(b.windows["event-burst"].available, false);
    assert.match(b.windows["event-burst"].reason, /the HUD of arm B has no stats\(\)/);
    assert.deepEqual(b.windows["event-burst"].occurrences, []);
    const reasons = bare.analysis.sections.validity.slots.filter((slot) => slot.attempts.length > 0).flatMap((slot) => slot.attempts[0].reasons.filter((reason) => reason.rule === "incomplete").map((reason) => `${slot.arm}:${reason.clause}`));
    assert.deepEqual(reasons, ["A:stress", "B:event-burst", "B:stress"]);
  } finally {
    for (const put of restore) {
      await put();
    }
  }
});

test("a scenario that does not write its report stops the rehearsal, which says where to look, and builds no analysis", async () => {
  const file = path.join(prepared.harness.project, "comparison", "frontier-comparison-scenario.gd");
  const genuine = await readFile(file, "utf8");
  await writeFile(file, "extends SceneTree\n\nfunc _initialize() -> void:\n  quit(3)\n");
  try {
    const refused = await rehearse({ prepared, arms: ["A"], lane: "presented", assumeRefreshHz: ASSUMED_REFRESH_HZ });
    assert.equal(refused.analysis, null);
    assert.equal(refused.executions.length, 0);
    assert.match(refused.problems.join("\n"), /arm A: the scenario wrote no report \(exit 3\); see build\/frontier-comparison-run\/run-A-presented\.log/);
  } finally {
    await writeFile(file, genuine);
  }
});

test("the summary of the rehearsal is written as a report", async () => {
  const summary = summaryOf(rehearsal, prepared);
  assert.equal(summary.rehearsal, true);
  assert.equal(summary.executions.length, ARMS.length);
  const out = path.join(prepared.harness.root, "build", "frontier-comparison-run-report.json");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(summary, null, 2)}\n`);
  for (const execution of summary.executions) {
    const unavailable = Object.entries(execution.windows).filter(([, window]) => !window.available).map(([id]) => id);
    console.log(`arm ${execution.arm}: ${execution.seconds} s, ${execution.frames} frames, windows ${Object.entries(execution.windows).map(([id, window]) => `${id}=${window.available ? window.measured : "n/a"}`).join(" ")}, unavailable [${unavailable}], rejected ${execution.rejected}`);
  }
  console.log(`FRONTIER_COMPARISON_RUN_REPORT: ${out}`);
});
