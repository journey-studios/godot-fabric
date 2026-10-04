import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleEventTargetProbe, eventTargetProbeModes} from "../scripts/event-target-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const digest = content => createHash("sha256").update(content).digest("hex");
const productionSources = ["src/initialize.js", "src/private-interface.js", "sdk/toolchain/platform-plugin.mjs", "native/application_runtime.cpp"];
async function productionHashes() {
  return Object.fromEntries(await Promise.all(productionSources.map(async file => [file, digest(await readFile(path.join(root, file)))])));
}
async function publicBundleHash() {
  try { return digest(await readFile(path.join(root, "build/app.js"))); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

test("isolated original ref EventTarget contracts expose native-interest, legacy-dispatch and parent-cache gaps", async () => {
  const before = await productionHashes(), publicBefore = await publicBundleHash();
  const bundles = await bundleEventTargetProbe();
  const reportPath = path.join(root, "build/event-target-report.json");
  await rm(reportPath, {force: true});
  const result = spawnSync(await ensureGodotBinary(), ["--path", root, "--headless", "--script", "res://tests/event-target-probe.gd"],
    {encoding: "utf8", timeout: 45000, maxBuffer: 6 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, "build/event-target.log"), log);
  assert.equal(result.error, undefined, log);
  assert.equal(result.status, 0, "signal=" + result.signal + "\n" + log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|FABRIC_CHECK_FAILED|ObjectDB instances leaked|Resources still in use/);
  const diagnostics = [...log.matchAll(/^ERROR: (.+)$/gm)].map(match => match[1]);
  assert.equal(diagnostics.length, 1, log);
  assert.match(diagnostics[0], /EventTarget deliberate public listener fault/);
  assert.match(log, /Unable to preventDefault inside passive event listener invocation/);
  assert.match(log, /EVENT_TARGET_PROBE_PASSED/);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.scenario, "event-target-original-probe");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.ok(report.checks.length > 0);
  assert.ok(report.checks.every(entry => entry.passed), JSON.stringify(report.checks.filter(entry => !entry.passed)));
  assert.equal(new Set(report.checks.map(entry => entry.name)).size, report.checks.length, "Every executed check has a distinct name");
  assert.deepEqual(Object.keys(report.capabilities).sort(), [...eventTargetProbeModes].sort());
  for (const mode of eventTargetProbeModes) {
    const capability = report.capabilities[mode];
    assert.ok(capability.originalElement && capability.globalsOriginal && capability.logicalFlatParent);
    assert.equal(capability.originalEventTarget, mode === "enabled" || mode === "internal-only");
    assert.deepEqual(Object.values(capability.methods), Array(3).fill(mode === "enabled" ? "function" : "undefined"));
  }
  for (const name of ["A", "B"]) {
    const manual = report.stages["manual" + name];
    assert.ok(manual.checks.length >= 30 && manual.checks.every(entry => entry.passed), "Real original ref semantics must execute in each root");
  }
  assert.deepEqual(report.gaps.map(entry => entry.id), ["native-interest", "native-dispatch", "original-parent-cache"]);
  assert.ok(report.gaps.every(entry => entry.observed && entry.status === "original-gap-observed"));
  const interest = report.gaps[0].details, dispatch = report.gaps[1].details, cache = report.gaps[2].details;
  assert.ok(interest.nativeAfter.events > interest.nativeBefore.events);
  assert.deepEqual(interest.react.raw, []);
  assert.deepEqual(interest.react.imperative, []);
  assert.equal(dispatch.react.raw.length, 1);
  assert.equal(dispatch.react.declarative.length, 1);
  assert.deepEqual(dispatch.react.imperative, []);
  assert.ok(cache.afterRemoval.warmParentNull && cache.afterRemoval.coldParentNull && cache.afterRemoval.parentConnected);
  assert.deepEqual(cache.afterRemoval.trace.map(entry => entry.id + "/" + entry.at), ["warm/self", "warm/old-parent", "cold/self"]);
  assert.deepEqual(report.scope, {manualDispatch: true, publicDefaultEnabled: false, nativeEventTargetIntegrated: false,
    parentCacheFixed: false, rendererOverlay: false});
  assert.deepEqual(await productionHashes(), before, "Probe cannot modify production bootstrap, interface, resolver or runtime");
  assert.equal(await publicBundleHash(), publicBefore, "Probe cannot rewrite the default public bundle");
  report.provenance = {node: process.version, bundles, productionSources: before,
    publicBundleSha256: publicBefore, nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib")))};
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
});
