import * as Registry from "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry";
import {
  create,
  diff,
} from "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload";
import RawEventEmitter from "react-native/Libraries/Core/RawEventEmitter";

// This is the host-platform seam, not a replacement reconciler. Attribute
// diffing, event registry and the renderer itself remain upstream React Native.
function currentNode(handle) {
  return handle.stateNode?.node ?? null;
}
function createPublicInstance(tag, viewConfig, handle) {
  return {
    tag,
    handle,
    measure(callback) {
      nativeFabricUIManager.measure(currentNode(handle), callback);
    },
    measureInWindow(callback) {
      nativeFabricUIManager.measureInWindow(currentNode(handle), callback);
    },
    getNativeMetrics() {
      return godotMetrics(tag);
    },
    setTextAndSelection(eventCount, text, start = -1, end = start) {
      if (
        !Number.isInteger(eventCount) ||
        eventCount < 0 ||
        !(text === null || typeof text === "string") ||
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < -1 ||
        end < -1
      )
        throw new Error(
          "setTextAndSelection requires an edit count, string/null and integer offsets",
        );
      const node = currentNode(handle);
      if (node)
        nativeFabricUIManager.dispatchCommand(node, "setTextAndSelection", [
          eventCount,
          text,
          start,
          end,
        ]);
    },
    scrollTo({ x = 0, y = 0, animated = false } = {}) {
      if (animated || !Number.isFinite(x) || !Number.isFinite(y))
        throw new Error(
          "Godot scrollTo requires finite coordinates and animated: false",
        );
      const node = currentNode(handle);
      if (node) nativeFabricUIManager.dispatchCommand(node, "scrollTo", [x, y]);
    },
    scrollToEnd({ animated = false } = {}) {
      if (animated)
        throw new Error("Godot animated scrolling is not implemented");
      const node = currentNode(handle);
      if (node) nativeFabricUIManager.dispatchCommand(node, "scrollToEnd", []);
    },
    isFocused() {
      return godotMetrics(tag)?.focused ?? false;
    },
    focus() {
      godotFocus(tag, true);
    },
    blur() {
      godotFocus(tag, false);
    },
  };
}
export {
  Registry as ReactNativeViewConfigRegistry,
  RawEventEmitter,
  create as createAttributePayload,
  diff as diffAttributePayloads,
  createPublicInstance,
};
export const ReactFiberErrorDialog = {
  showErrorDialog() {
    return true;
  },
};
export function createPublicRootInstance(tag) {
  return { tag };
}
export function createPublicTextInstance() {
  throw new Error("Use the Godot Text component with a text prop");
}
export function getNativeTagFromPublicInstance(instance) {
  return instance.tag;
}
export function getNodeFromPublicInstance(instance) {
  return currentNode(instance.handle);
}
export function legacySendAccessibilityEvent() {
  throw new Error("Accessibility is not implemented in this validation");
}
export const UIManager = new Proxy(
  {},
  {
    get(_, name) {
      if (name === "measure")
        return (tag, callback) => {
          const metrics = godotMetrics(tag);
          if (metrics)
            callback(
              metrics.x,
              metrics.y,
              metrics.width,
              metrics.height,
              metrics.pageX,
              metrics.pageY,
            );
        };
      throw new Error(`Legacy UIManager.${String(name)} is not supported`);
    },
  },
);
