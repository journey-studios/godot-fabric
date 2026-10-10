import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { MEASUREMENT_FILES } from "./frontier-comparison-run.mjs";

// The project of each arm of the comparison (V05-10, criterion `execucao`; docs/research/frontier-comparison-entry.md, "The projects of the arms" and "The measurement exports").
//
// Arms A (no HUD, main_bare.tscn) and B (the HUD in GDScript, main_native.tscn) are built WITHOUT the Fabric extension: no addons/godot_fabric (the addon, the .gdextension, the host and the
// Hermes and React Native frameworks). The protocol reads the price of each HUD in package size as C - A and B - A, and loading the extension would also enter the execution measures of A and B.
// Only C (main.tscn) carries it. This file describes those projects (`armProject`, pure) and applies the description to a provisioned copy (`shapeArmProject`). It does not export the game: that is
// `exportPreparedProject` of scripts/macos-export.mjs, which scripts/frontier-comparison-measurement-export.mjs calls with the options this file describes.
//
// An arm is exported with the "scenes" filter: its scene and what the scene FILES reference. Godot's scenes mode does not follow the `preload()` calls of scripts, and it ignores the entries of
// `exportFiles` that are not scenes, so the scripts and files an arm loads that its scene files do not attach are named by the include filter, the way export_presets.cfg writes it: globs
// relative to res://, separated by commas. Every pattern has the reason it is there, and was put there because the arm failed or changed its report without it.

const ADDON = "addons/godot_fabric";
// What the extension and C's HUD leave in a copy that was provisioned and built with them: the list of extensions the editor keeps (the import regenerates it) and the build output of the HUD
// (app.js and its assets, in a hidden folder). Neither belongs to A or B, and a list that names a folder that is gone makes the next import report it.
const FABRIC_ARTIFACTS = [".godot/extension_list.cfg", ".godot_fabric"];
// The sections of the product's project.godot that exist only for the extension: the editor plugin that enables it and the application's settings.
const FABRIC_SECTIONS = ["editor_plugins", "godot_fabric"];
const MAIN_SCENE_SETTING = "run/main_scene";
const PROJECT_FILE = "project.godot";
const MAIN_SCENES = { A: "res://main_bare.tscn", B: "res://main_native.tscn", C: "res://main.tscn" };
// What each arm's include filter names, with why: [pattern, reason].
const GAME = ["game/*.gd", "the game's rules: the scripts of the scene (game_services.gd, world.gd) preload them, and a scene file does not name a script's preloads"];
const SERVICES = ["services/*.gd", "schema.gd and stress.gd, which game_services.gd preloads"];
const HUD_SCRIPTS = ["hud_*.gd", "the scene attaches hud_validation.gd, which extends res://hud_probe.gd by path, and that one preloads the readers (hud_reader*.gd)"];
const INCLUDES = {
  A: [GAME, SERVICES],
  B: [
    GAME,
    SERVICES,
    ["native_hud/*", "the HUD: hud.gd preloads its bar, menu and panel scenes (.tscn) and the kit and icons scripts, and the HUD's scene file attaches only hud.gd"],
    HUD_SCRIPTS,
    ["ui/icons/*", "native_hud/icons.gd preloads the six PNG icons of the HUD"],
  ],
  C: [
    GAME,
    SERVICES,
    HUD_SCRIPTS,
    ["stability_*.gd", "the scene attaches stability_validation.gd, which extends res://stability_judge.gd by path"],
    ["addons/godot_fabric/*.gdextension", "the extension's manifest, which no scene file references: the export copies the host into Contents/Frameworks only for a manifest it exports, and the engine loads no extension without it"],
    ["addons/godot_fabric/assets/fonts/*.ttf", "the fonts the host loads for text layout, by path, from res://addons/godot_fabric/assets/fonts: no scene file names them, and C's text has none without them"],
  ],
};
// What the measurement project adds to the product, as a filter names it: a folder (`comparison/*`) or a file (`override.cfg`), read off the files the runner writes into the copy.
const MEASUREMENT_ENTRIES = [...new Set(Object.keys(MEASUREMENT_FILES).map((file) => (file.includes("/") ? `${file.slice(0, file.indexOf("/"))}/*` : file)))];
// What the scenario itself loads, in every arm, that the product of an arm may not carry: its HUD helper preloads res://hud_probe.gd, in A too, where the product has no HUD script.
const MEASUREMENT_INCLUDES = [["hud_*.gd", "the scenario's HUD helper (frontier-comparison-hud.gd) preloads res://hud_probe.gd and, through it, the readers, in every arm"]];
// The empty main scene of the measurement project: the one scene among the files the runner writes. The scenes mode needs it by name, since only override.cfg points at it.
const EMPTY_SCENE = `res://${Object.keys(MEASUREMENT_FILES).find((file) => file.endsWith(".tscn"))}`;

const filterOf = (entries) => entries.join(", ");

// The project of an arm: its main scene (the product's), whether it carries the extension, the include patterns of its set with their reasons, and the options of `exportPreparedProject`
// ({exportFilter, exportFiles, includeFilter, excludeFilter, frameworks}) for the PRODUCT (the package the size axis reads: the arm's scene and its scripts, no measurement files) and for the
// MEASUREMENT project (the product plus the empty scene, `comparison/` and `override.cfg`, whose settings override the main scene and the main loop). `frameworks` is false in A and B (an app
// with no host and no frameworks) and true in C.
export function armProject(arm) {
  if (typeof arm !== "string" || !Object.hasOwn(MAIN_SCENES, arm)) {
    throw new Error(`unknown arm ${JSON.stringify(arm)}: the arms are ${Object.keys(MAIN_SCENES).join(", ")}`);
  }
  const fabric = arm === "C";
  const withoutFabric = fabric ? [] : [`${ADDON}/*`];
  const mainScene = MAIN_SCENES[arm];
  const patterns = INCLUDES[arm].map(([pattern]) => pattern);
  // What the measurement project adds to the arm's own patterns: the scenario's, unless the arm already has the pattern.
  const added = MEASUREMENT_INCLUDES.filter(([pattern]) => !patterns.includes(pattern));
  const measured = [...patterns, ...added.map(([pattern]) => pattern), ...MEASUREMENT_ENTRIES];
  return {
    arm,
    mainScene,
    fabric,
    includes: INCLUDES[arm].map(([pattern, why]) => ({ pattern, why })),
    measurementIncludes: added.map(([pattern, why]) => ({ pattern, why })),
    product: { exportFilter: "scenes", exportFiles: [mainScene], includeFilter: filterOf(patterns), excludeFilter: filterOf([...MEASUREMENT_ENTRIES, ...withoutFabric]), frameworks: fabric },
    measurement: {
      exportFilter: "scenes",
      exportFiles: [mainScene, EMPTY_SCENE],
      includeFilter: filterOf(measured),
      excludeFilter: filterOf(withoutFabric),
      frameworks: fabric,
    },
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
