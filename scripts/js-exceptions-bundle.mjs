import {SABOTAGES} from "../tests/js-exceptions-sabotages.mjs";
import {bundleNativeProbe} from "./native-probe-bundle.mjs";

// Executed producers of the callback exceptions slice (GF-05 slice F): the host's catch sites and microtask checkpoint, and the unit that holds RN's
// JsErrorHandler, which every fatal exception ends in.
export const jsExceptionsNativeProducers = ["native/application_runtime.cpp", "native/application_runtime.h", "native/fabric_application.cpp",
  "native/js_error_path.cpp", "native/js_error_path.h"];

// The original RN modules the bundle runs: the timers, the immediates and the microtasks over the host's modules, the error path, and the files that decide
// whether Hermes tracks a rejection.
const bundled = ["Libraries/Core/setUpTimers.js", "Libraries/Core/Timers/immediateShim.js", "Libraries/Core/setUpErrorHandling.js",
  "Libraries/Core/ExceptionsManager.js", "Libraries/vendor/core/ErrorUtils.js", "src/private/webapis/microtasks/specs/NativeMicrotasks.js",
  "src/private/webapis/idlecallbacks/specs/NativeIdleCallbacks.js"];
// What the oracle reads of RN: the C++ that runs each callback and reports its exception, the event system that rethrows a handler's, the platform hosts
// that wire the timers, and the files that enable (or do not) the rejection tracker.
const references = ["ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler_Modern.cpp", "ReactCommon/react/renderer/runtimescheduler/RuntimeScheduler_Modern.h",
  "ReactCommon/react/renderer/runtimescheduler/Task.cpp", "ReactCommon/react/runtime/TimerManager.cpp", "ReactCommon/react/runtime/ReactInstance.cpp",
  "ReactCommon/react/runtime/BufferedRuntimeExecutor.cpp", "ReactCommon/react/runtime/platform/ios/ReactCommon/RCTInstance.mm",
  "ReactAndroid/src/main/jni/react/runtime/jni/JReactInstance.cpp", "ReactCommon/react/nativemodule/microtasks/NativeMicrotasks.cpp",
  "ReactCommon/react/nativemodule/idlecallbacks/NativeIdleCallbacks.cpp", "ReactCommon/react/renderer/core/EventBeat.cpp",
  "ReactCommon/react/renderer/core/EventQueueProcessor.cpp", "ReactCommon/react/renderer/uimanager/UIManagerBinding.cpp",
  "ReactCommon/react/featureflags/ReactNativeFeatureFlagsDefaults.h", "ReactCommon/jserrorhandler/JsErrorHandler.cpp", "ReactCommon/jsi/jsi/jsi.h",
  "Libraries/Core/polyfillPromise.js", "Libraries/Core/InitializeCore.js", "Libraries/promiseRejectionTrackingOptions.js",
  "Libraries/Renderer/implementations/ReactFabric-prod.js", "React/Fabric/RCTScheduler.mm", "ReactCommon/react/renderer/animated/NativeAnimatedNodesManager.cpp",
  "ReactCommon/react/renderer/animations/LayoutAnimationKeyFrameManager.cpp"];
const sources = ["tests/js-exceptions-fixture.jsx", "tests/js-exceptions-host.js", "tests/js-exceptions-cases.mjs", "tests/js-exceptions-probe.gd",
  "tests/js-exceptions-native.test.mjs", "tests/js-exceptions-oracle.mjs", "tests/js-exceptions-sabotages.mjs", "scripts/js-exceptions-bundle.mjs",
  "scripts/js-exceptions-sabotage.mjs", "scripts/native-probe-bundle.mjs", "src/initialize.js", "src/runtime.js", "sdk/toolchain/platform-plugin.mjs",
  "sdk/toolchain/metro-polyfills.mjs", ...jsExceptionsNativeProducers];

export const sabotageNames = SABOTAGES.map(entry => entry.name);

// The bundle of a lane. Every sabotage of this slice breaks the host (a line of native/application_runtime.cpp), so every lane bundles the current SDK, and the host
// in addons/ is the one that differs (scripts/js-exceptions-sabotage.mjs builds it). The host-state module runs before everything.
export async function bundleJsExceptionsProbe() {
  return bundleNativeProbe({name: "js-exceptions", entryPoint: "tests/js-exceptions-fixture.jsx", inject: ["tests/js-exceptions-host.js"], references, sources,
    seams: ["src/initialize.js", "src/runtime.js"], bundled});
}
