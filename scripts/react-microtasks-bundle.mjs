import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {SABOTAGES} from "../tests/react-microtasks-sabotages.mjs";
import {bundleNativeProbe} from "./native-probe-bundle.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

// Executed producers of the React microtasks slice (GF-05 slice D1): the host's registration of RN's NativeMicrotasks module and the registry that serves it.
export const reactMicrotasksNativeProducers = ["native/application_runtime.cpp", "native/turbo_module_registry.cpp", "native/turbo_module_registry.h",
  "native/CMakeLists.txt"];

// The original RN modules the current bundle runs: the spec module queueMicrotask is installed from and what it loads, and the shim over it.
const bundled = ["src/private/webapis/microtasks/specs/NativeMicrotasks.js", "Libraries/TurboModule/TurboModuleRegistry.js",
  "Libraries/Core/Timers/immediateShim.js"];
// What the oracle reads of RN: setUpTimers (the flag and where queueMicrotask comes from), the pinned renderer (what the flag changes), the module's C++
// and the RuntimeScheduler that drains the queue and orders the tasks, the event beat that delivers the press, and the portable shim this slice replaces.
const references = ["Libraries/Core/setUpTimers.js", "Libraries/Core/Timers/queueMicrotask.js", "Libraries/Renderer/implementations/ReactFabric-prod.js",
  "ReactCommon/react/nativemodule/microtasks/NativeMicrotasks.cpp", "ReactCommon/react/nativemodule/microtasks/NativeMicrotasks.h",
  "ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler_Modern.cpp", "ReactCommon/react/renderer/runtimescheduler/SchedulerPriorityUtils.h",
  "ReactCommon/react/renderer/runtimescheduler/Task.h", "ReactCommon/react/renderer/core/EventBeat.cpp",
  "src/private/setup/setUpDefaultReactNativeEnvironment.js"];
const sources = ["tests/react-microtasks-fixture.jsx", "tests/react-microtasks-host.js", "tests/react-microtasks-cases.mjs", "tests/react-microtasks-probe.gd",
  "tests/react-microtasks-native.test.mjs", "tests/react-microtasks-oracle.mjs", "tests/react-microtasks-sabotages.mjs", "scripts/react-microtasks-bundle.mjs",
  "scripts/react-microtasks-sabotage.mjs", "scripts/native-probe-bundle.mjs", "src/runtime.js", "src/initialize.js", "sdk/toolchain/platform-plugin.mjs",
  "sdk/toolchain/metro-polyfills.mjs", ...reactMicrotasksNativeProducers];

export const sabotageNames = SABOTAGES.map(entry => entry.name);
export const sabotageNamed = name => SABOTAGES.find(entry => entry.name === name);

// A sabotage of a file the bundle holds is an override in memory: the plugin hands esbuild a changed text for that file and no file is edited.
function sabotagePlugin(variant) {
  const target = path.join(root, variant.file);
  return {name: "react-microtasks-sabotage-" + variant.name, setup(builder) {
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

// The bundle of a lane: the current SDK, or the SDK with one sabotage. A sabotage of the host (`host: true`) bundles the current SDK: it is the host in addons/ that
// differs, and scripts/react-microtasks-sabotage.mjs builds it. The host-state module runs before everything.
export async function bundleReactMicrotasksProbe(sabotage = null) {
  const variant = sabotage === null ? null : sabotageNamed(sabotage);
  assert.ok(sabotage === null || variant, "Unknown sabotage: " + sabotage);
  const probe = {entryPoint: "tests/react-microtasks-fixture.jsx", inject: ["tests/react-microtasks-host.js"], references, sources};
  if (variant === null || variant.host === true) {
    return bundleNativeProbe({...probe, name: "react-microtasks", seams: ["src/runtime.js", "src/initialize.js"], bundled});
  }
  // A sabotaged bundle is not asked to contain what the sabotage may have taken out.
  return bundleNativeProbe({...probe, name: `react-microtasks-sabotage-${variant.name}`, seams: [], bundled: [], plugins: [sabotagePlugin(variant)]});
}
