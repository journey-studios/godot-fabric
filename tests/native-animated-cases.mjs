// The experiment, as plain data: the fixture runs each animation through RN's
// public Animated, and the oracle derives every expected curve from the same
// numbers with its own formulas. Neither side reads the other's results here.

// Interpolated outputs of one Animated.Value, over inputRange: opacity,
// translateX in px and rotate in degrees (RN sends degrees to native in radians).
const UNIT = {input: [0, 1], opacity: [1, 0.2], translateX: [0, 80], rotate: [0, 180]};
const RANGE = {input: [0, 50], opacity: [1, 0.2], translateX: [0, 50], rotate: [0, 45]};
// opacity: value, with no interpolation node in between.
const DIRECT = {opacity: "direct"};

// The views each root renders: one Animated.View per box, with its own value.
// "view" is RN's Animated.View, "created" is Animated.createAnimatedComponent
// over the public View, and "xy" drives translateX and translateY from a
// useAnimatedValueXY value.
export const BOXES = {
  "js-view": {view: "view", map: UNIT},
  "native-timing": {view: "view", map: UNIT},
  "native-spring": {view: "view", map: UNIT},
  "native-decay": {view: "view", map: RANGE},
  "native-created": {view: "created", map: UNIT},
  "native-xy": {view: "xy"},
  "native-stop": {view: "view", map: DIRECT},
  "native-listener": {view: "view", map: DIRECT},
  "native-rerender": {view: "view", map: UNIT},
  "native-unmount": {view: "view", map: UNIT},
  "native-race": {view: "view", map: UNIT},
  "native-two": {view: "view", map: UNIT},
};

const timing = (driver, box, duration, easing, map) => ({driver, box, kind: "timing", from: 0, to: 1, duration, easing, map});
const spring = (driver, box, map) => ({driver, box, kind: "spring", from: 0, to: 1, stiffness: 200, damping: 20, mass: 1, map});
const decay = (driver, box, map) => ({driver, box, kind: "decay", from: 0, velocity: 0.5, deceleration: 0.99, map});

// Animations by name. A driver "js" is useNativeDriver: false; "native" is true.
// The js-* values without a box run on a bare Animated.Value, on any host, and
// carry the map their outputs are read through; a box brings its own.
export const ANIMATIONS = {
  "js-timing": timing("js", null, 400, "inOut(ease)", UNIT),
  "js-spring": spring("js", null, UNIT),
  "js-decay": decay("js", null, RANGE),
  "js-view": timing("js", "js-view", 300, "linear"),
  "native-timing": timing("native", "native-timing", 300, "inOut(ease)"),
  "native-spring": spring("native", "native-spring"),
  "native-decay": decay("native", "native-decay"),
  "native-created": timing("native", "native-created", 200, "linear"),
  "native-xy": {driver: "native", box: "native-xy", kind: "timing", from: {x: 0, y: 0}, to: {x: 60, y: 30}, duration: 250, easing: "linear"},
  "native-stop": timing("native", "native-stop", 600, "linear"),
  "native-listener": timing("native", "native-listener", 300, "linear"),
  "native-rerender": timing("native", "native-rerender", 300, "inOut(ease)"),
  "native-unmount": timing("native", "native-unmount", 600, "linear"),
  "native-race": timing("native", "native-race", 600, "linear"),
  // The native-timing box's value after its first run, animated back to 0.
  "native-return": {driver: "native", box: "native-timing", kind: "timing", from: 1, to: 0, duration: 600, easing: "linear"},
  "native-two-a": timing("native", "native-two", 400, "out(cubic)"),
  "native-two-b": timing("native", "native-two", 250, "linear"),
};

// The values of the JS-only compositions and interruptions, for the oracle.
export const COMPOSITION = {sequence: [60, 60], parallel: [40, 80], stagger: {delay: 30, durations: [60, 60]},
  loop: {duration: 100, iterations: 2}};
export const INTERRUPT = {stopAfter: 100, longDuration: 2000, replacement: {duration: 100, to: 0.5}};

// TouchableOpacity: RN's activeOpacity and timings, as TouchableOpacity.js
// hard-codes them (0 ms on a responder grant, then 250 ms back).
export const TOUCHABLE = {activeOpacity: 0.4, restOpacity: 1, pressIn: 0, pressOut: 250, easing: "inOut(quad)"};
