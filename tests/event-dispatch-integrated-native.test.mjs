import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {bundleIntegratedEventDispatchProbe} from "../scripts/event-target-bundle.mjs";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const capture = process.argv.includes("--capture");
const previousHost = process.argv.includes("--previous-host");
const queueOnly = process.argv.includes("--queue-only");
if (previousHost) assert.ok(queueOnly, "The previous-host warning control excludes the separately recorded reentrant crash case");
const digest = value => createHash("sha256").update(value).digest("hex");
async function publicBundleHash() {
  try { return digest(await readFile(path.join(root, "build/app.js"))); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
test("original EventTarget dispatcher is selected exclusively inside the real native renderer batch", async () => {
  const before = await publicBundleHash(), reports = {};
  for (const integrationMode of ["original", "integrated"]) {
    const bundles = await bundleIntegratedEventDispatchProbe({integrationMode});
    const reportPath = path.join(root, "build/event-dispatch-integrated-report.json");
    await rm(reportPath, {force: true});
    const binary = await ensureGodotBinary();
    const headed = capture && integrationMode === "integrated";
    const result = spawnSync(binary, ["--path", root, ...(headed ? [] : ["--headless"]), "--script", "res://tests/event-dispatch-integrated-probe.gd", "--", "--integration-mode=" + integrationMode, ...(headed ? ["--capture"] : []), ...(queueOnly ? ["--queue-only"] : [])],
      {encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024});
    const log = (result.stdout ?? "") + (result.stderr ?? "");
    await writeFile(path.join(root, "build/event-dispatch-integrated-" + integrationMode + ".log"), log);
    assert.equal(result.error, undefined, log);
    assert.equal(result.signal, null, log);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    report.provenance = {node: process.version, bundles, publicBundleSha256: before,
      nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib")))};
    const registryWarnings = log.split("\n").filter(row => /Inconsistency between local and platform pointer registries/.test(row));
    report.nativeQueue = {previousHostControl: previousHost, registryWarnings,
      check: {id: "native-pointer-terminal-registry-order", passed: registryWarnings.length === 0}};
    await writeFile(path.join(root, "build/event-dispatch-integrated-" + integrationMode + "-report.json"), JSON.stringify(report, null, 2) + "\n");
    assert.equal(result.status, 0, log);
    assert.equal(registryWarnings.length, previousHost ? 1 : 0, "A queued terminal event must precede native registry retirement; previous host fails this unchanged contract");
    assert.equal(report.nativeQueue.check.passed, !previousHost);
    assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use|FABRIC_CHECK_FAILED/);
    assert.equal([...log.matchAll(/^ERROR:/gm)].length, 2, "Only two configured native callback error deliveries are allowed");
    const delivered = [...log.matchAll(/^ERROR: FABRIC_ERROR: (.+)$/gm)].map(match => match[1]);
    assert.equal(delivered.length, 2);
    assert.ok(delivered[0].includes("GF integration JSX deliberate fault"));
    assert.ok(delivered[1].includes("GF integration responder deliberate fault"));
    assert.deepEqual(report.deliberateErrors, ["GF integration JSX deliberate fault", "GF integration responder deliberate fault"]);
    assert.match(log, /INTEGRATED_EVENT_DISPATCH_PASSED/);
    assert.deepEqual(report.checks.filter(row => !row.passed), []);
    assert.equal(report.integrationMode, integrationMode);
    assert.equal(report.displayServer, headed ? "macOS" : "headless");
    assert.equal(report.captures.length, headed ? 2 : 0);
    if (headed) assert.ok(report.captures.every(row => row.width === 800 && row.height === 270 && row.pixels.length === 14));
    assert.ok(report.checks.length >= 100);
    assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length);
    assert.equal(await publicBundleHash(), before, "Isolated native integration must preserve build/app.js");
    reports[integrationMode] = report;
  }
  assert.deepEqual(reports.original.provenance.bundles.sources, reports.integrated.provenance.bundles.sources);
  assert.deepEqual(reports.original.provenance.bundles.originalReactNativeSources, reports.integrated.provenance.bundles.originalReactNativeSources);
  assert.equal(reports.original.provenance.nativeHostSha256, reports.integrated.provenance.nativeHostSha256);
  assert.equal(reports.original.provenance.bundles.nativeDispatchMode, "original");
  assert.equal(reports.integrated.provenance.bundles.nativeDispatchMode, "experimental");
  assert.notEqual(reports.original.provenance.bundles.rendererTagOverlay.generatedSourceSha256,
    reports.integrated.provenance.bundles.rendererTagOverlay.generatedSourceSha256);
  await writeFile(path.join(root, "build/event-dispatch-integrated-comparison.json"), JSON.stringify({scenario: "native-event-target-renderer-integration", reports}, null, 2) + "\n");
});
