extends Control

# The bar's activity indicator: an arc that turns while it is shown. Hidden, it neither draws nor processes.

const SPEED := 5.0
const SWEEP := TAU * 0.72

var _angle := 0.0


func _ready() -> void:
  custom_minimum_size = Vector2(20, 20)
  mouse_filter = Control.MOUSE_FILTER_IGNORE
  set_process(is_visible_in_tree())


func _notification(what: int) -> void:
  if what == NOTIFICATION_VISIBILITY_CHANGED:
    set_process(is_visible_in_tree())


func _process(delta: float) -> void:
  _angle = fmod(_angle + delta * SPEED, TAU)
  queue_redraw()


func _draw() -> void:
  var colour := get_theme_color(&"font_color", &"HeadingLabel")
  draw_arc(size * 0.5, minf(size.x, size.y) * 0.5 - 2.0, _angle, _angle + SWEEP, 28, colour, 2.5, true)


func is_animating() -> bool:
  return is_visible_in_tree() and is_processing()
