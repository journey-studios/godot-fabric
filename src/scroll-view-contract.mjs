import {listOnlyProps} from "./list-props.mjs";

// Values describe the only request that is neutral for the host. `rejectAny`
// keeps behavior-bearing props fail-closed; `emptyArray` covers opt-in lists
// with no configured entries. Keep this as the canonical public prop policy.
const rejectAny = Symbol("reject-any-non-null");
const emptyArray = Symbol("empty-array-is-neutral");
const unsupportedProps = new Map([
  ["alwaysBounceHorizontal", false],
  ["alwaysBounceVertical", false],
  ["automaticallyAdjustContentInsets", false],
  ["automaticallyAdjustKeyboardInsets", false],
  ["automaticallyAdjustsScrollIndicatorInsets", false],
  ["bounces", false],
  ["bouncesZoom", false],
  ["canCancelContentTouches", true],
  ["centerContent", false],
  ["contentInset", rejectAny],
  ["contentInsetAdjustmentBehavior", rejectAny],
  ["decelerationRate", rejectAny],
  ["disableIntervalMomentum", false],
  ["disableScrollViewPanResponder", false],
  ["directionalLockEnabled", rejectAny],
  ["endFillColor", rejectAny],
  ["experimental_endDraggingSensitivityMultiplier", rejectAny],
  ["fadingEdgeLength", rejectAny],
  ["indicatorStyle", rejectAny],
  ["keyboardDismissMode", "none"],
  ["keyboardShouldPersistTaps", rejectAny],
  ["maintainVisibleContentPosition", rejectAny],
  ["maximumZoomScale", rejectAny],
  ["minimumZoomScale", rejectAny],
  ["nestedScrollEnabled", false],
  ["onScrollToTop", rejectAny],
  ["onKeyboardDidShow", rejectAny],
  ["onKeyboardDidHide", rejectAny],
  ["onKeyboardWillShow", rejectAny],
  ["onKeyboardWillHide", rejectAny],
  ["overScrollMode", "never"],
  ["pagingEnabled", false],
  ["pinchGestureEnabled", false],
  ["persistentScrollbar", true],
  ["refreshControl", rejectAny],
  ["scrollToOverflowEnabled", false],
  ["scrollsToTop", false],
  ["scrollIndicatorInsets", rejectAny],
  ["scrollPerfTag", rejectAny],
  ["scrollsChildToFocus", rejectAny],
  ["removeClippedSubviews", false],
  ["snapToAlignment", rejectAny],
  ["snapToInterval", rejectAny],
  ["snapToOffsets", emptyArray],
  ["snapToStart", rejectAny],
  ["snapToEnd", rejectAny],
  ["stickyHeaderIndices", emptyArray],
  ["zoomScale", rejectAny],
]);

function isRequested(neutral, value) {
  if (value == null) return false;
  if (neutral === rejectAny) return true;
  if (neutral === emptyArray)
    return !Array.isArray(value) || value.length > 0;
  return !Object.is(value, neutral);
}

export function prepareScrollViewProps(props) {
  if (props.onRefresh != null || props.refreshing === true)
    throw new Error("Godot ScrollView refreshControl is not implemented");

  for (const [name, value] of Object.entries(props)) {
    if (unsupportedProps.has(name) && isRequested(unsupportedProps.get(name), value))
      throw new Error(`Godot ScrollView ${name} is not implemented`);
  }
  if (props.contentOffset != null) {
    const offset = props.contentOffset;
    if (typeof offset !== "object" || Array.isArray(offset))
      throw new Error("Godot ScrollView contentOffset requires an object with finite x/y coordinates");
    const x = offset.x ?? 0;
    const y = offset.y ?? 0;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y))
      throw new Error("Godot ScrollView contentOffset requires finite x/y coordinates");
  }
  if (props.scrollEventThrottle != null &&
      (!Number.isFinite(props.scrollEventThrottle) || props.scrollEventThrottle < 0))
    throw new Error("Godot ScrollView scrollEventThrottle requires a finite non-negative number");

  const forwarded = {...props};
  // Original lists pass their own props through the ScrollView boundary.
  for (const name of listOnlyProps) delete forwarded[name];
  delete forwarded.isInvertedVirtualizedList;
  delete forwarded.onRefresh;
  delete forwarded.refreshing;
  return forwarded;
}
