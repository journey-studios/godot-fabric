import { CAMPAIGN_FORMAT } from "./frontier-comparison-format.mjs";
import { UNLIMITED, slotsOf } from "./frontier-comparison-protocol.mjs";
import { campaignOf } from "./frontier-comparison-run-campaign.mjs";
import { assessValidity } from "./frontier-comparison-validity.mjs";

// The state machine of the comparative campaign (V05-10, `execucao`, part 2): what has run, what each attempt came to and what runs next, as pure functions of a JSON object (the state that
// scripts/frontier-comparison-campaign.mjs writes to <out>/campaign-state.json after every attempt). Nothing here runs a process, reads a clock or touches a file. Every rule of validity
// is the analysis' (scripts/frontier-comparison-validity.mjs): an attempt is judged by `assessValidity` over the campaign that the state makes, and the stops are the ones it reports
// (a slot whose attempts are used up, a repeat of the other game in one arm, an instrument that did not pass), to which this adds only what the analysis cannot see.
//
//   idle -> self-check -> [blocked: the check failed, nothing runs]
//        -> next slot in the order of the sequence, lane after lane -> wait for load -> launch -> judge -> write the state
//        -> slot accepted -> next slot | slot rejected -> redo in the same slot (at most 3 attempts) | stopped | done

export const STATE_FORMAT = "godot-fabric.frontier-comparison-campaign-state/v1";

// "3" or "1-3": the slots of each lane to run (a rehearsal's short run). The slots count from 1.
export function parseSlots(text, total) {
  const found = /^(\d+)(?:-(\d+))?$/.exec(text ?? "");
  if (found === null) {
    throw new Error(`--slots takes a slot or a range such as 1-3, not ${JSON.stringify(text)}`);
  }
  const from = parseInt(found[1], 10);
  const to = found[2] === undefined ? from : parseInt(found[2], 10);
  if (from < 1 || to < from || to > total) {
    throw new Error(`--slots ${text}: the slots of a lane are 1 to ${total}, in order`);
  }
  return [from, to];
}

// The order of the executions: the protocol's sequence in the first lane, then in the next one (a lane keeps the same sequence), limited to `slots` when a rehearsal asks for a short run.
export function planOf(protocol, { lanes, slots }) {
  const entries = slotsOf(protocol).filter((entry) => slots === null || (entry.slot >= slots[0] && entry.slot <= slots[1]));
  return lanes.flatMap((lane) => entries.map((entry) => ({ lane, ...entry })));
}

export function optionsErrors(protocol, { lanes, slots }) {
  const known = protocol.runs.lanes.map((lane) => lane.id);
  const errors = lanes.filter((lane) => !known.includes(lane)).map((lane) => `--lanes: ${lane} is not a lane of the protocol (${known.join(", ")})`);
  if (new Set(lanes).size !== lanes.length || lanes.length === 0) {
    errors.push("--lanes: name each lane once");
  }
  if (slots !== null && slots[1] > slotsOf(protocol).length) {
    errors.push(`--slots: the protocol has ${slotsOf(protocol).length} slots in a lane`);
  }
  return errors;
}

const attemptsOf = (state, { lane, slot }) => state.attempts.filter((attempt) => attempt.lane === lane && attempt.slot === slot);

// The state of a campaign that has not begun. `launcher` is what the launcher said of itself when it was prepared (its registration, the sizes of its packages and its own deviations from the
// protocol), `provenance` the commit, machine, system and raw-data directory, `environment` the display, renderer and adapter (to be replaced by the first report's).
export function initialState({ protocolSha256, options, launcher, provenance, environment, now }) {
  return {
    format: STATE_FORMAT,
    rehearsal: options.rehearsal,
    options: { lanes: options.lanes, slots: options.slots, build: launcher.build, maxWaitSeconds: options.maxWaitSeconds, assumeRefreshHz: options.assumeRefreshHz },
    protocolSha256,
    launcher: { name: launcher.name, build: launcher.build, engine: launcher.engine, registered: launcher.registered, packages: launcher.packages, deviations: launcher.deviations },
    provenance,
    environment,
    scenarioEngine: null,
    selfCheck: null,
    attempts: [],
    unreported: [],
    stopped: [],
    resumes: [],
    created: now,
    updated: now,
  };
}

// ---- the campaign that a state makes ----

// The executions the analysis sees: the attempts that have an execution object, in the order they ran, each with the number of its attempt in the slot. The attempts without one (the process
// wrote no report the scenario's format reads) are the campaign's `unreported` (unreportedEntries), and the numbering 1, 2, ... of a slot is over both lists.
export const campaignExecutions = (state) => state.attempts.filter((attempt) => attempt.execution !== null).map((attempt) => attempt.execution);

const omittedOf = (state) => state.attempts.filter((attempt) => attempt.execution === null);

// The attempts that wrote no report the format can hold, as the campaign's `unreported` has them (scripts/frontier-comparison-format.mjs): the slot, the attempt, the load around the process, how
// the process ended (a process killed by a signal has no exit code, one that exited has no signal) and the SHA-256 of the log kept under `raw/`.
export const unreportedEntries = (state) => omittedOf(state).map((attempt) => ({
  arm: attempt.arm,
  lane: attempt.lane,
  slot: attempt.slot,
  attempt: attempt.attempt,
  load: attempt.load,
  errors: { crashed: attempt.crashed, timedOut: attempt.timedOut, ...(attempt.signal === null ? { exitCode: attempt.exitCode } : { signal: attempt.signal }) },
  logSha256: attempt.logSha256,
}));

// The same attempts for whoever reads the state or the summary, one by one: the slot, the attempt, why it was rejected (the reasons the analysis gives it, which are those of the campaign's
// report), the exit code and signal of the process as the launcher read them and the log that was kept.
export const unreportedOf = (state) => omittedOf(state).map((attempt) => ({
  lane: attempt.lane, slot: attempt.slot, arm: attempt.arm, attempt: attempt.attempt, reasons: attempt.verdict.reasons, exitCode: attempt.exitCode, signal: attempt.signal, log: attempt.log,
}));

// runs.lanes: the unlimited lane "if the reading is not DISABLED ... is N/A and is not run further". Read as: the first attempt of that lane whose vsync mode read back is not the one the
// protocol requires (`vsync.unlimitedFpsRequires`) makes the lane N/A, and its remaining slots do not run. The attempt itself is judged by the rules like any other (`vsync-reading` is not invalid).
export function unavailableLanes(state, protocol) {
  const required = protocol.vsync.unlimitedFpsRequires;
  const found = state.attempts.find((attempt) => attempt.lane === UNLIMITED && attempt.execution !== null && attempt.execution.vsync.mode !== required);
  return found === undefined ? {} : { [UNLIMITED]: { slot: found.slot, attempt: found.attempt, mode: found.execution.vsync.mode, required } };
}

const times = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

// What the campaign says it is not: each way in which it deviates from the protocol, as the format's `provenance.deviations` wants them (strings). The launcher's come first.
function deviationsOf(state, protocol) {
  const lines = [];
  if (state.rehearsal) {
    lines.push("REHEARSAL: not a comparative execution and not a campaign; no number of it is a result of any arm");
  }
  lines.push(...state.launcher.deviations);
  if (state.rehearsal) {
    lines.push("a rehearsal does not redo: each slot ran once, whatever the rules said of it, so that the rejections it shows (the Debug build, the headless display, the load of a busy machine) can be seen and counted");
  }
  if (state.options.slots !== null) {
    lines.push(`only the slots ${state.options.slots[0]} to ${state.options.slots[1]} of the ${slotsOf(protocol).length} of each lane were run (--slots)`);
  }
  const assumed = state.attempts.filter((attempt) => attempt.assumedRefreshHz !== null);
  if (assumed.length > 0) {
    lines.push(`the refresh rate read back was not positive (a headless display has none) in ${times(assumed.length, "attempt")} and ${state.options.assumeRefreshHz} Hz was assumed for the format`);
  }
  for (const [lane, off] of Object.entries(unavailableLanes(state, protocol))) {
    lines.push(`lane ${lane} is N/A and was not run further: the vsync mode read back ${off.mode}, not ${off.required} (lane ${lane}, slot ${off.slot}, attempt ${off.attempt}; runs.lanes)`);
  }
  if (state.selfCheck?.lane === "headless") {
    lines.push("the instrument's self-check ran headless, because the launcher runs headless; a campaign proper runs in a window and its self-check runs in one (the engine and renderer the gate asks for), which this rehearsal did not repeat");
  }
  return lines;
}

// The campaign object in the format of the analysis (scripts/frontier-comparison-format.mjs) that this state makes: every attempt is in it, the ones that wrote a report in `executions` and the
// ones that did not in `unreported`, each with its own number.
export function campaignFor(state, protocol) {
  const { registered } = state.launcher;
  const campaign = campaignOf({
    executions: campaignExecutions(state),
    registered,
    instrument: { selfCheckPassed: state.selfCheck?.passed === true, sha256: state.selfCheck?.sha256 ?? registered.instrumentSha256 },
    provenance: { ...state.provenance, ...state.environment, deviations: deviationsOf(state, protocol) },
    packages: state.launcher.packages,
  });
  return { ...campaign, unreported: unreportedEntries(state) };
}

// ---- judging, stopping, going on ----

export const assess = (state, protocol) => assessValidity(campaignFor(state, protocol), protocol, state.protocolSha256);

// How the analysis judged the attempt, by its place in the campaign it makes: accepted or not, and the reasons ({rule, clause, ...values}). The attempt keeps its own number in the campaign.
export function verdictOf(validity, attempt) {
  const slot = validity.slots.find((candidate) => candidate.lane === attempt.lane && candidate.slot === attempt.slot);
  const judged = slot.attempts.find((candidate) => candidate.attempt === attempt.attempt);
  return { accepted: judged.status === "accepted", reasons: judged.reasons };
}

// The engine and renderer a scenario ran on, against the ones the self-check ran on: what the probe and the scenario both record of them, the engine's build, the display server, the rendering
// driver and method and the adapter. The gate asks for the engine and the renderer of the campaign, so a self-check in another display mode (a headless check for a campaign in a window) differs
// here and stops the campaign. An empty list when they are the same.
const SAME_ENGINE = ["godot", "godotHash", "architecture", "displayServer", "renderingDriver", "renderingMethod", "adapter"];
export const engineOf = (provenance) => Object.fromEntries(SAME_ENGINE.map((key) => [key, provenance?.[key] ?? null]));
export const engineDifferences = (selfCheck, scenario) => SAME_ENGINE.filter((key) => selfCheck?.[key] !== scenario?.[key]);

// Why the campaign cannot go on, if it cannot: the analysis' stops (which count the attempts that wrote no report, as they are in the campaign), the scenario that waited with other numbers than
// the protocol's (which the analysis cannot see) and an engine that is not the one the self-check ran on. A rehearsal redoes nothing, so it has no slot whose attempts are used up.
export function stopsOf(state, protocol, validity) {
  const stops = [...validity.stopped];
  for (const attempt of state.attempts.filter((candidate) => candidate.configProblems.length > 0)) {
    stops.push({ rule: "scenario-config", lane: attempt.lane, slot: attempt.slot, attempt: attempt.attempt, problems: attempt.configProblems });
  }
  const differences = state.selfCheck === null || state.scenarioEngine === null ? [] : engineDifferences(engineOf(state.selfCheck.provenance), state.scenarioEngine);
  if (differences.length > 0) {
    stops.push({ rule: "instrument", clause: "other-engine", differs: differences });
  }
  return stops;
}

// The next thing to do: launch the first slot, in the order of the sequence, that has no accepted attempt (the redo of a rejected one comes before the next slot), or stop, or be done.
export function nextStep(state, protocol, validity) {
  const why = stopsOf(state, protocol, validity);
  if (why.length > 0) {
    return { kind: "stopped", why };
  }
  const off = unavailableLanes(state, protocol);
  for (const entry of planOf(protocol, state.options)) {
    const attempts = attemptsOf(state, entry);
    const settled = attempts.some((attempt) => attempt.verdict.accepted) || (state.rehearsal && attempts.length > 0);
    if (!settled && !Object.hasOwn(off, entry.lane)) {
      return { kind: "launch", ...entry, attempt: attempts.length + 1 };
    }
  }
  return { kind: "done" };
}

// ---- resuming ----

// What differs between the campaign that a state records and the one that is about to continue it. The protocol, the script, the binary and the package must have the same hashes (and the
// rest of what was registered, and the options that decide which executions exist): otherwise the executions after the interruption would not be the same experiment.
export function resumeProblems(state, { protocolSha256, launcher, options }) {
  const problems = [];
  if (state.protocolSha256 !== protocolSha256) {
    problems.push(`protocol: the state ran under ${state.protocolSha256}, the file now hashes to ${protocolSha256}`);
  }
  const was = { lanes: state.options.lanes, slots: state.options.slots, build: state.options.build, rehearsal: state.rehearsal, assumeRefreshHz: state.options.assumeRefreshHz };
  const now = { lanes: options.lanes, slots: options.slots, build: launcher.build, rehearsal: options.rehearsal, assumeRefreshHz: options.assumeRefreshHz };
  if (JSON.stringify(was) !== JSON.stringify(now)) {
    problems.push(`options: the state ran with ${JSON.stringify(was)}, this run asks for ${JSON.stringify(now)}`);
  }
  const before = state.launcher.registered;
  const after = launcher.registered;
  for (const key of ["seed", "replayGoldenHash", "soakFinalHash", "instrumentSha256"]) {
    if (before[key] !== after[key]) {
      problems.push(`${key === "instrumentSha256" ? "instrument" : key}: the state registered ${before[key]}, now ${after[key]}`);
    }
  }
  for (const arm of Object.keys(before.arms)) {
    for (const [name, key] of [["binary", "binarySha256"], ["package", "packageSha256"], ["script", "scriptSha256"]]) {
      if (before.arms[arm][key] !== after.arms[arm]?.[key]) {
        problems.push(`arm ${arm} ${name}: the state registered ${before.arms[arm][key]}, now ${after.arms[arm]?.[key]}`);
      }
    }
  }
  return problems;
}

// ---- the summary ----

const reasonsText = (verdict) => verdict.reasons.map((reason) => `${reason.rule}:${reason.clause}`);

// What happened, for a reader: per lane and arm the slots run, accepted, and the rejected attempts with their reasons; the waits; the stops; the self-check.
export function summaryOf(state, protocol, validity, status) {
  const lanes = {};
  for (const entry of planOf(protocol, state.options)) {
    const arms = (lanes[entry.lane] ??= {});
    const own = (arms[entry.arm] ??= { slots: 0, started: 0, accepted: 0, attempts: 0, rejected: [] });
    const attempts = attemptsOf(state, entry);
    own.slots += 1;
    own.started += attempts.length > 0 ? 1 : 0;
    own.accepted += attempts.some((attempt) => attempt.verdict.accepted) ? 1 : 0;
    own.attempts += attempts.length;
    own.rejected.push(...attempts.filter((attempt) => !attempt.verdict.accepted).map((attempt) => ({ slot: attempt.slot, attempt: attempt.attempt, reasons: reasonsText(attempt.verdict) })));
  }
  return {
    rehearsal: state.rehearsal,
    ...(state.rehearsal ? { notAResult: "This is a rehearsal of the campaign. No number in it is a measurement of an arm for the comparison, and no campaign was run." } : {}),
    format: CAMPAIGN_FORMAT,
    status,
    stopped: stopsOf(state, protocol, validity),
    options: state.options,
    protocolSha256: state.protocolSha256,
    launcher: { name: state.launcher.name, build: state.launcher.build, registered: state.launcher.registered },
    selfCheck: state.selfCheck === null ? null : { passed: state.selfCheck.passed, why: state.selfCheck.why, sha256: state.selfCheck.sha256, lane: state.selfCheck.lane, seconds: state.selfCheck.seconds },
    unavailableLanes: unavailableLanes(state, protocol),
    unreported: unreportedOf(state),
    lanes,
    waits: { attempts: state.attempts.length, seconds: Math.round(state.attempts.reduce((sum, attempt) => sum + attempt.waited.seconds, 0) * 10) / 10, timedOut: state.attempts.filter((attempt) => attempt.waited.timedOut).length },
    anomalies: state.attempts.reduce((sum, attempt) => sum + attempt.anomalies.length, 0),
    resumes: state.resumes.length,
  };
}
