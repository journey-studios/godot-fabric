import {bundleNativeProbe} from "./native-probe-bundle.mjs";

// Executed producers of the text layout slice: the platform TextLayoutManager that gives the
// build RN's measureLines, the host that overrides it over the one shaped paragraph, the runtime
// that exposes the counters, and the build files that select the platform manager.
export const textLayoutNativeProducers = ["native/text_platform/react/renderer/textlayoutmanager/TextLayoutManager.h",
  "native/text_platform/react/renderer/textlayoutmanager/TextLayoutManager.cpp", "native/paragraph_layout.h",
  "native/paragraph_layout.cpp", "native/paragraph_view.cpp", "native/application_runtime.cpp", "native/CMakeLists.txt"];

export function bundleTextLayoutProbe() {
  return bundleNativeProbe({name: "text-layout", entryPoint: "tests/text-layout-fixture.jsx",
    sources: ["tests/text-layout-fixture.jsx", "tests/text-layout-probe.gd", "tests/text-layout-native.test.mjs",
      "tests/text-layout-oracle.mjs", "scripts/text-layout-bundle.mjs", "scripts/native-probe-bundle.mjs",
      "src/react-native-platform.jsx", "src/text.jsx", "sdk/toolchain/platform-plugin.mjs", ...textLayoutNativeProducers],
    seams: ["src/react-native-platform.jsx", "src/text.jsx"],
    // The original modules the probe runs: the renderer that dispatches topTextLayout to the
    // registered handler and the registry that holds the Paragraph's ViewConfig.
    bundled: ["Libraries/Renderer/implementations/ReactFabric-prod.js",
      "Libraries/Renderer/shims/ReactNativeViewConfigRegistry.js"],
    // What RN's own code does with a platform's line measurements and what iOS and Android report:
    // the layout and baseline callers, the payload, the JS declaration of onTextLayout and its
    // type, and the two platform measurements the slice's contract follows.
    references: ["ReactCommon/react/renderer/components/text/ParagraphShadowNode.cpp",
      "ReactCommon/react/renderer/components/text/ParagraphEventEmitter.cpp",
      "ReactCommon/react/renderer/components/text/BaseParagraphProps.cpp",
      "ReactCommon/react/renderer/textlayoutmanager/TextLayoutManagerExtended.h",
      "ReactCommon/react/renderer/textlayoutmanager/TextMeasureCache.h",
      "ReactCommon/react/renderer/textlayoutmanager/platform/cxx/react/renderer/textlayoutmanager/TextLayoutManager.h",
      "ReactCommon/react/renderer/textlayoutmanager/platform/ios/react/renderer/textlayoutmanager/RCTTextLayoutManager.mm",
      "ReactCommon/react/renderer/textlayoutmanager/platform/ios/react/renderer/textlayoutmanager/RCTAttributedTextUtils.mm",
      "ReactAndroid/src/main/java/com/facebook/react/views/text/FontMetricsUtil.kt",
      "Libraries/Text/TextNativeComponent.js", "Libraries/Types/CoreEventTypes.js"]});
}
