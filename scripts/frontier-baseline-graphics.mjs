import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {GRAPHICS_RUNS, IDLE_FRAMES, ROUNDS, WARMUP_ROUNDS} from "../tests/frontier-baseline-cases.mjs";
import {graphicsRunValidity, summarizeGraphicsRuns, verifyGraphicsReceipt, verifyGraphicsRun} from "../tests/frontier-baseline-oracle.mjs";
import {bundleFrontierBaselineProbe} from "./frontier-baseline-bundle.mjs";
import {ensureGodotBinary} from "./godot-binary.mjs";

// The windowed lane of the performance baseline, local only (a real window, the native renderer and a display; CI has none): the
// scene of the baseline in a real window, GRAPHICS_RUNS runs in separate processes, each with WARMUP_ROUNDS rounds of the tour thrown away
// and ROUNDS measured (30 swaps for every ordered pair of panels), the intervals between consecutive process frames in an idle window and in the
// frames that took a click, the vsync mode and refresh rate read back from the window, the load of the system before and after every
// run, and one capture per panel. The receipt keeps every raw interval, so that the percentiles are recomputed from the data
// and nothing is discarded; the statistics across runs are the median and the interquartile range of each run's.
//
// A frame time exists only if a display presents the window. A run is a measurement only if the window drew throughout AND its idle reference
// (the median of the half-sums of consecutive pairs of the idle intervals, idleReference in the oracle) is at least half of the refresh period the
// window read back (a presented window at 120 Hz has a reference of about 8.3 ms, an unpaced one of about 0.6 ms: the display off or showing the lock
// screen, with the vsync still reading back enabled). The median of the idle intervals is recorded but no longer judges: with the vsync on the
// intervals come in two alternating groups and the median falls in one or the other. A run that fails either rule is kept
// in the receipt under rejectedAttempts, with its reason ("unpaced: the display is not presenting" or "undrawn: ...") and its raw intervals, and
// repeated, up to MAX_ATTEMPTS times for the same slot. If a slot exhausts its attempts the lane stops: the receipt is written with
// presented: false, status "not presented: <reason>" and NO frame-time statistic (summary is null, and nothing of the rejected attempts is
// printed as a frame time), and the process exits with EXIT_NOT_PRESENTED (3), which is neither success nor a crash, so that nothing
// downstream mistakes it for a baseline. A complete lane exits 0. The receipt is checked by verifyGraphicsReceipt before it is written.
//
// The probe puts its window in front of the others and above them before it measures, and records for every process frame whether the engine could draw
// it (tests/window-presence.gd, docs/research/windowed-presence.md): on macOS the engine does not draw a window that is occluded. The count (undrawableFrames, of
// sampledFrames) is in every attempt, and the reason of a run refused as undrawn says what the engine said of the window (a run in which it never said it could not draw stays open). The rule of validity is unchanged.
// What the helper cannot do is make a display that is asleep or locked present the window, so keep the display awake and the Mac unlocked. Run with:
//   caffeinate -d node scripts/frontier-baseline-graphics.mjs
const EXIT_NOT_PRESENTED = 3;
const root = fileURLToPath(new URL("..", import.meta.url));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const bundle = await bundleFrontierBaselineProbe();
const binary = await ensureGodotBinary();
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
  os: `macOS ${read("sw_vers", ["-productVersion"])} (${read("sw_vers", ["-buildVersion"])})`, architecture: read("uname", ["-m"]),
  displays: displays()};

// One process of the probe: its file, its log and the system load around it. Whatever it reports, the engine must not have complained.
async function launch(number, extra = []) {
  const file = path.join(root, `build/frontier-baseline-graphics-run-${number}.json`);
  await rm(file, {force: true});
  const before = loadAverage();
  const started = Date.now();
  const result = spawnSync(binary, ["--path", root, "--windowed", "--script", "res://tests/frontier-baseline-graphics-probe.gd", "--",
    `--run=${number}`, ...extra], {encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024});
  const after = loadAverage();
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/frontier-baseline-graphics-run-${number}.log`), log);
  let report;
  try {
    report = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`Run ${number} of the graphical probe did not write its file (${error.message}). Godot output:\n${log}`);
  }
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, 0, "No engine or check error is hidden");
  assert.equal(result.status, 0, log);
  assert.match(log, /FRONTIER_BASELINE_GRAPHICS_PASSED: \d+/);
  return {report, load: {before, after, seconds: Math.round((Date.now() - started) / 100) / 10}};
}

// The runs, each in a process of its own, accepted or rejected by graphicsRunValidity (see the header), at most MAX_ATTEMPTS for each of the
// GRAPHICS_RUNS slots. No other run is ever left out.
const MAX_ATTEMPTS = 3;
await mkdir(path.join(root, "build/frontier-baseline-graphics"), {recursive: true});
const runs = [];
const attempts = [];
let number = 0;
let stopped = null;
for (let slot = 1; slot <= GRAPHICS_RUNS && stopped === null; ++slot) {
  let accepted = false;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !accepted; ++attempt) {
    const {report, load} = await launch(++number);
    verifyGraphicsRun(report);
    const validity = graphicsRunValidity(report);
    report.attempt = number;
    report.run = slot;
    attempts.push({slot, attempt: number, ...validity, loadAverage: load});
    if (validity.valid) {
      runs.push(report);
      accepted = true;
    } else {
      report.rejected = validity;
      attempts.at(-1).raw = report;
    }
  }
  if (!accepted) {
    stopped = {slot, reason: attempts.at(-1).reason};
  }
}
const presented = stopped === null;
// The captures are a run of their own, which measures nothing and does not depend on a display pacing the loop: one image per panel and the base,
// read back from the viewport on the same renderer.
const shots = (await launch(0, ["--captures"])).report;
const captures = await Promise.all(shots.captures.map(async file => {
  const bytes = await readFile(path.join(root, file));
  return {path: file, sha256: digest(bytes), bytes: bytes.length};
}));
assert.deepEqual(captures.map(capture => path.basename(capture.path, ".png")), ["panel-empty", "panel-units", "panel-city", "panel-research"]);
assert.ok(captures.every(capture => capture.bytes > 1000), "Every capture has an image");
const summary = presented ? summarizeGraphicsRuns(runs) : null;
const first = runs[0] ?? shots;
// The raw data: every interval of every run, the swaps as [round, step, from, to, latency in frames, injection, time to the nodes, time to the
// first drawn frame (microseconds, null when none was seen), the intervals of the swap's frames]; and the window's presence: whether the engine could draw it, frame by frame.
const rawOf = run => ({run: run.run, attempt: run.attempt, presence: run.presence ?? null, idleIntervalsUsec: run.idle.intervalsUsec, idleDraws: run.idle.draws, heap: {
  startBytes: run.heap.start.performance.hermes.heap.hermes_allocatedBytes, endBytes: run.heap.end.performance.hermes.heap.hermes_allocatedBytes,
  startRssKb: run.heap.start.godot.rssKb, endRssKb: run.heap.end.godot.rssKb},
swaps: run.swaps.map(swap => [swap.round, swap.step, swap.from, swap.to, swap.latencyFrames, swap.flushUsec, swap.latencyUsec, swap.drawUsec, swap.frameUsec])});
const raw = runs.map(rawOf);
const rejectedAttempts = attempts.filter(each => each.raw !== undefined).map(each => ({...each, raw: rawOf(each.raw)}));
const receipt = {format: "godot-fabric.frontier-baseline-graphics/v2", scenario: first.scenario, godot: first.godot,
  presented, status: presented ? "presented" : `not presented: ${stopped.reason} (slot ${stopped.slot}, ${MAX_ATTEMPTS} attempts)`,
  command: "Godot --path <checkout> --windowed --script res://tests/frontier-baseline-graphics-probe.gd -- --run=<n>",
  protocol: {runs: GRAPHICS_RUNS, maxAttempts: MAX_ATTEMPTS, warmupRounds: WARMUP_ROUNDS, rounds: ROUNDS, swapsPerPair: ROUNDS, idleFrames: IDLE_FRAMES,
    viewport: first.viewport, percentiles: "nearest rank over the raw intervals of one run",
    acrossRuns: "median and interquartile range (nearest-rank quartiles) of each run's statistic",
    validity: "a run counts only if the window drew throughout (a frame after every steady click and nine of ten in the idle window) and its idle reference (the median of the half-sums of consecutive pairs of the idle intervals) is at least half of the refresh period read back; any other run is rejected with its reason, kept in rejectedAttempts and repeated; a slot that exhausts its attempts ends the lane as not presented, with no frame-time statistic",
    presence: "the window is put in front of the others and above them before the first measurement (tests/window-presence.gd), and every process frame records whether the engine could draw it (window_can_draw()): each attempt carries undrawableFrames, of sampledFrames, and the raw runs the spans of those frames; the reason of a run refused for not drawing says what the engine said of the window, and a run in which window_can_draw() was never false stays open (no cause is concluded). The rule of validity does not read it",
    discarded: "the warm-up rounds, and the rejected attempts; every interval of every accepted run is in raw, and every rejected attempt is kept in rejectedAttempts"},
  machine, provenance: first.provenance, attempts: attempts.map(({raw: _raw, ...each}) => each),
  nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))),
  bundleSha256: bundle.bundle.sha256, checks: runs[0]?.checks ?? null, capturesChecks: shots.checks, capturesPresence: shots.presence ?? null, captures, summary, raw,
  rejectedAttempts,
  limitations: ["Putting the window in front and above the others does not make a display show it: a display that is asleep or locked, or a window the system keeps on another Space, is still not drawn, and the receipt then counts the frames the engine could not draw (undrawableFrames).",
    "Godot macOS windowed run with synthetic events through Input.parse_input_event; no hardware pointer or touch screen, no mobile export.",
    "One machine, one display and one vsync mode (the project default, read back from the window); a frame time with the vsync disabled was not measured.",
    "The intervals are of process frames. With the vsync on they come in clusters (the engine runs ahead of the display and blocks on it), so a missed frame is not read from them; missed frames with the vsync on need presentation timestamps this engine does not give."]};
verifyGraphicsReceipt(receipt);
await writeFile(path.join(root, "build/frontier-baseline-graphics.json"), JSON.stringify(receipt, null, 2) + "\n");
const line = (name, value) => `${name.padEnd(26)}${value}`;
console.log(JSON.stringify({presented, status: receipt.status, displayServer: first.provenance.displayServer, renderer: first.provenance.renderingMethod,
  adapter: first.provenance.adapter, vsync: first.provenance.vsyncModeName, refreshRate: first.provenance.refreshRate, accepted: runs.length,
  attempts: attempts.length, undrawableFrames: attempts.map(attempt => `${attempt.slot}.${attempt.attempt}: ${attempt.undrawableFrames} of ${attempt.sampledFrames}`),
  captures: captures.map(capture => capture.path)}, null, 2));
if (presented) {
  for (const run of summary.runs) {
    console.log(line(`run ${run.run} idle (ms)`, `p50 ${run.idleFrameMs.p50}  p95 ${run.idleFrameMs.p95}  p99 ${run.idleFrameMs.p99}  max ${run.idleFrameMs.max}`));
    console.log(line(`run ${run.run} swap frame (ms)`, `p50 ${run.swapFrameMs.p50}  p95 ${run.swapFrameMs.p95}  p99 ${run.swapFrameMs.p99}  max ${run.swapFrameMs.max}  above 2x idle reference ${run.swapFrameMs.aboveTwiceIdleReference}/${run.swapFrameMs.samples}  above 2x idle median ${run.swapFrameMs.aboveTwiceIdleMedian}/${run.swapFrameMs.samples}`));
  }
  console.log(JSON.stringify(summary.across, null, 2));
} else {
  // Nothing of a rejected attempt is printed as a frame time: only why it was rejected.
  console.log("NOT PRESENTED: the lane ends without frame-time numbers. Wake and unlock the display and run it again.");
  for (const attempt of attempts) {
    console.log(line(`slot ${attempt.slot} attempt ${attempt.attempt}`, `${attempt.valid ? "accepted" : `rejected, ${attempt.reason}`} (idle reference ${attempt.idleReferenceMs} ms, at least ${attempt.minimumIdleReferenceMs} ms wanted; idle median ${attempt.idleMedianMs} ms)`));
  }
  process.exitCode = EXIT_NOT_PRESENTED;
}
