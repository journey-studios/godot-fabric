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
# a refused intent changed nothing and fires nothing.
#
# The turn is a job. `end_turn` is registered with the acceptance response (docs/GAME_SERVICES.md): it answers that the game
# took the turn, with the id of the job, and the turn goes on here, advancing one phase per frame, in this node's `_process` and never in
# the World or in a surface. So closing the HUD, going to the menu or dropping the World does not stop it, and it finishes on
# its own. The snapshot is published once when the turn is accepted (it shows the first `phase`) and once after each phase (it
# shows the next one, and the last shows the turn at rest). After the last phase `turn_ended` fires once, with the turn that
# begins, what each phase did and the job's id, ahead of the snapshot of the turn that begins, whose `last_job` is that id.
# Until then every intent is refused with `turn_in_progress` (the game's own rule). The ids rise by 1 from 1 for the life of
# the node and are in neither the state nor its hash; `new_game` abandons a job in progress, because the session it belonged
# to is gone, and no `turn_ended` fires for it. `finished_jobs` counts how many times each job finished. The job follows the
# game's clock: it stops while the tree is paused, like the rest of the game.
#
# The pointer. `frontier.hover` is a state of its own, the card of the tile under the pointer (the snapshot's `tile` DTO, with
# `present` 0 over no tile). The World, which hears the pointer, calls `set_hover` (and `refresh_hover` after each snapshot); they are
# not services and not part of the game, so the snapshot, its emission rule and the hashes are what they were. `hover_changed` fires
# when the hovered tile changes and when a snapshot changes what the card of the hovered tile says; a new game, the menu and a
# reload clear it.
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
const HOVER_NAME := PREFIX + "hover"
const WORLD_NAME := "World"
# How many finished jobs `finished_jobs` remembers: the node runs as long as the game does.
const FINISHED_KEPT := 256

signal snapshot_changed(snapshot: Dictionary)
signal hover_changed(card: Dictionary)
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
# The end-of-turn job in progress: its id, 0 when there is none, and what each phase of it did so far.
var job := 0
var job_phases: Array = []
# The next id. It is the node's, not the session's: it keeps rising across new games.
var next_job := 1
# The tile under the pointer, (-1, -1) over none, and the card last published for it.
var hover := Vector2i(-1, -1)
var hover_card: Dictionary = {}
# job id -> how many times it finished (exactly 1 for a job that finished well), for the last FINISHED_KEPT jobs.
var finished_jobs := {}


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
  bindings.append(services.bind_state(HOVER_NAME, get_hover, hover_changed, Schema.HOVER))
  registered.append({"name": HOVER_NAME, "kind": "state", "value": Schema.HOVER})
  bindings.append(services.bind_signal(TURN_ENDED_NAME, turn_ended, [Schema.TURN_ENDED]))
  registered.append({"name": TURN_ENDED_NAME, "kind": "signal", "args": [Schema.TURN_ENDED]})
  for method: String in Schema.METHOD_ARGS:
    var args: Array = Schema.METHOD_ARGS[method]
    var options: Dictionary = Schema.METHOD_OPTIONS.get(method, {})
    bindings.append(services.register_method(PREFIX + method, Callable(self, method), args, Schema.RESULT, options))
    registered.append({"name": PREFIX + method, "kind": "method", "args": args, "result": Schema.RESULT, "response": options.get("response", "completion")})


# --- State ---------------------------------------------------------------------------------------------------------

func get_snapshot() -> Dictionary:
  return game.snapshot()


# The card of the tile under the pointer; the absent card (`present` 0) over none.
func get_hover() -> Dictionary:
  return game.tile_card(hover.x, hover.y)


# The World reports the tile under the pointer: a coordinate outside the map is none. It publishes only a change.
func set_hover(x: int, y: int) -> void:
  var next := Vector2i(x, y) if (x >= 0 and x < Rules.MAP_W and y >= 0 and y < Rules.MAP_H) else Vector2i(-1, -1)
  if next == hover:
    return
  hover = next
  hover_card = get_hover()
  hover_changed.emit(hover_card)


# A published snapshot can change what the card of the hovered tile says (a unit moved onto it). The World, which hears every
# snapshot the node publishes, asks for the card again, and the node publishes it only if it changed.
func refresh_hover() -> void:
  if hover.x < 0:
    return
  var card := get_hover()
  if card != hover_card:
    hover_card = card
    hover_changed.emit(card)


# A new game, the menu or a reload: the World that heard the pointer is gone, and with it the tile it pointed at.
func _clear_hover() -> void:
  if hover.x < 0:
    return
  hover = Vector2i(-1, -1)
  hover_card = get_hover()
  hover_changed.emit(hover_card)


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


# Accepts the end of the turn as a job. The game starts the turn (`begin_end_turn`): its phase becomes the first one and every
# intent is refused until the last has run. The answer is the acceptance, with the job's id; a refusal (an event waiting, a
# turn already in progress) starts nothing and answers job 0. The snapshot is published once, because the state changed:
# it shows the first phase. `advance_job` does the rest, advancing one phase per frame.
func end_turn() -> Dictionary:
  _count("end_turn")
  var started: Dictionary = game.begin_end_turn()
  if started.ok == 0:
    return _plain(started)
  job = next_job
  next_job += 1
  job_phases = []
  snapshot_changed.emit(game.snapshot())
  return _plain(started, job)


# The job's driver: one phase of the end-of-turn job in progress per frame, and nothing when there is none.
func _process(_delta: float) -> void:
  advance_job()


# Runs the phase the turn is at and publishes the snapshot, which shows the next phase; after the last phase it finishes the
# job. A phase is the game's unit of work (at most 64 tasks and 128 events of its own, docs/research/frontier-game.md); the
# registry's budgets of one pump are a count of its own, which docs/research/frontier-services.md measures for each phase.
func advance_job() -> void:
  if job == 0:
    return
  var ran: Dictionary = game.advance_phase()
  job_phases.append({"name": ran.name, "tasks": ran.tasks, "events": ran.events})
  if ran.done == 0:
    snapshot_changed.emit(game.snapshot())
    return
  _finish_job()


# The turn is over: the job finishes exactly once. `turn_ended` goes out ahead of the snapshot of the turn that begins, and that
# snapshot carries the job as `last_job`.
func _finish_job() -> void:
  var finished := job
  var summary := {"turn": game.state.turn, "phases": job_phases, "job": finished}
  job = 0
  job_phases = []
  game.last_job = finished
  finished_jobs[finished] = int(finished_jobs.get(finished, 0)) + 1
  while finished_jobs.size() > FINISHED_KEPT:
    finished_jobs.erase(finished_jobs.keys()[0])
  turn_ended.emit(summary)
  snapshot_changed.emit(game.snapshot())


# The session the job was driving is gone: nothing finishes it and no `turn_ended` fires for it.
func _abandon_job() -> void:
  job = 0
  job_phases = []


# Starts a new session of the same scenario. The epoch rises by 1 and tells a HUD that every earlier snapshot is gone.
# If the scene has lost its World (the player went to the menu), the new session brings one back before it is published.
func new_game() -> Dictionary:
  _count("new_game")
  _abandon_job()
  epoch += 1
  game = Game.new(Rules.SEED, epoch)
  _clear_hover()
  _ensure_world()
  snapshot_changed.emit(game.snapshot())
  return _plain({"ok": 1, "code": "ok", "text": ""})


# The player left the game for the menu: the World goes out of the tree and is freed. It is not a rule of the game, so it
# changes no state, publishes no snapshot and leaves the epoch alone; a `new_game` brings the World back. A job in
# progress is not the World's: it goes on and finishes with the menu open.
func open_menu() -> Dictionary:
  _count("open_menu")
  _drop_world()
  return _plain({"ok": 1, "code": "ok", "text": ""})


# Replaces the World with a new one on a new session. Called by the scene's owner, not a service. The epoch goes on
# rising: the application, the registry and the bindings are this node's and are not recreated.
func reload_world() -> Dictionary:
  _drop_world()
  return new_game()


# --- The World -----------------------------------------------------------------------------------------------------

# The World comes back ahead of the HUD's layer: Godot offers the unhandled input to the last node of the tree first, and the HUD's
# Surface has to claim what React Native hits before the World hears it (docs/research/world-input.md). `add_child` alone would put
# it last, behind the HUD, and what the GUI lets through (the wheel over a panel, a hit slop) would reach the map.
func _ensure_world() -> void:
  if world_scene == null or get_node_or_null(WORLD_NAME) != null:
    return
  var world := world_scene.instantiate()
  world.name = WORLD_NAME
  add_child(world)
  for child in get_children():
    if child is CanvasLayer:
      move_child(world, child.get_index())
      break


func _drop_world() -> void:
  var world := get_node_or_null(WORLD_NAME)
  if world == null:
    return
  _clear_hover()
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


# The uniform result: exactly {ok, code, text, job}, with the job the call started (0 for every call that starts none).
func _plain(result: Dictionary, started_job: int = 0) -> Dictionary:
  return {"ok": result.ok, "code": result.code, "text": result.text, "job": started_job}
