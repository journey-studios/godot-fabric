import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {constants as fsConstants, createReadStream} from "node:fs";
import {access, cp, lstat, mkdir, mkdtemp, open, readFile, readdir, readlink, realpath, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {judgeReplayReport, parseRoteiro} from "../tests/macos-export-civ-lite-oracle.mjs";
import {CIV_LITE_BUNDLE_IDENTIFIER, GOLDEN_HASH, TRACE_HASH, judgeReplayRun, replayRecord} from "./macos-export-civ-lite.mjs";

// V05-07 `limpa`, on a hosted runner: Frontier's signed Release .app, built and replayed by the `native-suites-runtime` job, is shipped to a fresh macOS runner and
// plays its 12-turn replay there. `pack` runs in the job that exported the app and `run` in the job `macos-clean-run` (.github/workflows/contracts.yml); both import
// only `node:` modules and this repository's lane files, so the second job needs no `npm ci`, no Godot and no native host. Node is the judge: it unpacks the archive,
// checks hashes, signatures and load commands, starts the app with a scrubbed environment and judges the reports it leaves. The app never sees it.
//
// The claim is the hosted runner's and no more: the runner is another machine (a new VM, a clean user, no Godot, no `.deps`, no installed project dependencies), but its
// image still ships Node and Xcode. The app is shown not to use them by its environment (`env -i`, a PATH with neither) and by its load commands (its bundle and the system).
// `--local` rehearses the same steps on a development Mac, relaxes the assertions only a clean machine can meet, and claims nothing.
const root = fileURLToPath(new URL("..", import.meta.url));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export const RECORD_FORMAT = "godot-fabric.frontier-release-app/v1";
const SUMMARY_FORMAT = "godot-fabric.macos-clean-run/v1";
const APP_NAME = "Frontier.app";
const ARCHIVE_NAME = "Frontier.app.tar.gz";
const RECORD_NAME = "frontier-release-app.json";
const SUMMARY_NAME = "clean-run.json";
export const SCRUBBED_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
export const RUNS = 3;
export const NEGATIVES = ["wrongGoldenPin", "tamperedCopy", "dirtyProfile"];
const HOSTED_LIMIT = "another hosted macOS runner (a new VM, a clean user, no Godot, no .deps, no installed project dependencies): the runner image still ships Node and Xcode, and the app is shown not to use them (a scrubbed environment, load commands of its bundle and the system only); Node ran only as the judge";
const LOCAL_LIMIT = "a rehearsal on a development Mac (--local): the no-Godot and the other-machine assertions were relaxed, so nothing about criterion `limpa` is claimed";
const PROJECT_PREFIX = "Frontier Export ";
const REPLAY_REPORT = "civ-lite-replay-report.json";
// The load commands the exported binaries may name: the app's own bundle and the system, never a path of the machine that built them.
const ALLOWED_LOADS = [/^@rpath\//, /^@loader_path(?:\/|$)/, /^@executable_path(?:\/|$)/, /^\/System\/Library\//, /^\/usr\/lib\//];
const ENVIRONMENT_KEYS = ["HOME", "PATH", "TMPDIR", "USER"];

function tool(command, args, options = {}) {
  const result = spawnSync(command, args, {encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024, ...options});
  assert.equal(result.error, undefined, `${command} ${args.join(" ")}: ${result.error?.message}`);
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return {status: result.status, signal: result.signal, stdout, stderr, output: stdout + stderr};
}

async function exists(filename) {
  try {
    await lstat(filename);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

const isInside = (parent, candidate) => {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
};

function sha256File(filename) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filename).on("error", reject).on("data", chunk => hash.update(chunk)).on("end", () => resolve(hash.digest("hex")));
  });
}

// The lane's bundle hash (hashApp in scripts/macos-export.mjs, which this script cannot import: it pulls the whole export runner in). `pack` compares the two on
// the app the lane just exported, so a drift between them fails there.
export async function hashApp(app) {
  const rows = [];
  async function visit(directory) {
    for (const entry of (await readdir(directory, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.join(directory, entry.name);
      const relative = path.relative(app, filename).split(path.sep).join("/");
      const info = await lstat(filename);
      if (info.isSymbolicLink()) {
        rows.push({path: relative, link: await readlink(filename)});
      } else if (info.isDirectory()) {
        await visit(filename);
      } else {
        rows.push({path: relative, sha256: sha256(await readFile(filename))});
      }
    }
  }
  await visit(app);
  return sha256(Buffer.from(JSON.stringify(rows)));
}

export const flipHash = hash => `${hash[0] === "0" ? "1" : "0"}${hash.slice(1)}`;

export async function flipByte(filename, offset) {
  const handle = await open(filename, "r+");
  try {
    const byte = Buffer.alloc(1);
    await handle.read(byte, 0, 1, offset);
    byte[0] ^= 0xff;
    await handle.write(byte, 0, 1, offset);
  } finally {
    await handle.close();
  }
}

// ----- what the machine is -----

export const parseDylibList = output => output.split("\n").slice(1).map(line => line.trim().replace(/ \(.*$/, "")).filter(Boolean);
export const parseRpaths = output => output.split("\n").filter(line => /^\s*path .* \(offset/.test(line))
  .map(line => line.trim().replace(/^path /, "").replace(/ \(offset.*$/, ""));

export function judgeLoads(binaries) {
  const problems = [];
  for (const {binary, loads, rpaths} of binaries) {
    for (const load of [...loads, ...rpaths]) {
      if (!ALLOWED_LOADS.some(pattern => pattern.test(load))) {
        problems.push(`${binary} names ${load}, which is not the bundle's or the system's`);
      }
    }
  }
  return problems;
}

export const isAdHoc = details => /^Signature=adhoc$/m.test(details) && !/^Authority=/m.test(details);

/** The hardware lines worth recording; the serial and the UUIDs are hashed and never printed. */
export function parseHardware(output) {
  const fields = {};
  for (const line of output.split("\n")) {
    const match = line.match(/^\s+([A-Za-z][^:]*):\s+(.+)$/);
    if (match) {
      fields[match[1].trim()] = match[2].trim();
    }
  }
  const hashed = value => (value === undefined ? null : sha256(value));
  return {modelName: fields["Model Name"] ?? null, modelIdentifier: fields["Model Identifier"] ?? null, chip: fields.Chip ?? fields["Processor Name"] ?? null,
    cores: fields["Total Number of Cores"] ?? null, memory: fields.Memory ?? null, serialSha256: hashed(fields["Serial Number (system)"]),
    hardwareUuidSha256: hashed(fields["Hardware UUID"]), provisioningUdidSha256: hashed(fields["Provisioning UDID"])};
}

function machineIdentity(env) {
  const swVers = {};
  for (const line of tool("/usr/bin/sw_vers", []).stdout.split("\n")) {
    const match = line.match(/^(\w+):\s+(.+)$/);
    if (match) {
      swVers[match[1]] = match[2];
    }
  }
  const boot = tool("/usr/sbin/sysctl", ["-n", "kern.boottime"]).stdout.match(/sec = (\d+)/);
  return {runnerName: env.RUNNER_NAME ?? null, runnerOs: env.RUNNER_OS ?? null, runnerArch: env.RUNNER_ARCH ?? null, imageOs: env.ImageOS ?? null,
    imageVersion: env.ImageVersion ?? null, workflowRunId: env.GITHUB_RUN_ID ?? null, workflowRunAttempt: env.GITHUB_RUN_ATTEMPT ?? null, workflowJob: env.GITHUB_JOB ?? null, uname: tool("/usr/bin/uname", ["-a"]).stdout.trim(), swVers, bootTimeSec: boot ? Number(boot[1]) : null,
    hostnameSha256: sha256(os.hostname()), user: os.userInfo().username, hardware: parseHardware(tool("/usr/sbin/system_profiler", ["SPHardwareDataType"]).stdout)};
}

export function compareMachines(uploader, runner) {
  return {sameRunnerName: uploader.runnerName === runner.runnerName, sameBootTime: uploader.bootTimeSec === runner.bootTimeSec,
    sameHostname: uploader.hostnameSha256 === runner.hostnameSha256, sameHardwareUuid: uploader.hardware?.hardwareUuidSha256 === runner.hardware?.hardwareUuidSha256};
}

/** What on this machine should not be there for a clean runner: a godot on PATH, a Godot.app, Godot's data directory, the workspace's `.deps` and `node_modules`. */
export async function observeAbsences({env, workspace, home, applications = "/Applications"}) {
  const found = [];
  const onPath = tool("/bin/sh", ["-c", "command -v godot"], {env});
  if (onPath.status === 0) {
    found.push(`command -v godot: ${onPath.stdout.trim()}`);
  }
  for (const directory of [applications, path.join(home, "Applications")]) {
    let names = [];
    try {
      names = await readdir(directory);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
    found.push(...names.filter(name => /^godot.*\.app$/i.test(name)).map(name => path.join(directory, name)));
  }
  const checked = [path.join(home, "Library", "Application Support", "Godot"), ...[".deps", "node_modules", ".godot"].map(name => path.join(workspace, name))];
  for (const filename of checked) {
    if (await exists(filename)) {
      found.push(filename);
    }
  }
  return {checked: ["command -v godot", path.join(applications, "Godot*.app"), path.join(home, "Applications", "Godot*.app"), ...checked], found};
}

async function scrubbedPathFinds() {
  const finds = [];
  for (const directory of SCRUBBED_PATH.split(":")) {
    for (const name of ["node", "godot", "Godot"]) {
      try {
        await access(path.join(directory, name), fsConstants.X_OK);
        finds.push(path.join(directory, name));
      } catch (error) {
        if (error.code !== "ENOENT" && error.code !== "EACCES") {
          throw error;
        }
      }
    }
  }
  return finds;
}

// ----- the clean profile and the run -----

export const scrubbedEnvironment = ({home, user, tmpdir}) => ({HOME: home, USER: user, TMPDIR: tmpdir, PATH: SCRUBBED_PATH});

/** The application's user-data directory: Godot derives it from HOME and the project's name, which is unique to the export. */
export function profilePath(home, projectName) {
  assert.ok(projectName.startsWith(PROJECT_PREFIX) && projectName.length > PROJECT_PREFIX.length && !/[\\/]/.test(projectName), "the project name is not an export's own");
  return path.join(home, "Library", "Application Support", "Godot", "app_userdata", projectName);
}

export async function assertProfileAbsent(userData, label) {
  if (await exists(userData)) {
    throw new Error(`${label}: the user profile ${userData} exists before the run`);
  }
}

function parseReport(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

/** One replay of the app in a clean profile, as observed: `env -i` with four variables, a profile that must not exist before and is removed after. */
export async function observeReplay({label, executable, cwd, home, user, tmpdir, projectName, outDir}) {
  const userData = profilePath(home, projectName);
  await assertProfileAbsent(userData, label);
  const environment = scrubbedEnvironment({home, user, tmpdir});
  const command = ["/usr/bin/env", "-i", ...Object.entries(environment).map(([key, value]) => `${key}=${value}`), executable, "--headless", "--", "--validate-replay"];
  let result;
  try {
    result = tool(command[0], command.slice(1), {cwd, env: environment, timeout: 180000, maxBuffer: 8 * 1024 * 1024});
  } catch (error) {
    await rm(userData, {recursive: true, force: true});
    throw error;
  }
  await writeFile(path.join(outDir, `${label}.log`), result.output);
  let entriesAfter = null;
  try {
    entriesAfter = (await readdir(userData)).sort();
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  let text = null;
  try {
    text = await readFile(path.join(userData, REPLAY_REPORT), "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  if (text !== null) {
    await writeFile(path.join(outDir, `${label}.json`), text);
  }
  await rm(userData, {recursive: true, force: true});
  return {label, status: result.status, signal: result.signal, log: result.output, report: text === null ? null : parseReport(text),
    reportSha256: text === null ? null : sha256(Buffer.from(text)), profile: {path: userData, existedBefore: false, entriesAfter, removedAfter: !(await exists(userData))},
    environment, command};
}

/** The problems of one observed replay: the lane's own judgement of a run, the oracle's of its report, and what only this machine can say (the project, the executable, the environment). */
export function judgeCleanReplay(observation, {expected, roteiro, projectName, executable}) {
  const {label, report} = observation;
  const record = replayRecord({label, lane: "app", run: observation, report, reportSha256: observation.reportSha256, profile: observation.profile});
  const problems = judgeReplayRun(record, expected);
  if (report !== null) {
    problems.push(...judgeReplayReport(report, expected, roteiro).map(finding => `${label}: ${finding}`));
    if (report.project !== projectName) {
      problems.push(`${label}: the run was of the project ${report.project}, not the export's ${projectName}`);
    }
    if (report.executable !== executable) {
      problems.push(`${label}: it ran ${report.executable}, not the unpacked app's ${executable}`);
    }
  }
  const keys = Object.keys(observation.environment ?? {}).sort();
  if (JSON.stringify(keys) !== JSON.stringify(ENVIRONMENT_KEYS) || observation.environment.PATH !== SCRUBBED_PATH) {
    problems.push(`${label}: its environment was not the scrubbed one (${keys.join(", ")})`);
  }
  return problems;
}

/** A run's row in the summary: the lane's record of it, the states it played (to compare the runs) and what was wrong with it. */
export function runRow(observation, problems) {
  const {report} = observation;
  const record = replayRecord({label: observation.label, lane: "app", run: observation, report, reportSha256: observation.reportSha256, profile: observation.profile});
  const states = report === null ? null : sha256(`${JSON.stringify(report.steps)}\n${report.finalSerialization}`);
  return {...record, project: report?.project ?? null, statesSha256: states, environment: observation.environment, command: observation.command, problems};
}

// ----- the negative controls: what keeps the job from passing vacuously -----

/** The same observed run, judged against a golden hash that is not the pinned one: the judge must reject it, and accept it against the real pins. */
export function wrongPinControl(observation, context) {
  const baselineProblems = judgeCleanReplay(observation, context);
  const wrongProblems = judgeCleanReplay(observation, {...context, expected: {goldenHash: flipHash(context.expected.goldenHash), traceHash: context.expected.traceHash}});
  return {baselineProblems: baselineProblems.length, wrongPinProblems: wrongProblems.length,
    rejected: baselineProblems.length === 0 && wrongProblems.some(problem => /pinned/.test(problem)), firstProblem: wrongProblems[0] ?? null};
}

/** A profile that exists before a run must stop it: the guard the runs go through, run against a profile made on purpose. */
export async function dirtyProfileControl({home, projectName}) {
  const userData = profilePath(home, projectName);
  await assertProfileAbsent(userData, "dirty-profile-control");
  await mkdir(userData, {recursive: true});
  await writeFile(path.join(userData, REPLAY_REPORT), "{}\n");
  let refusal = null;
  try {
    await assertProfileAbsent(userData, "dirty-profile-control");
  } catch (error) {
    refusal = error.message;
  } finally {
    await rm(userData, {recursive: true, force: true});
  }
  return {refused: refusal !== null, refusal, removedAfter: !(await exists(userData)), rejected: refusal !== null && !(await exists(userData))};
}

/** A copy of the unpacked app with one byte of its PCK changed: codesign must refuse it, and its bundle hash must differ from the one the uploader recorded. */
async function tamperedCopyControl({app, directory, recordedBundleSha256}) {
  const copied = path.join(directory, APP_NAME);
  await cp(app, copied, {recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false});
  // The copy must verify before the byte changes, or its refusal afterwards would say nothing about the byte.
  const baseline = tool("/usr/bin/codesign", ["--verify", "--deep", "--strict", copied]);
  const filename = await pckOf(copied);
  const size = (await lstat(filename)).size;
  const offset = Math.floor(size / 2);
  await flipByte(filename, offset);
  const verify = tool("/usr/bin/codesign", ["--verify", "--deep", "--strict", copied]);
  const bundleSha256 = await hashApp(copied);
  return {pckOffset: offset, pckBytes: size, baselineCodesignStatus: baseline.status, codesignStatus: verify.status, codesignMessage: verify.output.trim().split("\n")[0], bundleSha256,
    differsFromRecord: bundleSha256 !== recordedBundleSha256, rejected: baseline.status === 0 && verify.status !== 0 && bundleSha256 !== recordedBundleSha256};
}

// ----- the verdict -----

/**
 * The problems of a whole clean run, from what was observed and nothing else. `observed.hosted` selects the assertions a rehearsal cannot meet (a machine with no
 * Godot, other than the one that exported the app); everything else, the negative controls included, is asked of both.
 */
export function judgeCleanRun(observed) {
  const problems = [];
  const fail = message => problems.push(message);
  const {record, expected, hosted} = observed;
  if (observed.error) {
    fail(`the run stopped before it was judged: ${observed.error}`);
  }
  if (record?.format !== RECORD_FORMAT || !record.archive?.sha256 || !record.app?.bundleSha256 || !record.app.executableName || !record.app.projectName) {
    fail("the record is not the uploader's");
    return problems;
  }
  if (record.pins?.goldenHash !== expected.goldenHash || record.pins?.traceHash !== expected.traceHash) {
    fail("the pins the uploader recorded are not the ones this checkout judges against");
  }
  if (hosted && observed.sourceCommit !== record.sourceCommit) {
    fail(`this checkout is ${observed.sourceCommit}, the app was exported from ${record.sourceCommit}`);
  }
  if (observed.archive?.sha256 !== record.archive.sha256) {
    fail(`the archive's SHA-256 ${observed.archive?.sha256} is not the uploader's ${record.archive.sha256}`);
  }
  const bundle = observed.bundle;
  if (bundle === undefined) {
    fail("the bundle was not observed");
  } else {
    if (bundle.sha256 !== record.app.bundleSha256) {
      fail(`the unpacked bundle's hash ${bundle.sha256} is not the uploader's ${record.app.bundleSha256}`);
    }
    if (bundle.afterRunsSha256 !== record.app.bundleSha256) {
      fail(`the bundle's hash after the runs, ${bundle.afterRunsSha256}, is not the uploader's: running the app changed its bytes`);
    }
    if (bundle.executableName !== record.app.executableName || bundle.bundleIdentifier !== CIV_LITE_BUNDLE_IDENTIFIER) {
      fail(`the bundle is ${bundle.bundleIdentifier} / ${bundle.executableName}, not Frontier's ${CIV_LITE_BUNDLE_IDENTIFIER} / ${record.app.executableName}`);
    }
    if (bundle.pckSha256 !== record.app.pckSha256 || bundle.projectNameInPck !== true) {
      fail("the PCK is not the uploader's, or it does not carry the export's project name");
    }
    if (!bundle.architectures?.includes("arm64")) {
      fail("the executable has no arm64 slice");
    }
  }
  if (observed.outsideWorkspace !== true) {
    fail("the app was not unpacked outside the workspace");
  }
  const signature = observed.signature;
  const checks = [...(signature?.checks ?? []), ...(signature?.afterRunsChecks ?? [])];
  if (checks.length === 0 || checks.some(check => check.status !== 0) || signature?.adhoc !== true) {
    fail(`codesign did not verify every signed item before and after the runs, or the signature is not ad hoc (${checks.filter(check => check.status !== 0).map(check => check.item).join(", ")})`);
  }
  if ((observed.loads ?? []).length !== 4) {
    fail(`${(observed.loads ?? []).length} binaries had their load commands read, not the executable, the host and the two frameworks`);
  }
  problems.push(...judgeLoads(observed.loads ?? []));
  if ((observed.scrubbedPathFinds ?? ["unobserved"]).length !== 0) {
    fail(`the scrubbed PATH finds ${(observed.scrubbedPathFinds ?? ["nothing observed"]).join(", ")}`);
  }
  if (hosted) {
    if ((observed.absences?.found ?? ["unobserved"]).length !== 0) {
      fail(`this machine is not clean: ${(observed.absences?.found ?? ["nothing observed"]).join("; ")}`);
    }
    const here = observed.machine?.runnerName;
    const there = record.uploader?.runnerName;
    if (typeof here !== "string" || typeof there !== "string" || here === "" || here === there) {
      fail(`the runner ${here} is not another machine than the uploader's ${there}`);
    }
    if (observed.machine?.runnerArch !== "ARM64" || observed.architecture !== "arm64") {
      fail(`the runner is ${observed.machine?.runnerArch}/${observed.architecture}, not arm64`);
    }
  }
  const runs = observed.runs ?? [];
  if (runs.length !== RUNS) {
    fail(`${runs.length} replays ran, not ${RUNS}`);
  }
  for (const run of runs) {
    problems.push(...run.problems);
  }
  if (new Set(runs.map(run => run.statesSha256)).size > 1 || runs.some(run => run.statesSha256 === null)) {
    fail("the replays did not play the same states");
  }
  for (const name of NEGATIVES) {
    if (observed.negatives?.[name]?.rejected !== true) {
      fail(`the negative control ${name} did not reject: the job could pass without the judge or the signature check biting`);
    }
  }
  return problems;
}

// ----- shipping the app between jobs -----

export function judgeArchiveListing(listing) {
  const entries = listing.split("\n").filter(Boolean);
  const problems = entries.filter(entry => entry.startsWith("/") || entry.split("/").includes("..") || ![APP_NAME, `._${APP_NAME}`].includes(entry.split("/")[0]))
    .map(entry => `the archive holds ${entry}, which is not inside ${APP_NAME}`);
  if (!entries.includes(`${APP_NAME}/Contents/Info.plist`)) {
    problems.push(`the archive has no ${APP_NAME}/Contents/Info.plist`);
  }
  return problems;
}

function sourceCommit(env) {
  if (env.GITHUB_SHA) {
    return env.GITHUB_SHA;
  }
  return tool("git", ["rev-parse", "HEAD"], {cwd: root}).stdout.trim();
}

function plistValue(app, key) {
  const result = tool("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, path.join(app, "Contents", "Info.plist")]);
  assert.equal(result.status, 0, result.output);
  return result.stdout.trim();
}

async function pckOf(app) {
  const resources = path.join(app, "Contents", "Resources");
  const names = (await readdir(resources)).filter(name => name.endsWith(".pck"));
  assert.equal(names.length, 1, "the app holds exactly one PCK");
  return path.join(resources, names[0]);
}

function signedItems(app, executableName) {
  const contents = path.join(app, "Contents");
  return [app, path.join(contents, "MacOS", executableName), path.join(contents, "Frameworks", "fabric_godot.dylib"),
    path.join(contents, "Frameworks", "frameworks", "hermesvm.framework"), path.join(contents, "Frameworks", "frameworks", "ReactNativeDependencies.framework")];
}

function verifySignatures(app, executableName) {
  return signedItems(app, executableName).map(item => {
    const result = tool("/usr/bin/codesign", ["--verify", "--deep", "--strict", item]);
    return {item: path.relative(app, item) || ".", status: result.status, message: result.output.trim().split("\n")[0] ?? ""};
  });
}

/** In the job that exported the app: archive it with tar (symlinks, modes and extended attributes kept), unpack it again to prove the archive, and record what the other job must see. */
async function packApp({app, laneReportPath, out, env}) {
  assert.equal(path.basename(app), APP_NAME, `the app must be named ${APP_NAME}`);
  const lane = JSON.parse(await readFile(laneReportPath, "utf8"));
  assert.equal(lane.format, "godot-fabric.macos-export-civ-lite/v1");
  assert.equal(lane.status, "passed", "the lane did not pass");
  const bundleSha256 = await hashApp(app);
  assert.equal(bundleSha256, lane.app.sha256, "the bundle hash differs from the lane's hashApp: the app is not the one the lane judged, or the two hashes drifted");
  const pck = await pckOf(app);
  const pckSha256 = await sha256File(pck);
  assert.equal(pckSha256, lane.app.pckSha256, "the PCK differs from the lane's");
  const projectNames = new Set(lane.replay.runs.map(run => path.basename(run.profile.path)));
  assert.equal(projectNames.size, 1, "the lane's runs did not share one profile name");
  const [projectName] = projectNames;
  assert.ok(projectName.startsWith(PROJECT_PREFIX), `unexpected project name ${projectName}`);

  await mkdir(out, {recursive: true});
  const archive = path.join(out, ARCHIVE_NAME);
  assert.equal(await exists(archive), false, `refusing to overwrite ${archive}`);
  const packed = tool("/usr/bin/tar", ["-czf", archive, "-C", path.dirname(app), APP_NAME]);
  assert.equal(packed.status, 0, packed.output);
  const listing = tool("/usr/bin/tar", ["-tzf", archive], {maxBuffer: 64 * 1024 * 1024});
  assert.equal(listing.status, 0, listing.output);
  assert.deepEqual(judgeArchiveListing(listing.stdout), []);

  // Unpacked once here, in a scratch directory, so that a tar that loses what the signature covers fails in the job that made it.
  const scratch = await mkdtemp(path.join(os.tmpdir(), "frontier-release-app-roundtrip-"));
  let roundTrip;
  try {
    const unpacked = tool("/usr/bin/tar", ["-xzf", archive, "-C", scratch]);
    assert.equal(unpacked.status, 0, unpacked.output);
    const copy = path.join(scratch, APP_NAME);
    const verified = verifySignatures(copy, lane.app.executableName);
    roundTrip = {unpackedBundleSha256: await hashApp(copy), signatureStatuses: verified.map(check => check.status)};
  } finally {
    await rm(scratch, {recursive: true, force: true});
  }
  assert.equal(roundTrip.unpackedBundleSha256, bundleSha256, "the archive does not unpack to the same bundle");
  assert.ok(roundTrip.signatureStatuses.every(status => status === 0), "the unpacked app's signatures do not verify");

  const record = {format: RECORD_FORMAT, sourceCommit: sourceCommit(env), packedAt: new Date().toISOString(),
    archive: {name: ARCHIVE_NAME, bytes: (await lstat(archive)).size, sha256: await sha256File(archive), packer: `tar -czf ${ARCHIVE_NAME} -C <parent> ${APP_NAME}`},
    app: {name: APP_NAME, bundleSha256, executableName: lane.app.executableName, projectName, bundleIdentifier: lane.app.bundleIdentifier, pckSha256},
    roundTrip, pins: {goldenHash: GOLDEN_HASH, traceHash: TRACE_HASH}, uploader: machineIdentity(env)};
  await writeFile(path.join(out, RECORD_NAME), JSON.stringify(record, null, 2) + "\n");
  return record;
}

// ----- the run on the other machine -----

export function resolveMode({local, env}) {
  const inActions = env.GITHUB_ACTIONS === "true";
  if (local && inActions) {
    throw new Error("--local is a rehearsal flag and is refused on GitHub Actions");
  }
  if (!local && !inActions) {
    throw new Error("this is not a GitHub Actions run; pass --local to rehearse it on a development Mac (the result then claims nothing)");
  }
  return {hosted: !local};
}

/** Every step of the clean run. Whatever was observed lands in the summary even when a step throws; the verdict is judgeCleanRun's. */
export async function cleanRun({archive, recordPath, out, env, local}) {
  const {hosted} = resolveMode({local, env});
  const startedAt = new Date().toISOString();
  assert.ok(!(await exists(out)) || (await readdir(out)).length === 0, `refusing to write into a non-empty ${out}`);
  await mkdir(out, {recursive: true});
  const expected = {goldenHash: GOLDEN_HASH, traceHash: TRACE_HASH};
  const home = os.homedir();
  const user = os.userInfo().username;
  const tmpdir = os.tmpdir();
  // Everything that can throw from here on is inside the try, the reading of the record first: a record that is not JSON still leaves a failed summary.
  const observed = {hosted, expected, record: null, sourceCommit: null, architecture: process.arch, negatives: {}, runs: [], outsideWorkspace: false};
  let workRoot = null;
  try {
    const recordBytes = await readFile(recordPath);
    const record = JSON.parse(recordBytes.toString("utf8"));
    observed.record = record;
    await writeFile(path.join(out, RECORD_NAME), recordBytes);
    observed.sourceCommit = sourceCommit(env);
    const roteiro = parseRoteiro(await readFile(path.join(root, "consumers/civ-lite/game/replay.gd"), "utf8"));
    workRoot = await mkdtemp(path.join(tmpdir, "frontier-clean-run-"));
    observed.outsideWorkspace = !isInside(root, workRoot);
    observed.machine = machineIdentity(env);
    observed.comparison = compareMachines(record.uploader ?? {}, observed.machine);
    observed.absences = await observeAbsences({env, workspace: root, home});
    observed.scrubbedPathFinds = await scrubbedPathFinds();
    observed.tools = {judge: {node: process.version, execPath: process.execPath, role: "judge only: it reads files and starts the app with `env -i`; the app never sees it"},
      xcodeSelect: tool("/usr/bin/xcode-select", ["-p"]).output.trim()};

    // The archive and the bundle, against what the uploader recorded.
    observed.archive = {sha256: await sha256File(archive), bytes: (await lstat(archive)).size};
    const listing = tool("/usr/bin/tar", ["-tzf", archive], {maxBuffer: 64 * 1024 * 1024});
    assert.equal(listing.status, 0, listing.output);
    assert.deepEqual(judgeArchiveListing(listing.stdout), []);
    const unpackDirectory = path.join(workRoot, "unpacked");
    await mkdir(unpackDirectory);
    const unpacked = tool("/usr/bin/tar", ["-xzf", archive, "-C", unpackDirectory]);
    assert.equal(unpacked.status, 0, unpacked.output);
    const app = path.join(unpackDirectory, APP_NAME);
    assert.ok((await lstat(app)).isDirectory(), `${APP_NAME} was not unpacked`);
    const realApp = await realpath(app);
    const executableName = plistValue(app, "CFBundleExecutable");
    const executable = path.join(realApp, "Contents", "MacOS", executableName);
    const projectName = record.app.projectName;
    const pck = await pckOf(app);
    observed.bundle = {sha256: await hashApp(app), executableName, bundleIdentifier: plistValue(app, "CFBundleIdentifier"), pckSha256: await sha256File(pck),
      projectNameInPck: (await readFile(pck)).includes(Buffer.from(projectName)), architectures: tool("/usr/bin/lipo", ["-archs", executable]).stdout.trim().split(/\s+/)};

    // The signature and the load commands.
    const details = tool("/usr/bin/codesign", ["-dvv", app]).output;
    observed.signature = {checks: verifySignatures(app, executableName), adhoc: isAdHoc(details), details: details.split("\n").filter(line => /^(Identifier|Format|Signature|TeamIdentifier|CodeDirectory)/.test(line))};
    const contents = path.join(app, "Contents");
    observed.loads = [path.join(contents, "MacOS", executableName), path.join(contents, "Frameworks", "fabric_godot.dylib"), path.join(contents, "Frameworks", "frameworks", "hermesvm.framework", "hermesvm"),
      path.join(contents, "Frameworks", "frameworks", "ReactNativeDependencies.framework", "ReactNativeDependencies")].map(binary => ({binary: path.relative(app, binary),
      loads: parseDylibList(tool("/usr/bin/otool", ["-arch", "arm64", "-L", binary]).stdout), rpaths: parseRpaths(tool("/usr/bin/otool", ["-arch", "arm64", "-l", binary]).stdout)}));

    // The replays: each in a clean profile, from an empty directory, with the environment scrubbed.
    const cwd = path.join(workRoot, "cwd");
    await mkdir(cwd);
    const context = {expected, roteiro, projectName, executable};
    const observations = [];
    for (let index = 1; index <= RUNS; index++) {
      const observation = await observeReplay({label: `replay-clean-${index}`, executable, cwd, home, user, tmpdir, projectName, outDir: out});
      observations.push(observation);
      observed.runs.push(runRow(observation, judgeCleanReplay(observation, context)));
    }
    observed.bundle.afterRunsSha256 = await hashApp(app);
    observed.signature.afterRunsChecks = verifySignatures(app, executableName);

    // The negatives, so that none of the above can pass vacuously: a wrong pin, a tampered copy and a profile that is not clean.
    observed.negatives.wrongGoldenPin = wrongPinControl(observations[0], context);
    const tamperedDirectory = path.join(workRoot, "tampered");
    await mkdir(tamperedDirectory);
    observed.negatives.tamperedCopy = await tamperedCopyControl({app, directory: tamperedDirectory, recordedBundleSha256: record.app.bundleSha256});
    observed.negatives.dirtyProfile = await dirtyProfileControl({home, projectName});
  } catch (error) {
    observed.error = error.message;
  } finally {
    if (workRoot !== null) {
      await rm(workRoot, {recursive: true, force: true});
      observed.workRootRemoved = !(await exists(workRoot));
    }
  }
  const problems = judgeCleanRun(observed);
  const {record, ...observations} = observed;
  const summary = {format: SUMMARY_FORMAT, verdict: problems.length === 0 ? "passed" : "failed", claim: hosted ? "hosted-runner" : "local-rehearsal", limit: hosted ? HOSTED_LIMIT : LOCAL_LIMIT,
    startedAt, completedAt: new Date().toISOString(), problems, recordFile: RECORD_NAME, uploader: record?.uploader ?? null, archiveRecord: record?.archive ?? null, appRecord: record?.app ?? null, ...observations};
  await writeFile(path.join(out, SUMMARY_NAME), JSON.stringify(summary, null, 2) + "\n");
  return summary;
}

// ----- the command line -----

const COMMANDS = {
  pack: {values: ["--app", "--lane-report", "--out"], flags: []},
  run: {values: ["--archive", "--record", "--out"], flags: ["--local"]},
};

export function usage() {
  return "Usage:\n  node scripts/macos-clean-run.mjs pack --app Frontier.app --lane-report report.json --out DIRECTORY\n"
    + "  node scripts/macos-clean-run.mjs run --archive Frontier.app.tar.gz --record frontier-release-app.json --out DIRECTORY [--local]\n"
    + "pack archives the exported app and records its hashes; run unpacks it on another machine, replays it three times in clean profiles with a scrubbed environment and judges it.\n"
    + "--local rehearses run on a development Mac and claims nothing; it is refused on GitHub Actions, and Actions never passes it.";
}

export function parseArguments(argv) {
  const [command, ...rest] = argv;
  const spec = COMMANDS[command];
  if (spec === undefined) {
    throw new Error(usage());
  }
  const options = new Map();
  for (let index = 0; index < rest.length; index++) {
    const option = rest[index];
    if (spec.flags.includes(option) && !options.has(option)) {
      options.set(option, true);
    } else if (spec.values.includes(option) && !options.has(option) && rest[index + 1] !== undefined && !rest[index + 1].startsWith("--")) {
      options.set(option, path.resolve(rest[++index]));
    } else {
      throw new Error(usage());
    }
  }
  if (!spec.values.every(option => options.has(option))) {
    throw new Error(usage());
  }
  return {command, options};
}

async function main() {
  let parsed;
  try {
    parsed = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }
  const {command, options} = parsed;
  try {
    if (command === "pack") {
      const record = await packApp({app: options.get("--app"), laneReportPath: options.get("--lane-report"), out: options.get("--out"), env: process.env});
      console.log(`FRONTIER_RELEASE_APP_PACKED: archive=${record.archive.sha256} bundle=${record.app.bundleSha256}`);
      return;
    }
    const summary = await cleanRun({archive: options.get("--archive"), recordPath: options.get("--record"), out: options.get("--out"), env: process.env, local: options.get("--local") === true});
    if (summary.verdict === "passed") {
      console.log(`MACOS_CLEAN_RUN_PASSED: ${summary.claim} runs=${summary.runs.length} golden=${GOLDEN_HASH} trace=${TRACE_HASH}`);
    } else {
      console.error(`MACOS_CLEAN_RUN_FAILED: ${summary.claim}\n${summary.problems.join("\n")}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(`MACOS_CLEAN_RUN_FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
