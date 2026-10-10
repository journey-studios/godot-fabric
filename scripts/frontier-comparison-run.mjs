import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, readlink, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHarness, root } from "./consumer-harness.mjs";
import { campaignErrors } from "./frontier-comparison-format.mjs";
import { buildReport, serializeReport } from "./frontier-comparison-report.mjs";
import { protocolErrors } from "./frontier-comparison-protocol.mjs";
import { analyse, campaignOf, executionOf, goldenReplayHash, SEED, sha256, slotOf, SOAK_FINAL_HASH } from "./frontier-comparison-run-campaign.mjs";
import { loadAverage, machine } from "./frontier-turn-lane.mjs";

// The runner of the comparative execution (V05-10, criterion `execucao`). This part runs the REHEARSAL only: the scenario (tests/frontier-comparison-scenario.gd) once in each arm,
// in a Debug build, on a provisioned copy of the consumer, and the campaign object that the analysis reads, marked as a rehearsal and kept apart from any campaign. No comparative
// execution happens here: that needs the Release export (V05-07) and a quiet window that the user reserves (docs/research/frontier-comparison-execution.md, "What is missing").
//
//   node scripts/frontier-comparison-run.mjs --rehearsal --arms A,B,C --lane presented|unlimited [--windowed] [--assume-refresh-hz <n>] [--out <directory>]
//
// It provisions civ-lite with the harness (scripts/consumer-harness.mjs), builds the HUD with the editor, copies the scenario into the copy and runs a Godot process for each arm. It reads
// the load before and after each process as a number, and hashes the binary, the package (the provisioned copy), the scenario and the protocol. It assembles a campaign with
// `build: "debug"`, requires `campaignErrors` to pass and builds the analysis' report: every execution comes out rejected by `not-the-registered-build`, which is what a rehearsal must show.

const TEMPLATE = "civ-lite";
const RUNNER = "res://comparison/frontier-comparison-scenario.gd";
const PROJECT_DIRECTORY = "comparison";
export const PROTOCOL_FILE = path.join(root, "docs", "research", "frontier-comparison-protocol.json");
// The files of the scenario, copied into the provisioned copy next to one another (the scenario preloads them by name), and the files the scenario uses that other lanes own.
const SCENARIO_FILES = [
  "tests/frontier-comparison-scenario.gd",
  "tests/frontier-comparison-player.gd",
  "tests/frontier-comparison-hud.gd",
  "tests/frontier-comparison-readings.gd",
  "tests/frontier-comparison-cycle.gd",
];
const SUPPORT_FILES = ["tests/cpu-time-instrument.gd", "tests/performance-sampler.gd", "tests/window-presence.gd", "tests/world-input-driver.gd"];
const INSTRUMENT_FILE = "tests/cpu-time-instrument.gd";
// The game and the HUD are the template's; the scenario and its readings are not part of the package, which is the provisioned copy as the product ships it.
const PACKAGE_EXCLUDED = new Set([".godot", PROJECT_DIRECTORY]);

const fileSha256 = async (file) => sha256(await readFile(file));

// What reading `stats()` costs, from the record of the slice that delivered the hooks (docs/research/frontier-stress.md): the median per read in B and in C over 20,000 reads, headless, and the two
// paths that a measured frame must not take, for the record. It is part of the rehearsal's provenance, beside what the scenario itself measured of the same reads.
const STRESS_COSTS = "docs/evidence/frontier-stress/costs.json";
const twoDigits = (value) => Number(value.toPrecision(2));

export async function readCostsOf() {
  const costs = JSON.parse(await readFile(path.join(root, STRESS_COSTS), "utf8"));
  return {
    source: STRESS_COSTS,
    statsUsec: { B: twoDigits(costs.arms["b-new"].statsUs.median), C: twoDigits(costs.arms["c-new"].statsUs.median) },
    notTaken: { evaluateUsec: twoDigits(costs.arms["c-new"].evaluateUs), surfaceSnapshotUsec: twoDigits(costs.arms["c-new"].surfaceSnapshotUs) },
  };
}

// The files of a directory with their hashes, in path order, leaving out the top-level entries in `excluded`.
async function digest(directory, excluded = new Set()) {
  const lines = [];
  let bytes = 0;
  const walk = async (current, prefix) => {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (prefix === "" && excluded.has(entry.name)) {
        continue;
      }
      const relative = `${prefix}${entry.name}`;
      const file = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        lines.push(`${relative} -> ${await readlink(file)}`);
      } else if (entry.isDirectory()) {
        await walk(file, `${relative}/`);
      } else {
        const content = await readFile(file);
        bytes += content.length;
        lines.push(`${relative} ${sha256(content)}`);
      }
    }
  };
  await walk(directory, "");
  return { sha256: sha256(lines.join("\n")), bytes, files: lines.length };
}

// A provisioned copy of the consumer with the HUD built and the scenario copied in. The package is the copy as provisioned and built; the script is the scenario's files and the support
// files it uses, by path and hash; the binary is the engine's executable.
export async function prepareProject({ name = "frontier-comparison-rehearsal" } = {}) {
  const harness = await createHarness({ template: TEMPLATE, name });
  await harness.provision();
  await harness.editor("editor-cold");
  const packageDigest = await digest(harness.project, PACKAGE_EXCLUDED);
  const directory = path.join(harness.project, PROJECT_DIRECTORY);
  await mkdir(directory, { recursive: true });
  const files = {};
  for (const file of [...SCENARIO_FILES, ...SUPPORT_FILES]) {
    await copyFile(path.join(root, file), path.join(directory, path.basename(file)));
    files[file] = await fileSha256(path.join(root, file));
  }
  const scripted = Object.entries(files).map(([file, fileHash]) => `${file} ${fileHash}`).sort();
  return {
    harness,
    scripts: { files, sha256: sha256(scripted.join("\n")) },
    package: packageDigest,
    binarySha256: await fileSha256(harness.godot),
    instrumentSha256: files[INSTRUMENT_FILE],
  };
}

// The 1-minute load average of `sysctl -n vm.loadavg` ("{ 1.50 2.00 2.50 }") as a number.
export function loadNumber(text) {
  const found = /([0-9]+(?:\.[0-9]+)?)/.exec(text ?? "");
  return found === null ? Number.NaN : Number(found[1]);
}

// How a Godot process ended, from its exit status and its log: the counts the `errors` rule of the protocol asks for.
export function processOf(result, log) {
  const lines = log.split("\n");
  return {
    exitCode: result.status ?? -1,
    crashed: result.signal !== null || /Program crashed|Segmentation fault|Bus error/.test(log),
    scriptErrors: lines.filter((line) => /SCRIPT ERROR/.test(line)).length,
    godotLogErrors: lines.filter((line) => /^ERROR:|FABRIC_ERROR|FABRIC_CHECK_FAILED|CONSUMER_CHECK_FAILED/.test(line)).length,
  };
}

// One Godot process: the scenario in an arm. Returns where the scenario's report is (if it wrote one), the log, how the process ended and the load around it.
export function launchScenario({ prepared, arm, lane, windowed = false, timeout = 1800000 }) {
  const { harness } = prepared;
  const label = `run-${arm}-${lane}${windowed ? "-windowed" : ""}`;
  const reportFile = path.join(harness.directory, `${label}.json`);
  rmSync(reportFile, { force: true });
  const before = loadNumber(loadAverage());
  const started = Date.now();
  const result = spawnSync(harness.godot, ["--path", harness.project, windowed ? "--windowed" : "--headless", "-s", RUNNER, "--", `--arm=${arm}`, `--lane=${lane}`, `--out=${reportFile}`],
    { env: harness.env, encoding: "utf8", timeout, maxBuffer: 256 * 1024 * 1024 });
  const after = loadNumber(loadAverage());
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  writeFileSync(path.join(harness.directory, `${label}.log`), log);
  return { label, reportFile, log, result, process: processOf(result, log), load: { before, after }, seconds: Math.round((Date.now() - started) / 100) / 10, windowed };
}

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

// What a scenario's report says of the display and the renderer it ran on, as the campaign's provenance words it ("none" before any report).
export function environmentOf(report) {
  if (report === undefined) {
    return { display: "none", renderer: "none", adapter: "none: the headless display server names no adapter" };
  }
  const { provenance } = report;
  return {
    display: `${provenance.displayServer}, ${provenance.screenSize.join("x")} at scale ${provenance.screenScale}, window ${provenance.windowSize.join("x")}`,
    renderer: `${provenance.renderingDriver} (${provenance.renderingMethod})`,
    adapter: provenance.adapter === "" ? "none: the headless display server names no adapter" : provenance.adapter,
  };
}

// The registration of a rehearsal. A rehearsal registers nothing in advance: it registers what it measured, so that the rules that compare with the registered values judge the other
// things (the build, the game, the errors), and `not-the-registered-build` is left with the one reason that is true, the Debug build.
export function registeredOf(prepared, replayGoldenHash) {
  const entry = { binarySha256: prepared.binarySha256, packageSha256: prepared.package.sha256, scriptSha256: prepared.scripts.sha256 };
  return { seed: SEED, replayGoldenHash, soakFinalHash: SOAK_FINAL_HASH, instrumentSha256: prepared.instrumentSha256, arms: { A: entry, B: entry, C: entry } };
}

export const git = (args) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 30000 });
  return result.status === 0 ? result.stdout.trim() : "unknown";
};

// Runs the scenario in each arm and builds the rehearsal: the campaign (strictly in the format), the sidecar that marks it as a rehearsal, the analysis' report and a summary.
export async function rehearse({ prepared, arms, lane, windowed = false, assumeRefreshHz = null, log = () => undefined }) {
  const protocolBytes = await readFile(PROTOCOL_FILE);
  const protocol = JSON.parse(protocolBytes);
  const protocolSha256 = sha256(protocolBytes);
  const problems = protocolErrors(protocol);
  const executions = [];
  const runs = [];
  const unavailable = {};
  const assumed = [];
  for (const arm of arms) {
    log(`arm ${arm}, lane ${lane}${windowed ? ", windowed" : ", headless"}`);
    const run = launchScenario({ prepared, arm, lane, windowed });
    runs.push(run);
    if (!(await stat(run.reportFile).then(() => true, () => false))) {
      problems.push(`arm ${arm}: the scenario wrote no report (exit ${run.process.exitCode}); see ${path.relative(root, prepared.harness.directory)}/${run.label}.log`);
      continue;
    }
    const report = await readJson(run.reportFile);
    run.report = report;
    const { derived, problems: found } = analyse(report, protocol);
    problems.push(...found.map((problem) => `arm ${arm}: ${problem.message}`));
    problems.push(...report.anomalies.map((anomaly) => `arm ${arm}: ${anomaly}`));
    if (derived === null) {
      continue;
    }
    run.derived = derived;
    const hashes = { binary: prepared.binarySha256, package: prepared.package.sha256, script: prepared.scripts.sha256, protocol: protocolSha256 };
    const execution = executionOf({ report, derived, protocol, slot: slotOf(protocol, arm), load: run.load, hashes, ended: run.process });
    if (execution.vsync.refreshHz <= 0 && assumeRefreshHz !== null) {
      assumed.push({ arm, read: execution.vsync.refreshHz, assumed: assumeRefreshHz });
      execution.vsync.refreshHz = assumeRefreshHz;
    }
    executions.push(execution);
    unavailable[arm] = report.unavailable;
  }
  const first = runs.find((run) => run.report !== undefined)?.report;
  const sizes = [prepared.package.bytes, prepared.package.bytes];
  const hardware = machine();
  const campaign = campaignOf({
    executions,
    registered: registeredOf(prepared, goldenReplayHash(root)),
    instrument: { selfCheckPassed: false, sha256: prepared.instrumentSha256 },
    packages: { A: { exportBytes: sizes }, B: { exportBytes: sizes }, C: { exportBytes: sizes } },
    provenance: {
      commit: git(["rev-parse", "HEAD"]),
      machine: `${hardware.chip}, ${hardware.logicalCores} cores, ${hardware.memoryGb} GB`,
      system: hardware.os,
      ...environmentOf(first),
      rawData: path.relative(root, prepared.harness.directory),
      deviations: [
        "REHEARSAL: not a comparative execution and not a campaign; no number of it is a result of any arm",
        "Debug build, not the Release export of V05-07; the binary is the engine's executable and the package is the provisioned copy, not an export",
        "one execution per arm instead of the 36 executions of the sequence, with no redo and no balance",
        "the registration is the rehearsal's own: it registers what it measured, in the same process that measured it",
        "packages.<arm>.exportBytes is the size of the provisioned copy, twice, not the size of an exported package",
        "the instrument's self-check was not run for this rehearsal",
        ...(assumed.length > 0 ? [`the refresh rate read back was not positive (a headless display has none) and ${assumeRefreshHz} Hz was assumed for the format: ${JSON.stringify(assumed)}`] : []),
      ],
    },
  });
  const formatErrors = campaignErrors(campaign, protocol);
  const campaignText = `${JSON.stringify(campaign, null, 2)}\n`;
  const analysis = problems.length === 0 && formatErrors.length === 0 ? buildReport({ campaign, protocol, protocolSha256, campaignSha256: sha256(campaignText) }) : null;
  const readCosts = await readCostsOf();
  const sidecar = {
    rehearsal: true,
    notAResult: "This is a rehearsal of the scenario. No number in it is a measurement of an arm for the comparison, and no campaign was run.",
    campaign: "campaign.json",
    campaignSha256: sha256(campaignText),
    lane,
    windowed,
    arms,
    assumedRefreshHz: assumed,
    unavailableWindows: unavailable,
    sizesAre: "the size of the provisioned copy, not of a Release export",
    provenance: { readCosts },
  };
  return { protocol, protocolSha256, campaign, campaignText, formatErrors, problems, analysis, sidecar, runs, executions };
}

// The summary of a rehearsal: what ran, how long it took, which windows have how many occurrences, what was unavailable and why, and how the analysis judged each execution.
export function summaryOf(result, prepared) {
  const slots = result.analysis === null ? [] : result.analysis.sections.validity.slots.filter((slot) => slot.state !== "missing" && slot.state !== "not-planned");
  return {
    rehearsal: true,
    notAResult: result.sidecar.notAResult,
    lane: result.sidecar.lane,
    windowed: result.sidecar.windowed,
    commit: result.campaign.provenance.commit,
    hashes: { binary: prepared.binarySha256, package: prepared.package.sha256, script: prepared.scripts.sha256, protocol: result.protocolSha256 },
    scriptFiles: prepared.scripts.files,
    provenance: result.sidecar.provenance,
    formatErrors: result.formatErrors,
    problems: result.problems,
    status: result.analysis === null ? null : result.analysis.status,
    executions: result.runs.filter((run) => run.derived !== undefined).map((run) => {
      const { report, derived } = run;
      const execution = result.executions.find((candidate) => candidate.arm === report.arm);
      return {
        arm: report.arm,
        seconds: run.seconds,
        exitCode: run.process.exitCode,
        frames: report.frames.frame.length,
        vsync: report.vsync,
        timeToInteractiveHudMs: report.boot.timeToInteractiveHudMs ?? null,
        game: report.game,
        parity: report.parity,
        windows: Object.fromEntries(Object.entries(derived.windows).map(([id, window]) => [id, {
          available: window.available,
          occurrences: window.occurrences.length,
          measured: window.occurrences.filter((occurrence) => !occurrence.warmup).length,
          frames: window.occurrences.reduce((total, occurrence) => total + occurrence.frameUsec.length, 0),
          reason: window.reason,
        }])),
        idleFrames: derived.idle.cpuUsec.length,
        latencyClicks: report.latency.frames.length,
        costsUsec: report.costsUsec,
        hooks: report.boot.hooks,
        anomalies: report.anomalies,
        rejected: (slots.find((slot) => slot.arm === report.arm)?.attempts ?? []).flatMap((attempt) => attempt.reasons.map((reason) => `${reason.rule}:${reason.clause}`)),
        errors: execution.errors,
      };
    }),
  };
}

function parseArguments(argv) {
  const options = { rehearsal: false, arms: ["A", "B", "C"], lane: null, windowed: false, assumeRefreshHz: null, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--rehearsal") {
      options.rehearsal = true;
    } else if (argument === "--arms") {
      options.arms = (argv[++index] ?? "").split(",");
    } else if (argument === "--lane") {
      options.lane = argv[++index];
    } else if (argument === "--windowed") {
      options.windowed = true;
    } else if (argument === "--assume-refresh-hz") {
      options.assumeRefreshHz = Number(argv[++index]);
    } else if (argument === "--out") {
      options.out = path.resolve(argv[++index] ?? "");
    } else {
      throw new Error(`unknown argument ${argument}`);
    }
  }
  if (!options.rehearsal) {
    throw new Error("this part of the runner only runs the rehearsal: use --rehearsal --arms A,B,C --lane presented|unlimited [--windowed]");
  }
  if (!["presented", "unlimited"].includes(options.lane) || options.arms.some((arm) => !["A", "B", "C"].includes(arm))) {
    throw new Error("use --lane presented|unlimited and --arms among A,B,C");
  }
  return options;
}

async function main(argv) {
  const options = parseArguments(argv);
  const prepared = await prepareProject();
  try {
    const result = await rehearse({ prepared, arms: options.arms, lane: options.lane, windowed: options.windowed, assumeRefreshHz: options.assumeRefreshHz, log: (line) => console.log(line) });
    const out = options.out ?? prepared.harness.directory;
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, "campaign.json"), result.campaignText);
    await writeFile(path.join(out, "rehearsal.json"), `${JSON.stringify(result.sidecar, null, 2)}\n`);
    if (result.analysis !== null) {
      await writeFile(path.join(out, "report.json"), serializeReport(result.analysis));
    }
    await writeFile(path.join(out, "summary.json"), `${JSON.stringify(summaryOf(result, prepared), null, 2)}\n`);
    for (const problem of [...result.problems, ...result.formatErrors]) {
      console.error(`FAIL ${problem}`);
    }
    if (result.problems.length > 0 || result.formatErrors.length > 0) {
      throw new Error("the rehearsal did not produce a campaign in the format");
    }
    console.log(`FRONTIER_COMPARISON_REHEARSAL_WRITTEN: ${out}, status ${result.analysis.status}`);
  } finally {
    await prepared.harness.cleanup();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
