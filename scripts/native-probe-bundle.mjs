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

// One immutable bundle for a platform-module probe, written to
// build/<name>-probe.js with its receipt; build/app.js is never written here.
// seams are the public SDK files and bundled the original RN modules the
// bundle must contain; references are RN platform sources pinned for citation.
export async function bundleNativeProbe({name, entryPoint, sources, seams, bundled, references}) {
  const output = path.join(root, "build");
  await mkdir(output, {recursive: true});
  const bundlePath = path.join(output, name + "-probe.js");
  const result = await build({absWorkingDir: root, entryPoints: [entryPoint],
    outfile: bundlePath, bundle: true, platform: "neutral", format: "iife", metafile: true,
    define: {"process.env.NODE_ENV": '"production"', __DEV__: "false"},
    mainFields: ["main"], resolveExtensions: godotExtensions,
    plugins: [platformPlugin(path.join(root, "src"), id => requireSdk.resolve(id))]});
  const inputs = Object.keys(result.metafile.inputs);
  for (const file of bundled) {
    assert.ok(inputs.includes("node_modules/react-native/" + file), "Probe must bundle the original RN module: " + file);
  }
  for (const file of seams) {
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
  const receipt = {format: "godot-fabric.native-probe-bundle/v1", name,
    bundle: {path: "build/" + name + "-probe.js", sha256: digest(await readFile(bundlePath)), inputs},
    sources: await pin(root, sources), originalReactNativeSources: await pin(rnRoot, [...bundled, ...references])};
  await writeFile(path.join(output, name + "-probe-bundle.json"), JSON.stringify(receipt, null, 2) + "\n");
  return receipt;
}
