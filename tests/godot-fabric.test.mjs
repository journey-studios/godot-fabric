import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import ts from "typescript";
import { isSdkOwnedSpecifier, platformPlugin } from "../sdk/toolchain/platform-plugin.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const registryImport = "react-native/Libraries/TurboModule/TurboModuleRegistry";
let fixtureSequence = 0;
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function nativeFixture() {
  const listeners = new Set(), pending = new Map(), removed = [], calls = [];
  let next = 1;
  return {
    listeners, pending, removed, calls,
    reserve() { return next++; },
    onEvent(callback) { listeners.add(callback); return { remove() { listeners.delete(callback); } }; },
    connect(id, address, initial) {
      const result = deferred();
      pending.set(id, { ...result, address, initial });
      this.beforeConnect?.(id, address, initial);
      return result.promise;
    },
    remove(id) { removed.push(id); },
    emit(event) { for (const listener of [...listeners]) listener(event); },
    call(address, args) {
      calls.push({ address, args });
      return Promise.resolve({ ...address, generation: "1", response: "completion", value: args });
    },
    ack(id, revision = 0, value) {
      const request = pending.get(id);
      request.resolve({ ...request.address, generation: "1", revision,
        ...(request.initial ? { value } : {}) });
    },
    event(id, revision, args = [], extras = {}) {
      return { ...pending.get(id).address, subscriptionId: id, generation: "1", revision, args, ...extras };
    },
  };
}
async function fixture(run) {
  const native = nativeFixture(), errors = [], key = `__godotServicesTest${++fixtureSequence}`;
  globalThis[key] = native;
  const bundled = await build({ entryPoints: [path.join(root, "src/godot-fabric.js")], bundle: true,
    write: false, platform: "node", format: "esm", logLevel: "silent",
    plugins: [{ name: "mock-native-provider", setup(builder) {
      builder.onResolve({ filter: /^react-native\/Libraries\/TurboModule\/TurboModuleRegistry$/ },
        () => ({ path: "registry", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents:
        `export function getEnforcing(name) { if (name !== "GodotFabricServices") throw Error(name); return globalThis[${JSON.stringify(key)}]; }` }));
    } }],
  });
  const { GodotFabric } = await import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"));
  const originalError = console.error;
  console.error = (...values) => errors.push(values);
  try { await run(GodotFabric, native, errors); }
  finally { console.error = originalError; delete globalThis[key]; }
}

test("state connection installs listeners first, reads once and delivers only newer revisions in order", async () => {
  await fixture(async (GodotFabric, native, errors) => {
    const seen = [];
    native.beforeConnect = (id) => {
      assert.equal(native.listeners.size, 1);
      native.emit(native.event(id, 3, [], { value: { hp: 83 } }));
      native.emit(native.event(id, 4, [], { value: { hp: 84 } }));
      native.emit(native.event(id, 4, [], { value: { hp: -1 } }));
    };
    const subscription = GodotFabric.connect("player.health", snapshot => {
      seen.push(snapshot);
      if (snapshot.revision === 3) native.emit(native.event(1, 5, [], { value: { hp: 85 } }));
    });
    assert.deepEqual(seen, []);
    native.ack(1, 3, { hp: 83 });
    const initial = await subscription.ready;
    assert.equal(initial.revision, 3);
    assert.deepEqual(seen.map(snapshot => [snapshot.revision, snapshot.value.hp]), [[3, 83], [4, 84], [5, 85]]);
    assert.equal(initial.origin, "default");
    assert.equal(initial.name, "player.health");
    assert.equal(Object.isFrozen(initial), true);
    native.emit(native.event(1, 2, [], { value: { hp: -2 } }));
    native.emit(native.event(1, 6, [], { generation: "2", value: { hp: -3 } }));
    native.emit(native.event(1, 100, [], { subscriptionId: 999, value: { hp: -4 } }));
    assert.equal(seen.length, 3);
    assert.equal(errors.length, 1);
    subscription.remove(); subscription.remove();
    assert.deepEqual(native.removed, [1]);
    assert.equal(native.listeners.size, 0);
  });
});

test("signals preserve equal-revision occurrences, callback faults and reentrant buffering order", async () => {
  await fixture(async (GodotFabric, native, errors) => {
    const seen = [];
    const sub = GodotFabric.subscribe({ origin: "inventory", name: "item.picked" }, (label, count) => {
      seen.push([label, count]);
      if (label === "first") {
        native.emit(native.event(1, 1, ["third", 3]));
        throw new Error("consumer failure");
      }
    });
    native.emit(native.event(1, 1, ["first", 1]));
    native.emit(native.event(1, 1, ["second", 2]));
    native.ack(1, 1);
    assert.equal((await sub.ready).revision, 1);
    assert.deepEqual(seen, [["first", 1], ["second", 2], ["third", 3]]);
    assert.equal(errors.length, 1);
    native.emit(native.event(1, 1, ["fourth", 4]));
    assert.deepEqual(seen.at(-1), ["fourth", 4]);
    sub.remove();
    assert.equal(errors.length, 1, "normal remove produces no error diagnostic");
  });
});

test("removal before readiness and from initial/buffered callbacks settles ready and cancels queued work", async () => {
  await fixture(async (GodotFabric, native) => {
    let count = 0;
    const sub = GodotFabric.subscribe("change", () => count++);
    const queued = [...native.listeners][0];
    sub.remove(); sub.remove();
    await assert.rejects(sub.ready, error => error.code === "E_SUBSCRIPTION_REMOVED");
    native.ack(1);
    queued(native.event(1, 1));
    await Promise.resolve();
    assert.equal(count, 0);
    assert.equal(native.listeners.size, 0);
    const initial = GodotFabric.connect("value", () => { count++; initial.remove(); });
    native.ack(2, 0, null);
    await assert.rejects(initial.ready, error => error.code === "E_SUBSCRIPTION_REMOVED");
    assert.equal(count, 1);
    const buffered = GodotFabric.subscribe("change", () => { count++; buffered.remove(); });
    native.emit(native.event(3, 1)); native.emit(native.event(3, 2)); native.ack(3);
    await assert.rejects(buffered.ready, error => error.code === "E_SUBSCRIPTION_REMOVED");
    assert.equal(count, 2);
    assert.deepEqual(native.removed, [1, 2, 3]);
  });
});

test("closed bindings reject early readiness or close a live subscription, without calling its handler", async () => {
  await fixture(async (GodotFabric, native, errors) => {
    let calls = 0;
    const early = GodotFabric.connect("health", () => calls++);
    native.emit(native.event(1, 0, [], { closed: true, error: { code: "E_SERVICE_REMOVED", message: "source removed" } }));
    await assert.rejects(early.ready, error => error.code === "E_SERVICE_REMOVED");
    native.ack(1, 0, 90);
    const live = GodotFabric.subscribe("hit", () => calls++);
    native.ack(2);
    await live.ready;
    native.emit(native.event(2, 1, [], { closed: true, error: { code: "E_SERVICE_REMOVED", message: "owner freed" } }));
    live.remove();
    assert.equal(calls, 0);
    assert.equal(native.listeners.size, 0);
    assert.deepEqual(native.removed, [1, 2]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0][1].code, "E_SERVICE_REMOVED");
  });
});

test("foreign origins and malformed events are diagnosed without interrupting other subscriptions", async () => {
  await fixture(async (GodotFabric, native, errors) => {
    const one = [], two = [];
    const sub1 = GodotFabric.subscribe("one", value => one.push(value));
    const sub2 = GodotFabric.subscribe("two", value => two.push(value));
    native.ack(1); native.ack(2);
    await Promise.all([sub1.ready, sub2.ready]);
    assert.equal(native.listeners.size, 1, "logical subscriptions share one original RN listener");
    native.emit(native.event(1, 1, [1], { origin: "other" }));
    native.emit(native.event(1, -1, [1]));
    native.emit(native.event(1, 1, [], { args: undefined }));
    native.emit(native.event(1, 1, [NaN]));
    native.emit(native.event(1, 1, [], { closed: false }));
    const unread = {}; Object.defineProperty(unread, "subscriptionId", { get() { throw new Error("must not read event getter"); } });
    assert.doesNotThrow(() => native.emit(unread));
    native.emit(native.event(2, 1, [2]));
    sub1.remove();
    native.emit(native.event(2, 2, [3]));
    assert.equal(native.listeners.size, 1);
    assert.deepEqual(one, []);
    assert.deepEqual(two, [2, 3]);
    assert.equal(errors.length, 6);
    sub2.remove();
    assert.equal(native.listeners.size, 0);
  });
});

test("native failures release reserved subscriptions and normalize stopped runtime errors", async () => {
  await fixture(async (GodotFabric, native) => {
    const sub = GodotFabric.subscribe("missing", () => {});
    native.pending.get(1).reject(new Error("E_SERVICE_NOT_FOUND: missing"));
    await assert.rejects(sub.ready, error => error.code === "E_SERVICE_NOT_FOUND");
    assert.deepEqual(native.removed, [1]);
    assert.equal(native.listeners.size, 0);
    native.onEvent = () => { throw new Error("E_RUNTIME_STOPPED: stopped"); };
    const late = GodotFabric.subscribe("late", () => {});
    await assert.rejects(late.ready, error => error.code === "E_RUNTIME_STOPPED");
    late.remove();
    assert.deepEqual(native.removed, [1, 2]);
    native.call = () => { throw new Error("Exception in HostFunction: E_RUNTIME_STOPPED: stopped\n\nError: native stack"); };
    let promise;
    assert.doesNotThrow(() => { promise = GodotFabric.call("late", []); });
    await assert.rejects(promise, error => error.code === "E_RUNTIME_STOPPED");
  });
});

test("strict DTOs reject coercion, cycles, unsafe numbers, hidden properties and unsupported prototypes", async () => {
  await fixture(async (GodotFabric, native) => {
    const cycle = {}; cycle.self = cycle;
    const accessor = {}; Object.defineProperty(accessor, "value", { enumerable: true, get() { throw new Error("must not read getter"); } });
    const hidden = {}; Object.defineProperty(hidden, "secret", { value: 1 });
    const symbolic = { [Symbol("key")]: 1 };
    const sparse = [1, , 3];
    const extraArray = [1]; extraArray.extra = 2;
    const getterArray = [1]; Object.defineProperty(getterArray, "0", { get() { throw new Error("must not read getter"); }, enumerable: true });
    for (const invalid of [undefined, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1,
      1n, () => {}, Symbol("value"), cycle, accessor, hidden, symbolic, sparse, extraArray,
      getterArray, new Date(), new Map(), new Set(), Object.create({ inherited: 1 }), { toJSON() { return 1; } }]) {
      await assert.rejects(GodotFabric.call("save", [invalid]), error => error.code === "E_SERVICE_DTO");
    }
    assert.equal(native.calls.length, 0);
    const shared = { hp: 90 }, input = [shared, shared, -0, 1.25, Object.assign(Object.create(null), { ok: true })];
    const result = GodotFabric.call("save", input);
    shared.hp = 0; input.push("mutated");
    assert.deepEqual((await result).value, [{ hp: 90 }, { hp: 90 }, -0, 1.25, { ok: true }]);
    assert.notEqual(native.calls[0].args[0], shared);
    assert.notEqual(native.calls[0].args[0], native.calls[0].args[1]);
    const protoKey = JSON.parse('{"__proto__":{"polluted":true}}');
    const copied = (await GodotFabric.call("save", [protoKey])).value[0];
    assert.equal(Object.prototype.hasOwnProperty.call(copied, "__proto__"), true);
    assert.equal({}.polluted, undefined);
    let deep = null;
    for (let depth = 0; depth < 33; depth++) deep = { nested: deep };
    await assert.rejects(GodotFabric.call("save", [deep]), error => error.code === "E_SERVICE_DTO_LIMIT");
    await assert.rejects(GodotFabric.call("save", Array(10000).fill(null)), error => error.code === "E_SERVICE_DTO_LIMIT");
    assert.equal((await GodotFabric.call("save", Array(9999).fill(null))).value.length, 9999);
  });
});

test("strings reject NUL and lone surrogates in values, keys and addresses before native work", async () => {
  await fixture(async (GodotFabric, native, errors) => {
    const invalidStrings = ["a\u0000b", "a\ud800b", "a\udc00b", "\ud800", "\udfff", "\ud800\ud800\udc00"];
    for (const invalid of invalidStrings) {
      await assert.rejects(GodotFabric.call("save", [invalid]), error => error.code === "E_SERVICE_DTO_STRING");
      await assert.rejects(GodotFabric.call("save", [{ [invalid]: "value" }]), error => error.code === "E_SERVICE_DTO_STRING");
      for (const target of [invalid, { origin: invalid, name: "save" }, { origin: "default", name: invalid },
        { origin: "default", name: "save", [invalid]: "hidden" }]) {
        await assert.rejects(GodotFabric.call(target, []), error => error.code === "E_SERVICE_DTO_STRING");
        assert.throws(() => GodotFabric.subscribe(target, () => {}), error => error.code === "E_SERVICE_DTO_STRING");
        assert.throws(() => GodotFabric.connect(target, () => {}), error => error.code === "E_SERVICE_DTO_STRING");
      }
      const unread = {};
      Object.defineProperty(unread, invalid, { enumerable: true, get() { throw Error("must not evaluate getter"); } });
      await assert.rejects(GodotFabric.call("save", [unread]), error => error.code === "E_SERVICE_DTO_STRING");
    }
    assert.equal(native.calls.length, 0);
    assert.equal(native.pending.size, 0);
    assert.equal(native.listeners.size, 0);
    assert.deepEqual(errors, []);
    const target = { origin: "inventário🔑", name: "ação🚀" };
    const value = { "é😀": "ç🚀", empty: "", validPairs: "\ud800\udc00\udbff\udfff" };
    assert.deepEqual((await GodotFabric.call(target, [value])).value, [value]);
    assert.deepEqual(native.calls[0].address, target);
  });
});

test("incoming invalid strings never reach handlers or silently change snapshots", async () => {
  await fixture(async (GodotFabric, native, errors) => {
    const seen = [];
    const initial = GodotFabric.connect("initial", value => seen.push(value));
    native.ack(1, 0, { invalid: "\u0000" });
    await assert.rejects(initial.ready, error => error.code === "E_SERVICE_DTO_STRING");
    const signals = GodotFabric.subscribe("signals", value => seen.push(value));
    native.ack(2); await signals.ready;
    native.emit(native.event(2, 1, ["\ud800"]));
    native.emit(native.event(2, 2, [{ "\u0000": "value" }]));
    native.emit(native.event(2, 3, ["ação🚀"]));
    assert.deepEqual(seen, ["ação🚀"]);
    assert.deepEqual(errors.map(values => values[1].code), ["E_SERVICE_DTO_STRING", "E_SERVICE_DTO_STRING"]);
    signals.remove();
    native.call = () => Promise.resolve({ origin: "default", name: "result", generation: "1", response: "completion", value: "\udc00" });
    await assert.rejects(GodotFabric.call("result", []), error => error.code === "E_SERVICE_DTO_STRING");
  });
});

test("addresses and native responses fail visibly instead of accepting an unrelated or malformed source", async () => {
  await fixture(async (GodotFabric, native) => {
    for (const invalid of ["", null, 3, {}, { origin: "", name: "x" }, { name: "x" },
      { origin: "default", name: "x", ignored: 1 }, { origin: "default", name: 2 }]) {
      await assert.rejects(GodotFabric.call(invalid, []));
      assert.throws(() => GodotFabric.subscribe(invalid, () => {}));
    }
    assert.throws(() => GodotFabric.subscribe("x", null), error => error.code === "E_SERVICE_ARGUMENT");
    const base = { origin: "default", name: "x", generation: "1", response: "completion", value: null };
    for (const invalid of [{ ...base, origin: "other" }, { ...base, generation: "01" },
      { ...base, response: "finished" }, { ...base, value: undefined }, { ...base, ignored: 1 }]) {
      native.call = () => Promise.resolve(invalid);
      await assert.rejects(GodotFabric.call("x", []));
    }
    const sub = GodotFabric.connect("x", () => { throw new Error("must not be called"); });
    native.pending.get(1).resolve({ origin: "default", name: "x", generation: "1", revision: 0 });
    await assert.rejects(sub.ready, error => error.code === "E_SERVICE_PROTOCOL");
    assert.equal(native.listeners.size, 0);
  });
});

test("state snapshots and updates accept the same 10000-node and depth32 payload boundaries", async () => {
  await fixture(async (GodotFabric, native, errors) => {
    let deep = null;
    for (let depth = 0; depth < 32; depth++) deep = { nested: deep };
    for (const [index, value] of [Array(9999).fill(null), deep].entries()) {
      const id = index + 1, seen = [];
      const subscription = GodotFabric.connect(`boundary${id}`, snapshot => seen.push(snapshot));
      native.ack(id, 0, value);
      await subscription.ready;
      native.emit(native.event(id, 1, [value], { value }));
      assert.equal(seen.length, 2, "an accepted initial value also reaches its update handler");
      assert.deepEqual(seen[0].value, value);
      assert.deepEqual(seen[1].value, value);
      assert.deepEqual(seen.map(snapshot => snapshot.revision), [0, 1]);
      subscription.remove();
    }
    assert.deepEqual(errors, []);
  });
});

test("protocol argument tuples retain strict shape and share their DTO budget across elements", async () => {
  await fixture(async (GodotFabric, native, errors) => {
    const seen = [], sub = GodotFabric.subscribe("boundary", (...args) => seen.push(args));
    native.ack(1); await sub.ready;
    native.emit(native.event(1, 1, [Array(4999).fill(null), Array(4999).fill(null)]));
    assert.equal(seen.length, 1, "two 5000-node arguments fit the shared budget");
    for (const invalid of [[Array(5000).fill(null), Array(4999).fill(null)], [1, , 3],
      Object.assign([1], { extra: 2 }), Object.assign([1], { [Symbol("key")]: 2 })])
      native.emit(native.event(1, 2, invalid));
    const accessor = [1]; Object.defineProperty(accessor, "0", { enumerable: true, get() { throw Error("must not evaluate"); } });
    native.emit(native.event(1, 2, accessor));
    native.emit(native.event(1, 2, Object.setPrototypeOf([1], null)));
    assert.equal(seen.length, 1);
    assert.equal(errors.length, 6);
    sub.remove();
  });
});

test("call args retain their integral DTO root budget independently of the service address", async () => {
  await fixture(async (GodotFabric, native) => {
    const target = { origin: "inventory.player", name: "save.snapshot" };
    const args = Array(9999).fill(null);
    const result = await GodotFabric.call(target, args);
    assert.equal(result.value.length, 9999);
    assert.deepEqual(native.calls[0].address, target);
    assert.equal(native.calls[0].args.length, 9999);
    await assert.rejects(GodotFabric.call(target, Array(10000).fill(null)), error => error.code === "E_SERVICE_DTO_LIMIT");
    assert.equal(native.calls.length, 1);
  });
});

test("the external SDK resolver owns the exact runtime import and preserves project ownership of subpaths", async () => {
  assert.equal(isSdkOwnedSpecifier("@godot-fabric/runtime"), true);
  for (const specifier of ["@godot-fabric/runtime/private", "@godot-fabric/runtime-other", "zustand", "react-native-svg"])
    assert.equal(isSdkOwnedSpecifier(specifier), false, specifier);
  const directory = await mkdtemp(path.join(os.tmpdir(), "godot-runtime-resolution-"));
  try {
    const entry = path.join(directory, "App.js");
    await writeFile(entry, 'import { GodotFabric } from "@godot-fabric/runtime"; export const execute = () => GodotFabric.call("save", []);');
    const sdkRequire = createRequire(path.join(root, "package.json"));
    const result = await build({ entryPoints: [entry], bundle: true, write: false, metafile: true, platform: "neutral",
      plugins: [{ name: "native-provider-test-boundary", setup(builder) {
        builder.onResolve({ filter: /^react-native\/Libraries\/TurboModule\/TurboModuleRegistry$/ },
          () => ({ path: registryImport, external: true }));
      } }, platformPlugin(path.join(root, "src"), id => sdkRequire.resolve(id))] });
    assert.ok(Object.keys(result.metafile.inputs).some(input => input.endsWith("src/godot-fabric.js")));
    await writeFile(entry, 'import { GodotFabric } from "@godot-fabric/runtime/private"; export { GodotFabric };');
    await assert.rejects(build({ entryPoints: [entry], bundle: true, write: false, logLevel: "silent",
      plugins: [platformPlugin(path.join(root, "src"), id => sdkRequire.resolve(id))] }), /Could not resolve/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("strict consumer types resolve the runtime import and preserve payload/result types", () => {
  const configuration = ts.readConfigFile(path.join(root, "tsconfig.godot.json"), ts.sys.readFile);
  assert.equal(configuration.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(configuration.config, ts.sys, root);
  assert.deepEqual(parsed.errors, []);
  const program = ts.createProgram([path.join(root, "tests/types/godot-fabric.tsx")], parsed.options);
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")), []);
});
