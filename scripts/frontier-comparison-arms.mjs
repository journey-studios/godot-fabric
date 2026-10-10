import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { MEASUREMENT_FILES } from "./frontier-comparison-run.mjs";

// The project of each arm of the comparison (V05-10, criterion `execucao`; docs/research/frontier-comparison-entry.md, "The projects of the arms").
//
// Arms A (no HUD, main_bare.tscn) and B (the HUD in GDScript, main_native.tscn) are built WITHOUT the Fabric extension: no addons/godot_fabric (the addon, the .gdextension, the host and the
// Hermes and React Native frameworks). The protocol reads the price of each HUD in package size as C - A and B - A, and loading the extension would also enter the execution measures of A and B.
// Only C (main.tscn) carries it. This file describes those projects (`armProject`, pure) and applies the description to a provisioned copy (`shapeArmProject`). It does not
// export the game: that is a function of scripts/macos-export.mjs, which takes the directory this one prepares.
//
// The filters are written the way export_presets.cfg writes include_filter and exclude_filter: globs relative to res://, separated by commas.

const ADDON = "addons/godot_fabric";
// What the extension and C's HUD leave in a copy that was provisioned and built with them: the list of extensions the editor keeps (the import regenerates it) and the build output of the HUD
// (app.js and its assets, in a hidden folder). Neither belongs to A or B, and a list that names a folder that is gone makes the next import report it.
const FABRIC_ARTIFACTS = [".godot/extension_list.cfg", ".godot_fabric"];
// The sections of the product's project.godot that exist only for the extension: the editor plugin that enables it and the application's settings.
const FABRIC_SECTIONS = ["editor_plugins", "godot_fabric"];
const MAIN_SCENE_SETTING = "run/main_scene";
const PROJECT_FILE = "project.godot";
const MAIN_SCENES = { A: "res://main_bare.tscn", B: "res://main_native.tscn", C: "res://main.tscn" };
// What the measurement project adds to the product, as a filter names it: a folder (`comparison/*`) or a file (`override.cfg`), read off the files the runner writes into the copy.
const MEASUREMENT_ENTRIES = [...new Set(Object.keys(MEASUREMENT_FILES).map((file) => (file.includes("/") ? `${file.slice(0, file.indexOf("/"))}/*` : file)))];

const filterOf = (entries) => entries.join(", ");

// The project of an arm: its main scene (the product's), whether it carries the extension, and the export filters of the product (the package the size axis reads: no measurement files) and of
// the measurement project (the product plus `comparison/` and `override.cfg`, whose settings override the main scene and the main loop).
export function armProject(arm) {
  if (typeof arm !== "string" || !Object.hasOwn(MAIN_SCENES, arm)) {
    throw new Error(`unknown arm ${JSON.stringify(arm)}: the arms are ${Object.keys(MAIN_SCENES).join(", ")}`);
  }
  const fabric = arm === "C";
  const withoutFabric = fabric ? [] : [`${ADDON}/*`];
  return {
    arm,
    mainScene: MAIN_SCENES[arm],
    fabric,
    product: { include: "", exclude: filterOf([...MEASUREMENT_ENTRIES, ...withoutFabric]) },
    measurement: { include: filterOf(MEASUREMENT_ENTRIES), exclude: filterOf(withoutFabric) },
  };
}

// project.godot is Godot's INI text. Its lines keep their endings, so that putting them back together gives the text byte for byte, and only the lines named are touched.
const linesOf = (text) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
const sectionNameOf = (line) => /^\[([^\]\r\n]+)\]\s*$/.exec(line)?.[1] ?? null;

// The sections of a text: where each starts (its header) and ends (the line of the next header, or the end of the text).
function sectionsOf(lines) {
  const sections = [];
  lines.forEach((line, index) => {
    const name = sectionNameOf(line);
    if (name !== null) {
      if (sections.length > 0) {
        sections[sections.length - 1].end = index;
      }
      sections.push({ name, start: index, end: lines.length });
    }
  });
  return sections;
}

// Removes the named sections, each with its lines up to the next header. A section that was last leaves the blank line that separated it from the one before: that goes too.
function withoutSections(lines, names) {
  const removed = sectionsOf(lines).filter((section) => names.includes(section.name));
  const dropped = new Set(removed.flatMap((section) => Array.from({ length: section.end - section.start }, (_, offset) => section.start + offset)));
  const kept = lines.filter((_, index) => !dropped.has(index));
  if (removed.some((section) => section.end === lines.length)) {
    while (kept.length > 0 && kept[kept.length - 1].trim() === "") {
      kept.pop();
    }
  }
  return { lines: kept, removed: removed.map((section) => section.name) };
}

// Writes `run/main_scene` in `[application]`, in the line that already holds it.
function withMainScene(lines, scene) {
  const application = sectionsOf(lines).find((section) => section.name === "application");
  const prefix = `${MAIN_SCENE_SETTING}=`;
  const index = application === undefined ? -1 : lines.findIndex((line, at) => at > application.start && at < application.end && line.startsWith(prefix));
  if (index === -1) {
    throw new Error(`${PROJECT_FILE} has no ${MAIN_SCENE_SETTING} in [application] to write`);
  }
  const ending = /\r?\n$/.exec(lines[index])?.[0] ?? "";
  const previous = lines[index].slice(prefix.length, lines[index].length - ending.length).trim();
  const result = [...lines];
  result[index] = `${prefix}"${scene}"${ending}`;
  return { lines: result, from: /^"(.*)"$/.exec(previous)?.[1] ?? previous };
}

// project.godot of an arm, from the text of the product's: without the extension's sections in A and B, and with the arm's main scene. Pure.
export function shapedProjectText(text, arm) {
  const project = armProject(arm);
  const stripped = project.fabric ? { lines: linesOf(text), removed: [] } : withoutSections(linesOf(text), FABRIC_SECTIONS);
  const scene = withMainScene(stripped.lines, project.mainScene);
  return { text: scene.lines.join(""), removedSections: stripped.removed, mainScene: { from: scene.from, to: project.mainScene } };
}

// Applies the description of an arm to a provisioned copy of the consumer: in A and B the addon folder, the extension's sections of project.godot and the artifacts of the extension and of C's
// HUD (`FABRIC_ARTIFACTS`) go, in every arm the product's main scene is written, and with `measurement` the files of the measurement project are written (`MEASUREMENT_FILES`; their
// override.cfg overrides the scene and the main loop). Nothing else of the copy is touched, and the measurement files are never removed: a product is shaped from a copy that never had them.
// Returns what changed.
export async function shapeArmProject(directory, arm, { measurement = false } = {}) {
  const project = armProject(arm);
  const projectFile = path.join(directory, PROJECT_FILE);
  const shaped = shapedProjectText(await readFile(projectFile, "utf8"), arm);
  await writeFile(projectFile, shaped.text);
  const removedArtifacts = [];
  let removedAddon = false;
  if (!project.fabric) {
    const addon = path.join(directory, ADDON);
    removedAddon = await lstat(addon).then(() => true, () => false);
    await rm(addon, { recursive: true, force: true });
    for (const artifact of FABRIC_ARTIFACTS) {
      if (await lstat(path.join(directory, artifact)).then(() => true, () => false)) {
        removedArtifacts.push(artifact);
      }
      await rm(path.join(directory, artifact), { recursive: true, force: true });
    }
  }
  const written = [];
  if (measurement) {
    for (const [file, content] of Object.entries(MEASUREMENT_FILES)) {
      await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
      await writeFile(path.join(directory, file), content);
      written.push(file);
    }
  }
  return { arm, mainScene: shaped.mainScene, removedSections: shaped.removedSections, removedAddon, removedArtifacts, measurementFiles: written };
}
