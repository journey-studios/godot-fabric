import ts from "typescript";

// These are the public TsconfigRaw fields in the pinned esbuild 0.25.12 API.
// Checker-only options stay in the original TypeScript compiler profiles.
const transformFields = ["alwaysStrict", "experimentalDecorators", "importsNotUsedAsValues",
  "jsxFactory", "jsxFragmentFactory", "jsxImportSource", "preserveValueImports", "strict",
  "useDefineForClassFields", "verbatimModuleSyntax"];
const jsxNames = new Map([
  [ts.JsxEmit.Preserve, "preserve"], [ts.JsxEmit.React, "react"],
  [ts.JsxEmit.ReactNative, "react-native"], [ts.JsxEmit.ReactJSX, "react-jsx"],
  [ts.JsxEmit.ReactJSXDev, "react-jsxdev"],
]);
const targetNames = new Map(["ES3", "ES5", "ES2015", "ES2016", "ES2017", "ES2018", "ES2019",
  "ES2020", "ES2021", "ES2022", "ES2023", "ES2024", "ES2025", "ESNext"]
  .filter(name => typeof ts.ScriptTarget[name] === "number")
  .map(name => [ts.ScriptTarget[name], name.toLowerCase()]));

export function projectCompilerProfiles(options, sdkTypeMaps) {
  if (options.moduleResolution !== ts.ModuleResolutionKind.Bundler
      || ![ts.ModuleKind.ESNext, ts.ModuleKind.Preserve].includes(options.module))
    throw new Error("E_PROJECT_MODULE_PROFILE: this prototype requires module ESNext or Preserve with moduleResolution Bundler");
  if (options.customConditions?.includes("types"))
    throw new Error("E_PROJECT_CONDITION_PROFILE: the types condition belongs to the checker and cannot select runtime modules");
  if (options.emitDecoratorMetadata)
    throw new Error("E_PROJECT_CONFIG: emitDecoratorMetadata is not implemented by this esbuild/Babel pipeline");
  const compilerOptions = Object.fromEntries(transformFields.filter(name => options[name] !== undefined)
    .map(name => [name, options[name]]));
  for (const [name, values] of [["jsx", jsxNames], ["target", targetNames]]) {
    if (options[name] === undefined) continue;
    const value = values.get(options[name]);
    if (value === undefined) throw new Error(`E_PROJECT_CONFIG: unsupported ${name} compiler option`);
    compilerOptions[name] = value;
  }
  const protectedPaths = Object.fromEntries([...sdkTypeMaps].map(([name, target]) => [name, [target]]));
  const appOptions = {...options, paths: {...options.paths, ...protectedPaths}};
  const packageOptions = {...options, paths: protectedPaths, baseUrl: undefined, pathsBasePath: undefined};
  return {appOptions, packageOptions, tsconfigRaw: {compilerOptions}, conditions: options.customConditions ?? []};
}
