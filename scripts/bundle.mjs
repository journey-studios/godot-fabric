import { build } from "esbuild";
import { transformAsync } from "@babel/core";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";
import { platformPlugin } from "../sdk/toolchain/platform-plugin.mjs";
import { godotExtensions } from "./platform-resolution.mjs";
import {
  compileNativeWind,
  assertNativeWindBundle,
} from "./nativewind-compile.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const requireSdk = createRequire(import.meta.url);
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
  resolveExtensions: godotExtensions,
  metafile: true,
  plugins: [
    {
      name: "laboratory-nativewind",
      setup(builder) {
        builder.onLoad({ filter: /(?:examples\/(?:nativewind|typography)\/App\.jsx|react-native-css-interop\/dist\/doctor\.native\.js)$/ },
          async ({ path: filename }) => ({
            contents: (await transformAsync(await readFile(filename, "utf8"), {
              filename, configFile: false, babelrc: false, presets: ["nativewind/babel"],
            })).code,
            loader: "js",
          }));
      },
    },
    platformPlugin(path.join(root, "src"), (id) => requireSdk.resolve(id)),
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
