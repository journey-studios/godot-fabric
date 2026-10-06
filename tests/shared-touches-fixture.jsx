import {bootstrap} from "./event-target-bootstrap";
import React, {useState} from "react";
import {AppRegistry, Pressable, View} from "react-native";
import RawEventEmitter from "react-native/Libraries/Core/RawEventEmitter";

// Two roots of one application share RN's single JS responder. Each root has
// an original Pressable; the fixture records its callbacks and every raw touch
// event's application-wide touch list.
const panels = new Map();
let active = null, sequence = 0;
const ids = touches => (Array.isArray(touches) ? touches.map(touch => touch.identifier).sort((a, b) => a - b) : null);
function record(name, callback, event) {
  if (active == null) {
    return;
  }
  const native = event?.nativeEvent ?? {};
  active.events.push({sequence: ++sequence, name, callback, changed: ids(native.changedTouches), touches: ids(native.touches),
    target: native.changedTouches?.[0]?.target ?? native.target ?? null});
}
for (const type of ["topTouchStart", "topTouchEnd", "topTouchCancel"]) {
  RawEventEmitter.addListener(type, ({eventName, nativeEvent}) => {
    if (active != null) {
      active.raw.push({sequence: ++sequence, type: eventName, changed: ids(nativeEvent.changedTouches), touches: ids(nativeEvent.touches),
        targetTouches: ids(nativeEvent.targetTouches), target: nativeEvent.changedTouches?.[0]?.target ?? null});
    }
  });
}
function Fixture({name}) {
  const [presses, setPresses] = useState(0);
  panels.set(name, {presses});
  const press = callback => event => {
    record(name, callback, event);
    if (callback === "press") {
      setPresses(value => value + 1);
    }
  };
  return <View style={{flex: 1}}>
    <Pressable testID={name + "-press"} style={{position: "absolute", left: 20, top: 20, width: 120, height: 80, backgroundColor: "#f97316"}}
      onPressIn={press("pressIn")} onPressOut={press("pressOut")} onPress={press("press")} />
    <View testID={name + "-presses"} style={{position: "absolute", left: 20, top: 120, width: 10 + presses * 4, height: 6, backgroundColor: "#fde047"}} />
  </View>;
}
AppRegistry.registerComponent("SharedTouchesProbe", () => Fixture);
globalThis.SharedTouchesProbe = {
  arm(caseId) {
    active = {caseId, events: [], raw: []};
    return {caseId, flags: bootstrap.flags};
  },
  snapshot() {
    return {flags: bootstrap.flags, mode: bootstrap.mode, caseId: active?.caseId ?? null,
      events: active ? [...active.events] : [], raw: active ? [...active.raw] : [],
      panels: Object.fromEntries([...panels].map(([name, panel]) => [name, {presses: panel.presses}])),
      scope: {actualNativeInput: true, originalPressability: true, originalResponderSystem: true,
        publicDefaultEnabled: false, hardwareCertified: false}};
  },
};
