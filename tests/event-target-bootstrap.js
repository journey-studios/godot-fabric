// Test-only bootstrap. This module MUST evaluate before any React Native node
// class: ReadOnlyNode chooses its base class when its module is evaluated.
import "../src/initialize";
import * as Flags from "../node_modules/react-native/src/private/featureflags/ReactNativeFeatureFlags";
import {polyfillGlobal} from "react-native/Libraries/Utilities/PolyfillFunctions";

const mode = __EVENT_TARGET_PROBE_MODE__;
if (!["disabled", "imperative-only", "internal-only", "enabled"].includes(mode))
  throw new Error("Unknown isolated EventTarget probe mode: " + mode);
const overrides = {
  enableImperativeEvents: () => mode === "enabled" || mode === "imperative-only",
  enableNativeEventTargetEventDispatching: () => mode === "enabled" || mode === "internal-only",
};
// The disabled bundle is also the original-default and late-override control.
// The other configurations override exactly once, before any flag is read.
if (mode !== "disabled") Flags.override(overrides);

// Install the same constructors as upstream setUpDOM/setUpXHR, without pulling
// in mobile networking setup or changing the public application bootstrap.
polyfillGlobal("Event", () => require("../node_modules/react-native/src/private/webapis/dom/events/Event").default);
polyfillGlobal("EventTarget", () => require("../node_modules/react-native/src/private/webapis/dom/events/EventTarget").default);
polyfillGlobal("CustomEvent", () => require("../node_modules/react-native/src/private/webapis/dom/events/CustomEvent").default);
polyfillGlobal("AbortController", () => require("../node_modules/react-native/src/private/webapis/dom/abort-api/AbortController").AbortController);
polyfillGlobal("AbortSignal", () => require("../node_modules/react-native/src/private/webapis/dom/abort-api/AbortSignal").AbortSignal_public);
globalThis.RN$isNativeEventTargetEventDispatchingEnabled = () => Flags.enableNativeEventTargetEventDispatching();

export const bootstrap = {
  mode,
  flags: {
    imperative: Flags.enableImperativeEvents(),
    nativeDispatch: Flags.enableNativeEventTargetEventDispatching(),
  },
  rejectedOverride() {
    try { Flags.override(overrides); return null; }
    catch (error) { return error.message; }
  },
};
