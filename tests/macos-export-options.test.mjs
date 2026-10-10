import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {auditAppLoadPaths, exportPreparedProject, normalizeFrameworkPackaging, presetText, verifySignatures} from "../scripts/macos-export.mjs";
import {CIV_LITE_BUNDLE_IDENTIFIER} from "../scripts/macos-export-civ-lite.mjs";
import {BARE_PAYLOAD, FABRIC_PAYLOAD, HOST_LIBRARY_NAME, appEntries, assertPayloadExact, exportFilesLine, payloadBinaries, payloadOf, payloadSignables,
  payloadTraces} from "../scripts/macos-export-payload.mjs";

// V05-10 `execucao`: the two options that let scripts/macos-export.mjs export a project without the Fabric extension (arms A and B of the comparison) and only the
// scenes it selects: `exportFiles` of the preset, and `frameworks: false` of exportPreparedProject, which selects a payload (scripts/macos-export-payload.mjs: what the app is
// expected to hold of the extension, as data). This file holds what is decided without a template or an export; the export itself is
// tests/macos-export-options-native.test.mjs (npm run test:export:options).

const sha256 = text => createHash("sha256").update(text).digest("hex");
const template = "/tmp/templates/macos-arm64-template.zip";
const minimalIdentifier = "org.journeystudios.godotfabric.exportvalidation";
const sandbox = async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "godot-fabric-export-options-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return directory;
};

// The preset as it was written before the options existed, with the arguments of the minimal export and of Frontier's (neither passes a filter), typed out and hashed from
// the function at 02e7868. Without `exportFiles` the text must still be these bytes.
const minimalPreset = `[preset.0]
name="macOS Arm64"
platform="macOS"
runnable=true
dedicated_server=false
custom_features=""
export_filter="all_resources"
include_filter=""
exclude_filter=""

[preset.0.options]
application/bundle_identifier="${minimalIdentifier}"
application/short_version="1.0"
application/version="1.0"
binary_format/architecture="arm64"
custom_template/release="${template}"
codesign/codesign=0
`;

test("without exportFiles the preset is byte for byte the one written before the option existed", () => {
  assert.equal(presetText(template, minimalIdentifier), minimalPreset);
  const noFilters = {exportFilter: undefined, includeFilter: undefined, excludeFilter: undefined};
  assert.equal(sha256(presetText(template, minimalIdentifier)), "050d060578fd176ae7f0b41e7b7ad529e185e26878f05e9fd006c547dac4baf6");
  assert.equal(sha256(presetText(template, minimalIdentifier, noFilters)), "050d060578fd176ae7f0b41e7b7ad529e185e26878f05e9fd006c547dac4baf6");
  assert.equal(sha256(presetText(template, CIV_LITE_BUNDLE_IDENTIFIER, noFilters)), "73063d7038495b2e45bd74c1e90b050e00ed7c78e2351c470608e48e845ae25c");
  const filters = {exportFilter: "scenes", includeFilter: "comparison/*, override.cfg", excludeFilter: "addons/godot_fabric/*"};
  assert.equal(sha256(presetText(template, "org.example.x", filters)), "5436529ab22965e1384610785ebe8a7683aff2f43a519ba597c658b96348ce40");
  assert.equal(sha256(presetText('/tmp/we"ird\\path/t.zip', "org.example.x")), "84db6cf36abc112a0165d932bc2324796a38d1c4c40111d74849112a6f98c4b3");
  // An empty list is no list: the same bytes, with any filter.
  assert.equal(presetText(template, minimalIdentifier, {exportFiles: []}), minimalPreset);
  assert.equal(presetText(template, "org.example.x", {...filters, exportFiles: []}), presetText(template, "org.example.x", filters));
});

test("exportFiles is written right after export_filter, as the editor writes it", () => {
  const text = presetText(template, "org.example.x", {exportFilter: "scenes", exportFiles: ["res://main_bare.tscn"], excludeFilter: "addons/godot_fabric/*"});
  assert.ok(text.includes('export_filter="scenes"\nexport_files=PackedStringArray("res://main_bare.tscn")\ninclude_filter=""\n'), text);
  const several = presetText(template, "org.example.x", {exportFilter: "scenes", exportFiles: ["res://a.tscn", "res://b/c.tscn"]});
  assert.ok(several.includes('export_filter="scenes"\nexport_files=PackedStringArray("res://a.tscn", "res://b/c.tscn")\ninclude_filter=""\n'), several);
  // Nothing else of the preset moves: taking the line out gives the preset without the option.
  assert.equal(several.replace(/export_files=.*\n/, ""), presetText(template, "org.example.x", {exportFilter: "scenes"}));
  assert.ok(!presetText(template, "org.example.x", {exportFilter: "scenes"}).includes("export_files"));
});

test("an invalid exportFiles is an error, not a line in the preset", () => {
  const withFiles = (exportFiles, options = {exportFilter: "scenes"}) => () => presetText(template, "org.example.x", {...options, exportFiles});
  for (const bad of ["main.tscn", "/main.tscn", "user://main.tscn", "res:/main.tscn", "RES://main.tscn", "res://", "", 'res://a".tscn', "res://a\nb.tscn", "res://a\rb.tscn",
    "res://../x.tscn", "res://a/../b.tscn", "res://a..b.tscn", "res://a\\b.tscn", null, undefined, 3, {path: "res://a.tscn"}]) {
    assert.throws(withFiles([bad]), /exportFiles must hold res:\/\/ paths/, `${JSON.stringify(bad)} must be refused`);
    assert.throws(withFiles(["res://ok.tscn", bad]), /exportFiles must hold res:\/\/ paths/, `${JSON.stringify(bad)} must be refused among valid paths`);
  }
  assert.throws(withFiles("res://a.tscn"), /exportFiles must be a list/);
  assert.throws(withFiles(null), /exportFiles must be a list/);
  // The list means something only to the "scenes" filter; the default filter is not that one.
  for (const options of [{}, {exportFilter: undefined}, {exportFilter: "all_resources"}, {exportFilter: "selected_resources"}, {exportFilter: "exclude_selected_resources"}, {exportFilter: "customized"}, {exportFilter: ""}]) {
    assert.throws(withFiles(["res://main.tscn"], options), /exportFiles selects scenes for the "scenes" export filter/, JSON.stringify(options));
  }
  assert.equal(exportFilesLine([], "all_resources"), "");
  assert.equal(exportFilesLine(["res://main.tscn"], "scenes"), 'export_files=PackedStringArray("res://main.tscn")\n');
});

// A fake application bundle with the given files; a name ending in `/` is a folder.
async function fakeApp(directory, files) {
  const app = path.join(directory, "Arm.app");
  for (const file of files) {
    const target = path.join(app, file);
    if (file.endsWith("/")) {
      await mkdir(target, {recursive: true});
    } else {
      await mkdir(path.dirname(target), {recursive: true});
      await writeFile(target, "x");
    }
  }
  return app;
}

const engineFiles = ["Contents/Info.plist", "Contents/MacOS/Frontier", "Contents/Resources/Frontier.pck", "Contents/Resources/icon.icns"];
const fabricFiles = [...engineFiles, `Contents/Frameworks/${HOST_LIBRARY_NAME}`, "Contents/Frameworks/frameworks/hermesvm.framework/hermesvm",
  "Contents/Frameworks/frameworks/ReactNativeDependencies.framework/ReactNativeDependencies"];
const packOf = paths => ({format: 4, fileCount: paths.length, fabricAddonExcluded: !paths.some(name => name.startsWith("addons/godot_fabric/")), paths, pckSHA256: "0".repeat(64)});
const barePack = packOf(["game/canon.gd", "main_bare.tscn.remap", "world/map.gd"]);
const fabricPack = packOf([".godot_fabric/app.js", "addons/godot_fabric/native/macos/fabric_godot.gdextension", "main.tscn.remap"]);

test("the public frameworks option selects one of two payloads, and the payloads are data", () => {
  assert.equal(payloadOf(true), FABRIC_PAYLOAD);
  assert.equal(payloadOf(false), BARE_PAYLOAD);
  for (const bad of [undefined, null, "false", 0, 1]) {
    assert.throws(() => payloadOf(bad), /frameworks must be true or false/, JSON.stringify(bad));
  }
  assert.deepEqual([FABRIC_PAYLOAD.hosts, FABRIC_PAYLOAD.frameworks, FABRIC_PAYLOAD.bundle],
    [[HOST_LIBRARY_NAME], ["hermesvm.framework", "ReactNativeDependencies.framework"], ".godot_fabric/app.js"]);
  assert.equal(FABRIC_PAYLOAD.resourceBundles.length, 4);
  assert.deepEqual([BARE_PAYLOAD.hosts, BARE_PAYLOAD.frameworks, BARE_PAYLOAD.resourceBundles, BARE_PAYLOAD.bundle], [[], [], [], null]);
  assert.ok(Object.isFrozen(FABRIC_PAYLOAD) && Object.isFrozen(BARE_PAYLOAD) && Object.isFrozen(FABRIC_PAYLOAD.frameworks) && Object.isFrozen(BARE_PAYLOAD.hosts));
});

test("a payload says where its binaries and its signatures are, and a payload without the extension has none", () => {
  const app = "/x/Arm.app";
  const frameworks = "/x/Arm.app/Contents/Frameworks/frameworks";
  const binaries = payloadBinaries(FABRIC_PAYLOAD, app, "/sdk");
  assert.deepEqual(binaries.hosts, [{label: "host", name: HOST_LIBRARY_NAME, binary: `/x/Arm.app/Contents/Frameworks/${HOST_LIBRARY_NAME}`, source: `/sdk/native/${HOST_LIBRARY_NAME}`}]);
  assert.deepEqual(binaries.frameworks.map(item => [item.label, item.name, item.bundle, item.binary, item.source]), [
    ["hermesvm-framework", "hermesvm.framework", `${frameworks}/hermesvm.framework`, `${frameworks}/hermesvm.framework/hermesvm`, "/sdk/native/frameworks/hermesvm.framework/hermesvm"],
    ["ReactNativeDependencies-framework", "ReactNativeDependencies.framework", `${frameworks}/ReactNativeDependencies.framework`,
      `${frameworks}/ReactNativeDependencies.framework/ReactNativeDependencies`, "/sdk/native/frameworks/ReactNativeDependencies.framework/ReactNativeDependencies"],
  ]);
  const signables = payloadSignables(FABRIC_PAYLOAD, app);
  assert.deepEqual(signables.frameworkBundles, [`${frameworks}/hermesvm.framework`, `${frameworks}/ReactNativeDependencies.framework`]);
  assert.deepEqual(signables.resourceBundles, ["SocketRocket", "boost", "folly", "glog"].map(name => `${frameworks}/ReactNativeDependencies.framework/Versions/A/ReactNativeDependencies_${name}.bundle`));
  assert.deepEqual(signables.hosts, [`/x/Arm.app/Contents/Frameworks/${HOST_LIBRARY_NAME}`]);
  assert.deepEqual(payloadBinaries(BARE_PAYLOAD, app, "/sdk"), {hosts: [], frameworks: []});
  assert.deepEqual(payloadSignables(BARE_PAYLOAD, app), {resourceBundles: [], frameworkBundles: [], hosts: []});
});

test("the exact check accepts an application that holds its payload, with the extension and without it", async t => {
  const directory = await sandbox(t);
  const bare = await appEntries(await fakeApp(await mkdtemp(path.join(directory, "bare-")), [...engineFiles, "Contents/Frameworks/"]));
  assert.deepEqual(bare, ["Contents", "Contents/Frameworks", "Contents/Info.plist", "Contents/MacOS", "Contents/MacOS/Frontier", "Contents/Resources", "Contents/Resources/Frontier.pck",
    "Contents/Resources/icon.icns"]);
  assert.deepEqual(payloadTraces(BARE_PAYLOAD, bare, barePack), []);
  assert.deepEqual(assertPayloadExact(BARE_PAYLOAD, bare, barePack), {description: BARE_PAYLOAD.description, hosts: [], frameworks: [], bundle: null, pckAddonEntries: 0});
  // An app with no Frameworks folder at all is a bare app as well.
  assert.deepEqual(payloadTraces(BARE_PAYLOAD, bare.filter(entry => !entry.startsWith("Contents/Frameworks")), barePack), []);
  const fabric = await appEntries(await fakeApp(await mkdtemp(path.join(directory, "fabric-")), fabricFiles));
  assert.deepEqual(payloadTraces(FABRIC_PAYLOAD, fabric, fabricPack), []);
  assert.deepEqual(assertPayloadExact(FABRIC_PAYLOAD, fabric, fabricPack),
    {description: FABRIC_PAYLOAD.description, hosts: [HOST_LIBRARY_NAME], frameworks: [...FABRIC_PAYLOAD.frameworks], bundle: ".godot_fabric/app.js", pckAddonEntries: 1});
});

test("the exact check refuses a bare application that carries the frameworks, the host or the addon", async t => {
  const directory = await sandbox(t);
  const refuse = async (extra, pack, expected, label) => {
    const entries = await appEntries(await fakeApp(await mkdtemp(path.join(directory, "case-")), [...engineFiles, ...extra]));
    assert.throws(() => assertPayloadExact(BARE_PAYLOAD, entries, pack), expected, label);
  };
  const everything = /the exported \.app does not hold exactly its payload \(without the Fabric extension \(frameworks: false\)\): /;
  await refuse(["Contents/Frameworks/frameworks/hermesvm.framework/hermesvm"], barePack, /Contents\/Frameworks holds \[frameworks\], not the payload's \[\]; Contents\/Frameworks\/frameworks holds \[hermesvm\.framework\], not the payload's \[\]/, "the Hermes framework");
  await refuse(["Contents/Frameworks/frameworks/"], barePack, /Contents\/Frameworks holds \[frameworks\], not the payload's \[\]/, "an empty frameworks folder");
  await refuse([`Contents/Frameworks/${HOST_LIBRARY_NAME}`], barePack, /Contents\/Frameworks holds \[fabric_godot\.dylib\], not the payload's \[\]; Contents\/Frameworks\/fabric_godot\.dylib is a Fabric host/, "the host library");
  await refuse([`Contents/Resources/elsewhere/${HOST_LIBRARY_NAME}`], barePack, /Contents\/Resources\/elsewhere\/fabric_godot\.dylib is a Fabric host/, "the host in another place");
  const withAddon = packOf([...barePack.paths, "addons/godot_fabric/native/macos/fabric_godot.gdextension"].sort());
  await refuse([], withAddon, /the PCK holds 1 entry under addons\/godot_fabric\/ \(addons\/godot_fabric\/native\/macos\/fabric_godot\.gdextension\), which the payload does not carry/, "the addon in the PCK");
  await refuse([], {...barePack, fabricAddonExcluded: false}, /fabricAddonExcluded disagrees with its list of paths/, "the flag alone");
  // Everything wrong at once is listed at once, behind the payload's name.
  await refuse(["Contents/Frameworks/frameworks/hermesvm.framework/hermesvm", `Contents/Frameworks/${HOST_LIBRARY_NAME}`], withAddon, everything, "all of it");
  await refuse(["Contents/Frameworks/frameworks/hermesvm.framework/hermesvm", `Contents/Frameworks/${HOST_LIBRARY_NAME}`], withAddon, /is a Fabric host[^;]*; the PCK holds 1 entry/, "all of it, in order");
});

test("the exact check refuses an application with the extension that lost or gained part of it", async t => {
  const directory = await sandbox(t);
  const refuse = async (files, pack, expected, label) => {
    const entries = await appEntries(await fakeApp(await mkdtemp(path.join(directory, "case-")), files));
    assert.throws(() => assertPayloadExact(FABRIC_PAYLOAD, entries, pack), expected, label);
  };
  const without = name => fabricFiles.filter(file => !file.includes(name));
  await refuse(without(HOST_LIBRARY_NAME), fabricPack, /Contents\/Frameworks holds \[frameworks\], not the payload's \[fabric_godot\.dylib, frameworks\]/, "no host");
  await refuse(without("hermesvm.framework"), fabricPack, /Contents\/Frameworks\/frameworks holds \[ReactNativeDependencies\.framework\], not the payload's \[ReactNativeDependencies\.framework, hermesvm\.framework\]/, "a framework less");
  await refuse(without("frameworks/"), fabricPack, /Contents\/Frameworks holds \[fabric_godot\.dylib\], not the payload's \[fabric_godot\.dylib, frameworks\]/, "no frameworks folder");
  await refuse([...fabricFiles, "Contents/Frameworks/frameworks/Extra.framework/Extra"], fabricPack, /Contents\/Frameworks\/frameworks holds \[Extra\.framework, ReactNativeDependencies/, "a framework more");
  await refuse([...fabricFiles, "Contents/Frameworks/libextra.dylib"], fabricPack, /Contents\/Frameworks holds \[fabric_godot\.dylib, frameworks, libextra\.dylib\]/, "another file in Frameworks");
  await refuse([...fabricFiles, `Contents/Resources/${HOST_LIBRARY_NAME}`], fabricPack, /Contents\/Resources\/fabric_godot\.dylib is a Fabric host/, "a second host");
  await refuse(fabricFiles, barePack, /the PCK holds no entry under addons\/godot_fabric\/, which the payload carries/, "a PCK without the addon");
  await refuse(fabricFiles, {...fabricPack, fabricAddonExcluded: true}, /fabricAddonExcluded disagrees with its list of paths/, "the flag alone");
});

test("a dangling link in the place of the frameworks folder or of the host is still an entry the exact check sees", async t => {
  const directory = await sandbox(t);
  const app = await fakeApp(directory, [...engineFiles, "Contents/Frameworks/"]);
  await symlink(path.join(directory, "missing"), path.join(app, "Contents/Frameworks/frameworks"));
  await symlink(path.join(directory, "missing"), path.join(app, "Contents/Frameworks", HOST_LIBRARY_NAME));
  const traces = payloadTraces(BARE_PAYLOAD, await appEntries(app), barePack);
  assert.equal(traces.length, 2, traces.join("\n"));
  assert.match(traces[0], /Contents\/Frameworks holds \[fabric_godot\.dylib, frameworks\], not the payload's \[\]/);
  assert.match(traces[1], /is a Fabric host/);
});

test("a PCK summary that does not list its paths is refused, not read as clean", () => {
  const entries = ["Contents/MacOS/Frontier"];
  assert.throws(() => payloadTraces(BARE_PAYLOAD, entries, {format: 4, fileCount: 2, bundleEmbeddedByteForByte: true, pckSHA256: "0".repeat(64)}), /no list of paths/);
  assert.throws(() => payloadTraces(BARE_PAYLOAD, entries, null), /no list of paths/);
  assert.throws(() => payloadTraces(BARE_PAYLOAD, entries, {...barePack, fileCount: 9}), /do not match its file count/);
  assert.throws(() => payloadTraces(BARE_PAYLOAD, null, barePack), /entries are required/);
});

// A harness that only records the commands it is asked to run, and answers the executable's name to PlistBuddy.
function recordingHarness(directory, onRun = async () => "") {
  const calls = [];
  return {directory, project: path.join(directory, "project"), outside: directory, env: {}, calls,
    async run(label, command, args) {
      calls.push({label, command, args});
      return command === "/usr/libexec/PlistBuddy" ? "Frontier\n" : onRun(label, command, args);
    }};
}

test("the signature check of the default export still covers the frameworks, the resource bundles and the host, and the payload without the extension covers the executable and the app", async t => {
  const directory = await sandbox(t);
  const app = path.join(directory, "Arm.app");
  const contents = path.join(app, "Contents");
  const frameworks = path.join(contents, "Frameworks", "frameworks");
  const bundle = name => path.join(frameworks, "ReactNativeDependencies.framework", "Versions", "A", `ReactNativeDependencies_${name}.bundle`);
  const executable = path.join(contents, "MacOS", "Frontier");

  const full = recordingHarness(directory);
  const everything = await verifySignatures(full, app);
  assert.deepEqual(everything, [bundle("SocketRocket"), bundle("boost"), bundle("folly"), bundle("glog"), path.join(frameworks, "hermesvm.framework"),
    path.join(frameworks, "ReactNativeDependencies.framework"), path.join(contents, "Frameworks", HOST_LIBRARY_NAME), executable, app]);
  assert.deepEqual(full.calls.filter(call => call.command === "/usr/bin/codesign").map(call => call.args), everything.map(item => ["--verify", "--deep", "--strict", item]));
  assert.deepEqual(await verifySignatures(recordingHarness(directory), app, FABRIC_PAYLOAD), everything);

  const bare = recordingHarness(directory);
  const onlyTheApp = await verifySignatures(bare, app, BARE_PAYLOAD);
  assert.deepEqual(onlyTheApp, [executable, app]);
  assert.deepEqual(bare.calls.filter(call => call.command === "/usr/bin/codesign").map(call => call.args), [["--verify", "--deep", "--strict", executable], ["--verify", "--deep", "--strict", app]]);
});

test("the load-path audit and the framework normalization have nothing to do for a payload without frameworks", async t => {
  const directory = await sandbox(t);
  const app = await fakeApp(directory, engineFiles);
  const executable = path.join(app, "Contents/MacOS/Frontier");
  const macho = "Load command 0\n     cmd LC_LOAD_DYLIB\n    name /usr/lib/libSystem.B.dylib (offset 24)\nLoad command 1\n     cmd LC_LOAD_DYLIB\n    name /usr/lib/libc++.1.dylib (offset 24)\n";
  const harness = recordingHarness(directory, async () => macho);
  const records = await auditAppLoadPaths(harness, app, [{label: "app-executable", path: executable}], BARE_PAYLOAD);
  assert.deepEqual(records.map(record => [record.label, record.libraries]), [["app-executable", ["/usr/lib/libSystem.B.dylib", "/usr/lib/libc++.1.dylib"]]]);
  // A host handed to the audit of a payload that has none is an error of the caller, and the audit of the default payload still requires its host.
  await assert.rejects(auditAppLoadPaths(harness, app, [{label: "host", path: executable}], BARE_PAYLOAD), /exactly when the payload has one/);
  await assert.rejects(auditAppLoadPaths(harness, app, [{label: "app-executable", path: executable}]), /exactly when the payload has one/);
  // Normalizing the frameworks of a payload that has none touches nothing: the app need not even exist.
  assert.deepEqual(await normalizeFrameworkPackaging(path.join(directory, "Missing.app"), BARE_PAYLOAD), {hostSha256Before: undefined, hostSha256After: undefined, frameworks: []});
});

// exportPreparedProject, as far as it goes before Godot runs: the options are checked at the door and reach the preset.
const knownTemplateMember = {member: "macos_template.app/Contents/MacOS/godot_macos_release.arm64", bytes: 1, sha256: "1".repeat(64), archiveSha256: "2".repeat(64)};

test("exportPreparedProject refuses the options that cannot be honored before it writes or runs anything", async t => {
  const directory = await sandbox(t);
  const staging = path.join(directory, ".Arm.staging.app");
  const refused = async (options, expected, label) => {
    const harness = recordingHarness(directory);
    await assert.rejects(exportPreparedProject({harness, template, staging, templateMember: knownTemplateMember, ...options}), expected, label);
    assert.deepEqual(harness.calls, [], `${label}: nothing may run`);
    await assert.rejects(readFile(path.join(harness.project, "export_presets.cfg")), {code: "ENOENT"}, `${label}: no preset may be written`);
  };
  await refused({exportFiles: ["res://main_bare.tscn"]}, /exportFiles selects scenes for the "scenes" export filter/, "exportFiles with the default filter");
  await refused({exportFiles: ["res://main_bare.tscn"], exportFilter: "customized"}, /exportFiles selects scenes/, "exportFiles with another filter");
  await refused({exportFiles: ["res://../outside.tscn"], exportFilter: "scenes"}, /exportFiles must hold res:\/\/ paths/, "a path with ..");
  await refused({exportFiles: ["main_bare.tscn"], exportFilter: "scenes"}, /exportFiles must hold res:\/\/ paths/, "a path without res://");
  await refused({frameworks: false, bundle: path.join(directory, "app.js"), exportFilter: "scenes", exportFiles: ["res://main_bare.tscn"]}, /no bundle/,
    "a bundle for an export without frameworks");
  await refused({frameworks: "false"}, /frameworks must be true or false/, "a frameworks option that is not a boolean");
});

test("exportPreparedProject writes the preset with the files it was given", async t => {
  const directory = await sandbox(t);
  const project = path.join(directory, "project");
  await mkdir(project);
  const stop = new Error("stopped before Godot ran");
  const harness = recordingHarness(directory, async label => {
    if (label === "macos-export-release") {
      throw stop;
    }
    return "";
  });
  const files = ["res://main_bare.tscn", "res://other.tscn"];
  await assert.rejects(exportPreparedProject({harness, template, staging: path.join(directory, ".Arm.staging.app"), templateMember: knownTemplateMember,
    bundleIdentifier: "org.example.x", frameworks: false, exportFilter: "scenes", exportFiles: files, excludeFilter: "comparison/*"}), stop);
  const preset = await readFile(path.join(project, "export_presets.cfg"), "utf8");
  assert.equal(preset, presetText(template, "org.example.x", {exportFilter: "scenes", exportFiles: files, excludeFilter: "comparison/*"}));
  assert.ok(preset.includes('export_files=PackedStringArray("res://main_bare.tscn", "res://other.tscn")\n'));
  assert.deepEqual(harness.calls.map(call => call.label), ["macos-export-release"]);
});
