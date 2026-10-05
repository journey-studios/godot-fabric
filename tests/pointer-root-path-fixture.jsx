import "./pointer-query-fault-fixture";

// Reuse the actual two-root View scene and the single real SDK observer. Hover
// listeners sit on the hit target or on the target's original Document.
const base = globalThis.QueryFaultProbe;
if (base == null) throw Error("PointerRootPath probe requires the real query-fault scene");
const hoverTypes = ["pointerover", "pointerenter", "pointerout", "pointerleave"];
globalThis.PointerRootPathProbe = {
  capability: base.capability, arm: base.arm,
  configure(name, capture, where, types = hoverTypes) {
    if (!types.every(type => hoverTypes.includes(type))) throw Error("Root-path probe registers only hover types");
    return base.configure(name, capture, types, where);
  },
  snapshot() {
    // RN resolves an empty point inside a root to the root, which stays in the
    // hover path; events targeted at a root never reach JS.
    return {...base.snapshot(), scope: {actualNativeInput: true, realOriginalViewRefs: true,
      originalFlagsEnabled: true, experimentalNativeDispatch: true, realSDKQueryWrappedOnlyForTest: true,
      listenerRegistryMirrored: false, documentCaptureHoverOnly: true, documentHoverCertified: false,
      publicDefaultEnabled: false, hardwareCertified: false}};
  },
};
