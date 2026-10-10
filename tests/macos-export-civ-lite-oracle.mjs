import {createHash} from "node:crypto";
import path from "node:path";

// The independent oracle of the Frontier export lane (tests/macos-export-civ-lite.test.mjs). scripts/macos-export-civ-lite.mjs judges each run as it
// happens; this module judges again what the runs left behind, from the raw observations and without its verdicts: the roteiro is read from
// consumers/civ-lite/game/replay.gd (not from the gate), the final hash is recomputed from the final canonical serialization the gate kept, the trace
// hash from the 77 step hashes, and the receipt's profile, copy and signature facts are checked against each other and against the files on disk.
// Every function is pure: the files are read by the caller.
const sha256 = value => createHash("sha256").update(value).digest("hex");
const HASH = /^[0-9a-f]{64}$/;

export const CONTEXTS = ["none", "tile", "settler", "warrior", "stack", "city", "dialog"];
export const PANELS = ["hud-bar", "hud-actions", "hud-tile", "hud-city", "hud-research", "hud-dialog"];
export const RUN_LABELS = ["replay-editor-1", "replay-editor-2", "replay-editor-3", "replay-app-1", "replay-app-2", "replay-app-3"];
// The scenario's fixed seed: the state the replay ends in carries it, and a game whose seed was altered cannot end in the golden state.
const SEED = 4242;
export const HUD_CHECKS = 152;
export const HUD_MATRIX_ROWS = 46;
const BUNDLE_IDENTIFIER = "org.journeystudios.godotfabric.frontier";

// The steps of game/replay.gd, as the game's own text gives them: each is one line that happens to be JSON.
export function parseRoteiro(text) {
  const steps = [];
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*(\{"label": .*\}),?\s*$/);
    if (match) {
      steps.push(JSON.parse(match[1]));
    }
  }
  return steps;
}

/** The problems of one replay report against the roteiro and the hashes it must reach. */
export function judgeReplayReport(report, expected, roteiro) {
  const findings = [];
  const fail = message => findings.push(message);
  if (report === null || typeof report !== "object" || report.schemaVersion !== 1 || report.scenario !== "civ-lite-replay" || !Array.isArray(report.steps)) {
    return ["the report is not the replay gate's"];
  }
  if (report.steps.length !== roteiro.length || report.stepCount !== roteiro.length) {
    fail(`the report holds ${report.steps.length} steps (stepCount ${report.stepCount}), the roteiro has ${roteiro.length}`);
  }
  roteiro.forEach((wanted, index) => {
    const step = report.steps[index];
    if (step === undefined) {
      return;
    }
    const same = step.index === index && step.label === wanted.label && step.intent === wanted.intent && JSON.stringify(step.args) === JSON.stringify(wanted.args)
      && step.code === wanted.code && step.context === wanted.context && step.ok === (wanted.code === "ok" ? 1 : 0) && HASH.test(step.hash);
    if (!same) {
      fail(`step ${index} is not the roteiro's ${wanted.intent}${JSON.stringify(wanted.args)} -> ${wanted.code}/${wanted.context}: ${JSON.stringify({...step, hash: undefined})}`);
    }
  });
  const hashes = report.steps.map(step => step.hash);
  const trace = sha256(hashes.join("\n"));
  if (trace !== report.traceHash) {
    fail(`the trace hash ${report.traceHash} is not the SHA-256 of the step hashes (${trace})`);
  }
  if (trace !== expected.traceHash) {
    fail(`the trace hash ${trace} is not the pinned ${expected.traceHash}`);
  }
  const final = typeof report.finalSerialization === "string" ? sha256(report.finalSerialization) : null;
  if (final !== report.goldenHash || hashes.at(-1) !== report.goldenHash) {
    fail(`the golden hash ${report.goldenHash} is not the SHA-256 of the final state (${final}) or of the last step (${hashes.at(-1)})`);
  }
  if (final !== expected.goldenHash) {
    fail(`the golden hash ${final} is not the pinned ${expected.goldenHash}`);
  }
  let state = null;
  try {
    state = JSON.parse(report.finalSerialization);
  } catch {
    fail("the final serialization is not JSON");
  }
  if (state !== null && (state.turn !== roteiro.filter(step => step.intent === "end_turn" && step.code === "ok").length + 1 || state.seed !== SEED || report.seed !== SEED)) {
    fail(`the replay did not end in turn 13 of seed ${SEED}: turn ${state.turn}, seed ${state.seed}, report seed ${report.seed}`);
  }
  const turns = report.steps.filter(step => step.intent === "end_turn" && step.ok === 1).length;
  if (turns !== 12 || report.acceptedTurns !== 12) {
    fail(`${turns} end_turn steps were accepted (acceptedTurns ${report.acceptedTurns}), not 12`);
  }
  const seen = new Set(report.steps.map(step => step.context));
  if (!CONTEXTS.every(context => seen.has(context))) {
    fail(`the replay observed only the contexts ${[...seen].sort().join(", ")}`);
  }
  if (report.allPassed !== true || !Array.isArray(report.checks) || report.checks.length === 0 || !report.checks.every(check => check.passed === true)) {
    fail("the gate's own checks did not all pass");
  }
  return findings;
}

const LANES = {
  editor: {template: false, release: false, debug: true, editor: true},
  app: {template: true, release: true, debug: false, editor: false},
};

/**
 * The problems of an export's receipt, from the receipt, the reports it names (`reports`: label -> {report, sha256 of the file's bytes}) and the HUD
 * report (`hud`: {report, sha256}). `home` is the user's home directory, where the profiles live.
 */
export function judgeExportReceipt({receipt, reports, hud, expected, roteiro, home}) {
  const findings = [];
  const fail = message => findings.push(message);
  if (receipt.status !== "passed" || receipt.published !== true || receipt.consumer !== "civ-lite") {
    fail(`the receipt is ${receipt.status}, published ${receipt.published}, consumer ${receipt.consumer}`);
  }
  if (!receipt.limitations?.some(text => text.includes("same Mac") && text.includes("`limpa` is not claimed"))) {
    fail("the receipt does not state its limit (same Mac, criterion limpa not claimed)");
  }
  if (receipt.sdk?.sourceDirty !== false) {
    fail("the export did not come from a clean, committed source tree");
  }
  if (receipt.app?.bundleIdentifier !== BUNDLE_IDENTIFIER || !/^4\.7\.2\.stable/.test(receipt.app?.engineVersion ?? "") || !receipt.app?.signing?.includes("ad-hoc local signing verified")) {
    fail("the app is not Frontier's, a 4.7.2 engine, ad-hoc signed and verified");
  }
  if (JSON.stringify(receipt.templateMember?.architectures) !== '["arm64"]' || receipt.app?.executableRecord?.sha256 !== receipt.templateMember?.sha256) {
    fail("the exported engine is not the arm64 Release member of the template");
  }
  const runs = receipt.replay?.runs ?? [];
  if (JSON.stringify(runs.map(run => run.label)) !== JSON.stringify(RUN_LABELS)) {
    fail(`the runs are ${runs.map(run => run.label).join(", ")}, not the 3 editor and the 3 app runs`);
  }
  const profile = path.join(home, "Library", "Application Support", "Godot", "app_userdata", receipt.fixture?.projectName ?? "");
  if (!(receipt.fixture?.projectName ?? "").startsWith("Frontier Export ")) {
    fail("the project was not given a name of its own, so its profile was not the export's own");
  }
  const copy = receipt.copy;
  // The engine reports the real path of what it runs (a temporary directory is reached through a symlink).
  const executable = copy === undefined ? "" : path.join(copy.realPath, "Contents", "MacOS", receipt.app.executableName);
  if (copy === undefined || path.dirname(copy.directory) === path.dirname(receipt.output) || copy.directory === path.dirname(receipt.output)) {
    fail("the app was not run from a copy in another directory");
  }
  for (const label of RUN_LABELS) {
    const run = runs.find(entry => entry.label === label);
    const kept = reports[label];
    if (run === undefined || kept === undefined) {
      fail(`${label}: no run or no kept report`);
      continue;
    }
    for (const finding of judgeReplayReport(kept.report, expected, roteiro)) {
      fail(`${label}: ${finding}`);
    }
    if (kept.sha256 !== run.reportSha256) {
      fail(`${label}: the kept report is not the one the receipt hashed`);
    }
    if (run.status !== 0 || run.problems?.length !== 0) {
      fail(`${label}: the runner recorded status ${run.status} and ${run.problems?.length} problems`);
    }
    if (run.profile.path !== profile || run.profile.existedBefore !== false || run.profile.removedAfter !== true || kept.report.userDataDir !== profile) {
      fail(`${label}: the profile ${run.profile.path} (report ${kept.report.userDataDir}) was not the export's own ${profile}, absent before and removed after`);
    }
    if (kept.report.userEntriesAtStart?.includes("civ-lite-replay-report.json") || kept.report.project !== receipt.fixture?.projectName) {
      fail(`${label}: the profile held an earlier report, or the run was not of the export's project`);
    }
    const lane = label.includes("-app-") ? "app" : "editor";
    if (!Object.entries(LANES[lane]).every(([feature, value]) => kept.report.features?.[feature] === value) || kept.report.displayServer !== "headless") {
      fail(`${label}: its engine features ${JSON.stringify(kept.report.features)} are not those of the ${lane === "app" ? "Release template" : "editor binary"}, headless`);
    }
    if (lane === "app" && kept.report.executable !== executable) {
      fail(`${label}: it ran ${kept.report.executable}, not the copy's ${executable}`);
    }
    if (lane === "editor" && kept.report.executable === executable) {
      fail(`${label}: the editor run ran the app`);
    }
  }
  const first = reports[RUN_LABELS[0]]?.report;
  if (first !== undefined && !RUN_LABELS.every(label => JSON.stringify(reports[label]?.report.steps) === JSON.stringify(first.steps) && reports[label].report.finalSerialization === first.finalSerialization)) {
    fail("the six runs did not play the same states");
  }
  if (copy !== undefined && !(copy.sourceSha256 === copy.beforeRunsSha256 && copy.beforeRunsSha256 === copy.afterRunsSha256 && copy.afterRunsSha256 === receipt.publishedAppSha256
      && copy.signaturesVerifiedAfterRuns === true && copy.removedAfterRuns === true)) {
    fail("the copy was not the published app, byte for byte, before and after the runs, with its signatures verified and the copy removed");
  }

  const record = receipt.hud;
  const hudReport = hud?.report;
  if (record === undefined || hudReport === undefined) {
    fail("the HUD matrix was not run in the app");
    return findings;
  }
  if (hud.sha256 !== record.reportSha256 || record.status !== 0 || record.problems?.length !== 0) {
    fail("the HUD record is not the kept report's, or the run did not pass");
  }
  if (hudReport.checks.length !== HUD_CHECKS || !hudReport.checks.every(check => check.passed === true) || hudReport.matrix.length !== HUD_MATRIX_ROWS
      || hudReport.displayServer !== "headless" || hudReport.arm !== "rn") {
    fail(`the HUD report holds ${hudReport.checks.length} checks and ${hudReport.matrix.length} matrix rows, headless on the React Native arm; ${HUD_CHECKS} passed checks and ${HUD_MATRIX_ROWS} rows were expected`);
  }
  const panels = new Set(hudReport.matrix.flatMap(row => row.panels));
  if (!PANELS.every(panel => panels.has(panel))) {
    fail(`the matrix showed only the panels ${[...panels].sort().join(", ")}`);
  }
  if (!CONTEXTS.every(context => hudReport.covering?.[context] !== undefined)) {
    fail("the matrix did not cover the seven contexts");
  }
  if (record.profile.path !== profile || record.profile.existedBefore !== false || record.profile.removedAfter !== true) {
    fail("the HUD run's profile was not the export's own, absent before and removed after");
  }
  return findings;
}
