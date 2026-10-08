extends Node

# Frontier's GameServices: the persistent node that owns one FrontierGame session and publishes it to React over the
# typed services (docs/GAME_SERVICES.md). Godot keeps the map, the rules and the turn; React projects the snapshot this
# node publishes and sends the intents it exposes as methods. Nothing here decides a rule: an intent is the game's own,
# validated by the game, and a refusal changes nothing.
#
# Lifecycle. The node registers every service from `Application.runtime_available`, connected in `_enter_tree` as
# consumers/minimal/game.gd does: that signal fires while the application enters the tree, before any surface mounts and
# before the bundle evaluates, and `_ready` would be too late. The bindings belong to this node and the application, not
# to a surface: unmounting and remounting a FabricSurface leaves the bindings, the state and the epoch as they were.
# `_exit_tree` removes them.
#
# Epoch. The session's epoch is an integer that lives here. It starts at 1 and `new_game` raises it by 1; it is handed to
# the game, so it reaches the snapshot, and it never enters the state or its hash.
#
# Emission. `snapshot_changed` fires once after every accepted intent and every new game, carrying the whole snapshot;
# a refused intent changed nothing and fires nothing. `turn_ended` fires after an accepted end_turn, before that turn's
# `snapshot_changed`, with the turn that begins and what each phase did.
#
# Every schema comes from schema.gd. The names and shapes are documented in docs/research/frontier-services.md.

const Rules := preload("../game/rules.gd")
const Game := preload("../game/game.gd")
const Schema := preload("schema.gd")
# The laboratory keeps the SDK sources behind .gdignore, so the root project reaches the facade by path; an installed
# addon exposes the same script as the global GodotFabric class, which is what a provisioned consumer swaps this for.
const FabricAPI := preload("res://sdk/addon/godot_fabric.gd")

const PREFIX := "frontier."
const SNAPSHOT_NAME := PREFIX + "snapshot"
const TURN_ENDED_NAME := PREFIX + "turn_ended"

signal snapshot_changed(snapshot: Dictionary)
signal turn_ended(summary: Dictionary)

# The session: whoever holds it can read it, only the intents below change it.
var game: RefCounted
var epoch := 1
# How many times each method's GDScript callback ran. A call the schema rejects never gets here.
var callbacks := {}
var bindings: Array = []
# What was registered, in order: {name, kind, ...schemas}. The probe reports it for the parity test.
var registered: Array = []


func _init() -> void:
  game = Game.new(Rules.SEED, epoch)


func _enter_tree() -> void:
  $Application.runtime_available.connect(_bind_services)


func _exit_tree() -> void:
  for binding in bindings:
    if is_instance_valid(binding):
      binding.remove()
  bindings.clear()
  registered.clear()


func _bind_services(runtime: Node) -> void:
  var services = FabricAPI.for_application(runtime)
  bindings.append(services.bind_state(SNAPSHOT_NAME, get_snapshot, snapshot_changed, Schema.SNAPSHOT))
  registered.append({"name": SNAPSHOT_NAME, "kind": "state", "value": Schema.SNAPSHOT})
  bindings.append(services.bind_signal(TURN_ENDED_NAME, turn_ended, [Schema.TURN_ENDED]))
  registered.append({"name": TURN_ENDED_NAME, "kind": "signal", "args": [Schema.TURN_ENDED]})
  for method: String in Schema.METHOD_ARGS:
    var args: Array = Schema.METHOD_ARGS[method]
    bindings.append(services.register_method(PREFIX + method, Callable(self, method), args, Schema.RESULT))
    registered.append({"name": PREFIX + method, "kind": "method", "args": args, "result": Schema.RESULT})


# --- State ---------------------------------------------------------------------------------------------------------

func get_snapshot() -> Dictionary:
  return game.snapshot()


# --- Intents -------------------------------------------------------------------------------------------------------

func select_tile(x: int, y: int) -> Dictionary:
  return _intent("select_tile", game.select_tile(x, y))


func select_unit(unit_id: int) -> Dictionary:
  return _intent("select_unit", game.select_unit(unit_id))


func clear_selection() -> Dictionary:
  return _intent("clear_selection", game.clear_selection())


func move_unit(unit_id: int, x: int, y: int) -> Dictionary:
  return _intent("move_unit", game.move_unit(unit_id, x, y))


func found_city(unit_id: int) -> Dictionary:
  return _intent("found_city", game.found_city(unit_id))


func fortify(unit_id: int) -> Dictionary:
  return _intent("fortify", game.fortify(unit_id))


func set_production(item_id: String, slot: int) -> Dictionary:
  return _intent("set_production", game.set_production(item_id, slot))


func set_research(tech_id: String) -> Dictionary:
  return _intent("set_research", game.set_research(tech_id))


func resolve_event(choice_id: String) -> Dictionary:
  return _intent("resolve_event", game.resolve_event(choice_id))


# Ends the turn. The game answers with the turn and the phases; the method's result is the uniform one, and those two go
# out on `turn_ended`, ahead of the snapshot of the turn that begins.
func end_turn() -> Dictionary:
  var result: Dictionary = game.end_turn()
  _count("end_turn")
  if result.ok == 1:
    turn_ended.emit({"turn": result.turn, "phases": result.phases})
    snapshot_changed.emit(game.snapshot())
  return _plain(result)


# Starts a new session of the same scenario. The epoch rises by 1 and tells a HUD that every earlier snapshot is gone.
func new_game() -> Dictionary:
  _count("new_game")
  epoch += 1
  game = Game.new(Rules.SEED, epoch)
  snapshot_changed.emit(game.snapshot())
  return {"ok": 1, "code": "ok", "text": ""}


# --- Results -------------------------------------------------------------------------------------------------------

# An accepted intent changed the state, so the snapshot is published once; a refused one changed nothing.
func _intent(method: String, result: Dictionary) -> Dictionary:
  _count(method)
  if result.ok == 1:
    snapshot_changed.emit(game.snapshot())
  return _plain(result)


func _count(method: String) -> void:
  callbacks[method] = int(callbacks.get(method, 0)) + 1


# The uniform result: exactly {ok, code, text}.
func _plain(result: Dictionary) -> Dictionary:
  return {"ok": result.ok, "code": result.code, "text": result.text}
