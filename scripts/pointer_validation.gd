extends "res://scripts/validation_base.gd"

func at(id: String, offset := Vector2.ZERO) -> Vector2:
  var control: Control = surface.find_child(id, true, false)
  return control.get_global_rect().get_center() + offset

func mouse(phase: String, position: Vector2) -> void:
  # Refresh Godot's GUI hover after pointerEvents changes, even if the physical
  # pointer position is unchanged. The negative control must activate the Button.
  if phase == "start":
    var motion := InputEventMouseMotion.new()
    motion.device = 1001
    motion.position = position
    get_viewport().push_input(motion, true)
  if phase == "move":
    var motion := InputEventMouseMotion.new()
    motion.device = 1001
    motion.position = position
    motion.button_mask = MOUSE_BUTTON_MASK_LEFT
    get_viewport().push_input(motion, true)
  else:
    var event := InputEventMouseButton.new()
    event.device = 1001
    event.position = position
    event.button_index = MOUSE_BUTTON_LEFT
    event.pressed = phase == "start"
    get_viewport().push_input(event, true)
  await frames(2)

func touch(phase: String, position: Vector2, index := 0) -> void:
  if phase == "move":
    var event := InputEventScreenDrag.new()
    event.index = index
    event.device = 1001
    event.position = position
    get_viewport().push_input(event, true)
  else:
    var event := InputEventScreenTouch.new()
    event.index = index
    event.device = 1001
    event.position = position
    event.pressed = phase == "start"
    event.canceled = phase == "cancel"
    get_viewport().push_input(event, true)
  await frames(2)

func wheel(position: Vector2, button := MOUSE_BUTTON_WHEEL_DOWN) -> void:
  var event := InputEventMouseButton.new()
  event.device = 1001
  event.position = position
  event.button_index = button
  event.pressed = true
  event.factor = 1
  get_viewport().push_input(event, true)
  await frames(3)

func resize_window(size: Vector2i) -> void:
  get_window().size = size
  await wait_js("GodotApp.stats().environment.window.width === %d && GodotApp.stats().environment.window.height === %d" % [size.x, size.y], 4)
  await frames(4)
