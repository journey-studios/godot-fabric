import assert from "node:assert/strict";
import {SABOTAGES} from "../tests/react-microtasks-sabotages.mjs";
import {bundleNativeProbe, sabotageOverride} from "./native-probe-bundle.mjs";

// Executed producers of the React microtasks slice (GF-05 slice D1): the host's registration of RN's NativeMicrotasks module and the registry that serves it.
export const reactMicrotasksNativeProducers = ["native/application_runtime.cpp", "native/turbo_module_registry.cpp", "native/turbo_module_registry.h",
  "native/CMakeLists.txt"];

// The original RN modules the current bundle runs: setUpTimers (since slice D2, which sets the flag and installs queueMicrotask), the spec module
// queueMicrotask comes from and what it loads, and the shim over it.
const bundled = ["Libraries/Core/setUpTimers.js", "src/private/webapis/microtasks/specs/NativeMicrotasks.js", "Libraries/TurboModule/TurboModuleRegistry.js",
  "Libraries/Core/Timers/immediateShim.js"];
// What the oracle reads of RN: setUpTimers (the flag and where queueMicrotask comes from, which the bundle runs too), the pinned renderer (what the flag changes), the module's C++
// and the RuntimeScheduler that drains the queue and orders the tasks, the event beat that delivers the press, and the portable shim this slice replaces.
const references = ["Libraries/Core/Timers/queueMicrotask.js", "Libraries/Renderer/implementations/ReactFabric-prod.js",
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
  return bundleNativeProbe({...probe, name: `react-microtasks-sabotage-${variant.name}`, seams: [], bundled: [], plugins: [sabotageOverride(`react-microtasks-sabotage-${variant.name}`, variant)]});
}
