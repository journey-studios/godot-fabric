import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {build} from "esbuild";
import {parseSync, transformFromAstSync} from "@babel/core";
import {controlViewConfig} from "../src/base-view-config.js";
import {platformPlugin} from "../sdk/toolchain/platform-plugin.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const requireSdk = createRequire(path.join(root, "package.json"));
const plugins = () => [platformPlugin(path.join(root, "src"), id => requireSdk.resolve(id))];
function fixture(t, files) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "godot-platform-seams-")));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  for (const [name, contents] of Object.entries(files)) {
    const filename = path.join(directory, name);
    fs.mkdirSync(path.dirname(filename), {recursive: true});
    fs.writeFileSync(filename, contents);
  }
  return directory;
}
async function compile(directory, entry, options = {}) {
  return build({absWorkingDir: directory, entryPoints: [entry], bundle: true,
    write: false, format: "cjs", platform: "neutral", mainFields: ["main"],
    define: {"process.env.NODE_ENV": '"production"'}, metafile: true, plugins: plugins(), ...options});
}
function execute(result, globals = {}) {
  const module = {exports: {}};
  vm.runInNewContext(result.outputFiles[0].text, {module, exports: module.exports, ...globals});
  return module.exports;
}

test("only RN's original lists resolve RN's unexported feature flags", async t => {
  // The public FlatList reaches @react-native/virtualized-lists, whose
  // VirtualizedList imports ReactNativeFeatureFlags by a deep RN path.
  const lists = fixture(t, {"App.js": 'import {FlatList} from "react-native"; export default FlatList;'});
  const inputs = Object.keys((await compile(lists, "App.js")).metafile.inputs);
  for (const suffix of ["node_modules/@react-native/virtualized-lists/Lists/VirtualizedList.js",
    "node_modules/react-native/src/private/featureflags/ReactNativeFeatureFlags.js", "src/lists.js"])
    assert.ok(inputs.some(input => input.endsWith(suffix)), suffix);
  // Project code keeps RN's package exports, which do not expose the module.
  const project = fixture(t, {
    "App.js": 'import flags from "react-native/src/private/featureflags/ReactNativeFeatureFlags"; export default flags;',
  });
  await assert.rejects(compile(project, "App.js", {logLevel: "silent"}), /is not defined by "exports"/);
});

test("project modules named like RN native seams retain their own implementation", async t => {
  const names = ["Utilities/Platform", "ReactNative/UIManager", "ReactNative/RendererProxy", "BatchedBridge/NativeModules"];
  const files = Object.fromEntries(names.map(name => [name + ".js", 'export default "owned:' + name + '";']));
  files["App.js"] = names.map((name, index) => `import value${index} from "./${name}";`).join("\n")
    + `\nexport default [${names.map((_, index) => "value" + index).join(",")}];`;
  const directory = fixture(t, files);
  const result = await compile(directory, "App.js");
  assert.deepEqual(Array.from(execute(result).default), names.map(name => "owned:" + name));
  const inputs = Object.keys(result.metafile.inputs);
  for (const name of names) assert.ok(inputs.includes(name + ".js"));
  assert.equal(inputs.length, names.length + 1);
});

test("RN's RCTNetworking resolves to its Android wrapper and a project's own module of that name stays", async t => {
  // RN ships the wrapper only as .ios.js and .android.js; RCTNetworking.js merely imports itself, and this host's
  // extensions pick neither platform file. The Android wrapper is the one whose contract the Godot module implements.
  const rn = fixture(t, {"App.js": 'import Networking from "react-native/Libraries/Network/RCTNetworking"; export default Networking;'});
  const inputs = Object.keys((await compile(rn, "App.js")).metafile.inputs);
  assert.ok(inputs.some(input => input.endsWith("node_modules/react-native/Libraries/Network/RCTNetworking.android.js")));
  assert.ok(!inputs.some(input => input.endsWith("node_modules/react-native/Libraries/Network/RCTNetworking.js")));
  const project = fixture(t, {"RCTNetworking.js": 'export default "owned";', "App.js": 'import value from "./RCTNetworking"; export default value;'});
  const result = await compile(project, "App.js");
  assert.equal(execute(result).default, "owned");
  assert.equal(Object.keys(result.metafile.inputs).length, 2);
});

test("a project AppRegistryImpl and renderApplication do not become original RN hooks", async t => {
  const directory = fixture(t, {
    "ReactNative/AppRegistryImpl.js": 'import render from "./renderApplication"; export default render();',
    "ReactNative/renderApplication.js": 'export default () => "project renderer preserved";',
  });
  const result = await compile(directory, "ReactNative/AppRegistryImpl.js");
  assert.equal(execute(result).default, "project renderer preserved");
  assert.equal(Object.keys(result.metafile.inputs).length, 2);
});

test("an exact public RN Platform deep import still selects the Godot seam", async t => {
  const directory = fixture(t, {
    "App.js": 'import Platform from "react-native/Libraries/Utilities/Platform"; export default Platform.OS;',
  });
  const result = await compile(directory, "App.js");
  assert.equal(execute(result).default, "godot");
  assert.ok(Object.keys(result.metafile.inputs).some(input => input.endsWith("src/platform.js")));
});

test("a project ViewConfig and PlatformBaseViewConfig keep their own implementation", async t => {
  const directory = fixture(t, {
    "NativeComponent/ViewConfig.js": 'import base from "./PlatformBaseViewConfig"; export default base;',
    "NativeComponent/PlatformBaseViewConfig.js": 'export default "project base view config";',
  });
  const result = await compile(directory, "NativeComponent/ViewConfig.js");
  assert.equal(execute(result).default, "project base view config");
  assert.deepEqual(Object.keys(result.metafile.inputs).sort(), [
    "NativeComponent/PlatformBaseViewConfig.js", "NativeComponent/ViewConfig.js",
  ]);
});

test("an exact public RN PlatformBaseViewConfig import selects the Godot base config", async t => {
  const directory = fixture(t, {
    "App.js": 'import base from "react-native/Libraries/NativeComponent/PlatformBaseViewConfig"; export default base;',
  });
  const result = await compile(directory, "App.js");
  const base = execute(result).default;
  assert.equal(base.validAttributes.pointerEvents, true);
  assert.equal(base.validAttributes.style.zIndex, true);
  assert.equal(base.validAttributes.kind, undefined);
  // The host synthesizes click like RN's platforms; without this registration
  // the legacy plugin rejects every topClick as an unsupported event type.
  const click = base.bubblingEventTypes.topClick.phasedRegistrationNames;
  assert.deepEqual([click.bubbled, click.captured, click.skipBubbling], ["onClick", "onClickCapture", undefined]);
  assert.equal(base.validAttributes.onClick, true);
  assert.equal(base.validAttributes.onClickCapture, true);
  assert.ok(Object.keys(result.metafile.inputs).some(input => input.endsWith("src/base-view-config.js")));
});

test("original RN ViewConfig composes the Godot base config without the adapter plugin", async t => {
  const directory = fixture(t, {
    "App.js": 'import {createViewConfig} from "react-native/Libraries/NativeComponent/ViewConfig"; '
      + 'export default createViewConfig({uiViewClassName: "RCTView", validAttributes: {fixtureProp: true}});',
  });
  const result = await compile(directory, "App.js");
  const config = execute(result).default;
  assert.equal(config.uiViewClassName, "RCTView");
  assert.equal(config.validAttributes.fixtureProp, true);
  assert.equal(config.validAttributes.pointerEvents, true);
  assert.equal(config.validAttributes.style.zIndex, true);
  assert.equal(config.bubblingEventTypes.topTouchStart.phasedRegistrationNames.bubbled, "onTouchStart");
  assert.equal(config.validAttributes.kind, undefined);
  const inputs = Object.keys(result.metafile.inputs);
  assert.ok(inputs.some(input => input.endsWith("react-native/Libraries/NativeComponent/ViewConfig.js")));
  assert.ok(inputs.some(input => input.endsWith("src/base-view-config.js")));
  assert.ok(!inputs.some(input => input.endsWith("react-native/Libraries/NativeComponent/PlatformBaseViewConfig.js")));
});

test("original RN transform processors reach the composed ViewConfig without losing ordered array or origin syntax", async t => {
  const directory = fixture(t, {
    "App.js": 'import {createViewConfig} from "react-native/Libraries/NativeComponent/ViewConfig"; '
      + 'export {default as originalTransform} from "react-native/Libraries/StyleSheet/processTransform"; '
      + 'export {default as originalOrigin} from "react-native/Libraries/StyleSheet/processTransformOrigin"; '
      + 'export default createViewConfig({uiViewClassName: "RCTView"});',
  });
  const result = await compile(directory, "App.js");
  const {default: config, originalTransform, originalOrigin} = execute(result, {__DEV__: false});
  const processTransform = config.validAttributes.style.transform.process;
  const processOrigin = config.validAttributes.style.transformOrigin.process;
  const plain = value => JSON.parse(JSON.stringify(value));
  const ordered = [{translateX: "25%"}, {scaleX: 2}, {rotate: "45deg"}, {skewY: "10deg"}];
  assert.equal(processTransform(ordered), ordered);
  assert.equal(processTransform(ordered), originalTransform(ordered));
  const css = "translateX(24px) rotate(90deg) scale(1.5)";
  assert.deepEqual(plain(processTransform(css)), [
    {translateX: 24}, {rotate: "90deg"}, {scale: 1.5},
  ]);
  assert.deepEqual(plain(processTransform(css)), plain(originalTransform(css)));
  const origin = [20, "75%", 0];
  assert.equal(processOrigin(origin), origin);
  assert.equal(processOrigin(origin), originalOrigin(origin));
  assert.deepEqual(plain(processOrigin("left top")), [0, 0, 0]);
  assert.deepEqual(plain(processOrigin("25% 75% 0px")), ["25%", "75%", 0]);
  assert.deepEqual(plain(processOrigin("25% 75% 0px")), plain(originalOrigin("25% 75% 0px")));
  // Recognition here is not native 3D support: the unchanged payload reaches
  // native validation instead of being silently filtered by this config.
  const unsupportedNative3D = [{rotateX: "45deg"}, {perspective: 800}];
  assert.equal(processTransform(unsupportedNative3D), unsupportedNative3D);
  const debugStyle = execute(result, {__DEV__: true}).default.validAttributes.style;
  assert.throws(() => debugStyle.transform.process([{rotate: "45"}]), /degrees|radians/);
  assert.throws(() => debugStyle.transformOrigin.process([20, "75%"]), /exactly 3 values/);
  const inputs = Object.keys(result.metafile.inputs);
  for (const suffix of ["react-native/Libraries/NativeComponent/ViewConfig.js",
    "react-native/Libraries/StyleSheet/processTransform.js",
    "react-native/Libraries/StyleSheet/processTransformOrigin.js", "src/base-view-config.js"])
    assert.ok(inputs.some(input => input.endsWith(suffix)), suffix);
});

test("project-owned ViewConfig and similarly named transform processors keep their own behavior", async t => {
  const directory = fixture(t, {
    "NativeComponent/ViewConfig.js": 'import base from "./PlatformBaseViewConfig"; export default base;',
    "NativeComponent/PlatformBaseViewConfig.js": 'import transform from "../StyleSheet/processTransform"; '
      + 'import origin from "../StyleSheet/processTransformOrigin"; '
      + 'export default {validAttributes: {style: {transform: {process: transform}, transformOrigin: {process: origin}}}};',
    "StyleSheet/processTransform.js": 'export default value => "project-transform:" + value;',
    "StyleSheet/processTransformOrigin.js": 'export default value => "project-origin:" + value;',
  });
  const result = await compile(directory, "NativeComponent/ViewConfig.js");
  const style = execute(result).default.validAttributes.style;
  assert.equal(style.transform.process("rotate(45deg)"), "project-transform:rotate(45deg)");
  assert.equal(style.transformOrigin.process("left top"), "project-origin:left top");
  assert.deepEqual(Object.keys(result.metafile.inputs).sort(), [
    "NativeComponent/PlatformBaseViewConfig.js", "NativeComponent/ViewConfig.js",
    "StyleSheet/processTransform.js", "StyleSheet/processTransformOrigin.js",
  ]);
});

test("the public style validator forwards transforms and still rejects unrelated unsupported styles", () => {
  // Execute the actual validator and its actual StyleSheet dependency without
  // mounting React or substituting a renderer merely to test style validation.
  const filename = path.join(root, "src/react-native-platform.jsx");
  const ast = parseSync(fs.readFileSync(filename, "utf8"), {
    filename, configFile: false, babelrc: false, parserOpts: {plugins: ["jsx"]},
  });
  const stylesheet = ast.program.body.find(node => node.type === "ExportNamedDeclaration"
    && node.declaration?.declarations?.some(declaration => declaration.id.name === "StyleSheet"));
  const validator = ast.program.body.find(node => node.type === "FunctionDeclaration" && node.id.name === "nativeStyle");
  assert.ok(stylesheet && validator);
  const selected = {...ast, program: {...ast.program, body: [stylesheet.declaration, validator]}};
  const {code} = transformFromAstSync(selected, undefined, {configFile: false, babelrc: false});
  const nativeStyle = vm.runInNewContext(code + "\nnativeStyle;", {controlViewConfig, textStyleAttributes: []});
  const style = {transform: [{translateX: "25%"}, {rotate: "45deg"}], transformOrigin: "left top"};
  assert.equal(nativeStyle(style, "View"), style);
  for (const name of ["filter", "elevation", "perspective"])
    assert.throws(() => nativeStyle([style, {[name]: 2}], "View"),
      new RegExp("Godot View does not implement style " + name));
  assert.throws(() => nativeStyle({borderStyle: "dashed"}, "View"), /solid borders only/);
});


test("native IDs reach original attribute payloads and public View keeps the original ID mapping", async t => {
  const directory = fixture(t, {
    "App.js": 'import {createViewConfig} from "react-native/Libraries/NativeComponent/ViewConfig"; '
      + 'export {create, diff} from "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload"; '
      + 'export default createViewConfig({uiViewClassName: "RCTView"});',
  });
  const result = await compile(directory, "App.js");
  const {default: config, create, diff} = execute(result, {__DEV__: false});
  const plain = value => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(create({nativeID: "panel", unknownAttribute: "ignored"}, config.validAttributes)), {nativeID: "panel"});
  assert.deepEqual(plain(diff({nativeID: "panel"}, {nativeID: "updated"}, config.validAttributes)), {nativeID: "updated"});
  assert.deepEqual(plain(diff({nativeID: "updated"}, {}, config.validAttributes)), {nativeID: null});
  assert.equal(create({nativeID: "same"}, {}), null);
  // Inspect the actual compiled public entrypoint dependency graph; the runtime
  // fixture independently verifies ID precedence, lookup and mount behavior.
  const publicEntry = fixture(t, {"Public.js": 'export {View} from "react-native";'});
  const publicResult = await compile(publicEntry, "Public.js");
  assert.ok(Object.keys(publicResult.metafile.inputs).some(input => input.endsWith("react-native/Libraries/Components/View/View.js")));
});

test("the Godot focus bridge retains original TextInputState guards and singleton", async t => {
  const directory = fixture(t, {"App.js":
    `export {default as state} from ${JSON.stringify(path.join(root, "src/text-input-state.js"))};\n`
    + 'export {default as original} from "react-native/Libraries/Components/TextInput/TextInputState";'});
  // Spy only at the renderer command boundary. The registry, focus guard and
  // codegen command functions themselves are the pinned upstream modules.
  const result = await build({absWorkingDir: directory, entryPoints: ["App.js"], bundle: true,
    write: false, format: "cjs", platform: "neutral", mainFields: ["main"],
    define: {"process.env.NODE_ENV": '"production"', __DEV__: "false"}, metafile: true,
    plugins: [{name: "command-boundary-spy", setup(builder) {
      builder.onLoad({filter: /\/src\/renderer-proxy\.js$/}, () => ({contents:
        'export function dispatchCommand(ref, name, args) { globalThis.commandCalls.push({ref, name, args}); } '
        + 'export function findNodeHandle(ref) { return ref?.tag ?? null; }', loader: "js"}));
    }}, ...plugins()]});
  const commandCalls = [];
  const host = {RN$Bridgeless: true,
    nativeModuleProxy: {
      SourceCode: {getConstants: () => ({scriptURL: "file:///unit-fixture.js"})},
      DeviceInfo: {getConstants: () => ({Dimensions: {
        window: {width: 800, height: 600, scale: 1, fontScale: 1},
        screen: {width: 800, height: 600, scale: 1, fontScale: 1},
      }})},
    },
    RN$registerCallableModule() {}};
  const {state, original} = execute(result, {commandCalls, global: host, ...host});
  assert.equal(state, original);
  const first = {tag: 101, currentProps: {editable: true}};
  const second = {tag: 103, currentProps: {editable: true}};
  const readonly = {tag: 105, currentProps: {editable: false}};
  state.registerInput(first);
  assert.equal(original.isTextInput(first), true);
  state.focusTextInput(first);
  assert.equal(original.currentlyFocusedInput(), first);
  assert.equal(state.currentlyFocusedField(), 101);
  for (const field of [first, readonly, null, undefined, 101]) state.focusTextInput(field);
  state.blurTextInput(second);
  assert.equal(commandCalls.length, 1);
  state.focusTextInput(second);
  state.blurTextInput(first);
  assert.equal(commandCalls.length, 2);
  state.blurTextInput(second);
  state.blurTextInput(second);
  assert.equal(state.currentlyFocusedInput(), null);
  assert.equal(state.currentlyFocusedField(), null);
  assert.deepEqual(commandCalls.map(call => [call.ref.tag, call.name, Array.from(call.args)]),
    [[101, "focus", []], [103, "focus", []], [103, "blur", []]]);
  state.unregisterInput(first);
  assert.equal(original.isTextInput(first), false);
  for (const suffix of ["react-native/Libraries/Components/TextInput/TextInputState.js",
    "react-native/Libraries/Utilities/codegenNativeCommands.js", "src/text-input-state.js"])
    assert.ok(Object.keys(result.metafile.inputs).some(input => input.endsWith(suffix)), suffix);
});

test("public Switch is RN's original Switch.js over the generated RCTSwitch ViewConfig and setValue command", async t => {
  const directory = fixture(t, {"App.js":
    'export {default as Native, Commands} from "react-native/Libraries/Components/Switch/SwitchNativeComponent";\n'
    + 'export {get as viewConfig, customBubblingEventTypes} from "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry";'});
  // RN's codegen Babel plugin compiles the original spec. The static ViewConfig
  // path never reads the legacy UIManager; commands stop at the renderer seam.
  const result = await build({absWorkingDir: directory, entryPoints: ["App.js"], bundle: true,
    write: false, format: "cjs", platform: "neutral", mainFields: ["main"],
    define: {"process.env.NODE_ENV": '"production"', __DEV__: "false"}, metafile: true,
    plugins: [{name: "switch-boundaries", setup(builder) {
      builder.onLoad({filter: /\/src\/ui-manager\.js$/}, () => ({contents:
        'export default new Proxy({}, {get(_, name) { throw new Error("legacy UIManager." + String(name)); }});', loader: "js"}));
      builder.onLoad({filter: /\/src\/renderer-proxy\.js$/}, () => ({contents:
        'export function dispatchCommand(ref, name, args) { globalThis.commandCalls.push({ref, name, args}); }', loader: "js"}));
    }}, ...plugins()]});
  const commandCalls = [];
  const host = {RN$Bridgeless: true, nativeModuleProxy: {
    SourceCode: {getConstants: () => ({scriptURL: "file:///unit-fixture.js"})},
    DeviceInfo: {getConstants: () => ({Dimensions: {
      window: {width: 800, height: 600, scale: 1, fontScale: 1},
      screen: {width: 800, height: 600, scale: 1, fontScale: 1},
    }})},
  }, RN$registerCallableModule() {}};
  const {Native, Commands, viewConfig, customBubblingEventTypes} = execute(result, {commandCalls, global: host, ...host});
  assert.equal(Native, "RCTSwitch");
  const config = viewConfig("RCTSwitch");
  assert.equal(config.uiViewClassName, "RCTSwitch");
  assert.ok(config.validAttributes.disabled === true && config.validAttributes.value === true);
  for (const name of ["tintColor", "onTintColor", "thumbTintColor", "thumbColor", "trackColorForFalse", "trackColorForTrue"]) {
    assert.equal(typeof config.validAttributes[name].process("#ff3b30"), "number", name);
  }
  // Only the iOS ViewConfig lists onChange as an attribute; it is still an event.
  assert.equal(config.validAttributes.onChange, undefined);
  assert.deepEqual(Object.keys(config.validAttributes.style).sort(), Object.keys(controlViewConfig.validAttributes.style).sort());
  assert.deepEqual({...config.bubblingEventTypes.topChange.phasedRegistrationNames}, {captured: "onChangeCapture", bubbled: "onChange"});
  assert.ok(config.bubblingEventTypes.topTouchStart && config.directEventTypes.topLayout);
  assert.equal(customBubblingEventTypes.topChange, config.bubblingEventTypes.topChange);
  Commands.setValue({tag: 7}, false);
  assert.deepEqual(commandCalls.map(call => [call.ref.tag, call.name, Array.from(call.args)]), [[7, "setValue", [false]]]);
  const publicEntry = fixture(t, {"Public.js": 'export {Switch} from "react-native";'});
  const inputs = Object.keys((await compile(publicEntry, "Public.js")).metafile.inputs);
  for (const suffix of ["react-native/Libraries/Components/Switch/Switch.js",
    "react-native/src/private/components/switch/specs/SwitchNativeComponent.js"]) {
    assert.ok(inputs.some(input => input.endsWith(suffix)), suffix);
  }
});

test("public ActivityIndicator is RN's original module over the generated RCTActivityIndicatorView ViewConfig", async t => {
  const directory = fixture(t, {"App.js":
    'export {default as Native} from "react-native/Libraries/Components/ActivityIndicator/ActivityIndicatorViewNativeComponent";\n'
    + 'export {get as viewConfig} from "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry";'});
  // RN's codegen Babel plugin compiles the original spec; the static ViewConfig
  // path never reads the legacy UIManager.
  const result = await build({absWorkingDir: directory, entryPoints: ["App.js"], bundle: true,
    write: false, format: "cjs", platform: "neutral", mainFields: ["main"],
    define: {"process.env.NODE_ENV": '"production"', __DEV__: "false"}, metafile: true,
    plugins: [{name: "indicator-boundaries", setup(builder) {
      builder.onLoad({filter: /\/src\/ui-manager\.js$/}, () => ({contents:
        'export default new Proxy({}, {get(_, name) { throw new Error("legacy UIManager." + String(name)); }});', loader: "js"}));
    }}, ...plugins()]});
  const host = {RN$Bridgeless: true, nativeModuleProxy: {
    SourceCode: {getConstants: () => ({scriptURL: "file:///unit-fixture.js"})},
    DeviceInfo: {getConstants: () => ({Dimensions: {
      window: {width: 800, height: 600, scale: 1, fontScale: 1},
      screen: {width: 800, height: 600, scale: 1, fontScale: 1},
    }})},
  }, RN$registerCallableModule() {}};
  const {Native, viewConfig} = execute(result, {global: host, ...host});
  assert.equal(Native, "RCTActivityIndicatorView");
  const config = viewConfig("RCTActivityIndicatorView");
  assert.equal(config.uiViewClassName, "RCTActivityIndicatorView");
  for (const name of ["hidesWhenStopped", "animating", "size"]) {
    assert.equal(config.validAttributes[name], true, name);
  }
  assert.equal(typeof config.validAttributes.color.process("#999999"), "number");
  assert.deepEqual(Object.keys(config.validAttributes.style).sort(), Object.keys(controlViewConfig.validAttributes.style).sort());
  assert.ok(config.bubblingEventTypes.topTouchStart && config.directEventTypes.topLayout);
  const publicEntry = fixture(t, {"Public.js": 'export {ActivityIndicator} from "react-native";'});
  const inputs = Object.keys((await compile(publicEntry, "Public.js")).metafile.inputs);
  for (const suffix of ["react-native/Libraries/Components/ActivityIndicator/ActivityIndicator.js",
    "react-native/src/private/components/activityindicator/specs/ActivityIndicatorViewNativeComponent.js"]) {
    assert.ok(inputs.some(input => input.endsWith(suffix)), suffix);
  }
});
