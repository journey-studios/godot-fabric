import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { root } from "./consumer-harness.mjs";
import { sha256 } from "./frontier-comparison-run-campaign.mjs";
import { scriptsOf } from "./frontier-comparison-run.mjs";
import { ensureGodotBinary } from "./godot-binary.mjs";

// The probe project of the instrument's self-check (V05-10, `execucao`): a small Godot project that runs the instrument's probe (tests/cpu-time-instrument-probe.gd) as its MAIN LOOP, the way the
// scenario enters the measurement project (docs/research/frontier-comparison-entry.md). An export template discards `-s`/`--script` and aborts on `--path`, so the probe cannot be started from the
// command line there; as the main loop of a project it can, in the editor's binary with `--path` and, once the project is exported, in a `.app`.
//
//   project.godot                                      the name, `config_version=5` and the renderer of civ-lite and of the repository's own project (`gl_compatibility`); no main scene
//   tests/cpu-time-instrument-probe.gd                 the probe, copied at its own path (it preloads `res://tests/cpu-time-instrument.gd`)
//   tests/cpu-time-instrument.gd                       the instrument the probe vouches for, copied at its own path: its SHA-256 is the repository's
//   tests/cpu-time-instrument-probe-entry.gd           `class_name CpuTimeInstrumentProbeEntry` and `extends "cpu-time-instrument-probe.gd"` (the probe, by its relative name): the main loop's class
//   tests/cpu-time-instrument-probe-empty.tscn         the main scene: one empty `Node`
//   override.cfg                                       `run/main_scene` (the empty scene) and `run/main_loop_type` (the entry class), as the measurement project's
//
// The texts the project writes are constants here, so they are in the hashes that `prepareProbeProject` returns. The entry class is new to the project, so the editor's `--import` runs once at the end:
// it fills `.godot/global_script_class_cache.cfg`, where the engine finds a main loop by its class name. The probe takes `--report=<absolute path>` and writes there, as an exported project's `res://`
// is read-only.

export const PROBE_FILE = "tests/cpu-time-instrument-probe.gd";
export const INSTRUMENT_FILE = "tests/cpu-time-instrument.gd";
export const OVERRIDE_FILE = "override.cfg";
export const ENTRY_CLASS = "CpuTimeInstrumentProbeEntry";
const ENTRY_FILE = "tests/cpu-time-instrument-probe-entry.gd";
const EMPTY_SCENE_FILE = "tests/cpu-time-instrument-probe-empty.tscn";
const COPIED_FILES = [PROBE_FILE, INSTRUMENT_FILE];
const IMPORT_TIMEOUT_MS = 180000;

// What the project writes by path, as text.
export const PROBE_PROJECT_FILES = {
  "project.godot": 'config_version=5\n\n[application]\n\nconfig/name="Frontier instrument probe"\n\n[rendering]\n\nrenderer/rendering_method="gl_compatibility"\n',
  [ENTRY_FILE]: `class_name ${ENTRY_CLASS}\nextends "cpu-time-instrument-probe.gd"\n`,
  [EMPTY_SCENE_FILE]: '[gd_scene format=3]\n\n[node name="CpuTimeInstrumentProbeEmpty" type="Node"]\n',
  [OVERRIDE_FILE]: `config_version=5\n\n[application]\n\nrun/main_scene="res://${EMPTY_SCENE_FILE}"\nrun/main_loop_type="${ENTRY_CLASS}"\n`,
};

// Prepares the probe project in `directory`, which is new (absent or empty): copies the probe and the instrument, writes the other files and imports the project with `engine` (the editor's binary by
// default; `run` is spawnSync's shape, injectable for the tests). Returns the project's directory, the engine, every file by project-relative path with its absolute path and SHA-256 (hashed from
// the copy in the project), `instrumentSha256`, which is the repository's, and `scripts` ({files, sha256}, as `scriptsOf` gives for an export's manifest).
export async function prepareProbeProject(directory, { engine, run = spawnSync } = {}) {
  const project = path.resolve(directory);
  await mkdir(project, { recursive: true });
  if ((await readdir(project)).length > 0) {
    throw new Error(`the probe project needs a new directory, and ${project} is not empty`);
  }
  for (const file of COPIED_FILES) {
    await mkdir(path.dirname(path.join(project, file)), { recursive: true });
    await copyFile(path.join(root, file), path.join(project, file));
  }
  for (const [file, content] of Object.entries(PROBE_PROJECT_FILES)) {
    await mkdir(path.dirname(path.join(project, file)), { recursive: true });
    await writeFile(path.join(project, file), content);
  }
  const files = {};
  for (const file of [...COPIED_FILES, ...Object.keys(PROBE_PROJECT_FILES)]) {
    files[file] = { path: path.join(project, file), sha256: sha256(await readFile(path.join(project, file))) };
  }
  const repositorySha256 = sha256(await readFile(path.join(root, INSTRUMENT_FILE)));
  if (files[INSTRUMENT_FILE].sha256 !== repositorySha256) {
    throw new Error(`the instrument in the probe project (${files[INSTRUMENT_FILE].sha256}) is not the repository's (${repositorySha256})`);
  }
  const godot = engine ?? (await ensureGodotBinary());
  const imported = run(godot, ["--path", project, "--headless", "--import"], { encoding: "utf8", timeout: IMPORT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
  if (imported.status !== 0) {
    throw new Error(`the import of the probe project ended with ${imported.status === null ? `signal ${imported.signal}` : `exit ${imported.status}`}:\n${(imported.stdout ?? "") + (imported.stderr ?? "")}`);
  }
  return {
    directory: project,
    engine: godot,
    files,
    instrumentSha256: files[INSTRUMENT_FILE].sha256,
    scripts: scriptsOf(Object.fromEntries(Object.entries(files).map(([file, entry]) => [file, entry.sha256]))),
  };
}
