// Generated correction for the pinned RN renderer; original files stay intact.
import {createHash} from "node:crypto";

const originalHash = "6f53e433d921c0090d0610c5a0091d0b3acb53d13f5d48c32d1e40bfac4bdfda";
const before = `getInstanceFromNode$1 = function (node) {
  return null != node.canonical && null != node.canonical.internalInstanceHandle
    ? node.canonical.internalInstanceHandle
    : node;
};`;
const after = `getInstanceFromNode$1 = function (node) {
  if ("number" === typeof node)
    return ReactNativePrivateInterface.getInternalInstanceHandleFromNativeTag(node);
  return null != node.canonical && null != node.canonical.internalInstanceHandle
    ? node.canonical.internalInstanceHandle
    : node;
};`;
const dispatchBefore = `function dispatchEvent(target, topLevelType, nativeEvent) {
  var eventTarget = null;
  if (null != target) {
    var stateNode = target.stateNode;
    null != stateNode && (eventTarget = getPublicInstance(stateNode));
  }
  batchedUpdates$1(function () {
    var event = { eventName: topLevelType, nativeEvent: nativeEvent };
    ReactNativePrivateInterface.RawEventEmitter.emit(topLevelType, event);
    ReactNativePrivateInterface.RawEventEmitter.emit("*", event);
    event = eventTarget;`;
const dispatchAfter = `var nativeEventTargetDispatchEnabledForGodot =
  "function" === typeof RN$isNativeEventTargetEventDispatchingEnabled &&
  RN$isNativeEventTargetEventDispatchingEnabled();
function dispatchEvent(target, topLevelType, nativeEvent) {
  var eventTarget = null;
  if (null != target) {
    var stateNode = target.stateNode;
    null != stateNode && (eventTarget = getPublicInstance(stateNode));
  }
  batchedUpdates$1(function () {
    var event = { eventName: topLevelType, nativeEvent: nativeEvent };
    ReactNativePrivateInterface.RawEventEmitter.emit(topLevelType, event);
    ReactNativePrivateInterface.RawEventEmitter.emit("*", event);
    if (nativeEventTargetDispatchEnabledForGodot) {
      ReactNativePrivateInterface.dispatchNativeEvent(eventTarget, topLevelType, nativeEvent);
      return;
    }
    event = eventTarget;`;

export function renderRendererTagOverlay(source, mode = "current", {nativeDispatchMode = "original"} = {}) {
  if (mode !== "current" && mode !== "original")
    throw new Error("E_RENDERER_TAG_OVERLAY_MODE: expected current or original");
  if (nativeDispatchMode !== "original" && nativeDispatchMode !== "experimental")
    throw new Error("E_RENDERER_NATIVE_DISPATCH_MODE: expected original or experimental");
  if (typeof source !== "string")
    throw new Error("E_RENDERER_TAG_OVERLAY_INPUT: expected pinned renderer source");
  // Validate cardinality independently of the pin, including original controls.
  if (source.split(before).length !== 2)
    throw new Error("E_RENDERER_TAG_OVERLAY_SPAN: expected one pinned instance-lookup span");
  if (source.split(dispatchBefore).length !== 2)
    throw new Error("E_RENDERER_NATIVE_DISPATCH_SPAN: expected one pinned batched-dispatch span");
  if (createHash("sha256").update(source).digest("hex") !== originalHash)
    throw new Error("E_RENDERER_TAG_OVERLAY_INPUT: RN 0.87.1 ReactFabric-prod hash mismatch");
  const corrected = mode === "original" ? source : source.replace(before, after);
  // The default produces exactly the already-delivered tag correction. The
  // isolated experiment captures the original flag once before native input.
  return nativeDispatchMode === "original" ? corrected : corrected.replace(dispatchBefore, dispatchAfter);
}
