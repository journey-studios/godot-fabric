import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
import test from "node:test";
import {build} from "esbuild";
import metro from "metro-resolver";
import {prepareProjectResolution} from "../sdk/toolchain/project-resolution.mjs";

const original = createRequire(import.meta.url);

function fixture(t, conditions) {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "godot-package-conditions-")));
  t.after(() => fs.rmSync(project, {recursive: true, force: true}));
  const sdk = path.join(project, "addons/godot_fabric");
  const write = (name, contents) => {
    const filename = path.join(project, name);
    fs.mkdirSync(path.dirname(filename), {recursive: true});
    fs.writeFileSync(filename, typeof contents === "string" ? contents : JSON.stringify(contents));
    return filename;
  };
  const manifest = {name: "condition-consumer", private: true, dependencies: {conditional: "1.0.0"}};
  write("package.json", manifest);
  write("tsconfig.json", {compilerOptions: {module: "Preserve", moduleResolution: "Bundler",
    moduleSuffixes: [".godot", ".native", ""], customConditions: conditions, types: []}});
  write("addons/godot_fabric/toolchain/package.json", {private: true});
  const sdkRequire = createRequire(path.join(sdk, "toolchain/package.json"));
  return {project, sdk, manifest, write, conditions, resolveSdk: id => sdkRequire.resolve(id)};
}

function lookup(filename) {
  try {
    const stat = fs.statSync(filename);
    return {exists: true, type: stat.isFile() ? "f" : "d", realPath: fs.realpathSync(filename)};
  } catch { return {exists: false}; }
}
function getPackage(filename) {
  try { return JSON.parse(fs.readFileSync(filename, "utf8")); }
  catch { return null; }
}
function closestPackage(filename) {
  let directory = lookup(filename).type === "d" ? filename : path.dirname(filename);
  for (;;) {
    const packageJson = getPackage(path.join(directory, "package.json"));
    if (packageJson) return {rootPath: directory, packageJson, packageRelativePath: path.relative(directory, filename)};
    if (path.basename(directory) === "node_modules") return null;
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

// Original Metro with its public filesystem host. This profile uses main,
// hierarchical node_modules, platform godot, and only the conditions in each row.
// It does not certify other Metro settings or implicit React Native conditions.
function metroResult(f, origin, specifier, mode) {
  const warnings = [];
  const context = {
    allowHaste: false, assetExts: new Set(), customResolverOptions: {},
    disableHierarchicalLookup: false, doesFileExist: filename => lookup(filename).type === "f",
    extraNodeModules: null, dev: false, getPackage, getPackageForModule: closestPackage,
    isESMImport: mode === "import", fileSystemLookup: lookup,
    mainFields: ["main"], originModulePath: origin, nodeModulesPaths: [], preferNativePlatform: true,
    resolveAsset: () => null, redirectModulePath: filename => filename,
    resolveHasteModule: () => null, resolveHastePackage: () => null,
    sourceExts: ["ts", "tsx", "js", "jsx", "json"], unstable_conditionNames: f.conditions,
    unstable_conditionsByPlatform: {}, unstable_enablePackageExports: true,
    unstable_incrementalResolution: false,
    unstable_logWarning: message => warnings.push(message.replaceAll(f.project, "<fixture>")),
  };
  try { return {resolution: metro.resolve(context, specifier, "godot"), warnings}; }
  catch (error) { return {error, warnings}; }
}

async function sdkBundle(f) {
  const resolution = prepareProjectResolution({project: f.project, sdk: f.sdk,
    dependencies: f.manifest, resolveSdk: f.resolveSdk});
  const result = await build({absWorkingDir: f.project, entryPoints: ["ui/index.ts"], bundle: true,
    write: false, format: "iife", platform: "neutral", mainFields: ["main"], logLevel: "silent",
    tsconfigRaw: resolution.tsconfigRaw, conditions: resolution.conditions,
    resolveExtensions: resolution.resolveExtensions, plugins: [resolution.plugin], metafile: true});
  const context = {};
  vm.runInNewContext(result.outputFiles[0].text, context);
  resolution.assertUnchanged();
  return {context, inputs: Object.keys(result.metafile.inputs).map(filename => path.resolve(f.project, filename))};
}

function conditionalFixture(f, kind, mode, map) {
  const folder = "node_modules/conditional";
  const entry = "entry." + (mode === "import" ? "mjs" : "cjs");
  f.write(folder + "/package.json", {name: "conditional", main: "./" + entry,
    ...(kind === "exports" ? {exports: {".": map}} : {imports: {"#branch": map}})});
  for (const target of ["godot", "import", "require", "fallback"]) {
    // Exact exports/imports targets must beat these platform-suffixed siblings.
    for (const suffix of ["", ".godot", ".native"])
      f.write(folder + "/" + target + suffix + ".js", "module.exports = " + JSON.stringify(target + suffix) + ";");
  }
  const expression = mode === "import" ? "import value from 'conditional';" : "const value = require('conditional');";
  const origin = f.write("ui/index.ts", expression + " (globalThis as any).result = value;");
  if (kind === "exports") return {origin, specifier: "conditional", folder};
  const inner = mode === "import" ? "import value from '#branch'; export default value;"
    : "module.exports = require('#branch');";
  return {origin: f.write(folder + "/" + entry, inner), specifier: "#branch", folder};
}

test("the differential oracle uses the pinned original Metro and esbuild versions", () => {
  assert.equal(original("metro-resolver/package.json").version, "0.87.1");
  assert.equal(original("esbuild/package.json").version, "0.25.12");
});

for (const kind of ["exports", "imports"]) {
  for (const mode of ["import", "require"]) {
    for (const conditions of [[], ["godot"]]) {
      test("original Metro and SDK choose the same exact " + kind + " target: " + mode + "/" + JSON.stringify(conditions), async t => {
        const f = fixture(t, conditions);
        const map = {godot: "./godot.js", import: "./import.js", require: "./require.js", default: "./fallback.js"};
        const source = conditionalFixture(f, kind, mode, map);
        const expected = conditions.includes("godot") ? "godot" : mode;
        const oracle = metroResult(f, source.origin, source.specifier, mode);
        assert.equal(oracle.error, undefined);
        assert.deepEqual(oracle.warnings, []);
        assert.equal(oracle.resolution.type, "sourceFile");
        const selected = path.join(f.project, source.folder, expected + ".js");
        assert.equal(oracle.resolution.filePath, selected);
        const result = await sdkBundle(f);
        assert.equal(result.context.result, expected);
        assert.ok(result.inputs.includes(selected));
        assert.ok(!result.inputs.some(filename => /\.(godot|native)\.js$/.test(filename)),
          "Package target lookup must not expand competing platform suffixes");
      });
    }
  }
}

for (const kind of ["exports", "imports"]) {
  test("original condition object key order wins over enabled conditions for " + kind, async t => {
    const f = fixture(t, ["godot"]);
    const source = conditionalFixture(f, kind, "import", {
      default: "./fallback.js", godot: "./godot.js", import: "./import.js", require: "./require.js",
    });
    const oracle = metroResult(f, source.origin, source.specifier, "import");
    assert.equal(oracle.error, undefined);
    assert.deepEqual(oracle.warnings, []);
    const selected = path.join(f.project, source.folder, "fallback.js");
    assert.equal(oracle.resolution.filePath, selected);
    const result = await sdkBundle(f);
    assert.equal(result.context.result, "fallback");
    assert.ok(result.inputs.includes(selected));
  });
}

test("declared incompatibility: Metro falls back from a missing exact export while the SDK fails", async t => {
  const f = fixture(t, []);
  f.write("node_modules/conditional/package.json", {name: "conditional", main: "./fallback.js", exports: "./missing.js"});
  f.write("node_modules/conditional/missing.godot.js", "module.exports = 'platform sibling';");
  const fallback = f.write("node_modules/conditional/fallback.js", "module.exports = 'legacy fallback';");
  const origin = f.write("ui/index.ts", "import value from 'conditional'; (globalThis as any).result = value;");
  const oracle = metroResult(f, origin, "conditional", "import");
  assert.equal(oracle.error, undefined);
  assert.equal(oracle.resolution.filePath, fallback);
  assert.ok(oracle.warnings.length > 0, "Metro must expose its fallback warning");
  await assert.rejects(() => sdkBundle(f), error => error.errors?.some(item => item.text.includes("Could not resolve")));
});

test("declared incompatibility: Metro rejects an external #imports target that the SDK resolves", async t => {
  const f = fixture(t, []);
  f.write("node_modules/conditional/package.json", {name: "conditional", main: "entry.mjs",
    imports: {"#external": "leaf"}, dependencies: {leaf: "1.0.0"}});
  const origin = f.write("node_modules/conditional/entry.mjs", "import value from '#external'; export default value;");
  f.write("node_modules/conditional/node_modules/leaf/package.json", {name: "leaf", main: "index.js"});
  const selected = f.write("node_modules/conditional/node_modules/leaf/index.js", "module.exports = 'declared leaf';");
  f.write("ui/index.ts", "import value from 'conditional'; (globalThis as any).result = value;");
  const oracle = metroResult(f, origin, "#external", "import");
  assert.equal(oracle.error?.constructor.name, "FailedToResolveNameError");
  assert.ok(oracle.warnings.length > 0, "Metro must expose its invalid mapping warning");
  const result = await sdkBundle(f);
  assert.equal(result.context.result, "declared leaf");
  assert.ok(result.inputs.includes(selected));
});

// D20 subpaths: the same oracle on a package's exact subpaths and `./features/*` patterns. Every target file holds its own
// relative name, so the bundle's result says which file was chosen.
function ownName(file) {
  if (file.endsWith(".json")) {
    return JSON.stringify(file);
  }
  return file.endsWith(".mjs") ? "export default " + JSON.stringify(file) + ";" : "module.exports = " + JSON.stringify(file) + ";";
}
function usage(f, mode, specifier) {
  const expression = mode === "import" ? `import value from '${specifier}';` : `const value = require('${specifier}');`;
  return f.write("ui/index.ts", expression + " (globalThis as any).result = value;");
}
function subpathFixture(f, mode, map, specifier) {
  const folder = "node_modules/conditional";
  f.write(folder + "/package.json", {name: "conditional", main: "./main.js", exports: map});
  f.write(folder + "/main.js", ownName("main.js"));
  for (const file of ["godot.js", "import.js", "require.js", "fallback.js", "present.js",
    "lib/alpha.js", "lib/alpha.mjs", "lib/alpha.cjs", "lib/alpha.godot.js"]) {
    f.write(folder + "/" + file, ownName(file));
  }
  return {origin: usage(f, mode, specifier), folder};
}
const feature = "conditional/feature", alpha = "conditional/features/alpha";

const subpathRows = [
  {name: "an exact subpath", specifier: feature, expected: ({mode, godot}) => godot ? "godot.js" : mode + ".js",
    exports: {"./feature": {godot: "./godot.js", import: "./import.js", require: "./require.js", default: "./fallback.js"}}},
  {name: "an exact subpath with its condition keys reversed", specifier: feature, expected: () => "fallback.js",
    exports: {"./feature": {default: "./fallback.js", require: "./require.js", import: "./import.js", godot: "./godot.js"}}},
  {name: "an exact subpath with nested conditions", specifier: feature, expected: ({mode, godot}) => godot ? "godot.js" : mode + ".js",
    exports: {"./feature": {import: {godot: "./godot.js", default: "./import.js"}, require: {godot: "./godot.js", default: "./require.js"},
      default: "./fallback.js"}}},
  {name: "a pattern", specifier: alpha, expected: () => "lib/alpha.js", exports: {"./features/*": "./lib/*.js"}},
  {name: "a pattern with conditions", specifier: alpha,
    expected: ({mode, godot}) => godot ? "lib/alpha.godot.js" : mode === "import" ? "lib/alpha.mjs" : "lib/alpha.cjs",
    exports: {"./features/*": {godot: "./lib/*.godot.js", import: "./lib/*.mjs", require: "./lib/*.cjs", default: "./lib/*.js"}}},
  {name: "a pattern with its condition keys reversed", specifier: alpha, expected: () => "lib/alpha.js",
    exports: {"./features/*": {default: "./lib/*.js", require: "./lib/*.cjs", import: "./lib/*.mjs", godot: "./lib/*.godot.js"}}},
  {name: "a pattern with nested conditions", specifier: alpha,
    expected: ({mode, godot}) => godot ? "lib/alpha.godot.js" : mode === "import" ? "lib/alpha.mjs" : "lib/alpha.cjs",
    exports: {"./features/*": {import: {godot: "./lib/*.godot.js", default: "./lib/*.mjs"},
      require: {godot: "./lib/*.godot.js", default: "./lib/*.cjs"}, default: "./lib/*.js"}}},
  {name: "an exact subpath that is more specific than the pattern", specifier: alpha, expected: () => "present.js",
    exports: {"./features/*": "./lib/*.js", "./features/alpha": "./present.js"}},
  {name: "an array whose first item is a valid target", specifier: feature, expected: () => "present.js",
    exports: {"./feature": ["./present.js", "./fallback.js"]}},
  {name: "a pattern array whose first item is a valid target", specifier: alpha, expected: () => "lib/alpha.js",
    exports: {"./features/*": ["./lib/*.js", "./lib/*.cjs"]}},
  {name: "an array whose first item is a condition object the host matches", specifier: feature, expected: () => "godot.js",
    conditions: [["godot"]], exports: {"./feature": [{godot: "./godot.js"}, "./present.js"]}},
];
for (const row of subpathRows) {
  for (const mode of ["import", "require"]) {
    for (const conditions of row.conditions ?? [[], ["godot"]]) {
      test("original Metro and SDK choose the same target for " + row.name + ": " + mode + "/" + JSON.stringify(conditions), async t => {
        const f = fixture(t, conditions);
        const source = subpathFixture(f, mode, row.exports, row.specifier);
        const expected = row.expected({mode, godot: conditions.includes("godot")});
        const selected = path.join(f.project, source.folder, expected);
        const oracle = metroResult(f, source.origin, row.specifier, mode);
        assert.equal(oracle.error, undefined);
        assert.deepEqual(oracle.warnings, []);
        assert.equal(oracle.resolution.type, "sourceFile");
        assert.equal(oracle.resolution.filePath, selected);
        const result = await sdkBundle(f);
        assert.equal(result.context.result, expected);
        assert.deepEqual(result.inputs.filter(filename => filename.startsWith(path.join(f.project, "node_modules") + path.sep)), [selected]);
      });
    }
  }
}

// Both reject: nothing outside the map is reachable, and neither falls back to main or skips a missing file.
for (const row of [
  {name: "a subpath its null pattern excludes", specifier: "conditional/features/internal/alpha",
    exports: {"./features/*": "./lib/*.js", "./features/internal/*": null}},
  {name: "a subpath the exports map does not declare", specifier: "conditional/other/alpha", exports: {"./features/*": "./lib/*.js"}},
  {name: "an array whose first item is a missing file", specifier: feature, exports: {"./feature": ["./missing.js", "./present.js"]}},
]) {
  for (const mode of ["import", "require"]) {
    test("original Metro and SDK both reject " + row.name + ": " + mode, async t => {
      const f = fixture(t, ["godot"]);
      const source = subpathFixture(f, mode, row.exports, row.specifier);
      const oracle = metroResult(f, source.origin, row.specifier, mode);
      assert.equal(oracle.error?.constructor.name, "FailedToResolveNameError");
      assert.ok(oracle.warnings.length > 0, "Metro must expose why it rejected the subpath");
      await assert.rejects(() => sdkBundle(f), error => error.errors?.some(item => item.text.includes("Could not resolve")));
    });
  }
}

// Metro 0.87.1 (flattenLegacySubpathValues) reads only value[0] of an exports array at the subpath level and does not understand an
// array inside a condition object, so it rejects each form below. The SDK's esbuild follows Node: it tries each item and takes the
// first target the conditions select. The SDK resolves what Metro refuses; which side is right is the user's pending D20 decision.
for (const form of [
  {name: "the first item is a condition object nothing matches", specifier: feature, expected: () => "present.js",
    exports: {"./feature": [{unknown: "./godot.js"}, "./present.js"]}},
  {name: "the first item is a condition the host lacks", specifier: feature, expected: () => "present.js",
    exports: {"./feature": [{godot: "./godot.js"}, "./present.js"]}},
  {name: "a pattern array whose first item matches nothing", specifier: alpha, expected: () => "lib/alpha.js",
    exports: {"./features/*": [{unknown: "./lib/*.godot.js"}, "./lib/*.js"]}},
  {name: "an array inside a condition, even with a valid first item", specifier: feature, expected: ({mode}) => mode + ".js",
    exports: {"./feature": {import: ["./import.js", "./fallback.js"], require: ["./require.js", "./fallback.js"], default: "./fallback.js"}}},
]) {
  for (const mode of ["import", "require"]) {
    test("declared incompatibility: Metro reads only the first item of an exports array, while the SDK tries each: " + form.name + ", " + mode, async t => {
      const f = fixture(t, []);
      const source = subpathFixture(f, mode, form.exports, form.specifier);
      const oracle = metroResult(f, source.origin, form.specifier, mode);
      assert.equal(oracle.error?.constructor.name, "FailedToResolveNameError");
      assert.ok(oracle.warnings.length > 0, "Metro must expose its rejection warning");
      const expected = form.expected({mode});
      const result = await sdkBundle(f);
      assert.equal(result.context.result, expected);
      assert.ok(result.inputs.includes(path.join(f.project, source.folder, expected)));
    });
  }
}

// D20 files outside exports: an installed package without "exports" resolves main, subpaths and competing platform files by file
// lookup. Resolution here does not depend on import or require, so each row runs once.
function plainPackage(f, {main = "./index.js", files, extra = {}, specifier, relative = false}) {
  const folder = "node_modules/conditional";
  f.write(folder + "/package.json", {name: "conditional", main});
  for (const file of files) {
    f.write(folder + "/" + file, ownName(file));
  }
  for (const [file, contents] of Object.entries(extra)) {
    f.write(folder + "/" + file, contents);
  }
  if (!relative) {
    return {origin: usage(f, "import", specifier), folder};
  }
  // The relative import is written inside the package, as a library's own internal import would be.
  const origin = f.write(folder + "/entry.js", `module.exports = require('${specifier}');`);
  usage(f, "import", "conditional/entry");
  return {origin, folder};
}
const xModule = "conditional/x";
const plainRows = [
  {name: "godot, native and plain siblings", files: ["x.godot.js", "x.native.js", "x.js"], specifier: xModule, expected: "x.godot.js"},
  {name: "native and plain siblings", files: ["x.native.js", "x.js"], specifier: xModule, expected: "x.native.js"},
  {name: "a plain file alone", files: ["x.js"], specifier: xModule, expected: "x.js"},
  {name: "godot and plain siblings", files: ["x.godot.js", "x.js"], specifier: xModule, expected: "x.godot.js"},
  {name: "an explicit extension names that exact file", files: ["x.godot.js", "x.js"], specifier: xModule + ".js", expected: "x.js"},
  {name: "a plain JSON file loses to a godot JavaScript sibling", files: ["x.json", "x.godot.js"], specifier: xModule, expected: "x.godot.js"},
  {name: "a godot JSX file loses to a plain JavaScript file", files: ["x.godot.jsx", "x.js"], specifier: xModule, expected: "x.js"},
  {name: "a godot JSON file loses to a plain JavaScript file", files: ["x.godot.json", "x.js"], specifier: xModule, expected: "x.js"},
  {name: "a nested subpath", files: ["lib/y.godot.js", "lib/y.js"], specifier: "conditional/lib/y", expected: "lib/y.godot.js"},
  {name: "a directory index", files: ["dir/index.godot.js", "dir/index.js"], specifier: "conditional/dir", expected: "dir/index.godot.js"},
  {name: "a directory package.json main", files: ["dir/entry.godot.js", "dir/entry.js"], extra: {"dir/package.json": {main: "./entry"}},
    specifier: "conditional/dir", expected: "dir/entry.godot.js"},
  {name: "an extensionless main", main: "./lib/entry", files: ["lib/entry.godot.js", "lib/entry.js"], specifier: "conditional", expected: "lib/entry.godot.js"},
  {name: "a main with its extension names that exact file", main: "./lib/entry.js", files: ["lib/entry.godot.js", "lib/entry.js"],
    specifier: "conditional", expected: "lib/entry.js"},
  {name: "the package's own relative import", relative: true, files: ["x.godot.js", "x.native.js", "x.js"], specifier: "./x", expected: "x.godot.js"},
  {name: "the package's own relative import of a native sibling", relative: true, files: ["x.native.js", "x.js"], specifier: "./x", expected: "x.native.js"},
];
for (const row of plainRows) {
  test("original Metro and SDK choose the same file outside exports for " + row.name, async t => {
    const f = fixture(t, ["godot"]);
    const source = plainPackage(f, row);
    const selected = path.join(f.project, source.folder, row.expected);
    const oracle = metroResult(f, source.origin, row.specifier, "import");
    assert.equal(oracle.error, undefined);
    assert.deepEqual(oracle.warnings, []);
    assert.equal(oracle.resolution.filePath, selected);
    const result = await sdkBundle(f);
    assert.equal(result.context.result, row.expected);
    const loaded = result.inputs.filter(filename => filename.startsWith(path.join(f.project, source.folder) + path.sep));
    const relativeEntry = path.join(f.project, source.folder, "entry.js");
    assert.deepEqual(loaded.filter(filename => filename !== relativeEntry), [selected], "competing siblings must stay out of the bundle");
  });
}

const eliminationCandidates = ["ts", "tsx", "js", "jsx", "json"].flatMap(extension =>
  ["godot", "native", ""].map(suffix => suffix ? `x.${suffix}.${extension}` : `x.${extension}`));
// Metro: extension by extension in sourceExts order, each with .godot, .native and plain.
const metroOrder = ["x.godot.ts", "x.native.ts", "x.ts", "x.godot.tsx", "x.native.tsx", "x.tsx", "x.godot.js", "x.native.js", "x.js",
  "x.godot.jsx", "x.native.jsx", "x.jsx", "x.godot.json", "x.native.json", "x.json"];
const notPlatformJson = name => !/\.(godot|native)\.json$/.test(name);

// Removes the winner and resolves again until nothing resolves, so the result is the whole order a resolver prefers.
async function resolutionOrder(t, {folder, specifier, side}) {
  const f = fixture(t, ["godot"]);
  f.write("node_modules/conditional/package.json", {name: "conditional", main: "./index.js"});
  f.write("node_modules/conditional/index.js", ownName("index.js"));
  for (const file of eliminationCandidates) {
    f.write(folder + "/" + file, ownName(file));
  }
  const origin = usage(f, "import", specifier);
  const order = [];
  for (;;) {
    let winner;
    if (side === "metro") {
      const oracle = metroResult(f, origin, specifier, "import");
      winner = oracle.error ? undefined : path.basename(oracle.resolution.filePath);
    } else {
      try {
        const result = await sdkBundle(f);
        winner = path.basename(result.inputs.find(filename => filename.startsWith(path.join(f.project, folder) + path.sep)));
      } catch (error) {
        if (!error.errors?.some(item => item.text.includes("Could not resolve"))) {
          throw error;
        }
      }
    }
    if (winner === undefined) {
      return order;
    }
    order.push(winner);
    fs.rmSync(path.join(f.project, folder, winner));
  }
}

// esbuild defers TypeScript extensions behind JavaScript ones inside node_modules whatever the resolveExtensions order says, while
// Metro tries sourceExts in order, TypeScript first. It matters only for a package that ships both .ts and .js (or .godot.js against
// .native.ts) of the same module. Which order the host wants is the user's pending D20 decision.
for (const row of [
  {name: "a native TypeScript sibling against a godot JavaScript sibling", files: ["x.native.ts", "x.godot.js"], metro: "x.native.ts", sdk: "x.godot.js"},
  {name: "a plain TypeScript file against a godot JavaScript sibling", files: ["x.godot.js", "x.ts"], metro: "x.ts", sdk: "x.godot.js"},
]) {
  test("declared incompatibility: inside node_modules Metro tries TypeScript before JavaScript and the SDK tries JavaScript first: " + row.name, async t => {
    const f = fixture(t, ["godot"]);
    const source = plainPackage(f, {files: row.files, specifier: xModule});
    const oracle = metroResult(f, source.origin, xModule, "import");
    assert.equal(oracle.resolution.filePath, path.join(f.project, source.folder, row.metro));
    const result = await sdkBundle(f);
    assert.equal(result.context.result, row.sdk);
  });
}

test("declared incompatibility: the whole file order inside node_modules, Metro against the SDK", async t => {
  const installed = {folder: "node_modules/conditional", specifier: xModule};
  assert.deepEqual(await resolutionOrder(t, {...installed, side: "metro"}), metroOrder);
  assert.deepEqual(await resolutionOrder(t, {...installed, side: "sdk"}),
    ["x.godot.js", "x.native.js", "x.js", "x.godot.jsx", "x.native.jsx", "x.jsx",
      "x.godot.ts", "x.native.ts", "x.ts", "x.godot.tsx", "x.native.tsx", "x.tsx", "x.json"]);
});

// The project's own sources keep the resolveExtensions order, which is Metro's, with one gap: platform-suffixed JSON.
test("the project's own sources resolve in Metro's order, except platform-suffixed JSON", async t => {
  const project = {folder: "ui/lib", specifier: "./lib/x"};
  assert.deepEqual(await resolutionOrder(t, {...project, side: "metro"}), metroOrder);
  assert.deepEqual(await resolutionOrder(t, {...project, side: "sdk"}), metroOrder.filter(notPlatformJson));
});

// Metro resolves x.godot.json and x.native.json (sourceExts has json, each tried with the platform suffixes). godotExtensions has no
// .godot.json or .native.json, so the SDK cannot resolve them. A probable SDK gap, not a policy choice.
for (const row of [
  {name: "a godot JSON file", files: ["x.godot.json"], specifier: xModule, expected: "x.godot.json"},
  {name: "a native JSON file", files: ["x.native.json"], specifier: xModule, expected: "x.native.json"},
  {name: "the package's own relative import of a godot JSON file", relative: true, files: ["x.godot.json"], specifier: "./x", expected: "x.godot.json"},
]) {
  test("declared incompatibility: Metro resolves platform-suffixed JSON and the SDK does not: " + row.name, async t => {
    const f = fixture(t, ["godot"]);
    const source = plainPackage(f, row);
    const oracle = metroResult(f, source.origin, row.specifier, "import");
    assert.equal(oracle.error, undefined);
    assert.equal(oracle.resolution.filePath, path.join(f.project, source.folder, row.expected));
    await assert.rejects(() => sdkBundle(f), error => error.errors?.some(item => item.text.includes("Could not resolve")));
  });
}

// When main names a missing file, Metro throws InvalidPackageError even though the package root has an index file. The SDK's esbuild
// falls back to that index like Node does, honoring the platform suffixes.
test("declared incompatibility: Metro rejects a package whose main is missing while the SDK falls back to the root index", async t => {
  const f = fixture(t, ["godot"]);
  const source = plainPackage(f, {main: "./missing.js", files: ["index.godot.js", "index.js"], specifier: "conditional"});
  const oracle = metroResult(f, source.origin, "conditional", "import");
  assert.equal(oracle.error?.constructor.name, "InvalidPackageError");
  const result = await sdkBundle(f);
  assert.equal(result.context.result, "index.godot.js");
});
