import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SABOTAGES} from "../tests/os-contracts-sabotages.mjs";
import {bundleNativeProbe} from "./native-probe-bundle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const digest = content => createHash("sha256").update(content).digest("hex");

// This slice has no native producer: the host is the one main already builds, and
// everything the slice changes is SDK JavaScript. The control that replaces the
// "previous host" of native slices is therefore the previous SDK: the same
// fixture bundled with the src/ that origin/main had before this slice.
export const precedingCommit = "6d02746bfe95ba48041ba1accbb6096ae4e8bb82";
const precedingFacadeSha256 = "2ffd51304b181de3946a09c29a58450398b11c134b9c48f46afce7fc45f71218";
// Where the previous SDK is extracted, and the facade a bundle of it must contain.
const previousSdkDirectory = "build/os-contracts-previous-sdk/src";
export const previousSdkFacade = previousSdkDirectory + "/react-native-platform.jsx";

// The original RN modules every lane bundles: the ones the facade returns, the
// ones they import, and the registry that answers null for their host modules.
export const bundledOriginals = ["Libraries/Components/ToastAndroid/ToastAndroidFallback.js",
  "Libraries/Components/ToastAndroid/ToastAndroid.js", "Libraries/PermissionsAndroid/PermissionsAndroid.js",
  "Libraries/PermissionsAndroid/NativePermissionsAndroid.js", "src/private/specs_DEPRECATED/modules/NativePermissionsAndroid.js",
  "Libraries/NativeModules/specs/NativeDialogManagerAndroid.js", "Libraries/StyleSheet/PlatformColorValueTypesIOS.js",
  "Libraries/ActionSheetIOS/ActionSheetIOS.js", "Libraries/ActionSheetIOS/NativeActionSheetManager.js",
  "src/private/specs_DEPRECATED/modules/NativeActionSheetManager.js", "Libraries/Components/ProgressBarAndroid/ProgressBarAndroid.js",
  "Libraries/Components/UnimplementedViews/UnimplementedView.js", "Libraries/Components/DrawerAndroid/DrawerLayoutAndroidFallback.js",
  "Libraries/Components/TextInput/InputAccessoryView.js", "Libraries/PushNotificationIOS/PushNotificationIOS.js",
  "src/private/specs_DEPRECATED/modules/NativePushNotificationManagerIOS.js",
  "Libraries/Components/Touchable/TouchableNativeFeedback.js", "Libraries/Pressability/Pressability.js",
  "Libraries/Utilities/warnOnce.js", "Libraries/TurboModule/TurboModuleRegistry.js"];
// RN files the oracle reads (and the platform implementations whose absence on
// Godot it reproduces), pinned for citation.
const referencedOriginals = ["index.js", "Libraries/Components/DrawerAndroid/DrawerLayoutAndroid.js",
  "Libraries/Components/DrawerAndroid/DrawerLayoutAndroid.android.js", "Libraries/Components/DrawerAndroid/DrawerLayoutAndroid.ios.js",
  "Libraries/Components/DrawerAndroid/DrawerLayoutAndroidTypes.js", "Libraries/Components/ToastAndroid/ToastAndroid.android.js",
  "Libraries/Components/ToastAndroid/ToastAndroid.ios.js", "src/private/specs_DEPRECATED/modules/NativeToastAndroid.js",
  "Libraries/Components/ProgressBarAndroid/ProgressBarAndroid.android.js", "Libraries/Components/StatusBar/StatusBar.js",
  "src/private/specs_DEPRECATED/modules/NativeStatusBarManagerIOS.js", "src/private/specs_DEPRECATED/modules/NativeStatusBarManagerAndroid.js",
  "Libraries/StyleSheet/PlatformColorValueTypesIOS.ios.js", "Libraries/StyleSheet/PlatformColorValueTypes.js"];
const sources = ["tests/os-contracts-fixture.jsx", "tests/os-contracts-probe.gd", "tests/os-contracts-native.test.mjs",
  "tests/os-contracts-oracle.mjs", "scripts/os-contracts-bundle.mjs", "scripts/os-contracts-sabotage.mjs",
  "tests/os-contracts-sabotages.mjs", "scripts/native-probe-bundle.mjs", "src/os-specific.js", "src/react-native-platform.jsx", "src/platform.js",
  "sdk/toolchain/platform-plugin.mjs"];
const seams = ["src/os-specific.js", "src/react-native-platform.jsx", "src/platform.js"];

// The src/ of origin/main before this slice, extracted from git so that the
// control is the SDK that was actually published, never a hand-written stub.
async function extractPreviousSdk() {
  const target = path.join(root, "build/os-contracts-previous-sdk");
  await rm(target, {recursive: true, force: true});
  const listed = spawnSync("git", ["ls-tree", "-r", "--name-only", precedingCommit, "src"], {cwd: root, encoding: "utf8"});
  assert.equal(listed.status, 0, "The previous SDK control needs commit " + precedingCommit + " locally");
  for (const file of listed.stdout.trim().split("\n")) {
    const shown = spawnSync("git", ["show", `${precedingCommit}:${file}`], {cwd: root, maxBuffer: 16 * 1024 * 1024});
    assert.equal(shown.status, 0, file);
    await mkdir(path.dirname(path.join(target, file)), {recursive: true});
    await writeFile(path.join(target, file), shown.stdout);
  }
  assert.equal(digest(await readFile(path.join(target, "src/react-native-platform.jsx"))), precedingFacadeSha256);
  return path.join(target, "src");
}

// Sabotages are overrides in memory: the plugin hands esbuild a changed text for
// one SDK file and no source file is edited. Each replaces exactly one place. They are
// written once, in tests/os-contracts-sabotages.mjs, where they are described.
export const sabotageNames = SABOTAGES.map(entry => entry.name);

function sabotagePlugin(name) {
  const variant = SABOTAGES.find(entry => entry.name === name);
  assert.ok(variant, "Unknown sabotage: " + name);
  const target = path.join(root, variant.file);
  return {name: "os-contracts-sabotage-" + name, setup(builder) {
    builder.onLoad({filter: /\.js$/}, async args => {
      if (args.path !== target) {
        return undefined;
      }
      let text = await readFile(target, "utf8");
      for (const {find, replace} of variant.edits) {
        assert.equal(text.split(find).length, 2, `The ${name} sabotage must replace exactly one place in ${variant.file}: ${find}`);
        text = text.replace(find, () => replace);
      }
      return {contents: text, loader: "js", resolveDir: path.dirname(target)};
    });
  }};
}

// The bundle for a lane: "current", "previous-sdk" or "sabotage-<name>". Every lane
// is bundleNativeProbe over the same fixture; a control only changes where the
// facade comes from (platformRoot) or adds an in-memory override (plugins).
export async function bundleLane(lane) {
  const probe = {entryPoint: "tests/os-contracts-fixture.jsx", bundled: bundledOriginals, references: referencedOriginals};
  if (lane === "current") {
    return bundleNativeProbe({...probe, name: "os-contracts", sources, seams});
  }
  if (lane === "previous-sdk") {
    const platformRoot = await extractPreviousSdk();
    assert.equal(path.relative(root, platformRoot), previousSdkDirectory);
    // The previous SDK has no os-specific module: its facade and platform stand for the seams.
    return bundleNativeProbe({...probe, name: `os-contracts-${lane}`, platformRoot,
      sources: [...sources, previousSdkFacade, previousSdkDirectory + "/platform.js"],
      seams: [previousSdkFacade, previousSdkDirectory + "/platform.js"]});
  }
  const name = lane.replace(/^sabotage-/, "");
  assert.ok(lane.startsWith("sabotage-") && sabotageNames.includes(name), "Unknown lane: " + lane);
  return bundleNativeProbe({...probe, name: `os-contracts-${lane}`, sources, seams, plugins: [sabotagePlugin(name)]});
}
