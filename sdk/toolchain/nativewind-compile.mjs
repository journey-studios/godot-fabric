import { createRequire } from "node:module";

// One implementation of "Tailwind CSS to NativeWind runtime styles", shared by
// the SDK builder and the laboratory bundler. Only SDK-owned packages run here:
// tailwindcss, nativewind's preset and react-native-css-interop's compiler.
const requireToolchain = createRequire(import.meta.url);

// NativeWind's documented default for the native rem; the compiled styles inline it.
export const inlineRem = 14;

// NativeWind reads NATIVEWIND_OS once, when its preset modules first load (while
// Tailwind resolves the config), to pick the web or the native pipeline. A
// process therefore keeps the first choice and refuses a different one.
let pipeline;
function selectPipeline(os) {
  if (pipeline !== undefined && pipeline.os !== os) {
    throw new Error("NativeWind preset was already loaded for NATIVEWIND_OS=" + (pipeline.os ?? "unset") + " in this process");
  }
  pipeline = { os };
}

// The Tailwind configuration of NativeWind. `content` must already be
// absolute: Tailwind otherwise resolves it against the working directory.
export function nativewindTailwindConfig({ content, darkMode, theme }) {
  return { content, ...(darkMode === undefined ? {} : { darkMode }), ...(theme === undefined ? {} : { theme }),
    presets: [requireToolchain("nativewind/preset")], corePlugins: { preflight: false } };
}

function setPipelineOs(os) {
  if (os === undefined) {
    delete process.env.NATIVEWIND_OS;
  } else {
    process.env.NATIVEWIND_OS = os;
  }
}

// Tailwind's own CLI pipeline (Tailwind, then Autoprefixer), run in process.
async function compileTailwindCss({ css, from, config, os }) {
  selectPipeline(os);
  const tailwindRequire = createRequire(requireToolchain.resolve("tailwindcss/package.json"));
  const postcss = tailwindRequire("postcss");
  const tailwind = tailwindRequire("tailwindcss");
  const autoprefixer = tailwindRequire("./peers/index.js").lazyAutoprefixer();
  const previous = process.env.NATIVEWIND_OS;
  setPipelineOs(os);
  try {
    return (await postcss([tailwind(config), autoprefixer]).process(css, { from })).css;
  } finally {
    setPipelineOs(previous);
  }
}

// react-native-css-interop's compiler is loaded on demand: it brings a native
// CSS parser that builds without Tailwind never need.
export async function compileNativeWindStyles({ css, from, config, os }) {
  const { cssToReactNativeRuntime } = await import("react-native-css-interop/css-to-rn/index.js");
  const tailwindCss = await compileTailwindCss({ css, from, config, os });
  return { tailwindCss, compiled: cssToReactNativeRuntime(tailwindCss, { inlineRem }) };
}

// The module that hands the compiled styles to the one interop runtime the
// bundle contains. `runtime` is the import specifier of that runtime.
export function registrationModule(compiled, runtime) {
  return `import { StyleSheet } from ${JSON.stringify(runtime)};\nStyleSheet.registerCompiled(${JSON.stringify(compiled)});\n`;
}
