extends RefCounted

# Frontier: the constants and tables every rule reads. The game is original; only the interaction pattern of a
# turn-based map game is borrowed. Nothing here is a float: the state, the rules and the snapshot hold integers and
# strings only (docs/research/frontier-game.md).

const VERSION := 1
# The fixed scenario seed and the PCG32 stream selector it is paired with.
const SEED := 4242
const PRNG_SEQUENCE := 54

const MAP_W := 24
const MAP_H := 16

const OWNER_PLAYER := 1
const OWNER_AI := 2

const WATER := 0
const PLAIN := 1
const FOREST := 2
const HILL := 3

# Indexed by terrain id. `move` is the movement-point cost of entering the tile; 0 means a land unit cannot enter it.
const TERRAIN := [
  {"name": "Water", "food": 1, "production": 0, "science": 2, "move": 0},
  {"name": "Plain", "food": 2, "production": 1, "science": 0, "move": 1},
  {"name": "Forest", "food": 1, "production": 2, "science": 0, "move": 2},
  {"name": "Hill", "food": 0, "production": 2, "science": 1, "move": 2},
]

# The two unit kinds. `moves` is the movement-point allowance refreshed every turn.
const UNITS := {
  "settler": {"name": "Settler", "moves": 2},
  "warrior": {"name": "Warrior", "moves": 3},
}

# The city centre adds this on top of its own tile.
const CENTER_FOOD := 1
const CENTER_PRODUCTION := 1
const CENTER_SCIENCE := 2
const CITY_NAME := "Aurora"
const CITY_MAX_SIZE := 3
# A city of size n grows when the food stock reaches n * GROWTH_PER_SIZE.
const GROWTH_PER_SIZE := 10
const QUEUE_MAX := 3

# The production items. A building adds its yields to the city once built; a unit is spawned on the city tile.
const ITEMS := [
  {"id": "warrior", "label": "Warrior", "kind": "unit", "cost": 8, "tech": "", "food": 0, "production": 0, "science": 0},
  {"id": "granary", "label": "Granary", "kind": "building", "cost": 10, "tech": "alphabet", "food": 2, "production": 0, "science": 0},
  {"id": "workshop", "label": "Workshop", "kind": "building", "cost": 14, "tech": "bronze_working", "food": 0, "production": 2, "science": 0},
  {"id": "library", "label": "Library", "kind": "building", "cost": 16, "tech": "writing", "food": 0, "production": 0, "science": 2},
]

# The research list. It is linear: the next technology is the only one that can be researched.
const TECHS := [
  {"id": "alphabet", "label": "Alphabet", "cost": 6},
  {"id": "bronze_working", "label": "Bronze Working", "cost": 9},
  {"id": "writing", "label": "Writing", "cost": 12},
]

# The blocking events: a queue of three. All of them are raised together, in this order, when EVENT_TURN begins, once, and the player
# answers them one at a time, the head of the queue first. Each has choices of its own (a choice id belongs to one event, so the
# choice of another is refused as unknown), and each choice adds `amount` to one stock, plus a draw of `spread` from the game's PRNG
# when `spread` is not 0. Only welcoming the wanderers draws, so the PRNG's draws are what they were with the one event.
const EVENT_TURN := 5
const EVENTS := [
  {"id": "wanderers", "title": "Wanderers at the gate", "text": "A band of wanderers asks to settle beside your city.", "choices": [
    {"id": "welcome", "label": "Welcome them", "detail": "Food +6 to +9", "resource": "food", "amount": 6, "spread": 4},
    {"id": "turn_away", "label": "Turn them away", "detail": "Production +4", "resource": "production", "amount": 4, "spread": 0},
  ]},
  {"id": "traders", "title": "Traders at the crossroads", "text": "A caravan stops outside the walls and offers to sell what it carries.", "choices": [
    {"id": "buy_grain", "label": "Buy grain", "detail": "Food +3", "resource": "food", "amount": 3, "spread": 0},
    {"id": "buy_tools", "label": "Buy tools", "detail": "Production +3", "resource": "production", "amount": 3, "spread": 0},
  ]},
  {"id": "scholar", "title": "A scholar asks for shelter", "text": "A wandering scholar offers to teach in exchange for a roof.", "choices": [
    {"id": "host", "label": "Host the scholar", "detail": "Science +3", "resource": "science", "amount": 3, "spread": 0},
    {"id": "send_on", "label": "Send the scholar on", "detail": "Food +2", "resource": "food", "amount": 2, "spread": 0},
  ]},
]

# The scripted faction: its Warrior walks this closed route, one step a turn, and starts on the first tile.
const ROUTE := [[17, 8], [18, 8], [19, 8], [19, 9], [19, 10], [18, 10], [17, 10], [17, 9]]

# Where the player's Settler and Warrior start, stacked on one tile.
const START_X := 6
const START_Y := 8

# Terrain the scenario forces after the generator ran: [x, y, terrain]. The surroundings of the start, the city
# site (7, 8) and the route are fixed, so the scripted replay does not depend on what the generator drew there.
const SCENARIO_TILES := [
  [5, 7, 0], [5, 8, 0], [5, 9, 0],
  [6, 7, 1], [6, 8, 1], [6, 9, 1],
  [7, 7, 3], [7, 8, 2], [7, 9, 1],
  [8, 7, 2], [8, 8, 1], [8, 9, 3],
  [9, 8, 1], [9, 9, 1],
  [17, 8, 1], [18, 8, 1], [19, 8, 1], [19, 9, 1], [19, 10, 1], [18, 10, 1], [17, 10, 1], [17, 9, 1],
]

# The end of a turn runs these phases in order. A phase is the unit a frame budget slices on.
const PHASES := ["ai_plan", "ai_move", "production", "growth", "research", "refresh"]
const PHASE_TASK_LIMIT := 64
const PHASE_EVENT_LIMIT := 128
const LOG_MAX := 32

const CONTEXTS := ["none", "tile", "settler", "warrior", "stack", "city", "dialog"]

# Why an intent is refused: code -> text. The code is for programs, the text is what the HUD shows.
const REASONS := {
  "event_pending": "A decision is waiting. Resolve the event first.",
  "turn_in_progress": "The turn is being processed.",
  "no_turn_job": "No turn is being processed.",
  "unknown_unit": "No such unit.",
  "not_your_unit": "That unit belongs to another faction.",
  "out_of_bounds": "That tile is outside the map.",
  "nothing_selected": "Nothing is selected.",
  "not_adjacent": "The destination is not an adjacent tile.",
  "impassable_terrain": "Land units cannot enter water.",
  "tile_occupied": "A foreign unit blocks that tile.",
  "no_moves_left": "The unit has no movement points left.",
  "not_enough_moves": "Not enough movement points for that terrain.",
  "cannot_fortify": "Settlers cannot fortify.",
  "already_fortified": "The unit is already fortified.",
  "not_a_settler": "Only a Settler can found a city.",
  "city_exists": "This scenario allows a single city.",
  "too_close_to_edge": "A city needs open ground on every side.",
  "no_city": "There is no city to manage yet.",
  "unknown_item": "Unknown production item.",
  "tech_required": "Research the required technology first.",
  "already_built": "The city already has that building.",
  "already_queued": "That building is already in the queue.",
  "queue_full": "The production queue is full.",
  "bad_slot": "Pick an existing queue slot or the next free one.",
  "unknown_tech": "Unknown technology.",
  "tech_known": "That technology is already known.",
  "research_out_of_order": "Technologies are researched in list order.",
  "already_researching": "That technology is already being researched.",
  "no_event": "There is no event to resolve.",
  "unknown_choice": "That is not one of the choices.",
  # The comparison's stress mode, which is not a rule of the game (services/stress.gd).
  "stress_on": "The stress mode is already on.",
  "stress_off": "The stress mode is not on.",
}


static func reason_text(code: String) -> String:
  return REASONS.get(code, "")


static func item_index(item_id: String) -> int:
  for index in ITEMS.size():
    if ITEMS[index].id == item_id:
      return index
  return -1


static func event_index(event_id: String) -> int:
  for index in EVENTS.size():
    if EVENTS[index].id == event_id:
      return index
  return -1


static func tech_index(tech_id: String) -> int:
  for index in TECHS.size():
    if TECHS[index].id == tech_id:
      return index
  return -1
