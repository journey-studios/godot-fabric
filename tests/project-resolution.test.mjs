import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
import test from "node:test";
import {build} from "esbuild";
import ts from "typescript";
import {prepareProjectResolution} from "../sdk/toolchain/project-resolution.mjs";
import {checkProjectTypes} from "../sdk/toolchain/project-typecheck.mjs";
import {platformPlugin} from "../sdk/toolchain/platform-plugin.mjs";

const requireOriginal = createRequire(import.meta.url);
const suffixes = [".godot", ".native", ""];
const json = value => JSON.stringify(value, null, 2) + "\n";
const diagnostic = code => error => error.message.includes(code);

function fixture(t, {dependencies = {}, compilerOptions = {}} = {}) {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "godot-project-resolution-")));
  t.after(() => fs.rmSync(project, {recursive: true, force: true}));
  const sdk = path.join(project, "addons/godot_fabric");
  const write = (name, contents) => {
    const filename = path.join(project, name);
    fs.mkdirSync(path.dirname(filename), {recursive: true});
    fs.writeFileSync(filename, typeof contents === "string" ? contents : json(contents));
    return filename;
  };
  const manifest = {name: "independent-project", private: true, dependencies};
  write("package.json", manifest);
  write("tsconfig.json", {compilerOptions: {strict: true, module: "ESNext", moduleResolution: "Bundler",
    target: "ESNext", moduleSuffixes: suffixes, ...compilerOptions}});
  write("ui/index.ts", "globalThis.result = 'entry';");
  write("addons/godot_fabric/toolchain/package.json", {private: true});
  write("addons/godot_fabric/toolchain/node_modules/react-native/package.json",
    {name: "react-native", version: requireOriginal("react-native/package.json").version, main: "index.js"});
  const sdkRequire = createRequire(path.join(sdk, "toolchain/package.json"));
  return {project, sdk, manifest, write, resolveSdk: id => sdkRequire.resolve(id)};
}
function installed(f, name, source, {parent = "", dependencies = {}, imports} = {}) {
  const folder = path.posix.join(parent, "node_modules", name);
  f.write(folder + "/package.json", {name, version: "1.0.0", main: "index.js", dependencies,
    ...(imports ? {imports} : {})});
  f.write(folder + "/index.js", source);
  return folder;
}
async function prepare(f) {
  return prepareProjectResolution({project: f.project, sdk: f.sdk, dependencies: f.manifest, resolveSdk: f.resolveSdk});
}
async function bundle(f, prepared = undefined) {
  const resolution = prepared ?? await prepare(f);
  const result = await build({absWorkingDir: f.project, entryPoints: [f.entry ?? "ui/index.ts"], write: false,
    tsconfigRaw: resolution.tsconfigRaw, conditions: resolution.conditions,
    bundle: true, format: "iife", platform: "neutral",
    mainFields: ["main"], resolveExtensions: resolution.resolveExtensions, metafile: true, logLevel: "silent",
    define: {"process.env.NODE_ENV": '"production"', __DEV__: "false"},
    plugins: [resolution.plugin, platformPlugin(path.join(f.sdk, "src"), f.resolveSdk)]});
  const context = {};
  vm.runInNewContext(result.outputFiles[0].text, context);
  resolution.assertUnchanged();
  return {resolution, context, code: result.outputFiles[0].text,
    inputs: Object.keys(result.metafile.inputs).map(name => path.resolve(f.project, name))};
}

function declaration(f, folder, contents) {
  const filename = path.join(f.project, folder, "package.json");
  f.write(folder + "/package.json", {...JSON.parse(fs.readFileSync(filename, "utf8")), types: "index.d.ts"});
  f.write(folder + "/index.d.ts", contents);
}

function assertTypes(resolution, errorCode) {
  const result = resolution.checkTypes();
  if (errorCode === undefined) assert.equal(result.errorCount, 0,
    result.diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));
  else {
    assert.ok(result.errorCount > 0, "The original checker must reject the intentional type error");
    assert.ok(result.diagnostics.some(d => d.code === errorCode));
  }
  return result;
}

function originalDiagnostics(f) {
  const parsed = ts.getParsedCommandLineOfConfigFile(path.join(f.project, "tsconfig.json"), {}, {
    ...ts.sys, onUnRecoverableConfigFileDiagnostic: d => assert.fail(ts.flattenDiagnosticMessageText(d.messageText, "\n")),
  });
  return ts.getPreEmitDiagnostics(ts.createProgram(parsed.fileNames, {...parsed.options, noEmit: true}));
}

function originalReactTypes(f) {
  for (const name of ["@types/react", "csstype"]) {
    const source = path.dirname(requireOriginal.resolve(name + "/package.json"));
    fs.cpSync(source, path.join(f.sdk, "toolchain/node_modules", name), {recursive: true});
  }
}
function originalTypeScriptResolution(f, specifier) {
  const filename = path.join(f.project, "tsconfig.json");
  const read = ts.readConfigFile(filename, ts.sys.readFile);
  assert.equal(read.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, f.project);
  assert.equal(parsed.errors.length, 0);
  return ts.resolveModuleName(specifier, path.join(f.project, "ui/index.ts"), parsed.options, ts.sys).resolvedModule?.resolvedFileName;
}
function sdkPackages(f) {
  const reactRoot = path.dirname(requireOriginal.resolve("react/package.json"));
  const copied = path.join(f.sdk, "toolchain/node_modules/react");
  fs.mkdirSync(path.dirname(copied), {recursive: true});
  fs.cpSync(reactRoot, copied, {recursive: true});
  f.write("addons/godot_fabric/src/react-native-platform.jsx", "export const sdkMarker = 'SDK Native facade';");
  f.write("addons/godot_fabric/toolchain/node_modules/react-native/index.js", "throw new Error('Use the SDK native facade');");
  f.write("addons/godot_fabric/toolchain/node_modules/react-native/types_generated/index.d.ts", "export {};");
  f.write("addons/godot_fabric/toolchain/node_modules/@types/react/index.d.ts", "export {};");
  f.write("addons/godot_fabric/types/react-native.ts", "export interface ViewProps {testID?: string}");
  f.write("addons/godot_fabric/types/godot-fabric.ts", "export interface GodotFabric {}");
}

// Every build is write:false against authored temporary files. No dependency
// installation, user project mutation, native library, or Godot process is needed.
test("inherited local aliases match original TypeScript and select the Godot platform source", async t => {
  const f = fixture(t);
  f.write("config/base.json", {compilerOptions: {baseUrl: "..", paths: {"@local/*": ["ui/lib/*"]}, moduleSuffixes: suffixes}});
  f.write("tsconfig.json", {extends: "./config/base.json", compilerOptions: {module: "ESNext", moduleResolution: "Bundler"}});
  f.write("ui/lib/answer.ts", "export const answer = 'generic';");
  f.write("ui/lib/answer.native.ts", "export const answer = 'native';");
  const expected = f.write("ui/lib/answer.godot.ts", "export const answer: string = 'godot';");
  f.write("ui/index.ts", "import {answer} from '@local/answer'; globalThis.result = answer;");
  assert.equal(originalTypeScriptResolution(f, "@local/answer"), expected);
  const result = await bundle(f);
  assert.equal(result.context.result, "godot");
  assert.ok(result.inputs.includes(expected));
  assert.ok(!result.inputs.includes(path.join(f.project, "ui/lib/answer.native.ts")));
});

test("declared project dependencies resolve their nested transitive dependency without hoisting", async t => {
  const f = fixture(t, {dependencies: {library: "1.0.0"}});
  const library = installed(f, "library", "exports.answer = require('leaf').answer + 1;", {dependencies: {leaf: "1.0.0"}});
  installed(f, "leaf", "exports.answer = 40;", {parent: library});
  assert.equal(fs.existsSync(path.join(f.project, "node_modules/leaf")), false);
  f.write("ui/index.ts", "import {answer} from 'library'; globalThis.result = answer;");
  const result = await bundle(f);
  assert.equal(result.context.result, 41);
  assert.ok(result.inputs.includes(path.join(f.project, library, "node_modules/leaf/index.js")));
});

test("an installed but undeclared direct project package fails visibly", async t => {
  const f = fixture(t);
  installed(f, "undeclared", "exports.answer = 42;");
  f.write("ui/index.ts", "import {answer} from 'undeclared'; globalThis.result = answer;");
  await assert.rejects(() => bundle(f), /Declare undeclared in the project's dependencies/);
});

test("a missing declared dependency retains the project package manager diagnostic", async t => {
  const f = fixture(t, {dependencies: {missing: "1.0.0"}});
  f.write("ui/index.ts", "import {answer} from 'missing'; globalThis.result = answer;");
  await assert.rejects(() => bundle(f), /Missing project dependency missing/);
});

test("a transitive import cannot borrow an undeclared sibling package", async t => {
  const f = fixture(t, {dependencies: {library: "1.0.0"}});
  installed(f, "library", "exports.answer = require('borrowed').answer;");
  installed(f, "borrowed", "exports.answer = 42;");
  f.write("ui/index.ts", "import {answer} from 'library'; globalThis.result = answer;");
  await assert.rejects(() => bundle(f), /Declare borrowed|undeclared.*borrowed|borrowed.*dependencies/i);
});

test("an alias targeting a physical file outside the project is rejected before publication", async t => {
  const outside = fixture(t);
  const target = outside.write("external.ts", "export const answer = 42;");
  const f = fixture(t, {compilerOptions: {paths: {"@escape": [target]}}});
  f.write("ui/index.ts", "import {answer} from '@escape'; globalThis.result = answer;");
  await assert.rejects(() => bundle(f), diagnostic("E_PROJECT_ALIAS"));
});

test("a local alias cannot escape through an external symlink", async t => {
  const outside = fixture(t);
  outside.write("answer.ts", "export const answer = 42;");
  const f = fixture(t, {compilerOptions: {paths: {"@escape": ["./ui/link/answer.ts"]}}});
  fs.symlinkSync(outside.project, path.join(f.project, "ui/link"), "dir");
  f.write("ui/index.ts", "import {answer} from '@escape'; globalThis.result = answer;");
  await assert.rejects(() => bundle(f), diagnostic("E_PROJECT_ALIAS"));
});

test("a dependency symlink outside the project cannot enter the bundle", async t => {
  const outside = fixture(t);
  outside.write("package.json", {name: "escaped", version: "1.0.0", main: "index.js"});
  outside.write("index.js", "exports.answer = 42;");
  const f = fixture(t, {dependencies: {escaped: "1.0.0"}});
  fs.mkdirSync(path.join(f.project, "node_modules"));
  fs.symlinkSync(outside.project, path.join(f.project, "node_modules/escaped"), "dir");
  f.write("ui/index.ts", "import {answer} from 'escaped'; globalThis.result = answer;");
  await assert.rejects(() => bundle(f), diagnostic("E_PROJECT_PATH"));
});

for (const [label, target] of [["SDK implementation", "addons/godot_fabric/src/implementation.ts"],
  ["SDK type facade", "addons/godot_fabric/types/react-native.ts"],
  ["declaration-only file", "ui/only-types.d.ts"]]) {
  test("a project runtime alias cannot address " + label, async t => {
    const f = fixture(t, {compilerOptions: {paths: {"@internal": ["./" + target]}}});
    f.write(target, "export const answer = 42;");
    f.write("ui/index.ts", "import {answer} from '@internal'; globalThis.result = answer;");
    await assert.rejects(() => bundle(f), diagnostic("E_PROJECT_ALIAS"));
  });
}

for (const name of ["react", "react-native"]) {
  test("a reserved " + name + " type mapping cannot spoof SDK identity", async t => {
    const f = fixture(t, {compilerOptions: {paths: {[name]: ["./ui/spoof.ts"]}}});
    sdkPackages(f);
    f.write("ui/spoof.ts", "throw new Error('Spoofed SDK identity');");
    f.write("ui/index.ts", "import * as spoof from '" + name + "'; globalThis.result = spoof;");
    await assert.rejects(() => bundle(f), diagnostic("E_PROJECT_SDK_IDENTITY"));
  });
  test("a physical project " + name + " import cannot bypass SDK identity", async t => {
    const f = fixture(t);
    sdkPackages(f);
    installed(f, name, "throw new Error('Physical spoof was evaluated');");
    f.write("ui/index.ts", "import * as spoof from '../node_modules/" + name + "/index.js'; globalThis.result = spoof;");
    await assert.rejects(() => bundle(f), diagnostic("E_PROJECT_SDK_IDENTITY"));
  });
}

test("legitimate SDK type mappings retain original React and the SDK native facade", async t => {
  const prefix = "./addons/godot_fabric/";
  const f = fixture(t, {compilerOptions: {paths: {
    "@godot-fabric/runtime": [prefix + "types/godot-fabric.ts"],
    react: [prefix + "toolchain/node_modules/@types/react"],
    "react/*": [prefix + "toolchain/node_modules/@types/react/*"],
    "react-native": [prefix + "types/react-native.ts"],
    "react-native/*": [prefix + "toolchain/node_modules/react-native/types_generated/*"],
  }}});
  sdkPackages(f);
  f.write("ui/index.ts", "import * as React from 'react'; import {sdkMarker} from 'react-native'; globalThis.result = {version: React.version, createElement: typeof React.createElement, sdkMarker};");
  const result = await bundle(f);
  assert.equal(result.context.result.version, requireOriginal("react").version);
  assert.equal(result.context.result.createElement, "function");
  assert.equal(result.context.result.sdkMarker, "SDK Native facade");
  assert.ok(result.inputs.some(name => name.startsWith(path.join(f.sdk, "toolchain/node_modules/react") + path.sep)));
  assert.ok(!result.inputs.some(name => name.endsWith(".d.ts")));
});

test("a transitive library's false nested React never creates a second React identity", async t => {
  const f = fixture(t, {dependencies: {library: "1.0.0"}});
  sdkPackages(f);
  const library = installed(f, "library", "exports.React = require('react');", {dependencies: {react: "1.0.0"}});
  installed(f, "react", "throw new Error('Nested React spoof was evaluated');", {parent: library});
  f.write("ui/index.ts", "import React from 'react'; import {React as nested} from 'library'; globalThis.result = {same: React === nested, version: nested.version};");
  const result = await bundle(f);
  assert.equal(result.context.result.same, true);
  assert.equal(result.context.result.version, requireOriginal("react").version);
  assert.ok(!result.inputs.includes(path.join(f.project, library, "node_modules/react/index.js")));
});

for (const value of [undefined, [".native", ".godot", ""], [".godot", ""], [".web", ""]]) {
  test("unsupported moduleSuffixes fail with a clear diagnosis: " + JSON.stringify(value), async t => {
    const f = fixture(t, {compilerOptions: {moduleSuffixes: value}});
    await assert.rejects(() => prepare(f), diagnostic("E_PROJECT_SUFFIXES"));
  });
}

test("a malformed project config exposes the original TypeScript parse failure", async t => {
  const f = fixture(t);
  f.write("tsconfig.json", '{"compilerOptions":');
  await assert.rejects(() => prepare(f), diagnostic("E_PROJECT_CONFIG"));
});

test("a malformed inherited config fails before bundling", async t => {
  const f = fixture(t);
  f.write("config/base.json", '{"compilerOptions":');
  f.write("tsconfig.json", {extends: "./config/base.json"});
  await assert.rejects(() => prepare(f), diagnostic("E_PROJECT_CONFIG"));
});

test("the config snapshot stays valid after a build and rejects changed root config bytes", async t => {
  const f = fixture(t), prepared = await prepare(f);
  await bundle(f, prepared);
  assert.doesNotThrow(() => prepared.assertUnchanged());
  fs.appendFileSync(path.join(f.project, "tsconfig.json"), "\n");
  assert.throws(() => prepared.assertUnchanged(), diagnostic("E_PROJECT_CONFIG_CHANGED"));
});

test("the config snapshot also guards inherited configuration", async t => {
  const f = fixture(t);
  f.write("config/base.json", {compilerOptions: {module: "ESNext", moduleResolution: "Bundler", moduleSuffixes: suffixes}});
  f.write("tsconfig.json", {extends: "./config/base.json"});
  const prepared = await prepare(f);
  assert.doesNotThrow(() => prepared.assertUnchanged());
  fs.appendFileSync(path.join(f.project, "config/base.json"), "\n");
  assert.throws(() => prepared.assertUnchanged(), diagnostic("E_PROJECT_CONFIG_CHANGED"));
});

for (const name of ["react", "react-native"]) {
  test("a named " + name + " result cannot escape the physical SDK through a symlink", async t => {
    const f = fixture(t), outside = fixture(t);
    if (name === "react") {
      outside.write("package.json", {name, main: "index.js"});
      outside.write("index.js", "throw new Error('Escaped named React was evaluated');");
      fs.symlinkSync(outside.project, path.join(f.sdk, "toolchain/node_modules/react"), "dir");
    } else {
      const target = outside.write("facade.jsx", "throw new Error('Escaped named Native facade was evaluated');");
      fs.mkdirSync(path.join(f.sdk, "src"));
      fs.symlinkSync(target, path.join(f.sdk, "src/react-native-platform.jsx"), "file");
    }
    f.write("ui/index.ts", "import * as escaped from '" + name + "'; globalThis.result = escaped;");
    await assert.rejects(() => bundle(f), diagnostic("E_PROJECT_SDK_IDENTITY"));
  });
}

for (const declared of [false, true]) {
  test("a relative import between packages " + (declared ? "uses its owner's declaration" : "cannot borrow the project's declaration"), async t => {
    const f = fixture(t, {dependencies: {library: "1.0.0", borrowed: "1.0.0"}});
    installed(f, "library", "exports.answer = require('../borrowed/index.js').answer;",
      {dependencies: declared ? {borrowed: "1.0.0"} : {}});
    installed(f, "borrowed", "exports.answer = 42;");
    f.write("ui/index.ts", "import {answer} from 'library'; globalThis.result = answer;");
    if (declared) assert.equal((await bundle(f)).context.result, 42);
    else await assert.rejects(() => bundle(f), diagnostic("E_PROJECT_DEPENDENCY"));
  });
}

function collidingLibrary(t, intentionalError = false) {
  const f = fixture(t, {dependencies: {library: "1.0.0"},
    compilerOptions: {types: [], paths: {leaf: ["./ui/local-leaf.ts"]}}});
  f.write("ui/local-leaf.ts", "export const answer: 'application alias' = 'application alias';");
  const library = installed(f, "library", "exports.answer = require('leaf').answer;", {dependencies: {leaf: "1.0.0"}});
  declaration(f, library, "export {answer} from 'leaf';");
  const leaf = installed(f, "leaf", "exports.answer = 'nested dependency';", {parent: library});
  declaration(f, leaf, "export const answer: 'nested dependency';");
  f.write("ui/index.ts", "import {answer as local} from 'leaf'; import {answer as fromLib} from 'library';"
    + " const app: 'application alias' = local; const nested: '"
    + (intentionalError ? "application alias" : "nested dependency") + "' = fromLib;"
    + " (globalThis as any).result = {local, fromLib};");
  return f;
}

test("application and library aliases coexist with distinct original declaration ownership", async t => {
  const f = collidingLibrary(t);
  // This is the causal control: plain project-wide paths alter the library's
  // reexported type even though its runtime dependency remains a different file.
  assert.ok(originalDiagnostics(f).some(d => d.code === 2322));
  const resolution = await prepare(f);
  assertTypes(resolution);
  const result = await bundle(f, resolution);
  assert.equal(result.context.result.local, "application alias");
  assert.equal(result.context.result.fromLib, "nested dependency");
  assert.ok(result.inputs.includes(path.join(f.project, "node_modules/library/node_modules/leaf/index.js")));
});

test("the scoped original checker rejects treating the library's type as the application's alias", async t => {
  const f = collidingLibrary(t, true);
  assert.equal(originalDiagnostics(f).length, 0, "The global-alias control falsely accepts the wrong library type");
  assertTypes(await prepare(f), 2322);
});

test("application aliases coexist with private SDK runtime and declaration imports", async t => {
  const f = fixture(t, {compilerOptions: {types: [], paths: {
    "@react-native/normalize-colors": ["./ui/colors.ts"],
    "react-native": ["./addons/godot_fabric/types/react-native.ts"],
  }}});
  f.write("ui/colors.ts", "const colors: 'application alias' = 'application alias'; export default colors;");
  const colors = installed(f, "@react-native/normalize-colors", "module.exports = 'original private dependency';",
    {parent: "addons/godot_fabric/toolchain"});
  declaration(f, colors, "declare const colors: 'original private dependency'; export default colors;");
  f.write("addons/godot_fabric/toolchain/node_modules/react-native/private-fixture.ts",
    "import colors from '@react-native/normalize-colors'; export const value = colors;");
  f.write("addons/godot_fabric/src/react-native-platform.jsx",
    "export {value} from '../toolchain/node_modules/react-native/private-fixture.ts';");
  f.write("addons/godot_fabric/types/react-native.ts",
    "export {value} from '../toolchain/node_modules/react-native/private-fixture';");
  f.write("ui/index.ts", "import local from '@react-native/normalize-colors'; import {value} from 'react-native';"
    + " const app: 'application alias' = local; const sdk: 'original private dependency' = value;"
    + " (globalThis as any).result = {local, sdk: value};");
  const resolution = await prepare(f);
  assertTypes(resolution);
  const result = await bundle(f, resolution);
  assert.equal(result.context.result.local, "application alias");
  assert.equal(result.context.result.sdk, "original private dependency");
  assert.ok(result.inputs.includes(path.join(f.project, colors, "index.js")));
});

test("a project can resolve its declared #imports map without a TS alias", async t => {
  const f = fixture(t);
  f.manifest.imports = {"#answer": "./ui/answer.ts"};
  f.write("package.json", f.manifest);
  const expected = f.write("ui/answer.ts", "export const answer: number = 42;");
  f.write("ui/index.ts", "import {answer} from '#answer'; globalThis.result = answer;");
  const result = await bundle(f);
  assert.equal(result.context.result, 42);
  assert.ok(result.inputs.includes(expected));
});

test("an installed library can resolve its own declared #imports map", async t => {
  const f = fixture(t, {dependencies: {library: "1.0.0"}});
  const library = installed(f, "library", "exports.answer = require('#answer').answer;",
    {imports: {"#answer": "./answer.js"}});
  const expected = f.write(library + "/answer.js", "exports.answer = 42;");
  f.write("ui/index.ts", "import {answer} from 'library'; globalThis.result = answer;");
  const result = await bundle(f);
  assert.equal(result.context.result, 42);
  assert.ok(result.inputs.includes(expected));
});

test("an undeclared project #import fails with an ownership diagnostic", async t => {
  const f = fixture(t);
  f.write("ui/index.ts", "import {answer} from '#missing'; globalThis.result = answer;");
  await assert.rejects(() => bundle(f), diagnostic("E_PROJECT_DEPENDENCY"));
});

test("an installed library cannot borrow the application's #imports declaration", async t => {
  const f = fixture(t, {dependencies: {library: "1.0.0"}});
  f.manifest.imports = {"#answer": "./ui/answer.ts"};
  f.write("package.json", f.manifest);
  f.write("ui/answer.ts", "export const answer = 'application private import';");
  installed(f, "library", "exports.answer = require('#answer').answer;");
  f.write("ui/index.ts", "import {answer} from 'library'; globalThis.result = answer;");
  await assert.rejects(() => bundle(f), diagnostic("E_PROJECT_DEPENDENCY"));
});

for (const declared of [false, true]) {
  test("a package #imports external destination " + (declared ? "uses its declared dependency" : "requires its own dependency declaration"), async t => {
    const f = fixture(t, {dependencies: {library: "1.0.0"}});
    const library = installed(f, "library", "exports.answer = require('#leaf').answer;",
      {imports: {"#leaf": "leaf"}, dependencies: declared ? {leaf: "1.0.0"} : {}});
    installed(f, "leaf", "exports.answer = 42;", {parent: library});
    f.write("ui/index.ts", "import {answer} from 'library'; globalThis.result = answer;");
    if (declared) assert.equal((await bundle(f)).context.result, 42);
    else await assert.rejects(() => bundle(f), diagnostic("E_PROJECT_DEPENDENCY"));
  });
}

test("a received dependency manifest must match the package bytes captured at preflight", async t => {
  const f = fixture(t);
  installed(f, "library", "exports.answer = 42;");
  f.write("package.json", {...f.manifest, dependencies: {library: "1.0.0"}});
  await assert.rejects(() => prepare(f), diagnostic("E_PROJECT_CONFIG_CHANGED"));
});

test("received declarations cannot survive removal of the project's package.json", async t => {
  const f = fixture(t, {dependencies: {library: "1.0.0"}});
  installed(f, "library", "exports.answer = 42;");
  fs.rmSync(path.join(f.project, "package.json"));
  await assert.rejects(() => prepare(f), diagnostic("E_PROJECT_CONFIG_CHANGED"));
});

test("the preflight snapshot rejects later changes to the root dependency manifest", async t => {
  const f = fixture(t), prepared = await prepare(f);
  await bundle(f, prepared);
  fs.appendFileSync(path.join(f.project, "package.json"), "\n");
  assert.throws(() => prepared.assertUnchanged(), diagnostic("E_PROJECT_CONFIG_CHANGED"));
});

test("the snapshot guards a nested dependency manifest actually used by the bundle", async t => {
  const f = fixture(t, {dependencies: {library: "1.0.0"}});
  const library = installed(f, "library", "exports.answer = require('leaf').answer;", {dependencies: {leaf: "1.0.0"}});
  const leaf = installed(f, "leaf", "exports.answer = 42;", {parent: library});
  f.write("ui/index.ts", "import {answer} from 'library'; globalThis.result = answer;");
  const result = await bundle(f);
  assert.equal(result.context.result, 42);
  fs.appendFileSync(path.join(f.project, leaf, "package.json"), "\n");
  assert.throws(() => result.resolution.assertUnchanged(), diagnostic("E_PROJECT_CONFIG_CHANGED"));
});

for (const inherited of [false, true]) {
  test("the snapshot records the exact " + (inherited ? "inherited " : "") + "config text delivered to TypeScript during a save", async t => {
    const f = fixture(t);
    const relative = inherited ? "config/base.json" : "tsconfig.json";
    if (inherited) {
      f.write(relative, {compilerOptions: {module: "ESNext", moduleResolution: "Bundler", moduleSuffixes: suffixes}});
      f.write("tsconfig.json", {extends: "./" + relative});
    }
    const target = path.join(f.project, relative);
    const originalReadFile = ts.sys.readFile;
    let saved = false, prepared;
    ts.sys.readFile = (filename, encoding) => {
      const text = originalReadFile(filename, encoding);
      if (path.resolve(filename) === target && !saved) {
        saved = true;
        fs.appendFileSync(target, "\n");
      }
      return text;
    };
    try { prepared = await prepare(f); }
    finally { ts.sys.readFile = originalReadFile; }
    assert.equal(saved, true, "The fixture saves after TypeScript reads the original config text");
    assert.throws(() => prepared.assertUnchanged(), diagnostic("E_PROJECT_CONFIG_CHANGED"));
  });
}

test("the original checker and runtime retain import and require condition modes", async t => {
  const f = fixture(t, {dependencies: {modes: "1.0.0"}, compilerOptions: {module: "Preserve", types: []}});
  const folder = installed(f, "modes", "throw new Error('The unexported main must not execute');");
  const manifest = JSON.parse(fs.readFileSync(path.join(f.project, folder, "package.json"), "utf8"));
  f.write(folder + "/package.json", {...manifest, exports: {".": {
    import: {types: "./import.d.ts", default: "./import.js"},
    require: {types: "./require.d.ts", default: "./require.js"},
  }}});
  for (const mode of ["import", "require"]) {
    f.write(folder + "/" + mode + ".js", "exports.value = '" + mode + "';");
    f.write(folder + "/" + mode + ".d.ts", "export const value: '" + mode + "';");
  }
  f.write("ui/index.ts", "import {value as esm} from 'modes'; import cjs = require('modes');"
    + " const imported: 'import' = esm; const required: 'require' = cjs.value;"
    + " (globalThis as any).result = {esm, cjs: cjs.value};");
  const resolution = await prepare(f);
  assertTypes(resolution);
  const result = await bundle(f, resolution);
  assert.equal(result.context.result.esm, "import");
  assert.equal(result.context.result.cjs, "require");
});

test("scoped package types retain the reserved SDK React identity beside a false nested React", async t => {
  const prefix = "./addons/godot_fabric/toolchain/node_modules/@types/react";
  const f = fixture(t, {dependencies: {library: "1.0.0"}, compilerOptions: {types: [], paths: {
    react: [prefix], "react/*": [prefix + "/*"],
  }}});
  sdkPackages(f);
  originalReactTypes(f);
  const library = installed(f, "library", "exports.React = require('react');", {dependencies: {react: "1.0.0"}});
  declaration(f, library, "export {default as React} from 'react';");
  const spoof = installed(f, "react", "throw new Error('Nested React must remain unused');", {parent: library});
  declaration(f, spoof, "declare const React: {version: number}; export default React;");
  f.write("ui/index.ts", "import React from 'react'; import {React as nested} from 'library';"
    + " const directVersion: string = React.version; const nestedVersion: string = nested.version;"
    + " (globalThis as any).result = {same: React === nested, version: nested.version};");
  const resolution = await prepare(f);
  assertTypes(resolution);
  const result = await bundle(f, resolution);
  assert.equal(result.context.result.same, true);
  assert.equal(result.context.result.version, requireOriginal("react").version);
  assert.ok(!result.inputs.includes(path.join(f.project, spoof, "index.js")));
});

test("effective scoped config preserves inherited JSX and strict:false while exposing strict errors", async t => {
  const f = fixture(t);
  sdkPackages(f);
  originalReactTypes(f);
  f.write("config/base.json", {compilerOptions: {
    module: "ESNext", moduleResolution: "Bundler", moduleSuffixes: suffixes, types: [],
    strict: false, jsx: "react-jsx", paths: {
      leaf: ["../ui/leaf.ts"],
      react: ["../addons/godot_fabric/toolchain/node_modules/@types/react"],
      "react/*": ["../addons/godot_fabric/toolchain/node_modules/@types/react/*"],
    },
  }});
  f.write("tsconfig.json", {extends: "./config/base.json", include: ["ui/**/*"]});
  fs.rmSync(path.join(f.project, "ui/index.ts"));
  f.write("ui/leaf.ts", "export const answer = 'owned JSX';");
  f.entry = "ui/index.tsx";
  f.write(f.entry, "import {answer} from 'leaf'; function identity(value) { return value; }"
    + " (globalThis as any).result = <span>{identity(answer)}</span>;");
  const resolution = await prepare(f);
  assertTypes(resolution);
  const result = await bundle(f, resolution);
  assert.equal(result.context.result.type, "span");
  assert.equal(result.context.result.props.children, "owned JSX");
  const emitted = ts.createSourceFile("bundle.js", result.code, ts.ScriptTarget.Latest);
  const first = emitted.statements[0];
  assert.equal(ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression)
    && first.expression.text === "use strict", false);
  f.write("tsconfig.json", {extends: "./config/base.json", compilerOptions: {strict: true}, include: ["ui/**/*"]});
  assertTypes(await prepare(f), 7006);
});

for (const [module, moduleResolution] of [["NodeNext", "NodeNext"], ["Node16", "Node16"], ["CommonJS", "Bundler"]]) {
  test("an unvalidated module profile is rejected: " + module + "/" + moduleResolution, async t => {
    const f = fixture(t, {compilerOptions: {module, moduleResolution}});
    await assert.rejects(() => prepare(f), diagnostic("E_PROJECT_MODULE_PROFILE"));
  });
}

test("runtime conditions cannot activate the declaration-only types condition", async t => {
  const f = fixture(t, {compilerOptions: {customConditions: ["types"]}});
  await assert.rejects(() => prepare(f), diagnostic("E_PROJECT_CONDITION_PROFILE"));
});

test("a package's default runtime export cannot point to a declaration-only file", async t => {
  const f = fixture(t, {dependencies: {typesOnly: "1.0.0"}});
  const folder = installed(f, "typesOnly", "throw new Error('Unexported fallback must not execute');");
  f.write(folder + "/package.json", {name: "typesOnly", exports: {".": {default: "./runtime.d.ts"}}});
  f.write(folder + "/runtime.d.ts", "export const value: string;");
  f.write("ui/index.ts", "import 'typesOnly'; (globalThis as any).result = 'side effect import';");
  await assert.rejects(() => bundle(f), diagnostic("E_PROJECT_PATH"));
});

test("the typecheck worker accepts the builder's captured config without emitting files", async t => {
  const f = fixture(t, {compilerOptions: {types: []}});
  f.write("ui/index.ts", "export const answer: number = 42;");
  const resolution = await prepare(f);
  const result = checkProjectTypes({project: f.project, sdk: f.sdk,
    expectedConfigFingerprint: resolution.configFingerprint});
  assert.equal(result.errorCount, 0);
  assert.equal(result.configFingerprint, resolution.configFingerprint);
  assert.equal(fs.existsSync(path.join(f.project, "ui/index.js")), false);
});

test("the typecheck worker rejects configuration saved after the builder's preflight", async t => {
  const f = fixture(t, {compilerOptions: {types: []}});
  f.write("ui/index.ts", "export const answer: number = 42;");
  const resolution = await prepare(f);
  fs.appendFileSync(path.join(f.project, "tsconfig.json"), "\n");
  assert.throws(() => checkProjectTypes({project: f.project, sdk: f.sdk,
    expectedConfigFingerprint: resolution.configFingerprint}), diagnostic("E_PROJECT_CONFIG_CHANGED"));
  assert.equal(fs.existsSync(path.join(f.project, "ui/index.js")), false);
});
