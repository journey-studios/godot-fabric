extends Control

# Frontier's native HUD, arm B of the 0.5 comparison: the same six panels, seven contexts and testIDs as the React Native HUD (ui/hud/), written
# as Godot is written. It connects to the signals of the GameServices node, mounts the panels the context calls for and unmounts the others
# (a panel is made once and kept, out of the tree, for the next time), and sets a Control only when what it shows has changed. Like the React Native HUD it decides nothing of the game: the context, the
# actions and their reasons, the phase and the queue of events all come from the snapshot, and an intent is the game's own, sent back through
# the node's methods. The panels are scenes of their own (bar, actions, tile, city, research, dialog) with a `render(snapshot, hover)`; they
# raise `intent` and the HUD sends it.
#
#   none                bar
#   tile                bar, tile
#   settler, warrior    bar, actions, tile
#   stack               bar, actions (one select_unit per unit), tile
#   city                bar, city, research
#   dialog              bar, dialog
#
# The city screen with the research list, and the event dialog, are overlays (overlay.gd): blocking layers above the map, so under them
# nothing hears the pointer. The bar, the actions and the tile card are Controls that claim their own pixels, and this root claims none, so
# the map around them is the World's. A dialog is made for each event of the queue and freed when the head changes.

const Bar := preload("bar.tscn")
const Menu := preload("menu.tscn")
const Overlay := preload("overlay.gd")
const SCENES := {
  "actions": preload("actions.tscn"),
  "tile": preload("tile.tscn"),
  "city": preload("city.tscn"),
  "research": preload("research.tscn"),
  "dialog": preload("dialog.tscn"),
  "stress": preload("stress.tscn"),
}

# The context to panels table (ui/hud/hud.tsx, `panelsOf`); the bar is in all of them.
const PANELS := {
  "none": [],
  "tile": ["tile"],
  "settler": ["actions", "tile"],
  "warrior": ["actions", "tile"],
  "stack": ["actions", "tile"],
  "city": ["city", "research"],
  "dialog": ["dialog"],
}
# The panels each overlay holds. Every other panel is a Control of the tree, and the overlay is there exactly while one of its panels is.
const OVERLAYS := {"city": ["city", "research"], "dialog": ["dialog"]}

# The GameServices node the game plays on, by path (the scene sets it, as the Surface's application_path).
@export var services_path: NodePath

var services: Node

var _snapshot: Dictionary = {}
# The snapshot the panels last showed, set in `_show_game` and nowhere else: the one place that knows what the HUD has applied.
var _applied: Dictionary = {}
var _hover: Dictionary = {}
var _answer := ""
var _calls := 0
# What the runner reads in `stats()`: the snapshots applied and the notifications consumed (snapshots, hover cards and ends of turn), since boot.
var _snapshots := 0
var _events := 0
var _in_menu := false
# What is mounted: the bar, the menu, and the panels and overlays by name.
var _bar: Control
var _menu: Control
var _panels: Dictionary = {}
var _overlays: Dictionary = {}
# What was unmounted and is kept for the next time, by key.
var _pool: Dictionary = {}

@onready var _column: Control = $Column


func _enter_tree() -> void:
  services = get_node(services_path)
  services.snapshot_changed.connect(_on_snapshot_changed)
  services.hover_changed.connect(_on_hover_changed)
  services.turn_ended.connect(_on_turn_ended)
  _snapshot = services.get_snapshot()
  _hover = services.get_hover()
  # The HUD put back in the tree shows the game as it is now before its first frame.
  if is_node_ready():
    _render()


func _ready() -> void:
  _render()


func _exit_tree() -> void:
  if is_instance_valid(services):
    services.snapshot_changed.disconnect(_on_snapshot_changed)
    services.hover_changed.disconnect(_on_hover_changed)
    services.turn_ended.disconnect(_on_turn_ended)


# What the execution runner reads, in the shape the three arms share: how many snapshots the HUD applied since boot, the context it shows now,
# and how many notifications of the game it consumed (snapshots, hover cards and ends of turn). Three reads of variables: it costs no
# evaluation and no copy, so a runner may read it in a measured frame.
func stats() -> Dictionary:
  return {"snapshots": _snapshots, "context": String(_applied.get("context", "")), "events": _events}


# How many intents the HUD has sent: what the validation counts, apart from the runner's `stats()`.
func intents_sent() -> int:
  return _calls


# The snapshot the panels last showed. A runner that asks whether the HUD has caught up with the game compares it with the node's.
func applied_snapshot() -> Dictionary:
  return _applied


# The GUI hands a click to the Control under the pointer and marks it handled, but a tick of the wheel goes on to `_unhandled_input`, where the
# World would take it for the map's. A tick over a Control is the HUD's. This root comes after the World in the tree (the layer it is in
# does), and the node called last in the tree is called first, so it claims the tick before the World hears it.
func _unhandled_input(event: InputEvent) -> void:
  if event is InputEventMouseButton and get_viewport().gui_get_hovered_control() != null:
    get_viewport().set_input_as_handled()


func _on_snapshot_changed(snapshot: Dictionary) -> void:
  _snapshot = snapshot
  _snapshots += 1
  _events += 1
  _render()


func _on_hover_changed(card: Dictionary) -> void:
  _hover = card
  _events += 1
  if _panels.has("tile"):
    _panels.tile.render(_snapshot, _hover)


func _on_turn_ended(_summary: Dictionary) -> void:
  _events += 1


# --- Mounting --------------------------------------------------------------------------------------------------------------

func _render() -> void:
  if _in_menu:
    _show_menu()
  else:
    _show_game()


func _show_menu() -> void:
  _unmount_game()
  if _menu == null:
    _menu = Menu.instantiate()
    _menu.new_game_requested.connect(_new_game)
    add_child(_menu)


func _show_game() -> void:
  if _menu != null:
    _unmount("menu", _menu)
    _menu = null
  if _bar == null:
    _bar = _take("bar", _new_bar)
    add_child(_bar)
    _bar.show_answer(_answer)
  # The stress panel is the comparison's, not the table's: it is mounted in every context while the snapshot carries the mode.
  var wanted: Array = PANELS.get(_snapshot.context, []).duplicate()
  if _snapshot.has("stress"):
    wanted.append("stress")
  _sync_panels(wanted)
  _bar.render(_snapshot, _hover)
  for panel in _panels.values():
    panel.render(_snapshot, _hover)
  _applied = _snapshot


# Mounts the panels the context calls for and unmounts the others, with the overlay a panel lives in. A dialog is made for the head of the
# queue: when the head changes, the dialog of the previous event goes and a new one comes.
func _sync_panels(wanted: Array) -> void:
  for panel_name: String in _panels.keys():
    if not wanted.has(panel_name) or (panel_name == "dialog" and _panels.dialog.event_id != _snapshot.dialog.id):
      _unmount(panel_name, _panels[panel_name])
      _panels.erase(panel_name)
  for overlay_name: String in _overlays.keys():
    if not OVERLAYS[overlay_name].any(func(panel_name: String) -> bool: return wanted.has(panel_name)):
      _unmount("overlay-" + overlay_name, _overlays[overlay_name])
      _overlays.erase(overlay_name)
  for panel_name: String in SCENES:
    if wanted.has(panel_name) and not _panels.has(panel_name):
      var panel: Control = _take(panel_name, _new_panel.bind(panel_name))
      _parent_of(panel_name).add_child(panel)
      # Under the overlays and the bar, which come after the column.
      if panel_name == "stress":
        move_child(panel, _column.get_index() + 1)
      _panels[panel_name] = panel


# Where a panel is mounted: the actions in the column, the tile card in the tree, and the others inside their overlay, made when the first of
# its panels comes.
func _parent_of(panel_name: String) -> Node:
  for overlay_name: String in OVERLAYS:
    if OVERLAYS[overlay_name].has(panel_name):
      if not _overlays.has(overlay_name):
        _overlays[overlay_name] = _take("overlay-" + overlay_name, _new_overlay.bind(overlay_name))
        add_child(_overlays[overlay_name])
      return _overlays[overlay_name].content
  return _column if panel_name == "actions" else self


func _new_bar() -> Control:
  var bar: Control = Bar.instantiate()
  bar.intent.connect(_send)
  bar.menu_requested.connect(_open_menu)
  bar.new_game_requested.connect(_new_game)
  return bar


func _new_panel(panel_name: String) -> Control:
  var panel: Control = SCENES[panel_name].instantiate()
  # The tile card and the stress panel only show; the others send intents.
  if panel.has_signal(&"intent"):
    panel.intent.connect(_send)
  return panel


func _new_overlay(overlay_name: String) -> Overlay:
  var overlay: Overlay = Overlay.new()
  overlay.name = "hud-%s-overlay" % overlay_name
  overlay.centered = overlay_name == "dialog"
  # Escape closes the city screen, as its Close button does; on the dialog nothing is connected, because the event has to be answered.
  if overlay_name == "city":
    overlay.close_requested.connect(_send.bind(&"clear_selection", []))
  return overlay


func _unmount_game() -> void:
  for panel_name: String in _panels:
    _unmount(panel_name, _panels[panel_name])
  for overlay_name: String in _overlays:
    _unmount("overlay-" + overlay_name, _overlays[overlay_name])
  if _bar != null:
    _unmount("bar", _bar)
  _panels.clear()
  _overlays.clear()
  _bar = null


# A panel or an overlay is made once and kept: taken out of the tree it goes to the pool whole, with its Controls and the text they shaped, and the
# next time the context calls for it, mounting it is an add_child and a render that touches only what changed. The dialog and the menu are
# made each time (a new event is a subtree of its own) and are freed. Out of the tree at once, so that the names are free for what replaces it.
func _unmount(key: String, node: Node) -> void:
  node.get_parent().remove_child(node)
  if key == "dialog" or key == "menu":
    node.queue_free()
  else:
    _pool[key] = node


func _take(key: String, make: Callable) -> Node:
  var kept: Node = _pool.get(key)
  if kept == null:
    return make.call()
  _pool.erase(key)
  return kept


# What is in the pool is in no tree, so nothing frees it with the HUD.
func _notification(what: int) -> void:
  if what == NOTIFICATION_PREDELETE:
    for node: Node in _pool.values():
      node.free()


# --- Intents ---------------------------------------------------------------------------------------------------------------

# An intent is the game's own: the node validates it, and a refusal changes nothing and is shown in the bar.
func _send(method: StringName, args: Array) -> void:
  if not services.has_method(method):
    push_error("The HUD does not know the action %s" % method)
    return
  _call(method, args)


func _call(method: StringName, args: Array) -> Dictionary:
  _calls += 1
  var result: Dictionary = services.callv(method, args)
  _answer = "" if int(result.ok) == 1 else String(result.text)
  if _bar != null:
    _bar.show_answer(_answer)
  return result


func _open_menu() -> void:
  if int(_call(&"open_menu", []).ok) == 1:
    _in_menu = true
    _render()


func _new_game() -> void:
  if int(_call(&"new_game", []).ok) == 1:
    _in_menu = false
    _render()
