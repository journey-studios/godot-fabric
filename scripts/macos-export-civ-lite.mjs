import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {constants as fsConstants} from "node:fs";
import {cp, lstat, mkdtemp, readFile, readdir, realpath, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// What the macOS export runner (scripts/macos-export.mjs) does for the Frontier game (consumers/civ-lite) after the Release .app is
// signed: it plays the 12-turn replay (consumers/civ-lite/replay_validation.gd, `-- --validate-replay`) three times in the provisioned
// project and three times in a copy of the .app that sits in another directory, each run in a clean user profile, and runs the HUD's
// matrix (`-- --validate-hud`) once in that copy. The pinned hashes are the ones the headless lane fixes
// (tests/civ-lite-game-native.test.mjs); tests/macos-export-civ-lite-oracle.test.mjs checks that they still are.
//
// A clean profile is the application's user-data directory: the project's name is unique to the export, so the directory
// (~/Library/Application Support/Godot/app_userdata/<name>) is owned by it, must not exist when a run starts, and is removed when the run
// ends. It is not a clean macOS user, a second Mac or a virtual machine (the milestone's `limpa` criterion stays open).
export const GOLDEN_HASH = "cb7ab974f47f18c37ae96bda57ffd1b87f8c3733e251a386040dc17ccb540e8d";
export const TRACE_HASH = "ed43495ec48d896c0eb0c4f9a7b97471be86f37082218d16a8411d0f3766275e";
export const REPLAY_STEPS = 77;
export const REPLAY_TURNS = 12;
// What hud_validation.gd counts in a headless run (tests/civ-lite-ui-native.test.mjs EXPECTED_CHECKS) and the rows of its matrix: the roteiro's steps 0 to 45.
export const HUD_CHECKS = 152;
export const HUD_MATRIX_ROWS = 46;
export const CIV_LITE_BUNDLE_IDENTIFIER = "org.journeystudios.godotfabric.frontier";
const REPLAY_REPORT = "civ-lite-replay-report.json";
const HUD_REPORT = "civ-lite-ui-report.json";
export const LIMIT = "same Mac, fresh application user-data directory per run: not a clean macOS user, a second Mac or a VM (criterion `limpa` is not claimed)";

const PROJECT_PREFIX = "Frontier Export ";
const RUNS = 3;
const fatalOutput = /SCRIPT ERROR|Parse Error|(?:^|\n)ERROR:|Program crashed|Stack overflow|ObjectDB instances leaked|Resources still in use|FABRIC_ERROR|CONSUMER_CHECK_FAILED/;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export const civLiteProjectName = token => `${PROJECT_PREFIX}${token}`;
const dataRoot = () => path.join(os.homedir(), "Library", "Application Support", "Godot", "app_userdata");
const civLiteUserDataPath = projectName => path.join(dataRoot(), projectName);

async function exists(filename) {
  try { await lstat(filename); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

// Removes the user-data directory of an export's own project. The name carries the export's token, so nothing else can match it.
export async function removeCivLiteUserData(projectName) {
  assert.ok(projectName.startsWith(PROJECT_PREFIX) && projectName.length > PROJECT_PREFIX.length && !/[\\/]/.test(projectName),
    "refusing to remove a user-data directory that is not an export's own");
  const target = civLiteUserDataPath(projectName);
  assert.equal(path.dirname(target), dataRoot());
  const existed = await exists(target);
  if (existed) await rm(target, {recursive: true, force: true});
  return existed;
}

// What a run's log and report say, as one record. `profile` is the clean-profile observation of the run that made it.
function replayRecord({label, lane, run, report, reportSha256, profile}) {
  const hashes = run.log.match(/^CIVLITE_REPLAY_HASHES: golden=([0-9a-f]{64}) trace=([0-9a-f]{64})$/m);
  return {label, lane, status: run.status, signal: run.signal,
    passedMarker: /^CIVLITE_REPLAY_PASSED: \d+$/m.test(run.log), fatalOutput: fatalOutput.test(run.log),
    printedGoldenHash: hashes?.[1] ?? null, printedTraceHash: hashes?.[2] ?? null,
    goldenHash: report?.goldenHash ?? null, traceHash: report?.traceHash ?? null, stepCount: report?.stepCount ?? null,
    acceptedTurns: report?.acceptedTurns ?? null, checks: report?.checks?.length ?? null, allPassed: report?.allPassed ?? null,
    displayServer: report?.displayServer ?? null, features: report?.features ?? null, executable: report?.executable ?? null,
    userDataDir: report?.userDataDir ?? null, userEntriesAtStart: report?.userEntriesAtStart ?? null, seed: report?.seed ?? null,
    logSha256: sha256(Buffer.from(run.log)), reportSha256, reportFile: `${label}.json`, logFile: `${label}.log`, profile};
}

// The problems of one replay record against the hashes it must reach. An empty list is a run that reached them in a Release app (or in
// the provisioned project) with a clean profile. The independent check of the lane is tests/macos-export-civ-lite-oracle.mjs.
export function judgeReplayRun(record, expected = {goldenHash: GOLDEN_HASH, traceHash: TRACE_HASH}) {
  const problems = [];
  const fail = message => problems.push(`${record.label}: ${message}`);
  if (record.status !== 0) fail(`the run exited with status ${record.status}${record.signal ? ` (${record.signal})` : ""}`);
  if (record.fatalOutput) fail("its log holds an engine, script or check error");
  if (!record.passedMarker) fail("it printed no CIVLITE_REPLAY_PASSED marker");
  if (record.goldenHash === null) fail("it wrote no report");
  if (record.goldenHash !== expected.goldenHash) fail(`its golden hash ${record.goldenHash} differs from the pinned ${expected.goldenHash}`);
  if (record.traceHash !== expected.traceHash) fail(`its trace hash ${record.traceHash} differs from the pinned ${expected.traceHash}`);
  if (record.printedGoldenHash !== record.goldenHash || record.printedTraceHash !== record.traceHash) fail("the hashes it printed are not the report's");
  if (record.stepCount !== REPLAY_STEPS || record.acceptedTurns !== REPLAY_TURNS) fail(`it played ${record.stepCount} steps and ${record.acceptedTurns} turns, not ${REPLAY_STEPS} and ${REPLAY_TURNS}`);
  if (record.allPassed !== true) fail("one of its own checks failed");
  if (record.displayServer !== "headless") fail(`it ran on the ${record.displayServer} display server, not headless`);
  const lane = record.lane === "app" ? {template: true, release: true, debug: false, editor: false} : {template: false, release: false, debug: true, editor: true};
  if (!Object.entries(lane).every(([feature, value]) => record.features?.[feature] === value)) fail(`its engine features ${JSON.stringify(record.features)} are not ${record.lane === "app" ? "a Release export template's" : "the editor binary's"}`);
  if (record.profile.existedBefore !== false || record.profile.removedAfter !== true) fail("its user profile was not clean before and removed after");
  if (record.userDataDir !== record.profile.path) fail(`it wrote its report to ${record.userDataDir}, not to the profile it was given, ${record.profile.path}`);
  if (record.userEntriesAtStart?.includes(REPLAY_REPORT)) fail("the profile already held a replay report when the run began");
  return problems;
}

export function judgeHudRun(record) {
  const problems = [];
  const fail = message => problems.push(`${record.label}: ${message}`);
  if (record.status !== 0) fail(`the run exited with status ${record.status}${record.signal ? ` (${record.signal})` : ""}`);
  if (record.fatalOutput) fail("its log holds an engine, script or check error");
  if (!record.passedMarker) fail("it printed no CIVLITE_UI_PASSED marker");
  if (record.checks !== HUD_CHECKS || record.allPassed !== true) fail(`it ran ${record.checks} checks (${HUD_CHECKS} expected) and ${record.allPassed ? "all" : "not all"} passed`);
  if (record.matrixRows !== HUD_MATRIX_ROWS) fail(`its matrix has ${record.matrixRows} rows, not ${HUD_MATRIX_ROWS}`);
  if (record.displayServer !== "headless") fail(`it ran on the ${record.displayServer} display server, not headless`);
  if (record.profile.existedBefore !== false || record.profile.removedAfter !== true) fail("its user profile was not clean before and removed after");
  return problems;
}

async function execute(harness, label, command, args, cwd) {
  const result = spawnSync(command, args, {cwd, env: harness.env, encoding: "utf8", timeout: 180000, maxBuffer: 8 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(harness.directory, `${label}.log`), log);
  assert.equal(result.error, undefined, log);
  return {status: result.status, signal: result.signal, log};
}

// One process in a clean profile: the user-data directory must not exist when it starts; whatever it wrote is read back (the report is
// kept byte for byte in the harness directory) and the directory is removed before the next one.
async function profileRun({harness, projectName, label, command, args, cwd, reportName}) {
  const userData = civLiteUserDataPath(projectName);
  const existedBefore = await exists(userData);
  assert.equal(existedBefore, false, `${label}: the user profile ${userData} exists before the run`);
  const run = await execute(harness, label, command, args, cwd);
  let entriesAfter = null;
  try { entriesAfter = (await readdir(userData)).sort(); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  let text = null;
  try { text = await readFile(path.join(userData, reportName), "utf8"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (text !== null) await writeFile(path.join(harness.directory, `${label}.json`), text);
  await removeCivLiteUserData(projectName);
  const profile = {path: userData, existedBefore, entriesAfter, removedAfter: !(await exists(userData))};
  return {run, report: text === null ? null : JSON.parse(text), reportSha256: text === null ? null : sha256(Buffer.from(text)), profile};
}

// The runs of an exported Frontier. `ops` are the two operations of the runner that the module does not own: hashing an app bundle and
// verifying its signatures. `receipt` receives what was observed before anything is judged, so a rejected export keeps its records.
export async function runCivLiteRuntime({harness, receipt, app, executableName, projectName, expected = {goldenHash: GOLDEN_HASH, traceHash: TRACE_HASH}, ops}) {
  const residue = await removeCivLiteUserData(projectName);
  const replay = {limit: LIMIT, expected, residueRemovedBeforeFirstRun: residue, runs: []};
  receipt.replay = replay;
  const records = [];
  const note = record => { records.push(record); replay.runs.push({...record, problems: judgeReplayRun(record, expected)}); };

  for (let index = 1; index <= RUNS; index++) {
    const label = `replay-editor-${index}`;
    const result = await profileRun({harness, projectName, label, command: harness.godot,
      args: ["--path", harness.project, "--headless", "--", "--validate-replay"], cwd: harness.project, reportName: REPLAY_REPORT});
    note(replayRecord({label, lane: "editor", ...result}));
  }

  const copyRoot = await mkdtemp(path.join(os.tmpdir(), "godot-fabric-civ-lite-app-copy-"));
  try {
    const copied = path.join(copyRoot, "Frontier.app");
    const sourceSha256 = await ops.hashApp(app);
    await cp(app, copied, {recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false, mode: fsConstants.COPYFILE_FICLONE});
    // The engine reports the real path of the executable (a temporary directory is reached through a symlink): the record holds both.
    const copy = {directory: copyRoot, path: copied, realPath: await realpath(copied), sourceSha256, beforeRunsSha256: await ops.hashApp(copied)};
    receipt.copy = copy;
    assert.equal(copy.beforeRunsSha256, sourceSha256, "the copied app differs from the app it was copied from");
    await ops.verifySignatures(harness, copied);
    const executable = path.join(copied, "Contents", "MacOS", executableName);

    for (let index = 1; index <= RUNS; index++) {
      const label = `replay-app-${index}`;
      const result = await profileRun({harness, projectName, label, command: executable, args: ["--headless", "--", "--validate-replay"],
        cwd: harness.outside, reportName: REPLAY_REPORT});
      note(replayRecord({label, lane: "app", ...result}));
    }
    const problems = replay.runs.flatMap(run => run.problems);
    if (problems.length > 0) {
      throw new Error(`The replay did not reach the pinned hashes in ${replay.runs.filter(run => run.problems.length > 0).length} of ${records.length} runs:\n${problems.join("\n")}`);
    }

    const hud = await profileRun({harness, projectName, label: "hud-app", command: executable, args: ["--headless", "--", "--validate-hud"],
      cwd: harness.outside, reportName: HUD_REPORT});
    const hudRecord = {label: "hud-app", lane: "app", status: hud.run.status, signal: hud.run.signal,
      passedMarker: /^CIVLITE_UI_PASSED$/m.test(hud.run.log), fatalOutput: fatalOutput.test(hud.run.log),
      checks: hud.report?.checks?.length ?? null, allPassed: hud.report ? hud.report.checks.every(check => check.passed === true) : null,
      matrixRows: hud.report?.matrix?.length ?? null, displayServer: hud.report?.displayServer ?? null,
      arm: hud.report?.arm ?? null, covering: hud.report?.covering ? Object.keys(hud.report.covering).sort() : null,
      logSha256: sha256(Buffer.from(hud.run.log)), reportSha256: hud.reportSha256, reportFile: "hud-app.json", logFile: "hud-app.log", profile: hud.profile};
    receipt.hud = {...hudRecord, problems: judgeHudRun(hudRecord)};
    assert.deepEqual(receipt.hud.problems, [], `the HUD matrix did not pass in the exported app:\n${receipt.hud.problems.join("\n")}`);

    copy.afterRunsSha256 = await ops.hashApp(copied);
    assert.equal(copy.afterRunsSha256, sourceSha256, "running the copied app changed its bytes");
    await ops.verifySignatures(harness, copied);
    copy.signaturesVerifiedAfterRuns = true;
  } finally {
    await rm(copyRoot, {recursive: true, force: true});
    if (receipt.copy) receipt.copy.removedAfterRuns = !(await exists(copyRoot));
  }
  replay.reached = {goldenHash: expected.goldenHash, traceHash: expected.traceHash, runs: records.length};
  return receipt;
}
