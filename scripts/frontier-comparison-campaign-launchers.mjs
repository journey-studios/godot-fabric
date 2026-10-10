import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { root } from "./consumer-harness.mjs";
import { goldenReplayHash } from "./frontier-comparison-run-campaign.mjs";
import { launchScenario, prepareProject, registeredOf } from "./frontier-comparison-run.mjs";

// The launchers of the comparative campaign (V05-10, `execucao`, part 2): what runs one execution, behind an interface the campaign does not look through.
//
//   launcher.build                       "debug" or "release": the build recorded in each execution (the protocol accepts only "release")
//   launcher.name                        what the launcher is, for the record
//   launcher.windowed                    whether its processes run in a window or headless: the instrument's self-check runs in the same mode, with the launcher's engine
//   await launcher.prepare()             {engine, registered, packages, deviations}: gets everything ready and says what the campaign registers (the hashes of the binary, the package
//                                        and the script of each arm, the seed, the game's hashes and the instrument's file), the sizes of the packages, and each way in which this launcher
//                                        deviates from the protocol. It may refuse: the Release launcher does.
//   await launcher.launch({arm, lane, slot, attempt})
//                                        runs ONE fresh process of the scenario and returns {report, exitCode, signal, log, load: {before, after}, hashes: {binary, package, script}, seconds}:
//                                        `report` is the scenario's report (null when the process wrote none), the load is the 1-minute average read right before the process starts and right
//                                        after it ends, and the hashes are those of the files the process ran. The campaign adds the protocol's hash and judges everything.
//   await launcher.cleanup()
//
// The Debug launcher is the part 1 rehearsal's own: a provisioned copy of civ-lite, the scenario copied into it and the engine's executable, run with `--path`. The Release launcher is an
// extension point that refuses until V05-07 says how the scenario runs inside an exported package. A fake launcher in the tests plays programmable executions.

export const RELEASE_REFUSAL = [
  "The Release launcher is not defined yet: the campaign needs the Release export of the civ-lite game in the three arms (V05-07, the macOS export), and that slice has not said how the scenario",
  "(tests/frontier-comparison-scenario.gd, a SceneTree script run with `-s`) runs inside an exported .app, where an export template may not run `-s`. Nothing was run and no campaign directory was made.",
  "Until V05-07 defines the path, use `--build debug --rehearsal` for a rehearsal of the campaign.",
].join(" ");

export function createReleaseLauncher() {
  const refuse = () => {
    throw new Error(RELEASE_REFUSAL);
  };
  return { build: "release", name: "release (V05-07: not defined)", windowed: true, prepare: refuse, launch: refuse, cleanup: async () => undefined };
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
      const report = existsSync(ran.reportFile) ? JSON.parse(await readFile(ran.reportFile, "utf8")) : null;
      return {
        report,
        exitCode: ran.process.exitCode,
        signal: ran.result.signal,
        log: ran.log,
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
