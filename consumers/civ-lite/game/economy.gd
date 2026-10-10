extends RefCounted

# The city's yields, its worked tiles and what a production item or a technology needs. Pure functions of the state:
# nothing here changes it.

const Rules := preload("rules.gd")
const World := preload("world.gd")


# The city, or an empty Dictionary while there is none.
static func city(state: Dictionary) -> Dictionary:
  if state.cities.is_empty():
    return {}
  return state.cities[0]


# What a tile yields: its terrain's, and one more food while it is irrigated.
static func tile_yield(state: Dictionary, x: int, y: int) -> Dictionary:
  var terrain: Dictionary = Rules.TERRAIN[World.terrain_at(state, x, y)]
  var food: int = terrain.food + (Rules.IRRIGATION_FOOD if World.is_irrigated(state, x, y) else 0)
  return {"x": x, "y": y, "food": food, "production": terrain.production, "science": terrain.science}


# The in-map neighbours of the city, best first: by total yield, then production, then food, then row, then column.
# The order is total, so no two tiles tie and the result does not depend on how the sort treats equal keys.
static func ranked_neighbors(state: Dictionary, center_x: int, center_y: int) -> Array:
  var tiles := []
  for dy in range(-1, 2):
    for dx in range(-1, 2):
      if (dx != 0 or dy != 0) and World.in_bounds(center_x + dx, center_y + dy):
        tiles.append(tile_yield(state, center_x + dx, center_y + dy))
  tiles.sort_custom(_better_tile)
  return tiles


static func _better_tile(a: Dictionary, b: Dictionary) -> bool:
  var total_a: int = a.food + a.production + a.science
  var total_b: int = b.food + b.production + b.science
  if total_a != total_b:
    return total_a > total_b
  if a.production != b.production:
    return a.production > b.production
  if a.food != b.food:
    return a.food > b.food
  if a.y != b.y:
    return a.y < b.y
  return a.x < b.x


# The tiles the city works: its centre and as many neighbours as its size.
static func worked_tiles(state: Dictionary, c: Dictionary) -> Array:
  var worked := [tile_yield(state, c.x, c.y)]
  var ranked := ranked_neighbors(state, c.x, c.y)
  for index in mini(int(c.size), ranked.size()):
    worked.append(ranked[index])
  return worked


# What the city yields in a turn: its worked tiles, the centre's bonus and the buildings. All zero while there is no city.
static func rates(state: Dictionary) -> Dictionary:
  var result := {"food": 0, "production": 0, "science": 0, "tiles": 0}
  var c := city(state)
  if c.is_empty():
    return result
  var worked := worked_tiles(state, c)
  for tile: Dictionary in worked:
    result.food += tile.food
    result.production += tile.production
    result.science += tile.science
  result.food += Rules.CENTER_FOOD
  result.production += Rules.CENTER_PRODUCTION
  result.science += Rules.CENTER_SCIENCE
  for building: String in c.buildings:
    var item: Dictionary = Rules.ITEMS[Rules.item_index(building)]
    result.food += item.food
    result.production += item.production
    result.science += item.science
  result.tiles = worked.size()
  return result


# The food a city of this size needs in stock to grow.
static func growth_needed(size: int) -> int:
  return size * Rules.GROWTH_PER_SIZE


# Whether the technology with this id has been researched.
static func tech_known(state: Dictionary, tech_id: String) -> bool:
  var index := Rules.tech_index(tech_id)
  return index >= 0 and index < int(state.research.done)


# Why set_production(item_id, slot) would be refused, or "" when it would be accepted. The order of the checks is the
# order the codes are documented in.
static func production_reason(state: Dictionary, item_id: String, slot: int) -> String:
  var c := city(state)
  if c.is_empty():
    return "no_city"
  var item_index := Rules.item_index(item_id)
  if item_index < 0:
    return "unknown_item"
  var item: Dictionary = Rules.ITEMS[item_index]
  if item.tech != "" and not tech_known(state, item.tech):
    return "tech_required"
  if item.kind == "building" and c.buildings.has(item_id):
    return "already_built"
  var queue: Array = c.queue
  if slot < 0 or slot > queue.size():
    return "bad_slot"
  if item.kind == "building":
    for queued_slot in queue.size():
      if queue[queued_slot] == item_id and queued_slot != slot:
        return "already_queued"
  if slot == queue.size() and queue.size() >= Rules.QUEUE_MAX:
    return "queue_full"
  return ""


# Why set_research(tech_id) would be refused, or "" when it would be accepted.
static func research_reason(state: Dictionary, tech_id: String) -> String:
  var index := Rules.tech_index(tech_id)
  if index < 0:
    return "unknown_tech"
  var done := int(state.research.done)
  if index < done:
    return "tech_known"
  if index > done:
    return "research_out_of_order"
  if state.research.current == tech_id:
    return "already_researching"
  return ""
