import {API, formatDiagnostics} from "tsc-rs/unstable/sync";
import {resolveNativeCompiler} from "./native-compiler.mjs";

const compilerOptionKeys = new Set([
  "allowJs", "allowNonTsExtensions", "allowSyntheticDefaultImports", "allowUmdGlobalAccess",
  "allowUnreachableCode", "allowUnusedLabels",
  "alwaysStrict", "assumeChangesOnlyAffectDirectDependencies", "baseUrl", "checkJs",
  "composite", "customConditions", "declaration", "declarationDir", "declarationMap",
  "deduplicatePackages", "disableReferencedProjectLoad", "disableSizeLimit",
  "disableSolutionSearching", "disableSourceOfProjectReferenceRedirect", "downlevelIteration",
  "emitBOM", "emitDeclarationOnly", "emitDecoratorMetadata", "erasableSyntaxOnly",
  "esModuleInterop", "exactOptionalPropertyTypes", "experimentalDecorators", "forceConsistentCasingInFileNames",
  "importHelpers", "importsNotUsedAsValues", "inlineSourceMap", "inlineSources", "isolatedDeclarations",
  "ignoreConfig", "ignoreDeprecations", "incremental", "init", "isolatedModules", "jsx",
  "jsxFactory", "jsxFragmentFactory", "jsxImportSource", "lib", "libReplacement", "locale", "mapRoot",
  "maxNodeModuleJsDepth", "module", "moduleResolution", "moduleSuffixes", "newLine", "noEmit", "noEmitHelpers",
  "noEmitOnError", "noErrorTruncation", "noFallthroughCasesInSwitch", "noImplicitAny", "noImplicitOverride",
  "noImplicitReturns", "noImplicitThis", "noLib", "noPropertyAccessFromIndexSignature", "noResolve",
  "noUncheckedIndexedAccess", "noUncheckedSideEffectImports", "noUnusedLocals", "noUnusedParameters",
  "outDir", "paths", "plugins", "preserveConstEnums",
  "preserveValueImports", "pretty", "removeComments", "resolveJsonModule", "rootDir", "rootDirs",
  "preserveSymlinks", "project", "reactNamespace", "rewriteRelativeImportExtensions",
  "skipDefaultLibCheck", "skipLibCheck", "sourceMap", "sourceRoot", "stableTypeOrdering", "strict", "strictBindCallApply",
  "strictBuiltinIteratorReturn", "strictFunctionTypes", "strictNullChecks", "strictPropertyInitialization",
  "stripInternal", "suppressExcessPropertyErrors", "suppressImplicitAnyIndexErrors",
  "suppressOutputPathCheck", "target",
  "traceResolution", "tsBuildInfoFile", "typeRoots", "types", "useDefineForClassFields",
  "useUnknownInCatchVariables", "verbatimModuleSyntax", "watch", "resolvePackageJsonExports", "resolvePackageJsonImports",
  "allowImportingTsExtensions", "allowArbitraryExtensions", "moduleDetection", "noCheck",
  "pathsBasePath", "configFilePath",
]);

function actionableCompilerError(error) {
  const detail = error instanceof Error ? error.message : String(error);
  if (/Unable to resolve @tsc-rs\/|Executable not found|spawn .*ENOENT/i.test(detail))
    return new Error(`E_NATIVE_TYPECHECK: tsc-rs@0.1.0 native compiler is unavailable (${detail}). Install the pinned tsc-rs package with its platform binary for ${process.platform}-${process.arch}.`);
  if (/unsupported|unknown compiler option|invalid compiler option/i.test(detail))
    return new Error(`E_NATIVE_TYPECHECK: tsc-rs@0.1.0 cannot use this project's effective compiler options (${detail}).`);
  return error;
}

function adaptDiagnostic(diagnostic) {
  return {...diagnostic, messageText: diagnostic.messageChain?.length
    ? {messageText: diagnostic.text, category: diagnostic.category, code: diagnostic.code,
      next: diagnostic.messageChain.map(adaptDiagnostic)}
    : diagnostic.text, start: diagnostic.pos, end: diagnostic.end};
}

export function checkNativeTypes({rootFiles, compilerOptions, projectReferences, resolveModuleName, cwd}) {
  const unsupported = Object.keys(compilerOptions).filter(key => compilerOptions[key] !== undefined
    && !compilerOptionKeys.has(key));
  if (unsupported.length) throw new Error(`E_NATIVE_TYPECHECK: tsc-rs@0.1.0 does not support effective compiler option(s): ${unsupported.join(", ")}`);
  let api, resolver, program;
  try {
    const compiler = resolveNativeCompiler();
    const nativeOptions = Object.fromEntries(Object.entries(compilerOptions)
      .filter(([key, value]) => value !== undefined && compilerOptionKeys.has(key)
        && key !== "pathsBasePath"));
    api = new API({cwd, tsserverPath: compiler.executable});
    resolver = api.createModuleResolver(nativeOptions, {
      resolveModuleName(moduleName, containingDirectory, resolutionMode) {
        const containingFile = `${containingDirectory.replace(/[\\/]$/, "")}/__resolution__.ts`;
        const result = resolveModuleName(moduleName, containingFile, resolutionMode);
        const resolved = result?.resolvedModule;
        // An empty static result is a deliberate unresolved result. Returning
        // undefined permits the native compiler's default resolver to retry
        // against global app paths, which would leak aliases into dependencies.
        if (!resolved) return {};
        return {resolvedFileName: resolved.resolvedFileName,
          originalPath: resolved.originalPath, packageId: resolved.packageId};
      },
    });
    program = api.createProgram(rootFiles, nativeOptions, {moduleResolver: resolver,
      projectReferences});
    const reported = [...program.getProgramDiagnostics(), ...program.getGlobalDiagnostics(),
      ...program.getSyntacticDiagnostics(), ...program.getBindDiagnostics(), ...program.getSemanticDiagnostics()];
    const seen = new Set();
    const diagnostics = reported.filter(diagnostic => {
      const key = JSON.stringify([diagnostic.fileName, diagnostic.pos, diagnostic.end,
        diagnostic.code, diagnostic.text, diagnostic.messageChain]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(adaptDiagnostic);
    return {diagnostics, errorCount: diagnostics.filter(diagnostic => diagnostic.category === 1).length,
      backend: "tsc-rs"};
  } catch (error) {
    throw actionableCompilerError(error);
  } finally {
    try { program?.dispose(); } catch {}
    try { resolver?.dispose(); } catch {}
    try { api?.close(); } catch {}
  }
}

export function formatNativeDiagnostics(diagnostics, host) {
  return formatDiagnostics(diagnostics, host);
}
