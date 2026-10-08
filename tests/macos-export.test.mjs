import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {copyFile, mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";

const repository = fileURLToPath(new URL("..", import.meta.url));
const addonFiles = ["plugin.gd", "plugin.cfg", "build.gd", "application_resource.gd", "export_payload.gd",
  "export_preflight.gd", "ios_export.gd", "macos_export.gd"];
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

test("Godot export payload and registered hooks validate in an isolated project", async () => {
  const godot = await ensureGodotBinary();
  const project = await mkdtemp(path.join(os.tmpdir(), "godot-fabric-macos-export-"));
  const write = async (relative, value) => {
    const file = path.join(project, relative);
    await mkdir(path.dirname(file), {recursive: true});
    await writeFile(file, value);
  };
  const invoke = args => spawnSync(godot, args, {cwd: project, encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024});
  try {
    for (const name of addonFiles) {
      const target = path.join(project, "sdk/addon", name);
      await mkdir(path.dirname(target), {recursive: true});
      await copyFile(path.join(repository, "sdk/addon", name), target);
    }
    await mkdir(path.join(project, "tests"), {recursive: true});
    await copyFile(path.join(repository, "tests/macos-export-payload.gd"), path.join(project, "tests/macos-export-payload.gd"));
    await write("project.godot", `[application]\nconfig/name="Godot Fabric export payload fixture"\n\n[editor_plugins]\nenabled=PackedStringArray("res://sdk/addon/plugin.cfg")\n\n[godot_fabric]\napplication="res://ui/application.tres"\n`);
    await write("ui/application.tres", `[gd_resource type="Resource" script_class="GodotFabricApplication" load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://sdk/addon/application_resource.gd" id="1"]\n\n[resource]\nscript = ExtResource("1")\nformat_version = 1\nentry_file = "res://ui/index.js"\nbundle_file = "res://.godot_fabric/export-payload-tests/app.js"\n`);
    const bundle = Buffer.from("bundle");
    await write(".godot_fabric/export-payload-tests/app.js", bundle);
    await write(".godot_fabric/export-payload-tests/build-report.json", JSON.stringify({
      schemaVersion: 1, entry: "res://ui/index.js", bundle: "res://.godot_fabric/export-payload-tests/app.js",
      sdkSourceCommit: "isolated-fixture", sha256: sha256(bundle), inputs: [], typeChecker: {},
      adapterSelection: null, assets: null, styles: null,
    }));

    const preflight = invoke(["--headless", "--path", project, "--script", "res://sdk/addon/export_preflight.gd"]);
    const preflightLog = (preflight.stdout ?? "") + (preflight.stderr ?? "");
    assert.equal(preflight.error, undefined, preflightLog);
    assert.equal(preflight.status, 0, preflightLog);
    assert.match(preflightLog, /GODOT_FABRIC_EXPORT_PREFLIGHT_PASSED:/);
    assert.doesNotMatch(preflightLog, /SCRIPT ERROR|Parse Error|ERROR:|Program crashed|Stack overflow|ObjectDB instances leaked|Resources still in use/);

    const payload = invoke(["--headless", "--path", project, "--script", "res://tests/macos-export-payload.gd"]);
    const payloadLog = (payload.stdout ?? "") + (payload.stderr ?? "");
    assert.equal(payload.error, undefined, payloadLog);
    assert.equal(payload.status, 0, payloadLog);
    assert.match(payloadLog, /MACOS_EXPORT_PAYLOAD_PASSED: 28\b/);
    assert.doesNotMatch(payloadLog, /SCRIPT ERROR|Parse Error|Program crashed|Stack overflow|ObjectDB instances leaked|Resources still in use/);

    const rejectedPreflight = invoke(["--headless", "--path", project, "--script", "res://sdk/addon/export_preflight.gd"]);
    const rejectionLog = (rejectedPreflight.stdout ?? "") + (rejectedPreflight.stderr ?? "");
    assert.equal(rejectedPreflight.error, undefined, rejectionLog);
    assert.equal(rejectedPreflight.status, 1, rejectionLog);
    assert.match(rejectionLog, /GODOT_FABRIC_EXPORT_PREFLIGHT_REJECTED: The bundle build report is malformed/);
    assert.doesNotMatch(rejectionLog, /SCRIPT ERROR|Parse Error|Program crashed|Stack overflow|ObjectDB instances leaked|Resources still in use/);

    const editor = invoke(["--headless", "--editor", "--path", project, "--quit"]);
    const editorLog = (editor.stdout ?? "") + (editor.stderr ?? "");
    assert.equal(editor.error, undefined, editorLog);
    assert.equal(editor.status, 0, editorLog);
    assert.doesNotMatch(editorLog, /SCRIPT ERROR|Parse Error|Failed to load script/);
  } finally {
    await rm(project, {recursive: true, force: true});
  }
});
