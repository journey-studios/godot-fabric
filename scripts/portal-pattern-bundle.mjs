import {bundleNativeProbe} from "./native-probe-bundle.mjs";

// The files the portal pattern runs through: the example that holds the pattern (its provider, host and Portal, and the scenario the
// probe drives), and the public SDK files the pattern uses without changing any of them: the facade of AppRegistry that exposes
// setWrapperComponentProvider, the container that renders the wrapper around a root, the package facade, and the ScrollView and the
// components (View, Pressable, Text) the scenario draws.
export const portalPatternExample = "examples/portal-pattern/App.jsx";
export const portalPatternSdkProducers = ["src/app-registry.js", "src/render-application.jsx", "src/react-native-platform.jsx", "src/scroll-view.jsx",
  "src/components.jsx"];

// The original RN modules the bundle must run: the registry that holds the wrapper provider, the View and the ScrollView the scenario
// draws, and the renderer that draws every root.
export const portalPatternBundled = ["Libraries/ReactNative/AppRegistryImpl.js", "Libraries/Components/View/View.js",
  "Libraries/Components/ScrollView/ScrollView.js", "Libraries/Renderer/implementations/ReactFabric-prod.js"];

// What the oracle follows: the stacking context condition and the slicing that hoists the children of a View that forms none, the container
// RN's own renderApplication puts around a root, and the DOM element that gives a ref its measureInWindow.
const references = ["ReactCommon/react/renderer/components/view/ViewShadowNode.cpp",
  "ReactCommon/react/renderer/mounting/internal/sliceChildShadowNodeViewPairs.cpp", "Libraries/ReactNative/AppContainer-prod.js",
  "Libraries/ReactNative/renderApplication.js", "src/private/webapis/dom/nodes/ReactNativeElement.js"];

export function bundlePortalPatternProbe() {
  return bundleNativeProbe({name: "portal-pattern", entryPoint: "tests/portal-pattern-fixture.jsx",
    sources: ["tests/portal-pattern-fixture.jsx", "tests/portal-pattern-probe.gd", "tests/portal-pattern-native.test.mjs",
      "tests/portal-pattern-oracle.mjs", "tests/portal-pattern-sabotages.mjs", "scripts/portal-pattern-bundle.mjs",
      "scripts/portal-pattern-sabotage.mjs", "scripts/native-probe-bundle.mjs", "sdk/toolchain/platform-plugin.mjs",
      "native/application_runtime.cpp", portalPatternExample, ...portalPatternSdkProducers],
    seams: [portalPatternExample, ...portalPatternSdkProducers], bundled: portalPatternBundled, references});
}
