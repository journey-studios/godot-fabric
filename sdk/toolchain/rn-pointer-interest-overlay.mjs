// Generated query for pinned RN listener storage; original methods stay intact.
import {createHash} from "node:crypto";

const originalHash = "9ef4ad5d04667a3e786de5008f3a3da76920215b16b6605549db4f3b206b0e53";
const listenerStorageSpan = `function getListenersForPhase(
  eventTarget: EventTarget,
  isCapture: boolean,
): ?ListenersMap {
  return isCapture
    ? // $FlowExpectedError[prop-missing]
      eventTarget[CAPTURING_LISTENERS_KEY]
    : // $FlowExpectedError[prop-missing]
      eventTarget[BUBBLING_LISTENERS_KEY];
}`;
const pointerQueries = `// Godot: inspect original Down/Up/Move/hover registrations without invoking listeners.
function hasPointerListenerForGodot(target, capture, type) {
  if (target == null) return false;
  const listeners = getListenersForPhase(target, capture)?.get(type);
  if (listeners == null) return false;
  for (const listener of listeners.values()) {
    if (!listener.removed) return true;
  }
  return false;
}
export function hasPointerDownListenerForGodot(target, capture) {
  return hasPointerListenerForGodot(target, capture, 'pointerdown');
}
export function hasPointerUpListenerForGodot(target, capture) {
  return hasPointerListenerForGodot(target, capture, 'pointerup');
}
export function hasPointerMoveListenerForGodot(target, capture) {
  return hasPointerListenerForGodot(target, capture, 'pointermove');
}
export function hasPointerEnterListenerForGodot(target, capture) {
  return hasPointerListenerForGodot(target, capture, 'pointerenter');
}
export function hasPointerLeaveListenerForGodot(target, capture) {
  return hasPointerListenerForGodot(target, capture, 'pointerleave');
}
export function hasPointerOverListenerForGodot(target, capture) {
  return hasPointerListenerForGodot(target, capture, 'pointerover');
}
export function hasPointerOutListenerForGodot(target, capture) {
  return hasPointerListenerForGodot(target, capture, 'pointerout');
}
`;

export function renderPointerInterestOverlay(source, mode = "original") {
  if (mode !== "original" && mode !== "current")
    throw new Error("E_POINTER_INTEREST_OVERLAY_MODE: expected original or current");
  if (typeof source !== "string")
    throw new Error("E_POINTER_INTEREST_OVERLAY_INPUT: expected pinned EventTarget source");
  // Both modes validate the exact original storage helper and the entire input.
  if (source.split(listenerStorageSpan).length !== 2)
    throw new Error("E_POINTER_INTEREST_OVERLAY_SPAN: expected one pinned listener-storage span");
  if (createHash("sha256").update(source).digest("hex") !== originalHash)
    throw new Error("E_POINTER_INTEREST_OVERLAY_INPUT: RN 0.87.1 EventTarget hash mismatch");
  return mode === "original" ? source : source + "\n" + pointerQueries;
}
