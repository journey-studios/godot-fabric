import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {mkdir, readFile, readdir, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {createHarness} from "../scripts/consumer-harness.mjs";
import {exportPreparedProject} from "../scripts/macos-export.mjs";
import {shapeArmProject} from "../scripts/frontier-comparison-arms.mjs";
import {HOST_LIBRARY_NAME, appEntries} from "../scripts/macos-export-payload.mjs";

// V05-10 `execucao`: the `exportFiles` and `frameworks: false` options of exportPreparedProject, on the real thing. Frontier is prepared as arm A of the comparison would be
// (scripts/frontier-comparison-arms.mjs, shapeArmProject: no addon, no extension sections, main_bare.tscn as the main scene, no measurement files) and exported with the
// arm64 Release template as a signed .app with no frameworks, no host and only the files it selects. It is not run: that needs the measurement project, which is the next slice.
//
// It needs MACOS_EXPORT_TEMPLATE (the derived arm64 template ZIP, as npm run test:export:macos does) and is run with npm run test:export:options. Only one .app exists at a time
// (this disk is small), and each one is removed as soon as it was inspected.
//
// Three exports are made, in this order:
//   1. arm A with `exportFiles: ["res://main_bare.tscn"]` alone, to see what Godot's "scenes" mode takes: the scene and what its scene files reference (world.tscn, and the scripts they
//      attach), and nothing it only preloads;
//   2. arm A as the next slice exports it: the same scene, and the folders of the scripts the scene's scripts preload named by the include filter. This is the export judged;
//   3. the negative control: the same options over the copy WITH the addon (arm C, provisioned and built), which `frameworks: false` must refuse.
const root = fileURLToPath(new URL("..", import.meta.url));
const template = process.env.MACOS_EXPORT_TEMPLATE ? path.resolve(process.env.MACOS_EXPORT_TEMPLATE) : null;
const skip = template ? false : "MACOS_EXPORT_TEMPLATE is unset; the export requires the reviewed Godot arm64 Release template";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

const BUNDLE_IDENTIFIER = "org.journeystudios.godotfabric.exportoptions";
const SCENE = "res://main_bare.tscn";
// The GDScript that main_bare.tscn's scripts preload: Godot's "scenes" mode follows the references of scene files, not the preload() calls of scripts.
const SCRIPT_FOLDERS = "game/*.gd, services/*.gd";
// What Frontier's other arms are made of and arm A must not carry: the product's own scene (main.tscn, C), arm B's (main_native.tscn), the React Native HUD (ui/) and its GDScript
// twin (native_hud/).
const NOT_IN_A = [/^ui\//, /^native_hud\//, /(^|\/)main\.tscn/, /(^|\/)main_native\.tscn/, /export-[0-9a-f]+-main\.scn$/, /export-[0-9a-f]+-main_native\.scn$/];

function tool(command, args) {
  const result = spawnSync(command, args, {encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024});
  assert.equal(result.error, undefined, `${command} ${args.join(" ")}`);
  return {status: result.status, output: (result.stdout ?? "") + (result.stderr ?? "")};
}

// An export needs the desktop texture formats imported, which prepareCivLiteProject of scripts/macos-export.mjs writes for the Frontier export.
async function allowTextureExport(project) {
  const projectFile = path.join(project, "project.godot");
  const text = await readFile(projectFile, "utf8");
  assert.equal(text.split("[rendering]\n").length - 1, 1, "Frontier's rendering section changed unexpectedly");
  await writeFile(projectFile, text.replace("[rendering]\n", "[rendering]\ntextures/vram_compression/import_s3tc_bptc=true\ntextures/vram_compression/import_etc2_astc=true\n"));
}

// The names of what a PCK holds for a resource, in either of the forms the export writes it: the file itself, its remap, or its compiled script.
const holds = (paths, resource) => paths.includes(resource) || paths.includes(`${resource}.remap`) || paths.includes(resource.replace(/\.gd$/, ".gdc"));

function expectedFilesOfA(paths) {
  for (const resource of ["main_bare.tscn", "world/world.tscn", "world/world.gd", "services/game_services.gd"]) {
    assert.ok(holds(paths, resource), `the PCK of arm A must hold ${resource}`);
  }
  assert.ok(paths.some(name => /^\.godot\/exported\/\d+\/export-[0-9a-f]+-main_bare\.scn$/.test(name)), "the PCK holds the imported main_bare scene");
  for (const forbidden of NOT_IN_A) {
    assert.deepEqual(paths.filter(name => forbidden.test(name)), [], `the PCK of arm A must not hold ${forbidden}`);
  }
  assert.deepEqual(paths.filter(name => name.startsWith("addons/")), [], "no addon in the PCK of arm A");
}

test("arm A, without the Fabric extension, exports as a signed Release app with only its selected files, and the same options refuse a copy that has the addon", {skip}, async t => {
  const token = `${process.pid}-${Date.now()}-${randomUUID().slice(0, 6)}`;
  const outputDirectory = path.join(root, "build", "macos-export-options-native");
  await rm(outputDirectory, {recursive: true, force: true});
  await mkdir(path.join(outputDirectory, "staging"), {recursive: true});
  const harness = await createHarness({template: "civ-lite", name: `macos-export-options-${token}`});
  const receipt = {stages: []};
  t.after(async () => {
    // The engine member the export extracted to inspect the template, and the staged apps, are the big files of this lane; the rest of the diagnostic stays under build/.
    await rm(path.join(harness.directory, "template-engine"), {recursive: true, force: true});
    await rm(path.join(outputDirectory, "staging"), {recursive: true, force: true});
    await harness.cleanup();
  });
  const staging = name => path.join(outputDirectory, "staging", `${name}.app`);
  const report = {format: "godot-fabric.macos-export-options/v1", startedAt: new Date().toISOString(), templateSha256: sha256(await readFile(template)),
    exportFilter: "scenes", exportFiles: [SCENE], includeFilter: SCRIPT_FOLDERS};

  // The product's own project, provisioned as every export is, shaped as arm A: no addon, no extension sections, main_bare.tscn.
  await harness.provision();
  const shaped = await shapeArmProject(harness.project, "A");
  assert.equal(shaped.removedAddon, true);
  assert.deepEqual(shaped.removedSections, ["editor_plugins", "godot_fabric"]);
  assert.equal(shaped.mainScene.to, SCENE);
  await allowTextureExport(harness.project);
  assert.deepEqual((await readdir(path.join(harness.project, "addons"))), [], "arm A has no addon folder left");

  // 1. The scene alone.
  const sceneOnly = await exportPreparedProject({harness, template, staging: staging("scene-only"), bundleIdentifier: BUNDLE_IDENTIFIER, receipt,
    frameworks: false, exportFilter: "scenes", exportFiles: [SCENE]});
  assert.equal(sceneOnly.frameworks, false);
  const sceneOnlyPaths = sceneOnly.pack.paths;
  assert.equal(sceneOnly.pack.fabricAddonExcluded, true);
  for (const resource of ["main_bare.tscn", "world/world.tscn", "world/world.gd", "services/game_services.gd"]) {
    assert.ok(holds(sceneOnlyPaths, resource), `the scene's own references reach the PCK: ${resource}`);
  }
  // What Godot does not do: the scripts those scripts preload are not in the PCK, so a project selected by its scene alone is not complete.
  assert.deepEqual(sceneOnlyPaths.filter(name => name.startsWith("game/")), [], "Godot's scenes mode does not follow preload() calls");
  assert.deepEqual(sceneOnlyPaths.filter(name => name.startsWith("services/") && !name.startsWith("services/game_services.")), [], "nor the other scripts of services/");
  report.sceneOnly = {fileCount: sceneOnly.pack.fileCount, pckSHA256: sceneOnly.pck.sha256, paths: sceneOnlyPaths};
  await rm(staging("scene-only"), {recursive: true});

  // 2. Arm A as it is exported for the comparison.
  const exported = await exportPreparedProject({harness, template, staging: staging("arm-a"), bundleIdentifier: BUNDLE_IDENTIFIER, receipt, templateMember: receipt.templateMember,
    frameworks: false, exportFilter: "scenes", exportFiles: [SCENE], includeFilter: SCRIPT_FOLDERS});
  const app = exported.app.path;
  assert.equal(exported.frameworks, false);
  const preset = await readFile(path.join(harness.project, "export_presets.cfg"), "utf8");
  assert.ok(preset.includes('export_filter="scenes"\nexport_files=PackedStringArray("res://main_bare.tscn")\ninclude_filter="game/*.gd, services/*.gd"\n'), preset);

  // The signed app, on the files themselves.
  const verify = tool("/usr/bin/codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
  assert.equal(verify.status, 0, verify.output);
  assert.match(tool("/usr/bin/codesign", ["-dvv", app]).output, /Signature=adhoc/);
  const executable = exported.executable.path;
  assert.equal(tool("/usr/bin/lipo", ["-archs", executable]).output.trim(), "arm64");
  // No frameworks, no host, no Hermes or React Native anywhere in the bundle.
  const entries = await appEntries(app);
  assert.ok(!entries.includes("Contents/Frameworks/frameworks"), "no Contents/Frameworks/frameworks");
  assert.deepEqual(entries.filter(entry => path.posix.basename(entry) === HOST_LIBRARY_NAME), [], "no Fabric host");
  assert.deepEqual(entries.filter(entry => /hermes|ReactNative|fabric|\.gdextension/i.test(entry)), [], "nothing of Fabric, Hermes or React Native in the bundle");
  // The first line of otool -L names the file, whose path is this checkout's.
  const loads = tool("/usr/bin/otool", ["-arch", "arm64", "-L", executable]).output.split("\n").slice(1).join("\n");
  assert.ok(loads.includes("/usr/lib/libSystem.B.dylib"), loads);
  assert.doesNotMatch(loads, /hermes|ReactNative|fabric/i, "the executable links none of them");
  // The engine is the template's and says its version.
  assert.equal(exported.templateMemberSha256, receipt.templateMember.sha256);
  const version = tool(executable, ["--version"]);
  assert.equal(version.status, 0, version.output);
  assert.match(version.output.trim(), /^4\.7\.2\.stable(?:\.official\.[^\s]+)?$/);
  assert.equal(exported.engineVersion, version.output.trim());

  // The PCK: the scene, what it uses, and nothing of the other arms or of the extension.
  const paths = exported.pack.paths;
  assert.equal(exported.pack.fabricAddonExcluded, true);
  assert.equal(exported.pack.fileCount, paths.length);
  assert.equal(exported.pack.pckSHA256, exported.pck.sha256);
  expectedFilesOfA(paths);
  for (const resource of ["services/schema.gd", "services/stress.gd", "game/rules.gd", "game/game.gd", "game/canon.gd", "game/context.gd", "game/snapshot.gd", "game/world.gd"]) {
    assert.ok(holds(paths, resource), `the preloaded script is in the PCK: ${resource}`);
  }
  for (const name of paths) {
    assert.ok(sceneOnlyPaths.includes(name) || /^(game|services)\//.test(name), `the include filter added only scripts of game/ and services/: ${name}`);
  }
  assert.ok(sceneOnlyPaths.every(name => paths.includes(name)), "the include filter removed nothing the scene selected");
  report.armA = {app: {sha256: exported.app.sha256}, executable: {sha256: exported.executable.sha256}, pck: {sha256: exported.pck.sha256, fileCount: exported.pack.fileCount},
    presetSha256: exported.presetSha256, templateMemberSha256: exported.templateMemberSha256, engineVersion: exported.engineVersion, bundleIdentifier: BUNDLE_IDENTIFIER,
    appEntries: entries, paths, payloadCheck: receipt.payloadCheck, signature: "ad-hoc, codesign --verify --deep --strict"};
  await rm(staging("arm-a"), {recursive: true});

  // 3. The negative control: the copy WITH the addon, provisioned and built as a product (arm C) is not an export without frameworks.
  await rm(harness.project, {recursive: true});
  await harness.provision();
  const product = await shapeArmProject(harness.project, "C");
  assert.equal(product.removedAddon, false);
  await allowTextureExport(harness.project);
  await harness.editor("macos-export-options-editor");
  const refusal = await exportPreparedProject({harness, template, staging: staging("with-addon"), bundleIdentifier: BUNDLE_IDENTIFIER, receipt: {stages: []},
    templateMember: receipt.templateMember, frameworks: false, exportFilter: "scenes", exportFiles: [SCENE]}).then(() => null, error => error);
  assert.ok(refusal instanceof Error, "an export with frameworks: false of the copy that has the addon must be refused");
  assert.match(refusal.message, /the exported \.app does not hold exactly its payload \(without the Fabric extension \(frameworks: false\)\): /);
  assert.match(refusal.message, /Contents\/Frameworks holds \[frameworks\], not the payload's \[\]/);
  report.negativeControl = {project: "arm C: the product with the addon, built by the editor", refused: true, message: refusal.message};
  await rm(staging("with-addon"), {recursive: true, force: true});

  report.completedAt = new Date().toISOString();
  await writeFile(path.join(outputDirectory, "report.json"), JSON.stringify(report, null, 2) + "\n");
});
