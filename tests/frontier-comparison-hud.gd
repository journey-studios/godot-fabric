extends RefCounted

# What the scenario of the comparative execution (frontier-comparison-scenario.gd) knows of an arm: its scene, its HUD and the hooks the arms and the game may or may not have yet.
# The arms are the scenes of consumers/civ-lite: A is main_bare.tscn (the game, no HUD), B is main_native.tscn (the native Godot HUD, no host) and C is main.tscn (the React Native HUD).
#
# The HUD is read from its Controls and never from the Surface's snapshot (the `observation` rule of docs/research/frontier-turn.md, #108): the host names every Control it mounts by its
# testID and the native HUD names its own the same way, so `live_views()` is one walk of the SceneTree for both arms. A Control that counts is live (in the tree, not queued to be
# freed) and visible, the reading the context matrix of consumers/civ-lite/hud_probe.gd makes of the native HUD and of the host's.
#
# The hooks of the stress and events slice (docs/research/frontier-stress.md). They are detected by name; a hook that is not there is reported as missing and the window that needs it is
# recorded as unavailable, never invented:
#   the HUD of B                 stats() on `HUDLayer/HUD`: {snapshots: int, context: String, events: int}, cumulative; `events` counts the notifications the HUD consumed
#   the HUD of C                 the same stats() on the node `HudStats` of main.tscn, which reads the registry's native counters and evaluates no JavaScript
#   GameServices                 notifications_emitted() -> int, the same set on the side that emits
#   GameServices                 stress_begin(), stress_step(), stress_end(): the stress window's intents
const Driver := preload("world-input-driver.gd")
# The context matrix: the panels, the table of contexts to panels and the viewport of the game, written once in the consumer's probes.
const HudProbe := preload("res://hud_probe.gd")

const SCENES := {"A": "res://main_bare.tscn", "B": "res://main_native.tscn", "C": "res://main.tscn"}
const SIZE := HudProbe.SIZE
const PANELS := HudProbe.PANELS
const TABLE := HudProbe.TABLE
# The control that tells the contexts apart when they mount the same panels, as tests/frontier-turn-probe.gd has them.
const MARKERS := {"stack": "hud-actions-select_unit-2", "settler": "hud-actions-found_city-1", "warrior": "hud-actions-fortify-2"}
# The way the arms are told apart from their scene.
const WITH_HUD := ["B", "C"]

var arm: String
var tree: SceneTree
var services: Node
var hud: Control
# The node whose stats() the runner reads: the native HUD in B, `HudStats` in C, none in A.
var stats_source: Node
var _driver: Driver


func _init(scene_tree: SceneTree, arm_id: String) -> void:
  tree = scene_tree
  arm = arm_id


static func is_arm(arm_id: String) -> bool:
  return SCENES.has(arm_id)


# Puts the arm's scene in the root, the way the project's `run/main_scene` would.
func instantiate() -> void:
  var packed: PackedScene = load(SCENES[arm])
  services = packed.instantiate()
  tree.root.add_child(services)
  hud = services.get_node_or_null("HUDLayer/HUD") as Control
  stats_source = hud if arm == "B" else services.get_node_or_null("HudStats")


func has_hud() -> bool:
  return WITH_HUD.has(arm)


# The React Native host's runtime, or null before it exists (the addon creates it a frame after the scene is in the tree) and in the arms that have none.
func application() -> Node:
  return services.get_node_or_null("Application/Runtime")


# A headless window is 64x64 and the HUD is laid out for the game's 1080x600 (the consumer's own validations do the same, after a couple of frames, because the window sets its size later).
func fit_window() -> void:
  tree.root.size = SIZE
  if DisplayServer.get_name() != "headless":
    DisplayServer.window_set_size(SIZE)


# --- Reading the HUD ----------------------------------------------------------------------------------------------------------------

# The Controls of the HUD that are live and visible, by testID. One walk of the SceneTree; a Modal's Controls are children of its own Window, which is in the tree.
func live_views() -> Dictionary:
  var out := {}
  for view: Node in tree.root.find_children("hud-*", "Control", true, false):
    var control := view as Control
    if control != null and control.is_inside_tree() and not control.is_queued_for_deletion() and control.is_visible_in_tree():
      out[str(control.name)] = control
  return out


func panels_shown(live: Dictionary) -> Array:
  return PANELS.filter(func(id: String) -> bool: return live.has(id))


# The `parity` rule: the visible panels are exactly the context matrix's row of the context.
func parity_matches(context: String, live: Dictionary) -> bool:
  var expected: Array = TABLE[context]
  for id: String in PANELS:
    if live.has(id) != expected.has(id):
      return false
  return true


# The parity of a run, from the checks it made at rest: for each context it saw, whether the visible panels were the matrix's, and whether it saw all seven.
static func parity_summary(checks: Array) -> Dictionary:
  var contexts := {}
  var all_match := not checks.is_empty()
  for check: Dictionary in checks:
    contexts[check.context] = bool(contexts.get(check.context, true)) and bool(check.matches)
    all_match = all_match and bool(check.matches)
  var seen_all := true
  for context: String in TABLE.keys():
    seen_all = seen_all and contexts.has(context)
  return {"checked": checks.size(), "contexts": contexts, "matches": all_match and seen_all}


# The HUD shows a context: its panels and, for the contexts that mount the same panels, only its own marker (the arrival of a click, as tests/frontier-turn-probe.gd reads it).
func shows_context(context: String, live: Dictionary) -> bool:
  if not parity_matches(context, live):
    return false
  for other: String in MARKERS.keys():
    if live.has(MARKERS[other]) != (other == context):
      return false
  return true


# --- The pointer ----------------------------------------------------------------------------------------------------------------------

# A real click on a Control: the pointer spike's own injection (tests/world-input-driver.gd), a motion, a press and a release queued with Input.parse_input_event and delivered
# at once by Input.flush_buffered_events, at the centre of the Control's rectangle. The events carry no validation device: the Surface and the Controls hear them as a mouse.
func click(control: Control) -> void:
  if _driver == null:
    _driver = Driver.new(services.get_node("World"), application(), [])
  _driver.inject(Driver.part("latency", "left", control.get_global_rect().get_center()))
  Input.flush_buffered_events()


# --- The hooks ----------------------------------------------------------------------------------------------------------------------

func stats_available() -> bool:
  return stats_source != null and stats_source.has_method("stats")


# What stats() answers, or {} when the arm has no such method.
func stats() -> Dictionary:
  if not stats_available():
    return {}
  var value: Variant = stats_source.call("stats")
  return value if value is Dictionary else {}


# Why the event-burst window cannot be measured in this arm, or "" when it can. The window ends when what the consumers took in equals what the game emitted.
func event_burst_reason() -> String:
  if not services.has_method("notifications_emitted"):
    return "GameServices has no notifications_emitted() (the hook of the stress and events slice is not delivered)"
  if has_hud():
    if not stats_available():
      return "the HUD of arm %s has no stats() that the scenario can read from GDScript without evaluating JavaScript in a measured frame (B: HUDLayer/HUD, C: HudStats)" % arm
    if not stats().has("events"):
      return "stats() of the HUD of arm %s has no `events` counter" % arm
  return ""


# Why the stress window cannot be measured, or "" when it can.
func stress_reason() -> String:
  for name: String in ["stress_begin", "stress_step", "stress_end"]:
    if not services.has_method(name):
      return "GameServices has no %s() (the stress hooks are not delivered)" % name
  return ""


# The counters of the turn's notifications: what the game has emitted and, in B and C, what the HUD has taken in (-1 in A, which has no consumer).
func notification_counters() -> Dictionary:
  return {"emitted": int(services.call("notifications_emitted")), "consumed": int(stats().get("events", -1)) if has_hud() else -1}


# Whether every notification of the turn has been consumed. In B and C the HUD's counter must equal the emitter's. Arm A has no consumer, so the window is judged on the game's side
# alone: the emitter's counter has not moved since the previous reading (`previous_emitted`), which does not depend on whether the game counts a notification before or after it emits it.
func notifications_settled(counters: Dictionary, previous_emitted: int) -> bool:
  if has_hud():
    return int(counters.consumed) == int(counters.emitted)
  return int(counters.emitted) == previous_emitted
