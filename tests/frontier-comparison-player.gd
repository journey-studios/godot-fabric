extends RefCounted

# The scripted player of the 100-turn soak, in GDScript: the port of `decide` in tests/frontier-soak-fixture.jsx (the player that tests/frontier-soak-probe.gd drives through the React
# Native HUD), for the comparative execution of V05-10. The same rule over the same snapshot: with no Math.random, no clock and nothing the game does not show, what it chooses depends
# only on the snapshot it is given and on which steps of the turn it has already taken in this turn. It founds the city on the start tile, then, every turn: sets the research and the
# production if they are empty (the first enabled technology of the snapshot; a building if one is enabled, else a Warrior while fewer than GARRISON_CAP units stand on the city tile),
# selects the city, fortifies the first unfortified unit on its tile, selects an empty tile, clears the selection and ends the turn. An event that blocks the game is resolved with its
# first choice. Every call is one the snapshot offers as enabled, so the game accepts all of them.
#
# It reads the snapshot (GameServices.get_snapshot()) and answers {"id", "args"}: the intent to send back, by the name and the arguments the snapshot's actions use, or {} when a turn
# is in progress and there is nothing to decide. tests/frontier-comparison-player.test.mjs plays the 100 turns on arm A and requires the same final hash and trail hash as the soak of
# JavaScript (tests/frontier-soak-native.test.mjs).
#
# The scenario's start tile is the one fact about the map the player does not read from the snapshot (it shows a tile only once it is selected): tests/frontier-soak-cases.mjs, START_TILE.
const START_TILE := Vector2i(6, 8)
const GARRISON_CAP := 6

# The turn the memory is about, and the steps of it already taken.
var _turn := -1
var _done := {}


# A step of the turn is taken once: the first time it is asked for in a turn it answers true.
func _takes(step: String) -> bool:
  if _done.has(step):
    return false
  _done[step] = true
  return true


static func _act(id: String, args: Array) -> Dictionary:
  return {"id": id, "args": args}


# The first item the test accepts, or null: Array.find of JavaScript.
static func _find(items: Array, test: Callable) -> Variant:
  for item: Variant in items:
    if test.call(item):
      return item
  return null


func decide(s: Dictionary) -> Dictionary:
  if _turn != int(s.turn):
    _turn = int(s.turn)
    _done.clear()
  if s.phase != "idle":
    return {}
  if int(s.dialog.open) == 1:
    return _act("resolve_event", [s.dialog.choices[0].id])
  if int(s.city.present) == 0:
    if s.context == "settler":
      var found: Variant = _find(s.actions, func(action: Dictionary) -> bool: return action.id == "found_city" and int(action.enabled) == 1)
      if found != null:
        return _act("found_city", found.args)
    if s.context == "stack":
      var settler: Variant = _find(s.actions, func(action: Dictionary) -> bool: return action.id == "select_unit" and action.label == "Select Settler" and int(action.enabled) == 1)
      if settler != null:
        return _act("select_unit", settler.args)
    return _act("select_tile", [START_TILE.x, START_TILE.y])
  if _takes("research") and s.research.current == "":
    var tech: Variant = _find(s.research.techs, func(entry: Dictionary) -> bool: return int(entry.enabled) == 1)
    if tech != null:
      return _act("set_research", [tech.id])
  if _takes("production") and s.city.queue.size() == 0:
    var building: Variant = _find(s.city.items, func(item: Dictionary) -> bool: return item.kind == "building" and int(item.enabled) == 1)
    var warrior: Variant = null
    if s.city.garrison.size() < GARRISON_CAP:
      warrior = _find(s.city.items, func(item: Dictionary) -> bool: return item.id == "warrior" and int(item.enabled) == 1)
    var chosen: Variant = building if building != null else warrior
    if chosen != null:
      return _act("set_production", [chosen.id, 0])
  if _takes("city"):
    return _act("select_tile", [int(s.city.x), int(s.city.y)])
  if _takes("unit"):
    var unit: Variant = _find(s.tile.units, func(entry: Dictionary) -> bool: return int(entry.owner) == 1 and int(entry.fortified) == 0)
    if unit != null:
      return _act("select_unit", [unit.id])
  if _takes("fortify"):
    var fortify: Variant = _find(s.actions, func(action: Dictionary) -> bool: return action.id == "fortify" and int(action.enabled) == 1)
    if fortify != null:
      return _act("fortify", fortify.args)
  if _takes("tile"):
    return _act("select_tile", [int(s.city.x) - 1, int(s.city.y)])
  if _takes("clear"):
    return _act("clear_selection", [])
  return _act("end_turn", [])
