extends RefCounted

# The player's intents. Each one has a check_* function that answers a refusal code, or "" when the intent is
# accepted, and an apply_* function that changes the state. FrontierGame calls apply_* only after check_* answered "",
# so a refused intent never changes the state, and the HUD's disabled actions use the same check_* functions, so an
# action is enabled exactly when its intent would be accepted.

const Rules := preload("rules.gd")
const Prng := preload("prng.gd")
const World := preload("world.gd")
const Economy := preload("economy.gd")


# The refusal every intent shares: a turn being processed, or an event waiting. resolve_event is the only intent
# that goes past the event, and nothing goes past a turn in progress.
static func check_guard(state: Dictionary, allow_event: bool = false) -> String:
  if state.phase != "idle":
    return "turn_in_progress"
  if int(state.event.pending) == 1 and not allow_event:
    return "event_pending"
  return ""


static func check_select_tile(state: Dictionary, x: int, y: int) -> String:
  var guard := check_guard(state)
  if guard != "":
    return guard
  if not World.in_bounds(x, y):
    return "out_of_bounds"
  return ""


# A tile with the city selects the city; otherwise a tile with exactly one of the player's units selects it, and a
# stack or an empty tile selects the tile alone.
static func apply_select_tile(state: Dictionary, x: int, y: int) -> void:
  var selected := 0
  if World.city_at(state, x, y).is_empty():
    var own := World.units_at(state, x, y, Rules.OWNER_PLAYER)
    if own.size() == 1:
      selected = own[0].id
  state.sel = {"x": x, "y": y, "unit": selected}


static func check_select_unit(state: Dictionary, unit_id: int) -> String:
  var guard := check_guard(state)
  if guard != "":
    return guard
  return _unit_reason(state, unit_id)


static func apply_select_unit(state: Dictionary, unit_id: int) -> void:
  var unit := World.unit_by_id(state, unit_id)
  state.sel = {"x": unit.x, "y": unit.y, "unit": unit_id}


static func check_move_unit(state: Dictionary, unit_id: int, x: int, y: int) -> String:
  var guard := check_guard(state)
  if guard != "":
    return guard
  var unit_reason := _unit_reason(state, unit_id)
  if unit_reason != "":
    return unit_reason
  if not World.in_bounds(x, y):
    return "out_of_bounds"
  var unit := World.unit_by_id(state, unit_id)
  if maxi(absi(x - int(unit.x)), absi(y - int(unit.y))) != 1:
    return "not_adjacent"
  var cost: int = Rules.TERRAIN[World.terrain_at(state, x, y)].move
  if cost == 0:
    return "impassable_terrain"
  for other: Dictionary in World.units_at(state, x, y):
    if other.owner != unit.owner:
      return "tile_occupied"
  if int(unit.moves) == 0:
    return "no_moves_left"
  if int(unit.moves) < cost:
    return "not_enough_moves"
  return ""


static func apply_move_unit(state: Dictionary, unit_id: int, x: int, y: int) -> void:
  var unit := World.unit_by_id(state, unit_id)
  unit.moves = int(unit.moves) - int(Rules.TERRAIN[World.terrain_at(state, x, y)].move)
  unit.fortified = 0
  unit.x = x
  unit.y = y
  if int(state.sel.unit) == unit_id:
    state.sel.x = x
    state.sel.y = y
  World.emit(state, "unit_moved", unit_id, World.index(x, y))


static func check_found_city(state: Dictionary, unit_id: int) -> String:
  var guard := check_guard(state)
  if guard != "":
    return guard
  var unit_reason := _unit_reason(state, unit_id)
  if unit_reason != "":
    return unit_reason
  var unit := World.unit_by_id(state, unit_id)
  if unit.kind != "settler":
    return "not_a_settler"
  if not state.cities.is_empty():
    return "city_exists"
  if int(unit.moves) == 0:
    return "no_moves_left"
  if unit.x < 1 or unit.x > Rules.MAP_W - 2 or unit.y < 1 or unit.y > Rules.MAP_H - 2:
    return "too_close_to_edge"
  return ""


# The Settler becomes the city on its tile, and the new city is selected.
static func apply_found_city(state: Dictionary, unit_id: int) -> void:
  var unit := World.unit_by_id(state, unit_id)
  state.units.erase(unit)
  state.cities.append({"name": Rules.CITY_NAME, "x": unit.x, "y": unit.y, "size": 1, "queue": [], "buildings": []})
  state.sel = {"x": unit.x, "y": unit.y, "unit": 0}
  World.emit(state, "city_founded", unit.x, unit.y)


static func check_fortify(state: Dictionary, unit_id: int) -> String:
  var guard := check_guard(state)
  if guard != "":
    return guard
  var unit_reason := _unit_reason(state, unit_id)
  if unit_reason != "":
    return unit_reason
  var unit := World.unit_by_id(state, unit_id)
  if unit.kind == "settler":
    return "cannot_fortify"
  if int(unit.fortified) == 1:
    return "already_fortified"
  return ""


# Fortifying takes the rest of the unit's movement; moving again undoes it.
static func apply_fortify(state: Dictionary, unit_id: int) -> void:
  var unit := World.unit_by_id(state, unit_id)
  unit.fortified = 1
  unit.moves = 0
  World.emit(state, "unit_fortified", unit_id, 0)


static func check_set_production(state: Dictionary, item_id: String, slot: int) -> String:
  var guard := check_guard(state)
  if guard != "":
    return guard
  return Economy.production_reason(state, item_id, slot)


# Slot 0 is what the city is building; a slot equal to the queue's length appends. The production already stored
# stays: changing the item loses nothing.
static func apply_set_production(state: Dictionary, item_id: String, slot: int) -> void:
  var queue: Array = Economy.city(state).queue
  if slot == queue.size():
    queue.append(item_id)
  else:
    queue[slot] = item_id
  World.emit(state, "production_set", slot, Rules.item_index(item_id))


static func check_set_research(state: Dictionary, tech_id: String) -> String:
  var guard := check_guard(state)
  if guard != "":
    return guard
  return Economy.research_reason(state, tech_id)


static func apply_set_research(state: Dictionary, tech_id: String) -> void:
  state.research.current = tech_id
  World.emit(state, "research_set", Rules.tech_index(tech_id), 0)


static func check_resolve_event(state: Dictionary, choice_id: String) -> String:
  var guard := check_guard(state, true)
  if guard != "":
    return guard
  if int(state.event.pending) != 1:
    return "no_event"
  for choice: Dictionary in Rules.EVENT_CHOICES:
    if choice.id == choice_id:
      return ""
  return "unknown_choice"


# Welcoming the wanderers draws their gift from the game's PRNG; turning them away is a fixed trade.
static func apply_resolve_event(state: Dictionary, choice_id: String) -> void:
  var gift := 0
  if choice_id == "welcome":
    gift = Rules.WELCOME_BASE + Prng.next_below(state.rng, Rules.WELCOME_SPREAD)
    state.res.food = int(state.res.food) + gift
  else:
    gift = Rules.TURN_AWAY_PRODUCTION
    state.res.production = int(state.res.production) + gift
  state.event.pending = 0
  state.event.resolved = 1
  state.event.choice = choice_id
  var choice_index := 0
  for index in Rules.EVENT_CHOICES.size():
    if Rules.EVENT_CHOICES[index].id == choice_id:
      choice_index = index
  World.emit(state, "event_resolved", choice_index, gift)


static func check_end_turn(state: Dictionary) -> String:
  return check_guard(state)


# The unit must exist and belong to the player.
static func _unit_reason(state: Dictionary, unit_id: int) -> String:
  var unit := World.unit_by_id(state, unit_id)
  if unit.is_empty():
    return "unknown_unit"
  if unit.owner != Rules.OWNER_PLAYER:
    return "not_your_unit"
  return ""
