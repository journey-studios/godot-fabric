import {bundleNativeProbe} from "./native-probe-bundle.mjs";

// The public SDK files the slice changed: the facade that exposes RN's registry, the container that reports which
// surfaces it renders, and the facade of the package that exports the facade.
export const appRegistrySdkProducers = ["src/app-registry.js", "src/render-application.jsx", "src/react-native-platform.jsx"];

// The original RN modules the bundle must run: the registry itself, the root tag context, the display mode coercion and the
// stub that the instrumentation hook receives, and the renderer that draws every root.
export const appRegistryBundled = ["Libraries/ReactNative/AppRegistryImpl.js", "Libraries/ReactNative/RootTag.js",
  "Libraries/ReactNative/DisplayMode.js", "Libraries/ReactNative/DeprecatedPerformanceLoggerStub.js",
  "Libraries/Renderer/implementations/ReactFabric-prod.js"];

// What RN's registry, its host binding and its containers do, which the oracle follows: AppRegistry.js (LogBox and the
// callable module), the headless members, the AppContainer that RN's renderApplication wraps a root in, the binding the
// host calls, and the declarations the public type is checked against.
const references = ["Libraries/ReactNative/AppRegistry.js", "Libraries/ReactNative/AppContainer-prod.js", "Libraries/ReactNative/renderApplication.js",
  "Libraries/ReactNative/HeadlessJsTaskError.js", "Libraries/ReactNative/NativeHeadlessJsTaskSupport.js",
  "ReactCommon/react/renderer/uimanager/AppRegistryBinding.cpp", "types_generated/Libraries/ReactNative/AppRegistryImpl.d.ts",
  "types_generated/Libraries/ReactNative/AppRegistry.flow.d.ts"];

export function bundleAppRegistryProbe() {
  return bundleNativeProbe({name: "app-registry", entryPoint: "tests/app-registry-fixture.jsx",
    sources: ["tests/app-registry-fixture.jsx", "tests/app-registry-probe.gd", "tests/app-registry-native.test.mjs",
      "tests/app-registry-oracle.mjs", "tests/app-registry-sabotages.mjs", "scripts/app-registry-bundle.mjs",
      "scripts/app-registry-sabotage.mjs", "scripts/native-probe-bundle.mjs", "sdk/toolchain/platform-plugin.mjs",
      "native/application_runtime.cpp", ...appRegistrySdkProducers],
    seams: appRegistrySdkProducers, bundled: appRegistryBundled, references});
}
