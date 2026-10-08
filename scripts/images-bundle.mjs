import {bundleNativeProbe} from "./native-probe-bundle.mjs";

// Executed producers of the Images slice: the pure image core and geometry with their unit test, the loader that reads and
// decodes on the worker pool, RN's ImageManager over it, the GodotImage view, the ImageLoader module, the asset pipeline
// that puts bundled pictures beside the bundle, the SDK files that route RN's Image through the validating wrapper, the
// runtime wiring and the build that compiles RN's image sources.
export const imagesNativeProducers = ["native/image_core.h", "native/image_geometry.h", "native/image_core_test.cpp", "native/image_loader.h",
  "native/image_loader.cpp", "native/godot_image_manager.h", "native/godot_image_manager.cpp", "native/image_view.h", "native/image_view.cpp",
  "native/image_loader_module.h", "native/image_loader_module.cpp", "native/application_runtime.cpp", "native/register.cpp", "native/godot-profile.json",
  "native/CMakeLists.txt"];

export function bundleImagesProbe() {
  return bundleNativeProbe({name: "images", entryPoint: "tests/images-fixture.jsx",
    sources: ["tests/images-fixture.jsx", "tests/images-probe.gd", "tests/images-native.test.mjs", "tests/images-oracle.mjs", "tests/images-pattern.mjs",
      "tests/fixtures/images/manifest.json", "scripts/images-bundle.mjs", "scripts/images-fixtures.mjs", "scripts/images-fixtures.gd", "scripts/native-probe-bundle.mjs",
      "src/image.jsx", "src/image-contract.mjs", "src/react-native-platform.jsx", "src/animated-exports.js", "sdk/toolchain/platform-plugin.mjs",
      "sdk/toolchain/asset-plugin.mjs", ...imagesNativeProducers],
    seams: ["src/image.jsx", "src/image-contract.mjs", "src/react-native-platform.jsx", "src/animated-exports.js"],
    // The original modules this bundle runs: RN's Image for the host's non-Android path, its native component and loader
    // spec, the asset resolution, ImageBackground and the animated wrapper.
    bundled: ["Libraries/Image/Image.ios.js", "Libraries/Image/ImageViewNativeComponent.js", "Libraries/Image/ImageSourceUtils.js",
      "Libraries/Image/ImageUtils.js", "Libraries/Image/ImageInjection.js", "Libraries/Image/NativeImageLoaderIOS.js",
      "src/private/specs_DEPRECATED/modules/NativeImageLoaderIOS.js", "Libraries/Image/resolveAssetSource.js", "Libraries/Image/AssetSourceResolver.js",
      "Libraries/Image/AssetUtils.js", "src/private/assets/AssetRegistry.js", "src/asset-registry.js", "Libraries/Image/ImageBackground.js",
      "Libraries/Animated/components/AnimatedImage.js", "Libraries/NativeComponent/NativeComponentRegistry.js"],
    // What the host reproduces: the iOS component and its loader, the request handlers, the C++ pipeline and Metro's asset descriptor.
    references: ["Libraries/Image/Image.js", "Libraries/Image/Image.android.js", "Libraries/Image/RCTImageLoader.mm", "Libraries/Image/RCTImageUtils.mm",
      "Libraries/Image/RCTBundleAssetImageLoader.mm", "Libraries/Network/RCTFileRequestHandler.mm", "Libraries/Network/RCTDataRequestHandler.mm",
      "Libraries/Network/RCTNetworkTask.mm", "React/Fabric/Mounting/ComponentViews/Image/RCTImageComponentView.mm",
      "ReactCommon/react/renderer/imagemanager/platform/ios/react/renderer/imagemanager/RCTImageManager.mm",
      "ReactCommon/react/renderer/imagemanager/platform/ios/react/renderer/imagemanager/RCTImagePrimitivesConversions.h",
      "ReactCommon/react/renderer/imagemanager/ImageResponseObserverCoordinator.cpp", "ReactCommon/react/renderer/imagemanager/ImageRequest.h",
      "ReactCommon/react/renderer/components/image/ImageShadowNode.cpp", "ReactCommon/react/renderer/components/image/ImageEventEmitter.cpp",
      "ReactCommon/react/renderer/components/image/ImageComponentDescriptor.cpp", "ReactCommon/react/renderer/components/image/conversions.h",
      "React/FBReactNativeSpec/FBReactNativeSpecJSI.h"]});
}
