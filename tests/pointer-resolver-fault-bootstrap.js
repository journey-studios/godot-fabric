// Reuse the executed SDK observer; this probe installs no second callback and
// modifies only one own canonical.publicInstance descriptor for one native Down.
import {queryFaultControl} from "./pointer-query-fault-bootstrap";
import OriginalEventTarget from "../node_modules/react-native/src/private/webapis/dom/events/EventTarget";
import ReactNativeElement from "../node_modules/react-native/src/private/webapis/dom/nodes/ReactNativeElement";

const cause = "GF pointer resolver deliberate fault: canonical.publicInstance";
let fault = null;
function exactDescriptor(actual, expected) {
  return actual != null && Object.prototype.hasOwnProperty.call(actual, "value") &&
    actual.value === expected.value && actual.writable === expected.writable &&
    actual.enumerable === expected.enumerable && actual.configurable === expected.configurable;
}
export const resolverFaultControl = {
  arm(tag) {
    if (fault != null) throw Error("Resolver probe arms exactly one getter fault");
    const handle = godotInstanceHandle(tag), canonical = handle?.stateNode?.canonical;
    const descriptor = canonical == null ? null : Object.getOwnPropertyDescriptor(canonical, "publicInstance");
    if (descriptor == null || !Object.prototype.hasOwnProperty.call(descriptor, "value") || !descriptor.configurable ||
      !(descriptor.value instanceof OriginalEventTarget) || !(descriptor.value instanceof ReactNativeElement) ||
      descriptor.value.tag !== tag || !descriptor.value.isConnected)
      throw Error("Resolver fault needs the actual connected Fiber canonical's configurable original public ref descriptor");
    fault = {tag, canonical, descriptor, remaining: 1, attempts: []};
    const getter = function() {
      // Restore BEFORE throwing so following TouchStart/terminal/React work can
      // read the exact original descriptor. No native API or listener runs here.
      --fault.remaining;
      Object.defineProperty(canonical, "publicInstance", descriptor);
      fault.attempts.push({ownerMatches: this === canonical, remaining: fault.remaining,
        descriptorRestoredBeforeThrow: exactDescriptor(Object.getOwnPropertyDescriptor(canonical, "publicInstance"), descriptor),
        sdkEntriesBeforeThrow: queryFaultControl.snapshot().rows.length, cause});
      throw Error(cause);
    };
    Object.defineProperty(canonical, "publicInstance", {get: getter, configurable: descriptor.configurable, enumerable: descriptor.enumerable});
    return {targetTag: tag, actualFiber: handle != null && handle.stateNode != null,
      actualCanonical: canonical === handle.stateNode.canonical, descriptorOwnData: true,
      originalRef: descriptor.value instanceof OriginalEventTarget && descriptor.value instanceof ReactNativeElement,
      connected: descriptor.value.isConnected, valueTagMatches: descriptor.value.tag === tag,
      descriptorConfigurable: descriptor.configurable, cause, remaining: 1};
  },
  snapshot() {
    if (fault == null) return {armed: false, remaining: null, attempts: [], descriptorRestored: null};
    const actual = Object.getOwnPropertyDescriptor(fault.canonical, "publicInstance");
    return {targetTag: fault.tag, armed: !exactDescriptor(actual, fault.descriptor), remaining: fault.remaining,
      attempts: [...fault.attempts], descriptorRestored: exactDescriptor(actual, fault.descriptor), cause,
      descriptor: {kind: Object.prototype.hasOwnProperty.call(actual, "value") ? "data" : "accessor",
        valueMatches: actual.value === fault.descriptor.value, writableMatches: actual.writable === fault.descriptor.writable,
        enumerableMatches: actual.enumerable === fault.descriptor.enumerable, configurableMatches: actual.configurable === fault.descriptor.configurable}};
  },
};
