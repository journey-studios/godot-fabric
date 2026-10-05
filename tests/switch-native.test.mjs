import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {transformAsync} from "@babel/core";
import {build} from "esbuild";
import {ensureGodotBinary} from "../scripts/godot-binary.mjs";
import {platformPlugin} from "../sdk/toolchain/platform-plugin.mjs";
import {godotExtensions} from "../sdk/toolchain/platform-resolution.mjs";
import {expectedErrors, normativeOriginalFailures, verifySwitchReport} from "./switch-oracle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const requireSdk = createRequire(import.meta.url);
const allowOriginalNegative = process.argv.includes("--allow-original-negative");
const lane = allowOriginalNegative ? "original" : "current";
const digest = value => createHash("sha256").update(value).digest("hex");
const nativeProducers = ["native/switch_view.h", "native/switch_view.cpp", "native/application_runtime.cpp",
  "native/register.cpp", "native/CMakeLists.txt"];
const sources = ["tests/switch-fixture.jsx", "tests/switch-probe.gd", "tests/switch-native.test.mjs", "tests/switch-oracle.mjs",
  "src/react-native-platform.jsx", "src/base-view-config.js", "src/private-interface.js", "src/renderer-proxy.js",
  "sdk/toolchain/platform-plugin.mjs", ...nativeProducers];
// JS executed from the bundle, and the codegen that turns the original spec
// into the static RCTSwitch ViewConfig.
const originalModules = ["react-native/Libraries/Components/Switch/Switch.js",
  "react-native/Libraries/Components/Switch/SwitchNativeComponent.js",
  "react-native/src/private/components/switch/specs/SwitchNativeComponent.js",
  "react-native/Libraries/NativeComponent/NativeComponentRegistry.js", "react-native/Libraries/NativeComponent/ViewConfig.js",
  "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry.js",
  "react-native/Libraries/Renderer/implementations/ReactFabric-prod.js",
  "@react-native/babel-plugin-codegen/index.js", "@react-native/codegen/lib/generators/components/GenerateViewConfigJs.js"];
// Upstream C++ compiled into the host from the pinned package archive.
const originalNative = ["ReactCommon/react/renderer/components/switch/iosswitch/react/renderer/components/switch/AppleSwitchShadowNode.h",
  "ReactCommon/react/renderer/components/switch/iosswitch/react/renderer/components/switch/AppleSwitchComponentDescriptor.h",
  "ReactCommon/react/renderer/componentregistry/componentNameByReactViewName.cpp",
  "ReactCommon/react/renderer/componentregistry/ComponentDescriptorRegistry.cpp",
  "ReactCommon/react/renderer/uimanager/UIManagerBinding.cpp",
  ...["Props.h", "Props.cpp", "EventEmitters.h", "EventEmitters.cpp"]
    .map(file => "React/FBReactNativeSpec/react/renderer/components/FBReactNativeSpec/" + file)];

async function optionalFile(file) {
  try {
    return await readFile(path.join(root, file));
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
async function pins(base, files) {
  return Object.fromEntries(await Promise.all(files.map(async file => [file, digest(await readFile(path.join(base, file)))])));
}

// The ordinary SDK pipeline: default platform plugin, original RN modules.
// This bundle path belongs to the suite; it never writes build/app.js.
async function bundleSwitchProbe() {
  const bundlePath = path.join(root, "build/switch.js");
  await mkdir(path.dirname(bundlePath), {recursive: true});
  const bundled = await build({absWorkingDir: root, entryPoints: ["tests/switch-fixture.jsx"], outfile: bundlePath,
    bundle: true, platform: "neutral", format: "iife", metafile: true,
    define: {"process.env.NODE_ENV": '"production"', __DEV__: "false"}, mainFields: ["main"],
    resolveExtensions: godotExtensions, plugins: [platformPlugin(path.join(root, "src"), id => requireSdk.resolve(id))]});
  const inputs = Object.keys(bundled.metafile.inputs);
  for (const file of ["Libraries/Components/Switch/Switch.js", "src/private/components/switch/specs/SwitchNativeComponent.js",
    "Libraries/Renderer/implementations/ReactFabric-prod.js"]) {
    assert.ok(inputs.includes("node_modules/react-native/" + file), "The probe must bundle the original RN module: " + file);
  }
  const transformed = await transformAsync(await readFile(bundlePath, "utf8"), {filename: bundlePath, configFile: false,
    babelrc: false, presets: [["@react-native/babel-preset", {disableImportExportTransform: true, enableBabelRuntime: false}]]});
  await writeFile(bundlePath, transformed.code + "\n");
  // RN's codegen Babel plugin compiled the original spec into this ViewConfig.
  assert.match(transformed.code, /uiViewClassName:"RCTSwitch",bubblingEventTypes:\{topChange:\{phasedRegistrationNames:\{captured:"onChangeCapture",bubbled:"onChange"\}\}\}/);
  const rnRoot = path.dirname(requireSdk.resolve("react-native/package.json"));
  const modulesRoot = path.dirname(rnRoot);
  return {format: "godot-fabric.switch-probe-bundle/v1", path: "build/switch.js",
    sha256: digest(await readFile(bundlePath)), inputCount: inputs.length,
    sources: await pins(root, sources), originalReactNativeSources: await pins(modulesRoot, originalModules),
    originalNativeSources: await pins(path.join(root, ".deps/package"), originalNative)};
}

async function runProbe(binary, bundle, label, args) {
  await rm(path.join(root, "build/switch-report.json"), {force: true});
  const result = spawnSync(binary, ["--path", root, "--headless", "--script", "res://tests/switch-probe.gd", "--", ...args],
    {encoding: "utf8", timeout: 90000, maxBuffer: 8 * 1024 * 1024});
  const log = (result.stdout ?? "") + (result.stderr ?? "");
  await writeFile(path.join(root, "build/switch-" + label + ".log"), log);
  const bytes = await optionalFile("build/switch-report.json"), report = bytes == null ? null : JSON.parse(bytes);
  if (report != null) {
    report.provenance = {node: process.version, bundle,
      nativeHostSha256: digest(await readFile(path.join(root, "addons/fabric_godot.dylib"))), sourceReceiptDoesNotCertifyNativeBuild: true};
    await writeFile(path.join(root, "build/switch-" + label + "-report.json"), JSON.stringify(report, null, 2) + "\n");
  }
  return {result, log, report};
}

test("RN's original Switch runs over the native Switch descriptor with actual Godot mouse and touch input", async () => {
  const bundle = await bundleSwitchProbe();
  const {result, log, report} = await runProbe(await ensureGodotBinary(), bundle, lane,
    allowOriginalNegative ? ["--allow-original-negative"] : []);
  // Artifacts are saved before any assertion. The old-host flag accepts only
  // the normative mount failures; nothing else may fail on either host.
  assert.equal(result.error, undefined, log);
  assert.equal(result.signal, null, log);
  assert.equal(result.status, 0, log);
  assert.ok(report != null, log);
  assert.doesNotMatch(log, /SCRIPT ERROR|Program crashed|ObjectDB instances leaked|Resources still in use/);
  const failures = report.checks.filter(row => !row.passed).map(row => row.name);
  const checkErrors = [...log.matchAll(/^ERROR: FABRIC_CHECK_FAILED: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual([...checkErrors].sort(), [...failures].sort());
  const fabricErrors = [...log.matchAll(/^ERROR: FABRIC_ERROR: (.+)$/gm)].map(match => match[1]);
  if (allowOriginalNegative) {
    // The preceding host has no Switch descriptor: Fabric's legacy interop
    // resolves "Switch" and the host mount rejects it.
    assert.ok(fabricErrors.some(error => error.includes("Unsupported GodotControl kind: Switch")), log);
    assert.deepEqual([...failures].sort(), [...normativeOriginalFailures].sort());
  } else {
    assert.deepEqual(fabricErrors, expectedErrors);
    assert.deepEqual(failures, []);
  }
  assert.equal([...log.matchAll(/^ERROR:/gm)].length, checkErrors.length + fabricErrors.length, "No other diagnostic is hidden");
  assert.match(log, allowOriginalNegative ? new RegExp("SWITCH_ORIGINAL_NEGATIVE: " + normativeOriginalFailures.length) : /SWITCH_PASSED: \d+/);
  verifySwitchReport(report, {original: allowOriginalNegative});
  for (const file of sources) {
    assert.match(bundle.sources[file], /^[0-9a-f]{64}$/, "Pin every producer: " + file);
  }
  if (!allowOriginalNegative) {
    const originalBytes = await optionalFile("build/switch-original-report.json");
    const original = originalBytes == null ? null : JSON.parse(originalBytes);
    if (original != null) {
      verifySwitchReport(original, {original: true});
      // The same SDK bundle runs on both hosts; only native producers differ.
      assert.equal(original.provenance.bundle.sha256, bundle.sha256);
      assert.deepEqual(original.provenance.bundle.originalReactNativeSources, bundle.originalReactNativeSources);
      for (const [file, sha] of Object.entries(bundle.sources)) {
        if (!nativeProducers.includes(file)) {
          assert.equal(original.provenance.bundle.sources[file], sha, "Shared producer: " + file);
        }
      }
      assert.notEqual(original.provenance.nativeHostSha256, report.provenance.nativeHostSha256);
    }
    await writeFile(path.join(root, "build/switch-comparison.json"), JSON.stringify({scenario: report.scenario,
      originalControlPresent: original != null, sameSDKBundleRequired: true, intentionalNativeProducerDifferences: nativeProducers,
      original, current: report}, null, 2) + "\n");
  }
});
