// Injected ahead of everything else in the bundle, RN's Metro polyfills included: what the host defines before any JavaScript runs, and a
// record of every write and read of the two globals the pinned renderer consumes when it evaluates (ReactFabric-prod.js: supportsMicrotasks,
// from RN$enableMicrotasksInReact, and scheduleMicrotask, from queueMicrotask), so that the order of the writes of the bundle and the reads of the
// renderer is a fact of the run and not a claim. It imports nothing, so that nothing of the bundle runs before it, and it changes nothing: the
// getters return what they return, the setters store.
//
// The flag is an accessor over a slot: RN's setUpTimers assigns it (slice D2; slice D1 had src/runtime.js assign it).
//
// queueMicrotask cannot be an accessor over a slot, because RN's setUpTimers installs it with polyfillGlobal: defineLazyObjectProperty replaces
// whatever the global holds with a lazy accessor, and that accessor replaces itself with the value when it is first read (Libraries/Utilities/
// defineLazyObjectProperty.js). The host's gate (src/runtime.js) puts a second lazy accessor over RN's the same way. So the record follows the
// defineProperty calls on the global: every value that is installed is a write, and a read is logged by the outermost accessor that is
// asked for the value, which is the one the renderer asks.
const names = ["RN$enableMicrotasksInReact", "queueMicrotask"];
const limit = 64;
const events = [];
const slots = {};
const before = {};

function entry(op, name, value) {
  return {op, name, type: typeof value, value: typeof value === "boolean" ? value : null, ref: value};
}

function log(op, name, value) {
  if (events.length < limit) {
    events.push(entry(op, name, value));
  }
}

// What the host defines of the two, and of the other globals setUpTimers installs (slice D2 certifies those), before any JavaScript of the bundle runs.
for (const name of [...names, "setImmediate", "clearImmediate", "requestIdleCallback", "cancelIdleCallback"]) {
  before[name] = typeof globalThis[name];
}

const flag = names[0];
slots[flag] = {value: globalThis[flag]};
Object.defineProperty(globalThis, flag, {
  configurable: true,
  enumerable: true,
  get() {
    log("read", flag, slots[flag].value);
    return slots[flag].value;
  },
  set(value) {
    log("write", flag, value);
    slots[flag].value = value;
  },
});

const microtask = names[1];
const defineProperty = Object.defineProperty;
let depth = 0;
Object.defineProperty = function (object, name, descriptor) {
  if (object !== globalThis || name !== microtask) {
    return Reflect.apply(defineProperty, this, [object, name, descriptor]);
  }
  if ("value" in descriptor) {
    log("write", name, descriptor.value);
    return Reflect.apply(defineProperty, this, [object, name, descriptor]);
  }
  const {get} = descriptor;
  return Reflect.apply(defineProperty, this, [object, name, {...descriptor, get() {
    depth += 1;
    let value;
    try {
      value = get.call(this);
    } finally {
      depth -= 1;
    }
    if (depth === 0) {
      log("read", name, value);
    }
    return value;
  }}]);
};

// The value a global holds now, read without running an accessor.
function current(name) {
  return name === flag ? slots[flag].value : Object.getOwnPropertyDescriptor(globalThis, name)?.value;
}

globalThis.ReactMicrotasksHost = {
  before,
  // The log without the references; `final` says the value is the one the global holds now.
  events() {
    return events.map(({ref, ...rest}) => ({...rest, final: ref === current(rest.name)}));
  },
};
