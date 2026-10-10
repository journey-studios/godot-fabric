extends SceneTree

# Frontier's headless probe. It loads the game's scripts from the root project (res://consumers/civ-lite/game/), plays
# the 12-turn roteiro three ways (the first one examined step by step, a second one in the same process, a third one with
# every end_turn sliced into phases), and writes a report with the canonical serialization after every step. The probe
# only reports: the golden hash is fixed in tests/civ-lite-game-native.test.mjs, and tests/civ-lite-game-oracle.mjs
# judges the raw observations without trusting any verdict here. There is no extension, no Control and no frame: the
# rules are plain GDScript.
#
# It also plays the irrigation scenarios (the Irrigate rule, the base of the cost-of-change experiment, docs/research/frontier-change-cost.md):
# games built for each case of the rule, played through the same intents, with the state after every step in the report for the oracle.
#
#   --out=<path>   where the report goes, relative to the project (default build/civ-lite-game-report.json)

const Rules := preload("res://consumers/civ-lite/game/rules.gd")
const Prng := preload("res://consumers/civ-lite/game/prng.gd")
const Canon := preload("res://consumers/civ-lite/game/canon.gd")
const Game := preload("res://consumers/civ-lite/game/game.gd")
const Replay := preload("res://consumers/civ-lite/game/replay.gd")
const World := preload("res://consumers/civ-lite/game/world.gd")
const Snapshot := preload("res://consumers/civ-lite/game/snapshot.gd")

# The first outputs of the PCG32 generator seeded with state 42 and sequence 54, from PCG's published reference demo.
const REFERENCE_VECTOR := [0xa15c02b7, 0x7b47f409, 0xba1d3330, 0x83d2f293, 0xbfa4784b, 0xcbed606e]
# The SHA-256 of "abc", from FIPS 180-2.
const SHA256_ABC := "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
# An epoch that is not the default, to show it reaches the snapshot and not the hash.
const SESSION_EPOCH := 7

var checks: Array = []


func check(condition: bool, name: String) -> bool:
  checks.append({"name": name, "passed": condition})
  if not condition:
    push_error("FABRIC_CHECK_FAILED: " + name)
  return condition


func output_path() -> String:
  for argument: String in OS.get_cmdline_user_args():
    if argument.begins_with("--out="):
      return "res://" + argument.substr("--out=".length())
  return "res://build/civ-lite-game-report.json"


func step_name(index: int, step: Dictionary) -> String:
  return "step %02d %s%s" % [index, step.intent, JSON.stringify(step.args)]


# Whether every action and every item and technology of the snapshot is enabled exactly when its intent is accepted:
# each one is tried on a copy of the game.
func intents_agree_with_snapshot(game: RefCounted, snapshot: Dictionary) -> bool:
  var agree := true
  for action: Dictionary in snapshot.actions:
    var result: Dictionary = game.duplicate_game().callv(action.id, action.args)
    agree = agree and result.ok == action.enabled and (result.ok == 1 or result.code == action.reason)
  var slot := mini(snapshot.city.queue.size(), snapshot.city.queue_max - 1)
  for item: Dictionary in snapshot.city.items:
    var result: Dictionary = game.duplicate_game().set_production(item.id, slot)
    agree = agree and result.ok == item.enabled and (result.ok == 1 or result.code == item.reason)
  for tech: Dictionary in snapshot.research.techs:
    var result: Dictionary = game.duplicate_game().set_research(tech.id)
    agree = agree and result.ok == tech.enabled and (result.ok == 1 or result.code == tech.reason)
  return agree


# Plays the roteiro on a fresh game. `examine` adds the per-step checks; the observations are the same either way.
func play(sliced: bool, epoch: int, examine: bool) -> Dictionary:
  var game = Game.new(Rules.SEED, epoch)
  var initial := game.serialize()
  var steps := []
  var snapshots := {}
  var contexts := {}
  var accepted_turns := 0
  for index in Replay.STEPS.size():
    var step: Dictionary = Replay.STEPS[index]
    var name := step_name(index, step)
    var before := game.serialize()
    var result: Dictionary = Replay.run_step(game, step, sliced)
    var after := game.serialize()
    var context := game.context()
    var record := {"index": index, "label": step.label, "intent": step.intent, "args": step.args, "ok": result.ok, "code": result.code,
      "text": result.text, "context": context, "turn": game.state.turn, "serialization": after, "hash": Canon.hash_text(after)}
    if result.has("phases"):
      record["phases"] = result.phases
    steps.append(record)
    contexts[context] = true
    if step.intent == "end_turn" and result.ok == 1:
      accepted_turns += 1
    if not examine:
      continue
    check(result.code == step.code, name + " answers " + step.code)
    check(context == step.context, name + " leaves the context " + step.context)
    if result.ok == 0:
      check(after == before, name + " refused: the state is untouched")
      check(result.text == Rules.reason_text(result.code) and result.text != "", name + " refused: the text is the code's")
    check(after != "" and before != "", name + " serializes")
    var snapshot := game.snapshot()
    check(snapshot.context == context and snapshot.turn == game.state.turn and snapshot.epoch == epoch, name + " snapshot agrees with the game")
    check(Snapshot.is_frozen(snapshot) and Canon.encode(snapshot) != "", name + " snapshot is immutable and integers and strings only")
    check(game.serialize() == after, name + " snapshot reads without changing the state")
    check(intents_agree_with_snapshot(game, snapshot), name + " every enabled action is an accepted intent and the reverse")
    if step.label.begins_with("cover-"):
      snapshots[step.label] = snapshot
      check(context == step.label.substr("cover-".length()), name + " covers " + step.label)
    if result.has("phases"):
      var names := []
      var within := true
      for phase: Dictionary in result.phases:
        names.append(phase.name)
        within = within and phase.tasks <= Rules.PHASE_TASK_LIMIT and phase.events <= Rules.PHASE_EVENT_LIMIT
      check(names == Rules.PHASES, name + " runs the phases in order")
      check(within, name + " keeps every phase within 64 tasks and 128 events")
  snapshots["final"] = game.snapshot()
  return {"game": game, "initial": initial, "steps": steps, "snapshots": snapshots, "contexts": contexts, "accepted_turns": accepted_turns}


func hashes_of(steps: Array) -> Array:
  return steps.map(func(record: Dictionary) -> String: return record.hash)


func check_serializer() -> void:
  check(Canon.encode({"b": [1, -2, "x"], "a": {}}) == '{"a":{},"b":[1,-2,"x"]}', "canon: keys are sorted and nothing else is spaced")
  check(Canon.encode("a\"b\\c") == '"a\\"b\\\\c"', "canon: only the quote and the backslash are escaped")
  check(Canon.encode({"a": 1.5}) == "" and Canon.encode([2.0]) == "", "canon: a float is refused")
  check(Canon.encode([true]) == "" and Canon.encode({"a": null}) == "", "canon: a bool and a null are refused")
  check(Canon.encode({1: 2}) == "" and Canon.encode({"é": 1}) == "" and Canon.encode("é") == "", "canon: a non-string key and a non-ASCII text are refused")
  check(Canon.state_hash({"a": 1.5}) == "", "canon: the hash of unserializable data is empty")
  check(Canon.hash_text("abc") == SHA256_ABC, "canon: the hash is SHA-256 (FIPS 180-2 vector)")


func check_prng() -> void:
  check(Prng.reference_vector() == REFERENCE_VECTOR, "prng: PCG32 matches its published reference outputs")
  var first := Prng.create(Rules.SEED, Rules.PRNG_SEQUENCE)
  var second := Prng.create(Rules.SEED, Rules.PRNG_SEQUENCE)
  var other := Prng.create(Rules.SEED + 1, Rules.PRNG_SEQUENCE)
  var same := true
  var differs := false
  var bounded := true
  for _index in 200:
    var value := Prng.next_u32(first)
    same = same and value == Prng.next_u32(second)
    differs = differs or value != Prng.next_u32(other)
    bounded = bounded and Prng.next_below(first, 7) < 7 and Prng.next_below(second, 7) < 7
  check(same, "prng: the same seed gives the same stream")
  check(differs, "prng: another seed gives another stream")
  check(bounded, "prng: a bounded draw stays below its bound")
  check(int(first.draws) == int(second.draws) and int(first.draws) >= 400, "prng: every output is counted")


func check_turn_slicing() -> void:
  var game = Game.new()
  check(game.advance_phase().code == "no_turn_job", "turn: no phase to advance outside a turn")
  var before: String = game.serialize()
  check(game.begin_end_turn().ok == 1 and game.state.phase == Rules.PHASES[0], "turn: begin_end_turn stops at the first phase")
  var refused := true
  var calls := [["select_tile", [6, 8]], ["select_unit", [1]], ["clear_selection", []], ["move_unit", [1, 7, 8]], ["found_city", [1]], ["fortify", [2]], ["irrigate", [1]],
    ["set_production", ["warrior", 0]], ["set_research", ["alphabet"]], ["resolve_event", ["welcome"]], ["end_turn", []], ["begin_end_turn", []]]
  var mid: String = game.serialize()
  for call: Array in calls:
    var result: Dictionary = game.callv(call[0], call[1])
    refused = refused and result.ok == 0 and result.code == "turn_in_progress"
  check(refused and game.serialize() == mid, "turn: every intent is refused with turn_in_progress and changes nothing")
  var ran := []
  while game.state.phase != "idle":
    ran.append(game.advance_phase().name)
  check(ran == Rules.PHASES and game.state.turn == 2 and game.serialize() != before, "turn: advancing runs every phase once and ends the turn")
  check(game.begin_end_turn().ok == 1, "turn: a new turn can be started after the last phase")


# The refusals the roteiro cannot reach by playing, each on a state built to need it: the scenario has one Settler (so no
# second city), a faction that never walks next to the player, and a queue that never fills. Answers the code each got.
func check_unreachable_refusals() -> Array:
  var cases := [
    {"name": "a second city", "code": "city_exists", "intent": "found_city", "args": [9], "mutate": func(game: RefCounted) -> void:
      game.state.units.append(World.make_unit(9, Rules.OWNER_PLAYER, "settler", 12, 8))
      game.state.cities.append({"name": "Aurora", "x": 7, "y": 8, "size": 1, "queue": [], "buildings": []})},
    {"name": "a city on the outer ring", "code": "too_close_to_edge", "intent": "found_city", "args": [9], "mutate": func(game: RefCounted) -> void:
      game.state.units.append(World.make_unit(9, Rules.OWNER_PLAYER, "settler", 23, 5))},
    {"name": "a move onto the faction's Warrior", "code": "tile_occupied", "intent": "move_unit", "args": [9, 17, 8], "mutate": func(game: RefCounted) -> void:
      game.state.units.append(World.make_unit(9, Rules.OWNER_PLAYER, "warrior", 16, 8))},
    {"name": "a fourth queue entry", "code": "queue_full", "intent": "set_production", "args": ["warrior", 3], "mutate": func(game: RefCounted) -> void:
      game.state.cities.append({"name": "Aurora", "x": 7, "y": 8, "size": 1, "queue": ["warrior", "warrior", "warrior"], "buildings": []})},
  ]
  var codes := []
  for entry: Dictionary in cases:
    var game = Game.new()
    entry.mutate.call(game)
    var before: String = game.serialize()
    var result: Dictionary = game.callv(entry.intent, entry.args)
    codes.append({"name": entry.name, "code": result.code})
    check(result.code == entry.code and result.ok == 0 and game.serialize() == before, "refusal: " + entry.name + " is refused with " + entry.code + " and changes nothing")
  return codes


# Whether units of two sides share a tile, or a unit of the faction stands on the player's city.
func overlaps(state: Dictionary) -> bool:
  for unit: Dictionary in state.units:
    for other: Dictionary in World.units_at(state, unit.x, unit.y):
      if other.owner != unit.owner:
        return true
  for city: Dictionary in state.cities:
    if not World.units_at(state, city.x, city.y, Rules.OWNER_AI).is_empty():
      return true
  return false


# The faction's wait. The roteiro never puts the player on the faction's route, so these are states built for it: the
# player's city, or a unit of the player, on the tile the faction would enter next (the second tile of its route). The
# faction waits where it is, nothing overlaps, and a unit that finishes in the city that turn is born alone on it.
# Answers each turn as its serialization before and after, for the oracle to judge.
func check_faction_waits() -> Array:
  var start: Array = Rules.ROUTE[0]
  var target: Array = Rules.ROUTE[1]
  var cases := []

  var city_game = Game.new()
  city_game.state.cities.append({"name": "Aurora", "x": target[0], "y": target[1], "size": 1, "queue": ["warrior"], "buildings": []})
  city_game.state.res.production = Rules.ITEMS[Rules.item_index("warrior")].cost
  var before: String = city_game.serialize()
  var result: Dictionary = city_game.end_turn()
  var born: Array = World.units_at(city_game.state, target[0], target[1])
  cases.append({"name": "city-on-route", "before": before, "after": city_game.serialize()})
  check(result.ok == 1 and city_game.state.ai.step == 0 and World.unit_by_id(city_game.state, 3).x == start[0] and World.unit_by_id(city_game.state, 3).y == start[1],
    "ai wait: a city on the faction's route keeps the faction where it was")
  check(born.size() == 1 and born[0].owner == Rules.OWNER_PLAYER and born[0].kind == "warrior" and World.city_at(city_game.state, target[0], target[1]).queue.is_empty(),
    "ai wait: the Warrior finished in that city is born alone on its tile")
  check(not overlaps(city_game.state) and city_game.state.log.any(func(entry: Dictionary) -> bool: return entry.code == "ai_blocked" and entry.a == target[0] and entry.b == target[1]),
    "ai wait: nothing overlaps and the wait is an ai_blocked event")
  before = city_game.serialize()
  city_game.end_turn()
  cases.append({"name": "city-on-route-next-turn", "before": before, "after": city_game.serialize()})
  check(city_game.state.ai.step == 0 and World.unit_by_id(city_game.state, 3).x == start[0] and not overlaps(city_game.state),
    "ai wait: the faction keeps waiting for as long as the city stays on its route")

  var unit_game = Game.new()
  unit_game.state.units.append(World.make_unit(int(unit_game.state.next_unit), Rules.OWNER_PLAYER, "warrior", target[0], target[1]))
  unit_game.state.next_unit = int(unit_game.state.next_unit) + 1
  before = unit_game.serialize()
  unit_game.end_turn()
  cases.append({"name": "unit-on-route", "before": before, "after": unit_game.serialize()})
  check(unit_game.state.ai.step == 0 and World.unit_by_id(unit_game.state, 3).x == start[0] and not overlaps(unit_game.state),
    "ai wait: a unit of the player on the faction's route keeps the faction where it was")
  return cases


# --- Irrigation -----------------------------------------------------------------------------------------------------------

# The actions of the Settler's context, in the game's order.
const SETTLER_ACTIONS := ["found_city", "irrigate", "fortify", "clear_selection", "end_turn"]


# A Settler on open land for the scenarios: the 3x3 around it is Plain, with Water on the one tile given and nowhere else, so what the
# tile has beside it is exactly that. Answers the Settler's id.
func place_settler(game: RefCounted, tile: Vector2i, water: Vector2i) -> int:
  for dy in range(-1, 2):
    for dx in range(-1, 2):
      game.state.map.terrain[World.index(tile.x + dx, tile.y + dy)] = Rules.PLAIN
  game.state.map.terrain[World.index(water.x, water.y)] = Rules.WATER
  var id := int(game.state.next_unit)
  game.state.units.append(World.make_unit(id, Rules.OWNER_PLAYER, "settler", tile.x, tile.y))
  game.state.next_unit = id + 1
  return id


func add_city(game: RefCounted) -> void:
  game.state.cities.append({"name": Rules.CITY_NAME, "x": 7, "y": 8, "size": 1, "queue": [], "buildings": []})


# Settlers 4 to 8, with Water north, east, south and west of the first four and on a diagonal only of the fifth.
func setup_four_sides(game: RefCounted) -> void:
  place_settler(game, Vector2i(4, 4), Vector2i(4, 3))
  place_settler(game, Vector2i(7, 4), Vector2i(8, 4))
  place_settler(game, Vector2i(10, 4), Vector2i(10, 5))
  place_settler(game, Vector2i(13, 4), Vector2i(12, 4))
  place_settler(game, Vector2i(16, 4), Vector2i(17, 5))


func setup_far_tile(game: RefCounted) -> void:
  add_city(game)
  place_settler(game, Vector2i(14, 4), Vector2i(14, 3))


# The scenarios: a setup that builds the game, and the steps [intent, args, code] it plays. The start tile (6, 8) is a Plain with Water at
# (5, 8), and (6, 9) another with Water at (5, 9); the Forest (7, 8) and the Hill (7, 7) are next to it.
func irrigation_scenarios() -> Array:
  return [
    {"name": "start-plain", "steps": [["irrigate", [99], "unknown_unit"], ["irrigate", [3], "not_your_unit"], ["irrigate", [2], "not_a_settler"],
      ["select_unit", [1], "ok"], ["irrigate", [1], "ok"], ["irrigate", [1], "already_irrigated"], ["end_turn", [], "ok"], ["irrigate", [1], "already_irrigated"]]},
    # The Settler has no moves left after the forest (2 of 2), and the refusal is still the tile's: the checks run unit, tile, moves.
    {"name": "forest", "steps": [["move_unit", [1, 7, 8], "ok"], ["irrigate", [1], "not_a_plain"]]},
    {"name": "hill", "steps": [["move_unit", [1, 7, 7], "ok"], ["irrigate", [1], "not_a_plain"]]},
    {"name": "no-moves-left", "steps": [["move_unit", [1, 6, 9], "ok"], ["move_unit", [1, 6, 8], "ok"], ["irrigate", [1], "no_moves_left"], ["end_turn", [], "ok"],
      ["irrigate", [1], "ok"]]},
    # Water on each of the four sides irrigates, in whatever order the Settlers go; Water on a diagonal only does not.
    {"name": "four-sides", "setup": setup_four_sides,
      "steps": [["irrigate", [6], "ok"], ["irrigate", [4], "ok"], ["irrigate", [8], "no_water_nearby"], ["irrigate", [7], "ok"], ["irrigate", [5], "ok"]]},
    # The city's yields use the bonus: the irrigated Plain next to the city outranks every neighbour, so the city works it.
    {"name": "city-yield", "setup": add_city, "steps": [["select_unit", [1], "ok"], ["irrigate", [1], "ok"], ["end_turn", [], "ok"]]},
    {"name": "city-control", "setup": add_city, "steps": [["select_unit", [1], "ok"], ["end_turn", [], "ok"]]},
    # An irrigated Plain that the city does not work changes nothing of its yields.
    {"name": "far-tile", "setup": setup_far_tile,
      "steps": [["select_unit", [4], "ok"], ["irrigate", [4], "ok"]]},
    # The city founded on an irrigated Plain works it as its centre.
    {"name": "city-on-irrigated", "steps": [["select_unit", [1], "ok"], ["irrigate", [1], "ok"], ["end_turn", [], "ok"], ["found_city", [1], "ok"], ["end_turn", [], "ok"]]},
  ]


# Plays one scenario on a game built for it. The state after every step goes to the report; the snapshots stay here for the checks of the case.
func play_irrigation(entry: Dictionary) -> Dictionary:
  var game = Game.new(Rules.SEED, SESSION_EPOCH)
  if entry.has("setup"):
    entry.setup.call(game)
  var initial: String = game.serialize()
  check(initial != "", "irrigation %s: the game built for the case serializes" % entry.name)
  var records := []
  var snapshots := []
  for index in entry.steps.size():
    var step: Array = entry.steps[index]
    var name := "irrigation %s step %02d %s%s" % [entry.name, index, step[0], JSON.stringify(step[1])]
    var before: String = game.serialize()
    var result: Dictionary = game.callv(step[0], step[1])
    var after: String = game.serialize()
    check(result.code == step[2], name + " answers " + step[2])
    if result.ok == 0:
      check(after == before, name + " refused: the state is untouched")
      check(result.text == Rules.reason_text(result.code) and result.text != "", name + " refused: the text is the code's")
    var snapshot: Dictionary = game.snapshot()
    check(Snapshot.is_frozen(snapshot) and Canon.encode(snapshot) != "", name + " snapshot is immutable and integers and strings only")
    check(intents_agree_with_snapshot(game, snapshot), name + " every enabled action is an accepted intent and the reverse")
    if snapshot.context == "settler":
      check(snapshot.actions.map(func(action: Dictionary) -> String: return action.id) == SETTLER_ACTIONS, name + " the Settler's actions are in the game's order")
    var record := {"index": index, "intent": step[0], "args": step[1], "ok": result.ok, "code": result.code, "context": game.context(), "turn": game.state.turn,
      "serialization": after, "hash": Canon.hash_text(after)}
    if result.has("phases"):
      record["phases"] = result.phases
    records.append(record)
    snapshots.append(snapshot)
  return {"name": entry.name, "initial": initial, "steps": records, "snapshots": snapshots, "game": game}


# The irrigation of the start tile, seen in the snapshot, the card and the hover: the numbers the HUDs show.
func check_start_plain(played: Dictionary) -> Dictionary:
  var snapshots: Array = played.snapshots
  var game = played.game
  var offered: Dictionary = snapshots[3].actions[1]
  check(snapshots[3].context == "settler" and offered.id == "irrigate" and offered.label == "Irrigate" and offered.args == [1] and offered.enabled == 1 and offered.reason == "",
    "irrigation: a Settler on a Plain with Water beside it is offered Irrigate, enabled, for its own id")
  check(snapshots[3].tile.irrigated == 0 and snapshots[3].tile.food == 2 and snapshots[3].tile.production == 1,
    "irrigation: the tile card of a Plain that is not irrigated says so and yields its terrain's")
  var done: Dictionary = snapshots[4].actions[1]
  check(done.enabled == 0 and done.reason == "already_irrigated" and done.reason_text == Rules.reason_text("already_irrigated"),
    "irrigation: once irrigated the action is disabled with already_irrigated and the game's text")
  check(snapshots[4].tile.irrigated == 1 and snapshots[4].tile.food == 3 and snapshots[4].tile.production == 1 and snapshots[4].tile.science == 0,
    "irrigation: the card of the irrigated tile says so and its food has the bonus")
  var settler: Dictionary = snapshots[4].tile.units.filter(func(unit: Dictionary) -> bool: return unit.id == 1)[0]
  check(settler.moves == 0 and settler.max_moves == 2, "irrigation: irrigating spends all of the Settler's remaining moves")
  check(game.state.irrigated == [World.index(6, 8)], "irrigation: the state holds the tile as an index into the map")
  # Two turns on, the Settler has its moves back and the tile is still irrigated: the refusal is the tile's, not the moves'.
  check(World.unit_by_id(game.state, 1).moves == 2 and game.state.turn == 2 and game.tile_card(6, 8).food == 3, "irrigation: the tile stays irrigated across the turn")
  var hover_irrigated: Dictionary = game.tile_card(6, 8)
  var hover_plain: Dictionary = game.tile_card(9, 8)
  var hover_water: Dictionary = game.tile_card(5, 8)
  var hover_outside: Dictionary = game.tile_card(-1, 8)
  check(hover_irrigated.irrigated == 1 and hover_irrigated.food == 3 and hover_plain.irrigated == 0 and hover_plain.food == 2 and hover_water.irrigated == 0
    and hover_water.food == 1 and hover_outside.present == 0 and hover_outside.irrigated == 0, "irrigation: the hover's card says it too, tile by tile, and the absent card is not irrigated")
  var fresh = Game.new()
  var changed = Game.new()
  changed.state.irrigated.append(World.index(6, 8))
  check(fresh.state.irrigated.is_empty() and fresh.state_hash() != changed.state_hash() and fresh.serialize().contains("\"irrigated\":[]"),
    "irrigation: a fresh game holds no irrigated tile, and the irrigated tiles are part of the state's hash")
  return {"before": snapshots[3], "after": snapshots[4], "hoverIrrigated": hover_irrigated, "hoverPlain": hover_plain, "hoverWater": hover_water, "hoverOutside": hover_outside}


func check_irrigation_yields(by_name: Dictionary) -> void:
  var yield_case: Dictionary = by_name["city-yield"]
  var control: Dictionary = by_name["city-control"]
  var before: Dictionary = yield_case.snapshots[0]
  var after: Dictionary = yield_case.snapshots[1]
  check(before.city.food_rate == 3 and before.city.production_rate == 5 and after.city.food_rate == 5 and after.city.production_rate == 4,
    "irrigation: the city works the irrigated Plain, which outranks its other neighbours: two more food and one less production")
  check(after.resources.food.rate == after.city.food_rate and yield_case.snapshots[2].resources.food.stock == 5 and control.snapshots[1].resources.food.stock == 3,
    "irrigation: the turn after, the city's food stock has the irrigated yield, and the same turn without it has the other")
  var far_before: Dictionary = by_name["far-tile"].snapshots[0]
  var far_after: Dictionary = by_name["far-tile"].snapshots[1]
  check(far_before.city.food_rate == far_after.city.food_rate and far_after.tile.irrigated == 1 and far_after.tile.food == 3,
    "irrigation: an irrigated Plain the city does not work leaves the city's yields as they were, and its card has the bonus")
  var founded: Dictionary = by_name["city-on-irrigated"].snapshots[3]
  check(founded.city.present == 1 and founded.city.food_rate == 5, "irrigation: a city founded on an irrigated Plain works it as its centre")


func check_irrigation() -> Dictionary:
  var scenarios := []
  var by_name := {}
  for entry: Dictionary in irrigation_scenarios():
    var played := play_irrigation(entry)
    by_name[entry.name] = played
    scenarios.append({"name": played.name, "initial": played.initial, "steps": played.steps})
  var cards := check_start_plain(by_name["start-plain"])
  check_irrigation_yields(by_name)
  var four: Dictionary = by_name["four-sides"]
  check(four.game.state.irrigated == [100, 103, 106, 109], "irrigation: four tiles with Water on each of the four sides are irrigated, kept ascending whatever the order")
  check(World.unit_by_id(four.game.state, 8).moves == 2 and World.unit_by_id(four.game.state, 6).moves == 0,
    "irrigation: the Settler that was refused keeps its moves and the ones that irrigated spent them")
  check(by_name["forest"].game.state.irrigated.is_empty() and by_name["hill"].game.state.irrigated.is_empty(), "irrigation: no Forest and no Hill is irrigated")
  return {"scenarios": scenarios, "cards": cards}


func check_epoch(primary: Dictionary) -> void:
  var other = Game.new(Rules.SEED, SESSION_EPOCH + 1)
  check(other.snapshot().epoch == SESSION_EPOCH + 1 and primary.snapshots.final.epoch == SESSION_EPOCH, "epoch: the snapshot carries the session's epoch")
  check(other.state_hash() == Game.new(Rules.SEED, 1).state_hash(), "epoch: it is not part of the state's hash")


func _init() -> void:
  check_serializer()
  check_prng()
  check_turn_slicing()
  var unreachable := check_unreachable_refusals()
  var waits := check_faction_waits()
  var irrigation := check_irrigation()
  var primary := play(false, SESSION_EPOCH, true)
  var repeated := play(false, SESSION_EPOCH, false)
  var sliced := play(true, SESSION_EPOCH, false)
  check_epoch(primary)
  var hashes := hashes_of(primary.steps)
  check(hashes == hashes_of(repeated.steps), "replay: a second play in the same process reaches the same state at every step")
  check(hashes == hashes_of(sliced.steps), "replay: slicing every end_turn into phases reaches the same state at every step")
  check(primary.accepted_turns == 12 and primary.game.state.turn == 13, "replay: twelve turns were played and turn 13 begins")
  check(primary.contexts.size() == Rules.CONTEXTS.size() and Rules.CONTEXTS.all(func(context: String) -> bool: return primary.contexts.has(context)),
    "replay: all seven contexts were observed")
  var failures := checks.filter(func(row: Dictionary) -> bool: return not row.passed).map(func(row: Dictionary) -> String: return row.name)
  var final_hash: String = hashes[hashes.size() - 1]
  var report := {"scenario": "civ-lite-game", "godot": Engine.get_version_info().string, "displayServer": DisplayServer.get_name(),
    "seed": Rules.SEED, "epoch": SESSION_EPOCH, "prng": {"vector": Prng.reference_vector()}, "initial": primary.initial,
    "steps": primary.steps, "snapshots": primary.snapshots, "unreachableRefusals": unreachable, "waitCases": waits, "irrigation": irrigation, "finalHash": final_hash, "checks": checks,
    "allPassed": failures.is_empty()}
  DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://build"))
  var output := FileAccess.open(output_path(), FileAccess.WRITE)
  if output == null:
    push_error("FABRIC_CHECK_FAILED: report: the report cannot be written")
    quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  print("CIV_LITE_GAME_HASH: " + final_hash)
  print("CIV_LITE_GAME_PASSED: " + str(checks.size()) if failures.is_empty() else "CIV_LITE_GAME_FAILED: " + str(failures.size()))
  quit(0 if failures.is_empty() else 1)
