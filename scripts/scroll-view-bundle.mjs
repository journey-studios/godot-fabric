import {bundleNativeProbe} from "./native-probe-bundle.mjs";

const references = ["Libraries/Components/ScrollView/ScrollView.js", "Libraries/Components/ScrollView/ScrollViewCommands.js",
  "Libraries/Components/ScrollView/ScrollViewNativeComponent.js", "Libraries/NativeComponent/NativeComponentRegistry.js",
  "Libraries/Renderer/shims/ReactNativeViewConfigRegistry.js", "Libraries/NativeComponent/ViewConfig.js"];
const bundled = references;
const sources = ["tests/scroll-view-fixture.jsx", "tests/scroll-view-probe.gd", "tests/scroll-view-native.test.mjs",
  "scripts/scroll-view-bundle.mjs", "src/scroll-view.jsx", "src/scroll-view-native-config.js", "src/scroll-view-contract.mjs", "src/react-native-platform.jsx",
  "types/react-native.ts", "tests/types/consumer.tsx",
  "native/application_runtime.cpp", "native/pointer_adapter.cpp", "native/pointer_adapter.h",
  "native/scroll_adapter.cpp", "native/scroll_adapter.h", "native/scroll_motion.h", "native/scroll_offset.h",
  "native/scroll_throttle.h"];

export async function bundleScrollViewProbe() {
  return bundleNativeProbe({name: "scroll-view-gf14", entryPoint: "tests/scroll-view-fixture.jsx", sources,
    seams: ["src/scroll-view.jsx", "src/scroll-view-native-config.js", "src/scroll-view-contract.mjs", "src/react-native-platform.jsx"], bundled, references});
}
