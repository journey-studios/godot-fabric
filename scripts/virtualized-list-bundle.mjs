import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {cp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {transformAsync} from "@babel/core";
import {build} from "esbuild";
import {platformPlugin} from "../sdk/toolchain/platform-plugin.mjs";
import {godotExtensions} from "../sdk/toolchain/platform-resolution.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const requireSdk = createRequire(import.meta.url);
const digest = content => createHash("sha256").update(content).digest("hex");

// The SDK this slice starts from: its facade exported FlatList and
// VirtualizedList as unavailable placeholders and had no SectionList.
const precedingSdkCommit = "8f80feda8c38512f3608f479da21b7abac5c3e0a";
// Executed producers: the reproducer, the public SDK seams and the native
// ScrollView pieces that RN's scroll views own (drag coordinates, throttle).
export const virtualizedListNativeProducers = ["native/application_runtime.cpp", "native/scroll_adapter.cpp",
  "native/scroll_adapter.h", "native/pointer_adapter.cpp", "native/pointer_adapter.h",
  "native/scroll_motion.h", "native/scroll_offset.h", "native/scroll_throttle.h"];
const sdkProducers = ["src/lists.js", "src/list-props.mjs", "src/scroll-view.jsx", "src/react-native-platform.jsx",
  "src/scroll-view-contract.mjs", "src/scroll-view-native-config.js", "sdk/toolchain/platform-plugin.mjs"];
const sources = ["tests/virtualized-list-fixture.jsx", "tests/virtualized-list-probe.gd",
  "tests/virtualized-list-native.test.mjs", "tests/virtualized-list-oracle.mjs", "tests/scroll-view-contract.test.mjs",
  "scripts/virtualized-list-bundle.mjs",
  ...sdkProducers, ...virtualizedListNativeProducers];
// The original modules the current bundle runs.
const bundledReactNative = ["Libraries/Lists/FlatList.js", "Libraries/Lists/SectionList.js",
  "Libraries/Lists/VirtualizedList.js", "Libraries/Lists/VirtualizedSectionList.js",
  "Libraries/StyleSheet/StyleSheet.js", "src/private/featureflags/ReactNativeFeatureFlags.js",
  "Libraries/Components/ScrollView/ScrollViewNativeComponent.js", "Libraries/NativeComponent/NativeComponentRegistry.js",
  "Libraries/Renderer/shims/ReactNativeViewConfigRegistry.js", "Libraries/NativeComponent/ViewConfig.js"];
const bundledLists = ["index.js", "Lists/VirtualizedList.js", "Lists/VirtualizedListCellRenderer.js",
  "Lists/VirtualizedListContext.js", "Lists/VirtualizedSectionList.js", "Lists/ListMetricsAggregator.js",
  "Lists/ViewabilityHelper.js", "Lists/VirtualizeUtils.js", "Lists/CellRenderMask.js", "Lists/ChildListCollection.js",
  "Lists/FillRateHelper.js", "Lists/StateSafePureComponent.js", "Utilities/clamp.js"];
// RN's ScrollView contract that the SDK ScrollView and the host follow.
const references = ["index.js", "Libraries/Components/ScrollView/ScrollView.js",
  "Libraries/Components/ScrollView/ScrollViewNativeComponent.js", "Libraries/NativeComponent/NativeComponentRegistry.js",
  "Libraries/Renderer/shims/ReactNativeViewConfigRegistry.js", "Libraries/NativeComponent/ViewConfig.js",
  "ReactCommon/react/renderer/components/scrollview/ScrollEvent.cpp",
  "ReactCommon/react/renderer/components/scrollview/ScrollViewEventEmitter.cpp",
  "ReactCommon/react/renderer/uimanager/UIManagerBinding.cpp",
  "ReactAndroid/src/main/java/com/facebook/react/views/scroll/ReactScrollViewHelper.kt",
  "React/Fabric/Mounting/ComponentViews/ScrollView/RCTScrollViewComponentView.mm"];
// The retained sabotage: the public wrapper stops forwarding onLayout, so a
// list never learns its viewport length from RN's original ScrollView.
const sabotage = {file: "scroll-view.jsx", find: "  return <OriginalScrollView ref={ref} {...forwarded} />;",
  replace: "  delete forwarded.onLayout;\n  return <OriginalScrollView ref={ref} {...forwarded} />;"};
export const lanes = ["current", "preceding-sdk", "sabotage"];

async function platformFor(lane) {
  if (lane === "current") {
    return {platformRoot: path.join(root, "src"), plugin: platformPlugin};
  }
  const base = path.join(root, "build", "virtualized-list-" + lane);
  await rm(base, {recursive: true, force: true});
  await mkdir(base, {recursive: true});
  if (lane === "preceding-sdk") {
    // The whole SDK of the preceding commit: facade, components and toolchain.
    const archive = execFileSync("git", ["archive", "--format=tar", precedingSdkCommit, "src", "sdk/toolchain"],
      {cwd: root, maxBuffer: 64 * 1024 * 1024});
    execFileSync("tar", ["-x", "-C", base], {input: archive});
    const {platformPlugin: precedingPlugin} = await import(pathToFileURL(path.join(base, "sdk/toolchain/platform-plugin.mjs")).href);
    return {platformRoot: path.join(base, "src"), plugin: precedingPlugin};
  }
  await cp(path.join(root, "src"), path.join(base, "src"), {recursive: true});
  const file = path.join(base, "src", sabotage.file);
  const source = await readFile(file, "utf8");
  assert.equal(source.split(sabotage.find).length, 2, "The sabotage must replace exactly one ScrollView spread");
  await writeFile(file, source.replace(sabotage.find, sabotage.replace));
  return {platformRoot: path.join(base, "src"), plugin: platformPlugin};
}

// One immutable bundle per lane; build/app.js is never written here.
export async function bundleVirtualizedListProbe(lane = "current") {
  assert.ok(lanes.includes(lane), "Unknown virtualized-list lane " + lane);
  const output = path.join(root, "build");
  await mkdir(output, {recursive: true});
  const bundlePath = path.join(output, "virtualized-list-" + lane + ".js");
  const {platformRoot, plugin} = await platformFor(lane);
  const result = await build({absWorkingDir: root, entryPoints: ["tests/virtualized-list-fixture.jsx"],
    outfile: bundlePath, bundle: true, platform: "neutral", format: "iife", metafile: true, logLevel: "silent",
    define: {"process.env.NODE_ENV": '"production"', __DEV__: "false"},
    mainFields: ["main"], resolveExtensions: godotExtensions,
    plugins: [plugin(platformRoot, id => requireSdk.resolve(id))]});
  const inputs = Object.keys(result.metafile.inputs);
  const sdk = path.relative(root, platformRoot);
  const originals = [...bundledReactNative.map(file => "node_modules/react-native/" + file),
    ...bundledLists.map(file => "node_modules/@react-native/virtualized-lists/" + file)];
  if (lane === "preceding-sdk") {
    // The preceding facade never reaches a list module.
    assert.deepEqual(inputs.filter(file => file.includes("/Lists/") || file.includes("virtualized-lists")), []);
  } else {
    for (const file of originals) {
      assert.ok(inputs.includes(file), "Probe must bundle the original RN module: " + file);
    }
    for (const file of ["lists.js", "list-props.mjs", "scroll-view.jsx", "scroll-view-native-config.js", "scroll-view-contract.mjs", "react-native-platform.jsx"]) {
      assert.ok(inputs.includes(path.join(sdk, file)), "Probe must bundle the public SDK seam: " + file);
    }
  }
  const transformed = await transformAsync(await readFile(bundlePath, "utf8"), {
    filename: bundlePath, configFile: false, babelrc: false,
    presets: [["@react-native/babel-preset", {disableImportExportTransform: true, enableBabelRuntime: false}]],
  });
  await writeFile(bundlePath, transformed.code + "\n");
  const rnRoot = path.dirname(requireSdk.resolve("react-native/package.json"));
  const listsRoot = path.dirname(requireSdk.resolve("@react-native/virtualized-lists/package.json"));
  const pin = async (base, files) => Object.fromEntries(await Promise.all(
    files.map(async file => [file, digest(await readFile(path.join(base, file)))])));
  const receipt = {format: "godot-fabric.virtualized-list-probe-bundle/v1", lane,
    bundle: {path: "build/virtualized-list-" + lane + ".js", sha256: digest(await readFile(bundlePath)), inputs},
    platformRoot: sdk, sources: await pin(root, sources),
    originalReactNativeSources: await pin(rnRoot, [...bundledReactNative, ...references]),
    originalVirtualizedListSources: await pin(listsRoot, bundledLists)};
  if (lane === "preceding-sdk") {
    receipt.precedingSdk = {commit: precedingSdkCommit,
      sources: await pin(platformRoot, ["react-native-platform.jsx", "scroll-view.jsx"])};
  }
  if (lane === "sabotage") {
    receipt.sabotage = {file: path.join(sdk, sabotage.file), removed: "onLayout forwarded to RN's original ScrollView",
      sha256: digest(await readFile(path.join(platformRoot, sabotage.file)))};
  }
  await writeFile(path.join(output, "virtualized-list-" + lane + "-bundle.json"), JSON.stringify(receipt, null, 2) + "\n");
  return receipt;
}
