import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { root } from "./consumer-harness.mjs";
import { sha256 } from "./frontier-comparison-run-campaign.mjs";
import { judgeCpuTimeInstrumentReport } from "../tests/cpu-time-instrument-oracle.mjs";

// The instrument's self-check as the gate of a campaign (V05-10, `execucao`; threshold `cpu-time-instrument`, `frozenValue.gate`): before the first execution of a campaign the probe
// (tests/cpu-time-instrument-probe.gd) and the oracle (tests/cpu-time-instrument-oracle.mjs) run again on the campaign's machine, with the campaign's engine and in the campaign's display mode,
// and tests/cpu-time-instrument.gd must be byte-identical to the file they passed: its SHA-256 goes into the campaign (`instrument.sha256`, beside `registered.instrumentSha256`). If the
// check fails, no execution runs.
//
// The lane of the check follows the launcher: a launcher that runs headless is checked headless, which is what `npm run test:cpu-time-instrument` runs; a launcher that runs windowed (the
// campaign proper, whose presented lane needs a display and whose unlimited lane needs a window to read the vsync back) is checked in a window, which is what
// `npm run bench:cpu-time-instrument-graphics` runs (scripts/cpu-time-instrument-graphics.mjs, a command line that cannot be imported: it is the same probe, the same flags and the same oracle).
// A window that no display presented is not a measurement, so the oracle's `presented` must be true for a windowed check to pass; that script exits with 3 for it, and this one does not pass it.
//
// The entry of the check, three ways to start the same probe: "script" (the default, `--script` in the editor's binary over this checkout, which `npm run test:cpu-time-instrument` runs), "main-loop"
// (the editor's binary over the probe project, `--path <probeProject>` and no `--script`: the probe is the project's main loop, scripts/frontier-comparison-probe-project.mjs) and "release" (the executable
// of an exported .app of the probe project, which an export template starts without `--path` or `--script`, from a working directory outside the .app). The last two give the probe an absolute
// `--report=<file>` in `outDirectory`. All three go through the same judgement: the probe's process, its checks, its log, the oracle, `presented` in a window and the instrument's SHA-256.

const INSTRUMENT_FILE = "tests/cpu-time-instrument.gd";
const PROBE = "res://tests/cpu-time-instrument-probe.gd";
const REPORT_NAME = "cpu-time-instrument-campaign-report.json";
const KEPT_REPORT = "probe-report.json";
const PROBE_TIMEOUT_MS = 900000;
const ENTRIES = ["script", "main-loop", "release"];

const parsedJson = async (file) => {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

// The arguments after the executable of the probe's process for an entry, pure. "script" gives `--report=<name>` (the probe writes it under res://build); the other two give an absolute `report`
// and no `--script`: "main-loop" has `--path` at the probe project, and "release" has no `--path` either.
export function selfCheckArguments({ entry = "script", windowed = false, project = root, probeProject, report }) {
  const mode = windowed ? "--windowed" : "--headless";
  if (entry === "script") {
    return ["--path", project, mode, "--script", PROBE, "--", `--report=${report}`];
  }
  if (!ENTRIES.includes(entry)) {
    throw new Error(`unknown entry of the self-check: ${entry} (${ENTRIES.join(", ")})`);
  }
  if (!path.isAbsolute(report)) {
    throw new Error(`--report must be an absolute path for the ${entry} entry: ${report}`);
  }
  if (entry === "main-loop") {
    if (typeof probeProject !== "string" || probeProject === "") {
      throw new Error("the main-loop entry needs the probe project: probeProject");
    }
    return ["--path", probeProject, mode, "--", `--report=${report}`];
  }
  return [mode, "--", `--report=${report}`];
}

// Runs the probe through `entry` and judges its raw report with the oracle. "script" runs `engine` (headless, or in a window with `windowed`) over `project`; "main-loop" runs `engine` over `probeProject`;
// "release" runs `executable`, with `outDirectory` as its working directory. `outDirectory` gets the probe's report and log. The answer is what the
// campaign's state keeps: whether the check passed (the probe's process and its own checks, the log without a hidden error, the oracle's verdict, and in a window that a display presented it),
// and why not, the entry, the lane, the instrument's SHA-256 and the engine's provenance. `project`, `spawn` and `judge` are the checkout, the process and the oracle, injectable for the tests, and
// so is the `timeout` of the process.
export async function runSelfCheck({
  engine, windowed = false, outDirectory, project = root, spawn = spawnSync, judge = judgeCpuTimeInstrumentReport, entry = "script", probeProject, executable, timeout = PROBE_TIMEOUT_MS,
}) {
  const out = path.resolve(outDirectory);
  const kept = path.join(out, KEPT_REPORT);
  const reportFile = entry === "script" ? path.join(project, "build", REPORT_NAME) : kept;
  const args = selfCheckArguments({ entry, windowed, project, probeProject, report: entry === "script" ? REPORT_NAME : kept });
  if (entry === "release" && (typeof executable !== "string" || executable === "")) {
    throw new Error("the release entry needs the executable of the exported probe: executable");
  }
  await mkdir(path.dirname(reportFile), { recursive: true });
  await mkdir(out, { recursive: true });
  await rm(reportFile, { force: true });
  const started = Date.now();
  const options = { encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 };
  const result = entry === "release" ? spawn(executable, args, { ...options, cwd: out }) : spawn(engine, args, options);
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(out, "probe.log"), log);
  const report = await parsedJson(reportFile);
  const why = [];
  if (result.status !== 0) {
    why.push(`the probe ended with ${result.status === null ? `signal ${result.signal}` : `exit ${result.status}`}`);
  }
  if (report === null) {
    why.push("the probe wrote no report");
  }
  if (/SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/.test(log)) {
    why.push("the probe's log has a script error, a crash or a leak");
  }
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map((match) => match[1]);
  const hiddenErrors = [...log.matchAll(/^ERROR:/gm)].length - checkErrors.length;
  if (hiddenErrors > 0) {
    why.push(`${hiddenErrors} error line(s) in the probe's log are not a failed check`);
  }
  let probe = { exitCode: result.status ?? -1, checks: 0, failed: [] };
  let oracle = { judged: false, violations: [] };
  let provenance = null;
  if (report !== null) {
    if (entry === "script") {
      await copyFile(reportFile, kept);
    }
    probe = { exitCode: result.status ?? -1, checks: report.checks.length, failed: report.checks.filter((row) => !row.passed).map((row) => row.name) };
    if (probe.failed.length > 0 || report.allCurrentAssertionsPassed !== true) {
      why.push(`the probe's checks failed: ${probe.failed.join(", ") || "allCurrentAssertionsPassed is not true"}`);
    }
    if (!/CPU_TIME_INSTRUMENT_PASSED: \d+/.test(log)) {
      why.push("the probe did not print CPU_TIME_INSTRUMENT_PASSED");
    }
    const verdict = judge(report);
    oracle = { judged: verdict.judged, violations: verdict.violations, presented: verdict.presented ?? null, reason: verdict.reason ?? null, accuracy: verdict.accuracy ?? null, cpu: verdict.cpu ?? null, engine: verdict.engine ?? null };
    if (windowed && verdict.presented !== true) {
      why.push(`no display presented the window, so the check measured nothing: ${verdict.reason ?? "the oracle gives no reason"}`);
    } else if (!verdict.judged || verdict.violations.length > 0) {
      why.push(`the oracle ${verdict.judged ? "rejects the report" : "could not judge the report"}: ${verdict.violations.join("; ")}`);
    }
    provenance = report.provenance;
  }
  const instrumentSha256 = sha256(await readFile(path.join(project, INSTRUMENT_FILE)));
  // The sha256 below is the repository's. The main-loop entry runs the copy in the probe project, which has to be the same file; the release entry's export is checked against it by the Release launcher.
  if (entry === "main-loop" && sha256(await readFile(path.join(probeProject, INSTRUMENT_FILE))) !== instrumentSha256) {
    why.push(`the probe project carries another ${INSTRUMENT_FILE} than the repository's (${instrumentSha256})`);
  }
  return {
    passed: why.length === 0,
    why,
    entry,
    lane: windowed ? "windowed" : "headless",
    sha256: instrumentSha256,
    seconds: Math.round((Date.now() - started) / 100) / 10,
    probe,
    oracle,
    provenance,
    files: { report: report === null ? null : "probe-report.json", log: "probe.log" },
  };
}
