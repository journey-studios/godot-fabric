extends RefCounted

# The scripted replay: twelve turns of the player's intents, each with the code and the context it must produce.
# A refused step is part of the script on purpose: it proves the refusal and that it changed nothing. The hash of the
# state after the last step is the golden hash the headless test fixes (docs/research/frontier-game.md).
#
# `label` names the steps that cover one of the seven contexts, "cover-<context>", so a test can find them without
# counting; every other step has "".

const STEPS := [
  # Turn 1: a stack on the start tile, the Settler walks into the forest and cannot found a city with no movement left.
  {"label": "", "intent": "clear_selection", "args": [], "code": "nothing_selected", "context": "none"},
  {"label": "", "intent": "select_tile", "args": [30, 5], "code": "out_of_bounds", "context": "none"},
  {"label": "cover-stack", "intent": "select_tile", "args": [6, 8], "code": "ok", "context": "stack"},
  {"label": "cover-settler", "intent": "select_unit", "args": [1], "code": "ok", "context": "settler"},
  {"label": "", "intent": "move_unit", "args": [1, 7, 8], "code": "ok", "context": "settler"},
  {"label": "", "intent": "found_city", "args": [1], "code": "no_moves_left", "context": "settler"},
  {"label": "", "intent": "move_unit", "args": [1, 9, 8], "code": "not_adjacent", "context": "settler"},
  {"label": "", "intent": "fortify", "args": [1], "code": "cannot_fortify", "context": "settler"},
  {"label": "", "intent": "found_city", "args": [2], "code": "not_a_settler", "context": "settler"},
  {"label": "cover-warrior", "intent": "select_unit", "args": [2], "code": "ok", "context": "warrior"},
  {"label": "", "intent": "move_unit", "args": [2, 5, 8], "code": "impassable_terrain", "context": "warrior"},
  {"label": "", "intent": "select_unit", "args": [3], "code": "not_your_unit", "context": "warrior"},
  {"label": "", "intent": "select_unit", "args": [99], "code": "unknown_unit", "context": "warrior"},
  {"label": "", "intent": "fortify", "args": [2], "code": "ok", "context": "warrior"},
  {"label": "", "intent": "fortify", "args": [2], "code": "already_fortified", "context": "warrior"},
  {"label": "", "intent": "set_production", "args": ["warrior", 0], "code": "no_city", "context": "warrior"},
  {"label": "", "intent": "end_turn", "args": [], "code": "ok", "context": "none"},
  # Turn 2: the Settler founds the city, the city starts building and the empire starts researching.
  {"label": "", "intent": "select_tile", "args": [7, 8], "code": "ok", "context": "settler"},
  {"label": "cover-city", "intent": "found_city", "args": [1], "code": "ok", "context": "city"},
  {"label": "", "intent": "found_city", "args": [1], "code": "unknown_unit", "context": "city"},
  {"label": "", "intent": "set_production", "args": ["library", 0], "code": "tech_required", "context": "city"},
  {"label": "", "intent": "set_production", "args": ["bogus", 0], "code": "unknown_item", "context": "city"},
  {"label": "", "intent": "set_production", "args": ["warrior", 0], "code": "ok", "context": "city"},
  {"label": "", "intent": "set_production", "args": ["warrior", 1], "code": "ok", "context": "city"},
  {"label": "", "intent": "set_production", "args": ["warrior", 3], "code": "bad_slot", "context": "city"},
  {"label": "", "intent": "set_research", "args": ["writing"], "code": "research_out_of_order", "context": "city"},
  {"label": "", "intent": "set_research", "args": ["alphabet"], "code": "ok", "context": "city"},
  {"label": "", "intent": "set_research", "args": ["alphabet"], "code": "already_researching", "context": "city"},
  {"label": "", "intent": "set_research", "args": ["pottery"], "code": "unknown_tech", "context": "city"},
  {"label": "", "intent": "select_unit", "args": [2], "code": "ok", "context": "warrior"},
  {"label": "", "intent": "move_unit", "args": [2, 7, 8], "code": "ok", "context": "warrior"},
  {"label": "", "intent": "end_turn", "args": [], "code": "ok", "context": "none"},
  # Turn 3: an empty tile, closed again.
  {"label": "cover-tile", "intent": "select_tile", "args": [9, 8], "code": "ok", "context": "tile"},
  {"label": "cover-none", "intent": "clear_selection", "args": [], "code": "ok", "context": "none"},
  {"label": "", "intent": "end_turn", "args": [], "code": "ok", "context": "none"},
  # Turn 4: the city built a second Warrior; both walk out, stack up and run out of movement points.
  {"label": "", "intent": "select_tile", "args": [7, 8], "code": "ok", "context": "city"},
  {"label": "", "intent": "select_unit", "args": [4], "code": "ok", "context": "warrior"},
  {"label": "", "intent": "move_unit", "args": [4, 8, 8], "code": "ok", "context": "warrior"},
  {"label": "", "intent": "move_unit", "args": [4, 9, 8], "code": "ok", "context": "warrior"},
  {"label": "", "intent": "move_unit", "args": [4, 8, 9], "code": "not_enough_moves", "context": "warrior"},
  {"label": "", "intent": "select_unit", "args": [2], "code": "ok", "context": "warrior"},
  {"label": "", "intent": "move_unit", "args": [2, 8, 8], "code": "ok", "context": "warrior"},
  {"label": "", "intent": "move_unit", "args": [2, 9, 8], "code": "ok", "context": "warrior"},
  {"label": "", "intent": "select_tile", "args": [9, 8], "code": "ok", "context": "stack"},
  {"label": "", "intent": "end_turn", "args": [], "code": "ok", "context": "dialog"},
  # Turn 5: the three events block everything until they are resolved.
  {"label": "cover-dialog", "intent": "select_tile", "args": [7, 8], "code": "event_pending", "context": "dialog"},
  {"label": "", "intent": "clear_selection", "args": [], "code": "event_pending", "context": "dialog"},
  {"label": "", "intent": "end_turn", "args": [], "code": "event_pending", "context": "dialog"},
  {"label": "", "intent": "resolve_event", "args": ["bogus"], "code": "unknown_choice", "context": "dialog"},
  # The queue of three: the head is answered with its own choices only, and the next one becomes the head.
  {"label": "", "intent": "resolve_event", "args": ["buy_grain"], "code": "unknown_choice", "context": "dialog"},
  {"label": "", "intent": "resolve_event", "args": ["welcome"], "code": "ok", "context": "dialog"},
  {"label": "", "intent": "resolve_event", "args": ["welcome"], "code": "unknown_choice", "context": "dialog"},
  {"label": "", "intent": "resolve_event", "args": ["buy_tools"], "code": "ok", "context": "dialog"},
  {"label": "", "intent": "resolve_event", "args": ["send_on"], "code": "ok", "context": "none"},
  {"label": "", "intent": "resolve_event", "args": ["send_on"], "code": "no_event", "context": "none"},
  {"label": "", "intent": "set_research", "args": ["alphabet"], "code": "tech_known", "context": "none"},
  {"label": "", "intent": "set_research", "args": ["bronze_working"], "code": "ok", "context": "none"},
  {"label": "", "intent": "set_production", "args": ["granary", 1], "code": "ok", "context": "none"},
  {"label": "", "intent": "set_production", "args": ["granary", 2], "code": "already_queued", "context": "none"},
  {"label": "", "intent": "set_production", "args": ["workshop", 2], "code": "tech_required", "context": "none"},
  {"label": "", "intent": "select_tile", "args": [7, 8], "code": "ok", "context": "city"},
  {"label": "", "intent": "clear_selection", "args": [], "code": "ok", "context": "none"},
  {"label": "", "intent": "end_turn", "args": [], "code": "ok", "context": "none"},
  # Turns 6 to 12: the city builds, grows and researches; the player keeps the queue and the research busy.
  {"label": "", "intent": "set_production", "args": ["workshop", 1], "code": "tech_required", "context": "none"},
  {"label": "", "intent": "end_turn", "args": [], "code": "ok", "context": "none"},
  {"label": "", "intent": "set_production", "args": ["granary", 0], "code": "already_built", "context": "none"},
  {"label": "", "intent": "set_production", "args": ["warrior", 0], "code": "ok", "context": "none"},
  {"label": "", "intent": "end_turn", "args": [], "code": "ok", "context": "none"},
  {"label": "", "intent": "set_production", "args": ["library", 0], "code": "tech_required", "context": "none"},
  {"label": "", "intent": "end_turn", "args": [], "code": "ok", "context": "none"},
  {"label": "", "intent": "set_research", "args": ["writing"], "code": "ok", "context": "none"},
  {"label": "", "intent": "set_production", "args": ["workshop", 0], "code": "ok", "context": "none"},
  {"label": "", "intent": "end_turn", "args": [], "code": "ok", "context": "none"},
  {"label": "", "intent": "end_turn", "args": [], "code": "ok", "context": "none"},
  {"label": "", "intent": "end_turn", "args": [], "code": "ok", "context": "none"},
  {"label": "", "intent": "set_production", "args": ["library", 0], "code": "ok", "context": "none"},
  {"label": "", "intent": "end_turn", "args": [], "code": "ok", "context": "none"},
]


# Plays one step on a game and answers the intent's result. With `sliced`, an end_turn runs as begin_end_turn followed
# by one advance_phase at a time, which must leave exactly the state that end_turn leaves.
static func run_step(game: RefCounted, step: Dictionary, sliced: bool) -> Dictionary:
  if not sliced or step.intent != "end_turn":
    return game.callv(step.intent, step.args)
  var started: Dictionary = game.begin_end_turn()
  if started.ok == 0:
    return started
  var phases := []
  while game.state.phase != "idle":
    var ran: Dictionary = game.advance_phase()
    phases.append({"name": ran.name, "tasks": ran.tasks, "events": ran.events})
  return {"ok": 1, "code": "ok", "text": "", "turn": game.state.turn, "phases": phases}
