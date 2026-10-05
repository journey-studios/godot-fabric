import * as TurboModuleRegistry from "react-native/Libraries/TurboModule/TurboModuleRegistry";

// Experimental D03–D08 transport. The game and React (or a JS store) keep
// ownership of their state; this facade does not create a second state system.
let nativeModule;
let nativeEvents;
const subscriptions = new Map();
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function failure(code, message) {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}
function normalizeError(error) {
  if (error instanceof Error) {
    if (!error.code) {
      const code = /^\s*(?:Exception in HostFunction:\s*)?(E_[A-Z0-9_]+):/.exec(error.message)?.[1];
      if (code) error.code = code;
    }
    return error;
  }
  return failure("E_SERVICE_PROTOCOL", String(error));
}
function diagnose(error) {
  // A consumer callback (or diagnostic sink) cannot block other subscriptions.
  try { console.error("GodotFabric", normalizeError(error)); } catch {}
}
function module() {
  return nativeModule ??= TurboModuleRegistry.getEnforcing("GodotFabricServices");
}

function string(value, label) {
  // Godot String cannot preserve NUL. JSI UTF-8 conversion also replaces lone
  // UTF-16 surrogates; reject both before crossing the boundary without loss.
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit === 0) throw failure("E_SERVICE_DTO_STRING", `${label} cannot contain NUL`);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        throw failure("E_SERVICE_DTO_STRING", `${label} cannot contain an unpaired UTF-16 surrogate`);
    } else if (unit >= 0xdc00 && unit <= 0xdfff)
      throw failure("E_SERVICE_DTO_STRING", `${label} cannot contain an unpaired UTF-16 surrogate`);
  }
  return value;
}
function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw failure("E_SERVICE_DTO", `${label} must be a plain object`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key === "string") string(key, `${label} key`);
    if (typeof key !== "string" || !own(descriptors[key], "value") || !descriptors[key].enumerable)
      throw failure("E_SERVICE_DTO", `${label} cannot contain symbols, accessors or hidden properties`);
  }
  return descriptors;
}
function exact(value, keys, label) {
  const descriptors = record(value, label);
  for (const key of Object.keys(descriptors))
    if (!keys.includes(key)) throw failure("E_SERVICE_PROTOCOL", `${label} has unsupported field ${key}`);
  return value;
}
function text(value, label) {
  if (typeof value !== "string" || value.length === 0)
    throw failure("E_SERVICE_ADDRESS", `${label} must be a nonempty string`);
  return string(value, label);
}
function address(value) {
  if (typeof value === "string") return { origin: "default", name: text(value, "name") };
  exact(value, ["origin", "name"], "address");
  return { origin: text(value.origin, "origin"), name: text(value.name, "name") };
}
function arrayDescriptors(value, label) {
  if (!Array.isArray(value)) throw failure("E_SERVICE_DTO", `${label} must be an array`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(descriptors).length !== value.length + 1)
    throw failure("E_SERVICE_DTO", `${label} must be a dense array without extra properties`);
  for (let index = 0; index < value.length; index++) {
    const descriptor = descriptors[index];
    if (!descriptor || !own(descriptor, "value") || !descriptor.enumerable)
      throw failure("E_SERVICE_DTO", `${label} cannot contain holes or accessors`);
  }
  return descriptors;
}
function dto(value, label = "value", traversal = { ancestors: new Set(), nodes: 0 }, depth = 0) {
  // Match the native transport limits before recursion can exhaust the JS stack.
  if (depth > 32 || ++traversal.nodes > 10000)
    throw failure("E_SERVICE_DTO_LIMIT", `${label} exceeds the DTO depth/node limit`);
  if (typeof value === "string") return string(value, label);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
      throw failure("E_SERVICE_DTO", `${label} must be finite and integers must be safe`);
    return value;
  }
  if (!value || typeof value !== "object")
    throw failure("E_SERVICE_DTO", `${label} contains an unsupported value`);
  if (traversal.ancestors.has(value)) throw failure("E_SERVICE_DTO", `${label} contains a cycle`);
  traversal.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const descriptors = arrayDescriptors(value, label);
      const result = [];
      for (let index = 0; index < value.length; index++) {
        const descriptor = descriptors[index];
        result.push(dto(descriptor.value, `${label}[${index}]`, traversal, depth + 1));
      }
      return result;
    }
    const descriptors = record(value, label);
    const result = {};
    for (const [key, descriptor] of Object.entries(descriptors))
      Object.defineProperty(result, key, { value: dto(descriptor.value, `${label}.${key}`, traversal, depth + 1),
        enumerable: true, writable: true, configurable: true });
    return result;
  } finally { traversal.ancestors.delete(value); }
}
function eventArgs(value) {
  // The event's outer tuple is protocol structure. Like native signal
  // ingestion, arguments start at depth zero and share one DTO node budget.
  // A state value therefore has the same limits in its snapshot and updates.
  const descriptors = arrayDescriptors(value, "event args");
  const traversal = { ancestors: new Set(), nodes: 0 };
  const result = [];
  for (let index = 0; index < value.length; index++)
    result.push(dto(descriptors[index].value, `args[${index}]`, traversal));
  return result;
}
function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw failure("E_SERVICE_PROTOCOL", "revision must be a nonnegative safe integer");
  return value;
}
function identity(value, expected) {
  if (value.origin !== expected.origin || value.name !== expected.name)
    throw failure("E_SERVICE_PROTOCOL", "native service address does not match the subscription");
  if (typeof value.generation !== "string" || !/^[1-9][0-9]*$/.test(value.generation))
    throw failure("E_SERVICE_PROTOCOL", "generation must be a positive decimal string");
  return { origin: value.origin, name: value.name, generation: value.generation };
}
function snapshot(value, expected, initial) {
  exact(value, ["origin", "name", "generation", "revision", ...(initial ? ["value"] : [])], "snapshot");
  const result = { ...identity(value, expected), revision: revision(value.revision) };
  if (initial) {
    if (!own(value, "value")) throw failure("E_SERVICE_PROTOCOL", "state snapshot has no value");
    result.value = dto(value.value);
  }
  return Object.freeze(result);
}
function cleanup(state) {
  if (!state.active) return;
  state.active = false;
  state.buffer.length = 0;
  subscriptions.delete(state.id);
  try { state.module.remove(state.id); } catch (error) { diagnose(error); }
  if (subscriptions.size === 0 && nativeEvents) {
    const events = nativeEvents;
    nativeEvents = undefined;
    try { events.remove(); } catch (error) { diagnose(error); }
  }
}
function abort(state, error) {
  if (!state.active) return;
  cleanup(state);
  if (state.pending) { state.pending = false; state.reject(normalizeError(error)); }
  else diagnose(error);
}
function invoke(state, value) {
  if (!state.active) return;
  try {
    if (state.initial) state.handler(value);
    else state.handler(...value.args);
  } catch (error) { diagnose(error); }
}
function deliver(state, event) {
  if (!state.active) return;
  if (event.generation !== state.generation) {
    diagnose(failure("E_SERVICE_PROTOCOL", "ignored event from another service generation"));
    return;
  }
  if (state.initial) {
    if (event.revision <= state.revision) return;
    state.revision = event.revision;
    invoke(state, Object.freeze({ origin: event.origin, name: event.name,
      generation: event.generation, revision: event.revision, value: event.value }));
  } else invoke(state, event);
}
function receive(value) {
  try {
    // Do not read an accessor before the protocol guard. Unknown IDs belong to
    // another subscriber or to an already removed one and need no delivery.
    const descriptor = value && typeof value === "object"
      ? Object.getOwnPropertyDescriptor(value, "subscriptionId") : undefined;
    if (!descriptor || !own(descriptor, "value") || !Number.isSafeInteger(descriptor.value) || descriptor.value <= 0)
      throw failure("E_SERVICE_PROTOCOL", "event subscriptionId must be a positive safe integer");
    const state = subscriptions.get(descriptor.value);
    if (!state?.active) return;
    exact(value, ["subscriptionId", "origin", "name", "generation", "revision", "args", "value", "closed", "error"], "event");
    const event = { ...identity(value, state.address), revision: revision(value.revision), args: eventArgs(value.args) };
    if (state.generation && event.generation !== state.generation) {
      diagnose(failure("E_SERVICE_PROTOCOL", "ignored event from another service generation"));
      return;
    }
    if (value.closed === true) {
      exact(value.error, ["code", "message"], "closed error");
      if (typeof value.error.code !== "string" || !/^E_[A-Z0-9_]+$/.test(value.error.code) ||
          typeof value.error.message !== "string" || event.args.length !== 0 || own(value, "value"))
        throw failure("E_SERVICE_PROTOCOL", "invalid closed event");
      abort(state, failure(value.error.code, value.error.message));
      return;
    }
    if (own(value, "closed") || own(value, "error"))
      throw failure("E_SERVICE_PROTOCOL", "unexpected event lifecycle fields");
    if (state.initial) {
      if (!own(value, "value")) throw failure("E_SERVICE_PROTOCOL", "state event has no value");
      event.value = dto(value.value);
    } else if (own(value, "value")) event.value = dto(value.value);
    if (state.pending) state.buffer.push(event);
    else deliver(state, event);
  } catch (error) { diagnose(error); }
}
function subscribe(service, handler, initial) {
  const target = address(service);
  if (typeof handler !== "function") throw failure("E_SERVICE_ARGUMENT", "handler must be a function");
  let state;
  const ready = new Promise((resolve, reject) => {
    try {
      const native = module();
      const id = native.reserve();
      if (!Number.isSafeInteger(id) || id <= 0 || subscriptions.has(id))
        throw failure("E_SERVICE_PROTOCOL", "reserve must return a unique positive safe integer");
      state = { id, module: native, address: target, handler, initial, active: true, pending: true,
        buffer: [], resolve, reject };
      subscriptions.set(id, state);
      nativeEvents ??= native.onEvent(receive);
      // Both the map and RN event subscription exist before native can connect.
      Promise.resolve(native.connect(id, target, initial)).then((value) => {
        if (!state.active) return;
        try {
          const current = snapshot(value, target, initial);
          state.generation = current.generation;
          state.revision = current.revision;
          // Keep buffering reentrant events until the initial callback ends.
          if (initial) invoke(state, current);
          if (!state.active) return;
          while (state.active && state.buffer.length) {
            const buffered = state.buffer;
            state.buffer = [];
            for (const event of buffered) deliver(state, event);
          }
          if (state.active) { state.pending = false; resolve(current); }
        } catch (error) { abort(state, error); }
      }, (error) => { if (state.active) abort(state, error); });
    } catch (error) {
      if (state?.active) cleanup(state);
      if (state) state.pending = false;
      reject(normalizeError(error));
    }
  });
  return Object.freeze({ ready, remove() {
    if (!state?.active) return;
    cleanup(state);
    if (state.pending) {
      state.pending = false;
      state.reject(failure("E_SUBSCRIPTION_REMOVED", "subscription removed before it became ready"));
    }
  } });
}

export const GodotFabric = Object.freeze({
  subscribe(service, handler) { return subscribe(service, handler, false); },
  connect(service, handler) { return subscribe(service, handler, true); },
  call(service, args) {
    try {
      const target = address(service);
      const copied = dto(args, "args");
      if (!Array.isArray(copied)) throw failure("E_SERVICE_ARGUMENT", "call args must be an array");
      return Promise.resolve(module().call(target, copied)).then((value) => {
        exact(value, ["origin", "name", "generation", "response", "value"], "call result");
        const source = identity(value, target);
        if (!["completion", "acceptance"].includes(value.response) || !own(value, "value"))
          throw failure("E_SERVICE_PROTOCOL", "invalid call result");
        return Object.freeze({ ...source, response: value.response, value: dto(value.value) });
      }, (error) => { throw normalizeError(error); });
    } catch (error) { return Promise.reject(normalizeError(error)); }
  },
});
