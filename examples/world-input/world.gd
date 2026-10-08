extends Node2D

# The world of the pointer spike: a 24x16 map of 32-pixel tiles seen through a
# Camera2D at zoom 2, behind a React Native HUD. It listens in _unhandled_input,
# the last stop of an input event: after every _input and after the GUI, so it
# only hears what neither the HUD's Surface nor a Control claimed.
#
# The world listens to the MOUSE stream. A touch reaches an unhandled world as
# two events, the InputEventScreenTouch and the InputEventMouseButton Godot emulates
# from it (device -1, input_devices/pointing/emulate_mouse_from_touch, on by
# default), and acting on both would select a tile twice. Selecting on the mouse
# stream keeps one code path for a mouse and a finger; a game that needs
# multi-touch (a pinch to zoom the map) listens to InputEventScreenTouch and
# ScreenDrag and skips the mouse events whose device is
# InputEvent.DEVICE_ID_EMULATION. Both streams are still counted, so a probe can
# prove that a blocked touch reaches neither.
const TILE := 32
const COLUMNS := 24
const ROWS := 16

# Every event that reached _unhandled_input: [class, device, button or finger, pressed].
var received: Array = []
# Left-button presses, by the tile under the pointer.
var selected: Dictionary = {}
var last_tile := Vector2i(-1, -1)

func _unhandled_input(event: InputEvent) -> void:
  if event is InputEventMouseButton:
    received.append(["InputEventMouseButton", event.device, int(event.button_index), event.pressed])
    if event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
      select(tile_of(event))
  elif event is InputEventMouseMotion:
    received.append(["InputEventMouseMotion", event.device, 0, false])
  elif event is InputEventScreenTouch:
    received.append(["InputEventScreenTouch", event.device, event.index, event.pressed])
  elif event is InputEventScreenDrag:
    received.append(["InputEventScreenDrag", event.device, event.index, false])

# The tile under a pointer event, through the Camera2D: make_input_local undoes the
# canvas transform the camera sets.
func tile_of(event: InputEventMouse) -> Vector2i:
  var local: InputEventMouse = make_input_local(event)
  return Vector2i(floori(local.position.x / TILE), floori(local.position.y / TILE))

func select(tile: Vector2i) -> void:
  last_tile = tile
  selected[tile] = int(selected.get(tile, 0)) + 1
  queue_redraw()

func reset() -> void:
  received.clear()
  selected.clear()
  last_tile = Vector2i(-1, -1)
  queue_redraw()

# How many events of one class arrived; null for a field means any.
func count(event_class: String, pressed = null, button = null, device = null) -> int:
  var total := 0
  for row: Array in received:
    if row[0] != event_class:
      continue
    if pressed != null and row[3] != pressed:
      continue
    if button != null and row[2] != button:
      continue
    if device != null and row[1] != device:
      continue
    total += 1
  return total

func _draw() -> void:
  for column in range(COLUMNS):
    for row in range(ROWS):
      var odd := (column + row) % 2 == 1
      draw_rect(Rect2(column * TILE, row * TILE, TILE, TILE), Color(0.16, 0.30, 0.20) if odd else Color(0.20, 0.36, 0.24))
  for column in range(COLUMNS + 1):
    draw_line(Vector2(column * TILE, 0), Vector2(column * TILE, ROWS * TILE), Color(0, 0, 0, 0.25))
  for row in range(ROWS + 1):
    draw_line(Vector2(0, row * TILE), Vector2(COLUMNS * TILE, row * TILE), Color(0, 0, 0, 0.25))
  if last_tile.x >= 0:
    draw_rect(Rect2(last_tile.x * TILE, last_tile.y * TILE, TILE, TILE), Color(1.0, 0.85, 0.2, 0.7))
