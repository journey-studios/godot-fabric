import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {copyFile, lstat, mkdir, readFile, readlink, readdir, realpath, rename, rm, stat, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHarness} from "./consumer-harness.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtureChecksPath = fileURLToPath(new URL("./macos-export-checks.json", import.meta.url));
const expectedBundleIdentifier = "org.journeystudios.godotfabric.exportvalidation";
const frameworkNames = ["hermesvm.framework", "ReactNativeDependencies.framework"];
const fatalOutput = /SCRIPT ERROR|Parse Error|(?:^|\n)ERROR:|Program crashed|Stack overflow|ObjectDB instances leaked|Resources still in use|FABRIC_ERROR|CONSUMER_CHECK_FAILED/;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

async function existsIncludingDangling(filename) {
  try { await lstat(filename); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

async function writeJson(filename, value) {
  await writeFile(filename, JSON.stringify(value, null, 2) + "\n");
}

async function fileRecord(filename) {
  const bytes = await readFile(filename);
  const metadata = await stat(filename);
  return {path: filename, bytes: bytes.length, sha256: sha256(bytes), mode: metadata.mode & 0o777};
}

async function verifyTemplateMember(harness, template) {
  const member = "macos_template.app/Contents/MacOS/godot_macos_release.arm64";
  const inventory = await harness.run("template-inventory", "/usr/bin/unzip", ["-Z1", template], 0, harness.env, {cwd: harness.directory});
  assert.ok(inventory.split(/\r?\n/).includes(member), "the template ZIP has no exact arm64 Release member");
  const extractedDirectory = path.join(harness.directory, "template-engine");
  assert.equal(await existsIncludingDangling(extractedDirectory), false, "template inspection directory already exists");
  await mkdir(extractedDirectory);
  await harness.run("template-member-extract", "/usr/bin/unzip", ["-q", template, member, "-d", extractedDirectory], 0, harness.env, {cwd: harness.directory});
  const executable = path.join(extractedDirectory, member);
  const extractedMetadata = await lstat(executable);
  assert.ok(extractedMetadata.isFile() && !extractedMetadata.isSymbolicLink(), "template arm64 engine member is not a regular file");
  const extractedBytes = await readFile(executable);
  const architectures = (await tool(harness, "template-member-architectures", "/usr/bin/lipo", ["-archs", executable], harness.directory)).split(/\s+/).sort();
  assert.deepEqual(architectures, ["arm64"], "template engine member must contain only arm64");
  return {member, bytes: extractedBytes.length, sha256: sha256(extractedBytes), mode: extractedMetadata.mode & 0o777, architectures,
    archiveSha256: sha256(await readFile(template)),
    extractedPath: executable};
}

function assertCheckInventory(report, expectedNames, server, userDataPath) {
  assert.equal(report.displayServer, server);
  assert.deepEqual(report.checks.map(check => check.name), expectedNames, "consumer check names/order differ from the committed 40/43 baseline");
  assert.ok(report.checks.every(check => check.passed === true), "one or more canonical consumer assertions failed");
  assert.ok(report.beforeStop && report.afterStop && report.geometry, "consumer report omitted lifecycle or layout observations");
  assert.ok(userDataPath.length > 0, "exported fixture omitted its actual user data path");
}

function assertConsumerCapture(bytes, name) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(bytes.length >= 24 && bytes.subarray(0, 8).equals(signature), `${name} capture is not PNG`);
  assert.equal(bytes.toString("ascii", 12, 16), "IHDR", `${name} capture has no PNG IHDR`);
  const dimensions = {width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20)};
  assert.deepEqual(dimensions, {width: 1080, height: 600}, `${name} capture dimensions differ from the canonical consumer baseline`);
  return dimensions;
}

async function assertFrameworkSymlinksStayInside(framework) {
  const rootPath = await realpath(framework);
  async function visit(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const filename = path.join(directory, entry.name);
      const metadata = await lstat(filename);
      if (metadata.isSymbolicLink()) {
        const target = await realpath(filename);
        assert.ok(target === rootPath || target.startsWith(rootPath + path.sep), `framework symlink escapes bundle: ${filename}`);
      } else if (metadata.isDirectory()) await visit(filename);
    }
  }
  await visit(framework);
}

async function tool(harness, name, command, args, cwd = harness.project, expected = 0) {
  const log = await harness.run(name, command, args, expected, harness.env, {cwd});
  assert.doesNotMatch(log, fatalOutput);
  return log.trim();
}

async function plistValue(harness, plist, key, cwd = harness.project, label = `plist-${key.replace(/[^a-z0-9]+/gi, "-")}`) {
  return tool(harness, label, "/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plist], cwd);
}

async function architectures(harness, filename, name) {
  return (await tool(harness, `lipo-${name}`, "/usr/bin/lipo", ["-archs", filename])).split(/\s+/).sort();
}

async function machOLoadCommands(harness, filename, name) {
  const output = await tool(harness, `otool-load-commands-${name}`, "/usr/bin/otool", ["-arch", "arm64", "-l", filename]);
  const libraries = [], rpaths = [];
  let command = null;
  for (const raw of output.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("cmd ")) command = line.slice(4);
    if (command === "LC_RPATH" && line.startsWith("path "))
      rpaths.push(line.replace(/^path\s+(.+?)\s+\(offset.*$/, "$1"));
    // LC_ID_DYLIB identifies the current binary; it is not a dependency.
    if (["LC_LOAD_DYLIB", "LC_LOAD_WEAK_DYLIB", "LC_REEXPORT_DYLIB", "LC_LOAD_UPWARD_DYLIB"].includes(command) && line.startsWith("name "))
      libraries.push(line.replace(/^name\s+(.+?)\s+\(offset.*$/, "$1"));
  }
  return {libraries, rpaths};
}

export function assertLocalLoadPaths(values, binary, app, label = "binary") {
  for (const value of values) {
    if (value === "@loader_path" || value === "@executable_path") continue;
    assert.ok(value.startsWith("@rpath/") || value.startsWith("@loader_path/") || value.startsWith("@executable_path/")
      || value.startsWith("/System/Library/") || value.startsWith("/usr/lib/"), `${label} has an unexpected absolute path: ${value}`);
    if (!value.startsWith("@rpath/") && !value.startsWith("@loader_path/") && !value.startsWith("@executable_path/")) continue;
    const suffix = value.slice(value.indexOf("/") + 1);
    assert.ok(suffix.length > 0 && !path.isAbsolute(suffix), `${label} contains an unsafe load-path suffix: ${value}`);
    if (value.startsWith("@rpath/")) {
      assert.ok(!suffix.split("/").includes(".."), `${label} contains an unsafe @rpath traversal suffix: ${value}`);
      continue;
    }
    const base = value.startsWith("@loader_path/") ? path.dirname(binary) : path.join(app, "Contents/MacOS");
    const resolved = path.resolve(base, suffix);
    assert.ok(resolved === path.resolve(app) || resolved.startsWith(path.resolve(app) + path.sep), `${label} escapes the .app: ${value}`);
  }
}

export async function auditAppLoadPaths(harness, app, binaries) {
  const records = [];
  for (const {label, path: binary} of binaries) {
    const {libraries, rpaths: binaryRpaths} = await machOLoadCommands(harness, binary, label);
    assertLocalLoadPaths(libraries, binary, app, label);
    assertLocalLoadPaths(binaryRpaths, binary, app, `${label} rpath`);
    records.push({label, binary, libraries, rpaths: binaryRpaths});
  }

  const host = binaries.find(binary => binary.label === "host");
  assert.ok(host, "load audit omitted the host dylib");
  const expected = ["@rpath/hermesvm.framework/Versions/1/hermesvm",
    "@rpath/ReactNativeDependencies.framework/Versions/A/ReactNativeDependencies"].sort();
  const hostRecord = records.find(record => record.label === "host");
  const rpathLoads = hostRecord.libraries.filter(value => value.startsWith("@rpath/")).sort();
  assert.deepEqual(rpathLoads, expected, "host framework load commands differ from the packaged frameworks");
  assert.ok(hostRecord.rpaths.includes("@loader_path/frameworks"), "host has no @loader_path/frameworks search path");
  const appRoot = await realpath(app);
  for (const load of expected) {
    const suffix = load.slice("@rpath/".length);
    const candidate = path.resolve(path.dirname(host.path), "frameworks", suffix);
    const target = await realpath(candidate);
    assert.ok(target === appRoot || target.startsWith(appRoot + path.sep), `host framework dependency escapes the app: ${load}`);
    assert.ok((await stat(target)).isFile(), `host framework dependency is not a file inside the app: ${load}`);
  }
  return records;
}

async function filesNamed(directory, name, matches = []) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const filename = path.join(directory, entry.name);
    if (entry.name === name) matches.push(filename);
    if (entry.isDirectory()) await filesNamed(filename, name, matches);
  }
  return matches;
}

async function filesWithExtension(directory, extension, matches = []) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const filename = path.join(directory, entry.name);
    if (entry.isFile() && path.extname(entry.name) === extension) matches.push(filename);
    if (entry.isDirectory()) await filesWithExtension(filename, extension, matches);
  }
  return matches;
}

async function inspectApp(harness, app, sdkPath) {
  const directory = harness.directory;
  const contents = path.join(app, "Contents");
  const executableName = await plistValue(harness, path.join(contents, "Info.plist"), "CFBundleExecutable", directory, "inspect-plist-executable");
  const bundleIdentifier = await plistValue(harness, path.join(contents, "Info.plist"), "CFBundleIdentifier", directory, "inspect-plist-bundle-id");
  assert.equal(bundleIdentifier, expectedBundleIdentifier, "exported app bundle identifier does not match this isolated fixture");
  const executable = path.join(contents, "MacOS", executableName);
  const executableRecord = await fileRecord(executable);
  assert.notEqual(executableRecord.mode & 0o111, 0, "the exported executable is not executable");
  assert.deepEqual(await architectures(harness, executable, "app-executable"), ["arm64"]);

  const host = path.join(contents, "Frameworks", "fabric_godot.dylib");
  const sourceHost = path.join(sdkPath, "native", "fabric_godot.dylib");
  const hostBeforeSigning = await fileRecord(host);
  const hostSourceRecord = await fileRecord(sourceHost);
  assert.equal(hostBeforeSigning.sha256, hostSourceRecord.sha256, "exported host does not match the provisioned SDK");
  assert.deepEqual(await architectures(harness, host, "host"), ["arm64"]);
  const frameworks = [];
  for (const name of frameworkNames) {
    const framework = path.join(contents, "Frameworks", "frameworks", name);
    const binaryName = name === "hermesvm.framework" ? "hermesvm" : "ReactNativeDependencies";
    const binary = path.join(framework, binaryName);
    const original = path.join(sdkPath, "native", "frameworks", name, binaryName);
    await assertFrameworkSymlinksStayInside(framework);
    const record = await fileRecord(binary);
    const sourceRecord = await fileRecord(original);
    assert.equal(record.sha256, sourceRecord.sha256, `${name} does not match the provisioned SDK`);
    const archs = await architectures(harness, binary, name.replaceAll(".", "-"));
    assert.ok(archs.includes("arm64"), `${name} has no arm64 slice`);
    frameworks.push({name, framework, binary, source: sourceRecord, beforeSigning: record, architectures: archs});
  }
  const loadRecords = await auditAppLoadPaths(harness, app, [
    {label: "app-executable", path: executable}, {label: "host", path: host},
    ...frameworks.map(item => ({label: item.name.replaceAll(".", "-"), path: item.binary})),
  ]);
  const hostLoads = loadRecords.find(record => record.label === "host").libraries;
  const hostRpaths = loadRecords.find(record => record.label === "host").rpaths;
  const hostNames = await filesNamed(contents, "fabric_godot.dylib");
  assert.deepEqual(hostNames, [host], "exported app must contain exactly one host dylib");

  return {bundleIdentifier, executableName, executable, executableRecord,
    host: {source: hostSourceRecord, beforeSigning: hostBeforeSigning}, hostLoads, hostRpaths, loadRecords,
    frameworks: frameworks.map(item => ({name: item.name, source: item.source, beforeSigning: item.beforeSigning,
      architectures: item.architectures, bundlePath: path.relative(app, item.framework)})),
    signing: "pending ad-hoc local signing; no distribution or notarization claim"};
}

export async function verifySignatures(harness, app) {
  const contents = path.join(app, "Contents");
  const executableName = await plistValue(harness, path.join(contents, "Info.plist"), "CFBundleExecutable", harness.directory, "signature-plist-executable");
  const executable = path.join(contents, "MacOS", executableName);
  const frameworkBundles = frameworkNames.map(name => path.join(contents, "Frameworks", "frameworks", name));
  const signedItems = [...frameworkBundles, path.join(contents, "Frameworks", "fabric_godot.dylib"), executable, app];
  for (let index = 0; index < signedItems.length; index++)
    await harness.run(`verify-signature-${index}`, "/usr/bin/codesign", ["--verify", "--deep", "--strict", signedItems[index]]);
  return signedItems;
}

async function signAndVerifyApp(harness, app, inspection) {
  const contents = path.join(app, "Contents");
  const host = path.join(contents, "Frameworks", "fabric_godot.dylib");
  const executable = inspection.executable;
  const frameworkBundles = inspection.frameworks.map(item => path.join(app, item.bundlePath));
  for (let index = 0; index < frameworkBundles.length; index++)
    await harness.run(`sign-framework-${index}`, "/usr/bin/codesign", ["--force", "--sign", "-", frameworkBundles[index]]);
  await harness.run("sign-host", "/usr/bin/codesign", ["--force", "--sign", "-", host]);
  await harness.run("sign-executable", "/usr/bin/codesign", ["--force", "--sign", "-", executable]);
  await harness.run("sign-app", "/usr/bin/codesign", ["--force", "--sign", "-", app]);
  await verifySignatures(harness, app);
  inspection.host.afterSigning = await fileRecord(host);
  inspection.executableAfterSigning = await fileRecord(executable);
  for (const framework of inspection.frameworks)
    framework.afterSigning = await fileRecord(path.join(app, framework.bundlePath, framework.name === "hermesvm.framework" ? "hermesvm" : "ReactNativeDependencies"));
  inspection.signing = "ad-hoc local signing verified; no distribution or notarization claim";
  return inspection;
}

function patchValidation(text) {
  const pathCount = (text.match(/res:\/\/consumer-/g) ?? []).length;
  assert.equal(pathCount, 2, "expected exactly two canonical report/capture output path prefixes");
  let result = text.replaceAll("res://consumer-", "user://consumer-");
  const completion = '  print("CONSUMER_VALIDATION_PASSED" if success else "CONSUMER_VALIDATION_FAILED")';
  assert.equal(result.split(completion).length - 1, 1, "canonical consumer completion marker not found uniquely");
  result = result.replace(completion, '  print("MACOS_EXPORT_USER_DATA_DIR:" + OS.get_user_data_dir())\n' + completion);
  return result;
}

async function prepareProject(harness, template, projectName) {
  const sourceValidation = await readFile(path.join(harness.project, "validation.gd"), "utf8");
  const adaptedValidation = patchValidation(sourceValidation);
  await writeFile(path.join(harness.project, "validation.gd"), adaptedValidation);
  const projectPath = path.join(harness.project, "project.godot");
  const sourceProject = await readFile(projectPath, "utf8");
  assert.equal(sourceProject.split('config/name="Godot Fabric Consumer"').length - 1, 1, "minimal consumer project name changed unexpectedly");
  assert.equal(sourceProject.split("[rendering]\n").length - 1, 1, "minimal consumer rendering section changed unexpectedly");
  let adaptedProject = sourceProject.replace('config/name="Godot Fabric Consumer"', `config/name="${projectName}"`);
  adaptedProject = adaptedProject.replace("[rendering]\n", "[rendering]\ntextures/vram_compression/import_s3tc_bptc=true\ntextures/vram_compression/import_etc2_astc=true\n");
  assert.ok(adaptedProject.includes(`config/name="${projectName}"`));
  assert.ok(adaptedProject.includes("textures/vram_compression/import_s3tc_bptc=true"));
  assert.ok(adaptedProject.includes("textures/vram_compression/import_etc2_astc=true"));
  await writeFile(projectPath, adaptedProject);
  const preset = `[preset.0]\nname="macOS Arm64"\nplatform="macOS"\nrunnable=true\ndedicated_server=false\ncustom_features=""\nexport_filter="all_resources"\ninclude_filter=""\nexclude_filter=""\n\n[preset.0.options]\napplication/bundle_identifier="${expectedBundleIdentifier}"\napplication/short_version="1.0"\napplication/version="1.0"\nbinary_format/architecture="arm64"\ncustom_template/release="${template.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"\ncodesign/codesign=0\n`;
  await writeFile(path.join(harness.project, "export_presets.cfg"), preset);
  const originalCopy = path.join(harness.directory, "validation-original.gd");
  const adaptedCopy = path.join(harness.directory, "validation-adapted.gd");
  const originalProjectCopy = path.join(harness.directory, "project-original.godot");
  const adaptedProjectCopy = path.join(harness.directory, "project-adapted.godot");
  await writeFile(originalCopy, sourceValidation);
  await writeFile(adaptedCopy, adaptedValidation);
  await writeFile(originalProjectCopy, sourceProject);
  await writeFile(adaptedProjectCopy, adaptedProject);
  const patch = await harness.run("fixture-validation-diff", "/usr/bin/diff", ["-u", originalCopy, adaptedCopy], 1, harness.env, {cwd: harness.directory});
  assert.equal((patch.match(/^[-+](?![-+])/gm) ?? []).length, 5, "fixture output adaptation should contain two path swaps and one marker line");
  const projectPatch = await harness.run("fixture-project-diff", "/usr/bin/diff", ["-u", originalProjectCopy, adaptedProjectCopy], 1, harness.env, {cwd: harness.directory});
  assert.equal((projectPatch.match(/^[-+](?![-+])/gm) ?? []).length, 4, "project adaptation should only rename the app and enable two texture import settings");
  return {canonicalProjectSha256: sha256(await readFile(path.join(root, "consumers/minimal/project.godot"))),
    adaptedProjectSha256: sha256(await readFile(projectPath)), canonicalValidationSha256: sha256(Buffer.from(sourceValidation)),
    adaptedValidationSha256: sha256(Buffer.from(adaptedValidation)), validationDiff: patch,
    validationDiffSha256: sha256(Buffer.from(patch)), projectDiff: projectPatch,
    projectDiffSha256: sha256(Buffer.from(projectPatch)),
    presetSha256: sha256(Buffer.from(preset)), projectName, supportedChecks: "the unchanged 40/43 names/order are pinned in scripts/macos-export-checks.json"};
}

async function clearConsumerOutputs(userDataPath, expectedUserDataPath) {
  assert.equal(path.resolve(userDataPath), path.resolve(expectedUserDataPath), "runtime reported a user-data directory outside its unique fixture");
  try {
    const directory = await lstat(userDataPath);
    assert.ok(directory.isDirectory() && !directory.isSymbolicLink(), "fixture user-data path is not a real directory");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const name of ["consumer-report.json", "consumer-initial.png", "consumer-updated.png", "consumer-resized.png"])
    await rm(path.join(userDataPath, name), {force: true});
}

async function runExportedConsumer(harness, app, label, headed, expectedNames, projectName, priorUserDataPath = null) {
  const expectedUserDataPath = path.join(os.homedir(), "Library", "Application Support", "Godot", "app_userdata", projectName);
  if (priorUserDataPath) await clearConsumerOutputs(priorUserDataPath, expectedUserDataPath);
  else await clearConsumerOutputs(expectedUserDataPath, expectedUserDataPath);
  const executableName = await plistValue(harness, path.join(app, "Contents/Info.plist"), "CFBundleExecutable", harness.directory, `runtime-${label}-plist-executable`);
  const executable = path.join(app, "Contents/MacOS", executableName);
  const args = headed ? ["--", "--validate", "--capture"] : ["--headless", "--", "--validate"];
  const log = await harness.run(`runtime-${label}`, executable, args, 0, harness.env, {cwd: harness.outside});
  assert.doesNotMatch(log, fatalOutput);
  assert.match(log, /CONSUMER_VALIDATION_PASSED/);
  const dataMatch = log.match(/MACOS_EXPORT_USER_DATA_DIR:([^\r\n]+)/);
  assert.ok(dataMatch, "exported validation did not report the real Godot user-data directory");
  const userDataPath = dataMatch[1].trim();
  assert.equal(path.resolve(userDataPath), path.resolve(expectedUserDataPath), "runtime user-data directory does not match the isolated project name");
  const reportPath = path.join(userDataPath, "consumer-report.json");
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assertCheckInventory(report, expectedNames, headed ? "macOS" : "headless", userDataPath);
  await writeJson(path.join(harness.directory, `runtime-${label}.json`), {userDataPath, reportPath, report});
  const captures = [];
  if (headed) {
    for (const name of ["initial", "updated", "resized"]) {
      const source = path.join(userDataPath, `consumer-${name}.png`);
      const bytes = await readFile(source);
      const dimensions = assertConsumerCapture(bytes, name);
      const destination = path.join(harness.directory, `${name}.png`);
      await copyFile(source, destination);
      captures.push({...await fileRecord(destination), dimensions});
    }
  }
  return {userDataPath, reportPath, checks: report.checks.length, logSha256: sha256(Buffer.from(log)), captures,
    expectedUserDataPath};
}

async function hashApp(app) {
  const rows = [];
  async function visit(directory) {
    for (const entry of (await readdir(directory, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name))) {
      const filename = path.join(directory, entry.name);
      const relative = path.relative(app, filename).split(path.sep).join("/");
      const info = await lstat(filename);
      if (info.isSymbolicLink()) rows.push({path: relative, link: await readlink(filename)});
      else if (info.isDirectory()) await visit(filename);
      else rows.push({path: relative, sha256: sha256(await readFile(filename))});
    }
  }
  await visit(app);
  return sha256(Buffer.from(JSON.stringify(rows)));
}

export async function runMacOSExport({template, output}) {
  assert.ok(path.isAbsolute(output) && output.endsWith(".app"), "--out must resolve to a new absolute .app destination");
  if (await existsIncludingDangling(output)) throw new Error("Refusing to overwrite an existing output path");
  assert.equal(process.platform, "darwin", "macOS export validation requires macOS");
  assert.equal(process.arch, "arm64", "macOS export validation requires an arm64 host");
  assert.ok(template, "--template is required");
  if (!(await existsIncludingDangling(template))) throw new Error("--template ZIP does not exist; pass a Godot 4.7.2 template containing the exact arm64 Release member");

  const parent = path.dirname(output);
  await mkdir(parent, {recursive: true});
  if (await existsIncludingDangling(output)) throw new Error("Refusing to overwrite an output path created during preflight");
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const appBase = path.basename(output, ".app");
  const staging = path.join(parent, `.${appBase}.staging-${token}.app`);
  const relocated = path.join(parent, `.${appBase}.runtime-${token}.app`);
  if (await existsIncludingDangling(staging) || await existsIncludingDangling(relocated)) throw new Error("Refusing to reuse an existing temporary app path");
  const harness = await createHarness({template: "minimal", name: `macos-export-${appBase}-${token}`});
  const environment = harness.env;
  const receiptPath = path.join(harness.directory, "receipt.json");
  const receipt = {format: "godot-fabric.macos-arm64-export/v1", status: "running", startedAt: new Date().toISOString(),
    output, template, limitations: ["local ad-hoc signing only", "not a distribution/notarization claim", "no mobile or second-machine claim"], stages: [],
    removedDyldEnvironmentKeys: harness.removedDyldEnvironmentKeys};
  let stagingOwned = false, relocatedOwned = false, published = false, projectName = null, userDataPath = null;
  try {
    await writeJson(receiptPath, receipt);
    receipt.templateMember = await verifyTemplateMember(harness, template);
    const checksBytes = await readFile(fixtureChecksPath);
    const checks = JSON.parse(checksBytes);
    assert.equal(checks.format, "godot-fabric.macos-export-consumer-checks/v1");
    assert.equal(checks.sourceFixture, "consumers/minimal/validation.gd");
    assert.equal(checks.headless.length, 40);
    assert.equal(checks.headed.length, 43);
    assert.equal(new Set(checks.headless).size, 40);
    assert.equal(new Set(checks.headed).size, 43);
    const provisionOutput = await harness.provision();
    const sdkManifestPath = path.join(harness.sdk, "manifest.json");
    const sdkManifestBytes = await readFile(sdkManifestPath);
    const sdkManifest = JSON.parse(sdkManifestBytes);
    const hostSource = path.join(harness.sdk, "native/fabric_godot.dylib");
    assert.equal(sdkManifest.nativeSha256, sha256(await readFile(hostSource)), "provisioned host differs from its SDK manifest");
    assert.equal(sdkManifest.sourceDirty, false, "export requires a provisioned SDK from a committed, clean source tree");
    const sourceHead = await harness.run("macos-export-source-head", "git", ["rev-parse", "HEAD"], 0, environment, {cwd: root});
    assert.equal(sdkManifest.sourceCommit, sourceHead.trim(), "provisioned SDK source commit differs from this checkout");
    const frameworkSourceHashes = {};
    for (const name of frameworkNames) {
      const binary = name === "hermesvm.framework" ? "hermesvm" : "ReactNativeDependencies";
      frameworkSourceHashes[name] = sha256(await readFile(path.join(harness.sdk, "native/frameworks", name, binary)));
    }
    receipt.sdk = {manifestSha256: sha256(sdkManifestBytes), sourceCommit: sdkManifest.sourceCommit, sourceDirty: sdkManifest.sourceDirty,
      sourceFiles: sdkManifest.sourceFiles, hostSha256: sdkManifest.nativeSha256, frameworkSourceHashes,
      provisionLogSha256: sha256(Buffer.from(provisionOutput))};
    receipt.stages.push({name: "provision", passed: true});

    projectName = `Godot Fabric Export ${token}`;
    receipt.fixture = await prepareProject(harness, template, projectName);
    const editorLog = await harness.editor("macos-export-editor");
    receipt.stages.push({name: "editor-build", passed: true, logSha256: sha256(Buffer.from(editorLog))});
    receipt.fixture.checkInventorySha256 = sha256(checksBytes);
    const preflightLog = await harness.run("macos-export-preflight", harness.godot,
      ["--headless", "--path", harness.project, "--script", "res://addons/godot_fabric/export_preflight.gd"], 0, environment);
    assert.doesNotMatch(preflightLog, fatalOutput);
    assert.match(preflightLog, /GODOT_FABRIC_EXPORT_PREFLIGHT_PASSED:/);
    receipt.stages.push({name: "payload-preflight", passed: true, logSha256: sha256(Buffer.from(preflightLog))});
    const bundle = path.join(harness.project, ".godot_fabric/app.js");
    const reportPath = path.join(harness.project, ".godot_fabric/build-report.json");
    const reportBytes = await readFile(reportPath);
    const report = JSON.parse(reportBytes);
    const bundleBytes = await readFile(bundle);
    const applicationText = await readFile(path.join(harness.project, "ui/application.tres"), "utf8");
    const entryMatch = applicationText.match(/^entry_file="([^"]+)"$/m);
    assert.ok(entryMatch, "temporary application Resource omitted entry_file");
    for (const field of ["schemaVersion", "entry", "bundle", "sdkSourceCommit", "sha256", "inputs", "typeChecker", "adapterSelection", "assets", "styles"])
      assert.ok(Object.hasOwn(report, field), `build report omitted required field ${field}`);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.entry, entryMatch[1], "build report entry differs from the selected application Resource");
    assert.equal(report.bundle, "res://.godot_fabric/app.js");
    assert.equal(path.resolve(harness.project, report.bundle.slice("res://".length)), bundle, "build report bundle path differs from the selected bundle");
    assert.equal(report.sha256, sha256(bundleBytes));
    assert.equal(report.sdkSourceCommit, sdkManifest.sourceCommit, "build report was produced from a different SDK source commit");
    assert.equal(report.assets, null, "the canonical minimal export baseline is intentionally asset-free");
    assert.equal(report.adapterSelection, null, "the first macOS slice does not support external Codegen adapters");
    receipt.bundle = {path: report.bundle, sha256: sha256(bundleBytes), reportSha256: sha256(reportBytes), assets: report.assets,
      adapterSelection: report.adapterSelection, sdkSourceCommit: report.sdkSourceCommit};

    stagingOwned = true;
    const exportLog = await harness.run("macos-export-release", harness.godot,
      ["--headless", "--path", harness.project, "--export-release", "macOS Arm64", staging], 0, environment);
    assert.doesNotMatch(exportLog, fatalOutput);
    assert.ok(await existsIncludingDangling(staging), "Godot export returned success without creating the staged application");
    receipt.stages.push({name: "arm64-release-export", passed: true, logSha256: sha256(Buffer.from(exportLog))});
    const unsignedInspection = await inspectApp(harness, staging, harness.sdk);
    const resources = path.join(staging, "Contents", "Resources");
    const pckPaths = await filesWithExtension(resources, ".pck");
    assert.equal(pckPaths.length, 1, "export must contain exactly one PCK in Contents/Resources");
    const pckPath = pckPaths[0];
    const packLog = await harness.run("macos-export-pck", "/usr/bin/python3",
      [path.join(root, "scripts/godot_pack.py"), pckPath, bundle], 0, environment, {cwd: root});
    assert.doesNotMatch(packLog, fatalOutput);
    const pack = JSON.parse(packLog);
    assert.equal(pack.format, 4, "exported PCK has an unsupported format");
    assert.ok(Number.isInteger(pack.fileCount) && pack.fileCount > 0, "PCK inspection omitted its file count");
    assert.equal(pack.bundleEmbeddedByteForByte, true, "PCK does not contain the selected bundle unchanged");
    assert.equal(pack.buildToolchainExcluded, true, "PCK contains build-only SDK contents");
    assert.equal(pack.editorScriptsExcluded, true, "PCK contains editor-only SDK scripts");
    assert.equal(pack.pckSHA256, sha256(await readFile(pckPath)), "PCK hash differs from the inspector result");
    receipt.pack = {path: path.relative(staging, pckPath).split(path.sep).join("/"), ...pack,
      inspectorLogSha256: sha256(Buffer.from(packLog))};
    const appInspection = await signAndVerifyApp(harness, staging, unsignedInspection);
    const versionOutput = await tool(harness, "exported-engine-version", appInspection.executable, ["--version"], harness.outside);
    assert.match(versionOutput, /^4\.7\.2\.stable(?:\.official\.[^\s]+)?$/);
    receipt.app = {...appInspection, engineVersion: versionOutput};

    await rename(staging, relocated);
    stagingOwned = false;
    relocatedOwned = true;
    receipt.relocation = {completedBeforeRuntime: true, path: relocated};
    const headless = await runExportedConsumer(harness, relocated, "headless", false, checks.headless, projectName);
    userDataPath = headless.userDataPath;
    const headed = await runExportedConsumer(harness, relocated, "headed", true, checks.headed, projectName, userDataPath);
    receipt.runtimes = [{displayServer: "headless", checkCount: headless.checks, logSha256: headless.logSha256},
      {displayServer: "macOS", checkCount: headed.checks, logSha256: headed.logSha256}];
    receipt.captures = headed.captures;
    receipt.publishedAppSha256 = await hashApp(relocated);
    receipt.status = "validated";
    receipt.completedAt = new Date().toISOString();
    receipt.published = false;
    await writeJson(receiptPath, receipt);
    if (await existsIncludingDangling(output)) throw new Error("Output destination appeared during the run; refusing to overwrite it");
    await rename(relocated, output);
    relocatedOwned = false;
    published = true;
    receipt.status = "passed";
    receipt.published = true;
    receipt.publishedAt = new Date().toISOString();
    await writeJson(receiptPath, receipt);
    return {output, directory: harness.directory, receipt};
  } catch (error) {
    if (published) {
      const diagnostic = {status: "app-published-report-update-failed", output, receiptPath, error: error.message};
      try { await writeJson(path.join(harness.directory, "post-publish-diagnostic.json"), diagnostic); } catch {}
      throw new Error(`The app was published, but its final receipt update failed: ${error.message}`);
    }
    receipt.status = "failed";
    receipt.completedAt = new Date().toISOString();
    receipt.error = error.message;
    await writeJson(receiptPath, receipt);
    throw new Error(`${error.message}\nDiagnostic receipt: ${receiptPath}`);
  } finally {
    const cleanupErrors = [];
    for (const [owned, filename] of [[stagingOwned, staging], [relocatedOwned, relocated]]) {
      if (!owned) continue;
      try { await rm(filename, {recursive: true, force: true}); }
      catch (error) { cleanupErrors.push({path: filename, error: error.message}); }
    }
    if (projectName) {
      const ownedDataPath = path.join(os.homedir(), "Library", "Application Support", "Godot", "app_userdata", projectName);
      try { await clearConsumerOutputs(ownedDataPath, ownedDataPath); }
      catch (error) { cleanupErrors.push({path: ownedDataPath, error: error.message}); }
    }
    try { await harness.cleanup(); }
    catch (error) { cleanupErrors.push({path: harness.project, error: error.message}); }
    if (cleanupErrors.length) {
      const diagnostic = {status: published ? "published-with-cleanup-diagnostic" : "cleanup-diagnostic", cleanupErrors};
      try { await writeJson(path.join(harness.directory, "cleanup-diagnostic.json"), diagnostic); } catch {}
      if (!published) {
        receipt.cleanupErrors = cleanupErrors;
        try { await writeJson(receiptPath, receipt); } catch {}
      }
    }
  }
}

function usage() {
  return "Usage: node scripts/macos-export.mjs --template REVIEWED-GODOT-4.7.2-ARM64.zip --out NEW.app\n"
    + "The supplied ZIP is inspected for its exact arm64 Release member; its observed archive and member hashes are recorded.";
}

async function main() {
  const values = new Map();
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) { console.log(usage()); return; }
  for (let index = 0; index < argv.length; index++) {
    const option = argv[index];
    if (!["--out", "--template"].includes(option) || values.has(option) || !argv[index + 1] || argv[index + 1].startsWith("--")) {
      console.error(usage()); process.exitCode = 2; return;
    }
    values.set(option, argv[++index]);
  }
  if (!values.has("--out") || !values.has("--template")) { console.error(usage()); process.exitCode = 2; return; }
  try {
    const result = await runMacOSExport({output: path.resolve(values.get("--out")), template: path.resolve(values.get("--template"))});
    console.log("MACOS_EXPORT_PASSED: " + result.output);
    console.log("MACOS_EXPORT_RECEIPT: " + path.join(result.directory, "receipt.json"));
  } catch (error) {
    console.error("MACOS_EXPORT_FAILED: " + error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
