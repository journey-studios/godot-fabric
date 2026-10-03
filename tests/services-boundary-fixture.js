// Executed by the application's actual Hermes runtime and upstream RN modules.
import React from "react";
import { AppRegistry, TurboModuleRegistry, View, Text } from "react-native";
import { GodotFabric } from "@godot-fabric/runtime";

const native = TurboModuleRegistry.getEnforcing("GodotFabricServices");
const checks = [], diagnostics = [], rejected = {}, results = {}, states = {};
const connections = new Map();
const burst = [], clocks = { frame: 0, timer: 0 };
const unicodeKey = "é😀", unicodeValue = "ç🚀";
let getterCalls = 0;
let disposed = false;
const originalError = console.error;
console.error = (...values) => {
  if (values[0] === "GodotFabric") diagnostics.push({ code: values[1]?.code, message: values[1]?.message });
  originalError(...values);
};
function verify(passed, name) { checks.push({ name, passed: Boolean(passed) }); }
function errorCode(error) { return error.code || /^\s*(?:Exception in HostFunction:\s*)?(E_[A-Z0-9_]+):/.exec(error.message)?.[1]; }
function deep(depth) {
  let value = null;
  while (depth--) value = [value];
  return value;
}
function depth(value) {
  let count = 0;
  while (Array.isArray(value) && value.length === 1) { value = value[0]; count++; }
  return value === null ? count : -1;
}
function summary(kind, value) {
  if (kind === "unicode") {
    if (!value || typeof value !== "object" || typeof value[unicodeKey] !== "string") return { invalid: true };
    const keys = Object.keys(value);
    return { keys: keys.map(key => [...key].map(character => character.codePointAt(0))),
      value: value[unicodeKey], keyPresent: Object.prototype.hasOwnProperty.call(value, unicodeKey),
      valueCodes: [...value[unicodeKey]].map(character => character.codePointAt(0)) };
  }
  if (kind === "nodes") return Array.isArray(value)
    ? { length: value.length, allNull: value.every(item => item === null) } : { invalid: true };
  if (kind === "depth") return { depth: depth(value) };
  return { value };
}
function watch(label, name, kind) {
  const state = states[label] = { ready: false, snapshots: [], failed: null };
  const connection = GodotFabric.connect(name, snapshot => {
    state.snapshots.push({ revision: snapshot.revision, generation: snapshot.generation,
      ...summary(kind, snapshot.value) });
  });
  connections.set(label, connection);
  connection.ready.then(() => { state.ready = true; }, error => {
    state.failed = errorCode(error);
    verify(false, `Unexpected readiness rejection: ${label}: ${error.message}`);
  });
}
function expectRejection(label, promise, code) {
  promise.then(() => {
    rejected[label] = "unexpected-success";
    verify(false, `${label} must reject ${code}`);
  }, error => {
    rejected[label] = errorCode(error);
    verify(rejected[label] === code, `${label} rejects the precise ${code} contract`);
  });
}
function execute(label, name, args, kind, direct = false) {
  const promise = direct ? native.call({ origin: "default", name }, args) : GodotFabric.call(name, args);
  promise.then(result => {
    results[label] = { response: result.response, generation: result.generation, ...summary(kind, result.value) };
    verify(result.response === "completion", `${label} reports native completion`);
  }, error => {
    results[label] = { error: errorCode(error) };
    verify(false, `Unexpected call rejection: ${label}: ${error.message}`);
  });
}
AppRegistry.registerComponent("ServicesBoundaryFixture", () => function ServicesBoundaryFixture() { return null; });
AppRegistry.registerComponent("ServicesLifetimeFixture", () => function ServicesLifetimeFixture() {
  return React.createElement(View, { testID: "lifetime-view", style: { width: 160, height: 100 } },
    React.createElement(Text, { testID: "lifetime-text" }, "Native lifetime probe"));
});
globalThis.ServiceBoundaryFixture = {
  stats() { return { checks, states, diagnostics, rejected, results, burst, clocks, disposed, getterCalls }; },
  start() {
    watch("unicode", "boundary.unicode", "unicode");
    watch("nodes", "boundary.nodes", "nodes");
    watch("depth", "boundary.depth", "depth");
    watch("oldGeneration", "boundary.lifecycle", "scalar");
  },
  validCalls() {
    execute("unicode", "boundary.echoUnicode", [{ [unicodeKey]: unicodeValue }], "unicode");
    // 1 args root + 1 nested array + 9998 leaves = 10000 DTO nodes.
    execute("nodes", "boundary.echoNodes", [Array(9998).fill(null)], "nodes");
    // The public call's outer args root adds one depth; data itself has31.
    execute("depth", "boundary.echoDepth", [deep(31)], "depth");
  },
  invalidCalls() {
    expectRejection("nodesFacade", GodotFabric.call("boundary.echoNodes", [Array(9999).fill(null)]), "E_SERVICE_DTO_LIMIT");
    expectRejection("nodesNative", native.call({ origin: "default", name: "boundary.echoNodes" }, [Array(9999).fill(null)]), "E_SERVICE_DTO_LIMIT");
    expectRejection("depthFacade", GodotFabric.call("boundary.echoDepth", [deep(32)]), "E_SERVICE_DTO_LIMIT");
    expectRejection("depthNative", native.call({ origin: "default", name: "boundary.echoDepth" }, [deep(32)]), "E_SERVICE_DTO_LIMIT");
    for (const [label, invalid] of [["nul", "a\u0000b"], ["highSurrogate", "a\ud800b"], ["lowSurrogate", "a\udc00b"]]) {
      const unread = {};
      Object.defineProperty(unread, invalid, { enumerable: true, get() { getterCalls++; return unicodeValue; } });
      const target = { origin: "default", name: "boundary.echoUnicode" };
      for (const [field, address, args] of [
        ["Value", target, [{ [unicodeKey]: invalid }]],
        ["Key", target, [{ [invalid]: unicodeValue }]],
        ["Name", { ...target, name: invalid }, [{ [unicodeKey]: unicodeValue }]],
        ["Origin", { ...target, origin: invalid }, [{ [unicodeKey]: unicodeValue }]],
        ["KeyGetter", target, [unread]],
      ]) {
        expectRejection(`${label}${field}Facade`, GodotFabric.call(address, args), "E_SERVICE_DTO_STRING");
        expectRejection(`${label}${field}Native`, native.call(address, args), "E_SERVICE_DTO_STRING");
      }
    }
    const objectAccessor = {};
    Object.defineProperty(objectAccessor, unicodeKey, { enumerable: true, get() { getterCalls++; return unicodeValue; } });
    const objectHidden = {};
    Object.defineProperty(objectHidden, unicodeKey, { value: unicodeValue });
    const objectHiddenExtra = { [unicodeKey]: unicodeValue };
    Object.defineProperty(objectHiddenExtra, "extra", { value: null });
    const objectSymbol = { [unicodeKey]: unicodeValue, [Symbol("extra")]: null };
    const objectPrototype = Object.assign(Object.create({ inherited: null }), { [unicodeKey]: unicodeValue });
    const arrayAccessor = [null];
    Object.defineProperty(arrayAccessor, "0", { enumerable: true, get() { getterCalls++; return null; } });
    const arrayHidden = [null];
    Object.defineProperty(arrayHidden, "0", { enumerable: false });
    const outerArgsAccessor = [{ [unicodeKey]: unicodeValue }];
    Object.defineProperty(outerArgsAccessor, "0", { enumerable: true, get() { getterCalls++; return { [unicodeKey]: unicodeValue }; } });
    const addressAccessor = { name: "boundary.echoUnicode" };
    Object.defineProperty(addressAccessor, "origin", { enumerable: true, get() { getterCalls++; return "default"; } });
    const unicodeAddress = { origin: "default", name: "boundary.echoUnicode" };
    const nodesAddress = { origin: "default", name: "boundary.echoNodes" };
    const invalidShapes = [
      ["objectAccessor", unicodeAddress, [objectAccessor]],
      ["objectHidden", unicodeAddress, [objectHidden]],
      ["objectHiddenExtra", unicodeAddress, [objectHiddenExtra]],
      ["objectSymbol", unicodeAddress, [objectSymbol]],
      ["objectPrototype", unicodeAddress, [objectPrototype]],
      ["arrayHole", nodesAddress, [Array(1)]],
      ["arrayExtra", nodesAddress, [Object.assign([null], { extra: null })]],
      ["arraySymbol", nodesAddress, [Object.assign([null], { [Symbol("extra")]: null })]],
      ["arrayHidden", nodesAddress, [arrayHidden]],
      ["arrayAccessor", nodesAddress, [arrayAccessor]],
      ["arrayPrototypeNull", nodesAddress, [Object.setPrototypeOf([null], null)]],
      ["arrayPrototypeCustom", nodesAddress, [Object.setPrototypeOf([null], {})]],
      ["outerArgsAccessor", unicodeAddress, outerArgsAccessor],
      ["addressAccessor", addressAccessor, [{ [unicodeKey]: unicodeValue }]],
    ];
    for (const [label, address, args] of invalidShapes) {
      expectRejection(`${label}Facade`, GodotFabric.call(address, args), "E_SERVICE_DTO");
      expectRejection(`${label}Native`, native.call(address, args), "E_SERVICE_DTO");
    }
  },
  validShapes() {
    execute("unicodeNative", "boundary.echoUnicode", [{ [unicodeKey]: unicodeValue }], "unicode", true);
    execute("nullPrototypeFacade", "boundary.echoUnicode", [Object.assign(Object.create(null), { [unicodeKey]: unicodeValue })], "unicode");
    execute("nullPrototypeNative", "boundary.echoUnicode", [Object.assign(Object.create(null), { [unicodeKey]: unicodeValue })], "unicode", true);
    execute("arrayNative", "boundary.echoNodes", [[null, null]], "nodes", true);
  },
  rebind() { watch("newGeneration", "boundary.lifecycle", "scalar"); },
  watchOwner() { watch("owner", "boundary.owner", "scalar"); },
  queueGeneration() {
    expectRejection("generation", GodotFabric.call("boundary.generation", []), "E_SERVICE_GENERATION");
  },
  newGenerationCall() { execute("newGeneration", "boundary.generation", [], "scalar"); },
  burst() {
    requestAnimationFrame(() => clocks.frame++);
    setTimeout(() => clocks.timer++, 0);
    for (let ordinal = 0; ordinal < 70; ordinal++) {
      GodotFabric.call("boundary.generation", []).then(result => {
        burst.push({ ordinal, value: result.value });
      }, error => { verify(false, `Unexpected burst rejection ${ordinal}: ${error.message}`); });
    }
  },
  queueStop() { expectRejection("stopped", GodotFabric.call("boundary.generation", []), "E_SERVICE_STOPPED"); },
  destroyApplication() {
    GodotFabric.call("lifetime.destroy", []).then(() => console.error("LIFETIME_UNEXPECTED_SUCCESS"),
      error => console.log("LIFETIME_CANCELLED", errorCode(error)));
  },
  dispose() {
    if (disposed) return;
    disposed = true;
    for (const connection of connections.values()) { connection.remove(); connection.remove(); }
    connections.clear();
  },
  afterStop() {
    for (const [label, callback] of [["reserve", () => native.reserve()],
      ["connect", () => native.connect(1, { origin: "default", name: "boundary.unicode" }, true)],
      ["call", () => native.call({ origin: "default", name: "boundary.generation" }, [])],
      ["onEvent", () => native.onEvent(() => {})]]) {
      let error;
      try { callback(); } catch (failure) { error = failure; }
      verify(errorCode(error || {}) === "E_RUNTIME_STOPPED", `Cached native ${label} fails before allocating work after stop: ${error?.message}`);
    }
    native.remove(1); native.remove(1);
    verify(true, "Native remove remains idempotent after runtime shutdown");
  },
};
