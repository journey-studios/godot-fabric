import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {transformAsync} from "@babel/core";
import {build} from "esbuild";
import {platformPlugin} from "../sdk/toolchain/platform-plugin.mjs";
import {godotExtensions} from "../sdk/toolchain/platform-resolution.mjs";
import {renderEventTargetParentOverlay} from "../sdk/toolchain/rn-event-target-overlay.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const requireSdk = createRequire(import.meta.url);
const digest = content => createHash("sha256").update(content).digest("hex");
export const eventTargetProbeModes = ["disabled", "imperative-only", "internal-only", "enabled"];
const eventTargetProbeSources = [
  "tests/event-target-bootstrap.js", "tests/event-target-fixture.jsx",
  "tests/event-target-probe.gd", "tests/event-target-native.test.mjs", "scripts/event-target-bundle.mjs",
];
const upstreamFiles = [
  "src/private/featureflags/ReactNativeFeatureFlags.js",
  "src/private/featureflags/ReactNativeFeatureFlagsBase.js",
  "src/private/webapis/dom/events/Event.js",
  "src/private/webapis/dom/events/CustomEvent.js",
  "src/private/webapis/dom/events/EventTarget.js",
  "src/private/webapis/dom/events/internals/EventTargetInternals.js",
  "src/private/webapis/dom/nodes/ReadOnlyNode.js",
  "src/private/webapis/dom/nodes/ReactNativeElement.js",
  "src/private/webapis/dom/nodes/specs/NativeDOM.js",
  "Libraries/Renderer/implementations/ReactFabric-prod.js",
];

// Each output is a separate Hermes runtime's immutable flag configuration.
// This helper never writes build/app.js and performs no native build or run.
async function bundleProbe({entryPoint, modes, prefix, parentMode, sources}) {
  const output = path.join(root, "build");
  await mkdir(output, {recursive: true});
  const bundles = {};
  for (const mode of modes) {
    const bundlePath = path.join(output, prefix + "-" + mode + ".js");
    const bundled = await build({absWorkingDir: root, entryPoints: [entryPoint],
      outfile: bundlePath, bundle: true, platform: "neutral", format: "iife", metafile: true,
      define: {"process.env.NODE_ENV": '"production"', __DEV__: "false", __EVENT_TARGET_PROBE_MODE__: JSON.stringify(mode)},
      mainFields: ["main"], resolveExtensions: godotExtensions,
      plugins: [platformPlugin(path.join(root, "src"), id => requireSdk.resolve(id), {eventTargetParentMode: parentMode})]});
    const inputs = Object.keys(bundled.metafile.inputs);
    for (const file of ["Libraries/Renderer/implementations/ReactFabric-prod.js", "src/private/webapis/dom/events/EventTarget.js",
      "src/private/webapis/dom/nodes/ReactNativeElement.js"])
      assert.ok(inputs.includes("node_modules/react-native/" + file), "Probe must bundle the original RN module: " + file);
    const transformed = await transformAsync(await readFile(bundlePath, "utf8"), {
      filename: bundlePath, configFile: false, babelrc: false,
      presets: [["@react-native/babel-preset", {disableImportExportTransform: true, enableBabelRuntime: false}]],
    });
    await writeFile(bundlePath, transformed.code + "\n");
    bundles[mode] = {sha256: digest(await readFile(bundlePath)), inputs};
  }
  const rnRoot = path.dirname(requireSdk.resolve("react-native/package.json"));
  const parentModule = "src/private/webapis/dom/events/internals/EventTargetInternals.js";
  const parentSource = await readFile(path.join(rnRoot, parentModule), "utf8");
  const receipt = {format: "godot-fabric.event-target-probe-bundles/v1", parentMode, bundles,
    parentOverlay: {module: parentModule, originalSha256: digest(parentSource),
      generatedSourceSha256: digest(renderEventTargetParentOverlay(parentSource, parentMode))},
    sources: Object.fromEntries(await Promise.all(sources.map(async file => [file, digest(await readFile(path.join(root, file)))]))),
    originalReactNativeSources: Object.fromEntries(await Promise.all(upstreamFiles.map(async file => [file, digest(await readFile(path.join(rnRoot, file)))])))};
  await writeFile(path.join(output, prefix + "-bundles.json"), JSON.stringify(receipt, null, 2) + "\n");
  return receipt;
}

export async function bundleEventTargetProbe() {
  return bundleProbe({entryPoint: "tests/event-target-fixture.jsx", modes: eventTargetProbeModes,
    prefix: "event-target", parentMode: "original", sources: eventTargetProbeSources});
}

export async function bundleEventTargetAncestryProbe({parentMode = "current"} = {}) {
  return bundleProbe({entryPoint: "tests/event-target-ancestry-fixture.jsx", modes: ["enabled"],
    prefix: "event-target-ancestry", parentMode, sources: ["tests/event-target-bootstrap.js",
      "tests/event-target-ancestry-fixture.jsx", "tests/event-target-ancestry-probe.gd",
      "tests/event-target-ancestry-native.test.mjs", "scripts/event-target-bundle.mjs",
      "sdk/toolchain/platform-plugin.mjs", "sdk/toolchain/rn-event-target-overlay.mjs"]});
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await bundleEventTargetProbe();
  console.log("Bundled isolated original EventTarget flag probes; public build/app.js untouched.");
}
