import "./pointer-document-fixture";

// Same original Documents, root-handle observer and physical native Controls.
// The separate application initializes eventType=pointerhover, registering
// every Document listener for over, enter, out and leave.
const base = globalThis.PointerDocumentProbe;
if (base == null) throw Error("Document hover probe requires the real Document scene");
globalThis.PointerDocumentHoverProbe = {
  bindRoot: base.bindRoot, capability: base.capability, arm: base.arm,
  manualDocument: base.manualDocument, manualElement: base.manualElement,
  resetAll: base.resetAll, removeFinal: base.removeFinal, noRefSnapshot: base.noRefSnapshot,
  rejectLateOverride: base.rejectLateOverride,
  configure(name, kind) { return base.configure(name, kind, "pointerhover"); },
  snapshot() {
    // RN's hover tracker dispatches every hover event at Discrete priority.
    return {...base.snapshot(), scope: {actualNativeInput: true, realOriginalDocuments: true,
      realSDKQueryObservedOnlyForTest: true, listenerRegistryMirrored: false,
      manualDispatchIsOnlyInstallationControl: true, publicDefaultEnabled: false, hardwareCertified: false}};
  },
};
