import "./pointer-query-fault-fixture";

// Reuse the actual two-root View scene and single real SDK observer. Only this
// separate application selects the hover types, on the target or its parent.
const base = globalThis.QueryFaultProbe;
if (base == null) throw Error("PointerHover probe requires the real query-fault scene");
const hoverTypes = ["pointerover", "pointerenter", "pointerout", "pointerleave"];
globalThis.PointerHoverProbe = {
  capability: base.capability, arm: base.arm, fault: base.fault, clearFault: base.clearFault,
  configure(name, capture = false, where = "only") { return base.configure(name, capture, hoverTypes, where); },
  publicControl(name, type) {
    if (!hoverTypes.includes(type)) throw Error("Hover control requires a hover type");
    return base.publicControl(name, type);
  },
  snapshot() {
    // RN's hover tracker dispatches every hover event at Discrete priority.
    return {...base.snapshot(), scope: {actualNativeInput: true, realOriginalViewRefs: true,
      originalFlagsEnabled: true, experimentalNativeDispatch: true, realSDKQueryWrappedOnlyForTest: true,
      listenerRegistryMirrored: false, manualDispatchIsOnlyInstallationControl: true,
      pointerHoverOnlyViewScope: true, documentInterestCertified: false,
      publicDefaultEnabled: false, hardwareCertified: false}};
  },
};
