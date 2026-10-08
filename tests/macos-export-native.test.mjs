import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtemp, mkdir, rm, symlink, readFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {assertLocalLoadPaths} from "../scripts/macos-export.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const runner = path.join(root, "scripts/macos-export.mjs");
const checkInventory = JSON.parse(await readFile(path.join(root, "scripts/macos-export-checks.json"), "utf8"));

function run(args, cwd) {
  return spawnSync(process.execPath, [runner, ...args], {cwd, encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024});
}

test("macOS export documents its required new-output contract without starting a build", () => {
  const result = run(["--help"], root);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--out NEW\.app/);
  assert.match(result.stdout, /observed archive and member hashes/);
});

test("macOS export requires an explicit template before provisioning", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "godot-fabric-export-template-required-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const result = run(["--out", path.join(directory, "new.app")], directory);
  assert.equal(result.error, undefined, result.stderr);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--template REVIEWED-GODOT-4\.7\.2-ARM64\.zip/);
  assert.doesNotMatch(result.stderr, /GODOT_FABRIC_PROVISIONED|provisioning/i);
});

test("macOS export refuses existing and dangling-symlink destinations before provisioning", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "godot-fabric-export-destination-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const existing = path.join(directory, "existing.app");
  await mkdir(existing);
  const dangling = path.join(directory, "dangling.app");
  await symlink(path.join(directory, "missing-target.app"), dangling);
  for (const output of [existing, dangling]) {
    const result = run(["--out", output, "--template", path.join(directory, "missing-template.zip")], directory);
    assert.equal(result.error, undefined, result.stderr);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Refusing to overwrite an existing output path/);
    assert.doesNotMatch(result.stderr, /GODOT_FABRIC_PROVISIONED|provisioning/i);
  }
});

test("committed consumer oracle preserves the exact 40/43 check names and capture order", () => {
  assert.equal(checkInventory.format, "godot-fabric.macos-export-consumer-checks/v1");
  assert.equal(checkInventory.sourceFixture, "consumers/minimal/validation.gd");
  assert.equal(checkInventory.headless.length, 40);
  assert.equal(checkInventory.headed.length, 43);
  assert.equal(new Set(checkInventory.headless).size, 40);
  assert.equal(new Set(checkInventory.headed).size, 43);
  assert.deepEqual(checkInventory.headed.filter(name => name.startsWith("Consumer capture saved:")), [
    "Consumer capture saved: initial", "Consumer capture saved: updated", "Consumer capture saved: resized",
  ]);
});

test("load-path validation permits contained loader paths and rejects traversal", () => {
  const app = path.join(os.tmpdir(), "Godot Fabric.app");
  const host = path.join(app, "Contents/Frameworks/fabric_godot.dylib");
  assert.doesNotThrow(() => assertLocalLoadPaths([
    "@rpath/hermesvm.framework/Versions/1/hermesvm", "@loader_path/frameworks",
    "/System/Library/Frameworks/AppKit.framework/AppKit", "/usr/lib/libSystem.B.dylib",
  ], host, app));
  assert.throws(() => assertLocalLoadPaths(["@rpath/../outside.dylib"], host, app), /unsafe @rpath traversal suffix/);
  assert.throws(() => assertLocalLoadPaths(["@loader_path/../../../../outside.dylib"], host, app), /escapes the \.app/);
  assert.throws(() => assertLocalLoadPaths(["/workspace/developer/libcustom.dylib"], host, app), /unexpected absolute path/);
});
