import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {GOLDEN_HASH, TRACE_HASH} from "../scripts/macos-export-civ-lite.mjs";
import {NEGATIVES, RECORD_FORMAT, RUNS, SCRUBBED_PATH, assertProfileAbsent, cleanRun, compareMachines, dirtyProfileControl, flipByte, flipHash, hashApp, isAdHoc, judgeArchiveListing,
  judgeCleanReplay, judgeCleanRun, judgeLoads, observeAbsences, observeReplay, parseArguments, parseDylibList, parseHardware, parseRpaths, profilePath, resolveMode,
  runRow, scrubbedEnvironment, usage, wrongPinControl} from "../scripts/macos-clean-run.mjs";
import {parseRoteiro} from "./macos-export-civ-lite-oracle.mjs";

// The template-free half of the clean-machine lane (scripts/macos-clean-run.mjs): the verdict of a run on another machine, and the rejection of each thing that would make
// it wrong, from observations made up here. It never skips and runs no Godot, no codesign and no otool, so it also runs on the Linux job of Contracts; the run that matters
// is the `macos-clean-run` job, on a hosted macOS runner.
const root = fileURLToPath(new URL("..", import.meta.url));
const read = file => readFile(path.join(root, file), "utf8");
const sha256 = value => createHash("sha256").update(value).digest("hex");
const roteiro = parseRoteiro(await read("consumers/civ-lite/game/replay.gd"));
const clone = value => structuredClone(value);

const PROJECT = "Frontier Export 1-2-abc";
const HOME = "/home/runner";
const EXECUTABLE = `/var/folders/xx/T/frontier-clean-run-a/unpacked/Frontier.app/Contents/MacOS/${PROJECT}`;
const PROFILE = profilePath(HOME, PROJECT);
const BUNDLE_SHA256 = sha256("bundle");
const IDENTIFIER = "org.journeystudios.godotfabric.frontier";

// A replay report that is consistent with itself and with the roteiro, with hashes of its own: the pins it is judged against are the ones it makes.
function genuineReport() {
  const finalSerialization = JSON.stringify({seed: 4242, turn: 13});
  const hashes = roteiro.map((_, index) => sha256(`state ${index}`));
  hashes[hashes.length - 1] = sha256(finalSerialization);
  const steps = roteiro.map((step, index) => ({index, label: step.label, intent: step.intent, args: step.args, ok: step.code === "ok" ? 1 : 0, code: step.code,
    context: step.context, turn: 1, hash: hashes[index]}));
  return {schemaVersion: 1, scenario: "civ-lite-replay", seed: 4242, stepCount: steps.length, acceptedTurns: 12, steps, goldenHash: hashes.at(-1),
    traceHash: sha256(hashes.join("\n")), finalSerialization, checks: [{name: "a", passed: true}], allPassed: true,
    project: PROJECT, executable: EXECUTABLE, userDataDir: PROFILE, userEntriesAtStart: ["logs"], displayServer: "headless",
    features: {template: true, release: true, debug: false, editor: false}};
}
const base = genuineReport();
const expected = {goldenHash: base.goldenHash, traceHash: base.traceHash};
const context = {expected, roteiro, projectName: PROJECT, executable: EXECUTABLE};

function genuineObservation(label = "replay-clean-1") {
  return {label, status: 0, signal: null, report: clone(base), reportSha256: sha256(label), environment: scrubbedEnvironment({home: HOME, user: "runner", tmpdir: "/var/folders/xx/T"}),
    log: `Godot Engine\nCIVLITE_REPLAY_HASHES: golden=${base.goldenHash} trace=${base.traceHash}\nCIVLITE_REPLAY_PASSED: 246\n`,
    profile: {path: PROFILE, existedBefore: false, entriesAfter: ["civ-lite-replay-report.json", "logs"], removedAfter: true}, command: []};
}

test("the pins and the hash of a bundle are the lane's", async () => {
  assert.match(GOLDEN_HASH, /^[0-9a-f]{64}$/);
  for (const hash of [GOLDEN_HASH, TRACE_HASH, "0".repeat(64)]) {
    assert.match(flipHash(hash), /^[0-9a-f]{64}$/);
    assert.notEqual(flipHash(hash), hash);
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), "macos-clean-run-hash-"));
  try {
    const app = path.join(directory, "Frontier.app");
    await mkdir(path.join(app, "Contents", "Frameworks"), {recursive: true});
    await writeFile(path.join(app, "Contents", "Info.plist"), "plist");
    await writeFile(path.join(app, "Contents", "Frameworks", "lib"), "library");
    await symlink("lib", path.join(app, "Contents", "Frameworks", "Current"));
    // scripts/macos-export.mjs hashApp: the SHA-256 of the JSON rows of the tree in name order, a file by its hash and a symlink by its target.
    const rows = [{path: "Contents/Frameworks/Current", link: "lib"}, {path: "Contents/Frameworks/lib", sha256: sha256("library")}, {path: "Contents/Info.plist", sha256: sha256("plist")}];
    assert.equal(await hashApp(app), sha256(JSON.stringify(rows)));
    await flipByte(path.join(app, "Contents", "Frameworks", "lib"), 3);
    assert.notEqual(await hashApp(app), sha256(JSON.stringify(rows)));
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("a replay in a clean profile is accepted, and each thing that makes it wrong is rejected", () => {
  assert.deepEqual(judgeCleanReplay(genuineObservation(), context), []);
  const reject = (change, pattern, against = context) => {
    const observation = genuineObservation();
    change(observation);
    assert.match(judgeCleanReplay(observation, against).join("\n"), pattern);
  };
  // The hashes the run reached are not the pinned ones.
  reject(() => {}, /differs from the pinned/, {...context, expected: {goldenHash: flipHash(expected.goldenHash), traceHash: expected.traceHash}});
  reject(() => {}, /differs from the pinned/, {...context, expected: {goldenHash: expected.goldenHash, traceHash: flipHash(expected.traceHash)}});
  reject(() => {}, /is not the pinned/, {...context, expected: {goldenHash: GOLDEN_HASH, traceHash: TRACE_HASH}});
  reject(observation => { observation.report.steps[40].hash = sha256("another state"); }, /trace hash/);
  // The markers.
  reject(observation => { observation.log = observation.log.replace(/^CIVLITE_REPLAY_PASSED: \d+$/m, ""); }, /printed no CIVLITE_REPLAY_PASSED marker/);
  reject(observation => { observation.log = observation.log.replace(/^CIVLITE_REPLAY_HASHES: .*$/m, ""); }, /hashes it printed are not the report's/);
  reject(observation => { observation.log += "ERROR: something broke\n"; }, /engine, script or check error/);
  reject(observation => { observation.status = 1; }, /exited with status 1/);
  reject(observation => { observation.report = null; observation.reportSha256 = null; }, /wrote no report/);
  // The profile.
  reject(observation => { observation.profile.existedBefore = true; }, /profile was not clean before/);
  reject(observation => { observation.profile.removedAfter = false; }, /profile was not clean before and removed after/);
  reject(observation => { observation.report.userEntriesAtStart = ["civ-lite-replay-report.json"]; }, /already held a replay report/);
  reject(observation => { observation.report.userDataDir = "/home/runner/elsewhere"; }, /wrote its report to/);
  // What only this machine can say.
  reject(observation => { observation.report.project = "Frontier Export 9-9-zzz"; }, /was of the project Frontier Export 9-9-zzz/);
  reject(observation => { observation.report.executable = "/home/runner/work/Frontier.app/Contents/MacOS/Frontier"; }, /not the unpacked app's/);
  reject(observation => { observation.report.features = {template: false, release: false, debug: true, editor: true}; }, /engine features/);
  reject(observation => { observation.report.displayServer = "macOS"; }, /not headless/);
  reject(observation => { observation.environment.NODE_OPTIONS = "--inspect"; }, /environment was not the scrubbed one/);
  reject(observation => { observation.environment.PATH = `/opt/homebrew/bin:${SCRUBBED_PATH}`; }, /environment was not the scrubbed one/);
  reject(observation => { delete observation.environment.USER; }, /environment was not the scrubbed one/);
});

test("the wrong-pin control rejects a run against a golden hash that is not the pinned one, and says nothing when the run was wrong to begin with", () => {
  const control = wrongPinControl(genuineObservation(), context);
  assert.equal(control.rejected, true);
  assert.equal(control.baselineProblems, 0);
  assert.match(control.firstProblem, /differs from the pinned/);
  const broken = genuineObservation();
  broken.profile.existedBefore = true;
  assert.equal(wrongPinControl(broken, context).rejected, false);
});

function genuineObserved({hosted = true} = {}) {
  const runs = Array.from({length: RUNS}, (_, index) => {
    const observation = genuineObservation(`replay-clean-${index + 1}`);
    return runRow(observation, judgeCleanReplay(observation, context));
  });
  const record = {format: RECORD_FORMAT, sourceCommit: "a".repeat(40), archive: {sha256: sha256("archive")},
    app: {bundleSha256: BUNDLE_SHA256, executableName: PROJECT, projectName: PROJECT, pckSha256: sha256("pck")}, pins: clone(expected),
    uploader: {runnerName: "GitHub Actions 1000000001", hardware: {hardwareUuidSha256: sha256("uuid-a")}}};
  const verified = [".", `Contents/MacOS/${PROJECT}`, "Contents/Frameworks/fabric_godot.dylib"].map(item => ({item, status: 0}));
  return {hosted, expected, record, sourceCommit: record.sourceCommit, architecture: "arm64", archive: {sha256: record.archive.sha256},
    bundle: {sha256: BUNDLE_SHA256, afterRunsSha256: BUNDLE_SHA256, executableName: PROJECT, bundleIdentifier: IDENTIFIER, pckSha256: record.app.pckSha256, projectNameInPck: true,
      architectures: ["arm64"]},
    outsideWorkspace: true, signature: {checks: verified, afterRunsChecks: clone(verified), adhoc: true},
    loads: ["MacOS/app", "Frameworks/fabric_godot.dylib", "hermesvm", "ReactNativeDependencies"].map(binary => ({binary, loads: ["@rpath/x", "/usr/lib/libc++.1.dylib", "/System/Library/Frameworks/Foundation.framework/Versions/C/Foundation"],
      rpaths: ["@loader_path/frameworks"]})),
    scrubbedPathFinds: [], absences: {checked: ["command -v godot"], found: []}, machine: {runnerName: "GitHub Actions 1000000002", runnerArch: "ARM64"}, runs,
    negatives: Object.fromEntries(NEGATIVES.map(name => [name, {rejected: true}]))};
}

test("a clean run on another machine is accepted, and each assertion of the lane rejects what breaks it", () => {
  assert.deepEqual(judgeCleanRun(genuineObserved()), []);
  const reject = (change, pattern) => {
    const observed = genuineObserved();
    change(observed);
    assert.match(judgeCleanRun(observed).join("\n"), pattern);
  };
  // What was shipped.
  reject(observed => { observed.archive.sha256 = sha256("another archive"); }, /archive's SHA-256/);
  reject(observed => { observed.bundle.sha256 = sha256("another bundle"); }, /unpacked bundle's hash/);
  reject(observed => { observed.bundle.afterRunsSha256 = sha256("changed by the runs"); }, /running the app changed its bytes/);
  reject(observed => { observed.bundle.pckSha256 = sha256("another pck"); }, /PCK is not the uploader's/);
  reject(observed => { observed.bundle.projectNameInPck = false; }, /PCK is not the uploader's/);
  reject(observed => { observed.bundle.bundleIdentifier = "com.example.other"; }, /not Frontier's/);
  reject(observed => { observed.bundle.architectures = ["x86_64"]; }, /no arm64 slice/);
  reject(observed => { observed.record.pins.goldenHash = flipHash(expected.goldenHash); }, /pins the uploader recorded/);
  reject(observed => { observed.record.format = "other"; }, /record is not the uploader's/);
  reject(observed => { delete observed.record.app; }, /record is not the uploader's/);
  reject(observed => { observed.sourceCommit = "b".repeat(40); }, /this checkout is/);
  reject(observed => { observed.outsideWorkspace = false; }, /outside the workspace/);
  // The signature and the load commands.
  reject(observed => { observed.signature.checks[1].status = 1; }, /did not verify every signed item/);
  reject(observed => { observed.signature.afterRunsChecks[0].status = 3; }, /did not verify every signed item/);
  reject(observed => { observed.signature.adhoc = false; }, /not ad hoc/);
  reject(observed => { observed.loads[1].loads.push("/home/someone/build/libhermes.dylib"); }, /libhermes.dylib, which is not the bundle's or the system's/);
  reject(observed => { observed.loads[2].rpaths.push("/opt/homebrew/lib"); }, /\/opt\/homebrew\/lib/);
  reject(observed => { observed.loads.pop(); }, /3 binaries had their load commands read/);
  reject(observed => { observed.scrubbedPathFinds = ["/usr/bin/node"]; }, /scrubbed PATH finds \/usr\/bin\/node/);
  // The machine.
  reject(observed => { observed.absences.found = ["command -v godot: /usr/local/bin/godot"]; }, /this machine is not clean: command -v godot/);
  reject(observed => { observed.absences = undefined; }, /this machine is not clean/);
  reject(observed => { observed.machine.runnerName = observed.record.uploader.runnerName; }, /is not another machine/);
  reject(observed => { observed.machine.runnerName = null; }, /is not another machine/);
  reject(observed => { observed.architecture = "x64"; }, /not arm64/);
  // The replays.
  reject(observed => { observed.runs.pop(); }, /2 replays ran, not 3/);
  reject(observed => { observed.runs[1].problems = ["replay-clean-2: its golden hash differs from the pinned"]; }, /replay-clean-2: its golden hash/);
  reject(observed => { observed.runs[2].statesSha256 = sha256("other states"); }, /did not play the same states/);
  reject(observed => { observed.runs[0].statesSha256 = null; }, /did not play the same states/);
  reject(observed => { observed.error = "tar: Error opening archive"; }, /stopped before it was judged: tar/);
  // The negatives: a run with one of them missing, or not rejected, could pass without the judge or the signature check biting.
  for (const name of NEGATIVES) {
    reject(observed => { delete observed.negatives[name]; }, new RegExp(`negative control ${name} did not reject`));
    reject(observed => { observed.negatives[name].rejected = false; }, new RegExp(`negative control ${name} did not reject`));
  }
});

test("a rehearsal relaxes the assertions only a clean machine can meet, and nothing else", () => {
  const rehearsal = genuineObserved({hosted: false});
  rehearsal.absences.found = ["/Applications/Godot.app", "/home/dev/.deps"];
  rehearsal.machine.runnerName = rehearsal.record.uploader.runnerName;
  rehearsal.sourceCommit = "b".repeat(40);
  assert.deepEqual(judgeCleanRun(rehearsal), []);
  const hosted = {...clone(rehearsal), hosted: true};
  assert.match(judgeCleanRun(hosted).join("\n"), /this machine is not clean/);
  rehearsal.bundle.sha256 = sha256("another bundle");
  assert.match(judgeCleanRun(rehearsal).join("\n"), /unpacked bundle's hash/);
  const unrejected = genuineObserved({hosted: false});
  unrejected.negatives.tamperedCopy.rejected = false;
  assert.match(judgeCleanRun(unrejected).join("\n"), /negative control tamperedCopy did not reject/);
});

test("the hosted mode is refused off GitHub Actions, and --local is refused on it", () => {
  assert.deepEqual(resolveMode({local: false, env: {GITHUB_ACTIONS: "true"}}), {hosted: true});
  assert.deepEqual(resolveMode({local: true, env: {}}), {hosted: false});
  assert.throws(() => resolveMode({local: false, env: {}}), /pass --local to rehearse/);
  assert.throws(() => resolveMode({local: true, env: {GITHUB_ACTIONS: "true"}}), /refused on GitHub Actions/);
});

test("the command line refuses what it should before it unpacks anything", () => {
  const run = ["run", "--archive", "a.tar.gz", "--record", "r.json", "--out", "o"];
  const parsed = parseArguments(run);
  assert.equal(parsed.command, "run");
  assert.equal(parsed.options.get("--archive"), path.resolve("a.tar.gz"));
  assert.equal(parsed.options.has("--local"), false);
  assert.equal(parseArguments([...run, "--local"]).options.get("--local"), true);
  assert.equal(parseArguments(["pack", "--app", "A.app", "--lane-report", "r.json", "--out", "o"]).command, "pack");
  for (const argv of [[], ["unpack"], ["run"], ["run", "--archive", "a", "--record", "r"], [...run, "--bogus"], [...run, "--local", "--local"], [...run, "--out", "p"],
    ["run", "--archive", "--record", "r", "--out", "o"], ["pack", "--app", "A.app", "--lane-report", "r.json", "--out", "o", "--local"]]) {
    assert.throws(() => parseArguments(argv), /Usage:/, argv.join(" "));
  }
  assert.match(usage(), /claims nothing/);
});

test("the load commands, the signature and the archive listing are judged as the lane judges them", () => {
  const listed = "/path/hermesvm:\n\t@rpath/hermesvm.framework/Versions/1/hermesvm (compatibility version 0.0.0, current version 0.0.0)\n\t/usr/lib/libc++.1.dylib (compatibility version 1.0.0)\n";
  assert.deepEqual(parseDylibList(listed), ["@rpath/hermesvm.framework/Versions/1/hermesvm", "/usr/lib/libc++.1.dylib"]);
  const commands = "Load command 14\n          cmd LC_RPATH\n      cmdsize 32\n         path @loader_path/frameworks (offset 12)\nLoad command 15\n          cmd LC_ID_DYLIB\n         name x (offset 24)\n";
  assert.deepEqual(parseRpaths(commands), ["@loader_path/frameworks"]);
  assert.deepEqual(judgeLoads([{binary: "host", loads: parseDylibList(listed), rpaths: parseRpaths(commands)}]), []);
  assert.match(judgeLoads([{binary: "host", loads: ["/opt/homebrew/lib/libz.dylib"], rpaths: []}]).join("\n"), /host names \/opt\/homebrew\/lib\/libz.dylib/);
  assert.match(judgeLoads([{binary: "host", loads: [], rpaths: ["/home/runner/work/godot-fabric/.deps/build"]}]).join("\n"), /\.deps\/build/);

  assert.equal(isAdHoc("Identifier=x\nSignature=adhoc\nTeamIdentifier=not set\n"), true);
  assert.equal(isAdHoc("Identifier=x\nAuthority=Developer ID Application: Someone\nTeamIdentifier=ABCDE12345\n"), false);
  assert.equal(isAdHoc("Identifier=x\nSignature size=9000\nAuthority=Apple Development: Someone\n"), false);

  const listing = ["Frontier.app/", "Frontier.app/Contents/", "Frontier.app/Contents/Info.plist", "._Frontier.app", ""].join("\n");
  assert.deepEqual(judgeArchiveListing(listing), []);
  assert.match(judgeArchiveListing(`${listing}/etc/passwd\n`).join("\n"), /holds \/etc\/passwd/);
  assert.match(judgeArchiveListing(`${listing}Frontier.app/../../x\n`).join("\n"), /holds Frontier.app\/\.\.\/\.\.\/x/);
  assert.match(judgeArchiveListing(`${listing}Other.app/Contents/Info.plist\n`).join("\n"), /holds Other.app/);
  assert.match(judgeArchiveListing("Frontier.app/\n").join("\n"), /no Frontier.app\/Contents\/Info.plist/);
});

test("the serial and the UUIDs of a machine are hashed and never printed, and two machines are told apart", () => {
  const output = "Hardware:\n\n    Hardware Overview:\n\n      Model Name: Mac mini\n      Model Identifier: Mac16,10\n      Chip: Apple M4\n      Memory: 16 GB\n"
    + "      Serial Number (system): SERIAL12345\n      Hardware UUID: 11111111-2222-3333-4444-555555555555\n      Provisioning UDID: 00006030-AAAAAAAAAAAAAAAA\n";
  const hardware = parseHardware(output);
  assert.equal(hardware.modelName, "Mac mini");
  assert.equal(hardware.chip, "Apple M4");
  assert.equal(hardware.serialSha256, sha256("SERIAL12345"));
  assert.equal(hardware.hardwareUuidSha256, sha256("11111111-2222-3333-4444-555555555555"));
  const printed = JSON.stringify(hardware);
  for (const secret of ["SERIAL12345", "11111111-2222-3333-4444-555555555555", "00006030-AAAAAAAAAAAAAAAA"]) {
    assert.equal(printed.includes(secret), false, `${secret} is printed`);
  }
  assert.deepEqual(parseHardware("nothing useful here").serialSha256, null);
  const here = {runnerName: "GitHub Actions 1", bootTimeSec: 10, hostnameSha256: "a", hardware};
  assert.deepEqual(compareMachines(here, {...here, runnerName: "GitHub Actions 2", bootTimeSec: 99, hostnameSha256: "b", hardware: {hardwareUuidSha256: "other"}}),
    {sameRunnerName: false, sameBootTime: false, sameHostname: false, sameHardwareUuid: false});
  assert.equal(compareMachines(here, here).sameRunnerName, true);
});

test("a machine with a Godot on its PATH, a Godot.app, Godot's data or the workspace's .deps is not clean", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "macos-clean-run-absences-"));
  try {
    const home = path.join(directory, "home");
    const workspace = path.join(directory, "workspace");
    const applications = path.join(directory, "Applications");
    const bin = path.join(directory, "bin");
    await Promise.all([home, workspace, applications, bin].map(directory => mkdir(directory, {recursive: true})));
    const env = {PATH: `${bin}:${SCRUBBED_PATH}`};
    const clean = await observeAbsences({env, workspace, home, applications});
    assert.deepEqual(clean.found, []);
    assert.ok(clean.checked.length >= 6);
    await writeFile(path.join(bin, "godot"), "#!/bin/sh\n");
    await chmod(path.join(bin, "godot"), 0o755);
    await mkdir(path.join(applications, "Godot_mono.app"));
    await mkdir(path.join(home, "Library", "Application Support", "Godot"), {recursive: true});
    await Promise.all([".deps", "node_modules", ".godot"].map(name => mkdir(path.join(workspace, name))));
    const found = (await observeAbsences({env, workspace, home, applications})).found;
    assert.equal(found.length, 6, found.join("\n"));
    assert.ok(found[0].startsWith(`command -v godot: ${bin}`));
    for (const wanted of [path.join(applications, "Godot_mono.app"), path.join(home, "Library", "Application Support", "Godot"), path.join(workspace, ".deps"),
      path.join(workspace, "node_modules"), path.join(workspace, ".godot")]) {
      assert.ok(found.includes(wanted), `${wanted} was found`);
    }
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("a profile that exists before a run stops it, and the control that proves it leaves nothing behind", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "macos-clean-run-profile-"));
  try {
    const control = await dirtyProfileControl({home: directory, projectName: PROJECT});
    assert.equal(control.rejected, true);
    assert.match(control.refusal, /exists before the run/);
    await assertProfileAbsent(profilePath(directory, PROJECT), "after the control");
    assert.throws(() => profilePath(directory, "Frontier"), /not an export's own/);
    assert.throws(() => profilePath(directory, `Frontier Export ../${PROJECT}`), /not an export's own/);
    await mkdir(profilePath(directory, PROJECT), {recursive: true});
    await assert.rejects(dirtyProfileControl({home: directory, projectName: PROJECT}), /exists before the run/);
    await rm(profilePath(directory, PROJECT), {recursive: true});
    await writeFile(path.join(directory, "pck"), "0123456789");
    await flipByte(path.join(directory, "pck"), 4);
    assert.deepEqual([...(await readFile(path.join(directory, "pck")))], [48, 49, 50, 51, 203, 53, 54, 55, 56, 57]);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test("an app is started with env -i and four variables in a profile that did not exist, and the profile is gone after the report is kept", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "macos-clean-run-app-"));
  process.env.FRONTIER_CLEAN_RUN_SENTINEL = "leaked";
  try {
    const home = path.join(directory, "home");
    const out = path.join(directory, "out");
    const cwd = path.join(directory, "cwd");
    await Promise.all([home, out, cwd].map(each => mkdir(each, {recursive: true})));
    const userData = profilePath(home, PROJECT);
    const executable = path.join(directory, "Frontier.app", "Contents", "MacOS", PROJECT);
    await mkdir(path.dirname(executable), {recursive: true});
    const fixture = path.join(directory, "fixture.json");
    const fixtureReport = {...clone(base), executable, userDataDir: userData};
    await writeFile(fixture, JSON.stringify(fixtureReport));
    const dump = path.join(directory, "environment.txt");
    // A stand-in for the exported app: it writes the report where Godot would, prints the markers and dumps what it was given. It is a shell script, not a game.
    await writeFile(executable, `#!/bin/sh
profile="$HOME/Library/Application Support/Godot/app_userdata/${PROJECT}"
mkdir -p "$profile/logs"
cp '${fixture}' "$profile/civ-lite-replay-report.json"
env > '${dump}'
pwd >> '${dump}'
echo "CIVLITE_REPLAY_HASHES: golden=${base.goldenHash} trace=${base.traceHash}"
echo "CIVLITE_REPLAY_PASSED: 246"
`);
    await chmod(executable, 0o755);
    const parameters = {label: "replay-clean-1", executable, cwd, home, user: "runner", tmpdir: "/var/folders/xx/T", projectName: PROJECT, outDir: out};
    const observation = await observeReplay(parameters);
    assert.equal(observation.status, 0);
    assert.deepEqual(observation.profile, {path: userData, existedBefore: false, entriesAfter: ["civ-lite-replay-report.json", "logs"], removedAfter: true});
    assert.deepEqual(judgeCleanReplay(observation, {...context, executable}), []);
    await assert.rejects(readFile(path.join(userData, "civ-lite-replay-report.json")), {code: "ENOENT"});
    assert.deepEqual(JSON.parse(await readFile(path.join(out, "replay-clean-1.json"), "utf8")), fixtureReport);
    assert.equal(await readFile(path.join(out, "replay-clean-1.json"), "utf8"), await readFile(fixture, "utf8"));
    assert.match(await readFile(path.join(out, "replay-clean-1.log"), "utf8"), /CIVLITE_REPLAY_PASSED: 246/);
    assert.deepEqual(observation.command.slice(0, 2), ["/usr/bin/env", "-i"]);

    const variables = (await readFile(dump, "utf8")).split("\n").filter(line => /^[A-Za-z_]+=/.test(line));
    const given = Object.fromEntries(variables.map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
    // A shell adds its own PWD, SHLVL, OLDPWD and _ ; nothing of this process's environment, and none of the sentinel, may reach the app.
    assert.deepEqual(Object.keys(given).filter(key => !["PWD", "OLDPWD", "SHLVL", "_"].includes(key)).sort(), ["HOME", "PATH", "TMPDIR", "USER"]);
    assert.deepEqual({HOME: given.HOME, PATH: given.PATH, TMPDIR: given.TMPDIR, USER: given.USER}, {HOME: home, PATH: SCRUBBED_PATH, TMPDIR: "/var/folders/xx/T", USER: "runner"});
    assert.equal((await readFile(dump, "utf8")).includes("leaked"), false);
    assert.equal((await readFile(dump, "utf8")).trim().split("\n").at(-1), await realpath(cwd));

    // A profile left behind by anything else stops the run before the app is started.
    await rm(dump);
    await mkdir(userData, {recursive: true});
    await assert.rejects(observeReplay(parameters), /the user profile .* exists before the run/);
    await assert.rejects(readFile(dump), {code: "ENOENT"}, "the app was started in a profile that was not clean");
  } finally {
    delete process.env.FRONTIER_CLEAN_RUN_SENTINEL;
    await rm(directory, {recursive: true, force: true});
  }
});

test("a record that cannot be read leaves a failed summary and no run, and a non-empty output directory is refused before anything is written", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "macos-clean-run-summary-"));
  try {
    const archive = path.join(directory, "Frontier.app.tar.gz");
    const broken = async (name, text) => {
      const recordPath = path.join(directory, `${name}.json`);
      if (text !== null) {
        await writeFile(recordPath, text);
      }
      const out = path.join(directory, `out-${name}`);
      // --local with no GITHUB_ACTIONS in the environment: the mode is the rehearsal's, whatever job runs this test.
      const summary = await cleanRun({archive, recordPath, out, env: {}, local: true});
      const written = JSON.parse(await readFile(path.join(out, "clean-run.json"), "utf8"));
      assert.deepEqual(written.problems, summary.problems);
      return {summary: written, out};
    };
    for (const [name, text, error] of [["not-json", "{ this is not json", /SyntaxError|JSON/], ["missing", null, /ENOENT/]]) {
      const {summary, out} = await broken(name, text);
      assert.equal(summary.verdict, "failed", name);
      assert.equal(summary.claim, "local-rehearsal");
      assert.match(summary.problems.join("\n"), error);
      assert.match(summary.problems.join("\n"), /the record is not the uploader's/);
      assert.deepEqual(summary.runs, []);
      assert.equal(summary.uploader, null);
      assert.deepEqual((await readdir(out)).filter(file => file.startsWith("replay-clean-")), []);
    }
    // The output directory is the one place a summary cannot go: a non-empty one stops the run first.
    const occupied = path.join(directory, "occupied");
    await mkdir(occupied);
    await writeFile(path.join(occupied, "earlier.txt"), "kept");
    await assert.rejects(cleanRun({archive, recordPath: path.join(directory, "not-json.json"), out: occupied, env: {}, local: true}), /refusing to write into a non-empty/);
    assert.deepEqual(await readdir(occupied), ["earlier.txt"]);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

// The job's own promise is that it installs nothing: no Godot, no native host, no npm install, no .deps. A later edit that adds one would still pass the judge, so the workflow is read here.
test("the workflow ships the app in one job and runs it in another that installs nothing", async () => {
  const workflow = await read(".github/workflows/contracts.yml");
  // Comments may name what the job does not do; only the YAML itself is held to it.
  const code = text => text.split("\n").filter(line => !line.trim().startsWith("#")).join("\n");
  const block = name => workflow.match(new RegExp(`^  ${name}:\\n(?:(?: {4}.*)?\\n)+`, "m"))?.[0];
  const clean = code(block("macos-clean-run") ?? "");
  const runtime = code(block("native-suites-runtime") ?? "");
  assert.ok(clean && runtime, "both jobs are in the workflow");
  assert.match(clean, /^    needs: native-suites-runtime$/m);
  assert.match(clean, /^    if: github\.event_name == 'workflow_dispatch'$/m);
  assert.match(clean, /^    runs-on: macos-15$/m);
  assert.match(clean, /node scripts\/macos-clean-run\.mjs run /);
  for (const forbidden of [/install-godot/, /native-host/, /npm ci/, /npm run/, /\.deps/, /setup-node/, /godot\.zip/, /GODOT_BIN/, /--local/]) {
    assert.doesNotMatch(clean, forbidden);
  }
  assert.doesNotMatch(code(workflow), /--local/, "no job rehearses");
  assert.match(runtime, /node scripts\/macos-clean-run\.mjs pack /);
  // The last steps of the job, so that a pack that fails skips none of the uploads before it.
  assert.ok(runtime.indexOf("name: native-examples-headless") < runtime.indexOf("macos-clean-run.mjs pack"), "the archive step comes after the last upload of the job");
  assert.match(clean, /name: frontier-release-app$/m);
  assert.match(runtime, /name: frontier-release-app$/m);
  assert.match(runtime, /compression-level: 0/);
  assert.match(clean, /name: macos-clean-run$/m);
});
