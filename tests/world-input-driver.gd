extends RefCounted

# The inputs of the pointer spike and what they leave behind, shared by the headless probe
# (world-input-probe.gd) and the windowed one (world-input-graphics-probe.gd).
#
# A burst queues n repetitions of its parts with Input.parse_input_event and delivers them at
# once with Input.flush_buffered_events: every count is exact and none depends on how many
# frames went by. The events carry no validation_input_device (that meta marks every other device
# as blocked); the pointer adapter ignores device -1, the mouse Godot emulates from a touch.
var world: Node2D
var app: Node
var surfaces: Array

func _init(world_node: Node2D, application: Node, surface_nodes: Array) -> void:
  world = world_node
  app = application
  surfaces = surface_nodes

# Waits until the condition holds, at most `limit` frames: the frames are a bound on a hang, not a measure.
func wait_for(condition: Callable, limit := 600) -> bool:
  for index in range(limit):
    if condition.call():
      return true
    await world.get_tree().process_frame
  return condition.call()

# The native node of a testID, from the snapshot of the Surfaces.
func node_by(test_id: String) -> Dictionary:
  for surface: Control in surfaces:
    var parsed: Variant = JSON.parse_string(surface.call("snapshot"))
    if parsed is Dictionary:
      for node: Dictionary in parsed.get("nodes", []):
        if node.get("testID") == test_id:
          return node
  return {}

# Every Surface has mounted its root and the bar's Pressable is a native node.
func mounted() -> bool:
  for surface: Control in surfaces:
    if int(surface.call("get_surface_id")) == 0:
      return false
  return not node_by("bar-button").is_empty()

# The tree overlay is a native node; the Modal is a visible host window with its content mounted.
func overlay_open(kind: String) -> bool:
  if kind == "tree":
    return not node_by("tree-overlay").is_empty()
  var modal := node_by("modal")
  return not modal.is_empty() and modal.get("modalWindow", {}).get("visible", false) == true and not node_by("modal-button").is_empty()

# Opens or closes the tree overlay or the Modal, and waits until it is so.
func set_overlay(kind: String, visible: bool) -> bool:
  app.call("evaluate", "WorldInputProbe.show('%s', %s)" % [kind, "true" if visible else "false"])
  return await wait_for(func() -> bool: return overlay_open(kind) == visible)

# A part is one interaction at a point, on a region of the HUD or of the world: a click, a right click, a wheel tick
# (press and release of the wheel button), a tap, the mouse Godot emulates from a touch on its own ("emulated": a left
# press and release with device -1), a bare pointer motion, or a drag (a touch, a ScreenDrag and the release).
static func part(region: String, input: String, at: Vector2, panel := "hud") -> Dictionary:
  return {"region": region, "input": input, "at": [at.x, at.y], "panel": panel}

# What the world hears of an input delivered n times, by stream: the mouse button's press and release, or a touch
# as ScreenTouch and as the mouse Godot emulates from it. The motion and the drag are not buttons: they have no stream.
static func stream_of(input: String, n: int) -> Dictionary:
  if input == "emulated":
    return {"emulated/press/1": n, "emulated/release/1": n}
  if input == "left":
    return {"mouse/press/1": n, "mouse/release/1": n}
  if input == "right":
    return {"mouse/press/2": n, "mouse/release/2": n}
  if input == "wheel":
    return {"mouse/press/4": n, "mouse/release/4": n}
  return {"touch/press": n, "touch/release": n, "emulated/press/1": n, "emulated/release/1": n}

func motion(at: Vector2) -> void:
  var event := InputEventMouseMotion.new()
  event.position = at
  event.global_position = at
  Input.parse_input_event(event)

func button_event(at: Vector2, button: int, pressed: bool, device := 0) -> void:
  var event := InputEventMouseButton.new()
  event.device = device
  event.position = at
  event.global_position = at
  event.button_index = button
  event.pressed = pressed
  event.button_mask = (1 << (button - 1)) if pressed else 0
  Input.parse_input_event(event)

func touch_event(at: Vector2, pressed: bool) -> void:
  var event := InputEventScreenTouch.new()
  event.index = 0
  event.position = at
  event.pressed = pressed
  Input.parse_input_event(event)

func drag_event(at: Vector2) -> void:
  var event := InputEventScreenDrag.new()
  event.index = 0
  event.position = at
  event.relative = Vector2(1, 0)
  Input.parse_input_event(event)

func inject(item: Dictionary) -> void:
  var at := Vector2(item.at[0], item.at[1])
  if item.input == "touch":
    touch_event(at, true)
    touch_event(at, false)
    return
  if item.input == "drag":
    touch_event(at, true)
    drag_event(at + Vector2(1, 0))
    touch_event(at, false)
    return
  if item.input == "motion":
    # Delivered on its own: consecutive motions in one flush are accumulated into a single event.
    motion(at)
    Input.flush_buffered_events()
    return
  if item.input == "emulated":
    # The mouse Godot emulates from a touch, on its own: the pointer adapter ignores device -1, the world does not.
    motion(at)
    button_event(at, MOUSE_BUTTON_LEFT, true, InputEvent.DEVICE_ID_EMULATION)
    button_event(at, MOUSE_BUTTON_LEFT, false, InputEvent.DEVICE_ID_EMULATION)
    return
  var button := MOUSE_BUTTON_LEFT
  if item.input == "right":
    button = MOUSE_BUTTON_RIGHT
  elif item.input == "wheel":
    button = MOUSE_BUTTON_WHEEL_UP
  motion(at)
  button_event(at, button, true)
  button_event(at, button, false)

# What the world heard, by stream: mouse and emulated-mouse presses and releases by button, touches.
func observe() -> Dictionary:
  var counts := {}
  for received: Array in world.received:
    var key := ""
    if received[0] == "InputEventMouseButton":
      key = ("emulated" if received[1] == -1 else "mouse") + "/" + ("press" if received[3] else "release") + "/" + str(received[2])
    elif received[0] == "InputEventScreenTouch":
      key = "touch/" + ("press" if received[3] else "release")
    if key != "":
      counts[key] = int(counts.get(key, 0)) + 1
  return counts

# The tiles the world selected, as "column,row" with how many times.
func tiles() -> Dictionary:
  var counts := {}
  for tile: Vector2i in world.selected:
    counts["%d,%d" % [tile.x, tile.y]] = int(world.selected[tile])
  return counts

# What the handlers of the HUD counted, from the fixture's global.
func rn_counts() -> Dictionary:
  var counts := {}
  var parsed: Variant = JSON.parse_string(app.call("evaluate", "JSON.stringify(WorldInputProbe.snapshot())"))
  if parsed is Dictionary:
    for key: String in parsed:
      counts[key] = int(parsed[key])
  return counts

# n repetitions of the parts, queued and delivered at once, with what each side heard.
func run(parts: Array, n: int) -> Dictionary:
  world.reset()
  app.call("evaluate", "WorldInputProbe.reset()")
  for index in range(n):
    for item: Dictionary in parts:
      inject(item)
  Input.flush_buffered_events()
  return {"parts": parts, "n": n, "world": observe(), "rn": rn_counts(), "tiles": tiles(), "motion": world.count("InputEventMouseMotion"),
    "drag": world.count("InputEventScreenDrag")}

# The control under the pointer after it moves to a point.
func hovered(at: Vector2) -> Control:
  motion(at)
  Input.flush_buffered_events()
  return world.get_viewport().gui_get_hovered_control()
