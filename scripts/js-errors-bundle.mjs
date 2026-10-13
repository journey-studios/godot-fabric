import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SABOTAGES} from "../tests/js-errors-sabotages.mjs";
import {METRO_POLYFILLS, metroPolyfills} from "../sdk/toolchain/metro-polyfills.mjs";
import {bundleNativeProbe} from "./native-probe-bundle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const requireSdk = createRequire(import.meta.url);

// Executed producers of the error path slice (GF-05 slice C): the host's bootstrap and its catch sites, and the unit that holds RN's
// JsErrorHandler, its globals and the ExceptionsManager module.
export const jsErrorsNativeProducers = ["native/application_runtime.cpp", "native/application_runtime.h", "native/fabric_application.cpp",
  "native/js_error_path.cpp", "native/js_error_path.h"];

// The original RN modules the current bundle runs: the error path's JS.
const bundled = ["Libraries/Core/setUpErrorHandling.js", "Libraries/Core/ExceptionsManager.js", "Libraries/Core/NativeExceptionsManager.js",
  "src/private/specs_DEPRECATED/modules/NativeExceptionsManager.js", "Libraries/vendor/core/ErrorUtils.js", "Libraries/Core/Devtools/parseErrorStack.js",
  "src/private/utilities/toError.js"];
// What the oracle reads of RN: the polyfill and its list, the bootstrap order, the C++ the host mirrors, and what RN's own iOS and Android
// hosts do with a fatal and a soft exception.
const references = ["../@react-native/js-polyfills/error-guard.js", "../@react-native/js-polyfills/index.js",
  "src/private/setup/setUpDefaultReactNativeEnvironment.js", "ReactCommon/react/runtime/ReactInstance.cpp",
  "ReactCommon/jserrorhandler/JsErrorHandler.cpp", "ReactCommon/jserrorhandler/ErrorUtils.cpp",
  "ReactCommon/react/featureflags/ReactNativeFeatureFlagsDefaults.h", "React/CoreModules/RCTExceptionsManager.mm",
  "ReactCommon/react/runtime/platform/ios/ReactCommon/RCTInstance.mm", "ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler_Modern.cpp",
  "ReactAndroid/src/main/java/com/facebook/react/modules/core/ExceptionsManagerModule.kt",
  "ReactAndroid/src/main/java/com/facebook/react/util/JSStackTrace.kt"];
const sources = ["tests/js-errors-fixture.jsx", "tests/js-errors-early.js", "tests/js-errors-host.js", "tests/js-errors-cases.mjs",
  "tests/js-errors-probe.gd", "tests/js-errors-native.test.mjs", "tests/js-errors-oracle.mjs", "tests/js-errors-sabotages.mjs",
  "scripts/js-errors-bundle.mjs", "scripts/js-errors-sabotage.mjs", "scripts/native-probe-bundle.mjs", "src/initialize.js",
  "sdk/toolchain/platform-plugin.mjs", "sdk/toolchain/metro-polyfills.mjs", ...jsErrorsNativeProducers];

export const sabotageNames = SABOTAGES.map(entry => entry.name);
export const sabotageNamed = name => SABOTAGES.find(entry => entry.name === name);

// A sabotage of a file the bundle holds is an override in memory: the plugin hands esbuild a changed text for that file and no file is edited.
function sabotagePlugin(variant) {
  const target = path.join(root, variant.file);
  return {name: "js-errors-sabotage-" + variant.name, setup(builder) {
    builder.onLoad({filter: /\.js$/}, async args => {
      if (args.path !== target) {
        return undefined;
      }
      const text = await readFile(target, "utf8");
      assert.equal(text.split(variant.find).length, 2, `The ${variant.name} sabotage must replace exactly one place in ${variant.file}: ${variant.find}`);
      return {contents: text.replace(variant.find, () => variant.replace), loader: "js", resolveDir: path.dirname(target)};
    });
  }};
}

// The list of polyfills the toolchain would inject with the sabotaged text of sdk/toolchain/metro-polyfills.mjs: the text's own list, edited.
async function sabotagedPolyfills(variant) {
  const text = await readFile(path.join(root, variant.file), "utf8");
  assert.equal(text.split(variant.find).length, 2, `The ${variant.name} sabotage must replace exactly one place in ${variant.file}: ${variant.find}`);
  const edited = text.replace(variant.find, () => variant.replace);
  const list = edited.match(/export const METRO_POLYFILLS = (\[[^\]]*\]);/);
  assert.ok(list, "metro-polyfills.mjs no longer exports METRO_POLYFILLS as a list of strings");
  const specifiers = JSON.parse(list[1]);
  assert.ok(specifiers.length < METRO_POLYFILLS.length || specifiers.join() !== METRO_POLYFILLS.join(), "The sabotage changes the list");
  return metroPolyfills(id => requireSdk.resolve(id)).filter((_, index) => specifiers.includes(METRO_POLYFILLS[index]));
}

// The bundle of a lane: the current SDK, or the SDK with one sabotage. A sabotage of the host (`host: true`) bundles the current SDK: it is
// the host in addons/ that differs, and scripts/js-errors-sabotage.mjs builds it. The host-state module runs before everything.
export async function bundleJsErrorsProbe(sabotage = null) {
  const variant = sabotage === null ? null : sabotageNamed(sabotage);
  assert.ok(sabotage === null || variant, "Unknown sabotage: " + sabotage);
  const probe = {entryPoint: "tests/js-errors-fixture.jsx", inject: ["tests/js-errors-host.js"], references, sources};
  const current = {...probe, name: "js-errors", seams: ["src/initialize.js"], bundled};
  if (variant === null || variant.host === true) {
    return bundleNativeProbe(current);
  }
  // A sabotaged bundle lacks what it broke, so it is not asked to contain the modules the current one must.
  const broken = {...probe, name: `js-errors-sabotage-${variant.name}`, seams: [], bundled: []};
  if (variant.file === "sdk/toolchain/metro-polyfills.mjs") {
    return bundleNativeProbe({...broken, polyfills: await sabotagedPolyfills(variant)});
  }
  return bundleNativeProbe({...broken, plugins: [sabotagePlugin(variant)]});
}
