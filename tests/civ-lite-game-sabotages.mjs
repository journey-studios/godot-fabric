// The retained sabotages of scripts/civ-lite-game-sabotage.mjs, written once: that script runs them (its header says what each breaks and what must reject it) and
// tests/sabotage-anchors.test.mjs checks that every `find` still occurs exactly once in its file. It has no side effects, so the test can import it.
const game = "consumers/civ-lite/game";
export const SABOTAGES = [
  {name: "prng", file: `${game}/prng.gd`, find: "  return ((shifted >> rotation) | (shifted << ((32 - rotation) & 31))) & MASK32\n",
    replace: "  return randi() & MASK32\n"},
  {name: "canon", file: `${game}/canon.gd`, find: "      keys.sort()\n", replace: ""},
  {name: "rule", file: `${game}/rules.gd`, find: "  {\"name\": \"Forest\", \"food\": 1, \"production\": 2, \"science\": 0, \"move\": 2},\n",
    replace: "  {\"name\": \"Forest\", \"food\": 1, \"production\": 2, \"science\": 0, \"move\": 1},\n"},
  {name: "economy", file: `${game}/rules.gd`, find: "const CENTER_PRODUCTION := 1\n", replace: "const CENTER_PRODUCTION := 2\n"},
  {name: "ai-ignores-block", file: `${game}/turn.gd`,
    find: "  return not World.units_at(state, x, y, Rules.OWNER_PLAYER).is_empty() or not World.city_at(state, x, y).is_empty()\n",
    replace: "  return false\n"},
  {name: "ai-city", file: `${game}/turn.gd`,
    find: "  return not World.units_at(state, x, y, Rules.OWNER_PLAYER).is_empty() or not World.city_at(state, x, y).is_empty()\n",
    replace: "  return not World.units_at(state, x, y, Rules.OWNER_PLAYER).is_empty()\n"},
  {name: "events-out-of-order", file: `${game}/intents.gd`, find: "  state.events.queue.remove_at(0)\n", replace: "  state.events.queue.pop_back()\n"},
  {name: "ai-wrong-event", file: `${game}/turn.gd`, find: "    World.emit(state, \"ai_blocked\", ai.tx, ai.ty)\n",
    replace: "    World.emit(state, \"ai_moved\", ai.tx, ai.ty)\n"},
];
