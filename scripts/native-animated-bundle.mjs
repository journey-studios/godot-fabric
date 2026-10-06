import {bundleNativeProbe} from "./native-probe-bundle.mjs";

// Executed producers of the native Animated slice: the reproducer and oracle,
// the public SDK seams that give RN's own Animated its platform pieces, and the
// native side that runs RN's C++ AnimatedModule and AnimationBackend on Godot's
// frame tick.
export const nativeAnimatedNativeProducers = ["native/native_animated.h", "native/native_animated.cpp",
  "native/application_runtime.cpp", "native/turbo_module_registry.cpp", "native/turbo_module_registry.h", "native/register.cpp",
  "native/CMakeLists.txt"];

export function bundleNativeAnimatedProbe() {
  return bundleNativeProbe({name: "native-animated", entryPoint: "tests/native-animated-fixture.jsx",
    sources: ["tests/native-animated-fixture.jsx", "tests/native-animated-cases.mjs", "tests/native-animated-probe.gd",
      "tests/native-animated-native.test.mjs", "tests/native-animated-oracle.mjs", "scripts/native-animated-bundle.mjs",
      "scripts/native-probe-bundle.mjs", "src/react-native-platform.jsx", "src/animated-exports.js",
      "src/platform-color-value-types.js", "sdk/toolchain/platform-plugin.mjs", ...nativeAnimatedNativeProducers],
    seams: ["src/react-native-platform.jsx", "src/animated-exports.js", "src/platform-color-value-types.js"],
    // The original modules this bundle runs: Animated and its drivers, values,
    // composition, hooks and Animated.View, and the TouchableOpacity that
    // Pressability drives with the native driver.
    bundled: ["Libraries/Animated/Animated.js", "Libraries/Animated/AnimatedImplementation.js",
      "Libraries/Animated/Easing.js", "Libraries/Animated/useAnimatedValue.js", "Libraries/Animated/useAnimatedValueXY.js",
      "Libraries/Animated/components/AnimatedView.js", "Libraries/Animated/createAnimatedComponent.js",
      "Libraries/Animated/nodes/AnimatedValue.js", "Libraries/Animated/nodes/AnimatedInterpolation.js",
      "Libraries/Animated/animations/TimingAnimation.js", "Libraries/Animated/animations/SpringAnimation.js",
      "Libraries/Animated/animations/DecayAnimation.js", "Libraries/Animated/NativeAnimatedModule.js",
      "src/private/animated/NativeAnimatedHelper.js", "src/private/animated/createAnimatedPropsHook.js",
      "Libraries/Components/Touchable/TouchableOpacity.js", "Libraries/Pressability/Pressability.js"],
    // The C++ drivers, backend and module the host runs, and how the platforms
    // wire them (iOS and Android's mounting and scheduler delegates).
    references: ["index.js", "ReactCommon/react/renderer/animated/AnimatedModule.cpp",
      "ReactCommon/react/renderer/animated/NativeAnimatedNodesManager.cpp",
      "ReactCommon/react/renderer/animated/NativeAnimatedNodesManagerProvider.cpp",
      "ReactCommon/react/renderer/animated/drivers/FrameAnimationDriver.cpp",
      "ReactCommon/react/renderer/animated/drivers/SpringAnimationDriver.cpp",
      "ReactCommon/react/renderer/animated/drivers/DecayAnimationDriver.cpp",
      "ReactCommon/react/renderer/animationbackend/AnimationBackend.cpp",
      "ReactCommon/react/renderer/animationbackend/AnimationChoreographer.h",
      "ReactCommon/react/nativemodule/defaults/DefaultTurboModules.cpp",
      "React/Fabric/Mounting/RCTMountingManager.mm", "React/Fabric/RCTScheduler.mm",
      "ReactAndroid/src/main/jni/react/fabric/FabricUIManagerBinding.cpp"]});
}
