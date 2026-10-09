extends RefCounted

# The one GDScript source of the Frontier service schemas: the snapshot DTO and its parts, the signal the end of a turn
# emits, the arguments of every method and their result. game_services.gd registers from here and nowhere else repeats
# a schema. The shapes are the DTO documented in docs/research/frontier-game.md, in the registry's schema language
# (docs/GAME_SERVICES.md): scalars are "integer" and "string"; `{"array": schema}` and `{"object": {field: schema}}` are
# exact, with no optional field and no union. The TypeScript mirror is consumers/civ-lite/ui/frontier-types.ts, and
# tests/frontier-services-parity.test.mjs compares the two in both directions.

const INT := "integer"
const STR := "string"

# --- The snapshot and its parts -----------------------------------------------------------------------------------

const SELECTION := {"object": {"x": INT, "y": INT, "unit": INT}}
const STOCK := {"object": {"stock": INT, "rate": INT}}
const RESOURCES := {"object": {"food": STOCK, "production": STOCK, "science": STOCK}}
# `args` are the intent's positional arguments, an array of integers: [unit_id] or [], so that an action is a call with no
# knowledge of which intent takes what.
const ACTION_ARGS := {"array": INT}
const ACTION := {"object": {"id": STR, "label": STR, "args": ACTION_ARGS, "enabled": INT, "reason": STR, "reason_text": STR}}
const UNIT_CARD := {"object": {"id": INT, "owner": INT, "kind": STR, "name": STR, "moves": INT, "max_moves": INT, "fortified": INT}}
const TILE_CARD := {"object": {"present": INT, "x": INT, "y": INT, "terrain": INT, "terrain_name": STR, "food": INT, "production": INT,
  "science": INT, "move_cost": INT, "city": INT, "units": {"array": UNIT_CARD}}}
const QUEUE_ENTRY := {"object": {"slot": INT, "item": STR, "label": STR, "cost": INT, "stock": INT}}
const ITEM := {"object": {"id": STR, "label": STR, "kind": STR, "cost": INT, "tech": STR, "enabled": INT, "reason": STR, "reason_text": STR}}
const GARRISON_ENTRY := {"object": {"id": INT, "kind": STR}}
const CITY_SCREEN := {"object": {"present": INT, "name": STR, "x": INT, "y": INT, "size": INT, "max_size": INT, "food_needed": INT,
  "food_rate": INT, "production_rate": INT, "science_rate": INT, "queue": {"array": QUEUE_ENTRY}, "queue_max": INT,
  "items": {"array": ITEM}, "buildings": {"array": STR}, "garrison": {"array": GARRISON_ENTRY}}}
const TECH := {"object": {"id": STR, "label": STR, "cost": INT, "state": STR, "enabled": INT, "reason": STR, "reason_text": STR}}
const RESEARCH := {"object": {"current": STR, "known": INT, "needed": INT, "rate": INT, "techs": {"array": TECH}}}
const CHOICE := {"object": {"id": STR, "label": STR, "detail": STR}}
const DIALOG := {"object": {"open": INT, "id": STR, "title": STR, "text": STR, "choices": {"array": CHOICE}}}
const SNAPSHOT := {"object": {"version": INT, "epoch": INT, "turn": INT, "phase": STR, "context": STR, "selection": SELECTION,
  "resources": RESOURCES, "actions": {"array": ACTION}, "tile": TILE_CARD, "city": CITY_SCREEN, "research": RESEARCH, "dialog": DIALOG}}

# --- The end of a turn ---------------------------------------------------------------------------------------------

const TURN_PHASE := {"object": {"name": STR, "tasks": INT, "events": INT}}
const TURN_ENDED := {"object": {"turn": INT, "phases": {"array": TURN_PHASE}}}

# --- Methods -------------------------------------------------------------------------------------------------------

# Every method answers the same object, so the schema needs no union: `ok` is 0 or 1, `code` is "ok" or the refusal
# code, `text` is what the HUD shows ("" when accepted). What an intent adds (end_turn's phases) goes out as a signal.
const RESULT := {"object": {"ok": INT, "code": STR, "text": STR}}

# The arguments of each method, in order. The registered name is "frontier." plus the key.
const METHOD_ARGS := {
  "select_tile": [INT, INT],
  "select_unit": [INT],
  "clear_selection": [],
  "move_unit": [INT, INT, INT],
  "found_city": [INT],
  "fortify": [INT],
  "set_production": [STR, INT],
  "set_research": [STR],
  "resolve_event": [STR],
  "end_turn": [],
  "new_game": [],
  # Not a rule of the game: the scene drops its World (game_services.gd). It is here so that HUD and scene share one list.
  "open_menu": [],
}
