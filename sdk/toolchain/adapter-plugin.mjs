// SDK-owned adapter build integration. Package JavaScript/build tools never run.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { transformAsync } from "@babel/core";

export const SELECTION_FORMAT = "godot-fabric.experimental-adapter-selection/v1";
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
function fail(code, message) {
  const error = new Error(`${code}: ${message}`); error.code = code; throw error;
}
function relative(root, filename, where) {
  const value = path.relative(root, filename);
  if (!value || path.isAbsolute(value) || value === ".." || value.startsWith(".." + path.sep))
    fail("E_ADAPTER_PROJECT_PATH", `${where} must remain inside its declared root`);
  return value.split(path.sep).join("/");
}
function checkedFile(filename, expected, where) {
  if (sha256(fs.readFileSync(filename)) !== expected) fail("E_ADAPTER_BUILD_CHANGED", `${where} changed after preflight`);
}
function packageName(value) {
  return typeof value === "string" && /^(?:@[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+$/.test(value)
    && !value.split("/").some(part => part === "." || part === "..");
}

// Explicit selection only; no dependency installation or package script execution.
export function selectedAdapterInputs(project, packageJson) {
  project = fs.realpathSync(project);
  const config = packageJson.godotFabric;
  if (config === undefined) return [];
  // godotFabric.tailwind belongs to the style step (tailwind-plugin.mjs); adapters stay the only selection.
  if (!config || typeof config !== "object" || Array.isArray(config) || !Object.keys(config).length
      || Object.keys(config).some(key => !["adapters", "tailwind"].includes(key))
      || (config.adapters !== undefined && !Array.isArray(config.adapters)))
    fail("E_ADAPTER_SELECTION", "godotFabric accepts only an adapters array and a tailwind declaration");
  if (config.adapters === undefined) return [];
  const seen = new Set();
  return config.adapters.map(selection => {
    if (!selection || typeof selection !== "object" || Array.isArray(selection)
        || Object.keys(selection).some(key => !["package", "manifest"].includes(key))
        || !packageName(selection.package) || (selection.manifest !== undefined && typeof selection.manifest !== "string"))
      fail("E_ADAPTER_SELECTION", "adapter selection requires package and optional manifest");
    const name = selection.package;
    if (seen.has(name)) fail("E_ADAPTER_SELECTION", `duplicate package ${name}`);
    seen.add(name);
    if (!Object.hasOwn(packageJson.dependencies ?? {}, name))
      fail("E_ADAPTER_DEPENDENCY", `declare ${name} in the project's dependencies and install it explicitly`);
    let packageRoot;
    try {
      packageRoot = fs.realpathSync(path.join(project, "node_modules", name));
      relative(project, packageRoot, name);
      const identity = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));
      if (identity.name !== name) fail("E_ADAPTER_DEPENDENCY", `${name}: installed package identity differs`);
    } catch (error) {
      if (error.code?.startsWith("E_ADAPTER_")) throw error;
      fail("E_ADAPTER_DEPENDENCY", `missing installed package ${name}; Play never installs packages`);
    }
    return {packageRoot, manifestPath: selection.manifest ?? "adapter.json"};
  });
}

const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
function validateAdapterEvents(records, coreEventConfigs) {
  const wires = new Map();
  function claim(wire, signature, owner) {
    const value = JSON.stringify(canonical(signature));
    const previous = wires.get(wire);
    if (previous && previous.value !== value)
      fail("E_ADAPTER_EVENT_COLLISION", `${owner}: ${wire} conflicts with ${previous.owner}`);
    if (!previous) wires.set(wire, {value, owner});
  }
  for (const [wire, config] of Object.entries(coreEventConfigs.bubblingEventTypes))
    claim(wire, {kind: "bubble", ...config.phasedRegistrationNames}, "Godot core");
  for (const [wire, config] of Object.entries(coreEventConfigs.directEventTypes))
    claim(wire, {kind: "direct", registrationName: config.registrationName}, "Godot core");
  for (const record of records) {
    const schema = JSON.parse(fs.readFileSync(path.join(path.dirname(record.codegenManifestPath), record.codegenManifest.schema.path), "utf8"));
    for (const module of Object.values(schema.modules)) {
      if (module.type !== "Component") continue;
      for (const [name, component] of Object.entries(module.components)) {
        for (const event of component.events) {
          const wire = event.name.replace(/^on/, "top");
          const signature = event.bubblingType === "bubble"
            ? {kind: "bubble", captured: event.name + "Capture", bubbled: event.name}
            : {kind: "direct", registrationName: event.name};
          claim(wire, signature, `${record.manifest.id}/${name}`);
        }
      }
    }
  }
}

export function prepareAdapterBuild({project, records, nativeCombination, resolveSdk, baseViewConfigPath, coreEventConfigs}) {
  project = fs.realpathSync(project);
  validateAdapterEvents(records, coreEventConfigs);
  const selected = new Map(), files = [];
  for (const record of records) {
    relative(project, record.packageRoot, "adapter packageRoot");
    const generated = path.dirname(record.codegenManifestPath);
    if (JSON.stringify(canonical(JSON.parse(fs.readFileSync(record.manifestPath, "utf8"))))
        !== JSON.stringify(canonical(record.manifest)))
      fail("E_ADAPTER_BUILD_CHANGED", "adapter manifest changed after preflight");
    const refs = [
      [record.manifestPath, sha256(fs.readFileSync(record.manifestPath))],
      [record.libraryPath, record.manifest.library.sha256],
      [record.codegenManifestPath, record.manifest.codegenManifest.sha256],
      [path.join(generated, record.codegenManifest.schema.path), record.codegenManifest.schema.sha256],
      ...record.codegenManifest.artifacts.map(ref => [path.join(generated, ref.path), ref.sha256]),
    ];
    for (const source of record.codegenManifest.sources) {
      const filename = fs.realpathSync(path.join(record.packageRoot, source.path));
      if (selected.has(filename)) fail("E_ADAPTER_SELECTION", `spec selected twice: ${source.path}`);
      selected.set(filename, source.sha256); refs.push([filename, source.sha256]);
    }
    for (const [filename, expected] of refs) {
      const physical = fs.realpathSync(filename);
      relative(record.packageRoot, physical, "adapter file");
      relative(project, physical, "adapter file");
      files.push({filename, physical, expected});
    }
  }
  const rnRoot = path.dirname(resolveSdk("react-native/package.json"));
  function assertUnchanged() {
    for (const {filename, physical, expected} of files) {
      if (fs.realpathSync(filename) !== physical) fail("E_ADAPTER_BUILD_CHANGED", "adapter file target changed after preflight");
      checkedFile(filename, expected, filename);
    }
  }
  assertUnchanged();
  const plugin = {
    name: "godot-adapter-specs",
    setup(builder) {
      builder.onResolve({filter: /(?:^|\/)PlatformBaseViewConfig$/}, args => {
        if (args.importer === path.join(rnRoot, "Libraries/NativeComponent/ViewConfig.js")
            || args.path === "react-native/Libraries/NativeComponent/PlatformBaseViewConfig")
          return {path: baseViewConfigPath};
      });
      builder.onLoad({filter: /\.(?:js|jsx|ts|tsx)$/}, async ({path: filename}) => {
        const physical = fs.realpathSync(filename);
        if (selected.has(physical)) {
          checkedFile(physical, selected.get(physical), filename);
          const transformed = await transformAsync(fs.readFileSync(physical, "utf8"), {
            filename: physical, configFile: false, babelrc: false,
            presets: [[resolveSdk("@react-native/babel-preset"), {disableImportExportTransform: true, enableBabelRuntime: false}]],
          });
          return {contents: transformed.code, loader: "js", watchFiles: [physical]};
        }
        if (!physical.startsWith(rnRoot + path.sep)
            && /\bcodegenNativeComponent\s*(?:<|\()/.test(fs.readFileSync(physical, "utf8")))
          fail("E_ADAPTER_SPEC_UNSELECTED", `${filename}: native component spec needs a selected, verified adapter`);
      });
    },
  };
  function selectionPacket(bundlePath, bundleSha256) {
    assertUnchanged();
    if (!records.length) return null;
    if (!/^[a-f0-9]{64}$/.test(bundleSha256)) fail("E_ADAPTER_SELECTION", "bundle requires SHA-256");
    return {format: SELECTION_FORMAT,
      bundle: {path: relative(project, path.resolve(project, bundlePath), "bundle"), sha256: bundleSha256},
      nativeCombination: structuredClone(nativeCombination),
      adapters: records.map(record => ({packageRoot: relative(project, record.packageRoot, "packageRoot"),
        manifest: {path: relative(record.packageRoot, record.manifestPath, "manifest"),
          sha256: sha256(fs.readFileSync(record.manifestPath))}}))};
  }
  return {plugin, selectionPacket, assertUnchanged, specCount: selected.size};
}
