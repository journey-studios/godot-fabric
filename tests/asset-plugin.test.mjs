import assert from "node:assert/strict";
import {cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import {fileURLToPath} from "node:url";
import {build} from "esbuild";
import {assetFilePath, createAssetPipeline, imageDimensions, parseAssetFile, publishAssets} from "../sdk/toolchain/asset-plugin.mjs";

// Metro's own asset code is the oracle: its descriptor and its module for the same files.
const {getAssetData} = await import("metro/private/Assets");
const {generateAssetCodeFileAst} = await import("metro/private/Bundler/util");
// Metro's module for any descriptor: module.exports = require("react-native/asset-registry").registerAsset({...}).
const metroStatement = generateAssetCodeFileAst("react-native/asset-registry", {}).program.body[0].expression;

const root = fileURLToPath(new URL("..", import.meta.url));
const fixtures = path.join(root, "tests/fixtures/images");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

function project(t, files = {}) {
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), "godot-assets-")));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  for (const [name, source] of Object.entries(files)) {
    const target = path.join(directory, name);
    mkdirSync(path.dirname(target), {recursive: true});
    if (typeof source === "string" && source.startsWith("@")) cpSync(path.join(fixtures, source.slice(1)), target);
    else writeFileSync(target, source);
  }
  return directory;
}
// The registry module the generated code requires, standing in for RN's: a descriptor is its own asset id.
const registry = {name: "registry", setup(builder) {
  builder.onResolve({filter: /^react-native\/asset-registry$/}, () => ({path: "registry", namespace: "registry"}));
  builder.onLoad({filter: /.*/, namespace: "registry"}, () => ({contents: "module.exports = {registerAsset: descriptor => descriptor};", loader: "js"}));
}};
async function bundle(directory, entry, pipeline) {
  const result = await build({absWorkingDir: directory, entryPoints: [entry], bundle: true, write: false, format: "cjs", platform: "neutral",
    mainFields: ["main"], plugins: [pipeline.plugin, registry], logLevel: "silent"});
  const module = {exports: {}};
  vm.runInNewContext(result.outputFiles[0].text, {module, exports: module.exports});
  return {exports: module.exports, text: result.outputFiles[0].text, outputs: result.outputFiles.length};
}
// What Metro makes of a file: its descriptor without the fields Bundler/util.js leaves out.
async function metro(directory, relative) {
  const {files, fileSystemLocation, path: _path, ...descriptor} = await getAssetData(path.join(directory, relative), relative, [], null, "/assets");
  void files; void fileSystemLocation; void _path;
  return descriptor;
}

test("the asset module registers the descriptor Metro writes: same fields in the same order, hash included", async t => {
  const directory = project(t, {
    "src/img/badge.png": "@assets/badge.png", "src/img/badge@2x.png": "@assets/badge@2x.png", "src/img/badge@3x.png": "@assets/badge@3x.png",
    "src/wide.png": "@assets/wide.png", "icon.png": "@assets/tile.png", "pics/photo.jpg": "@formats/format.jpg", "pics/photo.webp": "@formats/format.webp",
    "pics/photo.bmp": "@formats/format.bmp", "pics/photo.gif": "@formats/format.gif", "pics/vector.svg": "@formats/format.svg",
    "app/App.js": [
      'exports.a0 = require("../src/img/badge@2x.png");', 'exports.a1 = require("../src/wide.png");', 'exports.a2 = require("../icon.png");',
      'exports.a3 = require("../pics/photo.jpg");', 'exports.a4 = require("../pics/photo.webp");', 'exports.a5 = require("../pics/photo.bmp");',
      'exports.a6 = require("../pics/photo.gif");', 'exports.a7 = require("../pics/vector.svg");'].join("\n"),
  });
  const pipeline = createAssetPipeline({root: directory});
  const {exports, outputs, text} = await bundle(directory, "app/App.js", pipeline);
  assert.equal(outputs, 1, "Assets never become esbuild output files");
  const expected = {a0: "src/img/badge@2x.png", a1: "src/wide.png", a2: "icon.png", a3: "pics/photo.jpg", a4: "pics/photo.webp", a5: "pics/photo.bmp",
    a6: "pics/photo.gif", a7: "pics/vector.svg"};
  for (const [key, relative] of Object.entries(expected)) {
    const descriptor = await metro(directory, relative);
    assert.equal(JSON.stringify(exports[key]), JSON.stringify(descriptor), relative);
  }
  // Variants of one asset, imported by any of their names, make one descriptor with every scale.
  assert.deepEqual(Array.from(exports.a0.scales), [1, 2, 3]);
  assert.equal(exports.a0.httpServerLocation, "/assets/src/img");
  assert.equal(exports.a0.width, 16);
  assert.equal(exports.a2.httpServerLocation, "/assets");
  // Metro's module is a registerAsset call on the registry RN's own AssetRegistry serves; so is the generated one.
  const {left, right} = metroStatement;
  assert.equal(`${left.object.name}.${left.property.name}`, "module.exports");
  assert.equal(right.callee.property.name, "registerAsset");
  assert.deepEqual([right.callee.object.callee.name, right.callee.object.arguments[0].value], ["require", "react-native/asset-registry"]);
  assert.match(text, /module\d*\.exports = require_registry\(\)\.registerAsset\(\{/, "The generated module calls registerAsset on the module the registry plugin serves");
});

test("an asset outside the project keeps Metro's un-normalized location, and its files land where RN's resolver looks", async t => {
  const outer = project(t, {"shared/pic.png": "@assets/badge.png", "shared/pic@2x.png": "@assets/badge@2x.png", "app/App.js": 'exports.pic = require("../shared/pic.png");'});
  const directory = path.join(outer, "app");
  const pipeline = createAssetPipeline({root: directory});
  const {exports} = await bundle(directory, "App.js", pipeline);
  assert.equal(JSON.stringify(exports.pic), JSON.stringify(await metro(outer, "shared/pic.png").then(descriptor => ({...descriptor,
    httpServerLocation: "/assets/../shared"}))), "Metro's location for a file above the project root");
  assert.equal(exports.pic.httpServerLocation, "/assets/../shared");
  assert.equal(assetFilePath(exports.pic, 2), "assets/_shared/pic@2x.png");
  assert.equal(assetFilePath(exports.pic, 1), "assets/_shared/pic.png");
  const out = path.join(directory, "out");
  mkdirSync(out);
  const code = "bundle code\n";
  const manifest = await publishAssets(pipeline, path.join(out, "app.js"), code);
  assert.deepEqual(manifest.files.map(file => file.path), ["assets/_shared/pic.png", "assets/_shared/pic@2x.png"]);
  assert.ok(readFileSync(path.join(out, "assets/_shared/pic@2x.png")).equals(readFileSync(path.join(fixtures, "assets/badge@2x.png"))));
});

test("the manifest lists every file with its SHA-256 and the bundle's, and no staging file is left", async t => {
  const directory = project(t, {"a/logo.png": "@assets/badge.png", "a/logo@2x.png": "@assets/badge@2x.png", "App.js": 'exports.logo = require("./a/logo.png");'});
  const pipeline = createAssetPipeline({root: directory});
  await bundle(directory, "App.js", pipeline);
  const out = path.join(directory, "out");
  mkdirSync(out);
  const code = "the bundle\n";
  await publishAssets(pipeline, path.join(out, "app.js"), code);
  const manifest = JSON.parse(readFileSync(path.join(out, "app.js.assets.json"), "utf8"));
  assert.equal(manifest.format, "godot-fabric.assets/v1");
  assert.equal(manifest.bundle, "app.js");
  assert.equal(manifest.bundleSha256, sha256(code));
  assert.equal(manifest.publicPath, "/assets");
  assert.deepEqual(manifest.files, [
    {path: "assets/a/logo.png", sha256: sha256(readFileSync(path.join(fixtures, "assets/badge.png"))), bytes: 103},
    {path: "assets/a/logo@2x.png", sha256: sha256(readFileSync(path.join(fixtures, "assets/badge@2x.png"))), bytes: 130},
  ]);
  assert.deepEqual(manifest.assets, [{name: "logo", type: "png", httpServerLocation: "/assets/a", scales: [1, 2], hash: manifest.assets[0].hash,
    files: ["assets/a/logo.png", "assets/a/logo@2x.png"]}]);
  const leftovers = [];
  for (const entry of readdirSync(out, {recursive: true})) if (String(entry).includes(".staging-")) leftovers.push(entry);
  assert.deepEqual(leftovers, []);
});

test("a rebuild retires the files only its previous manifest named, and keeps the ones another bundle names", async t => {
  const directory = project(t, {"a/one.png": "@assets/badge.png", "a/two.png": "@assets/wide.png", "a/three.png": "@assets/tile.png",
    "First.js": 'exports.assets = [require("./a/one.png"), require("./a/two.png")];',
    "Second.js": 'exports.assets = [require("./a/two.png"), require("./a/three.png")];',
    "Third.js": "exports.assets = [];"});
  const out = path.join(directory, "out");
  mkdirSync(out);
  const publish = async (entry, name) => {
    const pipeline = createAssetPipeline({root: directory});
    await bundle(directory, entry, pipeline);
    return publishAssets(pipeline, path.join(out, name), entry);
  };
  await publish("First.js", "first.js");
  await publish("Second.js", "second.js");
  const present = () => readdirSync(path.join(out, "assets/a")).sort();
  assert.deepEqual(present(), ["one.png", "three.png", "two.png"]);
  // The first bundle no longer needs two.png, which the second still does; one.png nobody needs any more.
  const rebuilt = createAssetPipeline({root: directory});
  await bundle(directory, "Third.js", rebuilt);
  assert.equal(await publishAssets(rebuilt, path.join(out, "first.js"), "Third.js"), null, "A bundle without assets has no manifest");
  assert.deepEqual(present(), ["three.png", "two.png"]);
  assert.ok(!existsSync(path.join(out, "first.js.assets.json")));
  assert.ok(existsSync(path.join(out, "second.js.assets.json")));
});

test("a reused pipeline starts every build from the files as they are: a changed variant and a dropped asset", async t => {
  const directory = project(t, {"a/pic.png": "@assets/badge.png", "a/pic@2x.png": "@assets/badge@2x.png", "a/gone.png": "@assets/tile.png",
    "App.js": 'exports.pic = require("./a/pic.png"); exports.gone = require("./a/gone.png");'});
  const pipeline = createAssetPipeline({root: directory});
  const first = await bundle(directory, "App.js", pipeline);
  assert.equal(pipeline.count, 2);
  // A watch rebuild after the first variant became another picture and the second asset left the entry.
  cpSync(path.join(fixtures, "assets/wide.png"), path.join(directory, "a/pic.png"));
  writeFileSync(path.join(directory, "App.js"), 'exports.pic = require("./a/pic.png");');
  const second = await bundle(directory, "App.js", pipeline);
  assert.equal(pipeline.count, 1, "The asset the entry dropped is not staged any more");
  assert.notEqual(second.exports.pic.hash, first.exports.pic.hash, "The hash is the new files'");
  assert.deepEqual([second.exports.pic.width, second.exports.pic.height], [40, 20], "The size is the new first variant's, not the cached one");
  assert.deepEqual(Array.from(second.exports.pic.scales), [1, 2]);
  assert.equal(second.exports.pic.hash, createHash("md5").update(readFileSync(path.join(fixtures, "assets/wide.png")))
    .update(readFileSync(path.join(fixtures, "assets/badge@2x.png"))).digest("hex"));
  const out = path.join(directory, "out");
  mkdirSync(out);
  const manifest = await publishAssets(pipeline, path.join(out, "app.js"), "second");
  assert.deepEqual(manifest.files.map(file => [file.path, file.sha256]), [
    ["assets/a/pic.png", sha256(readFileSync(path.join(fixtures, "assets/wide.png")))],
    ["assets/a/pic@2x.png", sha256(readFileSync(path.join(fixtures, "assets/badge@2x.png")))]]);
});

test("the new asset files are put in place before the bundle and the manifest and retirement wait for it, so the old bundle never loses a file", async t => {
  const directory = project(t, {"a/one.png": "@assets/badge.png", "a/two.png": "@assets/wide.png", "a/three.png": "@assets/tile.png",
    "First.js": 'exports.assets = [require("./a/one.png"), require("./a/two.png")];',
    "Second.js": 'exports.assets = [require("./a/two.png"), require("./a/three.png")];'});
  const out = path.join(directory, "out");
  mkdirSync(out);
  const bundleFile = path.join(out, "app.js");
  const manifestFile = bundleFile + ".assets.json";
  const present = () => readdirSync(path.join(out, "assets/a")).filter(name => !name.includes(".staging-")).sort();
  const staged = async (entry, code) => {
    const pipeline = createAssetPipeline({root: directory});
    await bundle(directory, entry, pipeline);
    return pipeline.stage(bundleFile, sha256(code));
  };
  const previous = await staged("First.js", "first");
  await previous.place();
  await previous.finish();
  await previous.discard();
  const oldManifest = readFileSync(manifestFile, "utf8");
  assert.deepEqual(present(), ["one.png", "two.png"]);

  // The second bundle's files are staged under other names and change nothing until they are placed.
  const next = await staged("Second.js", "second");
  assert.deepEqual(present(), ["one.png", "two.png"]);
  assert.equal(readFileSync(manifestFile, "utf8"), oldManifest);
  // Placed: the new file is there and the old bundle, which is still the published one, keeps every file and its manifest.
  await next.place();
  assert.deepEqual(present(), ["one.png", "three.png", "two.png"]);
  assert.equal(readFileSync(manifestFile, "utf8"), oldManifest, "The old manifest stays until the new bundle is published");
  // Finished (after the bundle's rename in the builder): the manifest names the new bundle and one.png, which nobody names, goes.
  await next.finish();
  assert.deepEqual(present(), ["three.png", "two.png"]);
  assert.equal(JSON.parse(readFileSync(manifestFile, "utf8")).bundleSha256, sha256("second"));
  await next.discard();
  assert.deepEqual(readdirSync(out, {recursive: true}).filter(entry => String(entry).includes(".staging-")), []);
});

test("a publish that fails after the files were placed leaves the old bundle's files and manifest whole", async t => {
  const directory = project(t, {"a/one.png": "@assets/badge.png", "a/two.png": "@assets/wide.png", "a/three.png": "@assets/tile.png",
    "First.js": 'exports.assets = [require("./a/one.png"), require("./a/two.png")];',
    "Second.js": 'exports.assets = [require("./a/three.png")];'});
  const out = path.join(directory, "out");
  mkdirSync(out);
  const bundleFile = path.join(out, "app.js");
  const published = createAssetPipeline({root: directory});
  await bundle(directory, "First.js", published);
  await publishAssets(published, bundleFile, "first");
  const oldManifest = readFileSync(bundleFile + ".assets.json", "utf8");
  const failing = createAssetPipeline({root: directory});
  await bundle(directory, "Second.js", failing);
  const staged = await failing.stage(bundleFile, sha256("second"));
  await staged.place();
  // The builder's rename of the bundle failed here: it never reaches finish, and discards what it staged.
  await staged.discard();
  assert.deepEqual(readdirSync(path.join(out, "assets/a")).sort(), ["one.png", "three.png", "two.png"], "Nothing the old bundle names is gone");
  assert.equal(readFileSync(bundleFile + ".assets.json", "utf8"), oldManifest, "The old manifest still describes the old bundle");
  assert.deepEqual(readdirSync(out, {recursive: true}).filter(entry => String(entry).includes(".staging-")), []);
});

test("the SDK builder places the asset files, publishes the bundle and only then finishes the manifest", () => {
  const source = readFileSync(path.join(root, "sdk/toolchain/build.mjs"), "utf8");
  const at = text => {
    assert.equal(source.split(text).length - 1, 1, `${text} appears once in the builder`);
    return source.indexOf(text);
  };
  assert.ok(at("await stagedAssets.place()") < at("await rename(staging, outfile)"), "The files are placed before the bundle is published");
  assert.ok(at("await rename(staging, outfile)") < at("await stagedAssets.finish()"), "The manifest and the retirement follow the bundle");
  assert.equal(source.includes("stagedAssets.commit"), false, "There is no single commit that retires files before the bundle is published");
});

test("a file name's scale suffix, platform-less extension and sizes are read as Metro reads them", () => {
  assert.deepEqual(parseAssetFile("/p/logo@2x.png"), {name: "logo", scale: 2, type: "png"});
  assert.deepEqual(parseAssetFile("/p/logo@1.5x.webp"), {name: "logo", scale: 1.5, type: "webp"});
  assert.deepEqual(parseAssetFile("/p/logo.ios.png"), {name: "logo.ios", scale: 1, type: "png"});
  assert.deepEqual(parseAssetFile("/p/logo@abcx.png"), {name: "logo@abcx", scale: 1, type: "png"});
  assert.equal(parseAssetFile("/p/README"), null);
  const read = relative => readFileSync(path.join(fixtures, relative));
  assert.deepEqual(imageDimensions("png", read("assets/wide.png"), "wide.png"), {width: 40, height: 20});
  assert.deepEqual(imageDimensions("jpg", read("formats/format.jpg"), "format.jpg"), {width: 24, height: 24});
  assert.deepEqual(imageDimensions("webp", read("formats/format.webp"), "format.webp"), {width: 24, height: 24});
  assert.deepEqual(imageDimensions("bmp", read("formats/format.bmp"), "format.bmp"), {width: 24, height: 24});
  assert.deepEqual(imageDimensions("gif", read("formats/format.gif"), "format.gif"), {width: 1, height: 1});
  assert.deepEqual(imageDimensions("svg", read("formats/format.svg"), "format.svg"), {width: 24, height: 24});
  assert.deepEqual(imageDimensions("svg", Buffer.from('<svg viewBox="0 0 30 15" width="60"/>'), "v.svg"), {width: 60, height: 30});
  assert.throws(() => imageDimensions("png", read("broken/notimage.png"), "notimage.png"), /Invalid png image asset/);
  assert.throws(() => imageDimensions("svg", Buffer.from("<svg/>"), "empty.svg"), /Invalid svg image asset/);
});

test("an asset that is not a picture, or an empty one, fails the build where Metro fails it", async t => {
  const broken = project(t, {"bad.png": "@broken/notimage.png", "App.js": 'exports.bad = require("./bad.png");'});
  await assert.rejects(bundle(broken, "App.js", createAssetPipeline({root: broken})), /Invalid png image asset/);
  const empty = project(t, {"empty.png": "", "App.js": 'exports.empty = require("./empty.png");'});
  await assert.rejects(bundle(empty, "App.js", createAssetPipeline({root: empty})), /cannot be an empty file/);
});
