extends RefCounted

# The snapshot the HUD projects: an immutable tree of integers and strings. It is a function of the state, the session's
# epoch and the last finished end-of-turn job, never a handle to any of them, so React can hold it as long as it likes.
# Every section is always present; an absent thing has `present` or `open` set to 0, empty lists and zeros. The fields
# are documented one by one in docs/research/frontier-game.md, and the services slice mirrors them in TypeScript.

const Rules := preload("rules.gd")
const World := preload("world.gd")
const Economy := preload("economy.gd")
const Context := preload("context.gd")
const Intents := preload("intents.gd")


static func build(state: Dictionary, epoch: int, last_job: int) -> Dictionary:
  var rates := Economy.rates(state)
  var context := Context.derive(state)
  var snapshot := {
    "version": Rules.VERSION,
    "epoch": epoch,
    "last_job": last_job,
    "turn": state.turn,
    "phase": state.phase,
    "context": context,
    "selection": {"x": state.sel.x, "y": state.sel.y, "unit": state.sel.unit},
    "resources": {
      "food": {"stock": state.res.food, "rate": rates.food},
      "production": {"stock": state.res.production, "rate": rates.production},
      "science": {"stock": state.res.science, "rate": rates.science},
    },
    "actions": _actions(state, context),
    "tile": _tile(state),
    "city": _city(state, rates),
    "research": _research(state, rates),
    "dialog": _dialog(state),
  }
  freeze(snapshot)
  return snapshot


# Makes the dictionary and everything inside it read-only. make_read_only() is shallow, so it walks the tree.
static func freeze(value: Variant) -> void:
  if typeof(value) == TYPE_DICTIONARY:
    for key: Variant in value:
      freeze(value[key])
    value.make_read_only()
  elif typeof(value) == TYPE_ARRAY:
    for item: Variant in value:
      freeze(item)
    value.make_read_only()


static func is_frozen(value: Variant) -> bool:
  if typeof(value) == TYPE_DICTIONARY:
    if not value.is_read_only():
      return false
    for key: Variant in value:
      if not is_frozen(value[key]):
        return false
  elif typeof(value) == TYPE_ARRAY:
    if not value.is_read_only():
      return false
    for item: Variant in value:
      if not is_frozen(item):
        return false
  return true


# An action is an intent the HUD can offer. `enabled` and `reason` come from the intent's own check, so the two agree.
# `args` are the intent's positional arguments, an array of integers in the order the intent takes them: [unit_id] for
# select_unit, found_city and fortify, [] for clear_selection and end_turn. A caller sends them back as they are, under the
# action's id as the intent's name, and needs no knowledge of which intent takes what.
static func action(id: String, label: String, args: Array, reason: String) -> Dictionary:
  return {"id": id, "label": label, "args": args, "enabled": 1 if reason == "" else 0, "reason": reason, "reason_text": Rules.reason_text(reason)}


static func _actions(state: Dictionary, context: String) -> Array:
  var actions := []
  var unit_id := int(state.sel.unit)
  if context == "settler":
    actions.append(action("found_city", "Found city", [unit_id], Intents.check_found_city(state, unit_id)))
    actions.append(action("fortify", "Fortify", [unit_id], Intents.check_fortify(state, unit_id)))
  elif context == "warrior":
    actions.append(action("fortify", "Fortify", [unit_id], Intents.check_fortify(state, unit_id)))
  elif context == "stack":
    for unit: Dictionary in World.units_at(state, int(state.sel.x), int(state.sel.y), Rules.OWNER_PLAYER):
      var name: String = Rules.UNITS[unit.kind].name
      actions.append(action("select_unit", "Select " + name, [unit.id], Intents.check_select_unit(state, int(unit.id))))
  # Every context with something selected can close it. `none` has nothing to close, and `dialog` blocks the rest.
  if context != "none" and context != "dialog":
    actions.append(action("clear_selection", "Clear selection", [], Intents.check_clear_selection(state)))
  actions.append(action("end_turn", "End turn", [], Intents.check_end_turn(state)))
  return actions


static func _unit_card(unit: Dictionary) -> Dictionary:
  return {"id": unit.id, "owner": unit.owner, "kind": unit.kind, "name": Rules.UNITS[unit.kind].name, "moves": unit.moves,
    "max_moves": Rules.UNITS[unit.kind].moves, "fortified": unit.fortified}


static func _tile(state: Dictionary) -> Dictionary:
  var x := int(state.sel.x)
  var y := int(state.sel.y)
  if x < 0:
    return {"present": 0, "x": -1, "y": -1, "terrain": -1, "terrain_name": "", "food": 0, "production": 0, "science": 0, "move_cost": 0,
      "city": 0, "units": []}
  var terrain_id := World.terrain_at(state, x, y)
  var terrain: Dictionary = Rules.TERRAIN[terrain_id]
  var units := []
  for unit: Dictionary in World.units_at(state, x, y):
    units.append(_unit_card(unit))
  return {"present": 1, "x": x, "y": y, "terrain": terrain_id, "terrain_name": terrain.name, "food": terrain.food,
    "production": terrain.production, "science": terrain.science, "move_cost": terrain.move,
    "city": 0 if World.city_at(state, x, y).is_empty() else 1, "units": units}


static func _city(state: Dictionary, rates: Dictionary) -> Dictionary:
  var city := Economy.city(state)
  var queue := []
  var buildings := []
  var garrison := []
  var size := 0
  if not city.is_empty():
    size = int(city.size)
    for slot in city.queue.size():
      var item: Dictionary = Rules.ITEMS[Rules.item_index(city.queue[slot])]
      queue.append({"slot": slot, "item": item.id, "label": item.label, "cost": item.cost, "stock": state.res.production if slot == 0 else 0})
    buildings = city.buildings.duplicate()
    for unit: Dictionary in World.units_at(state, int(city.x), int(city.y), Rules.OWNER_PLAYER):
      garrison.append({"id": unit.id, "kind": unit.kind})
  # The HUD's default slot: the first free one, or the last when the queue is full.
  var slot_default := mini(queue.size(), Rules.QUEUE_MAX - 1)
  var items := []
  for item: Dictionary in Rules.ITEMS:
    var reason := Intents.check_set_production(state, item.id, slot_default)
    items.append({"id": item.id, "label": item.label, "kind": item.kind, "cost": item.cost, "tech": item.tech,
      "enabled": 1 if reason == "" else 0, "reason": reason, "reason_text": Rules.reason_text(reason)})
  return {"present": 0 if city.is_empty() else 1, "name": "" if city.is_empty() else city.name,
    "x": -1 if city.is_empty() else city.x, "y": -1 if city.is_empty() else city.y,
    "size": size, "max_size": Rules.CITY_MAX_SIZE, "food_needed": Economy.growth_needed(size) if size > 0 else 0,
    "food_rate": rates.food, "production_rate": rates.production, "science_rate": rates.science,
    "queue": queue, "queue_max": Rules.QUEUE_MAX, "items": items, "buildings": buildings, "garrison": garrison}


static func _research(state: Dictionary, rates: Dictionary) -> Dictionary:
  var done := int(state.research.done)
  var techs := []
  for index in Rules.TECHS.size():
    var tech: Dictionary = Rules.TECHS[index]
    var tech_state := "locked"
    if index < done:
      tech_state = "known"
    elif tech.id == state.research.current:
      tech_state = "current"
    elif index == done:
      tech_state = "available"
    var reason := Intents.check_set_research(state, tech.id)
    techs.append({"id": tech.id, "label": tech.label, "cost": tech.cost, "state": tech_state,
      "enabled": 1 if reason == "" else 0, "reason": reason, "reason_text": Rules.reason_text(reason)})
  var current: String = state.research.current
  return {"current": current, "known": done, "needed": Rules.TECHS[done].cost if current != "" else 0, "rate": rates.science, "techs": techs}


static func _dialog(state: Dictionary) -> Dictionary:
  if int(state.event.pending) != 1:
    return {"open": 0, "id": "", "title": "", "text": "", "choices": []}
  var choices := []
  for choice: Dictionary in Rules.EVENT_CHOICES:
    choices.append({"id": choice.id, "label": choice.label, "detail": choice.detail})
  return {"open": 1, "id": Rules.EVENT_ID, "title": Rules.EVENT_TITLE, "text": Rules.EVENT_TEXT, "choices": choices}
