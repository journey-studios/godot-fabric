import { readFileSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MANIFEST_FILE, MANIFEST_FORMAT } from "../scripts/frontier-comparison-release.mjs";
import { sha256 } from "../scripts/frontier-comparison-run-campaign.mjs";
import { scriptsOf } from "../scripts/frontier-comparison-run.mjs";

// The fake Release exports of the launcher's tests (V05-10, `execucao`, part 2): <directory>/A, B and C, each with a `.app` that has a Contents/MacOS/<executable> and a Contents/Resources/<name>.pck,
// and the manifest beside it (scripts/frontier-comparison-release.mjs) with the real hashes of those files. The executable is a script that does what the Godot scenario's process does at its
// edges and nothing else: it reads the arguments after `--`, appends the arguments and its working directory to a log of launches (so a test sees what was run, with what, where, and that
// nothing was), writes a minimal report to `--out`, prints a line and exits. A program says what it does (`sleepMs` to be killed at a timeout, `exitCode`, `log`, `report`: an object written as it
// is, `null` for none; absent, a report that holds only the format, the arm and the lane; `rawReport`: a text written to `--out` as it is, for a report that is not JSON). Nothing here was measured, and no number of it says anything about an arm.

const SCENARIO_FORMAT = "godot-fabric.frontier-comparison-scenario/v1";
const INSTRUMENT_FILE = "tests/cpu-time-instrument.gd";
const instrumentFile = fileURLToPath(new URL(`../${INSTRUMENT_FILE}`, import.meta.url));
const FAKE_ARMS = ["A", "B", "C"];

// The script of the fake executable. `process.getBuiltinModule` serves a file that Node reads as CommonJS or as a module alike (an extensionless file takes the type of the package around it).
const executableOf = (arm, program, launches) => `#!/usr/bin/env node
// The fake executable of arm ${arm}.
const fs = process.getBuiltinModule("node:fs");
const program = { exitCode: 0, sleepMs: 0, log: "FRONTIER_COMPARISON_SCENARIO_DONE\\n", ...${JSON.stringify(program)} };
const args = process.argv.slice(2);
const option = (name) => args.find((argument) => argument.startsWith("--" + name + "="))?.slice(name.length + 3);
fs.appendFileSync(${JSON.stringify(launches)}, JSON.stringify({ arguments: args, cwd: process.cwd() }) + "\\n");
setTimeout(() => {
  const report = "report" in program ? program.report : { format: ${JSON.stringify(SCENARIO_FORMAT)}, arm: option("arm"), lane: option("lane"), fake: true };
  if ("rawReport" in program) {
    fs.writeFileSync(option("out"), program.rawReport);
  } else if (report !== null) {
    fs.writeFileSync(option("out"), JSON.stringify(report));
  }
  process.stdout.write(program.log);
  process.exit(program.exitCode);
}, program.sleepMs);
`;

// The exports of arms A, B and C under `<parent>/exports`, and the log of launches `<parent>/launches.jsonl` (each fake executable appends to it). `programs` maps an arm to the program of its
// executable. Returns where everything is: {directory, launchesFile, launches(), apps: {A: {manifestFile, app, executable, pck}, ...}}.
export async function createFakeExports(parent, { programs = {} } = {}) {
  const directory = path.join(parent, "exports");
  const launchesFile = path.join(parent, "launches.jsonl");
  const instrumentSha256 = sha256(readFileSync(instrumentFile));
  const apps = {};
  for (const arm of FAKE_ARMS) {
    const name = `civ-${arm.toLowerCase()}`;
    const folder = path.join(directory, arm);
    const app = path.join(folder, `${name}.app`);
    const executable = path.join(app, "Contents", "MacOS", name);
    const pck = path.join(app, "Contents", "Resources", `${name}.pck`);
    await mkdir(path.dirname(executable), { recursive: true });
    await mkdir(path.dirname(pck), { recursive: true });
    const script = executableOf(arm, programs[arm] ?? {}, launchesFile);
    const bytes = `fake package of arm ${arm}\n`;
    await writeFile(executable, script);
    await chmod(executable, 0o755);
    await writeFile(pck, bytes);
    const scriptFiles = {
      "tests/frontier-comparison-scenario.gd": sha256("fake scenario"),
      [INSTRUMENT_FILE]: instrumentSha256,
      "override.cfg": sha256("fake override"),
    };
    const manifestFile = path.join(folder, MANIFEST_FILE);
    const manifest = {
      format: MANIFEST_FORMAT,
      arm,
      app: `${name}.app`,
      executable: `${name}.app/Contents/MacOS/${name}`,
      pck: `${name}.app/Contents/Resources/${name}.pck`,
      binarySha256: sha256(script),
      packageSha256: sha256(bytes),
      scriptSha256: scriptsOf(scriptFiles).sha256,
      scriptFiles,
      godot: "4.7.2.stable.fake",
      templateSha256: sha256("fake template"),
      exportBytes: [bytes.length, bytes.length],
    };
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    apps[arm] = { manifestFile, app, executable, pck };
  }
  return {
    directory,
    launchesFile,
    apps,
    // The launches so far: {arguments, cwd} of each, in order ([] when nothing ever ran).
    async launches() {
      try {
        return (await readFile(launchesFile, "utf8")).trimEnd().split("\n").map((line) => JSON.parse(line));
      } catch (error) {
        if (error.code === "ENOENT") {
          return [];
        }
        throw error;
      }
    },
  };
}

// Rewrites the manifest of `arm`: `edit` receives the parsed manifest and changes it in place.
export async function editManifest(exports, arm, edit) {
  const manifest = JSON.parse(await readFile(exports.apps[arm].manifestFile, "utf8"));
  edit(manifest);
  await writeFile(exports.apps[arm].manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
}
