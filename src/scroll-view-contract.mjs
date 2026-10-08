import {listOnlyProps} from "./list-props.mjs";

// These props change native scrolling behavior that the Godot adapter does
// not implement. Fail at the public boundary instead of letting RN's original
// component pass them to a host that silently ignores them.
const unsupportedProps = new Set([
  "alwaysBounceHorizontal",
  "alwaysBounceVertical",
  "automaticallyAdjustContentInsets",
  "automaticallyAdjustKeyboardInsets",
  "automaticallyAdjustsScrollIndicatorInsets",
  "bounces",
  "bouncesZoom",
  "canCancelContentTouches",
  "centerContent",
  "contentInset",
  "contentInsetAdjustmentBehavior",
  "decelerationRate",
  "disableIntervalMomentum",
  "disableScrollViewPanResponder",
  "directionalLockEnabled",
  "endFillColor",
  "experimental_endDraggingSensitivityMultiplier",
  "fadingEdgeLength",
  "indicatorStyle",
  "keyboardDismissMode",
  "keyboardShouldPersistTaps",
  "maintainVisibleContentPosition",
  "maximumZoomScale",
  "minimumZoomScale",
  "nestedScrollEnabled",
  "onScrollToTop",
  "overScrollMode",
  "pagingEnabled",
  "pinchGestureEnabled",
  "persistentScrollbar",
  "refreshControl",
  "scrollToOverflowEnabled",
  "scrollsToTop",
  "scrollIndicatorInsets",
  "snapToAlignment",
  "snapToInterval",
  "snapToOffsets",
  "snapToStart",
  "snapToEnd",
  "stickyHeaderIndices",
  "zoomScale",
]);

function isRequested(name, value) {
  if (value == null) return false;
  if (name === "stickyHeaderIndices" || name === "snapToOffsets")
    return !Array.isArray(value) || value.length > 0;
  return true;
}

export function prepareScrollViewProps(props) {
  if (props.onRefresh != null || props.refreshing === true)
    throw new Error("Godot ScrollView refreshControl is not implemented");

  for (const [name, value] of Object.entries(props)) {
    if (unsupportedProps.has(name) && isRequested(name, value))
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
