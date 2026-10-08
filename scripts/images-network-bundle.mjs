import {bundleNativeProbe} from "./native-probe-bundle.mjs";

// Executed producers of the network half of the Images work: the loader that decodes, the sources that download and cache, their pure
// parts and their unit tests, the image view and the ImageLoader module, the HTTP transport the downloads go through and the pure HTTP
// core it shares with Networking, the lifecycle that tells the caches to give their memory back, the runtime wiring and the build.
export const imagesNetworkNativeProducers = ["native/image_core.h", "native/image_core_test.cpp", "native/image_cache.h", "native/image_cache_test.cpp",
  "native/image_network.h", "native/image_network.cpp", "native/image_network_test.cpp", "native/image_sources.h", "native/image_sources.cpp",
  "native/image_loader.h", "native/image_loader.cpp",
  "native/image_view.h", "native/image_view.cpp", "native/image_loader_module.h", "native/image_loader_module.cpp", "native/godot_image_manager.cpp",
  "native/http_core.h", "native/http_transport.h", "native/godot_http_transport.cpp", "native/app_lifecycle.h", "native/application_runtime.cpp",
  "native/register.cpp", "native/godot-profile.json", "native/CMakeLists.txt"];

export function bundleImagesNetworkProbe() {
  return bundleNativeProbe({name: "images-network", entryPoint: "tests/images-network-fixture.jsx",
    sources: ["tests/images-network-fixture.jsx", "tests/images-network-probe.gd", "tests/images-network-base.gd", "tests/images-network-native.test.mjs", "tests/images-network-oracle.mjs",
      "tests/images-network-server.mjs", "tests/networking-certificates.mjs", "tests/images-pattern.mjs", "scripts/images-network-bundle.mjs", "scripts/native-probe-bundle.mjs",
      "src/image.jsx", "src/image-contract.mjs", "src/react-native-platform.jsx", "src/animated-exports.js", "sdk/toolchain/platform-plugin.mjs",
      "sdk/toolchain/asset-plugin.mjs", ...imagesNetworkNativeProducers],
    seams: ["src/image.jsx", "src/image-contract.mjs", "src/react-native-platform.jsx", "src/animated-exports.js"],
    // The original modules this bundle runs: RN's Image for the host's non-Android path (with the source utilities that turn
    // crossOrigin and referrerPolicy into headers), its native component and its loader spec.
    bundled: ["Libraries/Image/Image.ios.js", "Libraries/Image/ImageViewNativeComponent.js", "Libraries/Image/ImageSourceUtils.js",
      "Libraries/Image/ImageUtils.js", "Libraries/Image/ImageInjection.js", "Libraries/Image/NativeImageLoaderIOS.js",
      "src/private/specs_DEPRECATED/modules/NativeImageLoaderIOS.js", "Libraries/Image/resolveAssetSource.js", "Libraries/Image/AssetSourceResolver.js",
      "Libraries/Image/AssetUtils.js", "src/private/assets/AssetRegistry.js", "src/asset-registry.js", "Libraries/NativeComponent/NativeComponentRegistry.js"],
    // What the host reproduces: the iOS loader and its caches, the HTTP request handler and the network task it downloads through,
    // the component and the manager that ask for a picture, and the C++ pipeline.
    references: ["Libraries/Image/RCTImageLoader.mm", "Libraries/Image/RCTImageCache.mm", "Libraries/Image/RCTImageUtils.mm", "Libraries/Network/RCTNetworkTask.mm",
      "Libraries/Network/RCTHTTPRequestHandler.mm", "React/Fabric/Mounting/ComponentViews/Image/RCTImageComponentView.mm",
      "ReactCommon/react/renderer/imagemanager/platform/ios/react/renderer/imagemanager/RCTImageManager.mm",
      "ReactCommon/react/renderer/imagemanager/platform/ios/react/renderer/imagemanager/RCTImagePrimitivesConversions.h",
      "ReactCommon/react/renderer/imagemanager/ImageResponseObserverCoordinator.cpp", "ReactCommon/react/renderer/components/image/ImageEventEmitter.cpp",
      "ReactCommon/react/renderer/components/image/conversions.h", "React/FBReactNativeSpec/FBReactNativeSpecJSI.h"]});
}
