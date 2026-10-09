// The retained sabotages of the turn measured on the Frontier game as a consumer has it (V05-06, criterion `turno`), written once. Each breaks one thing on purpose, in
// exactly one place, and says which rules of the independent oracle (tests/frontier-turn-oracle.mjs) must reject the report it makes: the lane that breaks the provisioned copy
// (scripts/frontier-turn-lane.mjs), the script that breaks the probe and runs them all (scripts/frontier-turn-sabotage.mjs) and the test that judges the run
// (tests/frontier-turn-native.test.mjs) read it and none of them repeats it. A variant that stops the run early fails more rules than the ones named; the ones named are the ones
// it was written for.
//
//  target "copy"   the provisioned project, which the lane throws away (`file` is relative to it): the template (consumers/civ-lite) is never edited
//  target "probe"  the probe, swapped in and out of the repository through scripts/sabotage-sources.mjs and restored byte for byte (`file` is relative to the repository)
export const SABOTAGES = [
  {name: "skipped-phase", target: "copy", file: "services/game_services.gd",
    breaks: "the game node advances the turn's job twice in a frame, so a frame runs two phases",
    find: "func _process(_delta: float) -> void:\n  advance_job()\n", replace: "func _process(_delta: float) -> void:\n  advance_job()\n  advance_job()\n",
    rules: ["turns"]},
  {name: "leaky-transition", target: "probe", file: "tests/frontier-turn-probe.gd",
    breaks: "every click leaves a Godot node behind that nothing frees",
    find: "  click_at(point)\n  var flushed := Time.get_ticks_usec()\n", replace: "  click_at(point)\n  var leaked := Node.new()\n  var flushed := Time.get_ticks_usec()\n",
    rules: ["rests"]},
  {name: "click-misses-panel", target: "probe", file: "tests/frontier-turn-probe.gd",
    breaks: "the click is delivered far from the tile or the button",
    find: "func click_at(point: Vector2) -> void:\n", replace: "func click_at(requested: Vector2) -> void:\n  var point := requested + Vector2(-2000, 0)\n",
    rules: ["shape", "clicks"]},
  {name: "heap-leak", target: "copy", file: "ui/hud/hud.tsx",
    breaks: "the HUD keeps 64 numbers of every render for ever, a JavaScript leak that grows with every transition",
    find: "function GameScreen() {\n", replace: "const turnLeak: number[][] = [];\n\nfunction GameScreen() {\n  turnLeak.push(new Array<number>(64).fill(0));\n",
    rules: ["heap"]},
];
