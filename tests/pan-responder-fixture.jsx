import {bootstrap} from "./event-target-bootstrap";
import React, {useRef, useState} from "react";
import {AppRegistry, PanResponder, Pressable, View} from "react-native";

// Original PanResponder instances over the platform's original responder
// events. Every callback records its gesture state and touch payload; the probe
// owns no gesture math.
const panels = new Map();
let active = null, sequence = 0;
const finite = value => (typeof value === "number" && Number.isFinite(value) ? value : null);
function record(name, view, callback, event, gestureState) {
  if (active == null) {
    return;
  }
  const native = event?.nativeEvent ?? {};
  active.events.push({sequence: ++sequence, name, view, callback,
    dx: finite(gestureState?.dx), dy: finite(gestureState?.dy), moveX: finite(gestureState?.moveX), moveY: finite(gestureState?.moveY),
    x0: finite(gestureState?.x0), y0: finite(gestureState?.y0), vx: finite(gestureState?.vx), vy: finite(gestureState?.vy),
    numberActiveTouches: gestureState?.numberActiveTouches ?? null,
    touches: Array.isArray(native.touches) ? native.touches.length : null,
    changed: Array.isArray(native.changedTouches) ? native.changedTouches.map(touch => touch.identifier) : [],
    pageX: finite(native.pageX), pageY: finite(native.pageY), locationX: finite(native.locationX), locationY: finite(native.locationY),
    touchHistory: event?.touchHistory != null, timestamp: finite(native.timestamp)});
}
// config: start/startCapture booleans, move/moveCapture predicates on the
// gesture state, and whether the responder yields to a termination request.
function usePan(name, view, config) {
  const responder = useRef(null);
  if (responder.current == null) {
    const predicate = value => (typeof value === "function" ? value : () => value === true);
    const move = predicate(config.move), moveCapture = predicate(config.moveCapture);
    responder.current = PanResponder.create({
      onStartShouldSetPanResponder: () => config.start === true,
      onStartShouldSetPanResponderCapture: () => config.startCapture === true,
      onMoveShouldSetPanResponder: (_event, gestureState) => move(gestureState),
      onMoveShouldSetPanResponderCapture: (_event, gestureState) => moveCapture(gestureState),
      onPanResponderTerminationRequest: () => config.yields !== false,
      onPanResponderGrant: (event, gestureState) => record(name, view, "grant", event, gestureState),
      onPanResponderReject: (event, gestureState) => record(name, view, "reject", event, gestureState),
      onPanResponderStart: (event, gestureState) => record(name, view, "start", event, gestureState),
      onPanResponderMove: (event, gestureState) => record(name, view, "move", event, gestureState),
      onPanResponderEnd: (event, gestureState) => record(name, view, "end", event, gestureState),
      onPanResponderRelease: (event, gestureState) => record(name, view, "release", event, gestureState),
      onPanResponderTerminate: (event, gestureState) => record(name, view, "terminate", event, gestureState),
    });
  }
  return responder.current.panHandlers;
}
const box = (left, top, width, height, backgroundColor) => ({position: "absolute", left, top, width, height, backgroundColor});
// Root-relative layout: P 10,10 120x80 pans freely; Q 150,10 claims vertical
// moves past 10 points from K (a Pressable, 160,20) and R (a pan view that
// refuses to yield, 220,20); T 10,110 captures every start before its child U
// (20,120); M 150,110 is removable mid-gesture.
function Fixture({name}) {
  const [removable, setRemovable] = useState(true);
  const [presses, setPresses] = useState(0);
  panels.set(name, {setRemovable, presses});
  const pan = usePan(name, "P", {start: true});
  const claimer = usePan(name, "Q", {moveCapture: gestureState => Math.abs(gestureState.dy) > 10});
  const refuser = usePan(name, "R", {start: true, yields: false});
  const capturer = usePan(name, "T", {startCapture: true});
  const child = usePan(name, "U", {start: true});
  const removed = usePan(name, "M", {start: true});
  const pressable = callback => () => {
    record(name, "K", callback, null, null);
    if (callback === "press") {
      setPresses(value => value + 1);
    }
  };
  return <View style={{flex: 1}}>
    <View testID={name + "-pan"} style={box(10, 10, 120, 80, "#1e293b")} {...pan} />
    <View testID={name + "-claimer"} style={box(150, 10, 140, 90, "#334155")} {...claimer}>
      <Pressable testID={name + "-press"} style={box(10, 10, 50, 30, "#f97316")}
        onPressIn={pressable("pressIn")} onPressOut={pressable("pressOut")} onPress={pressable("press")} />
      <View testID={name + "-refuser"} style={box(70, 10, 60, 30, "#9333ea")} {...refuser} />
    </View>
    <View testID={name + "-capturer"} style={box(10, 110, 120, 80, "#475569")} {...capturer}>
      <View testID={name + "-child"} style={box(10, 10, 50, 40, "#16a34a")} {...child} />
    </View>
    {removable && <View testID={name + "-removable"} style={box(150, 110, 60, 60, "#be123c")} {...removed} />}
    <View testID={name + "-presses"} style={box(230, 180, 10 + presses * 4, 6, "#fde047")} />
  </View>;
}
AppRegistry.registerComponent("PanResponderProbe", () => Fixture);
globalThis.PanResponderProbe = {
  arm(name, caseId) {
    active = {name, caseId, events: []};
    return {caseId, flags: bootstrap.flags, mode: bootstrap.mode};
  },
  removeTarget(name) {
    panels.get(name).setRemovable(false);
    return true;
  },
  snapshot() {
    return {flags: bootstrap.flags, mode: bootstrap.mode, caseId: active?.caseId ?? null, name: active?.name ?? null,
      events: active ? [...active.events] : [],
      panels: Object.fromEntries([...panels].map(([name, panel]) => [name, {presses: panel.presses}])),
      currentPriority: nativeFabricUIManager.unstable_getCurrentEventPriority(),
      defaultPriority: nativeFabricUIManager.unstable_DefaultEventPriority,
      scope: {actualNativeInput: true, originalPanResponder: true, originalResponderSystem: true,
        publicDefaultEnabled: false, hardwareCertified: false}};
  },
};
