import "./pointer-document-fixture";

// Same original Documents, root-handle observer and physical native Controls.
// The separate application initializes eventType=pointerup; Down remains the
// default for every existing caller and the historical Document probe.
const base = globalThis.PointerDocumentProbe;
if (base == null) throw Error("Document Up probe requires the real Document scene");
globalThis.PointerDocumentUpProbe = {
  bindRoot: base.bindRoot, capability: base.capability, arm: base.arm,
  manualDocument: base.manualDocument, manualElement: base.manualElement,
  resetAll: base.resetAll, removeFinal: base.removeFinal, noRefSnapshot: base.noRefSnapshot,
  rejectLateOverride: base.rejectLateOverride,
  signal: base.registeredSignal,
  abort(name) { base.abortRegistered(name); return base.registeredSignal(name); },
  configure(name, kind) { return base.configure(name, kind, "pointerup"); },
  // Retained OldDoc/OldRoot listeners keep their original Up registration on
  // the retired root objects; the replacement root starts with empty Maps.
  rerender: base.rerender, inspectIdentity: base.inspectIdentity, inspectRetained: base.inspectRetained,
  retainRoot(name) { return base.retainRoot(name, "pointerup"); },
  manualRetained(key) { return base.manualRetained(key, "pointerup"); },
  snapshot() {
    return {...base.snapshot(), scope: {actualNativeInput: true, realOriginalDocuments: true,
      realSDKQueryObservedOnlyForTest: true, listenerRegistryMirrored: false,
      manualDispatchIsOnlyInstallationControl: true, publicDefaultEnabled: false, hardwareCertified: false}};
  },
};
