import assert from "node:assert/strict";
import test from "node:test";
import {prepareScrollViewProps} from "../src/scroll-view-contract.mjs";

test("the public ScrollView rejects native features the host cannot honor", () => {
  const unsupported = [
    ["alwaysBounceHorizontal", true], ["alwaysBounceVertical", true],
    ["automaticallyAdjustContentInsets", true], ["automaticallyAdjustKeyboardInsets", true],
    ["automaticallyAdjustsScrollIndicatorInsets", true],
    ["pagingEnabled", true], ["snapToInterval", 20], ["snapToOffsets", [20]], ["bounces", true],
    ["bouncesZoom", true],
    ["contentInset", {top: 12}], ["refreshControl", {}], ["maintainVisibleContentPosition", {minIndexForVisible: 0}],
    ["stickyHeaderIndices", [0]], ["nestedScrollEnabled", true], ["keyboardDismissMode", "on-drag"],
    ["zoomScale", 2], ["disableScrollViewPanResponder", true], ["indicatorStyle", "white"],
    ["scrollIndicatorInsets", {right: 2}], ["directionalLockEnabled", true], ["centerContent", true],
    ["canCancelContentTouches", false], ["snapToStart", false], ["snapToEnd", false],
    ["pinchGestureEnabled", true], ["scrollsToTop", true],
    ["persistentScrollbar", false], ["fadingEdgeLength", 12], ["endFillColor", "red"],
    ["experimental_endDraggingSensitivityMultiplier", 2], ["overScrollMode", "always"],
    ["scrollToOverflowEnabled", true], ["disableIntervalMomentum", true],
  ];
  for (const [name, value] of unsupported) {
    assert.throws(() => prepareScrollViewProps({[name]: value}), new Error(`Godot ScrollView does not implement ${name}`));
  }
  const unsupportedValues = [
    ["scrollPerfTag", "probe-perf"],
    ["scrollsChildToFocus", true],
    ...["onKeyboardWillShow", "onKeyboardDidShow", "onKeyboardWillHide", "onKeyboardDidHide"]
      .map(name => [name, () => {}]),
  ];
  for (const [name, value] of unsupportedValues)
    assert.throws(() => prepareScrollViewProps({[name]: value}), new Error(`Godot ScrollView does not implement ${name}`));
  assert.throws(() => prepareScrollViewProps({removeClippedSubviews: true}),
    new Error("Godot ScrollView does not implement removeClippedSubviews"));
  assert.equal(prepareScrollViewProps({removeClippedSubviews: false}).removeClippedSubviews, false);

  const neutralOptions = [
    ["alwaysBounceHorizontal", false], ["alwaysBounceVertical", false],
    ["automaticallyAdjustContentInsets", false], ["automaticallyAdjustKeyboardInsets", false],
    ["automaticallyAdjustsScrollIndicatorInsets", false], ["bounces", false], ["bouncesZoom", false],
    ["canCancelContentTouches", true], ["centerContent", false], ["disableIntervalMomentum", false],
    ["disableScrollViewPanResponder", false], ["keyboardDismissMode", "none"],
    ["nestedScrollEnabled", false], ["overScrollMode", "never"], ["pagingEnabled", false],
    ["persistentScrollbar", true], ["pinchGestureEnabled", false], ["scrollToOverflowEnabled", false],
    ["scrollsToTop", false],
    ["removeClippedSubviews", false], ["stickyHeaderIndices", []], ["snapToOffsets", []],
  ];
  for (const [name, value] of neutralOptions) {
    assert.equal(prepareScrollViewProps({[name]: value})[name], value,
      `${name} neutral value should pass through`);
  }
  // Pull to refresh: the lists hand onRefresh and refreshing to the ScrollView they render. Both fail, uniformly with the rest,
  // and the idle values (refreshing false, no handler) pass and are taken off.
  assert.throws(() => prepareScrollViewProps({onRefresh() {}}), new Error("Godot ScrollView does not implement onRefresh"));
  assert.throws(() => prepareScrollViewProps({refreshing: true}), new Error("Godot ScrollView does not implement refreshing"));
  assert.deepEqual(prepareScrollViewProps({refreshing: false, onRefresh: null, testID: "idle"}), {testID: "idle"});
  assert.throws(() => prepareScrollViewProps({contentOffset: {x: 0, y: Infinity}}), /finite x\/y coordinates/);
  assert.throws(() => prepareScrollViewProps({contentOffset: {x: NaN, y: 1}}), /finite x\/y coordinates/);
  for (const contentOffset of ["12", [0, 12], 12, {x: "0", y: 12}])
    assert.throws(() => prepareScrollViewProps({contentOffset}), /contentOffset requires/);
  assert.throws(() => prepareScrollViewProps({scrollEventThrottle: Infinity}), /finite non-negative number/);
  assert.throws(() => prepareScrollViewProps({scrollEventThrottle: -1}), /finite non-negative number/);
});

test("the original list's passthrough and native indicator defaults remain usable", () => {
  const props = prepareScrollViewProps({
    testID: "feed", horizontal: false, scrollEnabled: true, scrollEventThrottle: 16,
    showsVerticalScrollIndicator: true, stickyHeaderIndices: [], snapToOffsets: [],
    data: [1, 2], renderItem() {}, refreshing: false,
  });
  assert.equal(props.testID, "feed");
  assert.equal(props.showsVerticalScrollIndicator, true);
  assert.equal(props.scrollEventThrottle, 16);
  assert.deepEqual(props.stickyHeaderIndices, []);
  assert.deepEqual(props.snapToOffsets, []);
  assert.equal("data" in props, false);
  assert.equal("renderItem" in props, false);
  assert.equal("refreshing" in props, false);
});

test("neutral ScrollView options do not strip ordinary props or command inputs", () => {
  const neutralOptions = {
    bounces: false, pagingEnabled: false, nestedScrollEnabled: false, scrollsToTop: false,
    alwaysBounceHorizontal: false, alwaysBounceVertical: false, pinchGestureEnabled: false,
    disableScrollViewPanResponder: false, automaticallyAdjustContentInsets: false,
    automaticallyAdjustKeyboardInsets: false, automaticallyAdjustsScrollIndicatorInsets: false,
    keyboardDismissMode: "none", centerContent: false, disableIntervalMomentum: false,
    canCancelContentTouches: true, overScrollMode: "never", scrollToOverflowEnabled: false,
  };
  const props = prepareScrollViewProps({
    ...neutralOptions, testID: "neutral-options", horizontal: false, scrollEnabled: true,
    contentOffset: {x: 12, y: 24}, scrollEventThrottle: 0,
  });
  assert.deepEqual(Object.fromEntries(Object.keys(neutralOptions).map(name => [name, props[name]]),), neutralOptions);
  assert.equal(props.testID, "neutral-options");
  assert.equal(props.horizontal, false);
  assert.deepEqual(props.contentOffset, {x: 12, y: 24});
});
