import { createHash } from "node:crypto";
import { syntheticReport } from "./frontier-comparison-run-synthetic.mjs";

// The fake launcher of the campaign's tests (V05-10, `execucao`, part 2), and the other injected parts of a campaign: a self-check that passes or fails, a clock that only moves when the
// campaign sleeps, and a load average that follows a script. The fake plays SYNTHETIC executions (tests/frontier-comparison-run-synthetic.mjs): nothing here was measured, nothing runs and no
// number says anything about an arm. A plan programs what a given attempt is, by its key `<lane>/<slot>/<attempt>`; an attempt that is not in the plan is a good one. The launch says
// whether the launcher killed the process at its time limit (`timedOut`), which a launcher is free to leave out: the campaign reads it as false.

export const sha = (text) => createHash("sha256").update(text).digest("hex");
// The game's hashes of the synthetic report, and the engine its provenance names.
const REPLAY_HASH = "a".repeat(64);
const SOAK_HASH = "b".repeat(64);
export const INSTRUMENT_SHA256 = sha("fake-instrument");
const ENGINE = { godot: "4.7.2.stable.fake", godotHash: "fake-hash", architecture: "arm64", renderingMethod: "gl_compatibility" };
// What the probe and the scenario record of the engine and the display, headless and in a window.
export const HEADLESS_ENGINE = { ...ENGINE, displayServer: "headless", renderingDriver: "dummy", adapter: "" };
const WINDOWED_ENGINE = { ...ENGINE, displayServer: "macOS", renderingDriver: "opengl3", adapter: "Fake GPU" };
export const where = () => ({ commit: "fake-commit", machine: "fake machine", system: "fake system" });

export const registeredOf = () => ({
  seed: 4242,
  replayGoldenHash: REPLAY_HASH,
  soakFinalHash: SOAK_HASH,
  instrumentSha256: INSTRUMENT_SHA256,
  arms: Object.fromEntries(["A", "B", "C"].map((arm) => [arm, { binarySha256: sha(`binary-${arm}`), packageSha256: sha(`package-${arm}`), scriptSha256: sha(`script-${arm}`) }])),
});

// What an attempt can be, to put in a plan.
export const attempts = {
  // The 1-minute load above the limit (2.0) before the process.
  highLoad: { load: { before: 5.3, after: 1 } },
  // A display that drew nothing: the presented lane rejects it as not presented.
  notPresented: { change: (report) => report.frames.drawn.fill(0) },
  // The stress window unavailable (a missing hook): the execution has fewer measured occurrences than the protocol counts.
  incomplete: { options: { unavailable: { stress: "fake: the game has no stress_step()" } } },
  // Another game: the replay's golden hash differs from the registered one.
  otherGame: { change: (report) => (report.game.replayGoldenHash = "c".repeat(64)) },
  // A script error in the log and an exit code of 1.
  failing: { exitCode: 1, log: "SCRIPT ERROR: fake\n" },
  // A process that was killed and wrote no report.
  crashed: { noReport: true, exitCode: -1, signal: "SIGSEGV", log: "Program crashed\n" },
  // A process that the launcher killed at its time limit (SIGTERM) and that wrote no report.
  timedOut: { noReport: true, timedOut: true, exitCode: -1, signal: "SIGTERM", log: "FRONTIER_COMPARISON_SCENARIO_STARTED\n" },
  // A process that was killed while it wrote its report: the launcher found a file that is not JSON, returned no report and said in the log where it kept the file.
  unreadableReport: { noReport: true, exitCode: -1, signal: "SIGKILL", log: "FRONTIER_COMPARISON_SCENARIO_STARTED\nFRONTIER_COMPARISON_REPORT_UNREADABLE: /tmp/run-B-presented.unreadable.json (Unexpected end of JSON input)\n" },
  // A process that exited 0 and wrote no report.
  silent: { noReport: true, log: "FRONTIER_COMPARISON_SCENARIO_STARTED\n" },
  // A scenario that waited with a number other than the protocol's: nothing in the analysis' rules sees it.
  otherWaits: { change: (report) => (report.config.waits.burstMinimumFrames = 4) },
  // The vsync reads back as ENABLED where DISABLED was asked for.
  vsyncEnabled: { options: { mode: "ENABLED" } },
};

// The report of an attempt: the synthetic report of the arm and lane, with the provenance a real one has (the engine and the display) and the game's registered hashes.
function reportOf(protocol, { arm, lane }, directive, windowed) {
  const report = syntheticReport(protocol, { arm, lane, mode: lane === "unlimited" ? "DISABLED" : "ENABLED", ...directive.options });
  report.provenance = { ...(windowed ? WINDOWED_ENGINE : HEADLESS_ENGINE), screenSize: [1, 1], screenScale: 1, windowSize: [1, 1] };
  directive.change?.(report);
  return report;
}

// The launcher: `plan` programs attempts, `interruptBefore` throws when that many attempts have been launched (a campaign that is killed, to be resumed), and `registration` is what it
// registers (a test changes a hash to make a resume refuse). `calls` is every launch, in order, and `concurrent` the most launches that were ever running at once.
export function fakeLauncher({ protocol, plan = {}, interruptBefore = null, registration = registeredOf(), deviations = [], windowed = false }) {
  const calls = [];
  let running = 0;
  const launcher = {
    build: "release",
    name: "fake",
    windowed,
    calls,
    concurrent: 0,
    cleanups: 0,
    async prepare() {
      return { engine: "fake-engine", registered: registration, packages: Object.fromEntries(["A", "B", "C"].map((arm) => [arm, { exportBytes: [1000, 1000] }])), deviations };
    },
    async launch(request) {
      if (interruptBefore !== null && calls.length === interruptBefore) {
        throw new Error("simulated interruption");
      }
      calls.push({ ...request });
      running += 1;
      launcher.concurrent = Math.max(launcher.concurrent, running);
      try {
        await Promise.resolve();
        const directive = plan[`${request.lane}/${request.slot}/${request.attempt}`] ?? {};
        const arm = registration.arms[request.arm];
        return {
          report: directive.noReport ? null : reportOf(protocol, request, directive, windowed),
          exitCode: directive.exitCode ?? 0,
          signal: directive.signal ?? null,
          timedOut: directive.timedOut ?? false,
          log: directive.log ?? "FRONTIER_COMPARISON_SCENARIO_DONE\n",
          load: directive.load ?? { before: 0.9, after: 1 },
          hashes: { binary: arm.binarySha256, package: arm.packageSha256, script: arm.scriptSha256 },
          seconds: 60,
        };
      } finally {
        running -= 1;
      }
    },
    async cleanup() {
      launcher.cleanups += 1;
    },
  };
  return launcher;
}

// A self-check that has been through the probe and the oracle and passes (or does not), in the lane it is asked for, recording the engine and display of the fake scenario in that lane unless a
// test gives another provenance.
export function selfCheck({ passed = true, provenance = null } = {}) {
  const runs = [];
  const run = async (request) => {
    runs.push(request);
    const lane = request.windowed ? "windowed" : "headless";
    return { passed, why: passed ? [] : ["the oracle rejects the report: fake"], lane, sha256: INSTRUMENT_SHA256, seconds: 1, probe: {}, oracle: {}, provenance: provenance ?? (request.windowed ? WINDOWED_ENGINE : HEADLESS_ENGINE), files: {} };
  };
  run.runs = runs;
  return run;
}

// A clock that moves only when the campaign sleeps (so a state is the same bytes in two runs), and a load average that follows a script (the last value repeats).
export function fakeClock(start = Date.parse("2026-10-10T00:00:00.000Z")) {
  const clock = {
    time: start,
    slept: 0,
    now: () => clock.time,
    async sleep(milliseconds) {
      clock.slept += milliseconds;
      clock.time += milliseconds;
    },
  };
  return clock;
}

export function scriptedLoad(values) {
  let index = 0;
  const read = () => values[Math.min(index++, values.length - 1)];
  read.count = () => index;
  return read;
}
