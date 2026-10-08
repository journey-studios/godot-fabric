extends RefCounted

# The scenario (the 24x16 map from the fixed seed, the units, the empty city, research and event slots) and the
# queries every other rule shares. The state is one Dictionary of integers, strings, arrays and dictionaries; see
# docs/research/frontier-game.md for the field-by-field model.

const Rules := preload("rules.gd")
const Prng := preload("prng.gd")


# A new game. The keys are written in no particular order on purpose: the canonical form sorts them, and a
# serializer that forgot to would show.
static func new_state(seed_value: int) -> Dictionary:
  var rng := Prng.create(seed_value, Rules.PRNG_SEQUENCE)
  var terrain := generate_terrain(rng)
  var state := {}
  state["v"] = Rules.VERSION
  state["seed"] = seed_value
  state["turn"] = 1
  state["phase"] = "idle"
  state["rng"] = rng
  state["map"] = {"w": Rules.MAP_W, "h": Rules.MAP_H, "terrain": terrain}
  state["units"] = [
    make_unit(1, Rules.OWNER_PLAYER, "settler", Rules.START_X, Rules.START_Y),
    make_unit(2, Rules.OWNER_PLAYER, "warrior", Rules.START_X, Rules.START_Y),
    make_unit(3, Rules.OWNER_AI, "warrior", Rules.ROUTE[0][0], Rules.ROUTE[0][1]),
  ]
  state["next_unit"] = 4
  state["cities"] = []
  state["res"] = {"food": 0, "production": 0, "science": 0}
  state["research"] = {"done": 0, "current": ""}
  state["event"] = {"id": Rules.EVENT_ID, "pending": 0, "resolved": 0, "choice": ""}
  state["ai"] = {"unit": 3, "step": 0, "tx": Rules.ROUTE[0][0], "ty": Rules.ROUTE[0][1]}
  state["sel"] = {"x": -1, "y": -1, "unit": 0}
  state["log"] = []
  state["log_seq"] = 0
  return state


static func make_unit(id: int, owner: int, kind: String, x: int, y: int) -> Dictionary:
  return {"id": id, "owner": owner, "kind": kind, "x": x, "y": y, "moves": Rules.UNITS[kind].moves, "fortified": 0}


# Each tile draws a terrain, one majority pass smooths the draw, the frame of the map is water and the scenario's
# own tiles are forced last. Water is 22%, forest 18%, hill 12% and plain 48% of the draw.
static func generate_terrain(rng: Dictionary) -> Array:
  var raw := []
  for _index in Rules.MAP_W * Rules.MAP_H:
    var roll := Prng.next_below(rng, 100)
    if roll < 22:
      raw.append(Rules.WATER)
    elif roll < 40:
      raw.append(Rules.FOREST)
    elif roll < 52:
      raw.append(Rules.HILL)
    else:
      raw.append(Rules.PLAIN)
  var smooth := raw.duplicate()
  for y in range(1, Rules.MAP_H - 1):
    for x in range(1, Rules.MAP_W - 1):
      var counts := [0, 0, 0, 0]
      for dy in range(-1, 2):
        for dx in range(-1, 2):
          counts[raw[index(x + dx, y + dy)]] += 1
      var best: int = raw[index(x, y)]
      for terrain in 4:
        if counts[terrain] > counts[best]:
          best = terrain
      smooth[index(x, y)] = best
  for x in Rules.MAP_W:
    smooth[index(x, 0)] = Rules.WATER
    smooth[index(x, Rules.MAP_H - 1)] = Rules.WATER
  for y in Rules.MAP_H:
    smooth[index(0, y)] = Rules.WATER
    smooth[index(Rules.MAP_W - 1, y)] = Rules.WATER
  for forced: Array in Rules.SCENARIO_TILES:
    smooth[index(forced[0], forced[1])] = forced[2]
  return smooth


static func index(x: int, y: int) -> int:
  return y * Rules.MAP_W + x


static func in_bounds(x: int, y: int) -> bool:
  return x >= 0 and x < Rules.MAP_W and y >= 0 and y < Rules.MAP_H


static func terrain_at(state: Dictionary, x: int, y: int) -> int:
  return state.map.terrain[index(x, y)]


# The unit with this id, or an empty Dictionary. The result is the state's own entry, not a copy.
static func unit_by_id(state: Dictionary, id: int) -> Dictionary:
  for unit: Dictionary in state.units:
    if unit.id == id:
      return unit
  return {}


# The units on a tile, in id order. owner 0 means every faction.
static func units_at(state: Dictionary, x: int, y: int, owner: int = 0) -> Array:
  var found := []
  for unit: Dictionary in state.units:
    if unit.x == x and unit.y == y and (owner == 0 or unit.owner == owner):
      found.append(unit)
  return found


# The city on a tile, or an empty Dictionary.
static func city_at(state: Dictionary, x: int, y: int) -> Dictionary:
  for city: Dictionary in state.cities:
    if city.x == x and city.y == y:
      return city
  return {}


# Appends to the log the HUD and the phases' event budget read, and returns nothing: an entry is the event.
static func emit(state: Dictionary, code: String, a: int, b: int) -> void:
  state.log_seq = int(state.log_seq) + 1
  state.log.append({"seq": state.log_seq, "turn": state.turn, "code": code, "a": a, "b": b})
  while state.log.size() > Rules.LOG_MAX:
    state.log.remove_at(0)
