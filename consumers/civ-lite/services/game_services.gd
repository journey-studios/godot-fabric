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
# The facade. This node names no path to the SDK: whoever owns the scene injects `fabric_api`, the script of the facade
# (godot_fabric.gd). A provisioned consumer's main.tscn points it at the addon's copy; the laboratory's probe assigns the
# SDK source before the node enters the tree. Without it `_bind_services` fails loud and registers nothing.
#
# The scene. When the scene owner also sets `world_scene`, this node owns the life of the child named World, the map the
# session is drawn on: `new_game` brings one back if there is none, `open_menu` drops it, `reload_world` replaces it.
# Dropping a World is remove_child followed by queue_free, so that it is out of the tree at once and freed within the
# frame; the application, the registry, the bindings and the epoch are this node's and are never recreated. Without
# `world_scene` (the laboratory's probe) there is no World and these three leave it alone.
#
# Every schema comes from schema.gd. The names and shapes are documented in docs/research/frontier-services.md.

const Rules := preload("../game/rules.gd")
const Game := preload("../game/game.gd")
const Schema := preload("schema.gd")

const PREFIX := "frontier."
const SNAPSHOT_NAME := PREFIX + "snapshot"
const TURN_ENDED_NAME := PREFIX + "turn_ended"
const WORLD_NAME := "World"

signal snapshot_changed(snapshot: Dictionary)
signal turn_ended(summary: Dictionary)

# The script of the SDK facade (godot_fabric.gd), injected by the scene's owner.
@export var fabric_api: Script
# The scene of the map. Optional: a node without it has no World to manage.
@export var world_scene: PackedScene

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
  if fabric_api == null:
    push_error("FABRIC_ERROR: GameServices has no fabric_api; the scene's owner injects the facade script (godot_fabric.gd), so no service was registered")
    return
  var services = fabric_api.for_application(runtime)
  if services == null:
    push_error("FABRIC_ERROR: the facade refused the application; no service was registered")
    return
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
# If the scene has lost its World (the player went to the menu), the new session brings one back before it is published.
func new_game() -> Dictionary:
  _count("new_game")
  epoch += 1
  game = Game.new(Rules.SEED, epoch)
  _ensure_world()
  snapshot_changed.emit(game.snapshot())
  return {"ok": 1, "code": "ok", "text": ""}


# The player left the game for the menu: the World goes out of the tree and is freed. It is not a rule of the game, so it
# changes no state, publishes no snapshot and leaves the epoch alone; a `new_game` brings the World back.
func open_menu() -> Dictionary:
  _count("open_menu")
  _drop_world()
  return {"ok": 1, "code": "ok", "text": ""}


# Replaces the World with a new one on a new session. Called by the scene's owner, not a service. The epoch goes on
# rising: the application, the registry and the bindings are this node's and are not recreated.
func reload_world() -> Dictionary:
  _drop_world()
  return new_game()


# --- The World -----------------------------------------------------------------------------------------------------

func _ensure_world() -> void:
  if world_scene == null or get_node_or_null(WORLD_NAME) != null:
    return
  var world := world_scene.instantiate()
  world.name = WORLD_NAME
  add_child(world)


func _drop_world() -> void:
  var world := get_node_or_null(WORLD_NAME)
  if world == null:
    return
  remove_child(world)
  world.queue_free()


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
