import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleAccessibilityInfoProbe} from "../scripts/accessibility-info-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {verifyAnnouncementsBridgeReport} from "./accessibility-info-oracle.mjs";

// The graphical, macOS proof of announcements, local and outside hosted CI (which is headless). Godot opens a real window
// with --accessibility always, RN's AccessibilityInfo announces through the host, and an inspector injected into the process
// (DYLD_INSERT_LIBRARIES; the official build's entitlements allow it) intercepts, by dyld interposition,
// NSAccessibilityPostNotificationWithUserInfo: the call AccessKit makes to ask AppKit for the announcement notification. The test
// judges what the host made AccessKit post (text, priority level, one post each). That VoiceOver spoke it is not provable from
// inside the process, and nothing here claims it. No TCC permission is needed: nothing outside the process is asked.
// There is no skip: without a window session it fails, and says so.
// --allow-original-negative runs the same bundle on the preceding host, which refuses every announcement. --sabotage=<name> runs it on
// a host broken on purpose (scripts/accessibility-info-sabotage.mjs builds them and keeps them in build/): the announcements of the
// three whose damage AccessKit's posts show (the text in the name, the priorities swapped, one element reused) must make it fail.
const root = fileURLToPath(new URL("..", import.meta.url));
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const sabotageArgument = process.argv.find(argument => argument.startsWith("--sabotage="));
const sabotage = sabotageArgument === undefined ? null : sabotageArgument.split("=")[1];
assert.ok(sabotage === null || ["announce-name", "swapped-priorities", "reused-element"].includes(sabotage), "Unknown sabotage: " + sabotage);
assert.ok(!(allowOriginalNegative && sabotage !== null), "A run is the current host, the previous one, or one sabotage");
const lane = allowOriginalNegative ? "original" : sabotage === null ? "current" : `sabotage-${sabotage}`;
const digest = value => createHash("sha256").update(value).digest("hex");
const sorted = values => [...values].sort();
const output = path.join(root, "build/accessibility-announcements-bridge");

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
    "The announcements bridge test reads what AccessKit posts to macOS's NSAccessibility: run it on macOS, with a window session.");
  const session = spawnSync("launchctl", ["managername"], {encoding: "utf8"});
  assert.equal(session.stdout.trim(), "Aqua",
    "The announcements bridge test needs a graphical macOS login session (launchctl managername is " +
    JSON.stringify(session.stdout.trim()) + ", not \"Aqua\"): Godot has to open a window. Run it from a desktop session.");
}

test("AccessKit posts RN's announcements to the window, with their text and priority level, once each", async () => {
  requireWindowSession();
  await mkdir(output, {recursive: true});
  const inspector = path.join(output, "libaccessibility-inspector.dylib");
  const compiled = spawnSync("xcrun", ["clang", "-dynamiclib", "-fobjc-arc", "-framework", "AppKit",
    path.join(root, "tests/accessibility-bridge-probe.m"), "-o", inspector], {encoding: "utf8"});
  assert.equal(compiled.status, 0, "The inspector must compile: " + compiled.stderr);
  const bundle = await bundleAccessibilityInfoProbe();
  const binary = await ensureGodotBinary();
  const exchange = path.join(output, "exchange");
  await rm(exchange, {recursive: true, force: true});
  await mkdir(exchange, {recursive: true});
  await rm(path.join(root, "build/accessibility-announcements-bridge-report.json"), {force: true});
  const result = spawnSync(binary, ["--path", root, "--accessibility", "always", "--script",
    "res://tests/accessibility-announcements-bridge-probe.gd", "--", ...(allowOriginalNegative ? ["--allow-original-negative"] : []), ...(sabotage === null ? [] : ["--sabotage"])],
  {encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024,
    env: {...process.env, DYLD_INSERT_LIBRARIES: inspector, FABRIC_AX_DIR: exchange}});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/accessibility-announcements-bridge-${lane}.log`), log);
  const report = await optionalJson("build/accessibility-announcements-bridge-report.json");
  if (report != null) {
    report.provenance = {node: process.version, bundle, inspectorSha256: digest(await readFile(inspector)),
      nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, `build/accessibility-announcements-bridge-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  if (sabotage !== null) {
    const broken = digest(await readFile(path.join(root, `build/accessibility-info-sabotage-${sabotage}-host/fabric_godot.dylib`)));
    assert.equal(digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), broken, "addons/fabric_godot.dylib must be the sabotaged host");
  }
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.ok(report != null, "Godot left no report: it probably could not open a window.\n" + log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  assert.equal(report.allowOriginalNegative, allowOriginalNegative);
  assert.equal(report.inspectorLost, "");
  if (sabotage !== null) {
    assert.equal(result.status, 0, log);
    assert.ok(failures.length > 0, "the lane rejects the " + sabotage + " host");
    assert.match(log, new RegExp(`ACCESSIBILITY_ANNOUNCEMENTS_BRIDGE_SABOTAGE_REJECTED: ${failures.length}`));
    assert.throws(() => verifyAnnouncementsBridgeReport(report), `The oracle rejects the ${sabotage} host`);
    return;
  }
  if (allowOriginalNegative) {
    // The preceding host refuses every announcement as "not implemented yet", so AccessKit posts nothing and only the checks
    // about the posts fail; the bridge itself (window, adapter) holds.
    assert.equal(result.status, 0, log);
    assert.ok(report.originalNegativeObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedOriginalFailures));
    assert.ok(failures.length > 0 && failures.length < report.checks.length);
    assert.match(log, new RegExp(`ACCESSIBILITY_ANNOUNCEMENTS_BRIDGE_ORIGINAL_NEGATIVE: ${failures.length}`));
    assert.throws(() => verifyAnnouncementsBridgeReport(report), "The oracle rejects the preceding host");
    return;
  }
  assert.equal(result.status, 0, log);
  assert.deepEqual(failures, [], "Each check of what AccessKit posted held");
  assert.match(log, /ACCESSIBILITY_ANNOUNCEMENTS_BRIDGE_PASSED: \d+/);
  assert.equal(report.originalNegativeObserved, false);
  assert.equal(report.scope.voiceOverSpoke, false);
  const verified = verifyAnnouncementsBridgeReport(report);
  // The oracle is not satisfied by a host that posted the priorities the wrong way round or a text twice.
  const swapped = structuredClone(report);
  swapped.stages.steps.high[0][1] = 50;
  assert.throws(() => verifyAnnouncementsBridgeReport(swapped), "The oracle rejects a wrong priority level");
  const doubled = structuredClone(report);
  doubled.stages.steps.saved.push(doubled.stages.steps.saved[0]);
  assert.throws(() => verifyAnnouncementsBridgeReport(doubled), "The oracle rejects a doubled post");
  const original = await optionalJson("build/accessibility-announcements-bridge-original-report.json");
  if (original != null) {
    assert.ok(original.originalNegativeObserved);
    assert.deepEqual(original.checks.map(row => row.name), report.checks.map(row => row.name));
    assert.equal(original.provenance.bundle.bundle.sha256, bundle.bundle.sha256, "The same SDK bundle runs on both hosts");
    assert.equal(original.provenance.inspectorSha256, report.provenance.inspectorSha256);
    assert.notEqual(original.provenance.nativeHostSha256, report.provenance.nativeHostSha256);
  }
  await writeFile(path.join(root, "build/accessibility-announcements-bridge-comparison.json"), JSON.stringify({scenario: report.scenario,
    originalControlPresent: original != null, originalFailures: original?.checks.filter(row => !row.passed).map(row => row.name) ?? null,
    oracle: verified, current: {checks: report.checks.length, nativeHostSha256: report.provenance.nativeHostSha256, bundleSha256: bundle.bundle.sha256}},
  null, 2) + "\n");
});
