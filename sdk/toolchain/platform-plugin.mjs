import path from "node:path";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
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
  // RN's FlatList/SectionList import @react-native/virtualized-lists (Flow
  // source) from RN's own location. Resolved when first needed: an SDK without
  // the package never loads one of its modules.
  let listsRoot;
  const inListsPackage = filename => {
    if (listsRoot === undefined) {
      try {
        listsRoot = path.dirname(createRequire(path.join(rnRoot, "package.json"))
          .resolve("@react-native/virtualized-lists/package.json"));
      } catch (error) {
        if (error.code !== "MODULE_NOT_FOUND") {
          throw error;
        }
        listsRoot = null;
      }
    }
    return listsRoot !== null && filename.startsWith(listsRoot + path.sep);
  };
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
      builder.onResolve({ filter: /^react-native\/src\/private\/featureflags\/ReactNativeFeatureFlags$/ }, ({ importer }) => {
        // The original virtualized lists import this unexported RN module. Only
        // that package resolves it; other code keeps RN's package exports.
        if (inListsPackage(importer)) {
          return { path: path.join(rnRoot, "src/private/featureflags/ReactNativeFeatureFlags.js") };
        }
      });
      builder.onResolve({ filter: /(?:^|\/)RCTNetworking$/ }, args => {
        // RN ships this wrapper only as .ios.js and .android.js (RCTNetworking.js
        // merely imports itself for deep imports), and this host resolves neither
        // extension. The Android wrapper is the one whose native contract the
        // Godot Networking module implements: sendRequest(..., data, responseType,
        // incrementalUpdates, timeout, withCredentials), abortRequest, clearCookies.
        if (args.path === "react-native/Libraries/Network/RCTNetworking" || args.importer.startsWith(rnRoot + path.sep)) {
          return { path: path.join(rnRoot, "Libraries/Network/RCTNetworking.android.js") };
        }
      });
      builder.onResolve({ filter: /(?:^|\/)legacySendAccessibilityEvent$/ }, args => {
        // RN ships this function only as .ios.js and .android.js (legacySendAccessibilityEvent.js merely imports
        // itself, for deep imports), and this host resolves neither extension: AccessibilityInfo.js would import a
        // module that imports itself and its setAccessibilityFocus would call undefined. The iOS one is the function
        // whose contract the Godot AccessibilityManager module implements (setAccessibilityFocus for a focus event);
        // the Android one reaches NativeAccessibilityInfo, which the host does not install.
        const target = path.join(rnRoot, "Libraries/Components/AccessibilityInfo/legacySendAccessibilityEvent");
        if (args.path === "react-native/Libraries/Components/AccessibilityInfo/legacySendAccessibilityEvent" ||
            (args.path.startsWith(".") && args.importer.startsWith(rnRoot + path.sep) &&
              path.resolve(path.dirname(args.importer), args.path) === target))
          return { path: target + ".ios.js" };
      });
      builder.onResolve({ filter: /(?:^|\/)Image$/ }, args => {
        // RN ships Image only as .ios.js and .android.js (Image.js merely imports itself for deep imports), and
        // this host resolves neither extension. The public export, ImageBackground and AnimatedImage all import the
        // same module, which renders RN's Image.ios.js (the host's non-Android path) behind a validating wrapper.
        const imageModule = path.join(rnRoot, "Libraries/Image/Image");
        if (args.path === "react-native/Libraries/Image/Image" ||
            (args.path.startsWith(".") && args.importer.startsWith(rnRoot + path.sep) &&
              path.resolve(path.dirname(args.importer), args.path) === imageModule))
          return { path: path.join(platformRoot, "image.jsx") };
      });
      builder.onResolve({ filter: /(?:^|\/)renderApplication$/ }, ({ importer }) => {
        if (importer === path.join(rnRoot, "Libraries/ReactNative/AppRegistryImpl.js"))
          return { path: path.join(platformRoot, "render-application.jsx") };
      });
      builder.onResolve({ filter: /^\.\/AnimatedExports$/ }, ({ importer }) => {
        // RN's Animated.js keeps its original body; only its export glue is
        // Godot's, which leaves out wrappers over hosts Godot does not have.
        if (importer === path.join(rnRoot, "Libraries/Animated/Animated.js"))
          return { path: path.join(platformRoot, "animated-exports.js") };
      });
      builder.onResolve({ filter: /^\.\.\/\.\.\/StyleSheet\/PlatformColorValueTypes$/ }, ({ importer }) => {
        // iOS and Android ship their own PlatformColorValueTypes; Godot has no OS
        // color resources. Only RN's AnimatedColor, which Animated exports, imports
        // it by name; every other RN module keeps RN's own generic forwarder.
        if (importer === path.join(rnRoot, "Libraries/Animated/nodes/AnimatedColor.js"))
          return { path: path.join(platformRoot, "platform-color-value-types.js") };
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
import {hasPointerDownListenerForGodot, hasPointerUpListenerForGodot, hasPointerMoveListenerForGodot,
  hasPointerEnterListenerForGodot, hasPointerLeaveListenerForGodot, hasPointerOverListenerForGodot,
  hasPointerOutListenerForGodot} from ${JSON.stringify(path.join(rnRoot, "src/private/webapis/dom/events/EventTarget.js"))};
import * as Flags from ${JSON.stringify(path.join(rnRoot, "src/private/featureflags/ReactNativeFeatureFlags.js"))};
import {getOwnerDocument} from ${JSON.stringify(path.join(rnRoot, "src/private/webapis/dom/nodes/internals/NodeInternals.js"))};
import {isReactNativeDocumentElementInstanceHandle, getPublicInstanceFromReactNativeDocumentElementInstanceHandle} from ${JSON.stringify(path.join(rnRoot, "src/private/webapis/dom/nodes/internals/ReactNativeDocumentElementInstanceHandle.js"))};
export function installPointerListenerQuery() {
  // Document retains original listener APIs with native dispatch alone. View
  // and documentElement keep their upstream imperative-events method gate.
  if (Flags.enableNativeEventTargetEventDispatching())
    godotInstallPointerListenerQuery((candidate, offset, isRootHandle = false) => {
      // Exact pinned ViewEvents offsets; neither parity nor adjacency defines
      // capture for the remaining native pointer categories.
      let query, capture;
      switch (offset) {
        case 0: query = hasPointerEnterListenerForGodot; capture = false; break;
        case 2: query = hasPointerLeaveListenerForGodot; capture = false; break;
        case 23: query = hasPointerEnterListenerForGodot; capture = true; break;
        case 24: query = hasPointerLeaveListenerForGodot; capture = true; break;
        case 26: query = hasPointerOverListenerForGodot; capture = false; break;
        case 27: query = hasPointerOutListenerForGodot; capture = false; break;
        case 28: query = hasPointerOverListenerForGodot; capture = true; break;
        case 29: query = hasPointerOutListenerForGodot; capture = true; break;
        case 1: query = hasPointerMoveListenerForGodot; capture = false; break;
        case 25: query = hasPointerMoveListenerForGodot; capture = true; break;
        case 34: query = hasPointerDownListenerForGodot; capture = false; break;
        case 35: query = hasPointerDownListenerForGodot; capture = true; break;
        case 36: query = hasPointerUpListenerForGodot; capture = false; break;
        case 37: query = hasPointerUpListenerForGodot; capture = true; break;
        default: return false;
      }
      if (!isRootHandle) return query(candidate, capture);
      if (!isReactNativeDocumentElementInstanceHandle(candidate)) return false;
      const element = getPublicInstanceFromReactNativeDocumentElementInstanceHandle(candidate);
      // These instances were created and linked by RN when the root started.
      // Only read their original slots/Maps; generic renderer ref lookup is lazy.
      // pointerenter/pointerleave do not bubble: at the root only the Document's
      // capture listeners take part, never its bubble listeners.
      const bubbling = offset !== 0 && offset !== 2;
      return query(element, capture) ||
        (element != null && (bubbling || capture) && query(getOwnerDocument(element), capture));
    });
}`};
        if (!filename.startsWith(rnRoot + path.sep) && !inListsPackage(filename)) return;
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
