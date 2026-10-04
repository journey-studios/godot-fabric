import path from "node:path";
import { readFile } from "node:fs/promises";
import { transformAsync } from "@babel/core";
import {renderEventTargetParentOverlay} from "./rn-event-target-overlay.mjs";
import {renderRendererTagOverlay} from "./rn-renderer-tag-overlay.mjs";
import {renderPointerInterestOverlay} from "./rn-pointer-interest-overlay.mjs";

// Only this exact runtime import is SDK-owned; arbitrary package subpaths keep
// the consumer's dependency rules and cannot accidentally escape into the SDK.
export function isSdkOwnedSpecifier(specifier) {
  return specifier === "@godot-fabric/runtime" || /^react(?:\/|$)|^react-native(?:\/|$)/.test(specifier);
}

// Shared native-host seams. Consumers and the laboratory use the same facade
// and original RN transforms; only their application entrypoints differ.
export function platformPlugin(platformRoot, resolveSdk, {eventTargetParentMode = "current", rendererTagMode = "current", nativeDispatchMode = "original", pointerInterestMode = "original"} = {}) {
  if (eventTargetParentMode !== "current" && eventTargetParentMode !== "original")
    throw new Error("E_EVENT_TARGET_OVERLAY_MODE: expected current or original");
  if (rendererTagMode !== "current" && rendererTagMode !== "original")
    throw new Error("E_RENDERER_TAG_OVERLAY_MODE: expected current or original");
  if (nativeDispatchMode !== "original" && nativeDispatchMode !== "experimental")
    throw new Error("E_RENDERER_NATIVE_DISPATCH_MODE: expected original or experimental");
  if (pointerInterestMode !== "original" && pointerInterestMode !== "current")
    throw new Error("E_POINTER_INTEREST_OVERLAY_MODE: expected original or current");
  if (pointerInterestMode === "current" && nativeDispatchMode !== "experimental")
    throw new Error("E_POINTER_INTEREST_DISPATCH: current interest requires experimental native dispatch");
  const rnRoot = path.dirname(resolveSdk("react-native/package.json"));
  return {
    name: "godot-platform",
    setup(builder) {
      builder.onResolve({ filter: /^\.\.\/node_modules\/react-native\/src\/private\/webapis\/dom\/nodes\/specs\/NativeDOM$/ }, ({ importer }) => {
        // This pinned internal spec is not a package export. Resolve only the
        // platform-owned import against SDK RN, including a relocated addon.
        if (importer !== path.join(platformRoot, "private-interface.js")) return;
        return { path: path.join(path.dirname(resolveSdk("react-native/package.json")),
          "src/private/webapis/dom/nodes/specs/NativeDOM.js") };
      });
      builder.onResolve({ filter: /^\.\.\/node_modules\/react-native\/src\/private\/renderer\/events\/dispatchNativeEvent$/ }, ({ importer }) => {
        // Only this platform facade may resolve the unexported original module.
        if (importer !== path.join(platformRoot, "private-interface.js")) return;
        return { path: path.join(rnRoot, "src/private/renderer/events/dispatchNativeEvent.js") };
      });
      builder.onResolve({ filter: /(?:^|\/)renderApplication$/ }, ({ importer }) => {
        if (importer === path.join(rnRoot, "Libraries/ReactNative/AppRegistryImpl.js"))
          return { path: path.join(platformRoot, "render-application.jsx") };
      });
      builder.onResolve({ filter: /(?:^|\/)PlatformBaseViewConfig$/ }, args => {
        // Only upstream ViewConfig and the exact RN deep import own this seam.
        // A project's similarly named relative module remains project-owned.
        if (args.importer === path.join(rnRoot, "Libraries/NativeComponent/ViewConfig.js") ||
            args.path === "react-native/Libraries/NativeComponent/PlatformBaseViewConfig")
          return { path: path.join(platformRoot, "base-view-config.js") };
      });
      for (const [pattern, file] of [
        [/^@godot-fabric\/runtime$/, "godot-fabric.js"],
        [/^react-native$/, "react-native-platform.jsx"],
        [/^react-native-svg$/, "svg.jsx"],
        [/^react-native-reanimated$/, "unsupported-reanimated.js"],
        [/^react-native-safe-area-context$/, "unsupported-safe-area.js"],
        [/^react-native\/Libraries\/ReactPrivate\/ReactNativePrivateInterface$/, "private-interface.js"],
        [/^react-native\/Libraries\/ReactPrivate\/ReactNativePrivateInitializeCore$/, "initialize.js"],
      ]) builder.onResolve({ filter: pattern }, () => ({ path: path.join(platformRoot, file) }));
      for (const [pattern, publicSpecifier, file] of [
        [/\/Utilities\/Platform$/, "react-native/Libraries/Utilities/Platform", "platform.js"],
        [/\/ReactNative\/UIManager$/, "react-native/Libraries/ReactNative/UIManager", "ui-manager.js"],
        [/\/ReactNative\/RendererProxy$/, "react-native/Libraries/ReactNative/RendererProxy", "renderer-proxy.js"],
        [/\/BatchedBridge\/NativeModules$/, "react-native/Libraries/BatchedBridge/NativeModules", "native-modules.js"],
      ]) builder.onResolve({filter: pattern}, args => {
        if (args.path === publicSpecifier || args.importer.startsWith(rnRoot + path.sep))
          return {path: path.join(platformRoot, file)};
      });
      builder.onResolve({ filter: /^react(?:\/.*)?$|^react-native\// }, ({ path: specifier }) => ({ path: resolveSdk(specifier) }));
      builder.onLoad({ filter: /\.js$/ }, async ({ path: filename }) => {
        if (filename === path.join(platformRoot, "pointer-listener-query.js") && pointerInterestMode === "current")
          return {loader: "js", contents: `
import {hasPointerDownListenerForGodot} from ${JSON.stringify(path.join(rnRoot, "src/private/webapis/dom/events/EventTarget.js"))};
import * as Flags from ${JSON.stringify(path.join(rnRoot, "src/private/featureflags/ReactNativeFeatureFlags.js"))};
import {getOwnerDocument} from ${JSON.stringify(path.join(rnRoot, "src/private/webapis/dom/nodes/internals/NodeInternals.js"))};
import {isReactNativeDocumentElementInstanceHandle, getPublicInstanceFromReactNativeDocumentElementInstanceHandle} from ${JSON.stringify(path.join(rnRoot, "src/private/webapis/dom/nodes/internals/ReactNativeDocumentElementInstanceHandle.js"))};
export function installPointerListenerQuery() {
  // Document retains original listener APIs with native dispatch alone. View
  // and documentElement keep their upstream imperative-events method gate.
  if (Flags.enableNativeEventTargetEventDispatching())
    godotInstallPointerListenerQuery((candidate, offset, isRootHandle = false) => {
      if (offset !== 34 && offset !== 35) return false;
      const capture = offset === 35;
      if (!isRootHandle) return hasPointerDownListenerForGodot(candidate, capture);
      if (!isReactNativeDocumentElementInstanceHandle(candidate)) return false;
      const element = getPublicInstanceFromReactNativeDocumentElementInstanceHandle(candidate);
      // These instances were created and linked by RN when the root started.
      // Only read their original slots/Maps; generic renderer ref lookup is lazy.
      return hasPointerDownListenerForGodot(element, capture) ||
        (element != null && hasPointerDownListenerForGodot(getOwnerDocument(element), capture));
    });
}`};
        if (!filename.startsWith(rnRoot + path.sep)) return;
        let source = await readFile(filename, "utf8");
        if (filename === path.join(rnRoot, "src/private/webapis/dom/events/EventTarget.js"))
          source = renderPointerInterestOverlay(source, pointerInterestMode);
        if (filename === path.join(rnRoot, "src/private/webapis/dom/events/internals/EventTargetInternals.js"))
          source = renderEventTargetParentOverlay(source, eventTargetParentMode);
        if (filename === path.join(rnRoot, "Libraries/Renderer/implementations/ReactFabric-prod.js"))
          source = renderRendererTagOverlay(source, rendererTagMode, {nativeDispatchMode});
        return {
        contents: (await transformAsync(source, {
          filename, configFile: false, babelrc: false,
          presets: [[resolveSdk("@react-native/babel-preset"), { disableImportExportTransform: true }]],
        })).code,
        loader: "js",
        };
      });
    },
  };
}
