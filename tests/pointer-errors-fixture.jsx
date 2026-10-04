import React, {useEffect, useRef} from "react";
import {AppRegistry, View, TextInput} from "react-native";

const panels = new Map(), events = [], mounts = {}, cleanups = {};
let fault = null, stopOnGot = false;
function Fixture({name}) {
  const refs = useRef({}).current;
  panels.set(name, refs);
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1;
    return () => { cleanups[name] = (cleanups[name] ?? 0) + 1; panels.delete(name); };
  }, [name]);
  const record = (box, type, event) => {
    events.push({name, box, type, pointerId: event.nativeEvent.pointerId});
    if (fault?.name === name && fault.box === box && fault.type === type) {
      fault = null;
      throw Error("Pointer listener fault " + type);
    }
    if (type === "GotPointerCapture" && stopOnGot) {
      stopOnGot = false;
      refs.input.focus(); // Real LineEdit focus signal requests host stop synchronously.
    }
  };
  return <View style={{flex: 1}} pointerEvents="box-none">
    {["left", "right"].map((box, index) => {
      const props = {};
      for (const type of ["Down", "Move", "Up", "Cancel", "Over", "Out", "Enter", "Leave", "GotPointerCapture", "LostPointerCapture"])
        props[type.endsWith("PointerCapture") ? "on" + type : "onPointer" + type] = event => record(box, type, event);
      return <View key={box} testID={name + "-" + box} ref={instance => { refs[box] = instance; }} {...props}
        style={{position: "absolute", left: index * 180 + 20, top: 20, width: 120, height: 120}} />;
    })}
    <TextInput testID={name + "-input"} ref={instance => { refs.input = instance; }}
      style={{position: "absolute", left: 20, top: 170, width: 250, height: 40}} value="Stop from real focus signal" />
  </View>;
}
AppRegistry.registerComponent("PointerErrorsFixture", () => Fixture);
globalThis.PointerErrorsFixture = {
  snapshot: () => ({events: [...events], mounts, cleanups,
    currentPriority: nativeFabricUIManager.unstable_getCurrentEventPriority(),
    defaultPriority: nativeFabricUIManager.unstable_DefaultEventPriority}),
  clear: () => { events.length = 0; },
  arm(name, box, type) { fault = {name, box, type}; },
  capture(name, box, pointerId) { panels.get(name)[box].setPointerCapture(pointerId); },
  query(name, box, pointerId) { return panels.get(name)?.[box]?.hasPointerCapture(pointerId) ?? false; },
  stopOnGot() { stopOnGot = true; },
};
