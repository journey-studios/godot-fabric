extends Node2D

# The scenery of a Frontier session: the 24x16 map drawn tile by tile (one draw_rect each, in the colour of its terrain), the
# city and the units as markers, and the selected tile outlined. It decides no rule: it reads the session of its parent, the
# GameServices node, and draws what it finds (the terrain, the units and the city of services.game.state, the selection of
# the snapshot). When the node publishes a snapshot it draws again.
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

var services: Node


func _enter_tree() -> void:
  services = get_parent()
  if services == null or not services.has_signal("snapshot_changed"):
    push_error("FABRIC_ERROR: the World belongs under the GameServices node, which publishes snapshot_changed")
    services = null
    return
  services.snapshot_changed.connect(_on_snapshot_changed)


func _exit_tree() -> void:
  if services != null and services.snapshot_changed.is_connected(_on_snapshot_changed):
    services.snapshot_changed.disconnect(_on_snapshot_changed)
  services = null


func _on_snapshot_changed(_snapshot: Dictionary) -> void:
  queue_redraw()


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
