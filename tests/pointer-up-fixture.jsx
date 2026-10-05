import {resolverFaultControl} from "./pointer-resolver-fault-bootstrap";
import "./pointer-query-fault-fixture";

// Reuse the actual two-root View scene and single real SDK observer. The old
// fixture still defaults to Down; only this separate application selects Up.
const base = globalThis.QueryFaultProbe;
if (base == null) throw Error("PointerUp probe requires the real query-fault scene");
globalThis.PointerUpProbe = {
  capability: base.capability, arm: base.arm,
  configure(name, capture = false) { return base.configure(name, capture, "pointerup"); },
  publicControl(name) { return base.publicControl(name, "pointerup"); },
  // One-shot faults on the actual View ref at Up offsets 36/37.
  fault: base.fault, clearFault: base.clearFault,
  // One-shot getter on the actual View canonical.publicInstance slot, read by
  // the native component lookup before it can enter the SDK query.
  armResolverFault(name) {
    const capability = base.capability(name);
    if (!capability.original || !capability.connected) throw Error("Resolver target must be a real original connected View ref");
    return resolverFaultControl.arm(capability.targetTag);
  },
  snapshot() {
    return {...base.snapshot(), resolver: resolverFaultControl.snapshot(), scope: {actualNativeInput: true, realOriginalViewRefs: true,
      originalFlagsEnabled: true, experimentalNativeDispatch: true, realSDKQueryWrappedOnlyForTest: true,
      listenerRegistryMirrored: false, manualDispatchIsOnlyInstallationControl: true,
      pointerUpOnlyViewScope: true, documentInterestCertified: false, publicDefaultEnabled: false, hardwareCertified: false}};
  },
};
