import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { appendFile, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";
import { parseArguments, runCampaign } from "../scripts/frontier-comparison-campaign.mjs";
import { RELEASE_SELF_CHECK_REFUSAL, createReleaseLauncher } from "../scripts/frontier-comparison-campaign-launchers.mjs";
import { MANIFEST_FILE, MANIFEST_FORMAT, hashesOf, hashProblems, manifestErrors, readExports } from "../scripts/frontier-comparison-release.mjs";
import { SEED, SOAK_FINAL_HASH, goldenReplayHash, sha256 } from "../scripts/frontier-comparison-run-campaign.mjs";
import { scriptsOf } from "../scripts/frontier-comparison-run.mjs";
import { createFakeExports, editManifest } from "./frontier-comparison-release-fake-app.mjs";

// The Release launcher of the comparative campaign (V05-10, `execucao`, part 2), Node only, over FAKE exports (tests/frontier-comparison-release-fake-app.mjs): three `.app` whose executable is a
// script that writes a minimal report, with the manifests that the measuring script writes beside them. The manifest and its checks, what `prepare()` refuses and registers, the arguments and the
// directory of a launch, the hashes checked again at every launch, the timeout, what `cleanup()` leaves alone, and the campaign that reads the exports and then refuses because the instrument's
// self-check cannot run in a template. Nothing here was measured, and the real export of civ-lite does not exist yet.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const protocolBytes = readFileSync(path.join(root, "docs", "research", "frontier-comparison-protocol.json"));
const protocol = JSON.parse(protocolBytes);
const campaignScript = path.join(root, "scripts", "frontier-comparison-campaign.mjs");
const INSTRUMENT_FILE = "tests/cpu-time-instrument.gd";

let scratch = null;
let counter = 0;
before(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), "frontier-comparison-release-"));
});
after(async () => {
  await rm(scratch, { recursive: true, force: true });
});

const exportsIn = async (options) => createFakeExports(await mkdtemp(path.join(scratch, `exports-${counter++}-`)), options);
const exists = (file) => stat(file).then(() => true, () => false);
const readManifest = async (exports, arm) => JSON.parse(await readFile(exports.apps[arm].manifestFile, "utf8"));
// A `run` that is never to be called: the tests of a refusal prove that nothing was started.
const neverRun = () => assert.fail("a process was started");

test("a good manifest has no problem, and each way of being wrong is named", async () => {
  const exports = await exportsIn();
  const good = await readManifest(exports, "B");
  assert.equal(good.format, MANIFEST_FORMAT);
  assert.deepEqual(manifestErrors(good, "B"), []);
  const changed = (edit) => {
    const manifest = structuredClone(good);
    edit(manifest);
    return manifest;
  };
  assert.deepEqual([manifestErrors(null, "B"), manifestErrors([], "B"), manifestErrors("text", "B")], Array(3).fill(["the manifest is not an object"]));
  const wrong = [
    [(m) => (m.format = "godot-fabric.frontier-comparison-export/v0"), /format is "godot-fabric.frontier-comparison-export\/v0"/],
    [(m) => delete m.format, /format is undefined/],
    [(m) => (m.arm = "A"), /arm is "A", but this is the export of arm B/],
    [(m) => (m.app = 7), /app is not a path/],
    [(m) => (m.executable = ""), /executable is not a path/],
    [(m) => (m.pck = "/abs/civ.pck"), /pck must be relative to the manifest's directory and have no "\.\."/],
    [(m) => (m.executable = "../civ-b.app/Contents/MacOS/civ-b"), /executable must be relative to the manifest's directory and have no "\.\."/],
    [(m) => (m.pck = "civ-b.app/Contents/../Resources/civ-b.pck"), /pck must be relative to the manifest's directory and have no "\.\."/],
    [(m) => (m.app = "civ-b"), /app is not a \.app/],
    [(m) => (m.executable = "civ-b.app/Contents/Resources/civ-b"), /executable is not a file in civ-b\.app\/Contents\/MacOS\//],
    [(m) => (m.pck = "civ-b.app/Contents/Resources/civ-b.bin"), /pck is not a \.pck in civ-b\.app\/Contents\/Resources\//],
    [(m) => (m.binarySha256 = "abc"), /binarySha256 is not a SHA-256 of 64 hexadecimal digits/],
    [(m) => (m.packageSha256 = "A".repeat(64)), /packageSha256 is not a SHA-256/],
    [(m) => delete m.templateSha256, /templateSha256 is not a SHA-256/],
    [(m) => (m.scriptSha256 = "0".repeat(64)), /scriptSha256 is not the hash of scriptFiles/],
    [(m) => (m.scriptFiles = {}), /scriptFiles is not a non-empty object/],
    [(m) => (m.scriptFiles["tests/x.gd"] = "short"), /scriptFiles is not a non-empty object/],
    [(m) => (m.godot = ""), /godot is not the engine's version/],
    [(m) => (m.exportBytes = [10]), /exportBytes is not two positive integers/],
    [(m) => (m.exportBytes = [10, 10, 10]), /exportBytes is not two positive integers/],
    [(m) => (m.exportBytes = [0, 0]), /exportBytes is not two positive integers/],
    [(m) => (m.exportBytes = [1.5, 1.5]), /exportBytes is not two positive integers/],
    [(m) => (m.exportBytes = ["10", "10"]), /exportBytes is not two positive integers/],
    [(m) => (m.exportBytes = [100, 101]), /exportBytes are 100 and 101: the protocol asks for the export and its repeat to have the same size/],
  ];
  for (const [edit, pattern] of wrong) {
    assert.match(manifestErrors(changed(edit), "B").join("\n"), pattern, pattern.source);
  }
});

test("the three manifests are read from <directory>/<arm>, with their paths resolved to absolute ones", async () => {
  const exports = await exportsIn();
  const entries = await readExports(exports.directory);
  assert.deepEqual(Object.keys(entries), ["A", "B", "C"]);
  for (const arm of ["A", "B", "C"]) {
    const { app, executable, pck } = entries[arm];
    assert.deepEqual([app, executable, pck], [exports.apps[arm].app, exports.apps[arm].executable, exports.apps[arm].pck]);
    assert.ok(path.isAbsolute(executable) && path.isAbsolute(pck));
    assert.deepEqual(hashProblems(entries[arm], await hashesOf(entries[arm])), []);
  }
  assert.equal(MANIFEST_FILE, "frontier-comparison-export.json");
  // A relative exports directory is resolved: a relative executable would be looked up in the launch's working directory.
  const relative = path.relative(process.cwd(), exports.directory);
  assert.ok(path.isAbsolute((await readExports(relative)).C.executable));
});

test("prepare() registers what the manifests say, with the seed, the game's hashes and the instrument from the Debug launcher's sources", async () => {
  const exports = await exportsIn();
  const launcher = createReleaseLauncher({ exportsDirectory: exports.directory, run: neverRun });
  assert.deepEqual([launcher.build, launcher.windowed, launcher.selfCheck], ["release", true, "unsupported"]);
  assert.ok(launcher.name.includes(exports.directory), "the name says where the exports come from");
  const prepared = await launcher.prepare();
  assert.deepEqual(Object.keys(prepared), ["engine", "registered", "packages", "deviations"]);
  assert.equal(prepared.engine, exports.apps.C.executable);
  assert.deepEqual(prepared.deviations, []);
  const { registered } = prepared;
  assert.deepEqual(Object.keys(registered), ["seed", "replayGoldenHash", "soakFinalHash", "instrumentSha256", "arms"]);
  assert.equal(registered.seed, SEED);
  assert.equal(registered.replayGoldenHash, goldenReplayHash(root));
  assert.equal(registered.soakFinalHash, SOAK_FINAL_HASH);
  assert.equal(registered.instrumentSha256, sha256(readFileSync(path.join(root, INSTRUMENT_FILE))));
  for (const arm of ["A", "B", "C"]) {
    const manifest = await readManifest(exports, arm);
    assert.deepEqual(registered.arms[arm], { binarySha256: manifest.binarySha256, packageSha256: manifest.packageSha256, scriptSha256: manifest.scriptSha256 });
    assert.equal(registered.arms[arm].binarySha256, sha256(await readFile(exports.apps[arm].executable)));
    assert.equal(registered.arms[arm].packageSha256, sha256(await readFile(exports.apps[arm].pck)));
    assert.deepEqual(prepared.packages[arm], { exportBytes: manifest.exportBytes });
  }
  assert.equal(new Set(["A", "B", "C"].map((arm) => registered.arms[arm].binarySha256)).size, 3, "each arm has its own binary");
  assert.deepEqual(await exports.launches(), [], "prepare() starts nothing");
  await launcher.cleanup();
});

test("prepare() refuses, naming the arm and the file, when a manifest is missing, is wrong or does not match its file, and nothing runs", async () => {
  const refusals = [
    ["a manifest that is missing", async (e) => rm(e.apps.B.manifestFile), /arm B: .*frontier-comparison-export\.json is missing/],
    ["a manifest that is not JSON", async (e) => writeFile(e.apps.A.manifestFile, "{"), /arm A: .* is not JSON/],
    ["another format", async (e) => editManifest(e, "A", (m) => (m.format = "other/v1")), /arm A: .*format is "other\/v1"/],
    ["another arm", async (e) => editManifest(e, "B", (m) => (m.arm = "C")), /arm B: .*arm is "C", but this is the export of arm B/],
    ["export sizes that differ", async (e) => editManifest(e, "C", (m) => (m.exportBytes = [100, 101])), /arm C: .*exportBytes are 100 and 101/],
    ["a path with ..", async (e) => editManifest(e, "A", (m) => (m.pck = "../elsewhere/civ-a.pck")), /arm A: .*pck must be relative to the manifest's directory and have no "\.\."/],
    ["an executable whose hash is not the registered one", async (e) => appendFile(e.apps.B.executable, "// changed\n"), /arm B: the executable .*civ-b has the SHA-256 [0-9a-f]{64}, and the manifest registered [0-9a-f]{64}/],
    ["a package whose hash is not the registered one", async (e) => appendFile(e.apps.C.pck, "changed"), /arm C: the package .*civ-c\.pck has the SHA-256 [0-9a-f]{64}, and the manifest registered/],
    ["a package that is not there", async (e) => rm(e.apps.A.pck), /arm A: the package .*civ-a\.pck is not a file/],
    [
      "another instrument than the repository's",
      async (e) => editManifest(e, "B", (m) => {
        m.scriptFiles[INSTRUMENT_FILE] = sha256("another instrument");
        m.scriptSha256 = scriptsOf(m.scriptFiles).sha256;
      }),
      /arm B: the export carries another tests\/cpu-time-instrument\.gd than the repository's/,
    ],
  ];
  for (const [what, damage, pattern] of refusals) {
    const exports = await exportsIn();
    await damage(exports);
    const launcher = createReleaseLauncher({ exportsDirectory: exports.directory, run: neverRun });
    await assert.rejects(launcher.prepare(), (error) => pattern.test(error.message) && /^the Release exports in .* are refused:\n/.test(error.message), what);
    await assert.rejects(launcher.launch({ arm: "A", lane: "presented" }), /before prepare\(\)/, `${what}: nothing is registered, so nothing launches`);
    assert.deepEqual(await exports.launches(), [], what);
    await launcher.cleanup();
  }
  // The problems of every arm are in one message.
  const exports = await exportsIn();
  await rm(exports.apps.A.manifestFile);
  await editManifest(exports, "C", (m) => (m.exportBytes = [1, 2]));
  await assert.rejects(createReleaseLauncher({ exportsDirectory: exports.directory }).prepare(), (error) => /arm A: .*is missing/.test(error.message) && /arm C: .*exportBytes are 1 and 2/.test(error.message));
  assert.throws(() => createReleaseLauncher({}), /needs the directory of the exports: --exports <directory>/);
  assert.throws(() => createReleaseLauncher(), /needs the directory of the exports/);
});

test("launch() runs the executable of the arm with the scenario's arguments, with no -s and an absolute --out, in a directory outside the .app and the exports", async () => {
  const exports = await exportsIn();
  const seen = [];
  const launcher = createReleaseLauncher({
    exportsDirectory: exports.directory,
    run: (request) => {
      seen.push(request);
      return { result: { status: 0, signal: null }, log: "", load: { before: 0.5, after: 0.6 }, seconds: 1 };
    },
  });
  await launcher.prepare();
  await launcher.launch({ arm: "B", lane: "unlimited", slot: 2, attempt: 1 });
  assert.equal(seen.length, 1);
  const { executable, args, cwd, timeout } = seen[0];
  assert.equal(executable, exports.apps.B.executable);
  assert.equal(timeout, 1800000, "a process has a time limit");
  const out = args.find((argument) => argument.startsWith("--out="))?.slice("--out=".length);
  assert.deepEqual(args, ["--windowed", "--", "--arm=B", "--lane=unlimited", `--out=${out}`]);
  assert.ok(!args.includes("-s") && !args.includes("--script"), "a template discards -s: the scenario is the project's main loop");
  assert.ok(path.isAbsolute(out) && path.dirname(out) === cwd);
  for (const outside of [exports.apps.B.app, exports.directory]) {
    assert.ok(path.relative(outside, cwd).startsWith(".."), `the working directory is not inside ${outside}`);
    assert.ok(path.relative(outside, out).startsWith(".."), `the report is not written inside ${outside}`);
  }
  await launcher.cleanup();
});

test("a real process of the fake .app: the report is read, the launch has the interface's shape, and the working directory is the launcher's own", async () => {
  const exports = await exportsIn({ programs: { A: { exitCode: 0, log: "FRONTIER_COMPARISON_SCENARIO_DONE: arm A\n" } } });
  const launcher = createReleaseLauncher({ exportsDirectory: exports.directory });
  const prepared = await launcher.prepare();
  const launched = await launcher.launch({ arm: "A", lane: "presented", slot: 1, attempt: 1 });
  assert.deepEqual(Object.keys(launched), ["report", "exitCode", "signal", "timedOut", "log", "load", "hashes", "seconds"]);
  assert.deepEqual(launched.report, { format: "godot-fabric.frontier-comparison-scenario/v1", arm: "A", lane: "presented", fake: true });
  assert.deepEqual([launched.exitCode, launched.signal, launched.timedOut], [0, null, false]);
  assert.equal(launched.log, "FRONTIER_COMPARISON_SCENARIO_DONE: arm A\n");
  assert.deepEqual(Object.keys(launched.load), ["before", "after"]);
  assert.ok(launched.load.before > 0 || Number.isNaN(launched.load.before), "the load average is read (a machine without sysctl reads NaN)");
  assert.ok(Number.isFinite(launched.seconds) && launched.seconds >= 0);
  const { arms } = prepared.registered;
  assert.deepEqual(launched.hashes, { binary: arms.A.binarySha256, package: arms.A.packageSha256, script: arms.A.scriptSha256 });
  // What the process saw: the arguments after the executable, and a working directory that is neither in the .app nor in the exports.
  const [launch] = await exports.launches();
  assert.deepEqual(launch.arguments.slice(0, 4), ["--windowed", "--", "--arm=A", "--lane=presented"]);
  assert.match(launch.arguments[4], /^--out=\/.+run-A-presented\.json$/);
  for (const outside of [exports.apps.A.app, exports.directory]) {
    assert.ok(path.relative(await realpath(outside), launch.cwd).startsWith(".."), `the process ran outside ${outside}`);
  }
  // A second launch is another fresh process, in the same arm or another, and the report of the first is not carried over.
  const next = await launcher.launch({ arm: "C", lane: "presented", slot: 3, attempt: 1 });
  assert.equal(next.report.arm, "C");
  assert.equal((await exports.launches()).length, 2);
  await launcher.cleanup();
});

test("a process that exits with an error, writes no report or writes a report of its own is passed on as it came", async () => {
  const exports = await exportsIn({ programs: { A: { exitCode: 1, log: "SCRIPT ERROR: fake\n", report: null }, B: { report: { format: "other", anything: 1 } } } });
  const launcher = createReleaseLauncher({ exportsDirectory: exports.directory });
  await launcher.prepare();
  const failing = await launcher.launch({ arm: "A", lane: "presented" });
  assert.deepEqual([failing.report, failing.exitCode, failing.signal, failing.timedOut, failing.log], [null, 1, null, false, "SCRIPT ERROR: fake\n"]);
  assert.deepEqual((await launcher.launch({ arm: "B", lane: "presented" })).report, { format: "other", anything: 1 });
  await launcher.cleanup();
});

test("a process killed while it wrote its report leaves a file that is not JSON: no report, the file is kept, the log says where, and cleanup() leaves it", async () => {
  const truncated = '{"format":"godot-fabric.frontier-comparison-scenario/v1","frames":{"frame":[1,2';
  const exports = await exportsIn({ programs: { A: { rawReport: truncated, log: "FRONTIER_COMPARISON_SCENARIO_STARTED\n" } } });
  const launcher = createReleaseLauncher({ exportsDirectory: exports.directory });
  await launcher.prepare();
  let directory = null;
  try {
    for (const [index, kept] of [[1, "run-A-presented.unreadable.json"], [2, "run-A-presented.unreadable-2.json"]]) {
      const launched = await launcher.launch({ arm: "A", lane: "presented", attempt: index });
      assert.deepEqual([launched.report, launched.exitCode, launched.signal, launched.timedOut], [null, 0, null, false]);
      const out = (await exports.launches())[index - 1].arguments[4].slice("--out=".length);
      directory = path.dirname(out);
      const says = `FRONTIER_COMPARISON_SCENARIO_STARTED\nFRONTIER_COMPARISON_REPORT_UNREADABLE: ${path.join(directory, kept)} (`;
      assert.ok(launched.log.startsWith(says) && launched.log.endsWith(")\n"), launched.log);
      assert.equal(await readFile(path.join(directory, kept), "utf8"), truncated, "the file is kept, and the second one does not overwrite the first");
      assert.ok(!(await exists(out)), "it is not left under the name of a report");
    }
    // The other arms are not disturbed, and a report that is readable is still read.
    assert.equal((await launcher.launch({ arm: "B", lane: "presented" })).report.arm, "B");
    await launcher.cleanup();
    assert.ok(await exists(path.join(directory, "run-A-presented.unreadable.json")), "the directory that holds raw data stays after cleanup()");
  } finally {
    if (directory !== null) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("a file that changed between prepare() and launch() makes launch() throw, and the process is not started", async () => {
  for (const [what, damage, pattern] of [
    ["the executable", (e) => appendFile(e.apps.B.executable, "// swapped\n"), /arm B: the executable .* has the SHA-256/],
    ["the package", (e) => appendFile(e.apps.B.pck, "swapped"), /arm B: the package .* has the SHA-256/],
    ["the package, deleted", (e) => rm(e.apps.B.pck), /arm B: the package .* is not a file/],
  ]) {
    const exports = await exportsIn();
    const launcher = createReleaseLauncher({ exportsDirectory: exports.directory });
    await launcher.prepare();
    await launcher.launch({ arm: "A", lane: "presented" });
    await damage(exports);
    await assert.rejects(launcher.launch({ arm: "B", lane: "presented" }), (error) => /is not the one that was registered, so nothing runs/.test(error.message) && pattern.test(error.message), what);
    assert.equal((await exports.launches()).length, 1, `${what}: only the launch before the change ran`);
    // The other arms are still the registered ones.
    assert.equal((await launcher.launch({ arm: "C", lane: "presented" })).exitCode, 0);
    await launcher.cleanup();
  }
});

test("a process that outlives the launcher's timeout is killed and is reported as timed out, and only then", async () => {
  const exports = await exportsIn({ programs: { A: { sleepMs: 60000 } } });
  // The short timeout is only for the process that sleeps 60 s (it is killed whatever the machine's pace is); a process that has to finish runs under a launcher with a limit that load cannot reach.
  const launcher = createReleaseLauncher({ exportsDirectory: exports.directory, timeout: 700 });
  await launcher.prepare();
  const killed = await launcher.launch({ arm: "A", lane: "presented" });
  assert.deepEqual([killed.timedOut, killed.signal, killed.exitCode, killed.report], [true, "SIGTERM", -1, null]);
  assert.ok(killed.seconds < 30, "the launcher did not wait for the process");
  const patient = createReleaseLauncher({ exportsDirectory: exports.directory, timeout: 600000 });
  await patient.prepare();
  const normal = await patient.launch({ arm: "B", lane: "presented" });
  assert.deepEqual([normal.timedOut, normal.signal, normal.exitCode], [false, null, 0]);
  // A launch whose spawn failed for another reason did not time out.
  const failed = createReleaseLauncher({ exportsDirectory: exports.directory, run: () => ({ result: { status: null, signal: null, error: { code: "EACCES" } }, log: "", load: { before: 1, after: 1 }, seconds: 0 }) });
  await failed.prepare();
  assert.deepEqual([(await failed.launch({ arm: "A", lane: "presented" })).timedOut, (await failed.launch({ arm: "A", lane: "presented" })).exitCode], [false, -1]);
  await launcher.cleanup();
  await patient.cleanup();
  await failed.cleanup();
});

test("cleanup() removes the launcher's own directory and nothing of the exports", async () => {
  const exports = await exportsIn();
  const seen = [];
  const launcher = createReleaseLauncher({
    exportsDirectory: exports.directory,
    run: (request) => {
      seen.push(request);
      return { result: { status: 0, signal: null }, log: "", load: { before: 1, after: 1 }, seconds: 0 };
    },
  });
  await launcher.cleanup();
  await launcher.prepare();
  await launcher.launch({ arm: "A", lane: "presented" });
  assert.ok(await exists(seen[0].cwd), "the launcher's directory is there while it runs");
  const before = await Promise.all(["A", "B", "C"].map(async (arm) => hashesOf({ executable: exports.apps[arm].executable, pck: exports.apps[arm].pck })));
  await launcher.cleanup();
  await launcher.cleanup();
  assert.ok(!(await exists(seen[0].cwd)), "the launcher's directory is gone");
  for (const [index, arm] of ["A", "B", "C"].entries()) {
    assert.deepEqual(await hashesOf({ executable: exports.apps[arm].executable, pck: exports.apps[arm].pck }), before[index]);
    assert.ok(await exists(exports.apps[arm].manifestFile));
  }
  assert.deepEqual((await readExports(exports.directory)).A.manifest, await readManifest(exports, "A"));
});

test("the campaign reads and validates the exports, then refuses because the instrument's self-check cannot run in a template, before anything is launched or written", async () => {
  const exports = await exportsIn();
  const out = path.join(scratch, "campaign-out");
  const lockFile = path.join(scratch, "campaign.lock");
  const launcher = createReleaseLauncher({ exportsDirectory: exports.directory });
  let prepared = 0;
  const prepare = launcher.prepare;
  launcher.prepare = async () => {
    prepared += 1;
    return prepare();
  };
  let checked = 0;
  await assert.rejects(
    runCampaign({ launcher, protocol, protocolSha256: sha256(protocolBytes), out, lanes: ["presented"], lockFile, runCheck: async () => (checked += 1) }),
    (error) => error.message === RELEASE_SELF_CHECK_REFUSAL,
  );
  assert.equal(prepared, 1, "the exports were read and validated first");
  assert.equal(checked, 0, "the self-check was not even tried");
  assert.deepEqual(await exports.launches(), [], "no process was launched");
  assert.ok(!(await exists(out)), "no directory was created");
  assert.ok(!(await exists(lockFile)), "the lock the refusal took was released");
  assert.match(RELEASE_SELF_CHECK_REFUSAL, /read and validated/);
  assert.match(RELEASE_SELF_CHECK_REFUSAL, /self-check of the instrument in a template/);
  assert.match(RELEASE_SELF_CHECK_REFUSAL, /`-s`/);
  assert.match(RELEASE_SELF_CHECK_REFUSAL, /Nothing was run and no campaign directory was made/);
  // With manifests that are wrong the refusal is the exports', and still nothing runs.
  await rm(exports.apps.B.manifestFile);
  await assert.rejects(runCampaign({ launcher: createReleaseLauncher({ exportsDirectory: exports.directory }), protocol, protocolSha256: sha256(protocolBytes), out, lanes: ["presented"], lockFile }), /arm B: .*is missing/);
  assert.ok(!(await exists(out)));
});

test("the command line: --build release needs --exports, which a Debug rehearsal does not take, and the campaign refuses with the self-check's reason and runs nothing", async () => {
  const ok = (...argv) => parseArguments(["--campaign", ...argv], protocol);
  assert.equal(ok("--build", "release", "--out", "/tmp/campaign", "--exports", "/tmp/exports").exports, "/tmp/exports");
  assert.equal(path.isAbsolute(ok("--build", "release", "--out", "x", "--exports", "exports").exports), true);
  assert.equal(ok("--build", "debug", "--rehearsal", "--out", "x").exports, null);
  assert.throws(() => ok("--build", "release", "--out", "x"), /--build release needs --exports <directory>/);
  assert.throws(() => ok("--build", "debug", "--rehearsal", "--out", "x", "--exports", "e"), /--exports is for --build release/);
  assert.throws(() => ok("--build", "release", "--out", "x", "--exports"), /--exports takes a value/);

  const exports = await exportsIn();
  const out = path.join(scratch, "cli-out");
  // The command line takes the lock in the system's temporary directory: a private one keeps this test from meeting a campaign that is really running.
  const run = (...argv) => spawnSync(process.execPath, [campaignScript, "--campaign", "--lanes", "presented,unlimited", "--build", "release", "--out", out, ...argv], { encoding: "utf8", env: { ...process.env, TMPDIR: scratch } });
  const refused = run("--exports", exports.directory);
  assert.equal(refused.status, 1);
  assert.ok(refused.stderr.includes(RELEASE_SELF_CHECK_REFUSAL), refused.stderr);
  assert.deepEqual(await exports.launches(), [], "no process was launched");
  assert.ok(!(await exists(out)), "no campaign directory was made");
  const without = run();
  assert.equal(without.status, 1);
  assert.match(without.stderr, /--build release needs --exports/);
  await rm(exports.apps.C.manifestFile);
  const missing = run("--exports", exports.directory);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /arm C: .*frontier-comparison-export\.json is missing/);
  assert.ok(!(await exists(out)));
});
