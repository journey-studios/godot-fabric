import "./pointer-document-fixture";
import * as Flags from "../node_modules/react-native/src/private/featureflags/ReactNativeFeatureFlags";

// Same original Documents, root-handle observer and physical native Controls.
// The separate application initializes eventType=pointermove; Down remains the
// default for every existing caller and the historical Document probe.
const base = globalThis.PointerDocumentProbe;
if (base == null) throw Error("Document Move probe requires the real Document scene");
globalThis.PointerDocumentMoveProbe = {
  bindRoot: base.bindRoot, capability: base.capability, arm: base.arm,
  manualDocument: base.manualDocument, manualElement: base.manualElement,
  resetAll: base.resetAll, removeFinal: base.removeFinal, noRefSnapshot: base.noRefSnapshot,
  rejectLateOverride: base.rejectLateOverride,
  configure(name, kind) { return base.configure(name, kind, "pointermove"); },
  snapshot() {
    // Moves are unique Continuous events: Default under the pinned priority
    // mapping, Continuous only when that native flag is fixed.
    return {...base.snapshot(), continuousPriority: nativeFabricUIManager.unstable_ContinuousEventPriority,
      priorityMappingFixed: Flags.fixMappingOfEventPrioritiesBetweenFabricAndReact(),
      scope: {actualNativeInput: true, realOriginalDocuments: true,
        realSDKQueryObservedOnlyForTest: true, listenerRegistryMirrored: false,
        manualDispatchIsOnlyInstallationControl: true, publicDefaultEnabled: false, hardwareCertified: false}};
  },
};
