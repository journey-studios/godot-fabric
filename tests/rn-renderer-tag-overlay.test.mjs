import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
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

async function relocatedPlatform(t, suffix) {
  const repository = fileURLToPath(new URL("..", import.meta.url));
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "godot-renderer-dispatch-" + suffix + "-")));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const platformRoot = path.join(directory, "addon", "src");
  await cp(path.join(repository, "src"), platformRoot, {recursive: true});
  return {directory, platformRoot, sdkResolver: createRequire(path.join(repository, "package.json")).resolve};
}

test("experimental relocated SDK facade resolves the exact original dispatcher and NativeDOM through the shared toolchain", async t => {
  const {build} = await import("esbuild");
  const {platformPlugin} = await import("../sdk/toolchain/platform-plugin.mjs");
  const {directory, platformRoot, sdkResolver} = await relocatedPlatform(t, "sdk");
  const dispatcherRelative = "src/private/renderer/events/dispatchNativeEvent.js";
  const nativeDOMRelative = "src/private/webapis/dom/nodes/specs/NativeDOM.js";
  const dispatcher = await realpath(path.join(rnRoot, dispatcherRelative));
  const nativeDOM = await realpath(path.join(rnRoot, nativeDOMRelative));
  const originalDispatcher = await readFile(dispatcher, "utf8");
  assert.equal(JSON.parse(await readFile(path.join(rnRoot, "package.json"), "utf8")).version, "0.87.1");
  // If importer ownership or relocation breaks, these physically resolvable
  // neighbors would satisfy the same relative imports with consumer code.
  const shadowRoot = path.join(directory, "addon", "node_modules", "react-native");
  for (const [relative, contents] of [[dispatcherRelative, 'export default function() { return "consumer-shadow-dispatcher"; }'],
    [nativeDOMRelative, 'export default {marker: "consumer-shadow-NativeDOM"};']]) {
    await mkdir(path.dirname(path.join(shadowRoot, relative)), {recursive: true});
    await writeFile(path.join(shadowRoot, relative), contents);
  }
  await writeFile(path.join(directory, "App.js"),
    'export {dispatchNativeEvent, UIManager} from "react-native/Libraries/ReactPrivate/ReactNativePrivateInterface";');
  const result = await build({absWorkingDir: directory, entryPoints: ["App.js"], bundle: true, write: false,
    platform: "neutral", format: "esm", mainFields: ["main"], metafile: true,
    define: {"process.env.NODE_ENV": '"production"', __DEV__: "false"},
    plugins: [platformPlugin(platformRoot, sdkResolver, {nativeDispatchMode: "experimental"})]});
  const entries = Object.entries(result.metafile.inputs).map(([filename, metadata]) => [path.resolve(directory, filename), metadata]);
  const inputs = entries.map(([filename]) => filename), facade = path.join(platformRoot, "private-interface.js");
  assert.ok(inputs.includes(facade), "The actual copied SDK facade must enter the relocated bundle");
  assert.ok(inputs.includes(dispatcher), "The exact RN 0.87.1 original dispatcher must enter the bundle");
  assert.ok(inputs.includes(nativeDOM), "The existing unexported NativeDOM importer seam must also survive relocation");
  assert.equal(inputs.filter(filename => filename === dispatcher).length, 1);
  assert.ok(!inputs.includes(path.join(shadowRoot, dispatcherRelative)), "Relative consumer dispatcher cannot shadow the SDK facade import");
  assert.ok(!inputs.includes(path.join(shadowRoot, nativeDOMRelative)), "Relative consumer NativeDOM cannot shadow the SDK facade import");
  const facadeImports = entries.find(([filename]) => filename === facade)[1].imports.map(entry => path.resolve(directory, entry.path));
  assert.ok(facadeImports.includes(dispatcher), "Resolution must be a direct import from the copied facade, not an incidental transitive module");
  assert.ok(facadeImports.includes(nativeDOM));
  assert.doesNotMatch(result.outputFiles[0].text, /consumer-shadow-dispatcher|consumer-shadow-NativeDOM/);
  assert.equal(await readFile(dispatcher, "utf8"), originalDispatcher, "Bundling cannot rewrite original RN source");
});

test("identical unexported dispatcher and NativeDOM relative imports stay owned by an arbitrary project caller", async t => {
  const {build} = await import("esbuild");
  const {platformPlugin} = await import("../sdk/toolchain/platform-plugin.mjs");
  const {directory, platformRoot, sdkResolver} = await relocatedPlatform(t, "project");
  const relativeDispatcher = "node_modules/react-native/src/private/renderer/events/dispatchNativeEvent.js";
  const relativeNativeDOM = "node_modules/react-native/src/private/webapis/dom/nodes/specs/NativeDOM.js";
  const projectFacade = path.join(directory, "consumer", "private-interface.js");
  await mkdir(path.dirname(projectFacade), {recursive: true});
  for (const [relative, contents] of [[relativeDispatcher, 'export default function projectDispatch() { return "project-owned-relative-dispatcher"; }'],
    [relativeNativeDOM, 'export default {marker: "project-owned-relative-NativeDOM"};']]) {
    await mkdir(path.dirname(path.join(directory, relative)), {recursive: true});
    await writeFile(path.join(directory, relative), contents);
  }
  await writeFile(projectFacade, 'import dispatcher from "../node_modules/react-native/src/private/renderer/events/dispatchNativeEvent";\n' +
    'import NativeDOM from "../node_modules/react-native/src/private/webapis/dom/nodes/specs/NativeDOM";\nexport {dispatcher, NativeDOM};\n');
  await writeFile(path.join(directory, "App.js"), 'export * from "./consumer/private-interface.js";');
  const result = await build({absWorkingDir: directory, entryPoints: ["App.js"], bundle: true, write: false, format: "esm", metafile: true,
    plugins: [platformPlugin(platformRoot, sdkResolver, {nativeDispatchMode: "experimental"})]});
  const inputs = Object.keys(result.metafile.inputs).map(filename => path.resolve(directory, filename)).sort();
  assert.deepEqual(inputs, [path.join(directory, "App.js"), projectFacade,
    path.join(directory, relativeDispatcher), path.join(directory, relativeNativeDOM)].sort(),
    "Same basename and exact internal specifier cannot turn a project caller into the platform facade");
  assert.match(result.outputFiles[0].text, /project-owned-relative-dispatcher/);
  assert.match(result.outputFiles[0].text, /project-owned-relative-NativeDOM/);
  assert.ok(!inputs.includes(path.join(platformRoot, "private-interface.js")));
  assert.ok(!inputs.includes(path.join(rnRoot, "src/private/renderer/events/dispatchNativeEvent.js")));
});

test("default renderer output remains the delivered tag correction without a dispatcher selection", () => {
  const corrected = renderRendererTagOverlay(source);
  assert.equal(createHash("sha256").update(corrected).digest("hex"),
    "dc981c8726a5a77686f37131dc356f0f4626aee3adef425854391c3b8abb172e");
  assert.equal(renderRendererTagOverlay(source, "current", {nativeDispatchMode: "original"}), corrected);
  assert.equal(renderRendererTagOverlay(source, "original", {nativeDispatchMode: "original"}), source);
  assert.doesNotMatch(corrected, /nativeEventTargetDispatchEnabledForGodot|ReactNativePrivateInterface\.dispatchNativeEvent/);
});

test("experimental dispatch and numeric lookup compose from the single original pin", () => {
  const enabled = renderRendererTagOverlay(source, "current", {nativeDispatchMode: "experimental"});
  const originalTags = renderRendererTagOverlay(source, "original", {nativeDispatchMode: "experimental"});
  assert.equal(enabled.replace(insertion, ""), originalTags);
  assert.equal(enabled.split("ReactNativePrivateInterface.dispatchNativeEvent(").length, 2);
  assert.equal(enabled.split("RN$isNativeEventTargetEventDispatchingEnabled();").length, 2);
  assert.match(enabled, /RawEventEmitter\.emit\(topLevelType, event\);\n    ReactNativePrivateInterface\.RawEventEmitter\.emit\("\*", event\);\n    if \(nativeEventTargetDispatchEnabledForGodot\) \{/);
  assert.match(enabled, /dispatchNativeEvent\(eventTarget, topLevelType, nativeEvent\);\n      return;\n    \}\n    event = eventTarget;/);
  // Other than flag capture and exclusive routing, the complete renderer stays
  // byte-identical, including native priority resolution and React batching.
  const capture = `var nativeEventTargetDispatchEnabledForGodot =
  "function" === typeof RN$isNativeEventTargetEventDispatchingEnabled &&
  RN$isNativeEventTargetEventDispatchingEnabled();
`;
  const branch = `    if (nativeEventTargetDispatchEnabledForGodot) {
      ReactNativePrivateInterface.dispatchNativeEvent(eventTarget, topLevelType, nativeEvent);
      return;
    }
`;
  assert.equal(enabled.replace(capture, "").replace(branch, ""), renderRendererTagOverlay(source));
});

test("dispatcher mode and span drift reject every control combination", async () => {
  const {platformPlugin} = await import("../sdk/toolchain/platform-plugin.mjs");
  for (const mode of ["unknown", "", null, false]) {
    assert.throws(() => renderRendererTagOverlay(source, "current", {nativeDispatchMode: mode}), /E_RENDERER_NATIVE_DISPATCH_MODE/);
    assert.throws(() => platformPlugin("unused", () => { throw Error("must not resolve"); }, {nativeDispatchMode: mode}), /E_RENDERER_NATIVE_DISPATCH_MODE/);
  }
  const opening = "function dispatchEvent(target, topLevelType, nativeEvent) {";
  const spanEnd = "    event = eventTarget;";
  const start = source.indexOf(opening), end = source.indexOf(spanEnd, start) + spanEnd.length;
  const span = source.slice(start, end);
  for (const tagMode of ["current", "original"])
    for (const nativeDispatchMode of ["original", "experimental"]) {
      assert.throws(() => renderRendererTagOverlay(source + "\n", tagMode, {nativeDispatchMode}), /E_RENDERER_TAG_OVERLAY_INPUT/);
      for (const drift of [source.replace(span, ""), source + "\n" + span])
        assert.throws(() => renderRendererTagOverlay(drift, tagMode, {nativeDispatchMode}), /E_RENDERER_NATIVE_DISPATCH_SPAN/);
      const generated = renderRendererTagOverlay(source, "original", {nativeDispatchMode: "experimental"});
      assert.throws(() => renderRendererTagOverlay(generated, tagMode, {nativeDispatchMode}), /E_RENDERER_NATIVE_DISPATCH_SPAN/);
    }
});

// These bounded function controls prove generated routing only. Real refs,
// native queue priority, responder state and React commits require Godot proof.
function isolatedDispatch(flagGetter, nativeDispatcher) {
  const enabled = renderRendererTagOverlay(source, "current", {nativeDispatchMode: "experimental"});
  const start = enabled.indexOf("var nativeEventTargetDispatchEnabledForGodot =");
  const end = enabled.indexOf("\nvar scheduleCallback$3 =", start);
  const trace = [], publicTarget = {}, stateNode = {}, nativePayload = {};
  let batched = false, legacyCalls = 0;
  const privateInterface = {
    RawEventEmitter: {emit(type, event) { trace.push({kind: "raw", type, event, batched}); }},
    dispatchNativeEvent(target, type, payload) {
      trace.push({kind: "native", target, type, payload, batched});
      return nativeDispatcher?.(target, type, payload);
    },
  };
  const dispatch = new Function("ReactNativePrivateInterface", "RN$isNativeEventTargetEventDispatchingEnabled",
    "batchedUpdates$1", "getPublicInstance", "plugins", "let eventQueue = null;\n" +
    enabled.slice(start, end) + "\nreturn dispatchEvent;")(privateInterface, flagGetter,
      callback => { batched = true; try { return callback(); } finally { batched = false; } },
      node => { assert.equal(node, stateNode); return publicTarget; },
      [{extractEvents() { legacyCalls++; trace.push({kind: "legacy", batched}); return null; }}]);
  return {dispatch, trace, publicTarget, nativePayload, target: {stateNode},
    isBatched: () => batched, legacyCalls: () => legacyCalls};
}

test("experimental routing captures the original flag once and emits both Raw channels before one exclusive batched dispatch", () => {
  let selected = true, reads = 0;
  const f = isolatedDispatch(() => { reads++; return selected; });
  assert.equal(reads, 1);
  for (const type of ["topTouchStart", "topTouchEnd"]) {
    selected = false;
    f.dispatch(f.target, type, f.nativePayload);
    const entries = f.trace.slice(-3);
    assert.deepEqual(entries.map(entry => [entry.kind, entry.type, entry.batched]),
      [["raw", type, true], ["raw", "*", true], ["native", type, true]]);
    assert.equal(entries[0].event, entries[1].event);
    assert.equal(entries[0].event.nativeEvent, f.nativePayload);
    assert.equal(entries[2].target, f.publicTarget);
    assert.equal(entries[2].payload, f.nativePayload);
    assert.equal(f.isBatched(), false);
  }
  assert.equal(reads, 1);
  assert.equal(f.legacyCalls(), 0);
});

test("missing and disabled original flags retain exclusive legacy routing for the lifetime of the renderer", () => {
  let selected = false, reads = 0;
  const disabled = isolatedDispatch(() => { reads++; return selected; });
  selected = true;
  for (const f of [disabled, isolatedDispatch(undefined)]) {
    f.dispatch(f.target, "topTouchStart", f.nativePayload);
    assert.deepEqual(f.trace.map(entry => [entry.kind, entry.batched]),
      [["raw", true], ["raw", true], ["legacy", true]]);
    assert.equal(f.legacyCalls(), 1);
    assert.equal(f.isBatched(), false);
  }
  assert.equal(reads, 1);
});

test("experimental routing never falls back to legacy for a null target or a thrown dispatcher", () => {
  const fault = new Error("isolated original-dispatch failure");
  let fail = true;
  const f = isolatedDispatch(() => true, () => { if (fail) throw fault; });
  assert.throws(() => f.dispatch(null, "topTouchCancel", f.nativePayload), error => error === fault);
  assert.equal(f.trace.at(-1).target, null);
  assert.equal(f.isBatched(), false);
  assert.equal(f.legacyCalls(), 0);
  fail = false;
  f.dispatch(f.target, "topTouchStart", f.nativePayload);
  assert.equal(f.trace.filter(entry => entry.kind === "native").length, 2);
  assert.equal(f.trace.filter(entry => entry.kind === "raw").length, 4);
  assert.equal(f.isBatched(), false);
  assert.equal(f.legacyCalls(), 0);
});
