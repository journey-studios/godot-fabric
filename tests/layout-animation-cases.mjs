// The experiment, as plain data: the fixture runs each case through RN's public LayoutAnimation (or the legacy UIManager
// method), and the oracle derives every expected frame from the same numbers with its own formulas. Neither side reads
// the other's results here.

export const STAGE = {width: 400, height: 560};

// Absolute boxes, so that what Yoga lays out is exactly what the style says and no sibling moves when one is added or
// removed. The "box" moves between poses (an update), "child" is added (a create) and "doomed" is removed (a delete).
export const POSES = {
  a: {x: 20, y: 30, width: 60, height: 40},
  b: {x: 220, y: 120, width: 100, height: 90},
  c: {x: 60, y: 260, width: 140, height: 30},
};
export const CHILD = {x: 40, y: 380, width: 80, height: 50};
export const DOOMED = {x: 240, y: 380, width: 80, height: 50};

// What the stage shows at rest. Every case starts from it, set without any animation.
export const BASE = {box: "a", child: false, doomed: true};

// A config as RN's helpers build it. The literal is what RN's LayoutAnimation.js (create, Presets and configureNext)
// must hand to nativeFabricUIManager.configureNextLayoutAnimation: the fixture records what it was given, and the
// oracle compares it with the literal, so a change in RN's presets cannot move the expected curves unnoticed.
const create = (duration, type, property) => ({duration, create: {type, property}, update: {type}, delete: {type, property}});
const PRESETS = {
  easeInEaseOut: create(300, "easeInEaseOut", "opacity"),
  linear: create(500, "linear", "opacity"),
  spring: {duration: 700, create: {type: "linear", property: "opacity"}, update: {type: "spring", springDamping: 0.4},
    delete: {type: "linear", property: "opacity"}},
};

// via: how the fixture arms the animation.
//   configureNext  LayoutAnimation.configureNext(config, onEnd, onFail), or a helper that builds the config (how)
//   legacy         UIManager.configureNextLayoutAnimation(config, onEnd, onFail)
// how: "create" builds the config with LayoutAnimation.create(...args), "preset" passes LayoutAnimation.Presets[name],
// "shorthand" calls LayoutAnimation[name](onEnd) and "literal" passes the config as written.
// entities: what the case animates, by the name of the node ("box", "child", "doomed").
// separated: the config's top-level duration, which RN's JS timer waits for (plus 17 ms), is far longer than every animation
// in it, so the driver's end cannot be mistaken for the timer's: only the driver can end the call first. The other cases end
// within a frame or two of their timer, and either may be the one that calls onAnimationDidEnd (RN calls it once).
export const CASES = {
  // A long top-level duration, which RN's JS timer waits for, and a short update: only the driver can end it in time.
  "native-end": {via: "configureNext", how: "literal", config: {duration: 5000, create: {type: "linear", property: "opacity"},
    update: {type: "linear", duration: 300}, delete: {type: "linear", property: "opacity"}}, to: {box: "b"}, entities: ["box"],
  separated: true},
  "update-linear": {via: "configureNext", how: "create", args: [600, "linear", "opacity"], config: create(600, "linear", "opacity"),
    to: {box: "b"}, entities: ["box"]},
  "update-ease": {via: "configureNext", how: "create", args: [600, "easeInEaseOut", "opacity"], config: create(600, "easeInEaseOut", "opacity"),
    to: {box: "c"}, entities: ["box"]},
  "update-spring": {via: "configureNext", how: "preset", name: "spring", config: PRESETS.spring, to: {box: "b"}, entities: ["box"]},
  "create-opacity": {via: "configureNext", how: "shorthand", name: "easeInEaseOut", config: PRESETS.easeInEaseOut, to: {child: true},
    entities: ["child"]},
  "create-scale": {via: "configureNext", how: "create", args: [600, "linear", "scaleXY"], config: create(600, "linear", "scaleXY"),
    to: {child: true}, entities: ["child"]},
  "delete-opacity": {via: "configureNext", how: "preset", name: "linear", config: PRESETS.linear, to: {doomed: false}, entities: ["doomed"]},
  "delete-scale": {via: "configureNext", how: "create", args: [600, "linear", "scaleXY"], config: create(600, "linear", "scaleXY"),
    to: {doomed: false}, entities: ["doomed"]},
  // All three kinds in one commit and one animation, each with its own curve.
  mixed: {via: "configureNext", how: "literal", config: {duration: 5000, create: {type: "easeInEaseOut", property: "opacity", duration: 500},
    update: {type: "linear", duration: 400}, delete: {type: "linear", property: "opacity", duration: 600}},
  to: {box: "c", child: true, doomed: false}, entities: ["box", "child", "doomed"], separated: true},
  // A config RN's driver cannot parse (conversions.h): the failure callback, no animation.
  fail: {via: "configureNext", how: "literal", config: {duration: 400, update: {type: "bogus"}}, to: {box: "b"}, entities: []},
  // The first of two animations on the box, and the second that interrupts it (the probe starts it mid-animation).
  "interrupt-first": {via: "configureNext", how: "literal", config: {duration: 5000, create: {type: "linear", property: "opacity"},
    update: {type: "linear", duration: 800}, delete: {type: "linear", property: "opacity"}}, to: {box: "b"}, entities: ["box"],
  separated: true},
  "interrupt-second": {via: "configureNext", how: "literal", config: {duration: 5000, create: {type: "linear", property: "opacity"},
    update: {type: "easeInEaseOut", duration: 400}, delete: {type: "linear", property: "opacity"}}, to: {box: "c"}, entities: ["box"],
  separated: true},
  // Armed before the root that is about to stop unmounts: the removal of its views is what RN animates, and the animation outlives the
  // root (the host's stop does not tick, and RN drops a stopped surface's animations at its next pull).
  "restart-first": {via: "configureNext", how: "literal", config: {duration: 5000, create: {type: "linear", property: "opacity"},
    update: {type: "linear", duration: 3000}, delete: {type: "linear", property: "opacity", duration: 3000}}, to: {}, entities: ["stage", "box", "doomed"],
  separated: true},
  // Armed before the next root mounts: that root's first commit, the creates of its stage, is the one RN animates.
  restart: {via: "configureNext", how: "literal", config: {duration: 1500, create: {type: "linear", property: "opacity", duration: 400},
    update: {type: "linear", duration: 400}, delete: {type: "linear", property: "opacity"}}, to: {}, entities: ["stage", "box", "doomed"],
  separated: true},
  legacy: {via: "legacy", how: "create", args: [600, "linear", "opacity"], config: create(600, "linear", "opacity"), to: {box: "b"},
    entities: ["box"]},
  // The legacy flag, then a plain commit: no animation was armed.
  flag: {via: "flag", config: null, to: {box: "b"}, entities: []},
};

export const RACE_MS = 17;
