import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdir, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {bundleNativeProbe} from "./native-probe-bundle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

// The executed producers of this slice that differ between the host of main and this host: the paragraph the host
// shapes, paints and reports. The previous host is a build of main's sources, so a control on it differs here only.
export const textStyleNativeProducers = ["native/paragraph_layout.h", "native/paragraph_layout.cpp", "native/paragraph_view.cpp"];
// The public SDK files the slice changed: the controls run the same fixture on the SDK before them.
export const textStyleSdkProducers = ["src/react-native-platform.jsx", "src/base-view-config.js"];

// The SDK of main before the slice, taken from its commit, and where the control extracts it. The facade a bundle
// of it must contain is pinned in the bundle's receipt under this path.
export const precedingCommit = "0f2cc7e7b87af4826c76bf7490637c282cab77cd";
const previousSdkDirectory = "build/text-style-previous-sdk/src";
export const previousSdkFacade = previousSdkDirectory + "/react-native-platform.jsx";

// The original RN modules the probe must run: the Text that owns the props and the style processing, the native
// components it registers, the ancestor context the View shares, and the renderer that mounts them.
export const textStyleBundled = ["Libraries/Text/Text.js", "Libraries/Text/TextNativeComponent.js",
  "Libraries/Text/TextAncestorContext.js", "Libraries/Components/View/View.js",
  "Libraries/Renderer/implementations/ReactFabric-prod.js", "Libraries/Renderer/shims/ReactNativeViewConfigRegistry.js"];
const harness = ["tests/text-style-fixture.jsx", "tests/text-style-probe.gd", "tests/text-style-native.test.mjs",
  "tests/text-style-oracle.mjs", "scripts/text-style-bundle.mjs", "scripts/native-probe-bundle.mjs",
  "sdk/toolchain/platform-plugin.mjs"];

// What RN's code and the platforms do with the styles this slice accepts and rejects: the style types, the
// attributes the host receives and how the native parser reads them, and how a child's attributes replace its parent's.
const references = ["Libraries/StyleSheet/StyleSheetTypes.js", "Libraries/Components/View/ReactNativeStyleAttributes.js",
  "ReactCommon/react/renderer/components/text/BaseTextProps.cpp", "ReactCommon/react/renderer/attributedstring/TextAttributes.cpp",
  "ReactCommon/react/renderer/attributedstring/conversions.h", "ReactCommon/react/renderer/attributedstring/primitives.h"];
const probe = {entryPoint: "tests/text-style-fixture.jsx", references};

export function bundleTextStyleProbe() {
  return bundleNativeProbe({...probe, name: "text-style",
    sources: [...harness, ...textStyleSdkProducers, ...textStyleNativeProducers, "native/application_runtime.cpp", "native/CMakeLists.txt"],
    seams: textStyleSdkProducers, bundled: textStyleBundled});
}

// The src/ of origin/main before the slice, extracted from git so that the control is the SDK that was actually
// published, never a hand-written stub.
async function extractPreviousSdk() {
  const target = path.join(root, "build/text-style-previous-sdk");
  await rm(target, {recursive: true, force: true});
  const listed = spawnSync("git", ["ls-tree", "-r", "--name-only", precedingCommit, "src"], {cwd: root, encoding: "utf8"});
  assert.equal(listed.status, 0, "The previous SDK control needs commit " + precedingCommit + " locally");
  for (const file of listed.stdout.trim().split("\n")) {
    const shown = spawnSync("git", ["show", `${precedingCommit}:${file}`], {cwd: root, maxBuffer: 64 * 1024 * 1024});
    assert.equal(shown.status, 0, file);
    await mkdir(path.dirname(path.join(target, file)), {recursive: true});
    await writeFile(path.join(target, file), shown.stdout);
  }
  return path.join(target, "src");
}

// The same fixture over the previous SDK: bundleNativeProbe with the platform root of the extracted src/. Its facade
// rejects fontStyle and textDecoration*, so the cases that use them fail at render and are reported by name.
export async function bundleTextStylePrevious() {
  const platformRoot = await extractPreviousSdk();
  assert.equal(path.relative(root, platformRoot), previousSdkDirectory);
  const sdk = ["react-native-platform.jsx", "base-view-config.js"].map(file => previousSdkDirectory + "/" + file);
  return bundleNativeProbe({...probe, name: "text-style-previous", platformRoot,
    sources: [...harness, ...sdk], seams: sdk, bundled: textStyleBundled});
}
