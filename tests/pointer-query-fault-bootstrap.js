// Test-only injection around the one real SDK installation. Healthy calls still
// consult the pinned original EventTarget Maps through that SDK callback.
import {bootstrap} from "./event-target-bootstrap";

const installer = globalThis.godotInstallPointerListenerQuery;
if (typeof installer !== "function") throw Error("Query-fault probe requires the native installer");
let installations = 0, fault = null, rows = [], sequence = 0;
const interceptedInstaller = function(query) {
  if (installations !== 0 || typeof query !== "function") throw Error("Query-fault probe expects exactly one SDK installation");
  const result = installer(function(target, offset, isRootHandle) {
    const matched = fault != null && target === fault.targetref && offset === fault.offset && fault.remaining > 0;
    const row = {sequence: ++sequence, targetTag: target?.tag ?? null, rootHandle: isRootHandle === true, offset, matched,
      action: matched ? fault.mode : "delegate", label: matched ? fault.label : null, resultKind: null, result: null};
    rows.push(row);
    if (matched) {
      --fault.remaining;
      if (fault.mode === "throw") {
        row.resultKind = "throw";
        throw Error("GF pointer query deliberate fault: " + fault.label);
      }
      row.resultKind = "number"; row.result = 1;
      return 1;
    }
    const value = query(target, offset, isRootHandle);
    row.resultKind = typeof value; row.result = value;
    return value;
  });
  ++installations;
  // Retain only the already-installed wrapper, without leaving a replacement
  // installer available to other application code.
  globalThis.godotInstallPointerListenerQuery = installer;
  return result;
};
globalThis.godotInstallPointerListenerQuery = interceptedInstaller;

export const queryFaultControl = {
  setFault({targetref, offset, mode, remaining = 1, label}) {
    // Move interest uses offsets 1/25, Down 34/35 and Up 36/37 (bubble/capture).
    // A Move fault may repeat across a few samples to exercise repeated reports.
    if (targetref == null || typeof targetref.addEventListener !== "function" ||
      ![1, 25, 34, 35, 36, 37].includes(offset) || !["throw", "nonboolean"].includes(mode) || typeof label !== "string" ||
      !Number.isInteger(remaining) || remaining < 1 || remaining > ([1, 25].includes(offset) ? 4 : 1))
      throw Error("Query-fault configuration requires a real ref, a native pointer offset and explicit failures");
    fault = {targetref, offset, mode, remaining, label};
    return {targetTag: targetref.tag, offset, mode, remaining, label};
  },
  clearFault() { fault = null; return true; },
  clearObservations() { rows = []; return true; },
  snapshot() {
    return {installations, restoredInstaller: globalThis.godotInstallPointerListenerQuery === installer,
      rows: [...rows], fault: fault == null ? null : {targetTag: fault.targetref.tag, offset: fault.offset,
        mode: fault.mode, remaining: fault.remaining, label: fault.label},
      scope: {realSDKInstallation: true, delegatesOriginalQuery: true, listenerRegistryMirrored: false, publicAPIAdded: false}};
  },
};
export {bootstrap};
