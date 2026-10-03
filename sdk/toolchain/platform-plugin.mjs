import path from "node:path";
import { readFile } from "node:fs/promises";
import { transformAsync } from "@babel/core";

// Shared native-host seams. Consumers and the laboratory use the same facade
// and original RN transforms; only their application entrypoints differ.
export function platformPlugin(platformRoot, resolveSdk) {
  return {
    name: "godot-platform",
    setup(builder) {
      builder.onResolve({ filter: /(?:^|\/)renderApplication$/ }, ({ importer }) => {
        if (importer.endsWith("/ReactNative/AppRegistryImpl.js"))
          return { path: path.join(platformRoot, "render-application.jsx") };
      });
      for (const [pattern, file] of [
        [/^react-native$/, "react-native-platform.jsx"],
        [/^react-native-svg$/, "svg.jsx"],
        [/^react-native-reanimated$/, "unsupported-reanimated.js"],
        [/^react-native-safe-area-context$/, "unsupported-safe-area.js"],
        [/react-native\/Libraries\/ReactPrivate\/ReactNativePrivateInterface$/, "private-interface.js"],
        [/react-native\/Libraries\/ReactPrivate\/ReactNativePrivateInitializeCore$/, "initialize.js"],
        [/\/Utilities\/Platform$/, "platform.js"],
        [/\/ReactNative\/UIManager$/, "ui-manager.js"],
        [/\/BatchedBridge\/NativeModules$/, "native-modules.js"],
      ]) builder.onResolve({ filter: pattern }, () => ({ path: path.join(platformRoot, file) }));
      builder.onResolve({ filter: /^react(?:\/.*)?$|^react-native\// }, ({ path: specifier }) => ({ path: resolveSdk(specifier) }));
      builder.onLoad({ filter: /node_modules\/react-native\/.*\.js$/ }, async ({ path: filename }) => ({
        contents: (await transformAsync(await readFile(filename, "utf8"), {
          filename, configFile: false, babelrc: false,
          presets: [[resolveSdk("@react-native/babel-preset"), { disableImportExportTransform: true }]],
        })).code,
        loader: "js",
      }));
    },
  };
}
