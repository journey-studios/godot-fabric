// The retained sabotages of scripts/world-input-sabotage.mjs that break a source, written once: that script runs them (its header says what each breaks and what must reject it)
// and tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it. The scene variants of
// the script (surface-stop, views-ignore, unhandled-off) break the probe's own setup and have no source to anchor, so they stay in the script.
// `must` is the checks whose failure proves the sabotage broke what it was written to break.
export const SURFACE = "native/fabric_surface.cpp";
const claimCall = "owner->get_runtime()->claims(surface_id, event))";
const inputCall = "owner->get_runtime()->input(surface_id, event))";
export const SABOTAGES = [
  {name: "claim-all", file: SURFACE, find: claimCall, replace: "(owner->get_runtime()->claims(surface_id, event) || true))",
    must: ["a/void: 100 of 100 left presses"]},
  {name: "before-gui", file: SURFACE, find: inputCall, replace: "(owner->get_runtime()->input(surface_id, event) || owner->get_runtime()->claims(surface_id, event)))",
    must: ["a/native Switch: 100 left inputs", "a/native Switch: 100 touch inputs"]},
];
