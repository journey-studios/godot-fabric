import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {transformAsync} from "@babel/core";
import {build} from "esbuild";
import {platformPlugin} from "../sdk/toolchain/platform-plugin.mjs";
import {metroPolyfills} from "../sdk/toolchain/metro-polyfills.mjs";
import {godotExtensions} from "../sdk/toolchain/platform-resolution.mjs";
import {createAssetPipeline, publishAssets} from "../sdk/toolchain/asset-plugin.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const requireSdk = createRequire(import.meta.url);
const digest = content => createHash("sha256").update(content).digest("hex");

// An in-memory sabotage of one file the bundle holds: the plugin hands esbuild the text of `variant.file` with the one replacement made, and no file is
// edited. A file of RN is Flow source, so it goes through the babel preset that the platform plugin gives every RN file before it is bundled. Put it before
// the platform plugin in `plugins`.
export function sabotageOverride(name, variant) {
  const target = path.join(root, variant.file);
  return {name, setup(builder) {
    builder.onLoad({filter: /\.js$/}, async args => {
      if (args.path !== target) {
        return undefined;
      }
      const text = await readFile(target, "utf8");
      assert.equal(text.split(variant.find).length, 2, `The ${variant.name} sabotage must replace exactly one place in ${variant.file}: ${variant.find}`);
      const replaced = text.replace(variant.find, () => variant.replace);
      const contents = variant.file.startsWith("node_modules/react-native/")
        ? (await transformAsync(replaced, {filename: target, configFile: false, babelrc: false,
          presets: [[requireSdk.resolve("@react-native/babel-preset"), {disableImportExportTransform: true}]]})).code
        : replaced;
      return {contents, loader: "js", resolveDir: path.dirname(target)};
    });
  }};
}

// One immutable bundle for a platform-module probe, written to
// build/<name>-probe.js with its receipt; build/app.js is never written here.
// seams are the public SDK files and bundled the original RN modules the
// bundle must contain; references are RN platform sources pinned for citation.
// A control can bundle another SDK: platformRoot is the directory of the facade
// and its siblings (default src/), and plugins are esbuild plugins that go
// before the platform plugin, such as an in-memory override of one SDK file. A
// control names its bundle and receipt through name, and its seams and sources
// are the paths of the SDK it bundles. Every bundle starts with the Metro polyfills, as a consumer's does; inject names files
// that run before even those (a probe that records what the host defines before any JS of the bundle), given as project paths, and
// polyfills the files to inject as the Metro polyfills (the list of sdk/toolchain/metro-polyfills.mjs unless a control builds another).
export async function bundleNativeProbe({name, entryPoint, sources, seams, bundled, references, platformRoot = path.join(root, "src"), plugins = [], inject = [],
  polyfills = metroPolyfills(id => requireSdk.resolve(id))}) {
  const output = path.join(root, "build");
  await mkdir(output, {recursive: true});
  const bundlePath = path.join(output, name + "-probe.js");
  const assets = createAssetPipeline({root});
  const result = await build({absWorkingDir: root, entryPoints: [entryPoint],
    outfile: bundlePath, bundle: true, platform: "neutral", format: "iife", metafile: true,
    define: {"process.env.NODE_ENV": '"production"', __DEV__: "false"},
    inject: [...inject.map(file => path.join(root, file)), ...polyfills],
    mainFields: ["main"], resolveExtensions: godotExtensions,
    plugins: [assets.plugin, ...plugins, platformPlugin(platformRoot, id => requireSdk.resolve(id))]});
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
  // The image assets the bundle requires go beside it, with the manifest that names them.
  const manifest = await publishAssets(assets, bundlePath, transformed.code + "\n");
  const rnRoot = path.dirname(requireSdk.resolve("react-native/package.json"));
  const pin = async (base, files) => Object.fromEntries(await Promise.all(
    files.map(async file => [file, digest(await readFile(path.join(base, file)))])));
  const receipt = {format: "godot-fabric.native-probe-bundle/v1", name,
    bundle: {path: "build/" + name + "-probe.js", sha256: digest(await readFile(bundlePath)), inputs},
    assets: manifest ? {path: "build/" + name + "-probe.js.assets.json", files: manifest.files} : null,
    sources: await pin(root, sources), originalReactNativeSources: await pin(rnRoot, [...bundled, ...references])};
  await writeFile(path.join(output, name + "-probe-bundle.json"), JSON.stringify(receipt, null, 2) + "\n");
  return receipt;
}
