import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  compileNativeWindStyles,
  registrationModule,
} from "../sdk/toolchain/nativewind-compile.mjs";

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
  // The laboratory keeps its own tailwind.config.cjs and the preset's default
  // pipeline (no NATIVEWIND_OS); the compile step itself is the SDK's.
  const config = createRequire(import.meta.url)("../tailwind.config.cjs");
  const input = path.join(root, "src/nativewind.css");
  const { tailwindCss, compiled } = await compileNativeWindStyles({
    css: await readFile(input, "utf8"),
    from: input,
    config: { ...config, content: config.content.map((glob) => path.resolve(root, glob)) },
  });
  await writeFile(path.join(root, "build/nativewind.css"), tailwindCss);
  await writeFile(
    path.join(root, "build/nativewind-compiled.json"),
    JSON.stringify(compiled, null, 2) + "\n",
  );
  await writeFile(
    path.join(root, "build/nativewind-compiled.js"),
    registrationModule(compiled, "react-native-css-interop"),
  );
  return compiled;
}
