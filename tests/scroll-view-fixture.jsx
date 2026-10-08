import React, {useEffect, useRef, useState} from "react";
import {AppRegistry, PanResponder, Pressable, ScrollView, Text, View} from "react-native";
import OriginalScrollView from "react-native/Libraries/Components/ScrollView/ScrollView";
import {create, diff} from "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload";
import * as ViewConfigRegistry from "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry";
import {controlViewConfig} from "../src/components";

const state = {events: [], errors: [], taps: 0, cancelled: 0, touchCancelled: 0, captured: 0, measure: null,
  contextForwarded: ScrollView.Context === OriginalScrollView.Context, blockNative: false,
  captureSibling: false, lastPointerId: null, siblingCaptureRequests: 0, siblingGotCapture: 0, siblingLostCapture: 0};
let scrollRef;
let setRowsVisible;
let setFirstRowCollapsed;
let setTinyViewport;
let setControlledOffset;
let firstRowRef;
let siblingCaptureTarget;
const secondaryState = {events: [], end: null};
globalThis.ScrollViewFixture = {
  snapshot: () => ({...JSON.parse(JSON.stringify(state)), siblingHasCapture: state.lastPointerId != null &&
    siblingCaptureTarget?.hasPointerCapture(state.lastPointerId) === true}),
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
  reset: () => { state.events = []; state.taps = 0; state.cancelled = 0; state.touchCancelled = 0; state.captured = 0;
    state.captureSibling = false; state.lastPointerId = null; state.siblingCaptureRequests = 0;
    state.siblingGotCapture = 0; state.siblingLostCapture = 0; },
  replaceContent: () => setRowsVisible?.(value => !value),
  setCaptureSibling: value => { state.captureSibling = value; },
  setFirstRowCollapsed: value => setFirstRowCollapsed?.(value),
  setTinyViewport: value => setTinyViewport?.(value),
  setContentOffset: value => setControlledOffset?.(value),
  setBlockNative: value => { state.blockNative = value; },
  measureFirstRow: () => firstRowRef?.measureInWindow((x, y, width, height) => { state.measure = {x, y, width, height}; }),
};

function ScrollViewFixture() {
  const ref = useRef(null);
  const firstRow = useRef(null);
  const siblingCaptureRef = useRef(null);
  const [rowsVisible, setRowsVisibleState] = useState(true);
  const [firstRowCollapsedState, setFirstRowCollapsedState] = useState(false);
  const [tiny, setTiny] = useState(false);
  const [contentOffset, setContentOffset] = useState({x: 0, y: 0});
  const blocker = useRef(PanResponder.create({
    onStartShouldSetPanResponderCapture: () => state.blockNative,
    onMoveShouldSetPanResponderCapture: (_event, gesture) => state.blockNative && Math.abs(gesture.dy) > 4,
    onPanResponderGrant: () => state.events.push({type: "responderGrant"}),
  })).current;
  useEffect(() => { scrollRef = ref.current; }, []);
  useEffect(() => { siblingCaptureTarget = siblingCaptureRef.current; }, []);
  useEffect(() => { setFirstRowCollapsed = setFirstRowCollapsedState; }, []);
  useEffect(() => { firstRowRef = firstRow.current; }, [rowsVisible]);
  useEffect(() => { setRowsVisible = setRowsVisibleState; }, []);
  useEffect(() => { setTinyViewport = setTiny; }, []);
  useEffect(() => { setControlledOffset = setContentOffset; }, []);
  return <View testID="fixture-root" style={{width: 420, height: 320}} {...blocker.panHandlers}>
    <ScrollView ref={ref} testID="scroll" contentOffset={contentOffset} style={{position: "absolute", left: 24, top: 24,
      width: tiny ? 8 : 220, height: tiny ? 8 : 170}}
      bounces={false} pagingEnabled={false} nestedScrollEnabled={false} scrollsToTop={false}
      persistentScrollbar={true}
      alwaysBounceHorizontal={false} alwaysBounceVertical={false} pinchGestureEnabled={false}
      disableScrollViewPanResponder={false} automaticallyAdjustContentInsets={false}
      automaticallyAdjustKeyboardInsets={false} automaticallyAdjustsScrollIndicatorInsets={false}
      keyboardDismissMode="none" centerContent={false} disableIntervalMomentum={false}
      canCancelContentTouches={true} overScrollMode="never" scrollToOverflowEnabled={false}
      contentContainerStyle={{minWidth: rowsVisible ? 760 : 0, minHeight: rowsVisible ? 760 : 0}} scrollEventThrottle={0}
      onScroll={event => state.events.push({type: "scroll", x: event.nativeEvent.contentOffset.x, y: event.nativeEvent.contentOffset.y})}
      onScrollBeginDrag={event => state.events.push({type: "begin", y: event.nativeEvent.contentOffset.y})}
      onScrollEndDrag={event => state.events.push({type: "end", y: event.nativeEvent.contentOffset.y,
        x: event.nativeEvent.contentOffset.x, target: event.nativeEvent.targetContentOffset.y,
        targetX: event.nativeEvent.targetContentOffset.x, velocity: event.nativeEvent.velocity.y,
        velocityX: event.nativeEvent.velocity.x})}
      onMomentumScrollBegin={() => state.events.push({type: "momentumBegin"})}
      onMomentumScrollEnd={() => state.events.push({type: "momentumEnd"})}>
      {rowsVisible && Array.from({length: 20}, (_, index) => <Pressable key={index} ref={index === 0 ? firstRow : null}
        testID={`row-${index}`} style={{height: 36,
          transform: index === 0 && firstRowCollapsedState ? [{scale: 0}] : undefined}}
        onPress={() => state.taps++} onPointerCancel={() => state.cancelled++} onTouchCancel={() => state.touchCancelled++}
        onPointerDown={event => {
          state.lastPointerId = event.nativeEvent.pointerId;
          if (state.captureSibling && index === 0 && siblingCaptureRef.current) {
            siblingCaptureRef.current.setPointerCapture(event.nativeEvent.pointerId);
            state.siblingCaptureRequests++;
          }
          if (index === 1) { event.currentTarget.setPointerCapture(event.nativeEvent.pointerId); state.captured++; }
        }}>
        <Text>Scroll row {index}</Text>
      </Pressable>)}
    </ScrollView>
    <View ref={siblingCaptureRef} testID="sibling-capture-target" pointerEvents="none"
      onGotPointerCapture={() => { state.siblingGotCapture++; }}
      onLostPointerCapture={() => { state.siblingLostCapture++; }}
      style={{position: "absolute", left: 300, top: 24, width: 24, height: 24}} />
  </View>;
}

AppRegistry.registerComponent("ScrollViewFixture", () => ScrollViewFixture);

function SecondaryScrollViewFixture() {
  const ref = useRef(null);
  const [horizontal, setHorizontal] = useState(true);
  useEffect(() => { globalThis.SecondaryScrollViewFixture = {
    command: (method, args) => ref.current?.[method](...args),
    reset: () => { secondaryState.events = []; secondaryState.end = null; },
    setHorizontal,
    snapshot: () => JSON.parse(JSON.stringify(secondaryState)),
  }; }, []);
  return <ScrollView ref={ref} testID="secondary-scroll" horizontal={horizontal}
    style={{position: "absolute", left: 24, top: 24, width: 220, height: 170}}
    contentContainerStyle={{width: 760, height: 760}}
    onScrollBeginDrag={() => secondaryState.events.push("begin")}
    onScrollEndDrag={event => {
      secondaryState.end = {x: event.nativeEvent.contentOffset.x, y: event.nativeEvent.contentOffset.y,
        velocityX: event.nativeEvent.velocity.x, velocityY: event.nativeEvent.velocity.y,
        targetX: event.nativeEvent.targetContentOffset.x, targetY: event.nativeEvent.targetContentOffset.y};
      secondaryState.events.push("end");
    }}
    onMomentumScrollBegin={() => secondaryState.events.push("momentumBegin")}
    onMomentumScrollEnd={() => secondaryState.events.push("momentumEnd")}>
    <View style={{width: 760, height: 760, backgroundColor: "#1d4ed8"}} />
  </ScrollView>;
}
AppRegistry.registerComponent("SecondaryScrollViewFixture", () => SecondaryScrollViewFixture);
