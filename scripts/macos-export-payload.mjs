import assert from "node:assert/strict";
import {readdir} from "node:fs/promises";
import path from "node:path";

// What an exported macOS application carries of the Fabric extension, as data, and the options of scripts/macos-export.mjs that follow from it (V05-10: arms A and B of the
// comparison have no extension, and export only the scenes they select).
//
// A PAYLOAD lists what the .app is expected to hold besides the engine and the PCK: the host library, the frameworks, the resource bundles that need their own signature and the
// JS bundle that the PCK must embed. The export, the inspection, the signing, the signature check and the framework normalization iterate those lists, so a payload with empty
// lists (BARE_PAYLOAD) goes through the same flow and does nothing where there is nothing: there is no per-feature branch in it. assertPayloadExact is the one check that the
// exported app and its PCK hold exactly the payload, in either mode. This module cannot import scripts/macos-export.mjs (that module imports this one).

// The host library the addon exports into Contents/Frameworks.
export const HOST_LIBRARY_NAME = "fabric_godot.dylib";
const FRAMEWORK_NAMES = ["hermesvm.framework", "ReactNativeDependencies.framework"];
export const FRAMEWORK_VERSIONS = {"hermesvm.framework": "1", "ReactNativeDependencies.framework": "A"};
// ReactNativeDependencies.framework carries these resource bundles; each is signed before its framework.
const RN_RESOURCE_BUNDLES = [
  "ReactNativeDependencies_SocketRocket.bundle",
  "ReactNativeDependencies_boost.bundle",
  "ReactNativeDependencies_folly.bundle",
  "ReactNativeDependencies_glog.bundle",
];
// Where the host sits in the .app, and the folder of it that the addon's export hook puts the frameworks in.
const APP_FRAMEWORKS = "Contents/Frameworks";
const FRAMEWORKS_FOLDER = "frameworks";
// Where the addon lives in a PCK (scripts/godot_pack.py names it the same way).
const ADDON_PCK_PREFIX = "addons/godot_fabric/";
// What scripts/godot_pack.py states about a PCK that holds a bundle, and what it means when it is not true.
const BUNDLE_FACTS = [
  ["bundleEmbeddedByteForByte", "PCK does not contain the selected bundle unchanged"],
  ["buildToolchainExcluded", "PCK contains build-only SDK contents"],
  ["editorScriptsExcluded", "PCK contains editor-only SDK scripts"],
];

// The export with the extension: the host, both frameworks with their resource bundles, and the bundle the project builds (relative to the project).
export const FABRIC_PAYLOAD = Object.freeze({
  description: "with the Fabric extension",
  hosts: Object.freeze([HOST_LIBRARY_NAME]),
  frameworks: Object.freeze([...FRAMEWORK_NAMES]),
  resourceBundles: Object.freeze([...RN_RESOURCE_BUNDLES]),
  bundle: ".godot_fabric/app.js",
});
// The export of a project WITHOUT the extension (`frameworks: false`): nothing of it, and no bundle.
export const BARE_PAYLOAD = Object.freeze({
  description: "without the Fabric extension (frameworks: false)",
  hosts: Object.freeze([]),
  frameworks: Object.freeze([]),
  resourceBundles: Object.freeze([]),
  bundle: null,
});

// The payload that the public `frameworks` option of exportPreparedProject selects.
export function payloadOf(frameworks) {
  assert.equal(typeof frameworks, "boolean", "frameworks must be true or false");
  return frameworks ? FABRIC_PAYLOAD : BARE_PAYLOAD;
}

export const frameworkBinaryName = name => name.slice(0, -".framework".length);

// The binaries a payload puts in an app (besides the engine), where each is in the app and in the SDK the project was provisioned with: {hosts, frameworks}, both empty for BARE_PAYLOAD.
export function payloadBinaries(payload, app, sdkPath) {
  const inApp = path.join(app, ...APP_FRAMEWORKS.split("/"));
  const fromSdk = path.join(sdkPath, "native");
  return {
    hosts: payload.hosts.map(name => ({label: "host", name, binary: path.join(inApp, name), source: path.join(fromSdk, name)})),
    frameworks: payload.frameworks.map(name => ({label: name.replaceAll(".", "-"), name, bundle: path.join(inApp, FRAMEWORKS_FOLDER, name),
      binary: path.join(inApp, FRAMEWORKS_FOLDER, name, frameworkBinaryName(name)), source: path.join(fromSdk, FRAMEWORKS_FOLDER, name, frameworkBinaryName(name))})),
  };
}

// What a payload has signed besides the engine and the app, in the order it is signed: the resource bundles, the framework bundles, the host.
export function payloadSignables(payload, app) {
  const inApp = path.join(app, ...APP_FRAMEWORKS.split("/"));
  return {
    resourceBundles: payload.resourceBundles.map(name => path.join(inApp, FRAMEWORKS_FOLDER, "ReactNativeDependencies.framework", "Versions", FRAMEWORK_VERSIONS["ReactNativeDependencies.framework"], name)),
    frameworkBundles: payload.frameworks.map(name => path.join(inApp, FRAMEWORKS_FOLDER, name)),
    hosts: payload.hosts.map(name => path.join(inApp, name)),
  };
}

// The facts that the PCK inspector states about a bundle, as [name, message] pairs: none for a payload without a bundle.
export const bundleFactsOf = payload => (payload.bundle === null ? [] : BUNDLE_FACTS);

// A path of the project as export_presets.cfg writes it inside a quoted string: no quote, backslash or line break, and no `..` to leave the project.
const RESOURCE_PATH = /^res:\/\/[^"\\\r\n]+$/;

// The `export_files` line of the export preset, in the form the editor writes it, or "" when there is nothing to select. The list only means something to the "scenes" export
// mode, so a list with any other mode is refused rather than written and silently ignored.
export function exportFilesLine(exportFiles, exportFilter) {
  assert.ok(Array.isArray(exportFiles), "exportFiles must be a list of res:// paths");
  if (exportFiles.length === 0) {
    return "";
  }
  assert.equal(exportFilter, "scenes", `exportFiles selects scenes for the "scenes" export filter, not ${JSON.stringify(exportFilter)}`);
  for (const file of exportFiles) {
    assert.ok(typeof file === "string" && RESOURCE_PATH.test(file) && !file.includes(".."),
      `exportFiles must hold res:// paths without quotes, backslashes, line breaks or "..": ${JSON.stringify(file)}`);
  }
  return `export_files=PackedStringArray(${exportFiles.map((file) => `"${file}"`).join(", ")})\n`;
}

// Every entry of an application bundle (files, folders and links, a dangling link included), as sorted paths relative to the .app with `/` separators.
export async function appEntries(app) {
  const entries = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const filename = path.join(directory, entry.name);
      entries.push(path.relative(app, filename).split(path.sep).join("/"));
      if (entry.isDirectory()) {
        await visit(filename);
      }
    }
  }
  await visit(app);
  return entries.sort();
}

// Where the exported app and its PCK differ from the payload: `Contents/Frameworks` holds exactly the payload's host and the frameworks folder (when it has frameworks), that folder
// holds exactly the payload's frameworks, no other file is named like the host, and the PCK holds entries under `addons/godot_fabric/` if and only if the payload carries the
// extension. `entries` is appEntries(app); `pack` is the result of scripts/godot_pack.py, which lists the paths of the PCK. An empty list is an app that holds its payload.
export function payloadTraces(payload, entries, pack) {
  assert.ok(Array.isArray(entries), "the application's entries are required");
  assert.ok(pack !== null && typeof pack === "object" && Array.isArray(pack.paths), "the PCK summary has no list of paths (is it from scripts/godot_pack.py?)");
  assert.equal(pack.paths.length, pack.fileCount, "the PCK summary's paths do not match its file count");
  const childrenOf = (directory) => entries.filter((entry) => path.posix.dirname(entry) === directory).map((entry) => path.posix.basename(entry)).sort();
  const traces = [];
  const folders = [
    [APP_FRAMEWORKS, [...payload.hosts, ...(payload.frameworks.length > 0 ? [FRAMEWORKS_FOLDER] : [])]],
    [`${APP_FRAMEWORKS}/${FRAMEWORKS_FOLDER}`, payload.frameworks],
  ];
  for (const [directory, expected] of folders) {
    const actual = childrenOf(directory);
    if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
      traces.push(`${directory} holds [${actual.join(", ")}], not the payload's [${[...expected].sort().join(", ")}]`);
    }
  }
  const expectedHosts = payload.hosts.map((name) => `${APP_FRAMEWORKS}/${name}`);
  for (const entry of entries.filter((item) => path.posix.basename(item) === HOST_LIBRARY_NAME && !expectedHosts.includes(item))) {
    traces.push(`${entry} is a Fabric host (${HOST_LIBRARY_NAME}) the payload does not carry there`);
  }
  const addon = pack.paths.filter((name) => name.startsWith(ADDON_PCK_PREFIX));
  const carriesExtension = payload.hosts.length > 0;
  if (carriesExtension && addon.length === 0) {
    traces.push(`the PCK holds no entry under ${ADDON_PCK_PREFIX}, which the payload carries`);
  }
  if (!carriesExtension && addon.length > 0) {
    traces.push(`the PCK holds ${addon.length} entr${addon.length === 1 ? "y" : "ies"} under ${ADDON_PCK_PREFIX} (${addon.slice(0, 3).join(", ")}${addon.length > 3 ? ", ..." : ""}), which the payload does not carry`);
  }
  if (pack.fabricAddonExcluded !== (addon.length === 0)) {
    traces.push("the PCK summary's fabricAddonExcluded disagrees with its list of paths");
  }
  return traces;
}

// The one check of the export, for either payload: refuses an application that does not hold exactly what the export was told to put in it.
export function assertPayloadExact(payload, entries, pack) {
  const traces = payloadTraces(payload, entries, pack);
  if (traces.length > 0) {
    throw new Error(`the exported .app does not hold exactly its payload (${payload.description}): ${traces.join("; ")}`);
  }
  return {description: payload.description, hosts: [...payload.hosts], frameworks: [...payload.frameworks], bundle: payload.bundle,
    pckAddonEntries: pack.paths.filter((name) => name.startsWith(ADDON_PCK_PREFIX)).length};
}
