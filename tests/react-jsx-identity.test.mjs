import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import {bundle, diagnostic, fixture, installed, prepare, requireOriginal, sdkPackages} from "./project-fixtures.mjs";

// D20: React's JSX runtimes have one identity, the SDK's, for the app and for an installed precompiled
// library, and the development runtime is refused where the production-only build cannot run it.
// Every build is write:false against authored temporary files; no Godot process is needed.

const element = Symbol.for("react.transitional.element");
const fragment = Symbol.for("react.fragment");

// A library the way Babel's automatic runtime precompiles it to CommonJS.
const library = `"use strict";
Object.defineProperty(exports, "__esModule", {value: true});
exports.Badge = Badge;
var _jsxRuntime = require("react/jsx-runtime");
exports.runtime = _jsxRuntime;
function Badge(props) {
  return (0, _jsxRuntime.jsxs)(_jsxRuntime.Fragment, {children: [
    (0, _jsxRuntime.jsx)("b", {children: props.label}),
    (0, _jsxRuntime.jsx)("i", {children: "!"}),
  ]});
}
`;

// Expands function components until only host elements and fragments remain, so a rendered tree
// compares as plain data. Array.from keeps the arrays in this realm, not the bundle's.
function render(node) {
  if (Array.isArray(node)) {
    return Array.from(node, render);
  }
  if (node === null || typeof node !== "object") {
    return node;
  }
  assert.equal(node.$$typeof, element, "every node must be a React element made by the JSX runtime");
  if (typeof node.type === "function") {
    return render(node.type(node.props));
  }
  const children = render(node.props.children ?? null);
  return node.type === fragment ? children : {[node.type]: children};
}

function jsxProject(t, jsx = "react-jsx") {
  const f = fixture(t, {dependencies: {library: "1.0.0"}, compilerOptions: {jsx}});
  sdkPackages(f);
  const folder = installed(f, "library", library);
  return {f, folder};
}

test("react/jsx-runtime has one SDK identity for the app and a precompiled library beside a false nested runtime", async t => {
  const {f, folder} = jsxProject(t);
  f.write(folder + "/node_modules/react/package.json", {name: "react", version: "0.0.0-fake", main: "index.js"});
  const fake = f.write(folder + "/node_modules/react/jsx-runtime.js", "throw new Error('Nested jsx-runtime spoof was evaluated');");
  f.entry = "ui/index.tsx";
  f.write(f.entry, `import {jsx, jsxs, Fragment} from "react/jsx-runtime";
import {Badge, runtime} from "library";
function App() { return <><Badge label="hello" /><u>tail</u></>; }
(globalThis as any).result = {App, appRuntime: {jsx, jsxs, Fragment}, libRuntime: runtime};`);
  const result = await bundle(f);
  const {App, appRuntime, libRuntime} = result.context.result;
  assert.equal(appRuntime.jsx, libRuntime.jsx, "the app and the library must call the same jsx");
  assert.equal(appRuntime.jsxs, libRuntime.jsxs, "the app and the library must call the same jsxs");
  assert.equal(appRuntime.Fragment, libRuntime.Fragment);
  assert.equal(libRuntime.Fragment, fragment);
  assert.equal(typeof libRuntime.jsx, "function");
  // The compiled JSX of the app and the library's calls end in the same module of the SDK's React.
  const sdkReact = path.join(f.sdk, "toolchain/node_modules/react");
  assert.deepEqual(result.inputs.filter(name => /[\\/]jsx-runtime\.js$/.test(name)), [path.join(sdkReact, "jsx-runtime.js")]);
  assert.ok(result.inputs.includes(path.join(sdkReact, "cjs/react-jsx-runtime.production.js")));
  assert.ok(!result.inputs.includes(fake), "the library's nested jsx-runtime must never enter the bundle");
  assert.deepEqual(render(App()), [[{b: "hello"}, {i: "!"}], {u: "tail"}]);
});

test("react/jsx-runtime still builds and renders for an app without a library", async t => {
  const f = fixture(t, {compilerOptions: {jsx: "react-jsx"}});
  sdkPackages(f);
  f.entry = "ui/index.tsx";
  f.write(f.entry, "(globalThis as any).result = {App: () => <main>only app</main>};");
  const result = await bundle(f);
  assert.deepEqual(render(result.context.result.App()), {main: "only app"});
});

// The development runtime is the one thing the production-only build must not accept in silence.
test("the premise holds: React's production build of the development runtime leaves jsxDEV undefined", () => {
  const source = fs.readFileSync(path.join(path.dirname(requireOriginal.resolve("react/package.json")), "cjs/react-jsx-dev-runtime.production.js"), "utf8");
  const exports = {};
  vm.runInNewContext(source, {exports});
  assert.equal("jsxDEV" in exports, true);
  assert.equal(exports.jsxDEV, undefined);
  assert.equal(exports.Fragment, fragment);
});

test("jsx react-jsxdev passes the config and is refused by the resolution at the build", async t => {
  const f = fixture(t, {compilerOptions: {jsx: "react-jsxdev"}});
  sdkPackages(f);
  f.entry = "ui/index.tsx";
  f.write(f.entry, "(globalThis as any).result = <main>dev</main>;");
  const prepared = await prepare(f);
  await assert.rejects(() => bundle(f, prepared), error => {
    assert.ok(diagnostic("E_PROJECT_JSX_DEV_RUNTIME")(error));
    assert.match(error.message, /production-only \(NODE_ENV=production leaves jsxDEV undefined\)/);
    assert.match(error.message, /Use "jsx": "react-jsx"/);
    assert.match(error.message, /compiled in development mode/);
    return true;
  });
});

test("an installed library compiled in development mode is refused at its require", async t => {
  const {f, folder} = jsxProject(t);
  f.write(folder + "/index.js", `var _jsxDevRuntime = require("react/jsx-dev-runtime");
exports.Badge = function Badge() { return (0, _jsxDevRuntime.jsxDEV)("b", {children: "dev"}, undefined, false, {}, this); };`);
  f.write("ui/index.ts", "import {Badge} from 'library'; (globalThis as any).result = Badge;");
  await assert.rejects(() => bundle(f), diagnostic("E_PROJECT_JSX_DEV_RUNTIME"));
});

test("the app cannot import the development runtime by name either", async t => {
  const f = fixture(t, {compilerOptions: {jsx: "react-jsx"}});
  sdkPackages(f);
  f.write("ui/index.ts", "import {jsxDEV} from 'react/jsx-dev-runtime'; (globalThis as any).result = jsxDEV;");
  await assert.rejects(() => bundle(f), diagnostic("E_PROJECT_JSX_DEV_RUNTIME"));
});
