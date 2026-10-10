import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";
import { runSelfCheck, selfCheckArguments } from "../scripts/frontier-comparison-campaign-instrument.mjs";
import { ENTRY_CLASS, INSTRUMENT_FILE, OVERRIDE_FILE, PROBE_FILE, PROBE_PROJECT_FILES, prepareProbeProject } from "../scripts/frontier-comparison-probe-project.mjs";
import { sha256 } from "../scripts/frontier-comparison-run-campaign.mjs";
import { scriptsOf } from "../scripts/frontier-comparison-run.mjs";

// The probe project of the instrument's self-check and the entries of the self-check (V05-10, `execucao`), Node only: the project that `prepareProbeProject` writes (its files, their texts and hashes, the
// instrument that has to be the repository's, the refusals) with the editor's import replaced by a fake process, and `runSelfCheck` through its three entries ("script", "main-loop" and "release")
// against a probe process and an oracle that the test supplies, which have to judge them all the same way. The native proof, with the real engine, is tests/frontier-comparison-probe-native.test.mjs.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file));

let scratch = null;
let counter = 0;
before(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "frontier-comparison-probe-project-"));
});
after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const next = (name) => path.join(scratch, `${name}-${counter++}`);
const exists = (file) => stat(file).then(() => true, () => false);
// The editor's import, as a process: it records what it was asked and ends as the test says.
const importer = ({ status = 0, stdout = "", stderr = "", signal = null } = {}) => {
  const calls = [];
  const run = (command, args, options) => {
    calls.push({ command, args, options });
    return { status, signal, stdout, stderr };
  };
  return { calls, run };
};

test("the probe project is the probe, the instrument and four small files, at the paths the probe preloads, with the repository's instrument and the hash of every file", async () => {
  const directory = next("project");
  const fake = importer();
  const prepared = await prepareProbeProject(directory, { engine: "the-editor", run: fake.run });
  assert.equal(prepared.directory, directory);
  assert.equal(prepared.engine, "the-editor");
  assert.deepEqual(Object.keys(prepared.files).sort(), [INSTRUMENT_FILE, OVERRIDE_FILE, PROBE_FILE, "project.godot", "tests/cpu-time-instrument-probe-empty.tscn", "tests/cpu-time-instrument-probe-entry.gd"].sort());
  // The probe and the instrument are the repository's files, byte for byte, at their own paths.
  for (const file of [PROBE_FILE, INSTRUMENT_FILE]) {
    assert.deepEqual(await readFile(prepared.files[file].path), read(file), file);
  }
  assert.equal(prepared.instrumentSha256, sha256(read(INSTRUMENT_FILE)), "the instrument is the repository's");
  assert.equal(prepared.files[INSTRUMENT_FILE].sha256, prepared.instrumentSha256);
  // The rest is the constants' text, and every hash is the file's as it is on disk.
  for (const [file, text] of Object.entries(PROBE_PROJECT_FILES)) {
    assert.equal(await readFile(path.join(directory, file), "utf8"), text, file);
  }
  for (const [file, entry] of Object.entries(prepared.files)) {
    assert.equal(entry.path, path.join(directory, file));
    assert.equal(entry.sha256, sha256(await readFile(entry.path)), file);
  }
  assert.deepEqual(prepared.scripts, scriptsOf(Object.fromEntries(Object.entries(prepared.files).map(([file, entry]) => [file, entry.sha256]))));
  // Every file the probe or the instrument loads by path is in the project.
  const sources = [PROBE_FILE, INSTRUMENT_FILE].map((file) => read(file).toString("utf8")).join("\n");
  const loaded = [...sources.matchAll(/\b(?:pre)?load\("res:\/\/([^"]+)"\)/g)].map((match) => match[1]);
  assert.deepEqual(loaded, [INSTRUMENT_FILE], "the probe preloads the instrument and nothing else");
  for (const file of loaded) {
    assert.ok(await exists(path.join(directory, file)), `${file} is in the project`);
  }
  // The import ran once, last, in the editor's binary over the new project.
  assert.deepEqual(fake.calls.map(({ command, args }) => [command, args]), [["the-editor", ["--path", directory, "--headless", "--import"]]]);
});

test("the project's texts: a minimal project.godot on civ-lite's renderer, an entry class that extends the probe by name, an empty scene, and override.cfg naming both", async () => {
  const project = PROBE_PROJECT_FILES["project.godot"];
  assert.match(project, /^config_version=5\n/);
  assert.match(project, /config\/name="Frontier instrument probe"/);
  assert.match(project, /renderer\/rendering_method="gl_compatibility"/);
  assert.ok(!/run\/main_scene|main_loop_type/.test(project), "the project's own settings name no main scene: override.cfg does, as the measurement project's");
  assert.equal(readFileSync(path.join(root, "consumers", "civ-lite", "project.godot"), "utf8").includes('renderer/rendering_method="gl_compatibility"'), true, "civ-lite's renderer");
  const entry = PROBE_PROJECT_FILES["tests/cpu-time-instrument-probe-entry.gd"];
  assert.equal(entry, `class_name ${ENTRY_CLASS}\nextends "cpu-time-instrument-probe.gd"\n`);
  assert.equal(PROBE_FILE, "tests/cpu-time-instrument-probe.gd", "the entry class and the probe are in the same directory: the relative name is the probe's");
  assert.match(PROBE_PROJECT_FILES["tests/cpu-time-instrument-probe-empty.tscn"], /^\[gd_scene format=3\]\n\n\[node name="CpuTimeInstrumentProbeEmpty" type="Node"\]\n$/);
  assert.equal(
    PROBE_PROJECT_FILES[OVERRIDE_FILE],
    `config_version=5\n\n[application]\n\nrun/main_scene="res://tests/cpu-time-instrument-probe-empty.tscn"\nrun/main_loop_type="${ENTRY_CLASS}"\n`,
  );
  // The probe is a SceneTree script, so it can be a main loop; the class name is not one the repository's own project registers.
  assert.match(read(PROBE_FILE).toString("utf8"), /^extends SceneTree\n/);
  assert.ok(!/class_name CpuTimeInstrumentProbeEntry/.test(read(PROBE_FILE).toString("utf8")));
});

test("a directory that is not new is refused, an absent or empty one is made, and a failed import is refused with its log", async () => {
  const taken = next("taken");
  await mkdir(taken, { recursive: true });
  await writeFile(path.join(taken, "keep.txt"), "mine");
  const never = importer();
  await assert.rejects(prepareProbeProject(taken, { engine: "e", run: never.run }), /needs a new directory, and .* is not empty/);
  assert.equal(await readFile(path.join(taken, "keep.txt"), "utf8"), "mine");
  assert.deepEqual(never.calls, []);
  // An empty one is fine, and so is one in a directory that does not exist yet.
  const empty = next("empty");
  await mkdir(empty, { recursive: true });
  assert.equal((await prepareProbeProject(empty, { engine: "e", run: importer().run })).directory, empty);
  const nested = path.join(next("nested"), "inside", "project");
  assert.equal((await prepareProbeProject(nested, { engine: "e", run: importer().run })).directory, nested);
  // A relative directory is resolved.
  const relative = path.relative(process.cwd(), next("relative"));
  assert.ok(path.isAbsolute((await prepareProbeProject(relative, { engine: "e", run: importer().run })).directory));
  const failed = importer({ status: 1, stdout: "importing\n", stderr: "ERROR: nope\n" });
  await assert.rejects(prepareProbeProject(next("failing"), { engine: "e", run: failed.run }), (error) => /ended with exit 1/.test(error.message) && /importing\nERROR: nope/.test(error.message));
  const killed = importer({ status: null, signal: "SIGTERM" });
  await assert.rejects(prepareProbeProject(next("killed"), { engine: "e", run: killed.run }), /ended with signal SIGTERM/);
});

test("the arguments of each entry are pure: script keeps today's, main-loop and release have no --script, and a report that is not absolute is refused", () => {
  const project = "/repo";
  const report = "/out/probe-report.json";
  assert.deepEqual(selfCheckArguments({ project, report: "name.json" }), ["--path", project, "--headless", "--script", "res://tests/cpu-time-instrument-probe.gd", "--", "--report=name.json"]);
  assert.deepEqual(selfCheckArguments({ entry: "script", windowed: true, project, report: "name.json" }), ["--path", project, "--windowed", "--script", "res://tests/cpu-time-instrument-probe.gd", "--", "--report=name.json"]);
  assert.deepEqual(selfCheckArguments({ entry: "main-loop", project, probeProject: "/probe", report }), ["--path", "/probe", "--headless", "--", `--report=${report}`]);
  assert.deepEqual(selfCheckArguments({ entry: "main-loop", windowed: true, project, probeProject: "/probe", report }), ["--path", "/probe", "--windowed", "--", `--report=${report}`]);
  assert.deepEqual(selfCheckArguments({ entry: "release", project, report }), ["--headless", "--", `--report=${report}`]);
  assert.deepEqual(selfCheckArguments({ entry: "release", windowed: true, project, report }), ["--windowed", "--", `--report=${report}`]);
  for (const entry of ["main-loop", "release"]) {
    const args = selfCheckArguments({ entry, project, probeProject: "/probe", report });
    assert.ok(!args.includes("-s") && !args.includes("--script"), `${entry}: a template discards -s`);
    assert.ok(!args.some((argument) => argument.startsWith("res://")), `${entry}: the probe is the project's main loop and not a path`);
    assert.throws(() => selfCheckArguments({ entry, project, probeProject: "/probe", report: "relative.json" }), /--report must be an absolute path/);
  }
  assert.ok(!selfCheckArguments({ entry: "release", project, report }).includes("--path"), "a template aborts on --path");
  assert.throws(() => selfCheckArguments({ entry: "main-loop", project, report }), /needs the probe project: probeProject/);
  assert.throws(() => selfCheckArguments({ entry: "other", project, report }), /unknown entry of the self-check: other/);
});

// ---- runSelfCheck through the three entries ----

// A checkout (or a probe project) with the instrument's file in it.
async function checkout(name, instrument = "extends Node\n") {
  const project = next(name);
  await mkdir(path.join(project, "tests"), { recursive: true });
  await writeFile(path.join(project, INSTRUMENT_FILE), instrument);
  return project;
}
const GOOD_REPORT = { checks: [{ name: "a", passed: true }, { name: "b", passed: true }], allCurrentAssertionsPassed: true, provenance: { godot: "4.7.2" } };
// A probe process that writes its report where its `--report` says (a name under <--path>/build, or an absolute file) and ends as the test says.
function probeProcess({ status = 0, log = "CPU_TIME_INSTRUMENT_PASSED: 2\n", report = GOOD_REPORT } = {}) {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args, options });
    if (report !== null) {
      const requested = args.find((argument) => argument.startsWith("--report=")).slice("--report=".length);
      writeFileSync(path.isAbsolute(requested) ? requested : path.join(args[args.indexOf("--path") + 1], "build", requested), JSON.stringify(report));
    }
    return { status, signal: null, stdout: log, stderr: "" };
  };
  return { calls, spawn };
}
const judged = { judged: true, violations: [] };
const presented = { judged: true, presented: true, violations: [] };

// What each entry is asked to run, with the same probe process and oracle.
async function through(entry, { windowed = false, verdict = judged, project, probeProject, outDirectory = next(`out-${entry}`), ...behavior } = {}) {
  const fake = probeProcess(behavior);
  const home = project ?? (await checkout(`repository-${entry}`));
  const request = {
    script: { engine: "the-engine" },
    "main-loop": { engine: "the-engine", probeProject: probeProject ?? (await checkout(`probe-${entry}`)) },
    release: { engine: "the-engine", executable: "/exports/probe.app/Contents/MacOS/probe" },
  }[entry];
  const result = await runSelfCheck({ windowed, outDirectory, project: home, spawn: fake.spawn, judge: () => verdict, entry, ...request });
  return { result, calls: fake.calls, outDirectory, project: home };
}

test("the main-loop entry runs the editor over the probe project with no --script, and the release entry runs the exported .app from the check's own directory; both leave the report in the check's directory", async () => {
  const main = await through("main-loop");
  const [call] = main.calls;
  assert.equal(call.command, "the-engine");
  assert.deepEqual(call.args.slice(0, 3), ["--path", call.args[1], "--headless"]);
  assert.ok(!call.args.includes("--script") && !call.args.includes("-s"));
  assert.equal(call.args[3], "--");
  assert.equal(call.args[4], `--report=${path.join(main.outDirectory, "probe-report.json")}`);
  assert.notEqual(call.args[1], main.project, "the probe project, not the repository's checkout");
  assert.equal(call.options.cwd, undefined);
  assert.deepEqual([main.result.passed, main.result.why, main.result.entry, main.result.lane], [true, [], "main-loop", "headless"]);
  assert.ok(await exists(path.join(main.outDirectory, "probe-report.json")), "the report is in the check's directory");
  assert.ok(await exists(path.join(main.outDirectory, "probe.log")));
  assert.ok(!(await exists(path.join(main.project, "build"))), "the checkout is not written");

  const release = await through("release", { windowed: true, verdict: presented });
  const [launch] = release.calls;
  assert.equal(launch.command, "/exports/probe.app/Contents/MacOS/probe", "the executable of the .app, not the engine");
  assert.deepEqual(launch.args, ["--windowed", "--", `--report=${path.join(release.outDirectory, "probe-report.json")}`]);
  assert.equal(launch.options.cwd, release.outDirectory, "outside the .app");
  assert.deepEqual([release.result.passed, release.result.why, release.result.entry, release.result.lane, release.result.oracle.presented], [true, [], "release", "windowed", true]);
  assert.deepEqual(release.result.files, { report: "probe-report.json", log: "probe.log" });
  assert.ok(!(await exists(path.join(release.project, "build"))), "the checkout is not written");

  // A relative directory for the check's files is made absolute for the probe.
  const relative = path.relative(process.cwd(), next("relative-out"));
  const resolved = await through("release", { outDirectory: relative });
  assert.ok(path.isAbsolute(resolved.calls[0].args[2].slice("--report=".length)));
  assert.ok(await exists(path.join(path.resolve(relative), "probe-report.json")));
});

test("the script entry is what it was: the report is a name under the checkout's build directory and is copied to the check's directory", async () => {
  const script = await through("script");
  assert.deepEqual(script.calls[0].args, ["--path", script.project, "--headless", "--script", "res://tests/cpu-time-instrument-probe.gd", "--", "--report=cpu-time-instrument-campaign-report.json"]);
  assert.equal(script.calls[0].command, "the-engine");
  assert.equal(script.calls[0].options.timeout, 900000);
  assert.deepEqual([script.result.passed, script.result.entry, script.result.lane], [true, "script", "headless"]);
  assert.ok(await exists(path.join(script.project, "build", "cpu-time-instrument-campaign-report.json")));
  assert.deepEqual(JSON.parse(await readFile(path.join(script.outDirectory, "probe-report.json"), "utf8")), GOOD_REPORT);
  // No entry given is the script entry.
  const fake = probeProcess();
  const project = await checkout("default-entry");
  const result = await runSelfCheck({ engine: "e", outDirectory: next("out-default"), project, spawn: fake.spawn, judge: () => judged });
  assert.equal(result.entry, "script");
  assert.ok(fake.calls[0].args.includes("--script"));
});

test("the three entries judge the same way: the oracle, the log, the probe's own checks, the display of a window and the instrument's hash", async () => {
  const failing = { checks: [{ name: "idle", passed: false }], allCurrentAssertionsPassed: false, provenance: {} };
  const dark = { judged: false, presented: false, reason: "the window drew 12 of the 600 idle frames", violations: [] };
  const cases = [
    ["a window that no display presented", { windowed: true, verdict: dark }, /no display presented the window, so the check measured nothing: the window drew 12 of the 600 idle frames/],
    ["an oracle that rejects", { verdict: { judged: true, violations: ["The 10 ms load is read to within 10%"] } }, /the oracle rejects the report: The 10 ms load is read to within 10%/],
    ["an oracle that cannot judge", { verdict: { judged: false, violations: ["too few frames"] } }, /the oracle could not judge the report: too few frames/],
    ["a probe that ends with an error", { status: 1 }, /the probe ended with exit 1/],
    ["a probe that writes no report", { report: null }, /the probe wrote no report/],
    ["a log with a hidden error", { log: "CPU_TIME_INSTRUMENT_PASSED: 2\nERROR: something hidden\n" }, /1 error line\(s\) in the probe's log are not a failed check/],
    ["a log with a script error", { log: "CPU_TIME_INSTRUMENT_PASSED: 2\nSCRIPT ERROR: x\n" }, /the probe's log has a script error, a crash or a leak/],
    ["a probe whose checks failed", { report: failing }, /the probe's checks failed: idle/],
    ["a probe that does not say it passed", { log: "" }, /the probe did not print CPU_TIME_INSTRUMENT_PASSED/],
  ];
  const whyOf = async (entry, options) => (await through(entry, options)).result.why;
  for (const [what, options, pattern] of cases) {
    const script = await whyOf("script", options);
    assert.match(script.join("\n"), pattern, `script: ${what}`);
    assert.deepEqual(await whyOf("main-loop", options), script, `main-loop: ${what}`);
    assert.deepEqual(await whyOf("release", options), script, `release: ${what}`);
  }
  // The instrument's hash is the checkout's in all three, and the main-loop entry runs the probe project's own copy, which has to be the same file.
  const project = await checkout("hashed", "extends Node # the instrument\n");
  for (const entry of ["script", "main-loop", "release"]) {
    assert.equal((await through(entry, { project, probeProject: await checkout("same-copy", "extends Node # the instrument\n") })).result.sha256, sha256("extends Node # the instrument\n"), entry);
  }
  const other = await through("main-loop", { project, probeProject: await checkout("other-copy", "extends Node # another\n") });
  assert.equal(other.result.passed, false);
  assert.match(other.result.why.join("\n"), new RegExp(`the probe project carries another tests/cpu-time-instrument\\.gd than the repository's \\(${sha256("extends Node # the instrument\n")}\\)`));
  assert.equal(other.result.sha256, sha256("extends Node # the instrument\n"), "the hash that is recorded is the repository's");
});

test("the timeout of the process is the check's to set, and an entry that lacks what it runs is refused before anything starts", async () => {
  const fake = probeProcess();
  const project = await checkout("timeout");
  await runSelfCheck({ engine: "e", outDirectory: next("out-timeout"), project, spawn: fake.spawn, judge: () => judged, entry: "release", executable: "/probe", timeout: 15000 });
  assert.equal(fake.calls[0].options.timeout, 15000);
  const never = probeProcess();
  const refuse = (extra, pattern) => assert.rejects(runSelfCheck({ engine: "e", outDirectory: next("out-refused"), project, spawn: never.spawn, judge: () => judged, ...extra }), pattern);
  await refuse({ entry: "release" }, /the release entry needs the executable of the exported probe/);
  await refuse({ entry: "release", executable: "" }, /the release entry needs the executable/);
  await refuse({ entry: "main-loop" }, /the main-loop entry needs the probe project/);
  await refuse({ entry: "nope", executable: "/probe" }, /unknown entry of the self-check: nope/);
  assert.deepEqual(never.calls, [], "no process was started");
  // A probe that is killed at the timeout wrote no report, and says why.
  const killed = (command, args) => ({ status: null, signal: "SIGTERM", stdout: "Error: Can't run project: no main scene defined in the project.\n", stderr: "", args, command });
  const result = await runSelfCheck({ engine: "e", outDirectory: next("out-killed"), project, spawn: killed, judge: () => judged, entry: "main-loop", probeProject: await checkout("killed-probe"), timeout: 1 });
  assert.equal(result.passed, false);
  assert.deepEqual(result.why.slice(0, 2), ["the probe ended with signal SIGTERM", "the probe wrote no report"]);
  assert.ok(!(await exists(path.join(project, "build"))), "a main-loop check does not write the checkout");
});
