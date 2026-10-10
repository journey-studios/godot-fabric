import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { armProject, shapeArmProject, shapedProjectText } from "../scripts/frontier-comparison-arms.mjs";
import { digest, MEASUREMENT_FILES } from "../scripts/frontier-comparison-run.mjs";

// The projects of the arms of the comparison (V05-10, `execucao`), Node only: the description of each arm, its export filters, and the edit of a copy's project.godot, tried on the text of the
// real consumers/civ-lite/project.godot. That A and B run the whole script on a copy without the Fabric extension is tests/frontier-comparison-arms-native.test.mjs.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const civLite = readFileSync(path.join(root, "consumers", "civ-lite", "project.godot"), "utf8");
const FABRIC_PART = civLite.slice(civLite.indexOf("[editor_plugins]") - 1);
const exists = (file) => stat(file).then(() => true, () => false);

// What Godot's `String::match` does with a filter's glob: `*` stands for any run of characters (slashes too) and `?` for one. The filters are tried against paths relative to res://.
const globOf = (pattern) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*").replaceAll("?", ".")}$`);
const filtered = (filter, file) => filter.split(",").map((pattern) => pattern.trim()).filter((pattern) => pattern !== "").some((pattern) => globOf(pattern).test(file));

// What the editor run that builds C's HUD leaves in a copy besides the addon: the list of extensions and the HUD's build output, and the engine's own cache, which is not Fabric's.
const FABRIC_ARTIFACT_FILES = [".godot/extension_list.cfg", ".godot_fabric/app.js", ".godot_fabric/assets/ui/icons/city.png"];
const ENGINE_CACHE_FILES = [".godot/global_script_class_cache.cfg"];
const FABRIC_FILES = ["addons/godot_fabric/plugin.cfg", "addons/godot_fabric/godot_fabric.gdextension", "addons/godot_fabric/bin/libgodot_fabric.dylib", "addons/godot_fabric/frameworks/hermes.framework/hermes"];

test("each arm has its product's main scene, and only C carries the extension", () => {
  assert.deepEqual(armProject("A"), {
    arm: "A",
    mainScene: "res://main_bare.tscn",
    fabric: false,
    product: { include: "", exclude: "comparison/*, override.cfg, addons/godot_fabric/*" },
    measurement: { include: "comparison/*, override.cfg", exclude: "addons/godot_fabric/*" },
  });
  assert.deepEqual(armProject("B"), {
    arm: "B",
    mainScene: "res://main_native.tscn",
    fabric: false,
    product: { include: "", exclude: "comparison/*, override.cfg, addons/godot_fabric/*" },
    measurement: { include: "comparison/*, override.cfg", exclude: "addons/godot_fabric/*" },
  });
  assert.deepEqual(armProject("C"), {
    arm: "C",
    mainScene: "res://main.tscn",
    fabric: true,
    product: { include: "", exclude: "comparison/*, override.cfg" },
    measurement: { include: "comparison/*, override.cfg", exclude: "" },
  });
});

test("an unknown arm is refused, by the description and by the function that shapes a copy, before anything is touched", async () => {
  for (const arm of ["D", "a", "", "AB", undefined, null, 1, "toString", "__proto__", "constructor"]) {
    assert.throws(() => armProject(arm), /unknown arm .*the arms are A, B, C/, String(arm));
  }
  const directory = await mkdtemp(path.join(tmpdir(), "frontier-comparison-arms-refused-"));
  try {
    await writeFile(path.join(directory, "project.godot"), civLite);
    await assert.rejects(shapeArmProject(directory, "D", { measurement: true }), /unknown arm "D"/);
    assert.equal(await readFile(path.join(directory, "project.godot"), "utf8"), civLite);
    assert.equal(await exists(path.join(directory, "override.cfg")), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the filters keep the measurement files out of the product, and the extension out of A and B", () => {
  const measurementFiles = Object.keys(MEASUREMENT_FILES);
  assert.deepEqual(measurementFiles.map((file) => file.split("/")[0]).sort(), ["comparison", "comparison", "override.cfg"], "the filters are read off the files the runner writes");
  for (const arm of ["A", "B", "C"]) {
    const { product, measurement } = armProject(arm);
    for (const file of measurementFiles) {
      assert.equal(filtered(product.exclude, file), true, `${arm}: the product leaves out ${file}`);
      assert.equal(filtered(product.include, file), false);
      assert.equal(filtered(measurement.include, file), true, `${arm}: the measurement project includes ${file}`);
      assert.equal(filtered(measurement.exclude, file), false, `${arm}: the measurement project keeps ${file}`);
    }
    for (const file of ["project.godot", "main.tscn", "main_bare.tscn", "main_native.tscn", "game/rules.gd", "services/game_services.gd", "native_hud/hud.gd", "ui/application.tres"]) {
      assert.equal(filtered(product.exclude, file), false, `${arm}: the product keeps ${file}`);
      assert.equal(filtered(measurement.exclude, file), false, `${arm}: the measurement project keeps ${file}`);
    }
    const carries = arm === "C";
    for (const file of FABRIC_FILES) {
      assert.equal(filtered(product.exclude, file), !carries, `${arm}: the product ${carries ? "keeps" : "leaves out"} ${file}`);
      assert.equal(filtered(measurement.exclude, file), !carries, `${arm}: the measurement project ${carries ? "keeps" : "leaves out"} ${file}`);
    }
    for (const filter of [product.include, product.exclude, measurement.include, measurement.exclude]) {
      assert.ok(filter === "" || filter.split(", ").every((pattern) => pattern !== "" && !pattern.includes(",") && pattern === pattern.trim()), `a filter in the syntax of the preset: ${filter}`);
    }
  }
});

test("the real project.godot of civ-lite is the shape the edit expects", () => {
  assert.equal(civLite.split(`run/main_scene="res://main.tscn"`).length, 2);
  assert.equal(FABRIC_PART, '\n[editor_plugins]\nenabled=PackedStringArray("res://addons/godot_fabric/plugin.cfg")\n\n[godot_fabric]\napplication="res://ui/application.tres"\n');
});

test("A and B lose the two sections of the extension and take their main scene, and the rest of the real project.godot is the same bytes", () => {
  for (const [arm, scene] of [["A", "res://main_bare.tscn"], ["B", "res://main_native.tscn"]]) {
    const shaped = shapedProjectText(civLite, arm);
    assert.deepEqual(shaped.removedSections, ["editor_plugins", "godot_fabric"]);
    assert.deepEqual(shaped.mainScene, { from: "res://main.tscn", to: scene });
    const expected = civLite.slice(0, civLite.length - FABRIC_PART.length).replace('run/main_scene="res://main.tscn"', `run/main_scene="${scene}"`);
    assert.equal(shaped.text, expected);
    assert.doesNotMatch(shaped.text, /godot_fabric|editor_plugins|ui\/application/);
    assert.equal(shaped.text.endsWith('Color(0.035, 0.047, 0.075, 1)\n'), true, "the file ends where its last kept section ends, with no blank line left behind");
  }
});

test("C keeps the project.godot it has, byte for byte, because its main scene already is main.tscn", () => {
  const shaped = shapedProjectText(civLite, "C");
  assert.equal(shaped.text, civLite);
  assert.deepEqual(shaped.removedSections, []);
  assert.deepEqual(shaped.mainScene, { from: "res://main.tscn", to: "res://main.tscn" });
  assert.equal(shapedProjectText(civLite.replace("main.tscn", "main_native.tscn"), "C").text, civLite, "C takes its main scene back");
});

test("the edit is idempotent, and it touches nothing but the sections it names", () => {
  const once = shapedProjectText(civLite, "A");
  const twice = shapedProjectText(once.text, "A");
  assert.equal(twice.text, once.text);
  assert.deepEqual(twice.removedSections, []);
  assert.deepEqual(twice.mainScene, { from: "res://main_bare.tscn", to: "res://main_bare.tscn" });
  // A section in the middle, comments, a value that looks like a header, a repeated section, windows line endings and the lack of a last newline.
  const text = ["config_version=5", "", "[godot_fabric]", "application=\"res://ui/application.tres\"", "", "[application]", "; the main scene", "run/main_scene=\"res://main.tscn\"", "config/note=\"[editor_plugins]\"", "", "[editor_plugins]", "enabled=true", "", "[godot_fabric]", "again=1", "", "[display]", "window/size/viewport_width=1080"].join("\r\n");
  const shaped = shapedProjectText(text, "B");
  assert.deepEqual(shaped.removedSections, ["godot_fabric", "editor_plugins", "godot_fabric"]);
  assert.equal(shaped.text, ["config_version=5", "", "[application]", "; the main scene", "run/main_scene=\"res://main_native.tscn\"", "config/note=\"[editor_plugins]\"", "", "[display]", "window/size/viewport_width=1080"].join("\r\n"));
});

test("a project.godot without a main scene to write is refused, and so is one without the section", () => {
  assert.throws(() => shapedProjectText("config_version=5\n\n[application]\nconfig/name=\"x\"\n", "A"), /no run\/main_scene in \[application\] to write/);
  assert.throws(() => shapedProjectText("config_version=5\n\n[display]\nrun/main_scene=\"res://x.tscn\"\n", "A"), /no run\/main_scene in \[application\] to write/);
  assert.throws(() => shapedProjectText("", "C"), /no run\/main_scene in \[application\] to write/);
});

// A copy as the harness provisions it and the editor builds it, in the part that matters here: the project, the addon with its files, the artifacts of the extension and of the HUD, and the game.
async function provisionedCopy() {
  const directory = await mkdtemp(path.join(tmpdir(), "frontier-comparison-arms-"));
  await writeFile(path.join(directory, "project.godot"), civLite);
  for (const file of [...FABRIC_FILES, ...FABRIC_ARTIFACT_FILES, ...ENGINE_CACHE_FILES, "main.tscn", "main_bare.tscn", "main_native.tscn", "game/rules.gd", "ui/application.tres"]) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await writeFile(path.join(directory, file), `${file}\n`);
  }
  return directory;
}

test("shaping a copy for A or B removes the addon, the artifacts of the extension and the sections, writes the scene and the measurement files, and says what it did", async () => {
  const directory = await provisionedCopy();
  try {
    const before = await digest(directory);
    const result = await shapeArmProject(directory, "A", { measurement: true });
    assert.deepEqual(result, {
      arm: "A",
      mainScene: { from: "res://main.tscn", to: "res://main_bare.tscn" },
      removedSections: ["editor_plugins", "godot_fabric"],
      removedAddon: true,
      removedArtifacts: [".godot/extension_list.cfg", ".godot_fabric"],
      measurementFiles: Object.keys(MEASUREMENT_FILES),
    });
    assert.equal(await exists(path.join(directory, "addons", "godot_fabric")), false);
    assert.equal(await exists(path.join(directory, ".godot_fabric")), false);
    assert.equal(await exists(path.join(directory, ".godot", "extension_list.cfg")), false);
    assert.equal(await readFile(path.join(directory, ".godot", "global_script_class_cache.cfg"), "utf8"), ".godot/global_script_class_cache.cfg\n", "the engine's own cache stays");
    assert.equal(await readFile(path.join(directory, "project.godot"), "utf8"), shapedProjectText(civLite, "A").text);
    for (const [file, content] of Object.entries(MEASUREMENT_FILES)) {
      assert.equal(await readFile(path.join(directory, file), "utf8"), content);
    }
    // The game is as it was: the tree is the same but for project.godot, the addon, the artifacts and the files written.
    const after = await digest(directory);
    assert.equal(after.files, before.files - FABRIC_FILES.length - FABRIC_ARTIFACT_FILES.length + Object.keys(MEASUREMENT_FILES).length);
    for (const file of ["main.tscn", "main_bare.tscn", "main_native.tscn", "game/rules.gd", "ui/application.tres"]) {
      assert.equal(await readFile(path.join(directory, file), "utf8"), `${file}\n`);
    }
    // Shaped again, for B: nothing of the extension is left to remove, and the scene is B's.
    const again = await shapeArmProject(directory, "B", { measurement: true });
    assert.deepEqual(again, {
      arm: "B",
      mainScene: { from: "res://main_bare.tscn", to: "res://main_native.tscn" },
      removedSections: [],
      removedAddon: false,
      removedArtifacts: [],
      measurementFiles: Object.keys(MEASUREMENT_FILES),
    });
    assert.match(await readFile(path.join(directory, "project.godot"), "utf8"), /run\/main_scene="res:\/\/main_native\.tscn"/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("shaping a copy for C without the measurement changes nothing, and shaping it for B without the measurement writes no measurement file", async () => {
  const directory = await provisionedCopy();
  try {
    const before = await digest(directory);
    assert.deepEqual(await shapeArmProject(directory, "C"), { arm: "C", mainScene: { from: "res://main.tscn", to: "res://main.tscn" }, removedSections: [], removedAddon: false, removedArtifacts: [], measurementFiles: [] });
    assert.deepEqual(await digest(directory), before);
    const shaped = await shapeArmProject(directory, "B");
    assert.equal(shaped.removedAddon, true);
    assert.deepEqual(shaped.removedArtifacts, [".godot/extension_list.cfg", ".godot_fabric"]);
    assert.deepEqual(shaped.measurementFiles, []);
    assert.equal(await exists(path.join(directory, "override.cfg")), false);
    assert.equal(await exists(path.join(directory, "comparison")), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
