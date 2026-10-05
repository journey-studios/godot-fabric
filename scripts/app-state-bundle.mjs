import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {transformAsync} from "@babel/core";
import {build} from "esbuild";
import {platformPlugin} from "../sdk/toolchain/platform-plugin.mjs";
import {godotExtensions} from "../sdk/toolchain/platform-resolution.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const requireSdk = createRequire(import.meta.url);
const digest = content => createHash("sha256").update(content).digest("hex");

// Executed producers of the AppState slice: the reproducer, the public SDK seam
// and the native module fed by Godot's lifecycle notifications.
export const appStateNativeProducers = ["native/app_lifecycle.h", "native/fabric_application.cpp",
  "native/fabric_application.h", "native/turbo_module_registry.cpp", "native/turbo_module_registry.h",
  "native/application_runtime.cpp", "native/application_runtime.h"];
const sources = ["tests/app-state-fixture.jsx", "tests/app-state-probe.gd", "tests/app-state-native.test.mjs",
  "tests/app-state-oracle.mjs", "scripts/app-state-bundle.mjs", "src/app-state.js", "src/platform-environment.js", "src/react-native-platform.jsx",
  "sdk/toolchain/platform-plugin.mjs", ...appStateNativeProducers];
// The original modules this bundle runs, and the RN platform implementations
// whose AppState semantics the native module follows.
const bundled = ["Libraries/AppState/AppState.js", "Libraries/AppState/NativeAppState.js",
  "src/private/specs_DEPRECATED/modules/NativeAppState.js", "Libraries/EventEmitter/NativeEventEmitter.js",
  "Libraries/EventEmitter/RCTDeviceEventEmitter.js", "Libraries/vendor/emitter/EventEmitter.js",
  "Libraries/TurboModule/TurboModuleRegistry.js"];
const references = ["index.js", "React/CoreModules/RCTAppState.mm", "React/Modules/RCTEventEmitter.m",
  "ReactAndroid/src/main/java/com/facebook/react/modules/appstate/AppStateModule.kt",
  "React/FBReactNativeSpec/FBReactNativeSpecJSI.h", "ReactCommon/react/nativemodule/core/ReactCommon/TurboModule.cpp",
  "ReactCommon/react/bridging/Function.h"];

// One immutable bundle for the probe; build/app.js is never written here.
export async function bundleAppStateProbe() {
  const output = path.join(root, "build");
  await mkdir(output, {recursive: true});
  const bundlePath = path.join(output, "app-state-probe.js");
  const result = await build({absWorkingDir: root, entryPoints: ["tests/app-state-fixture.jsx"],
    outfile: bundlePath, bundle: true, platform: "neutral", format: "iife", metafile: true,
    define: {"process.env.NODE_ENV": '"production"', __DEV__: "false"},
    mainFields: ["main"], resolveExtensions: godotExtensions,
    plugins: [platformPlugin(path.join(root, "src"), id => requireSdk.resolve(id))]});
  const inputs = Object.keys(result.metafile.inputs);
  for (const file of bundled) {
    assert.ok(inputs.includes("node_modules/react-native/" + file), "Probe must bundle the original RN module: " + file);
  }
  for (const file of ["src/app-state.js", "src/platform-environment.js", "src/react-native-platform.jsx"]) {
    assert.ok(inputs.includes(file), "Probe must bundle the public SDK seam: " + file);
  }
  const transformed = await transformAsync(await readFile(bundlePath, "utf8"), {
    filename: bundlePath, configFile: false, babelrc: false,
    presets: [["@react-native/babel-preset", {disableImportExportTransform: true, enableBabelRuntime: false}]],
  });
  await writeFile(bundlePath, transformed.code + "\n");
  const rnRoot = path.dirname(requireSdk.resolve("react-native/package.json"));
  const pin = async (base, files) => Object.fromEntries(await Promise.all(
    files.map(async file => [file, digest(await readFile(path.join(base, file)))])));
  const receipt = {format: "godot-fabric.app-state-probe-bundle/v1",
    bundle: {path: "build/app-state-probe.js", sha256: digest(await readFile(bundlePath)), inputs},
    sources: await pin(root, sources), originalReactNativeSources: await pin(rnRoot, [...bundled, ...references])};
  await writeFile(path.join(output, "app-state-probe-bundle.json"), JSON.stringify(receipt, null, 2) + "\n");
  return receipt;
}
