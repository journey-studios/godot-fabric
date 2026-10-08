extends RefCounted

# The end of a turn, in phases (Rules.PHASES). A phase is the unit a frame budget slices on: it reports how many tasks
# it ran and how many events it emitted, and the ceiling of 64 tasks and 128 events a phase is what the authority
# criterion of the services slice measures against. The phases are deterministic: the same state runs the same phase
# the same way, whether they run in one call or one per frame.
#
#   ai_plan     the scripted faction picks the next tile of its route
#   ai_move     its Warrior walks there, or waits when a player's unit stands on it
#   production  the city adds its production to the stock and finishes the item it can pay
#   growth      the city adds its food to the stock and grows when it can pay
#   research    the empire adds its science to the stock and learns the technology it can pay
#   refresh     units get their movement back, the turn number advances, the selection clears, the event is raised

const Rules := preload("rules.gd")
const World := preload("world.gd")
const Economy := preload("economy.gd")


# Runs the phase with this name on the state. Answers {"name", "tasks", "events"}.
static func run_phase(state: Dictionary, name: String) -> Dictionary:
  var before := int(state.log_seq)
  var tasks := 0
  match name:
    "ai_plan":
      tasks = _ai_plan(state)
    "ai_move":
      tasks = _ai_move(state)
    "production":
      tasks = _production(state)
    "growth":
      tasks = _growth(state)
    "research":
      tasks = _research(state)
    "refresh":
      tasks = _refresh(state)
  return {"name": name, "tasks": tasks, "events": int(state.log_seq) - before}


static func _ai_plan(state: Dictionary) -> int:
  var ai: Dictionary = state.ai
  if World.unit_by_id(state, int(ai.unit)).is_empty():
    return 0
  var next: Array = Rules.ROUTE[(int(ai.step) + 1) % Rules.ROUTE.size()]
  ai.tx = next[0]
  ai.ty = next[1]
  World.emit(state, "ai_planned", ai.tx, ai.ty)
  return 1


static func _ai_move(state: Dictionary) -> int:
  var ai: Dictionary = state.ai
  var unit := World.unit_by_id(state, int(ai.unit))
  if unit.is_empty():
    return 0
  if not World.units_at(state, int(ai.tx), int(ai.ty), Rules.OWNER_PLAYER).is_empty():
    World.emit(state, "ai_blocked", ai.tx, ai.ty)
    return 1
  unit.x = ai.tx
  unit.y = ai.ty
  ai.step = (int(ai.step) + 1) % Rules.ROUTE.size()
  World.emit(state, "ai_moved", ai.tx, ai.ty)
  return 1


# Production accumulates only while something is queued: with an empty queue it is lost, not banked.
static func _production(state: Dictionary) -> int:
  var city := Economy.city(state)
  if city.is_empty() or city.queue.is_empty():
    return 0
  var rates := Economy.rates(state)
  state.res.production = int(state.res.production) + int(rates.production)
  var item_index := Rules.item_index(city.queue[0])
  var item: Dictionary = Rules.ITEMS[item_index]
  if int(state.res.production) >= int(item.cost):
    state.res.production = int(state.res.production) - int(item.cost)
    city.queue.remove_at(0)
    if item.kind == "unit":
      state.units.append(World.make_unit(int(state.next_unit), Rules.OWNER_PLAYER, "warrior", city.x, city.y))
      state.next_unit = int(state.next_unit) + 1
    else:
      city.buildings.append(item.id)
    World.emit(state, "production_complete", item_index, item.cost)
  return int(rates.tiles) + 1


# Food accumulates until the city reaches its largest size; then the surplus is lost.
static func _growth(state: Dictionary) -> int:
  var city := Economy.city(state)
  if city.is_empty() or int(city.size) >= Rules.CITY_MAX_SIZE:
    return 0
  var rates := Economy.rates(state)
  state.res.food = int(state.res.food) + int(rates.food)
  var needed := Economy.growth_needed(int(city.size))
  if int(state.res.food) >= needed:
    state.res.food = int(state.res.food) - needed
    city.size = int(city.size) + 1
    World.emit(state, "city_grew", city.size, needed)
  return int(rates.tiles) + 1


# Science accumulates only while a technology is being researched; without one it is lost, not banked.
static func _research(state: Dictionary) -> int:
  var research: Dictionary = state.research
  if research.current == "":
    return 0
  var rates := Economy.rates(state)
  state.res.science = int(state.res.science) + int(rates.science)
  var index := int(research.done)
  var cost: int = Rules.TECHS[index].cost
  if int(state.res.science) >= cost:
    state.res.science = int(state.res.science) - cost
    research.done = index + 1
    research.current = ""
    World.emit(state, "tech_learned", index, cost)
  return int(rates.tiles) + 1


static func _refresh(state: Dictionary) -> int:
  for unit: Dictionary in state.units:
    unit.moves = Rules.UNITS[unit.kind].moves
  state.turn = int(state.turn) + 1
  state.sel = {"x": -1, "y": -1, "unit": 0}
  World.emit(state, "turn_started", state.turn, 0)
  var event: Dictionary = state.event
  if int(state.turn) == Rules.EVENT_TURN and int(event.pending) == 0 and int(event.resolved) == 0:
    event.pending = 1
    World.emit(state, "event_raised", state.turn, 0)
  return state.units.size()
