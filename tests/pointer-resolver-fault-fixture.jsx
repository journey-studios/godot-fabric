import {resolverFaultControl} from "./pointer-resolver-fault-bootstrap";
// Reuse its actual two-root View/ref scene and original event/Raw assertions in
// a separate Hermes application. The existing probe and its registrations stay
// unchanged; this bundle mounts its PointerQueryFaultProbe component.
import "./pointer-query-fault-fixture";

const base = globalThis.QueryFaultProbe;
if (base == null) throw Error("Resolver probe requires the original query-fault fixture");
globalThis.PointerResolverFaultProbe = {
  capability: base.capability,
  configure: base.configure,
  arm: base.arm,
  publicControl: base.publicControl,
  armResolverFault(name, passThrough = 0) {
    const capability = base.capability(name);
    if (!capability.original || !capability.connected) throw Error("Resolver target must be a real original connected View ref");
    return resolverFaultControl.arm(capability.targetTag, passThrough);
  },
  snapshot() { return {...base.snapshot(), resolver: resolverFaultControl.snapshot()}; },
};
