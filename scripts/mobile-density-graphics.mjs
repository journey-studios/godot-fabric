import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {bundleMobileDensityProbe} from "./mobile-density-bundle.mjs";
import {ensureGodotBinary} from "./godot-binary.mjs";

// The windowed lane of the density slice, local only (a real window and the native renderer; CI has neither): the HUD of the density fixture
// under density_policy "screen" at the display's scale (2 on a Retina Mac), with the unsafe bands of a landscape iPhone stated through
// validation_safe_area, captured as drawn with pixels read back from the frames (tests/mobile-density-graphics-probe.gd). The captures are
// written to build/mobile-density-graphics/. Run with:
//   node scripts/mobile-density-graphics.mjs
const root = fileURLToPath(new URL("..", import.meta.url));
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const reportPath = path.join(root, "build/mobile-density-graphics-report.json");
const bundle = await bundleMobileDensityProbe();
const binary = await ensureGodotBinary();
await rm(reportPath, {force: true});
await mkdir(path.join(root, "build/mobile-density-graphics"), {recursive: true});
const run = spawnSync(binary, ["--path", root, "--windowed", "--script", "res://tests/mobile-density-graphics-probe.gd"],
  {encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024});
const log = (run.stdout ?? "") + (run.stderr ?? "");
await writeFile(path.join(root, "build/mobile-density-graphics.log"), log);
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
const receipt = {format: "godot-fabric.mobile-density-graphics/v1", scenario: report.scenario, godot: report.godot, facts: report.facts,
  command: "Godot --path <checkout> --windowed --script res://tests/mobile-density-graphics-probe.gd",
  nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), bundleSha256: bundle.bundle.sha256,
  checks: report.checks, captures, pixels: report.pixels,
  limitations: ["Godot macOS windowed run: the unsafe bands are the seam's numbers, not an iPhone's; no simulator, no device, no hardware pointer."]};
await writeFile(path.join(root, "build/mobile-density-graphics.json"), JSON.stringify(receipt, null, 2) + "\n");
assert.equal(run.error, undefined, log);
assert.equal(run.signal, null, log);
assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
assert.deepEqual(report.checks.filter(check => !check.passed), []);
assert.notEqual(report.facts.displayServer, "headless");
assert.equal(new Set(report.checks.map(check => check.name)).size, report.checks.length);
assert.deepEqual(report.captures.map(file => path.basename(file, ".png")), ["insets-scale-2", "insets-scale-2-bands", "no-insets-scale-2"]);
assert.ok(captures.every(capture => capture.bytes > 1000), "Every capture has an image");
assert.equal(run.status, 0, log);
assert.match(log, /MOBILE_DENSITY_GRAPHICS_PASSED: \d+/);
assert.equal([...log.matchAll(/^ERROR:/gm)].length, 0, "No engine or check error is hidden");
console.log(JSON.stringify({displayServer: report.facts.displayServer, renderer: report.facts.renderer, scale: report.facts.dimensions.scale,
  scaleSource: report.facts.scaleSource, checks: report.checks.length, captures: report.captures}, null, 2));
