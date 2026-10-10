import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { campaignErrors } from "../scripts/frontier-comparison-format.mjs";
import { buildReport } from "../scripts/frontier-comparison-report.mjs";
import { analyse, campaignOf, executionOf, fpsOf, goldenReplayHash, sha256, slotOf } from "../scripts/frontier-comparison-run-campaign.mjs";
import { derivedOf, TRACE_KINDS, usecOf, windowFramesOf, windowRulesOf } from "../scripts/frontier-comparison-run-windows.mjs";
import { loadNumber, processOf } from "../scripts/frontier-comparison-run.mjs";
import { syntheticReport, syntheticTrace, totalMsOf } from "./frontier-comparison-run-synthetic.mjs";

// The runner of the comparative execution (V05-10, `execucao`), Node only: the window rule (there is one, in JavaScript), the numbers the scenario waits with, the conversion to microseconds and
// the assembly of the campaign from executions in the scenario's format. Every report and trace here is synthetic: their numbers were made up to exercise the code and say nothing about an
// arm. The scenario itself, the player and the rehearsal in the three arms are tested by `npm run test:frontier-comparison-run` (tests/frontier-comparison-player.test.mjs and
// tests/frontier-comparison-run-native.test.mjs).

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const protocolFile = path.join(root, "docs", "research", "frontier-comparison-protocol.json");
const protocolBytes = readFileSync(protocolFile);
const protocol = JSON.parse(protocolBytes);
const protocolSha256 = sha256(protocolBytes);
const rules = windowRulesOf(protocol);
const text = (file) => readFileSync(path.join(root, file), "utf8");
const constant = (source, name) => {
  const found = new RegExp(`const ${name} := (\\d+)`).exec(source);
  assert.notEqual(found, null, `${name} is not a constant of the file`);
  return parseInt(found[1], 10);
};
const window = (id) => protocol.windows.find((candidate) => candidate.id === id);

test("the window rule reads the numbers the protocol states in words, and refuses an amendment that rewrites a sentence", () => {
  assert.deepEqual(rules, { burstMinimumFrames: 5, switchFrames: 3, stressSteps: 20, stressTail: 2 });
  const amended = structuredClone(protocol);
  amended.windows.find((candidate) => candidate.id === "event-burst").ends = "the first frame after which every event has been delivered";
  assert.throws(() => windowRulesOf(amended), /no longer says the minimum length of the event burst/);
});

test("the frames of each window, on a trace written by hand", () => {
  const trace = [
    { frame: 10, kind: "end-turn-accepted" }, { frame: 15, kind: "turn-ended" }, { frame: 20, kind: "events-settled" },
    { frame: 60, kind: "end-turn-accepted" }, { frame: 65, kind: "turn-ended" }, { frame: 80, kind: "events-settled" },
    { frame: 120, kind: "end-turn-accepted" }, { frame: 125, kind: "turn-ended" },
    { frame: 200, kind: "context-switch" }, { frame: 212, kind: "context-switch" },
    { frame: 300, kind: "stress-begin" }, ...Array.from({ length: 20 }, (_, index) => ({ frame: 301 + index, kind: "stress-step" })),
    { frame: 400, kind: "stress-begin" },
    { frame: 500, kind: "stress-begin" }, { frame: 501, kind: "stress-step" }, { frame: 502, kind: "stress-step" }, { frame: 503, kind: "stress-step" },
  ];
  const frames = windowFramesOf(trace, rules);
  // From the frame that accepts End Turn to the last frame before the frame that delivers turn_ended.
  assert.deepEqual(frames["ai-phase"], [{ first: 10, last: 14 }, { first: 60, last: 64 }, { first: 120, last: 124 }]);
  // From the frame that delivers turn_ended to the frame before the first at whose start the events are settled, and never under 5 frames: settled at 20 gives the minimum, 80 gives 15
  // frames, and a turn whose events never settle has no end.
  assert.deepEqual(frames["event-burst"], [{ first: 15, last: 19 }, { first: 65, last: 79 }, { first: 125, last: null }]);
  // The frame that receives the intent and the two after it: 3 frames.
  assert.deepEqual(frames["context-switches"], [{ first: 200, last: 202 }, { first: 212, last: 214 }]);
  // From stress_begin to the second frame after the last of the steps that follow it: 301 to 320 are the 20 steps (322), none is no end, three steps end two frames after the third.
  assert.deepEqual(frames.stress, [{ first: 300, last: 322 }, { first: 400, last: null }, { first: 500, last: 505 }]);
});

test("on the trace of a whole execution the windows have the occurrences the protocol counts", () => {
  const { trace } = syntheticTrace({ settleDelays: [0, 3, 8] });
  const frames = windowFramesOf(trace, rules);
  assert.deepEqual(Object.keys(frames), protocol.windows.map((candidate) => candidate.id));
  for (const candidate of protocol.windows) {
    assert.equal(frames[candidate.id].filter((range) => range.last !== null).length, candidate.warmupOccurrences + candidate.measuredOccurrences, candidate.id);
  }
  assert.ok(frames["ai-phase"].every((range) => range.last - range.first + 1 === 5), "End Turn is accepted five frames before turn_ended is delivered: the window has 5 frames");
  assert.ok(frames["event-burst"].every((range) => range.last - range.first + 1 >= rules.burstMinimumFrames));
  assert.ok(frames["context-switches"].every((range) => range.last - range.first + 1 === rules.switchFrames));
  assert.ok(frames.stress.every((range) => range.last - range.first + 1 === rules.stressSteps + 1 + rules.stressTail));
});

test("the numbers the scenario waits with, in GDScript, are the protocol's", () => {
  const scenario = text("tests/frontier-comparison-scenario.gd");
  assert.equal(constant(scenario, "BURST_MINIMUM_FRAMES"), rules.burstMinimumFrames);
  assert.equal(constant(scenario, "SWITCH_FRAMES"), rules.switchFrames);
  assert.equal(constant(scenario, "STRESS_STEPS"), rules.stressSteps);
  assert.equal(constant(scenario, "STRESS_TAIL"), rules.stressTail);
  const cycle = text("tests/frontier-comparison-cycle.gd");
  assert.equal(constant(cycle, "WARMUP_SWITCHES"), window("context-switches").warmupOccurrences);
  assert.equal(constant(cycle, "MEASURED_SWITCHES"), window("context-switches").measuredOccurrences);
  assert.equal(constant(scenario, "IDLE_FRAMES"), protocol.idleReference.frames);
  assert.equal(constant(scenario, "TURNS"), parseInt(/(\d+) turns/.exec(protocol.runs.fixed.soak)[1], 10));
  const latency = /(\d+) warm-up and (\d+) measured real clicks/.exec(protocol.runs.script.find((step) => step.step === "latency").does);
  assert.deepEqual([constant(scenario, "LATENCY_WARMUP"), constant(scenario, "LATENCY_MEASURED")], [parseInt(latency[1], 10), parseInt(latency[2], 10)]);
  const stress = /(\d+) warm-up and (\d+) measured rounds/.exec(protocol.runs.script.find((step) => step.step === "stress").does);
  assert.deepEqual([constant(scenario, "STRESS_WARMUP"), constant(scenario, "STRESS_MEASURED")], [parseInt(stress[1], 10), parseInt(stress[2], 10)]);
  // 12 switches a round (the entries of ROUND; a setup step has another shape), the 24 + 50 occurrences cut where the count is reached: 6 whole rounds and the first 2 switches of the 7th.
  const perRound = constant(cycle, "SWITCHES_PER_ROUND");
  assert.equal(perRound, 12);
  assert.equal([...cycle.matchAll(/^ {2}\{"id": "[a-z-]+", "intent": /gm)].length, perRound, "the entries of ROUND are as many as the constant says");
  assert.equal(constant(cycle, "WARMUP_SWITCHES") % perRound, 0, "the 24 of warm-up are two whole rounds, the baseline's 12-swap tour twice");
  assert.equal((constant(cycle, "WARMUP_SWITCHES") + constant(cycle, "MEASURED_SWITCHES")) % perRound, 2);
});

test("the amendments of the protocol that the scenario follows are in the protocol it is run against", () => {
  // The amendment 3: the replay has 77 intents, which are the steps of replay.gd.
  const replay = /(\d+) intents/.exec(protocol.runs.fixed.replay);
  assert.equal(parseInt(replay[1], 10), [...text("consumers/civ-lite/game/replay.gd").matchAll(/^ {2}\{"label"/gm)].length);
  assert.equal(parseInt(replay[1], 10), 77);
  // The amendment 4: the occurrence of the dialog is its last resolve_event, and what sets the dialog up (the End Turns, the earlier answers, any new game) is outside every window. The cycle
  // does so: the dialog's switch is the last answer, and the setup that precedes it is data of that switch, not an occurrence.
  const switches = window("context-switches");
  const step = protocol.runs.script.find((candidate) => candidate.step === "context-switches").does;
  for (const sentence of [switches.starts, step]) {
    assert.match(sentence, /last resolve_event/);
    assert.match(sentence, /dialog/);
  }
  assert.match(step, /belong to no window/);
  const cycle = text("tests/frontier-comparison-cycle.gd");
  assert.match(cycle, /\{"id": "close-dialog", "intent": "resolve_event", "args": \["host"\], "from": "dialog", "to": "none", "setup": \[/);
});

test("the kinds of event the scenario traces are the ones the window rule reads", () => {
  const unique = (found) => [...new Set(found.map((each) => each[1]))].sort();
  assert.deepEqual(unique([...text("tests/frontier-comparison-scenario.gd").matchAll(/"kind": "([a-z-]+)"/g)]), [...TRACE_KINDS].sort());
  assert.deepEqual(unique([...text("scripts/frontier-comparison-run-windows.mjs").matchAll(/framesOf\(trace, "([a-z-]+)"\)/g)]), [...TRACE_KINDS].sort());
});

test("the player's constants are the soak's own", () => {
  const player = text("tests/frontier-comparison-player.gd");
  const fixture = text("tests/frontier-soak-cases.mjs");
  assert.equal(constant(player, "GARRISON_CAP"), parseInt(/GARRISON_CAP = (\d+)/.exec(fixture)[1], 10));
  const start = /START_TILE = \{x: (\d+), y: (\d+)\}/.exec(fixture);
  assert.ok(player.includes(`const START_TILE := Vector2i(${start[1]}, ${start[2]})`));
});

test("a CPU time becomes integer microseconds as Math.round(totalMs * 1000)", () => {
  assert.equal(usecOf(0), 0);
  assert.equal(usecOf(0.0004), 0);
  assert.equal(usecOf(0.0005), 1);
  assert.equal(usecOf(0.014), 14);
  assert.equal(usecOf(0.0824999), 82);
  assert.equal(usecOf(0.0825), 83);
  assert.equal(usecOf(15.4999), 15500);
  assert.equal(usecOf(1.5), 1500);
  assert.ok(Number.isInteger(usecOf(123.456789)));
  // The windows' frames carry exactly that integer, frame by frame, from the raw milliseconds of the report.
  const report = syntheticReport(protocol, { arm: "B" });
  const derived = derivedOf(report, protocol);
  assert.deepEqual(derived.problems, []);
  const first = derived.ranges["ai-phase"][3];
  assert.deepEqual(derived.windows["ai-phase"].occurrences[3].frameUsec, Array.from({ length: first.last - first.first + 1 }, (_, index) => Math.round(totalMsOf(first.first + index) * 1000)));
});

test("the load average, the exit and the log of a Godot process are read as the errors rule asks", () => {
  assert.equal(loadNumber("{ 3.58 5.74 7.85 }"), 3.58);
  assert.ok(Number.isNaN(loadNumber(null)));
  const clean = processOf({ status: 0, signal: null }, "Godot Engine v4.7.2\nFRONTIER_COMPARISON_SCENARIO_DONE: arm A\nW1010 UIManager::~UIManager() was called\n");
  assert.deepEqual(clean, { exitCode: 0, crashed: false, scriptErrors: 0, godotLogErrors: 0 });
  const failed = processOf({ status: 1, signal: null }, "SCRIPT ERROR: Parse Error\nERROR: Failed to load script\nFABRIC_ERROR: no\n   at: x\n");
  assert.deepEqual(failed, { exitCode: 1, crashed: false, scriptErrors: 1, godotLogErrors: 2 });
  assert.equal(processOf({ status: null, signal: "SIGSEGV" }, "").crashed, true);
});

test("the replay's golden hash is read from the test that fixes it", () => {
  assert.match(goldenReplayHash(root), /^[0-9a-f]{64}$/);
  assert.equal(goldenReplayHash(root), /const GOLDEN_HASH = "([0-9a-f]{64})"/.exec(text("tests/civ-lite-game-native.test.mjs"))[1]);
});

// ---- the campaign assembled from executions in the scenario's format ----

const hashes = { binary: "1".repeat(64), package: "2".repeat(64), script: "3".repeat(64), protocol: protocolSha256 };
const ended = { exitCode: 0, crashed: false, scriptErrors: 0, godotLogErrors: 0 };
const registered = (entry = { binarySha256: hashes.binary, packageSha256: hashes.package, scriptSha256: hashes.script }) => ({
  seed: 4242, replayGoldenHash: "a".repeat(64), soakFinalHash: "b".repeat(64), instrumentSha256: "4".repeat(64), arms: { A: entry, B: entry, C: entry },
});
const executionIn = (arm, lane = "presented", options = {}) => {
  const report = syntheticReport(protocol, { arm, lane, ...options });
  const { derived, problems } = analyse(report, protocol);
  return { report, derived, problems, execution: executionOf({ report, derived, protocol, slot: slotOf(protocol, arm), load: { before: 1.2, after: 1.4 }, hashes, ended }) };
};
const campaignIn = (executions, overrides = {}) => campaignOf({
  executions,
  registered: registered(),
  instrument: { selfCheckPassed: false, sha256: "4".repeat(64) },
  packages: { A: { exportBytes: [10, 10] }, B: { exportBytes: [10, 10] }, C: { exportBytes: [10, 10] } },
  provenance: { commit: "c".repeat(40), machine: "m", system: "s", display: "d", renderer: "r", adapter: "a", rawData: "build/x", deviations: ["REHEARSAL"] },
  ...overrides,
});

test("the scenario's reports, assembled into a campaign, pass the format and the analysis rejects each execution as a Debug build", () => {
  const made = ["A", "B", "C"].map((arm) => executionIn(arm));
  for (const { report, problems } of made) {
    assert.deepEqual(problems, [], report.arm);
  }
  const campaign = campaignIn(made.map(({ execution }) => execution));
  assert.deepEqual(campaignErrors(campaign, protocol), []);
  assert.deepEqual(made.map(({ execution }) => [execution.arm, execution.slot, execution.build, "parityMatches" in execution]), [["A", 1, "debug", false], ["B", 2, "debug", true], ["C", 3, "debug", true]]);
  const report = buildReport({ campaign, protocol, protocolSha256, campaignSha256: sha256(JSON.stringify(campaign)) });
  const rejected = report.sections.validity.slots.filter((slot) => slot.lane === "presented" && slot.attempts.length > 0);
  assert.deepEqual(rejected.map((slot) => slot.arm), ["A", "B", "C"]);
  for (const slot of rejected) {
    assert.deepEqual(slot.attempts[0].reasons.map((reason) => `${reason.rule}:${reason.clause}`), ["not-the-registered-build:build"], slot.arm);
  }
  // The rehearsal registers an instrument whose self-check it did not run, so the analysis produces no statistic.
  assert.equal(report.status, "stopped");
  assert.deepEqual(report.why.map((why) => why.rule), ["instrument"]);
});

test("a window the scenario could not measure has no occurrence in the campaign, and the campaign says why apart", () => {
  const hooks = { "event-burst": "GameServices has no notifications_emitted()", stress: "GameServices has no stress_begin()" };
  const { derived, problems, execution } = executionIn("B", "presented", { unavailable: hooks });
  assert.deepEqual(Object.fromEntries(Object.entries(derived.windows).filter(([, found]) => !found.available).map(([id, found]) => [id, found.reason])), hooks);
  assert.deepEqual(execution.windows["event-burst"].occurrences, []);
  assert.deepEqual(execution.windows.stress.occurrences, []);
  assert.deepEqual(problems, []);
  assert.deepEqual(campaignErrors(campaignIn([execution]), protocol), []);
  const analysed = buildReport({ campaign: campaignIn([execution]), protocol, protocolSha256, campaignSha256: sha256("x") });
  const reasons = analysed.sections.validity.slots.find((slot) => slot.lane === "presented" && slot.arm === "B").attempts[0].reasons.map((reason) => `${reason.rule}:${reason.clause}`);
  assert.deepEqual(reasons, ["not-the-registered-build:build", "incomplete:event-burst", "incomplete:stress"]);
});

test("the FPS without a limit is the frames of the measured occurrences over the time they took, and only a vsync read back as DISABLED has one", () => {
  const disabled = executionIn("A", "unlimited", { mode: "DISABLED" });
  const [first, second, third] = ["ai-phase", "context-switches", "stress"].map((id) => disabled.execution.windows[id].fps);
  assert.ok(Number.isFinite(first) && first > 0);
  // The synthetic frames start 8333 microseconds apart, so every window runs at 1e6 / 8333 frames per second.
  for (const fps of [first, second, third]) {
    assert.ok(Math.abs(fps - 1e6 / 8333) < 1e-9, String(fps));
  }
  assert.equal(fpsOf(disabled.derived, window("ai-phase")), first);
  assert.deepEqual(campaignErrors(campaignIn([disabled.execution]), protocol), []);
  const enabled = executionIn("A", "unlimited", { mode: "ENABLED" });
  assert.ok(!("fps" in enabled.execution.windows["ai-phase"]), "the unlimited lane that did not read DISABLED back has no FPS");
  assert.deepEqual(campaignErrors(campaignIn([enabled.execution]), protocol), []);
  assert.ok(!("fps" in executionIn("A", "presented", { mode: "DISABLED" }).execution.windows["ai-phase"]), "the presented lane reads no FPS");
});

test("the windows are derived from the trace and the samples, and a report that cannot be analysed says why", () => {
  const fresh = () => syntheticReport(protocol, { arm: "B" });
  const derived = derivedOf(fresh(), protocol);
  assert.deepEqual(derived.problems, []);
  for (const candidate of protocol.windows) {
    const found = derived.windows[candidate.id];
    assert.equal(found.occurrences.length, candidate.warmupOccurrences + candidate.measuredOccurrences, candidate.id);
    assert.deepEqual(found.occurrences.map((occurrence) => occurrence.warmup), found.occurrences.map((_, index) => index < candidate.warmupOccurrences), `${candidate.id}: the first ones are the warm-up`);
  }
  assert.equal(derived.idle.cpuUsec.length, protocol.idleReference.frames);
  assert.equal(derived.idle.intervalsUsec.length, protocol.idleReference.frames);
  assert.deepEqual(derived.drew, { afterEveryMeasuredIntent: true, idleDrawnFrames: protocol.idleReference.frames });

  const rewritten = fresh();
  rewritten.config.waits.burstMinimumFrames = 4;
  assert.match(derivedOf(rewritten, protocol).problems.join("\n"), /waits: the scenario waited with/);
  const shorter = fresh();
  shorter.config.idleFrames = 599;
  shorter.idle.last = 599;
  assert.match(derivedOf(shorter, protocol).problems.join("\n"), /idleFrames: 599[\s\S]*idle: 599 frames/);
  const foreign = fresh();
  foreign.format = "something/else";
  assert.deepEqual(analyse(foreign, protocol), { derived: null, problems: ["format: something/else is not godot-fabric.frontier-comparison-scenario/v1"] });

  // A frame the run lacks, or whose render reading never arrived, is not a sample: the occurrence that needs it is left out, and the report says so.
  const lacking = fresh();
  lacking.frames.renderKnown[lacking.frames.frame.indexOf(derived.ranges["context-switches"][30].first + 1)] = 0;
  const lost = derivedOf(lacking, protocol);
  assert.match(lost.problems.join("\n"), /context-switches\[30\]: frame \d+ has no complete sample/);
  assert.equal(lost.windows["context-switches"].occurrences.length, 73);
  const idling = fresh();
  for (const column of Object.values(idling.frames)) {
    column.splice(10, 1);
  }
  assert.match(derivedOf(idling, protocol).problems.join("\n"), /idle: frame 11 has no complete sample/);

  // A display that drew nothing in a measured occurrence says so.
  const dark = fresh();
  for (let frame = derived.ranges["ai-phase"][50].first; frame <= derived.ranges["ai-phase"][50].last; frame += 1) {
    dark.frames.drawn[dark.frames.frame.indexOf(frame)] = 0;
  }
  assert.equal(derivedOf(dark, protocol).drew.afterEveryMeasuredIntent, false);
});

test("an event burst that never settles leaves the window one occurrence short, and the analysis calls the execution incomplete", () => {
  const { problems, execution } = executionIn("A", "presented", { trace: { unsettled: [57] } });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^event-burst\[57\]: the occurrence that began at frame \d+ did not end$/);
  assert.equal(execution.windows["event-burst"].occurrences.length, 99);
  const analysed = buildReport({ campaign: campaignIn([execution]), protocol, protocolSha256, campaignSha256: sha256("x") });
  const reasons = analysed.sections.validity.slots.find((slot) => slot.lane === "presented" && slot.arm === "A").attempts[0].reasons;
  const incomplete = reasons.find((reason) => reason.rule === "incomplete");
  assert.deepEqual([incomplete.clause, incomplete.measured, incomplete.required], ["event-burst", 97, 98]);
});

test("the runner of this part runs only the rehearsal", () => {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "frontier-comparison-run.mjs"), "--arms", "A"], { encoding: "utf8", timeout: 60000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /only runs the rehearsal/);
});
