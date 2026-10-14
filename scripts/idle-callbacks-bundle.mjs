import assert from "node:assert/strict";
import {SABOTAGES} from "../tests/idle-callbacks-sabotages.mjs";
import {bundleNativeProbe, sabotageOverride} from "./native-probe-bundle.mjs";

// Executed producers of the idle callbacks slice (GF-05 slice D2): the host's registration of RN's NativeIdleCallbacks module, the registry that serves and
// counts it, the build of RN's module, and the host's lifecycle gate with its strict argument.
export const idleCallbacksNativeProducers = ["native/application_runtime.cpp", "native/turbo_module_registry.cpp", "native/turbo_module_registry.h",
  "native/CMakeLists.txt"];

// The original RN modules the current bundle runs: setUpTimers and what it installs the idle callbacks, the microtask and the immediates from, and the
// polyfillGlobal that the host's gate uses over RN's.
const bundled = ["Libraries/Core/setUpTimers.js", "Libraries/Utilities/PolyfillFunctions.js", "Libraries/Utilities/defineLazyObjectProperty.js",
  "src/private/webapis/idlecallbacks/specs/NativeIdleCallbacks.js", "src/private/webapis/microtasks/specs/NativeMicrotasks.js", "Libraries/TurboModule/TurboModuleRegistry.js",
  "Libraries/Core/Timers/immediateShim.js"];
// What the oracle reads of RN: the module's C++ and header, the RuntimeScheduler that orders the tasks, yields and cancels, the event beat that delivers the press,
// and the setup chain's own order.
const references = ["Libraries/Core/Timers/queueMicrotask.js", "ReactCommon/react/nativemodule/idlecallbacks/NativeIdleCallbacks.cpp",
  "ReactCommon/react/nativemodule/idlecallbacks/NativeIdleCallbacks.h", "ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler.cpp",
  "ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler.h", "ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler_Modern.cpp",
  "ReactCommon/react/renderer/runtimescheduler/SchedulerPriorityUtils.h", "ReactCommon/react/renderer/runtimescheduler/Task.h",
  "ReactCommon/react/renderer/runtimescheduler/Task.cpp", "ReactCommon/react/renderer/core/EventBeat.cpp", "src/private/setup/setUpDefaultReactNativeEnvironment.js"];
const sources = ["tests/idle-callbacks-fixture.jsx", "tests/idle-callbacks-cases.mjs", "tests/idle-callbacks-probe.gd", "tests/idle-callbacks-native.test.mjs",
  "tests/idle-callbacks-oracle.mjs", "tests/idle-callbacks-sabotages.mjs", "tests/react-microtasks-host.js", "tests/react-microtasks-oracle.mjs",
  "scripts/idle-callbacks-bundle.mjs", "scripts/idle-callbacks-sabotage.mjs", "scripts/native-probe-bundle.mjs", "src/runtime.js", "src/initialize.js",
  "sdk/toolchain/platform-plugin.mjs", "sdk/toolchain/metro-polyfills.mjs", ...idleCallbacksNativeProducers];

export const sabotageNames = SABOTAGES.map(entry => entry.name);
export const sabotageNamed = name => SABOTAGES.find(entry => entry.name === name);

// The bundle of a lane: the current SDK, or the SDK with one sabotage. A sabotage of the host (`host: true`) bundles the current SDK: it is the host in addons/ that
// differs, and scripts/idle-callbacks-sabotage.mjs builds it. The host-state module of the microtasks slice runs before everything: it records the flag's writes and
// reads, which the renderer's read must follow.
export async function bundleIdleCallbacksProbe(sabotage = null) {
  const variant = sabotage === null ? null : sabotageNamed(sabotage);
  assert.ok(sabotage === null || variant, "Unknown sabotage: " + sabotage);
  const probe = {entryPoint: "tests/idle-callbacks-fixture.jsx", inject: ["tests/react-microtasks-host.js"], references, sources};
  if (variant === null || variant.host === true) {
    return bundleNativeProbe({...probe, name: "idle-callbacks", seams: ["src/runtime.js", "src/initialize.js"], bundled});
  }
  // A sabotaged bundle is not asked to contain what the sabotage may have taken out.
  return bundleNativeProbe({...probe, name: `idle-callbacks-sabotage-${variant.name}`, seams: [], bundled: [],
    plugins: [sabotageOverride(`idle-callbacks-sabotage-${variant.name}`, variant)]});
}
