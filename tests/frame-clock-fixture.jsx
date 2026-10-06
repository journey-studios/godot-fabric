import React from "react";
import {Animated, AppRegistry, View, useAnimatedValue} from "react-native";
import {BOXES, DECAY} from "./frame-clock-cases.mjs";

// What JS observes of the host's frame clock, in order, in one log: the
// requestAnimationFrame callbacks that run (with the timestamp each one receives),
// the firings of a zero-delay interval and the end of a native decay. The Godot
// probe reads the Controls the decays move and the host's own counters; this
// fixture holds no expectation. Entries carry a sequence number, so that the order
// inside one Godot frame survives.
const log = [];
const loops = new Map();
const intervals = new Map();
const values = new Map();
let sequence = 0;
function note(entry) {
  log.push({sequence: ++sequence, now: performance.now(), ...entry});
}

// One box per run, each with its own value and a native decay of its own: RN's
// NativeAnimatedModule runs the driver on the host's frame clock ticks.
function Box({id}) {
  const value = useAnimatedValue(DECAY.from);
  values.set(id, value);
  return <Animated.View testID={`frame-clock-${id}`}
    style={{position: "absolute", left: 20, top: 10 + BOXES.indexOf(id) * 40, width: 60, height: 30, backgroundColor: "#0ea5e9",
      transform: [{translateX: value}]}} />;
}
function Probe() {
  return <View testID="frame-clock-root" pointerEvents="box-none" style={{flex: 1}}>
    {BOXES.map(id => <Box key={id} id={id} />)}
  </View>;
}
AppRegistry.registerComponent("FrameClockProbe", () => Probe);

globalThis.FrameClockProbe = {
  boxes() { return BOXES; },
  // Everything recorded since the last call.
  take() { return log.splice(0); },
  // The host's time now, in the base the callbacks' timestamps use.
  now() { return performance.now(); },
  // A chain of callbacks: each records the timestamp it received and requests the
  // next, as an animation loop does.
  startLoop(label) {
    const step = timestamp => {
      note({kind: "frame", label, timestamp});
      loops.get(label).id = requestAnimationFrame(step);
    };
    loops.set(label, {id: requestAnimationFrame(step)});
  },
  stopLoop(label) {
    cancelAnimationFrame(loops.get(label).id);
    loops.delete(label);
  },
  // One request and its callback; or one cancelled before any frame.
  request(label) {
    requestAnimationFrame(timestamp => note({kind: "frame", label, timestamp}));
  },
  cancelled(label) {
    cancelAnimationFrame(requestAnimationFrame(timestamp => note({kind: "frame", label, timestamp})));
  },
  // A callback that requests another from inside itself: the second runs on a
  // later tick than the first, never on the same one.
  nested(label) {
    requestAnimationFrame(outer => {
      note({kind: "frame", label: `${label}:outer`, timestamp: outer});
      requestAnimationFrame(inner => note({kind: "frame", label: `${label}:inner`, timestamp: inner}));
    });
  },
  // Callbacks registered before one tick run in that tick, in order.
  ordered(label) {
    for (const part of ["a", "b", "c"]) {
      requestAnimationFrame(timestamp => note({kind: "frame", label: `${label}:${part}`, timestamp}));
    }
  },
  // A zero-delay interval fires once per Godot frame: ticks do not pace timers.
  startInterval(label) {
    intervals.set(label, setInterval(() => note({kind: "timer", label}), 0));
  },
  stopInterval(label) {
    clearInterval(intervals.get(label));
    intervals.delete(label);
  },
  // RN's native decay, as the Animated slice runs it: it ends at the first step
  // under 0.1, so where it lands depends on how far apart its frames were.
  startDecay(label) {
    Animated.decay(values.get(label), {velocity: DECAY.velocity, deceleration: DECAY.deceleration, useNativeDriver: true})
      .start(result => note({kind: "end", label, result}));
  },
};
