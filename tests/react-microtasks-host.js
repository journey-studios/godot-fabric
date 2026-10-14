// Injected ahead of everything else in the bundle, RN's Metro polyfills included: what the host defines before any JavaScript runs, and a
// record of every write and read of the two globals the pinned renderer consumes when it evaluates (ReactFabric-prod.js: supportsMicrotasks,
// from RN$enableMicrotasksInReact, and scheduleMicrotask, from queueMicrotask). Each is an accessor over a slot, so that the order of
// the writes of src/runtime.js and the reads of the renderer is a fact of the run and not a claim. It imports nothing, so that nothing of
// the bundle runs before it, and it changes nothing: the getters return the slot, the setters store.
const names = ["RN$enableMicrotasksInReact", "queueMicrotask"];
const limit = 64;
const events = [];
const slots = {};
const before = {};

function entry(op, name, value) {
  return {op, name, type: typeof value, value: typeof value === "boolean" ? value : null, ref: value};
}

for (const name of names) {
  before[name] = typeof globalThis[name];
  slots[name] = {value: globalThis[name]};
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: true,
    get() {
      if (events.length < limit) {
        events.push(entry("read", name, slots[name].value));
      }
      return slots[name].value;
    },
    set(value) {
      if (events.length < limit) {
        events.push(entry("write", name, value));
      }
      slots[name].value = value;
    },
  });
}

globalThis.ReactMicrotasksHost = {
  before,
  // The log without the references; `final` says the value is the one the global holds now.
  events() {
    return events.map(({ref, ...rest}) => ({...rest, final: ref === slots[rest.name].value}));
  },
};
