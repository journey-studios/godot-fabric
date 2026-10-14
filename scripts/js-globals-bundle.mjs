import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SABOTAGES} from "../tests/js-globals-sabotages.mjs";
import {bundleNativeProbe} from "./native-probe-bundle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

// Executed producers of the JS globals slice: the host's bootstrap script (global and __DEV__ and nothing else) and the two hooks it binds.
export const jsGlobalsNativeProducers = ["native/application_runtime.cpp", "native/application_runtime.h"];

// The original RN modules the current bundle runs, and what the oracle reads of RN: the setup chain, the platforms' own logging hook and
// the polyfill's counterpart in the C++ runtime.
const bundled = ["Libraries/Core/setUpGlobals.js", "src/private/setup/setUpDOM.js", "Libraries/Core/setUpPerformance.js",
  "Libraries/Core/setUpNavigator.js", "Libraries/Utilities/PolyfillFunctions.js", "Libraries/Utilities/defineLazyObjectProperty.js"];
const references = ["src/private/setup/setUpDefaultReactNativeEnvironment.js", "Libraries/Core/InitializeCore.js",
  "../@react-native/js-polyfills/console.js", "../@react-native/js-polyfills/index.js",
  "ReactCommon/jsitooling/react/runtime/JSRuntimeBindings.cpp", "Libraries/Utilities/RCTLog.js"];
const sources = ["tests/js-globals-fixture.jsx", "tests/js-globals-early.js", "tests/js-globals-host.js", "tests/js-globals-cases.mjs",
  "tests/js-globals-probe.gd", "tests/js-globals-native.test.mjs", "tests/js-globals-oracle.mjs", "tests/js-globals-sabotages.mjs",
  "scripts/js-globals-bundle.mjs", "scripts/js-globals-sabotage.mjs", "scripts/native-probe-bundle.mjs", "src/initialize.js",
  "sdk/toolchain/platform-plugin.mjs", "sdk/toolchain/metro-polyfills.mjs", ...jsGlobalsNativeProducers];

export const sabotageNames = SABOTAGES.map(entry => entry.name);

// A sabotage is an override in memory: the plugin hands esbuild a changed text for one file and no file is edited.
function sabotagePlugin(name) {
  const variant = SABOTAGES.find(entry => entry.name === name);
  assert.ok(variant, "Unknown sabotage: " + name);
  const target = path.join(root, variant.file);
  return {name: "js-globals-sabotage-" + name, setup(builder) {
    builder.onLoad({filter: /\.js$/}, async args => {
      if (args.path !== target) {
        return undefined;
      }
      const text = await readFile(target, "utf8");
      assert.equal(text.split(variant.find).length, 2, `The ${name} sabotage must replace exactly one place in ${variant.file}: ${variant.find}`);
      return {contents: text.replace(variant.find, () => variant.replace), loader: "js", resolveDir: path.dirname(target)};
    });
  }};
}

// The bundle of a lane: the current SDK, or the SDK with one sabotage. The host-state module runs before everything, the polyfills included.
export function bundleJsGlobalsProbe(sabotage = null) {
  const probe = {entryPoint: "tests/js-globals-fixture.jsx", inject: ["tests/js-globals-host.js"], references, sources};
  if (sabotage === null) {
    return bundleNativeProbe({...probe, name: "js-globals", seams: ["src/initialize.js"], bundled});
  }
  // A sabotaged bundle lacks what it broke, so it is not asked to contain the modules the current one must.
  return bundleNativeProbe({...probe, name: `js-globals-sabotage-${sabotage}`, seams: [], bundled: [], plugins: [sabotagePlugin(sabotage)]});
}
