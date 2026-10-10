// The retained sabotage of the Frontier export (scripts/macos-export-civ-lite.mjs, V05-07 criterion `replay`), written once: scripts/macos-export-civ-lite-sabotage.mjs runs it, and
// tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it.
//
// `file` is the template's, relative to the repository. The template (consumers/civ-lite) is never edited: the export applies the same replacement to the project it provisions
// and throws away (`runMacOSExport({edits})`), so there is nothing to restore, and the sabotage script proves by hash that the template's tree is the same before and after.
//
//  game-seed  the scenario's fixed seed is not the one the golden hash was taken from. The game still plays the whole roteiro and every check of the replay gate passes
//             (the gate pins no hash), so only the golden and the trace hash, pinned outside the game, tell: all six runs must be rejected for them.
export const SABOTAGES = [
  {name: "game-seed", file: "consumers/civ-lite/game/rules.gd", find: "const SEED := 4242\n", replace: "const SEED := 4243\n"},
];
