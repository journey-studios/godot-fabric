import assert from "node:assert/strict";
import test from "node:test";
import {prepareScrollViewProps} from "../src/scroll-view-contract.mjs";

test("the public ScrollView rejects native features the host cannot honor", () => {
  const unsupported = [
    "pagingEnabled", "snapToInterval", "snapToOffsets", "bounces", "contentInset",
    "refreshControl", "maintainVisibleContentPosition", "stickyHeaderIndices",
    "nestedScrollEnabled", "keyboardDismissMode", "zoomScale",
    "disableScrollViewPanResponder", "indicatorStyle", "scrollIndicatorInsets",
    "directionalLockEnabled", "centerContent", "canCancelContentTouches",
    "snapToStart", "snapToEnd", "persistentScrollbar", "fadingEdgeLength",
    "endFillColor", "experimental_endDraggingSensitivityMultiplier",
  ];
  for (const name of unsupported) {
    assert.throws(() => prepareScrollViewProps({[name]: name === "snapToOffsets" ? [20] : true}),
      new RegExp(`Godot ScrollView ${name} is not implemented`));
  }
  const unsupportedValues = [
    ["scrollPerfTag", "probe-perf"],
    ["scrollsChildToFocus", true],
    ...["onKeyboardWillShow", "onKeyboardDidShow", "onKeyboardWillHide", "onKeyboardDidHide"]
      .map(name => [name, () => {}]),
  ];
  for (const [name, value] of unsupportedValues)
    assert.throws(() => prepareScrollViewProps({[name]: value}),
      new RegExp(`Godot ScrollView ${name} is not implemented`));
  assert.throws(() => prepareScrollViewProps({removeClippedSubviews: true}),
    /Godot ScrollView removeClippedSubviews is not implemented/);
  assert.equal(prepareScrollViewProps({removeClippedSubviews: false}).removeClippedSubviews, false);
  assert.throws(() => prepareScrollViewProps({onRefresh() {}}), /refreshControl is not implemented/);
  assert.throws(() => prepareScrollViewProps({refreshing: true}), /refreshControl is not implemented/);
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
