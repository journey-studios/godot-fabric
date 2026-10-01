import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cssToReactNativeRuntime } from "react-native-css-interop/css-to-rn/index.js";

export function assertNativeWindBundle(inputs) {
  for (const required of [
    "node_modules/nativewind/dist/index.js",
    "node_modules/react-native-css-interop/dist/runtime/jsx-runtime.js",
    "node_modules/react-native-css-interop/dist/runtime/api.native.js",
    "node_modules/react-native-css-interop/dist/runtime/native/native-interop.js",
  ]) {
    if (!inputs.includes(required))
      throw new Error(`NativeWind native bundle is missing ${required}`);
  }
  if (
    inputs.some((input) =>
      input.includes("react-native-css-interop/dist/runtime/web/"),
    )
  )
    throw new Error(
      "NativeWind Godot bundle must not use the web interop runtime",
    );
}

export async function compileNativeWind() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  await mkdir(path.join(root, "build"), { recursive: true });
  const cli = spawnSync(
    process.execPath,
    [
      "node_modules/tailwindcss/lib/cli.js",
      "--config",
      "tailwind.config.cjs",
      "--input",
      "src/nativewind.css",
      "--output",
      "build/nativewind.css",
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (cli.error || cli.status !== 0) throw new Error(cli.error ?? cli.stderr);
  const compiled = cssToReactNativeRuntime(
    await readFile(path.join(root, "build/nativewind.css"), "utf8"),
    { inlineRem: 14 },
  );
  await writeFile(
    path.join(root, "build/nativewind-compiled.json"),
    JSON.stringify(compiled, null, 2) + "\n",
  );
  await writeFile(
    path.join(root, "build/nativewind-compiled.js"),
    `import { StyleSheet } from "react-native-css-interop";\nStyleSheet.registerCompiled(${JSON.stringify(compiled)});\n`,
  );
  return compiled;
}
