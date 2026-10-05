import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
import {runInNewContext} from "node:vm";
import {build} from "esbuild";
import {platformPlugin} from "../sdk/toolchain/platform-plugin.mjs";
import {renderPointerInterestOverlay} from "../sdk/toolchain/rn-pointer-interest-overlay.mjs";

const rnRoot = path.dirname(createRequire(import.meta.url).resolve("react-native/package.json"));
const source = await readFile(path.join(rnRoot, "src/private/webapis/dom/events/EventTarget.js"), "utf8");
const originalStorageFunction = `function getListenersForPhase(
  eventTarget: EventTarget,
  isCapture: boolean,
): ?ListenersMap {
  return isCapture
    ? // $FlowExpectedError[prop-missing]
      eventTarget[CAPTURING_LISTENERS_KEY]
    : // $FlowExpectedError[prop-missing]
      eventTarget[BUBBLING_LISTENERS_KEY];
}`;
const exportOpening = "export function hasPointerDownListenerForGodot(target, capture) {";
const upExportOpening = "export function hasPointerUpListenerForGodot(target, capture) {";
const moveExportOpening = "export function hasPointerMoveListenerForGodot(target, capture) {";

// Execute only the generated queries against supplied original-shaped storage.
// This does not certify RN registration, NativeDOM, or native input transport.
function queriesWithStorage(getListenersForPhase) {
  const generated = renderPointerInterestOverlay(source, "current");
  const appended = generated.slice(source.length + 1);
  assert.equal(appended.split(exportOpening).length, 2);
  assert.equal(appended.split(upExportOpening).length, 2);
  assert.equal(appended.split(moveExportOpening).length, 2);
  return new Function("getListenersForPhase", appended.replace(/^export /gm, "") +
    "\nreturn {down: hasPointerDownListenerForGodot, up: hasPointerUpListenerForGodot, " +
    "move: hasPointerMoveListenerForGodot};")(getListenersForPhase);
}
function queryWithStorage(getListenersForPhase) { return queriesWithStorage(getListenersForPhase).down; }
function upQueryWithStorage(getListenersForPhase) { return queriesWithStorage(getListenersForPhase).up; }
function moveQueryWithStorage(getListenersForPhase) { return queriesWithStorage(getListenersForPhase).move; }

test("default and original controls retain the exact pinned EventTarget bytes", () => {
  assert.equal(createHash("sha256").update(source).digest("hex"),
    "9ef4ad5d04667a3e786de5008f3a3da76920215b16b6605549db4f3b206b0e53");
  assert.equal(source.split(originalStorageFunction).length, 2);
  assert.equal(renderPointerInterestOverlay(source), source);
  assert.equal(renderPointerInterestOverlay(source, "original"), source);
  assert.ok(!source.includes(exportOpening));
  assert.ok(!source.includes(upExportOpening));
  assert.ok(!source.includes(moveExportOpening));
});

test("current mode only appends shared Down/Up/Move queries and preserves every original method byte", () => {
  const generated = renderPointerInterestOverlay(source, "current");
  assert.equal(generated.slice(0, source.length), source);
  assert.equal(generated[source.length], "\n");
  assert.equal(generated.split(exportOpening).length, 2);
  assert.equal(generated.split(upExportOpening).length, 2);
  assert.equal(generated.split(moveExportOpening).length, 2);
  assert.equal(generated.split("function hasPointerListenerForGodot(target, capture, type) {").length, 2);
  assert.equal(generated.split(originalStorageFunction).length, 2);
  assert.ok(generated.indexOf(exportOpening) > source.length);
  assert.ok(generated.indexOf(upExportOpening) > source.length);
  assert.ok(generated.indexOf(moveExportOpening) > source.length);
  assert.equal(renderPointerInterestOverlay(source, "current"), generated);
});

test("unsupported modes fail before source adaptation", () => {
  for (const mode of ["unknown", "", null, false, 0])
    assert.throws(() => renderPointerInterestOverlay(source, mode), /E_POINTER_INTEREST_OVERLAY_MODE/);
});

test("unrelated whole-source pin drift is rejected in both modes", () => {
  for (const mode of ["original", "current"])
    for (const drift of [source + "\n", "// unrelated upstream change\n" + source])
      assert.throws(() => renderPointerInterestOverlay(drift, mode), /E_POINTER_INTEREST_OVERLAY_INPUT/);
});

test("missing or repeated original storage spans fail in both modes", () => {
  for (const mode of ["original", "current"])
    for (const invalid of [source.replace(originalStorageFunction, ""), source + "\n" + originalStorageFunction])
      assert.throws(() => renderPointerInterestOverlay(invalid, mode), /E_POINTER_INTEREST_OVERLAY_SPAN/);
});

test("generated input cannot be reapplied or accepted as an original control", () => {
  const generated = renderPointerInterestOverlay(source, "current");
  for (const mode of ["original", "current"])
    assert.throws(() => renderPointerInterestOverlay(generated, mode), /E_POINTER_INTEREST_OVERLAY_INPUT/);
});

test("invalid source values fail with the overlay input diagnostic", () => {
  for (const mode of ["original", "current"])
    for (const invalid of [undefined, null, {}, 0])
      assert.throws(() => renderPointerInterestOverlay(invalid, mode), /E_POINTER_INTEREST_OVERLAY_INPUT/);
});

test("the appended query distinguishes exact pointerdown storage and both phases", () => {
  const target = {};
  const bubble = new Map([["pointerdown", new Map([[() => {}, {removed: false}]])]]);
  const capture = new Map([["pointerdown", new Map([[() => {}, {removed: true}]])]]);
  const calls = [];
  const query = queryWithStorage((value, isCapture) => {
    calls.push([value, isCapture]);
    return isCapture ? capture : bubble;
  });
  assert.equal(query(target, false), true);
  assert.equal(query(target, true), false);
  capture.set("pointerdown", new Map([[() => {}, {removed: false}]]));
  bubble.delete("pointerdown");
  assert.equal(query(target, false), false);
  assert.equal(query(target, true), true);
  assert.deepEqual(calls, [[target, false], [target, true], [target, false], [target, true]]);

  for (const otherType of ["pointermove", "pointerup", "touchstart", "pointerDown"])
    assert.equal(queryWithStorage(() => new Map([[otherType, new Map([[() => {}, {removed: false}]])]]))(target, false), false);
});

test("null targets and missing or empty registration maps have no interest", () => {
  const noTarget = queryWithStorage(() => { throw Error("null target must not inspect storage"); });
  assert.equal(noTarget(null, false), false);
  assert.equal(noTarget(undefined, true), false);
  for (const map of [undefined, null, new Map(), new Map([["pointerdown", new Map()]])])
    assert.equal(queryWithStorage(() => map)({}, false), false);
});

test("live storage updates and removed registrations are observed without caching", () => {
  const target = {}, callback = () => {}, registration = {removed: true};
  const listeners = new Map([[callback, registration]]);
  const storage = new Map([["pointerdown", listeners]]);
  const query = queryWithStorage(() => storage);
  assert.equal(query(target, false), false);
  registration.removed = false;
  assert.equal(query(target, false), true);
  registration.removed = true;
  assert.equal(query(target, false), false);
  const replacement = {removed: false};
  listeners.set(callback, replacement);
  assert.equal(query(target, false), true);
  listeners.delete(callback);
  assert.equal(query(target, false), false);
  listeners.set(callback, registration);
  listeners.set(() => {}, {removed: false});
  assert.equal(query(target, false), true, "an earlier removed entry cannot hide a later live one");
  storage.delete("pointerdown");
  assert.equal(query(target, false), false);
});

test("query reads removed only without invoking callbacks or inspecting user listener options", () => {
  const callback = () => { throw Error("interest query invoked callback"); };
  const handler = Object.defineProperty({}, "handleEvent", {get() { throw Error("interest query inspected handleEvent"); }});
  const registration = {removed: false};
  for (const field of ["callback", "once", "passive", "capture", "signal"])
    Object.defineProperty(registration, field, {get() { throw Error("interest query inspected " + field); }});
  Object.freeze(registration);
  const listeners = new Map([[callback, registration], [handler, {removed: true}]]);
  const storage = new Map([["pointerdown", listeners]]);
  const entries = [...listeners];
  const query = queryWithStorage(() => storage);
  assert.equal(query({}, false), true);
  assert.equal(query({}, false), true);
  assert.equal(storage.get("pointerdown"), listeners);
  assert.deepEqual([...listeners], entries);
  assert.equal(registration.removed, false);

  const objectListener = Object.freeze({removed: false, callback: handler});
  const objectListeners = new Map([[handler, objectListener]]);
  assert.equal(queryWithStorage(() => new Map([["pointerdown", objectListeners]]))({}, true), true);
  assert.equal(objectListeners.get(handler), objectListener);

  const oncePassive = Object.freeze({removed: false, once: true, passive: true, callback});
  const onceListeners = new Map([[callback, oncePassive]]);
  const onceQuery = queryWithStorage(() => new Map([["pointerdown", onceListeners]]));
  assert.equal(onceQuery({}, true), true);
  assert.equal(onceQuery({}, true), true);
  assert.equal(onceListeners.get(callback), oncePassive);
  assert.equal(onceListeners.size, 1, "interest checks must not consume once registrations");
});

test("the plugin rejects invalid interest modes and incompatible dispatch before resolving the SDK", () => {
  const neverResolve = () => { throw Error("configuration must fail before resolution or build"); };
  for (const pointerInterestMode of ["unknown", "", null, false, 0])
    assert.throws(() => platformPlugin("unused", neverResolve,
      {pointerInterestMode, nativeDispatchMode: "experimental"}), /E_POINTER_INTEREST_OVERLAY_MODE/);
  for (const options of [{pointerInterestMode: "current"},
    {pointerInterestMode: "current", nativeDispatchMode: "original"}])
    assert.throws(() => platformPlugin("unused", neverResolve, options), /E_POINTER_INTEREST_DISPATCH/);
});

function absoluteInputs(result, directory) {
  return Object.entries(result.metafile.inputs).map(([filename, metadata]) =>
    [path.resolve(directory, filename), metadata]);
}

async function relocatedPlatform(t) {
  const repository = fileURLToPath(new URL("..", import.meta.url));
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "godot-pointer-interest-seam-")));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const platformRoot = path.join(directory, "addon", "src");
  await cp(path.join(repository, "src"), platformRoot, {recursive: true});
  return {directory, platformRoot, sdkResolver: createRequire(path.join(repository, "package.json")).resolve};
}

test("the default SDK helper bundles without an RN query or native installer", async t => {
  const {directory, platformRoot, sdkResolver} = await relocatedPlatform(t);
  const helper = path.join(platformRoot, "pointer-listener-query.js");
  const originalHelper = await readFile(helper, "utf8");
  const result = await build({absWorkingDir: directory, entryPoints: [helper], bundle: true,
    write: false, platform: "neutral", format: "esm", metafile: true,
    plugins: [platformPlugin(platformRoot, sdkResolver)]});
  const output = result.outputFiles[0].text;
  assert.match(output, /function installPointerListenerQuery\(\)\s*\{\s*\}/);
  assert.doesNotMatch(output, /godotInstallPointerListenerQuery|hasPointer(?:Down|Up|Move)ListenerForGodot/);
  assert.deepEqual(absoluteInputs(result, directory).map(([filename]) => filename), [helper]);
  assert.equal(await readFile(helper, "utf8"), originalHelper, "the generated toolchain must not edit its input helper");
});

test("the relocated opt-in helper uses exact SDK EventTarget and flags while preserving project dependency ownership", async t => {
  const {directory, platformRoot, sdkResolver} = await relocatedPlatform(t);
  const helper = path.join(platformRoot, "pointer-listener-query.js");
  const eventTargetRelative = "src/private/webapis/dom/events/EventTarget.js";
  const flagsRelative = "src/private/featureflags/ReactNativeFeatureFlags.js";
  const ownerRelative = "src/private/webapis/dom/nodes/internals/NodeInternals.js";
  const rootHandleRelative = "src/private/webapis/dom/nodes/internals/ReactNativeDocumentElementInstanceHandle.js";
  const eventTarget = await realpath(path.join(rnRoot, eventTargetRelative));
  const flags = await realpath(path.join(rnRoot, flagsRelative));
  const owner = await realpath(path.join(rnRoot, ownerRelative));
  const rootHandle = await realpath(path.join(rnRoot, rootHandleRelative));
  const sourceBefore = await readFile(eventTarget, "utf8");
  const helperBefore = await readFile(helper, "utf8");
  const neighborRoot = path.join(directory, "addon", "node_modules", "react-native");
  for (const [relative, contents] of [[eventTargetRelative,
    'export function hasPointerDownListenerForGodot() { return "neighbor-stole-pointer-query"; }\n' +
      'export function hasPointerUpListenerForGodot() { return "neighbor-stole-pointer-query"; }\n' +
      'export function hasPointerMoveListenerForGodot() { return "neighbor-stole-pointer-query"; }'],
    [flagsRelative, 'export function enableImperativeEvents() { return "neighbor-stole-flags"; }\n' +
      'export function enableNativeEventTargetEventDispatching() { return true; }'],
    [ownerRelative, 'export function getOwnerDocument() { throw Error("neighbor-stole-owner"); }'],
    [rootHandleRelative, 'export function isReactNativeDocumentElementInstanceHandle() { throw Error("neighbor-stole-root-handle"); }\n' +
      'export function getPublicInstanceFromReactNativeDocumentElementInstanceHandle() { return null; }']]) {
    await mkdir(path.dirname(path.join(neighborRoot, relative)), {recursive: true});
    await writeFile(path.join(neighborRoot, relative), contents);
  }
  const consumerName = "pointer-interest-consumer";
  const consumer = path.join(directory, "node_modules", consumerName, "index.js");
  const sdkConsumer = path.join(directory, "addon", "node_modules", consumerName, "index.js");
  for (const [filename, marker] of [[consumer, "project-owned-pointer-interest-dependency"],
    [sdkConsumer, "sdk-stole-pointer-interest-dependency"]]) {
    await mkdir(path.dirname(filename), {recursive: true});
    await writeFile(path.join(path.dirname(filename), "package.json"),
      JSON.stringify({name: consumerName, version: "1.0.0", main: "index.js"}));
    await writeFile(filename, 'export default "' + marker + '";');
  }
  const consumerSdkLookups = [];
  const guardedResolver = specifier => {
    if (specifier === consumerName) {
      consumerSdkLookups.push(specifier);
      return sdkConsumer;
    }
    return sdkResolver(specifier);
  };
  await writeFile(path.join(directory, "App.js"),
    'export {installPointerListenerQuery} from "./addon/src/pointer-listener-query.js";\n' +
    'export {default as consumerMarker} from "' + consumerName + '";');
  const result = await build({absWorkingDir: directory, entryPoints: ["App.js"], bundle: true,
    write: false, platform: "neutral", format: "esm", mainFields: ["main"], metafile: true,
    define: {"process.env.NODE_ENV": '"production"', __DEV__: "false"},
    plugins: [platformPlugin(platformRoot, guardedResolver,
      {pointerInterestMode: "current", nativeDispatchMode: "experimental"})]});
  const entries = absoluteInputs(result, directory), inputs = entries.map(([filename]) => filename);
  assert.ok(inputs.includes(helper), "the actual relocated SDK helper must enter the bundle");
  for (const required of [eventTarget, flags, owner, rootHandle])
    assert.equal(inputs.filter(filename => filename === required).length, 1,
      "each exact SDK RN module must enter once");
  const helperImports = entries.find(([filename]) => filename === helper)[1].imports
    .map(entry => path.resolve(directory, entry.path));
  assert.ok(helperImports.includes(eventTarget), "the helper must directly import exact SDK EventTarget");
  assert.ok(helperImports.includes(flags), "the helper must directly import exact SDK flags");
  assert.ok(helperImports.includes(owner), "the root query must directly import the original owner slot reader");
  assert.ok(helperImports.includes(rootHandle), "the root query must directly import the specialized original handle reader");
  for (const relative of [eventTargetRelative, flagsRelative, ownerRelative, rootHandleRelative])
    assert.ok(!inputs.includes(path.join(neighborRoot, relative)), "physically resolvable RN neighbors cannot steal SDK imports");
  assert.ok(inputs.includes(consumer), "the project's ordinary dependency must remain project-owned");
  assert.ok(!inputs.includes(sdkConsumer));
  assert.deepEqual(consumerSdkLookups, [], "the plugin cannot consult SDK resolution for an ordinary project package");
  const output = result.outputFiles[0].text;
  assert.match(output, /godotInstallPointerListenerQuery/);
  assert.match(output, /hasPointerDownListenerForGodot/);
  assert.match(output, /hasPointerUpListenerForGodot/);
  assert.match(output, /hasPointerMoveListenerForGodot/);
  assert.match(output, /project-owned-pointer-interest-dependency/);
  assert.doesNotMatch(output, /neighbor-stole|sdk-stole-pointer-interest-dependency/);
  assert.equal(await readFile(eventTarget, "utf8"), sourceBefore, "the pinned RN input must remain unchanged");
  assert.equal(await readFile(helper, "utf8"), helperBefore, "only generated loading may replace the helper");
});

test("a project's matching helper filename remains project-owned even in current mode", async t => {
  const {directory, platformRoot, sdkResolver} = await relocatedPlatform(t);
  const projectHelper = path.join(directory, "src", "pointer-listener-query.js");
  await mkdir(path.dirname(projectHelper), {recursive: true});
  await writeFile(projectHelper, 'export default "project-owned-pointer-listener-query";');
  await writeFile(path.join(directory, "App.js"),
    'export {default} from "./src/pointer-listener-query.js";');
  const result = await build({absWorkingDir: directory, entryPoints: ["App.js"], bundle: true,
    write: false, platform: "neutral", format: "esm", metafile: true,
    plugins: [platformPlugin(platformRoot, sdkResolver,
      {pointerInterestMode: "current", nativeDispatchMode: "experimental"})]});
  const inputs = absoluteInputs(result, directory).map(([filename]) => filename);
  assert.deepEqual(new Set(inputs), new Set([path.join(directory, "App.js"), projectHelper]));
  assert.match(result.outputFiles[0].text, /project-owned-pointer-listener-query/);
  assert.doesNotMatch(result.outputFiles[0].text, /godotInstallPointerListenerQuery|hasPointer(?:Down|Up|Move)ListenerForGodot/);
});


test("the pure Up query selects only pointerup registrations in the requested phase", () => {
  const target = {}, down = {removed: false}, upBubble = {removed: true}, upCapture = {removed: false};
  const bubble = new Map([["pointerdown", new Map([[() => {}, down]])],
    ["pointerup", new Map([[() => {}, upBubble]])]]);
  const capture = new Map([["pointerdown", new Map([[() => {}, {removed: true}]])],
    ["pointerup", new Map([[() => {}, upCapture]])]]);
  const calls = [];
  const queries = queriesWithStorage((value, isCapture) => {
    calls.push([value, isCapture]); return isCapture ? capture : bubble;
  });
  assert.equal(queries.up(target, false), false);
  assert.equal(queries.up(target, true), true);
  assert.equal(queries.down(target, false), true);
  assert.equal(queries.down(target, true), false);
  assert.deepEqual(calls, [[target, false], [target, true], [target, false], [target, true]]);
  upBubble.removed = false;
  assert.equal(queries.up(target, false), true);
  bubble.delete("pointerup");
  assert.equal(queries.up(target, false), false);
  assert.equal(queries.down(target, false), true, "Up removal cannot erase Down interest");
  upCapture.removed = true;
  assert.equal(queries.up(target, true), false);
  capture.get("pointerup").set(() => {}, {removed: false});
  assert.equal(queries.up(target, true), true, "a removed Up entry cannot hide a later live entry");
  for (const type of ["pointerdown", "pointermove", "pointercancel", "pointerUp", "touchend"])
    assert.equal(upQueryWithStorage(() => new Map([[type, new Map([[() => {}, {removed: false}]])]]))(target, false), false);
});

test("Up interest is read-only and rejects missing storage without consuming once listeners", () => {
  const noTarget = upQueryWithStorage(() => { throw Error("null Up target inspected storage"); });
  assert.equal(noTarget(null, false), false);
  assert.equal(noTarget(undefined, true), false);
  for (const storage of [null, undefined, new Map(), new Map([["pointerup", new Map()]])])
    assert.equal(upQueryWithStorage(() => storage)({}, true), false);
  const callback = () => { throw Error("Up interest invoked a listener"); };
  const registration = {removed: false};
  for (const key of ["callback", "once", "signal", "passive", "capture"])
    Object.defineProperty(registration, key, {get() { throw Error("Up interest inspected " + key); }});
  Object.freeze(registration);
  const listeners = new Map([[callback, registration]]), storage = new Map([["pointerup", listeners]]);
  const entries = [...listeners], query = upQueryWithStorage(() => storage);
  assert.equal(query({}, false), true); assert.equal(query({}, false), true);
  assert.equal(storage.get("pointerup"), listeners); assert.deepEqual([...listeners], entries);
  const once = Object.freeze({removed: false, once: true, callback});
  const onceListeners = new Map([[callback, once]]);
  const onceQuery = upQueryWithStorage(() => new Map([["pointerup", onceListeners]]));
  assert.equal(onceQuery({}, true), true); assert.equal(onceQuery({}, true), true);
  assert.equal(onceListeners.size, 1); assert.equal(onceListeners.get(callback), once);
});

test("the pure Move query selects only pointermove registrations in the requested phase", () => {
  const target = {}, moveBubble = {removed: true}, moveCapture = {removed: false};
  const bubble = new Map([["pointerdown", new Map([[() => {}, {removed: false}]])],
    ["pointerup", new Map([[() => {}, {removed: false}]])],
    ["pointermove", new Map([[() => {}, moveBubble]])]]);
  const capture = new Map([["pointermove", new Map([[() => {}, moveCapture]])]]);
  const calls = [];
  const queries = queriesWithStorage((value, isCapture) => {
    calls.push([value, isCapture]); return isCapture ? capture : bubble;
  });
  assert.equal(queries.move(target, false), false, "a removed bubble Move entry is not interest");
  assert.equal(queries.move(target, true), true);
  assert.deepEqual(calls, [[target, false], [target, true]]);
  moveBubble.removed = false;
  assert.equal(queries.move(target, false), true);
  bubble.delete("pointermove");
  assert.equal(queries.move(target, false), false);
  assert.equal(queries.down(target, false), true, "Move removal cannot erase Down interest");
  assert.equal(queries.up(target, false), true, "Move removal cannot erase Up interest");
  assert.equal(queries.down(target, true), false, "capture Move cannot satisfy Down");
  assert.equal(queries.up(target, true), false, "capture Move cannot satisfy Up");
  moveCapture.removed = true;
  assert.equal(queries.move(target, true), false);
  capture.get("pointermove").set(() => {}, {removed: false});
  assert.equal(queries.move(target, true), true, "a removed Move entry cannot hide a later live entry");
  for (const type of ["pointerdown", "pointerup", "pointerover", "pointerenter", "pointerrawupdate",
    "pointerMove", "touchmove", "mousemove"])
    assert.equal(moveQueryWithStorage(() => new Map([[type, new Map([[() => {}, {removed: false}]])]]))(target, false), false);
});

test("Move interest is read-only and rejects missing storage without consuming once listeners", () => {
  const noTarget = moveQueryWithStorage(() => { throw Error("null Move target inspected storage"); });
  assert.equal(noTarget(null, false), false);
  assert.equal(noTarget(undefined, true), false);
  for (const storage of [null, undefined, new Map(), new Map([["pointermove", new Map()]])])
    assert.equal(moveQueryWithStorage(() => storage)({}, false), false);
  const callback = () => { throw Error("Move interest invoked a listener"); };
  const registration = {removed: false};
  for (const key of ["callback", "once", "signal", "passive", "capture"])
    Object.defineProperty(registration, key, {get() { throw Error("Move interest inspected " + key); }});
  Object.freeze(registration);
  const listeners = new Map([[callback, registration]]), storage = new Map([["pointermove", listeners]]);
  const entries = [...listeners], query = moveQueryWithStorage(() => storage);
  assert.equal(query({}, true), true); assert.equal(query({}, true), true);
  assert.equal(storage.get("pointermove"), listeners); assert.deepEqual([...listeners], entries);
  const once = Object.freeze({removed: false, once: true, callback});
  const onceListeners = new Map([[callback, once]]);
  const onceQuery = moveQueryWithStorage(() => new Map([["pointermove", onceListeners]]));
  assert.equal(onceQuery({}, false), true); assert.equal(onceQuery({}, false), true);
  assert.equal(onceListeners.size, 1); assert.equal(onceListeners.get(callback), once);
});

// Compile the actual generated SDK helper with narrow module fixtures. Storage
// queries come from the real appended overlay; handles/flags are original-shaped
// mocks. This certifies its strict offset table, not RN instances or native input.
async function compiledInstaller(t) {
  const {directory, platformRoot, sdkResolver} = await relocatedPlatform(t);
  const helper = path.join(platformRoot, "pointer-listener-query.js");
  const eventTarget = path.join(rnRoot, "src/private/webapis/dom/events/EventTarget.js");
  const flags = path.join(rnRoot, "src/private/featureflags/ReactNativeFeatureFlags.js");
  const owner = path.join(rnRoot, "src/private/webapis/dom/nodes/internals/NodeInternals.js");
  const handle = path.join(rnRoot, "src/private/webapis/dom/nodes/internals/ReactNativeDocumentElementInstanceHandle.js");
  const appended = renderPointerInterestOverlay(source, "current").slice(source.length + 1);
  const replacements = new Map([
    [eventTarget, "function getListenersForPhase(target, capture) { globalThis.__pointerStorageReads.push([target, capture]); return capture ? target.capture : target.bubble; }\n" + appended],
    [flags, "export function enableNativeEventTargetEventDispatching() { return globalThis.__pointerTestFlags.nativeDispatch; }"],
    [owner, "export function getOwnerDocument(element) { return element.ownerDocument; }"],
    [handle, "export function isReactNativeDocumentElementInstanceHandle(candidate) { return candidate != null && candidate.rootHandle === true; }\nexport function getPublicInstanceFromReactNativeDocumentElementInstanceHandle(candidate) { return candidate.publicInstance; }"]]);
  const result = await build({absWorkingDir: directory, entryPoints: [helper], bundle: true,
    write: false, platform: "neutral", format: "cjs", metafile: true, plugins: [
      {name: "pointer-offset-contract-modules", setup(builder) {
        builder.onLoad({filter: /\.js$/}, ({path: filename}) => replacements.has(filename)
          ? {loader: "js", contents: replacements.get(filename)} : undefined);
      }}, platformPlugin(platformRoot, sdkResolver,
        {pointerInterestMode: "current", nativeDispatchMode: "experimental"})]});
  for (const filename of replacements.keys())
    assert.ok(absoluteInputs(result, directory).some(([input]) => input === filename));
  return nativeDispatch => {
    const installed = [], storageReads = [], flagsValue = Object.freeze({nativeDispatch});
    const context = {module: {exports: {}}, __pointerStorageReads: storageReads, __pointerTestFlags: flagsValue,
      godotInstallPointerListenerQuery: query => installed.push(query)};
    runInNewContext(result.outputFiles[0].text, context);
    return {install: context.module.exports.installPointerListenerQuery, installed, storageReads};
  };
}

test("the compiled SDK installer gates installation and maps exactly Down/Up/Move bubble/capture offsets", async t => {
  const create = await compiledInstaller(t), disabled = create(false);
  disabled.install(); assert.deepEqual(disabled.installed, [], "native dispatch off must install no callback");
  const {install, installed, storageReads} = create(true); install();
  assert.equal(installed.length, 1);
  const query = installed[0], upBubble = {removed: true};
  const target = {bubble: new Map([["pointerdown", new Map([[() => {}, {removed: false}]])],
    ["pointerup", new Map([[() => {}, upBubble]])], ["pointermove", new Map([[() => {}, {removed: false}]])]]),
    capture: new Map([["pointerdown", new Map([[() => {}, {removed: true}]])],
      ["pointerup", new Map([[() => {}, {removed: false}]])], ["pointermove", new Map([[() => {}, {removed: true}]])]])};
  for (const [offset, capture, expected] of [[1, false, true], [25, true, false],
    [34, false, true], [35, true, false], [36, false, false], [37, true, true]]) {
    storageReads.length = 0;
    assert.equal(query(target, offset), expected);
    assert.equal(storageReads.length, 1); assert.equal(storageReads[0][0], target); assert.equal(storageReads[0][1], capture);
  }
  upBubble.removed = false; assert.equal(query(target, 36), true);
  target.bubble.delete("pointerup"); assert.equal(query(target, 36), false);
  assert.equal(query(target, 34), true, "Down remains live after Up removal");
  target.capture.get("pointermove").set(() => {}, {removed: false}); assert.equal(query(target, 25), true);
  target.bubble.delete("pointermove"); assert.equal(query(target, 1), false);
  assert.equal(query(target, 25), true, "capture Move remains live after bubble Move removal");
  // Hover, enter/leave, click and capture notifications stay outside the opt-in.
  const poisoned = new Proxy({}, {get() { throw Error("unsupported offset resolved a candidate"); }});
  for (const offset of [0, 2, 19, 23, 24, 26, 27, 28, 29, 30, 31, 32, 33, 38, -1, Infinity, NaN, "1", "36", null, undefined]) {
    storageReads.length = 0;
    assert.equal(query(poisoned, offset, true), false); assert.deepEqual(storageReads, []);
  }
});

test("the compiled root callback reads only the chosen original-shaped element or owner maps", async t => {
  const create = await compiledInstaller(t), {install, installed, storageReads} = create(true);
  install(); const query = installed[0];
  const doc = {bubble: new Map(), capture: new Map([["pointerup", new Map([[() => {}, {removed: false}]])]])};
  const element = {bubble: new Map(), capture: new Map(), ownerDocument: doc};
  const handle = {rootHandle: true, publicInstance: element};
  assert.equal(query(handle, 36, true), false);
  assert.equal(query(handle, 37, true), true);
  assert.equal(query(handle, 34, true), false); assert.equal(query(handle, 35, true), false);
  assert.equal(query(handle, 1, true), false); assert.equal(query(handle, 25, true), false);
  doc.bubble.set("pointermove", new Map([[() => {}, {removed: false}]]));
  assert.equal(query(handle, 1, true), true, "the owner Document bubble Move Map is consulted");
  assert.equal(query(handle, 25, true), false);
  storageReads.length = 0;
  assert.equal(query({rootHandle: false}, 37, true), false); assert.deepEqual(storageReads, []);
  assert.equal(query({rootHandle: true, publicInstance: null}, 37, true), false); assert.deepEqual(storageReads, []);
  const untouchedOwner = new Proxy({}, {get() { throw Error("element interest must short-circuit owner lookup"); }});
  element.capture.set("pointerup", new Map([[() => {}, {removed: false}]]));
  element.ownerDocument = untouchedOwner;
  assert.equal(query(handle, 37, true), true);
});
