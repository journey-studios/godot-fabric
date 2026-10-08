import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { transform } from "esbuild";
import { compileNativeWindStyles, inlineRem, nativewindTailwindConfig, registrationModule } from "./nativewind-compile.mjs";

// NativeWind and Tailwind for projects, with nothing of the project executed.
// A project CSS import that holds Tailwind directives is compiled here, by the
// SDK's own Tailwind, NativeWind preset and react-native-css-interop compiler,
// into a module that registers the compiled styles with the one interop runtime
// of the bundle. The Tailwind configuration is data in package.json
// (godotFabric.tailwind), never a tailwind.config.* the SDK would have to run.
const requireToolchain = createRequire(import.meta.url);
// NativeWind picks its native pipeline for any NATIVEWIND_OS but "web".
const nativewindOs = "godot";
const configFiles = ["js", "cjs", "mjs", "ts", "cts", "mts"].map(extension => "tailwind.config." + extension);
const runtime = "godot-fabric-nativewind-runtime";
const tailwindDirective = /@tailwind\s+(?:base|components|utilities)\b/;
const declarationKeys = ["content", "darkMode", "theme"];

function fail(code, message) { throw new Error(`${code}: ${message}`); }
function inside(root, filename) {
  const relative = path.relative(root, filename);
  return relative !== "" && !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep);
}
function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const version = filename => JSON.parse(fs.readFileSync(filename, "utf8")).version;

// godotFabric.tailwind is JSON with a closed set of fields. Content globs stay
// inside the project; plugins, presets and functions have no place in JSON.
export function parseTailwindDeclaration(project, value) {
  if (value === undefined) {
    return undefined;
  }
  if (!plainObject(value) || Object.keys(value).some(key => !declarationKeys.includes(key))) {
    fail("E_PROJECT_TAILWIND", "godotFabric.tailwind accepts only content, darkMode and theme");
  }
  if (!Array.isArray(value.content) || !value.content.length
      || value.content.some(glob => typeof glob !== "string" || !glob || path.isAbsolute(glob)
        || glob.split(/[\\/]/).includes(".."))) {
    fail("E_PROJECT_TAILWIND", "godotFabric.tailwind.content must list project-relative globs without ..");
  }
  if (value.darkMode !== undefined && value.darkMode !== "media") {
    fail("E_PROJECT_TAILWIND", 'godotFabric.tailwind.darkMode supports only "media": NativeWind follows Appearance.setColorScheme');
  }
  if (value.theme !== undefined && !plainObject(value.theme)) {
    fail("E_PROJECT_TAILWIND", "godotFabric.tailwind.theme must be a JSON object");
  }
  return {content: value.content, darkMode: value.darkMode ?? "media", theme: value.theme,
    absoluteContent: value.content.map(glob => path.resolve(project, glob))};
}

// A tailwind.config.* file is JavaScript the SDK would have to run, which it never does.
export function assertNoTailwindConfigFile(project) {
  for (const name of configFiles) {
    if (fs.existsSync(path.join(project, name))) {
      fail("E_PROJECT_TAILWIND_CONFIG", `${name} is project JavaScript that this builder never runs; declare the Tailwind configuration as JSON in package.json under godotFabric.tailwind`);
    }
  }
}

export function createTailwindStep({project, dependencies}) {
  project = fs.realpathSync(project);
  const declaration = parseTailwindDeclaration(project, dependencies.godotFabric?.tailwind);
  // The SDK's own releases, read when a build first needs them: a project that uses none of this never touches them.
  let releases;
  const toolchain = () => releases ??= {
    tailwind: version(requireToolchain.resolve("tailwindcss/package.json")),
    nativewind: version(requireToolchain.resolve("nativewind/package.json")),
    cssInterop: version(requireToolchain.resolve("react-native-css-interop/package.json")),
  };
  let entry = null;

  function nativewindRoot() {
    if (!Object.hasOwn(dependencies.dependencies ?? {}, "nativewind")) {
      fail("E_PROJECT_TAILWIND", "a Tailwind CSS import needs nativewind in the project's dependencies, installed explicitly");
    }
    const root = path.join(project, "node_modules", "nativewind");
    if (!fs.existsSync(path.join(root, "package.json"))) {
      fail("E_PROJECT_DEPENDENCY", "Missing project dependency nativewind; install it explicitly with the project's package manager");
    }
    const physical = fs.realpathSync(root);
    if (!inside(project, physical)) {
      fail("E_PROJECT_PATH", "nativewind: dependency resolves outside the project");
    }
    return physical;
  }
  // The styles are compiled by the SDK's packages and read by the project's
  // runtime; the two must be the same release or the compiled format may differ.
  function assertRuntimeVersions(root) {
    const installed = {nativewind: version(path.join(root, "package.json")),
      cssInterop: version(createRequire(path.join(root, "package.json")).resolve("react-native-css-interop/package.json"))};
    for (const name of ["nativewind", "cssInterop"]) {
      if (installed[name] !== toolchain()[name]) {
        fail("E_PROJECT_NATIVEWIND_VERSION", `${name === "cssInterop" ? "react-native-css-interop" : name} ${installed[name]} is installed but the SDK compiles styles with ${toolchain()[name]}; install exactly ${toolchain()[name]}`);
      }
    }
  }

  const plugin = {
    name: "godot-fabric-nativewind",
    setup(builder) {
      // Only the generated registration module may name the interop runtime;
      // it resolves exactly as NativeWind's own import of it does.
      builder.onResolve({filter: /^godot-fabric-nativewind-runtime$/}, async args => {
        if (!entry || args.importer !== entry.file) {
          fail("E_PROJECT_PATH", `${runtime} belongs to the SDK's generated Tailwind module`);
        }
        const root = nativewindRoot();
        const resolved = await builder.resolve("react-native-css-interop", {
          importer: path.join(root, "dist", "index.js"), resolveDir: path.join(root, "dist"), kind: "require-call",
        });
        if (resolved.errors.length) {
          return resolved;
        }
        return {path: resolved.path, namespace: resolved.namespace, sideEffects: resolved.sideEffects};
      });
      builder.onLoad({filter: /\.css$/}, async args => {
        const file = fs.realpathSync(args.path);
        const relative = path.relative(project, file).split(path.sep).join("/");
        if (!inside(project, file) || relative.split("/").includes("node_modules")) {
          fail("E_PROJECT_CSS", `${relative}: CSS from installed packages is not supported; only the project's Tailwind CSS entry is compiled`);
        }
        const css = fs.readFileSync(file, "utf8");
        if (!tailwindDirective.test(css) || /@import\b/.test(css)) {
          fail("E_PROJECT_CSS", `${relative}: only a Tailwind entry (@tailwind base, components and utilities, without @import) is compiled; other CSS and assets are not supported`);
        }
        if (entry) {
          fail("E_PROJECT_CSS", `${relative}: one Tailwind CSS entry per project (${entry.relative} is already compiled)`);
        }
        if (!declaration) {
          fail("E_PROJECT_TAILWIND", `${relative}: declare the Tailwind configuration in package.json under godotFabric.tailwind`);
        }
        assertRuntimeVersions(nativewindRoot());
        const {compiled} = await compileNativeWindStyles({
          css, from: file, os: nativewindOs,
          config: nativewindTailwindConfig({content: declaration.absoluteContent, darkMode: declaration.darkMode, theme: declaration.theme}),
        });
        entry = {file, relative, ruleCount: Object.keys(compiled.rules ?? {}).length,
          compiledSha256: crypto.createHash("sha256").update(JSON.stringify(compiled)).digest("hex")};
        return {contents: registrationModule(compiled, runtime), loader: "js", resolveDir: path.dirname(file)};
      });
      // react-native-css-interop ships this one file with JSX in a .js file, for
      // Metro's Babel pipeline. It is compiled here with esbuild's JSX loader and
      // the package's own jsx-runtime; JSX in other .js files is still refused.
      builder.onLoad({filter: /react-native-css-interop[\\/]dist[\\/]doctor\.native\.js$/}, async args => {
        const file = fs.realpathSync(args.path);
        const packageFile = path.join(path.dirname(path.dirname(file)), "package.json");
        const manifest = JSON.parse(fs.readFileSync(packageFile, "utf8"));
        if (manifest.name !== "react-native-css-interop" || manifest.version !== toolchain().cssInterop) {
          fail("E_PROJECT_NATIVEWIND_VERSION", `react-native-css-interop ${manifest.version} is installed but the SDK compiles styles with ${toolchain().cssInterop}; install exactly ${toolchain().cssInterop}`);
        }
        const {code} = await transform(fs.readFileSync(file, "utf8"), {
          loader: "jsx", jsx: "transform", jsxFactory: "__godotFabricJsx", sourcefile: file,
        });
        const factory = 'const { jsx: __godotFabricJsx } = require("react-native-css-interop/jsx-runtime");\n';
        return {contents: code.replace(/^"use strict";\n/, match => match + factory), loader: "js", resolveDir: path.dirname(file)};
      });
    },
  };
  return {
    plugin,
    // What the build report says about the style step; null when no CSS was compiled.
    report() {
      return entry && {entry: entry.relative, content: declaration.content, darkMode: declaration.darkMode,
        rules: entry.ruleCount, compiledSha256: entry.compiledSha256, nativewindOs, inlineRem,
        tailwind: toolchain().tailwind, nativewind: toolchain().nativewind, reactNativeCssInterop: toolchain().cssInterop};
    },
  };
}
