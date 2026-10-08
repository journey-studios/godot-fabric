import {createHash} from "node:crypto";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {transformAsync} from "@babel/core";
import {build} from "esbuild";
import {platformPlugin} from "../sdk/toolchain/platform-plugin.mjs";
import {godotExtensions} from "../sdk/toolchain/platform-resolution.mjs";
import {bundleNativeProbe} from "./native-probe-bundle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const requireSdk = createRequire(import.meta.url);
const digest = content => createHash("sha256").update(content).digest("hex");

// The executed producers of this slice that differ between the host of main and this host: the guard of
// ParagraphLayout::prepare. The previous host is a build of main's sources, so a control on it differs here only.
export const textOriginalNativeProducers = ["native/paragraph_layout.h", "native/paragraph_layout.cpp", "native/paragraph_view.cpp"];
// The public SDK files the slice changed: the controls run the same fixture on the SDK before them.
export const textOriginalSdkProducers = ["src/react-native-platform.jsx", "src/text.jsx", "src/base-view-config.js"];

// The original RN modules the probe must run: the Text that owns the props and the Pressability of a pressable
// paragraph, the native components it registers, the ancestor context the View shares, the Pressability state
// machine, the renderer that dispatches the responder events, and the registry that refuses a second RCTText.
export const textOriginalBundled = ["Libraries/Text/Text.js", "Libraries/Text/TextNativeComponent.js",
  "Libraries/Text/TextAncestorContext.js", "Libraries/Pressability/Pressability.js", "Libraries/Pressability/usePressability.js",
  "Libraries/Components/View/View.js", "Libraries/Renderer/implementations/ReactFabric-prod.js",
  "Libraries/Renderer/shims/ReactNativeViewConfigRegistry.js"];
const harness = ["tests/text-original-fixture.jsx", "tests/text-original-probe.gd", "tests/text-original-native.test.mjs",
  "tests/text-original-oracle.mjs", "scripts/text-original-bundle.mjs", "scripts/native-probe-bundle.mjs",
  "sdk/toolchain/platform-plugin.mjs"];

// What RN's code and the platforms do with the props this slice accepts and rejects: the Text component and its
// prop types, the Pressability regions and timings, the paragraph props the host receives and the attributes it
// must refuse.
const references = ["Libraries/Text/TextProps.js", "Libraries/Pressability/PressabilityTypes.js",
  "ReactCommon/react/renderer/components/text/BaseParagraphProps.cpp", "ReactCommon/react/renderer/components/text/BaseTextProps.cpp",
  "ReactCommon/react/renderer/components/text/ParagraphEventEmitter.cpp", "ReactCommon/react/renderer/attributedstring/ParagraphAttributes.h",
  "ReactCommon/react/renderer/attributedstring/primitives.h"];

export function bundleTextOriginalProbe() {
  return bundleNativeProbe({name: "text-original", entryPoint: "tests/text-original-fixture.jsx",
    sources: [...harness, ...textOriginalSdkProducers, ...textOriginalNativeProducers, "native/application_runtime.cpp", "native/CMakeLists.txt"],
    seams: textOriginalSdkProducers, bundled: textOriginalBundled, references});
}

// The same fixture over another copy of the public SDK sources (the SDK of main before the slice, for the control
// lane): the platform plugin reads the facade and every src module from that root. It is the consumer build of
// scripts/native-probe-bundle.mjs with only the platform root changed.
export async function bundleTextOriginalProbeOn(platformRoot, name) {
  const outfile = path.join(root, `build/${name}-probe.js`);
  await mkdir(path.dirname(outfile), {recursive: true});
  const result = await build({absWorkingDir: root, entryPoints: ["tests/text-original-fixture.jsx"], outfile, bundle: true,
    platform: "neutral", format: "iife", metafile: true, logLevel: "silent",
    define: {"process.env.NODE_ENV": '"production"', __DEV__: "false"}, mainFields: ["main"], resolveExtensions: godotExtensions,
    plugins: [platformPlugin(platformRoot, id => requireSdk.resolve(id))]});
  // Hermes needs the RN syntax transforms on the bundler's helpers too.
  const code = (await transformAsync(await readFile(outfile, "utf8"), {filename: outfile, configFile: false, babelrc: false,
    presets: [["@react-native/babel-preset", {disableImportExportTransform: true, enableBabelRuntime: false}]]})).code + "\n";
  await writeFile(outfile, code);
  const rnRoot = path.dirname(requireSdk.resolve("react-native/package.json"));
  const pin = async (base, files) => Object.fromEntries(await Promise.all(files.map(async file => [file, digest(await readFile(path.join(base, file)))])));
  const receipt = {format: "godot-fabric.native-probe-bundle/v1", name, platformRoot: path.relative(root, platformRoot),
    bundle: {path: `build/${name}-probe.js`, sha256: digest(code), inputs: Object.keys(result.metafile.inputs)},
    assets: null, sources: await pin(root, harness),
    facadeSha256: digest(await readFile(path.join(platformRoot, "react-native-platform.jsx"))),
    originalReactNativeSources: await pin(rnRoot, [...textOriginalBundled, ...references])};
  await writeFile(path.join(root, `build/${name}-probe-bundle.json`), JSON.stringify(receipt, null, 2) + "\n");
  return receipt;
}
