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
