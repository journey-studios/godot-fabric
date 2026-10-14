import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {build} from "esbuild";
import ts from "typescript";
import {platformPlugin} from "../sdk/toolchain/platform-plugin.mjs";

// GF-03, root names: `ReactNativeVersion` is RN's own class, exported by the facade (src/react-native-platform.jsx), and the
// version that Platform.constants reports (src/platform.js) is read from that class, not written twice.
//
// The whole facade needs the Hermes and Fabric bindings of the native host (src/initialize.js refuses to start without them), so a
// Node test cannot run it. This one bundles the facade as the platform plugin of the SDK resolves `react-native`, with the file
// cut down to its own export statements for the two names under test, read from the file, and runs that bundle in a vm. The
// export statements are the facade's, so a wrapper or a copy in the facade shows as a different object.
const root = fileURLToPath(new URL("../", import.meta.url));
const requireSdk = createRequire(path.join(root, "package.json"));
const installed = JSON.parse(fs.readFileSync(requireSdk.resolve("react-native/package.json"), "utf8")).version;
const facadeFile = path.join(root, "src/react-native-platform.jsx");

// The facade's export statements that name one of `names`, as the file writes them.
function exportStatements(names) {
  const contents = fs.readFileSync(facadeFile, "utf8");
  const source = ts.createSourceFile("react-native-platform.jsx", contents, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  const found = source.statements.filter((statement) => ts.isExportDeclaration(statement) && statement.exportClause !== undefined
    && ts.isNamedExports(statement.exportClause) && statement.exportClause.elements.some((element) => names.includes(element.name.text)));
  assert.equal(found.length, names.length, `the facade has one export statement for each of ${names.join(", ")}`);
  return found.map((statement) => statement.getText(source)).join("\n");
}

const entry = [
  'export {ReactNativeVersion, Platform} from "react-native";',
  'export {default as Original} from "react-native/Libraries/Core/ReactNativeVersion";',
].join("\n");
async function bundle(t, extraPlugins = []) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "godot-rn-version-")));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  fs.writeFileSync(path.join(directory, "App.js"), entry);
  const facade = {name: "facade-exports-under-test", setup(builder) {
    builder.onLoad({filter: /\/src\/react-native-platform\.jsx$/}, ({path: filename}) => filename === facadeFile
      ? {loader: "jsx", resolveDir: path.dirname(facadeFile), contents: exportStatements(["ReactNativeVersion", "Platform"])}
      : undefined);
  }};
  const result = await build({absWorkingDir: directory, entryPoints: ["App.js"], bundle: true, write: false, format: "cjs",
    platform: "neutral", mainFields: ["main"], define: {"process.env.NODE_ENV": '"production"', __DEV__: "false"},
    plugins: [facade, ...extraPlugins, platformPlugin(path.join(root, "src"), (id) => requireSdk.resolve(id))]});
  const module = {exports: {}};
  vm.runInNewContext(result.outputFiles[0].text, {module, exports: module.exports});
  return module.exports;
}
const parts = (version) => {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(version);
  assert.ok(match, `${version} is a semver version`);
  return {major: parseInt(match[1], 10), minor: parseInt(match[2], 10), patch: parseInt(match[3], 10)};
};
const plain = (value) => JSON.parse(JSON.stringify(value));

test("the facade exports RN's own ReactNativeVersion, whose version is the installed react-native's", async (t) => {
  const {ReactNativeVersion, Original} = await bundle(t);
  // The identity of RN's module in the same bundle: no wrapper, no copy.
  assert.equal(typeof Original, "function");
  assert.equal(ReactNativeVersion, Original);
  // The installed version comes from the package, not from this test.
  assert.equal(ReactNativeVersion.getVersionString(), installed);
  assert.deepEqual({major: ReactNativeVersion.major, minor: ReactNativeVersion.minor, patch: ReactNativeVersion.patch}, parts(installed));
});

test("Platform.constants.reactNativeVersion carries the installed version, in the shape it always had", async (t) => {
  const {Platform} = await bundle(t);
  assert.deepEqual(plain(Platform.constants.reactNativeVersion), parts(installed));
  // The shape is the 0.5 contract's (docs/compatibility/scope-0.5.json): major, minor and patch, and no prerelease.
  assert.deepEqual(Object.keys(Platform.constants.reactNativeVersion), ["major", "minor", "patch"]);
});

test("the version has one source: a different ReactNativeVersion changes both the export and Platform.constants", async (t) => {
  const standIn = {name: "stand-in-version", setup(builder) {
    builder.onLoad({filter: /\/Libraries\/Core\/ReactNativeVersion\.js$/}, () => ({loader: "js", contents: [
      "export default class ReactNativeVersion {",
      "  static major = 7; static minor = 8; static patch = 9; static prerelease = null;",
      "  static getVersionString() { return `${this.major}.${this.minor}.${this.patch}`; }",
      "}"].join("\n")}));
  }};
  const {ReactNativeVersion, Platform, Original} = await bundle(t, [standIn]);
  assert.equal(ReactNativeVersion, Original);
  assert.equal(ReactNativeVersion.getVersionString(), "7.8.9");
  assert.deepEqual(plain(Platform.constants.reactNativeVersion), {major: 7, minor: 8, patch: 9});
});
