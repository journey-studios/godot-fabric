import "./pointer-query-fault-fixture";

// Reuse the actual two-root View scene and single real SDK observer. The old
// fixture still defaults to Down; only this separate application selects Up.
const base = globalThis.QueryFaultProbe;
if (base == null) throw Error("PointerUp probe requires the real query-fault scene");
globalThis.PointerUpProbe = {
  capability: base.capability, arm: base.arm,
  configure(name, capture = false) { return base.configure(name, capture, "pointerup"); },
  publicControl(name) { return base.publicControl(name, "pointerup"); },
  snapshot() {
    return {...base.snapshot(), scope: {actualNativeInput: true, realOriginalViewRefs: true,
      originalFlagsEnabled: true, experimentalNativeDispatch: true, realSDKQueryWrappedOnlyForTest: true,
      listenerRegistryMirrored: false, manualDispatchIsOnlyInstallationControl: true,
      pointerUpOnlyViewScope: true, documentInterestCertified: false, publicDefaultEnabled: false, hardwareCertified: false}};
  },
};
