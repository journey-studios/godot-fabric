import React, {useEffect, useRef, useState} from "react";
import {AppRegistry, PanResponder, Pressable, ScrollView, Text, View} from "react-native";
import OriginalScrollView from "react-native/Libraries/Components/ScrollView/ScrollView";
import {create, diff} from "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload";
import * as ViewConfigRegistry from "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry";
import {controlViewConfig} from "../src/components";

const state = {events: [], errors: [], taps: 0, cancelled: 0, touchCancelled: 0, captured: 0, measure: null,
  contextForwarded: ScrollView.Context === OriginalScrollView.Context, blockNative: false};
let scrollRef;
let setRowsVisible;
let setTinyViewport;
let firstRowRef;
const secondaryState = {events: []};
globalThis.ScrollViewFixture = {
  snapshot: () => JSON.parse(JSON.stringify(state)),
  scrollConfig: () => {
    const native = ViewConfigRegistry.get("RCTScrollView");
    const view = ViewConfigRegistry.get("RCTView");
    return {
      component: native.uiViewClassName,
      horizontalRegistered: Object.prototype.hasOwnProperty.call(native.validAttributes, "horizontal"),
      horizontalTrue: create({horizontal: true}, native.validAttributes),
      horizontalFalse: create({horizontal: false}, native.validAttributes),
      trueToFalse: diff({horizontal: true}, {horizontal: false}, native.validAttributes),
      falseToTrue: diff({horizontal: false}, {horizontal: true}, native.validAttributes),
      viewHasHorizontal: Object.prototype.hasOwnProperty.call(view.validAttributes, "horizontal"),
      godotControlHasHorizontal: Object.prototype.hasOwnProperty.call(controlViewConfig.validAttributes, "horizontal"),
    };
  },
  command: (method, args) => scrollRef?.[method](...args),
  measure: () => new Promise(resolve => scrollRef?.measureInWindow((x, y, width, height) => {
    state.measure = {x, y, width, height}; resolve(state.measure);
  })),
  reset: () => { state.events = []; state.taps = 0; state.cancelled = 0; state.touchCancelled = 0; state.captured = 0; },
  replaceContent: () => setRowsVisible?.(value => !value),
  setTinyViewport: value => setTinyViewport?.(value),
  setBlockNative: value => { state.blockNative = value; },
  measureFirstRow: () => firstRowRef?.measureInWindow((x, y, width, height) => { state.measure = {x, y, width, height}; }),
};

function ScrollViewFixture() {
  const ref = useRef(null);
  const firstRow = useRef(null);
  const [rowsVisible, setRowsVisibleState] = useState(true);
  const [tiny, setTiny] = useState(false);
  const blocker = useRef(PanResponder.create({
    onStartShouldSetPanResponderCapture: () => state.blockNative,
    onMoveShouldSetPanResponderCapture: (_event, gesture) => state.blockNative && Math.abs(gesture.dy) > 4,
    onPanResponderGrant: () => state.events.push({type: "responderGrant"}),
  })).current;
  useEffect(() => { scrollRef = ref.current; }, []);
  useEffect(() => { firstRowRef = firstRow.current; }, [rowsVisible]);
  useEffect(() => { setRowsVisible = setRowsVisibleState; }, []);
  useEffect(() => { setTinyViewport = setTiny; }, []);
  return <View testID="fixture-root" style={{width: 420, height: 320}} {...blocker.panHandlers}>
    <ScrollView ref={ref} testID="scroll" style={{position: "absolute", left: 24, top: 24,
      width: tiny ? 8 : 220, height: tiny ? 8 : 170}}
      contentContainerStyle={{minWidth: rowsVisible ? 760 : 0, minHeight: rowsVisible ? 760 : 0}} scrollEventThrottle={0}
      onScroll={event => state.events.push({type: "scroll", x: event.nativeEvent.contentOffset.x, y: event.nativeEvent.contentOffset.y})}
      onScrollBeginDrag={event => state.events.push({type: "begin", y: event.nativeEvent.contentOffset.y})}
      onScrollEndDrag={event => state.events.push({type: "end", y: event.nativeEvent.contentOffset.y,
        target: event.nativeEvent.targetContentOffset.y, velocity: event.nativeEvent.velocity.y})}
      onMomentumScrollBegin={() => state.events.push({type: "momentumBegin"})}
      onMomentumScrollEnd={() => state.events.push({type: "momentumEnd"})}>
      {rowsVisible && Array.from({length: 20}, (_, index) => <Pressable key={index} ref={index === 0 ? firstRow : null}
        testID={`row-${index}`} style={{height: 36}}
        onPress={() => state.taps++} onPointerCancel={() => state.cancelled++} onTouchCancel={() => state.touchCancelled++}
        onPointerDown={event => { if (index === 1) { event.currentTarget.setPointerCapture(event.nativeEvent.pointerId); state.captured++; } }}>
        <Text>Scroll row {index}</Text>
      </Pressable>)}
    </ScrollView>
  </View>;
}

AppRegistry.registerComponent("ScrollViewFixture", () => ScrollViewFixture);

function SecondaryScrollViewFixture() {
  const ref = useRef(null);
  useEffect(() => { globalThis.SecondaryScrollViewFixture = {
    command: (method, args) => ref.current?.[method](...args),
    reset: () => { secondaryState.events = []; },
    snapshot: () => JSON.parse(JSON.stringify(secondaryState)),
  }; }, []);
  return <ScrollView ref={ref} testID="secondary-scroll" horizontal
    style={{position: "absolute", left: 24, top: 24, width: 220, height: 170}}
    contentContainerStyle={{width: 760, height: 760}}
    onScrollBeginDrag={() => secondaryState.events.push("begin")}
    onScrollEndDrag={() => secondaryState.events.push("end")}
    onMomentumScrollBegin={() => secondaryState.events.push("momentumBegin")}
    onMomentumScrollEnd={() => secondaryState.events.push("momentumEnd")}>
    <View style={{width: 760, height: 760, backgroundColor: "#1d4ed8"}} />
  </ScrollView>;
}
AppRegistry.registerComponent("SecondaryScrollViewFixture", () => SecondaryScrollViewFixture);
