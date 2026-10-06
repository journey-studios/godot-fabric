import {bundleNativeProbe} from "./native-probe-bundle.mjs";

// Executed producers of the frame clock slice: the clock itself and its unit test,
// the runtime pump that asks it once per Godot frame, the window metrics that carry
// the display's refresh rate, and the Native Animated backend that ticks serve.
export const frameClockNativeProducers = ["native/frame_clock.h", "native/frame_clock_test.cpp", "native/application_runtime.cpp",
  "native/application_runtime.h", "native/fabric_application.cpp", "native/native_animated.h", "native/native_animated.cpp",
  "native/CMakeLists.txt"];

export function bundleFrameClockProbe() {
  return bundleNativeProbe({name: "frame-clock", entryPoint: "tests/frame-clock-fixture.jsx",
    sources: ["tests/frame-clock-fixture.jsx", "tests/frame-clock-cases.mjs", "tests/frame-clock-probe.gd",
      "tests/frame-clock-native.test.mjs", "tests/frame-clock-oracle.mjs", "scripts/frame-clock-bundle.mjs",
      "scripts/native-probe-bundle.mjs", "src/react-native-platform.jsx", "src/animated-exports.js",
      "src/platform-color-value-types.js", "sdk/toolchain/platform-plugin.mjs", ...frameClockNativeProducers],
    seams: ["src/react-native-platform.jsx", "src/animated-exports.js", "src/platform-color-value-types.js"],
    // The original modules this bundle runs: Animated with its value, view and
    // decay, and the helper that hands the native driver its operations.
    bundled: ["Libraries/Animated/Animated.js", "Libraries/Animated/AnimatedImplementation.js",
      "Libraries/Animated/useAnimatedValue.js", "Libraries/Animated/components/AnimatedView.js",
      "Libraries/Animated/createAnimatedComponent.js", "Libraries/Animated/nodes/AnimatedValue.js",
      "Libraries/Animated/animations/DecayAnimation.js", "src/private/animated/NativeAnimatedHelper.js"],
    // What RN's platforms run frame consumers on: requestAnimationFrame is a
    // zero-delay timer that the timer frame source fires (iOS RCTTiming and
    // RCTDisplayLink, Android JavaTimerManager on Choreographer), and Native
    // Animated is advanced by the scheduler's display link (RCTScheduler) or by
    // every vsync (FabricUIManagerBinding), whose drivers assume that cadence.
    references: ["ReactCommon/react/runtime/TimerManager.cpp", "React/CoreModules/RCTTiming.mm", "React/Base/RCTDisplayLink.m",
      "React/Fabric/RCTScheduler.mm", "ReactAndroid/src/main/java/com/facebook/react/modules/core/JavaTimerManager.kt",
      "ReactAndroid/src/main/jni/react/fabric/FabricUIManagerBinding.cpp",
      "ReactCommon/react/renderer/animated/drivers/DecayAnimationDriver.cpp",
      "ReactCommon/react/renderer/animationbackend/AnimationChoreographer.h"]});
}
