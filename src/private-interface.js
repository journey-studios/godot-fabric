import * as Registry from "react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry";
import {
  create,
  diff,
} from "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactNativeAttributePayload";
import RawEventEmitter from "react-native/Libraries/Core/RawEventEmitter";
import * as PublicInstances from "react-native/Libraries/ReactNative/ReactFabricPublicInstance/ReactFabricPublicInstance";
import NativeDOM from "../node_modules/react-native/src/private/webapis/dom/nodes/specs/NativeDOM";
import dispatchNativeEvent from "../node_modules/react-native/src/private/renderer/events/dispatchNativeEvent";

// This is the host-platform seam, not a replacement reconciler. Attribute
// diffing, event registry and the renderer itself remain upstream React Native.
function currentNode(handle) {
  return handle.stateNode?.node ?? null;
}
function createPublicInstance(tag, viewConfig, handle, ownerDocument) {
  const instance = PublicInstances.createPublicInstance(tag, viewConfig, handle, ownerDocument);
  // Existing Godot control commands augment the original RN element. Tree,
  // document, measurement and props APIs stay on the upstream prototype.
  return Object.assign(instance, {
    tag,
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
  });
}
export {
  Registry as ReactNativeViewConfigRegistry,
  RawEventEmitter,
  dispatchNativeEvent,
  create as createAttributePayload,
  diff as diffAttributePayloads,
  createPublicInstance,
};
export const ReactFiberErrorDialog = {
  showErrorDialog() {
    return true;
  },
};
export const createPublicRootInstance = PublicInstances.createPublicRootInstance;
export const createPublicTextInstance = PublicInstances.createPublicTextInstance;
export const getNativeTagFromPublicInstance = PublicInstances.getNativeTagFromPublicInstance;
export const getNodeFromPublicInstance = PublicInstances.getNodeFromPublicInstance;
export const getInternalInstanceHandleFromPublicInstance = PublicInstances.getInternalInstanceHandleFromPublicInstance;
export function getInternalInstanceHandleFromNativeTag(tag) {
  return godotInstanceHandle(tag);
}
export function legacySendAccessibilityEvent() {
  throw new Error("Accessibility is not implemented in this validation");
}
const legacyMethods = {
  dispatchViewManagerCommand(tag) {
    // Upstream dispatchCommand falls back here when a retired Fabric public
    // instance retains its native tag but no longer has a ShadowNode.
    if (!godotNode(tag)) return;
    throw new Error("Legacy UIManager.dispatchViewManagerCommand is not supported for a live node");
  },
  measure(tag, callback) {
    const node = godotNode(tag);
    if (node) NativeDOM.measure(node, callback);
  },
  measureInWindow(tag, callback) {
    const node = godotNode(tag);
    if (node) NativeDOM.measureInWindow(node, callback);
  },
  measureLayout(tag, ancestorTag, onFail, onSuccess) {
    const node = godotNode(tag);
    const ancestor = godotNode(ancestorTag);
    if (node && ancestor) NativeDOM.measureLayout(node, ancestor, onFail, onSuccess);
    else onFail?.();
  },
};
export const UIManager = new Proxy(legacyMethods, {
  get(target, name) {
    if (name in target) return target[name];
    throw new Error(`Legacy UIManager.${String(name)} is not supported`);
  },
});
