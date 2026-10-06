import React, { useRef, useLayoutEffect, useCallback } from "react";
import { register } from "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry";
import flattenStyle from "react-native/Libraries/StyleSheet/flattenStyle";
import { View, controlViewConfig } from "./components";
import { getNodeFromPublicInstance } from "./private-interface";
import { findNodeHandle } from "./renderer-proxy";
import { listOnlyProps } from "./list-props.mjs";

const scrollViewConfig = {
  uiViewClassName: "ScrollView",
  validAttributes: {
    ...Object.fromEntries(
      Object.entries(controlViewConfig.validAttributes).filter(
        ([name]) =>
          /^(onTouch|onResponder|onStartShould|onMoveShould)/.test(name) ||
          ["style", "testID", "pointerEvents", "onLayout"].includes(name),
      ),
    ),
    horizontal: true,
    scrollEnabled: true,
    contentOffset: true,
    scrollEventThrottle: true,
    onScroll: true,
    onScrollBeginDrag: true,
    onScrollEndDrag: true,
    onMomentumScrollBegin: true,
    onMomentumScrollEnd: true,
  },
  bubblingEventTypes: Object.fromEntries(
    Object.entries(controlViewConfig.bubblingEventTypes).filter(([name]) =>
      name.startsWith("topTouch"),
    ),
  ),
  directEventTypes: {
    topLayout: { registrationName: "onLayout" },
    topScroll: { registrationName: "onScroll" },
    topScrollBeginDrag: { registrationName: "onScrollBeginDrag" },
    topScrollEndDrag: { registrationName: "onScrollEndDrag" },
    topMomentumScrollBegin: { registrationName: "onMomentumScrollBegin" },
    topMomentumScrollEnd: { registrationName: "onMomentumScrollEnd" },
  },
};
const NativeScroll = register("ScrollView", () => scrollViewConfig);

function command(instance, name, args = []) {
  const node = instance && getNodeFromPublicInstance(instance);
  if (node) nativeFabricUIManager.dispatchCommand(node, name, args);
}
function point(event) {
  return [event.nativeEvent.pageX, event.nativeEvent.pageY];
}

function unsupported(feature) {
  throw new Error(`Godot ScrollView ${feature} is not implemented`);
}

// Godot's platform subset of ScrollView. Fabric ShadowNode, immutable state,
// Yoga layout, events and responder negotiation are all original upstream code.
export function ScrollView({
  ref,
  children,
  horizontal = false,
  scrollEnabled = true,
  contentOffset,
  contentContainerStyle,
  onContentSizeChange,
  onTouchStartCapture,
  onResponderReject,
  style,
  // A VirtualizedList always passes these. Sticky headers, refresh,
  // content-position maintenance and scroll indicators fail when requested.
  // invertStickyHeaders only applies to sticky headers, isInvertedVirtualizedList
  // only moves Android's scroll bar and removeClippedSubviews is an
  // optimization hint: the ScrollContainer already clips its content.
  stickyHeaderIndices,
  invertStickyHeaders: _invertStickyHeaders,
  maintainVisibleContentPosition,
  refreshControl,
  isInvertedVirtualizedList: _isInvertedVirtualizedList,
  removeClippedSubviews: _removeClippedSubviews,
  showsHorizontalScrollIndicator,
  showsVerticalScrollIndicator,
  ...props
}) {
  if (stickyHeaderIndices != null && stickyHeaderIndices.length > 0) {
    unsupported("stickyHeaderIndices");
  }
  if (maintainVisibleContentPosition != null) {
    unsupported("maintainVisibleContentPosition");
  }
  if (refreshControl != null) {
    unsupported("refreshControl");
  }
  if (showsHorizontalScrollIndicator === true || showsVerticalScrollIndicator === true) {
    throw new Error("Godot ScrollView does not show scroll indicators");
  }
  for (const name of Object.keys(props)) {
    if (listOnlyProps.has(name)) {
      delete props[name];
      continue;
    }
    if (
      !Object.hasOwn(scrollViewConfig.validAttributes, name) ||
      [
        "onMoveShouldSetResponderCapture",
        "onResponderGrant",
        "onResponderMove",
        "onResponderTerminationRequest",
        "onResponderRelease",
        "onResponderTerminate",
      ].includes(name)
    )
      throw new Error(`Godot ScrollView ${name} is not implemented`);
  }
  if (
    contentOffset &&
    (!Number.isFinite(contentOffset.x) || !Number.isFinite(contentOffset.y))
  )
    throw new Error("ScrollView contentOffset requires finite x/y coordinates");
  const viewportStyle = flattenStyle(style) ?? {};
  const contentStyle = flattenStyle(contentContainerStyle) ?? {};
  if (Object.keys(viewportStyle).some((name) => name.startsWith("padding")))
    throw new Error("Use contentContainerStyle for ScrollView padding");
  if (
    Object.keys(contentStyle).some(
      (name) =>
        name.startsWith("margin") ||
        ["position", "top", "left", "bottom", "right"].includes(name),
    )
  )
    throw new Error(
      "ScrollView content container margins and positioning are not implemented",
    );
  const native = useRef(null);
  const content = useRef(null);
  const origin = useRef(null);
  const pendingGrant = useRef(false);
  const attach = useCallback(
    (instance) => {
      native.current = instance;
      if (instance) {
        // RN's ScrollView augments its native instance with these methods
        // (createRefForwarder in ScrollView.js); scrollTo and scrollToEnd
        // already come from the platform's public instance.
        Object.assign(instance, {
          getScrollResponder: () => instance,
          getScrollableNode: () => findNodeHandle(instance),
          getNativeScrollRef: () => instance,
          getInnerViewNode: () => findNodeHandle(content.current),
          getInnerViewRef: () => content.current,
          flashScrollIndicators() {
            throw new Error("Godot ScrollView does not show scroll indicators");
          },
          scrollResponderZoomTo() {
            unsupported("zoom");
          },
          scrollResponderScrollNativeHandleToKeyboard() {
            unsupported("keyboard scrolling");
          },
        });
      }
      let cleanup;
      if (typeof ref === "function") cleanup = ref(instance);
      else if (ref) ref.current = instance;
      return () => {
        native.current = null;
        if (typeof cleanup === "function") cleanup();
        else if (typeof ref === "function") ref(null);
        else if (ref) ref.current = null;
      };
    },
    [ref],
  );
  useLayoutEffect(() => {
    if (!scrollEnabled) command(native.current, "scrollDragEnd");
    return () => command(native.current, "scrollDragEnd");
  }, [scrollEnabled]);
  return (
    <NativeScroll
      {...props}
      ref={attach}
      horizontal={horizontal}
      scrollEnabled={scrollEnabled}
      contentOffset={contentOffset}
      style={{
        ...viewportStyle,
        overflow: "scroll",
        flexDirection: horizontal ? "row" : "column",
      }}
      onTouchStartCapture={(event) => {
        origin.current =
          event.nativeEvent.touches.length === 1 ? point(event) : null;
        onTouchStartCapture?.(event);
      }}
      onMoveShouldSetResponderCapture={(event) => {
        if (
          !scrollEnabled ||
          !origin.current ||
          event.nativeEvent.touches.length !== 1
        )
          return false;
        const current = point(event);
        const axis = horizontal ? 0 : 1;
        const delta = Math.abs(current[axis] - origin.current[axis]);
        return (
          delta > 8 &&
          delta > Math.abs(current[1 - axis] - origin.current[1 - axis])
        );
      }}
      onResponderGrant={() => {
        // Upstream calls Grant speculatively, before the child can reject.
        // Only the following responder Move proves that transfer succeeded.
        pendingGrant.current = true;
        return true;
      }}
      onResponderReject={(event) => {
        pendingGrant.current = false;
        onResponderReject?.(event);
      }}
      onResponderMove={(event) => {
        if (event.nativeEvent.touches.length !== 1) return;
        if (pendingGrant.current) {
          pendingGrant.current = false;
          command(
            native.current,
            "scrollDragStart",
            origin.current ?? point(event),
          );
        }
        command(native.current, "scrollDragTo", point(event));
      }}
      onResponderTerminationRequest={() => true}
      onResponderRelease={() => command(native.current, "scrollDragEnd")}
      onResponderTerminate={() => command(native.current, "scrollDragEnd")}
    >
      <View
        ref={content}
        testID={props.testID ? `${props.testID}-content` : undefined}
        pointerEvents="box-none"
        style={{
          ...contentStyle,
          flexShrink: 0,
          flexGrow: 1,
          flexDirection: horizontal ? "row" : "column",
        }}
        onLayout={
          onContentSizeChange
            ? (event) => {
                const { width, height } = event.nativeEvent.layout;
                onContentSizeChange(width, height);
              }
            : undefined
        }
      >
        {children}
      </View>
    </NativeScroll>
  );
}
