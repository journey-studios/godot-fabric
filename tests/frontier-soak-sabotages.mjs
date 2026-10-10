// The retained sabotages of scripts/frontier-soak-sabotage.mjs, written once: that script runs them (its header says what each breaks and what must reject it) and
// tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it.
const fixture = "tests/frontier-soak-fixture.jsx";
const probe = "tests/frontier-soak-probe.gd";
// A variant is a list of edits of one file, each made in exactly one place, the text the oracle's rejection must match and whether the probe's own checks
// must fail too (they cannot for a game that is legal in each run).
export const SABOTAGES = [
  {name: "listener-leak", file: fixture, probeMustFail: true, expected: /same subscriptions at every reading|live heap at rest rose/,
    edits: [{find: "  counts.turnEnded += 1;\n", replace: "  counts.turnEnded += 1;\n  GodotFabric.connect(FRONTIER_SNAPSHOT, () => {});\n"}]},
  {name: "nondeterministic-player", file: fixture, probeMustFail: false, expected: /Execution 2: the final hash is the first's/,
    edits: [{find: 'takes("production") && s.city.queue.length === 0', replace: 'takes("production") && s.city.queue.length === 0 && Math.random() < 0.5'}]},
  {name: "pause-kills-ui", file: probe, probeMustFail: true, expected: /HUD answered while the game was paused/,
    edits: [{find: "hud.process_mode = Node.PROCESS_MODE_ALWAYS", replace: "hud.process_mode = Node.PROCESS_MODE_PAUSABLE"}]},
  {name: "leaky-hide", file: fixture, probeMustFail: true, expected: /the HUD holds the native views its state gives/,
    edits: [{find: "opacity: hidden ? 0 : 1,", replace: 'display: hidden ? "none" : "flex",'}]},
];
