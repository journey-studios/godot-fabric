import "./pointer-query-fault-fixture";
import * as Flags from "../node_modules/react-native/src/private/featureflags/ReactNativeFeatureFlags";

// Reuse the actual two-root View scene and single real SDK observer. The old
// fixture still defaults to Down; only this separate application selects Move.
const base = globalThis.QueryFaultProbe;
if (base == null) throw Error("PointerMove probe requires the real query-fault scene");
globalThis.PointerMoveProbe = {
  capability: base.capability, arm: base.arm, fault: base.fault, clearFault: base.clearFault,
  configure(name, capture = false, where = "only") { return base.configure(name, capture, "pointermove", where); },
  publicControl(name) { return base.publicControl(name, "pointermove"); },
  snapshot() {
    // Coalesced moves use RN's Continuous category: Default priority under the
    // pinned priority mapping, Continuous only when that native flag is fixed.
    return {...base.snapshot(), continuousPriority: nativeFabricUIManager.unstable_ContinuousEventPriority,
      priorityMappingFixed: Flags.fixMappingOfEventPrioritiesBetweenFabricAndReact(), scope: {actualNativeInput: true, realOriginalViewRefs: true,
      originalFlagsEnabled: true, experimentalNativeDispatch: true, realSDKQueryWrappedOnlyForTest: true,
      listenerRegistryMirrored: false, manualDispatchIsOnlyInstallationControl: true,
      pointerMoveOnlyViewScope: true, documentInterestCertified: false, hoverCertified: false,
      publicDefaultEnabled: false, hardwareCertified: false}};
  },
};
