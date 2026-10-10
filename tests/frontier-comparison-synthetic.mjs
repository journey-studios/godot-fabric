import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CAMPAIGN_FORMAT } from "../scripts/frontier-comparison-format.mjs";
import { slotsOf } from "../scripts/frontier-comparison-protocol.mjs";
import { buildReport } from "../scripts/frontier-comparison-report.mjs";
import { mulberry32 } from "../scripts/frontier-comparison-statistics.mjs";

// SYNTHETIC campaigns of the final comparison of the 0.5 Frontier (V05-10), made up to exercise scripts/frontier-comparison-analysis.mjs. Nothing here was measured: every number is drawn from
// a seeded generator around a value that the caller chooses, and none of it is a result of any arm. The campaign has the order of the executions of the protocol (12 per arm, in both lanes),
// every field of the format, and per-run values that depend only on the seed and on (window, arm, lane, run), so that a change to one cell moves nothing else.

const sha = (text) => createHash("sha256").update(text).digest("hex");

// A number in [-1, 1) that depends only on the keys.
const jitter = (...keys) => mulberry32(parseInt(sha(keys.join("/")).slice(0, 8), 16))() * 2 - 1;

// The frames of an occurrence of each window and how many of them are heavy (the ones that give the p95): enough that the p95 of the window is the heavy frame, whatever the protocol's
// number of occurrences.
export const FRAMES = { "ai-phase": [6, 1], "event-burst": [6, 1], "context-switches": [3, 1], stress: [22, 3] };

// [median, spread] of the per-run p95 of a window, in ms, by arm: a run draws its p95 in median +- spread. The default is an arm without a HUD at 5 ms and two HUDs at 8 ms, all alike.
const flat = (a, b, c) => ({ A: [a, 0.05], B: [b, 0.05], C: [c, 0.05] });
const DEFAULT_WINDOWS = { "ai-phase": flat(5, 8, 8), "event-burst": flat(5, 8, 8), "context-switches": flat(5, 8, 8), stress: flat(5, 8, 8) };

// [median, spread] of the FPS of a window in the unlimited lane, by arm.
const FPS = { A: [3000, 20], B: [1000, 10], C: [1000, 10] };

const armHashes = (arm) => ({ binarySha256: sha(`binary-${arm}`), packageSha256: sha(`package-${arm}`), scriptSha256: sha(`script-${arm}`) });
const REPLAY_HASH = "synthetic-replay-golden-hash";
const SOAK_HASH = "synthetic-soak-final-hash";
const INSTRUMENT_SHA256 = sha("synthetic-instrument");

function windowData(window, lane, arm, run, target, seed, fps) {
  const [frames, heavy] = FRAMES[window.id];
  const heavyUsec = Math.round(target * 1000);
  const occurrences = [];
  for (let index = 0; index < window.warmupOccurrences + window.measuredOccurrences; index += 1) {
    const warmup = index < window.warmupOccurrences;
    // A warm-up occurrence is made of frames of 150 ms: if one leaked into a statistic it would show in the p99 and in the frames of 100 ms or more.
    const frameUsec = Array.from({ length: frames }, (_, frame) => (warmup ? 150000 : frame >= frames - heavy ? heavyUsec : Math.round(heavyUsec * 0.4)));
    occurrences.push({ warmup, frameUsec });
  }
  const data = { occurrences };
  if (fps !== undefined) {
    data.fps = Math.round((fps[0] + fps[1] * jitter(seed, "fps", window.id, arm, lane, run)) * 100) / 100;
  }
  return data;
}

function readings(arm, run, seed) {
  const j = (name) => jitter(seed, name, arm, run);
  const own = {
    A: { rss: 300, nodes: 120 },
    B: { rss: 310, nodes: 180 },
    C: { rss: 330, nodes: 190 },
  }[arm];
  const values = { rssMb: { end: own.rss + 2 * j("rss"), max: own.rss + 12 + 2 * j("rss-max") }, sceneNodes: own.nodes };
  if (arm !== "A") {
    values.clickToPanelFrames = Array.from({ length: 30 }, () => 3);
    values.timeToInteractiveHudMs = (arm === "B" ? 400 : 420) + 4 * j("tti");
  }
  if (arm === "C") {
    values.hermes = { heapBytes: 5000000 + Math.round(50000 * j("heap")), nativeViews: 150 };
  }
  return values;
}

function execution({ entry, lane, protocol, seed, windows, hud, run }) {
  const { arm, slot } = entry;
  const unlimited = lane === "unlimited";
  return {
    arm,
    lane,
    slot,
    attempt: 1,
    load: { before: Math.round((0.8 + 0.4 * jitter(seed, "load-before", arm, lane, run)) * 100) / 100, after: Math.round((0.9 + 0.4 * jitter(seed, "load-after", arm, lane, run)) * 100) / 100 },
    build: "release",
    seed: 4242,
    hashes: { ...Object.fromEntries(Object.entries(armHashes(arm)).map(([key, value]) => [key.replace("Sha256", ""), value])), protocol: hud.protocolSha256 },
    vsync: { mode: unlimited ? "DISABLED" : "ENABLED", refreshHz: 120 },
    game: { replayGoldenHash: REPLAY_HASH, soakFinalHash: SOAK_HASH },
    errors: { unhandledJs: 0, scriptErrors: 0, godotLogErrors: 0, crashed: false, exitCode: 0 },
    ...(arm === "A" ? {} : { parityMatches: true }),
    drew: { afterEveryMeasuredIntent: true, idleDrawnFrames: protocol.idleReference.frames },
    // The idle CPU time is about 80 us; the idle intervals alternate 4 and 12.67 ms, as the windowed baseline's came in two groups (a pair of neighbours adds up to 16.67 ms).
    idle: {
      cpuUsec: Array.from({ length: protocol.idleReference.frames }, (_, frame) => 80 + (frame % 3)),
      intervalsUsec: Array.from({ length: protocol.idleReference.frames }, (_, frame) => (frame % 2 === 0 ? 4000 : 12667)),
    },
    windows: Object.fromEntries(
      protocol.windows.map((window) => {
        const [median, spread] = windows[window.id][arm];
        const target = median + spread * jitter(seed, "p95", window.id, arm, lane, run);
        return [window.id, windowData(window, lane, arm, run, target, seed, unlimited ? FPS_OF(hud, window.id, arm) : undefined)];
      }),
    ),
    readings: readings(arm, run, seed),
  };
}

const FPS_OF = (hud, windowId, arm) => hud.fps?.[windowId]?.[arm] ?? FPS[arm];

// The campaign. `protocol` is the protocol under analysis and `protocolSha256` the hash of its file, which every execution records. Options: `seed` (a string, to vary the draws),
// `windows` (the [median, spread] of the per-run p95 by window and arm), `fps` (the same for the FPS), `armBReady` (false: B is not planned and has no execution), `lanes`
// (the lanes that were run; both by default) and `text`.
export function syntheticCampaign(protocol, protocolSha256, options = {}) {
  const { seed = "synthetic", windows = DEFAULT_WINDOWS, fps, armBReady = true, lanes = ["presented", "unlimited"], text } = options;
  const hud = { protocolSha256, fps };
  const executions = [];
  for (const lane of lanes) {
    for (const entry of slotsOf(protocol)) {
      if (entry.arm === "B" && !armBReady) {
        continue;
      }
      executions.push(execution({ entry, lane, protocol, seed, windows, hud, run: entry.block }));
    }
  }
  const planned = ["A", "B", "C"].filter((arm) => armBReady || arm !== "B");
  const packageBytes = { A: 40000000, B: 41000000, C: 55000000 };
  return {
    format: CAMPAIGN_FORMAT,
    registered: { seed: 4242, replayGoldenHash: REPLAY_HASH, soakFinalHash: SOAK_HASH, instrumentSha256: INSTRUMENT_SHA256, arms: Object.fromEntries(["A", "B", "C"].map((arm) => [arm, armHashes(arm)])) },
    instrument: { selfCheckPassed: true, sha256: INSTRUMENT_SHA256 },
    armB: armBReady ? { ready: true } : { ready: false, reason: "synthetic: arm B did not pass the context matrix in its time-box" },
    provenance: {
      commit: "synthetic-commit",
      machine: "synthetic machine",
      system: "synthetic system",
      display: "synthetic display",
      renderer: "synthetic renderer",
      adapter: "synthetic adapter",
      rawData: "synthetic: no raw data",
      deviations: [],
    },
    executions,
    packages: Object.fromEntries(planned.map((arm) => [arm, { exportBytes: [packageBytes[arm], packageBytes[arm]] }])),
    ...(armBReady
      ? {
          changeCost: {
            B: { files: 3, lines: 120, timeMinutes: 90, tests: 4 },
            C: { files: 3, lines: 100, timeMinutes: 85, tests: 4 },
          },
        }
      : {}),
    ...(text === undefined ? {} : { text }),
  };
}

// Redo a slot: the accepted execution of (lane, slot) is preceded by one rejected attempt for each function in `rejections`, which receives a copy of the execution and makes it
// something a rule rejects; the accepted one becomes the next attempt. Returns the campaign.
export function redoSlot(campaign, lane, slot, rejections) {
  const index = campaign.executions.findIndex((candidate) => candidate.lane === lane && candidate.slot === slot);
  const accepted = campaign.executions[index];
  const rejected = rejections.map((change, attempt) => {
    const copy = structuredClone(accepted);
    copy.attempt = attempt + 1;
    change(copy);
    return copy;
  });
  accepted.attempt = rejected.length + 1;
  campaign.executions.splice(index, 0, ...rejected);
  return campaign;
}

// The load of an attempt above the limit, before the execution.
export const overLoaded = (execution) => {
  execution.load.before = 5.3;
};

// How the process of an attempt that wrote no report ended, as the entry of `unreported` says it: killed by a signal, killed at the launcher's time limit, or exited 0 with no report.
export const ENDINGS = {
  crash: { crashed: true, timedOut: false, signal: "SIGSEGV" },
  timeout: { crashed: true, timedOut: true, signal: "SIGTERM" },
  silent: { crashed: false, timedOut: false, exitCode: 0 },
};

// Attempts of (lane, slot) that wrote no report, one for each of `endings` and in that order, put before the slot's execution, which becomes the next attempt; with `redone: false` the
// execution is dropped instead, so that the slot ends with no accepted attempt. The entry takes the arm and the load readings of the execution, and a log hash made up from its key.
// Returns the campaign.
export function noReportSlot(campaign, lane, slot, endings = [ENDINGS.crash], { redone = true } = {}) {
  const index = campaign.executions.findIndex((candidate) => candidate.lane === lane && candidate.slot === slot);
  const execution = campaign.executions[index];
  const entries = endings.map((errors, position) => ({
    arm: execution.arm,
    lane,
    slot,
    attempt: position + 1,
    load: { ...execution.load },
    errors: { ...errors },
    logSha256: sha(`log/${lane}/${slot}/${position + 1}`),
  }));
  campaign.unreported = [...(campaign.unreported ?? []), ...entries];
  if (redone) {
    execution.attempt = entries.length + 1;
  } else {
    campaign.executions.splice(index, 1);
  }
  return campaign;
}

// ---- the helpers of the tests that analyse a synthetic campaign ----

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");

// The committed protocol and the SHA-256 of its file, as the analysis reads them.
export function readProtocol() {
  const bytes = fs.readFileSync(new URL("../docs/research/frontier-comparison-protocol.json", import.meta.url));
  return { protocol: JSON.parse(bytes.toString("utf8")), protocolSha256: sha256(bytes) };
}

// The same protocol with `resamples` bootstrap resamples instead of 10,000, for the tests of the validity of the executions, which do not depend on the bootstrap. Its file would hash to the
// SHA-256 of its JSON text.
export function withResamples(protocol, resamples) {
  const copy = structuredClone(protocol);
  copy.statistics.interval.resamples = resamples;
  return { protocol: copy, protocolSha256: sha256(JSON.stringify(copy)) };
}

// A campaign builder and an analyser bound to a protocol and the hash of its file.
export function harness(protocol, protocolSha256) {
  return {
    build: (options) => syntheticCampaign(protocol, protocolSha256, options),
    analyze: (campaign) => buildReport({ campaign, protocol, protocolSha256, campaignSha256: "0".repeat(64) }),
  };
}

export const executionsOf = (campaign, arm, lane = "presented") => campaign.executions.filter((execution) => execution.arm === arm && execution.lane === lane);
export const slotRecord = (report, lane, slot) => report.sections.validity.slots.find((candidate) => candidate.lane === lane && candidate.slot === slot);

// ---- the example of the evidence record ----

// The synthetic campaign of docs/evidence/frontier-comparison-analysis/: the committed `example-analysis.json` is the analysis of exactly these bytes. A scenario that shows the four categories and
// the Holm guard side by side (a gain, a neutral, a cost and an inconclusive window), one load that was redone, one window in which the arm with the React Native HUD draws more frames per second
// without a limit, and the words of a report that say the data are made up. Nothing here was measured: no number of it is a result of any arm.
const EXAMPLE_TEXT = {
  decision: "SYNTHETIC EXAMPLE: no decision was made. The data of this campaign were made up to exercise the analysis script, and none of them is a result of any arm.",
  limitations: "SYNTHETIC EXAMPLE: nothing was measured; there is no machine, no display and no iPhone behind these numbers.",
  costOfChange: "SYNTHETIC EXAMPLE: the single observation of each arm was made up.",
};
const EXAMPLE_WINDOWS = {
  "ai-phase": { A: [5, 0.05], B: [8, 0.05], C: [6, 0.05] },
  "event-burst": { A: [5, 0.05], B: [8, 0.05], C: [8.05, 0.05] },
  "context-switches": { A: [5, 0.05], B: [8, 0.05], C: [10, 0.05] },
  stress: { A: [5, 0.05], B: [8, 3], C: [8, 3] },
};

function exampleCampaign(protocol, protocolSha256) {
  const campaign = syntheticCampaign(protocol, protocolSha256, { seed: "example", windows: EXAMPLE_WINDOWS, fps: { "ai-phase": { C: [1400, 10] } }, text: EXAMPLE_TEXT });
  return redoSlot(campaign, "presented", 4, [overLoaded]);
}

// The example campaign with a process that crashed and wrote no report in the first attempt of the presented lane's slot 7 (arm B), which the second attempt redid: the attempt is in `unreported`.
const unreportedExampleCampaign = (protocol, protocolSha256) => noReportSlot(exampleCampaign(protocol, protocolSha256), "presented", 7);

// The bytes of a campaign file: compact JSON and a final newline. The report records the SHA-256 of these bytes.
const serializeCampaign = (campaign) => `${JSON.stringify(campaign)}\n`;

// The `validity` section of the report of that campaign, as the report writes it (two-space JSON and a final newline).
function unreportedValidity(protocol, protocolSha256) {
  const campaign = unreportedExampleCampaign(protocol, protocolSha256);
  const report = buildReport({ campaign, protocol, protocolSha256, campaignSha256: sha256(serializeCampaign(campaign)) });
  return `${JSON.stringify(report.sections.validity, null, 2)}\n`;
}

// node tests/frontier-comparison-synthetic.mjs <campaign.json>: writes the example campaign of the evidence record, which scripts/frontier-comparison-analysis.mjs then analyses.
// With --unreported, the same campaign with an attempt that wrote no report; with --unreported-validity, the file is the `validity` section of the report of that campaign.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [first, second] = process.argv.slice(2);
  const mode = first === "--unreported" || first === "--unreported-validity" ? first : null;
  const file = mode === null ? first : second;
  if (file === undefined) {
    console.error("use: node tests/frontier-comparison-synthetic.mjs [--unreported | --unreported-validity] <file.json>");
    process.exitCode = 1;
  } else {
    const { protocol, protocolSha256 } = readProtocol();
    if (mode === "--unreported-validity") {
      fs.writeFileSync(file, unreportedValidity(protocol, protocolSha256));
      console.log(`FRONTIER_COMPARISON_EXAMPLE_UNREPORTED_VALIDITY_WRITTEN: ${file}`);
    } else {
      fs.writeFileSync(file, serializeCampaign(mode === null ? exampleCampaign(protocol, protocolSha256) : unreportedExampleCampaign(protocol, protocolSha256)));
      console.log(`FRONTIER_COMPARISON_EXAMPLE_CAMPAIGN_WRITTEN: ${file}`);
    }
  }
}
