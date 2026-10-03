import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {build} from "esbuild";
import ts from "typescript";

const builderPath = fileURLToPath(new URL("../sdk/toolchain/build.mjs", import.meta.url));
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");

// Read only the real build call's tsconfig expression. Do not execute the SDK
// script (which typechecks, bundles and publishes) or project configuration JS.
function projectTsconfig(project) {
  const source = ts.createSourceFile(builderPath, fs.readFileSync(builderPath, "utf8"),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(source.parseDiagnostics.length, 0);
  const calls = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && node.expression.text === "build" && ts.isAwaitExpression(node.parent)) calls.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(calls.length, 1, "Locate the SDK's actual await build(options) call");
  const options = calls[0].arguments[0];
  assert.ok(ts.isObjectLiteralExpression(options));
  const properties = options.properties.filter(property => ts.isPropertyAssignment(property)
    && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    && property.name.text === "tsconfig");
  assert.equal(properties.length, 1, "The real SDK build must select the project's tsconfig explicitly");
  function value(node) {
    if (ts.isStringLiteral(node)) return node.text;
    if (ts.isIdentifier(node) && node.text === "project") return project;
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "path"
        && node.expression.name.text === "join") return path.join(...node.arguments.map(value));
    assert.fail("The tsconfig expression must be a project path, without executing build code");
  }
  const filename = value(properties[0].initializer);
  assert.equal(filename, path.join(project, "tsconfig.json"));
  return filename;
}

function fixture(t, {strict = true, jsx = false, inherited = false} = {}) {
  // Canonicalize the temporary directory's symlink before resolving either import spelling;
  // otherwise a symlink alias would create a different, unrelated repro.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "godot-bundle-determinism-")));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const compilerOptions = {strict, ...(jsx ? {jsx: "react-jsx", jsxImportSource: "owned-jsx"} : {})};
  const files = {
    "tsconfig.json": JSON.stringify(inherited ? {extends: "./config/base.json"} : {compilerOptions}),
    "entry.ts": 'import "./first"; require("package-branch");',
    [jsx ? "first.jsx" : "first.js"]: 'import Native from "./addon/facade"; globalThis.first = Native;'
      + (jsx ? ' globalThis.element = <badge key="row" label="project JSX" />;' : ""),
    "addon/facade.js": 'import "./bootstrap"; export {default} from "./original";',
    "addon/bootstrap.js": 'globalThis.bootstrapCount = (globalThis.bootstrapCount ?? 0) + 1;',
    "addon/original.js": '"use strict"; export default {value: 1};',
    "node_modules/package-branch/package.json": JSON.stringify({name: "package-branch", main: "index.js"}),
    "node_modules/package-branch/index.js": 'globalThis.second = require("facade").default;',
    ...(inherited ? {"config/base.json": JSON.stringify({compilerOptions})} : {}),
    ...(jsx ? {
      "node_modules/owned-jsx/package.json": JSON.stringify({name: "owned-jsx", exports: {"./jsx-runtime": "./jsx-runtime.js"}}),
      "node_modules/owned-jsx/jsx-runtime.js": 'export function jsx(type, props, key) { return {type, props, key, runtime: "project-owned"}; }',
    } : {}),
  };
  for (const [name, contents] of Object.entries(files)) {
    const filename = path.join(root, name);
    fs.mkdirSync(path.dirname(filename), {recursive: true});
    fs.writeFileSync(filename, contents);
  }
  return {root};
}

async function compile(project, order, {explicit = true} = {}) {
  let releaseFacadeLoad;
  const facadeLoaded = new Promise(resolve => { releaseFacadeLoad = resolve; });
  const facade = path.join(project.root, "addon/facade.js");
  const result = await build({
    absWorkingDir: project.root, entryPoints: ["entry.ts"], outfile: "bundle.js",
    write: false, bundle: true, platform: "neutral", format: "iife", metafile: true,
    ...(explicit ? {tsconfig: projectTsconfig(project.root)} : {}),
    plugins: [{
      name: "controlled-relative-import-and-native-alias",
      setup(builder) {
        builder.onResolve({filter: /facade$/}, async args => {
          const alias = args.path === "facade";
          // Both branches are parsed independently. Release the losing branch
          // only when the winner's canonical file has entered onLoad: no timing
          // guess or random delay determines which TSConfig wins.
          if (alias === (order === "relative-first")) await facadeLoaded;
          if (alias) return {path: facade};
        });
        builder.onLoad({filter: /facade\.js$/}, args => {
          if (args.path === facade) releaseFacadeLoad();
          // Keep esbuild's real file loader and the unchanged physical bytes.
        });
      },
    }],
  });
  const code = result.outputFiles[0].text;
  const context = {};
  vm.runInNewContext(code, context);
  assert.equal(context.bootstrapCount, 1);
  assert.equal(context.first.value, 1);
  assert.equal(context.first, context.second, "Both import forms retain the original default export identity");
  const inputs = Object.keys(result.metafile.inputs).sort().map(name =>
    [name, sha256(fs.readFileSync(path.resolve(project.root, name)))]);
  return {code, hash: sha256(code), inputs, context};
}

async function bothOrders(project, options) {
  const relative = await compile(project, "relative-first", options);
  const alias = await compile(project, "alias-first", options);
  assert.deepEqual(relative.inputs, alias.inputs, "Resolution order does not change physical sources");
  return [relative, alias];
}

test("inferred TSConfig reproduces the relative-import versus native-alias fingerprint race", async t => {
  const results = await bothOrders(fixture(t), {explicit: false});
  assert.notEqual(results[0].hash, results[1].hash, "Negative control must reproduce the original byte mismatch");
});

test("the real SDK builder's explicit project TSConfig keeps both resolution orders byte-identical", async t => {
  const results = await bothOrders(fixture(t));
  assert.equal(results[0].hash, results[1].hash);
  assert.equal(results[0].code, results[1].code);
});

test("the SDK builder honors strict:false from the project instead of hardcoding strict mode", async t => {
  const loose = await bothOrders(fixture(t, {strict: false}));
  const strict = await compile(fixture(t), "relative-first");
  assert.equal(loose[0].hash, loose[1].hash);
  assert.notEqual(loose[0].hash, strict.hash, "The project's strict option changes the emitted program");
  for (const [result, expected] of [[loose[0], false], [strict, true]]) {
    const source = ts.createSourceFile("bundle.js", result.code, ts.ScriptTarget.Latest);
    const first = source.statements[0];
    const strictDirective = ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression)
      && first.expression.text === "use strict";
    assert.equal(strictDirective, expected);
  }
});

for (const inherited of [false, true]) {
  test("the SDK builder honors " + (inherited ? "inherited " : "") + "project react-jsx configuration", async t => {
    const results = await bothOrders(fixture(t, {jsx: true, inherited}));
    assert.equal(results[0].hash, results[1].hash);
    for (const {context} of results) {
      assert.equal(context.element.runtime, "project-owned");
      assert.equal(context.element.type, "badge");
      assert.equal(context.element.props.label, "project JSX");
      assert.equal(context.element.key, "row");
    }
  });
}
