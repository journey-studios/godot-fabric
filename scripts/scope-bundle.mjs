import {bundleNativeProbe} from "./native-probe-bundle.mjs";

// The bundle of the 0.5 scope suite (tests/scope-0.5-native.test.mjs): the fixture over the public facade, with the prop policy
// (src/prop-scope.mjs) in it. The causal control bundles the same fixture over the SDK of main before this slice
// (build/frontier-scope-previous/src, taken from the commit that precedes it): `platformRoot` and `name` say so.
export const scopeSources = ["tests/scope-0.5-fixture.jsx", "tests/scope-0.5-probe.gd", "tests/scope-0.5-native.test.mjs",
  "tests/scope-0.5-oracle.mjs", "scripts/scope-bundle.mjs", "scripts/native-probe-bundle.mjs", "src/prop-scope.mjs",
  "src/react-native-platform.jsx", "src/components.jsx", "src/text.jsx", "src/image.jsx", "src/image-contract.mjs",
  "src/base-view-config.js", "docs/compatibility/scope-0.5.json", "docs/compatibility/contracts-0.87.1.json",
  "sdk/toolchain/platform-plugin.mjs"];

export function bundleScopeProbe({platformRoot, plugins} = {}) {
  return bundleNativeProbe({name: "scope-0.5", entryPoint: "tests/scope-0.5-fixture.jsx", sources: scopeSources,
    seams: ["src/prop-scope.mjs"],
    bundled: ["Libraries/Components/View/View.js", "Libraries/Text/Text.js", "Libraries/Pressability/usePressability.js",
      "Libraries/Image/Image.ios.js", "Libraries/Modal/Modal.js", "Libraries/Components/ActivityIndicator/ActivityIndicator.js"],
    // The sources the classification cites (the Pressable.js whose props the Godot port follows is a reference, not a module).
    references: ["Libraries/Components/Pressable/Pressable.js", "Libraries/NativeComponent/BaseViewConfig.ios.js", "Libraries/Components/View/ViewPropTypes.js",
      "Libraries/Text/TextNativeComponent.js", "Libraries/Image/ImageViewNativeComponent.js",
      "src/private/components/activityindicator/specs/ActivityIndicatorViewNativeComponent.js",
      "src/private/components/modal/specs/RCTModalHostViewNativeComponent.js",
      "React/Fabric/Mounting/ComponentViews/View/RCTViewComponentView.mm"],
    ...(platformRoot === undefined ? {} : {platformRoot}), ...(plugins === undefined ? {} : {plugins})});
}
