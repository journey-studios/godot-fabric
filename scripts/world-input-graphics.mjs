import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {bundleWorldInputProbe} from "./world-input-bundle.mjs";
import {ensureGodotBinary} from "./godot-binary.mjs";

// The windowed lane of the pointer spike, local only (a real window and the native renderer; CI has neither): the scene of
// topology (a) on the native renderer with a real display server, the same counts as the headless probe with N = 100, and
// captures of the map with its HUD in build/world-input-graphics/. Run with:
//   node scripts/world-input-graphics.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const reportPath = path.join(root, "build/world-input-graphics-report.json");
const bundle = await bundleWorldInputProbe();
const binary = await ensureGodotBinary();
await rm(reportPath, {force: true});
await mkdir(path.join(root, "build/world-input-graphics"), {recursive: true});
const run = spawnSync(binary, ["--path", root, "--windowed", "--script", "res://tests/world-input-graphics-probe.gd"],
  {encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024});
const log = (run.stdout ?? "") + (run.stderr ?? "");
await writeFile(path.join(root, "build/world-input-graphics.log"), log);
let report;
try {
  report = JSON.parse(await readFile(reportPath, "utf8"));
} catch (error) {
  throw new Error(`The graphical probe did not write a report (${error.message}). Godot output:\n${log}`);
}
const captures = await Promise.all(report.captures.map(async file => {
  const bytes = await readFile(path.join(root, file));
  return {path: file, sha256: digest(bytes), bytes: bytes.length};
}));
const receipt = {format: "godot-fabric.world-input-graphics/v1", scenario: report.scenario, godot: report.godot,
  displayServer: report.displayServer, renderer: report.renderer, adapter: report.adapter, viewport: report.viewport, n: report.n,
  command: "Godot --path <checkout> --windowed --script res://tests/world-input-graphics-probe.gd",
  nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), bundleSha256: bundle.bundle.sha256,
  checks: report.checks, captures, limitations: ["Godot macOS windowed run with synthetic events through Input.parse_input_event; no hardware pointer or touch screen, no mobile export."]};
await writeFile(path.join(root, "build/world-input-graphics.json"), JSON.stringify(receipt, null, 2) + "\n");
assert.equal(run.error, undefined, log);
assert.equal(run.signal, null, log);
assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
assert.deepEqual(report.checks.filter(check => !check.passed), []);
assert.notEqual(report.displayServer, "headless");
assert.equal(new Set(report.checks.map(check => check.name)).size, report.checks.length);
assert.deepEqual(report.captures.map(file => path.basename(file, ".png")),
  ["map-with-hud", "tile-selected", "tree-overlay-open", "modal-overlay-open"]);
assert.ok(captures.every(capture => capture.bytes > 1000), "Every capture has an image");
assert.equal(run.status, 0, log);
assert.match(log, /WORLD_INPUT_GRAPHICS_PASSED: \d+/);
assert.equal([...log.matchAll(/^ERROR:/gm)].length, 0, "No engine or check error is hidden");
console.log(JSON.stringify({displayServer: report.displayServer, renderer: report.renderer, checks: report.checks.length, captures: report.captures}, null, 2));
