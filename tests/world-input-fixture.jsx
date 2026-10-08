import React, {useState} from "react";
import {AppRegistry, Modal, Pressable, ScrollView, Text, View} from "react-native";

// The React Native HUD of the pointer spike, drawn over a Godot world. Each handler
// counts into one global, so that the probe can say, from JavaScript's side and
// without depending on the host's pointer counters, which controls of the HUD
// heard a pointer: a click on empty HUD must leave every counter at zero, because
// the root is pointerEvents="box-none" and the empty area belongs to the world.
//
// WorldInputHud is the full-screen root of topology (a): a bar with a Pressable and a
// handler of its own, a plain panel with no handler, a ScrollView, a tree overlay
// and a Modal (both start closed), and the controls where the minimal policy still
// lets the world hear a press that React Native also takes (a hit slop, a Text with
// onPress, the gaps of a ScrollView). WorldInputPanel is the root of topology (b),
// one Surface for each panel.
const counts = {};
const hit = (panel, handler) => {
  const key = panel + "/" + handler;
  counts[key] = (counts[key] ?? 0) + 1;
};
const setters = {};
const probe = {
  snapshot() {
    return {...counts};
  },
  reset() {
    for (const key of Object.keys(counts)) {
      delete counts[key];
    }
  },
  // Opens or closes the tree overlay or the Modal.
  show(name, visible) {
    setters[name](visible);
  },
};
globalThis.WorldInputProbe = probe;

const area = (left, top, width, height, extra = {}) => ({position: "absolute", left, top, width, height, ...extra});

function WorldInputHud({name = "hud"}) {
  const [tree, setTree] = useState(false);
  const [modal, setModal] = useState(false);
  setters.tree = setTree;
  setters.modal = setModal;
  // Everything painted below is a region React Native owns; the rest of the root is the world's.
  return (
    <View testID="hud-root" pointerEvents="box-none" style={{flex: 1}}>
      <View testID="bar" onPointerDown={() => hit(name, "barDown")} style={area(0, 0, 300, 100, {backgroundColor: "#223344"})}>
        <Pressable testID="bar-button" onPress={() => hit(name, "press")} style={area(20, 20, 100, 40, {backgroundColor: "#4466aa"})} />
      </View>
      <View testID="panel" style={area(320, 0, 160, 100, {backgroundColor: "#443322"})} />
      <View testID="scroll-panel" style={area(0, 120, 300, 150, {backgroundColor: "#334422"})}>
        <ScrollView testID="scroll" style={{flex: 1}}>
          <Pressable testID="scroll-button" onPress={() => hit(name, "scrollPress")}
            style={{width: 280, height: 400, backgroundColor: "#556633"}} />
        </ScrollView>
      </View>
      <Pressable testID="slop-button" hitSlop={20} onPress={() => hit(name, "slopPress")}
        style={area(500, 100, 60, 40, {backgroundColor: "#aa6666"})} />
      <Text testID="float-text" onPress={() => hit(name, "textPress")}
        style={area(500, 200, 80, 30, {color: "#ffffff", fontSize: 20})}>Tap me</Text>
      <View testID="short-wrap" pointerEvents="box-none" onPointerDown={() => hit(name, "wrapDown")} style={area(400, 300, 300, 150)}>
        <ScrollView testID="short-scroll" style={{flex: 1, backgroundColor: "#333355"}}>
          <View style={{height: 40}} />
        </ScrollView>
      </View>
      {tree && (
        <View testID="tree-overlay" style={area(0, 0, 800, 600, {backgroundColor: "rgba(0, 0, 0, 0.5)"})}>
          <Pressable testID="tree-button" onPress={() => hit(name, "treePress")}
            style={area(300, 300, 100, 40, {backgroundColor: "#aa6644"})} />
        </View>
      )}
      <Modal testID="modal" visible={modal} transparent onRequestClose={() => setModal(false)}>
        <View testID="modal-body" style={{flex: 1, backgroundColor: "rgba(0, 0, 0, 0.4)"}}>
          <Pressable testID="modal-button" onPress={() => hit(name, "modalPress")}
            style={area(300, 300, 100, 40, {backgroundColor: "#aa4466"})} />
        </View>
      </Modal>
    </View>
  );
}

function WorldInputPanel({name}) {
  return (
    <View testID={"panel-" + name} pointerEvents="box-none" style={{flex: 1}}>
      <View testID="bar" onPointerDown={() => hit(name, "barDown")} style={area(0, 0, 360, 80, {backgroundColor: "#223344"})}>
        <Pressable testID="bar-button" onPress={() => hit(name, "press")} style={area(20, 20, 100, 40, {backgroundColor: "#4466aa"})} />
      </View>
    </View>
  );
}

AppRegistry.registerComponent("WorldInputHud", () => WorldInputHud);
AppRegistry.registerComponent("WorldInputPanel", () => WorldInputPanel);
