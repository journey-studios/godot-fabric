import { measuredOf, plannedArms } from "./frontier-comparison-format.mjs";
import { PRESENTED, UNLIMITED, proseRulesOf, slotsOf } from "./frontier-comparison-protocol.mjs";
import { idleReference } from "./frontier-comparison-statistics.mjs";

// Which executions of a campaign count: the invalidation rules of docs/research/frontier-comparison-protocol.json (`invalidation`) that can be computed from the raw data, the redo of a
// rejected execution in its slot, the limit of attempts per slot and the campaign that stops. An attempt is accepted when no rule rejects it. A reason is {rule, clause, ...values}: the
// rule is the protocol's id, the clause says which part of the rule, and the values are the numbers that decided it. No text is written here.

// ---- the rules that reject an attempt, in the order of the protocol's list; the context is {protocol, registered, protocolSha256, prose} ----

// `load`: the 1-minute load average above the written limit before or after the execution (runs.load.limit1MinuteAverage).
function loadReasons(execution, { protocol }) {
  const limit = protocol.runs.load.limit1MinuteAverage;
  return ["before", "after"].filter((when) => execution.load[when] > limit).map((when) => ({ clause: when, value: execution.load[when], limit }));
}

// `not-presented`, in the presented lane only: the window did not draw throughout (a frame drawn after every measured intent and in at least nine of ten frames of the idle window) or the
// loop was not paced (the idle reference of the elapsed intervals between process frames is under half of the refresh period read back).
function notPresentedReasons(execution, { protocol, prose }) {
  if (execution.lane !== PRESENTED) {
    return [];
  }
  const reasons = [];
  const frames = protocol.idleReference.frames;
  if (!execution.drew.afterEveryMeasuredIntent) {
    reasons.push({ clause: "intent-not-drawn" });
  }
  if (execution.drew.idleDrawnFrames * prose.drawn.of < prose.drawn.atLeast * frames) {
    reasons.push({ clause: "idle-not-drawn", drawn: execution.drew.idleDrawnFrames, of: frames });
  }
  const intervals = execution.idle.intervalsUsec;
  const reference = intervals.length < 2 ? null : idleReference(intervals);
  const halfPeriod = (1e6 / execution.vsync.refreshHz) * prose.pacedFraction;
  if (reference === null || reference < halfPeriod) {
    reasons.push({ clause: "not-paced", reference, halfPeriod });
  }
  return reasons;
}

// `not-the-registered-build`: a Debug build, or a binary, package or script whose hash differs from the registered one, or a seed that is not the registered one. The hash of the protocol the
// execution ran under must be the one of the file being analysed: an execution made under another text of the protocol is not mixed with this one (preRegistration.amendments).
function buildReasons(execution, { registered, protocolSha256 }) {
  const reasons = [];
  const expected = registered.arms[execution.arm];
  if (execution.build !== "release") {
    reasons.push({ clause: "build", value: execution.build });
  }
  for (const [clause, hash, registeredHash] of [
    ["binary", execution.hashes.binary, expected.binarySha256],
    ["package", execution.hashes.package, expected.packageSha256],
    ["script", execution.hashes.script, expected.scriptSha256],
    ["protocol", execution.hashes.protocol, protocolSha256],
  ]) {
    if (hash !== registeredHash) {
      reasons.push({ clause, value: hash, registered: registeredHash });
    }
  }
  if (execution.seed !== registered.seed) {
    reasons.push({ clause: "seed", value: execution.seed, registered: registered.seed });
  }
  return reasons;
}

// `other-game`: the golden hash of the 12-turn replay or the final hash of the soak differs from the registered one.
function gameReasons(execution, { registered }) {
  return [
    ["replay", execution.game.replayGoldenHash, registered.replayGoldenHash],
    ["soak", execution.game.soakFinalHash, registered.soakFinalHash],
  ]
    .filter(([, hash, registeredHash]) => hash !== registeredHash)
    .map(([clause, hash, registeredHash]) => ({ clause, value: hash, registered: registeredHash }));
}

// `errors`: an unhandled JavaScript error, a script error or an error in Godot's log, a crash, or an exit code that is not 0.
function errorReasons(execution) {
  const { errors } = execution;
  const reasons = ["unhandledJs", "scriptErrors", "godotLogErrors"].filter((clause) => errors[clause] > 0).map((clause) => ({ clause, count: errors[clause] }));
  if (errors.crashed) {
    reasons.push({ clause: "crashed" });
  }
  if (errors.exitCode !== 0) {
    reasons.push({ clause: "exitCode", value: errors.exitCode });
  }
  return reasons;
}

// `parity`: in B or C, the visible testIDs differ from the table of the context matrix (the arm records whether they match; an arm without a HUD records nothing).
const parityReasons = (execution) => (execution.parityMatches === false ? [{ clause: "testIDs" }] : []);

// `incomplete`: a window has fewer measured occurrences than its protocol number. The idle window of idleReference.frames frames is a window too: fewer frames than that, of the CPU time or
// of the intervals, is incomplete.
function incompleteReasons(execution, { protocol }) {
  const reasons = [];
  for (const window of protocol.windows) {
    const measured = measuredOf(execution.windows[window.id]).length;
    if (measured < window.measuredOccurrences) {
      reasons.push({ clause: window.id, measured, required: window.measuredOccurrences });
    }
  }
  const frames = protocol.idleReference.frames;
  for (const name of ["cpuUsec", "intervalsUsec"]) {
    if (execution.idle[name].length < frames) {
      reasons.push({ clause: `idle-${name}`, measured: execution.idle[name].length, required: frames });
    }
  }
  return reasons;
}

// The protocol's ids that reject an attempt, with their checks. `vsync-reading` is not invalid (the FPS band is N/A for that execution) and `instrument` is a property of the campaign
// (see instrumentOf); both are recorded and neither rejects an attempt.
const CHECKS = {
  load: loadReasons,
  "not-presented": notPresentedReasons,
  "not-the-registered-build": buildReasons,
  "other-game": gameReasons,
  errors: errorReasons,
  parity: parityReasons,
  incomplete: incompleteReasons,
};
export const REJECTING_RULES = Object.keys(CHECKS);

function attemptReasons(execution, context) {
  return Object.entries(CHECKS).flatMap(([rule, check]) => check(execution, context).map((reason) => ({ rule, ...reason })));
}

// `instrument`: the instrument's self-check was not passed, or the reading changed after it (the instrument's file is not the one the self-check passed): no comparative execution counts.
function instrumentOf(campaign) {
  const matches = campaign.instrument.sha256 === campaign.registered.instrumentSha256;
  return { selfCheckPassed: campaign.instrument.selfCheckPassed, sha256: campaign.instrument.sha256, registeredSha256: campaign.registered.instrumentSha256, unchangedAfterSelfCheck: matches, passed: campaign.instrument.selfCheckPassed && matches };
}

// ---- the slots ----

const byAttempt = (a, b) => a.attempt - b.attempt;

// One slot of one lane, from its attempts. runs.load.redo: the redone execution takes the place of the rejected one in the sequence, the rejected attempt stays in the raw data with its
// load readings and its reason, and there are at most `maxAttempts` attempts per slot; when they are used up the campaign stops. The state is `accepted`, `open` (rejected and waiting for its
// redo), `exhausted` (all the attempts rejected), `missing` (no attempt yet) or `not-planned` (the arm is not ready).
function slotOf(entry, lane, attempts, context, problems) {
  const limit = context.prose.maxAttempts;
  const record = { lane, ...entry, state: "missing", accepted: null, rejected: 0, attempts: [] };
  attempts.sort(byAttempt).forEach((execution, index) => {
    const where = `lane ${lane}, slot ${entry.slot}`;
    if (execution.attempt !== index + 1) {
      problems.push(`${where}: the attempts are not numbered 1, 2, ... without gaps`);
    }
    if (record.accepted !== null) {
      problems.push(`${where}: attempt ${execution.attempt} comes after the accepted attempt ${record.accepted}`);
    }
    const reasons = attemptReasons(execution, context);
    if (execution.attempt > limit) {
      reasons.push({ rule: "attempts", clause: "beyond-the-limit", limit });
    }
    const status = reasons.length === 0 && record.accepted === null ? "accepted" : "rejected";
    record.attempts.push({ attempt: execution.attempt, load: execution.load, vsync: execution.vsync, status, reasons });
    if (status === "accepted") {
      record.accepted = execution.attempt;
    } else if (record.accepted === null) {
      record.rejected += 1;
    }
  });
  if (record.accepted !== null) {
    record.state = "accepted";
  } else if (record.attempts.length > 0) {
    record.state = record.rejected >= limit ? "exhausted" : "open";
  }
  return record;
}

const emptyPositions = (arms) => arms.map(() => Object.fromEntries(arms.map((arm) => [arm, 0])));

// The accepted and planned executions of each arm by position in the block (runs.balance: each arm 4 times in each position of a block).
function balanceOf(slots, arms) {
  const table = (select) => {
    const positions = emptyPositions(arms);
    for (const slot of slots.filter(select)) {
      positions[slot.position][slot.arm] += 1;
    }
    return positions;
  };
  const planned = table((slot) => slot.state !== "not-planned");
  const accepted = table((slot) => slot.state === "accepted");
  return { planned, accepted, balanced: JSON.stringify(planned) === JSON.stringify(accepted) };
}

// The whole validity of a campaign: the slots of both lanes, the accepted executions by lane and arm, the totals, the balance by position, whether the campaign stopped and why, and the
// data that contradict one another (`problems`, which the caller refuses). The campaign has been through campaignErrors.
export function assessValidity(campaign, protocol, protocolSha256) {
  const prose = proseRulesOf(protocol);
  const context = { protocol, registered: campaign.registered, protocolSha256, prose };
  const arms = protocol.arms.map((arm) => arm.id);
  const planned = new Set(plannedArms(campaign, protocol));
  const problems = [];
  const slots = [];
  for (const lane of protocol.runs.lanes.map((candidate) => candidate.id)) {
    for (const entry of slotsOf(protocol)) {
      const attempts = campaign.executions.filter((execution) => execution.lane === lane && execution.slot === entry.slot);
      slots.push(planned.has(entry.arm) ? slotOf(entry, lane, attempts, context, problems) : { lane, ...entry, state: "not-planned", accepted: null, rejected: 0, attempts: [] });
    }
  }
  const accepted = {};
  const totals = {};
  for (const lane of [PRESENTED, UNLIMITED]) {
    accepted[lane] = {};
    totals[lane] = {};
    for (const arm of arms) {
      const own = slots.filter((slot) => slot.lane === lane && slot.arm === arm);
      accepted[lane][arm] = own
        .filter((slot) => slot.state === "accepted")
        .map((slot) => campaign.executions.find((execution) => execution.lane === lane && execution.slot === slot.slot && execution.attempt === slot.accepted));
      totals[lane][arm] = {
        planned: own.filter((slot) => slot.state !== "not-planned").length,
        accepted: accepted[lane][arm].length,
        rejected: own.reduce((sum, slot) => sum + slot.rejected, 0),
        open: own.filter((slot) => slot.state === "open").length,
        missing: own.filter((slot) => slot.state === "missing").length,
        exhausted: own.filter((slot) => slot.state === "exhausted").length,
      };
    }
  }
  const instrument = instrumentOf(campaign);
  return {
    maxAttempts: prose.maxAttempts,
    minimumPerArm: protocol.runs.minimumPerArm,
    instrument,
    slots,
    totals,
    accepted,
    balance: Object.fromEntries([PRESENTED, UNLIMITED].map((lane) => [lane, balanceOf(slots.filter((slot) => slot.lane === lane), arms)])),
    stopped: stopsOf(slots, instrument, prose, arms),
    problems,
  };
}

// The reasons that the campaign stops and produces no statistic: a slot whose attempts are used up (or exceeded) with none accepted (runs.load.redo), a repeat of `other-game` in one arm
// (invalidation other-game: a repeat in one arm stops the campaign; read as the second rejected attempt for it among the attempts of the arm, in either lane) and an instrument that
// did not pass (invalidation instrument: no comparative execution counts).
function stopsOf(slots, instrument, prose, arms) {
  const stops = slots
    .filter((slot) => slot.state === "exhausted")
    .map((slot) => ({ rule: "attempts", lane: slot.lane, slot: slot.slot, arm: slot.arm, attempts: slot.attempts.length, limit: prose.maxAttempts }));
  for (const arm of arms) {
    const repeats = slots.filter((slot) => slot.arm === arm).flatMap((slot) => slot.attempts).filter((attempt) => attempt.reasons.some((reason) => reason.rule === "other-game"));
    if (repeats.length >= 2) {
      stops.push({ rule: "other-game", arm, rejected: repeats.length });
    }
  }
  if (!instrument.passed) {
    stops.push({ rule: "instrument", selfCheckPassed: instrument.selfCheckPassed, unchangedAfterSelfCheck: instrument.unchangedAfterSelfCheck });
  }
  return stops;
}
