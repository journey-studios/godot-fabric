import {bundleNativeProbe} from "./native-probe-bundle.mjs";

const references = ["Libraries/Components/ScrollView/ScrollView.js", "Libraries/Components/ScrollView/ScrollViewCommands.js",
  "Libraries/Components/ScrollView/ScrollViewNativeComponent.js", "Libraries/NativeComponent/NativeComponentRegistry.js",
  "Libraries/Renderer/shims/ReactNativeViewConfigRegistry.js", "Libraries/NativeComponent/ViewConfig.js"];
const modalReferences = ["Libraries/Modal/Modal.js", "Libraries/Modal/RCTModalHostViewNativeComponent.js",
  "src/private/components/modal/specs/RCTModalHostViewNativeComponent.js", "Libraries/Components/View/View.js"];
const bundled = references;
const sources = ["tests/scroll-view-fixture.jsx", "tests/scroll-view-probe.gd", "tests/scroll-view-native.test.mjs",
  "scripts/scroll-view-bundle.mjs", "src/scroll-view.jsx", "src/scroll-view-native-config.js", "src/scroll-view-contract.mjs", "src/react-native-platform.jsx",
  "types/react-native.ts", "tests/types/consumer.tsx",
  "native/application_runtime.cpp", "native/pointer_adapter.cpp", "native/pointer_adapter.h",
  "native/scroll_adapter.cpp", "native/scroll_adapter.h", "native/scroll_motion.h", "native/scroll_offset.h",
  "native/scroll_throttle.h"];

const modalSources = ["tests/scroll-view-modal-fixture.jsx", "tests/scroll-view-modal-probe.gd",
  "tests/scroll-view-modal-native.test.mjs", "tests/scroll-view-modal-oracle.mjs", "scripts/scroll-view-bundle.mjs",
  "src/scroll-view.jsx", "src/scroll-view-native-config.js", "src/scroll-view-contract.mjs", "src/react-native-platform.jsx",
  "native/application_runtime.cpp", "native/application_runtime.h", "native/scroll_adapter.cpp", "native/scroll_adapter.h",
  "native/modal_presentation.cpp", "native/modal_presentation.h", "native/physical_embedding.cpp", "native/physical_embedding.h"];

export async function bundleScrollViewProbe() {
  return bundleNativeProbe({name: "scroll-view-gf14", entryPoint: "tests/scroll-view-fixture.jsx", sources,
    seams: ["src/scroll-view.jsx", "src/scroll-view-native-config.js", "src/scroll-view-contract.mjs", "src/react-native-platform.jsx"], bundled, references});
}

export async function bundleScrollViewModalProbe() {
  return bundleNativeProbe({name: "scroll-view-modal", entryPoint: "tests/scroll-view-modal-fixture.jsx", sources: modalSources,
    seams: ["src/scroll-view.jsx", "src/scroll-view-native-config.js", "src/scroll-view-contract.mjs", "src/react-native-platform.jsx"],
    bundled: [...references, ...modalReferences], references: [...references, ...modalReferences]});
}
