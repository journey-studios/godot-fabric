import path from "node:path";
import fs from "node:fs";
import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import ts from "typescript";
import {isSdkOwnedSpecifier} from "./platform-plugin.mjs";
import {godotExtensions} from "./platform-resolution.mjs";
import {projectCompilerProfiles} from "./project-config.mjs";
import {checkNativeTypes} from "./native-typecheck.mjs";

const suffixes = [".godot", ".native", ""];
const facades = new Map([
  ["react-native-svg", "svg.jsx"],
  ["react-native-reanimated", "unsupported-reanimated.js"],
  ["react-native-safe-area-context", "unsupported-safe-area.js"],
]);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function fail(code, message) { throw new Error(`${code}: ${message}`); }
function inside(root, filename) {
  const relative = path.relative(root, filename);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(".." + path.sep));
}
// Also check aliases whose platform variant does not exist yet. Existing
// ancestors must already belong to the project, including symlink targets.
function physicalPath(filename) {
  let ancestor = filename;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error("No existing path ancestor");
    ancestor = parent;
  }
  return path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, filename));
}
function packageName(specifier) {
  return specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
}
function bare(specifier) {
  return !specifier.startsWith(".") && !path.isAbsolute(specifier);
}
function aliasMatches(pattern, specifier) {
  const star = pattern.indexOf("*");
  return star < 0 ? pattern === specifier
    : specifier.startsWith(pattern.slice(0, star)) && specifier.endsWith(pattern.slice(star + 1))
      && specifier.length >= pattern.length - 1;
}
function matchingAlias(paths, specifier) {
  if (Object.hasOwn(paths, specifier)) return specifier;
  return Object.keys(paths).filter(key => key.includes("*") && aliasMatches(key, specifier))
    .sort((a, b) => b.indexOf("*") - a.indexOf("*"))[0];
}
function overlapsSdk(pattern) {
  const star = pattern.indexOf("*"), prefix = star < 0 ? pattern : pattern.slice(0, star);
  return aliasMatches(pattern, "@godot-fabric/runtime") || ["react", "react-native"].some(name =>
    aliasMatches(pattern, name) || (star < 0 ? pattern.startsWith(name + "/")
      : prefix.startsWith(name + "/") || (name + "/").startsWith(prefix)));
}

// This is a bounded node_modules profile, not a general Metro/TSConfig resolver.
// TypeScript owns config inheritance; esbuild owns the actual runtime lookup.
export function prepareProjectResolution({project, sdk, dependencies, resolveSdk}) {
  project = fs.realpathSync(project);
  sdk = fs.realpathSync(sdk);
  if (!inside(project, sdk)) fail("E_PROJECT_PATH", "The provisioned SDK must remain inside the project");
  if (typeof resolveSdk !== "function") fail("E_PROJECT_CONFIG", "An SDK resolver is required");
  const snapshots = new Map();
  function snapshot(filename, contents = fs.readFileSync(filename), mode = "bytes") {
    const physical = fs.realpathSync(filename);
    const key = mode + ":" + filename;
    const previous = snapshots.get(key);
    const current = {filename, mode, physical, sha256: hash(contents)};
    if (previous && (previous.physical !== physical || previous.sha256 !== current.sha256))
      fail("E_PROJECT_CONFIG_CHANGED", "Project resolution inputs changed during preflight");
    snapshots.set(key, current);
  }
  const configPath = path.join(project, "tsconfig.json"), configErrors = [];
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...ts.sys,
    readFile(filename) {
      const text = ts.sys.readFile(filename);
      // Fingerprint the exact decoded input returned to TypeScript, rather than
      // reading again after a save could have replaced the config's contents.
      if (text !== undefined) snapshot(filename, text, "typescript-text");
      return text;
    },
    onUnRecoverableConfigFileDiagnostic: error => configErrors.push(error),
  });
  configErrors.push(...(parsed?.errors ?? []));
  if (!parsed || configErrors.length) fail("E_PROJECT_CONFIG", ts.formatDiagnostics(configErrors, {
    getCanonicalFileName: filename => filename, getCurrentDirectory: () => project, getNewLine: () => "\n",
  }).trim() || "Unable to read tsconfig.json");
  if (JSON.stringify(parsed.options.moduleSuffixes) !== JSON.stringify(suffixes))
    fail("E_PROJECT_SUFFIXES", 'This Godot prototype requires effective moduleSuffixes [".godot", ".native", ""]');
  const packageFile = path.join(project, "package.json");
  if (fs.existsSync(packageFile)) {
    const bytes = fs.readFileSync(packageFile);
    snapshot(packageFile, bytes);
    if (!isDeepStrictEqual(dependencies, JSON.parse(bytes.toString("utf8"))))
      fail("E_PROJECT_CONFIG_CHANGED", "Project dependency declarations changed before resolution preflight");
  } else if (!isDeepStrictEqual(dependencies, {})) {
    fail("E_PROJECT_CONFIG_CHANGED", "Project package.json disappeared before resolution preflight");
  }
  const paths = parsed.options.paths ?? {};
  const pathsBase = parsed.options.baseUrl ?? parsed.options.pathsBasePath ?? path.dirname(configPath);
  const typeMaps = new Map([
    ["@godot-fabric/runtime", path.join(sdk, "types/godot-fabric.ts")],
    ["react", path.join(sdk, "toolchain/node_modules/@types/react")],
    ["react/*", path.join(sdk, "toolchain/node_modules/@types/react/*")],
    ["react-native", path.join(sdk, "types/react-native.ts")],
    ["react-native/*", path.join(sdk, "toolchain/node_modules/react-native/types_generated/*")],
  ]);
  for (const [key, targets] of Object.entries(paths)) {
    if (typeMaps.has(key)) {
      const target = targets.length === 1 ? physicalPath(path.resolve(pathsBase, targets[0])) : null;
      if (!target || !inside(sdk, target) || target !== physicalPath(typeMaps.get(key)))
        fail("E_PROJECT_SDK_IDENTITY", `${key}: type mapping must reference the provisioned SDK type surface`);
      continue;
    }
    // A broad wildcard must not provide an alternative React/RN/runtime type
    // identity, even though named runtime imports are pinned separately.
    if (overlapsSdk(key))
      fail("E_PROJECT_SDK_IDENTITY", `${key}: alias overlaps the SDK-owned module surface`);
    for (const target of targets) {
      const physical = physicalPath(path.resolve(pathsBase, target));
      if (!inside(project, physical) || inside(sdk, physical) || /\.d\.[cm]?ts$/.test(target)
          || physical.split(path.sep).includes("node_modules"))
        fail("E_PROJECT_ALIAS", `${key}: aliases may address only project source files`);
    }
  }
  const profiles = projectCompilerProfiles(parsed.options, typeMaps);
  const configFingerprint = hash(JSON.stringify([...snapshots.values()]
    .sort((a, b) => (a.filename + a.mode).localeCompare(b.filename + b.mode))
    .map(({filename, mode, physical, sha256}) => [path.relative(project, filename), mode,
      path.relative(project, physical), sha256])));

  const manifestCache = new Map(), packageRoots = new Map();
  function manifestAt(root) {
    const filename = path.join(root, "package.json");
    if (!manifestCache.has(filename)) {
      let value;
      try { const bytes = fs.readFileSync(filename); snapshot(filename, bytes); value = JSON.parse(bytes.toString("utf8")); }
      catch (error) {
        if (error.message.startsWith("E_PROJECT_")) throw error;
        fail("E_PROJECT_PATH", "Cannot read installed dependency package.json");
      }
      manifestCache.set(filename, value);
    }
    return manifestCache.get(filename);
  }
  function installedOwner(filename) {
    let directory = path.dirname(filename);
    while (inside(project, directory) && directory !== project) {
      if (packageRoots.has(directory)) return packageRoots.get(directory);
      const parent = path.dirname(directory);
      const isPackage = path.basename(parent) === "node_modules"
        || (path.basename(parent).startsWith("@") && path.basename(path.dirname(parent)) === "node_modules");
      if (isPackage && fs.existsSync(path.join(directory, "package.json"))) {
        const owner = {root: fs.realpathSync(directory), name: path.basename(parent).startsWith("@")
          ? path.basename(parent) + "/" + path.basename(directory) : path.basename(directory), manifest: manifestAt(directory)};
        packageRoots.set(owner.root, owner);
        return owner;
      }
      directory = parent;
    }
    return null;
  }
  function requireDirect(name) {
    if (!Object.hasOwn(dependencies.dependencies ?? {}, name))
      fail("E_PROJECT_DEPENDENCY", `Declare ${name} in the project's dependencies and install it explicitly; Play does not install packages`);
    const root = path.join(project, "node_modules", name);
    if (!fs.existsSync(path.join(root, "package.json")))
      fail("E_PROJECT_DEPENDENCY", `Missing project dependency ${name}; install it explicitly with the project's package manager`);
    const physical = fs.realpathSync(root);
    if (!inside(project, physical)) fail("E_PROJECT_PATH", `${name}: dependency resolves outside the project`);
    packageRoots.set(physical, {root: physical, name, manifest: manifestAt(root)});
  }
  for (const name of Object.keys(dependencies.dependencies ?? {}))
    if (!isSdkOwnedSpecifier(name)) requireDirect(name);
  function requireOwned(name, owner) {
    if (!owner) return requireDirect(name);
    // peerDependenciesMeta may name an optional peer that peerDependencies does not list; such a peer is declared.
    const declared = [owner.manifest.dependencies, owner.manifest.optionalDependencies, owner.manifest.peerDependencies]
      .some(map => Object.hasOwn(map ?? {}, name))
      || owner.manifest.peerDependenciesMeta?.[name]?.optional === true;
    if (!declared && owner.manifest.name !== name)
      fail("E_PROJECT_DEPENDENCY", `${name}: undeclared import in ${owner.manifest.name ?? "installed package"} dependencies`);
  }
  const canonicalName = filename => ts.sys.useCaseSensitiveFileNames ? filename : filename.toLowerCase();
  const appTypeCache = ts.createModuleResolutionCache(project, canonicalName, profiles.appOptions);
  const packageTypeCache = ts.createModuleResolutionCache(project, canonicalName, profiles.packageOptions);
  function privateImporter(filename) {
    const physical = fs.existsSync(filename) ? fs.realpathSync(filename) : filename;
    return inside(sdk, physical) || installedOwner(physical) !== null;
  }
  function checkTypes() {
    const compilerOptions = {...profiles.appOptions, noEmit: true};
    const result = checkNativeTypes({rootFiles: parsed.fileNames, compilerOptions,
      projectReferences: parsed.projectReferences, cwd: project,
      resolveModuleName(moduleName, containingFile, resolutionMode) {
        const privateOwner = privateImporter(containingFile);
        const lookupOptions = privateOwner ? profiles.packageOptions : profiles.appOptions;
        const cache = privateOwner ? packageTypeCache : appTypeCache;
        const resolved = ts.resolveModuleName(moduleName, containingFile, lookupOptions,
          ts.sys, cache, undefined, resolutionMode).resolvedModule;
        return resolved ? {resolvedModule: resolved} : undefined;
      }});
    assertUnchanged();
    return result;
  }

  const skip = Symbol("project-resolution-recursion");
  const plugin = {
    name: "project-owned-resolution",
    setup(builder) {
      builder.onLoad({filter: /\.d\.[cm]?ts$/}, () => {
        fail("E_PROJECT_PATH", "Declaration-only files cannot execute in the runtime bundle");
      });
      builder.onResolve({filter: /.*/}, async args => {
        if (args.pluginData === skip || (args.namespace && args.namespace !== "file")) return;
        const importer = args.importer ? fs.realpathSync(args.importer) : null;
        const sdkOwned = isSdkOwnedSpecifier(args.path);
        // SDK internals keep their provisioned dependency graph and original
        // platform/Codegen hooks. Named React/RN imports have one SDK identity.
        if (importer && inside(sdk, importer)) return;
        const importerOwner = importer ? installedOwner(importer) : null;
        const alias = !importerOwner && bare(args.path) && !sdkOwned ? matchingAlias(paths, args.path) : undefined;
        const privateImport = args.path.startsWith("#") && !alias;
        if (privateImport && !matchingAlias((importerOwner ? importerOwner.manifest.imports : dependencies.imports) ?? {}, args.path))
          fail("E_PROJECT_DEPENDENCY", `${args.path}: private import must be declared in the importing package's imports map`);
        if (bare(args.path) && !alias && !sdkOwned && !privateImport) requireOwned(packageName(args.path), importerOwner);
        let specifier = args.path;
        if (alias) {
          const mode = args.kind === "require-call" || args.kind === "require-resolve"
            ? ts.ModuleKind.CommonJS : ts.ModuleKind.ESNext;
          const typed = ts.resolveModuleName(args.path, args.importer, profiles.appOptions,
            ts.sys, appTypeCache, undefined, mode).resolvedModule;
          if (!typed || /\.d\.[cm]?ts$/.test(typed.resolvedFileName))
            fail("E_PROJECT_ALIAS", `${alias}: runtime alias must resolve to a project source, not declarations only`);
          specifier = typed.resolvedFileName;
        }
        const resolved = await builder.resolve(specifier, {
          importer: args.importer, resolveDir: args.resolveDir, namespace: args.namespace,
          kind: args.kind, with: args.with, pluginData: skip,
        });
        // The recursion token belongs only to this nested resolution. Returning
        // it would exempt descendant imports from project ownership checks.
        if (resolved.pluginData === skip) delete resolved.pluginData;
        if (resolved.errors.length || !resolved.path) return resolved;
        if (resolved.external || (resolved.namespace && resolved.namespace !== "file"))
          fail("E_PROJECT_PATH", "External or virtual project modules are not supported by this prototype");
        const physical = fs.realpathSync(resolved.path);
        if (/\.d\.[cm]?ts$/.test(physical))
          fail(alias ? "E_PROJECT_ALIAS" : "E_PROJECT_PATH", "Declaration-only files cannot execute in the runtime bundle");
        if (sdkOwned) {
          if (!inside(sdk, physical)) fail("E_PROJECT_SDK_IDENTITY", "SDK-owned modules must resolve inside the provisioned SDK");
          return resolved;
        }
        // Inspect the requested physical spelling too: realpath may turn a
        // node_modules/react symlink into an ordinary-looking project file.
        const requestedOwner = !bare(args.path) ? installedOwner(path.resolve(args.resolveDir, args.path)) : null;
        const owner = installedOwner(physical) ?? requestedOwner;
        if (owner && (["react", "react-native"].includes(owner.name) || ["react", "react-native"].includes(owner.manifest.name))
            && !inside(sdk, physical))
          fail("E_PROJECT_SDK_IDENTITY", "Physical React/RN imports must use the provisioned SDK");
        if (!inside(project, physical)) fail(alias ? "E_PROJECT_ALIAS" : "E_PROJECT_PATH", "Resolved source escapes the project");
        const facade = facades.get(args.path);
        const allowedFacade = facade && physical === path.join(sdk, "src", facade);
        if (inside(sdk, physical) && !allowedFacade)
          fail(alias ? "E_PROJECT_ALIAS" : "E_PROJECT_SDK_IDENTITY", "Project imports cannot address SDK implementations or internals");
        if (alias && (owner || /\.d\.[cm]?ts$/.test(physical)))
          fail("E_PROJECT_ALIAS", "A runtime alias must resolve to a local project source file");
        if ((!bare(args.path) || privateImport) && owner && owner.root !== importerOwner?.root)
          requireOwned(owner.name, importerOwner);
        if (privateImport && importerOwner && !owner && !inside(importerOwner.root, physical))
          fail("E_PROJECT_PATH", "A private package import resolves outside its package or declared dependencies");
        return resolved;
      });
    },
  };
  function assertUnchanged() {
    for (const expected of snapshots.values()) {
      const {filename, mode} = expected;
      let current;
      try { current = {physical: fs.realpathSync(filename),
        sha256: hash(mode === "typescript-text" ? ts.sys.readFile(filename) : fs.readFileSync(filename))}; }
      catch { fail("E_PROJECT_CONFIG_CHANGED", "A project resolution input disappeared after preflight"); }
      if (current.physical !== expected.physical || current.sha256 !== expected.sha256)
        fail("E_PROJECT_CONFIG_CHANGED", "Project configuration or dependency declarations changed after preflight");
    }
  }
  return {plugin, resolveExtensions: [...godotExtensions], assertUnchanged,
    tsconfigRaw: profiles.tsconfigRaw, conditions: profiles.conditions, checkTypes, configFingerprint};
}
