import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runSelfCheck } from "../scripts/frontier-comparison-campaign-instrument.mjs";
import { ENTRY_CLASS, INSTRUMENT_FILE, OVERRIDE_FILE, PROBE_PROJECT_FILES, prepareProbeProject } from "../scripts/frontier-comparison-probe-project.mjs";
import { sha256 } from "../scripts/frontier-comparison-run-campaign.mjs";
import { ensureGodotBinary } from "../scripts/godot-binary.mjs";

// The instrument's self-check through the main loop of the probe project (V05-10, `execucao`), headless and with the real engine: the probe project is prepared in a temporary directory (the probe and the
// instrument copied, the entry class, an empty scene, override.cfg, the editor's import), and the self-check (the probe, then the oracle) runs through it with `entry: "main-loop"`, which gives the
// editor's binary `--path <probe project>` and no `--script`. It passes; so does the same check through `entry: "script"` over this checkout, as `npm run test:cpu-time-instrument` runs it, and the two
// judge the SAME checks, by name. No time is compared: the two runs take as long as they take.
//
// The negative controls: the probe project without its override.cfg does not enter the probe (the engine says there is no main scene, and idles until the check kills it), and with an override.cfg that
// names the empty scene and no main loop the empty scene runs and the probe is not entered either. In both the check writes no report and fails with "the probe wrote no report".
//
// Nothing windowed: a window is for the campaign's machine. The Release entry (the exported .app) is tested in Node, against a fake .app (tests/frontier-comparison-release.test.mjs); exporting the probe
// project, with the template and no frameworks, comes with the export of the arms.
const root = fileURLToPath(new URL("..", import.meta.url));
const SUMMARY_DIRECTORY = path.join(root, "build", "frontier-comparison-probe-entry");
const CONTROL_TIMEOUT_MS = 15000;

const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const exists = (file) => stat(file).then(() => true, () => false);
// The check's process, recorded: what the engine was asked, and what it said.
const recorded = () => {
  const calls = [];
  const spawn = (command, args, options) => {
    calls.push({ command, args });
    return spawnSync(command, args, options);
  };
  return { calls, spawn };
};
const namesOf = (report) => report.checks.map((row) => row.name);

test("the self-check through the main loop of the probe project passes headless and judges the same checks as the script entry; a project without its override.cfg does not enter the probe", async () => {
  const engine = await ensureGodotBinary();
  const scratch = await mkdtemp(path.join(tmpdir(), "frontier-comparison-probe-native-"));
  try {
    const project = path.join(scratch, "project");
    const prepared = await prepareProbeProject(project, { engine });
    // The import found the entry class, which is where the engine looks for a main loop by its name.
    assert.match(await readFile(path.join(project, ".godot", "global_script_class_cache.cfg"), "utf8"), new RegExp(`"class": &"${ENTRY_CLASS}"`));
    assert.equal(prepared.instrumentSha256, sha256(await readFile(path.join(root, INSTRUMENT_FILE))), "the instrument in the probe project is the repository's");

    // The main loop of the probe project.
    const entry = recorded();
    const outMainLoop = path.join(scratch, "out-main-loop");
    const mainLoop = await runSelfCheck({ engine, entry: "main-loop", probeProject: project, outDirectory: outMainLoop, spawn: entry.spawn });
    assert.deepEqual(mainLoop.why, []);
    assert.equal(mainLoop.passed, true);
    assert.deepEqual([mainLoop.entry, mainLoop.lane, mainLoop.probe.exitCode, mainLoop.probe.failed, mainLoop.oracle.judged, mainLoop.oracle.violations], ["main-loop", "headless", 0, [], true, []]);
    assert.equal(entry.calls.length, 1);
    const { command, args } = entry.calls[0];
    assert.equal(command, engine);
    assert.ok(!args.includes("--script") && !args.includes("-s"), "the probe is the main loop of the project, not a script");
    const reportFile = path.join(outMainLoop, "probe-report.json");
    assert.deepEqual(args, ["--path", project, "--headless", "--", `--report=${reportFile}`]);
    assert.ok(path.isAbsolute(reportFile) && (await exists(reportFile)), "the report is at the absolute path");
    assert.equal(mainLoop.sha256, prepared.instrumentSha256);
    const mainLoopReport = await readJson(reportFile);
    assert.equal(mainLoopReport.scenario, "cpu-time-instrument");
    assert.equal(mainLoopReport.lane, "headless");
    assert.equal(mainLoopReport.allCurrentAssertionsPassed, true);
    assert.match(await readFile(path.join(outMainLoop, "probe.log"), "utf8"), /CPU_TIME_INSTRUMENT_PASSED: \d+/);

    // The script entry, as today, over this checkout.
    const script = await runSelfCheck({ engine, entry: "script", outDirectory: path.join(scratch, "out-script") });
    assert.deepEqual(script.why, []);
    assert.equal(script.passed, true);
    assert.deepEqual([script.entry, script.lane, script.probe.exitCode, script.probe.failed, script.oracle.judged, script.oracle.violations], ["script", "headless", 0, [], true, []]);
    const scriptReport = await readJson(path.join(scratch, "out-script", "probe-report.json"));

    // The same checks are judged, by name; the timings are not compared.
    assert.deepEqual(namesOf(mainLoopReport), namesOf(scriptReport));
    assert.equal(mainLoop.probe.checks, script.probe.checks);
    assert.ok(mainLoop.probe.checks > 0);
    assert.deepEqual(mainLoopReport.checks.map((row) => row.passed), scriptReport.checks.map((row) => row.passed));
    assert.equal(mainLoop.sha256, script.sha256, "the instrument is the same file");
    assert.equal(mainLoopReport.provenance.godot, scriptReport.provenance.godot);
    assert.equal(mainLoopReport.provenance.displayServer, scriptReport.provenance.displayServer);

    // The controls: the project without its override.cfg, and with an override.cfg that has the empty scene and no main loop.
    await rm(path.join(project, OVERRIDE_FILE));
    const without = await runSelfCheck({ engine, entry: "main-loop", probeProject: project, outDirectory: path.join(scratch, "out-without"), timeout: CONTROL_TIMEOUT_MS });
    await writeFile(path.join(project, OVERRIDE_FILE), PROBE_PROJECT_FILES[OVERRIDE_FILE].split("\n").filter((line) => !line.startsWith("run/main_loop_type")).join("\n"));
    const emptyScene = await runSelfCheck({ engine, entry: "main-loop", probeProject: project, outDirectory: path.join(scratch, "out-empty-scene"), timeout: CONTROL_TIMEOUT_MS });
    for (const [what, control] of [["without override.cfg", without], ["with the empty scene and no main loop", emptyScene]]) {
      assert.equal(control.passed, false, what);
      assert.ok(control.why.includes("the probe wrote no report"), `${what}: ${control.why.join("; ")}`);
      assert.equal(control.files.report, null, what);
      assert.equal(control.probe.checks, 0, what);
    }
    const withoutLog = await readFile(path.join(scratch, "out-without", "probe.log"), "utf8");
    const emptySceneLog = await readFile(path.join(scratch, "out-empty-scene", "probe.log"), "utf8");
    assert.match(withoutLog, /no main scene defined in the project/);
    assert.doesNotMatch(emptySceneLog, /no main scene/);
    for (const log of [withoutLog, emptySceneLog]) {
      assert.doesNotMatch(log, /CPU_TIME_INSTRUMENT/);
    }
    assert.ok(!(await exists(path.join(scratch, "out-without", "probe-report.json"))));
    assert.ok(!(await exists(path.join(scratch, "out-empty-scene", "probe-report.json"))));

    await mkdir(SUMMARY_DIRECTORY, { recursive: true });
    await writeFile(
      path.join(SUMMARY_DIRECTORY, "summary.json"),
      `${JSON.stringify(
        {
          note: "The self-check of the instrument through the main loop of the probe project, headless, Debug (the editor's binary). It is not a measurement of an arm and no time of it is compared.",
          godot: mainLoopReport.provenance.godot,
          entries: {
            "main-loop": { passed: mainLoop.passed, checks: namesOf(mainLoopReport), failed: mainLoop.probe.failed, oracle: { judged: mainLoop.oracle.judged, violations: mainLoop.oracle.violations } },
            script: { passed: script.passed, checks: namesOf(scriptReport), failed: script.probe.failed, oracle: { judged: script.oracle.judged, violations: script.oracle.violations } },
          },
          sameChecks: true,
          instrumentSha256: prepared.instrumentSha256,
          probeProjectFiles: Object.fromEntries(Object.entries(prepared.files).map(([file, entry]) => [file, entry.sha256])),
          scriptsSha256: prepared.scripts.sha256,
          controls: {
            "without override.cfg": { passed: without.passed, why: without.why, engineSaid: "Error: Can't run project: no main scene defined in the project." },
            "override.cfg with the empty scene and no main loop": { passed: emptyScene.passed, why: emptyScene.why },
          },
        },
        null,
        2,
      )}\n`,
    );
    console.log(`FRONTIER_COMPARISON_PROBE_ENTRY: ${mainLoop.probe.checks} checks through the main loop and through the script, the same by name; ${without.why.length + emptyScene.why.length} reasons in the two controls`);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
