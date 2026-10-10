extends RefCounted

# Frontier, the reference game of the 0.5 milestone: the entry point. Godot owns the map, the rules, the scripted
# faction and the turn; whoever drives it (the services that React calls) only sends intents and reads snapshots.
#
# An intent is validated, and either applied or refused with a code and a text, leaving the state untouched. The
# results are Dictionaries of integers and strings: {"ok": 1, "code": "ok", "text": ""} or {"ok": 0, "code": <reason>,
# "text": <what the HUD shows>}. The state is deterministic: the same seed and the same intents give the same state,
# byte for byte in its canonical form, on every run and every platform (docs/research/frontier-game.md).

const Rules := preload("rules.gd")
const World := preload("world.gd")
const Canon := preload("canon.gd")
const Intents := preload("intents.gd")
const Turn := preload("turn.gd")
const Context := preload("context.gd")
const Snapshot := preload("snapshot.gd")

# The rules' state. It is public so that tests can read it; only the intents below may change it.
var state: Dictionary
# The session's epoch: set by whoever owns the session, never part of the state or of its hash.
var epoch: int
# The id of the last end-of-turn job the session's owner finished, 0 for none. Like the epoch it belongs to the owner and
# reaches the snapshot, and it is never part of the state or of its hash.
var last_job: int = 0


func _init(seed_value: int = Rules.SEED, session_epoch: int = 1, existing: Dictionary = {}) -> void:
  epoch = session_epoch
  state = existing if not existing.is_empty() else World.new_state(seed_value)


# --- Intents ---------------------------------------------------------------------------------------------------

func select_tile(x: int, y: int) -> Dictionary:
  return _decide(Intents.check_select_tile(state, x, y), func() -> void: Intents.apply_select_tile(state, x, y))


func select_unit(unit_id: int) -> Dictionary:
  return _decide(Intents.check_select_unit(state, unit_id), func() -> void: Intents.apply_select_unit(state, unit_id))


func clear_selection() -> Dictionary:
  return _decide(Intents.check_clear_selection(state), func() -> void: Intents.apply_clear_selection(state))


func move_unit(unit_id: int, x: int, y: int) -> Dictionary:
  return _decide(Intents.check_move_unit(state, unit_id, x, y), func() -> void: Intents.apply_move_unit(state, unit_id, x, y))


func found_city(unit_id: int) -> Dictionary:
  return _decide(Intents.check_found_city(state, unit_id), func() -> void: Intents.apply_found_city(state, unit_id))


func fortify(unit_id: int) -> Dictionary:
  return _decide(Intents.check_fortify(state, unit_id), func() -> void: Intents.apply_fortify(state, unit_id))


# The Settler irrigates the Plain it stands on: the tile yields one more food from now on, and the Settler has no moves left this turn.
func irrigate(unit_id: int) -> Dictionary:
  return _decide(Intents.check_irrigate(state, unit_id), func() -> void: Intents.apply_irrigate(state, unit_id))


# Puts an item in a slot of the city's queue: slot 0 is what it is building, and a slot equal to the queue's length
# appends.
func set_production(item_id: String, slot: int) -> Dictionary:
  return _decide(Intents.check_set_production(state, item_id, slot), func() -> void: Intents.apply_set_production(state, item_id, slot))


func set_research(tech_id: String) -> Dictionary:
  return _decide(Intents.check_set_research(state, tech_id), func() -> void: Intents.apply_set_research(state, tech_id))


func resolve_event(choice_id: String) -> Dictionary:
  return _decide(Intents.check_resolve_event(state, choice_id), func() -> void: Intents.apply_resolve_event(state, choice_id))


# Ends the turn: every phase of Rules.PHASES runs, in order, before this returns. The result lists what each phase did.
func end_turn() -> Dictionary:
  var started := begin_end_turn()
  if started.ok == 0:
    return started
  var phases := []
  while state.phase != "idle":
    var ran := advance_phase()
    phases.append({"name": ran.name, "tasks": ran.tasks, "events": ran.events})
  return _accept({"turn": state.turn, "phases": phases})


# --- The turn in slices ----------------------------------------------------------------------------------------

# Starts the end of the turn without running anything: the state's `phase` becomes the first phase, and every intent but
# advance_phase is refused until the last phase has run. This is what a frame budget drives, one phase per frame.
func begin_end_turn() -> Dictionary:
  var reason := Intents.check_end_turn(state)
  if reason != "":
    return _refuse(reason)
  state.phase = Rules.PHASES[0]
  return _accept({"phase": state.phase})


# Runs the phase the turn is at and moves to the next. {"name", "tasks", "events"} describe what ran; "done" is 1 when
# it was the last phase and the turn is over.
func advance_phase() -> Dictionary:
  if state.phase == "idle":
    return _refuse("no_turn_job")
  var ran := Turn.run_phase(state, state.phase)
  var next := Rules.PHASES.find(state.phase) + 1
  state.phase = Rules.PHASES[next] if next < Rules.PHASES.size() else "idle"
  return _accept({"name": ran.name, "tasks": ran.tasks, "events": ran.events, "done": 1 if state.phase == "idle" else 0})


# --- Reads -----------------------------------------------------------------------------------------------------

# The immutable DTO the HUD projects.
func snapshot() -> Dictionary:
  return Snapshot.build(state, epoch, last_job)


func context() -> String:
  return Context.derive(state)


# The card of one tile, the DTO of the snapshot's `tile`: frontier.hover publishes it for the tile under the pointer. It reads the
# state and changes nothing, and the pointer is no part of the state or of its hash.
func tile_card(x: int, y: int) -> Dictionary:
  var card := Snapshot.tile_card(state, x, y)
  Snapshot.freeze(card)
  return card


# The canonical serialization of the state, or "" if it holds anything the game's data may not hold.
func serialize() -> String:
  return Canon.encode(state)


# The SHA-256 of the canonical serialization: the hash the golden replay fixes.
func state_hash() -> String:
  return Canon.state_hash(state)


# A game with a deep copy of this state and the same epoch and last job, for asking what an intent would do.
func duplicate_game() -> RefCounted:
  var copy: RefCounted = get_script().new(int(state.seed), epoch, state.duplicate(true))
  copy.last_job = last_job
  return copy


# --- Results ---------------------------------------------------------------------------------------------------

func _decide(reason: String, apply: Callable) -> Dictionary:
  if reason != "":
    return _refuse(reason)
  apply.call()
  return _accept()


func _refuse(code: String) -> Dictionary:
  return {"ok": 0, "code": code, "text": Rules.reason_text(code)}


func _accept(extra: Dictionary = {}) -> Dictionary:
  var result := {"ok": 1, "code": "ok", "text": ""}
  result.merge(extra)
  return result
