import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {graphicsRunValidity, summarizeGraphicsRuns, verifyGraphicsReceipt} from "../tests/frontier-baseline-oracle.mjs";
import {GAME_CONTEXTS, GRAPHICS_RUNS, IDLE_FRAMES, STEADY_ROUNDS, WARMUP_ROUNDS} from "../tests/frontier-turn-cases.mjs";
import {graphicsReceiptSource, graphicsRunOf, summarizeTurnFrames, verifyTurnGraphicsRun} from "../tests/frontier-turn-oracle.mjs";
import {createTurnLane, machine, loadAverage} from "./frontier-turn-lane.mjs";

// The windowed lane of the turn, local only (a real window, the native renderer and a display; CI has none): the provisioned Frontier game in a real window,
// GRAPHICS_RUNS runs in separate processes, each with WARMUP_ROUNDS rounds of the tour thrown away and STEADY_ROUNDS measured (19 clicks and four turns in each round),
// the intervals between consecutive process frames in an idle window, in the frames that took a click and in every frame of a turn (the phases of the sliced
// AI), the vsync mode and refresh rate read back from the window, the load of the system before and after every run, and one capture per context. The receipt
// keeps every raw interval, so that the percentiles are recomputed from the data and nothing is discarded; the statistics across runs are the median and the
// interquartile range of each run's.
//
// A frame time exists only if a display presents the window, and the rule is the baseline's, imported and not copied (tests/frontier-baseline-oracle.mjs): a run
// is a measurement only if the window drew throughout AND its idle reference (the median of the half-sums of consecutive pairs of its idle intervals) is at least half of
// the refresh period the window read back (a presented window at 120 Hz has a reference of about 8.3 ms, an unpaced one about 0.6 ms: the display off or showing the
// lock screen, with the vsync still reading back enabled). A run that
// fails either rule is kept in the receipt under rejectedAttempts, with its reason ("unpaced: the display is not presenting" or "undrawn: ...") and its raw
// intervals, and repeated, up to MAX_ATTEMPTS times for the same slot. If a slot exhausts its attempts the lane stops: the receipt is written with presented:
// false, status "not presented: <reason>" and NO frame-time statistic (summary is null, and nothing of the rejected attempts is printed as a frame time), and the
// process exits with EXIT_NOT_PRESENTED (3), which is neither success nor a crash, so that nothing downstream mistakes it for a result. A complete lane exits 0.
// The receipt is checked by verifyGraphicsReceipt before it is written. As in the baseline, the probe puts its window in front of the others and above them
// before it measures and counts the frames in which the engine could not draw it (tests/window-presence.gd, docs/research/windowed-presence.md); the count is in
// every attempt and the reason of a run refused as undrawn says whether the window could not draw. The rule of validity is unchanged. Run with:
//   caffeinate -d node scripts/frontier-turn-graphics.mjs
const EXIT_NOT_PRESENTED = 3;
const MAX_ATTEMPTS = 3;
const root = fileURLToPath(new URL("..", import.meta.url));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const read = (command, args) => {
  const result = spawnSync(command, args, {encoding: "utf8", timeout: 30000});
  return result.status === 0 ? result.stdout.trim() : null;
};

// The display, as the system reports it. Names of the machine and its serials are not kept.
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

await mkdir(path.join(root, "build/frontier-turn-graphics"), {recursive: true});
const lane = await createTurnLane({name: "frontier-turn-graphics"});
try {
  const prepared = await lane.prepare();

  // One process of the probe: its report, its log and the system load around it. Whatever it reports, the engine must not have complained.
  async function launch(number, laneName) {
    const {result, log, report, load} = await lane.launch({label: `windowed-${laneName}-${number}`, lane: laneName, windowed: true, extra: [`--run=${number}`]});
    await writeFile(path.join(root, `build/frontier-turn-graphics-${laneName}-${number}.log`), log);
    assert.ok(report != null, `Run ${number} of the windowed probe did not write its report. Godot output:\n${log}`);
    assert.equal(result.error, undefined, log);
    assert.equal(result.signal, null, log);
    assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use|FABRIC_ERROR/);
    assert.equal([...log.matchAll(/^ERROR:/gm)].length, 0, "No engine or check error is hidden");
    assert.equal(result.status, 0, log);
    assert.match(log, /FRONTIER_TURN_PASSED: \d+/);
    return {report, load};
  }

  // The runs, each in a process of its own, accepted or rejected by graphicsRunValidity (see the header), at most MAX_ATTEMPTS for each of the GRAPHICS_RUNS slots.
  // No other run is ever left out.
  const reports = [];
  const attempts = [];
  let number = 0;
  let stopped = null;
  for (let slot = 1; slot <= GRAPHICS_RUNS && stopped === null; ++slot) {
    let accepted = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !accepted; ++attempt) {
      const {report, load} = await launch(++number, "windowed");
      verifyTurnGraphicsRun(report);
      const validity = graphicsRunValidity(graphicsRunOf(report));
      report.attempt = number;
      report.run = slot;
      attempts.push({slot, attempt: number, ...validity, loadAverage: load});
      if (validity.valid) {
        reports.push(report);
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

  // The captures are a run of their own, which measures nothing and does not depend on a display pacing the loop: the first time each context shows.
  const shots = (await launch(0, "captures")).report;
  assert.equal(shots.stages.aborted, null, "Every click of the captures run showed its panels");
  const kept = await lane.keepCaptures(path.join(root, "build/frontier-turn-graphics"));
  const captures = await Promise.all(kept.map(async file => {
    const bytes = await readFile(file);
    return {path: path.relative(root, file), sha256: digest(bytes), bytes: bytes.length};
  }));
  assert.deepEqual(captures.map(capture => path.basename(capture.path, ".png")).sort(), GAME_CONTEXTS.map(context => `context-${context}`).sort(), "One capture for each context");
  assert.ok(captures.every(capture => capture.bytes > 1000), "Every capture has an image");

  const summary = presented ? summarizeGraphicsRuns(reports.map(report => graphicsRunOf(report, {withTurns: false}))) : null;
  const turnFrames = presented ? summarizeTurnFrames(reports) : null;
  const first = graphicsReceiptSource({accepted: reports, attempts, captures: shots});
  // The raw data: every interval of every accepted run. The clicks as [round, step, id, frames to the panels, injection, time to the panels, time to the first drawn
  // frame (microseconds, null when none was seen), the intervals of the frames of the click]; the turns as [round, id, the frames as [phase, interval, nodes,
  // snapshots, end of the turn], the host's pump, JS, mount and layout milliseconds over the turn].
  const rawOf = report => ({run: report.run, attempt: report.attempt, presence: report.stages.presence ?? null, idleIntervalsUsec: report.stages.idle.intervalsUsec, idleDraws: report.stages.idle.draws,
    clicks: report.stages.rounds.flatMap(row => row.steps.map(record => [record.round, record.step, record.id, record.frames, record.flushUsec, record.latencyUsec,
      record.drawUsec, record.frameUsec])),
    turns: report.stages.rounds.flatMap(row => row.steps.filter(record => record.kind === "turn").map(record => [record.round, record.id,
      record.turn.frames.map(frame => [frame.phase, frame.usec, frame.nodes, frame.snapshots, frame.turnEnded]),
      [record.turn.host.pumpMs, record.turn.host.jsMs, record.turn.host.mountMs, record.turn.host.layoutMs]]))});
  const raw = reports.map(rawOf);
  const rejectedAttempts = attempts.filter(each => each.raw !== undefined).map(each => ({...each, raw: rawOf(each.raw)}));
  const receipt = {format: "godot-fabric.frontier-turn-graphics/v1", scenario: "frontier-turn-graphics", godot: first.godot, presented,
    status: presented ? "presented" : `not presented: ${stopped.reason} (slot ${stopped.slot}, ${MAX_ATTEMPTS} attempts)`,
    command: "Godot --path <the provisioned consumer> --windowed -s res://turn_probe/frontier-turn-runner.gd -- --lane=windowed --run=<n>",
    protocol: {runs: GRAPHICS_RUNS, maxAttempts: MAX_ATTEMPTS, warmupRounds: WARMUP_ROUNDS, rounds: STEADY_ROUNDS, idleFrames: IDLE_FRAMES, viewport: first.stages.scene.viewport,
      percentiles: "nearest rank over the raw intervals of one run",
      acrossRuns: "median and interquartile range (nearest-rank quartiles) of each run's statistic",
      validity: "the baseline's, imported: a run counts only if the window drew throughout (a frame after every steady click and nine of ten in the idle window) and its idle reference (the median of the half-sums of consecutive pairs of the idle intervals) is at least half of the refresh period read back; any other run is rejected with its reason, kept in rejectedAttempts and repeated; a slot that exhausts its attempts ends the lane as not presented, with no frame-time statistic",
      presence: "the baseline's, imported: the window is put in front of the others and above them before the first measurement (tests/window-presence.gd) and every process frame records whether the engine could draw it (window_can_draw()); each attempt carries undrawableFrames, of sampledFrames, the raw runs the spans of those frames, and the reason of a run refused for not drawing says whether the window could not draw. The rule of validity does not read it",
      discarded: "the warm-up rounds, and the rejected attempts; every interval of every accepted run is in raw, and every rejected attempt is kept in rejectedAttempts"},
    machine: {...machine(), displays: displays()}, provenance: first.stages.provenance, attempts: attempts.map(({raw: _raw, ...each}) => each),
    nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), bundleSha256: prepared.bundleSha256, probeSha256: prepared.probeSha256,
    checks: reports[0]?.checks ?? null, capturesChecks: shots.checks, capturesPresence: shots.stages.presence ?? null, captures, summary, turnFrames, raw, rejectedAttempts,
    limitations: ["Putting the window in front and above the others does not make a display show it: a display that is asleep or locked, or a window the system keeps on another Space, is still not drawn, and the receipt then counts the frames the engine could not draw (undrawableFrames).",
"Godot macOS windowed run with synthetic events through the viewport on the validation device; no hardware pointer or touch screen, no mobile export.",
      "One machine, one display and one vsync mode (the project default, read back from the window); a frame time with the vsync disabled was not measured.",
      "The intervals are of process frames. With the vsync on they come in clusters (the engine runs ahead of the display and blocks on it), so a missed frame is not read from them; missed frames with the vsync on need presentation timestamps this engine does not give."],
    loadAverageAtTheEnd: loadAverage()};
  verifyGraphicsReceipt(receipt);
  await writeFile(path.join(root, "build/frontier-turn-graphics.json"), JSON.stringify(receipt, null, 2) + "\n");
  const line = (name, value) => `${name.padEnd(26)}${value}`;
  console.log(JSON.stringify({presented, status: receipt.status, displayServer: first.stages.provenance.displayServer, renderer: first.stages.provenance.renderingMethod,
    adapter: first.stages.provenance.adapter, vsync: first.stages.provenance.vsyncModeName, refreshRate: first.stages.provenance.refreshRate, accepted: reports.length,
    attempts: attempts.length, undrawableFrames: attempts.map(attempt => `${attempt.slot}.${attempt.attempt}: ${attempt.undrawableFrames} of ${attempt.sampledFrames}`),
    captures: captures.map(capture => capture.path)}, null, 2));
  if (presented) {
    for (const run of summary.runs) {
      console.log(line(`run ${run.run} idle (ms)`, `p50 ${run.idleFrameMs.p50}  p95 ${run.idleFrameMs.p95}  p99 ${run.idleFrameMs.p99}  max ${run.idleFrameMs.max}`));
      console.log(line(`run ${run.run} click frame (ms)`, `p50 ${run.swapFrameMs.p50}  p95 ${run.swapFrameMs.p95}  p99 ${run.swapFrameMs.p99}  max ${run.swapFrameMs.max}  above 2x idle reference ${run.swapFrameMs.aboveTwiceIdleReference}/${run.swapFrameMs.samples}  above 2x idle median ${run.swapFrameMs.aboveTwiceIdleMedian}/${run.swapFrameMs.samples}`));
    }
    console.log(JSON.stringify({clicks: summary.across, turn: turnFrames.across}, null, 2));
  } else {
    // Nothing of a rejected attempt is printed as a frame time: only why it was rejected.
    console.log("NOT PRESENTED: the lane ends without frame-time numbers. Wake and unlock the display and run it again.");
    for (const attempt of attempts) {
      console.log(line(`slot ${attempt.slot} attempt ${attempt.attempt}`, `${attempt.valid ? "accepted" : `rejected, ${attempt.reason}`} (idle reference ${attempt.idleReferenceMs} ms, at least ${attempt.minimumIdleReferenceMs} ms wanted; idle median ${attempt.idleMedianMs} ms)`));
    }
    process.exitCode = EXIT_NOT_PRESENTED;
  }
} finally {
  await lane.cleanup();
}
