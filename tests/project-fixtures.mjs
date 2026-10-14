import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
import {build} from "esbuild";
import {prepareProjectResolution} from "../sdk/toolchain/project-resolution.mjs";
import {platformPlugin} from "../sdk/toolchain/platform-plugin.mjs";

// Helpers shared by the project-resolution and React identity contracts: an authored temporary
// project, an installed-package writer, the SDK's React packages, and a write:false esbuild
// bundle that runs the project plugin beside the platform plugin.
export const requireOriginal = createRequire(import.meta.url);
export const suffixes = [".godot", ".native", ""];
const json = value => JSON.stringify(value, null, 2) + "\n";
export const diagnostic = code => error => error.message.includes(code);

export function fixture(t, {dependencies = {}, compilerOptions = {}} = {}) {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "godot-project-resolution-")));
  t.after(() => fs.rmSync(project, {recursive: true, force: true}));
  const sdk = path.join(project, "addons/godot_fabric");
  const write = (name, contents) => {
    const filename = path.join(project, name);
    fs.mkdirSync(path.dirname(filename), {recursive: true});
    fs.writeFileSync(filename, typeof contents === "string" ? contents : json(contents));
    return filename;
  };
  const manifest = {name: "independent-project", private: true, dependencies};
  write("package.json", manifest);
  write("tsconfig.json", {compilerOptions: {strict: true, module: "ESNext", moduleResolution: "Bundler",
    target: "ESNext", moduleSuffixes: suffixes, ...compilerOptions}});
  write("ui/index.ts", "globalThis.result = 'entry';");
  write("addons/godot_fabric/toolchain/package.json", {private: true});
  write("addons/godot_fabric/toolchain/node_modules/react-native/package.json",
    {name: "react-native", version: requireOriginal("react-native/package.json").version, main: "index.js"});
  const sdkRequire = createRequire(path.join(sdk, "toolchain/package.json"));
  return {project, sdk, manifest, write, resolveSdk: id => sdkRequire.resolve(id)};
}
export function installed(f, name, source, {parent = "", dependencies = {}, imports} = {}) {
  const folder = path.posix.join(parent, "node_modules", name);
  f.write(folder + "/package.json", {name, version: "1.0.0", main: "index.js", dependencies,
    ...(imports ? {imports} : {})});
  f.write(folder + "/index.js", source);
  return folder;
}
export async function prepare(f) {
  return prepareProjectResolution({project: f.project, sdk: f.sdk, dependencies: f.manifest, resolveSdk: f.resolveSdk});
}
export async function bundle(f, prepared = undefined) {
  const resolution = prepared ?? await prepare(f);
  const result = await build({absWorkingDir: f.project, entryPoints: [f.entry ?? "ui/index.ts"], write: false,
    tsconfigRaw: resolution.tsconfigRaw, conditions: resolution.conditions,
    bundle: true, format: "iife", platform: "neutral",
    mainFields: ["main"], resolveExtensions: resolution.resolveExtensions, metafile: true, logLevel: "silent",
    define: {"process.env.NODE_ENV": '"production"', __DEV__: "false"},
    plugins: [resolution.plugin, platformPlugin(path.join(f.sdk, "src"), f.resolveSdk)]});
  const context = {};
  vm.runInNewContext(result.outputFiles[0].text, context);
  resolution.assertUnchanged();
  return {resolution, context, code: result.outputFiles[0].text,
    inputs: Object.keys(result.metafile.inputs).map(name => path.resolve(f.project, name))};
}
export function sdkPackages(f) {
  const reactRoot = path.dirname(requireOriginal.resolve("react/package.json"));
  const copied = path.join(f.sdk, "toolchain/node_modules/react");
  fs.mkdirSync(path.dirname(copied), {recursive: true});
  fs.cpSync(reactRoot, copied, {recursive: true});
  f.write("addons/godot_fabric/src/react-native-platform.jsx", "export const sdkMarker = 'SDK Native facade';");
  f.write("addons/godot_fabric/toolchain/node_modules/react-native/index.js", "throw new Error('Use the SDK native facade');");
  f.write("addons/godot_fabric/toolchain/node_modules/react-native/types_generated/index.d.ts", "export {};");
  f.write("addons/godot_fabric/toolchain/node_modules/@types/react/index.d.ts", "export {};");
  f.write("addons/godot_fabric/types/react-native.ts", "export interface ViewProps {testID?: string}");
  f.write("addons/godot_fabric/types/godot-fabric.ts", "export interface GodotFabric {}");
}
