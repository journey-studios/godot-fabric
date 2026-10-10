import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { parseArguments, runCampaign, writeAtomic } from "../scripts/frontier-comparison-campaign.mjs";
import { campaignErrors } from "../scripts/frontier-comparison-format.mjs";
import { HEADLESS_ENGINE, INSTRUMENT_SHA256, attempts, fakeClock, fakeLauncher, registeredOf, scriptedLoad, selfCheck, sha, where } from "./frontier-comparison-campaign-fake.mjs";
import { readProtocol, withResamples } from "./frontier-comparison-synthetic.mjs";

// The orchestrator of the whole comparative campaign (V05-10, `execucao`, part 2), Node only, with a FAKE launcher that plays synthetic executions (tests/frontier-comparison-campaign-fake.mjs):
// the sequence and its balance, the redo of a rejected attempt in its slot by the analysis' own rules, the limit of 3 attempts and the campaign that stops, the wait for a quiet machine, the state
// written after every attempt and the resume, the instrument's self-check as the gate (the Release launcher is in tests/frontier-comparison-release.test.mjs). Nothing runs and nothing here was measured: the real launcher is
// tested by tests/frontier-comparison-campaign-native.test.mjs (`npm run test:frontier-comparison-run`), a short headless rehearsal.
const { protocol, protocolSha256 } = withResamples(readProtocol().protocol, 200);

let scratch = null;
let counter = 0;
before(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "frontier-comparison-campaign-"));
});
after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const lock = () => path.join(scratch, "campaign.lock");
const read = async (out, file) => JSON.parse(await readFile(path.join(out, file), "utf8"));
const exists = (file) => stat(file).then(() => true, () => false);

// Plays a campaign with the fake launcher and the injected clock, load and self-check; returns what the campaign did and the objects that watched it.
async function play({ plan = {}, lanes = ["presented", "unlimited"], slots = null, out = path.join(scratch, `campaign-${counter++}`), launcher = fakeLauncher({ protocol, plan }), check = selfCheck(), load = scriptedLoad([0.5]), clock = fakeClock(), lockFile = lock(), ...rest } = {}) {
  const result = await runCampaign({ launcher, protocol, protocolSha256, out, lanes, slots, runCheck: check, read: load, clock, where, lockFile, ...rest });
  return { result, launcher, check, load, clock, out };
}
const armsOf = (launcher) => launcher.calls.map((call) => call.arm).join("");
const slotRecord = (result, lane, slot) => result.analysis.sections.validity.slots.find((candidate) => candidate.lane === lane && candidate.slot === slot);
const reasonsOf = (attempt) => attempt.reasons.map((reason) => `${reason.rule}:${reason.clause}`);

test("a campaign plays the protocol's sequence in both lanes, once per slot, one process at a time, balanced by position, and its campaign is in the format the analysis reads", async () => {
  const { result, launcher, check, out } = await play();
  assert.equal(result.status, "done");
  assert.deepEqual(result.formatErrors, []);
  // runs.sequence: ABC CAB BCA four times, in the presented lane and then in the unlimited one.
  const sequence = "ABCCABBCA".repeat(4);
  assert.equal(armsOf(launcher), sequence + sequence);
  assert.deepEqual(launcher.calls.map((call) => call.lane), [...Array(36).fill("presented"), ...Array(36).fill("unlimited")]);
  assert.deepEqual(launcher.calls.map((call) => call.slot), [...Array(36).keys(), ...Array(36).keys()].map((slot) => slot + 1));
  assert.ok(launcher.calls.every((call) => call.attempt === 1));
  assert.equal(launcher.concurrent, 1, "no two executions overlap: each is a fresh process that ends before the next begins");
  assert.equal(launcher.cleanups, 1);
  // runs.balance: each arm 12 times and 4 times in each position of a block, in each lane.
  for (const lane of ["presented", "unlimited"]) {
    const positions = { A: [0, 0, 0], B: [0, 0, 0], C: [0, 0, 0] };
    launcher.calls.filter((call) => call.lane === lane).forEach((call, index) => (positions[call.arm][index % 3] += 1));
    assert.deepEqual(positions, { A: [4, 4, 4], B: [4, 4, 4], C: [4, 4, 4] }, lane);
  }
  assert.equal(result.analysis.status, "complete");
  assert.equal(result.analysis.sections.validity.balance.presented.balanced, true);
  assert.deepEqual(result.analysis.sections.validity.totals.presented.C, { planned: 12, accepted: 12, rejected: 0, open: 0, missing: 0, exhausted: 0 });
  assert.deepEqual(campaignErrors(result.campaign, protocol), []);
  assert.deepEqual(result.campaign.instrument, { selfCheckPassed: true, sha256: INSTRUMENT_SHA256 });
  assert.equal(check.runs.length, 1, "the self-check runs once, at the start of the campaign");
  // The state, the raw data of every attempt and the outputs.
  const state = await read(out, "campaign-state.json");
  assert.equal(state.attempts.length, 72);
  assert.ok(state.attempts.every((attempt) => attempt.verdict.accepted && attempt.load.before === 0.9 && attempt.hashes.protocol === protocolSha256));
  assert.equal((await readdir(path.join(out, "raw"))).length, 144);
  assert.ok(await exists(path.join(out, "raw", "unlimited-36-1.json")));
  for (const file of ["campaign.json", "report.json", "summary.json", "campaign-state.json"]) {
    assert.ok(await exists(path.join(out, file)), file);
  }
  assert.ok(!(await exists(path.join(out, "rehearsal.json"))), "only a rehearsal is marked as one");
  assert.deepEqual([state.unreported, result.summary.unreported], [[], []], "every attempt of this campaign wrote a report");
  assert.ok(!(await exists(lock())), "the lock against another campaign is released at the end");
  assert.deepEqual((await readdir(out, { recursive: true })).filter((entry) => entry.endsWith(".tmp")), [], "every file was written atomically: no temporary file is left");
  assert.equal(result.campaign.executions.length, 72);
});

test("a load above the limit, an undrawn presented window and an incomplete window are each rejected with their reason, kept in the raw data and redone in the same slot", async () => {
  const plan = {
    "presented/2/1": attempts.highLoad,
    "presented/3/1": attempts.notPresented,
    "presented/3/2": attempts.incomplete,
    "unlimited/3/1": attempts.notPresented,
  };
  const { result, launcher, out } = await play({ plan, slots: [1, 4] });
  assert.equal(result.status, "done");
  // Each redo takes the place of the rejected attempt: the slots in order, and the attempts of a slot one after the other.
  assert.deepEqual(launcher.calls.map((call) => `${call.lane}/${call.slot}/${call.attempt}`), [
    "presented/1/1", "presented/2/1", "presented/2/2", "presented/3/1", "presented/3/2", "presented/3/3", "presented/4/1",
    "unlimited/1/1", "unlimited/2/1", "unlimited/3/1", "unlimited/4/1",
  ]);
  const presented = (slot) => slotRecord(result, "presented", slot);
  assert.deepEqual(reasonsOf(presented(2).attempts[0]), ["load:before"]);
  assert.equal(presented(2).attempts[0].load.before, 5.3, "the rejected attempt stays with its load reading");
  assert.deepEqual([presented(2).state, presented(2).accepted, presented(2).rejected], ["accepted", 2, 1]);
  assert.deepEqual(reasonsOf(presented(3).attempts[0]), ["not-presented:intent-not-drawn", "not-presented:idle-not-drawn"]);
  assert.deepEqual(reasonsOf(presented(3).attempts[1]), ["incomplete:stress"]);
  assert.deepEqual([presented(3).state, presented(3).accepted, presented(3).rejected], ["accepted", 3, 2]);
  // The same data in the unlimited lane is accepted: not-presented is a rule of the presented lane.
  assert.deepEqual(reasonsOf(slotRecord(result, "unlimited", 3).attempts[0]), []);
  const state = await read(out, "campaign-state.json");
  const rejected = state.attempts.filter((attempt) => !attempt.verdict.accepted);
  assert.deepEqual(rejected.map((attempt) => `${attempt.lane}/${attempt.slot}/${attempt.attempt}`), ["presented/2/1", "presented/3/1", "presented/3/2"]);
  assert.ok(rejected.every((attempt) => attempt.raw !== null && attempt.execution !== null), "a rejected attempt keeps its raw report and its execution");
  for (const attempt of rejected) {
    assert.ok(await exists(path.join(out, attempt.raw)), attempt.raw);
  }
  assert.deepEqual([result.summary.lanes.presented.B.attempts, result.summary.lanes.presented.C.attempts], [2, 4]);
});

test("an error and a process that wrote no report are rejected by the errors rule and redone; the one without a report is in the campaign's unreported, counts in its slot and in the report", async () => {
  const plan = { "presented/3/1": attempts.failing, "presented/4/1": attempts.crashed };
  const { result, out } = await play({ plan, lanes: ["presented"], slots: [1, 5] });
  assert.equal(result.status, "done");
  assert.deepEqual(reasonsOf(slotRecord(result, "presented", 3).attempts[0]), ["errors:scriptErrors", "errors:exitCode"]);
  const state = await read(out, "campaign-state.json");
  const crashed = state.attempts.find((attempt) => attempt.slot === 4 && attempt.attempt === 1);
  assert.deepEqual([crashed.execution, crashed.raw, crashed.verdict.accepted], [null, null, false]);
  // The verdict is the analysis': the clause, whether the process crashed or timed out, and its signal (a process killed by one has no exit code).
  const reason = { rule: "errors", clause: "no-report", crashed: true, timedOut: false, signal: "SIGSEGV" };
  assert.deepEqual(crashed.verdict.reasons, [reason]);
  assert.ok(await exists(path.join(out, crashed.log)), "its log is kept");
  assert.equal(crashed.logSha256, sha("Program crashed\n"), "the SHA-256 of the log kept under raw/");
  assert.equal(state.attempts.find((attempt) => attempt.slot === 4 && attempt.attempt === 2).verdict.accepted, true);
  // campaign.json holds the attempt in `unreported`, with its own number; the redo is attempt 2 of `executions`, and the campaign is in the format with no deviation to say.
  const campaign = await read(out, "campaign.json");
  assert.deepEqual(campaign.unreported, [{ arm: "C", lane: "presented", slot: 4, attempt: 1, load: { before: 0.9, after: 1 }, errors: { crashed: true, timedOut: false, signal: "SIGSEGV" }, logSha256: sha("Program crashed\n") }]);
  assert.deepEqual(campaign.executions.filter((execution) => execution.slot === 4).map((execution) => execution.attempt), [2]);
  assert.deepEqual(result.formatErrors, []);
  assert.doesNotMatch(campaign.provenance.deviations.join("\n"), /wrote no report/);
  // report.json counts the attempt in its slot and its totals, with the reason and no vsync.
  const report = await read(out, "report.json");
  const slot = report.sections.validity.slots.find((candidate) => candidate.lane === "presented" && candidate.slot === 4);
  assert.deepEqual([slot.state, slot.accepted, slot.rejected], ["accepted", 2, 1]);
  assert.deepEqual(slot.attempts.map((attempt) => [attempt.attempt, attempt.reported, attempt.status]), [[1, false, "rejected"], [2, true, "accepted"]]);
  assert.deepEqual(slot.attempts[0].reasons, [reason]);
  assert.ok(!("vsync" in slot.attempts[0]));
  assert.equal(report.sections.validity.totals.presented.C.rejected, 2, "the error of slot 3 and the attempt without a report of slot 4, both of arm C");
  assert.deepEqual(slot, slotRecord(result, "presented", 4));
  // The state and the summary list the same attempt, with the reasons of the report, the exit code and signal as the launcher read them, and the log.
  const listed = { lane: "presented", slot: 4, arm: "C", attempt: 1, reasons: [reason], exitCode: -1, signal: "SIGSEGV", log: "raw/presented-4-1.log" };
  assert.deepEqual(state.unreported, [listed]);
  assert.deepEqual(result.summary.unreported, [listed]);
  assert.deepEqual((await read(out, "summary.json")).unreported, [listed]);
  assert.deepEqual([listed.lane, listed.slot, listed.attempt], [slot.lane, slot.slot, slot.attempts[0].attempt], "the report and the summary count the same attempt");
});

test("a process that timed out and one that exited 0 without a report are unreported too, each with how it ended", async () => {
  const plan = { "presented/2/1": attempts.timedOut, "presented/3/1": attempts.silent };
  const { result, out } = await play({ plan, lanes: ["presented"], slots: [1, 4] });
  assert.equal(result.status, "done");
  assert.deepEqual(result.formatErrors, []);
  const campaign = await read(out, "campaign.json");
  assert.deepEqual(campaign.unreported.map((entry) => [entry.slot, entry.attempt, entry.errors]), [
    [2, 1, { crashed: true, timedOut: true, signal: "SIGTERM" }],
    [3, 1, { crashed: false, timedOut: false, exitCode: 0 }],
  ]);
  assert.deepEqual(slotRecord(result, "presented", 2).attempts[0].reasons, [{ rule: "errors", clause: "no-report", crashed: true, timedOut: true, signal: "SIGTERM" }]);
  assert.deepEqual(slotRecord(result, "presented", 3).attempts[0].reasons, [{ rule: "errors", clause: "no-report", crashed: false, timedOut: false, exitCode: 0 }]);
  assert.deepEqual([slotRecord(result, "presented", 2).accepted, slotRecord(result, "presented", 3).accepted], [2, 2], "each is redone in its slot");
  assert.deepEqual(result.summary.unreported.map((entry) => [entry.slot, entry.attempt, entry.exitCode, entry.signal]), [[2, 1, -1, "SIGTERM"], [3, 1, 0, null]]);
});

test("a process killed while it wrote its report (a file that is not JSON) is unreported too, and its log says where the launcher kept the file", async () => {
  const { result, out } = await play({ plan: { "presented/2/1": attempts.unreadableReport }, lanes: ["presented"], slots: [1, 3] });
  assert.equal(result.status, "done");
  assert.deepEqual(result.formatErrors, []);
  const campaign = await read(out, "campaign.json");
  assert.deepEqual(campaign.unreported.map((entry) => [entry.slot, entry.attempt, entry.errors]), [[2, 1, { crashed: true, timedOut: false, signal: "SIGKILL" }]]);
  assert.deepEqual(slotRecord(result, "presented", 2).attempts[0].reasons, [{ rule: "errors", clause: "no-report", crashed: true, timedOut: false, signal: "SIGKILL" }]);
  assert.equal(slotRecord(result, "presented", 2).accepted, 2, "it is redone in its slot");
  const attempt = (await read(out, "campaign-state.json")).attempts.find((candidate) => candidate.slot === 2 && candidate.attempt === 1);
  assert.deepEqual([attempt.raw, attempt.execution], [null, null]);
  const log = await readFile(path.join(out, attempt.log), "utf8");
  assert.match(log, /^FRONTIER_COMPARISON_REPORT_UNREADABLE: \/tmp\/run-B-presented\.unreadable\.json \(Unexpected end of JSON input\)$/m);
  assert.equal(attempt.logSha256, sha(log));
});

test("three attempts that wrote no report in a slot stop the campaign by the attempts rule of the analysis, as three rejected executions do", async () => {
  const plan = { "presented/4/1": attempts.crashed, "presented/4/2": attempts.timedOut, "presented/4/3": attempts.silent };
  const { result, launcher, out } = await play({ plan });
  assert.equal(result.status, "stopped");
  assert.equal(launcher.calls.length, 6, "slots 1 to 3, then the three attempts of slot 4, and nothing after them");
  // The same stop, in the same shape, as the one that three rejected executions give: the analysis' alone, listed once.
  const stop = { rule: "attempts", lane: "presented", slot: 4, arm: "C", attempts: 3, limit: 3 };
  assert.deepEqual(result.state.stopped, [stop]);
  assert.deepEqual((await read(out, "campaign-state.json")).stopped, [stop]);
  assert.deepEqual(result.analysis.why, [stop]);
  assert.equal(result.analysis.status, "stopped");
  assert.equal(slotRecord(result, "presented", 4).state, "exhausted");
  const campaign = await read(out, "campaign.json");
  assert.deepEqual(campaign.unreported.map((entry) => entry.attempt), [1, 2, 3]);
  assert.deepEqual(campaign.executions.filter((execution) => execution.slot === 4), []);
  assert.deepEqual(result.formatErrors, []);
  assert.equal(result.summary.unreported.length, 3);
  assert.deepEqual(result.summary.stopped, [stop]);
});

test("three rejected attempts in a slot stop the campaign: the later slots do not run, the stop is recorded and the analysis produces no statistic", async () => {
  const plan = { "presented/4/1": attempts.highLoad, "presented/4/2": attempts.highLoad, "presented/4/3": attempts.highLoad };
  const { result, launcher, out } = await play({ plan });
  assert.equal(result.status, "stopped");
  assert.equal(launcher.calls.length, 6, "slots 1 to 3, then the three attempts of slot 4, and nothing after them");
  assert.deepEqual(launcher.calls.slice(3).map((call) => [call.slot, call.attempt]), [[4, 1], [4, 2], [4, 3]]);
  const stop = { rule: "attempts", lane: "presented", slot: 4, arm: "C", attempts: 3, limit: 3 };
  assert.deepEqual(result.state.stopped, [stop]);
  assert.deepEqual((await read(out, "campaign-state.json")).stopped, [stop]);
  assert.equal(result.analysis.status, "stopped");
  assert.deepEqual(result.analysis.why, [stop]);
  assert.equal(slotRecord(result, "presented", 4).state, "exhausted");
  assert.ok(!launcher.calls.some((call) => call.lane === "unlimited"));
  assert.equal(result.summary.status, "stopped");
});

test("the other game once is redone; the second time in the same arm stops the campaign", async () => {
  // Arm B is the slots 2, 6, 7, ... of the sequence.
  const plan = { "presented/2/1": attempts.otherGame, "presented/6/1": attempts.otherGame };
  const { result, launcher } = await play({ plan });
  assert.equal(result.status, "stopped");
  assert.deepEqual(result.state.stopped, [{ rule: "other-game", arm: "B", rejected: 2 }]);
  assert.deepEqual(launcher.calls.map((call) => `${call.slot}/${call.attempt}`), ["1/1", "2/1", "2/2", "3/1", "4/1", "5/1", "6/1"], "the first is redone in its slot, the repeat in the arm stops it at once");
  assert.deepEqual(reasonsOf(slotRecord(result, "presented", 2).attempts[0]), ["other-game:replay"]);
  assert.equal(slotRecord(result, "presented", 2).state, "accepted");
});

test("a scenario that waited with numbers other than the protocol's stops the campaign, chosen by the problem's code, and the analysis alone would not have seen it", async () => {
  const { result, launcher } = await play({ plan: { "presented/2/1": attempts.otherWaits }, lanes: ["presented"], slots: [1, 4] });
  assert.equal(result.status, "stopped");
  assert.equal(launcher.calls.length, 2);
  assert.deepEqual(result.state.stopped.map((stop) => [stop.rule, stop.slot, stop.attempt, stop.problems.map((problem) => problem.code)]), [["scenario-config", 2, 1, ["config-waits"]]]);
  assert.match(result.state.stopped[0].problems[0].message, /^waits: the scenario waited with/);
  assert.equal(slotRecord(result, "presented", 2).state, "accepted", "no rule of the analysis rejects it");
});

test("a protocol whose load limit is not a finite positive number is refused before anything runs, because the wait could never tell a quiet machine", async () => {
  const limits = [[(load) => delete load.limit1MinuteAverage, "missing"], [(load) => (load.limit1MinuteAverage = "2"), '"2"'], [(load) => (load.limit1MinuteAverage = 0), "0"], [(load) => (load.limit1MinuteAverage = -1), "-1"], [(load) => (load.limit1MinuteAverage = null), "null"]];
  for (const [change, shown] of limits) {
    const mutated = structuredClone(protocol);
    change(mutated.runs.load);
    const launcher = fakeLauncher({ protocol });
    const out = path.join(scratch, `bad-limit-${counter++}`);
    await assert.rejects(play({ protocol: mutated, launcher, out }), (error) => error.message.includes("runs.load.limit1MinuteAverage is not a finite positive number") && error.message.includes(`(${shown})`));
    assert.equal(launcher.calls.length, 0, `${shown}: no process was started`);
    assert.ok(!(await exists(out)), `${shown}: nothing was written`);
    assert.ok(!(await exists(lock())), `${shown}: the lock was never taken`);
  }
});

test("the wait for the load reads it every few seconds until it is under the limit, records the wait, and a wait that runs out lets the attempt run to be judged by the rule", async () => {
  const quiet = await play({ lanes: ["presented"], slots: [1, 2], load: scriptedLoad([3, 2.5, 1.5]), maxWaitSeconds: 600 });
  const [first, second] = (await read(quiet.out, "campaign-state.json")).attempts;
  assert.deepEqual(first.waited, { limit: 2, maxWaitSeconds: 600, intervalSeconds: 5, first: 3, last: 1.5, polls: 3, seconds: 10, timedOut: false });
  assert.deepEqual([second.waited.polls, second.waited.seconds], [1, 0], "the next attempt finds the machine quiet at once");
  assert.equal(quiet.clock.slept, 10000);
  // The machine stays busy: the wait gives up after the time it was given and the attempt runs anyway; its own readings (before and after the process) are what the rule judges.
  const busy = await play({ lanes: ["presented"], slots: [1, 1], load: scriptedLoad([9]), maxWaitSeconds: 12, plan: { "presented/1/1": attempts.highLoad } });
  const state = await read(busy.out, "campaign-state.json");
  assert.deepEqual(state.attempts.map((attempt) => [attempt.waited.timedOut, attempt.waited.polls, attempt.waited.seconds, attempt.verdict.accepted]), [[true, 4, 12, false], [true, 4, 12, true]]);
  assert.equal(busy.clock.slept, 24000);
  assert.deepEqual(reasonsOf(slotRecord(busy.result, "presented", 1).attempts[0]), ["load:before"]);
  // No time to wait at all: one reading, and go on.
  const none = await play({ lanes: ["presented"], slots: [1, 1], load: scriptedLoad([9]), maxWaitSeconds: 0 });
  assert.deepEqual([none.clock.slept, none.load.count()], [0, 1]);
});

test("a campaign interrupted after the k-th attempt, or twice, resumes from the first open slot and ends as a campaign that was never interrupted", async () => {
  // A rejected load in the presented lane, a process that crashes and a repeat of the other game, to have a state with every kind of attempt in it. Every campaign is played in the same
  // directory one after the other (the record names where its raw data are), and the files of the uninterrupted one are kept in memory.
  const plan = { "presented/2/1": attempts.highLoad, "presented/6/1": attempts.crashed, "unlimited/4/1": attempts.otherGame };
  const out = path.join(scratch, "interrupted");
  const outputs = ["campaign.json", "report.json", "summary.json", "campaign-state.json"];
  const whole = await play({ plan, out });
  const kept = Object.fromEntries(await Promise.all(outputs.map(async (file) => [file, await readFile(path.join(out, file), "utf8")])));
  assert.equal(whole.result.state.attempts.length, 75, "36 slots in each lane, one redo of the load, one of the crash, one of the other game");
  const sameAsWhole = async (resumes) => {
    assert.equal(await readFile(path.join(out, "campaign.json"), "utf8"), kept["campaign.json"], "the same campaign, byte for byte");
    assert.equal(await readFile(path.join(out, "report.json"), "utf8"), kept["report.json"], "and the same report");
    const [was, now] = [JSON.parse(kept["campaign-state.json"]), await read(out, "campaign-state.json")];
    assert.deepEqual(now.attempts, was.attempts);
    assert.deepEqual(now.resumes.map((resume) => resume.attempts), resumes);
    assert.deepEqual({ ...(await read(out, "summary.json")), resumes: 0 }, JSON.parse(kept["summary.json"]));
  };
  // Killed after the k-th attempt: in the middle of a redo (2), after the first slot (1), right after the process that wrote no report (7), at the end of the presented lane (38) and one before the end (74).
  for (const k of [1, 2, 7, 38, 74]) {
    await rm(out, { recursive: true });
    await assert.rejects(play({ plan, out, launcher: fakeLauncher({ protocol, plan, interruptBefore: k }) }), /simulated interruption/);
    const saved = await read(out, "campaign-state.json");
    assert.equal(saved.attempts.length, k, "the state of the attempt that was last written is on disk when the process dies");
    assert.ok(!(await exists(path.join(out, "campaign.json"))), "an interrupted campaign has no campaign yet");
    const launcher = fakeLauncher({ protocol, plan });
    const resumed = await play({ plan, out, resume: true, launcher });
    // The first open slot is the one after the last attempt written, except when that attempt was rejected: then it is its redo, with the next number.
    const last = saved.attempts[k - 1];
    const lastOfLane = last.slot === 36;
    const expected = !last.verdict.accepted ? [last.lane, last.slot] : lastOfLane ? ["unlimited", 1] : [last.lane, last.slot + 1];
    assert.deepEqual([launcher.calls[0].lane, launcher.calls[0].slot], expected, `after ${k} attempts`);
    assert.equal(launcher.calls.length, 75 - k);
    assert.equal(resumed.result.status, "done");
    assert.equal(resumed.check.runs.length, 0, "the self-check that passed is not repeated");
    await sameAsWhole([k]);
  }
  // Killed before the 4th launch, and again 36 launches after the resume.
  await rm(out, { recursive: true });
  await assert.rejects(play({ plan, out, launcher: fakeLauncher({ protocol, plan, interruptBefore: 3 }) }), /simulated interruption/);
  await assert.rejects(play({ plan, out, resume: true, launcher: fakeLauncher({ protocol, plan, interruptBefore: 36 }) }), /simulated interruption/);
  assert.equal((await read(out, "campaign-state.json")).attempts.length, 39);
  const launcher = fakeLauncher({ protocol, plan });
  const resumed = await play({ plan, out, resume: true, launcher });
  assert.deepEqual(launcher.calls[0], { arm: "B", lane: "unlimited", slot: 2, attempt: 1 }, "the second slot of the unlimited lane");
  assert.equal(resumed.result.status, "done");
  await sameAsWhole([3, 39]);
});

test("a campaign is not resumed if the protocol, the script, the binary, the package or the instrument has another hash, or the options are not the same; nothing runs and the state stays as it was", async () => {
  const out = path.join(scratch, "to-resume");
  await assert.rejects(play({ out, launcher: fakeLauncher({ protocol, interruptBefore: 2 }) }), /simulated interruption/);
  const saved = await readFile(path.join(out, "campaign-state.json"), "utf8");
  const changed = (change) => {
    const registration = registeredOf();
    change(registration);
    return fakeLauncher({ protocol, registration });
  };
  const refusals = [
    [{ launcher: changed((r) => (r.arms.B.binarySha256 = sha("another binary"))) }, /arm B binary: the state registered/],
    [{ launcher: changed((r) => (r.arms.C.packageSha256 = sha("another package"))) }, /arm C package: the state registered/],
    [{ launcher: changed((r) => (r.arms.A.scriptSha256 = sha("another script"))) }, /arm A script: the state registered/],
    [{ launcher: changed((r) => (r.instrumentSha256 = sha("another instrument"))) }, /instrument: the state registered/],
    [{ launcher: changed((r) => (r.replayGoldenHash = "d".repeat(64))) }, /replayGoldenHash: the state registered/],
    [{ lanes: ["presented"] }, /options: the state ran with/],
    [{ slots: [1, 3] }, /options: the state ran with/],
  ];
  for (const [change, message] of refusals) {
    const { launcher: own, ...options } = change;
    const launcher = own ?? fakeLauncher({ protocol });
    await assert.rejects(play({ out, resume: true, launcher, ...options }), message);
    assert.equal(launcher.calls.length, 0, "no process was started");
    assert.equal(await readFile(path.join(out, "campaign-state.json"), "utf8"), saved, "the state was not touched");
  }
  // The protocol's file has another hash.
  await assert.rejects(runCampaign({ launcher: fakeLauncher({ protocol }), protocol, protocolSha256: sha("another protocol"), out, lanes: ["presented", "unlimited"], resume: true, runCheck: selfCheck(), read: scriptedLoad([0.5]), clock: fakeClock(), where, lockFile: lock() }), /protocol: the state ran under/);
  // The state is neither overwritten by a new campaign nor needed by a first one.
  await assert.rejects(play({ out }), /campaign-state\.json exists: continue that campaign with --resume/);
  await assert.rejects(play({ out: path.join(scratch, "never-started"), resume: true }), /--resume: there is no campaign to continue/);
});

test("the self-check is the gate: if it fails nothing runs, the stop is recorded, and a resume repeats it until it passes", async () => {
  const out = path.join(scratch, "blocked");
  const failing = selfCheck({ passed: false });
  const { result, launcher } = await play({ out, check: failing });
  assert.equal(result.status, "stopped");
  assert.equal(launcher.calls.length, 0, "no execution runs without the instrument's self-check");
  assert.deepEqual(result.state.stopped, [{ rule: "instrument", selfCheckPassed: false, unchangedAfterSelfCheck: true }]);
  assert.equal(result.state.selfCheck.passed, false);
  assert.equal(result.campaign.instrument.selfCheckPassed, false);
  assert.equal(result.analysis.status, "stopped");
  assert.equal(result.analysis.sections.validity.stopped[0].rule, "instrument");
  // The protocol: no comparative execution counts until it is repeated and passed.
  const passing = selfCheck();
  const resumed = await play({ out, resume: true, check: passing, lanes: ["presented", "unlimited"], slots: null });
  assert.equal(passing.runs.length, 1);
  assert.equal(resumed.result.status, "done");
  assert.equal(resumed.launcher.calls.length, 72);
  assert.deepEqual(passing.runs[0].outDirectory, path.join(out, "self-check"));
  assert.equal(passing.runs[0].engine, "fake-engine");
});

test("an engine or a renderer other than the one the self-check ran on stops the campaign", async () => {
  const other = { ...HEADLESS_ENGINE, godot: "4.7.2.stable.other", godotHash: "other", renderingMethod: "forward_plus" };
  const { result, launcher } = await play({ lanes: ["presented"], slots: [1, 3], check: selfCheck({ provenance: other }) });
  assert.equal(result.status, "stopped");
  assert.equal(launcher.calls.length, 1);
  assert.deepEqual(result.state.stopped, [{ rule: "instrument", clause: "other-engine", differs: ["godot", "godotHash", "renderingMethod"] }]);
});

test("the self-check runs in the lane the launcher runs in: a window for a launcher that opens one, headless for one that does not, and a check in the other lane is not the campaign's renderer", async () => {
  // A launcher that runs in a window is checked in a window, and then says nothing of a headless check.
  const windowed = await play({ lanes: ["presented"], slots: [1, 2], launcher: fakeLauncher({ protocol, windowed: true }) });
  assert.equal(windowed.result.status, "done");
  assert.deepEqual(windowed.check.runs.map((request) => request.windowed), [true]);
  assert.equal(windowed.result.state.selfCheck.lane, "windowed");
  assert.ok(!windowed.result.campaign.provenance.deviations.join("\n").includes("self-check ran headless"));
  // A launcher that runs headless is checked headless, and the campaign says what that leaves out.
  const headless = await play({ lanes: ["presented"], slots: [1, 2] });
  assert.deepEqual(headless.check.runs.map((request) => request.windowed), [false]);
  assert.match(headless.result.campaign.provenance.deviations.join("\n"), /self-check ran headless, because the launcher runs headless; a campaign proper runs in a window/);
  // A headless check cannot vouch for a window: the display server, the driver and the adapter differ, and the campaign stops after its first attempt.
  const mismatched = await play({ lanes: ["presented"], slots: [1, 2], launcher: fakeLauncher({ protocol, windowed: true }), check: selfCheck({ provenance: HEADLESS_ENGINE }) });
  assert.equal(mismatched.result.status, "stopped");
  assert.equal(mismatched.launcher.calls.length, 1);
  assert.deepEqual(mismatched.result.state.stopped, [{ rule: "instrument", clause: "other-engine", differs: ["displayServer", "renderingDriver", "adapter"] }]);
});

test("the unlimited lane whose vsync does not read back DISABLED is N/A and is not run further, and says so", async () => {
  const { result, launcher } = await play({ plan: { "unlimited/1/1": attempts.vsyncEnabled }, slots: [1, 3] });
  assert.equal(result.status, "done");
  assert.deepEqual(launcher.calls.map((call) => `${call.lane}/${call.slot}`), ["presented/1", "presented/2", "presented/3", "unlimited/1"]);
  assert.equal(slotRecord(result, "unlimited", 1).state, "accepted", "vsync-reading is not an invalid execution");
  assert.match(result.campaign.provenance.deviations.join("\n"), /lane unlimited is N\/A and was not run further: the vsync mode read back ENABLED, not DISABLED/);
  assert.deepEqual(result.formatErrors, []);
});

test("a rehearsal redoes nothing, is marked as one and says in its deviations that it is not a result", async () => {
  const { result, launcher, out } = await play({ plan: { "presented/1/1": attempts.highLoad }, lanes: ["presented"], slots: [1, 3], rehearsal: true, assumeRefreshHz: 60 });
  assert.equal(result.status, "done");
  assert.equal(launcher.calls.length, 3, "the rejected attempt of slot 1 is not redone");
  assert.match(result.campaign.provenance.deviations[0], /^REHEARSAL: not a comparative execution/);
  assert.match(result.campaign.provenance.deviations.join("\n"), /a rehearsal does not redo/);
  assert.match(result.campaign.provenance.deviations.join("\n"), /only the slots 1 to 3 of the 36 of each lane were run/);
  const sidecar = await read(out, "rehearsal.json");
  assert.equal(sidecar.rehearsal, true);
  assert.equal(sidecar.campaign, "campaign.json");
  assert.deepEqual(sidecar.provenance.readCosts.statsUsec, { B: 0.86, C: 4.5 });
  assert.ok(!("rehearsal" in result.campaign), "the campaign is strictly in the format: the mark is beside it");
  assert.equal(slotRecord(result, "presented", 1).state, "open");
});

test("the command line: --build debug and --slots are for a rehearsal, the numbers are checked, and a campaign needs its build and its directory", () => {
  const ok = (...argv) => parseArguments(["--campaign", ...argv], protocol);
  const defaults = ok("--build", "release", "--out", "/tmp/campaign", "--exports", "/tmp/exports");
  assert.deepEqual([defaults.lanes, defaults.build, defaults.out, defaults.exports, defaults.resume, defaults.rehearsal, defaults.slots, defaults.maxWaitSeconds], [["presented", "unlimited"], "release", "/tmp/campaign", "/tmp/exports", false, false, null, 1800]);
  const rehearsal = ok("--lanes", "presented", "--build", "debug", "--rehearsal", "--slots", "1-3", "--assume-refresh-hz", "60", "--max-wait", "0", "--out", "/tmp/rehearsal");
  assert.deepEqual([rehearsal.lanes, rehearsal.slots, rehearsal.assumeRefreshHz, rehearsal.maxWaitSeconds, rehearsal.rehearsal], [["presented"], [1, 3], 60, 0, true]);
  assert.equal(ok("--build", "release", "--out", "/tmp/campaign", "--exports", "/tmp/exports", "--resume").resume, true);
  assert.throws(() => parseArguments(["--build", "release", "--out", "x"], protocol), /use --campaign/);
  assert.throws(() => ok("--build", "debug", "--out", "x"), /--build debug is only for a rehearsal/);
  assert.throws(() => ok("--build", "release", "--out", "x", "--slots", "1-3"), /--slots limits the slots of a rehearsal/);
  assert.throws(() => ok("--build", "release", "--out", "x", "--assume-refresh-hz", "60"), /only for a rehearsal/);
  assert.throws(() => ok("--build", "debug", "--rehearsal", "--out", "x", "--assume-refresh-hz", "0"), /positive number/);
  assert.throws(() => ok("--build", "debug", "--rehearsal", "--out", "x", "--slots", "3-1"), /the slots of a lane are 1 to 36/);
  assert.throws(() => ok("--build", "debug", "--rehearsal", "--out", "x", "--slots", "1-37"), /the slots of a lane are 1 to 36/);
  assert.throws(() => ok("--build", "debug", "--rehearsal", "--out", "x", "--slots", "all"), /takes a slot or a range/);
  assert.throws(() => ok("--build", "release", "--out", "x", "--max-wait", "-1"), /seconds, 0 or more/);
  assert.throws(() => ok("--build", "release"), /use --out/);
  assert.throws(() => ok("--out", "x"), /use --build release\|debug/);
  assert.throws(() => ok("--build", "release", "--out", "x", "--windowed"), /unknown argument --windowed/);
  assert.throws(() => ok("--build", "release", "--out"), /--out takes a value/);
});

test("a file is written whole or not at all", async () => {
  const file = path.join(scratch, "atomic.json");
  await writeAtomic(file, "one\n");
  await writeAtomic(file, "two\n");
  assert.equal(await readFile(file, "utf8"), "two\n");
  await assert.rejects(writeAtomic(path.join(scratch, "missing", "atomic.json"), "three\n"), /ENOENT/);
  assert.deepEqual((await readdir(scratch)).filter((entry) => entry.endsWith(".tmp")), []);
});
