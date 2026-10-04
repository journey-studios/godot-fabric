import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
import path from "node:path";
import test from "node:test";
import {renderRendererTagOverlay} from "../sdk/toolchain/rn-renderer-tag-overlay.mjs";

const resolveSdk = createRequire(import.meta.url).resolve;
const rnRoot = path.dirname(resolveSdk("react-native/package.json"));
const source = await readFile(path.join(rnRoot, "Libraries/Renderer/implementations/ReactFabric-prod.js"), "utf8");
const originalFunction = `getInstanceFromNode$1 = function (node) {
  return null != node.canonical && null != node.canonical.internalInstanceHandle
    ? node.canonical.internalInstanceHandle
    : node;
};`;
const insertion = `  if ("number" === typeof node)
    return ReactNativePrivateInterface.getInternalInstanceHandleFromNativeTag(node);
`;

test("original tag-lookup control retains the pinned renderer byte-for-byte", () => {
  assert.equal(createHash("sha256").update(source).digest("hex"),
    "6f53e433d921c0090d0610c5a0091d0b3acb53d13f5d48c32d1e40bfac4bdfda");
  assert.equal(source.split(originalFunction).length, 2);
  assert.equal(renderRendererTagOverlay(source, "original"), source);
});

test("correction changes only one numeric lookup before the unchanged canonical and Fiber paths", () => {
  const corrected = renderRendererTagOverlay(source);
  const location = source.indexOf(originalFunction);
  const opening = "getInstanceFromNode$1 = function (node) {\n";
  const correctedFunction = opening + insertion + originalFunction.slice(opening.length);
  assert.equal(corrected.split(insertion).length, 2);
  assert.equal(corrected, source.slice(0, location) + correctedFunction +
    source.slice(location + originalFunction.length));
  assert.equal(corrected.replace(insertion, ""), source);
  assert.equal(renderRendererTagOverlay(source, "current"), corrected);
});

test("the generated function delegates numeric tags while retaining object lookup identities", () => {
  const corrected = renderRendererTagOverlay(source);
  const start = corrected.indexOf("getInstanceFromNode$1 = function (node) {");
  const end = corrected.indexOf("\n};", start) + "\n};".length;
  const calls = [];
  const handle = {return: null};
  const lookup = new Function("ReactNativePrivateInterface", "let getInstanceFromNode$1;\n" +
    corrected.slice(start, end) + "\nreturn getInstanceFromNode$1;")({
    getInternalInstanceHandleFromNativeTag(tag) {
      calls.push(tag);
      return tag === 17 ? handle : null;
    },
  });
  assert.equal(lookup(17), handle);
  assert.equal(lookup(23), null);
  const canonical = {canonical: {internalInstanceHandle: handle}};
  const emptyCanonical = {canonical: {internalInstanceHandle: null}};
  const fiber = {return: handle, stateNode: {}};
  assert.equal(lookup(canonical), handle);
  assert.equal(lookup(emptyCanonical), emptyCanonical);
  assert.equal(lookup(fiber), fiber);
  assert.deepEqual(calls, [17, 23]);
  // The platform seam, rather than this overlay, validates a native tag's lifetime.
});

test("unsupported overlay modes fail before source adaptation", () => {
  for (const mode of ["unknown", "", null, false, 0])
    assert.throws(() => renderRendererTagOverlay(source, mode), /E_RENDERER_TAG_OVERLAY_MODE/);
});

test("unrelated pin drift is rejected in both corrected and original-control modes", () => {
  for (const mode of ["current", "original"])
    for (const drift of [source + "\n", "// changed upstream bytes\n" + source])
      assert.throws(() => renderRendererTagOverlay(drift, mode), /E_RENDERER_TAG_OVERLAY_INPUT/);
});

test("missing or repeated lookup spans are rejected in both modes", () => {
  for (const mode of ["current", "original"])
    for (const invalid of [source.replace(originalFunction, ""), source + "\n" + originalFunction])
      assert.throws(() => renderRendererTagOverlay(invalid, mode), /E_RENDERER_TAG_OVERLAY_SPAN/);
});

test("generated renderer input cannot be adapted twice or accepted as an original control", () => {
  const generated = renderRendererTagOverlay(source);
  for (const mode of ["current", "original"])
    assert.throws(() => renderRendererTagOverlay(generated, mode), /E_RENDERER_TAG_OVERLAY_SPAN/);
});

test("invalid source values fail with the overlay input diagnostic", () => {
  for (const mode of ["current", "original"])
    for (const invalid of [undefined, null, {}, 0])
      assert.throws(() => renderRendererTagOverlay(invalid, mode), /E_RENDERER_TAG_OVERLAY_INPUT/);
});


test("toolchain rejects an invalid renderer tag mode before loading RN", async () => {
  const {platformPlugin} = await import("../sdk/toolchain/platform-plugin.mjs");
  assert.throws(() => platformPlugin("unused", () => { throw Error("must not resolve"); }, {rendererTagMode: "unknown"}), /E_RENDERER_TAG_OVERLAY_MODE/);
});

test("a project module matching the renderer filename remains project-owned", async t => {
  const {mkdtemp, mkdir, writeFile, rm} = await import("node:fs/promises");
  const {tmpdir} = await import("node:os");
  const {build} = await import("esbuild");
  const {platformPlugin} = await import("../sdk/toolchain/platform-plugin.mjs");
  const directory = await mkdtemp(path.join(tmpdir(), "godot-renderer-tag-seam-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const relative = "Libraries/Renderer/implementations/ReactFabric-prod.js";
  await mkdir(path.dirname(path.join(directory, relative)), {recursive: true});
  await writeFile(path.join(directory, relative), 'export default "project-owned-renderer";');
  await writeFile(path.join(directory, "App.js"), 'export {default} from "./' + relative + '";');
  const result = await build({absWorkingDir: directory, entryPoints: ["App.js"], bundle: true,
    write: false, format: "esm", metafile: true,
    plugins: [platformPlugin(path.resolve("src"), createRequire(import.meta.url).resolve)]});
  assert.match(result.outputFiles[0].text, /project-owned-renderer/);
  assert.equal(Object.keys(result.metafile.inputs).length, 2);
});
