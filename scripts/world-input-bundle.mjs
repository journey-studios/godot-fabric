import {bundleNativeProbe} from "./native-probe-bundle.mjs";

// Executed producers of the pointer spike: the Surface whose mouse_filter is the policy, the runtime that gives each
// View a STOP or IGNORE Control (apply_pointer_filters) and hands the Surface's input to React Native, and the adapter
// that turns Godot's events into pointer events.
export const worldInputNativeProducers = ["native/fabric_surface.h", "native/fabric_surface.cpp", "native/application_runtime.cpp",
  "native/application_runtime.h", "native/pointer_adapter.cpp", "native/pointer_adapter.h"];

export function bundleWorldInputProbe() {
  return bundleNativeProbe({name: "world-input", entryPoint: "tests/world-input-fixture.jsx",
    sources: ["tests/world-input-fixture.jsx", "tests/world-input-probe.gd", "tests/world-input-driver.gd", "tests/world-input-order-witness.gd",
      "tests/world-input-graphics-probe.gd", "tests/world-input-native.test.mjs",
      "tests/world-input-oracle.mjs", "examples/world-input/world.gd", "examples/world-input/world.tscn",
      "examples/world-input/scene.tscn", "examples/world-input/panels.tscn", "scripts/world-input-bundle.mjs",
      "scripts/world-input-graphics.mjs", "scripts/native-probe-bundle.mjs", "src/react-native-platform.jsx", "sdk/toolchain/platform-plugin.mjs",
      ...worldInputNativeProducers],
    seams: ["src/react-native-platform.jsx"],
    // The original modules this bundle runs: the Modal the overlay checks open, and the View under every region.
    bundled: ["Libraries/Modal/Modal.js", "Libraries/Components/View/View.js"],
    // The platforms' own answers to "who gets a touch": iOS (hitTest:withEvent: by pointerEvents, hitSlop as hit-test edge
    // insets) and Android (TouchTargetHelper, pointerEvents and hitSlop) hit-test the HUD's view tree, and what no view
    // takes goes on to the app's own world beneath.
    references: ["React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm",
      "ReactAndroid/src/main/java/com/facebook/react/uimanager/TouchTargetHelper.kt"]});
}
