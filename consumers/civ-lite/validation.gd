extends Node

# The consumer's own validation, run with `-- --validate` (scripts/consumer-civ-lite-check.mjs does): ten cycles of
#   (a) New game pressed on the HUD,                       (b) three intents of the roteiro through the HUD, the last of them
#                                                              the end of the turn, which is a job: it waits for the job to finish,
#   (c) the scene reloaded (the World dropped, a new one),  (d) the end of a turn and the menu pressed in the same frame: the
#                                                              job finishes with the menu open and the World stays out of the tree,
#   (e) New game pressed in the menu, back to the game.
# After each cycle, once the state it waited for has arrived (never a duration: a frame count is only the limit of a wait),
# it measures what a leak would grow: the nodes of the tree, the orphan nodes, the registry's bindings and subscriptions, its
# pending work, the connections of the services' signal, the connections the HUD holds, and the epoch, which must rise by
# exactly the new games of the cycle. The first cycle is the baseline; every later one has to come back to it. The per-cycle
# series go to civ-lite-report.json, which the check script keeps.
#
#   --capture    saves the screenshots of a headed run
#   --sabotage   a retained sabotage runs this scene: a failed check is the rejection, not an error

const CYCLES := 10
const BINDINGS := 14
# What the HUD sees of a turn that is processed: the phase of each snapshot as it changes, from the turn at rest to the turn at rest.
const PHASES_SEEN := ["ai_plan", "ai_move", "production", "growth", "research", "refresh", "idle"]
# The calls the HUD makes in a cycle: New game, three intents, the end of a turn, the menu, New game.
const CALLS_PER_CYCLE := 7
# New game (a), the reload (c) and New game in the menu (e): the epoch rises by this many in a cycle.
const NEW_GAMES_PER_CYCLE := 3
const REPORT := "res://civ-lite-report.json"
# The limit of a wait for state, in frames. A wait that reaches it is a failed check, not a pause.
const WAIT_FRAMES := 300
# The React effect that lets go of the snapshot runs right after the screen is replaced: a short limit is enough.
const CLEANUP_FRAMES := 30
# Pixels of the headed run: a unit marker of the map and the HUD panel's own background.
const PLAYER_COLOR := Color(0.38, 0.72, 0.98)
const PANEL_COLOR := Color(0.0588, 0.0902, 0.1647)

var checks: Array = []
var series: Array = []
var baseline: Dictionary = {}
var sabotage := false
var capture := false
var services: Node
var application: Node
var hud: Control
var epoch_before_cycles := 1


func check(condition: bool, message: String) -> bool:
  checks.append({"name": message, "passed": condition})
  if not condition and not sabotage:
    push_error("CONSUMER_CHECK_FAILED: " + message)
  return condition


# --- Reading the application and the HUD ---------------------------------------------------------------------------

func state() -> Dictionary:
  return JSON.parse_string(application.call("snapshot"))


func registry() -> Dictionary:
  var value: Variant = state().get("gameServices", {})
  return value if value is Dictionary else {}


# What the HUD counted. The counters (`resultCount`, `epochCount`, `problemCount`) count for the life of the HUD; the lists
# (`results`, `epochs`, `problems`) hold only the last few, so a cycle reads the tail that its counters say is new.
func hud_stats() -> Dictionary:
  var text: String = application.call("evaluate", "JSON.stringify(FrontierHud.stats())")
  var value: Variant = JSON.parse_string(text)
  return value if value is Dictionary else {"subscriptions": -1, "problems": ["FrontierHud is missing"], "problemCount": 1, "results": [],
    "resultCount": 0, "snapshots": 0, "epoch": -1, "epochs": [], "epochCount": 0, "turn": 0, "context": "", "screen": "", "calls": 0,
    "phase": "", "phaseCount": 0, "phases": [], "lastJob": -1}


func hud_epoch() -> int:
  return int(hud_stats().get("epoch", -1))


# The last `fresh` entries of a list the HUD keeps, `fresh` being how many its counter grew by.
func tail(kept: Array, fresh: int) -> Array:
  return kept.slice(maxi(kept.size() - fresh, 0))


# The HUD has the snapshot of the session the services hold now, a game that has just begun, and shows it.
func fresh_game_shown() -> bool:
  return hud_epoch() == int(services.epoch) and text("hud-turn") == "Turn 1 · epoch %d" % int(services.epoch)


func hud_tree() -> Dictionary:
  return JSON.parse_string(hud.call("snapshot"))


func text(id: String) -> String:
  for entry in hud_tree().nodes:
    if entry.testID == id:
      return entry.get("nativeText", "")
  return ""


func world() -> Node:
  return services.get_node_or_null("World")


# The World is connected to the services' snapshot signal.
func world_connected() -> bool:
  for connection in services.snapshot_changed.get_connections():
    if connection.callable.get_object() == world():
      return true
  return false


# The children of the services node that run the World's script: there must be one, never a second or a leftover.
func worlds() -> int:
  var count := 0
  for child in services.get_children():
    var script: Script = child.get_script()
    if script != null and script.resource_path.ends_with("/world/world.gd"):
      count += 1
  return count


# --- Waiting: for state, with a frame count only as the limit ------------------------------------------------------

func frames(count: int) -> void:
  for index in range(count):
    await get_tree().process_frame


func wait_until(condition: Callable, limit: int = WAIT_FRAMES) -> bool:
  for index in range(limit):
    if condition.call():
      return true
    await get_tree().process_frame
  return condition.call()


func button_ready(id: String) -> bool:
  return hud.find_child(id, true, false) != null


# Presses a button of the HUD as the user would, headless or headed: the mouse goes down on the centre of the Pressable's
# control and comes up, through the viewport, and Pressability turns that into onPress.
func press(id: String) -> bool:
  var control: Control = hud.find_child(id, true, false)
  if control == null:
    return false
  var motion := InputEventMouseMotion.new()
  motion.device = 1001
  motion.position = control.get_global_rect().get_center()
  get_viewport().push_input(motion, true)
  for down in [true, false]:
    var event := InputEventMouseButton.new()
    event.device = 1001
    event.position = motion.position
    event.button_index = MOUSE_BUTTON_LEFT
    event.pressed = down
    get_viewport().push_input(event, true)
    await frames(2)
  return true


# Presses buttons in one frame: every click goes into the viewport before any frame passes, so that the calls the HUD makes land in
# the same pump of the registry, in the order of the buttons.
func press_together(ids: Array) -> bool:
  var found := true
  for id: String in ids:
    var control: Control = hud.find_child(id, true, false)
    if control == null:
      found = false
      continue
    var motion := InputEventMouseMotion.new()
    motion.device = 1001
    motion.position = control.get_global_rect().get_center()
    get_viewport().push_input(motion, true)
    for down in [true, false]:
      var event := InputEventMouseButton.new()
      event.device = 1001
      event.position = motion.position
      event.button_index = MOUSE_BUTTON_LEFT
      event.pressed = down
      get_viewport().push_input(event, true)
  await frames(2)
  return found


# The HUD sends an intent with the function its buttons use, and the game answers it: one more result.
func send(id: String, args: Array) -> bool:
  var answered := int(hud_stats().resultCount)
  application.call("evaluate", "FrontierHud.send(%s, %s)" % [JSON.stringify(id), JSON.stringify(args)])
  return await wait_until(func() -> bool: return int(hud_stats().resultCount) > answered)


func epochs_seen_since(count: int) -> Array:
  var stats := hud_stats()
  return tail(stats.epochs, int(stats.epochCount) - count).map(func(value: Variant) -> int: return int(value))


# --- Measuring ----------------------------------------------------------------------------------------------------

func measure() -> Dictionary:
  var runtime := registry()
  var stats := hud_stats()
  return {
    "nodes": get_tree().get_node_count(),
    "orphans": int(Performance.get_monitor(Performance.OBJECT_ORPHAN_NODE_COUNT)),
    "objects": int(Performance.get_monitor(Performance.OBJECT_COUNT)),
    "bindings": int(runtime.get("bindings", -1)),
    "subscriptions": int(runtime.get("subscriptions", -1)),
    "pendingHostTasks": int(runtime.get("pendingHostTasks", -1)),
    "pendingEvents": int(runtime.get("pendingEvents", -1)),
    "connections": services.snapshot_changed.get_connections().size(),
    "hudSubscriptions": int(stats.get("subscriptions", -1)),
    "epoch": int(services.epoch),
    "hudEpoch": hud_epoch(),
    "worlds": worlds(),
  }


func near(a: Color, b: Color) -> bool:
  return absf(a.r - b.r) < 0.02 and absf(a.g - b.g) < 0.02 and absf(a.b - b.b) < 0.02


func capture_to(file: String) -> bool:
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  return image.save_png("res://" + file) == OK


# The capture of the game: a unit marker where the map draws one, and the HUD panel's colour where the HUD draws its own.
func capture_game() -> void:
  await frames(4)
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  var unit_at := Vector2i(24 + 6 * 24 + 11, 24 + 8 * 24 + 11)
  var hud_at := Vector2i(1060, 580)
  check(image.save_png("res://civ-lite-game.png") == OK, "Capture saved: the game with its World and its HUD")
  check(near(image.get_pixelv(unit_at), PLAYER_COLOR) and near(image.get_pixelv(hud_at), PANEL_COLOR),
    "Capture: the World's unit marker and the HUD panel are both on screen, the HUD over a transparent map area")


# --- The run ------------------------------------------------------------------------------------------------------

func _ready() -> void:
  var user_args := OS.get_cmdline_user_args()
  if not user_args.has("--validate"):
    return
  sabotage = user_args.has("--sabotage")
  capture = user_args.has("--capture")
  services = get_parent()
  application = services.get_node_or_null("Application/Runtime")
  hud = services.get_node_or_null("HUDLayer/HUD")
  if application == null or hud == null:
    push_error("CONSUMER_CHECK_FAILED: the scene has no running application or HUD")
    get_tree().quit(0 if sabotage else 1)
    return
  hud.set_meta("validation_input_device", 1001)
  run()


func run() -> void:
  var connected := await wait_until(func() -> bool: return int(hud_stats().get("snapshots", 0)) >= 1 and text("hud-turn") != "")
  var initial := state()
  var facade_injected := check(services.fabric_api != null and services.fabric_api.resource_path == "res://addons/godot_fabric/godot_fabric.gd",
    "The scene injects the addon's facade into the GameServices node: no path to a laboratory SDK")
  var evaluated := check(initial.bundleEvaluations == 1 and initial.errors.is_empty(), "The provisioned application evaluates its bundle once and reports no error")
  var registered := check(int(registry().get("bindings", -1)) == BINDINGS and registry().get("stopped") == false and services.registered.size() == BINDINGS,
    "The node registered the state, the signal and the 12 methods while the application entered the tree: 14 bindings")
  var scened := check(worlds() == 1 and world() != null and world().get_parent() == services, "The scene starts with one World, a child of the GameServices node")
  var shown := check(connected and text("hud-turn") == "Turn 1 · epoch 1" and int(hud_stats().subscriptions) == 1,
    "The public TSX HUD connected to the snapshot of epoch 1 with one subscription")
  var plain := check(not DirAccess.dir_exists_absolute("res://sdk") and not DirAccess.dir_exists_absolute("res://tests"), "The project is the template: no laboratory directory")
  epoch_before_cycles = int(services.epoch)

  # Nothing below can be observed through services that were not there: report what is known.
  if facade_injected and evaluated and registered and scened and shown and plain:
    for cycle in range(1, CYCLES + 1):
      await run_cycle(cycle)
    await finish_cycles()
  finish(initial)


func finish_cycles() -> void:
  var epochs := series.map(func(row: Dictionary) -> int: return int(row.epoch))
  var increasing := true
  for index in range(1, epochs.size()):
    if epochs[index] <= epochs[index - 1]:
      increasing = false
  check(increasing and int(services.epoch) == epoch_before_cycles + CYCLES * NEW_GAMES_PER_CYCLE and hud_epoch() == int(services.epoch),
    "The epoch only rose across the ten cycles: %d, then %d per cycle, to %d in Godot and in the HUD" % [epoch_before_cycles, NEW_GAMES_PER_CYCLE, int(services.epoch)])
  application.call("stop")
  await frames(4)
  var stopped := registry()
  check(stopped.get("stopped") == true and int(stopped.get("bindings", -1)) == 0 and int(stopped.get("subscriptions", -1)) == 0
    and int(stopped.get("pendingHostTasks", -1)) == 0 and int(stopped.get("pendingEvents", -1)) == 0,
    "Stopping the application releases the registry: no binding, subscription or pending work")
  check(services.snapshot_changed.get_connections().size() == 1, "After the stop the services' signal keeps only the World's connection")


func finish(initial: Dictionary) -> void:
  var report := {"schemaVersion": 1, "host": "independent-consumer", "displayServer": DisplayServer.get_name(), "sabotage": sabotage,
    "cycles": CYCLES, "newGamesPerCycle": NEW_GAMES_PER_CYCLE, "bindings": BINDINGS, "baseline": baseline, "series": series,
    "checks": checks, "beforeStop": initial, "afterStop": state()}
  var output := FileAccess.open(REPORT, FileAccess.WRITE)
  if output == null:
    push_error("CONSUMER_CHECK_FAILED: cannot write " + REPORT)
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  var failures := checks.filter(func(entry: Dictionary) -> bool: return not entry.passed)
  if failures.is_empty():
    print("CIVLITE_VALIDATION_PASSED")
  elif sabotage:
    print("CIVLITE_SABOTAGE_REJECTED: %d" % failures.size())
  else:
    print("CIVLITE_VALIDATION_FAILED")
  get_tree().quit(0 if failures.is_empty() or sabotage else 1)


func run_cycle(cycle: int) -> void:
  var label := "cycle %d" % cycle
  var epoch_start := int(services.epoch)
  var seen_start := int(hud_stats().epochCount)
  var results_start := int(hud_stats().resultCount)

  # (a) New game, pressed on the HUD.
  var pressed_new := await press("hud-new-game")
  await wait_until(func() -> bool: return int(services.epoch) == epoch_start + 1 and hud_epoch() == int(services.epoch))
  # (b) Three intents of the roteiro through the HUD: select the Settler, move it into the forest, end the turn.
  var selected := await send("select_unit", [1])
  await wait_until(func() -> bool: return hud_stats().context == "settler")
  var moved := await send("move_unit", [1, 7, 8])
  await wait_until(func() -> bool: return button_ready("action-end_turn") and text("hud-context").begins_with("Context: settler"))
  if capture and cycle == 1:
    await capture_game()
  # The end of the turn is a job: the game accepts it with an id, the HUD sees the turn go through its phases, and the job
  # finishes by itself. Nothing is pressed until the HUD has the turn at rest again with last_job = the job.
  var phases_start := int(hud_stats().phaseCount)
  var answered_before := int(hud_stats().resultCount)
  var ended := await press("action-end_turn")
  await wait_until(func() -> bool: return int(hud_stats().resultCount) > answered_before)
  var job_results: Array = hud_stats().results
  var job_id := int(job_results.back().job) if not job_results.is_empty() else 0
  await wait_until(func() -> bool: return job_id > 0 and int(hud_stats().lastJob) == job_id and int(hud_stats().turn) == 2 and text("hud-turn").begins_with("Turn 2"))
  var stats_after_job := hud_stats()
  var phases_of_job: Array = tail(stats_after_job.phases, int(stats_after_job.phaseCount) - phases_start)
  # (c) The scene reloaded: the World out of the tree and freed, a new one, a new game (the epoch rises).
  var reloaded_from := world()
  var reloaded_id := reloaded_from.get_instance_id() if reloaded_from != null else 0
  services.reload_world()
  await wait_until(func() -> bool: return world() != null and world().get_instance_id() != reloaded_id and fresh_game_shown())
  # (d) The end of a turn and the menu, pressed in the same frame: the World leaves the tree, the HUD shows the menu and lets go of
  # the snapshot, and the job the game accepted goes on and finishes with the menu open. The World stays out until a new game.
  var menu_from := world()
  var menu_id := menu_from.get_instance_id() if menu_from != null else 0
  var job_with_menu := int(services.next_job)
  var turn_with_menu := int(services.game.state.turn)
  var finished_before := int(services.finished_jobs.size())
  var opened := await press_together(["action-end_turn", "hud-menu"])
  await wait_until(func() -> bool: return hud_stats().screen == "menu" and world() == null and button_ready("menu-new-game"))
  await wait_until(func() -> bool: return int(hud_stats().subscriptions) == 0, CLEANUP_FRAMES)
  await wait_until(func() -> bool: return services.job == 0 and int(services.finished_jobs.get(job_with_menu, 0)) >= 1)
  await frames(CLEANUP_FRAMES)
  var in_menu := {"screen": hud_stats().screen, "world": world() != null, "hudSubscriptions": int(hud_stats().subscriptions)}
  var job_with_menu_report := {"job": job_with_menu, "finished": int(services.finished_jobs.get(job_with_menu, 0)), "running": int(services.job),
    "turnBefore": turn_with_menu, "turnAfter": int(services.game.state.turn), "nextJob": int(services.next_job), "world": world() != null,
    "finishedTotalBefore": finished_before, "finishedTotalAfter": int(services.finished_jobs.size())}
  if capture and cycle == 1:
    check(await capture_to("civ-lite-menu.png"), "Capture saved: the menu, with no World behind it")
  # (e) New game, pressed in the menu: the World is back, the HUD is on the game again with the new epoch.
  var started := await press("menu-new-game")
  await wait_until(func() -> bool: return hud_stats().screen == "game" and world() != null and fresh_game_shown())
  # The two dropped Worlds are freed at the end of their frame.
  await frames(2)

  var row := measure()
  row["cycle"] = cycle
  row["epochStart"] = epoch_start
  row["epochsSeen"] = epochs_seen_since(seen_start)
  row["menu"] = in_menu
  row["jobs"] = {"pressed": job_id, "phasesSeen": phases_of_job, "withMenu": job_with_menu_report}
  row["freed"] = [not is_instance_valid(instance_from_id(reloaded_id)), not is_instance_valid(instance_from_id(menu_id))]
  var stats := hud_stats()
  var cycle_results: Array = tail(stats.results, int(stats.resultCount) - results_start)
  row["results"] = cycle_results
  series.append(row)
  var runtime_errors: Array = state().errors

  check(pressed_new and selected and moved and ended and opened and started and cycle_results.size() == CALLS_PER_CYCLE
    and cycle_results.all(func(result: Dictionary) -> bool: return int(result.ok) == 1),
    label + ": the seven calls of the cycle (new game, three intents, end turn, open menu, new game) were made by the HUD and the game accepted them")
  # The calls in the order the game accepted them: new game, select, move, end turn (b), end turn (d), menu, new game.
  var end_turn_results: Array = cycle_results.filter(func(result: Dictionary) -> bool: return result.id == "frontier.end_turn")
  check(end_turn_results.size() == 2 and job_id > 0 and int(end_turn_results[0].job) == job_id and phases_of_job == PHASES_SEEN
    and int(stats_after_job.lastJob) == job_id and int(services.finished_jobs.get(job_id, 0)) == 1,
    label + ": the end of the turn pressed on the HUD was a job (accepted with an id): the HUD saw it go through every phase to rest, with last_job = the job, and the game finished it once")
  check(end_turn_results.size() == 2 and int(end_turn_results[1].job) == job_with_menu and int(job_with_menu_report.finished) == 1 and job_with_menu_report.running == 0
    and job_with_menu_report.turnAfter == job_with_menu_report.turnBefore + 1 and job_with_menu_report.nextJob == job_with_menu + 1 and not job_with_menu_report.world
    and job_with_menu_report.finishedTotalAfter == job_with_menu_report.finishedTotalBefore + 1
    and in_menu.hudSubscriptions == 0,
    label + ": the end of the turn pressed in the same frame as the menu finished with the menu open: once, the turn advanced, the World stayed out of the tree and the HUD held no connection")
  check(in_menu.screen == "menu" and in_menu.world == false and in_menu.hudSubscriptions == 0,
    label + ": in the menu the HUD showed it, the scene had no World and the HUD held no connection")
  check(row.freed == [true, true], label + ": the two Worlds the cycle dropped (the reload's and the menu's) are freed")
  check(row.bindings == BINDINGS, label + ": the registry still holds the 14 bindings")
  check(row.pendingHostTasks == 0 and row.pendingEvents == 0, label + ": no host task and no event is pending")
  check(runtime_errors.is_empty() and int(stats.problemCount) == 0, label + ": the application and the HUD report no error")
  check(row.worlds == 1 and world() != null and world().get_parent() == services and world_connected(),
    label + ": the scene holds exactly one World, subscribed to the session")
  check(row.epoch == epoch_start + NEW_GAMES_PER_CYCLE, label + ": the epoch rose by exactly the %d new games of the cycle: %d to %d" % [NEW_GAMES_PER_CYCLE, epoch_start, row.epoch])
  check(row.hudEpoch == row.epoch and row.epochsSeen == [epoch_start + 1, epoch_start + 2, epoch_start + 3],
    label + ": the HUD's epoch is Godot's, and the HUD saw the epochs rise one new game at a time")

  if cycle == 1:
    baseline = {"nodes": row.nodes, "orphans": row.orphans, "subscriptions": row.subscriptions, "connections": row.connections, "hudSubscriptions": row.hudSubscriptions}
    check(row.nodes > 0 and row.subscriptions >= 1 and row.connections >= 2 and row.hudSubscriptions == 1,
      label + ": the baseline is a fresh game on the game screen: one HUD subscription, the registry's connection and the World's")
    return
  check(row.nodes == baseline.nodes, label + ": the nodes of the tree are the first cycle's (%d)" % int(baseline.nodes))
  check(row.orphans == baseline.orphans, label + ": the orphan nodes are the first cycle's (%d)" % int(baseline.orphans))
  check(row.subscriptions == baseline.subscriptions, label + ": the registry's subscriptions are the first cycle's (%d)" % int(baseline.subscriptions))
  check(row.connections == baseline.connections, label + ": the connections of snapshot_changed are the first cycle's (%d)" % int(baseline.connections))
  check(row.hudSubscriptions == baseline.hudSubscriptions, label + ": the connections the HUD holds are the first cycle's (%d)" % int(baseline.hudSubscriptions))
