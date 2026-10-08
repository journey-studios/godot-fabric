import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleAccessibilityProbe} from "../scripts/accessibility-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {bridgeNormativeOriginalFailures, bridgeRejection, verifyBridgeReport} from "./accessibility-oracle.mjs";

// The OS-bridge proof of the accessibility slice, on a graphical macOS run: Godot opens a real window with
// --accessibility always, an NSAccessibility inspector is injected into its process (DYLD_INSERT_LIBRARIES; the
// official build's entitlements allow it), and the test reads the tree the window serves to the system, presses
// elements with AXPress and judges what RN's callbacks saw. It is not part of hosted CI, which is headless.
// There is no skip: without a window session it fails, and says so.
// --allow-original-negative runs the same bundle on the preceding host, which serves unnamed elements.
const root = fileURLToPath(new URL("..", import.meta.url));
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const lane = allowOriginalNegative ? "original" : "current";
const digest = value => createHash("sha256").update(value).digest("hex");
const sorted = values => [...values].sort();
const output = path.join(root, "build/accessibility-bridge");

async function optionalJson(file) {
  try {
    return JSON.parse(await readFile(path.join(root, file), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function requireWindowSession() {
  assert.equal(process.platform, "darwin",
    "The accessibility bridge test reads macOS's NSAccessibility tree: run it on macOS, with a window session.");
  const session = spawnSync("launchctl", ["managername"], {encoding: "utf8"});
  assert.equal(session.stdout.trim(), "Aqua",
    "The accessibility bridge test needs a graphical macOS login session (launchctl managername is " +
    JSON.stringify(session.stdout.trim()) + ", not \"Aqua\"): Godot has to open a window. Run it from a desktop session.");
}

test("the OS accessibility tree of the graphical Godot names, describes and presses RN's accessible Views", async () => {
  requireWindowSession();
  await mkdir(output, {recursive: true});
  const inspector = path.join(output, "libaccessibility-inspector.dylib");
  const compiled = spawnSync("xcrun", ["clang", "-dynamiclib", "-fobjc-arc", "-framework", "AppKit",
    path.join(root, "tests/accessibility-bridge-probe.m"), "-o", inspector], {encoding: "utf8"});
  assert.equal(compiled.status, 0, "The inspector must compile: " + compiled.stderr);
  const bundle = await bundleAccessibilityProbe();
  const binary = await ensureGodotBinary();
  const exchange = path.join(output, "exchange");
  await rm(exchange, {recursive: true, force: true});
  await mkdir(exchange, {recursive: true});
  await rm(path.join(root, "build/accessibility-bridge-report.json"), {force: true});
  const result = spawnSync(binary, ["--path", root, "--accessibility", "always", "--script", "res://tests/accessibility-bridge-probe.gd", "--",
    ...(allowOriginalNegative ? ["--allow-original-negative"] : [])],
  {encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024,
    env: {...process.env, DYLD_INSERT_LIBRARIES: inspector, FABRIC_AX_DIR: exchange}});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/accessibility-bridge-${lane}.log`), log);
  const report = await optionalJson("build/accessibility-bridge-report.json");
  if (report != null) {
    report.provenance = {node: process.version, bundle, inspectorSha256: digest(await readFile(inspector)),
      nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, `build/accessibility-bridge-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.ok(report != null, "Godot left no report: it probably could not open a window.\n" + log);
  assert.equal(result.status, 0, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length, "No other diagnostic is hidden");
  assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  if (allowOriginalNegative) {
    // The preceding host serves the same tree shape with unnamed elements, so only the descriptor checks fail.
    assert.ok(report.originalNegativeObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedOriginalFailures));
    assert.deepEqual(sorted(failures), sorted(bridgeNormativeOriginalFailures));
    assert.match(log, new RegExp(`ACCESSIBILITY_BRIDGE_ORIGINAL_NEGATIVE: ${failures.length}`));
    verifyBridgeReport(report, {original: true});
    return;
  }
  assert.deepEqual(failures, [], "Each check of the OS tree held");
  assert.match(log, /ACCESSIBILITY_BRIDGE_PASSED: \d+/);
  assert.equal(report.originalNegativeObserved, false);
  verifyBridgeReport(report);
  // The oracle is not satisfied by a tree that lost its semantics: the same report with every title blanked is rejected.
  const blank = structuredClone(report);
  const blankTree = node => {
    node.title = null;
    node.children.forEach(blankTree);
  };
  blankTree(blank.stages.tree.tree);
  assert.ok(bridgeRejection(blank) != null, "The oracle rejects an OS tree without names");
  const original = await optionalJson("build/accessibility-bridge-original-report.json");
  if (original != null) {
    assert.ok(original.originalNegativeObserved);
    assert.deepEqual(original.checks.map(row => row.name), report.checks.map(row => row.name).filter(name => original.checks.some(row => row.name === name)));
    assert.equal(original.provenance.bundle.bundle.sha256, bundle.bundle.sha256, "The same SDK bundle runs on both hosts");
    assert.equal(original.provenance.inspectorSha256, report.provenance.inspectorSha256);
    assert.notEqual(original.provenance.nativeHostSha256, report.provenance.nativeHostSha256);
  }
});
