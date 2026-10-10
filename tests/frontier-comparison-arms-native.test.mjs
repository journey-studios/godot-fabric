import assert from "node:assert/strict";
import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import test, { after, before } from "node:test";
import { isDeepStrictEqual } from "node:util";
import { armProject, shapeArmProject } from "../scripts/frontier-comparison-arms.mjs";
import { launchScenario, MEASUREMENT_FILES, prepareProject, rehearse } from "../scripts/frontier-comparison-run.mjs";

// Arms A (main_bare.tscn) and B (main_native.tscn) run the whole script of the comparison, through the main loop of the measurement project, on a copy WITHOUT the Fabric extension, with the
// counts the same copy gives WITH it (V05-10, `execucao`; docs/research/frontier-comparison-entry.md, "The projects of the arms"). One provisioned copy serves every round, in this order:
// both arms with the extension; A shaped (scripts/frontier-comparison-arms.mjs: no addons/godot_fabric, no [editor_plugins] and [godot_fabric] in project.godot, no .godot_fabric/ and no
// .godot/extension_list.cfg, the measurement files), the editor's --import, and A; B shaped, and B. Arm C, which needs the extension, is run in the same copy at the end, as the control that the checks below can fail.
//
// It is a Debug, headless, one-execution-per-arm check of what the two projects need, not a campaign: no time of it is compared, and none is a measurement of an arm. What is compared is what the
// scenario COUNTS: the hashes of the replay and of the soak, the occurrences and frames of each window, the nodes of the tree, the notifications and the parity of B.
//
// The headless display server has no refresh rate and the format requires a positive one, so the rehearsal assumes 60 Hz (as tests/frontier-comparison-run-native.test.mjs does).
const ARMS = ["A", "B"];
const ASSUMED_REFRESH_HZ = 60;
const SUMMARY_FILE = path.join("build", "frontier-comparison-arms-report.json");
// What a log may not say once the extension is gone: its folder, its manifest, or a class of it that the arm could not find.
const FABRIC_MENTION = /godot_fabric|gdextension|fabric/i;
// The editor's own label for the step of the import that checks the extensions of any project ("Verificando GDExtensions..."): it is not a mention of this one, and it is the only line of the
// import that may say GDExtension.
const EDITOR_STEP = /first_scan_filesystem \| Verificando GDExtensions\.\.\.$/;

let prepared = null;
const through = {};
const reports = {};

before(async () => {
  prepared = await prepareProject({ name: "frontier-comparison-arms" });
});

after(async () => {
  await prepared?.harness.cleanup();
});

// What a run counts, none of it a time: the hashes of the replay and of the soak, the nodes of the tree at the end, the parity, the notifications, the occurrences of the trace by kind, and
// the occurrences and frames that each window has.
const countsOf = ({ report, derived }) => ({
  replayGoldenHash: report.game.replayGoldenHash,
  soakFinalHash: report.game.soakFinalHash,
  game: report.game,
  sceneNodes: report.readings.sceneNodes,
  parity: report.parity,
  counters: report.counters,
  unavailable: report.unavailable,
  switches: report.switches.length,
  stressRounds: report.stress.rounds,
  idle: report.idle.last - report.idle.first + 1,
  idleFrames: derived.idle.cpuUsec.length,
  trace: Object.fromEntries([...new Set(report.trace.map((entry) => entry.kind))].sort().map((kind) => [kind, report.trace.filter((entry) => entry.kind === kind).length])),
  windows: Object.fromEntries(Object.entries(derived.windows).map(([id, window]) => [id, {
    available: window.available,
    occurrences: window.occurrences.length,
    measured: window.occurrences.filter((occurrence) => !occurrence.warmup).length,
    frames: window.occurrences.reduce((total, occurrence) => total + occurrence.frameUsec.length, 0),
  }])),
});

// The counts of a run in the few lines that the report keeps: the full ones (every turn's hash of the soak) are what the comparison tests.
const compactOf = (counts) => ({
  replayGoldenHash: counts.replayGoldenHash,
  replaySteps: counts.game.replaySteps,
  soakFinalHash: counts.soakFinalHash,
  soakTrailHash: counts.game.soakTrailHash,
  soakDecisions: counts.game.soakDecisions,
  soakRefusals: counts.game.soakRefusals,
  soakTurns: counts.game.soakTurnHashes.length,
  sceneNodes: counts.sceneNodes,
  parity: { checked: counts.parity.checked, matches: counts.parity.matches, contexts: Object.keys(counts.parity.contexts).sort() },
  notifications: counts.counters,
  switches: counts.switches,
  stressRounds: counts.stressRounds,
  idleFrames: counts.idleFrames,
  trace: counts.trace,
  windows: counts.windows,
});

// Every file of a directory by its path relative to it.
async function filesOf(directory, prefix = "") {
  const found = [];
  for (const entry of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...(await filesOf(directory, `${relative}/`)));
    } else {
      found.push(relative);
    }
  }
  return found;
}

const fabricLines = (log) => log.split("\n").filter((line) => FABRIC_MENTION.test(line));

// One arm, headless, in the copy as it is: the run of the rehearsal, and what it counts.
async function runArm(arm) {
  const rehearsal = await rehearse({ prepared, arms: [arm], lane: "presented", assumeRefreshHz: ASSUMED_REFRESH_HZ });
  assert.deepEqual(rehearsal.problems, []);
  assert.deepEqual(rehearsal.formatErrors, []);
  assert.equal(rehearsal.runs.length, 1);
  return rehearsal.runs[0];
}

test("with the extension, in the copy as provisioned, A and B run the script to its end", async () => {
  assert.equal(await stat(path.join(prepared.harness.project, "addons", "godot_fabric", "fabric.gdextension")).then(() => true, () => false), true);
  for (const arm of ARMS) {
    const run = await runArm(arm);
    assert.deepEqual(run.process, { exitCode: 0, crashed: false, scriptErrors: 0, godotLogErrors: 0 }, run.log);
    through[arm] = { with: run };
    reports[arm] = { with: countsOf(run) };
  }
  console.log(`with the extension, lines of the logs that say Fabric: ${ARMS.map((arm) => `${arm}=${fabricLines(through[arm].with.log).length}`).join(" ")}`);
});

// The extension's folder is gone, the project is shaped, the editor imports the copy again, and the arm runs.
async function withoutExtension(arm) {
  const project = prepared.harness.project;
  const shaped = await shapeArmProject(project, arm, { measurement: true });
  assert.deepEqual(shaped.measurementFiles, Object.keys(MEASUREMENT_FILES));
  assert.equal(shaped.mainScene.to, armProject(arm).mainScene);
  assert.match(await readFile(path.join(project, "project.godot"), "utf8"), new RegExp(`run/main_scene="${armProject(arm).mainScene}"`));
  return shaped;
}

test("the copy is shaped for A without the extension, imported again, and A runs the script to its end", async () => {
  const project = prepared.harness.project;
  const shaped = await withoutExtension("A");
  assert.deepEqual(shaped.removedSections, ["editor_plugins", "godot_fabric"]);
  assert.equal(shaped.removedAddon, true);
  assert.deepEqual(shaped.removedArtifacts, [".godot/extension_list.cfg", ".godot_fabric"], "the copy had the list of extensions the editor kept and the HUD's build output");
  reports.removedArtifacts = shaped.removedArtifacts;
  const projectText = await readFile(path.join(project, "project.godot"), "utf8");
  assert.doesNotMatch(projectText, FABRIC_MENTION);
  for (const [file, content] of Object.entries(MEASUREMENT_FILES)) {
    assert.equal(await readFile(path.join(project, file), "utf8"), content, `${file} is as the runner writes it`);
  }
  through.import = await prepared.harness.run("import-without-fabric", prepared.harness.godot, ["--path", project, "--headless", "--import"]);
  const run = await runArm("A");
  assert.deepEqual(run.process, { exitCode: 0, crashed: false, scriptErrors: 0, godotLogErrors: 0 }, run.log);
  assert.equal(run.report.aborted, "");
  assert.deepEqual(run.report.anomalies, []);
  through.A.without = run;
  reports.A.without = countsOf(run);
});

test("the copy is shaped for B, which keeps the extension out too, and B runs the script to its end", async () => {
  const shaped = await withoutExtension("B");
  assert.deepEqual(shaped.removedSections, [], "the sections went with A's shape");
  assert.equal(shaped.removedAddon, false, "the folder went with A's shape");
  assert.deepEqual(shaped.removedArtifacts, [], "the artifacts went with A's shape");
  const run = await runArm("B");
  assert.deepEqual(run.process, { exitCode: 0, crashed: false, scriptErrors: 0, godotLogErrors: 0 }, run.log);
  assert.equal(run.report.aborted, "");
  assert.deepEqual(run.report.anomalies, []);
  through.B.without = run;
  reports.B.without = countsOf(run);
});

test("without the extension no line of the import or of the logs of A and B says Fabric, godot_fabric or GDExtension", () => {
  for (const arm of ARMS) {
    assert.deepEqual(fabricLines(through[arm].without.log), [], `arm ${arm}: a line of the log cites the extension or a class of it`);
  }
  // The shape removed the list of extensions that the editor kept (.godot/extension_list.cfg) with the folder it named, so the import has nothing to report about an extension that is gone.
  assert.deepEqual(fabricLines(through.import).filter((line) => !EDITOR_STEP.test(line.replace(/\x1b\[[0-9;]*m/g, ""))), [], "a line of the import cites the extension");
  reports.importLinesThatNameTheExtension = 0;
});

test("the copy has no addons/godot_fabric, no .gdextension anywhere, and no extension is listed for the engine to load", async () => {
  const project = prepared.harness.project;
  assert.equal(await stat(path.join(project, "addons", "godot_fabric")).then(() => true, () => false), false);
  // Nor the HUD's build output (.godot_fabric/), nor any other path of the copy that names the extension.
  const files = await filesOf(project);
  assert.deepEqual(files.filter((file) => /\.gdextension$|godot_fabric/.test(file)), []);
  const list = path.join(project, ".godot", "extension_list.cfg");
  const listed = await readFile(list, "utf8").then((text) => text, () => null);
  reports.extensionList = listed === null ? "absent" : listed;
  if (listed !== null) {
    assert.doesNotMatch(listed, /gdextension|godot_fabric/, "the list the engine reads at start names no extension");
  }
  console.log(`.godot/extension_list.cfg after the import: ${listed === null ? "absent" : JSON.stringify(listed)}`);
});

test("the counts without the extension are those with it, in A and in B: the hashes, the windows, the nodes of the tree, the notifications and the parity", () => {
  for (const arm of ARMS) {
    const { with: withExtension, without } = reports[arm];
    assert.deepEqual(without, withExtension, `arm ${arm}`);
    assert.equal(without.replayGoldenHash, through[arm].with.report.game.replayGoldenHash);
    assert.equal(without.game.soakTurns, 100);
    for (const [id, window] of Object.entries(without.windows)) {
      assert.equal(window.available, true, `arm ${arm}: ${id} is measured`);
    }
  }
  assert.equal(reports.A.without.sceneNodes, 4);
  assert.equal(reports.B.without.sceneNodes, 31);
  assert.equal(reports.A.without.parity.checked, 0, "arm A has no HUD to check");
  assert.equal(reports.B.without.parity.matches, true, "the HUD of B shows what the context matrix says in the seven contexts");
  assert.equal(reports.A.without.counters.consumed, -1);
  assert.equal(reports.B.without.counters.consumed, reports.B.without.counters.emitted);
});

test("the control: arm C, which needs the extension, does not run in this copy, and its log is one of the lines the checks look for", () => {
  const run = launchScenario({ prepared, arm: "C", lane: "presented", timeout: 300000 });
  const failed = run.process.exitCode !== 0 || run.process.scriptErrors > 0 || run.process.godotLogErrors > 0 || run.process.crashed;
  reports.control = { arm: "C", process: run.process, fabricLines: fabricLines(run.log).length };
  console.log(`control, arm C without the extension: ${JSON.stringify(run.process)}, ${fabricLines(run.log).length} lines say Fabric`);
  assert.equal(failed, true, "C did not run without its extension, which is what the checks above rely on to be able to fail");
  assert.ok(fabricLines(run.log).length > 0, "the log of C names what is missing");
});

test("the counts with and without the extension are written as a report", async () => {
  const summary = {
    notAResult: "A check that two projects run the script and count the same. No time of it is compared, and none is a measurement of an arm.",
    arms: Object.fromEntries(ARMS.map((arm) => [arm, {
      mainScene: armProject(arm).mainScene,
      with: { process: through[arm].with.process, counts: compactOf(reports[arm].with) },
      without: { process: through[arm].without.process, counts: compactOf(reports[arm].without) },
      sameCounts: isDeepStrictEqual(reports[arm].with, reports[arm].without),
    }])),
    extensionListAfterImport: reports.extensionList,
    removedArtifacts: reports.removedArtifacts,
    importLinesThatNameTheExtension: reports.importLinesThatNameTheExtension,
    control: reports.control,
  };
  const out = path.join(prepared.harness.root, SUMMARY_FILE);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`FRONTIER_COMPARISON_ARMS_REPORT: ${out}`);
});
