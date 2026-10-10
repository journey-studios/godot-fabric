import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {mkdir, mkdtemp, readFile, rm, symlink} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {exportPreparedProject, presetText} from "../scripts/macos-export.mjs";
import {GOLDEN_HASH, HUD_CHECKS as RUNNER_HUD_CHECKS, HUD_MATRIX_ROWS as RUNNER_HUD_MATRIX_ROWS, LIMIT, REPLAY_STEPS, TRACE_HASH, judgeHudRun, judgeReplayRun,
  removeCivLiteUserData} from "../scripts/macos-export-civ-lite.mjs";
import {CONTEXTS, HUD_CHECKS, HUD_MATRIX_ROWS, PANELS, RUN_LABELS, judgeExportReceipt, judgeReplayReport, parseRoteiro} from "./macos-export-civ-lite-oracle.mjs";
import {SABOTAGES} from "./macos-export-civ-lite-sabotages.mjs";

// The template-free half of the Frontier export lane (the other half, tests/macos-export-civ-lite.test.mjs, needs the arm64 template and a clean committed tree): the pins
// the lane judges against are the ones the headless lanes pin, the oracle reads the game's own roteiro, accepts a consistent export and rejects each thing that would make it
// wrong, the runner's own judgment says the same of one run, the gate stays inert and reuses the game's code, and the command line refuses what it should before it provisions
// anything. It never skips and runs no Godot.
const root = fileURLToPath(new URL("..", import.meta.url));
const read = file => readFile(path.join(root, file), "utf8");
const sha256 = value => createHash("sha256").update(value).digest("hex");
const roteiro = parseRoteiro(await read("consumers/civ-lite/game/replay.gd"));

test("the lane's pins are the ones the headless lanes pin", async () => {
  for (const file of ["tests/civ-lite-game-native.test.mjs", "tests/frontier-services-native.test.mjs"]) {
    const text = await read(file);
    assert.equal(text.match(/^const GOLDEN_HASH = "([0-9a-f]{64})";$/m)?.[1], GOLDEN_HASH, `${file} pins the golden hash`);
    assert.equal(text.match(/^const TRACE_HASH = "([0-9a-f]{64})";$/m)?.[1], TRACE_HASH, `${file} pins the trace hash`);
  }
  const ui = await read("tests/civ-lite-ui-native.test.mjs");
  assert.equal(Number(ui.match(/^const EXPECTED_CHECKS = (\d+);$/m)?.[1]), HUD_CHECKS);
  assert.equal(RUNNER_HUD_CHECKS, HUD_CHECKS);
  assert.equal(RUNNER_HUD_MATRIX_ROWS, HUD_MATRIX_ROWS);
  assert.equal(REPLAY_STEPS, roteiro.length);
  // The matrix is the roteiro's steps 0 to 45 (hud_validation.gd LAST_STEP).
  assert.equal(Number((await read("consumers/civ-lite/hud_validation.gd")).match(/^const LAST_STEP := (\d+)$/m)?.[1]) + 1, HUD_MATRIX_ROWS);
});

test("the oracle reads the roteiro from the game's own source", () => {
  assert.equal(roteiro.length, 77);
  assert.equal(roteiro.filter(step => step.intent === "end_turn" && step.code === "ok").length, 12);
  assert.deepEqual(roteiro.filter(step => step.label.startsWith("cover-")).map(step => step.label.slice("cover-".length)).sort(), [...CONTEXTS].sort());
  assert.deepEqual(roteiro[2], {label: "cover-stack", intent: "select_tile", args: [6, 8], code: "ok", context: "stack"});
});

// A report that is consistent with itself and with the roteiro, with hashes of its own: the pins it is judged against are the ones it makes.
function genuineReport() {
  const finalSerialization = JSON.stringify({seed: 4242, turn: 13});
  const hashes = roteiro.map((_, index) => sha256(`state ${index}`));
  hashes[hashes.length - 1] = sha256(finalSerialization);
  const steps = roteiro.map((step, index) => ({index, label: step.label, intent: step.intent, args: step.args, ok: step.code === "ok" ? 1 : 0, code: step.code,
    context: step.context, turn: 1 + roteiro.slice(0, index + 1).filter(each => each.intent === "end_turn" && each.code === "ok").length, hash: hashes[index]}));
  const report = {schemaVersion: 1, scenario: "civ-lite-replay", seed: 4242, stepCount: steps.length, acceptedTurns: 12, steps, goldenHash: hashes.at(-1),
    traceHash: sha256(hashes.join("\n")), finalSerialization, checks: [{name: "a", passed: true}], allPassed: true};
  return {report, expected: {goldenHash: report.goldenHash, traceHash: report.traceHash}};
}
const clone = value => structuredClone(value);

test("the oracle accepts a consistent replay report and rejects each thing that makes it wrong", () => {
  const {report, expected} = genuineReport();
  assert.deepEqual(judgeReplayReport(report, expected, roteiro), []);
  const reject = (change, pattern, against = expected) => {
    const broken = clone(report);
    change(broken);
    assert.match(judgeReplayReport(broken, against, roteiro).join("\n"), pattern);
  };
  reject(broken => { broken.steps[40].hash = sha256("another state"); }, /trace hash/);
  reject(broken => { broken.steps.at(-1).hash = sha256("another final state"); }, /golden hash/);
  reject(broken => { broken.finalSerialization = JSON.stringify({seed: 4242, turn: 14}); }, /golden hash|did not end in turn 13/);
  reject(broken => { broken.finalSerialization = JSON.stringify({seed: 4243, turn: 13}); broken.goldenHash = sha256(broken.finalSerialization); broken.steps.at(-1).hash = broken.goldenHash; }, /seed 4242|golden hash/);
  reject(broken => { broken.steps[5].code = "ok"; }, /step 5 is not the roteiro's/);
  reject(broken => { broken.steps[5].args = [1, 9, 8]; }, /step 5 is not the roteiro's/);
  reject(broken => { broken.steps[9].context = "none"; }, /step 9 is not the roteiro's/);
  reject(broken => { broken.steps.pop(); broken.stepCount = 76; }, /holds 76 steps/);
  reject(broken => { broken.acceptedTurns = 11; }, /not 12/);
  reject(broken => { broken.allPassed = false; }, /own checks did not all pass/);
  reject(broken => { broken.checks[0].passed = false; }, /own checks did not all pass/);
  reject(() => {}, /is not the pinned/, {goldenHash: GOLDEN_HASH, traceHash: TRACE_HASH});
  assert.match(judgeReplayReport({}, expected, roteiro).join("\n"), /not the replay gate's/);
});

const PROJECT = "Frontier Export 1-2-abc";
const HOME = "/home/someone";
const PROFILE = path.join(HOME, "Library/Application Support/Godot/app_userdata", PROJECT);

function genuineExport() {
  const {report, expected} = genuineReport();
  const copy = {directory: "/var/folders/xx/T/godot-fabric-civ-lite-app-copy-a", path: "/var/folders/xx/T/godot-fabric-civ-lite-app-copy-a/Frontier.app",
    realPath: "/real/folders/xx/T/godot-fabric-civ-lite-app-copy-a/Frontier.app",
    sourceSha256: "app", beforeRunsSha256: "app", afterRunsSha256: "app", signaturesVerifiedAfterRuns: true, removedAfterRuns: true};
  const executableName = PROJECT;
  const reports = {};
  const runs = RUN_LABELS.map(label => {
    const lane = label.includes("-app-") ? "app" : "editor";
    const kept = {...clone(report), userDataDir: PROFILE, project: PROJECT, displayServer: "headless", userEntriesAtStart: ["logs"],
      features: lane === "app" ? {template: true, release: true, debug: false, editor: false} : {template: false, release: false, debug: true, editor: true},
      executable: lane === "app" ? path.join(copy.realPath, "Contents/MacOS", executableName) : "/Applications/Godot.app/Contents/MacOS/Godot"};
    reports[label] = {report: kept, sha256: sha256(label)};
    return {label, lane, status: 0, problems: [], reportSha256: sha256(label), profile: {path: PROFILE, existedBefore: false, removedAfter: true}};
  });
  const matrix = Array.from({length: HUD_MATRIX_ROWS}, (_, index) => ({index, panels: index === 0 ? [...PANELS] : ["hud-bar"]}));
  const hudReport = {checks: Array.from({length: HUD_CHECKS}, (_, index) => ({name: `check ${index}`, passed: true})), matrix, displayServer: "headless", arm: "rn",
    covering: Object.fromEntries(CONTEXTS.map(context => [context, {}]))};
  const receipt = {status: "passed", published: true, consumer: "civ-lite", output: "/repo/build/macos-export-civ-lite-native/Frontier.app", limitations: ["local ad-hoc signing only", LIMIT],
    sdk: {sourceDirty: false}, fixture: {projectName: PROJECT}, publishedAppSha256: "app", copy, replay: {runs},
    app: {bundleIdentifier: "org.journeystudios.godotfabric.frontier", engineVersion: "4.7.2.stable.official.ed1daf0bf", signing: "ad-hoc local signing verified; no distribution or notarization claim",
      executableName, executableRecord: {sha256: "engine"}},
    templateMember: {architectures: ["arm64"], sha256: "engine"},
    hud: {status: 0, problems: [], reportSha256: sha256("hud"), profile: {path: PROFILE, existedBefore: false, removedAfter: true}}};
  return {receipt, reports, hud: {report: hudReport, sha256: sha256("hud")}, expected, roteiro, home: HOME};
}

test("the oracle accepts a consistent export and rejects each thing that makes it wrong", () => {
  assert.deepEqual(judgeExportReceipt(genuineExport()), []);
  const reject = (change, pattern) => {
    const broken = genuineExport();
    change(broken);
    assert.match(judgeExportReceipt(broken).join("\n"), pattern);
  };
  reject(({receipt}) => { receipt.status = "failed"; }, /receipt is failed/);
  reject(({receipt}) => { receipt.consumer = "minimal"; }, /consumer minimal/);
  reject(({receipt}) => { receipt.limitations = receipt.limitations.slice(0, 1); }, /does not state its limit/);
  reject(({receipt}) => { receipt.sdk.sourceDirty = true; }, /clean, committed source tree/);
  reject(({receipt}) => { receipt.app.signing = "pending ad-hoc local signing"; }, /ad-hoc signed and verified/);
  reject(({receipt}) => { receipt.templateMember.sha256 = "other"; }, /arm64 Release member/);
  reject(({receipt}) => { receipt.replay.runs.pop(); }, /not the 3 editor and the 3 app runs/);
  reject(({receipt}) => { receipt.fixture.projectName = "Frontier"; }, /name of its own/);
  reject(({reports}) => { reports["replay-app-2"].report.steps[40].hash = sha256("x"); }, /replay-app-2: the trace hash/);
  reject(({reports}) => { reports["replay-editor-3"].sha256 = "other"; }, /replay-editor-3: the kept report is not the one/);
  reject(({receipt}) => { receipt.replay.runs[1].profile.existedBefore = true; }, /replay-editor-2: the profile/);
  reject(({receipt}) => { receipt.replay.runs[4].profile.removedAfter = false; }, /replay-app-2: the profile/);
  reject(({reports}) => { reports["replay-app-1"].report.userDataDir = "/elsewhere"; }, /replay-app-1: the profile/);
  reject(({reports}) => { reports["replay-editor-1"].report.userEntriesAtStart = ["civ-lite-replay-report.json"]; }, /replay-editor-1: the profile held an earlier report/);
  reject(({reports}) => { reports["replay-app-3"].report.features = {template: false, release: false, debug: true, editor: true}; }, /replay-app-3: its engine features/);
  reject(({reports}) => { reports["replay-app-3"].report.features.debug = true; }, /replay-app-3: its engine features/);
  reject(({reports}) => { reports["replay-editor-2"].report.displayServer = "macOS"; }, /replay-editor-2: its engine features/);
  reject(({reports}) => { reports["replay-app-1"].report.executable = "/repo/build/Frontier.app/Contents/MacOS/Frontier"; }, /replay-app-1: it ran/);
  reject(({reports}) => { reports["replay-editor-1"].report.executable = path.join("/real/folders/xx/T/godot-fabric-civ-lite-app-copy-a/Frontier.app/Contents/MacOS", PROJECT); }, /the editor run ran the app/);
  reject(({reports}) => { reports["replay-app-2"].report.finalSerialization = JSON.stringify({seed: 4242, turn: 13, other: true}); }, /replay-app-2: the golden hash|did not play the same states/);
  reject(({receipt}) => { receipt.copy.afterRunsSha256 = "changed"; }, /copy was not the published app/);
  reject(({receipt}) => { receipt.copy.signaturesVerifiedAfterRuns = false; }, /copy was not the published app/);
  reject(({receipt}) => { receipt.copy.directory = "/repo/build/macos-export-civ-lite-native"; }, /not run from a copy in another directory/);
  reject(({receipt}) => { delete receipt.copy; }, /not run from a copy in another directory/);
  reject(({hud}) => { hud.report.checks[3].passed = false; }, /HUD report holds/);
  reject(({hud}) => { hud.report.checks.pop(); }, /HUD report holds/);
  reject(({hud}) => { hud.report.matrix.pop(); }, /HUD report holds/);
  reject(({hud}) => { hud.report.matrix[0].panels = ["hud-bar"]; }, /showed only the panels/);
  reject(({hud}) => { delete hud.report.covering.dialog; }, /seven contexts/);
  reject(({hud}) => { hud.sha256 = "other"; }, /HUD record is not the kept report's/);
  reject(({receipt}) => { receipt.hud.profile.existedBefore = true; }, /HUD run's profile/);
  reject(({receipt}) => { delete receipt.hud; }, /HUD matrix was not run/);
});

test("the runner's own judgment of a run agrees with the oracle's", () => {
  const record = lane => ({label: `replay-${lane}-1`, lane, status: 0, signal: null, passedMarker: true, fatalOutput: false, printedGoldenHash: GOLDEN_HASH, printedTraceHash: TRACE_HASH,
    goldenHash: GOLDEN_HASH, traceHash: TRACE_HASH, stepCount: 77, acceptedTurns: 12, allPassed: true, displayServer: "headless", userDataDir: PROFILE,
    userEntriesAtStart: ["logs"], features: lane === "app" ? {template: true, release: true, debug: false, editor: false} : {template: false, release: false, debug: true, editor: true},
    profile: {path: PROFILE, existedBefore: false, removedAfter: true}});
  for (const lane of ["editor", "app"]) {
    assert.deepEqual(judgeReplayRun(record(lane)), []);
  }
  const reject = (change, pattern, lane = "app") => {
    const broken = record(lane);
    change(broken);
    assert.match(judgeReplayRun(broken).join("\n"), pattern);
  };
  reject(broken => { broken.goldenHash = "0".repeat(64); broken.printedGoldenHash = broken.goldenHash; }, /golden hash .* differs from the pinned/);
  reject(broken => { broken.traceHash = "0".repeat(64); broken.printedTraceHash = broken.traceHash; }, /trace hash .* differs from the pinned/);
  reject(broken => { broken.goldenHash = null; }, /wrote no report/);
  reject(broken => { broken.status = 1; }, /exited with status 1/);
  reject(broken => { broken.fatalOutput = true; }, /engine, script or check error/);
  reject(broken => { broken.passedMarker = false; }, /no CIVLITE_REPLAY_PASSED/);
  reject(broken => { broken.printedGoldenHash = "1".repeat(64); }, /printed are not the report's/);
  reject(broken => { broken.stepCount = 76; }, /played 76 steps/);
  reject(broken => { broken.allPassed = false; }, /own checks failed/);
  reject(broken => { broken.features.debug = true; }, /not a Release export template's/);
  reject(broken => { broken.features.editor = false; }, /not the editor binary's/, "editor");
  reject(broken => { broken.profile.existedBefore = true; }, /user profile was not clean/);
  reject(broken => { broken.profile.removedAfter = false; }, /user profile was not clean/);
  reject(broken => { broken.userDataDir = "/elsewhere"; }, /not to the profile it was given/);
  reject(broken => { broken.userEntriesAtStart = ["civ-lite-replay-report.json"]; }, /already held a replay report/);
  const hud = () => ({label: "hud-app", status: 0, signal: null, passedMarker: true, fatalOutput: false, checks: HUD_CHECKS, allPassed: true, matrixRows: HUD_MATRIX_ROWS,
    displayServer: "headless", profile: {path: PROFILE, existedBefore: false, removedAfter: true}});
  assert.deepEqual(judgeHudRun(hud()), []);
  for (const [change, pattern] of [[broken => { broken.checks = 151; }, /ran 151 checks/], [broken => { broken.allPassed = false; }, /not all passed/], [broken => { broken.matrixRows = 45; }, /matrix has 45 rows/],
    [broken => { broken.passedMarker = false; }, /no CIVLITE_UI_PASSED/], [broken => { broken.status = 1; }, /exited with status 1/], [broken => { broken.profile.existedBefore = true; }, /user profile was not clean/]]) {
    const broken = hud();
    change(broken);
    assert.match(judgeHudRun(broken).join("\n"), pattern);
  }
});

test("the replay gate is inert without its flag, reuses the game's roteiro and hashing, and the scene and the HUD report keep their shape", async () => {
  const gate = await read("consumers/civ-lite/replay_validation.gd");
  assert.match(gate, /if not OS\.get_cmdline_user_args\(\)\.has\("--validate-replay"\):\n    return/);
  assert.match(gate, /const Replay := preload\("game\/replay\.gd"\)/);
  assert.match(gate, /const Canon := preload\("game\/canon\.gd"\)/);
  assert.match(gate, /Canon\.hash_text\(/);
  assert.match(gate, /services\.callv\(step\.intent, step\.args\)/);
  assert.doesNotMatch(gate, /HashingContext|"intent": "|[0-9a-f]{64}/, "the gate holds neither a copy of the roteiro, nor a hasher of its own, nor a pinned hash");
  assert.match(gate, /const REPORT := "user:\/\/civ-lite-replay-report\.json"/);
  const scene = await read("consumers/civ-lite/main.tscn");
  assert.match(scene, /path="res:\/\/replay_validation\.gd" id="11"\]/);
  assert.match(scene, /\[node name="ReplayValidation" type="Node" parent="\."\]\nscript=ExtResource\("11"\)\n/);
  const loadSteps = Number(scene.match(/^\[gd_scene load_steps=(\d+) /)?.[1]);
  assert.equal(loadSteps, scene.split("[ext_resource ").length - 1 + 1, "load_steps counts the resources and the scene");
  const hud = await read("consumers/civ-lite/hud_validation.gd");
  assert.match(hud, /return "user:\/\/civ-lite-ui-report\.json" if OS\.has_feature\("template"\) else "res:\/\/civ-lite-ui-report\.json"/);
});

test("the command line refuses an unknown consumer and an existing destination before it provisions anything", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "godot-fabric-export-civ-lite-cli-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const run = args => spawnSync(process.execPath, [path.join(root, "scripts/macos-export.mjs"), ...args], {cwd: directory, encoding: "utf8", timeout: 20000});
  const help = run(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--consumer minimal\|civ-lite/);
  assert.match(help.stdout, /--out NEW\.app/);
  const unknown = run(["--consumer", "nope", "--out", path.join(directory, "new.app"), "--template", path.join(directory, "t.zip")]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /--consumer minimal\|civ-lite/);
  assert.doesNotMatch(unknown.stderr, /provisioning/i);
  const existing = path.join(directory, "existing.app");
  await mkdir(existing);
  const dangling = path.join(directory, "dangling.app");
  await symlink(path.join(directory, "missing.app"), dangling);
  for (const output of [existing, dangling]) {
    const refused = run(["--consumer", "civ-lite", "--out", output, "--template", path.join(directory, "missing.zip")]);
    assert.equal(refused.status, 1, refused.stderr);
    assert.match(refused.stderr, /Refusing to overwrite an existing output path/);
  }
  const repeated = run(["--consumer", "civ-lite", "--consumer", "minimal", "--out", path.join(directory, "new.app"), "--template", path.join(directory, "t.zip")]);
  assert.equal(repeated.status, 2);
});

test("the profile removal touches only an export's own user-data directory", async () => {
  for (const name of ["Frontier", "Godot Fabric Export 1", "Frontier Export ", "Frontier Export ../x", "Frontier Export a/b"]) {
    await assert.rejects(removeCivLiteUserData(name), /refusing to remove/, name);
  }
  assert.equal(await removeCivLiteUserData(`Frontier Export contract-test-${process.pid}-absent`), false, "a profile that is not there is not an error");
});

test("the retained sabotage alters the seed the golden hash was taken from, in the template's source and in one place", async () => {
  assert.deepEqual(SABOTAGES.map(entry => entry.name), ["game-seed"]);
  const [sabotage] = SABOTAGES;
  const rules = await read(sabotage.file);
  assert.equal(rules.split(sabotage.find).length - 1, 1);
  assert.notEqual(sabotage.find, sabotage.replace);
  assert.ok(sabotage.file.startsWith("consumers/civ-lite/"), "the sabotage names a file of the template, which the export applies to its disposable copy");
});

test("the export of a prepared project is a function of its own, and its preset writes the filters it is given", () => {
  assert.equal(typeof exportPreparedProject, "function");
  const identifier = "org.example.app";
  const plain = presetText("/templates/arm64.zip", identifier);
  assert.equal(plain, `[preset.0]\nname="macOS Arm64"\nplatform="macOS"\nrunnable=true\ndedicated_server=false\ncustom_features=""\nexport_filter="all_resources"\ninclude_filter=""\nexclude_filter=""\n\n`
    + `[preset.0.options]\napplication/bundle_identifier="${identifier}"\napplication/short_version="1.0"\napplication/version="1.0"\nbinary_format/architecture="arm64"\n`
    + `custom_template/release="/templates/arm64.zip"\ncodesign/codesign=0\n`, "the default preset is the one the first export slice wrote");
  const filtered = presetText("/templates/arm64.zip", identifier, {exportFilter: "scenes", includeFilter: "*.json", excludeFilter: "tests/*"});
  assert.match(filtered, /export_filter="scenes"\ninclude_filter="\*\.json"\nexclude_filter="tests\/\*"\n/);
  assert.throws(() => presetText("/templates/arm64.zip", identifier, {includeFilter: 'a"b'}), /plain text/);
  assert.throws(() => presetText("/templates/arm64.zip", identifier, {excludeFilter: "a\nb"}), /plain text/);
  assert.equal(presetText('/with "quote"/arm64.zip', identifier).includes('custom_template/release="/with \\"quote\\"/arm64.zip"'), true);
});
