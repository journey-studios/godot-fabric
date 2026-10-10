import { rm, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { root } from "./consumer-harness.mjs";
import { runSelfCheck } from "./frontier-comparison-campaign-instrument.mjs";
import { RELEASE_SELF_CHECK_REFUSAL, createDebugLauncher, createReleaseLauncher } from "./frontier-comparison-campaign-launchers.mjs";
import { acquireLock } from "./frontier-comparison-campaign-lock.mjs";
import { defaultClock, readLoad, waitForLoad } from "./frontier-comparison-campaign-load.mjs";
import {
  STATE_FORMAT, assess, campaignFor, engineOf, initialState, nextStep, optionsErrors, parseSlots, resumeProblems, summaryOf, unavailableLanes, unreportedOf, verdictOf,
} from "./frontier-comparison-campaign-state.mjs";
import { campaignErrors } from "./frontier-comparison-format.mjs";
import { protocolErrors, slotsOf } from "./frontier-comparison-protocol.mjs";
import { buildReport, serializeReport } from "./frontier-comparison-report.mjs";
import { analyse, executionOf, sha256 } from "./frontier-comparison-run-campaign.mjs";
import { CONFIGURATION_PROBLEMS } from "./frontier-comparison-run-windows.mjs";
import { PROTOCOL_FILE, environmentOf, git, processOf, readCostsOf } from "./frontier-comparison-run.mjs";
import { machine } from "./frontier-turn-lane.mjs";

// The orchestrator of the whole comparative campaign (V05-10, criterion `execucao`, part 2). It plays the protocol's sequence (docs/research/frontier-comparison-protocol.json, `runs`) in the
// lanes it is asked for, one fresh process per attempt through a launcher (scripts/frontier-comparison-campaign-launchers.mjs), waits for a quiet machine before each, judges every attempt with
// the analysis' own rules, redoes the rejected ones in their slots (at most 3 attempts), stops where the analysis says the campaign stops, and writes its state after every attempt so that an
// interrupted campaign continues with --resume. The campaign in the analysis' format and its report are written at the end. The state machine is in
// scripts/frontier-comparison-campaign-state.mjs, the wait in -load.mjs and the instrument's self-check, the gate that runs first, in -instrument.mjs.
//
//   node scripts/frontier-comparison-campaign.mjs --campaign --lanes presented,unlimited --build release|debug --out <dir> [--exports <dir>] [--resume] [--max-wait <s>]
//        [--rehearsal [--slots <a-b>] [--assume-refresh-hz <n>]]
//
// `--build debug` is a rehearsal: it needs `--rehearsal`, which marks the campaign as one (a rehearsal redoes nothing, and says in the campaign's deviations that it is not a result). `--build release`
// needs `--exports <dir>`, the exports of the three arms with their manifests (scripts/frontier-comparison-release.mjs): the Release launcher reads and validates them, and the campaign then refuses to start
// unless the directory also has the export of the instrument's probe project (probe/frontier-comparison-export.json), the only way to run the self-check in a template (`launcher.selfCheck` is "unsupported"
// without it, and `{entry: "release", executable}` with it). The files in <out>: campaign-state.json (the state), raw/<lane>-<slot>-<attempt>.json and
// .log (the scenario's report and the process's log of each attempt), self-check/ (the instrument's probe report and log), and at the end campaign.json (strictly the analysis' format),
// report.json (the analysis' report), summary.json and, in a rehearsal, rehearsal.json.

const DEFAULT_MAX_WAIT_SECONDS = 1800;
const LOAD_POLL_SECONDS = 5;
const DEFAULT_LANES = ["presented", "unlimited"];

// Writes a file so that a reader sees the old content or the new one and never half of it: into a temporary file next to it, and renamed over it.
export async function writeAtomic(file, text) {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, text);
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

const exists = (file) => stat(file).then(() => true, () => false);
const isoOf = (clock) => new Date(clock.now()).toISOString();

function currentMachine() {
  const hardware = machine();
  return { commit: git(["rev-parse", "HEAD"]), machine: `${hardware.chip}, ${hardware.logicalCores} cores, ${hardware.memoryGb} GB`, system: hardware.os };
}

// What one attempt came to, for the state: the wait, the process, the files kept, and the execution object the analysis reads (null when the process wrote no report in the scenario's format:
// the attempt is then the campaign's `unreported` entry, made from the process's readings below: whether it crashed, whether it timed out (the launcher says so, `launched.timedOut`), its exit
// code or signal and the SHA-256 of its log). The verdict is filled in once the analysis has judged the campaign with this attempt in it.
async function attemptOf({ step, launched, waited, startedAt, endedAt, out, protocol, protocolSha256, build, assumeRefreshHz }) {
  const key = `${step.lane}-${step.slot}-${step.attempt}`;
  await mkdir(path.join(out, "raw"), { recursive: true });
  await writeAtomic(path.join(out, "raw", `${key}.log`), launched.log);
  const { report } = launched;
  if (report !== null) {
    await writeAtomic(path.join(out, "raw", `${key}.json`), JSON.stringify(report));
  }
  const signal = launched.signal ?? null;
  const ended = processOf({ status: launched.exitCode, signal }, launched.log);
  const record = {
    lane: step.lane,
    slot: step.slot,
    arm: step.arm,
    attempt: step.attempt,
    startedAt,
    endedAt,
    seconds: launched.seconds ?? null,
    waited,
    load: launched.load,
    hashes: { ...launched.hashes, protocol: protocolSha256 },
    exitCode: launched.exitCode,
    signal,
    crashed: ended.crashed,
    timedOut: launched.timedOut === true,
    raw: report === null ? null : `raw/${key}.json`,
    log: `raw/${key}.log`,
    logSha256: sha256(launched.log),
    aborted: report?.aborted ?? "",
    anomalies: report?.anomalies ?? [],
    unavailable: report?.unavailable ?? {},
    problems: [],
    configProblems: [],
    assumedRefreshHz: null,
    execution: null,
    verdict: null,
  };
  const analysed = report === null ? null : analyse(report, protocol);
  if (analysed === null || analysed.derived === null) {
    record.problems = analysed === null ? [] : analysed.problems;
    return record;
  }
  record.problems = analysed.problems;
  // The scenario waited with numbers other than the protocol's, or with another idle window: no rule of the analysis sees that, and every attempt would be the same, so the campaign stops.
  record.configProblems = analysed.problems.filter((problem) => CONFIGURATION_PROBLEMS.includes(problem.code));
  const execution = executionOf({
    report, derived: analysed.derived, protocol, slot: step.slot, attempt: step.attempt, build, load: launched.load, hashes: record.hashes,
    ended,
  });
  if (execution.vsync.refreshHz <= 0 && assumeRefreshHz !== null) {
    record.assumedRefreshHz = { read: execution.vsync.refreshHz, assumed: assumeRefreshHz };
    execution.vsync.refreshHz = assumeRefreshHz;
  }
  record.execution = execution;
  return record;
}

const reasonsOf = (verdict) => verdict.reasons.map((reason) => `${reason.rule}:${reason.clause}`).join(", ");

async function readState(file) {
  const state = JSON.parse(await readFile(file, "utf8"));
  if (state.format !== STATE_FORMAT) {
    throw new Error(`${file} is not a campaign state (${state.format})`);
  }
  return state;
}

// The campaign in the analysis' format and everything written beside it. `status` is "done" when every slot of the plan has been dealt with and "stopped" when a rule stopped the campaign.
async function finish({ state, protocol, protocolSha256, out, validity, status, readCosts }) {
  const campaign = campaignFor(state, protocol);
  const campaignText = `${JSON.stringify(campaign)}\n`;
  await writeAtomic(path.join(out, "campaign.json"), campaignText);
  const formatErrors = campaignErrors(campaign, protocol);
  let analysis = null;
  let analysisError = null;
  if (formatErrors.length > 0) {
    analysisError = `the campaign is not in the format: ${formatErrors.join("; ")}`;
  } else {
    try {
      analysis = buildReport({ campaign, protocol, protocolSha256, campaignSha256: sha256(campaignText) });
      await writeAtomic(path.join(out, "report.json"), serializeReport(analysis));
    } catch (error) {
      analysisError = error.message;
    }
  }
  const summary = {
    ...summaryOf(state, protocol, validity, status),
    formatErrors,
    analysis: analysis === null ? { error: analysisError } : { status: analysis.status, why: analysis.why },
    provenance: { ...state.provenance, ...state.environment, engine: state.scenarioEngine, readCosts },
  };
  await writeAtomic(path.join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  if (state.rehearsal) {
    const sidecar = {
      rehearsal: true,
      notAResult: summary.notAResult,
      campaign: "campaign.json",
      campaignSha256: sha256(campaignText),
      lanes: state.options.lanes,
      slots: state.options.slots,
      assumedRefreshHz: state.attempts.filter((attempt) => attempt.assumedRefreshHz !== null).map((attempt) => ({ lane: attempt.lane, slot: attempt.slot, arm: attempt.arm, ...attempt.assumedRefreshHz })),
      unavailableWindows: state.attempts.filter((attempt) => Object.keys(attempt.unavailable).length > 0).map((attempt) => ({ lane: attempt.lane, slot: attempt.slot, arm: attempt.arm, unavailable: attempt.unavailable })),
      sizesAre: "the size of the provisioned copy, not of a Release export",
      provenance: { readCosts },
    };
    await writeAtomic(path.join(out, "rehearsal.json"), `${JSON.stringify(sidecar, null, 2)}\n`);
  }
  return { status, state, campaign, formatErrors, analysis, analysisError, summary };
}

// The state to go on with: the one on disk, if `resume` and it is the same experiment (the protocol, the script, the binary and the package have the hashes it was registered with, and the options are
// the same), or a new one that registers what the launcher said.
async function openState({ launcher, prepared, protocolSha256, out, statePath, options, maxWaitSeconds, resume, clock, where, log }) {
  if (!resume) {
    await mkdir(out, { recursive: true });
    return initialState({
      protocolSha256,
      options: { ...options, maxWaitSeconds },
      launcher: { name: launcher.name, build: launcher.build, ...prepared },
      provenance: { ...where(), rawData: path.relative(root, out) },
      environment: environmentOf(undefined),
      now: isoOf(clock),
    });
  }
  const state = await readState(statePath);
  const mismatches = resumeProblems(state, { protocolSha256, launcher: { build: launcher.build, registered: prepared.registered }, options });
  if (mismatches.length > 0) {
    throw new Error(`cannot resume ${out}, which is not the campaign that was interrupted:\n${mismatches.join("\n")}`);
  }
  state.options.maxWaitSeconds = maxWaitSeconds;
  state.resumes.push({ at: isoOf(clock), attempts: state.attempts.length });
  log(`resuming after ${state.attempts.length} attempt(s)`);
  return state;
}

// One attempt of the next step: the wait for a quiet machine, a fresh process, what it came to, and the analysis' verdict on the campaign with it in. Returns that validity.
async function playAttempt({ launcher, step, state, protocol, protocolSha256, out, read, clock, maxWaitSeconds, assumeRefreshHz, log }) {
  const waited = await waitForLoad({ read, clock, limit: protocol.runs.load.limit1MinuteAverage, maxWaitSeconds, intervalSeconds: LOAD_POLL_SECONDS });
  log(`${step.lane} slot ${step.slot} (${step.arm}) attempt ${step.attempt}: ${waited.timedOut ? `the load stayed at ${waited.last} after ${waited.seconds} s, going on` : `load ${waited.last} after ${waited.seconds} s`}`);
  const startedAt = isoOf(clock);
  const launched = await launcher.launch({ arm: step.arm, lane: step.lane, slot: step.slot, attempt: step.attempt });
  const attempt = await attemptOf({ step, launched, waited, startedAt, endedAt: isoOf(clock), out, protocol, protocolSha256, build: launcher.build, assumeRefreshHz });
  state.attempts.push(attempt);
  if (attempt.execution !== null && state.scenarioEngine === null) {
    state.scenarioEngine = engineOf(launched.report.provenance);
    state.environment = environmentOf(launched.report);
  }
  const validity = assess(state, protocol);
  attempt.verdict = verdictOf(validity, attempt);
  log(`  ${attempt.verdict.accepted ? "accepted" : `rejected (${reasonsOf(attempt.verdict)})`}${attempt.seconds === null ? "" : `, ${attempt.seconds} s`}`);
  return validity;
}

// Runs a campaign (or continues one, with `resume`) to its end or its stop. `launcher` runs the processes; `protocol` and `protocolSha256` are the protocol's file as read; `lanes` are the lanes
// in the order they run; `slots` ([from, to]) limits the slots of each lane (a rehearsal's short run); the injected `runCheck` (the instrument's self-check), `read` (the load average),
// `clock`, `where` (the commit, machine and system of the record) and `lockFile` (the lock against another campaign on the machine) are the real ones unless a test supplies its own.
export async function runCampaign({
  launcher, protocol, protocolSha256, out, lanes, slots = null, rehearsal = false, resume = false, maxWaitSeconds = DEFAULT_MAX_WAIT_SECONDS, assumeRefreshHz = null,
  runCheck = runSelfCheck, read = readLoad, clock = defaultClock, where = currentMachine, lockFile = undefined, log = () => undefined,
}) {
  const problems = [...protocolErrors(protocol), ...optionsErrors(protocol, { lanes, slots })];
  // The wait for a quiet machine compares the load with this limit: a limit that is missing, a string or not above zero makes `load <= limit` false for every reading, and every attempt would wait the whole --max-wait.
  const limit = protocol.runs?.load?.limit1MinuteAverage;
  if (!(Number.isFinite(limit) && limit > 0)) {
    problems.push(`runs.load.limit1MinuteAverage is not a finite positive number (${JSON.stringify(limit) ?? "missing"}): the wait for the load cannot tell a quiet machine`);
  }
  if (problems.length > 0) {
    throw new Error(`cannot run the campaign:\n${problems.join("\n")}`);
  }
  const statePath = path.join(out, "campaign-state.json");
  if (resume !== (await exists(statePath))) {
    throw new Error(resume ? `--resume: there is no campaign to continue in ${out}` : `${statePath} exists: continue that campaign with --resume, or use another --out`);
  }
  const release = await acquireLock({ file: lockFile, out });
  try {
    const prepared = await launcher.prepare();
    // A launcher whose processes cannot run the instrument's self-check (the Release one without the probe's export: a template discards `-s`) cannot start a campaign, because the gate has nothing to run. Nothing was launched or written.
    if (launcher.selfCheck === "unsupported") {
      throw new Error(RELEASE_SELF_CHECK_REFUSAL);
    }
    const state = await openState({ launcher, prepared, protocolSha256, out, statePath, options: { lanes, slots, rehearsal, assumeRefreshHz }, maxWaitSeconds, resume, clock, where, log });
    const save = async () => {
      state.updated = isoOf(clock);
      state.unreported = unreportedOf(state);
      await writeAtomic(statePath, JSON.stringify(state));
    };
    await save();
    // The gate: the instrument's self-check runs at the start of a campaign, and again only if it did not pass. If it fails, nothing runs.
    if (state.selfCheck?.passed !== true) {
      log(`the instrument's self-check (probe and oracle), ${launcher.windowed ? "in a window" : "headless"}`);
      state.selfCheck = { at: isoOf(clock), ...(await runCheck({ engine: prepared.engine, windowed: launcher.windowed, outDirectory: path.join(out, "self-check"), ...launcher.selfCheck })) };
      log(`the instrument's self-check ${state.selfCheck.passed ? "passed" : `FAILED: ${state.selfCheck.why.join("; ")}`}`);
      await save();
    }
    let validity = assess(state, protocol);
    let step = nextStep(state, protocol, validity);
    while (step.kind === "launch") {
      validity = await playAttempt({ launcher, step, state, protocol, protocolSha256, out, read, clock, maxWaitSeconds, assumeRefreshHz, log });
      step = nextStep(state, protocol, validity);
      await save();
    }
    state.stopped = step.kind === "stopped" ? step.why : [];
    await save();
    return await finish({ state, protocol, protocolSha256, out, validity, status: step.kind === "stopped" ? "stopped" : "done", readCosts: await readCostsOf() });
  } finally {
    await launcher.cleanup();
    await release();
  }
}

// ---- the command line ----

const FLAGS = new Set(["--campaign", "--resume", "--rehearsal"]);

export function parseArguments(argv, protocol) {
  const options = { campaign: false, lanes: DEFAULT_LANES, build: null, out: null, exports: null, resume: false, rehearsal: false, slots: null, maxWaitSeconds: DEFAULT_MAX_WAIT_SECONDS, assumeRefreshHz: null };
  const text = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (FLAGS.has(argument)) {
      options[argument.slice(2)] = true;
    } else if (["--lanes", "--build", "--out", "--exports", "--slots", "--max-wait", "--assume-refresh-hz"].includes(argument)) {
      if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) {
        throw new Error(`${argument} takes a value`);
      }
      text[argument] = argv[++index];
    } else {
      throw new Error(`unknown argument ${argument}`);
    }
  }
  if (!options.campaign) {
    throw new Error("use --campaign --lanes presented,unlimited --build release|debug --out <directory> [--exports <directory>] [--resume] [--max-wait <seconds>] [--rehearsal [--slots <a-b>] [--assume-refresh-hz <n>]]");
  }
  options.lanes = text["--lanes"] === undefined ? DEFAULT_LANES : text["--lanes"].split(",");
  options.build = text["--build"] ?? null;
  options.out = text["--out"] === undefined ? null : path.resolve(text["--out"]);
  options.exports = text["--exports"] === undefined ? null : path.resolve(text["--exports"]);
  if (!["release", "debug"].includes(options.build)) {
    throw new Error("use --build release|debug");
  }
  if (options.out === null) {
    throw new Error("use --out <directory>");
  }
  if (options.build === "debug" && !options.rehearsal) {
    throw new Error("--build debug is only for a rehearsal: add --rehearsal (a Debug build is never a comparative execution)");
  }
  if (text["--slots"] !== undefined) {
    if (!options.rehearsal) {
      throw new Error("--slots limits the slots of a rehearsal; a campaign runs all of them");
    }
    options.slots = parseSlots(text["--slots"], slotsOf(protocol).length);
  }
  if (text["--assume-refresh-hz"] !== undefined) {
    options.assumeRefreshHz = Number(text["--assume-refresh-hz"]);
    if (!options.rehearsal || !(options.assumeRefreshHz > 0)) {
      throw new Error("--assume-refresh-hz <n> is a positive number and only for a rehearsal: a campaign reads the refresh rate back and never assumes it");
    }
  }
  if (text["--max-wait"] !== undefined) {
    options.maxWaitSeconds = Number(text["--max-wait"]);
    if (!(options.maxWaitSeconds >= 0)) {
      throw new Error("--max-wait takes a number of seconds, 0 or more");
    }
  }
  if (options.build === "release" && options.exports === null) {
    throw new Error("--build release needs --exports <directory>: the exports of the three arms, <A|B|C>/frontier-comparison-export.json beside the .app of each");
  }
  if (options.build === "debug" && options.exports !== null) {
    throw new Error("--exports is for --build release: a Debug rehearsal provisions its own copy of civ-lite");
  }
  return options;
}

async function main(argv) {
  const bytes = await readFile(PROTOCOL_FILE);
  const protocol = JSON.parse(bytes);
  const options = parseArguments(argv, protocol);
  const launcher = options.build === "release" ? createReleaseLauncher({ exportsDirectory: options.exports }) : createDebugLauncher();
  const result = await runCampaign({
    launcher, protocol, protocolSha256: sha256(bytes), out: options.out, lanes: options.lanes, slots: options.slots, rehearsal: options.rehearsal, resume: options.resume,
    maxWaitSeconds: options.maxWaitSeconds, assumeRefreshHz: options.assumeRefreshHz, log: (line) => console.log(line),
  });
  for (const stop of result.state.stopped) {
    console.error(`STOPPED ${JSON.stringify(stop)}`);
  }
  for (const problem of result.formatErrors) {
    console.error(`FAIL ${problem}`);
  }
  const off = Object.keys(unavailableLanes(result.state, protocol));
  console.log(`FRONTIER_COMPARISON_CAMPAIGN_${result.status.toUpperCase()}: ${options.out}, ${result.state.attempts.length} attempt(s), analysis ${result.analysis === null ? `refused (${result.analysisError})` : result.analysis.status}${off.length > 0 ? `, lane(s) N/A: ${off}` : ""}`);
  process.exitCode = result.status === "done" && result.formatErrors.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
