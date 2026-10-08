import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleLayoutAnimationProbe, layoutAnimationNativeProducers} from "../scripts/layout-animation-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {verifyLayoutAnimationReport} from "./layout-animation-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// --previous-host runs the same bundle on the host that predates this slice, which has no LayoutAnimationDriver: every check that
// needs the driver must fail there while RN's own JavaScript (its timer, the committed layout) still holds. The host in addons/ has
// to be the preserved one (build/layout-animation-previous-host). --sabotage=<name> runs it on a host whose source was broken on
// purpose (scripts/layout-animation-sabotage.mjs builds those hosts and restores the source): the probe and the independent oracle
// must both reject it.
const previousHost = process.argv.includes("--previous-host");
const sabotageArgument = process.argv.find(argument => argument === "--sabotage" || argument.startsWith("--sabotage="));
const sabotageNames = ["seconds-clock", "no-register-surface", "no-consumer", "drop-callback", "unguarded-tick", "no-rearm"];
const sabotage = sabotageArgument === undefined ? null : (sabotageArgument.split("=")[1] ?? sabotageNames[0]);
assert.ok(sabotage === null || sabotageNames.includes(sabotage), "Unknown sabotage: " + sabotage);
assert.ok(!(previousHost && sabotage !== null), "A run is the current host, the previous one, or one sabotage");
const lane = previousHost ? "previous-host" : sabotage === null ? "current" : `sabotage-${sabotage}`;
const digest = value => createHash("sha256").update(value).digest("hex");
const sorted = values => [...values].sort();
const host = path.join(root, "addons/fabric_godot.dylib");

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

// The oracle's first complaint about a report whose checks all claim to pass, or null when it accepts it.
function oracleRejection(report) {
  try {
    verifyLayoutAnimationReport({...report, checks: report.checks.map(row => ({...row, passed: true}))});
  } catch (error) {
    return String(error.message).split("\n")[0];
  }
  return null;
}

// RN's glog diagnostics, which the probe provokes on purpose with a config the driver cannot parse (conversions.h and
// LayoutAnimationKeyFrameManager.cpp log it); no other native diagnostic may appear.
const provoked = ["Error parsing animation type: bogus", "Error parsing animation config: could not parse field `type`",
  "Parsing LayoutAnimationConfig failed: {\"duration\":400,\"update\":{\"type\":\"bogus\"}}"];

// Every ERROR line of a log is a failed check, and every glog error line is one the probe provoked: no native, script or engine
// error hides.
function assertOnlyExpectedErrors(report, log) {
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(sorted(checkErrors), sorted(failures));
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length, "No script or engine error is hidden");
  const diagnostics = [...log.matchAll(/^E\d{4} \S+ \d+ [^\]]+\] (.+)$/gm)].map(match => match[1]);
  // The previous host has no driver to parse the config; every other host does, whatever else it breaks.
  const parsed = !previousHost;
  assert.deepEqual(sorted(diagnostics), sorted(parsed ? provoked : []), "The only native diagnostics are the ones the probe provoked");
  return failures;
}

function assertSameReproducer(control, report, bundle, name) {
  assert.deepEqual(control.checks.map(row => row.name), report.checks.map(row => row.name), name);
  assert.deepEqual(control.expectedOriginalFailures, report.expectedOriginalFailures, name);
  assert.equal(control.provenance.bundle.bundle.sha256, bundle.bundle.sha256, name + ": the same bundle runs on every host");
  // Only the compiled native producers differ between hosts; their bundle-time pins say nothing about them.
  for (const [file, sha] of Object.entries(bundle.sources)) {
    if (!layoutAnimationNativeProducers.includes(file)) {
      assert.equal(control.provenance.bundle.sources[file], sha, `${name} shares the reproducer and SDK producer: ${file}`);
    }
  }
  assert.notEqual(control.provenance.nativeHostSha256, report.provenance.nativeHostSha256, name);
}

test("RN's own LayoutAnimation runs on RN's LayoutAnimationDriver, on the Godot frame tick, for updates, creates and deletes", async () => {
  const hostSha256 = digest(await readFile(host));
  if (previousHost) {
    // The control is only a control on the host that predates this slice.
    const preserved = digest(await readFile(path.join(root, "build/layout-animation-previous-host/fabric_godot.dylib")));
    assert.equal(hostSha256, preserved, "addons/fabric_godot.dylib must be the preserved previous host");
  }
  const bundle = await bundleLayoutAnimationProbe();
  const binary = await ensureGodotBinary();
  await rm(path.join(root, "build/layout-animation-report.json"), {force: true});
  const flags = [...(previousHost ? ["--previous-host"] : []), ...(sabotage === null ? [] : ["--sabotage"])];
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/layout-animation-probe.gd", "--", ...flags],
    {encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, `build/layout-animation-${lane}.log`), log);
  const report = await optionalJson("build/layout-animation-report.json");
  if (report != null) {
    report.provenance = {node: process.version, lane, bundle, nativeHostSha256: hostSha256, sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, `build/layout-animation-${lane}-report.json`), JSON.stringify(report, null, 2) + "\n");
  }
  // Artifacts are saved before assertions. A control flag never accepts unrelated failures or removes the declared failures from the
  // report.
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.ok(report != null, log);
  assert.equal(report.scenario, "layout-animation");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.equal(report.previousHost, previousHost);
  assert.equal(new Set(report.checks.map(check => check.name)).size, report.checks.length);
  assert.equal(new Set(report.expectedOriginalFailures).size, report.expectedOriginalFailures.length);
  const failures = assertOnlyExpectedErrors(report, log);
  for (const file of ["tests/layout-animation-fixture.jsx", "tests/layout-animation-cases.mjs", "tests/layout-animation-probe.gd",
    "tests/layout-animation-native.test.mjs", "tests/layout-animation-oracle.mjs", "scripts/layout-animation-bundle.mjs",
    "scripts/layout-animation-sabotage.mjs", "scripts/native-probe-bundle.mjs", "src/react-native-platform.jsx", "src/private-interface.js",
    "sdk/toolchain/platform-plugin.mjs", ...layoutAnimationNativeProducers]) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every executed producer: " + file);
  }
  for (const file of ["Libraries/LayoutAnimation/LayoutAnimation.js", "ReactCommon/react/renderer/animations/LayoutAnimationDriver.cpp",
    "ReactCommon/react/renderer/animations/LayoutAnimationKeyFrameManager.cpp", "ReactCommon/react/renderer/animations/utils.cpp",
    "ReactCommon/react/renderer/animations/conversions.h", "ReactCommon/react/renderer/uimanager/UIManager.cpp",
    "ReactCommon/react/renderer/scheduler/Scheduler.cpp", "React/Fabric/RCTScheduler.mm", "Libraries/ReactNative/BridgelessUIManager.js"]) {
    assert.match(bundle.originalReactNativeSources[file], /^[0-9a-f]{64}$/);
  }
  // The checks that need the driver are normative; the ones about RN's JavaScript and the committed layout hold on both hosts.
  assert.ok(report.expectedOriginalFailures.length > 0 && report.expectedOriginalFailures.length < report.checks.length);

  if (previousHost) {
    assert.equal(result.status, 0, log);
    assert.ok(report.originalNegativeObserved);
    assert.deepEqual(sorted(failures), sorted(report.expectedOriginalFailures), "Only the driver's checks qualify as the old-host control");
    assert.match(log, new RegExp(`LAYOUT_ANIMATION_ORIGINAL_NEGATIVE: ${failures.length}`));
    // Without the driver the host's configureNextLayoutAnimation does nothing, and RN's own timer is what ends every call.
    assert.equal(report.stages.mount.state?.enabled, undefined, "The preceding host has no LayoutAnimation section in its status");
    for (const name of ["update-linear", "update-ease", "update-spring", "create-opacity", "delete-opacity", "native-end", "mixed"]) {
      const ends = report.stages[name].events.filter(event => event.kind === "end");
      assert.equal(ends.length, 1, name);
      assert.equal(ends[0].race, "fired", name + ": RN's timer ended it");
      assert.equal(report.stages[name].rows.at(-1).pullsTotal, -1, name + ": no transaction counter");
    }
    assert.ok(oracleRejection(report) != null, "The oracle rejects the preceding host");
    return;
  }
  assert.equal(report.originalNegativeObserved, false);
  if (sabotage !== null) {
    assert.equal(result.status, 0, log);
    assert.ok(failures.length > 0);
    assert.match(log, new RegExp(`LAYOUT_ANIMATION_SABOTAGE_REJECTED: ${failures.length}`));
    assert.ok(oracleRejection(report) != null, "The oracle rejects the sabotaged report");
    // Each sabotage is rejected by checks of its own; the host's counters say what it did.
    const ran = report.stages["update-linear"];
    if (sabotage === "no-register-surface") {
      assert.equal(ran.final.pullsTotal, 0, "The driver never served a transaction: no surface lets it override the pulls");
    }
    if (sabotage === "seconds-clock") {
      const pulls = report.pulls.filter(pull => pull.sequence > ran.request.pullsTotal);
      assert.ok(pulls.length > 0 && pulls.every(pull => pull.readMs !== Math.floor(pull.frameMs)), "RN read seconds where the host's frames are in milliseconds");
    }
    if (sabotage === "unguarded-tick") {
      // A requestAnimationFrame loop alone ticked the driver, which had nothing to pull: only the normative check about it fails.
      const loop = report.stages["raf-idle"];
      assert.ok(loop.rows.at(-1).ticks > loop.request.ticks, "The driver was ticked by a loop that is not an animation");
      assert.equal(loop.rows.at(-1).pullsTotal, loop.request.pullsTotal, "...and had nothing to pull");
      assert.equal(failures.length, 1);
      assert.match(failures[0], /^raf-idle\//);
    }
    if (sabotage === "no-rearm") {
      // The next root's animation is created by the pull that finds the old one in flight, RN signals no start, and nothing ticks it.
      const next = report.stages.restart;
      assert.equal(next.timedOut, true, "The next root's animation never reached its end");
      assert.equal(next.final.ticks, next.request.ticks, "...because the driver was never ticked");
      assert.equal(next.final.active, false);
    }
    if (sabotage === "drop-callback") {
      assert.equal(report.stages["native-end"].events.find(event => event.kind === "end").race, "fired", "Only RN's timer ended the call");
      assert.ok(report.stages["native-end"].final.callbacks - report.stages["native-end"].request.callbacks >= 1, "The driver did queue the callback");
    }
    return;
  }
  assert.equal(result.status, 0, log);
  assert.deepEqual(failures, []);
  assert.equal(report.allCurrentAssertionsPassed, true);
  assert.match(log, /LAYOUT_ANIMATION_PASSED: \d+/);
  const verified = verifyLayoutAnimationReport(report);
  const original = await optionalJson("build/layout-animation-previous-host-report.json");
  if (original != null) {
    assert.ok(original.originalNegativeObserved);
    assertSameReproducer(original, report, bundle, "preceding host");
  }
  const rejections = {};
  for (const name of sabotageNames) {
    const sabotaged = await optionalJson(`build/layout-animation-sabotage-${name}-report.json`);
    if (sabotaged != null) {
      assert.ok(sabotaged.checks.some(row => !row.passed) && oracleRejection(sabotaged) != null, name);
      assertSameReproducer(sabotaged, report, bundle, `${name} host`);
      rejections[name] = {failures: sabotaged.checks.filter(row => !row.passed).map(row => row.name), oracle: oracleRejection(sabotaged)};
    }
  }
  await writeFile(path.join(root, "build/layout-animation-comparison.json"), JSON.stringify({scenario: report.scenario,
    originalControlPresent: original != null, sabotagePresent: Object.keys(rejections),
    intentionalNativeProducerDifferences: layoutAnimationNativeProducers,
    originalFailures: original?.checks.filter(row => !row.passed).map(row => row.name) ?? null, sabotages: rejections, oracle: verified,
    current: {checks: report.checks.length, nativeHostSha256: report.provenance.nativeHostSha256, bundleSha256: bundle.bundle.sha256}}, null, 2) + "\n");
});
