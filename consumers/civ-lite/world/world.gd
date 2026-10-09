extends Node2D

# The scenery of a Frontier session: the 24x16 map drawn tile by tile (one draw_rect each, in the colour of its terrain), the
# city and the units as markers, the selected tile outlined and the tile under the pointer outlined lighter. It decides no rule:
# it reads the session of its parent, the GameServices node, and draws what it finds (the terrain, the units and the city of
# services.game.state, the selection of the snapshot, the hovered tile of the node). When the node publishes a snapshot or the
# hovered tile changes it draws again.
#
# The pointer. The map is the Godot side of the screen, so the pointer on it is Godot's: a left click on a tile asks the node for
# the game's own `select_tile` (Godot to Godot: the rules stay in GDScript and the HUD only sees the snapshot that follows), and the
# mouse moving over the map tells the node which tile is under it (`set_hover`, published as the state `frontier.hover`). The
# World listens in `_unhandled_input`, after the GUI, so it only hears what neither a Control nor the HUD's Surface claimed; the
# Surface claims what React Native's hit test finds, which is why this node has to come before the HUD's layer in the tree
# (docs/research/world-input.md; GameServices keeps it there when it brings a World back). It listens to the MOUSE stream: a touch
# reaches it as the emulated mouse Godot makes from it, so one code path serves a mouse and a finger. The motion over a panel never
# gets here (the panel's Control stops it), so a pointer that leaves the map for a panel, or for outside the window, clears the
# hover in `_process` and `_notification`.
#
# Lifetime. The World belongs to the scene, the session does not: GameServices drops it for the menu and for a reload
# (remove_child, then queue_free) and brings a new one back. What the World wires it unwires in `_exit_tree`. The engine drops
# a connection whose target is a freed Node by itself, so this is symmetry and not the thing that prevents a leak: it leaves no
# handler on a World that is out of the tree and still alive until the end of the frame. The consumer's cycles count the
# connections of the services' signal and the nodes, which is the guard.

const Rules := preload("../game/rules.gd")

const TILE := 24
const GAP := 1
const TERRAIN_COLORS := {
  Rules.WATER: Color(0.11, 0.25, 0.42),
  Rules.PLAIN: Color(0.36, 0.55, 0.28),
  Rules.FOREST: Color(0.16, 0.37, 0.22),
  Rules.HILL: Color(0.55, 0.45, 0.30),
}
const PLAYER_COLOR := Color(0.38, 0.72, 0.98)
const AI_COLOR := Color(0.93, 0.36, 0.33)
const CITY_COLOR := Color(0.98, 0.84, 0.30)
const SELECTION_COLOR := Color(1, 1, 1)
const HOVER_COLOR := Color(1, 0.88, 0.35, 0.9)

var services: Node
# How many mouse button and motion events this node heard, for a probe that proves a click on a panel did not reach the map.
var heard := {"buttons": 0, "motions": 0}


func _enter_tree() -> void:
  services = get_parent()
  if services == null or not services.has_signal("snapshot_changed"):
    push_error("FABRIC_ERROR: the World belongs under the GameServices node, which publishes snapshot_changed")
    services = null
    return
  services.snapshot_changed.connect(_on_snapshot_changed)
  services.hover_changed.connect(_on_hover_changed)


func _exit_tree() -> void:
  if services != null and services.snapshot_changed.is_connected(_on_snapshot_changed):
    services.snapshot_changed.disconnect(_on_snapshot_changed)
  if services != null and services.hover_changed.is_connected(_on_hover_changed):
    services.hover_changed.disconnect(_on_hover_changed)
  services = null


func _on_snapshot_changed(_snapshot: Dictionary) -> void:
  queue_redraw()
  # What the card of the hovered tile says can change with the state (a unit moved onto it): the node publishes it again if so.
  services.refresh_hover()


func _on_hover_changed(_card: Dictionary) -> void:
  queue_redraw()


# --- The pointer --------------------------------------------------------------------------------------------------

func _unhandled_input(event: InputEvent) -> void:
  if services == null:
    return
  if event is InputEventMouseButton:
    heard.buttons += 1
    if event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
      var tile := tile_of(event)
      if on_map(tile):
        services.select_tile(tile.x, tile.y)
  elif event is InputEventMouseMotion:
    heard.motions += 1
    var tile := tile_of(event)
    services.set_hover(tile.x, tile.y)


# A pointer that is over a Control (a panel of the HUD) is not over the map, and the motion over a Control does not reach
# `_unhandled_input` to say so.
func _process(_delta: float) -> void:
  if services != null and services.hover.x >= 0 and get_viewport().gui_get_hovered_control() != null:
    services.set_hover(-1, -1)


func _notification(what: int) -> void:
  if what == NOTIFICATION_WM_MOUSE_EXIT and services != null:
    services.set_hover(-1, -1)


# The tile under a pointer event, whatever the canvas transform: make_input_local undoes it.
func tile_of(event: InputEventMouse) -> Vector2i:
  var local: InputEventMouse = make_input_local(event)
  return Vector2i(floori(local.position.x / TILE), floori(local.position.y / TILE))


func on_map(tile: Vector2i) -> bool:
  return tile.x >= 0 and tile.x < Rules.MAP_W and tile.y >= 0 and tile.y < Rules.MAP_H


func _draw() -> void:
  if services == null:
    return
  var state: Dictionary = services.game.state
  var terrain: Array = state.map.terrain
  for y in Rules.MAP_H:
    for x in Rules.MAP_W:
      draw_rect(Rect2(x * TILE, y * TILE, TILE - GAP, TILE - GAP), TERRAIN_COLORS[terrain[y * Rules.MAP_W + x]])
  for city: Dictionary in state.cities:
    draw_rect(Rect2(city.x * TILE + 4, city.y * TILE + 4, TILE - GAP - 8, TILE - GAP - 8), CITY_COLOR)
  for unit: Dictionary in state.units:
    var centre := Vector2(unit.x * TILE + TILE * 0.5 - GAP * 0.5, unit.y * TILE + TILE * 0.5 - GAP * 0.5)
    draw_circle(centre, TILE * 0.28, PLAYER_COLOR if unit.owner == Rules.OWNER_PLAYER else AI_COLOR)
  var selection: Dictionary = state.sel
  if int(selection.x) >= 0:
    draw_rect(Rect2(selection.x * TILE, selection.y * TILE, TILE - GAP, TILE - GAP), SELECTION_COLOR, false, 2.0)
  if services.hover.x >= 0:
    draw_rect(Rect2(services.hover.x * TILE + 1, services.hover.y * TILE + 1, TILE - GAP - 2, TILE - GAP - 2), HOVER_COLOR, false, 1.0)
