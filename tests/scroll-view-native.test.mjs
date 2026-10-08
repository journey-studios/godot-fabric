import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {bundleScrollViewProbe} from "../scripts/scroll-view-bundle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const sha = value => createHash("sha256").update(value).digest("hex");

test("original RN ScrollView commands and pan use one mounted Fabric offset", async () => {
  const bundle = await bundleScrollViewProbe();
  const binary = await ensureGodotBinary();
  const hostPath = path.join(root, "addons/fabric_godot.dylib");
  const buildReceiptPath = path.join(root, ".deps/build/native-sdk-build.json");
  const hostBefore = sha(await readFile(hostPath));
  const buildReceiptBytesBefore = await readFile(buildReceiptPath);
  const receiptBefore = JSON.parse(buildReceiptBytesBefore);
  await rm(path.join(root, "build/scroll-view-gf14-report.json"), {force: true});
  const run = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/scroll-view-probe.gd"],
    {encoding: "utf8", timeout: 30000, maxBuffer: 12 * 1024 * 1024});
  const log = (run.stdout ?? "") + (run.stderr ?? "");
  await writeFile(path.join(root, "build/scroll-view-gf14.log"), log);
  const reportPath = path.join(root, "build/scroll-view-gf14-report.json");
  let report = null;
  let reportReadError = null;
  try { report = JSON.parse(await readFile(reportPath, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") reportReadError = String(error); }
  const host = await readFile(hostPath);
  const receiptBytesAfter = await readFile(buildReceiptPath);
  const receipt = JSON.parse(receiptBytesAfter);
  const expectedSourcePins = ["native/application_runtime.cpp", "native/pointer_adapter.cpp", "native/pointer_adapter.h",
    "native/scroll_adapter.cpp", "native/scroll_adapter.h", "native/scroll_motion.h", "native/scroll_offset.h",
    "native/scroll_throttle.h"];
  const compiledSourcePins = Object.fromEntries(await Promise.all(expectedSourcePins.map(async file => [file,
    {actual: sha(await readFile(path.join(root, file))), recorded: receipt.inputs.sourceSha256?.[file]}])));
  const provenance = {bundle, host: {path: "addons/fabric_godot.dylib", sha256: sha(host)},
    buildReceipt: {path: ".deps/build/native-sdk-build.json", sha256: sha(receiptBytesAfter), beforeSha256: sha(buildReceiptBytesBefore)},
    hostStableDuringProbe: hostBefore === sha(host), buildReceiptStableDuringProbe: sha(buildReceiptBytesBefore) === sha(receiptBytesAfter),
    compiledSourcePins,
    recordedHostMatches: receipt.host?.sha256 === sha(host),
    experimentalExternalAbiCertification: receipt.abiCertified === true,
    note: "Runtime probe loaded the current Godot host; receipt hash binds bytes and recorded build inputs, not external SDK ABI certification."};
  await writeFile(path.join(root, "build/scroll-view-gf14-provenance.json"), JSON.stringify({
    scenario: "gf14-scroll-view-original-mounted", bundle, hostBeforeSha256: hostBefore, reportReadError, provenance,
  }, null, 2) + "\n");
  if (report != null) {
    report.provenance = provenance;
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  }
  // Keep the report, build receipt, and loaded-host identity even when an
  // assertion fails; the evidence must remain diagnosable after a red run.
  assert.equal(run.error, undefined, log);
  assert.equal(run.signal, null, log);
  assert.equal(run.status, 0, log);
  assert.equal(reportReadError, null, log);
  assert.ok(report, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  assert.doesNotMatch(log, /\bTODO\b/);
  assert.equal(report.scenario, "gf14-scroll-view-original-mounted");
  assert.equal(report.reactNative, "0.87.1");
  assert.equal(report.displayServer, "headless");
  assert.ok(report.checks.length >= 9);
  assert.equal(new Set(report.checks.map(row => row.name)).size, report.checks.length, "checks have unique names");
  assert.ok(report.checks.every(row => row.passed), JSON.stringify(report.checks.filter(row => !row.passed)));
  const expectedChecks = ["original ScrollView mounts with content extent, default indicator, and RN Context",
    "Godot preserves horizontal through RCTScrollView create/diff only",
    "mounted original ScrollView accepts neutral RN options and still scrolls",
    "fractional offset agrees across logical state, Fabric state, and content transform",
    "RN DOM measurement follows the fractional painted offset", "omitted animated defaults to upstream animation",
    "scrollToEnd omitted options use upstream animated default",
    "immediate command replaces and cancels active animation", "native routed pan changes offset and completes one drag",
    "RN receives one measured BeginDrag, EndDrag, MomentumBegin and MomentumEnd in order",
    "native takeover cancels the child pointer and touch stream once",
    "wheel replacement retires a claimed pan once before later pointer movement and Up",
    "contentOffset replacement retires a claimed pan once before later pointer movement and Up",
    "fast release enters momentum before the next accepted Down",
    "stationary Down interrupts momentum once without an offset jump", "a row-zero tap below the pan threshold remains a tap",
    "captured child pointer prevents native pan takeover",
    "same-surface sibling pointer capture prevents native pan takeover",
    "sibling capture releases exactly once on Up",
    "fresh contact starts without the previous sibling capture",
    "hidden mounted child retires its route before later Move or Up",
    "hidden mouse contact stays suppressed until a fresh Down, then scrolls normally",
    "removing a pressed child retires its pan route while ScrollView stays mounted",
    "mounted ScrollView survives content deletion and clamps its offset",
    "actual tiny ScrollView viewport keeps indicator bounds finite", "active RN responder block prevents native scroll takeover",
    "horizontal scrollToEnd reaches right edge and preserves vertical offset",
    "second Fabric root pans horizontally and leaves the vertical root unchanged",
    "vertical scrollToEnd reaches bottom and preserves horizontal offset",
    "vertical diagonal pan and new release coordinate preserve x and have zero cross-axis momentum",
    "horizontal diagonal pan and new release coordinate preserve y and have zero cross-axis momentum",
    "orientation replacement cancels the claimed pan once before the axis changes",
    "active animated scroll is canceled when content is removed and clamps to zero"];
  assert.deepEqual(report.checks.map(row => row.name), expectedChecks, "fixed GF-14 check inventory");
  assert.ok(report.cleanup, "both Fabric roots and native tags are removed");
  assert.deepEqual(report.beforeStop.app.errors, []);
  assert.deepEqual(report.beforeStop.surface.errors, []);
  assert.deepEqual(report.beforeStop.secondarySurface.errors, []);
  assert.deepEqual(report.afterStop.app.errors, []);
  assert.deepEqual(report.afterStop.surface.errors, []);
  assert.deepEqual(report.afterStop.secondarySurface.errors, []);
  assert.equal([...log.matchAll(/^ERROR:/gm)].length,
    [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED:/gm)].length, "no unexpected engine or host errors");
  for (const file of ["node_modules/react-native/Libraries/Components/ScrollView/ScrollView.js",
    "node_modules/react-native/Libraries/Components/ScrollView/ScrollViewCommands.js",
    "node_modules/react-native/Libraries/Components/ScrollView/ScrollViewNativeComponent.js",
    "node_modules/react-native/Libraries/NativeComponent/NativeComponentRegistry.js",
    "node_modules/react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry.js",
    "node_modules/react-native/Libraries/NativeComponent/ViewConfig.js"])
    assert.ok(bundle.bundle.inputs.includes(file), "original RN component is in the bundle: " + file);
  for (const file of ["tests/scroll-view-fixture.jsx", "tests/scroll-view-probe.gd", "src/scroll-view.jsx",
    "src/scroll-view-native-config.js", "src/scroll-view-contract.mjs", "src/react-native-platform.jsx", "types/react-native.ts", "tests/types/consumer.tsx"])
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "bundle receipt pins " + file);
  assert.ok(provenance.hostStableDuringProbe && provenance.buildReceiptStableDuringProbe,
    "probe uses a stable host and build receipt");
  assert.ok(provenance.recordedHostMatches, "native build receipt identifies the loaded host bytes");
  for (const [file, pins] of Object.entries(compiledSourcePins)) {
    assert.equal(pins.recorded, pins.actual, "compiled source pin matches current " + file);
  }
  assert.match(log, /SCROLL_VIEW_GF14_REPORT=/);
});
