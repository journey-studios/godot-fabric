extends Node

# What the three HUD probes share (hud_validation.gd, overlay_validation.gd and stability_validation.gd, each run by
# tests/civ-lite-ui-native.test.mjs with its own flag): reading the HUD's tree as the native host reports it, waiting for state, playing
# the replay through the services, pushing real pointer events through the viewport (single ones and bursts), and the report. A probe
# drives the real game scene and writes what the HUD showed as raw observations, which the lane's oracle judges again on its own; it
# decides nothing the HUD should decide. The HUD is read through a reader (hud_reader.gd), the one seam between a probe and the HUD it
# looks at: the React Native HUD's reader takes its rows from the host's snapshot (hud_reader_host.gd), the native HUD's from its Controls
# (hud_reader_native.gd), and the scene says which of the two it is (`Application/Runtime` is the host's). The probes run unchanged on both.
#
#   --capture    saves the screenshots of a headed run
#   --sabotage   a retained sabotage or the control runs this scene: a failed check is the rejection, not an error

const Replay := preload("game/replay.gd")
const HostReader := preload("hud_reader_host.gd")
const NativeReader := preload("hud_reader_native.gd")

const SIZE := Vector2i(1080, 600)
const DEVICE := 1001
# The limit of a wait for state, in frames. A wait that reaches it is a failed check, not a pause.
const WAIT_FRAMES := 90
const MAP_ORIGIN := Vector2(24, 24)
const MAP_TILE := 24
# Real pointer events of one kind that a burst pushes at the map: what an overlay must keep from the World.
const CLICKS := 100
const PANELS := ["hud-bar", "hud-actions", "hud-tile", "hud-city", "hud-research", "hud-dialog"]
const TABLE := {
  "none": ["hud-bar"],
  "tile": ["hud-bar", "hud-tile"],
  "settler": ["hud-bar", "hud-actions", "hud-tile"],
  "warrior": ["hud-bar", "hud-actions", "hud-tile"],
  "stack": ["hud-bar", "hud-actions", "hud-tile"],
  "city": ["hud-bar", "hud-city", "hud-research"],
  "dialog": ["hud-bar", "hud-dialog"],
}

var checks: Array = []
var report: Dictionary = {}
var sabotage := false
var capture := false
var services: Node
var application: Node
var hud: Control
var reader: RefCounted


func check(condition: bool, message: String) -> bool:
  checks.append({"name": message, "passed": condition})
  if not condition and not sabotage:
    push_error("CONSUMER_CHECK_FAILED: " + message)
  return condition


# --- Reading the HUD ------------------------------------------------------------------------------------------------

# Every Control of the HUD that has a testID and is on screen, with its text, its place, whether it stops the pointer, whether it is
# disabled and whether it is inside the blocking overlay; and, apart, every Control that stops the pointer, testID or not. Which Controls
# those are is the reader's to say (hud_reader.gd).
func observe() -> Dictionary:
  return reader.observe()


# The Control the HUD mounted for a testID, wherever it is. Null when there is none.
func control_of(id: String) -> Control:
  return reader.control_of(id)


func find_node(seen: Dictionary, id: String) -> Dictionary:
  for entry: Dictionary in seen.nodes:
    if entry.testID == id:
      return entry
  return {}


func text_of(seen: Dictionary, id: String) -> String:
  return find_node(seen, id).get("text", "")


func shown(seen: Dictionary, id: String) -> bool:
  var entry := find_node(seen, id)
  return not entry.is_empty() and entry.visible


func panels_shown(seen: Dictionary) -> Array:
  return PANELS.filter(func(id: String) -> bool: return shown(seen, id))


# The Pressables of the actions panel, in the order they are drawn: the testID holds the action's id and arguments.
func rendered_actions(seen: Dictionary) -> Array:
  var rows: Array = []
  for entry: Dictionary in seen.nodes:
    var id: String = entry.testID
    if not id.begins_with("hud-actions-") or id.ends_with("-label") or id.ends_with("-reason") or id.ends_with("-icon") or id == "hud-actions-title":
      continue
    rows.append({"key": id.trim_prefix("hud-actions-"), "label": text_of(seen, id + "-label"), "enabled": not entry.disabled,
      "reason": text_of(seen, id + "-reason"), "x": entry.rect[0], "y": entry.rect[1]})
  rows.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.y < b.y or (a.y == b.y and a.x < b.x))
  return rows.map(func(row: Dictionary) -> Dictionary: return {"key": row.key, "label": row.label, "enabled": row.enabled, "reason": row.reason})


# What the game says the actions panel lists: the snapshot's actions but End turn, which lives on the bar.
func expected_actions(snapshot: Dictionary) -> Array:
  var rows: Array = []
  for action: Dictionary in snapshot.actions:
    if action.id == "end_turn":
      continue
    var key: String = action.id
    for argument in action.args:
      key += "-" + str(int(argument))
    rows.append({"key": key, "label": action.label, "enabled": int(action.enabled) == 1, "reason": "" if int(action.enabled) == 1 else action.reason_text})
  return rows


# The HUD shows the state of the snapshot: its panels, its actions, its turn and phase.
func shows(snapshot: Dictionary) -> bool:
  var seen := observe()
  var expected: Array = TABLE.get(snapshot.context, [])
  return (panels_shown(seen) == expected and text_of(seen, "hud-bar-turn") == "Turn %d · epoch %d" % [int(snapshot.turn), int(snapshot.epoch)]
    and text_of(seen, "hud-bar-phase") == snapshot.phase and (not expected.has("hud-actions") or rendered_actions(seen) == expected_actions(snapshot)))


# End turn is the game's `end_turn` action: disabled exactly when the game says it is, with the game's reason beside it; the spinner is there
# exactly while the phase is not idle.
func bar_matches(seen: Dictionary, snapshot: Dictionary) -> bool:
  var end_turn: Dictionary = snapshot.actions.filter(func(action: Dictionary) -> bool: return action.id == "end_turn")[0]
  var enabled := int(end_turn.enabled) == 1
  var button := find_node(seen, "hud-bar-end-turn")
  return (not button.is_empty() and button.visible and button.disabled == (not enabled)
    and text_of(seen, "hud-bar-end-turn-reason") == ("" if enabled else end_turn.reason_text)
    and shown(seen, "hud-turn-spinner") == (snapshot.phase != "idle"))


func game_snapshot() -> Dictionary:
  return services.game.snapshot()


func world() -> Node:
  return services.get_node_or_null("World")


# --- Waiting: for state, with a frame count only as the limit --------------------------------------------------------

func frames(count: int) -> void:
  for index in range(count):
    await get_tree().process_frame


func wait_until(condition: Callable, limit: int = WAIT_FRAMES) -> bool:
  for index in range(limit):
    if condition.call():
      return true
    await get_tree().process_frame
  return condition.call()


# The HUD has caught up with the game: it shows the snapshot the services hold now, and keeps showing it.
func settle() -> bool:
  var reached := await wait_until(func() -> bool: return shows(game_snapshot()))
  await frames(3)
  return reached and shows(game_snapshot())


# One step of the replay played through the services, waiting for the job when it is an end turn that the game accepted.
func play_step(index: int) -> void:
  var move: Dictionary = Replay.STEPS[index]
  var result: Dictionary = services.callv(move.intent, move.args)
  if move.intent == "end_turn" and int(result.ok) == 1:
    await wait_until(func() -> bool: return int(services.job) == 0)


# A fresh game played through the services up to the step, waiting for the jobs of the end turns, and the HUD caught up.
func play_to(step: int) -> void:
  services.new_game()
  await settle()
  for index in range(step + 1):
    await play_step(index)
  await settle()


func hud_stats() -> Dictionary:
  return reader.stats()


# --- The pointer ----------------------------------------------------------------------------------------------------

func move_to(point: Vector2) -> void:
  var motion := InputEventMouseMotion.new()
  motion.device = DEVICE
  motion.position = point
  motion.global_position = point
  get_viewport().push_input(motion, true)
  await frames(2)


# One tick of the wheel: the mouse button event Godot makes of it, pressed and released.
func wheel_at(point: Vector2) -> void:
  await move_to(point)
  for down in [true, false]:
    var event := InputEventMouseButton.new()
    event.device = DEVICE
    event.position = point
    event.global_position = point
    event.button_index = MOUSE_BUTTON_WHEEL_UP
    event.pressed = down
    event.factor = 1.0
    get_viewport().push_input(event, true)
    await frames(2)


func click_at(point: Vector2) -> void:
  await move_to(point)
  for down in [true, false]:
    var event := InputEventMouseButton.new()
    event.device = DEVICE
    event.position = point
    event.global_position = point
    event.button_index = MOUSE_BUTTON_LEFT
    event.pressed = down
    get_viewport().push_input(event, true)
    await frames(2)


# The Escape key, pressed and released through the viewport.
func press_escape() -> void:
  for down in [true, false]:
    var event := InputEventKey.new()
    event.keycode = KEY_ESCAPE
    event.physical_keycode = KEY_ESCAPE
    event.pressed = down
    get_viewport().push_input(event, true)
    await frames(2)


func centre_of(id: String) -> Vector2:
  var control := control_of(id)
  return control.get_global_rect().get_center() if control != null else Vector2(-1, -1)


# A point inside a panel's border and padding, where it has no child: a click there is a click on the panel itself.
func corner_of(id: String) -> Vector2:
  var control := control_of(id)
  return control.get_global_rect().position + Vector2(4, 4) if control != null else Vector2(-1, -1)


func rect_of(id: String) -> Array:
  var control := control_of(id)
  if control == null:
    return [0, 0, 0, 0]
  var rect := control.get_global_rect()
  return [rect.position.x, rect.position.y, rect.size.x, rect.size.y]


# How many calls the game's methods have counted, all together.
func total_calls() -> int:
  return int(services.callbacks.values().reduce(func(total: int, count: int) -> int: return total + count, 0))


func heard_now() -> Dictionary:
  var node := world()
  return node.heard.duplicate() if node != null else {}


func press(id: String) -> bool:
  var control := control_of(id)
  if control == null:
    return false
  await click_at(control.get_global_rect().get_center())
  return true


func tile_centre(x: int, y: int) -> Vector2:
  return MAP_ORIGIN + Vector2(x, y) * MAP_TILE + Vector2(MAP_TILE, MAP_TILE) * 0.5


# Real pointer events of one kind over the map, `count` of them on tiles that cycle through it, all pushed before a frame passes: the
# World hears them in `_unhandled_input` or does not, and nothing in the HUD needs a frame to decide that.
func burst(kind: String, count: int) -> Dictionary:
  var before := heard_now()
  var selects_before := int(services.callbacks.get("select_tile", 0))
  var selection_before: Dictionary = game_snapshot().selection.duplicate()
  for index in range(count):
    var point := tile_centre(2 + index % 20, 2 + int(index / 20.0) % 12)
    var motion := InputEventMouseMotion.new()
    motion.device = DEVICE
    motion.position = point
    motion.global_position = point
    get_viewport().push_input(motion, true)
    for down in [true, false]:
      var event := InputEventMouseButton.new()
      event.device = DEVICE
      event.position = point
      event.global_position = point
      event.button_index = {"left": MOUSE_BUTTON_LEFT, "right": MOUSE_BUTTON_RIGHT, "wheel": MOUSE_BUTTON_WHEEL_UP}[kind]
      event.pressed = down
      get_viewport().push_input(event, true)
  await frames(4)
  return {"kind": kind, "count": count, "heardBefore": before, "heardAfter": heard_now(), "selectCalls": int(services.callbacks.get("select_tile", 0)) - selects_before,
    "selectionBefore": selection_before, "selectionAfter": game_snapshot().selection.duplicate()}


func bursts() -> Array:
  var rows: Array = []
  for kind in ["left", "right", "wheel"]:
    rows.append(await burst(kind, CLICKS))
  return rows


func reached(row: Dictionary) -> bool:
  return int(row.heardAfter.buttons) - int(row.heardBefore.buttons) == 2 * int(row.count)


func silent(row: Dictionary) -> bool:
  return row.heardAfter == row.heardBefore and row.selectCalls == 0 and row.selectionAfter == row.selectionBefore


func capture_to(file: String) -> bool:
  await RenderingServer.frame_post_draw
  var image := get_viewport().get_texture().get_image()
  return image.save_png("res://" + file) == OK


# --- The run --------------------------------------------------------------------------------------------------------

# What a probe says about itself: the flag that runs it, the file its report goes to and the marker its verdict prints.
func flag() -> String:
  return ""


func report_path() -> String:
  return ""


func marker() -> String:
  return ""


# What the probe does once the HUD is up.
func run_probe() -> void:
  pass


func _ready() -> void:
  var user_args := OS.get_cmdline_user_args()
  if not user_args.has(flag()):
    return
  sabotage = user_args.has("--sabotage")
  capture = user_args.has("--capture")
  services = get_parent()
  application = services.get_node_or_null("Application/Runtime")
  hud = services.get_node_or_null("HUDLayer/HUD")
  # The scene with an Application is the React Native HUD's; without one, the HUD is the native one's.
  if hud == null or (application == null and not hud.has_method("stats")):
    push_error("CONSUMER_CHECK_FAILED: the scene has no HUD, or a HUD this probe does not read")
    get_tree().quit(0 if sabotage else 1)
    return
  reader = NativeReader.new(hud) if application == null else HostReader.new(hud, application)
  reader.prepare(DEVICE)
  # A headless run has a 64x64 window; the HUD is laid out for the game's 1080x600.
  get_tree().root.size = SIZE
  run()


func run() -> void:
  # Whatever HUD is mounted shows something with a testID once it has the first snapshot; what it shows is judged by the probe.
  var connected := await wait_until(func() -> bool: return not observe().nodes.is_empty())
  check(connected, "The HUD mounted for the game's first snapshot")
  report = {"schemaVersion": 1, "arm": reader.arm(), "displayServer": DisplayServer.get_name(), "capture": capture, "sabotage": sabotage, "viewport": [SIZE.x, SIZE.y],
    "map": {"origin": [MAP_ORIGIN.x, MAP_ORIGIN.y], "tile": MAP_TILE, "columns": 24, "rows": 16}}
  if connected:
    await run_probe()
  finish()


func finish() -> void:
  report["checks"] = checks
  var output := FileAccess.open(report_path(), FileAccess.WRITE)
  if output == null:
    push_error("CONSUMER_CHECK_FAILED: cannot write " + report_path())
    get_tree().quit(1)
    return
  output.store_string(JSON.stringify(report, "  ") + "\n")
  output.close()
  var failures := checks.filter(func(entry: Dictionary) -> bool: return not entry.passed)
  if failures.is_empty():
    print(marker() + "_PASSED")
  elif sabotage:
    print(marker() + "_REJECTED: %d" % failures.size())
  else:
    print(marker() + "_FAILED")
  get_tree().quit(0 if failures.is_empty() or sabotage else 1)
