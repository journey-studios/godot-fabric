import { existsSync } from "node:fs";
import { mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { root } from "./consumer-harness.mjs";
import { ARMS, hashesOf, hashProblems, readExports, readProbeExport } from "./frontier-comparison-release.mjs";
import { goldenReplayHash, SEED, sha256, SOAK_FINAL_HASH } from "./frontier-comparison-run-campaign.mjs";
import { launchScenario, prepareProject, processOf, registeredOf, runTimed, scenarioArguments } from "./frontier-comparison-run.mjs";

// The launchers of the comparative campaign (V05-10, `execucao`, part 2): what runs one execution, behind an interface the campaign does not look through.
//
//   launcher.build                       "debug" or "release": the build recorded in each execution (the protocol accepts only "release")
//   launcher.name                        what the launcher is, for the record
//   launcher.windowed                    whether its processes run in a window or headless: the instrument's self-check runs in the same mode, with the launcher's engine
//   launcher.selfCheck                   "unsupported" when the launcher's processes cannot run the instrument's self-check, so that no campaign can start through it; an object ({entry, ...}) that the campaign passes
//                                        to the self-check when the launcher says how to enter the probe (the Release launcher with the probe's export: {entry: "release", executable}); absent: they can, as the editor's binary
//   await launcher.prepare()             {engine, registered, packages, deviations}: gets everything ready and says what the campaign registers (the hashes of the binary, the package
//                                        and the script of each arm, the seed, the game's hashes and the instrument's file), the sizes of the packages, and each way in which this launcher
//                                        deviates from the protocol. It may refuse: the Release launcher does, when an export is missing or is not the one its manifest registered.
//   await launcher.launch({arm, lane, slot, attempt})
//                                        runs ONE fresh process of the scenario and returns {report, exitCode, signal, timedOut, log, load: {before, after}, hashes: {binary, package, script}, seconds}:
//                                        `report` is the scenario's report (null when the process wrote none, or one that is not JSON: that file is kept as `<name>.unreadable.json` and the
//                                        log ends with a FRONTIER_COMPARISON_REPORT_UNREADABLE line that says where), `timedOut` is true when the launcher killed the process at its timeout (absent means
//                                        false), the load is the 1-minute average read right before the process starts and right after it ends, and the hashes are those of the files the process
//                                        ran. The campaign adds the protocol's hash and judges everything.
//   await launcher.cleanup()
//
// The Debug launcher is the part 1 rehearsal's own: a provisioned copy of civ-lite, the scenario copied into it with its entry and the engine's executable, run with `--path`. The scenario enters as
// the main loop of the measurement project (never `-s`: an export template discards it), and the arguments after the executable are `scenarioArguments`, which the Release launcher reuses for
// `Contents/MacOS/<executable>` of an exported .app. The Release launcher runs the three .app of an exports directory through the manifests that sit beside them (scripts/frontier-comparison-release.mjs);
// a campaign starts through it only when the directory also has the export of the instrument's probe project (<exports>/probe/frontier-comparison-export.json), whose .app runs the self-check, since a
// template discards `-s`. A fake launcher in the tests plays programmable executions.

export const RELEASE_SELF_CHECK_REFUSAL = [
  "The Release exports were read and validated (the manifests of the three arms, and the SHA-256 of each executable and package against them), but the campaign does not start:",
  "the instrument's self-check is the gate of every campaign and it runs the probe with `--script` (`-s`) in the engine's executable, which an export template discards,",
  "so, without the export of the instrument's probe project in <exports>/probe/frontier-comparison-export.json (its .app, from the same template as the three arms, which runs the probe as its main loop),",
  "there is no self-check of the instrument in a template (docs/research/frontier-comparison-execution.md, \"What is missing\"). Nothing was run and no campaign directory was made.",
  "Until then, use `--build debug --rehearsal` for a rehearsal of the campaign.",
].join(" ");

// The time limit of one process of an exported .app, the same as part 1's runner gives a Godot process.
const RELEASE_TIMEOUT_MS = 1800000;
const INSTRUMENT_FILE = "tests/cpu-time-instrument.gd";

// The scenario's report from the file its process was given, with the process's log: {report, log, kept}. A process that wrote no file has no report. A file that is not JSON (a process killed while writing
// it) is no report either, and the campaign counts the attempt as one that wrote none (`unreported`): the file is kept beside itself as `<name>.unreadable.json` (`kept`), for the raw data, and the log
// gets a line that says where.
async function readReport(reportFile, log) {
  if (!existsSync(reportFile)) {
    return { report: null, log, kept: null };
  }
  try {
    return { report: JSON.parse(await readFile(reportFile, "utf8")), log, kept: null };
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    // An earlier attempt of the same arm and lane may have left one: a later file never overwrites it.
    const base = path.join(path.dirname(reportFile), path.basename(reportFile, ".json"));
    let kept = `${base}.unreadable.json`;
    for (let number = 2; existsSync(kept); number += 1) {
      kept = `${base}.unreadable-${number}.json`;
    }
    await rename(reportFile, kept);
    return { report: null, log: `${log}${log === "" || log.endsWith("\n") ? "" : "\n"}FRONTIER_COMPARISON_REPORT_UNREADABLE: ${kept} (${error.message})\n`, kept };
  }
}

// The Release launcher over the exports in `exportsDirectory` (<A|B|C>/frontier-comparison-export.json, each beside its .app). `prepare()` reads and validates the three manifests and
// recomputes the SHA-256 of every executable and package: a manifest that is missing or wrong, or a file that is not the one its manifest registered, refuses it, and nothing runs. What it
// registers is what the manifests say (the hashes of each arm), with the seed, the game's hashes and the instrument's file from the same sources as the Debug launcher's. `launch()` hashes
// the executable and the package again and throws if either is not the registered one (the campaign stops: a file that changed after the registration is not the experiment that was
// registered), and then runs `Contents/MacOS/<executable>` with `scenarioArguments` (windowed, `--out` an absolute file in a private directory), in that directory, outside the .app. The
// override.cfg is inside the pck, so nothing is put in the .app, and the process gets this process's own environment. `run` (the process) and `timeout` are injectable for the tests; `cleanup()` removes
// only the launcher's own directory, and not even that when it holds a report that could not be read (`readReport`: raw data that the attempt's log points to).
//
// The instrument's self-check: when `exportsDirectory` also has the probe's export (probe/frontier-comparison-export.json, `arm` "probe"), `prepare()` validates it the same way (the hashes of its executable
// and package, the repository's instrument in its files) and checks that its `templateSha256` is that of the three arms: the self-check has to run on the campaign's engine. Then `selfCheck` is
// `{entry: "release", executable}` and the campaign runs the probe through that .app (scripts/frontier-comparison-campaign-instrument.mjs). Without the probe's export, or before `prepare()`, it stays "unsupported".
export function createReleaseLauncher({ exportsDirectory, run = runTimed, timeout = RELEASE_TIMEOUT_MS } = {}) {
  if (typeof exportsDirectory !== "string" || exportsDirectory === "") {
    throw new Error("the Release launcher needs the directory of the exports: --exports <directory>, with <A|B|C>/frontier-comparison-export.json beside the .app of each arm");
  }
  const directory = path.resolve(exportsDirectory);
  let exported = null;
  let work = null;
  let keptUnreadable = false;
  let selfCheck = "unsupported";
  return {
    build: "release",
    name: `release: the exports in ${directory} (A/, B/ and C/, each .app run through Contents/MacOS/<executable>)`,
    windowed: true,
    get selfCheck() {
      return selfCheck;
    },
    async prepare() {
      selfCheck = "unsupported";
      const entries = await readExports(directory);
      const probe = await readProbeExport(directory);
      const problems = [];
      for (const arm of ARMS) {
        problems.push(...hashProblems(entries[arm], await hashesOf(entries[arm])));
      }
      // The instrument's file is the repository's, as for the Debug launcher: the self-check vouches for that file, so the export must carry the same one.
      const instrumentSha256 = sha256(await readFile(path.join(root, INSTRUMENT_FILE)));
      for (const arm of ARMS) {
        if (entries[arm].manifest.scriptFiles[INSTRUMENT_FILE] !== instrumentSha256) {
          problems.push(`arm ${arm}: the export carries another ${INSTRUMENT_FILE} than the repository's (${instrumentSha256}): export again`);
        }
      }
      if (probe !== null) {
        problems.push(...hashProblems(probe, await hashesOf(probe)));
        if (probe.manifest.scriptFiles[INSTRUMENT_FILE] !== instrumentSha256) {
          problems.push(`the probe's export carries another ${INSTRUMENT_FILE} than the repository's (${instrumentSha256}): export again`);
        }
        for (const arm of ARMS) {
          if (probe.manifest.templateSha256 !== entries[arm].manifest.templateSha256) {
            problems.push(`the probe's export was made from the template ${probe.manifest.templateSha256}, and arm ${arm}'s from ${entries[arm].manifest.templateSha256}: the self-check has to run on the campaign's engine`);
          }
        }
      }
      if (problems.length > 0) {
        throw new Error(`the Release exports in ${directory} are refused:\n${problems.join("\n")}`);
      }
      exported = entries;
      selfCheck = probe === null ? "unsupported" : { entry: "release", executable: probe.executable };
      work ??= await mkdtemp(path.join(tmpdir(), "frontier-comparison-release-"));
      return {
        engine: entries.C.executable,
        registered: {
          seed: SEED,
          replayGoldenHash: goldenReplayHash(root),
          soakFinalHash: SOAK_FINAL_HASH,
          instrumentSha256,
          arms: Object.fromEntries(ARMS.map((arm) => {
            const { binarySha256, packageSha256, scriptSha256 } = entries[arm].manifest;
            return [arm, { binarySha256, packageSha256, scriptSha256 }];
          })),
        },
        packages: Object.fromEntries(ARMS.map((arm) => [arm, { exportBytes: [...entries[arm].manifest.exportBytes] }])),
        deviations: [],
      };
    },
    async launch({ arm, lane }) {
      const entry = exported?.[arm];
      if (entry === undefined) {
        throw new Error(`launch() for arm ${arm} before prepare(): there is no export registered`);
      }
      const hashes = await hashesOf(entry);
      const problems = hashProblems(entry, hashes);
      if (problems.length > 0) {
        throw new Error(`the export of arm ${arm} is not the one that was registered, so nothing runs:\n${problems.join("\n")}`);
      }
      const reportFile = path.join(work, `run-${arm}-${lane}.json`);
      await rm(reportFile, { force: true });
      const ran = await run({ executable: entry.executable, args: scenarioArguments({ arm, lane, windowed: true, out: reportFile }), cwd: work, env: process.env, timeout });
      const read = await readReport(reportFile, ran.log);
      keptUnreadable ||= read.kept !== null;
      return {
        report: read.report,
        exitCode: processOf(ran.result, ran.log).exitCode,
        signal: ran.result.signal,
        // spawnSync's timeout kills the process with SIGTERM and sets `error.code` to ETIMEDOUT.
        timedOut: ran.result.error?.code === "ETIMEDOUT",
        log: read.log,
        load: ran.load,
        hashes: { binary: hashes.binary, package: hashes.package, script: entry.manifest.scriptSha256 },
        seconds: ran.seconds,
      };
    },
    async cleanup() {
      if (work !== null && !keptUnreadable) {
        await rm(work, { recursive: true, force: true });
      }
      work = null;
    },
  };
}

// The Debug launcher over the part 1 runner: provisions the consumer, builds its HUD, copies the scenario and its support files in, and runs a Godot process per attempt. A rehearsal registers
// what it measured, in the same process that measured it, and the size of a package is the size of the provisioned copy twice (an export and its repeat).
export function createDebugLauncher({ name = "frontier-comparison-campaign", prepare = prepareProject, run = launchScenario } = {}) {
  let prepared = null;
  return {
    build: "debug",
    name: "debug: the provisioned copy of civ-lite, run with --path in the engine's executable",
    windowed: false,
    async prepare() {
      prepared = await prepare({ name });
      const sizes = [prepared.package.bytes, prepared.package.bytes];
      return {
        engine: prepared.harness.godot,
        registered: registeredOf(prepared, goldenReplayHash(root)),
        packages: Object.fromEntries(["A", "B", "C"].map((arm) => [arm, { exportBytes: sizes }])),
        deviations: [
          "Debug build, not the Release export of V05-07; the binary is the engine's executable and the package is the provisioned copy, not an export",
          "the registration is the rehearsal's own: it registers what it measured, in the same process that measured it",
          "packages.<arm>.exportBytes is the size of the provisioned copy, twice, not the size of an exported package",
        ],
      };
    },
    async launch({ arm, lane }) {
      const ran = run({ prepared, arm, lane });
      const read = await readReport(ran.reportFile, ran.log);
      return {
        report: read.report,
        exitCode: ran.process.exitCode,
        signal: ran.result.signal,
        // spawnSync's timeout kills the process with SIGTERM and sets `error.code` to ETIMEDOUT.
        timedOut: ran.result.error?.code === "ETIMEDOUT",
        log: read.log,
        load: ran.load,
        hashes: { binary: prepared.binarySha256, package: prepared.package.sha256, script: prepared.scripts.sha256 },
        seconds: ran.seconds,
      };
    },
    async cleanup() {
      await prepared?.harness.cleanup();
    },
  };
}
