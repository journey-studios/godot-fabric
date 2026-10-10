extends RefCounted

# The cycle of the `context-switches` window of the comparative execution (V05-10): which intents change the game's context, in which order, through the seven contexts (none, tile,
# Settler, Warrior, stack of two units, city, dialog). It is made from the `cover-*` steps of consumers/civ-lite/game/replay.gd and from the tour of tests/frontier-turn-probe.gd (STEPS),
# and every intent is the game's own, sent at the intent boundary (GameServices), so the cycle is the same in the three arms.
#
# The protocol (amendment 4: `windows[context-switches].starts` and the step `context-switches` of `runs.script`) says what an occurrence is: the frame that receives the intent that changes
# the game's context, which is a selection intent for the six first contexts and, for the dialog, the last `resolve_event`, which closes it (dialog to none). The End Turns that open the
# dialog, the earlier `resolve_event` calls, `found_city` and every `new_game` of the cycle belong to no window.
#
# One round is one game: the seven contexts do not fit in the state of one. The Settler exists only until it founds the city, the city only after that, and the dialog only after the end of
# turn 4 (Rules.EVENT_TURN is 5; the three events are raised once per game by the `refresh` phase of that turn, the sixth frame of the End Turn's job, outside the three frames of a switch,
# and in a dialog every selection is refused with `event_pending`). So a round is a new game, eight selections of the tour, the founding of the city (a setup), three selections more, the
# End Turns and the answers that make the dialog exist (a setup), and the last answer, which closes it. A switch carries the `setup` that must happen before it, outside every window.
#
# The start tile, where the Settler and the Warrior stand stacked; selecting it from none gives the stack context.
const STACK_TILE := Vector2i(6, 8)
# Each entry of ROUND is a switch: {id, intent, args, from, to}, and optionally {setup}: steps that come before it, each {intent, args} or {end_turns: n}.
const ROUND := [
  {"id": "map-stack", "intent": "select_tile", "args": [6, 8], "from": "none", "to": "stack"},
  {"id": "select-warrior", "intent": "select_unit", "args": [2], "from": "stack", "to": "warrior"},
  {"id": "clear-selection", "intent": "clear_selection", "args": [], "from": "warrior", "to": "none"},
  {"id": "map-stack-again", "intent": "select_tile", "args": [6, 8], "from": "none", "to": "stack"},
  {"id": "select-settler", "intent": "select_unit", "args": [1], "from": "stack", "to": "settler"},
  {"id": "map-tile", "intent": "select_tile", "args": [9, 8], "from": "settler", "to": "tile"},
  {"id": "map-stack-third", "intent": "select_tile", "args": [6, 8], "from": "tile", "to": "stack"},
  {"id": "select-settler-again", "intent": "select_unit", "args": [1], "from": "stack", "to": "settler"},
  {"id": "close-city", "intent": "clear_selection", "args": [], "from": "city", "to": "none", "setup": [{"intent": "found_city", "args": [1]}]},
  {"id": "map-city", "intent": "select_tile", "args": [6, 8], "from": "none", "to": "city"},
  {"id": "close-city-again", "intent": "clear_selection", "args": [], "from": "city", "to": "none"},
  {"id": "close-dialog", "intent": "resolve_event", "args": ["host"], "from": "dialog", "to": "none", "setup": [
    {"end_turns": 4}, {"intent": "resolve_event", "args": ["welcome"]}, {"intent": "resolve_event", "args": ["buy_grain"]}]},
]
const SWITCHES_PER_ROUND := 12

# The occurrences of the window: 24 of warm-up (two rounds of the baseline's 12-swap tour) and 50 measured, consecutive through the cycle. The cycle is cut where the count is reached.
const WARMUP_SWITCHES := 24
const MEASURED_SWITCHES := 50


# The occurrences in order, each {round, index, switch}: `index` is the position in the round (0 to 11).
static func occurrences() -> Array:
  var out: Array = []
  var round_index := 0
  while out.size() < WARMUP_SWITCHES + MEASURED_SWITCHES:
    for index in range(ROUND.size()):
      if out.size() >= WARMUP_SWITCHES + MEASURED_SWITCHES:
        break
      out.append({"round": round_index, "index": index, "switch": ROUND[index]})
    round_index += 1
  return out
