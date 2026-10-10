import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {spawnSync} from "node:child_process";
import {chmod, cp, mkdtemp, mkdir, readdir, rm, symlink, readFile, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {assertConsumerCapture, assertLocalLoadPaths, auditAppLoadPaths, normalizeFrameworkPackaging, retainFailedConsumerOutputs, runMacOSExport, verifySignatures} from "../scripts/macos-export.mjs";
import {createHarness} from "../scripts/consumer-harness.mjs";
import {GODOT_VERSION} from "../scripts/godot-binary.mjs";
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

test("load-path validation checks real targets behind app aliases and symlinks", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "godot-fabric-load-path-symlinks-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const app = path.join(directory, "Godot Fabric.app");
  const contents = path.join(app, "Contents");
  const frameworks = path.join(contents, "Frameworks");
  const executableDirectory = path.join(contents, "MacOS");
  const host = path.join(frameworks, "fabric_godot.dylib");
  const executable = path.join(executableDirectory, "Godot Fabric");
  const internal = path.join(frameworks, "inside.dylib");
  const internalAfterDotDot = path.join(frameworks, "internal", "inside.dylib");
  const internalLink = path.join(frameworks, "inside-link.dylib");
  const external = path.join(directory, "outside.dylib");
  const loaderEscape = path.join(frameworks, "loader-escape.dylib");
  const executableEscape = path.join(executableDirectory, "executable-escape.dylib");
  const loaderJump = path.join(frameworks, "jump");
  const executableJump = path.join(executableDirectory, "jump");
  const dangling = path.join(frameworks, "dangling.dylib");
  await mkdir(path.join(app, "..framework"), {recursive: true});
  await mkdir(frameworks, {recursive: true});
  await mkdir(path.join(frameworks, "frameworks"), {recursive: true});
  await mkdir(path.join(frameworks, "internal", "child"), {recursive: true});
  await mkdir(executableDirectory, {recursive: true});
  const externalDirectory = path.join(directory, "external-target");
  const executableExternalDirectory = path.join(directory, "executable-external-target");
  await mkdir(path.join(externalDirectory, "child"), {recursive: true});
  await mkdir(path.join(executableExternalDirectory, "child"), {recursive: true});
  for (const file of [host, executable, internal, internalAfterDotDot, external, path.join(frameworks, "owned.dylib"),
    path.join(executableDirectory, "owned.dylib"), path.join(externalDirectory, "owned.dylib"),
    path.join(executableExternalDirectory, "owned.dylib"), path.join(app, "..framework", "inside")])
    await writeFile(file, "private load-path fixture\n");
  await symlink("inside.dylib", internalLink);
  await symlink(external, loaderEscape);
  await symlink(external, executableEscape);
  await symlink(path.join(externalDirectory, "child"), loaderJump);
  await symlink(path.join(executableExternalDirectory, "child"), executableJump);
  await symlink(path.join(frameworks, "internal", "child"), path.join(frameworks, "internal-jump"));
  await symlink("missing-target.dylib", dangling);

  await assert.doesNotReject(() => assertLocalLoadPaths([
    "@rpath/hermesvm.framework/Versions/1/hermesvm", "@loader_path/frameworks",
    "@loader_path", "@executable_path", "@loader_path/../..", "@loader_path/../../..framework/inside",
    "@loader_path/inside-link.dylib", "@executable_path/../Frameworks/inside-link.dylib",
    "@loader_path/internal-jump/../inside.dylib",
    "/System/Library/Frameworks/AppKit.framework/AppKit", "/usr/lib/libSystem.B.dylib",
    "/usr/lib/sub/../libSystem.B.dylib",
  ], host, app));
  const appAlias = path.join(directory, "Fixture Alias.app");
  await symlink(app, appAlias);
  await assert.doesNotReject(() => assertLocalLoadPaths(["@loader_path/inside-link.dylib"],
    path.join(appAlias, "Contents/Frameworks/fabric_godot.dylib"), appAlias));

  await assert.rejects(() => assertLocalLoadPaths(["@rpath/../outside.dylib"], host, app), /unsafe @rpath traversal suffix/);
  await assert.rejects(() => assertLocalLoadPaths(["@loader_path/../../../outside.dylib"], host, app), /escapes the \.app/);
  await assert.rejects(() => assertLocalLoadPaths(["@loader_path/../../../Godot Fabric.app-sibling/host.dylib"], host, app), /escapes the \.app/);
  await assert.rejects(() => assertLocalLoadPaths(["@loader_path/loader-escape.dylib"], host, app), /resolves outside the \.app/);
  await assert.rejects(() => assertLocalLoadPaths(["@executable_path/executable-escape.dylib"], host, app), /resolves outside the \.app/);
  await assert.rejects(() => assertLocalLoadPaths(["@loader_path/jump/../owned.dylib"], host, app), /resolves outside the \.app/);
  await assert.rejects(() => assertLocalLoadPaths(["@executable_path/jump/../owned.dylib"], host, app), /resolves outside the \.app/);
  await assert.rejects(() => assertLocalLoadPaths(["@loader_path/dangling.dylib"], host, app), /ENOENT|no such file/i);
  await assert.rejects(() => assertLocalLoadPaths(["/workspace/developer/libcustom.dylib"], host, app), /unexpected absolute path/);
  await assert.rejects(() => assertLocalLoadPaths(["/usr/lib/../../outside.dylib"], host, app), /unsafe system load path/);
  await assert.rejects(() => assertLocalLoadPaths(["/System/Library/../../outside.dylib"], host, app), /unsafe system load path/);
});

test("load-path audit awaits realpath containment for Mach-O aliases", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "godot-fabric-load-audit-symlink-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const app = path.join(directory, "Fixture.app");
  const host = path.join(app, "Contents/Frameworks/fabric_godot.dylib");
  const executable = path.join(app, "Contents/MacOS/Fixture");
  const external = path.join(directory, "outside.dylib");
  await mkdir(path.dirname(host), {recursive: true});
  await mkdir(path.dirname(executable), {recursive: true});
  await mkdir(path.join(path.dirname(host), "frameworks"), {recursive: true});
  await mkdir(path.join(path.dirname(host), "frameworks", "hermesvm.framework/Versions/1"), {recursive: true});
  await mkdir(path.join(path.dirname(host), "frameworks", "ReactNativeDependencies.framework/Versions/A"), {recursive: true});
  await writeFile(host, "host placeholder\n");
  await writeFile(executable, "executable placeholder\n");
  await writeFile(path.join(path.dirname(host), "frameworks", "hermesvm.framework/Versions/1/hermesvm"), "hermes placeholder\n");
  await writeFile(path.join(path.dirname(host), "frameworks", "ReactNativeDependencies.framework/Versions/A/ReactNativeDependencies"), "dependencies placeholder\n");
  await writeFile(external, "external target\n");
  await symlink(external, path.join(path.dirname(host), "escape.dylib"));
  const externalSearch = path.join(directory, "external-search");
  const externalSearchChild = path.join(directory, "external-search-parent", "child");
  await mkdir(externalSearch);
  await mkdir(externalSearchChild, {recursive: true});
  await symlink(externalSearch, path.join(path.dirname(host), "external-search"));
  await symlink(externalSearchChild, path.join(path.dirname(host), "external-parent"));
  const machoOutput = (escapedLoad, rpath = "@loader_path/external-search") => [
    "Load command 0", "          cmd LC_LOAD_DYLIB",
    `         name ${escapedLoad ? "@loader_path/escape.dylib" : "@rpath/hermesvm.framework/Versions/1/hermesvm"} (offset 24)`,
    "Load command 1", "          cmd LC_LOAD_DYLIB",
    `         name ${escapedLoad ? "@rpath/hermesvm.framework/Versions/1/hermesvm" : "@rpath/ReactNativeDependencies.framework/Versions/A/ReactNativeDependencies"} (offset 24)`,
    "Load command 2", "          cmd LC_LOAD_DYLIB",
    `         name ${escapedLoad ? "@rpath/ReactNativeDependencies.framework/Versions/A/ReactNativeDependencies" : "/usr/lib/libSystem.B.dylib"} (offset 24)`,
    "Load command 3", "          cmd LC_RPATH", "         path @loader_path/frameworks (offset 12)",
    ...(escapedLoad ? [] : ["Load command 4", "          cmd LC_RPATH", `         path ${rpath} (offset 12)`]),
  ].join("\n");
  let macho = machoOutput(true);
  const harness = {env: {}, project: directory, async run() { return macho; }};
  const binaries = [{label: "host", path: host}];
  await assert.rejects(() => auditAppLoadPaths(harness, app, binaries), /resolves outside the \.app/);
  macho = machoOutput(false);
  await assert.rejects(() => auditAppLoadPaths(harness, app, binaries), /resolves outside the \.app/);
  macho = machoOutput(false, "@loader_path/external-parent/..");
  await assert.rejects(() => auditAppLoadPaths(harness, app, binaries), /resolves outside the \.app/);
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

test("generic subprocesses allow diagnostic literals while Godot editor and runtime reject fatal output", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "godot-fabric-harness-fatal-boundary-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const fakeGodot = path.join(directory, "godot-fixture");
  await writeFile(fakeGodot, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo ${GODOT_VERSION}.stable.official.fixture; exit 0; fi\nprintf '%s\\n' "$FAKE_GODOT_OUTPUT"\nexit "$FAKE_GODOT_STATUS"\n`);
  await chmod(fakeGodot, 0o755);

  const previousGodot = process.env.GODOT_BIN;
  process.env.GODOT_BIN = fakeGodot;
  let harness;
  try {
    harness = await controlHarness(`macos-export-harness-fatal-${randomUUID()}`);
    const literals = "SCRIPT ERROR | Program crashed | CONSUMER_CHECK_FAILED";
    const genericLog = await harness.run("generic-diagnostic-literals", process.execPath,
      ["-e", `process.stdout.write(${JSON.stringify(literals)})`]);
    assert.equal(genericLog, literals, "generic subprocess output must remain data");
    await assert.rejects(harness.run("generic-unexpected-exit", process.execPath,
      ["-e", "process.exit(7)"]), /AssertionError|assert/);

    harness.env.FAKE_GODOT_OUTPUT = "CONSUMER_EDITOR_BUILD_REJECTED\nSCRIPT ERROR: injected fatal marker";
    harness.env.FAKE_GODOT_STATUS = "1";
    await assert.rejects(harness.editor("editor-rejection-with-script-error", 1), /SCRIPT ERROR/);
    for (const [index, fatal] of ["Program crashed", "CONSUMER_CHECK_FAILED: injected fatal marker"].entries()) {
      harness.env.FAKE_GODOT_OUTPUT = `CONSUMER_EDITOR_BUILD_REJECTED\n${fatal}`;
      await assert.rejects(harness.editor(`editor-rejection-${index}`, 1), error => error.message.includes(fatal));
    }
    harness.env.FAKE_GODOT_OUTPUT = "CONSUMER_EDITOR_BUILD_REJECTED\nERROR: Missing optional module";
    assert.match(await harness.editor("editor-legitimate-rejection", 1), /CONSUMER_EDITOR_BUILD_REJECTED/);

    harness.env.FAKE_GODOT_STATUS = "0";
    harness.env.FAKE_GODOT_OUTPUT = "CONSUMER_VALIDATION_PASSED\nCONSUMER_CHECK_FAILED: injected fatal marker";
    await assert.rejects(harness.runtime("runtime-fatal-before-report-read", {
      marker: /CONSUMER_VALIDATION_PASSED/, report: "missing-report.json", expectedChecks: 40,
    }), /CONSUMER_CHECK_FAILED/);
    assert.match(await readFile(path.join(harness.directory, "runtime-fatal-before-report-read.log"), "utf8"),
      /CONSUMER_VALIDATION_PASSED[\s\S]*CONSUMER_CHECK_FAILED/);
  } finally {
    if (previousGodot === undefined) delete process.env.GODOT_BIN;
    else process.env.GODOT_BIN = previousGodot;
    if (harness) {
      await harness.cleanup();
      await rm(harness.directory, {recursive: true, force: true});
    }
  }
});

test("failed consumer outputs are retained byte-for-byte and missing outputs are allowed", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "godot-fabric-failed-consumer-outputs-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const userData = path.join(directory, "owned-user-data");
  const evidence = path.join(directory, "evidence");
  await mkdir(userData);
  await mkdir(evidence);
  const contents = new Map([
    ["consumer-report.json", Buffer.from('{"checks":[]}\n')],
    ["consumer-initial.png", Buffer.from([0, 1, 2, 3])],
    ["consumer-updated.png", Buffer.from([4, 5, 6])],
    ["consumer-resized.png", Buffer.from([7, 8])],
  ]);
  for (const [name, bytes] of contents) await writeFile(path.join(userData, name), bytes);

  const retained = await retainFailedConsumerOutputs(userData, evidence);
  assert.equal(retained.length, contents.size);
  assert.deepEqual((await readdir(evidence)).sort(), [
    "runtime-failed-consumer-initial.png", "runtime-failed-consumer-report.json",
    "runtime-failed-consumer-resized.png", "runtime-failed-consumer-updated.png",
  ]);
  for (const [name, bytes] of contents) {
    const targetName = `runtime-failed-${name}`;
    const saved = await readFile(path.join(evidence, targetName));
    assert.deepEqual(saved, bytes);
    assert.equal(retained.find(item => item.targetName === targetName)?.sha256, digest(bytes));
    assert.deepEqual(await readFile(path.join(userData, name)), bytes, "retention must leave source output untouched");
  }

  const empty = path.join(directory, "empty-user-data");
  await mkdir(empty);
  assert.deepEqual(await retainFailedConsumerOutputs(empty, evidence), []);
  const missing = path.join(directory, "missing-user-data");
  assert.deepEqual(await retainFailedConsumerOutputs(missing, evidence), []);
});

test("failed consumer output retention rejects symlinks before copying anything", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "godot-fabric-failed-consumer-symlink-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const userData = path.join(directory, "owned-user-data");
  const evidence = path.join(directory, "evidence");
  await mkdir(userData);
  await mkdir(evidence);
  const outside = path.join(directory, "outside.json");
  await writeFile(outside, "outside bytes");
  await writeFile(path.join(userData, "consumer-report.json"), "raw report");
  await writeFile(path.join(userData, "consumer-initial.png"), "raw initial");
  await writeFile(path.join(userData, "consumer-updated.png"), "raw updated");
  await symlink(outside, path.join(userData, "consumer-resized.png"));

  await assert.rejects(retainFailedConsumerOutputs(userData, evidence), /not a regular file/);
  assert.deepEqual(await readdir(evidence), [], "the last invalid input must be detected before any copy");
  assert.equal(await readFile(outside, "utf8"), "outside bytes");
  await rm(path.join(userData, "consumer-resized.png"));
  await mkdir(path.join(userData, "consumer-resized.png"));
  await assert.rejects(retainFailedConsumerOutputs(userData, evidence), /not a regular file/);
  assert.deepEqual(await readdir(evidence), []);
});

test("failed consumer output retention rejects a symlinked user-data directory", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "godot-fabric-failed-consumer-userdata-link-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const actual = path.join(directory, "actual-user-data");
  const linked = path.join(directory, "linked-user-data");
  const evidence = path.join(directory, "evidence");
  await mkdir(actual);
  await mkdir(evidence);
  await writeFile(path.join(actual, "consumer-report.json"), "raw report");
  await symlink(actual, linked);

  await assert.rejects(retainFailedConsumerOutputs(linked, evidence), /user-data path is not a real directory/);
  assert.deepEqual(await readdir(evidence), []);
  assert.equal(await readFile(path.join(actual, "consumer-report.json"), "utf8"), "raw report");
});

test("failed consumer output retention refuses existing evidence destinations", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "godot-fabric-failed-consumer-destination-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const userData = path.join(directory, "owned-user-data");
  const evidence = path.join(directory, "evidence");
  await mkdir(userData);
  await mkdir(evidence);
  await writeFile(path.join(userData, "consumer-report.json"), "raw report");
  await writeFile(path.join(userData, "consumer-initial.png"), "raw image");
  await writeFile(path.join(evidence, "runtime-failed-consumer-initial.png"), "preexisting");

  await assert.rejects(retainFailedConsumerOutputs(userData, evidence), /refusing to overwrite/);
  assert.deepEqual(await readdir(evidence), ["runtime-failed-consumer-initial.png"]);
  assert.equal(await readFile(path.join(userData, "consumer-report.json"), "utf8"), "raw report");
  assert.equal(await readFile(path.join(userData, "consumer-initial.png"), "utf8"), "raw image");
});

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

  const symlinkRpathApp = path.join(controlsDirectory, "symlink-rpath.app");
  await copyApp(output, symlinkRpathApp);
  const externalSearch = path.join(controlsDirectory, "external-search");
  await mkdir(externalSearch);
  await writeFile(path.join(externalSearch, "private-control.dylib"), "external search-path target\n");
  const symlinkRpath = path.join(symlinkRpathApp, "Contents", "Frameworks", "external-search");
  await symlink(externalSearch, symlinkRpath);
  const symlinkHost = path.join(symlinkRpathApp, "Contents", "Frameworks", "fabric_godot.dylib");
  const symlinkRpathHarness = await controlHarness(`${controlsName}-symlink-rpath`);
  t.after(() => symlinkRpathHarness.cleanup());
  await symlinkRpathHarness.run("install-symlink-rpath", "/usr/bin/install_name_tool",
    ["-add_rpath", "@loader_path/external-search", symlinkHost]);
  const symlinkRpathHostSha256 = digest(await readFile(symlinkHost));
  let symlinkRpathReason;
  await assert.rejects(
    () => auditAppLoadPaths(symlinkRpathHarness, symlinkRpathApp, appBinaries(symlinkRpathApp, executableName)),
    error => { symlinkRpathReason = error.message; return /resolves outside the \.app/.test(error.message); },
  );
  controls.push({name: "symlink-rpath-target-outside-app-rejected", app: symlinkRpathApp,
    mutation: "@loader_path/external-search symlink to a private external directory",
    externalTarget: externalSearch, hostSha256: symlinkRpathHostSha256, logDirectory: symlinkRpathHarness.directory,
    rejectedBy: "auditAppLoadPaths", reason: symlinkRpathReason});

  const symlinkParentRpathApp = path.join(controlsDirectory, "symlink-parent-rpath.app");
  await copyApp(output, symlinkParentRpathApp);
  const symlinkParentTarget = path.join(controlsDirectory, "symlink-parent-target", "child");
  await mkdir(symlinkParentTarget, {recursive: true});
  const symlinkParent = path.join(symlinkParentRpathApp, "Contents", "Frameworks", "external-search");
  await symlink(symlinkParentTarget, symlinkParent);
  const symlinkParentHost = path.join(symlinkParentRpathApp, "Contents", "Frameworks", "fabric_godot.dylib");
  const symlinkParentHarness = await controlHarness(`${controlsName}-symlink-parent-rpath`);
  t.after(() => symlinkParentHarness.cleanup());
  await symlinkParentHarness.run("install-symlink-parent-rpath", "/usr/bin/install_name_tool",
    ["-add_rpath", "@loader_path/external-search/..", symlinkParentHost]);
  const symlinkParentHostSha256 = digest(await readFile(symlinkParentHost));
  let symlinkParentReason;
  await assert.rejects(
    () => auditAppLoadPaths(symlinkParentHarness, symlinkParentRpathApp, appBinaries(symlinkParentRpathApp, executableName)),
    error => { symlinkParentReason = error.message; return /resolves outside the \.app/.test(error.message); },
  );
  controls.push({name: "symlink-parent-rpath-target-outside-app-rejected", app: symlinkParentRpathApp,
    mutation: "@loader_path/external-search/.. where external-search points to a private child directory",
    symlink: symlinkParent, externalTarget: symlinkParentTarget, hostSha256: symlinkParentHostSha256,
    logDirectory: symlinkParentHarness.directory, rejectedBy: "auditAppLoadPaths", reason: symlinkParentReason});

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

  assert.equal(controls.length, 7, "native export control inventory is incomplete");
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
