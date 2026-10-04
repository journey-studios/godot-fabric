import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {build} from "esbuild";
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
async function compile(directory, entry) {
  return build({absWorkingDir: directory, entryPoints: [entry], bundle: true,
    write: false, format: "cjs", platform: "neutral", metafile: true, plugins: plugins()});
}
function execute(result) {
  const module = {exports: {}};
  vm.runInNewContext(result.outputFiles[0].text, {module, exports: module.exports});
  return module.exports;
}

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
