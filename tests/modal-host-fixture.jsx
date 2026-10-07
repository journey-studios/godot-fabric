import React, {useEffect, useState} from "react";
import {AppRegistry, Button, Modal, Pressable, SafeAreaView, Text, TextInput, View} from "react-native";

const state = {shows: 0, secondShows: 0, showOrder: [], closes: 0, changes: [], layouts: [], measurements: [], zeroMeasurements: [], hiddenMeasurements: [], staleMeasurements: [], modalZeroMeasurements: [], nestedMeasurements: [], modalPointerDowns: 0, modalPointerCancels: 0, modalTouchCancels: 0, modalPointerCaptureGots: 0, modalPointerCaptureLosts: 0, modalCapturedMoves: 0, modalCapturedUps: 0, modalCaptureRequested: false, modalCapturePresentOnGot: false, modalCapturePresentOnLost: true, modalPressIns: 0, modalPressOuts: 0, modalPresses: 0, modalPointerScreen: null, modalAncestorMoves: 0, modalAncestorUps: 0, modalAncestorCaptureGots: 0, modalAncestorCaptureLosts: 0, nestedPointerDowns: 0, nestedPresses: 0, backgroundPointerDowns: 0, backgroundPresses: 0, buttonClicks: 0, backgroundClicks: 0, value: "first", visible: true, secondVisible: false, showZero: true};
let setVisibleFromReact, setSecondVisibleFromReact, setShowZeroFromReact;
let safeAreaRef, secondModalRef, zeroRef, retainedZeroRef, hiddenRef, modalZeroRef, modalPressableRef;
const foreignState = {shows: 0, value: "foreign", pointerDowns: 0, pointerCancels: 0,
  touchCancels: 0, gotCaptures: 0, lostCaptures: 0, captureActiveOnGot: false,
  captureActiveOnLost: true, presses: 0, pointerUps: 0};
let setForeignValueFromReact, foreignPressableRef;
const crossRootState = {events: [], pointerId: null, pendingCapture: false, captured: false};
const crossRootRefs = {};
const lifecycleState = {mounted: true, downs: 0, moves: 0, ups: 0, presses: 0,
  cancels: 0, gots: 0, losts: 0, capturePresentOnGot: false, shows: 0};
let setLifecycleMounted, lifecyclePressableRef;
const reorderState = {order: ["a", "portal", "b", "c"], value: "seed", shows: 0, changes: []};
let setReorderOrder, setReorderValue;
function ModalHostProbe() {
  const [visible, setVisible] = useState(true);
  setVisibleFromReact = value => {
    state.visible = value;
    setVisible(value);
  };
  const [secondVisible, setSecondVisible] = useState(false);
  const [showZero, setShowZero] = useState(true);
  setShowZeroFromReact = value => {
    state.showZero = value;
    setShowZero(value);
  };
  setSecondVisibleFromReact = value => {
    state.secondVisible = value;
    setSecondVisible(value);
  };
  const [value, setValue] = useState("first");
  state.value = value;
  useEffect(() => {
    state.mounts = (state.mounts ?? 0) + 1;
    return () => { state.unmounts = (state.unmounts ?? 0) + 1; };
  }, []);
  return <View testID="small-root" onPointerMove={() => { state.modalAncestorMoves += 1; }}
    onPointerUp={() => { state.modalAncestorUps += 1; }}
    onGotPointerCapture={() => { state.modalAncestorCaptureGots += 1; }}
    onLostPointerCapture={() => { state.modalAncestorCaptureLosts += 1; }} onLayout={() => {
    if (zeroRef) zeroRef.measureInWindow((x, y, width, height) => state.zeroMeasurements.push({x, y, width, height}));
    if (hiddenRef) hiddenRef.measureInWindow((x, y, width, height) => state.hiddenMeasurements.push({x, y, width, height}));
  }} style={{width: 90, height: 70, backgroundColor: "#142033", transform: [{scale: 1.25}]}}>
    <Text testID="background-label">Background</Text>
    {showZero && <View testID="background-zero" collapsable={false}
      ref={node => { if (node) zeroRef = node; else retainedZeroRef = zeroRef; zeroRef = node; }}
      style={{position: "absolute", left: 11, top: 13, width: 0, height: 0}} />}
    <View testID="background-hidden" collapsable={false} ref={node => { hiddenRef = node; }}
      style={{display: "none", position: "absolute", left: 17, top: 19, width: 0, height: 0}} />
    <Button testID="background-action" title="Background action" onPress={() => { state.backgroundClicks += 1; }} />
    <Pressable testID="background-pressable" onPointerDown={() => { state.backgroundPointerDowns += 1; }}
      onPress={() => { state.backgroundPresses += 1; }}
      style={{width: 80, height: 32, backgroundColor: "#304050"}} />
    <Modal testID="first-modal" visible={visible} transparent presentationStyle="overFullScreen"
      onShow={() => { state.shows += 1; state.showOrder.push("first"); }}
      onRequestClose={() => { state.closes += 1; }}>
      <SafeAreaView testID="modal-safe-area" ref={node => { safeAreaRef = node; }}
        onLayout={event => {
          state.layouts.push(event.nativeEvent.layout);
          if (safeAreaRef) safeAreaRef.measureInWindow((x, y, width, height) =>
            state.measurements.push({x, y, width, height}));
          if (modalZeroRef) modalZeroRef.measureInWindow((x, y, width, height) =>
            state.modalZeroMeasurements.push({x, y, width, height}));
        }}
        style={{flex: 1, backgroundColor: "#24364dcc", padding: 12}}>
        <View testID="modal-zero" collapsable={false} ref={node => { modalZeroRef = node; }}
          style={{position: "absolute", left: 23, top: 29, width: 0, height: 0}} />
        <Text testID="modal-title">Modal contents</Text>
        <TextInput testID="modal-input" value={value} onChangeText={next => {
          state.value = next;
          state.changes.push(next);
          setValue(next);
        }} />
        <Pressable testID="modal-pressable"
          ref={node => { modalPressableRef = node; }}
          onPointerDown={event => {
            state.modalPointerDowns += 1;
            state.modalPointerScreen = [event.nativeEvent.screenX, event.nativeEvent.screenY];
            state.modalPointerId = event.nativeEvent.pointerId;
            state.modalCaptureRequested = true;
            modalPressableRef?.setPointerCapture(event.nativeEvent.pointerId);
          }}
          onPointerMove={() => { state.modalCapturedMoves += 1; }}
          onPointerUp={() => { state.modalCapturedUps += 1; }}
          onPointerCancel={() => { state.modalPointerCancels += 1; }}
          onTouchCancel={() => { state.modalTouchCancels += 1; }}
          onGotPointerCapture={() => {
            state.modalPointerCaptureGots += 1;
            state.modalCapturePresentOnGot = modalPressableRef?.hasPointerCapture(
              Number(state.modalPointerId)) ?? false;
          }}
          onLostPointerCapture={event => {
            state.modalPointerCaptureLosts += 1;
            state.modalCapturePresentOnLost = modalPressableRef?.hasPointerCapture(
              event.nativeEvent.pointerId) ?? false;
          }}
          onPressIn={() => { state.modalPressIns += 1; }}
          onPressOut={() => { state.modalPressOuts += 1; }}
          onPress={() => { state.modalPresses += 1; }}
          style={{width: 180, height: 44, backgroundColor: "#358050"}} />
        <Button testID="modal-action" title="Modal action" onPress={() => { state.buttonClicks += 1; }} />
        <Modal testID="second-modal" visible={secondVisible} transparent presentationStyle="overFullScreen"
          onShow={() => {
            state.secondShows += 1;
            state.showOrder.push("second");
          }}>
          <SafeAreaView testID="second-modal-content" ref={node => { secondModalRef = node; }}
            onLayout={() => {
              if (secondModalRef) secondModalRef.measureInWindow((x, y, width, height) =>
                state.nestedMeasurements.push({x, y, width, height}));
            }} style={{flex: 1, backgroundColor: "#543624cc"}}>
            <Text testID="second-modal-title">Second modal</Text>
            <Pressable testID="second-modal-pressable"
              onPointerDown={() => { state.nestedPointerDowns += 1; }}
              onPress={() => { state.nestedPresses += 1; }}
              style={{width: 180, height: 44, backgroundColor: "#805035"}} />
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </Modal>
    <Text testID="visible-state">{visible ? "visible" : "hidden"}</Text>
  </View>;
}

function ForeignModalProbe() {
  const [value, setValue] = useState("foreign");
  setForeignValueFromReact = next => setValue(next);
  foreignState.value = value;
  return <Modal testID="foreign-modal" visible transparent presentationStyle="overFullScreen"
    onShow={() => { foreignState.shows += 1; }}>
    <SafeAreaView testID="foreign-modal-content" style={{flex: 1, backgroundColor: "#263c50"}}>
      <TextInput testID="foreign-input" value={value} onChangeText={next => {
        foreignState.value = next;
        setValue(next);
      }} />
      <Pressable testID="foreign-pressable" ref={node => { foreignPressableRef = node; }}
        onPointerDown={event => {
          foreignState.pointerDowns += 1;
          foreignPressableRef?.setPointerCapture(event.nativeEvent.pointerId);
        }}
        onPointerCancel={() => { foreignState.pointerCancels += 1; }}
        onTouchCancel={() => { foreignState.touchCancels += 1; }}
        onGotPointerCapture={event => {
          foreignState.gotCaptures += 1;
          foreignState.captureActiveOnGot = foreignPressableRef?.hasPointerCapture(
            event.nativeEvent.pointerId) ?? false;
        }}
        onLostPointerCapture={event => {
          foreignState.lostCaptures += 1;
          foreignState.captureActiveOnLost = foreignPressableRef?.hasPointerCapture(
            event.nativeEvent.pointerId) ?? false;
        }}
        onPointerUp={() => { foreignState.pointerUps += 1; }}
        onPress={() => { foreignState.presses += 1; }}
        style={{width: 180, height: 44, backgroundColor: "#357080"}} />
    </SafeAreaView>
  </Modal>;
}

function CrossRootCaptureProbe({name}) {
  return <View testID={`cross-root-${name}-root`} onPointerMove={() => {
    crossRootState.events.push({name, phase: "ancestor-move"});
  }} onPointerUp={() => { crossRootState.events.push({name, phase: "ancestor-up"}); }}
    onGotPointerCapture={() => crossRootState.events.push({name, phase: "ancestor-got"})}
    onLostPointerCapture={() => crossRootState.events.push({name, phase: "ancestor-lost"})}
    onPointerEnter={() => crossRootState.events.push({name, phase: "ancestor-enter"})}
    onPointerLeave={() => crossRootState.events.push({name, phase: "ancestor-leave"})}
    style={{flex: 1}}>
    <Pressable testID={`cross-root-${name}`} ref={node => { crossRootRefs[name] = node; }}
      onPointerEnter={() => crossRootState.events.push({name, phase: "enter"})}
      onPointerLeave={() => crossRootState.events.push({name, phase: "leave"})}
      onPointerDown={event => {
        crossRootState.events.push({name, phase: "down", id: event.nativeEvent.pointerId});
        if (name === "A") {
          crossRootState.pointerId = event.nativeEvent.pointerId;
          crossRootRefs.B?.setPointerCapture(crossRootState.pointerId);
          crossRootState.pendingCapture = crossRootRefs.B?.hasPointerCapture(crossRootState.pointerId) ?? false;
        }
      }}
      onGotPointerCapture={event => crossRootState.events.push({name, phase: "got", id: event.nativeEvent.pointerId})}
      onLostPointerCapture={event => crossRootState.events.push({name, phase: "lost", id: event.nativeEvent.pointerId})}
      onPointerMove={event => crossRootState.events.push({name, phase: "move", x: event.nativeEvent.offsetX, y: event.nativeEvent.offsetY})}
      onPointerUp={event => crossRootState.events.push({name, phase: "up", id: event.nativeEvent.pointerId})}
      onPress={() => crossRootState.events.push({name, phase: "press"})}
      style={{flex: 1, backgroundColor: name === "A" ? "#385080" : "#805038"}} />
  </View>;
}

function ModalLifecycleProbe() {
  const [mounted, setMounted] = useState(true);
  setLifecycleMounted = next => { lifecycleState.mounted = next; setMounted(next); };
  return <View testID="lifecycle-root" style={{flex: 1}}>
    {mounted && <Modal key="portal" testID="lifecycle-modal" visible transparent presentationStyle="overFullScreen"
      onShow={() => { lifecycleState.shows += 1; }}>
      <SafeAreaView testID="lifecycle-content" style={{flex: 1, backgroundColor: "#24364dcc"}}>
        <Pressable testID="lifecycle-target" ref={node => { lifecyclePressableRef = node; }}
          onPointerDown={event => {
            lifecycleState.downs += 1;
            lifecyclePressableRef?.setPointerCapture(event.nativeEvent.pointerId);
          }}
          onPointerMove={() => { lifecycleState.moves += 1; }}
          onPointerUp={() => { lifecycleState.ups += 1; }}
          onPointerCancel={() => { lifecycleState.cancels += 1; }}
          onGotPointerCapture={event => {
            lifecycleState.gots += 1;
            lifecycleState.capturePresentOnGot = lifecyclePressableRef?.hasPointerCapture(
              event.nativeEvent.pointerId) ?? false;
          }}
          onLostPointerCapture={() => { lifecycleState.losts += 1; }}
          onPress={() => { lifecycleState.presses += 1; }}
          style={{width: 180, height: 80, backgroundColor: "#358050"}} />
      </SafeAreaView>
    </Modal>}
  </View>;
}

function renderReorderChild(key) {
  if (key === "portal") return <Modal key="portal" testID="order-modal" visible transparent presentationStyle="overFullScreen"
    onShow={() => { reorderState.shows += 1; }}>
    <SafeAreaView testID="order-modal-content" style={{flex: 1, backgroundColor: "#24364dcc"}}>
      <TextInput testID="order-modal-input" value={reorderState.value} onChangeText={value => {
        reorderState.value = value;
        reorderState.changes.push(value);
        setReorderValue(value);
      }} />
    </SafeAreaView>
  </Modal>;
  const color = key === "a" ? "#804030" : key === "b" ? "#308040" : "#403080";
  return <View key={key} testID={`ordinary-${key}`} style={{width: 60, height: 36, backgroundColor: color}} />;
}

function ModalOrderProbe() {
  const [order, setOrder] = useState(reorderState.order);
  const [value, setValue] = useState(reorderState.value);
  setReorderOrder = next => { reorderState.order = next; setOrder(next); };
  setReorderValue = next => setValue(next);
  reorderState.value = value;
  return <View testID="logical-parent" style={{width: 360, height: 200}}>{order.map(renderReorderChild)}</View>;
}

function ModalMembershipProbe() {
  return <View testID="membership-root" style={{flex: 1}}>
    <Text testID="membership-label">Runtime without a Modal</Text>
  </View>;
}

AppRegistry.registerComponent("ModalHostProbe", () => ModalHostProbe);
AppRegistry.registerComponent("ForeignModalProbe", () => ForeignModalProbe);
AppRegistry.registerComponent("CrossRootCaptureProbe", () => CrossRootCaptureProbe);
AppRegistry.registerComponent("ModalLifecycleProbe", () => ModalLifecycleProbe);
AppRegistry.registerComponent("ModalOrderProbe", () => ModalOrderProbe);
AppRegistry.registerComponent("ModalMembershipProbe", () => ModalMembershipProbe);
globalThis.ModalHostProbe = {
  snapshot: () => ({...state}),
  setVisible: value => setVisibleFromReact(value),
  setSecondVisible: value => setSecondVisibleFromReact(value),
  setShowZero: value => setShowZeroFromReact(value),
  measureRetainedZero: () => {
    state.retainedZeroRef = retainedZeroRef != null;
    state.retainedZeroConnected = retainedZeroRef?.isConnected ?? null;
    if (retainedZeroRef) retainedZeroRef.measureInWindow((x, y, width, height) =>
      state.staleMeasurements.push({x, y, width, height}));
  },
};
globalThis.ForeignModalProbe = {
  snapshot: () => ({...foreignState}),
};
globalThis.CrossRootCaptureProbe = {
  snapshot: () => ({...crossRootState, connected: Object.fromEntries(Object.entries(crossRootRefs).map(([name, ref]) => [name, ref?.isConnected ?? false])), captured: crossRootState.pointerId === null ? null : crossRootRefs.B?.hasPointerCapture(crossRootState.pointerId) ?? false}),
};
globalThis.ModalLifecycleProbe = {
  snapshot: () => ({...lifecycleState}),
  setMounted: next => setLifecycleMounted(next),
};
globalThis.ModalOrderProbe = {
  snapshot: () => ({...reorderState, order: [...reorderState.order], changes: [...reorderState.changes]}),
  reorder: order => setReorderOrder(order),
};
