import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {build} from "esbuild";
import baseViewConfig, {controlViewConfig, coreEventConfigs} from "../src/base-view-config.js";
import {selectedAdapterInputs, prepareAdapterBuild, SELECTION_FORMAT} from "../sdk/toolchain/adapter-plugin.mjs";
import {platformPlugin} from "../sdk/toolchain/platform-plugin.mjs";
import {preflightAdapters, ADAPTER_FORMAT, ADAPTER_ENTRY_POINT} from "../scripts/adapter-manifest.mjs";
import {generateCodegen} from "../scripts/codegen.mjs";

const repository = fileURLToPath(new URL("../", import.meta.url));
const fixtures = path.join(repository, "tests/codegen");
const combination = JSON.parse(fs.readFileSync(path.join(fixtures, "native-combination.json"), "utf8"));
const requireSdk = createRequire(path.join(repository, "package.json"));
const resolveSdk = id => requireSdk.resolve(id);
const hash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const json = value => JSON.stringify(value, null, 2) + "\n";
const errorCode = code => error => error.code === code;

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "godot-adapter-plugin-"));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return root;
}
function fixture(root, {id = "External", event = "onBadgeActivate", bubbling = false, flow = false} = {}) {
  const name = "adapter-" + id.toLowerCase();
  const packageRoot = path.join(root, "node_modules", name);
  fs.mkdirSync(packageRoot, {recursive: true});
  fs.writeFileSync(path.join(packageRoot, "package.json"), json({name, version: "1.0.0", main: "index.js"}));
  const filename = flow ? "Native" + id + ".js" : id + "NativeComponent.ts";
  const source = flow ? fs.readFileSync(path.join(fixtures, "NativeFlowProbe.js"), "utf8").replaceAll("FlowProbe", id)
    : fs.readFileSync(path.join(fixtures, "BadgeNativeComponent.ts"), "utf8")
      .replaceAll("CodegenBadge", id + "Badge").replaceAll("onActivate", event)
      .replaceAll("DirectEventHandler", bubbling ? "BubblingEventHandler" : "DirectEventHandler")
      + "\nexport const packageMarker = 'named export preserved';\n";
  fs.writeFileSync(path.join(packageRoot, filename), source);
  const generated = path.join(packageRoot, "generated");
  generateCodegen({root: packageRoot, specs: [filename], libraryName: id + "Generated", nativeCombination: combination, out: generated});
  fs.writeFileSync(path.join(packageRoot, "adapter.library"), "opaque build-only bytes");
  const manifest = {format: ADAPTER_FORMAT, id, entryPoint: ADAPTER_ENTRY_POINT,
    library: {path: "adapter.library", sha256: hash(fs.readFileSync(path.join(packageRoot, "adapter.library")))},
    nativeCombination: combination,
    codegenManifest: {path: "generated/manifest.json", sha256: hash(fs.readFileSync(path.join(generated, "manifest.json")))},
    components: flow ? [] : [id + "Badge"], modules: flow ? [id] : [], dependsOn: []};
  fs.writeFileSync(path.join(packageRoot, "adapter.json"), json(manifest));
  return {name, packageRoot, filename, generated, manifest, input: {packageRoot}, source};
}
async function plan(root, packages) {
  const records = await preflightAdapters({adapters: packages.map(pkg => pkg.input), nativeCombination: combination});
  return prepareAdapterBuild({project: root, records, nativeCombination: combination, resolveSdk, coreEventConfigs,
    baseViewConfigPath: path.join(repository, "src/base-view-config.js")});
}
const plugins = plan => [plan.plugin, platformPlugin(path.join(repository, "src"), resolveSdk)];

test("selection is explicit and requires installed project-owned dependency identity", t => {
  const root = project(t), pkg = fixture(root);
  assert.deepEqual(selectedAdapterInputs(root, {}), []);
  const config = {dependencies: {[pkg.name]: "1.0.0"}, godotFabric: {adapters: [{package: pkg.name}]}};
  assert.deepEqual(selectedAdapterInputs(root, config), [{packageRoot: fs.realpathSync(pkg.packageRoot), manifestPath: "adapter.json"}]);
  for (const invalid of [null, {}, {adapters: [], extra: true}, {adapters: [pkg.name]},
    {adapters: [{package: "../escape"}]}, {adapters: [{package: pkg.name, extra: true}]},
    {adapters: [{package: pkg.name}, {package: pkg.name}]}])
    assert.throws(() => selectedAdapterInputs(root, {...config, godotFabric: invalid}), errorCode("E_ADAPTER_SELECTION"));
  assert.throws(() => selectedAdapterInputs(root, {...config, dependencies: {}}), errorCode("E_ADAPTER_DEPENDENCY"));
  fs.writeFileSync(path.join(pkg.packageRoot, "package.json"), json({name: "wrong"}));
  assert.throws(() => selectedAdapterInputs(root, config), errorCode("E_ADAPTER_DEPENDENCY"));
});

test("selection rejects a dependency symlink outside the project", t => {
  const root = project(t), outside = project(t);
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.writeFileSync(path.join(outside, "package.json"), json({name: "escaped"}));
  fs.symlinkSync(outside, path.join(root, "node_modules/escaped"));
  assert.throws(() => selectedAdapterInputs(root, {dependencies: {escaped: "1"}, godotFabric: {adapters: [{package: "escaped"}]}}),
    errorCode("E_ADAPTER_PROJECT_PATH"));
});

test("original TS Codegen runs before type erasure, preserving named exports and generated Commands", async t => {
  const root = project(t), pkg = fixture(root), prepared = await plan(root, [pkg]);
  const before = fs.readFileSync(path.join(pkg.packageRoot, pkg.filename));
  const result = await build({entryPoints: [path.join(pkg.packageRoot, pkg.filename)], bundle: false, write: false,
    format: "cjs", plugins: [prepared.plugin]});
  const output = result.outputFiles[0].text;
  assert.match(output, /__INTERNAL_VIEW_CONFIG/);
  assert.match(output, /NativeComponentRegistry\.get\(nativeComponentName/);
  assert.match(output, /topBadgeActivate/);
  assert.match(output, /dispatchCommand\(ref, "focus", \[\]\)/);
  assert.match(output, /named export preserved/);
  assert.doesNotMatch(output, /codegenNativeComponent</);
  assert.deepEqual(fs.readFileSync(path.join(pkg.packageRoot, pkg.filename)), before);
  assert.equal(prepared.specCount, 1);
});

test("approved Flow module spec keeps original registry access and never executes package code", async t => {
  const root = project(t), pkg = fixture(root, {id: "FlowExternal", flow: true});
  const prepared = await plan(root, [pkg]);
  const result = await build({entryPoints: [path.join(pkg.packageRoot, pkg.filename)], bundle: false, write: false,
    format: "cjs", plugins: [prepared.plugin]});
  assert.match(result.outputFiles[0].text, /TurboModuleRegistry\.getEnforcing\("FlowExternal"\)/);
  assert.doesNotMatch(result.outputFiles[0].text, /interface Spec/);
});

test("public Codegen signatures and deep spec types resolve through the SDK identity", t => {
  const root = project(t), pkg = fixture(root);
  const filename = path.join(pkg.packageRoot, pkg.filename);
  fs.writeFileSync(filename, pkg.source.replace(
    "import type {HostComponent, ViewProps} from 'react-native';",
    "import {codegenNativeComponent as publicComponent, codegenNativeCommands as publicCommands} from 'react-native';\nimport type {HostComponent, ViewProps} from 'react-native';")
    + "\nconst originalComponent: typeof codegenNativeComponent = publicComponent;\nconst originalCommands: typeof codegenNativeCommands = publicCommands;\n");
  const ts = requireSdk("typescript");
  const program = ts.createProgram([filename], {noEmit: true, strict: true, skipLibCheck: true,
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: [], paths: {
      react: [path.join(repository, "node_modules/@types/react")],
      "react/*": [path.join(repository, "node_modules/@types/react/*")],
      "react-native": [path.join(repository, "types/react-native.ts")],
      "react-native/*": [path.join(repository, "node_modules/react-native/types_generated/*")],
    }});
  const errors = ts.getPreEmitDiagnostics(program);
  assert.equal(errors.length, 0, ts.formatDiagnostics(errors, {
    getCurrentDirectory: () => root, getCanonicalFileName: name => name, getNewLine: () => "\n"}));
});

test("static config uses the Godot base through the original ViewConfig composer", async t => {
  const root = project(t), prepared = await plan(root, []);
  const result = await build({stdin: {contents: 'import {createViewConfig} from "react-native/Libraries/NativeComponent/ViewConfig"; export const config=createViewConfig({uiViewClassName:"Probe",validAttributes:{caption:true},directEventTypes:{topBadgeActivate:{registrationName:"onBadgeActivate"}}});',
    resolveDir: root}, bundle: true, write: false, format: "cjs", metafile: true, plugins: plugins(prepared)});
  assert.ok(!Object.keys(result.metafile.inputs).some(filename => filename.endsWith("/NativeComponent/BaseViewConfig.js")));
  const module = {exports: {}};
  vm.runInNewContext(result.outputFiles[0].text, {module, exports: module.exports});
  const config = module.exports.config;
  assert.equal(config.uiViewClassName, "Probe");
  assert.equal(config.validAttributes.caption, true);
  assert.equal(config.validAttributes.testID, true);
  assert.equal(config.validAttributes.nativeID, true);
  assert.equal(config.validAttributes.pointerEvents, true);
  assert.equal(typeof config.validAttributes.style.backgroundColor.process, "function");
  assert.equal(config.directEventTypes.topBadgeActivate.registrationName, "onBadgeActivate");
  assert.equal(config.directEventTypes.topLayout.registrationName, "onLayout");
  assert.equal(config.bubblingEventTypes.topTouchStart.phasedRegistrationNames.bubbled, "onTouchStart");
  assert.equal(config.bubblingEventTypes.topActivate, undefined);
  assert.equal(baseViewConfig.validAttributes.kind, undefined);
  assert.equal(controlViewConfig.bubblingEventTypes.topActivate.phasedRegistrationNames.bubbled, "onActivate");
});

test("direct/bubbling collisions against core and other selected adapters fail before bundling", async t => {
  const root = project(t), coreCollision = fixture(root, {id: "CoreCollision", event: "onActivate"});
  await assert.rejects(() => plan(root, [coreCollision]), errorCode("E_ADAPTER_EVENT_COLLISION"));
  const direct = fixture(root, {id: "Direct", event: "onShared"});
  const bubble = fixture(root, {id: "Bubble", event: "onShared", bubbling: true});
  await assert.rejects(() => plan(root, [direct, bubble]), errorCode("E_ADAPTER_EVENT_COLLISION"));
  const scroll = fixture(root, {id: "ScrollCollision", event: "onScroll", bubbling: true});
  await assert.rejects(() => plan(root, [scroll]), errorCode("E_ADAPTER_EVENT_COLLISION"));
});

test("identical global event signatures remain compatible across native components", async t => {
  const root = project(t), a = fixture(root, {id: "First", event: "onShared"}), b = fixture(root, {id: "Second", event: "onShared"});
  assert.equal((await plan(root, [a, b])).specCount, 2);
});

test("unselected typed specs and specs changed after preflight are rejected", async t => {
  const root = project(t), pkg = fixture(root), prepared = await plan(root, []);
  await assert.rejects(() => build({entryPoints: [path.join(pkg.packageRoot, pkg.filename)], write: false, logLevel: "silent", plugins: [prepared.plugin]}),
    /E_ADAPTER_SPEC_UNSELECTED/);
  const approved = await plan(root, [pkg]);
  fs.appendFileSync(path.join(pkg.packageRoot, pkg.filename), "\n// changed\n");
  await assert.rejects(() => build({entryPoints: [path.join(pkg.packageRoot, pkg.filename)], write: false, logLevel: "silent", plugins: [approved.plugin]}),
    /E_ADAPTER_BUILD_CHANGED/);
});

test("selection packet links bundle to original package manifests and all transitively verified bytes", async t => {
  const root = project(t), pkg = fixture(root), prepared = await plan(root, [pkg]);
  const packet = prepared.selectionPacket(".godot_fabric/app.js", "a".repeat(64));
  assert.deepEqual(Object.keys(packet).sort(), ["adapters", "bundle", "format", "nativeCombination"]);
  assert.equal(packet.format, SELECTION_FORMAT);
  assert.deepEqual(packet.bundle, {path: ".godot_fabric/app.js", sha256: "a".repeat(64)});
  assert.deepEqual(packet.nativeCombination, combination);
  assert.deepEqual(packet.adapters, [{packageRoot: "node_modules/" + pkg.name,
    manifest: {path: "adapter.json", sha256: hash(fs.readFileSync(path.join(pkg.packageRoot, "adapter.json")))}}]);
  assert.throws(() => prepared.selectionPacket("../escaped.js", "a".repeat(64)), errorCode("E_ADAPTER_PROJECT_PATH"));
  assert.throws(() => prepared.selectionPacket(".godot_fabric/app.js", "bad"), errorCode("E_ADAPTER_SELECTION"));
  const artifacts = JSON.parse(fs.readFileSync(path.join(pkg.generated, "manifest.json"))).artifacts;
  const files = [path.join(pkg.packageRoot, "adapter.json"), path.join(pkg.packageRoot, "adapter.library"),
    path.join(pkg.generated, "manifest.json"), path.join(pkg.generated, "schema.json"),
    path.join(pkg.packageRoot, pkg.filename), path.join(pkg.generated, artifacts[0].path)];
  for (const filename of files) {
    const original = fs.readFileSync(filename);
    fs.appendFileSync(filename, "\n");
    assert.throws(() => prepared.selectionPacket(".godot_fabric/app.js", "a".repeat(64)), errorCode("E_ADAPTER_BUILD_CHANGED"));
    fs.writeFileSync(filename, original);
  }
  assert.equal((await plan(root, [])).selectionPacket(".godot_fabric/app.js", "a".repeat(64)), null);
});
