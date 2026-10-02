import { build } from "esbuild";
import { transformAsync } from "@babel/core";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  compileNativeWind,
  assertNativeWindBundle,
} from "./nativewind-compile.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
await mkdir(path.join(root, "build"), { recursive: true });
await compileNativeWind();
const result = await build({
  absWorkingDir: root,
  entryPoints: ["examples/entry.jsx"],
  outfile: "build/app.js",
  bundle: true,
  platform: "neutral",
  format: "iife",
  define: { "process.env.NODE_ENV": '"production"', __DEV__: "false" },
  mainFields: ["main"],
  resolveExtensions: [".native.js", ".js", ".jsx", ".json"],
  metafile: true,
  plugins: [
    {
      name: "godot-platform",
      setup(builder) {
        builder.onResolve({ filter: /^react-native-reanimated$/ }, () => ({
          path: path.join(root, "src/unsupported-reanimated.js"),
        }));
        builder.onResolve(
          { filter: /^react-native-safe-area-context$/ },
          () => ({
            path: path.join(root, "src/unsupported-safe-area.js"),
          }),
        );
        builder.onLoad(
          {
            filter:
              /(?:examples\/(?:nativewind|typography)\/App\.jsx|react-native-css-interop\/dist\/doctor\.native\.js)$/,
          },
          async ({ path: filename }) => ({
            contents: (
              await transformAsync(await readFile(filename, "utf8"), {
                filename,
                configFile: false,
                babelrc: false,
                presets: ["nativewind/babel"],
              })
            ).code,
            loader: "js",
          }),
        );
        builder.onResolve({ filter: /^react-native$/ }, () => ({
          path: path.join(root, "src/react-native-platform.jsx"),
        }));
        builder.onResolve({ filter: /^react-native-svg$/ }, () => ({
          path: path.join(root, "src/svg.jsx"),
        }));
        builder.onResolve(
          {
            filter:
              /react-native\/Libraries\/ReactPrivate\/ReactNativePrivateInterface$/,
          },
          () => ({ path: path.join(root, "src/private-interface.js") }),
        );
        builder.onResolve(
          {
            filter:
              /react-native\/Libraries\/ReactPrivate\/ReactNativePrivateInitializeCore$/,
          },
          () => ({ path: path.join(root, "src/initialize.js") }),
        );
        for (const [pattern, file] of [
          [/\/Utilities\/Platform$/, "platform.js"],
          [/\/ReactNative\/UIManager$/, "ui-manager.js"],
          [/\/BatchedBridge\/NativeModules$/, "native-modules.js"],
        ])
          builder.onResolve({ filter: pattern }, () => ({
            path: path.join(root, "src", file),
          }));
        builder.onLoad(
          { filter: /node_modules\/react-native\/.*\.js$/ },
          async ({ path: filename }) => {
            const transformed = await transformAsync(
              await readFile(filename, "utf8"),
              {
                filename,
                configFile: false,
                babelrc: false,
                presets: [
                  [
                    "@react-native/babel-preset",
                    { disableImportExportTransform: true },
                  ],
                ],
              },
            );
            return { contents: transformed.code, loader: "js" };
          },
        );
      },
    },
  ],
});
assertNativeWindBundle(Object.keys(result.metafile.inputs));
// Hermes' source evaluator needs the RN syntax transforms on bundler-generated
// helpers too (especially block-scoped closure captures in export getters).
const bundlePath = path.join(root, "build/app.js");
const hermesBundle = await transformAsync(await readFile(bundlePath, "utf8"), {
  filename: bundlePath,
  configFile: false,
  babelrc: false,
  presets: [
    [
      "@react-native/babel-preset",
      { disableImportExportTransform: true, enableBabelRuntime: false },
    ],
  ],
});
await writeFile(bundlePath, hermesBundle.code + "\n");
await writeFile(
  path.join(root, "build/bundle-inputs.json"),
  JSON.stringify(Object.keys(result.metafile.inputs), null, 2) + "\n",
);
console.log(
  "Bundled upstream ReactFabric-prod, React 19.2.3 and Godot platform components.",
);
