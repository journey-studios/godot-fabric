import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {TARGETS_MS, judgeCpuTimeInstrumentReport} from "../tests/cpu-time-instrument-oracle.mjs";
import {ensureGodotBinary} from "./godot-binary.mjs";

// The windowed lane of the CPU-time instrument's self-check, local only (a real window, the Compatibility renderer and a display; CI has none): the probe
// (tests/cpu-time-instrument-probe.gd) runs once in a window, with the same schedule as the headless lane and a render pulse more, and the oracle
// (tests/cpu-time-instrument-oracle.mjs) judges its raw report. It is one run in one process and it is not repeated: a frame time exists only if a display
// presents the window, so the oracle first asks whether the window drew nine in ten of its idle frames and whether the idle reference of its intervals (the
// median of the half-sums of consecutive pairs, the baseline's idleReference) is at least half of the refresh period that the window read back. A window that
// no display presented is "not presented", with the reason: the receipt keeps the raw data, claims no accuracy, and the script exits with 3, which is neither
// success (0) nor a failure (1), so that nothing downstream takes it for a measurement. A presented window is judged by every rule of the headless lane, and
// by the render term's: the render pulse has to land six draws after its draw. Run with the display awake:
//   caffeinate -d node scripts/cpu-time-instrument-graphics.mjs
// --replay=<report.json> judges a report that was recorded before, without a window, and writes build/cpu-time-instrument-graphics-replay.json.
const EXIT_NOT_PRESENTED = 3;
const root = fileURLToPath(new URL("..", import.meta.url));
const replayArgument = process.argv.find(argument => argument.startsWith("--replay="));
const read = (command, args) => {
  const result = spawnSync(command, args, {encoding: "utf8", timeout: 30000});
  return result.status === 0 ? result.stdout.trim() : null;
};
const loadAverage = () => read("sysctl", ["-n", "vm.loadavg"]);

// The machine, the system and the display, as the system reports them. Names of the machine and its serials are not kept.
function displays() {
  const profiled = read("system_profiler", ["SPDisplaysDataType", "-json"]);
  if (profiled === null) {
    return null;
  }
  try {
    return JSON.parse(profiled).SPDisplaysDataType.flatMap(adapter => (adapter.spdisplays_ndrvs ?? []).map(display => ({
      adapter: adapter.sppci_model ?? adapter._name, display: display._name, resolution: display._spdisplays_resolution,
      pixels: display._spdisplays_pixels, main: display.spdisplays_main === "spdisplays_yes"})));
  } catch {
    return null;
  }
}
const machine = {chip: read("sysctl", ["-n", "machdep.cpu.brand_string"]), model: read("sysctl", ["-n", "hw.model"]),
  logicalCores: Number(read("sysctl", ["-n", "hw.ncpu"])), memoryGb: Math.round(Number(read("sysctl", ["-n", "hw.memsize"])) / 2 ** 30),
  os: `macOS ${read("sw_vers", ["-productVersion"])} (${read("sw_vers", ["-buildVersion"])})`, architecture: read("uname", ["-m"]), displays: displays()};

// The one run of the probe in a window, or the report that --replay names.
async function obtain() {
  if (replayArgument !== undefined) {
    return {report: JSON.parse(await readFile(path.resolve(replayArgument.slice("--replay=".length)), "utf8")), probeStatus: 0, before: null, after: null, seconds: 0};
  }
  const reportName = "cpu-time-instrument-windowed-report.json";
  await rm(path.join(root, "build", reportName), {force: true});
  const binary = await ensureGodotBinary();
  const before = loadAverage();
  const started = Date.now();
  const result = spawnSync(binary, ["--path", root, "--windowed", "--script", "res://tests/cpu-time-instrument-probe.gd", "--", `--report=${reportName}`],
    {encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024});
  const after = loadAverage();
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, "build/cpu-time-instrument-windowed.log"), log);
  let report;
  try {
    report = JSON.parse(await readFile(path.join(root, "build", reportName), "utf8"));
  } catch (error) {
    throw new Error(`The windowed probe did not write its report (${error.message}). Godot output:\n${log}`);
  }
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  return {report, probeStatus: result.status, before, after, seconds: Math.round((Date.now() - started) / 100) / 10};
}

const {report, probeStatus, before, after, seconds} = await obtain();
const {violations, ...stats} = judgeCpuTimeInstrumentReport(report);
const presented = stats.presented === true;
const ok = presented && violations.length === 0 && probeStatus === 0;
const status = presented ? (ok ? "presented" : "presented, a rule failed") : `not presented: ${stats.reason ?? "the report is incomplete"}`;
const receipt = {format: "godot-fabric.cpu-time-instrument-graphics/v1", scenario: report.scenario, godot: report.godot, presented, status,
  command: "Godot --path <checkout> --windowed --script res://tests/cpu-time-instrument-probe.gd -- --report=<file>",
  attempts: 1, replayed: replayArgument !== undefined, loadAverage: {before, after, seconds}, machine, provenance: report.provenance,
  probe: {status: probeStatus, checks: report.checks}, violations, verdict: stats,
  limitations: ["Godot macOS windowed run on the Compatibility renderer; no hardware pointer, no mobile export, no iPhone.",
    "One machine, one display and one vsync mode (the project default, read back from the window); a window that no display presented is not a measurement.",
    "The busy loop is a synthetic load in the process step; the render term is exercised by a canvas item of 30,000 rectangles shown for one frame in eleven, not by a Frontier HUD.",
    "The wait for the display is excluded by construction: no term spans the swap. Missed frames with the vsync on are not read."],
  raw: report};
await writeFile(path.join(root, replayArgument === undefined ? "build/cpu-time-instrument-graphics.json" : "build/cpu-time-instrument-graphics-replay.json"), JSON.stringify(receipt) + "\n");
const line = (name, value) => `${name.padEnd(28)}${value}`;
console.log(JSON.stringify({presented, status, displayServer: report.provenance?.displayServer, renderer: report.provenance?.renderingMethod, adapter: report.provenance?.adapter,
  vsync: report.provenance?.vsyncModeName, refreshRate: report.provenance?.refreshRate, loadAverage: receipt.loadAverage}, null, 2));
if (presented) {
  console.log(line("idle interval reference", `${stats.presentation.idleIntervalReferenceMs} ms (refresh period ${stats.presentation.refreshPeriodMs} ms)`));
  console.log(line("idle CPU total", `median ${stats.cpu.idleTotalMedianMs} ms, p95 ${stats.cpu.idleTotalP95Ms} ms (${(100 * stats.cpu.idleTotalShare).toFixed(2)}% of the idle interval)`));
  for (const target of TARGETS_MS) {
    const row = stats.accuracy[target];
    console.log(line(`load ${target} ms`, `burned ${row.burnedMs} ms, read ${row.readMs} ms, error ${(100 * row.error).toFixed(2)}%`));
  }
  console.log(line("render pulse", `${stats.render.pulses} pulses, strongest lag ${stats.render.bestLag} draws, gains ${stats.render.gainsMs.join(" ")} ms`));
  for (const violation of violations) {
    console.log(`VIOLATION: ${violation}`);
  }
  process.exitCode = ok ? 0 : 1;
} else {
  // Nothing of a window that no display presented is printed as an accuracy: only why it was not presented.
  console.log("NOT PRESENTED: the lane ends without an accuracy. Wake and unlock the display and run it again.");
  if (stats.presentation !== undefined) {
    console.log(line("window", `drew ${stats.presentation.idleDraws} of 600 idle frames; idle interval reference ${stats.presentation.idleIntervalReferenceMs} ms, at least ${
      stats.presentation.refreshPeriodMs / 2} ms wanted`));
  }
  for (const violation of violations) {
    console.log(`VIOLATION: ${violation}`);
  }
  process.exitCode = violations.length === 0 ? EXIT_NOT_PRESENTED : 1;
}
