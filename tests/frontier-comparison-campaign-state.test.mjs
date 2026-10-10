import assert from "node:assert/strict";
import test from "node:test";
import { defaultClock, waitForLoad } from "../scripts/frontier-comparison-campaign-load.mjs";
import {
  campaignExecutions, engineDifferences, engineOf, nextStep, optionsErrors, parseSlots, planOf, resumeProblems, stopsOf, unavailableLanes, unreportedEntries,
} from "../scripts/frontier-comparison-campaign-state.mjs";
import { fakeClock, registeredOf, scriptedLoad, sha } from "./frontier-comparison-campaign-fake.mjs";
import { readProtocol } from "./frontier-comparison-synthetic.mjs";

// The pure parts of the comparative campaign (V05-10, `execucao`, part 2): the plan, the next step of the state machine on states written by hand, what a state makes of its attempts, the
// resume's checks and the wait for the load, with a clock and a load average that the test controls. Nothing runs and nothing is read from a file but the protocol. The whole campaign
// against a fake launcher is tests/frontier-comparison-campaign.test.mjs.
const { protocol } = readProtocol();

// A state with the attempts written by hand: `[lane, slot, attempt, accepted, extra]`. The execution is a stub with the one field the state machine reads (the vsync mode).
function stateOf(entries, { rehearsal = false, lanes = ["presented", "unlimited"], slots = null } = {}) {
  return {
    rehearsal,
    options: { lanes, slots },
    attempts: entries.map(([lane, slot, attempt, accepted, extra = {}]) => ({
      lane, slot, attempt, configProblems: [], execution: { vsync: { mode: "ENABLED" } }, verdict: { accepted, reasons: [] }, ...extra,
    })),
    selfCheck: null,
    scenarioEngine: null,
  };
}
const noStops = { stopped: [] };

test("the plan is the protocol's sequence in each lane in turn, limited to the slots asked for", () => {
  const plan = planOf(protocol, { lanes: ["presented", "unlimited"], slots: null });
  assert.equal(plan.length, 72);
  assert.deepEqual(plan.slice(0, 4).map((entry) => `${entry.lane}/${entry.slot}/${entry.arm}/${entry.block}.${entry.position}`), ["presented/1/A/0.0", "presented/2/B/0.1", "presented/3/C/0.2", "presented/4/C/1.0"]);
  assert.deepEqual(plan.slice(35, 38).map((entry) => `${entry.lane}/${entry.slot}`), ["presented/36", "unlimited/1", "unlimited/2"]);
  assert.deepEqual(planOf(protocol, { lanes: ["unlimited"], slots: [2, 3] }).map((entry) => `${entry.lane}/${entry.slot}/${entry.arm}`), ["unlimited/2/B", "unlimited/3/C"]);
  assert.deepEqual([parseSlots("3", 36), parseSlots("1-3", 36), parseSlots("10-36", 36)], [[3, 3], [1, 3], [10, 36]]);
  assert.deepEqual(optionsErrors(protocol, { lanes: ["presented", "windowed", "presented"], slots: [1, 40] }), ["--lanes: windowed is not a lane of the protocol (presented, unlimited)", "--lanes: name each lane once", "--slots: the protocol has 36 slots in a lane"]);
});

test("the next step is the first slot without an accepted attempt: its redo before the next slot, no redo in a rehearsal", () => {
  const next = (state, validity = noStops) => nextStep(state, protocol, validity);
  assert.deepEqual(next(stateOf([])), { kind: "launch", lane: "presented", slot: 1, arm: "A", block: 0, position: 0, attempt: 1 });
  assert.deepEqual(next(stateOf([["presented", 1, 1, true]])), { kind: "launch", lane: "presented", slot: 2, arm: "B", block: 0, position: 1, attempt: 1 });
  const redo = next(stateOf([["presented", 1, 1, true], ["presented", 2, 1, false]]));
  assert.deepEqual([redo.kind, redo.slot, redo.attempt], ["launch", 2, 2]);
  const rehearsal = next(stateOf([["presented", 1, 1, false]], { rehearsal: true }));
  assert.deepEqual([rehearsal.kind, rehearsal.slot, rehearsal.attempt], ["launch", 2, 1]);
  assert.deepEqual(next(stateOf([["presented", 1, 1, false], ["presented", 2, 1, true], ["presented", 3, 1, true]], { rehearsal: true, lanes: ["presented"], slots: [1, 3] })), { kind: "done" });
  // The lane after the first one begins when the first one is whole.
  const whole = Array.from({ length: 36 }, (_, index) => ["presented", index + 1, 1, true]);
  assert.deepEqual(next(stateOf(whole)), { kind: "launch", lane: "unlimited", slot: 1, arm: "A", block: 0, position: 0, attempt: 1 });
});

test("the analysis' stops stop it, a slot whose attempts are used up is the analysis' stop alone, and what the analysis cannot see stops it too", () => {
  const analysisStop = { rule: "other-game", arm: "B", rejected: 2 };
  assert.deepEqual(nextStep(stateOf([]), protocol, { stopped: [analysisStop] }), { kind: "stopped", why: [analysisStop] });
  // Three attempts in a slot, the first of which wrote no report: the campaign holds all three (the first in `unreported`), so the analysis counts them and stops it. The state adds no stop
  // of its own for the attempts (tests/frontier-comparison-campaign.test.mjs plays three attempts without a report to the stop of the analysis).
  const used = stateOf([["presented", 1, 1, false, { execution: null }], ["presented", 1, 2, false], ["presented", 1, 3, false]]);
  assert.deepEqual(stopsOf(used, protocol, noStops), []);
  const stop = { rule: "attempts", lane: "presented", slot: 1, arm: "A", attempts: 3, limit: 3 };
  assert.deepEqual(stopsOf(used, protocol, { stopped: [stop] }), [stop], "the analysis' stop is the only one");
  assert.deepEqual(nextStep(used, protocol, { stopped: [stop] }), { kind: "stopped", why: [stop] });
  // The scenario waited with other numbers than the protocol's.
  const problem = { code: "config-waits", message: "waits: the scenario waited with {}" };
  const wrong = stateOf([["presented", 1, 1, true, { configProblems: [problem] }]]);
  assert.deepEqual(stopsOf(wrong, protocol, noStops), [{ rule: "scenario-config", lane: "presented", slot: 1, attempt: 1, problems: [problem] }]);
  // An engine or a display other than the self-check's: the gate asks for the engine and the renderer of the campaign.
  const engine = { godot: "4.7.2", godotHash: "h", architecture: "arm64", displayServer: "macOS", renderingDriver: "opengl3", renderingMethod: "gl_compatibility", adapter: "GPU" };
  const other = { ...stateOf([]), selfCheck: { provenance: { ...engine, godotHash: "other", displayServer: "headless", renderingDriver: "dummy" } }, scenarioEngine: engineOf(engine) };
  assert.deepEqual(stopsOf(other, protocol, noStops), [{ rule: "instrument", clause: "other-engine", differs: ["godotHash", "displayServer", "renderingDriver"] }]);
  assert.deepEqual(engineDifferences(engineOf(engine), engineOf({ ...engine, extra: 1 })), []);
});

test("the unlimited lane is N/A from the first attempt whose vsync did not read back DISABLED, and its slots do not run", () => {
  const state = stateOf([["presented", 1, 1, true, { execution: { vsync: { mode: "ENABLED" } } }], ["unlimited", 1, 1, false, { execution: { vsync: { mode: "ENABLED" } } }]], { slots: [1, 2] });
  assert.deepEqual(unavailableLanes(state, protocol), { unlimited: { slot: 1, attempt: 1, mode: "ENABLED", required: "DISABLED" } });
  const next = nextStep(state, protocol, noStops);
  assert.deepEqual([next.kind, next.lane, next.slot], ["launch", "presented", 2], "the presented lane goes on");
  const done = stateOf([...state.attempts.map((attempt) => [attempt.lane, attempt.slot, attempt.attempt, attempt.verdict.accepted, { execution: attempt.execution }]), ["presented", 2, 1, true]], { slots: [1, 2] });
  assert.deepEqual(nextStep(done, protocol, noStops), { kind: "done" });
  assert.deepEqual(unavailableLanes(stateOf([["unlimited", 1, 1, true, { execution: { vsync: { mode: "DISABLED" } } }]]), protocol), {});
});

test("the executions of a campaign are the attempts that have one, in the order they ran, each with the number of its attempt; the others are the entries of its unreported", () => {
  const state = stateOf([
    ["presented", 1, 1, false, { arm: "A", execution: null, load: { before: 0.9, after: 1 }, crashed: true, timedOut: false, exitCode: -1, signal: "SIGSEGV", logSha256: sha("log 1") }],
    ["presented", 1, 2, false, { execution: { id: "second", attempt: 2 } }],
    ["presented", 2, 1, false, { arm: "B", execution: null, load: { before: 5.3, after: 1 }, crashed: false, timedOut: false, exitCode: 0, signal: null, logSha256: sha("log 2") }],
    ["presented", 2, 2, true, { execution: { id: "other slot", attempt: 2 } }],
    ["presented", 1, 3, true, { execution: { id: "third", attempt: 3 } }],
    ["unlimited", 3, 1, false, { arm: "C", execution: null, load: { before: 1, after: 1 }, crashed: true, timedOut: true, exitCode: -1, signal: "SIGTERM", logSha256: sha("log 3") }],
  ]);
  assert.deepEqual(campaignExecutions(state), [{ id: "second", attempt: 2 }, { id: "other slot", attempt: 2 }, { id: "third", attempt: 3 }], "no renumbering: an attempt keeps its own number");
  // A process killed by a signal has no exit code, one that exited has no signal.
  assert.deepEqual(unreportedEntries(state), [
    { arm: "A", lane: "presented", slot: 1, attempt: 1, load: { before: 0.9, after: 1 }, errors: { crashed: true, timedOut: false, signal: "SIGSEGV" }, logSha256: sha("log 1") },
    { arm: "B", lane: "presented", slot: 2, attempt: 1, load: { before: 5.3, after: 1 }, errors: { crashed: false, timedOut: false, exitCode: 0 }, logSha256: sha("log 2") },
    { arm: "C", lane: "unlimited", slot: 3, attempt: 1, load: { before: 1, after: 1 }, errors: { crashed: true, timedOut: true, signal: "SIGTERM" }, logSha256: sha("log 3") },
  ]);
});

test("a resume checks the hashes of the protocol, the script, the binary and the package, what was registered, and the options", () => {
  const registered = registeredOf();
  const state = { protocolSha256: sha("protocol"), rehearsal: false, options: { lanes: ["presented"], slots: null, build: "release", assumeRefreshHz: null }, launcher: { registered } };
  const same = { protocolSha256: sha("protocol"), launcher: { build: "release", registered: registeredOf() }, options: { lanes: ["presented"], slots: null, rehearsal: false, assumeRefreshHz: null } };
  assert.deepEqual(resumeProblems(state, same), []);
  const changed = registeredOf();
  changed.arms.A.binarySha256 = sha("x");
  changed.arms.B.packageSha256 = sha("y");
  changed.arms.C.scriptSha256 = sha("z");
  changed.instrumentSha256 = sha("w");
  const problems = resumeProblems(state, { ...same, protocolSha256: sha("another"), launcher: { build: "debug", registered: changed }, options: { ...same.options, rehearsal: true } });
  assert.deepEqual(problems.map((problem) => problem.split(":")[0]), ["protocol", "options", "instrument", "arm A binary", "arm B package", "arm C script"]);
});

test("the wait for the load stops at the first reading under the limit, gives up when the time is spent, and the limit itself is quiet enough", async () => {
  const wait = (values, maxWaitSeconds, clock = fakeClock()) => waitForLoad({ read: scriptedLoad(values), clock, limit: 2, maxWaitSeconds, intervalSeconds: 5 }).then((result) => ({ result, clock }));
  const quiet = await wait([2], 60);
  assert.deepEqual([quiet.result.timedOut, quiet.result.polls, quiet.result.seconds, quiet.clock.slept], [false, 1, 0, 0], "2.0 is not above the limit of 2.0");
  const falling = await wait([5.2, 4, 2.01, 1.9], 60);
  assert.deepEqual([falling.result.first, falling.result.last, falling.result.polls, falling.result.seconds, falling.result.timedOut], [5.2, 1.9, 4, 15, false]);
  const busy = await wait([8], 12);
  assert.deepEqual([busy.result.timedOut, busy.result.polls, busy.result.seconds, busy.clock.slept], [true, 4, 12, 12000], "readings at 0, 5, 10 and 12 seconds");
  const none = await wait([8], 0);
  assert.deepEqual([none.result.timedOut, none.result.polls, none.clock.slept], [true, 1, 0]);
  assert.equal(typeof defaultClock.now(), "number");
});
