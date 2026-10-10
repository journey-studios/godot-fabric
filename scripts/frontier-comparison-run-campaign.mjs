import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { CAMPAIGN_FORMAT } from "./frontier-comparison-format.mjs";
import { slotsOf, UNLIMITED } from "./frontier-comparison-protocol.mjs";
import { derivedOf } from "./frontier-comparison-run-windows.mjs";

// From what the scenario recorded (tests/frontier-comparison-scenario.gd) to the campaign of docs/research/frontier-comparison-analysis.md (`godot-fabric.frontier-comparison-campaign/v1`):
// the analysis of the scenario's report (the windows are derived here, from its trace and its samples), the execution object of one attempt and the campaign around the executions. Pure
// functions of the scenario's report, the protocol and the readings the orchestrator makes of the files and the machine; no process is run here.

const SCENARIO_FORMAT = "godot-fabric.frontier-comparison-scenario/v1";
export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

// What the comparison registers about the game, which is the same in the three arms because it is the same game (invalidation `not-the-registered-build` and `other-game`).
//  - the seed of V05-03;
//  - the golden hash of the 12-turn replay, the one fixed in tests/civ-lite-game-native.test.mjs (read from there, so that there is one place that says it);
//  - the final hash of the 100-turn soak, the one the soak of JavaScript reaches today: tests/frontier-comparison-player.test.mjs pins it, with the trail hash and the number of decisions,
//    and cites docs/evidence/civ-lite-ui/README.md and report.json (`afterTheChange`), which record the change that moved it from the hash docs/research/frontier-soak.md still describes.
export const SEED = 4242;
export const SOAK_FINAL_HASH = "0b21c332c1f86fb41522cdbed0144f168831f6ab51bc427769a68a146aa6afd0";

export function goldenReplayHash(root) {
  const source = readFileSync(`${root}/tests/civ-lite-game-native.test.mjs`, "utf8");
  const found = /const GOLDEN_HASH = "([0-9a-f]{64})";/.exec(source);
  if (found === null) {
    throw new Error("tests/civ-lite-game-native.test.mjs no longer fixes `const GOLDEN_HASH = \"...\";`");
  }
  return found[1];
}

// ---- the analysis of a scenario report ----

// The report of the scenario with everything this side derives from it (scripts/frontier-comparison-run-windows.mjs: the windows, the microseconds, the idle window, whether every measured
// intent was drawn), and the problems that make it not one to analyse. `derived` is null when the report is not in the scenario's format.
export function analyse(report, protocol) {
  if (report.format !== SCENARIO_FORMAT) {
    return { derived: null, problems: [`format: ${report.format} is not ${SCENARIO_FORMAT}`] };
  }
  const derived = derivedOf(report, protocol);
  return { derived, problems: derived.problems };
}

// ---- the execution object ----

// The FPS of a window in the unlimited lane: the frames of its measured occurrences over the time they took, from the start of the first frame of an occurrence to the start of the
// frame after its last. The protocol says "FPS without a limit, per window" and defines nothing more; this is the reading recorded in docs/research/frontier-comparison-execution.md.
export function fpsOf(derived, window) {
  let frames = 0;
  let microseconds = 0;
  derived.ranges[window.id].forEach((range, index) => {
    if (range.last === null || index < window.warmupOccurrences) {
      return;
    }
    frames += range.last - range.first + 1;
    microseconds += derived.table.startUsec(range.last + 1) - derived.table.startUsec(range.first);
  });
  return microseconds === 0 ? 0 : (frames * 1e6) / microseconds;
}

// The execution object of one attempt of the campaign format, from the scenario's report, what was derived from it and what the orchestrator knows of the process: its slot, the load
// before and after, the hashes of the files, and how the process ended (`ended`: the exit code and the counts of its log).
export function executionOf({ report, derived, protocol, slot, attempt = 1, build = "debug", load, hashes, ended }) {
  const fps = report.lane === UNLIMITED && report.vsync.mode === protocol.vsync.unlimitedFpsRequires;
  const windows = Object.fromEntries(
    protocol.windows.map((window) => {
      const derivedWindow = derived.windows[window.id];
      const entry = { occurrences: derivedWindow.occurrences };
      if (fps) {
        entry.fps = derivedWindow.available ? fpsOf(derived, window) : 0;
      }
      return [window.id, entry];
    }),
  );
  const execution = {
    arm: report.arm,
    lane: report.lane,
    slot,
    attempt,
    load,
    build,
    seed: report.seed,
    hashes,
    vsync: { mode: report.vsync.mode, refreshHz: report.vsync.refreshHz },
    game: { replayGoldenHash: report.game.replayGoldenHash, soakFinalHash: report.game.soakFinalHash },
    errors: { unhandledJs: report.applicationErrors, scriptErrors: ended.scriptErrors, godotLogErrors: ended.godotLogErrors, crashed: ended.crashed, exitCode: ended.exitCode },
    drew: derived.drew,
    idle: { cpuUsec: derived.idle.cpuUsec, intervalsUsec: derived.idle.intervalsUsec },
    windows,
    readings: report.readings,
  };
  if (report.arm !== "A") {
    execution.parityMatches = report.parity.matches;
  }
  return execution;
}

export const slotOf = (protocol, arm, position = 0) => slotsOf(protocol).filter((entry) => entry.arm === arm)[position].slot;

// ---- the campaign ----

// The campaign object around the executions. `rawData` is where the raw reports are kept; `deviations` says what is not the protocol's (a rehearsal deviates in several ways).
export function campaignOf({ executions, registered, instrument, provenance, packages }) {
  return {
    format: CAMPAIGN_FORMAT,
    registered,
    instrument,
    armB: { ready: true },
    provenance,
    executions,
    packages,
  };
}
