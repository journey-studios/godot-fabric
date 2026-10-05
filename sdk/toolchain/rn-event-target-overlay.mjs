// Generated correction for the pinned RN implementation; original files stay intact.
import {createHash} from "node:crypto";

const originalHash = "61c16160ee0eb896f670154fb6d16c7f146e5c78c94b857533a4dd917d2a4171";
const before = `const EVENT_DISPATCH_PARENT_CACHE_KEY: symbol = Symbol(
  'EventTarget[dispatch parent cache]',
);

export function getEventTargetParent(target: EventTarget): EventTarget | null {
  // The slot is \`undefined\` until populated; a populated slot may hold
  // \`null\` (no parent), so check against \`undefined\` rather than nullishness.
  // $FlowExpectedError[prop-missing] symbol-keyed slot
  const cached: EventTarget | null | void =
    // $FlowExpectedError[prop-missing] symbol-keyed slot
    target[EVENT_DISPATCH_PARENT_CACHE_KEY];
  if (cached !== undefined) {
    return cached;
  }
  // $FlowExpectedError[prop-missing] symbol-keyed method
  const parent: EventTarget | null = target[EVENT_TARGET_GET_THE_PARENT_KEY]();
  // $FlowExpectedError[prop-missing] symbol-keyed slot
  target[EVENT_DISPATCH_PARENT_CACHE_KEY] = parent;
  return parent;
}`;
const after = `export function getEventTargetParent(target: EventTarget): EventTarget | null {
  // Godot: construct each dispatch path from current ancestry. The original
  // dispatcher snapshots its complete path before invoking any listener.
  // $FlowExpectedError[prop-missing] symbol-keyed method
  return target[EVENT_TARGET_GET_THE_PARENT_KEY]();
}`;

export function renderEventTargetParentOverlay(source, mode = "current") {
  if (mode !== "current" && mode !== "original")
    throw new Error("E_EVENT_TARGET_OVERLAY_MODE: expected current or original");
  if (createHash("sha256").update(source).digest("hex") !== originalHash)
    throw new Error("E_EVENT_TARGET_OVERLAY_INPUT: RN 0.87.1 EventTargetInternals hash mismatch");
  if (mode === "original") return source;
  if (source.split(before).length !== 2)
    throw new Error("E_EVENT_TARGET_OVERLAY_SPAN: expected one pinned parent-cache span");
  return source.replace(before, after);
}
