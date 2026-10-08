import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {cp, mkdtemp, mkdir, readdir, rm, symlink, readFile, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {assertConsumerCapture, assertLocalLoadPaths, auditAppLoadPaths, normalizeFrameworkPackaging, runMacOSExport, verifySignatures} from "../scripts/macos-export.mjs";
import {createHarness} from "../scripts/consumer-harness.mjs";
import {verifyAddonNativeInputs} from "../scripts/pack-addon.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const runner = path.join(root, "scripts/macos-export.mjs");
const checkInventory = JSON.parse(await readFile(path.join(root, "scripts/macos-export-checks.json"), "utf8"));
const nativeTemplate = process.env.MACOS_EXPORT_TEMPLATE ? path.resolve(process.env.MACOS_EXPORT_TEMPLATE) : null;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

function run(args, cwd) {
  return spawnSync(process.execPath, [runner, ...args], {cwd, encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024});
}

test("macOS export documents its required new-output contract without starting a build", () => {
  const result = run(["--help"], root);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--out NEW\.app/);
  assert.match(result.stdout, /observed archive and member hashes/);
});

test("macOS export requires an explicit template before provisioning", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "godot-fabric-export-template-required-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const result = run(["--out", path.join(directory, "new.app")], directory);
  assert.equal(result.error, undefined, result.stderr);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--template REVIEWED-GODOT-4\.7\.2-ARM64\.zip/);
  assert.doesNotMatch(result.stderr, /GODOT_FABRIC_PROVISIONED|provisioning/i);
});

test("macOS export refuses existing and dangling-symlink destinations before provisioning", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "godot-fabric-export-destination-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const existing = path.join(directory, "existing.app");
  await mkdir(existing);
  const dangling = path.join(directory, "dangling.app");
  await symlink(path.join(directory, "missing-target.app"), dangling);
  for (const output of [existing, dangling]) {
    const result = run(["--out", output, "--template", path.join(directory, "missing-template.zip")], directory);
    assert.equal(result.error, undefined, result.stderr);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Refusing to overwrite an existing output path/);
    assert.doesNotMatch(result.stderr, /GODOT_FABRIC_PROVISIONED|provisioning/i);
  }
});

test("committed consumer oracle preserves the exact 40/43 check names and capture order", () => {
  assert.equal(checkInventory.format, "godot-fabric.macos-export-consumer-checks/v1");
  assert.equal(checkInventory.sourceFixture, "consumers/minimal/validation.gd");
  assert.equal(checkInventory.headless.length, 40);
  assert.equal(checkInventory.headed.length, 43);
  assert.equal(new Set(checkInventory.headless).size, 40);
  assert.equal(new Set(checkInventory.headed).size, 43);
  assert.deepEqual(checkInventory.headed.filter(name => name.startsWith("Consumer capture saved:")), [
    "Consumer capture saved: initial", "Consumer capture saved: updated", "Consumer capture saved: resized",
  ]);
});

function pngHeader(width, height) {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function consumerCaptureReport(window = {width: 1080, height: 600, scale: 0.5, fontScale: 1}, geometryWindow = window) {
  return {beforeStop: {dimensions: {window}}, geometry: {windowMetrics: {window: geometryWindow}}};
}

test("headed consumer capture requires the fixed physical image and matching logical RN metrics", () => {
  const expected = consumerCaptureReport();
  assert.deepEqual(assertConsumerCapture(pngHeader(540, 300), "initial", expected), {width: 540, height: 300});
  assert.throws(() => assertConsumerCapture(pngHeader(1024, 600), "clamped", expected), /fixed exported window/);
  assert.throws(() => assertConsumerCapture(pngHeader(540, 300), "wrong-logical-window",
    consumerCaptureReport({width: 1024, height: 600, scale: 0.5, fontScale: 1})), /logical window or scale/);
  assert.throws(() => assertConsumerCapture(pngHeader(540, 300), "wrong-scale",
    consumerCaptureReport({width: 1080, height: 600, scale: 1, fontScale: 1})), /logical window or scale/);
  assert.throws(() => assertConsumerCapture(pngHeader(540, 300), "missing-window",
    {beforeStop: {dimensions: {}}, geometry: {windowMetrics: {}}}), /omitted RN window metrics/);
  assert.throws(() => assertConsumerCapture(pngHeader(540, 300), "geometry-mismatch",
    consumerCaptureReport(undefined, {width: 1080, height: 600, scale: 0.5, fontScale: 2})), /geometry window metrics differ/);
});

test("load-path validation permits contained loader paths and rejects traversal", () => {
  const app = path.join(os.tmpdir(), "Godot Fabric.app");
  const host = path.join(app, "Contents/Frameworks/fabric_godot.dylib");
  assert.doesNotThrow(() => assertLocalLoadPaths([
    "@rpath/hermesvm.framework/Versions/1/hermesvm", "@loader_path/frameworks",
    "@loader_path", "@executable_path",
    "/System/Library/Frameworks/AppKit.framework/AppKit", "/usr/lib/libSystem.B.dylib",
  ], host, app));
  assert.throws(() => assertLocalLoadPaths(["@rpath/../outside.dylib"], host, app), /unsafe @rpath traversal suffix/);
  assert.throws(() => assertLocalLoadPaths(["@loader_path/../../../../outside.dylib"], host, app), /escapes the \.app/);
  assert.throws(() => assertLocalLoadPaths(["/workspace/developer/libcustom.dylib"], host, app), /unexpected absolute path/);
});

function appBinaries(app, executableName) {
  const contents = path.join(app, "Contents");
  return [
    {label: "app-executable", path: path.join(contents, "MacOS", executableName)},
    {label: "host", path: path.join(contents, "Frameworks", "fabric_godot.dylib")},
  ];
}

async function copyApp(source, destination) {
  await cp(source, destination, {recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false});
}

async function controlHarness(name) {
  const harness = await createHarness({template: "minimal", name});
  await mkdir(harness.project, {recursive: true});
  return harness;
}

test("native macOS arm64 export and copied-app rejection controls", {
  skip: nativeTemplate ? false : "MACOS_EXPORT_TEMPLATE is unset; native export requires the reviewed Godot arm64 Release template",
}, async t => {
  const startedAt = new Date().toISOString();
  const token = randomUUID();
  const outputDirectory = path.join(root, "build", `macos-export-native-positive-${token}`);
  await mkdir(outputDirectory);
  const output = path.join(outputDirectory, "Verified.app");
  const positive = await runMacOSExport({template: nativeTemplate, output});
  const receipt = positive.receipt;
  assert.equal(receipt.status, "passed");
  assert.equal(receipt.published, true);
  assert.deepEqual(receipt.runtimes.map(item => item.checkCount), [40, 43]);
  assert.equal(receipt.captures.length, 3);
  assert.equal(receipt.pack.bundleEmbeddedByteForByte, true);
  assert.ok(receipt.app.signing.includes("verified"));

  const controlsName = `macos-export-native-controls-${token}`;
  const controlsDirectory = path.join(root, "build", controlsName);
  await mkdir(controlsDirectory);
  const controls = [];
  const executableName = receipt.app.executableName;
  const frameworkRelative = path.join("Contents", "Frameworks", "frameworks", "ReactNativeDependencies.framework");

  const idempotentApp = path.join(controlsDirectory, "idempotent-framework-layout.app");
  await copyApp(output, idempotentApp);
  const normalization = await normalizeFrameworkPackaging(idempotentApp);
  for (const framework of normalization.frameworks) {
    assert.equal(framework.beforeTreeSha256, framework.afterTreeSha256, `${framework.name} changed on repeated normalization`);
    assert.ok(framework.aliases.every(alias => alias.action === "retained-symlink"), `${framework.name} aliases were not already normalized`);
    assert.ok(framework.resourceBundles.every(bundle => bundle.action === "retained-symlink"), `${framework.name} resource bundles were not already normalized`);
  }
  const idempotentHarness = await controlHarness(`${controlsName}-idempotent`);
  t.after(() => idempotentHarness.cleanup());
  await verifySignatures(idempotentHarness, idempotentApp);
  controls.push({name: "framework-normalization-is-idempotent-and-preserves-signatures", app: idempotentApp,
    logDirectory: idempotentHarness.directory, normalization});

  const missingFrameworkApp = path.join(controlsDirectory, "missing-rn-dependencies.app");
  const rnDependenciesBinary = path.join(output, "Contents", "Frameworks", "frameworks",
    "ReactNativeDependencies.framework", "Versions", "A", "ReactNativeDependencies");
  const rnDependenciesSha256 = digest(await readFile(rnDependenciesBinary));
  await copyApp(output, missingFrameworkApp);
  await rm(path.join(missingFrameworkApp, frameworkRelative), {recursive: true});
  const missingHarness = await controlHarness(`${controlsName}-missing-framework`);
  t.after(() => missingHarness.cleanup());
  let missingReason;
  await assert.rejects(
    () => auditAppLoadPaths(missingHarness, missingFrameworkApp, appBinaries(missingFrameworkApp, executableName)),
    error => { missingReason = error.message; return /ENOENT|no such file/i.test(error.message); },
  );
  controls.push({name: "missing-rn-dependencies-framework", app: missingFrameworkApp,
    logDirectory: missingHarness.directory, rejectedBy: "auditAppLoadPaths",
    removedBinarySha256: rnDependenciesSha256, reason: missingReason});

  const plistApp = path.join(controlsDirectory, "modified-info-plist.app");
  await copyApp(output, plistApp);
  const plistPath = path.join(plistApp, "Contents", "Info.plist");
  const plistBefore = await readFile(plistPath);
  const plistText = plistBefore.toString("utf8");
  assert.match(plistText, /<plist[\s>]/, "exported Info.plist is not XML; harmless whitespace control is unavailable");
  assert.match(plistText, /<\/plist>\s*$/);
  const plistAfter = Buffer.concat([plistBefore, Buffer.from("\n")]);
  assert.notEqual(digest(plistBefore), digest(plistAfter));
  await writeFile(plistPath, plistAfter);
  const signatureHarness = await controlHarness(`${controlsName}-signature`);
  t.after(() => signatureHarness.cleanup());
  let signatureReason;
  await assert.rejects(() => verifySignatures(signatureHarness, plistApp),
    error => { signatureReason = error.message; return true; });
  assert.match(signatureReason, /invalid Info\.plist \(plist or signature have been modified\)/,
    "signature control must reject the modified plist through codesign");
  const signatureLogNames = await readdir(signatureHarness.directory);
  // The executable's signature binds its enclosing Info.plist and rejects it
  // before the enclosing app verification, so commands 0..7 must have run.
  for (let index = 0; index <= 7; index++)
    assert.ok(signatureLogNames.includes(`verify-signature-${index}.log`),
      `signature control did not reach production verification command ${index}`);
  controls.push({name: "xml-whitespace-invalidates-signed-info-plist", app: plistApp,
    logDirectory: signatureHarness.directory, beforeSha256: digest(plistBefore), mutationSha256: digest(plistAfter), rejectedBy: "verifySignatures", reason: signatureReason});

  const rpathApp = path.join(controlsDirectory, "absolute-rpath.app");
  await copyApp(output, rpathApp);
  const host = path.join(rpathApp, "Contents", "Frameworks", "fabric_godot.dylib");
  const rpathHarness = await controlHarness(`${controlsName}-rpath`);
  t.after(() => rpathHarness.cleanup());
  await rpathHarness.run("install-absolute-rpath", "/usr/bin/install_name_tool", ["-add_rpath", "/fabric-export-negative", host]);
  const mutatedHostSha256 = digest(await readFile(host));
  let rpathReason;
  await assert.rejects(
    () => auditAppLoadPaths(rpathHarness, rpathApp, appBinaries(rpathApp, executableName)),
    error => { rpathReason = error.message; return /unexpected absolute path: \/fabric-export-negative/.test(error.message); },
  );
  controls.push({name: "absolute-rpath-rejected", app: rpathApp, mutation: "/usr/bin/install_name_tool -add_rpath /fabric-export-negative",
    logDirectory: rpathHarness.directory, mutationSha256: mutatedHostSha256,
    rejectedBy: "auditAppLoadPaths", reason: rpathReason});

  const sourceCopy = path.join(controlsDirectory, "native-source-copy");
  const sourcePaths = ["native", "scripts/rn-pointer-overlay.mjs", "dependencies.json", ".deps/build/native-sdk-build.json",
    "addons/fabric_godot.dylib", "addons/frameworks"];
  for (const relative of sourcePaths) {
    const source = path.join(root, relative);
    const destination = path.join(sourceCopy, relative);
    await mkdir(path.dirname(destination), {recursive: true});
    await cp(source, destination, {recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false});
  }
  const matchingNativeInputs = await verifyAddonNativeInputs({sourceRoot: sourceCopy});
  const lockPath = path.join(sourceCopy, "dependencies.json");
  const originalLockBytes = await readFile(lockPath);
  const staleLock = JSON.parse(originalLockBytes.toString("utf8"));
  staleLock.godot.version += ".stale-control";
  const staleLockBytes = Buffer.from(JSON.stringify(staleLock, null, 2) + "\n");
  await writeFile(lockPath, staleLockBytes);
  let sourceReason;
  await assert.rejects(
    () => verifyAddonNativeInputs({sourceRoot: sourceCopy}),
    error => { sourceReason = error.message; return error.code === "SDK_HOST_SOURCE_MISMATCH"; },
  );
  controls.push({name: "stale-native-source-lock-rejected", sourceCopy, rejectedBy: "verifyAddonNativeInputs",
    reason: sourceReason, modifiedFile: "dependencies.json", beforeSha256: digest(originalLockBytes),
    mutationSha256: digest(staleLockBytes)});

  const controlReport = {
    format: "godot-fabric.macos-export-native-controls/v1",
    status: "passed", startedAt, completedAt: new Date().toISOString(),
    positive: {app: output, sdkSourceCommit: receipt.sdk.sourceCommit, harnessDirectory: positive.directory, receiptPath: path.join(positive.directory, "receipt.json"),
      hostSha256: receipt.app.host.source.sha256, checkCounts: [40, 43], pckSha256: receipt.pack.pckSHA256},
    controls,
    nativeSourceControl: {matchingInputsAccepted: true, nativeHashes: matchingNativeInputs.nativeHashes,
      staleDependenciesRejected: true},
  };
  await writeFile(path.join(controlsDirectory, "report.json"), JSON.stringify(controlReport, null, 2) + "\n");
});
