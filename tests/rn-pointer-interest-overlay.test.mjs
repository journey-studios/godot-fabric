import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import test from "node:test";
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

// Execute only the generated query against supplied original-shaped storage.
// This does not certify RN registration, NativeDOM, or native input transport.
function queryWithStorage(getListenersForPhase) {
  const generated = renderPointerInterestOverlay(source, "current");
  const appended = generated.slice(source.length + 1);
  assert.equal(appended.split(exportOpening).length, 2);
  return new Function("getListenersForPhase", appended.replace(exportOpening,
    "function hasPointerDownListenerForGodot(target, capture) {") +
    "\nreturn hasPointerDownListenerForGodot;")(getListenersForPhase);
}

test("default and original controls retain the exact pinned EventTarget bytes", () => {
  assert.equal(createHash("sha256").update(source).digest("hex"),
    "9ef4ad5d04667a3e786de5008f3a3da76920215b16b6605549db4f3b206b0e53");
  assert.equal(source.split(originalStorageFunction).length, 2);
  assert.equal(renderPointerInterestOverlay(source), source);
  assert.equal(renderPointerInterestOverlay(source, "original"), source);
  assert.ok(!source.includes(exportOpening));
});

test("current mode only appends one query and preserves every original method byte", () => {
  const generated = renderPointerInterestOverlay(source, "current");
  assert.equal(generated.slice(0, source.length), source);
  assert.equal(generated[source.length], "\n");
  assert.equal(generated.split(exportOpening).length, 2);
  assert.equal(generated.split(originalStorageFunction).length, 2);
  assert.ok(generated.indexOf(exportOpening) > source.length);
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
  assert.doesNotMatch(output, /godotInstallPointerListenerQuery|hasPointerDownListenerForGodot/);
  assert.deepEqual(absoluteInputs(result, directory).map(([filename]) => filename), [helper]);
  assert.equal(await readFile(helper, "utf8"), originalHelper, "the generated toolchain must not edit its input helper");
});

test("the relocated opt-in helper uses exact SDK EventTarget and flags while preserving project dependency ownership", async t => {
  const {directory, platformRoot, sdkResolver} = await relocatedPlatform(t);
  const helper = path.join(platformRoot, "pointer-listener-query.js");
  const eventTargetRelative = "src/private/webapis/dom/events/EventTarget.js";
  const flagsRelative = "src/private/featureflags/ReactNativeFeatureFlags.js";
  const eventTarget = await realpath(path.join(rnRoot, eventTargetRelative));
  const flags = await realpath(path.join(rnRoot, flagsRelative));
  const sourceBefore = await readFile(eventTarget, "utf8");
  const helperBefore = await readFile(helper, "utf8");
  const neighborRoot = path.join(directory, "addon", "node_modules", "react-native");
  for (const [relative, contents] of [[eventTargetRelative,
    'export function hasPointerDownListenerForGodot() { return "neighbor-stole-pointer-query"; }'],
    [flagsRelative, 'export function enableImperativeEvents() { return "neighbor-stole-flags"; }\n' +
      'export function enableNativeEventTargetEventDispatching() { return true; }']]) {
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
  for (const required of [eventTarget, flags])
    assert.equal(inputs.filter(filename => filename === required).length, 1,
      "each exact SDK RN module must enter once");
  const helperImports = entries.find(([filename]) => filename === helper)[1].imports
    .map(entry => path.resolve(directory, entry.path));
  assert.ok(helperImports.includes(eventTarget), "the helper must directly import exact SDK EventTarget");
  assert.ok(helperImports.includes(flags), "the helper must directly import exact SDK flags");
  for (const relative of [eventTargetRelative, flagsRelative])
    assert.ok(!inputs.includes(path.join(neighborRoot, relative)), "physically resolvable RN neighbors cannot steal SDK imports");
  assert.ok(inputs.includes(consumer), "the project's ordinary dependency must remain project-owned");
  assert.ok(!inputs.includes(sdkConsumer));
  assert.deepEqual(consumerSdkLookups, [], "the plugin cannot consult SDK resolution for an ordinary project package");
  const output = result.outputFiles[0].text;
  assert.match(output, /godotInstallPointerListenerQuery/);
  assert.match(output, /hasPointerDownListenerForGodot/);
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
  assert.doesNotMatch(result.outputFiles[0].text, /godotInstallPointerListenerQuery|hasPointerDownListenerForGodot/);
});
