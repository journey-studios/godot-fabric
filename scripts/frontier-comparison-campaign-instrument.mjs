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

const INSTRUMENT_FILE = "tests/cpu-time-instrument.gd";
const PROBE = "res://tests/cpu-time-instrument-probe.gd";
const REPORT_NAME = "cpu-time-instrument-campaign-report.json";
const PROBE_TIMEOUT_MS = 900000;

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

// Runs the probe with `engine` (headless, or in a window with `windowed`) and judges its raw report with the oracle. `outDirectory` gets the probe's report and log. The answer is what the
// campaign's state keeps: whether the check passed (the probe's process and its own checks, the log without a hidden error, the oracle's verdict, and in a window that a display presented it),
// and why not, the lane, the instrument's SHA-256 and the engine's provenance. `project`, `spawn` and `judge` are the checkout, the process and the oracle, injectable for the tests.
export async function runSelfCheck({ engine, windowed = false, outDirectory, project = root, spawn = spawnSync, judge = judgeCpuTimeInstrumentReport }) {
  const reportFile = path.join(project, "build", REPORT_NAME);
  await mkdir(path.join(project, "build"), { recursive: true });
  await rm(reportFile, { force: true });
  const started = Date.now();
  const result = spawn(engine, ["--path", project, windowed ? "--windowed" : "--headless", "--script", PROBE, "--", `--report=${REPORT_NAME}`], { encoding: "utf8", timeout: PROBE_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await mkdir(outDirectory, { recursive: true });
  await writeFile(path.join(outDirectory, "probe.log"), log);
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
    await copyFile(reportFile, path.join(outDirectory, "probe-report.json"));
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
  return {
    passed: why.length === 0,
    why,
    lane: windowed ? "windowed" : "headless",
    sha256: sha256(await readFile(path.join(project, INSTRUMENT_FILE))),
    seconds: Math.round((Date.now() - started) / 100) / 10,
    probe,
    oracle,
    provenance,
    files: { report: report === null ? null : "probe-report.json", log: "probe.log" },
  };
}
