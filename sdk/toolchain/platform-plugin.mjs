import path from "node:path";
import { readFile } from "node:fs/promises";
import { transformAsync } from "@babel/core";

// Only this exact runtime import is SDK-owned; arbitrary package subpaths keep
// the consumer's dependency rules and cannot accidentally escape into the SDK.
export function isSdkOwnedSpecifier(specifier) {
  return specifier === "@godot-fabric/runtime" || /^react(?:\/|$)|^react-native(?:\/|$)/.test(specifier);
}

// Shared native-host seams. Consumers and the laboratory use the same facade
// and original RN transforms; only their application entrypoints differ.
export function platformPlugin(platformRoot, resolveSdk) {
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
        if (!filename.startsWith(rnRoot + path.sep)) return;
        return {
        contents: (await transformAsync(await readFile(filename, "utf8"), {
          filename, configFile: false, babelrc: false,
          presets: [[resolveSdk("@react-native/babel-preset"), { disableImportExportTransform: true }]],
        })).code,
        loader: "js",
        };
      });
    },
  };
}
