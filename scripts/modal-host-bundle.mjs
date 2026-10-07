import {bundleNativeProbe} from "./native-probe-bundle.mjs";

export const modalHostNativeProducers = ["native/application_runtime.cpp", "native/application_runtime.h", "native/fabric_surface.cpp",
  "native/godot_dom.cpp", "native/godot_dom.h", "native/modal_host_view_component_descriptor.h",
  "native/modal_window_stack.cpp", "native/modal_window_stack.h",
  "native/modal_presentation.cpp", "native/modal_presentation.h", "native/window_metrics.h",
  "native/physical_embedding.cpp", "native/physical_embedding.h", "native/pointer_adapter.cpp",
  "native/pointer_adapter.h", "native/pointer_event.h", "native/pointer_geometry.cpp", "native/pointer_geometry.h",
  "native/adapter_registry.cpp", "native/CMakeLists.txt", "native/register.cpp"];

export function bundleModalHostProbe(name = "modal-host") {
  return bundleNativeProbe({name, entryPoint: "tests/modal-host-fixture.jsx",
    sources: ["tests/modal-host-fixture.jsx", "tests/modal-host-probe.gd", "tests/modal-host-native.test.mjs",
      "tests/modal-capture-lifetime-probe.gd", "tests/modal-sibling-order-probe.gd",
      "tests/modal-owner-windows-probe.gd", "tests/modal-stack-membership-probe.gd",
      "tests/modal-surface-lifetime-probe.gd",
      "tests/modal-stack-membership-native.test.mjs", "tests/modal-discriminators-native.test.mjs",
      "scripts/modal-host-bundle.mjs", "scripts/native-probe-bundle.mjs", "src/react-native-platform.jsx",
      "sdk/toolchain/platform-plugin.mjs", ...modalHostNativeProducers],
    seams: ["src/react-native-platform.jsx"],
    bundled: ["Libraries/Modal/Modal.js", "Libraries/Modal/RCTModalHostViewNativeComponent.js",
      "src/private/components/modal/specs/RCTModalHostViewNativeComponent.js",
      "Libraries/Components/SafeAreaView/SafeAreaView.js", "Libraries/Components/View/View.js"],
    references: ["React/Fabric/Mounting/ComponentViews/Modal/RCTModalHostViewComponentView.h",
      "React/Fabric/Mounting/ComponentViews/Modal/RCTModalHostViewComponentView.mm",
      "ReactAndroid/src/main/java/com/facebook/react/views/modal/ReactModalHostView.kt",
      "ReactCommon/react/renderer/components/modal/ModalHostViewShadowNode.cpp",
      "ReactCommon/react/renderer/components/modal/ModalHostViewComponentDescriptor.h"]});
}
