import { READINGS, UNLIMITED, rolesOf, slotsOf } from "./frontier-comparison-protocol.mjs";

// The raw data of a comparative campaign (V05-10, criteria `execucao` and `relatorio`), in the format `godot-fabric.frontier-comparison-campaign/v1`: what `execucao` produces and what the
// analysis (scripts/frontier-comparison-analysis.mjs) reads. The format is defined and validated here, field by field; docs/research/frontier-comparison-analysis.md says which rule of
// docs/research/frontier-comparison-protocol.json reads each field. It holds data and, in `text`, the words of the people who write the report: the analysis computes numbers and invents no text.

export const CAMPAIGN_FORMAT = "godot-fabric.frontier-comparison-campaign/v1";

// The kinds a field can have. A shape is a kind (or kinds joined with `|`), `[shape]` for an array of that shape, or an object of key: shape in which a key that ends with `?` is optional.
const KINDS = {
  string: (value) => typeof value === "string" && value.trim().length > 0,
  number: (value) => typeof value === "number" && Number.isFinite(value),
  measure: (value) => typeof value === "number" && Number.isFinite(value) && value >= 0,
  count: (value) => Number.isInteger(value) && value >= 0,
  positive: (value) => Number.isInteger(value) && value > 0,
  integer: (value) => Number.isInteger(value),
  boolean: (value) => typeof value === "boolean",
  sha256: (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value),
  null: (value) => value === null,
};

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const describe = (value) => {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "an array";
  }
  return typeof value === "object" ? "an object" : `${typeof value} ${JSON.stringify(value)}`.slice(0, 60);
};

function shapeErrors(value, shape, where = "$") {
  if (typeof shape === "string") {
    const kinds = shape.split("|");
    for (const kind of kinds) {
      if (!Object.hasOwn(KINDS, kind)) {
        throw new Error(`${where}: unknown kind ${kind}`);
      }
    }
    return kinds.some((kind) => KINDS[kind](value)) ? [] : [`${where}: expected ${shape}, got ${describe(value)}`];
  }
  if (Array.isArray(shape)) {
    return Array.isArray(value) ? value.flatMap((item, index) => shapeErrors(item, shape[0], `${where}[${index}]`)) : [`${where}: expected an array, got ${describe(value)}`];
  }
  if (!isObject(value)) {
    return [`${where}: expected an object, got ${describe(value)}`];
  }
  const errors = [];
  const known = new Set();
  for (const [key, inner] of Object.entries(shape)) {
    const optional = key.endsWith("?");
    const name = optional ? key.slice(0, -1) : key;
    known.add(name);
    if (!Object.hasOwn(value, name)) {
      if (!optional) {
        errors.push(`${where}.${name}: missing`);
      }
    } else {
      errors.push(...shapeErrors(value[name], inner, `${where}.${name}`));
    }
  }
  for (const key of Object.keys(value)) {
    if (!known.has(key)) {
      errors.push(`${where}.${key}: not part of the format`);
    }
  }
  return errors;
}

// The measures of the single observation of the cost of change (decisionRule.singleObservation): the protocol's "files, lines, time and tests". The time is in minutes.
export const CHANGE_MEASURES = { files: "count", lines: "count", timeMinutes: "measure", tests: "count" };

function campaignShape(protocol) {
  const arms = protocol.arms.map((arm) => arm.id);
  const keyed = (shape, ids = arms, optional = false) => Object.fromEntries(ids.map((id) => [optional ? `${id}?` : id, shape]));
  const windowShape = { occurrences: [{ warmup: "boolean", frameUsec: ["count"] }], "fps?": "measure" };
  const execution = {
    arm: "string",
    lane: "string",
    slot: "positive",
    attempt: "positive",
    load: { before: "measure", after: "measure" },
    build: "string",
    seed: "count",
    hashes: { binary: "sha256", package: "sha256", script: "sha256", protocol: "sha256" },
    vsync: { mode: "string", refreshHz: "measure" },
    game: { replayGoldenHash: "string", soakFinalHash: "string" },
    errors: { unhandledJs: "count", scriptErrors: "count", godotLogErrors: "count", crashed: "boolean", exitCode: "integer" },
    "parityMatches?": "boolean",
    drew: { afterEveryMeasuredIntent: "boolean", idleDrawnFrames: "count" },
    idle: { cpuUsec: ["count"], intervalsUsec: ["count"] },
    windows: keyed(windowShape, protocol.windows.map((window) => window.id)),
    readings: Object.fromEntries(Object.values(READINGS).map(({ key, shape }) => [`${key}?`, shape])),
  };
  // An attempt whose process wrote no report the analysis can read (it crashed, timed out, or ended without one) has no execution to hold: the entry holds what was read of the attempt.
  const unreported = {
    arm: "string",
    lane: "string",
    slot: "positive",
    attempt: "positive",
    load: { before: "measure", after: "measure" },
    errors: { crashed: "boolean", timedOut: "boolean", "exitCode?": "integer", "signal?": "string" },
    logSha256: "sha256",
  };
  const changeArms = protocol.secondaryOutcomes.find((outcome) => outcome.id === "change-cost").arms;
  return {
    format: "string",
    registered: {
      seed: "count",
      replayGoldenHash: "string",
      soakFinalHash: "string",
      instrumentSha256: "sha256",
      arms: keyed({ binarySha256: "sha256", packageSha256: "sha256", scriptSha256: "sha256" }),
    },
    instrument: { selfCheckPassed: "boolean", sha256: "sha256" },
    armB: { ready: "boolean", "reason?": "string" },
    provenance: { commit: "string", machine: "string", system: "string", display: "string", renderer: "string", adapter: "string", rawData: "string", deviations: ["string"] },
    executions: [execution],
    "unreported?": [unreported],
    packages: keyed({ exportBytes: ["count"] }, arms, true),
    "changeCost?": keyed(CHANGE_MEASURES, changeArms),
    "text?": { "decision?": "string", "limitations?": "string", "costOfChange?": "string" },
  };
}

// The arms that the campaign plans: all of them, or all but the reference (B) while it is not ready in its time-box (decisionRule.partialReport).
export function plannedArms(campaign, protocol) {
  const { reference } = rolesOf(protocol);
  return protocol.arms.map((arm) => arm.id).filter((id) => campaign.armB.ready || id !== reference);
}

// The attempts that wrote no report (`unreported`, optional in the format): none when the campaign has none.
export const unreportedAttempts = (campaign) => campaign.unreported ?? [];

// The measured occurrences of a window of an execution: the ones not flagged as warm-up (runs.warmup: flagged in the raw data and left out of every statistic).
export const measuredOf = (window) => window.occurrences.filter((occurrence) => !occurrence.warmup);

// Where an attempt sits in the order of the executions: its arm, its lane and its slot, which must be the arm's.
function placeErrors(attempt, where, protocol) {
  if (!protocol.arms.some((candidate) => candidate.id === attempt.arm)) {
    return [`${where}.arm: ${attempt.arm} is not an arm of the protocol`];
  }
  const errors = [];
  const slot = slotsOf(protocol)[attempt.slot - 1];
  if (!protocol.runs.lanes.some((lane) => lane.id === attempt.lane)) {
    errors.push(`${where}.lane: ${attempt.lane} is not a lane of the protocol`);
  }
  if (slot === undefined) {
    errors.push(`${where}.slot: ${attempt.slot} is not a slot of the order of the executions`);
  } else if (slot.arm !== attempt.arm) {
    errors.push(`${where}: slot ${attempt.slot} is arm ${slot.arm} in the order of the executions, not ${attempt.arm}`);
  }
  return errors;
}

function executionErrors(execution, where, protocol) {
  const arm = protocol.arms.find((candidate) => candidate.id === execution.arm);
  const errors = placeErrors(execution, where, protocol);
  if (arm === undefined) {
    return errors;
  }
  if (!["release", "debug"].includes(execution.build)) {
    errors.push(`${where}.build: ${execution.build} is neither release nor debug`);
  }
  if (execution.vsync.refreshHz <= 0) {
    errors.push(`${where}.vsync.refreshHz: the refresh rate read back is not positive`);
  }
  if ((arm.hud !== "none") !== Object.hasOwn(execution, "parityMatches")) {
    errors.push(`${where}.parityMatches: ${arm.hud === "none" ? "arm without a HUD has no context matrix" : "an arm with a HUD records whether its testIDs match the context matrix"}`);
  }
  for (const outcome of protocol.secondaryOutcomes.filter((candidate) => Object.hasOwn(READINGS, candidate.id))) {
    const { key } = READINGS[outcome.id];
    const expected = outcome.arms.includes(execution.arm);
    if (expected !== Object.hasOwn(execution.readings, key)) {
      errors.push(`${where}.readings.${key}: ${expected ? "missing" : `the outcome ${outcome.id} is not read in arm ${execution.arm}`}`);
    }
  }
  if (execution.readings.clickToPanelFrames?.length === 0) {
    errors.push(`${where}.readings.clickToPanelFrames: no measured click`);
  }
  const frames = protocol.idleReference.frames;
  for (const name of ["cpuUsec", "intervalsUsec"]) {
    if (execution.idle[name].length > frames) {
      errors.push(`${where}.idle.${name}: ${execution.idle[name].length} values, the idle window has ${frames} frames`);
    }
  }
  if (execution.drew.idleDrawnFrames > frames) {
    errors.push(`${where}.drew.idleDrawnFrames: more than the ${frames} frames of the idle window`);
  }
  for (const window of protocol.windows) {
    errors.push(...windowErrors(execution, execution.windows[window.id], `${where}.windows.${window.id}`, window, protocol));
  }
  return errors;
}

// An attempt that wrote no report says how its process ended, which is why there is no report: it crashed (killed by a signal, or a crash in its log), it timed out, or it exited with a
// code. The code may be 0: the scenario writes its report before it exits 0, so a process that ends cleanly without one did not complete the scenario, and the validity rejects it like any
// other attempt without a report (`errors`, clause `no-report`; reading 15 of docs/research/frontier-comparison-analysis.md). What the format refuses is an entry that says none of the three.
function unreportedErrors(entry, where, protocol) {
  const errors = placeErrors(entry, where, protocol);
  const { crashed, timedOut } = entry.errors;
  if (!crashed && !timedOut && !Object.hasOwn(entry.errors, "exitCode")) {
    errors.push(`${where}.errors: no reason for the missing report: the process did not crash, did not time out and has no exit code`);
  }
  // A process that exited has an exit code and one that was killed has a signal, never both (the campaign writes the signal when there is one and the exit code otherwise).
  if (Object.hasOwn(entry.errors, "exitCode") && Object.hasOwn(entry.errors, "signal")) {
    errors.push(`${where}.errors: exitCode and signal are both present: a process that exited has an exit code and one that was killed has a signal`);
  }
  return errors;
}

function windowErrors(execution, data, where, window, protocol) {
  const errors = [];
  const flagged = data.occurrences.filter((occurrence) => occurrence.warmup).length;
  const measured = data.occurrences.length - flagged;
  if (data.occurrences.slice(0, flagged).some((occurrence) => !occurrence.warmup)) {
    errors.push(`${where}: the warm-up occurrences are not the first ones`);
  }
  if (flagged > window.warmupOccurrences || (measured > 0 && flagged < window.warmupOccurrences)) {
    errors.push(`${where}: ${flagged} warm-up occurrences flagged, the protocol discards ${window.warmupOccurrences}`);
  }
  if (measured > window.measuredOccurrences) {
    errors.push(`${where}: ${measured} measured occurrences, the protocol measures ${window.measuredOccurrences}`);
  }
  data.occurrences.forEach((occurrence, index) => {
    if (occurrence.frameUsec.length === 0) {
      errors.push(`${where}.occurrences[${index}]: no frame`);
    }
  });
  const fps = execution.lane === UNLIMITED && execution.vsync.mode === protocol.vsync.unlimitedFpsRequires;
  if (fps !== Object.hasOwn(data, "fps")) {
    errors.push(`${where}.fps: ${fps ? "missing, the unlimited lane read the vsync mode back as DISABLED" : "only the unlimited lane with the vsync read back as DISABLED reads the FPS"}`);
  }
  return errors;
}

const MAXIMUM_ERRORS = 50;

// Every way in which a campaign is not in the format, shape first and then the rules the protocol puts on the data. At most MAXIMUM_ERRORS are listed.
export function campaignErrors(campaign, protocol) {
  const errors = shapeErrors(campaign, campaignShape(protocol));
  if (errors.length === 0) {
    errors.push(...semanticErrors(campaign, protocol));
  }
  return errors.length > MAXIMUM_ERRORS ? [...errors.slice(0, MAXIMUM_ERRORS), `... and ${errors.length - MAXIMUM_ERRORS} more`] : errors;
}

function semanticErrors(campaign, protocol) {
  const errors = [];
  if (campaign.format !== CAMPAIGN_FORMAT) {
    errors.push(`format: ${campaign.format} is not ${CAMPAIGN_FORMAT}`);
  }
  const { reference } = rolesOf(protocol);
  const planned = plannedArms(campaign, protocol);
  const seen = new Set();
  // The attempts of a slot are numbered across both lists: an attempt is in `executions` or in `unreported`, once.
  const noRepeat = (attempt, where) => {
    const key = `${attempt.lane}/${attempt.slot}/${attempt.attempt}`;
    if (seen.has(key)) {
      errors.push(`${where}: lane ${attempt.lane}, slot ${attempt.slot} and attempt ${attempt.attempt} appear twice`);
    }
    seen.add(key);
  };
  campaign.executions.forEach((execution, index) => {
    const where = `executions[${index}]`;
    noRepeat(execution, where);
    errors.push(...executionErrors(execution, where, protocol));
    if (!campaign.armB.ready && execution.arm === reference) {
      errors.push(`${where}: arm ${reference} is declared not ready and has an execution`);
    }
  });
  unreportedAttempts(campaign).forEach((entry, index) => {
    const where = `unreported[${index}]`;
    noRepeat(entry, where);
    errors.push(...unreportedErrors(entry, where, protocol));
    if (!campaign.armB.ready && entry.arm === reference) {
      errors.push(`${where}: arm ${reference} is declared not ready and has an attempt`);
    }
  });
  for (const arm of planned) {
    if (!Object.hasOwn(campaign.packages, arm) || campaign.packages[arm].exportBytes.length !== 2) {
      errors.push(`packages.${arm}.exportBytes: an export and its repeat (two sizes) for each planned arm`);
    }
  }
  if (campaign.changeCost !== undefined && !campaign.armB.ready) {
    errors.push(`changeCost: needs arm ${reference}, which is declared not ready`);
  }
  return errors;
}
