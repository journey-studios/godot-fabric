// Observe the one real SDK installation. This test owns no listener registry;
// healthy calls, including the root-handle discriminator, delegate unchanged.
import {bootstrap} from "./event-target-bootstrap";
import * as Flags from "../node_modules/react-native/src/private/featureflags/ReactNativeFeatureFlags";

export const interestMode = __POINTER_DOCUMENT_INTEREST_MODE__;
if (!["original", "current"].includes(interestMode)) throw Error("Invalid document interest mode");
const installer = globalThis.godotInstallPointerListenerQuery;
if (typeof installer !== "function") throw Error("Document probe requires the native query installer");
const roots = new Map();
let installations = 0, rows = [], sequence = 0, fault = null;
globalThis.godotInstallPointerListenerQuery = function(query) {
  if (installations !== 0 || typeof query !== "function") throw Error("Document probe expects one real SDK installation");
  const result = installer(function(candidate, offset, isRootHandle) {
    const root = isRootHandle === true ? roots.get(candidate?.publicInstance) : null;
    const before = root?.readLeaf() ?? null;
    const matched = fault != null && isRootHandle === true && candidate?.publicInstance === fault.element &&
      offset === fault.offset && fault.remaining > 0;
    const row = {sequence: ++sequence, isRootHandle: isRootHandle === true, offset,
      name: root?.name ?? null, candidateTag: isRootHandle === true ? candidate?.publicInstance?.__nativeTag ?? null : candidate?.tag ?? null,
      expectedHandle: root == null ? null : candidate === root.handle,
      before, after: null, matched, action: matched ? fault.mode : "delegate", resultKind: null, result: null};
    rows.push(row);
    if (matched) {
      --fault.remaining;
      row.after = root?.readLeaf() ?? null;
      if (fault.mode === "throw") {
        row.resultKind = "throw";
        throw Error("GF document query deliberate fault: " + fault.label);
      }
      row.resultKind = "number"; row.result = 1;
      return 1;
    }
    const value = query(candidate, offset, isRootHandle);
    row.resultKind = typeof value; row.result = value;
    row.after = root?.readLeaf() ?? null;
    return value;
  });
  ++installations;
  globalThis.godotInstallPointerListenerQuery = installer;
  return result;
};
export const documentQueryControl = {
  currentFlags() { return {imperative: Flags.enableImperativeEvents(), nativeDispatch: Flags.enableNativeEventTargetEventDispatching()}; },
  bind(name, element, handle, readLeaf) {
    if (element == null || handle == null || typeof readLeaf !== "function") throw Error("Actual root identities required");
    roots.set(element, {name, handle, readLeaf});
    return true;
  },
  clearObservations() { rows = []; return true; },
  setFault(element, offset, mode = "throw", label = "root34") {
    // Down interest uses offsets 34/35 and Up interest 36/37 (bubble/capture).
    if (!roots.has(element) || ![34, 35, 36, 37].includes(offset) || !["throw", "nonboolean"].includes(mode))
      throw Error("Root fault requires an actual bound documentElement and native offset");
    fault = {element, offset, mode, label, remaining: 1};
    return {offset, mode, label, remaining: 1};
  },
  clearFault() { fault = null; return true; },
  snapshot() {
    return {installations, restoredInstaller: globalThis.godotInstallPointerListenerQuery === installer, rows: [...rows],
      fault: fault == null ? null : {offset: fault.offset, mode: fault.mode, label: fault.label, remaining: fault.remaining},
      scope: {realSDKInstallation: true, forwardsRootDiscriminator: true, listenerRegistryMirrored: false}};
  },
};
export {bootstrap};
