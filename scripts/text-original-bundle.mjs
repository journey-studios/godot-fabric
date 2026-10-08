import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdir, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {bundleNativeProbe} from "./native-probe-bundle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

// The executed producers of this slice that differ between the host of main and this host: the guard of
// ParagraphLayout::prepare. The previous host is a build of main's sources, so a control on it differs here only.
export const textOriginalNativeProducers = ["native/paragraph_layout.h", "native/paragraph_layout.cpp", "native/paragraph_view.cpp"];
// The public SDK files the slice changed: the controls run the same fixture on the SDK before them.
export const textOriginalSdkProducers = ["src/react-native-platform.jsx", "src/text.jsx", "src/base-view-config.js"];

// The SDK of main before the slice, taken from its commit, and where the control extracts it. The facade a bundle
// of it must contain is pinned in the bundle's receipt under this path.
export const precedingCommit = "6d02746bfe95ba48041ba1accbb6096ae4e8bb82";
const previousSdkDirectory = "build/text-original-previous-sdk/src";
export const previousSdkFacade = previousSdkDirectory + "/react-native-platform.jsx";

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
const probe = {entryPoint: "tests/text-original-fixture.jsx", references};

export function bundleTextOriginalProbe() {
  return bundleNativeProbe({...probe, name: "text-original",
    sources: [...harness, ...textOriginalSdkProducers, ...textOriginalNativeProducers, "native/application_runtime.cpp", "native/CMakeLists.txt"],
    seams: textOriginalSdkProducers, bundled: textOriginalBundled});
}

// The src/ of origin/main before the slice, extracted from git so that the control is the SDK that was actually
// published, never a hand-written stub.
async function extractPreviousSdk() {
  const target = path.join(root, "build/text-original-previous-sdk");
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

// The same fixture over the previous SDK: bundleNativeProbe with the platform root of the extracted src/. Its wrapper
// never loads RN's Text.js (it registers RCTText itself), so that module is the one original the bundle lacks.
export async function bundleTextOriginalPrevious() {
  const platformRoot = await extractPreviousSdk();
  assert.equal(path.relative(root, platformRoot), previousSdkDirectory);
  const sdk = ["react-native-platform.jsx", "text.jsx", "base-view-config.js"].map(file => previousSdkDirectory + "/" + file);
  return bundleNativeProbe({...probe, name: "text-original-previous", platformRoot,
    sources: [...harness, ...sdk], seams: sdk, bundled: textOriginalBundled.filter(file => file !== "Libraries/Text/Text.js")});
}
