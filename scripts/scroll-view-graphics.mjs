import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {ensureGodotBinary} from "./godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const hostPath = path.join(root, "addons/fabric_godot.dylib");
const bundlePath = path.join(root, "build/scroll-view-gf14-probe.js");
const buildReceiptPath = path.join(root, ".deps/build/native-sdk-build.json");
const bundleReceiptPath = path.join(root, "build/scroll-view-gf14-probe-bundle.json");
const reportPath = path.join(root, "build/scroll-view-graphics-report.json");
const receiptPath = path.join(root, "docs/evidence/scroll-view/graphics-receipt.json");
await rm(reportPath, {force: true});
const hostBefore = hash(await readFile(hostPath));
const bundleBefore = hash(await readFile(bundlePath));
const buildReceiptBytes = await readFile(buildReceiptPath);
const buildReceipt = JSON.parse(buildReceiptBytes);
const bundleReceiptBytes = await readFile(bundleReceiptPath);
const bundleReceipt = JSON.parse(bundleReceiptBytes);
assert.equal(buildReceipt.host?.sha256, hostBefore, "build receipt must identify the current host bytes");
assert.equal(bundleReceipt.bundle?.sha256, bundleBefore, "bundle receipt must identify the current bundle bytes");
await writeFile(receiptPath, JSON.stringify({schemaVersion: 1, status: "pending",
  scenario: "gf14-scroll-view-windowed-capture", host: {path: "addons/fabric_godot.dylib", sha256: hostBefore},
  bundle: {path: "build/scroll-view-gf14-probe.js", sha256: bundleBefore},
  buildReceipt: {path: ".deps/build/native-sdk-build.json", sha256: hash(buildReceiptBytes)},
  bundleReceipt: {path: "build/scroll-view-gf14-probe-bundle.json", sha256: hash(bundleReceiptBytes)}}, null, 2) + "\n");

const binary = await ensureGodotBinary();
const run = spawnSync(binary, ["--path", root, "--windowed", "--script", "res://tests/scroll-view-graphics-probe.gd"],
  {encoding: "utf8", timeout: 60000, maxBuffer: 16 * 1024 * 1024});
const log = (run.stdout ?? "") + (run.stderr ?? "");
await mkdir(path.join(root, "build"), {recursive: true});
await writeFile(path.join(root, "build/scroll-view-graphics.log"), log);
let report;
try {
  report = JSON.parse(await readFile(reportPath, "utf8"));
} catch (error) {
  await writeFile(receiptPath, JSON.stringify({schemaVersion: 1, status: "failed",
    scenario: "gf14-scroll-view-windowed-capture", host: {path: "addons/fabric_godot.dylib", sha256: hostBefore},
    bundle: {path: "build/scroll-view-gf14-probe.js", sha256: bundleBefore},
    buildReceipt: {path: ".deps/build/native-sdk-build.json", sha256: hash(buildReceiptBytes)},
    bundleReceipt: {path: "build/scroll-view-gf14-probe-bundle.json", sha256: hash(bundleReceiptBytes)},
    failure: `Graphical probe did not write a valid report (${error.message}).`,
    log: {path: "build/scroll-view-graphics.log", sha256: hash(Buffer.from(log))}}, null, 2) + "\n");
  throw new Error(`Graphical probe did not write a valid report (${error.message}). Godot output:\n${log}`);
}
const hostAfter = hash(await readFile(hostPath));
const bundleAfter = hash(await readFile(bundlePath));
const buildReceiptAfter = hash(await readFile(buildReceiptPath));
const bundleReceiptAfter = hash(await readFile(bundleReceiptPath));
const captures = await Promise.all(report.captures.map(async relative => {
  const bytes = await readFile(path.join(root, relative));
  return {path: relative, sha256: hash(bytes), bytes: bytes.length};
}));
const failures = report.checks.filter(row => !row.passed);
const checkSummaries = report.checks.map(row => {
  const detail = row.detail ?? {};
  if (row.name.startsWith("initial frame"))
    return {name: row.name, passed: row.passed, viewport: detail.size, maxY: detail.scroll?.maxY};
  if (row.name.startsWith("fractional paint"))
    return {name: row.name, passed: row.passed, offsetY: detail.native?.y,
      fabricY: detail.native?.fabricY, paintedContentY: detail.native?.contentY, measuredRowY: detail.measure?.y};
  if (row.name.startsWith("horizontal pan"))
    return {name: row.name, passed: row.passed, viewport: detail.viewport,
      offsetX: detail.native?.x, fabricX: detail.native?.fabricX, paintedContentX: detail.native?.contentX,
      pixelInsideViewport: detail.insidePixel, pixelOutsideViewport: detail.outsidePixel};
  const after = detail.after ?? {};
  const app = after.app ?? {};
  const route = app.pointerRouting ?? {};
  const processor = app.pointerProcessor ?? {};
  const surfaces = [after.primary, after.secondary].map(surface => ({
    nativeTags: surface?.nativeTags, retiringTags: surface?.retiringTags,
    activePointers: surface?.pointer?.activePointers, activeTouches: surface?.pointer?.activeTouches,
    takenPointers: surface?.pointer?.takenPointers
  }));
  return {name: row.name, passed: row.passed,
    afterStop: {stopped: app.stopped, rootCount: app.rootCount, pendingWork: app.pendingWork,
      pendingTimers: app.pendingTimers, pendingAnimationFrames: app.pendingAnimationFrames,
      pointerRouting: {active: route.active, contacts: route.contacts, stored: route.stored, suppressed: route.suppressed},
      pointerProcessor: {active: processor.active, activeCapture: processor.activeCapture, pendingCapture: processor.pendingCapture},
      surfaces}}
});
const receipt = {
  schemaVersion: 1,
  status: "pending", 
  scenario: report.scenario,
  engine: report.godot,
  displayServer: report.displayServer,
  renderer: report.renderer,
  command: "Godot --path <checkout> --windowed --script res://tests/scroll-view-graphics-probe.gd",
  host: {path: "addons/fabric_godot.dylib", expectedSha256: buildReceipt.host.sha256, beforeSha256: hostBefore, afterSha256: hostAfter, unchanged: hostBefore === hostAfter},
  buildReceipt: {path: ".deps/build/native-sdk-build.json", sha256: hash(buildReceiptBytes),
    unchanged: buildReceiptAfter === hash(buildReceiptBytes), recordedHostMatches: buildReceipt.host?.sha256 === hostBefore},
  bundle: {path: "build/scroll-view-gf14-probe.js", expectedSha256: bundleReceipt.bundle.sha256, beforeSha256: bundleBefore, afterSha256: bundleAfter, unchanged: bundleBefore === bundleAfter},
  bundleReceipt: {path: "build/scroll-view-gf14-probe-bundle.json", sha256: hash(bundleReceiptBytes),
    unchanged: bundleReceiptAfter === hash(bundleReceiptBytes)},
  probe: {path: "tests/scroll-view-graphics-probe.gd", sha256: hash(await readFile(path.join(root, "tests/scroll-view-graphics-probe.gd")))},
  runner: {path: "scripts/scroll-view-graphics.mjs", sha256: hash(await readFile(path.join(root, "scripts/scroll-view-graphics.mjs")))},
  report: {path: "build/scroll-view-graphics-report.json", sha256: hash(await readFile(reportPath))},
  checks: checkSummaries,
  captures,
  log: {path: "build/scroll-view-graphics.log", sha256: hash(Buffer.from(log))},
  limitations: ["Godot macOS windowed run only; no physical hardware touch or mobile-export claim."]
};
await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
try {
  assert.equal(run.error, undefined, log);
  assert.equal(run.signal, null, log);
  assert.equal(run.status, 0, log);
  assert.deepEqual(failures, [], JSON.stringify(failures));
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  assert.equal(report.checks.length, 4);
  assert.deepEqual(report.captures.map(file => path.basename(file, ".png")),
    ["initial", "fractional-13_25", "horizontal-pan-clipped", "cleanup"]);
  assert.ok(receipt.host.unchanged && receipt.bundle.unchanged);
  assert.ok(receipt.buildReceipt.unchanged);
  assert.ok(receipt.bundleReceipt.unchanged);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use|SCROLL_GRAPHICS_CHECK_FAILED/);
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, 0);
  receipt.status = "verified";
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
} catch (error) {
  receipt.status = "failed";
  receipt.failure = String(error);
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
  throw error;
}
console.log(JSON.stringify({checks: report.checks.length, captures, host: hostAfter, bundle: bundleAfter}, null, 2));
