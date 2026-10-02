extends "res://scripts/pointer_validation.gd"

func key(code: Key, unicode_value: int = 0, shift := false, ctrl := false) -> void:
  for pressed in [true, false]:
    var event := InputEventKey.new()
    event.keycode = code
    event.unicode = unicode_value
    event.shift_pressed = shift
    event.ctrl_pressed = ctrl
    event.pressed = pressed
    get_viewport().push_input(event)

