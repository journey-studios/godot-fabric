import {bundleNativeProbe} from "./native-probe-bundle.mjs";

// Executed producers of the visual half of the Images work: the pure effects (the blur, the clip of rounded corners, the nine-patch of
// capInsets and the description of a draw) with their unit test, the module that draws the picture on an item of its own with a shared
// shader, the view that asks for it, the loader that blurs on its workers and leaves the blurred picture out of the decoded cache, the
// manager that carries the blur radius into the request, the sources that decide which pictures that cache may hold, the runtime
// wiring, the extension's termination, the SDK contract that takes the props and the build.
export const imagesVisualNativeProducers = ["native/image_effects_core.h", "native/image_effects.h", "native/image_effects.cpp", "native/image_effects_test.cpp",
  "native/image_geometry.h", "native/image_view.h", "native/image_view.cpp", "native/image_loader.h", "native/image_loader.cpp", "native/godot_image_manager.cpp",
  "native/image_sources.h", "native/image_sources.cpp", "native/image_cache.h", "native/application_runtime.cpp", "native/register.cpp",
  "native/godot-profile.json", "native/CMakeLists.txt"];

export function bundleImagesVisualProbe() {
  return bundleNativeProbe({name: "images-visual", entryPoint: "tests/images-visual-fixture.jsx",
    sources: ["tests/images-visual-fixture.jsx", "tests/images-visual-probe.gd", "tests/images-visual-native.test.mjs", "tests/images-visual-oracle.mjs",
      "tests/images-visual-pattern.mjs", "tests/images-pattern.mjs", "tests/images-network-server.mjs", "tests/fixtures/images-visual/manifest.json",
      "scripts/images-visual-bundle.mjs", "scripts/images-visual-fixtures.mjs", "scripts/native-probe-bundle.mjs",
      "src/image.jsx", "src/image-contract.mjs", "src/react-native-platform.jsx", "src/animated-exports.js", "sdk/toolchain/platform-plugin.mjs",
      "sdk/toolchain/asset-plugin.mjs", ...imagesVisualNativeProducers],
    seams: ["src/image.jsx", "src/image-contract.mjs", "src/react-native-platform.jsx", "src/animated-exports.js"],
    // The original modules this bundle runs: RN's Image for the host's non-Android path, and its native component, whose view config
    // decides which props reach the native side.
    bundled: ["Libraries/Image/Image.ios.js", "Libraries/Image/ImageViewNativeComponent.js", "Libraries/Image/ImageSourceUtils.js",
      "Libraries/Image/ImageUtils.js", "Libraries/Image/ImageInjection.js", "Libraries/Image/NativeImageLoaderIOS.js",
      "Libraries/Image/resolveAssetSource.js", "Libraries/NativeComponent/NativeComponentRegistry.js"],
    // What the host reproduces: the iOS component's tint, caps and blur, the blur itself, the corner drawing and the masks of a view that
    // clips, the props parsing and the feature flag that keeps the clip on the border box.
    references: ["Libraries/Image/ImageProps.js", "Libraries/Image/RCTImageBlurUtils.mm", "React/Fabric/Mounting/ComponentViews/Image/RCTImageComponentView.mm",
      "React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm", "React/Views/RCTBorderDrawing.m",
      "ReactCommon/react/renderer/imagemanager/platform/ios/react/renderer/imagemanager/RCTImagePrimitivesConversions.h",
      "ReactCommon/react/renderer/imagemanager/platform/ios/react/renderer/imagemanager/ImageRequestParams.h",
      "ReactCommon/react/renderer/components/image/ImageProps.cpp", "ReactCommon/react/renderer/components/image/ImageShadowNode.cpp",
      "ReactCommon/react/renderer/components/view/BaseViewProps.cpp", "ReactCommon/react/renderer/components/view/primitives.h",
      "ReactCommon/react/renderer/core/graphicsConversions.h", "ReactCommon/react/featureflags/ReactNativeFeatureFlagsDefaults.h"]});
}
