import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {bundleScrollViewModalProbe} from "../scripts/scroll-view-bundle.mjs";
import {assertScrollViewModalReport} from "./scroll-view-modal-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const sha = value => createHash("sha256").update(value).digest("hex");

test("original RN Modal wheel events reach its mounted ScrollView", {timeout: 120000}, async () => {
  const reportPath = path.join(root, "build/scroll-view-modal-report.json");
  const logPath = path.join(root, "build/scroll-view-modal.log");
  const provenancePath = path.join(root, "build/scroll-view-modal-provenance.json");
  await Promise.all([rm(reportPath, {force: true}), rm(logPath, {force: true}), rm(provenancePath, {force: true})]);

  const bundle = await bundleScrollViewModalProbe();
  const binary = await ensureGodotBinary();
  const hostPath = path.join(root, "addons/fabric_godot.dylib");
  const receiptPath = path.join(root, ".deps/build/native-sdk-build.json");
  const hostBefore = sha(await readFile(hostPath));
  const receiptBytesBefore = await readFile(receiptPath);
  const run = spawnSync(binary, ["--path", root, "--script", "res://tests/scroll-view-modal-probe.gd"],
    {encoding: "utf8", timeout: 90000, maxBuffer: 12 * 1024 * 1024});
  const log = (run.stdout ?? "") + (run.stderr ?? "");
  await writeFile(logPath, log);

  let report = null;
  let reportReadError = null;
  try { report = JSON.parse(await readFile(reportPath, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") reportReadError = String(error); }

  const [host, receiptBytesAfter] = await Promise.all([readFile(hostPath), readFile(receiptPath)]);
  const hostAfter = sha(host);
  const receiptAfter = JSON.parse(receiptBytesAfter);
  const nativePins = ["native/application_runtime.cpp", "native/application_runtime.h",
    "native/scroll_adapter.cpp", "native/scroll_adapter.h", "native/modal_presentation.cpp",
    "native/modal_presentation.h", "native/physical_embedding.cpp", "native/physical_embedding.h"];
  const compiledSourcePins = Object.fromEntries(await Promise.all(nativePins.map(async file => [file, {
    actual: sha(await readFile(path.join(root, file))), recorded: receiptAfter.inputs.sourceSha256?.[file],
  }])));
  const provenance = {
    bundle,
    host: {path: "addons/fabric_godot.dylib", sha256: hostAfter},
    buildReceipt: {path: ".deps/build/native-sdk-build.json", sha256: sha(receiptBytesAfter), beforeSha256: sha(receiptBytesBefore)},
    hostStableDuringProbe: hostBefore === hostAfter,
    buildReceiptStableDuringProbe: sha(receiptBytesBefore) === sha(receiptBytesAfter),
    recordedHostMatches: receiptAfter.host?.sha256 === hostAfter,
    compiledSourcePins,
    note: "Headed Godot probe delivers owner-window input to the current embedded RN Modal Window; receipt binds loaded host bytes and recorded native inputs.",
  };
  if (report) {
    report.provenance = provenance;
    await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  }
  await writeFile(provenancePath, JSON.stringify({scenario: "scroll-view-modal-wheel-routing", reportReadError,
    hostBeforeSha256: hostBefore, provenance}, null, 2) + "\n");

  assert.equal(run.error, undefined, log);
  assert.equal(run.signal, null, log);
  assert.equal(run.status, 0, log);
  assert.equal(reportReadError, null, log);
  assert.ok(report, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|Segmentation fault|Stack overflow|ObjectDB instances leaked|Resources still in use/);
  assert.equal([...log.matchAll(/^ERROR:/gm)].length,
    [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED:/gm)].length, "no unexpected engine or host errors");
  assert.match(log, /SCROLL_VIEW_MODAL_REPORT=PASS checks=13/);
  assertScrollViewModalReport(report);

  for (const file of ["tests/scroll-view-modal-fixture.jsx", "tests/scroll-view-modal-probe.gd",
    "tests/scroll-view-modal-native.test.mjs", "tests/scroll-view-modal-oracle.mjs",
    "src/scroll-view.jsx", "src/scroll-view-native-config.js", "src/scroll-view-contract.mjs",
    "src/react-native-platform.jsx"])
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "bundle receipt pins " + file);
  for (const file of ["node_modules/react-native/Libraries/Components/ScrollView/ScrollView.js",
    "node_modules/react-native/Libraries/Components/ScrollView/ScrollViewCommands.js",
    "node_modules/react-native/Libraries/Components/ScrollView/ScrollViewNativeComponent.js",
    "node_modules/react-native/Libraries/Modal/Modal.js",
    "node_modules/react-native/Libraries/Modal/RCTModalHostViewNativeComponent.js"])
    assert.ok(bundle.bundle.inputs.includes(file), "original RN producer is bundled: " + file);
  assert.ok(provenance.hostStableDuringProbe && provenance.buildReceiptStableDuringProbe,
    "probe keeps the loaded host and build receipt stable");
  assert.ok(provenance.recordedHostMatches, "build receipt identifies the loaded native host");
  assert.equal(receiptAfter.abiCertified, false,
    "native SDK receipt does not claim external ABI certification");
  for (const [file, pins] of Object.entries(compiledSourcePins))
    assert.equal(pins.recorded, pins.actual, "compiled native source pin matches " + file);
});
